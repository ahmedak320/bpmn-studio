/**
 * The headless half of the editable details rail (plan §13.3, §11.4, §8.2).
 *
 * `src/aris/details/tabs.ts` is a *read* projection: it flattens a selection
 * into localizable rows and deliberately throws away everything an editor
 * needs — above all the locale id a value is actually filed under. Writing a
 * name back requires that id, because §8.2 edits must land on the document's
 * own locale convention rather than on a synthetic tag this build invented.
 *
 * Nothing here touches a command. Every function is a pure projection or a
 * pure value transform, so the whole editing model is unit-testable without a
 * canvas, and the React layer stays a thin renderer of these results.
 *
 * ## Why the locale tag is never trusted on its own
 *
 * Two independent facts about real ARIS data drive the design:
 *
 *  1. The locale id that reaches this layer is the RAW, unexpanded AML entity
 *     reference — `"&LocaleId.AEar;"`, not `"LocaleId.AEar"`, not `14337` —
 *     because entity references inside *attribute values* are never expanded
 *     upstream. Classification therefore goes through `localeLang`, the same
 *     classifier `src/aris/details/tabs.ts` and `src/aris/canvas/localization.ts`
 *     already use, which handles the entity-reference, bare-name, BCP-47 and
 *     numeric-LCID spellings alike.
 *  2. The tag routinely lies about the content. In the reference export 35 of
 *     the 60 Arabic strings are filed under the *English* locale tag. So the
 *     editor reports the tag AND the script the text is actually written in,
 *     and flags the disagreement instead of silently "fixing" it: rewriting a
 *     value into the locale id we think it belongs in would corrupt the source
 *     round trip and the derived export's anchor lookup.
 *
 * A slot therefore carries both `localeId` (what the value is filed under, kept
 * byte-identical on write) and `scriptLang` (what the text really is).
 */

import { localeLang } from '../../library/amlParse'
import { DEFAULT_LOCALE_ID } from '../canvas/emptyDocument'
import { listAttachments, type ArisAttachment } from '../canvas/attachments'
import {
  schemaForModelType,
  schemaForObjectType,
  type ArisAttributeSchemaEntry
} from '../conventions/attributes'
import type {
  ArisAttribute,
  ArisAttributeValue,
  ArisLocalizedValue,
  ArisModel,
  ArisObjectDefinition,
  ArisOccurrenceStyle,
  ArisWorkingDocument
} from '../model/types'
import type { ArisDetailsDocument, ArisDetailsElement } from '../details/seam'

export type ArisEditLang = 'en' | 'ar'

export const ARIS_EDIT_LANGS: readonly ArisEditLang[] = Object.freeze(['en', 'ar'])

/**
 * The locale id used when the document itself offers no precedent for a
 * language. English reuses the canvas layer's own default so a name authored
 * here reads back through `readLocalized` unchanged.
 */
export const ARIS_FALLBACK_LOCALE_IDS: Readonly<Record<ArisEditLang, string>> = Object.freeze({
  en: DEFAULT_LOCALE_ID,
  ar: 'ar-AE'
})

/** Largest file this build will inline into a model as an attachment. */
export const ARIS_MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

/**
 * Arabic script blocks (base, supplement, extended-A, presentation forms).
 * Presence of any of these is what makes a string Arabic *in fact*, whatever
 * locale tag it is filed under.
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/u
const LATIN_SCRIPT = /[A-Za-z]/u

/** The language a string is actually written in, or `null` when undecidable. */
export function detectScriptLang(text: string): ArisEditLang | null {
  if (ARABIC_SCRIPT.test(text)) return 'ar'
  if (LATIN_SCRIPT.test(text)) return 'en'
  return null
}

/** The document's own locale id for each language, or `null` when it uses none. */
export interface ArisLocaleConvention {
  readonly en: string | null
  readonly ar: string | null
}

function tally(counts: Map<string, number>, localeId: string | null | undefined): void {
  if (typeof localeId !== 'string' || localeId.length === 0) return
  counts.set(localeId, (counts.get(localeId) ?? 0) + 1)
}

