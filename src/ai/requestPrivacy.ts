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

export function redactProcessNames(catalog: readonly ProcessContextEntry[]): ProcessContextEntry[] {
  return catalog.map((entry, index) => ({
    id: entry.id,
    name: `Process ${index + 1}`
  }))
}

/**
 * Worst-case physical provider requests for the generation repair envelope.
 * A large attachment is deliberately sent only on the first semantic attempt;
 * later repair turns are text-only and retain the normal transport retry cap.
 */
export function estimateGenerationRequestCount(
  hasLargeAttachment: boolean,
  semanticAttempts = 3,
  transportAttempts = 3
): number {
  const semantic = Math.max(1, Math.floor(semanticAttempts))
  const transport = Math.max(1, Math.floor(transportAttempts))
  return hasLargeAttachment ? 1 + (semantic - 1) * transport : semantic * transport
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/
const SECRETISH_RE = /\b(?:api[_ -]?key|password|secret|token)\b/i
const MULTIWORD_CAPITALIZED_NAME_RE =
  /(?:^|[^\p{L}\p{M}])\p{Lu}[\p{L}\p{M}'’.-]{1,}(?:\s+\p{Lu}[\p{L}\p{M}'’.-]{1,})+(?=$|[^\p{L}\p{M}])/u
const PERSON_LABEL_RE =
  /\b(?:approver|customer|employee|manager|owner|requester|responsible)\s*[:=-]?\s+[\p{L}\p{M}'’.-]{2,}(?:\s+[\p{L}\p{M}'’.-]{2,})?/iu
const ARABIC_PERSON_LABEL_RE =
  /(?:السيد(?:ة)?|الموظف(?:ة)?|المدير(?:ة)?|المسؤول(?:ة)?|العميل(?:ة)?)\s+[\p{Script=Arabic}\p{M}]{2,}(?:\s+[\p{Script=Arabic}\p{M}]{2,})?/u
const REDACTED_PROCESS_ALIAS_RE = /^Process \d+$/i

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
    containsNames:
      MULTIWORD_CAPITALIZED_NAME_RE.test(description) ||
      PERSON_LABEL_RE.test(description) ||
      ARABIC_PERSON_LABEL_RE.test(description) ||
      catalog.some((entry) => {
        const name = entry.name.trim()
        return name.length > 0 && !REDACTED_PROCESS_ALIAS_RE.test(name)
      }),
    containsSensitiveMetadata:
      EMAIL_RE.test(combined) || PHONE_RE.test(combined) || SECRETISH_RE.test(combined)
  }
}
