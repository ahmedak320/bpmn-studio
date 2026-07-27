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
import { UNTRUSTED_WORKSPACE_SYSTEM_GUARD } from '../ai/untrustedPrompt'
import { parseJsonLoose } from './parse'
import { validateBpmn } from './ir/validate'
import { BpmnGenerationIdentityError, generateBpmnXml, type BpmnXmlGenerationOptions } from './xml'
import { layoutBpmnValidated } from './layout'
import type { BpmnElement } from './ir/schema'
import {
  canCreateGenerated,
  getRuntimeValidationAdapters,
  validateBpmnXml,
  type BpmnValidationAdapter,
  type ValidationSummary
} from '../validation'

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
  preLayoutValidation: ValidationSummary
  postLayoutValidation: ValidationSummary
}

export interface GenerateOptions {
  /** Max attempts of the conversational repair loop (default 3). */
  maxRetries?: number
  /**
   * Optional catalog of the workspace's already-documented processes. When
   * provided (non-empty), the prompt gains a section teaching the model to emit
   * callActivity elements linking to these processes; forwarded verbatim to
   * {@link composeCreateBpmn}.
   */
  processCatalog?: Array<{ id: string; name: string }>
  /** Stable document identity supplied by spreadsheet/import/session callers. */
  identity?: BpmnXmlGenerationOptions
  /** Worker-backed XSD and bpmnlint adapters when configured by the app. */
  validationAdapters?: readonly BpmnValidationAdapter[]
  /** Defaults to true for release generation; false is for legacy migration only. */
  requireBilingual?: boolean
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * True for a provider/TRANSPORT-layer failure (auth 401/403, rate-limit 429,
 * CORS/network reject, or a timeout) as opposed to malformed model OUTPUT. The
 * repair loop must NOT retry these: re-sending the request (which, for the PDF
 * path, re-uploads the whole base64 document on every attempt) cannot fix a
 * permanent 401/403/429 or a dead connection, so a transport failure should
 * surface ONCE instead of triggering three identical large requests.
 *
 * Detection is duck-typed on a `transport === true` marker so this module stays
 * provider-agnostic (the browser adapter's `TransportError` sets it; a desktop
 * provider can opt in the same way). Anything without the marker is treated as
 * before — a candidate for the conversational repair loop.
 */
export function isTransportError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { transport?: unknown }).transport === true
  )
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

  const prompt = composeCreateBpmn(messageHistoryToString(baseHistory), options?.processCatalog)
  const messages: LlmMessage[] = [
    { role: 'system', content: UNTRUSTED_WORKSPACE_SYSTEM_GUARD },
    { role: 'user', content: prompt }
  ]

  let attempts = 0
  let lastError: unknown = null
  let process: Record<string, unknown>[] | null = null
  let semanticXml: string | null = null
  let preLayoutValidation: ValidationSummary | null = null
  const validationAdapters = options?.validationAdapters ?? getRuntimeValidationAdapters()

  while (attempts < maxRetries) {
    attempts += 1

    let raw: string | unknown
    try {
      // 6000 (was 3000, the vendored Python's cap): the mandatory bilingual
      // labels + optional org metadata roughly double the IR JSON, and a
      // truncated response would burn the whole repair loop on parse errors.
      raw = await callLLM(messages, { maxTokens: 6000 })
    } catch (e) {
      // A transport/auth/rate-limit/timeout failure is permanent for this call:
      // surface it immediately rather than burning retries (and, for PDFs,
      // re-uploading the document) on something a retry can never fix.
      if (isTransportError(e)) throw e
      lastError = e
      messages.push({ role: 'user', content: `Error: ${errMessage(e)}. Try again.` })
      continue
    }

    try {
      const parsed = typeof raw === 'string' ? parseJsonLoose(raw) : raw
      const proc = extractProcess(parsed)
      validateBpmn(proc)
      const candidateXml = generateBpmnXml(proc, {
        ...options?.identity,
        identitySeed: options?.identity?.identitySeed ?? description,
        existingProcessIds:
          options?.identity?.existingProcessIds ?? options?.processCatalog?.map((entry) => entry.id)
      })
      const candidateValidation = await validateBpmnXml(candidateXml, {
        knownProcessIds: options?.processCatalog?.map((entry) => entry.id),
        requireBilingual: options?.requireBilingual ?? true,
        adapters: validationAdapters,
        requireDi: false
      })
      if (!canCreateGenerated(candidateValidation.summary)) {
        const codes = candidateValidation.summary.issues
          .filter((issue) => issue.blocking)
          .slice(0, 8)
          .map((issue) => issue.code)
          .join(', ')
        throw new Error(`Generated BPMN failed validation: ${codes}`)
      }
      process = proc
      semanticXml = candidateXml
      preLayoutValidation = candidateValidation.summary
      break
    } catch (e) {
      // Identity/collision configuration is caller-owned and cannot be fixed by
      // asking the model to repeat the same process JSON.
      if (e instanceof BpmnGenerationIdentityError) throw e
      lastError = e
      // Surface the model's own output back to it, then the correction request.
      messages.push({
        role: 'assistant',
        content: typeof raw === 'string' ? raw : JSON.stringify(raw)
      })
      messages.push({ role: 'user', content: `Error: ${errMessage(e)}. Try again.` })
    }
  }

  if (!process || !semanticXml || !preLayoutValidation) {
    let message = 'Max number of retries reached. Could not create the BPMN process.'
    if (lastError) {
      message += ` Last error: ${errMessage(lastError)}`
    }
    throw new Error(message)
  }

  const layout = await layoutBpmnValidated(semanticXml, {
    validation: {
      knownProcessIds: options?.processCatalog?.map((entry) => entry.id),
      requireBilingual: options?.requireBilingual ?? true,
      adapters: validationAdapters
    }
  })

  return {
    ir: process as unknown as BpmnElement[],
    semanticXml,
    layoutedXml: layout.xml,
    preLayoutValidation,
    postLayoutValidation: layout.postLayoutValidation
  }
}
