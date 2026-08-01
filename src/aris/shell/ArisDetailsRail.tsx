/**
 * The properties rail, rendered from `src/aris/details`.
 *
 * The details lane is headless by design: `buildAllTabs` returns i18n keys plus
 * interpolation variables and never a display string. This component is the
 * rendering half of that contract — it looks every `labelKey`/`valueKey` up in
 * the dictionary and renders bilingual name rows side by side, which is what
 * plan §13.5 ("all AnimalWF metadata remains available") asks the UI to make
 * true.
 *
 * ## Editing (plan §13.3, §11.4)
 *
 * The rail used to be read-only, which left five §11.4 operations — rename
 * definition, edit definition attributes, restyle occurrence, add/remove a
 * linked-model assignment and add/download/remove an attachment — reachable
 * only from unit tests. They are now reachable from the tabs the plan places
 * them on, and every one of them goes through `ArisAuthoring` (passed in as
 * `editing`), so an edit made here is the same kind of command a canvas gesture
 * makes: one undo step, validated before it mutates, and carried into the
 * derived export.
 *
 * The read-only tabs (Accounting, Fidelity, Relations, Revision history) are
 * untouched: `editing` only ever *adds* controls to General, Names, Attributes,
 * Assignments and Attachments.
 *
 * ## Keyboard and screen readers (UI-03)
 *
 * The tab strip is a real ARIA tablist with roving tabindex, Home/End and
 * direction-aware arrow keys (in RTL, ArrowLeft moves *forward*), and each tab
 * owns a `role="tabpanel"` it is wired to in both directions. Every field is a
 * `<label htmlFor>`-associated control described by its group's §8.2 scope
 * note, and attachment removal focuses its own confirmation. The whole rail can
 * therefore be driven with Tab, the arrow keys, Enter and Escape alone.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'

import { getDir, t } from '../../i18n'
import type { Key } from '../../i18n'
import { arisAttributeTypeName } from '../conventions/displayNames'
import {
  ARIS_DETAILS_TAB_LABEL_KEYS,
  ARIS_DETAILS_TAB_ORDER,
  buildAllTabs,
  type ArisDetailRow,
  type ArisDetailsTabId
} from '../details/tabs'
import type { ArisDetailsDocument, ArisDetailsElement } from '../details/seam'
import { prepareAttachmentDownload, scanAttachment } from '../details/attachments'
import {
  METADATA_CATEGORY_LABEL_KEYS,
  defaultMetadataVisibility,
  summarizeMetadata
} from '../details/metadata'
import type { ArisWorkingDocument } from '../model/types'
import {
  ArisAssignmentsEditor,
  ArisAttachmentsEditor,
  ArisAttributesEditor,
  ArisBilingualEditor,
  ArisModelAttributesEditor,
  ArisStyleEditor,
  ArisTextEditor
} from './ArisDetailsEditors'
import {
  ARIS_FALLBACK_LOCALE_IDS,
  arisEditTarget,
  arisLocaleConvention,
  bilingualSlots,
  readAuthoredAttachments,
  targetDefinition,
  upsertAttributeValue,
  type ArisDetailsEditingApi,
  type ArisEditLang
} from './arisDetailsEditing'
import type { ArisRailFieldTarget } from './arisValidationFindings'
import { tk } from './shellI18n'

/**
 * The rail hosts the Details tabs minus Accounting and Fidelity: those two are
 * per-element source-fidelity surfaces that issue 5 removed from the shell. The
 * pure `src/aris/details/tabs.ts` layer is untouched; the strip filters at
 * render time only.
 */
const ARIS_DETAILS_RAIL_VISIBLE_TABS: readonly ArisDetailsTabId[] = ARIS_DETAILS_TAB_ORDER.filter(
  (id) => id !== 'accounting' && id !== 'fidelity'
)

/** A one-shot request to open a details tab and flash one field. */
export interface ArisDetailsRailHighlight {
  readonly token: number
  readonly tab: ArisDetailsTabId
  readonly field: ArisRailFieldTarget | null
}

function renderValue(row: ArisDetailRow): string {
  if (row.valueKey) {
    return t(row.valueKey as Key, row.vars)
  }
  if (row.missing || row.value === null || row.value === undefined || row.value === '') {
    return tk('aris.details.missing', 'Not set')
  }
  return String(row.value)
}

