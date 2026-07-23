// Interview mode ("Complete this process") — pure logic.
//
// A freshly generated draft usually carries only what the description stated;
// the interview loop fills the rest conversationally:
//   scan the open diagram for missing org info (reusing the completeness
//   rules that drive the canvas badges) -> ask the model for the next batch of
//   at most MAX_QUESTIONS_PER_ROUND questions (attribute gaps first, then
//   PROCESS-FLOW gaps: missing rejection/else branches, dead ends, unclear
//   sequencing) -> the user answers free-text -> the whole Q&A history is
//   replayed through the shared generation pipeline (generateFromDescription
//   with a message history) -> the regenerated XML replaces the draft -> re-scan.
//
// Everything here is PURE (no React, no bpmn-js imports): the modeler is typed
// structurally exactly like translate.ts / orgModel.ts, so the node-environment
// vitest suite drives it with plain object fakes.

import type { LlmMessage } from '@app/gen'
import { parseJsonLoose } from '@app/gen'
import {
  planMissingInfo,
  isMissingBadgeEligibleType,
  type MissingCategory
} from '../org/orgRenderer'
import {
  getOrgProps,
  getProcessElement,
  splitList,
  type OrgModeler,
  type OrgProps
} from '../org/orgModel'
import type { ProcessDigest } from './digest'

// --- structural modeler shapes (translate.ts convention) ---------------------

export interface InterviewModeler {
  get(name: string): unknown
}

interface BusinessObjectLike {
  $type?: string
  name?: string
  get?: (name: string) => unknown
  $attrs?: Record<string, unknown>
  [key: string]: unknown
}

interface ScanElementLike {
  id?: unknown
  type?: unknown
  businessObject?: BusinessObjectLike
  labelTarget?: unknown
  waypoints?: unknown
  source?: ScanElementLike | null
  target?: ScanElementLike | null
}

interface ElementRegistryLike {
  getAll(): ScanElementLike[]
}

function readName(bo: BusinessObjectLike | undefined): string {
  if (!bo) return ''
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get('name')
      if (typeof value === 'string') return value
    } catch {
      /* fall through */
    }
  }
  return typeof bo.name === 'string' ? bo.name : ''
}

// --- gap scan ----------------------------------------------------------------

/** One element with at least one detected gap. */
export interface GapScanEntry {
  id: string
  label: string
  type: string
  /** Missing key-info categories per the canvas completeness rules. */
  missing: MissingCategory[]
  /** CC recipients recorded WITHOUT a purpose (no '—'/'-' separator). */
  ccMissingPurpose: string[]
}

export interface GapScan {
  entries: GapScanEntry[]
  /** True when no element has any gap — the attribute side is complete. */
  clean: boolean
}

/** True when a ccList line records a recipient WITHOUT a purpose — CC purposes
 *  are per-recipient "Name — purpose" (em-dash or hyphen separator). */
export function ccEntryLacksPurpose(entry: string): boolean {
  return !/[—-]/.test(entry)
}

/**
 * Scan the open diagram for missing information: for every flow-node shape
 * (labels and connections skipped), the canvas completeness categories from
 * planMissingInfo (owner/responsible, inputs, outputs, decision basis,
 * trigger — only on badge-eligible types), PLUS recorded CC recipients that
 * lack a purpose. Elements with no gaps are omitted.
 */
export function scanDiagramGaps(modeler: InterviewModeler): GapScan {
  const registry = modeler.get('elementRegistry') as ElementRegistryLike
  const entries: GapScanEntry[] = []
  for (const element of registry.getAll()) {
    if (element.labelTarget != null || element.waypoints != null) continue
    const type = element.type
    if (typeof type !== 'string' || !type.startsWith('bpmn:')) continue
    const props: OrgProps = getOrgProps(element as { businessObject?: unknown })
    const missing = isMissingBadgeEligibleType(type) ? planMissingInfo(props, type) : []
    const ccMissingPurpose = splitList(props.ccList).filter(ccEntryLacksPurpose)
    if (missing.length === 0 && ccMissingPurpose.length === 0) continue
    const id = typeof element.id === 'string' ? element.id : ''
    const name = readName(element.businessObject).trim()
    entries.push({
      id,
      label: name || id,
      type,
      missing,
      ccMissingPurpose
    })
  }
  return { entries, clean: entries.length === 0 }
}

