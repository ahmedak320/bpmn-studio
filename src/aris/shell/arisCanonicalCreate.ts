/**
 * Create-from-description through the canonical convention pipeline.
 *
 * The description tab asks the model for one `CanonicalProcessV1` object (steps,
 * decisions, roles, systems, information objects, controls) instead of the flat
 * `ArisAiDraftV1`. `buildConventionAml` then projects it, lays it out with the
 * clean-layout engine, and writes the process-default legend (owner, input and
 * output satellites, branches side by side). The draft path placed every object in
 * one vertical column and had none of those rules.
 *
 * Transport errors propagate to the caller, which reports them as before. A
 * response that does not parse or fails the structural gate gets a bounded number
 * of repair turns; nothing is created unless the final XML is produced.
 */

import type { ArisAiGenerationMessage } from './arisAiGeneration'
import { parseArisAiResponseJson } from './arisAiGeneration'
import { buildConventionAml } from '../headless/amlConvention'

/** Repair turns after the first response, matching the draft path's budget. */
export const MAX_CANONICAL_REPAIR_TURNS = 2

/** Bound on the rejection detail sent back to the model. */
const MAX_DETAIL_CHARS = 1_500

export interface CanonicalCreateSuccess {
  readonly ok: true
  readonly xml: string
  readonly modelCount: number
  readonly objectCount: number
  readonly relationCount: number
  readonly uncertaintyCount: number
  readonly layoutAccepted: boolean
  readonly repairTurns: number
}

export interface CanonicalCreateFailure {
  readonly ok: false
  readonly detail: string
  readonly repairTurns: number
}

export type CanonicalCreateResult = CanonicalCreateSuccess | CanonicalCreateFailure

export interface CanonicalCreateInput {
  readonly system: string
  readonly user: string
  /** One model turn: the full message history in, the raw response text out. */
  readonly send: (messages: readonly ArisAiGenerationMessage[], signal: AbortSignal) => Promise<string>
  readonly signal: AbortSignal
}

function unknownsCount(parsed: unknown): number {
  if (typeof parsed !== 'object' || parsed === null) return 0
  const unknowns = (parsed as { unknowns?: unknown }).unknowns
  return Array.isArray(unknowns) ? unknowns.length : 0
}

function bounded(text: string): string {
  return text.length <= MAX_DETAIL_CHARS ? text : `${text.slice(0, MAX_DETAIL_CHARS)}…`
}

export async function runCanonicalCreate(input: CanonicalCreateInput): Promise<CanonicalCreateResult> {
  let messages: ArisAiGenerationMessage[] = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.user }
  ]
  for (let repairTurns = 0; ; repairTurns += 1) {
    const text = await input.send(messages, input.signal)
    let detail: string
    try {
      const parsed = parseArisAiResponseJson(text)
      const result = await buildConventionAml(parsed)
      if (result.ok) {
        return {
          ok: true,
          xml: result.xml,
          modelCount: result.counts.models,
          objectCount: result.counts.objects,
          relationCount: result.counts.relations,
          uncertaintyCount: unknownsCount(parsed),
          layoutAccepted: result.layoutAccepted,
          repairTurns
        }
      }
      detail = bounded(
        JSON.stringify(result.reason === 'parse' ? result.issues : result.findings)
      )
    } catch (error) {
      detail = bounded(error instanceof Error ? error.message : String(error))
    }
    if (repairTurns >= MAX_CANONICAL_REPAIR_TURNS) {
      return { ok: false, detail, repairTurns }
    }
    messages = [
      ...messages,
      { role: 'assistant', content: bounded(text) },
      {
        role: 'user',
        content: `The JSON was rejected: ${detail}\nReturn the complete corrected CanonicalProcessV1 JSON object only.`
      }
    ]
  }
}
