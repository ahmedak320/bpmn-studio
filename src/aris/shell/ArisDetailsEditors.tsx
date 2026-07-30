/**
 * The editable controls of the §13.3 details rail.
 *
 * Every control here is a thin renderer over `arisDetailsEditing.ts` (which
 * computes *what* is editable and under which locale id) and `ArisAuthoring`
 * (which performs the change). Nothing in this file mutates a document: it
 * calls one authoring method per gesture, and each of those is a single
 * `bridge.execute`, i.e. exactly one undo step on the same command stack the
 * canvas gestures use.
 *
 * ## Commit model
 *
 * Text fields hold a local draft and commit on **blur or Enter**, never on
 * keystroke. Typing "Approve invoice" would otherwise push sixteen commands
 * onto the stack and need sixteen undos. Escape discards the draft and restores
 * the stored value without touching the document at all.
 *
 * ## §8.2 in the UI
 *
 * Each editor group is introduced by a scope note that says, in words, whether
 * the change lands on the *definition* (and therefore on every occurrence of
 * the object, in every model) or on *this occurrence only*. The note is not
 * decoration: it is `aria-describedby` on the fields it governs, so a screen
 * reader announces the blast radius before the value is changed.
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'

import { t, type Key } from '../../i18n'
import type { ArisAttachment } from '../canvas/attachments'
import { bytesToBase64 } from '../canvas/attachments'
import type { ArisDetailsDocument } from '../details/seam'
import type { ArisModel, ArisObjectDefinition, ArisObjectOccurrence } from '../model/types'
import {
  ARIS_EDITABLE_STYLE_FIELDS,
  ARIS_LINE_STYLES,
  ARIS_MAX_ATTACHMENT_BYTES,
  arisLocaleConvention,
  assignableModels,
  attributeValuesToRecord,
  definitionAttributeRows,
  modelAttributeRows,
  modelLabel,
  styleFieldPatch,
  styleFieldValue,
  upsertAttributeValue,
  type ArisAttributeEditorRow,
  type ArisBilingualSlots,
  type ArisDetailsEditingApi,
  type ArisEditLang,
  type ArisEditTarget,
  type ArisEditableStyleField,
  type ArisLocaleSlot
} from './arisDetailsEditing'
import { tk } from './shellI18n'

const FIELD_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  fontSize: 13,
  padding: '0.25rem 0.4rem',
  borderRadius: 6,
  border: '1px solid var(--orbitpm-border)',
  background: 'var(--orbitpm-surface, transparent)',
  color: 'inherit'
}

const NOTE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--orbitpm-muted)'
}

const GROUP_STYLE: CSSProperties = { display: 'grid', gap: 8, marginTop: 10 }

const HEADING_STYLE: CSSProperties = { margin: 0, fontSize: 13 }

export type ArisEditScope = 'definition' | 'occurrence' | 'model'

/** The §8.2 blast-radius note, referenced by every field it governs. */
export function ArisScopeNote({
  scope,
  target,
  id
}: {
  scope: ArisEditScope
  target: ArisEditTarget
  id: string
}): JSX.Element {
  const text =
    scope === 'definition'
      ? tk(
          'aris.details.edit.scope.definition',
          'Definition — this value belongs to the ARIS object itself, so the change reaches all {count} occurrences of it across {models} model(s).',
          { count: target.occurrenceCount, models: target.modelCount }
        )
      : scope === 'occurrence'
        ? tk(
            'aris.details.edit.scope.occurrence',
            'Occurrence — this value belongs to this shape alone. The other occurrences of the same ARIS object ({count} in total) are left untouched.',
            { count: target.occurrenceCount }
          )
        : tk(
            'aris.details.edit.scope.model',
            'Model — this value belongs to the model record itself.'
          )
  return (
    <p
      id={id}
      style={NOTE_STYLE}
      data-orbitpm-aris-scope={scope}
      data-orbitpm-aris-scope-count={target.occurrenceCount}
      data-orbitpm-aris-scope-models={target.modelCount}
    >
      {text}
    </p>
  )
}

function scopeBadge(scope: ArisEditScope): string {
  if (scope === 'definition') return tk('aris.details.edit.badge.definition', 'Definition')
  if (scope === 'occurrence') return tk('aris.details.edit.badge.occurrence', 'This shape only')
  return tk('aris.details.edit.badge.model', 'Model')
}

