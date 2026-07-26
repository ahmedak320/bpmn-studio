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
        (entry) =>
          !overridden.has(lookupKey(entry.en)) &&
          !overridden.has(lookupKey(entry.ar))
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
  if (source === target) return undefined
  const sourceKey = lookupKey(sourceValue)
  if (!sourceKey) return undefined

  for (const entry of glossary) {
    if (lookupKey(entry[source]) !== sourceKey) continue
    const value = normalizeLocalizationLookup(entry[target])
    if (value) return { value, resource: 'glossary' }
  }

  for (const entry of translationMemory) {
    if (entry.accepted !== true || lookupKey(entry[source]) !== sourceKey) continue
    const value = normalizeLocalizationLookup(entry[target])
    if (value) return { value, resource: 'translation-memory' }
  }
  return undefined
}