function mostUsed(counts: Map<string, number>, lang: ArisEditLang): string | null {
  let best: string | null = null
  let bestCount = 0
  // Ties resolve by locale id so the convention is deterministic across runs.
  for (const [localeId, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (localeLang(localeId) !== lang) continue
    if (count > bestCount) {
      best = localeId
      bestCount = count
    }
  }
  return best
}

/**
 * Which locale id this document files English and Arabic under.
 *
 * Derived from every name and attribute value in the document rather than from
 * a constant, so an export that spells its locales `"&LocaleId.USen;"` keeps
 * being written with that exact string.
 */
export function arisLocaleConvention(details: ArisDetailsDocument): ArisLocaleConvention {
  const counts = new Map<string, number>()
  for (const definition of details.objectDefinitions.values()) {
    for (const localeId of Object.keys(definition.names.values)) tally(counts, localeId)
    for (const attribute of definition.attributes) {
      for (const value of attribute.values) tally(counts, value.localeId)
    }
  }
  for (const entry of details.models.values()) {
    for (const localeId of Object.keys(entry.model.names.values)) tally(counts, localeId)
    for (const attribute of entry.model.attributes) {
      for (const value of attribute.values) tally(counts, value.localeId)
    }
  }
  return Object.freeze({ en: mostUsed(counts, 'en'), ar: mostUsed(counts, 'ar') })
}

/** One editable value in one locale. */
export interface ArisLocaleSlot {
  /** The language slot this field represents. */
  readonly lang: ArisEditLang
  /** The locale id a write must use — the existing one whenever there is one. */
  readonly localeId: string
  /** Whether a value is already filed under `localeId`. */
  readonly present: boolean
  readonly text: string
  /** The language the text is really written in, ignoring the tag. */
  readonly scriptLang: ArisEditLang | null
  /** `true` when the stored script contradicts the locale tag. */
  readonly scriptMismatch: boolean
}

export interface ArisBilingualSlots {
  readonly en: ArisLocaleSlot
  readonly ar: ArisLocaleSlot
}

function slotFor(
  lang: ArisEditLang,
  values: Readonly<Record<string, string>>,
  convention: ArisLocaleConvention
): ArisLocaleSlot {
  // The first entry whose *tag* classifies as this language owns the slot; that
  // is the value the read projection and the canvas label both resolve to, so
  // the editor must write back to the same place.
  for (const [localeId, text] of Object.entries(values)) {
    if (localeLang(localeId) !== lang) continue
    const scriptLang = detectScriptLang(text)
    return Object.freeze({
      lang,
      localeId,
      present: true,
      text,
      scriptLang,
      scriptMismatch: scriptLang !== null && scriptLang !== lang
    })
  }
  return Object.freeze({
    lang,
    localeId: convention[lang] ?? ARIS_FALLBACK_LOCALE_IDS[lang],
    present: false,
    text: '',
    scriptLang: null,
    scriptMismatch: false
  })
}

/** The English and Arabic editing slots of a localized value. */
export function bilingualSlots(
  value: ArisLocalizedValue | null | undefined,
  convention: ArisLocaleConvention
): ArisBilingualSlots {
  const values = value?.values ?? {}
  return Object.freeze({
    en: slotFor('en', values, convention),
    ar: slotFor('ar', values, convention)
  })
}

/** One attribute, projected into its editable per-locale values. */
export interface ArisAttributeSlots {
  readonly attributeType: string
  readonly bilingual: ArisBilingualSlots
  /**
   * Values whose locale id classifies as neither English nor Arabic (including
   * the null/no-locale case, which AML also produces). Editable in place so a
   * third-language export is never silently dropped on write-back.
   */
  readonly other: readonly ArisLocaleSlot[]
  readonly values: readonly ArisAttributeValue[]
}

const NO_LOCALE_ID = ''

export function attributeSlots(
  attribute: ArisAttribute,
  convention: ArisLocaleConvention
): ArisAttributeSlots {
  const values: Record<string, string> = {}
  const other: ArisLocaleSlot[] = []
  for (const value of attribute.values) {
    const localeId = value.localeId ?? NO_LOCALE_ID
    const lang = localeLang(value.localeId ?? undefined)
    if (lang && values[localeId] === undefined) {
      values[localeId] = value.text
      continue
    }
    if (lang) continue
    const scriptLang = detectScriptLang(value.text)
    other.push(
      Object.freeze({
        lang: scriptLang ?? 'en',
        localeId,
        present: true,
        text: value.text,
        scriptLang,
        scriptMismatch: false
      })
    )
  }
  return Object.freeze({
    attributeType: attribute.type,
    bilingual: bilingualSlots({ values, fallback: null }, convention),
    other: Object.freeze(other),
    values: attribute.values
  })
}

/**
 * Replace (or append) the value filed under `localeId`.
 *
 * Order is preserved so a write-back never reshuffles an imported attribute,
 * and an empty text removes the entry rather than storing a blank — the
 * working model reads a missing attribute value and an empty one alike.
 */
export function upsertAttributeValue(
  values: readonly ArisAttributeValue[],
  localeId: string,
  text: string
): readonly ArisAttributeValue[] {
  const key = localeId === NO_LOCALE_ID ? null : localeId
  const next: ArisAttributeValue[] = []
  let replaced = false
  for (const value of values) {
    if ((value.localeId ?? null) === key) {
      replaced = true
      if (text.length > 0) next.push(Object.freeze({ localeId: key, text }))
      continue
    }
    next.push(value)
  }
  if (!replaced && text.length > 0) next.push(Object.freeze({ localeId: key, text }))
  return Object.freeze(next)
}

/**
 * Fallback label for an attribute the R3 schema
 * (`src/aris/conventions/attributes.ts`) does not describe. Mirrors the
 * generic label `src/aris/details/tabs.ts` has always used for these, so an
 * unknown/custom attribute type keeps reading exactly as it did before the
 * schema merge.
 */
const GENERIC_ATTRIBUTE_LABEL_KEY = 'aris.details.attributes.attr'

/**
 * One editable attribute row: an existing stored value, or — when `isNew` is
 * true — a schema-declared attribute type this definition/model does not
 * carry a value for yet.
 *
 * A missing row needs no special "create" plumbing: `attributeSlots` already
 * returns empty, `present: false` slots (seeded from the document's own
 * locale convention) for a zero-value attribute, and `upsertAttributeValue`
 * already *appends* rather than requiring an existing entry to replace. So
 * the very first commit against a missing row both creates the attribute and
 * fills it, in the same one `bridge.execute` call an edit to an existing
 * attribute makes — "create-on-first-save" for free, from code already
 * proven for the existing-attribute case.
 */
export interface ArisAttributeEditorRow extends ArisAttributeSlots {
  readonly attributeType: string
  readonly labelKey: string
  readonly mandatory: boolean
  /** True when the R3 schema describes this attribute type at all. */
  readonly isSchemaKnown: boolean
  /** True when there is no stored value yet — a create-on-first-save row. */
  readonly isNew: boolean
  readonly values: readonly ArisAttributeValue[]
}

function mergeAttributeSchemaRows(
  existing: readonly ArisAttribute[],
  schema: readonly ArisAttributeSchemaEntry[],
  convention: ArisLocaleConvention
): readonly ArisAttributeEditorRow[] {
  const schemaByType = new Map(schema.map((entry) => [entry.attributeType, entry]))
  const seen = new Set<string>()
  const rows: ArisAttributeEditorRow[] = []

  for (const attribute of existing) {
    seen.add(attribute.type)
    const entry = schemaByType.get(attribute.type)
    rows.push(
      Object.freeze({
        ...attributeSlots(attribute, convention),
        attributeType: attribute.type,
        labelKey: entry?.labelKey ?? GENERIC_ATTRIBUTE_LABEL_KEY,
        mandatory: entry?.mandatory ?? false,
        isSchemaKnown: entry !== undefined,
        isNew: false
      })
    )
  }

  for (const entry of schema) {
    if (seen.has(entry.attributeType)) continue
    rows.push(
      Object.freeze({
        ...attributeSlots(
          Object.freeze({ type: entry.attributeType, values: Object.freeze([]) }),
          convention
        ),
        attributeType: entry.attributeType,
        labelKey: entry.labelKey,
        mandatory: entry.mandatory,
        isSchemaKnown: true,
        isNew: true
      })
    )
  }

  return Object.freeze(rows)
}

/**
 * Every editable attribute row for an object definition (plan R3): its own
 * stored attributes plus any `schemaForObjectType` entry for its object type
 * that carries no value yet.
 */
export function definitionAttributeRows(
  definition: ArisObjectDefinition,
  convention: ArisLocaleConvention
): readonly ArisAttributeEditorRow[] {
  return mergeAttributeSchemaRows(
    definition.attributes,
    schemaForObjectType(definition.type),
    convention
  )
}

/**
 * Every editable attribute row for a model (plan R3): its own stored
 * attributes plus any `schemaForModelType` entry for its model type that
 * carries no value yet.
 */
export function modelAttributeRows(
  model: ArisModel,
  convention: ArisLocaleConvention
): readonly ArisAttributeEditorRow[] {
  return mergeAttributeSchemaRows(model.attributes, schemaForModelType(model.type), convention)
}

/**
 * Converts an ordered attribute-value list into the `localeId → text` map
 * `ArisAuthoring.setModelAttribute` expects — "the plain `localeId → text`
 * map the details panel builds", per that method's own doc comment, rather
 * than the internal `ArisAttributeValue[]` shape `setDefinitionAttribute`
 * takes. A `null` locale id (the "no locale id" case `upsertAttributeValue`
 * also produces) is filed under the same empty-string key `attributeSlots`
 * already uses for it elsewhere in this module.
 */
export function attributeValuesToRecord(
  values: readonly ArisAttributeValue[]
): Readonly<Record<string, string>> {
  const record: Record<string, string> = {}
  for (const value of values) {
    record[value.localeId ?? NO_LOCALE_ID] = value.text
  }
  return Object.freeze(record)
}

/** The object definition an editor should target for the current selection. */
export interface ArisEditTarget {
  readonly definitionId: string | null
  readonly occurrenceId: string | null
  readonly modelId: string | null
  /** How many occurrences of `definitionId` exist across the whole document. */
  readonly occurrenceCount: number
  /** How many distinct models those occurrences live in. */
  readonly modelCount: number
}

const EMPTY_TARGET: ArisEditTarget = Object.freeze({
  definitionId: null,
  occurrenceId: null,
  modelId: null,
  occurrenceCount: 0,
  modelCount: 0
})

function countOccurrences(
  details: ArisDetailsDocument,
  definitionId: string
): { occurrences: number; models: number } {
  let occurrences = 0
  const models = new Set<string>()
  for (const occurrence of details.occurrences.values()) {
    if (occurrence.definitionId !== definitionId) continue
    occurrences += 1
    models.add(occurrence.modelId)
  }
  return { occurrences, models: models.size }
}

/**
 * Resolve a selection into the definition / occurrence / model it can edit.
 *
 * This is the §8.2 distinction made concrete: an object occurrence resolves to
 * BOTH its own id (for occurrence-local geometry and style) and the definition
 * behind it (for the name, attributes, assignments and attachments that every
 * other occurrence of the same object shares).
 */
export function arisEditTarget(
  element: ArisDetailsElement | null,
  details: ArisDetailsDocument
): ArisEditTarget {
  if (!element) return EMPTY_TARGET
  if (element.kind === 'objectDefinition') {
    if (!details.objectDefinitions.has(element.id)) return EMPTY_TARGET
    const counts = countOccurrences(details, element.id)
    return Object.freeze({
      definitionId: element.id,
      occurrenceId: null,
      modelId: null,
      occurrenceCount: counts.occurrences,
      modelCount: counts.models
    })
  }
  if (element.kind === 'objectOccurrence') {
    const occurrence = details.occurrences.get(element.id)
    if (!occurrence) return EMPTY_TARGET
    const counts = countOccurrences(details, occurrence.definitionId)
    return Object.freeze({
      definitionId: details.objectDefinitions.has(occurrence.definitionId)
        ? occurrence.definitionId
        : null,
      occurrenceId: occurrence.id,
      modelId: occurrence.modelId,
      occurrenceCount: counts.occurrences,
      modelCount: counts.models
    })
  }
  if (element.kind === 'model') {
    if (!details.models.has(element.id)) return EMPTY_TARGET
    return Object.freeze({
      definitionId: null,
      occurrenceId: null,
      modelId: element.id,
      occurrenceCount: 0,
      modelCount: 1
    })
  }
  return EMPTY_TARGET
}

/** The definition record behind an edit target, when there is one. */
export function targetDefinition(
  target: ArisEditTarget,
  details: ArisDetailsDocument
): ArisObjectDefinition | null {
  if (!target.definitionId) return null
  return details.objectDefinitions.get(target.definitionId) ?? null
}

/** Models this definition is not linked to yet, as `{ id, label }` choices. */
export function assignableModels(
  definition: ArisObjectDefinition | null,
  details: ArisDetailsDocument,
  lang: ArisEditLang
): readonly { readonly id: string; readonly label: string }[] {
  if (!definition) return Object.freeze([])
  const linked = new Set(definition.linkedModelIds)
  const choices: { id: string; label: string }[] = []
  for (const [modelId, entry] of details.models) {
    if (linked.has(modelId)) continue
    const slots = bilingualSlots(entry.model.names, { en: null, ar: null })
    const label = slots[lang].text || slots[lang === 'en' ? 'ar' : 'en'].text || modelId
    choices.push({ id: modelId, label })
  }
  choices.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  return Object.freeze(choices)
}

/** Display label for a linked model id, falling back to the raw id. */
export function modelLabel(
  modelId: string,
  details: ArisDetailsDocument,
  lang: ArisEditLang
): string {
  const entry = details.models.get(modelId)
  if (!entry) return modelId
  const slots = bilingualSlots(entry.model.names, { en: null, ar: null })
  return slots[lang].text || slots[lang === 'en' ? 'ar' : 'en'].text || modelId
}

/** The occurrence style fields the rail offers, in render order. */
export type ArisEditableStyleField = 'fillColor' | 'strokeColor' | 'strokeWidth' | 'lineStyle'

export const ARIS_EDITABLE_STYLE_FIELDS: readonly ArisEditableStyleField[] = Object.freeze([
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'lineStyle'
])

export const ARIS_LINE_STYLES: readonly string[] = Object.freeze(['solid', 'dashed', 'dotted'])

/** Current value of one editable style field, as a string for form controls. */
export function styleFieldValue(
  style: ArisOccurrenceStyle | null | undefined,
  field: ArisEditableStyleField
): string {
  if (!style) return ''
  const value = style[field]
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * Turn a form value back into the `Partial<ArisOccurrenceStyle>` patch the
 * authoring API expects. An emptied field clears the override back to the
 * symbol's own appearance rather than storing `""`.
 */
export function styleFieldPatch(
  field: ArisEditableStyleField,
  raw: string
): Partial<ArisOccurrenceStyle> {
  const text = raw.trim()
  if (text.length === 0) return { [field]: null } as Partial<ArisOccurrenceStyle>
  if (field === 'strokeWidth') {
    const width = Number(text)
    if (!Number.isFinite(width) || width < 0) return {}
    return { strokeWidth: width }
  }
  return { [field]: text } as Partial<ArisOccurrenceStyle>
}

/** The write half of the rail: one method per §11.4 operation it exposes. */
export interface ArisDetailsEditingApi {
  readonly renameDefinition: (definitionId: string, localeId: string, name: string) => void
  readonly renameModel: (modelId: string, localeId: string, name: string) => void
  readonly setDefinitionAttribute: (
    definitionId: string,
    attributeType: string,
    values: readonly ArisAttributeValue[]
  ) => void
  /**
   * Edit a model-scoped R3 attribute (plan §11.4, the `'model'` owner kind).
   * Mirrors `ArisAuthoring.setModelAttribute`, which already exists (Lane
   * C4) and takes the plain `localeId → text` map `attributeValuesToRecord`
   * produces.
   *
   * Required: `ArisStudioTab.tsx` builds its concrete `ArisDetailsEditingApi`
   * object by delegating every member (this one included) to the matching
   * `canvas.authoring.*` call, so a caller can invoke it unconditionally —
   * there is no longer a "not wired yet" case to degrade gracefully from.
   */
  readonly setModelAttribute: (
    modelId: string,
    attributeType: string,
    values: Readonly<Record<string, string>>
  ) => void
  readonly restyleOccurrence: (occurrenceId: string, style: Partial<ArisOccurrenceStyle>) => void
  readonly addModelAssignment: (definitionId: string, modelId: string) => void
  readonly removeModelAssignment: (definitionId: string, modelId: string) => void
  readonly addAttachment: (definitionId: string, attachment: ArisAttachment) => void
  readonly removeAttachment: (definitionId: string, attachmentId: string) => void
  readonly downloadAttachment: (definitionId: string, attachmentId: string) => void
}

/**
 * Authored attachments on a definition.
 *
 * Delegates to the canvas layer's own reader rather than re-implementing the
 * `AT_ORBITPM_ATTACHMENT` JSON encoding, so the rail can never drift from what
 * `addAttachmentCommand` writes.
 */
export function readAuthoredAttachments(
  document: ArisWorkingDocument | null | undefined,
  definitionId: string | null
): readonly ArisAttachment[] {
  if (!document || !definitionId) return Object.freeze([])
  if (!document.objectDefinitions.has(definitionId)) return Object.freeze([])
  try {
    return listAttachments(document, definitionId)
  } catch {
    // A definition that belongs to another document revision must never blank
    // the rail.
    return Object.freeze([])
  }
}