/** Small scope chip rendered next to a group heading. */
function ScopeBadge({ scope }: { scope: ArisEditScope }): JSX.Element {
  return (
    <span
      data-orbitpm-aris-scope-badge={scope}
      style={{
        marginInlineStart: 6,
        padding: '0.05rem 0.4rem',
        borderRadius: 999,
        border: '1px solid var(--orbitpm-border)',
        fontSize: 11,
        fontWeight: 400,
        color: 'var(--orbitpm-muted)'
      }}
    >
      {scopeBadge(scope)}
    </span>
  )
}

/** Chip marking an R3-schema attribute as mandatory, next to its heading. */
function MandatoryBadge(): JSX.Element {
  return (
    <span
      data-orbitpm-aris-attribute-mandatory=""
      style={{
        padding: '0.05rem 0.4rem',
        borderRadius: 999,
        border: '1px solid var(--orbitpm-border)',
        fontSize: 11,
        fontWeight: 400,
        color: 'var(--orbitpm-muted)'
      }}
    >
      {tk('aris.details.edit.attributes.mandatory', 'Mandatory')}
    </span>
  )
}

export interface ArisTextEditorProps {
  readonly label: string
  readonly value: string
  readonly onCommit: (next: string) => void
  readonly describedBy?: string
  readonly lang?: string
  readonly dir?: 'ltr' | 'rtl' | 'auto'
  readonly hint?: string | null
  readonly dataAttribute?: Readonly<Record<string, string>>
  readonly disabled?: boolean
}

/**
 * A labelled text field that commits once, on blur or Enter.
 *
 * The draft is re-seeded whenever the stored value changes, so an undo (which
 * changes the document under the rail) is reflected in the field immediately
 * without the component needing to be remounted.
 */
