/**
 * Headless side-panel tab model.
 *
 * Each tab is a pure function from a selected element to structured,
 * localizable content. The UI layer renders the returned rows by looking up
 * `labelKey`/`valueKey` in the i18n dictionary and interpolating `vars`.
 *
 * Bilingual names are first-class: English and Arabic are returned side by side,
 * and a missing translation is explicitly marked rather than silently falling
 * back.
 */

import { localeLang } from '../../library/amlParse'
import {
  schemaForModelType,
  schemaForObjectType,
  type ArisAttributeSchemaEntry
} from '../conventions/attributes'
import {
  arisAttributeTypeName,
  arisConnectionTypeName,
  arisModelTypeName,
  arisObjectBlockName
} from '../conventions/displayNames'
import type {
  ArisAttribute,
  ArisConnectionOccurrence,
  ArisObjectDefinition,
  ArisObjectOccurrence
} from '../model/types'
import type {
  ArisDetailsAttachment,
  ArisDetailsDocument,
  ArisDetailsElement,
  ArisDetailsModel,
  ArisMetadataSatellite
} from './seam'

export type ArisDetailsTabId =
  | 'general'
  | 'names'
  | 'attributes'
  | 'ids'
  | 'relations'
  | 'assignments'
  | 'attachments'
  | 'accounting'
  | 'fidelity'
  | 'history'

export const ARIS_DETAILS_TAB_ORDER: readonly ArisDetailsTabId[] = [
  'general',
  'names',
  'attributes',
  'ids',
  'relations',
  'assignments',
  'attachments',
  'accounting',
  'fidelity',
  'history'
]

export const ARIS_DETAILS_TAB_LABEL_KEYS: Readonly<Record<ArisDetailsTabId, string>> = {
  general: 'aris.details.tab.general',
  names: 'aris.details.tab.names',
  attributes: 'aris.details.tab.attributes',
  ids: 'aris.details.tab.ids',
  relations: 'aris.details.tab.relations',
  assignments: 'aris.details.tab.assignments',
  attachments: 'aris.details.tab.attachments',
  accounting: 'aris.details.tab.accounting',
  fidelity: 'aris.details.tab.fidelity',
  history: 'aris.details.tab.history'
}

export interface ArisDetailRow {
  readonly labelKey: string
  readonly value?: string | number | boolean | null
  readonly valueKey?: string
  readonly vars?: Readonly<Record<string, string | number>>
  /** If true the value is missing and should be rendered as a placeholder. */
  readonly missing?: boolean
  /** Bilingual variant for name-like rows. */
  readonly bilingual?: ArisBilingualValue
  /**
   * True when the R3 convention schema (`src/aris/conventions/attributes.ts`)
   * marks this attribute mandatory for the row's object/model type. Only ever
   * set on rows from `buildAttributesTab`; every other builder leaves it
   * unset, which the UI treats exactly like `false`.
   */
  readonly mandatory?: boolean
}

export interface ArisBilingualValue {
  readonly en: string | null
  readonly ar: string | null
  readonly enMissing: boolean
  readonly arMissing: boolean
}

export type ArisTabBuilder = (
  element: ArisDetailsElement,
  doc: ArisDetailsDocument
) => readonly ArisDetailRow[]

/**
 * Classify a raw AML locale identifier as English or Arabic.
 *
 * ARIS AML declares locale ids as internal DTD entities:
 *
 *   <!ENTITY LocaleId.AEar "14337">
 *   <!ENTITY LocaleId.USen "1033">
 *
 * and attribute values reference them, e.g. `LocaleId="&LocaleId.AEar;"`.
 * The tokenizer/semantic-index layers only expand entity references inside
 * *element text* (`expandXmlEntities` / `decodeAmlEntities`), never inside
 * attribute values, so the `localeId` that actually reaches this layer is
 * the RAW, unexpanded reference string `"&LocaleId.AEar;"` /
 * `"&LocaleId.USen;"` — never the bare entity name `"LocaleId.AEar"` some
 * earlier version of this file assumed, and never the resolved numeric id
 * on its own either (confirmed against `reference/AnimalWF/ARISAMLExport.xml`,
 * the only real ARIS export available). An allow-list of exact strings can
 * therefore never match a real ARIS export.
 *
 * A hand-written or differently-exported AML could plausibly present any of
 * several shapes though: a raw numeric LCID (`LocaleId="1033"`), a bare
 * entity name without its `&…;` sigils, an unexpanded entity reference, or a
 * normalized BCP-47 tag (`"en-US"`, `"ar-AE"`). Handle all of them by
 * delegating to `localeLang`, the same classifier the semantic-index layer
 * already uses for its own (correctly resolved) `locale` field:
 *
 *  - numeric Windows LCID: classify by the low-10-bit primary language id
 *    (9 = English, 1 = Arabic), which covers every regional English/Arabic
 *    LCID (1033 en-US, 2057 en-GB, 14337 ar-AE, 1025 ar-SA, …) rather than
 *    hardcoding just the two ids this one reference export happens to use.
 *  - anything else: a case-insensitive "ar"/"en" word-boundary suffix match,
 *    which correctly classifies "&LocaleId.AEar;", "LocaleId.AEar", "ar-AE"
 *    and "en-US" alike.
 */
