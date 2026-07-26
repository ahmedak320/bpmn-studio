import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref
} from 'react'
import {
  PROCESS_OUTLINE_NODE_TYPES,
  ProcessOutlineError,
  canSetProcessOutlineCondition,
  canSetProcessOutlineDefault,
  createProcessOutlineController,
  emptyProcessOutlineSnapshot,
  planLinearNodeSwap,
  type ProcessOutlineController,
  type ProcessOutlineItem,
  type ProcessOutlineModeler,
  type ProcessOutlineNode,
  type ProcessOutlineNodeType,
  type ProcessOutlineSnapshot
} from './processOutline'
import { processOutlineMetadataVisibility } from './processOutlineMetadata'
import type { ProcessOutlineMessages } from './processOutlineMessages'
import { TRIGGER_TYPES } from '../org/orgModel'
import './ProcessOutlineEditor.css'

export interface ProcessOutlineEditorProps {
  modeler: ProcessOutlineModeler | null
  messages: ProcessOutlineMessages
  direction?: 'ltr' | 'rtl'
  className?: string
  confirmDelete?: (item: ProcessOutlineItem) => boolean | Promise<boolean>
  onOpenProcessDetails?: () => void
}

interface NodeEditState {
  kind: 'node'
  itemId: string
  name: string
  documentation: string
  calledElement: string
  metadata: ProcessOutlineNode['metadata']
}

interface FlowEditState {
  kind: 'flow'
  itemId: string
  name: string
  sourceId: string
  targetId: string
  condition: string
  isDefault: boolean
}

type EditState = NodeEditState | FlowEditState

type ProcessOutlineNodeMetadata = ProcessOutlineNode['metadata']

function hasMissingTriggerService(metadata: ProcessOutlineNodeMetadata): boolean {
  return metadata.triggers.some((entry) => entry.type === 'dmthub' && entry.service.trim() === '')
}

interface NodeMetadataFieldsProps {
  metadata: ProcessOutlineNodeMetadata
  nodeType: string
  messages: ProcessOutlineMessages
  firstInputRef: Ref<HTMLInputElement>
  onChange: (metadata: ProcessOutlineNodeMetadata) => void
}

