export interface ProcessContextEntry {
  id: string
  name: string
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'process',
  'the',
  'to',
  'with',
  'عملية',
  'في',
  'من',
  'إلى',
  'على',
  'و'
])

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  )
}

function scoreEntry(queryTokens: Set<string>, entry: ProcessContextEntry): number {
  const candidateTokens = tokens(`${entry.id} ${entry.name}`)
  let score = 0
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) score += token.length >= 5 ? 2 : 1
  }
  return score
}

/**
 * Return only processes with positive lexical evidence. A zero-confidence
 * query returns no context, never the first arbitrary workspace entries.
 */
export function selectRelevantProcesses(
  query: string,
  catalog: readonly ProcessContextEntry[],
  maxEntries = 6
): ProcessContextEntry[] {
  const queryTokens = tokens(query)
  if (queryTokens.size === 0) return []
  return catalog
    .map((entry, index) => ({ entry, index, score: scoreEntry(queryTokens, entry) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, maxEntries))
    .map(({ entry }) => ({ ...entry }))
}

export function redactProcessNames(
  catalog: readonly ProcessContextEntry[]
): ProcessContextEntry[] {
  return catalog.map((entry, index) => ({
    id: entry.id,
    name: `Process ${index + 1}`
  }))
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/
const SECRETISH_RE = /\b(?:api[_ -]?key|password|secret|token)\b/i

export interface ContextSensitivity {
  containsNames: boolean
  containsSensitiveMetadata: boolean
}

export function inspectContextSensitivity(
  description: string,
  catalog: readonly ProcessContextEntry[]
): ContextSensitivity {
  const combined = `${description}\n${catalog
    .map((entry) => `${entry.id}\n${entry.name}`)
    .join('\n')}`
  return {
    containsNames: catalog.some((entry) => entry.name.trim().length > 0),
    containsSensitiveMetadata:
      EMAIL_RE.test(combined) || PHONE_RE.test(combined) || SECRETISH_RE.test(combined)
  }
}