// --- diagram summary (the IR-ish view the question model reasons over) -------

const MISSING_FIELD_NAMES: Record<MissingCategory, string> = {
  owner: 'responsible party (owner)',
  inputs: 'inputs',
  outputs: 'outputs',
  basis: 'decision basis',
  trigger: 'trigger'
}

function present(parts: string[], label: string, value: string | undefined): void {
  if (value && value.trim()) parts.push(`${label}: ${value.trim()}`)
}

function presentList(parts: string[], label: string, value: string | undefined): void {
  const entries = splitList(value)
  if (entries.length) parts.push(`${label}: ${entries.join('; ')}`)
}

/**
 * Render the open diagram as a compact element list: label, type, recorded org
 * fields, missing fields, and `-> next:` connectivity resolved from the
 * sequence flows (with branch conditions) so the model can ALSO reason about
 * flow gaps (dead ends, missing else branches, unclear ordering).
 */
export function buildDiagramSummary(modeler: InterviewModeler): string {
  const registry = modeler.get('elementRegistry') as ElementRegistryLike
  const all = registry.getAll()

  // Outgoing sequence flows by source id (condition = the flow's name).
  const nextsBySource = new Map<string, Array<{ target: string; condition?: string }>>()
  for (const el of all) {
    if (el.type !== 'bpmn:SequenceFlow') continue
    const sourceId = typeof el.source?.id === 'string' ? el.source.id : ''
    const target = el.target
    if (!sourceId || !target) continue
    const targetName = readName(target.businessObject).trim()
    const targetId = typeof target.id === 'string' ? target.id : ''
    const condition = readName(el.businessObject).trim()
    const list = nextsBySource.get(sourceId) ?? []
    list.push({
      target: targetName || targetId,
      ...(condition ? { condition } : {})
    })
    nextsBySource.set(sourceId, list)
  }

  const lines: string[] = []
  for (const el of all) {
    if (el.labelTarget != null || el.waypoints != null) continue
    const type = el.type
    if (typeof type !== 'string' || !type.startsWith('bpmn:')) continue
    if (type === 'bpmn:Process' || type === 'bpmn:Collaboration' || type === 'bpmn:TextAnnotation')
      continue
    const id = typeof el.id === 'string' ? el.id : ''
    const props = getOrgProps(el as { businessObject?: unknown })
    const label = readName(el.businessObject).trim() || id

    const details: string[] = []
    present(details, 'owner', props.owner)
    presentList(details, 'responsible', props.respList)
    presentList(details, 'inputs', props.inputs)
    presentList(details, 'outputs', props.outputs)
    presentList(details, 'systems', props.system)
    presentList(details, 'CC', props.ccList)
    present(details, 'decision basis', props.decisionBasis)
    present(details, 'trigger', props.trigger)
    present(details, 'trigger service', props.triggerService)

    const missing = isMissingBadgeEligibleType(type) ? planMissingInfo(props, type) : []
    const ccNoPurpose = splitList(props.ccList).filter(ccEntryLacksPurpose)
    const missingParts = missing.map((m) => MISSING_FIELD_NAMES[m])
    if (ccNoPurpose.length) missingParts.push(`CC purpose for: ${ccNoPurpose.join(', ')}`)

    let line = `- "${label}" [${type.slice('bpmn:'.length)}]`
    if (details.length) line += ` — ${details.join(' | ')}`
    if (missingParts.length) line += ` — MISSING: ${missingParts.join('; ')}`
    const nexts = nextsBySource.get(id)
    if (nexts?.length) {
      line += ` -> next: ${nexts
        .map((n) => (n.condition ? `"${n.target}" (${n.condition})` : `"${n.target}"`))
        .join(' | ')}`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

// --- question-batch prompt ---------------------------------------------------

/** Max questions per interview round. */
export const MAX_QUESTIONS_PER_ROUND = 3
/** Max interview rounds (question batches) before the loop stops. */
export const MAX_INTERVIEW_ROUNDS = 8
/** Token budget for the question-batch call. */
export const QUESTIONS_MAX_TOKENS = 700

/** One completed interview exchange: the questions asked and the user's answer. */
export interface InterviewExchange {
  questions: string
  answer: string
}

function renderExchanges(exchanges: InterviewExchange[]): string {
  if (!exchanges.length) return '(none yet)'
  const lines: string[] = []
  for (const ex of exchanges) {
    lines.push(`Assistant asked:\n${ex.questions}`)
    lines.push(`User answered:\n${ex.answer}`)
  }
  return lines.join('\n')
}

function renderGaps(scan: GapScan): string {
  if (scan.clean) return 'none — the recorded details are complete; check the PROCESS FLOW for gaps.'
  const lines: string[] = []
  for (const entry of scan.entries) {
    const parts = entry.missing.map((m) => MISSING_FIELD_NAMES[m])
    if (entry.ccMissingPurpose.length)
      parts.push(`CC purpose for: ${entry.ccMissingPurpose.join(', ')}`)
    lines.push(`- "${entry.label}": ${parts.join('; ')}`)
  }
  return lines.join('\n')
}

/**
 * Build the prompt that asks the model for the NEXT batch of at most
 * {@link MAX_QUESTIONS_PER_ROUND} interview questions. The model sees the
 * original description, the current diagram summary, the detected gaps, and
 * the interview so far; it must ALSO look for process-flow gaps, write the
 * questions in the user's app language, and reply as JSON
 * `{"questions": [...]}` (empty array = nothing important left).
 */
export function buildInterviewQuestionPrompt(args: {
  description: string
  summary: string
  scan: GapScan
  exchanges: InterviewExchange[]
  lang: 'en' | 'ar'
}): string {
  const questionLanguage = args.lang === 'ar' ? 'Arabic' : 'English'
  return [
    'You are helping complete a draft BPMN business process that was generated from the user description below.',
    'Your job in THIS turn: decide what to ask next so the missing information gets filled in.',
    '',
    'Rules:',
    `- Ask AT MOST ${MAX_QUESTIONS_PER_ROUND} questions — only the most important ones next.`,
    '- First priority: the detected missing details listed below (responsible parties, inputs, outputs, decision basis, triggers, CC purposes).',
    '- Second priority: PROCESS-FLOW gaps — a decision with no rejection/else branch, paths that never reach an end state, steps whose order or connection is ambiguous.',
    '- Never re-ask something the user already answered in the interview below.',
    `- Write each question in ${questionLanguage}, concise, one question per line.`,
    '- Respond with ONLY a JSON object of exactly this form: {"questions": ["question 1", "question 2"]} — no other keys, no markdown.',
    '- When nothing important is missing AND the flow has no gaps, respond {"questions": []}.',
    '',
    '# Original description',
    args.description.trim() || '(not recorded)',
    '',
    '# Current process elements',
    args.summary || '(empty diagram)',
    '',
    '# Detected missing details',
    renderGaps(args.scan),
    '',
    '# Interview so far',
    renderExchanges(args.exchanges)
  ].join('\n')
}

// --- question-batch reply parsing -------------------------------------------

/**
 * Parse the model's question-batch reply.
 *   - `{"questions": [...]}` (fenced/prose-wrapped accepted) -> the trimmed
 *     string entries, capped at {@link MAX_QUESTIONS_PER_ROUND}; an empty
 *     array is a VALID "interview complete" verdict.
 *   - A plain-text reply (provider ignored JSON mode) -> its non-empty lines,
 *     list markers stripped, capped the same way.
 *   - Nothing usable -> null (callers treat that as a failed round, NOT as
 *     completion).
 */
export function parseInterviewQuestions(raw: string): string[] | null {
  const takeStrings = (items: unknown[]): string[] =>
    items
      .filter((q): q is string => typeof q === 'string' && q.trim() !== '')
      .map((q) => q.trim())
      .slice(0, MAX_QUESTIONS_PER_ROUND)
  try {
    const parsed = parseJsonLoose(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const questions = (parsed as { questions?: unknown }).questions
      if (Array.isArray(questions)) return takeStrings(questions)
      if (typeof questions === 'string') {
        return takeStrings(questions.split('\n'))
      }
      // Model renamed the key — accept the first array-of-strings value.
      for (const value of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(value) && value.some((v) => typeof v === 'string' && v.trim() !== '')) {
          return takeStrings(value)
        }
      }
      // A JSON object that matched none of the shapes: the model attempted the
      // contract and failed — do NOT fall through to the plain-line reading
      // (its lines would be JSON fragments, not questions).
      return null
    }
    if (Array.isArray(parsed)) {
      const items = takeStrings(parsed)
      if (items.length) return items
    }
  } catch {
    /* fall through to the plain-text reading */
  }
  const lines = raw
    .replace(/```[a-z]*\n?|```/gi, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|[٠-٩]+[.)])\s*/u, '').trim())
    .filter((line) => line.length >= 4)
  return lines.length ? lines.slice(0, MAX_QUESTIONS_PER_ROUND) : null
}

