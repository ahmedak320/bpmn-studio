// Deterministic, no-AI "what happens next" answerer for the OrbitPM Lite
// assistant. Given the workspace digests and a free-text question, it finds the
// step the user is most likely asking about (token overlap of the question vs
// each step name, with a small process-name tiebreak) and reports that step's
// resolved next-steps — or, when the match is ambiguous or absent, a short list
// of candidate processes to disambiguate. This runs instantly and offline; the
// LLM path (prompt.ts) is only needed when a natural-language answer is wanted.

import type { ProcessDigest, DigestStep } from './digest'
import { tokenize, rankDigests } from './retrieval'

export interface LocalAnswer {
  kind: 'next' | 'candidates' | 'none'
  process?: ProcessDigest
  step?: DigestStep
  nexts?: Array<{ name: string; owner?: string; condition?: string }>
  candidates?: Array<{ processName: string; relPath: string; stepName?: string }>
}

/** Count of shared unique tokens between two token lists. */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let n = 0
  for (const t of new Set(a)) if (setB.has(t)) n++
  return n
}

interface Pair {
  digest: ProcessDigest
  step: DigestStep
  score: number
}

/**
 * Answer "what happens after X" locally, without an LLM.
 *
 * Scores every (process, step) pair by `overlap(query, stepName) + 0.5 *
 * overlap(query, processName)`. A confident, unambiguous winner yields a `next`
 * answer with its next-steps resolved to names/owners/conditions (an end event
 * naturally yields `nexts: []`, i.e. the process is complete). Several close
 * matches spread across DIFFERENT processes yield a `candidates` list; nothing
 * matching yields `none` plus the top processes by general retrieval.
 */
export function answerLocally(digests: ProcessDigest[], query: string): LocalAnswer {
  const q = tokenize(query)

  const noneAnswer = (): LocalAnswer => ({
    kind: 'none',
    candidates: rankDigests(digests, query, 3).map(({ digest }) => ({
      processName: digest.processName,
      relPath: digest.relPath
    }))
  })

  if (!q.length) return noneAnswer()

  const pairs: Pair[] = []
  for (const digest of digests) {
    const procOverlap = overlap(q, tokenize(digest.processName))
    for (const step of digest.steps) {
      const score = overlap(q, tokenize(step.name)) + 0.5 * procOverlap
      if (score > 0) pairs.push({ digest, step, score })
    }
  }
  if (!pairs.length) return noneAnswer()

  pairs.sort((a, b) => b.score - a.score)
  const best = pairs[0]

  // Cross-process rivals whose score is within 1 of the best.
  const rivals = pairs.filter(
    (p) => p !== best && p.digest.relPath !== best.digest.relPath && best.score - p.score <= 1
  )
  // A unique top means no other pair (any process) ties the best score.
  const uniqueTop = !pairs.some((p) => p !== best && p.score === best.score)
  const confident = best.score >= 2 || (best.score >= 1 && uniqueTop)

  if (confident && rivals.length === 0) {
    const nameById = new Map(best.digest.steps.map((s) => [s.id, s]))
    const nexts = best.step.nexts.map((n) => {
      const tgt = nameById.get(n.targetId)
      const out: { name: string; owner?: string; condition?: string } = {
        name: tgt ? tgt.name : n.targetId
      }
      if (tgt?.owner) out.owner = tgt.owner
      if (n.condition) out.condition = n.condition
      return out
    })
    return { kind: 'next', process: best.digest, step: best.step, nexts }
  }

  if (rivals.length >= 1) {
    const pool = [best, ...rivals]
    const seen = new Set<string>()
    const candidates: NonNullable<LocalAnswer['candidates']> = []
    for (const p of pool) {
      if (seen.has(p.digest.relPath)) continue
      seen.add(p.digest.relPath)
      candidates.push({
        processName: p.digest.processName,
        relPath: p.digest.relPath,
        stepName: p.step.name
      })
      if (candidates.length >= 3) break
    }
    return { kind: 'candidates', candidates }
  }

  if (confident) {
    const nameById = new Map(best.digest.steps.map((s) => [s.id, s]))
    const nexts = best.step.nexts.map((n) => {
      const tgt = nameById.get(n.targetId)
      const out: { name: string; owner?: string; condition?: string } = {
        name: tgt ? tgt.name : n.targetId
      }
      if (tgt?.owner) out.owner = tgt.owner
      if (n.condition) out.condition = n.condition
      return out
    })
    return { kind: 'next', process: best.digest, step: best.step, nexts }
  }

  return noneAnswer()
}
