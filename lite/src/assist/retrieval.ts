// Token-overlap retrieval + context rendering for the OrbitPM Lite assistant.
//
// Deliberately dependency-free and language-agnostic: tokenization keeps any
// Unicode letter or digit (so Arabic ranks alongside Latin), and scoring is a
// transparent weighted overlap the user could reason about. The rendered
// context is a compact plain-text brief handed to the LLM (or shown as-is),
// budget-capped so a large workspace never blows the model's context window.

import type { ProcessDigest, DigestStep } from './digest'

/**
 * Lowercase and split a string into tokens on any non-(letter|digit) run,
 * keeping Unicode letters (Arabic included) and dropping tokens shorter than 2
 * characters.
 */
export function tokenize(s: string): string[] {
  if (!s) return []
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
}

/** Count of shared UNIQUE tokens between two token lists. */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let n = 0
  for (const t of new Set(a)) if (setB.has(t)) n++
  return n
}

/** Tokens drawn from step names across a whole digest. */
function stepNameTokens(d: ProcessDigest): string[] {
  const out: string[] = []
  for (const s of d.steps) out.push(...tokenize(s.name))
  return out
}

/** Tokens drawn from owners + notes + trigger — the lower-weight metadata band. */
function metaTokens(d: ProcessDigest): string[] {
  const out: string[] = []
  for (const s of d.steps) if (s.owner) out.push(...tokenize(s.owner))
  for (const note of d.notes) out.push(...tokenize(note))
  if (d.trigger) {
    out.push(...tokenize(d.trigger.type))
    if (d.trigger.service) out.push(...tokenize(d.trigger.service))
    if (d.trigger.detail) out.push(...tokenize(d.trigger.detail))
  }
  return out
}

/**
 * Rank digests against a free-text query by weighted token overlap:
 *   3 x processName + 2 x step names + 1 x owners/notes/trigger.
 * Returns the top `k` with score > 0, highest first.
 */
export function rankDigests(
  digests: ProcessDigest[],
  query: string,
  k = 6
): Array<{ digest: ProcessDigest; score: number }> {
  const q = tokenize(query)
  if (!q.length) return []
  const scored = digests.map((digest) => {
    const score =
      3 * overlap(q, tokenize(digest.processName)) +
      2 * overlap(q, stepNameTokens(digest)) +
      1 * overlap(q, metaTokens(digest))
    return { digest, score }
  })
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** Compact single-word type label for context lines. */
function shortType(type: string): string {
  if (type === 'StartEvent') return 'start'
  if (type === 'EndEvent') return 'end'
  if (type.endsWith('Gateway')) return 'gateway'
  if (type === 'CallActivity') return 'call'
  if (type === 'SubProcess') return 'subprocess'
  if (type.endsWith('Task')) return 'task'
  if (type.endsWith('Event')) return 'event'
  return type.toLowerCase()
}

/** Render one step line (number + name + type + owner/channel/cc/next suffixes). */
function stepLine(step: DigestStep, index: number, nameById: Map<string, string>): string {
  let line = `${index}. ${step.name} [${shortType(step.type)}]`
  if (step.owner) line += ` — owner: ${step.owner}${step.ownerRole ? ` (${step.ownerRole})` : ''}`
  if (step.channel) {
    const label = step.channel === 'dmthub' ? 'DMT Hub' : step.channel
    line += ` — via ${label}${step.channelDetail ? `: ${step.channelDetail}` : ''}`
  }
  if (step.ccTo) line += ` — CC: ${step.ccTo}`
  if (step.nexts.length) {
    const parts = step.nexts.map((n) => {
      const name = nameById.get(n.targetId) ?? n.targetId
      return n.condition ? `${name} (${n.condition})` : name
    })
    line += ` -> next: ${parts.join(' | ')}`
  }
  return line
}

/**
 * Render a digest as a plain-text brief: a `## name (path)` header, an optional
 * trigger line, numbered step lines, `Calls process:` lines, and a `Notes:`
 * block. Target ids in `-> next:` are resolved to step names.
 */
export function digestToContext(d: ProcessDigest): string {
  const nameById = new Map<string, string>()
  for (const s of d.steps) nameById.set(s.id, s.name)

  const lines: string[] = []
  lines.push(`## ${d.processName} (${d.relPath})`)
  if (d.trigger) {
    let t = `Trigger: ${d.trigger.type}`
    if (d.trigger.service) t += ` — service: ${d.trigger.service}`
    if (d.trigger.detail) t += ` (${d.trigger.detail})`
    lines.push(t)
  }
  d.steps.forEach((step, i) => lines.push(stepLine(step, i + 1, nameById)))
  for (const called of d.callsTo) lines.push(`Calls process: ${called}`)
  if (d.notes.length) {
    lines.push('Notes:')
    for (const note of d.notes) lines.push(`- ${note}`)
  }
  return lines.join('\n')
}

/**
 * Concatenate ranked digest briefs (rank order) up to a character budget,
 * separated by a blank line. Always includes at least the first, even when it
 * alone exceeds the budget.
 */
export function buildContext(
  ranked: Array<{ digest: ProcessDigest; score: number }>,
  charBudget = 12000
): string {
  const parts: string[] = []
  let total = 0
  for (const { digest } of ranked) {
    const ctx = digestToContext(digest)
    if (parts.length === 0) {
      parts.push(ctx)
      total = ctx.length
      continue
    }
    const added = 2 + ctx.length // "\n\n" separator + body
    if (total + added > charBudget) break
    parts.push(ctx)
    total += added
  }
  return parts.join('\n\n')
}
