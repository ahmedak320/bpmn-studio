// Token-overlap retrieval + context rendering for the ARIS process
// assistant. This is a direct port of the qualities in `src/assist/retrieval.ts`
// (the BPMN assistant's retrieval engine) onto `ArisProcessDigest`:
//
// - Unicode tokenization (`tokenize`): keeps any Unicode letter/digit so
//   Arabic ranks alongside Latin.
// - Arabic-aware normalization + clitic expansion (`normalizeToken`,
//   `expandToken`): diacritics/tatweel stripped, hamza-carrier alefs
//   unified, ى -> ي, ة -> ه, and definite-article-family clitics (ال، وال،
//   بال، فال، كال، لل) stripped as an ADDITIONAL match variant.
// - English light plural-s normalization, same additional-variant approach.
// - Weighted overlap scoring across bands, with a transparent weight scheme
//   the user could reason about.
// - Positive-confidence-only results (`selectContextDigests`): zero overlap
//   never returns a "closest" digest just to fill a slot.
// - Bounded top-k results and per-/overall-context character budgets.
//
// ADDED for ARIS (Section 17.3): process code, object definition/occurrence
// names (steps), owners/responsibilities, inputs/outputs/systems, decision
// outcomes, assigned models, and missing-information issues all feed the
// token bands below instead of being blind spots for the assistant.

import type { ArisDigestStep, ArisProcessDigest } from './types'

/**
 * Lowercase and split a string into tokens on any non-(letter|digit) run,
 * keeping Unicode letters (Arabic included) and dropping tokens shorter than
 * 2 characters.
 */
export function tokenize(s: string): string[] {
  if (!s) return []
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
}

// --- Arabic-aware token normalization + expansion ---------------------------

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g // tashkeel + quranic marks + dagger alef + tatweel

/**
 * Normalize one token for matching: Arabic diacritics/tatweel removed, hamza
 * alef forms (أ إ آ ٱ) unified to ا, ى->ي, ة->ه. Latin tokens pass through
 * (tokenize already lowercased them).
 */
export function normalizeToken(token: string): string {
  return token
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
}

/** Arabic definite-article (and common conjunction+article) clitic prefixes, longest first. */
const AR_CLITIC_PREFIXES = ['وال', 'فال', 'بال', 'كال', 'لل', 'ال']

/**
 * Expand one token into its match variants: the normalized surface form,
 * plus a de-cliticized Arabic form (definite article stripped when >= 2
 * letters remain), plus a singular form for English plural-s tokens (>= 4
 * chars). Pure expansion — the surface form is always kept.
 */
export function expandToken(token: string): string[] {
  const norm = normalizeToken(token)
  const out = new Set<string>([norm])
  for (const prefix of AR_CLITIC_PREFIXES) {
    if (norm.startsWith(prefix) && norm.length - prefix.length >= 2) {
      out.add(norm.slice(prefix.length))
      break
    }
  }
  if (/^[a-z0-9]+$/.test(norm) && norm.length >= 4 && norm.endsWith('s') && !norm.endsWith('ss')) {
    out.add(norm.slice(0, -1))
  }
  return [...out]
}

/** Tokenize then expand — the token set used on BOTH query and document sides. */
export function expandedTokens(s: string): string[] {
  const out: string[] = []
  for (const t of tokenize(s)) out.push(...expandToken(t))
  return out
}

/** Count of shared UNIQUE tokens between two token lists. Exported for `matching.ts`. */
export function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let n = 0
  for (const t of new Set(a)) if (setB.has(t)) n++
  return n
}

/** Band 1 (weight 3): process identity — model name + process code. */
function processTokens(d: ArisProcessDigest): string[] {
  const out = expandedTokens(d.modelName)
  if (d.processCode) out.push(...expandedTokens(d.processCode))
  return out
}

/** Band 2 (weight 2): object definition/occurrence names + decision outcome text. */
function stepTokens(d: ArisProcessDigest): string[] {
  const out: string[] = []
  for (const s of d.steps) {
    out.push(...expandedTokens(s.name))
    if (s.nameEn) out.push(...expandedTokens(s.nameEn))
    if (s.nameAr) out.push(...expandedTokens(s.nameAr))
  }
  for (const decision of d.decisions) {
    out.push(...expandedTokens(decision.name))
    if (decision.nameEn) out.push(...expandedTokens(decision.nameEn))
    if (decision.nameAr) out.push(...expandedTokens(decision.nameAr))
    for (const o of decision.outcomes) out.push(...expandedTokens(o.outcome))
  }
  return out
}

/** Band 3 (weight 1): owners/responsibilities, inputs/outputs/systems, triggers, assignments, gaps. */
function metaTokens(d: ArisProcessDigest): string[] {
  const out: string[] = []
  for (const o of d.owners) out.push(...expandedTokens(o))
  for (const t of d.triggers) out.push(...expandedTokens(t))
  for (const s of d.steps) {
    for (const list of [s.responsible, s.inputs, s.outputs, s.systems]) {
      for (const entry of list) out.push(...expandedTokens(entry))
    }
  }
  for (const i of d.inputs) out.push(...expandedTokens(i))
  for (const o of d.outputs) out.push(...expandedTokens(o))
  for (const sys of d.systems) out.push(...expandedTokens(sys))
  for (const a of d.assignments) {
    out.push(...expandedTokens(a.name))
    if (a.nameEn) out.push(...expandedTokens(a.nameEn))
    if (a.nameAr) out.push(...expandedTokens(a.nameAr))
    out.push(...expandedTokens(a.linkedModelId))
  }
  for (const g of d.missingInformation) {
    if (g.stepName) out.push(...expandedTokens(g.stepName))
    if (g.detail) out.push(...expandedTokens(g.detail))
  }
  return out
}

