// Token-overlap retrieval + context rendering for the OrbitPM Lite assistant.
//
// Deliberately dependency-free and language-agnostic: tokenization keeps any
// Unicode letter or digit (so Arabic ranks alongside Latin), and scoring is a
// transparent weighted overlap the user could reason about. On top of the raw
// surface tokens, matching uses EXPANDED token sets: Arabic orthography is
// normalized (diacritics/tatweel stripped, hamza-carrier alefs unified, ى→ي,
// ة→ه) and definite-article clitics (ال، وال، بال، فال، كال، لل …) are stripped
// as ADDITIONAL variants, so a question about "الموافقة" matches a step named
// "موافقة المدير"; English gets a light plural-s variant the same way. The
// rendered context is a compact plain-text brief handed to the LLM (or shown
// as-is), budget-capped both per digest and overall so a large workspace never
// blows the model's context window.

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

// --- Arabic-aware token normalization + expansion ---------------------------

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g // tashkeel + quranic marks + dagger alef + tatweel (explicit points — a wider literal range would swallow Arabic-Indic digits)

/**
 * Normalize one token for matching: Arabic diacritics/tatweel removed, hamza
 * alef forms (أ إ آ ٱ) unified to ا, ى→ي, ة→ه. Latin tokens pass through
 * (tokenize already lowercased them).
 */
export function normalizeToken(token: string): string {
  return token
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
}

/** Arabic definite-article (and common conjunction+article) clitic prefixes,
 *  longest first so وال strips before ال. */
const AR_CLITIC_PREFIXES = ['وال', 'فال', 'بال', 'كال', 'لل', 'ال']

/**
 * Expand one token into its match variants: the normalized surface form, plus
 * a de-cliticized Arabic form (definite article stripped when ≥ 2 letters
 * remain), plus a singular form for English plural-s tokens (≥ 4 chars). Pure
 * expansion — the surface form is always kept, so precision never drops.
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

/** Count of shared UNIQUE tokens between two token lists. */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let n = 0
  for (const t of new Set(a)) if (setB.has(t)) n++
  return n
}

/** Expanded tokens drawn from step names (incl. bilingual names) across a digest. */
function stepNameTokens(d: ProcessDigest): string[] {
  const out: string[] = []
  for (const s of d.steps) {
    out.push(...expandedTokens(s.name))
    if (s.nameEn) out.push(...expandedTokens(s.nameEn))
    if (s.nameAr) out.push(...expandedTokens(s.nameAr))
  }
  return out
}

/** Expanded tokens from owners + org metadata + notes + trigger — the
 *  lower-weight metadata band. */
function metaTokens(d: ProcessDigest): string[] {
  const out: string[] = []
  if (d.owner) out.push(...expandedTokens(d.owner))
  for (const s of d.steps) {
    if (s.owner) out.push(...expandedTokens(s.owner))
    if (s.ccTo) out.push(...expandedTokens(s.ccTo))
    if (s.decisionBasis) out.push(...expandedTokens(s.decisionBasis))
    for (const list of [s.respList, s.inputs, s.outputs, s.system, s.ccList]) {
      if (list) for (const entry of list) out.push(...expandedTokens(entry))
    }
  }
  for (const note of d.notes) out.push(...expandedTokens(note))
  if (d.trigger) {
    out.push(...expandedTokens(d.trigger.type))
    if (d.trigger.service) out.push(...expandedTokens(d.trigger.service))
    if (d.trigger.detail) out.push(...expandedTokens(d.trigger.detail))
  }
  return out
}

/**
 * Rank digests against a free-text query by weighted token overlap:
 *   3 x processName + 2 x step names + 1 x owners/org-metadata/notes/trigger.
 * Returns the top `k` with score > 0, highest first.
 */