function NodeMetadataFields({
  metadata,
  nodeType,
  messages,
  firstInputRef,
  onChange
}: NodeMetadataFieldsProps): JSX.Element {
  const triggerErrorIdPrefix = useId()
  const visibility = processOutlineMetadataVisibility(nodeType)

  const update = <Key extends keyof ProcessOutlineNodeMetadata>(
    key: Key,
    value: ProcessOutlineNodeMetadata[Key]
  ): void => {
    onChange({ ...metadata, [key]: value })
  }

  const updateTrigger = (
    index: number,
    patch: Partial<ProcessOutlineNodeMetadata['triggers'][number]>
  ): void => {
    update(
      'triggers',
      metadata.triggers.map((entry, rowIndex) =>
        rowIndex === index ? { ...entry, ...patch } : entry
      )
    )
  }

  return (
    <>
      <fieldset className="orbitpm-process-outline__fieldset">
        <legend>{messages.labelsHeading}</legend>
        <label>
          {messages.nameEnLabel}
          <input
            ref={firstInputRef}
            dir="auto"
            value={metadata.nameEn}
            onChange={(event) => update('nameEn', event.target.value)}
          />
        </label>
        <label>
          {messages.nameArLabel}
          <input
            dir="auto"
            value={metadata.nameAr}
            onChange={(event) => update('nameAr', event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="orbitpm-process-outline__fieldset">
        <legend>{messages.ownerHeading}</legend>
        <label>
          {messages.ownerLabel}
          <input
            dir="auto"
            value={metadata.owner}
            onChange={(event) => update('owner', event.target.value)}
          />
        </label>
        <label>
          {messages.ownerTypeLabel}
          <select
            value={metadata.ownerType}
            onChange={(event) => update('ownerType', event.target.value)}
          >
            <option value="">{messages.ownerTypeNone}</option>
            <option value="individual">{messages.ownerTypeIndividual}</option>
            <option value="department">{messages.ownerTypeDepartment}</option>
            <option value="division">{messages.ownerTypeDivision}</option>
          </select>
        </label>
        <label>
          {messages.ownerRoleLabel}
          <select
            value={metadata.ownerRole || 'R'}
            onChange={(event) => update('ownerRole', event.target.value)}
          >
            <option value="R">{messages.ownerRoleResponsible}</option>
            <option value="A">{messages.ownerRoleAccountable}</option>
            <option value="C">{messages.ownerRoleConsulted}</option>
            <option value="I">{messages.ownerRoleInformed}</option>
          </select>
        </label>
        <label>
          {messages.responsiblePeopleLabel}
          <textarea
            dir="auto"
            value={metadata.respList}
            onChange={(event) => update('respList', event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="orbitpm-process-outline__fieldset">
        <legend>{messages.noteHeading}</legend>
        <label>
          {messages.noteLabel}
          <textarea
            dir="auto"
            value={metadata.note}
            onChange={(event) => update('note', event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="orbitpm-process-outline__fieldset">
        <legend>{messages.stepDataHeading}</legend>
        <label>
          {messages.inputsLabel}
          <textarea
            dir="auto"
            value={metadata.inputs}
            onChange={(event) => update('inputs', event.target.value)}
          />
        </label>
        <label>
          {messages.outputsLabel}
          <textarea
            dir="auto"
            value={metadata.outputs}
            onChange={(event) => update('outputs', event.target.value)}
          />
        </label>
        <label>
          {messages.systemLabel}
          <input
            dir="auto"
            value={metadata.system}
            onChange={(event) => update('system', event.target.value)}
          />
        </label>
        <label>
          {messages.ccListLabel}
          <textarea
            dir="auto"
            value={metadata.ccList}
            onChange={(event) => update('ccList', event.target.value)}
          />
        </label>
        {visibility.decisionBasis ? (
          <label>
            {messages.decisionBasisLabel}
            <textarea
              dir="auto"
              value={metadata.decisionBasis}
              onChange={(event) => update('decisionBasis', event.target.value)}
            />
          </label>
        ) : null}
      </fieldset>

      {visibility.channel ? (
        <fieldset className="orbitpm-process-outline__fieldset">
          <legend>{messages.channelHeading}</legend>
          <label>
            {messages.channelLabel}
            <select
              value={metadata.channel}
              onChange={(event) => update('channel', event.target.value)}
            >
              <option value="">{messages.channelNone}</option>
              <option value="dmthub">{messages.channelDmthub}</option>
              <option value="email">{messages.channelEmail}</option>
              <option value="data">{messages.channelData}</option>
            </select>
          </label>
          {metadata.channel ? (
            <label>
              {messages.channelDetailLabel}
              <input
                dir="auto"
                value={metadata.channelDetail}
                onChange={(event) => update('channelDetail', event.target.value)}
              />
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {visibility.cc ? (
        <fieldset className="orbitpm-process-outline__fieldset">
          <legend>{messages.ccHeading}</legend>
          <label className="orbitpm-process-outline__checkbox">
            <input
              type="checkbox"
              checked={metadata.cc}
              onChange={(event) => update('cc', event.target.checked)}
            />
            {messages.ccLabel}
          </label>
          <label>
            {messages.ccToLabel}
            <input
              dir="auto"
              value={metadata.ccTo}
              disabled={!metadata.cc}
              onChange={(event) => update('ccTo', event.target.value)}
            />
          </label>
        </fieldset>
      ) : null}

      {visibility.triggers ? (
        <fieldset className="orbitpm-process-outline__fieldset">
          <legend>{messages.triggerHeading}</legend>
          {metadata.triggers.map((entry, index) => {
            const serviceMissing = entry.type === 'dmthub' && entry.service.trim() === ''
            return (
              <div className="orbitpm-process-outline__trigger-row" key={index}>
                <strong>{messages.triggerRowLabel(index + 1)}</strong>
                <label>
                  {messages.triggerTypeLabel}
                  <select
                    aria-label={messages.triggerTypeRowLabel(index + 1)}
                    value={entry.type}
                    onChange={(event) => updateTrigger(index, { type: event.target.value })}
                  >
                    {TRIGGER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {messages.triggerType(type)}
                      </option>
                    ))}
                  </select>
                </label>
                {entry.type === 'dmthub' ? (
                  <label>
                    {messages.triggerServiceLabel}
                    <input
                      dir="auto"
                      value={entry.service}
                      aria-label={messages.triggerServiceLabel}
                      aria-invalid={serviceMissing}
                      aria-describedby={
                        serviceMissing ? `${triggerErrorIdPrefix}-${index}` : undefined
                      }
                      onChange={(event) => updateTrigger(index, { service: event.target.value })}
                    />
                    {serviceMissing ? (
                      <span
                        id={`${triggerErrorIdPrefix}-${index}`}
                        className="orbitpm-process-outline__field-error"
                        role="alert"
                      >
                        {messages.triggerServiceRequired}
                      </span>
                    ) : null}
                  </label>
                ) : null}
                <label>
                  {messages.triggerDetailLabel}
                  <input
                    dir="auto"
                    value={entry.detail}
                    onChange={(event) => updateTrigger(index, { detail: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  aria-label={messages.removeTriggerLabel(index + 1)}
                  onClick={() =>
                    update(
                      'triggers',
                      metadata.triggers.filter((_, rowIndex) => rowIndex !== index)
                    )
                  }
                >
                  {messages.removeTrigger}
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() =>
              update('triggers', [...metadata.triggers, { type: 'email', service: '', detail: '' }])
            }
          >
            {messages.addTrigger}
          </button>
        </fieldset>
      ) : null}
    </>
  )
}

function caughtOutlineError(caught: unknown): ProcessOutlineError {
  return caught instanceof ProcessOutlineError
    ? caught
    : new ProcessOutlineError('service-unavailable')
}

function itemById(
  snapshot: ProcessOutlineSnapshot,
  id: string | null
): ProcessOutlineItem | undefined {
  return id ? snapshot.items.find((item) => item.id === id) : undefined
}

function initialEditState(item: ProcessOutlineItem): EditState {
  return item.kind === 'node'
    ? {
        kind: 'node',
        itemId: item.id,
        name: item.name,
        documentation: item.documentation,
        calledElement: item.calledElement ?? '',
        metadata: {
          ...item.metadata,
          triggers: item.metadata.triggers.map((entry) => ({ ...entry }))
        }
      }
    : {
        kind: 'flow',
        itemId: item.id,
        name: item.name,
        sourceId: item.sourceId,
        targetId: item.targetId,
        condition: item.condition,
        isDefault: item.isDefault
      }
}

export function ProcessOutlineEditor({
  modeler,
  messages,
  direction = 'ltr',
  className,
  confirmDelete,
  onOpenProcessDetails
}: ProcessOutlineEditorProps): JSX.Element {
  const instanceId = useId()
  const titleId = `${instanceId}-title`
  const keyboardHelpId = `${instanceId}-keyboard-help`
  const detailsTitleId = `${instanceId}-details-title`
  const conditionHintId = `${instanceId}-condition-hint`
  const addTitleId = `${instanceId}-add-title`
  const connectTitleId = `${instanceId}-connect-title`
  const newConditionHintId = `${instanceId}-new-condition-hint`
  const validationTitleId = `${instanceId}-validation-title`
  const controllerRef = useRef<ProcessOutlineController | null>(null)
  const announcedSelectionIdRef = useRef<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const firstEditInputRef = useRef<HTMLInputElement | null>(null)
  const [snapshot, setSnapshot] = useState<ProcessOutlineSnapshot>(emptyProcessOutlineSnapshot)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [error, setError] = useState<ProcessOutlineError | null>(null)
  const [status, setStatus] = useState('')

  const [newType, setNewType] = useState<ProcessOutlineNodeType>('bpmn:Task')
  const [newName, setNewName] = useState('')
  const [connectFromId, setConnectFromId] = useState('')

  const [connectionSourceId, setConnectionSourceId] = useState('')
  const [connectionTargetId, setConnectionTargetId] = useState('')
  const [connectionName, setConnectionName] = useState('')
  const [connectionCondition, setConnectionCondition] = useState('')
  const [connectionDefault, setConnectionDefault] = useState(false)

  useEffect(() => {
    controllerRef.current?.destroy()
    controllerRef.current = null
    if (!modeler) {
      setSnapshot(emptyProcessOutlineSnapshot())
      setActiveId(null)
      return
    }

    let controller: ProcessOutlineController
    try {
      controller = createProcessOutlineController(modeler)
    } catch (caught) {
      setError(caughtOutlineError(caught))
      setSnapshot(emptyProcessOutlineSnapshot())
      return
    }
    controllerRef.current = controller
    const unsubscribe = controller.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot)
      const selectedId = nextSnapshot.selectedIds[0] ?? null
      if (selectedId !== announcedSelectionIdRef.current) {
        announcedSelectionIdRef.current = selectedId
        if (selectedId) setStatus(messages.selected(selectedId))
      }
    })
    return () => {
      unsubscribe()
      controller.destroy()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [messages, modeler])

  useEffect(() => {
    const selected = snapshot.selectedIds.find((id) =>
      snapshot.items.some((item) => item.id === id)
    )
    if (selected) {
      setActiveId(selected)
      return
    }
    if (!activeId || !snapshot.items.some((item) => item.id === activeId)) {
      setActiveId(snapshot.items[0]?.id ?? null)
    }
  }, [activeId, snapshot])

  useEffect(() => {
    if (
      editState &&
      (editState.itemId !== activeId ||
        !snapshot.items.some((item) => item.id === editState.itemId))
    ) {
      setEditState(null)
    }
  }, [activeId, editState, snapshot.items])

  useEffect(() => {
    if (editState?.itemId) firstEditInputRef.current?.focus()
  }, [editState?.itemId])

  useEffect(() => {
    if (connectionSourceId && snapshot.nodes.some((node) => node.id === connectionSourceId)) {
      return
    }
    setConnectionSourceId(snapshot.nodes[0]?.id ?? '')
  }, [connectionSourceId, snapshot.nodes])

  useEffect(() => {
    if (connectionTargetId && snapshot.nodes.some((node) => node.id === connectionTargetId)) {
      return
    }
    setConnectionTargetId(snapshot.nodes[1]?.id ?? snapshot.nodes[0]?.id ?? '')
  }, [connectionTargetId, snapshot.nodes])

  const connectionSource = snapshot.nodes.find((node) => node.id === connectionSourceId)
  const connectionCanDefault = canSetProcessOutlineDefault(connectionSource?.type ?? '')
  const connectionCanCondition = canSetProcessOutlineCondition(connectionSource?.type ?? '')

  useEffect(() => {
    if (connectionDefault && !connectionCanDefault) setConnectionDefault(false)
  }, [connectionCanDefault, connectionDefault])

  useEffect(() => {
    if (connectionCondition && !connectionCanCondition) setConnectionCondition('')
  }, [connectionCanCondition, connectionCondition])

  const activeItem = useMemo(() => itemById(snapshot, activeId), [activeId, snapshot])
  const activeIndex = activeItem
    ? snapshot.items.findIndex((item) => item.id === activeItem.id)
    : -1
  const canMoveUp =
    activeItem?.kind === 'node' && planLinearNodeSwap(snapshot, activeItem.id, 'up') !== null
  const canMoveDown =
    activeItem?.kind === 'node' && planLinearNodeSwap(snapshot, activeItem.id, 'down') !== null
  const errors = snapshot.issues.filter((issue) => issue.severity === 'error').length
  const warnings = snapshot.issues.length - errors
  const editedFlowSource =
    editState?.kind === 'flow'
      ? snapshot.nodes.find((node) => node.id === editState.sourceId)
      : undefined
  const editCanDefault = canSetProcessOutlineDefault(editedFlowSource?.type ?? '')
  const editCanCondition = canSetProcessOutlineCondition(editedFlowSource?.type ?? '')
  const editHasMissingTriggerService =
    activeItem?.kind === 'node' &&
    activeItem.type === 'bpmn:StartEvent' &&
    editState?.kind === 'node' &&
    hasMissingTriggerService(editState.metadata)

  const reportError = useCallback((caught: unknown) => {
    setError(caughtOutlineError(caught))
    setStatus('')
  }, [])

  const restoreItemFocus = useCallback((itemId: string) => {
    requestAnimationFrame(() => rowRefs.current.get(itemId)?.focus())
  }, [])

  const focusItem = useCallback(
    (index: number) => {
      if (snapshot.items.length === 0) return
      const bounded = Math.max(0, Math.min(snapshot.items.length - 1, index))
      const id = snapshot.items[bounded]?.id
      if (!id) return
      setActiveId(id)
      restoreItemFocus(id)
    },
    [restoreItemFocus, snapshot.items]
  )

  const selectItem = useCallback(
    (item: ProcessOutlineItem) => {
      setActiveId(item.id)
      setError(null)
      try {
        controllerRef.current?.select(item.id)
        setStatus(messages.selected(item.id))
      } catch (caught) {
        reportError(caught)
      }
    },
    [messages, reportError]
  )

  const beginEdit = useCallback((item: ProcessOutlineItem) => {
    if (item.kind === 'flow' && !item.labelEditable) return
    setEditState(initialEditState(item))
    setError(null)
  }, [])

  const cancelEdit = useCallback(() => {
    const itemId = editState?.itemId
    setEditState(null)
    if (itemId) restoreItemFocus(itemId)
  }, [editState?.itemId, restoreItemFocus])

  const moveItem = useCallback(
    (node: ProcessOutlineNode, direction: 'up' | 'down') => {
      try {
        controllerRef.current?.moveNode(node.id, direction)
        setStatus(messages.movedStatus(node.id))
        setError(null)
      } catch (caught) {
        reportError(caught)
      }
    },
    [messages, reportError]
  )

  const deleteItem = useCallback(
    async (item: ProcessOutlineItem) => {
      const confirmed = confirmDelete
        ? await confirmDelete(item)
        : window.confirm(messages.deleteConfirmation(item))
      if (!confirmed) return
      const nextId =
        snapshot.items[activeIndex + 1]?.id ?? snapshot.items[activeIndex - 1]?.id ?? null
      try {
        controllerRef.current?.deleteItem(item.id)
        setEditState(null)
        setActiveId(nextId)
        setStatus(messages.deletedStatus(item.id))
        setError(null)
        if (nextId) restoreItemFocus(nextId)
      } catch (caught) {
        reportError(caught)
      }
    },
    [activeIndex, confirmDelete, messages, reportError, restoreItemFocus, snapshot.items]
  )

  const handleItemKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>, item: ProcessOutlineItem) => {
      if (event.altKey || event.metaKey) return
      if (event.ctrlKey && item.kind === 'node') {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveItem(item, 'up')
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveItem(item, 'down')
        }
        return
      }
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          focusItem(activeIndex - 1)
          break
        case 'ArrowDown':
          event.preventDefault()
          focusItem(activeIndex + 1)
          break
        case 'Home':
          event.preventDefault()
          focusItem(0)
          break
        case 'End':
          event.preventDefault()
          focusItem(snapshot.items.length - 1)
          break
        case 'Enter':
        case ' ':
          event.preventDefault()
          selectItem(item)
          break
        case 'F2':
          event.preventDefault()
          beginEdit(item)
          break
        case 'Delete':
          event.preventDefault()
          void deleteItem(item)
          break
      }
    },
    [activeIndex, beginEdit, deleteItem, focusItem, moveItem, selectItem, snapshot.items.length]
  )

  const handleAddNode = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      const node = controllerRef.current?.addNode({
        type: newType,
        name: newName,
        connectFromId: connectFromId || undefined
      })
      if (!node) return
      setNewName('')
      setActiveId(node.id)
      setStatus(messages.addedStatus(node.id))
      setError(null)
    } catch (caught) {
      reportError(caught)
    }
  }

  const handleConnect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      const flow = controllerRef.current?.connectNodes({
        sourceId: connectionSourceId,
        targetId: connectionTargetId,
        name: connectionName,
        condition: connectionCondition,
        isDefault: connectionDefault
      })
      if (!flow) return
      setConnectionName('')
      setConnectionCondition('')
      setConnectionDefault(false)
      setActiveId(flow.id)
      setStatus(messages.connectedStatus(flow.id))
      setError(null)
    } catch (caught) {
      reportError(caught)
    }
  }

  const handleSaveEdit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!editState || editState.itemId !== activeId) {
      setEditState(null)
      return
    }
    const editedItem = itemById(snapshot, editState.itemId)
    if (!editedItem) {
      setEditState(null)
      return
    }
    try {
      if (editedItem.kind === 'node' && editState.kind === 'node') {
        controllerRef.current?.updateNode(editedItem.id, {
          name: editState.name,
          documentation: editState.documentation,
          calledElement:
            editedItem.type === 'bpmn:CallActivity' ? editState.calledElement : undefined,
          metadata: editState.metadata
        })
      } else if (editedItem.kind === 'flow' && editState.kind === 'flow') {
        controllerRef.current?.updateFlow(editedItem.id, {
          name: editState.name,
          sourceId: editState.sourceId,
          targetId: editState.targetId,
          condition: editState.condition,
          isDefault: editState.isDefault
        })
      } else {
        return
      }
      setEditState(null)
      setStatus(messages.updatedStatus(editedItem.id))
      setError(null)
      restoreItemFocus(editedItem.id)
    } catch (caught) {
      reportError(caught)
    }
  }

  const selectedStatus = snapshot.selectedIds[0] ? messages.selected(snapshot.selectedIds[0]) : ''
  const rootClassName = ['orbitpm-process-outline', className?.trim()].filter(Boolean).join(' ')

  return (
    <section className={rootClassName} dir={direction} aria-labelledby={titleId}>
      <header className="orbitpm-process-outline__header">
        <div>
          <h2 id={titleId}>{messages.title}</h2>
          <p id={keyboardHelpId}>{messages.keyboardHelp}</p>
        </div>
        <div className="orbitpm-process-outline__header-actions">
          {onOpenProcessDetails ? (
            <button type="button" onClick={onOpenProcessDetails}>
              {messages.editProcessDetails}
            </button>
          ) : null}
          <span className="orbitpm-process-outline__summary">
            {messages.validationSummary(errors, warnings)}
          </span>
        </div>
      </header>

      {!modeler ? (
        <p className="orbitpm-process-outline__empty">{messages.unavailable}</p>
      ) : (
        <>
          {error ? (
            <p className="orbitpm-process-outline__error" role="alert">
              {messages.error(error)}
            </p>
          ) : null}
          <p className="orbitpm-process-outline__status" role="status" aria-live="polite">
            {status || selectedStatus}
          </p>

          {snapshot.items.length === 0 ? (
            <p className="orbitpm-process-outline__empty">{messages.empty}</p>
          ) : (
            <ul
              className="orbitpm-process-outline__tree"
              role="tree"
              aria-label={messages.listLabel}
              aria-describedby={keyboardHelpId}
            >
              {snapshot.items.map((item) => {
                const selected = activeId === item.id
                const itemIssues = snapshot.issues.filter((issue) => issue.itemId === item.id)
                const itemErrorCount = itemIssues.filter(
                  (issue) => issue.severity === 'error'
                ).length
                const itemWarningCount = itemIssues.length - itemErrorCount
                return (
                  <li
                    key={item.id}
                    ref={(element) => {
                      if (element) rowRefs.current.set(item.id, element)
                      else rowRefs.current.delete(item.id)
                    }}
                    role="treeitem"
                    aria-level={1}
                    aria-selected={selected}
                    aria-label={messages.itemLabel(item)}
                    tabIndex={selected ? 0 : -1}
                    className={`orbitpm-process-outline__item orbitpm-process-outline__item--${item.kind}`}
                    data-outline-id={item.id}
                    onFocus={() => setActiveId(item.id)}
                    onClick={() => selectItem(item)}
                    onKeyDown={(event) => handleItemKeyDown(event, item)}
                  >
                    <span className="orbitpm-process-outline__kind">
                      {item.kind === 'node' ? messages.nodeKind : messages.flowKind}
                    </span>
                    <span className="orbitpm-process-outline__item-main">
                      <strong>
                        {item.kind === 'node' ? messages.nodeType(item.type) : item.name || item.id}
                      </strong>
                      {item.kind === 'node' ? (
                        item.name ? (
                          <span>{item.name}</span>
                        ) : null
                      ) : (
                        <span>
                          <bdi lang="en">{item.sourceId}</bdi>
                          {' → '}
                          <bdi lang="en">{item.targetId}</bdi>
                        </span>
                      )}
                    </span>
                    <code lang="en">{item.id}</code>
                    {item.kind === 'flow' && item.isDefault ? (
                      <span className="orbitpm-process-outline__badge">
                        {messages.defaultFlowLabel}
                      </span>
                    ) : null}
                    {itemIssues.length > 0 ? (
                      <span
                        className="orbitpm-process-outline__issue-count"
                        aria-label={messages.validationSummary(itemErrorCount, itemWarningCount)}
                      >
                        {messages.formatNumber(itemIssues.length)}
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          <section className="orbitpm-process-outline__panel" aria-labelledby={detailsTitleId}>
            <h3 id={detailsTitleId}>{messages.detailsHeading}</h3>
            {!activeItem ? (
              <p>{messages.noSelection}</p>
            ) : editState ? (
              <form onSubmit={handleSaveEdit}>
                {activeItem.kind === 'node' && editState.kind === 'node' ? (
                  <>
                    <NodeMetadataFields
                      metadata={editState.metadata}
                      nodeType={activeItem.type}
                      messages={messages}
                      firstInputRef={firstEditInputRef}
                      onChange={(metadata) => setEditState({ ...editState, metadata })}
                    />
                    <label>
                      {messages.documentationLabel}
                      <textarea
                        value={editState.documentation}
                        onChange={(event) =>
                          setEditState({
                            ...editState,
                            documentation: event.target.value
                          })
                        }
                      />
                    </label>
                    {activeItem.type === 'bpmn:CallActivity' ? (
                      <label>
                        {messages.calledElementLabel}
                        <input
                          dir="ltr"
                          value={editState.calledElement}
                          onChange={(event) =>
                            setEditState({
                              ...editState,
                              calledElement: event.target.value
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  <label>
                    {messages.itemNameLabel}
                    <input
                      ref={firstEditInputRef}
                      value={editState.name}
                      onChange={(event) => setEditState({ ...editState, name: event.target.value })}
                    />
                  </label>
                )}
                {activeItem.kind === 'flow' && activeItem.editable && editState.kind === 'flow' ? (
                  <>
                    <label>
                      {messages.sourceLabel}
                      <select
                        value={editState.sourceId}
                        onChange={(event) => {
                          const sourceId = event.target.value
                          const source = snapshot.nodes.find((node) => node.id === sourceId)
                          setEditState({
                            ...editState,
                            sourceId,
                            condition: canSetProcessOutlineCondition(source?.type ?? '')
                              ? editState.condition
                              : '',
                            isDefault: canSetProcessOutlineDefault(source?.type ?? '')
                              ? editState.isDefault
                              : false
                          })
                        }}
                      >
                        {snapshot.nodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name || node.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {messages.targetLabel}
                      <select
                        value={editState.targetId}
                        onChange={(event) =>
                          setEditState({
                            ...editState,
                            targetId: event.target.value
                          })
                        }
                      >
                        {snapshot.nodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name || node.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {messages.conditionLabel}
                      <input
                        value={editState.condition}
                        disabled={editState.isDefault || !editCanCondition}
                        aria-describedby={conditionHintId}
                        onChange={(event) =>
                          setEditState({
                            ...editState,
                            condition: event.target.value,
                            isDefault: false
                          })
                        }
                      />
                    </label>
                    <p id={conditionHintId}>{messages.conditionHint}</p>
                    {editCanDefault || editState.isDefault ? (
                      <label className="orbitpm-process-outline__checkbox">
                        <input
                          type="checkbox"
                          checked={editState.isDefault}
                          onChange={(event) =>
                            setEditState({
                              ...editState,
                              isDefault: event.target.checked,
                              condition: event.target.checked ? '' : editState.condition
                            })
                          }
                        />
                        {messages.defaultFlowLabel}
                      </label>
                    ) : null}
                  </>
                ) : null}
                <div className="orbitpm-process-outline__actions">
                  <button type="submit" disabled={editHasMissingTriggerService}>
                    {messages.saveChanges}
                  </button>
                  <button type="button" onClick={cancelEdit}>
                    {messages.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <dl>
                  <div>
                    <dt>{activeItem.kind === 'node' ? messages.nodeKind : messages.flowKind}</dt>
                    <dd>{messages.itemLabel(activeItem)}</dd>
                  </div>
                  <div>
                    <dt lang="en">ID</dt>
                    <dd>
                      <code lang="en">{activeItem.id}</code>
                    </dd>
                  </div>
                  {activeItem.kind === 'node' && activeItem.documentation ? (
                    <div>
                      <dt>{messages.documentationLabel}</dt>
                      <dd>{activeItem.documentation}</dd>
                    </div>
                  ) : null}
                  {activeItem.kind === 'flow' && activeItem.editable && activeItem.condition ? (
                    <div>
                      <dt>{messages.conditionLabel}</dt>
                      <dd>
                        <code lang="en">{activeItem.condition}</code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="orbitpm-process-outline__actions">
                  {activeItem.kind === 'node' || activeItem.labelEditable ? (
                    <button type="button" onClick={() => beginEdit(activeItem)}>
                      {messages.editItem}
                    </button>
                  ) : null}
                  {activeItem.kind === 'node' ? (
                    <>
                      <button
                        type="button"
                        disabled={!canMoveUp}
                        onClick={() => moveItem(activeItem, 'up')}
                      >
                        {messages.moveUp}
                      </button>
                      <button
                        type="button"
                        disabled={!canMoveDown}
                        onClick={() => moveItem(activeItem, 'down')}
                      >
                        {messages.moveDown}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="orbitpm-process-outline__danger"
                    onClick={() => void deleteItem(activeItem)}
                  >
                    {messages.deleteItem}
                  </button>
                </div>
              </>
            )}
          </section>

          <div className="orbitpm-process-outline__form-grid">
            <form
              className="orbitpm-process-outline__panel"
              onSubmit={handleAddNode}
              aria-labelledby={addTitleId}
            >
              <h3 id={addTitleId}>{messages.addHeading}</h3>
              <label>
                {messages.nodeTypeLabel}
                <select
                  value={newType}
                  onChange={(event) => setNewType(event.target.value as ProcessOutlineNodeType)}
                >
                  {PROCESS_OUTLINE_NODE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {messages.nodeType(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {messages.newNodeLabel}
                <input value={newName} onChange={(event) => setNewName(event.target.value)} />
              </label>
              <label>
                {messages.connectFromLabel}
                <select
                  value={connectFromId}
                  onChange={(event) => setConnectFromId(event.target.value)}
                >
                  <option value="">{messages.noAutomaticConnection}</option>
                  {snapshot.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name || node.id}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">{messages.addNode}</button>
            </form>

            <form
              className="orbitpm-process-outline__panel"
              onSubmit={handleConnect}
              aria-labelledby={connectTitleId}
            >
              <h3 id={connectTitleId}>{messages.connectHeading}</h3>
              <label>
                {messages.sourceLabel}
                <select
                  value={connectionSourceId}
                  onChange={(event) => setConnectionSourceId(event.target.value)}
                >
                  {snapshot.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name || node.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {messages.targetLabel}
                <select
                  value={connectionTargetId}
                  onChange={(event) => setConnectionTargetId(event.target.value)}
                >
                  {snapshot.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name || node.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {messages.flowLabel}
                <input
                  value={connectionName}
                  onChange={(event) => setConnectionName(event.target.value)}
                />
              </label>
              <label>
                {messages.conditionLabel}
                <input
                  value={connectionCondition}
                  disabled={connectionDefault || !connectionCanCondition}
                  aria-describedby={newConditionHintId}
                  onChange={(event) => {
                    setConnectionCondition(event.target.value)
                    setConnectionDefault(false)
                  }}
                />
              </label>
              <p id={newConditionHintId}>{messages.conditionHint}</p>
              {connectionCanDefault ? (
                <label className="orbitpm-process-outline__checkbox">
                  <input
                    type="checkbox"
                    checked={connectionDefault}
                    onChange={(event) => {
                      setConnectionDefault(event.target.checked)
                      if (event.target.checked) setConnectionCondition('')
                    }}
                  />
                  {messages.defaultFlowLabel}
                </label>
              ) : null}
              <button
                type="submit"
                disabled={snapshot.nodes.length < 2 || !connectionSourceId || !connectionTargetId}
              >
                {messages.connectNodes}
              </button>
            </form>
          </div>

          <section className="orbitpm-process-outline__panel" aria-labelledby={validationTitleId}>
            <h3 id={validationTitleId}>{messages.validationHeading}</h3>
            {snapshot.issues.length === 0 ? (
              <p>{messages.validationEmpty}</p>
            ) : (
              <ul className="orbitpm-process-outline__issues" aria-live="polite">
                {snapshot.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.itemId ?? 'document'}-${index}`}>
                    {issue.itemId ? (
                      <button
                        type="button"
                        onClick={() => {
                          const item = itemById(snapshot, issue.itemId ?? null)
                          if (item) selectItem(item)
                        }}
                      >
                        <code lang="en">{issue.code}</code>
                        {' — '}
                        {messages.issue(issue)}
                      </button>
                    ) : (
                      <>
                        <code lang="en">{issue.code}</code>
                        {' — '}
                        {messages.issue(issue)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  )
}

export default ProcessOutlineEditor