function DetailRows({ rows }: { rows: readonly ArisDetailRow[] }): JSX.Element {
  if (rows.length === 0) {
    return (
      <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 13 }}>
        {tk('aris.details.emptyTab', 'No values for this tab.')}
      </p>
    )
  }
  return (
    <dl className="orbitpm-aris-defs">
      {rows.map((row, index) => (
        <div key={`${row.labelKey}:${index}`} style={{ display: 'contents' }}>
          <dt>{t(row.labelKey as Key, row.vars)}</dt>
          <dd>
            {row.bilingual ? (
              <span style={{ display: 'grid', gap: 2 }}>
                <span lang="en" dir="ltr">
                  {row.bilingual.en ?? tk('aris.details.missing', 'Not set')}
                </span>
                <span lang="ar" dir="rtl">
                  {row.bilingual.ar ?? tk('aris.details.missing', 'Not set')}
                </span>
              </span>
            ) : (
              renderValue(row)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The §13.1 metadata layers for the model the selection belongs to. Every layer
 * is enabled by default; the counts come from the details lane's own summary.
 */
function MetadataLayers({
  details,
  modelId
}: {
  details: ArisDetailsDocument
  modelId: string | null
}): JSX.Element | null {
  const summary = useMemo(() => {
    const model = modelId ? details.models.get(modelId) : null
    if (!model) return null
    return summarizeMetadata(model.satellites, defaultMetadataVisibility())
  }, [details, modelId])

  const active = summary?.layers.filter((layer) => layer.count > 0) ?? []
  if (active.length === 0) return null

  return (
    <div data-orbitpm-aris-metadata-layers="" style={{ marginTop: 10 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>{tk('aris.rail.metadata', 'Metadata')}</h4>
      <dl className="orbitpm-aris-defs">
        {active.map((layer) => (
          <div key={layer.category} style={{ display: 'contents' }}>
            <dt>{t(METADATA_CATEGORY_LABEL_KEYS[layer.category] as Key)}</dt>
            <dd>{layer.count}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** §13.4: exact-byte attachment download, never previewed or executed. */
function AttachmentActions({
  details,
  element,
  onDownload
}: {
  details: ArisDetailsDocument
  element: ArisDetailsElement
  onDownload: (filename: string, bytes: Uint8Array, mimeType: string) => void
}): JSX.Element | null {
  const attachments = useMemo(() => {
    if (element.kind === 'attachment') {
      const one = details.attachments.get(element.id)
      return one ? [one] : []
    }
    if (element.kind !== 'model') return []
    const model = details.models.get(element.id)
    return model ? [...model.attachments.values()] : []
  }, [details, element])

  if (attachments.length === 0) return null

  return (
    <div data-orbitpm-aris-attachments="" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
      {attachments.slice(0, 25).map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          className="orbitpm-lite-chrome-btn"
          style={{ fontSize: 12, textAlign: 'start' }}
          onClick={() => {
            void scanAttachment(attachment).then((scan) => {
              const download = prepareAttachmentDownload(attachment, scan)
              onDownload(download.filename, download.bytes, download.mimeType)
            })
          }}
        >
          {tk('aris.details.attachment.download', 'Download {name}', {
            name: attachment.displayName
          })}
        </button>
      ))}
    </div>
  )
}

export interface ArisDetailsRailProps {
  readonly details: ArisDetailsDocument
  readonly element: ArisDetailsElement | null
  readonly elementLabel: string | null
  /** The model the canvas is showing, for the §13.1 metadata layer counts. */
  readonly modelId: string | null
  readonly onDownloadAttachment: (filename: string, bytes: Uint8Array, mimeType: string) => void
  /**
   * The live working document. Only the authored-attachment store
   * (`AT_ORBITPM_ATTACHMENT`) needs it; the details projection has no view of
   * it because it is an ordinary ARIS attribute, not an OLE record.
   */
  readonly document?: ArisWorkingDocument | null
  /** Interface language, for model labels in the assignment picker. */
  readonly lang?: ArisEditLang
  /** Absent (or null) leaves the rail exactly as read-only as it was before. */
  readonly editing?: ArisDetailsEditingApi | null
  /** Surface a refused edit; the rail never renders an error of its own. */
  readonly onEditError?: (message: string) => void
  /**
   * A one-shot request from a validation row (or a canvas marker) to open a tab
   * and flash the specific field to fix. Each request bumps `token`.
   */
  readonly highlight?: ArisDetailsRailHighlight | null
  /**
   * Open an assigned model from the Assignments tab's per-row Open button.
   * Absent ⇒ the rail shows no Open button (read-only, pre-T6 behaviour).
   */
  readonly onOpenAssignedModel?: (modelId: string) => void
}

export function ArisDetailsRail({
  details,
  element,
  elementLabel,
  modelId,
  onDownloadAttachment,
  document: workingDocument = null,
  lang = 'en',
  editing = null,
  onEditError,
  highlight = null,
  onOpenAssignedModel
}: ArisDetailsRailProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ArisDetailsTabId>('general')
  const baseId = useId()
  const tabRefs = useRef<Partial<Record<ArisDetailsTabId, HTMLButtonElement | null>>>({})
  const shouldFocusTab = useRef(false)
  const sectionRef = useRef<HTMLElement | null>(null)
  const lastHighlightToken = useRef(0)
  const [flashField, setFlashField] = useState<string | null>(null)
  const tabs = useMemo(() => (element ? buildAllTabs(element, details) : null), [details, element])

  const tabId = useCallback((id: ArisDetailsTabId) => `${baseId}-tab-${id}`, [baseId])
  const panelId = useCallback((id: ArisDetailsTabId) => `${baseId}-panel-${id}`, [baseId])

  // Moving focus with the arrow keys must follow the rendered reading order, so
  // in RTL ArrowLeft advances and ArrowRight retreats.
  const onTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      const forward = getDir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const backward = getDir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      const last = ARIS_DETAILS_RAIL_VISIBLE_TABS.length - 1
      let next: number | null = null
      if (event.key === forward) next = index === last ? 0 : index + 1
      else if (event.key === backward) next = index === 0 ? last : index - 1
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = last
      if (next === null) return
      event.preventDefault()
      shouldFocusTab.current = true
      setActiveTab(ARIS_DETAILS_RAIL_VISIBLE_TABS[next])
    },
    []
  )

  useEffect(() => {
    if (!shouldFocusTab.current) return
    shouldFocusTab.current = false
    tabRefs.current[activeTab]?.focus()
  }, [activeTab])

  // A validation row (or a canvas marker) asks the rail to open a tab. Each
  // request bumps `token`, so the same tab/field can be re-requested.
  useEffect(() => {
    if (!highlight || highlight.token === lastHighlightToken.current) return
    lastHighlightToken.current = highlight.token
    setActiveTab(highlight.tab)
  }, [highlight])

  // Once the requested tab is showing, flash its specific field so the user can
  // see exactly what to fix. The class is added imperatively (the input elements
  // manage no className of their own) and cleared after the animation.
  useEffect(() => {
    if (!highlight || activeTab !== highlight.tab) return
    const root = sectionRef.current
    if (!root) return
    const field = highlight.field
    let node: HTMLElement | null = null
    let descriptor = 'section'
    if (field?.kind === 'name') {
      node = root.querySelector<HTMLElement>(`[data-orbitpm-aris-name-input$=":${field.lang}"]`)
      descriptor = `name:${field.lang}`
    } else if (field?.kind === 'attribute') {
      node =
        root.querySelector<HTMLElement>(`[data-orbitpm-aris-attribute="${field.attributeType}"]`) ??
        root.querySelector<HTMLElement>(
          `[data-orbitpm-aris-pending-attribute="${field.attributeType}"]`
        ) ??
        root.querySelector<HTMLElement>('[data-orbitpm-aris-attributes-editor]')
      descriptor = `attribute:${field.attributeType}`
    } else {
      node = root.querySelector<HTMLElement>(`[data-orbitpm-aris-details-panel="${activeTab}"]`)
      descriptor = 'section'
    }
    if (!node) return
    const flashNode = node
    flashNode.classList.add('orbitpm-aris-field-flash')
    flashNode.scrollIntoView?.({ block: 'nearest' })
    setFlashField(descriptor)
    const timer = window.setTimeout(() => {
      flashNode.classList.remove('orbitpm-aris-field-flash')
      setFlashField(null)
    }, 1600)
    return () => {
      window.clearTimeout(timer)
      flashNode.classList.remove('orbitpm-aris-field-flash')
      setFlashField(null)
    }
  }, [highlight, activeTab])

  const target = useMemo(() => arisEditTarget(element, details), [details, element])
  const definition = useMemo(() => targetDefinition(target, details), [details, target])
  const occurrence = target.occurrenceId
    ? (details.occurrences.get(target.occurrenceId) ?? null)
    : null
  const convention = useMemo(() => arisLocaleConvention(details), [details])
  const authoredAttachments = useMemo(
    () => readAuthoredAttachments(workingDocument, target.definitionId),
    [target.definitionId, workingDocument]
  )
  const reject = useCallback(
    (message: string) => {
      onEditError?.(message)
    },
    [onEditError]
  )

  if (!tabs || !element) {
    return (
      <section className="orbitpm-aris-rail__section" data-orbitpm-aris-details="">
        <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
          {tk('aris.rail.details', 'Details')}
        </h3>
        <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 13, lineHeight: 1.5 }}>
          {tk('aris.details.noSelection', 'Select an element on the canvas to inspect it.')}
        </p>
        <MetadataLayers details={details} modelId={modelId} />
      </section>
    )
  }

  const model = target.modelId && !target.occurrenceId ? details.models.get(target.modelId) : null
  const assignmentsEditable = Boolean(editing && definition)

  const nameEditor =
    editing && definition ? (
      <ArisBilingualEditor
        dataKind="definition"
        heading={tk('aris.details.edit.name', 'Bilingual name')}
        slots={bilingualSlots(definition.names, convention)}
        scope="definition"
        target={target}
        onCommit={(_lang, localeId, next) =>
          editing.renameDefinition(definition.id, localeId, next)
        }
      />
    ) : editing && model ? (
      <ArisBilingualEditor
        dataKind="model"
        heading={tk('aris.details.edit.name', 'Bilingual name')}
        slots={bilingualSlots(model.model.names, convention)}
        scope="model"
        target={target}
        onCommit={(_lang, localeId, next) => editing.renameModel(model.model.id, localeId, next)}
      />
    ) : null

  // The Assignments tab is fully superseded by its editor (same values, now
  // writable). The Names tab is NOT superseded: the read-only bilingual rows
  // carry `lang` attributes (`<span lang="en">`, `<span lang="ar">`) that
  // screen readers and the i18n characterization tests rely on, so they stay
  // visible above the editing controls.
  const rowsSuperseded = activeTab === 'assignments' && assignmentsEditable

  // §2.3: a validation row can point at an attribute the definition does not
  // record yet. There is no input to flash, so the Attributes panel renders a
  // pending row — a create-on-commit editor for exactly that type — for as long
  // as the highlight targets it and the attribute is still absent.
  const highlightField = highlight?.field ?? null
  const pendingAttributeType =
    activeTab === 'attributes' &&
    editing &&
    definition &&
    highlightField?.kind === 'attribute' &&
    !definition.attributes.some((attribute) => attribute.type === highlightField.attributeType)
      ? highlightField.attributeType
      : null

  return (
    <section
      ref={sectionRef}
      className="orbitpm-aris-rail__section"
      data-orbitpm-aris-details=""
      data-orbitpm-aris-details-definition={target.definitionId ?? undefined}
      data-orbitpm-aris-details-occurrence={target.occurrenceId ?? undefined}
      aria-label={tk('aris.details.selectionAria', 'Details for {element}', {
        element: elementLabel ?? element.id
      })}
    >
      <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
        {tk('aris.rail.details', 'Details')}
      </h3>
      <div
        role="tablist"
        aria-label={tk('aris.rail.details', 'Details')}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}
      >
        {ARIS_DETAILS_RAIL_VISIBLE_TABS.map((id, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={activeTab === id}
            aria-controls={panelId(id)}
            tabIndex={activeTab === id ? 0 : -1}
            data-orbitpm-aris-details-tab={id}
            ref={(node) => {
              tabRefs.current[id] = node
            }}
            className="orbitpm-lite-chrome-btn"
            style={{
              fontSize: 12,
              padding: '0.15rem 0.5rem',
              borderColor: activeTab === id ? 'var(--orbitpm-primary-bg)' : 'var(--orbitpm-border)'
            }}
            onClick={() => setActiveTab(id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {t(ARIS_DETAILS_TAB_LABEL_KEYS[id] as Key)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId(activeTab)}
        aria-labelledby={tabId(activeTab)}
        tabIndex={0}
        data-orbitpm-aris-details-panel={activeTab}
        data-orbitpm-aris-highlight-field={flashField ?? undefined}
      >
        {/* The Assignments tab is fully superseded by its editor (same
            values, now writable). Every other tab — including Names — keeps
            its read-only rows and gains editing controls underneath. */}
        {rowsSuperseded ? null : <DetailRows rows={tabs[activeTab]} />}

        {activeTab === 'names' ? nameEditor : null}

        {pendingAttributeType && editing && definition ? (
          <section
            style={{ display: 'grid', gap: 8, marginTop: 10 }}
            data-orbitpm-aris-pending-attribute={pendingAttributeType}
          >
            <h4 style={{ margin: 0, fontSize: 13 }}>
              {arisAttributeTypeName(pendingAttributeType, definition.type)}
            </h4>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {tk(
                'aris.details.highlight.missingAttribute',
                'The {type} attribute is not recorded yet — add its value below.',
                { type: arisAttributeTypeName(pendingAttributeType, definition.type) }
              )}
            </p>
            <ArisTextEditor
              label={tk('aris.details.edit.valueEn', 'Value (English locale)')}
              value=""
              lang="en"
              dataAttribute={{ 'data-orbitpm-aris-attribute-input': `${pendingAttributeType}:en` }}
              onCommit={(next) =>
                editing.setDefinitionAttribute(
                  definition.id,
                  pendingAttributeType,
                  upsertAttributeValue([], convention.en ?? ARIS_FALLBACK_LOCALE_IDS.en, next)
                )
              }
            />
            <ArisTextEditor
              label={tk('aris.details.edit.valueAr', 'Value (Arabic locale)')}
              value=""
              lang="ar"
              dataAttribute={{ 'data-orbitpm-aris-attribute-input': `${pendingAttributeType}:ar` }}
              onCommit={(next) =>
                editing.setDefinitionAttribute(
                  definition.id,
                  pendingAttributeType,
                  upsertAttributeValue([], convention.ar ?? ARIS_FALLBACK_LOCALE_IDS.ar, next)
                )
              }
            />
          </section>
        ) : null}

        {activeTab === 'attributes' && editing && definition ? (
          <ArisAttributesEditor
            definition={definition}
            details={details}
            target={target}
            editing={editing}
          />
        ) : null}

        {/* issue 7: the bare-model counterpart of the definition attributes
            editor above — same tab, same `editing` gate, but for a selection
            that resolved to a model rather than a definition (`target.modelId`
            set, `target.definitionId` null; see `arisEditTarget`). */}
        {activeTab === 'attributes' && editing && model ? (
          <ArisModelAttributesEditor
            model={model.model}
            details={details}
            target={target}
            editing={editing}
          />
        ) : null}

        {activeTab === 'assignments' && assignmentsEditable && editing && definition ? (
          <ArisAssignmentsEditor
            definition={definition}
            details={details}
            target={target}
            lang={lang}
            editing={editing}
            onOpenAssignedModel={onOpenAssignedModel}
          />
        ) : null}

        {activeTab === 'attachments' ? (
          <AttachmentActions
            details={details}
            element={element}
            onDownload={onDownloadAttachment}
          />
        ) : null}

        {activeTab === 'attachments' && editing && target.definitionId ? (
          <ArisAttachmentsEditor
            definitionId={target.definitionId}
            attachments={authoredAttachments}
            target={target}
            editing={editing}
            onReject={reject}
          />
        ) : null}

        {activeTab === 'general' && editing && occurrence ? (
          <ArisStyleEditor
            key={occurrence.id}
            occurrence={occurrence}
            target={target}
            editing={editing}
          />
        ) : null}
      </div>
      <MetadataLayers details={details} modelId={modelId} />
    </section>
  )
}
