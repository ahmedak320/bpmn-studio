/**
 * Field extraction: turn an `ArisWorkingDocument` into the notation-agnostic
 * `LocalizationField[]` the `src/localization` core planning/audit/queue stages
 * consume, plus the `owners` map that lets the apply stage route each resolved
 * value back to the exact ARIS record it came from.
 *
 * Locale detection is a LOCAL reimplementation of `arisChatProposal.detectLocaleIds`
 * (this lane must not import `src/aris/shell`). The classifier recognizes the three
 * shapes a real ARIS export uses for a `LocaleId`: numeric Windows LCIDs, short
 * BCP-47-ish tags, and the raw unexpanded internal-DTD entity reference
 * (`&LocaleId.USen;`), the last via `localeLang` — see `src/aris/chat/locale.ts` for
 * why every real import keys `names.values` by that raw form.
 *
 * The ARIS write-locale ids are smuggled through the notation-agnostic pipeline as
 * `storage.enProperty`/`storage.arProperty`: each is the existing key when that
 * language is already present, else the document-level detected id (fallback
 * `'1033'`/`'1025'`). The apply stage reads them back off the resulting patches.
 */

import { localeLang } from '../../library/amlParse'
import {
  LocalizationSource,
  type BilingualValue,
  type LocalizationField
} from '../../localization/types'
import type { ArisLocalizedValue, ArisWorkingDocument } from '../model/types'

/** Byte-identical to `arisChatProposal`'s local fallbacks. */
const DEFAULT_ENGLISH_LOCALE_ID = '1033'
const DEFAULT_ARABIC_LOCALE_ID = '1025'
const ENGLISH_LOCALE_IDS = new Set(['1033', 'en', 'en-US', 'en-GB'])
const ARABIC_LOCALE_IDS = new Set(['1025', 'ar', 'ar-AE', 'ar-SA'])

export interface ArisTranslationOwner {
  readonly kind: 'model' | 'objectDefinition' | 'connectionDefinition' | 'freeText'
  readonly id: string
  readonly modelId: string // '' for document-scoped definitions with no occurrence
}

export interface ArisLocaleIds {
  readonly en: string
  readonly ar: string
}

export interface ArisLocalizationExtract {
  readonly fields: readonly LocalizationField[]
  readonly owners: ReadonlyMap<string, ArisTranslationOwner> // key = elementId used in fields
  readonly locales: ArisLocaleIds
}

/** English/Arabic/neither for one `LocaleId`, across all three ARIS shapes. */
function classifyLocaleId(localeId: string): 'en' | 'ar' | undefined {
  if (ENGLISH_LOCALE_IDS.has(localeId) || localeLang(localeId) === 'en') return 'en'
  if (ARABIC_LOCALE_IDS.has(localeId) || localeLang(localeId) === 'ar') return 'ar'
  return undefined
}

/**
 * Local reimplementation of `detectLocaleIds`: the first `names.values` key per
 * language, scanned across every model then every object definition, with
 * byte-identical `'1033'`/`'1025'` fallbacks.
 */
export function detectArisLocaleIds(document: ArisWorkingDocument): ArisLocaleIds {
  let en: string | null = null
  let ar: string | null = null
  const consider = (values: Readonly<Record<string, string>>): void => {
    for (const localeId of Object.keys(values)) {
      if (en === null && classifyLocaleId(localeId) === 'en') en = localeId
      if (ar === null && classifyLocaleId(localeId) === 'ar') ar = localeId
    }
  }
  for (const model of document.models.values()) consider(model.names.values)
  for (const definition of document.objectDefinitions.values()) consider(definition.names.values)
  return { en: en ?? DEFAULT_ENGLISH_LOCALE_ID, ar: ar ?? DEFAULT_ARABIC_LOCALE_ID }
}

/** First non-blank `values` entry whose key classifies as `lang`. */
function slotFor(
  values: Readonly<Record<string, string>>,
  lang: 'en' | 'ar'
): { readonly localeId: string; readonly value: string } | undefined {
  for (const [localeId, text] of Object.entries(values)) {
    if (text.trim() === '') continue
    if (classifyLocaleId(localeId) === lang) return { localeId, value: text }
  }
  return undefined
}

function hasAnyNonBlank(values: Readonly<Record<string, string>>): boolean {
  return Object.values(values).some((text) => text.trim() !== '')
}

interface BuildFieldInput {
  readonly elementId: string
  readonly elementType: string
  readonly field: string
  readonly kind: LocalizationField['kind']
  readonly processId: string
  readonly localized: ArisLocalizedValue
}

