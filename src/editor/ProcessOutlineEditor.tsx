import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import {
  PROCESS_OUTLINE_NODE_TYPES,
  ProcessOutlineError,
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
import type { ProcessOutlineMessages } from './processOutlineMessages'
import './ProcessOutlineEditor.css'

export interface ProcessOutlineEditorProps {
  modeler: ProcessOutlineModeler | null
  messages: ProcessOutlineMessages
  direction?: 'ltr' | 'rtl'
  className?: string
  confirmDelete?: (item: ProcessOutlineItem) => boolean | Promise<boolean>
}

interface NodeEditState {
  kind: 'node'
  name: string
  documentation: string
  calledElement: string
}

interface FlowEditState {
  kind: 'flow'
  name: string
  sourceId: string
  targetId: string
  condition: string
  isDefault: boolean
}

type EditState = NodeEditState | FlowEditState

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
        name: item.name,
        documentation: item.documentation,
        calledElement: item.calledElement ?? ''
      }
    : {
        kind: 'flow',
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
  confirmDelete
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
    if (editState && (!activeId || !snapshot.items.some((item) => item.id === activeId))) {
      setEditState(null)
    }
  }, [activeId, editState, snapshot.items])

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

  const reportError = useCallback((caught: unknown) => {
    setError(caughtOutlineError(caught))
    setStatus('')
  }, [])

  const focusItem = useCallback(
    (index: number) => {
      if (snapshot.items.length === 0) return
      const bounded = Math.max(0, Math.min(snapshot.items.length - 1, index))
      const id = snapshot.items[bounded]?.id
      if (!id) return
      setActiveId(id)
      requestAnimationFrame(() => rowRefs.current.get(id)?.focus())
    },
    [snapshot.items]
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
    setEditState(initialEditState(item))
    setError(null)
    requestAnimationFrame(() => firstEditInputRef.current?.focus())
  }, [])

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
        if (nextId) requestAnimationFrame(() => rowRefs.current.get(nextId)?.focus())
      } catch (caught) {
        reportError(caught)
      }
    },
    [activeIndex, confirmDelete, messages, reportError, snapshot.items]
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
    if (!activeItem || !editState) return
    try {
      if (activeItem.kind === 'node' && editState.kind === 'node') {
        controllerRef.current?.updateNode(activeItem.id, {
          name: editState.name,
          documentation: editState.documentation,
          calledElement:
            activeItem.type === 'bpmn:CallActivity' ? editState.calledElement : undefined
        })
      } else if (activeItem.kind === 'flow' && editState.kind === 'flow') {
        controllerRef.current?.updateFlow(activeItem.id, {
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
      setStatus(messages.updatedStatus(activeItem.id))
      setError(null)
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
        <span className="orbitpm-process-outline__summary">
          {messages.validationSummary(errors, warnings)}
        </span>
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
                const issueCount = snapshot.issues.filter(
                  (issue) => issue.itemId === item.id
                ).length
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
                    {issueCount > 0 ? (
                      <span
                        className="orbitpm-process-outline__issue-count"
                        aria-label={messages.validationSummary(issueCount, 0)}
                      >
                        {issueCount}
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
                <label>
                  {messages.itemNameLabel}
                  <input
                    ref={firstEditInputRef}
                    value={editState.name}
                    onChange={(event) => setEditState({ ...editState, name: event.target.value })}
                  />
                </label>
                {activeItem.kind === 'node' && editState.kind === 'node' ? (
                  <>
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
                ) : null}
                {activeItem.kind === 'flow' && editState.kind === 'flow' ? (
                  <>
                    <label>
                      {messages.sourceLabel}
                      <select
                        value={editState.sourceId}
                        onChange={(event) =>
                          setEditState({
                            ...editState,
                            sourceId: event.target.value
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
                        disabled={editState.isDefault}
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
                  </>
                ) : null}
                <div className="orbitpm-process-outline__actions">
                  <button type="submit">{messages.saveChanges}</button>
                  <button type="button" onClick={() => setEditState(null)}>
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
                  {activeItem.kind === 'flow' && activeItem.condition ? (
                    <div>
                      <dt>{messages.conditionLabel}</dt>
                      <dd>
                        <code lang="en">{activeItem.condition}</code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="orbitpm-process-outline__actions">
                  <button type="button" onClick={() => beginEdit(activeItem)}>
                    {messages.editItem}
                  </button>
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
                  disabled={connectionDefault}
                  aria-describedby={newConditionHintId}
                  onChange={(event) => {
                    setConnectionCondition(event.target.value)
                    setConnectionDefault(false)
                  }}
                />
              </label>
              <p id={newConditionHintId}>{messages.conditionHint}</p>
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