export function ArisTextEditor({
  label,
  value,
  onCommit,
  describedBy,
  lang,
  dir = 'auto',
  hint,
  dataAttribute,
  disabled
}: ArisTextEditorProps): JSX.Element {
  const fieldId = useId()
  const hintId = `${fieldId}-hint`
  const [draft, setDraft] = useState(value)
  const [stored, setStored] = useState(value)
  // What was last handed to `onCommit`. Enter commits, and the blur that
  // follows must not commit the same text a second time — which it otherwise
  // would whenever the stored value has not (yet) changed, e.g. because the
  // ARIS command system refused the edit.
  const committed = useRef(value)
  if (value !== stored) {
    // Render-phase sync: cheaper and flicker-free compared with an effect.
    setStored(value)
    setDraft(value)
    committed.current = value
  }

  const commit = useCallback(() => {
    if (draft === value || draft === committed.current) return
    committed.current = draft
    onCommit(draft)
  }, [draft, onCommit, value])

  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <label htmlFor={fieldId} style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
        {label}
      </label>
      <input
        {...dataAttribute}
        id={fieldId}
        type="text"
        value={draft}
        lang={lang}
        dir={dir}
        disabled={disabled}
        aria-describedby={
          [describedBy, hint ? hintId : null].filter(Boolean).join(' ') || undefined
        }
        style={FIELD_STYLE}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            return
          }
          if (event.key === 'Escape' && draft !== value) {
            // Only swallow Escape when there is a draft to discard, so an
            // enclosing dismissable group still sees it otherwise.
            event.preventDefault()
            event.stopPropagation()
            setDraft(value)
          }
        }}
      />
      {hint ? (
        <p id={hintId} style={NOTE_STYLE}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A labelled field whose value lives in React state rather than in the
 * document. Used for the "add a value in another locale" form, where nothing is
 * written until the submit button is pressed and a commit-on-blur field would
 * make the button's disabled state lag a keystroke behind.
 */
export function ArisLiveTextField({
  label,
  value,
  onChange,
  dataAttribute
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (next: string) => void
  readonly dataAttribute?: Readonly<Record<string, string>>
}): JSX.Element {
  const fieldId = useId()
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <label htmlFor={fieldId} style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
        {label}
      </label>
      <input
        {...dataAttribute}
        id={fieldId}
        type="text"
        dir="auto"
        value={value}
        style={FIELD_STYLE}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function localeHint(slot: ArisLocaleSlot): string {
  const stored = slot.present
    ? tk('aris.details.edit.localeStored', 'Stored under locale id {locale}.', {
        locale: slot.localeId
      })
    : tk('aris.details.edit.localeNew', 'Not set yet; will be stored under locale id {locale}.', {
        locale: slot.localeId
      })
  if (!slot.scriptMismatch) return stored
  return `${stored} ${tk(
    'aris.details.edit.scriptMismatch',
    'The stored text is written in {script} even though the locale id says {tag}. The locale id is kept exactly as the source filed it.',
    {
      script:
        slot.scriptLang === 'ar'
          ? tk('aris.details.edit.lang.ar', 'Arabic')
          : tk('aris.details.edit.lang.en', 'English'),
      tag:
        slot.lang === 'ar'
          ? tk('aris.details.edit.lang.ar', 'Arabic')
          : tk('aris.details.edit.lang.en', 'English')
    }
  )}`
}

export interface ArisBilingualEditorProps {
  readonly heading: string
  readonly slots: ArisBilingualSlots
  readonly scope: ArisEditScope
  readonly target: ArisEditTarget
  readonly onCommit: (lang: ArisEditLang, localeId: string, next: string) => void
  readonly labels?: Readonly<Record<ArisEditLang, string>>
  readonly dataKind: string
}

/** §21.3 "edit bilingual attributes": the English and Arabic pair, side by side. */
export function ArisBilingualEditor({
  heading,
  slots,
  scope,
  target,
  onCommit,
  labels,
  dataKind
}: ArisBilingualEditorProps): JSX.Element {
  const noteId = useId()
  const enLabel = labels?.en ?? tk('aris.details.edit.nameEn', 'Name (English locale)')
  const arLabel = labels?.ar ?? tk('aris.details.edit.nameAr', 'Name (Arabic locale)')
  return (
    <section style={GROUP_STYLE} data-orbitpm-aris-bilingual-editor={dataKind}>
      <h4 style={HEADING_STYLE}>
        {heading}
        <ScopeBadge scope={scope} />
      </h4>
      <ArisScopeNote scope={scope} target={target} id={noteId} />
      <ArisTextEditor
        label={enLabel}
        value={slots.en.text}
        describedBy={noteId}
        lang="en"
        hint={localeHint(slots.en)}
        dataAttribute={{ 'data-orbitpm-aris-name-input': `${dataKind}:en` }}
        onCommit={(next) => onCommit('en', slots.en.localeId, next)}
      />
      <ArisTextEditor
        label={arLabel}
        value={slots.ar.text}
        describedBy={noteId}
        lang="ar"
        hint={localeHint(slots.ar)}
        dataAttribute={{ 'data-orbitpm-aris-name-input': `${dataKind}:ar` }}
        onCommit={(next) => onCommit('ar', slots.ar.localeId, next)}
      />
    </section>
  )
}

interface ArisAttributeRowFieldsProps {
  readonly row: ArisAttributeEditorRow
  readonly noteId: string
  readonly onCommit: (localeId: string, text: string) => void
}

/**
 * One editable ARIS attribute row, shared by the definition- and
 * model-scoped attribute editors (`ArisAttributesEditor` /
 * `ArisModelAttributesEditor`).
 *
 * `row.isNew` (a schema-declared attribute type with no stored value at all)
 * needs no special-casing here: `definitionAttributeRows`/`modelAttributeRows`
 * already seed it with empty, `present: false` slots from the document's own
 * locale convention — exactly like any other missing slot — so the first
 * commit both creates the attribute and fills it, through the same one-call
 * `onCommit` every other row uses. "Create-on-first-save" falls out of code
 * already proven for the existing-attribute case, not a separate path.
 */
function ArisAttributeRowFields({
  row,
  noteId,
  onCommit
}: ArisAttributeRowFieldsProps): JSX.Element {
  const [addingLocale, setAddingLocale] = useState(false)
  const [newLocaleId, setNewLocaleId] = useState('')
  const [newText, setNewText] = useState('')
  const addButtonRef = useRef<HTMLButtonElement | null>(null)

  // Closing the form unmounts it, so focus can only return to the button that
  // opened it after the next render — hence the effect rather than a direct
  // `focus()` call inside the handler.
  const [refocus, setRefocus] = useState(false)
  useEffect(() => {
    if (!refocus) return
    addButtonRef.current?.focus()
    setRefocus(false)
  }, [refocus])

  const closeAdd = useCallback(() => {
    setAddingLocale(false)
    setNewLocaleId('')
    setNewText('')
    setRefocus(true)
  }, [])

  return (
    <div
      style={{ display: 'grid', gap: 4 }}
      data-orbitpm-aris-attribute={row.attributeType}
      data-orbitpm-aris-attribute-status={row.isNew ? 'missing' : 'stored'}
    >
      <p
        style={{
          ...NOTE_STYLE,
          fontWeight: 600,
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}
      >
        {row.isSchemaKnown ? t(row.labelKey as Key) : row.attributeType}
        {row.mandatory ? <MandatoryBadge /> : null}
      </p>
      <ArisTextEditor
        label={tk('aris.details.edit.valueEn', 'Value (English locale)')}
        value={row.bilingual.en.text}
        describedBy={noteId}
        lang="en"
        hint={localeHint(row.bilingual.en)}
        dataAttribute={{
          'data-orbitpm-aris-attribute-input': `${row.attributeType}:en`
        }}
        onCommit={(next) => onCommit(row.bilingual.en.localeId, next)}
      />
      <ArisTextEditor
        label={tk('aris.details.edit.valueAr', 'Value (Arabic locale)')}
        value={row.bilingual.ar.text}
        describedBy={noteId}
        lang="ar"
        hint={localeHint(row.bilingual.ar)}
        dataAttribute={{
          'data-orbitpm-aris-attribute-input': `${row.attributeType}:ar`
        }}
        onCommit={(next) => onCommit(row.bilingual.ar.localeId, next)}
      />
      {row.other.map((slot) => (
        <ArisTextEditor
          key={slot.localeId}
          label={tk('aris.details.edit.valueOther', 'Value (locale {locale})', {
            locale:
              slot.localeId === ''
                ? tk('aris.details.edit.noLocale', 'no locale id')
                : slot.localeId
          })}
          value={slot.text}
          describedBy={noteId}
          hint={localeHint(slot)}
          dataAttribute={{
            'data-orbitpm-aris-attribute-input': `${row.attributeType}:${slot.localeId}`
          }}
          onCommit={(next) => onCommit(slot.localeId, next)}
        />
      ))}
      {addingLocale ? (
        <div
          role="group"
          aria-label={tk('aris.details.edit.addLocale', 'Add a value in another locale')}
          data-orbitpm-aris-attribute-add={row.attributeType}
          style={{ display: 'grid', gap: 4 }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            closeAdd()
          }}
        >
          <ArisLiveTextField
            label={tk('aris.details.edit.addLocale.id', 'Locale id for the new value')}
            value={newLocaleId}
            dataAttribute={{ 'data-orbitpm-aris-attribute-new-locale': row.attributeType }}
            onChange={setNewLocaleId}
          />
          <ArisLiveTextField
            label={tk('aris.details.edit.addLocale.text', 'Value for the new locale')}
            value={newText}
            dataAttribute={{ 'data-orbitpm-aris-attribute-new-text': row.attributeType }}
            onChange={setNewText}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              style={{ fontSize: 12 }}
              data-orbitpm-aris-attribute-add-submit={row.attributeType}
              disabled={newLocaleId.trim().length === 0 || newText.length === 0}
              onClick={() => {
                onCommit(newLocaleId.trim(), newText)
                closeAdd()
              }}
            >
              {tk('aris.details.edit.addLocale.submit', 'Add value')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              style={{ fontSize: 12 }}
              onClick={closeAdd}
            >
              {tk('aris.details.edit.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          style={{ fontSize: 12, justifySelf: 'start' }}
          ref={addButtonRef}
          data-orbitpm-aris-attribute-add-open={row.attributeType}
          onClick={() => {
            setNewLocaleId('')
            setNewText('')
            setAddingLocale(true)
          }}
        >
          {tk('aris.details.edit.addLocale', 'Add a value in another locale')}
        </button>
      )}
    </div>
  )
}

export interface ArisAttributesEditorProps {
  readonly definition: ArisObjectDefinition
  readonly details: ArisDetailsDocument
  readonly target: ArisEditTarget
  readonly editing: ArisDetailsEditingApi
}

/**
 * §11.4 "edit definition attributes", including adding another locale.
 *
 * Rows come from `definitionAttributeRows` (plan R3): every attribute the
 * definition already carries a value for, plus one row per
 * `schemaForObjectType` entry for its object type that has no value yet —
 * `data-orbitpm-aris-attribute-status="missing"`, badged when the schema
 * marks it mandatory. Filling in a missing row's value creates the attribute
 * on first save; see `ArisAttributeRowFields`.
 */
export function ArisAttributesEditor({
  definition,
  details,
  target,
  editing
}: ArisAttributesEditorProps): JSX.Element {
  const noteId = useId()
  const convention = arisLocaleConvention(details)
  const rows = definitionAttributeRows(definition, convention)

  if (rows.length === 0) {
    return (
      <section style={GROUP_STYLE} data-orbitpm-aris-attributes-editor="">
        <h4 style={HEADING_STYLE}>
          {tk('aris.details.edit.attributes', 'ARIS attributes')}
          <ScopeBadge scope="definition" />
        </h4>
        <p style={NOTE_STYLE}>
          {tk(
            'aris.details.edit.attributes.none',
            'This object definition carries no ARIS attributes, so there is no value to edit.'
          )}
        </p>
      </section>
    )
  }

  return (
    <section style={GROUP_STYLE} data-orbitpm-aris-attributes-editor="">
      <h4 style={HEADING_STYLE}>
        {tk('aris.details.edit.attributes', 'ARIS attributes')}
        <ScopeBadge scope="definition" />
      </h4>
      <ArisScopeNote scope="definition" target={target} id={noteId} />
      {rows.map((row) => (
        <ArisAttributeRowFields
          key={row.attributeType}
          row={row}
          noteId={noteId}
          onCommit={(localeId, next) =>
            editing.setDefinitionAttribute(
              definition.id,
              row.attributeType,
              upsertAttributeValue(row.values, localeId, next)
            )
          }
        />
      ))}
    </section>
  )
}

export interface ArisModelAttributesEditorProps {
  readonly model: ArisModel
  readonly details: ArisDetailsDocument
  readonly target: ArisEditTarget
  readonly editing: ArisDetailsEditingApi
}

/**
 * §11.4 "edit model attributes" — the model-scoped analogue of
 * `ArisAttributesEditor`. Rows come from `modelAttributeRows` (plan R3,
 * `schemaForModelType`); saving a missing row creates the attribute through
 * `editing.setModelAttribute`, which mirrors `setDefinitionAttribute` with the
 * `'model'` owner kind (Lane C4's `ArisAuthoring.setModelAttribute`).
 *
 * `setModelAttribute` is a required member of `ArisDetailsEditingApi`:
 * `ArisStudioTab.tsx` builds its concrete object by delegating it to
 * `canvas.authoring.setModelAttribute`, exactly like every other member, so a
 * commit here always reaches the document (issue 7 — this used to be a no-op
 * because that wiring, and the mount below, were both missing). The call
 * below keeps its optional-chaining syntax as cheap defence-in-depth against a
 * malformed test double; it is never actually skipped in production.
 *
 * Mounted by `ArisDetailsRail.tsx` on the Attributes tab whenever the current
 * selection resolves to a bare model (`target.modelId` set, no definition) —
 * the model-scoped counterpart of the `ArisAttributesEditor` mount for an
 * object-definition selection.
 */
export function ArisModelAttributesEditor({
  model,
  details,
  target,
  editing
}: ArisModelAttributesEditorProps): JSX.Element {
  const noteId = useId()
  const convention = arisLocaleConvention(details)
  const rows = modelAttributeRows(model, convention)

  if (rows.length === 0) {
    return (
      <section style={GROUP_STYLE} data-orbitpm-aris-model-attributes-editor="">
        <h4 style={HEADING_STYLE}>
          {tk('aris.details.edit.attributes', 'ARIS attributes')}
          <ScopeBadge scope="model" />
        </h4>
        <p style={NOTE_STYLE}>
          {tk(
            'aris.details.edit.attributes.noneModel',
            'This model type carries no R3 attribute schema, so there is no value to edit.'
          )}
        </p>
      </section>
    )
  }

  return (
    <section style={GROUP_STYLE} data-orbitpm-aris-model-attributes-editor="">
      <h4 style={HEADING_STYLE}>
        {tk('aris.details.edit.attributes', 'ARIS attributes')}
        <ScopeBadge scope="model" />
      </h4>
      <ArisScopeNote scope="model" target={target} id={noteId} />
      {rows.map((row) => (
        <ArisAttributeRowFields
          key={row.attributeType}
          row={row}
          noteId={noteId}
          onCommit={(localeId, next) => {
            const nextValues = upsertAttributeValue(row.values, localeId, next)
            editing.setModelAttribute?.(
              model.id,
              row.attributeType,
              attributeValuesToRecord(nextValues)
            )
          }}
        />
      ))}
    </section>
  )
}

export interface ArisAssignmentsEditorProps {
  readonly definition: ArisObjectDefinition
  readonly details: ArisDetailsDocument
  readonly target: ArisEditTarget
  readonly lang: ArisEditLang
  readonly editing: ArisDetailsEditingApi
  /** Open an assigned model from a row's Open button; absent ⇒ no Open button. */
  readonly onOpenAssignedModel?: (modelId: string) => void
}

/** §11.4 "add/remove linked-model assignment". */
export function ArisAssignmentsEditor({
  definition,
  details,
  target,
  lang,
  editing,
  onOpenAssignedModel
}: ArisAssignmentsEditorProps): JSX.Element {
  const noteId = useId()
  const selectId = useId()
  const choices = assignableModels(definition, details, lang)
  const [choice, setChoice] = useState('')
  const selected = choices.some((entry) => entry.id === choice) ? choice : (choices[0]?.id ?? '')

  return (
    <section style={GROUP_STYLE} data-orbitpm-aris-assignments-editor="">
      <h4 style={HEADING_STYLE}>
        {tk('aris.details.edit.assignments', 'Linked models')}
        <ScopeBadge scope="definition" />
      </h4>
      <ArisScopeNote scope="definition" target={target} id={noteId} />
      {definition.linkedModelIds.length === 0 ? (
        <p style={NOTE_STYLE}>
          {tk('aris.details.edit.assignments.none', 'No model is linked to this object yet.')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {definition.linkedModelIds.map((modelId) => (
            <li
              key={modelId}
              data-orbitpm-aris-assignment={modelId}
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span style={{ fontSize: 12 }}>{modelLabel(modelId, details, lang)}</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {onOpenAssignedModel && (
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    style={{ fontSize: 12 }}
                    data-orbitpm-aris-assignment-open={modelId}
                    aria-label={t('aris.assign.open.aria', {
                      model: modelLabel(modelId, details, lang)
                    })}
                    onClick={() => onOpenAssignedModel(modelId)}
                  >
                    {t('aris.assign.open')}
                  </button>
                )}
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  style={{ fontSize: 12 }}
                  data-orbitpm-aris-assignment-remove={modelId}
                  aria-label={tk('aris.details.edit.assignments.remove', 'Unlink {model}', {
                    model: modelLabel(modelId, details, lang)
                  })}
                  onClick={() => editing.removeModelAssignment(definition.id, modelId)}
                >
                  {tk('aris.details.edit.remove', 'Remove')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {choices.length === 0 ? (
        <p style={NOTE_STYLE}>
          {tk(
            'aris.details.edit.assignments.exhausted',
            'Every model in this source is already linked to this object.'
          )}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 4 }}>
          <label htmlFor={selectId} style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            {tk('aris.details.edit.assignments.choose', 'Model to link')}
          </label>
          <select
            id={selectId}
            value={selected}
            aria-describedby={noteId}
            style={FIELD_STYLE}
            data-orbitpm-aris-assignment-choice=""
            onChange={(event) => setChoice(event.target.value)}
          >
            {choices.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            style={{ fontSize: 12, justifySelf: 'start' }}
            data-orbitpm-aris-assignment-add=""
            disabled={selected === ''}
            onClick={() => {
              if (selected === '') return
              editing.addModelAssignment(definition.id, selected)
              setChoice('')
            }}
          >
            {tk('aris.details.edit.assignments.add', 'Link this model')}
          </button>
        </div>
      )}
    </section>
  )
}

export interface ArisAttachmentsEditorProps {
  readonly definitionId: string
  readonly attachments: readonly ArisAttachment[]
  readonly target: ArisEditTarget
  readonly editing: ArisDetailsEditingApi
  readonly onReject: (message: string) => void
}

/**
 * §11.4 "add/download/remove attachment", with the §13.4 confirmation.
 *
 * Removal is two gestures, not one: the first opens an inline confirmation and
 * moves focus onto its confirm button, so a keyboard-only user is never one
 * stray Enter away from deleting a file. Escape cancels and returns focus to
 * the row's own Remove button.
 */
export function ArisAttachmentsEditor({
  definitionId,
  attachments,
  target,
  editing,
  onReject
}: ArisAttachmentsEditorProps): JSX.Element {
  const noteId = useId()
  const fileId = useId()
  const [confirming, setConfirming] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const removeRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  const cancelConfirm = useCallback((attachmentId: string) => {
    setConfirming(null)
    removeRefs.current[attachmentId]?.focus()
  }, [])

  const onFile = useCallback(
    (file: File | null | undefined): void => {
      if (!file) return
      if (file.size > ARIS_MAX_ATTACHMENT_BYTES) {
        onReject(
          tk(
            'aris.details.edit.attachments.tooLarge',
            '{name} is {size} bytes; an attachment stored inside the model may be at most {limit} bytes.',
            { name: file.name, size: file.size, limit: ARIS_MAX_ATTACHMENT_BYTES }
          )
        )
        return
      }
      void file
        .arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer)
          editing.addAttachment(definitionId, {
            id: `att-${Date.now().toString(36)}-${bytes.byteLength.toString(36)}`,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: bytes.byteLength,
            dataBase64: bytesToBase64(bytes)
          })
        })
        .catch((error: unknown) => {
          onReject(
            tk('aris.details.edit.failed', 'The change was refused: {error}', {
              error: error instanceof Error ? error.message : String(error)
            })
          )
        })
    },
    [definitionId, editing, onReject]
  )

  return (
    <section style={GROUP_STYLE} data-orbitpm-aris-attachments-editor="">
      <h4 style={HEADING_STYLE}>
        {tk('aris.details.edit.attachments', 'Attachments on this object')}
        <ScopeBadge scope="definition" />
      </h4>
      <ArisScopeNote scope="definition" target={target} id={noteId} />
      {attachments.length === 0 ? (
        <p style={NOTE_STYLE}>
          {tk('aris.details.edit.attachments.none', 'No file is attached to this object.')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              data-orbitpm-aris-attachment={attachment.id}
              style={{ display: 'grid', gap: 3 }}
            >
              <span style={{ fontSize: 12 }}>{attachment.fileName}</span>
              <span style={NOTE_STYLE}>
                {tk('aris.details.edit.attachments.meta', '{size} bytes · {type}', {
                  size: attachment.size,
                  type: attachment.mimeType
                })}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  style={{ fontSize: 12 }}
                  data-orbitpm-aris-attachment-download={attachment.id}
                  aria-label={tk('aris.details.edit.attachments.download', 'Download {name}', {
                    name: attachment.fileName
                  })}
                  onClick={() => editing.downloadAttachment(definitionId, attachment.id)}
                >
                  {tk('aris.details.edit.download', 'Download')}
                </button>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  style={{ fontSize: 12 }}
                  ref={(node) => {
                    removeRefs.current[attachment.id] = node
                  }}
                  data-orbitpm-aris-attachment-remove={attachment.id}
                  aria-label={tk('aris.details.edit.attachments.remove', 'Remove {name}', {
                    name: attachment.fileName
                  })}
                  aria-expanded={confirming === attachment.id}
                  onClick={() => setConfirming(attachment.id)}
                >
                  {tk('aris.details.edit.remove', 'Remove')}
                </button>
              </div>
              {confirming === attachment.id ? (
                <div
                  role="group"
                  aria-label={tk(
                    'aris.details.edit.attachments.confirmAria',
                    'Confirm removing {name}',
                    { name: attachment.fileName }
                  )}
                  data-orbitpm-aris-attachment-confirm={attachment.id}
                  style={{ display: 'grid', gap: 4 }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    cancelConfirm(attachment.id)
                  }}
                >
                  <p style={NOTE_STYLE}>
                    {tk(
                      'aris.details.edit.attachments.confirmBody',
                      'Remove {name} from this object? Undo restores it in one step.',
                      { name: attachment.fileName }
                    )}
                  </p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="orbitpm-lite-chrome-btn"
                      style={{ fontSize: 12 }}
                      ref={confirmRef}
                      data-orbitpm-aris-attachment-confirm-remove={attachment.id}
                      onClick={() => {
                        setConfirming(null)
                        editing.removeAttachment(definitionId, attachment.id)
                      }}
                    >
                      {tk('aris.details.edit.attachments.confirm', 'Remove the attachment')}
                    </button>
                    <button
                      type="button"
                      className="orbitpm-lite-chrome-btn"
                      style={{ fontSize: 12 }}
                      data-orbitpm-aris-attachment-cancel={attachment.id}
                      onClick={() => cancelConfirm(attachment.id)}
                    >
                      {tk('aris.details.edit.attachments.keep', 'Keep it')}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'grid', gap: 4 }}>
        <label htmlFor={fileId} style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {tk('aris.details.edit.attachments.add', 'Attach a file to this object')}
        </label>
        <input
          id={fileId}
          type="file"
          data-orbitpm-aris-attachment-add=""
          style={{ fontSize: 12 }}
          onChange={(event) => {
            onFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
    </section>
  )
}

export interface ArisStyleEditorProps {
  readonly occurrence: ArisObjectOccurrence
  readonly target: ArisEditTarget
  readonly editing: ArisDetailsEditingApi
}

function styleFieldLabel(field: ArisEditableStyleField): string {
  switch (field) {
    case 'fillColor':
      return tk('aris.details.edit.style.fillColor', 'Fill colour')
    case 'strokeColor':
      return tk('aris.details.edit.style.strokeColor', 'Outline colour')
    case 'strokeWidth':
      return tk('aris.details.edit.style.strokeWidth', 'Outline width')
    default:
      return tk('aris.details.edit.style.lineStyle', 'Outline line style')
  }
}

function lineStyleLabel(value: string): string {
  if (value === 'dashed') return tk('aris.details.edit.style.dashed', 'Dashed')
  if (value === 'dotted') return tk('aris.details.edit.style.dotted', 'Dotted')
  return tk('aris.details.edit.style.solid', 'Solid')
}

/** §11.4 "restyle occurrence" — the one editor scoped to a single shape. */
export function ArisStyleEditor({
  occurrence,
  target,
  editing
}: ArisStyleEditorProps): JSX.Element {
  const noteId = useId()
  const lineStyleId = useId()
  return (
    <section style={GROUP_STYLE} data-orbitpm-aris-style-editor="">
      <h4 style={HEADING_STYLE}>
        {tk('aris.details.edit.style', 'Occurrence style')}
        <ScopeBadge scope="occurrence" />
      </h4>
      <ArisScopeNote scope="occurrence" target={target} id={noteId} />
      {ARIS_EDITABLE_STYLE_FIELDS.filter((field) => field !== 'lineStyle').map((field) => (
        <ArisTextEditor
          key={field}
          label={styleFieldLabel(field)}
          value={styleFieldValue(occurrence.style, field)}
          describedBy={noteId}
          dir="ltr"
          dataAttribute={{ 'data-orbitpm-aris-style-input': field }}
          onCommit={(next) =>
            editing.restyleOccurrence(occurrence.id, styleFieldPatch(field, next))
          }
        />
      ))}
      <div style={{ display: 'grid', gap: 3 }}>
        <label htmlFor={lineStyleId} style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {styleFieldLabel('lineStyle')}
        </label>
        <select
          id={lineStyleId}
          value={styleFieldValue(occurrence.style, 'lineStyle')}
          aria-describedby={noteId}
          style={FIELD_STYLE}
          data-orbitpm-aris-style-input="lineStyle"
          onChange={(event) =>
            editing.restyleOccurrence(
              occurrence.id,
              styleFieldPatch('lineStyle', event.target.value)
            )
          }
        >
          <option value="">{tk('aris.details.edit.style.inherit', 'From the ARIS symbol')}</option>
          {ARIS_LINE_STYLES.map((value) => (
            <option key={value} value={value}>
              {lineStyleLabel(value)}
            </option>
          ))}
        </select>
      </div>
      <p style={NOTE_STYLE}>
        {tk(
          'aris.details.edit.style.appliesToCanvas',
          'The style is drawn on the canvas and travels with the export. The ARIS symbol still supplies the shape.'
        )}
      </p>
    </section>
  )
}
