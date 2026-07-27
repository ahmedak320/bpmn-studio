import type { GlossaryEntry, TranslationMemoryEntry } from './types'

/** Reviewed 0.4.5 seed terms. They are whole-value neutrals, not substring
 * exemptions: `API` is neutral, while `API approval` still needs translation. */
export const SEEDED_GLOSSARY: readonly GlossaryEntry[] = Object.freeze([
  Object.freeze({ en: 'API', ar: 'API', neutral: true }),
  Object.freeze({ en: 'SLA', ar: 'SLA', neutral: true }),
  Object.freeze({ en: 'DMT HUB', ar: 'DMT HUB', neutral: true })
])

export function normalizeLocalizationLookup(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

function lookupKey(value: string): string {
  return normalizeLocalizationLookup(value).toLocaleLowerCase('en-US')
}

/**
 * Return a mutable workspace seed. Callers persist/edit this list in
 * `.orbitpm/i18n/glossary.json`; the frozen exported constant cannot be
 * accidentally changed.
 */
export function createSeededGlossary(): GlossaryEntry[] {
  return SEEDED_GLOSSARY.map((entry) => ({ ...entry }))
}

/**
 * Merge reviewed workspace edits over the seeds. A user entry replaces any
 * seed sharing either language side, so changing/removing a neutral mapping is
 * deterministic and does not leave a shadow seed match behind.
 */
export function mergeGlossary(
  workspaceEntries: readonly GlossaryEntry[],
  seeds: readonly GlossaryEntry[] = SEEDED_GLOSSARY
): GlossaryEntry[] {
  const overridden = new Set<string>()
  for (const entry of workspaceEntries) {
    overridden.add(lookupKey(entry.en))
    overridden.add(lookupKey(entry.ar))
  }
  return [
    ...seeds
      .filter(
        (entry) => !overridden.has(lookupKey(entry.en)) && !overridden.has(lookupKey(entry.ar))
      )
      .map((entry) => ({ ...entry })),
    ...workspaceEntries.map((entry) => ({ ...entry }))
  ]
}

export function approvedNeutralTerms(
  glossary: readonly GlossaryEntry[] = SEEDED_GLOSSARY
): string[] {
  const values: string[] = []
  const seen = new Set<string>()
  for (const entry of glossary) {
    if (!entry.neutral) continue
    for (const value of [entry.en, entry.ar]) {
      const normalized = normalizeLocalizationLookup(value)
      const key = lookupKey(normalized)
      if (!normalized || seen.has(key)) continue
      seen.add(key)
      values.push(normalized)
    }
  }
  return values
}

export interface LocalPairMatch {
  value: string
  resource: 'glossary' | 'translation-memory'
}

export interface LocalPairIndex {
  readonly enToAr: ReadonlyMap<string, LocalPairMatch>
  readonly arToEn: ReadonlyMap<string, LocalPairMatch>
}

export function createLocalPairIndex(
  glossary: readonly GlossaryEntry[],
  translationMemory: readonly TranslationMemoryEntry[]
): LocalPairIndex {
  const enToAr = new Map<string, LocalPairMatch>()
  const arToEn = new Map<string, LocalPairMatch>()
  const add = (
    entries: readonly (GlossaryEntry | TranslationMemoryEntry)[],
    resource: LocalPairMatch['resource']
  ): void => {
    for (const entry of entries) {
      if (
        resource === 'translation-memory' &&
        (!('accepted' in entry) || entry.accepted !== true)
      ) {
        continue
      }
      const enKey = lookupKey(entry.en)
      const arKey = lookupKey(entry.ar)
      const ar = normalizeLocalizationLookup(entry.ar)
      const en = normalizeLocalizationLookup(entry.en)
      if (enKey && ar && !enToAr.has(enKey)) enToAr.set(enKey, { value: ar, resource })
      if (arKey && en && !arToEn.has(arKey)) arToEn.set(arKey, { value: en, resource })
    }
  }
  // First-in-file order is retained within each resource, while adding the
  // entire glossary first preserves glossary-over-TM precedence.
  add(glossary, 'glossary')
  add(translationMemory, 'translation-memory')
  return Object.freeze({ enToAr, arToEn })
}

export function findIndexedLocalPair(
  index: LocalPairIndex,
  sourceValue: string,
  source: 'en' | 'ar',
  target: 'en' | 'ar'
): LocalPairMatch | undefined {
  if (source === target) return undefined
  const sourceKey = lookupKey(sourceValue)
  if (!sourceKey) return undefined
  return (source === 'en' ? index.enToAr : index.arToEn).get(sourceKey)
}

/**
 * Exact whole-value lookup with deterministic precedence:
 * glossary before TM, then first entry in file order. Rejected/unaccepted TM
 * records cannot enter this API because the durable type requires
 * `accepted: true`.
 */
export function findLocalPair(
  sourceValue: string,
  source: 'en' | 'ar',
  target: 'en' | 'ar',
  glossary: readonly GlossaryEntry[],
  translationMemory: readonly TranslationMemoryEntry[]
): LocalPairMatch | undefined {
  return findIndexedLocalPair(
    createLocalPairIndex(glossary, translationMemory),
    sourceValue,
    source,
    target
  )
}