/**
 * Rank digests against a free-text query by weighted token overlap:
 *   3 x process identity + 2 x step/decision names + 1 x metadata band.
 * Returns the top `k` with score > 0, highest first.
 */
export function rankDigests(
  digests: readonly ArisProcessDigest[],
  query: string,
  k = 6
): Array<{ digest: ArisProcessDigest; score: number }> {
  const q = expandedTokens(query)
  if (!q.length) return []
  const scored = digests.map((digest) => {
    const score =
      3 * overlap(q, processTokens(digest)) +
      2 * overlap(q, stepTokens(digest)) +
      1 * overlap(q, metaTokens(digest))
    return { digest, score }
  })
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/**
 * Pick only positively ranked digests. Zero confidence returns an empty
 * list; unrelated "first processes" are never disclosed merely to fill a
 * context budget.
 */
export function selectContextDigests(
  digests: readonly ArisProcessDigest[],
  query: string,
  k = 6
): Array<{ digest: ArisProcessDigest; score: number }> {
  return rankDigests(digests, query, k)
}

/** Compact single-word type label for context lines. */
function shortObjectType(objectType: string): string {
  if (objectType === 'OT_EVT') return 'event'
  if (objectType === 'OT_FUNC') return 'function'
  if (objectType === 'OT_RULE') return 'gateway'
  return objectType.toLowerCase()
}

function stepLine(step: ArisDigestStep, index: number, nameById: Map<string, string>): string {
  let line = `${index}. ${step.name} [${shortObjectType(step.objectType)}]`
  if (step.responsible.length) line += ` — responsible: ${step.responsible.join('; ')}`
  if (step.systems.length) line += ` — system: ${step.systems.join('; ')}`
  if (step.inputs.length) line += ` — inputs: ${step.inputs.join('; ')}`
  if (step.outputs.length) line += ` — outputs: ${step.outputs.join('; ')}`
  if (step.next.length) {
    const parts = step.next.map((n) => {
      const name = nameById.get(n.targetOccurrenceId) ?? n.targetOccurrenceId
      return n.outcome ? `${name} (${n.outcome})` : name
    })
    line += ` -> next: ${parts.join(' | ')}`
  }
  return line
}

/**
 * Render a digest as a plain-text brief: a `## name (path)` header, optional
 * process-code/owners/triggers lines, numbered step lines, decision lines,
 * assignment lines, and a missing-information summary. `maxChars` truncates
 * on WHOLE LINES with a `… (+N more lines)` marker.
 */
export function digestToContext(d: ArisProcessDigest, maxChars?: number): string {
  const nameById = new Map<string, string>()
  for (const s of d.steps) nameById.set(s.occurrenceId, s.name)

  const lines: string[] = []
  lines.push(`## ${d.modelName} (${d.relPath})`)
  if (d.processCode) lines.push(`Process code: ${d.processCode}`)
  if (d.owners.length) lines.push(`Owners: ${d.owners.join('; ')}`)
  if (d.triggers.length) lines.push(`Triggers: ${d.triggers.join('; ')}`)
  d.steps.forEach((step, i) => lines.push(stepLine(step, i + 1, nameById)))
  for (const decision of d.decisions) {
    const outcomes = decision.outcomes.map((o) => `${o.outcome} -> ${o.targetName}`).join(' | ')
    lines.push(`Decision (${decision.gatewayType}): ${decision.name} -> ${outcomes}`)
  }
  for (const a of d.assignments) lines.push(`Assigned model: ${a.name} -> ${a.linkedModelId}`)
  if (d.missingInformation.length) lines.push(`Missing information: ${d.missingInformation.length} issue(s)`)

  if (maxChars === undefined) return lines.join('\n')

  const kept: string[] = []
  let total = 0
  for (const line of lines) {
    const added = (kept.length ? 1 : 0) + line.length
    if (kept.length > 0 && total + added > maxChars) break
    kept.push(line)
    total += added
  }
  const dropped = lines.length - kept.length
  if (dropped > 0) kept.push(`… (+${dropped} more lines)`)
  return kept.join('\n')
}

/** Per-digest character cap applied inside {@link buildContext}. */
export const DIGEST_CHAR_CAP = 2400
/** Overall context budget (all digests + separators). ~3k tokens. */
export const CONTEXT_CHAR_BUDGET = 12000

/**
 * Concatenate ranked digest briefs (rank order) up to a character budget.
 * Each digest is individually capped at {@link DIGEST_CHAR_CAP} characters
 * and the total at `charBudget` ({@link CONTEXT_CHAR_BUDGET} by default).
 * Always includes at least the first digest, even when it alone exceeds the
 * budget. This is the seam Section 17.5 (AI-grounded answers) will consume —
 * see `seamAdapter.ts` for the documented note.
 */
export function buildContext(
  ranked: Array<{ digest: ArisProcessDigest; score: number }>,
  charBudget = CONTEXT_CHAR_BUDGET
): string {
  const parts: string[] = []
  let total = 0
  for (const { digest } of ranked) {
    const ctx = digestToContext(digest, DIGEST_CHAR_CAP)
    if (parts.length === 0) {
      parts.push(ctx)
      total = ctx.length
      continue
    }
    const added = 2 + ctx.length
    if (total + added > charBudget) break
    parts.push(ctx)
    total += added
  }
  return parts.join('\n\n')
}
