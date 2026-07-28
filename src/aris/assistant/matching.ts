// Generic "find the one entity the question is about" matcher, shared by the
// Section 17.4 answerers in `answer.ts`. Conceptually the same confidence
// rule `src/assist/answerLocal.ts` uses for "what happens after X": score
// every candidate by token overlap against the query, require the winner to
// clear a minimum score UNIQUELY (no same-score tie, no close cross-model
// rival), and refuse to answer otherwise. This is what keeps every answerer
// positive-confidence-only (Section 17.3).

import { expandedTokens, overlap } from './retrieval'
import type { ArisProcessDigest } from './types'

export interface MatchCandidate<T> {
  readonly digest: ArisProcessDigest
  readonly tokens: readonly string[]
  readonly value: T
}

export interface MatchResult<T> {
  readonly digest: ArisProcessDigest
  readonly value: T
  readonly score: number
}

/**
 * Score every candidate by token overlap against `query` and return the
 * unique, confident winner — or `null` when nothing scores, the top score is
 * tied, or a close rival sits in a DIFFERENT model (an ambiguous cross-model
 * match must not be silently resolved to one guess).
 */
export function bestTokenMatch<T>(
  candidates: readonly MatchCandidate<T>[],
  query: string
): MatchResult<T> | null {
  const q = expandedTokens(query)
  if (!q.length || candidates.length === 0) return null

  const scored = candidates
    .map((c) => ({ ...c, score: overlap([...q], [...c.tokens]) }))
    .filter((c) => c.score > 0)
  if (!scored.length) return null

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]

  const uniqueTop = !scored.some((c) => c !== best && c.score === best.score)
  const confident = best.score >= 2 || (best.score >= 1 && uniqueTop)
  if (!confident) return null

  const crossModelRival = scored.some(
    (c) => c !== best && c.digest.relPath !== best.digest.relPath && best.score - c.score <= 1
  )
  if (crossModelRival) return null

  return { digest: best.digest, value: best.value, score: best.score }
}