function classifyLocale(rawLocale: string | null | undefined): 'en' | 'ar' | undefined {
  return localeLang(rawLocale ?? undefined)
}

function extractBilingual(values: Readonly<Record<string, string>>): ArisBilingualValue {
  let en: string | null = null
  let ar: string | null = null
  for (const [locale, text] of Object.entries(values)) {
    const lang = classifyLocale(locale)
    if (lang === 'en' && en === null) en = text
    if (lang === 'ar' && ar === null) ar = text
  }
  return {
    en,
    ar,
    enMissing: en === null,
    arMissing: ar === null
  }
}

function objectDefinitionById(
  doc: ArisDetailsDocument,
  id: string
): ArisObjectDefinition | undefined {
  return doc.objectDefinitions.get(id)
}

function objectOccurrenceById(
  doc: ArisDetailsDocument,
  id: string
): ArisObjectOccurrence | undefined {
  return doc.occurrences.get(id)
}

function connectionOccurrenceById(
  doc: ArisDetailsDocument,
  id: string
): ArisConnectionOccurrence | undefined {
  return doc.connectionOccurrences.get(id)
}

function modelDetailsById(doc: ArisDetailsDocument, id: string): ArisDetailsModel | undefined {
  return doc.models.get(id)
}

function attachmentById(doc: ArisDetailsDocument, id: string): ArisDetailsAttachment | undefined {
  return doc.attachments.get(id)
}

function findSatellite(
  doc: ArisDetailsDocument,
  occurrenceId: string
): ArisMetadataSatellite | undefined {
  for (const model of doc.models.values()) {
    const satellite = model.satellites.get(occurrenceId)
    if (satellite) return satellite
  }
  return undefined
}

export const buildGeneralTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'objectDefinition') {
    const def = objectDefinitionById(doc, element.id)
    if (def) {
      rows.push({
        labelKey: 'aris.details.general.objectType',
        value: arisObjectBlockName({ objectType: def.type, symbolNum: def.defaultSymbol })
      })
      rows.push({
        labelKey: 'aris.details.general.linkedModels',
        value: def.linkedModelIds.length
      })
    }
  } else if (element.kind === 'objectOccurrence') {
    const occ = objectOccurrenceById(doc, element.id)
    const def = occ ? objectDefinitionById(doc, occ.definitionId) : undefined
    if (occ && def) {
      rows.push({
        labelKey: 'aris.details.general.objectType',
        value: arisObjectBlockName({ objectType: def.type, symbolNum: occ.symbol })
      })
      rows.push({
        labelKey: 'aris.details.general.position',
        value: `${occ.bounds.x},${occ.bounds.y}`
      })
      rows.push({
        labelKey: 'aris.details.general.size',
        value: `${occ.bounds.width}x${occ.bounds.height}`
      })
    }
  } else if (element.kind === 'model') {
    const details = modelDetailsById(doc, element.id)
    if (details) {
      rows.push({
        labelKey: 'aris.details.general.modelType',
        value: arisModelTypeName(details.model.type)
      })
      rows.push({
        labelKey: 'aris.details.general.occurrences',
        value: details.model.occurrences.length
      })
      rows.push({
        labelKey: 'aris.details.general.connections',
        value: details.model.connectionOccurrences.length
      })
      rows.push({ labelKey: 'aris.details.general.satellites', value: details.satellites.size })
    }
  } else if (element.kind === 'attachment') {
    const att = attachmentById(doc, element.id)
    if (att) {
      rows.push({ labelKey: 'aris.details.general.displayName', value: att.displayName })
      rows.push({ labelKey: 'aris.details.general.blobs', value: att.blobs.length })
    }
  }

  return rows
}

export const buildNamesTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'objectDefinition') {
    const def = objectDefinitionById(doc, element.id)
    if (def) {
      rows.push({
        labelKey: 'aris.details.names.definition',
        bilingual: extractBilingual(def.names.values)
      })
    }
  } else if (element.kind === 'objectOccurrence') {
    const occ = objectOccurrenceById(doc, element.id)
    const def = occ ? objectDefinitionById(doc, occ.definitionId) : undefined
    if (def) {
      rows.push({
        labelKey: 'aris.details.names.inherited',
        bilingual: extractBilingual(def.names.values)
      })
    }
  } else if (element.kind === 'model') {
    const details = modelDetailsById(doc, element.id)
    if (details) {
      rows.push({
        labelKey: 'aris.details.names.model',
        bilingual: extractBilingual(details.model.names.values)
      })
    }
  }

  return rows
}

