// THE single documented seam (per the Phase 14 brief: "define your own
// minimal input types ... and adapt at ONE seam") between a real parsed ARIS
// working document and this lane's own `ArisAssistantModelInput` contract.
//
// `src/aris/model/types.ts` is owned by another, actively-mid-flight agent,
// so nothing in this assistant lane imports it. Instead, the local
// `*Like` interfaces below are a STRUCTURAL copy of the subset of that
// module's shape this adapter needs, as read on 2026-07-29. When Phase 14 is
// wired into the real app, re-diff this file's `*Like` types against the
// current `src/aris/model/types.ts` before passing a real
// `ArisWorkingDocument` through `adaptArisWorkingDocument` — TypeScript's
// structural typing means a real `ArisWorkingDocument` will satisfy
// `ArisWorkingDocumentLike` as-is if the shapes still line up, with zero
// import coupling either way.
//
// Locale resolution: `ArisLocalizedValueLike.values` is keyed by whatever
// locale identifier the source layer stored (raw AML LCID strings like
// `"1033"`/`"14337"`, or a normalized tag like `"en-US"`/`"ar-AE"`).
// `arisVocabulary.localeKeyToLang` recognizes both conventions.

import { localeKeyToLang } from './arisVocabulary'
import type {
  ArisAssistantAttribute,
  ArisAssistantConnectionOccurrenceInput,
  ArisAssistantLocalizedText,
  ArisAssistantModelInput,
  ArisAssistantObjectOccurrenceInput
} from './types'

export interface ArisLocalizedValueLike {
  readonly values: Readonly<Record<string, string>>
  readonly fallback: string | null
}

export interface ArisAttributeValueLike {
  readonly localeId: string | null
  readonly text: string
}

export interface ArisAttributeLike {
  readonly type: string
  readonly values: readonly ArisAttributeValueLike[]
}

export interface ArisObjectDefinitionLike {
  readonly id: string
  readonly type: string
  readonly names: ArisLocalizedValueLike
  readonly attributes: readonly ArisAttributeLike[]
  readonly linkedModelIds: readonly string[]
}

export interface ArisConnectionDefinitionLike {
  readonly id: string
  readonly type: string
  readonly names: ArisLocalizedValueLike
}

export interface ArisObjectOccurrenceLike {
  readonly id: string
  readonly definitionId: string
  readonly symbol: string | null
}

export interface ArisConnectionOccurrenceLike {
  readonly id: string
  readonly definitionId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
}

export interface ArisModelLike {
  readonly id: string
  readonly type: string
  readonly names: ArisLocalizedValueLike
  readonly attributes: readonly ArisAttributeLike[]
  readonly occurrences: readonly ArisObjectOccurrenceLike[]
  readonly connectionOccurrences: readonly ArisConnectionOccurrenceLike[]
}

export interface ArisWorkingDocumentLike {
  readonly models: ReadonlyMap<string, ArisModelLike>
  readonly objectDefinitions: ReadonlyMap<string, ArisObjectDefinitionLike>
  readonly connectionDefinitions: ReadonlyMap<string, ArisConnectionDefinitionLike>
  readonly revision: number
}

const EMPTY_LOCALIZED: ArisLocalizedValueLike = { values: {}, fallback: null }

function resolveLocalized(value: ArisLocalizedValueLike | undefined): ArisAssistantLocalizedText {
  const v = value ?? EMPTY_LOCALIZED
  let en: string | null = null
  let ar: string | null = null
  for (const [localeKey, text] of Object.entries(v.values)) {
    if (!text) continue
    const lang = localeKeyToLang(localeKey)
    if (lang === 'en' && en === null) en = text
    else if (lang === 'ar' && ar === null) ar = text
  }
  return { en, ar, fallback: v.fallback }
}

function resolveAttributes(attributes: readonly ArisAttributeLike[]): ArisAssistantAttribute[] {
  return attributes.map((attr) => {
    let en: string | null = null
    let ar: string | null = null
    let fallback: string | null = null
    for (const value of attr.values) {
      if (!value.text) continue
      if (fallback === null) fallback = value.text
      const lang = localeKeyToLang(value.localeId)
      if (lang === 'en' && en === null) en = value.text
      else if (lang === 'ar' && ar === null) ar = value.text
    }
    return { type: attr.type, text: { en, ar, fallback } }
  })
}

/**
 * Adapt one real parsed ARIS working document into this lane's
 * `ArisAssistantModelInput[]`. `relPathByModelId` / `sourceDigestByModelId`
 * carry information the working document itself does not (workspace path,
 * content hash for cache keys) — the caller wiring this up owns both.
 */
export function adaptArisWorkingDocument(
  doc: ArisWorkingDocumentLike,
  relPathByModelId: ReadonlyMap<string, string>,
  sourceDigestByModelId: ReadonlyMap<string, string>
): ArisAssistantModelInput[] {
  const out: ArisAssistantModelInput[] = []
  for (const model of doc.models.values()) {
    const occurrences: ArisAssistantObjectOccurrenceInput[] = model.occurrences.map((occ) => {
      const def = doc.objectDefinitions.get(occ.definitionId)
      return {
        occurrenceId: occ.id,
        definitionId: occ.definitionId,
        objectType: def?.type ?? 'UNKNOWN',
        symbol: occ.symbol,
        names: resolveLocalized(def?.names),
        attributes: resolveAttributes(def?.attributes ?? []),
        linkedModelIds: def?.linkedModelIds ?? []
      }
    })

    const connectionOccurrences: ArisAssistantConnectionOccurrenceInput[] = model.connectionOccurrences.map(
      (c) => {
        const def = doc.connectionDefinitions.get(c.definitionId)
        return {
          occurrenceId: c.id,
          definitionId: c.definitionId,
          connectionType: def?.type ?? 'UNKNOWN',
          sourceOccurrenceId: c.sourceOccurrenceId,
          targetOccurrenceId: c.targetOccurrenceId,
          names: resolveLocalized(def?.names)
        }
      }
    )

    out.push({
      relPath: relPathByModelId.get(model.id) ?? model.id,
      modelId: model.id,
      modelType: model.type,
      names: resolveLocalized(model.names),
      attributes: resolveAttributes(model.attributes),
      occurrences,
      connectionOccurrences,
      revision: doc.revision,
      sourceDigest: sourceDigestByModelId.get(model.id) ?? ''
    })
  }
  return out
}