// --- regeneration history + loop decisions ----------------------------------

/**
 * The message history handed to generateFromDescription: the original
 * description as the opening user turn, then every interview exchange as an
 * assistant (questions) + user (answer) pair. The pipeline renders this whole
 * conversation into its create-BPMN prompt, so each regeneration sees the
 * description AND everything the user has clarified since.
 */
export function buildGenerationHistory(
  description: string,
  exchanges: InterviewExchange[]
): LlmMessage[] {
  const out: LlmMessage[] = [
    { role: 'user', content: description.trim() || 'Complete the process below.' }
  ]
  for (const ex of exchanges) {
    out.push({ role: 'assistant', content: ex.questions })
    out.push({ role: 'user', content: ex.answer })
  }
  return out
}

/** The interviewed diagram's own process id (used to keep it OUT of the link
 *  catalog — no self-links). Resolved via orgModel's participants-aware
 *  process-element lookup; '' when unavailable. */
export function readProcessId(modeler: InterviewModeler): string {
  const el = getProcessElement(modeler as unknown as OrgModeler)
  if (!el) return ''
  const maybeElement = el as { id?: unknown; businessObject?: { id?: unknown } }
  const boId = maybeElement.businessObject?.id
  if (typeof boId === 'string' && boId) return boId
  return typeof maybeElement.id === 'string' ? maybeElement.id : ''
}

/** The workspace catalog offered to the pipeline for callActivity linking —
 *  derived from the assistant digests, excluding the process being interviewed
 *  (no self-links) and any digest without a process id. */
export function digestsToCatalog(
  digests: ProcessDigest[],
  excludeProcessId?: string
): Array<{ id: string; name: string }> {
  return digests
    .filter((d) => d.processId && d.processId !== excludeProcessId)
    .map((d) => ({ id: d.processId, name: d.processName }))
}

export type InterviewDecision = 'ask' | 'done'

/**
 * Decide what happens after a scan + question batch:
 *   - the model returned NO questions (scan satisfied + no flow gaps) -> done;
 *   - `round` (1-based, the batch about to be shown) exceeds
 *     {@link MAX_INTERVIEW_ROUNDS} -> done;
 *   - otherwise ask.
 * The Finish button and a missing target stop the loop in the drawer itself.
 */
export function decideInterviewNext(round: number, questions: string[]): InterviewDecision {
  if (questions.length === 0) return 'done'
  if (round > MAX_INTERVIEW_ROUNDS) return 'done'
  return 'ask'
}