/**
 * Fallback label for an attribute the R3 schema does not describe. Kept as
 * the plain "Attribute" wording every attribute row used before the schema
 * merge, so an unknown/custom attribute type (e.g. the internal
 * `AT_ORBITPM_ATTACHMENT` store, or a source-specific `AT_REM`) renders
 * exactly as it always has.
 */
const GENERIC_ATTRIBUTE_LABEL_KEY = 'aris.details.attributes.attr'

/**
 * One `attributes` tab per plan R3: every attribute already carrying a stored
 * value, PLUS one explicit "missing" row for every schema-declared attribute
 * (`schemaForObjectType`/`schemaForModelType`) that has no value at all yet.
 *
 * A schema-covered attribute type — stored or not — renders under its own
 * `aris.attribute.*` label instead of the generic placeholder, and carries
 * the schema's `mandatory` flag. A stored attribute the schema does not know
 * about keeps the old generic label untouched.
 */
function buildAttributeRows(
  existing: readonly ArisAttribute[],
  schema: readonly ArisAttributeSchemaEntry[]
): ArisDetailRow[] {
  const schemaByType = new Map(schema.map((entry) => [entry.attributeType, entry]))
  const seen = new Set<string>()
  const rows: ArisDetailRow[] = []

  for (const attr of existing) {
    seen.add(attr.type)
    const entry = schemaByType.get(attr.type)
    const en = attr.values.find((v) => classifyLocale(v.localeId) === 'en')?.text
    const ar = attr.values.find((v) => classifyLocale(v.localeId) === 'ar')?.text
    rows.push({
      labelKey: entry?.labelKey ?? GENERIC_ATTRIBUTE_LABEL_KEY,
      value: attr.type,
      mandatory: entry?.mandatory ?? false,
      bilingual: {
        en: en ?? null,
        ar: ar ?? null,
        enMissing: en === undefined,
        arMissing: ar === undefined
      }
    })
  }

  // Schema-declared attributes with no stored value at all: an explicit
  // missing row so the existing missing-value highlight + editors light up.
  for (const entry of schema) {
    if (seen.has(entry.attributeType)) continue
    rows.push({
      labelKey: entry.labelKey,
      value: entry.attributeType,
      missing: true,
      mandatory: entry.mandatory,
      bilingual: { en: null, ar: null, enMissing: true, arMissing: true }
    })
  }

  return rows
}

export const buildAttributesTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'objectDefinition') {
    const def = objectDefinitionById(doc, element.id)
    if (def) {
      rows.push(...buildAttributeRows(def.attributes, schemaForObjectType(def.type)))
    }
  } else if (element.kind === 'objectOccurrence') {
    const occ = objectOccurrenceById(doc, element.id)
    if (occ) {
      // The occurrence-attribute row has no `bilingual` field to mask its
      // `value` (unlike the definition/model rows above), so this is the one
      // place in this tab where the raw `AT_*` code would otherwise reach the
      // UI directly (Lane L-P10b, user issue 10) — resolve it against the
      // owning definition's object type before it becomes a row.
      const ownerDef = objectDefinitionById(doc, occ.definitionId)
      for (const attrOcc of occ.attributeOccurrences) {
        rows.push({
          labelKey: 'aris.details.attributes.occurrence',
          value: arisAttributeTypeName(attrOcc.attributeType, ownerDef?.type)
        })
      }
    }
  } else if (element.kind === 'model') {
    const details = modelDetailsById(doc, element.id)
    if (details) {
      rows.push(
        ...buildAttributeRows(details.model.attributes, schemaForModelType(details.model.type))
      )
    }
  }

  return rows
}

export const buildIdsTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'objectDefinition') {
    rows.push({ labelKey: 'aris.details.ids.definitionId', value: element.id })
  } else if (element.kind === 'objectOccurrence') {
    const occ = objectOccurrenceById(doc, element.id)
    if (occ) {
      rows.push({ labelKey: 'aris.details.ids.occurrenceId', value: occ.id })
      rows.push({ labelKey: 'aris.details.ids.definitionId', value: occ.definitionId })
      rows.push({ labelKey: 'aris.details.ids.modelId', value: occ.modelId })
    }
  } else if (element.kind === 'connectionOccurrence') {
    const cxn = connectionOccurrenceById(doc, element.id)
    if (cxn) {
      rows.push({ labelKey: 'aris.details.ids.occurrenceId', value: cxn.id })
      rows.push({ labelKey: 'aris.details.ids.definitionId', value: cxn.definitionId })
      rows.push({ labelKey: 'aris.details.ids.modelId', value: cxn.modelId })
    }
  } else if (element.kind === 'model') {
    rows.push({ labelKey: 'aris.details.ids.modelId', value: element.id })
  } else if (element.kind === 'attachment') {
    const att = attachmentById(doc, element.id)
    if (att) {
      rows.push({ labelKey: 'aris.details.ids.oleDefinitionId', value: att.oleDefinitionId })
      rows.push({ labelKey: 'aris.details.ids.oleOccurrenceId', value: att.oleOccurrenceId })
    }
  }

  return rows
}