export function rankDigests(
  digests: ProcessDigest[],
  query: string,
  k = 6
): Array<{ digest: ProcessDigest; score: number }> {
  const q = expandedTokens(query)
  if (!q.length) return []
  const scored = digests.map((digest) => {
    const score =
      3 * overlap(q, expandedTokens(digest.processName)) +
      2 * overlap(q, stepNameTokens(digest)) +
      1 * overlap(q, metaTokens(digest))
    return { digest, score }
  })
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** Below this many processes the whole workspace fits comfortably in the
 *  context budget, so retrieval always includes ALL of them. */
export const SMALL_WORKSPACE_ALL = 4

/**
 * Pick the digests to ground the LLM on: the ranked matches first, then — when
 * the workspace is small (≤ {@link SMALL_WORKSPACE_ALL} processes) — every
 * remaining digest in workspace order, and when ranking found NOTHING at all,
 * every digest (capped at `k`). The AI path is therefore never silently
 * skipped just because token overlap came up empty (frequent for short or
 * paraphrased Arabic questions).
 */
export function selectContextDigests(
  digests: ProcessDigest[],
  query: string,
  k = 6
): Array<{ digest: ProcessDigest; score: number }> {
  const ranked = rankDigests(digests, query, k)
  if (digests.length <= SMALL_WORKSPACE_ALL) {
    const seen = new Set(ranked.map((r) => r.digest.relPath))
    const rest = digests
      .filter((d) => !seen.has(d.relPath))
      .map((digest) => ({ digest, score: 0 }))
    return [...ranked, ...rest]
  }
  if (ranked.length === 0) {
    return digests.slice(0, k).map((digest) => ({ digest, score: 0 }))
  }
  return ranked
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

/** Render one step line (number + name + type + org/next suffixes). */
function stepLine(step: DigestStep, index: number, nameById: Map<string, string>): string {
  let line = `${index}. ${step.name} [${shortType(step.type)}]`
  if (step.owner) line += ` — owner: ${step.owner}${step.ownerRole ? ` (${step.ownerRole})` : ''}`
  if (step.respList?.length) line += ` — responsible: ${step.respList.join('; ')}`
  if (step.channel) {
    const label = step.channel === 'dmthub' ? 'DMT Hub' : step.channel
    line += ` — via ${label}${step.channelDetail ? `: ${step.channelDetail}` : ''}`
  }
  if (step.system?.length) line += ` — system: ${step.system.join('; ')}`
  if (step.inputs?.length) line += ` — inputs: ${step.inputs.join('; ')}`
  if (step.outputs?.length) line += ` — outputs: ${step.outputs.join('; ')}`
  // CC recipients: the ccList entries carry per-recipient purposes
  // ("Name — purpose"); the legacy single ccTo string is folded in when no
  // list is stored.
  if (step.ccList?.length) line += ` — CC: ${step.ccList.join(', ')}`
  else if (step.ccTo) line += ` — CC: ${step.ccTo}`
  if (step.decisionBasis) line += ` — decision basis: ${step.decisionBasis}`
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
 * Render a digest as a plain-text brief: a `## name (path)` header, optional
 * process-owner and trigger lines, numbered step lines, `Calls process:` lines,
 * and a `Notes:` block. Target ids in `-> next:` are resolved to step names.
 * `maxChars` (optional) truncates on WHOLE LINES, appending a
 * `… (+N more lines)` marker, so a huge process cannot swallow the entire
 * context budget on its own.
 */
export function digestToContext(d: ProcessDigest, maxChars?: number): string {
  const nameById = new Map<string, string>()
  for (const s of d.steps) nameById.set(s.id, s.name)

  const lines: string[] = []
  lines.push(`## ${d.processName} (${d.relPath})`)
  if (d.owner) lines.push(`Process owner: ${d.owner}`)
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

  if (maxChars === undefined) return lines.join('\n')

  const kept: string[] = []
  let total = 0
  for (const line of lines) {
    const added = (kept.length ? 1 : 0) + line.length // '\n' + body
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
 * Concatenate ranked digest briefs (rank order) up to a character budget,
 * separated by a blank line. Each digest is individually capped at
 * {@link DIGEST_CHAR_CAP} characters (whole-line truncation) and the total at
 * `charBudget` ({@link CONTEXT_CHAR_BUDGET} by default). Always includes at
 * least the first digest, even when it alone exceeds the budget.
 */
export function buildContext(
  ranked: Array<{ digest: ProcessDigest; score: number }>,
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
    const added = 2 + ctx.length // "\n\n" separator + body
    if (total + added > charBudget) break
    parts.push(ctx)
    total += added
  }
  return parts.join('\n\n')
}