function buildField(
  input: BuildFieldInput,
  active: 'en' | 'ar',
  locales: ArisLocaleIds
): LocalizationField {
  const en = slotFor(input.localized.values, 'en')
  const ar = slotFor(input.localized.values, 'ar')
  const value: BilingualValue = { active }
  const origins: LocalizationField['origins'] = {}
  if (en) {
    value.en = en.value
    origins.en = 'paired'
  }
  if (ar) {
    value.ar = ar.value
    origins.ar = 'paired'
  }
  return {
    source: LocalizationSource.Aris,
    processId: input.processId,
    elementId: input.elementId,
    elementType: input.elementType,
    field: input.field,
    kind: input.kind,
    value,
    origins,
    // The storage strings smuggle the ARIS write-locale ids through the
    // notation-agnostic pipeline: existing key when present, else the
    // document-level detected id.
    storage: {
      enProperty: en?.localeId ?? locales.en,
      arProperty: ar?.localeId ?? locales.ar,
      projectionProperty: 'fallback'
    },
    planeIds: []
  }
}

export function extractArisLocalizationFields(
  document: ArisWorkingDocument,
  options: { readonly active: 'en' | 'ar'; readonly locales?: ArisLocaleIds }
): ArisLocalizationExtract {
  const locales = options.locales ?? detectArisLocaleIds(document)
  const active = options.active

  // First occurrence's model id gives a definition its process scope.
  const objectDefinitionModel = new Map<string, string>()
  const connectionDefinitionModel = new Map<string, string>()
  for (const model of document.models.values()) {
    for (const occurrence of model.occurrences) {
      if (!objectDefinitionModel.has(occurrence.definitionId)) {
        objectDefinitionModel.set(occurrence.definitionId, model.id)
      }
    }
    for (const connection of model.connectionOccurrences) {
      if (!connectionDefinitionModel.has(connection.definitionId)) {
        connectionDefinitionModel.set(connection.definitionId, model.id)
      }
    }
  }

  const fields: LocalizationField[] = []
  const owners = new Map<string, ArisTranslationOwner>()

  // Every model, always — even an unnamed one, so a missing model title is
  // still a visible translation gap.
  for (const model of document.models.values()) {
    fields.push(
      buildField(
        {
          elementId: model.id,
          elementType: String(model.type),
          field: 'name',
          kind: 'name',
          processId: model.id,
          localized: model.names
        },
        active,
        locales
      )
    )
    owners.set(model.id, { kind: 'model', id: model.id, modelId: model.id })
  }

  // Named object definitions. Unnamed ones are fix-missing territory, not
  // translate territory. A named `OT_RULE` ("Approved?") IS translatable, so it
  // is included exactly like any other named definition.
  for (const definition of document.objectDefinitions.values()) {
    if (!hasAnyNonBlank(definition.names.values)) continue
    const modelId = objectDefinitionModel.get(definition.id)
    fields.push(
      buildField(
        {
          elementId: definition.id,
          elementType: definition.type,
          field: 'name',
          kind: 'name',
          processId: modelId ?? 'document',
          localized: definition.names
        },
        active,
        locales
      )
    )
    owners.set(definition.id, {
      kind: 'objectDefinition',
      id: definition.id,
      modelId: modelId ?? ''
    })
  }

  // Named connection definitions.
  for (const definition of document.connectionDefinitions.values()) {
    if (!hasAnyNonBlank(definition.names.values)) continue
    const modelId = connectionDefinitionModel.get(definition.id)
    fields.push(
      buildField(
        {
          elementId: definition.id,
          elementType: definition.type,
          field: 'name',
          kind: 'name',
          processId: modelId ?? 'document',
          localized: definition.names
        },
        active,
        locales
      )
    )
    owners.set(definition.id, {
      kind: 'connectionDefinition',
      id: definition.id,
      modelId: modelId ?? ''
    })
  }

  // Non-blank free-text notes.
  for (const model of document.models.values()) {
    for (const note of model.freeText) {
      if (!hasAnyNonBlank(note.text.values)) continue
      fields.push(
        buildField(
          {
            elementId: note.id,
            elementType: 'freeText',
            field: 'text',
            kind: 'annotation',
            processId: model.id,
            localized: note.text
          },
          active,
          locales
        )
      )
      owners.set(note.id, { kind: 'freeText', id: note.id, modelId: model.id })
    }
  }

  return { fields, owners, locales }
}