export const buildRelationsTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'objectOccurrence') {
    const satellite = findSatellite(doc, element.id)
    if (satellite) {
      rows.push({
        labelKey: 'aris.details.relations.category',
        value: satellite.relation.category
      })
      rows.push({
        labelKey: 'aris.details.relations.connectionType',
        value: arisConnectionTypeName(satellite.relation.connectionType)
      })
      rows.push({
        labelKey: 'aris.details.relations.owner',
        value: satellite.relation.sourceOccurrenceId
      })
    }
  }

  return rows
}

export const buildAssignmentsTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'objectDefinition') {
    const def = objectDefinitionById(doc, element.id)
    if (def) {
      for (const modelId of def.linkedModelIds) {
        rows.push({ labelKey: 'aris.details.assignments.model', value: modelId })
      }
      if (def.linkedModelIds.length === 0) {
        rows.push({ labelKey: 'aris.details.assignments.none', value: '', missing: true })
      }
    }
  }

  return rows
}

export const buildAttachmentsTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'model') {
    const details = modelDetailsById(doc, element.id)
    if (details) {
      for (const att of details.attachments.values()) {
        rows.push({ labelKey: 'aris.details.attachments.item', value: att.displayName })
      }
      if (details.attachments.size === 0) {
        rows.push({ labelKey: 'aris.details.attachments.none', missing: true })
      }
    }
  } else if (element.kind === 'attachment') {
    const att = attachmentById(doc, element.id)
    if (att) {
      rows.push({ labelKey: 'aris.details.attachments.item', value: att.displayName })
      rows.push({ labelKey: 'aris.details.attachments.blobs', value: att.blobs.length })
    }
  }

  return rows
}

export const buildAccountingTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'model') {
    const details = modelDetailsById(doc, element.id)
    if (details) {
      rows.push({
        labelKey: 'aris.details.accounting.occurrences',
        value: details.model.occurrences.length
      })
      rows.push({
        labelKey: 'aris.details.accounting.connections',
        value: details.model.connectionOccurrences.length
      })
      rows.push({ labelKey: 'aris.details.accounting.satellites', value: details.satellites.size })
      rows.push({
        labelKey: 'aris.details.accounting.attachments',
        value: details.attachments.size
      })
      rows.push({
        labelKey: 'aris.details.accounting.unsupported',
        value: details.model.unsupported ? 1 : 0
      })
    }
  }

  return rows
}

export const buildFidelityTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  if (element.kind === 'model') {
    const details = modelDetailsById(doc, element.id)
    if (details) {
      rows.push({
        labelKey: 'aris.details.fidelity.symbolFallbacks',
        value: details.model.unsupported ? 1 : 0
      })
      rows.push({
        labelKey: 'aris.details.fidelity.oleUnsupported',
        value: details.attachments.size
      })
    }
  }

  return rows
}

export const buildHistoryTab: ArisTabBuilder = (element, doc) => {
  const rows: ArisDetailRow[] = []

  rows.push({
    labelKey: 'aris.details.history.revision',
    value: doc.revision
  })

  if (element.kind === 'objectDefinition') {
    const def = objectDefinitionById(doc, element.id)
    if (def) {
      rows.push({ labelKey: 'aris.details.history.definitionId', value: def.id })
    }
  }

  return rows
}

export const ARIS_DETAILS_TAB_BUILDERS: Readonly<Record<ArisDetailsTabId, ArisTabBuilder>> = {
  general: buildGeneralTab,
  names: buildNamesTab,
  attributes: buildAttributesTab,
  ids: buildIdsTab,
  relations: buildRelationsTab,
  assignments: buildAssignmentsTab,
  attachments: buildAttachmentsTab,
  accounting: buildAccountingTab,
  fidelity: buildFidelityTab,
  history: buildHistoryTab
}

/** Builds every tab for the selected element. */
export function buildAllTabs(
  element: ArisDetailsElement,
  doc: ArisDetailsDocument
): Readonly<Record<ArisDetailsTabId, readonly ArisDetailRow[]>> {
  const out: Partial<Record<ArisDetailsTabId, readonly ArisDetailRow[]>> = {}
  for (const tabId of ARIS_DETAILS_TAB_ORDER) {
    out[tabId] = ARIS_DETAILS_TAB_BUILDERS[tabId](element, doc)
  }
  return out as Readonly<Record<ArisDetailsTabId, readonly ArisDetailRow[]>>
}
