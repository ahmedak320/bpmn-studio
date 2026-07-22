/**
 * Provider-agnostic orchestration of the IR -> BPMN pipeline, ported from the
 * `create_bpmn` flow in `services/bpmn_modeling_service.py`.
 *
 * The provider is injected as a `callLLM` function so later waves (B4/C1) can
 * wire the seven AI-SDK providers (generateObject with the Zod IR schema, or
 * text + loose-parse) without this module depending on any of them. The
 * conversational repair loop is faithful to Python: up to `maxRetries` (3)
 * attempts, and after each failure the next user message is exactly
 * `Error: <e>. Try again.` — with the model's own bad output pushed back into
 * the conversation so it can see and correct its mistake.
 */
import { composeCreateBpmn, messageHistoryToString, type LlmMessage } from './prompts'
import { parseJsonLoose } from './parse'
import { validateBpmn } from './ir/validate'
import { generateBpmnXml } from './xml'
import { layoutBpmn } from './layout'
import type { BpmnElement } from './ir/schema'

export type { LlmMessage } from './prompts'

/**
 * Injected provider call. Receives the running conversation and returns either
 * the raw model text (which is loose-parsed here) or an already-parsed object
 * (e.g. from a schema-constrained `generateObject`).
 */
export type CallLLM = (
  messages: LlmMessage[],
  options: { maxTokens: number }
) => Promise<string | unknown>

export interface GenerateResult {
  /** The validated IR process list. */
  ir: BpmnElement[]
  /** Semantic BPMN 2.0 XML (no DI). */
  semanticXml: string
  /** Semantic XML with auto-layout DI added (ready for bpmn-js importXML). */
  layoutedXml: string
}

export interface GenerateOptions {
  /** Max attempts of the conversational repair loop (default 3). */
  maxRetries?: number
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function extractProcess(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed as Record<string, unknown>[]
  }
  if (parsed !== null && typeof parsed === 'object' && 'process' in parsed) {
    const proc = (parsed as { process: unknown }).process
    if (Array.isArray(proc)) {
      return proc as Record<string, unknown>[]
    }
  }
  throw new Error("Model output is missing the 'process' key")
}

/**
 * Generate a BPMN diagram from a natural-language description.
 *
 * @param callLLM      injected provider call (see {@link CallLLM}).
 * @param description  the process description (used when `history` is omitted).
 * @param history      optional full conversation to base the request on.
 * @param options      loop tuning ({@link GenerateOptions}).
 * @returns the validated IR plus semantic and laid-out XML.
 * @throws if all retries are exhausted without a valid process.
 */
export async function generateFromDescription(
  callLLM: CallLLM,
  description: string,
  history?: LlmMessage[],
  options?: GenerateOptions
): Promise<GenerateResult> {
  const maxRetries = options?.maxRetries ?? 3
  const baseHistory: LlmMessage[] =
    history && history.length > 0 ? history : [{ role: 'user', content: description }]

  const prompt = composeCreateBpmn(messageHistoryToString(baseHistory))
  const messages: LlmMessage[] = [{ role: 'user', content: prompt }]

  let attempts = 0
  let lastError: unknown = null
  let process: Record<string, unknown>[] | null = null

  while (attempts < maxRetries) {
    attempts += 1

    let raw: string | unknown
    try {
      raw = await callLLM(messages, { maxTokens: 3000 })
    } catch (e) {
      lastError = e
      messages.push({ role: 'user', content: `Error: ${errMessage(e)}. Try again.` })
      continue
    }

    try {
      const parsed = typeof raw === 'string' ? parseJsonLoose(raw) : raw
      const proc = extractProcess(parsed)
      validateBpmn(proc)
      process = proc
      break
    } catch (e) {
      lastError = e
      // Surface the model's own output back to it, then the correction request.
      messages.push({
        role: 'assistant',
        content: typeof raw === 'string' ? raw : JSON.stringify(raw)
      })
      messages.push({ role: 'user', content: `Error: ${errMessage(e)}. Try again.` })
    }
  }

  if (!process) {
    let message = 'Max number of retries reached. Could not create the BPMN process.'
    if (lastError) {
      message += ` Last error: ${errMessage(lastError)}`
    }
    throw new Error(message)
  }

  const semanticXml = generateBpmnXml(process)
  const layoutedXml = await layoutBpmn(semanticXml)

  return { ir: process as unknown as BpmnElement[], semanticXml, layoutedXml }
}
