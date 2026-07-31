// Browser-direct AI generation for Lite — RAW FETCH adapters.
//
// Every provider drives the SAME desktop generation pipeline
// (`generateFromDescription(callLLM, …)` + the shared IR/validate/xml/layout
// stages). Only the transport differs: instead of the desktop's Electron-net
// provider registry, Lite issues plain browser `fetch()` calls, one adapter per
// provider, so it can (a) set exactly the headers each provider's CORS policy
// needs (and none that break it — notably Gemini's raw path avoids the
// Api-Revision header that the @google/genai SDK adds), (b) truthfully
// distinguish a CORS block from an auth failure in the Test-connection probe,
// and (c) attach provider-native PDF document parts and IMAGE parts (photos /
// screenshots of process drawings). See providersLite.ts for which providers
// are reachable from a web page and why.
//
// The payload builders + response extractors are exported as pure functions and
// unit-tested (payloadBuilders.test.ts) — no network, no SDK.

import type { BpmnElement, CallLLM, LlmMessage } from '@/generation'
import { defaultLiteModelId, type LiteProviderId } from './providersLite'
import { buildImageInstruction, buildPdfInstruction, type GenAttachment } from './pdf'
import { extractUsage, recordUsage } from './credits'
import {
  isTransientHttpStatus,
  parseRetryAfter,
  withBoundedRetry,
  type RetryAttempt
} from './retry'

export type { LiteProviderId } from './providersLite'

/**
 * One AI-proposed process link, collected from the generated IR: the id of the
 * element that carries the `calledElement` in the emitted XML, its display
 * label, the referenced BPMN process id, and the model's self-reported match
 * confidence. `confidence` defaults to "low" when the model omitted it.
 */
export interface ProposedLink {
  elementId: string
  label: string
  calledProcess: string
  confidence: 'high' | 'low'
}

/**
 * Walk the generated IR and collect every callActivity that carries a non-empty
 * `calledProcess`. Recurses through exclusive/inclusive gateway branch `.path`
 * arrays and parallel gateway branch arrays so a link nested inside any gateway
 * is still surfaced. Pure + exported for unit testing.
 */
export function collectProposedLinks(ir: BpmnElement[]): ProposedLink[] {
  const out: ProposedLink[] = []
  const walk = (elements: BpmnElement[]): void => {
    for (const el of elements) {
      if (el.type === 'callActivity') {
        const called = el.calledProcess
        if (typeof called === 'string' && called.trim() !== '') {
          out.push({
            elementId: el.id,
            label: el.label,
            calledProcess: called,
            confidence: el.confidence ?? 'low'
          })
        }
      } else if (el.type === 'exclusiveGateway' || el.type === 'inclusiveGateway') {
        for (const branch of el.branches) walk(branch.path ?? [])
      } else if (el.type === 'parallelGateway') {
        for (const branch of el.branches) walk(branch ?? [])
      }
    }
  }
  walk(ir)
  return out
}

// --- config + request shapes ----------------------------------------------

export interface ProviderConfig {
  providerId: LiteProviderId
  model: string
  apiKey: string
  /** OpenRouter optional attribution headers. */
  referer?: string
  title?: string
}

export interface BuiltRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface BuildOpts {
  maxTokens: number
  /** Ask the provider for JSON output where it supports a mode flag. */
  jsonMode: boolean
  /** Optional PDF/image attached to the first user turn (provider-native part). */
  attachment?: GenAttachment
  /**
   * Optional enum-locked JSON Schema for `response_format: json_schema`
   * (Wave 8 M5). Honored ONLY by {@link buildOpenRouterRequest} on routes whose
   * endpoint advertises `structured_outputs`. The direct-vendor adapters
   * ({@link buildAnthropicRequest}/{@link buildGeminiRequest}) deliberately
   * IGNORE it — schema-locking those is out of scope this wave, and the zod
   * validator + deterministic normalizer remain the backstop everywhere.
   */
  responseSchema?: { name: string; schema: Record<string, unknown> }
}

/** Error carrying the HTTP status so the classifier can read it. */
export class ProviderHttpError extends Error {
  readonly transport = true as const
  status: number
  retryAfterMs?: number
  providerId?: LiteProviderId
  requestId?: string
  constructor(
    status: number,
    message: string,
    retryAfterMs?: number,
    metadata: { providerId?: LiteProviderId; requestId?: string } = {}
  ) {
    super(message)
    this.name = 'ProviderHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.providerId = metadata.providerId
    this.requestId = metadata.requestId
  }
}

export type ProviderResponseErrorCode = 'invalid-json' | 'invalid-response' | 'empty-response'

/** A readable 2xx provider response that cannot be consumed as model output. */
export class ProviderResponseError extends Error {
  readonly code: ProviderResponseErrorCode
  readonly providerId: LiteProviderId

  constructor(
    code: ProviderResponseErrorCode,
    providerId: LiteProviderId,
    options: { cause?: unknown } = {}
  ) {
    super(`${providerId}: ${code}`, options)
    this.name = 'ProviderResponseError'
    this.code = code
    this.providerId = providerId
  }
}

export type TransportCode = 'auth' | 'rate' | 'network' | 'timeout' | 'cancelled'

/**
 * A provider/TRANSPORT-layer failure — auth (401/403), rate-limit (429), a
 * CORS/network reject, or a timeout — as opposed to malformed model OUTPUT. It
 * carries the duck-typed `transport === true` marker that `src/gen/generate.ts`
 * reads via {@link isTransportError} to STOP the conversational repair loop:
 * retrying a permanent 401/429 (or, for PDFs, re-uploading the whole document)
 * can never help, so the failure surfaces once instead of three times.
 */
export class TransportError extends Error {
  readonly transport = true as const
  code: TransportCode
  status?: number
  retryAfterMs?: number
  providerId?: LiteProviderId
  requestId?: string
  constructor(
    code: TransportCode,
    message: string,
    status?: number,
    retryAfterMs?: number,
    metadata: { providerId?: LiteProviderId; requestId?: string } = {}
  ) {
    super(message)
    this.name = 'TransportError'
    this.code = code
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.providerId = metadata.providerId
    this.requestId = metadata.requestId
  }
}

// Every outbound fetch gets a timeout so a connection that never completes can't
// leave generation/testing busy forever (Codex M10). Generation is allowed to be
// slow (large PDFs, big diagrams); the connectivity probe must feel snappy.
export const GENERATION_TIMEOUT_MS = 180_000
export const TEST_CONNECTION_TIMEOUT_MS = 15_000

/**
 * Generation asks for at most 16,000 output tokens on attachment runs (8,000
 * for text runs) — see ArisGenerationPanel MAX_ATTACHMENT_TOKENS/MAX_TOKENS.
 * One decompressed MiB leaves a very large allowance for JSON syntax and
 * multibyte text (16k tokens ≈ 64–100 KB) while keeping decode + JSON.parse on
 * the main thread bounded below the multi-MiB range that would require a worker.
 */
export const MAX_PROVIDER_RESPONSE_BODY_BYTES = 1_048_576

/**
 * A byte limit alone does not bound the bookkeeping cost of a hostile stream:
 * one MiB can otherwise arrive as a million one-byte chunks, and zero-byte
 * chunks consume no byte budget at all. Normal fetch implementations use much
 * larger chunks, so this ceiling remains deliberately generous.
 */
export const MAX_PROVIDER_RESPONSE_BODY_CHUNKS = 4_096

export class ResponseBodyLimitError extends Error {
  constructor() {
    super('Provider response exceeded the safe body limit.')
    this.name = 'ResponseBodyLimitError'
  }
}

function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown
): void {
  try {
    void reader.cancel(reason).catch(() => undefined)
  } catch {
    /* cancellation is best-effort; the fetch AbortSignal remains authoritative */
  }
}

function cancelUnusedResponseBody(response: Response, reason: unknown): void {
  try {
    void response.body?.cancel(reason).catch(() => undefined)
  } catch {
    /* cancellation is best-effort; no response bytes are consumed */
  }
}

function responseAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function declaredBodyLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (!raw || !/^\d+$/.test(raw.trim())) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Read the FETCH-DECOMPRESSED response stream under an exact byte budget.
 * Content-Length is only an early-rejection optimization: it may describe the
 * compressed transfer, be absent for chunked responses, or simply be false, so
 * every actual chunk is counted as well. The reader is cancelled immediately
 * on an exceeded limit or AbortSignal.
 */
export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (signal.aborted) throw responseAbortReason(signal)
  const declared = declaredBodyLength(response)
  if (declared !== null && declared > maxBytes) {
    const error = new ResponseBodyLimitError()
    cancelUnusedResponseBody(response, error)
    throw error
  }
  if (!response.body) return new Uint8Array()

  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = response.body.getReader()
  } catch {
    if (signal.aborted) throw responseAbortReason(signal)
    throw new TransportError('network', 'The response body could not be opened.')
  }
  const onAbort = (): void => cancelResponseReader(reader, responseAbortReason(signal))
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    if (signal.aborted) {
      onAbort()
      throw responseAbortReason(signal)
    }
    const chunks: Uint8Array[] = []
    let total = 0
    let chunkCount = 0
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch {
        if (signal.aborted) throw responseAbortReason(signal)
        throw new TransportError('network', 'The response body could not be read.')
      }
      if (signal.aborted) throw responseAbortReason(signal)
      const { done, value } = result
      if (done) break
      chunkCount += 1
      if (chunkCount > MAX_PROVIDER_RESPONSE_BODY_CHUNKS) {
        const error = new ResponseBodyLimitError()
        cancelResponseReader(reader, error)
        throw error
      }
      if (total + value.byteLength > maxBytes) {
        const error = new ResponseBodyLimitError()
        cancelResponseReader(reader, error)
        throw error
      }
      if (value.byteLength === 0) continue
      total += value.byteLength
      chunks.push(value)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    signal.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      /* a cancelled reader can retain its lock until cancellation settles */
    }
  }
}

export function parseBoundedJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return JSON.parse(text) as unknown
}

const SAFE_REQUEST_ID_HEADERS = ['request-id', 'x-request-id'] as const
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/

function safeResponseRequestId(response: Response): string | undefined {
  for (const header of SAFE_REQUEST_ID_HEADERS) {
    const value = response.headers.get(header)?.trim()
    if (value && SAFE_REQUEST_ID_RE.test(value)) return value
  }
  return undefined
}

function safeHttpEvidence(error: {
  status?: number
  providerId?: LiteProviderId
  requestId?: string
}): string | undefined {
  if (!Number.isInteger(error.status) || (error.status ?? 0) < 100 || (error.status ?? 0) > 599) {
    return undefined
  }
  const provider = error.providerId ? `${error.providerId}: ` : ''
  const requestId =
    error.requestId && SAFE_REQUEST_ID_RE.test(error.requestId)
      ? `; request-id ${error.requestId}`
      : ''
  return `${provider}HTTP ${error.status}${requestId}`
}

/** Map a raw fetch rejection to a TransportError (already-typed ones pass through). */
function toTransportError(error: unknown): TransportError {
  try {
    if (error instanceof TransportError) return error
  } catch {
    /* a hostile Proxy can throw while instanceof walks its prototype chain */
  }
  const propertyMessage = safeDiagnosticProperty(error, 'message')
  const rawMessage =
    typeof propertyMessage === 'string' ? propertyMessage : safeDiagnosticString(error)
  const msg =
    boundedDiagnosticText(rawMessage, MAX_AI_ERROR_CLASSIFICATION_CODE_POINTS) ||
    'The network request failed.'
  return new TransportError('network', msg)
}

/**
 * `fetch` with an AbortSignal timeout that COVERS THE BODY. The caller supplies
 * a `consume(res)` that reads the response (status + body); the timer stays armed
 * through it, so a server that sends headers then STALLS THE BODY still aborts
 * (Codex ORIG-10 — the old version cleared the timer once headers arrived, so a
 * hung full-body read could block generation forever). On our timeout
 * it rejects with TransportError(code:'timeout'); a fetch-level rejection
 * (CORS/offline/DNS) becomes TransportError(code:'network'); errors thrown by
 * `consume` (HTTP status, empty body, JSON parse) keep their own type so the
 * repair loop's retry classification is unchanged. The timer is always cleared.
 */
async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (res: Response, signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal
): Promise<T> {
  const ctrl = new AbortController()
  let timedOut = false
  let callerAborted = false
  const onCallerAbort = (): void => {
    callerAborted = true
    ctrl.abort()
  }
  if (callerSignal?.aborted) {
    throw new TransportError('cancelled', 'The request was cancelled.')
  }
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)
  const timeoutError = (): TransportError =>
    new TransportError('timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s`)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal })
  } catch (error) {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
    if (timedOut) throw timeoutError()
    if (callerAborted) throw new TransportError('cancelled', 'The request was cancelled.')
    throw toTransportError(error)
  }
  try {
    // Body read runs under the SAME deadline — the timer is cleared only AFTER
    // the body is fully consumed.
    return await consume(res, ctrl.signal)
  } catch (error) {
    if (timedOut) throw timeoutError()
    if (callerAborted) throw new TransportError('cancelled', 'The request was cancelled.')
    throw error
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

function firstUserIndex(messages: LlmMessage[]): number {
  return messages.findIndex((m) => m.role === 'user')
}

// --- OpenAI-shaped message conversion (OpenRouter) -------------------------

interface OpenAiTextPart {
  type: 'text'
  text: string
}
interface OpenAiFilePart {
  type: 'file'
  file: { filename: string; file_data: string }
}
interface OpenAiImagePart {
  type: 'image_url'
  image_url: { url: string }
}
interface OpenAiMessage {
  role: string
  content: string | Array<OpenAiTextPart | OpenAiFilePart | OpenAiImagePart>
}

function toOpenAiMessages(messages: LlmMessage[], attachment?: GenAttachment): OpenAiMessage[] {
  const attachAt = attachment ? firstUserIndex(messages) : -1
  return messages.map((m, i): OpenAiMessage => {
    if (i === attachAt && attachment) {
      // Text part FIRST, then the attachment part — OpenRouter's documented
      // recommendation for image inputs ("send the text prompt first, then the
      // images") and the existing behavior for PDF file parts. Images ride as
      // an `image_url` part with a base64 data-URL (verified 2026-07-23,
      // openrouter.ai/docs/guides/overview/multimodal/image-understanding);
      // PDFs keep the `file` part consumed by the file-parser plugin.
      const part: OpenAiFilePart | OpenAiImagePart =
        attachment.kind === 'image'
          ? {
              type: 'image_url',
              image_url: { url: `data:${attachment.mediaType};base64,${attachment.base64}` }
            }
          : {
              type: 'file',
              file: {
                filename: attachment.fileName,
                file_data: `data:${attachment.mediaType};base64,${attachment.base64}`
              }
            }
      return {
        role: 'user',
        content: [{ type: 'text', text: m.content }, part]
      }
    }
    return { role: m.role, content: m.content }
  })
}

// --- per-provider payload builders (pure) ----------------------------------

export function buildAnthropicRequest(
  cfg: ProviderConfig,
  messages: LlmMessage[],
  opts: BuildOpts
): BuiltRequest {
  const systemParts: string[] = []
  const chat: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = []
  const attachAt = opts.attachment ? firstUserIndex(messages) : -1
  messages.forEach((m, i) => {
    if (m.role === 'system') {
      systemParts.push(m.content)
      return
    }
    const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user'
    const parts: unknown[] = []
    if (i === attachAt && opts.attachment) {
      // Attachment block goes BEFORE the text — Anthropic's documented ordering
      // for documents AND images ("Claude works best when images come before
      // text"; verified 2026-07-23, platform.claude.com/docs/en/build-with-claude/
      // vision). A PDF is a `document` block, an image an `image` block; both
      // use the same base64 source shape.
      parts.push({
        type: opts.attachment.kind === 'image' ? 'image' : 'document',
        source: {
          type: 'base64',
          media_type: opts.attachment.mediaType,
          data: opts.attachment.base64
        }
      })
    }
    parts.push({ type: 'text', text: m.content })
    chat.push({ role, content: parts })
  })
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: opts.maxTokens,
    messages: chat
  }
  if (systemParts.length) body.system = systemParts.join('\n\n')
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      // REQUIRED for browser CORS; the user opted in by pasting a key into a web
      // page (Settings shows the unencrypted-storage warning).
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    },
    body
  }
}

export function buildGeminiRequest(
  cfg: ProviderConfig,
  messages: LlmMessage[],
  opts: BuildOpts
): BuiltRequest {
  const systemParts: string[] = []
  const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = []
  const attachAt = opts.attachment ? firstUserIndex(messages) : -1
  messages.forEach((m, i) => {
    if (m.role === 'system') {
      systemParts.push(m.content)
      return
    }
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user'
    const parts: unknown[] = [{ text: m.content }]
    if (i === attachAt && opts.attachment) {
      // One `inlineData` part carries EITHER mime — application/pdf or an
      // image/* type — with the same {mimeType, data} shape (verified
      // 2026-07-23, ai.google.dev/gemini-api/docs/image-understanding).
      parts.push({
        inlineData: { mimeType: opts.attachment.mediaType, data: opts.attachment.base64 }
      })
    }
    contents.push({ role, parts })
  })
  const generationConfig: Record<string, unknown> = { maxOutputTokens: opts.maxTokens }
  if (opts.jsonMode) generationConfig.responseMimeType = 'application/json'
  const body: Record<string, unknown> = { contents, generationConfig }
  if (systemParts.length) {
    body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] }
  }
  return {
    // Raw generateContent; key in the header (kept out of the URL). Field names
    // are camelCase — accepted by proto-JSON alongside snake_case.
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      cfg.model
    )}:generateContent`,
    headers: {
      'x-goog-api-key': cfg.apiKey,
      'content-type': 'application/json'
    },
    body
  }
}

export function buildOpenRouterRequest(
  cfg: ProviderConfig,
  messages: LlmMessage[],
  opts: BuildOpts
): BuiltRequest {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: toOpenAiMessages(messages, opts.attachment),
    max_tokens: opts.maxTokens,
    // Enforce both documented OpenRouter privacy controls per request. If no
    // endpoint for the model satisfies them, OpenRouter rejects the request
    // instead of silently routing workspace content to a retaining provider.
    provider: {
      zdr: true,
      data_collection: 'deny'
    },
    // OpenRouter accounting: return the authoritative `usage.cost` (read by
    // credits.ts extractUsage) so cost is measured, not just estimated (M5/M8).
    usage: { include: true }
  }
  // An enum-locked json_schema (M5) makes invented codes like CT_FLOW
  // unrepresentable on schema-enforcing routes; plain json_object is the
  // fallback for every other route. OpenRouter silently drops an unsupported
  // param on some endpoints, so the zod validator + normalizer still run.
  if (opts.responseSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: opts.responseSchema.name,
        strict: true,
        schema: opts.responseSchema.schema
      }
    }
  } else if (opts.jsonMode) {
    body.response_format = { type: 'json_object' }
  }
  if (opts.attachment?.kind === 'pdf') {
    // Attach the file-parser plugin — for PDF `file` parts ONLY. Images are
    // native to chat/completions (no plugin; verified 2026-07-23, OpenRouter
    // image-understanding docs). And DO NOT pin `pdf.engine`: forcing 'native'
    // only works for models with native file input; the default model
    // (z-ai/glm-5.2) is text-input-only, so pinning 'native' broke its PDF path.
    // Omitting the engine lets OpenRouter pick per model capability — native
    // pass-through for Claude/Gemini, its OCR/text fallback for the rest.
    body.plugins = [{ id: 'file-parser' }]
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${cfg.apiKey}`,
    'content-type': 'application/json'
  }
  if (cfg.referer) headers['HTTP-Referer'] = cfg.referer
  if (cfg.title) headers['X-Title'] = cfg.title
  return { url: 'https://openrouter.ai/api/v1/chat/completions', headers, body }
}

export function buildRequest(
  cfg: ProviderConfig,
  messages: LlmMessage[],
  opts: BuildOpts
): BuiltRequest {
  switch (cfg.providerId) {
    case 'anthropic':
      return buildAnthropicRequest(cfg, messages, opts)
    case 'gemini':
      return buildGeminiRequest(cfg, messages, opts)
    case 'openrouter':
      return buildOpenRouterRequest(cfg, messages, opts)
  }
}

// --- response text extraction (pure) ---------------------------------------

/**
 * Response extraction is deliberately shallow and budgeted. Provider JSON is
 * untrusted even after a 2xx: walking or joining an attacker-controlled number
 * of content blocks can otherwise monopolize the UI thread, while embedding
 * the rejected payload in an error can expose model/workspace content. These
 * ceilings are far above a normal JSON-mode generation response.
 */
export const MAX_PROVIDER_RESPONSE_ITEMS = 2_048
export const MAX_PROVIDER_RESPONSE_TEXT_CHARS = 1_000_000

interface ResponseShapeBudget {
  items: number
  textChars: number
}

function invalidProviderResponse(providerId: LiteProviderId): never {
  throw new ProviderResponseError('invalid-response', providerId)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function consumeResponseItems(
  providerId: LiteProviderId,
  budget: ResponseShapeBudget,
  count: number
): void {
  budget.items += count
  if (budget.items > MAX_PROVIDER_RESPONSE_ITEMS) invalidProviderResponse(providerId)
}

function consumeResponseText(
  providerId: LiteProviderId,
  budget: ResponseShapeBudget,
  text: string
): void {
  budget.textChars += text.length
  if (budget.textChars > MAX_PROVIDER_RESPONSE_TEXT_CHARS) invalidProviderResponse(providerId)
}

function extractAnthropicText(
  providerId: LiteProviderId,
  data: Record<string, unknown>,
  budget: ResponseShapeBudget
): string {
  if (!Array.isArray(data.content)) invalidProviderResponse(providerId)
  consumeResponseItems(providerId, budget, data.content.length)

  const text: string[] = []
  for (const part of data.content) {
    if (!isJsonObject(part)) invalidProviderResponse(providerId)
    if (part.type === 'text') {
      if (typeof part.text !== 'string') invalidProviderResponse(providerId)
      consumeResponseText(providerId, budget, part.text)
      text.push(part.text)
      continue
    }
    if (part.type === 'thinking') {
      if (typeof part.thinking !== 'string' || typeof part.signature !== 'string') {
        invalidProviderResponse(providerId)
      }
      // Adaptive thinking is a documented non-text response block. Validate
      // and budget both opaque fields, but select only text as model output.
      consumeResponseText(providerId, budget, part.thinking)
      consumeResponseText(providerId, budget, part.signature)
      continue
    }
    if (part.type === 'redacted_thinking') {
      if (typeof part.data !== 'string') invalidProviderResponse(providerId)
      consumeResponseText(providerId, budget, part.data)
      continue
    }
    invalidProviderResponse(providerId)
  }
  return text.join('')
}

function extractGeminiText(
  providerId: LiteProviderId,
  data: Record<string, unknown>,
  budget: ResponseShapeBudget
): string {
  if (!Array.isArray(data.candidates)) invalidProviderResponse(providerId)
  consumeResponseItems(providerId, budget, data.candidates.length)

  let selected = ''
  for (let candidateIndex = 0; candidateIndex < data.candidates.length; candidateIndex += 1) {
    const candidate = data.candidates[candidateIndex]
    if (!isJsonObject(candidate) || !isJsonObject(candidate.content)) {
      invalidProviderResponse(providerId)
    }
    const parts = candidate.content.parts
    if (!Array.isArray(parts)) invalidProviderResponse(providerId)
    consumeResponseItems(providerId, budget, parts.length)

    const text: string[] = []
    for (const part of parts) {
      if (!isJsonObject(part) || typeof part.text !== 'string') {
        invalidProviderResponse(providerId)
      }
      consumeResponseText(providerId, budget, part.text)
      text.push(part.text)
    }
    if (candidateIndex === 0) selected = text.join('')
  }
  return selected
}

function extractOpenRouterContent(
  providerId: LiteProviderId,
  content: unknown,
  budget: ResponseShapeBudget
): string {
  if (typeof content === 'string') {
    consumeResponseText(providerId, budget, content)
    return content
  }
  if (!Array.isArray(content)) invalidProviderResponse(providerId)
  consumeResponseItems(providerId, budget, content.length)

  const text: string[] = []
  for (const part of content) {
    if (!isJsonObject(part) || typeof part.text !== 'string') {
      invalidProviderResponse(providerId)
    }
    consumeResponseText(providerId, budget, part.text)
    text.push(part.text)
  }
  return text.join('')
}

function extractOpenRouterText(
  providerId: LiteProviderId,
  data: Record<string, unknown>,
  budget: ResponseShapeBudget
): string {
  if (!Array.isArray(data.choices)) invalidProviderResponse(providerId)
  consumeResponseItems(providerId, budget, data.choices.length)

  let selected = ''
  for (let choiceIndex = 0; choiceIndex < data.choices.length; choiceIndex += 1) {
    const choice = data.choices[choiceIndex]
    if (!isJsonObject(choice) || !isJsonObject(choice.message)) {
      invalidProviderResponse(providerId)
    }
    const text = extractOpenRouterContent(providerId, choice.message.content, budget)
    if (choiceIndex === 0) selected = text
  }
  return selected
}

export function extractText(providerId: LiteProviderId, data: unknown): string {
  if (!isJsonObject(data)) invalidProviderResponse(providerId)
  const budget: ResponseShapeBudget = { items: 0, textChars: 0 }
  if (providerId === 'anthropic') return extractAnthropicText(providerId, data, budget)
  if (providerId === 'gemini') return extractGeminiText(providerId, data, budget)
  // OpenRouter uses the OpenAI-compatible response shape.
  return extractOpenRouterText(providerId, data, budget)
}

/**
 * Account for one physical request after the provider has returned an accepted
 * 2xx status. A malformed, truncated, cancelled, or otherwise unusable 2xx body
 * can still be billable, so missing/invalid counters count as an unknown-cost
 * request instead of making that attempt disappear from the ledger.
 */
function recordAcceptedAiRequest(cfg: ProviderConfig, responseJson?: unknown): void {
  try {
    const usage = extractUsage(cfg.providerId, responseJson)
    recordUsage(
      cfg.providerId,
      usage
        ? { ...usage, modelId: cfg.model }
        : {
            inputTokens: 0,
            outputTokens: 0,
            usageKnown: false,
            modelId: cfg.model
          }
    )
  } catch {
    /* usage accounting is best-effort only */
  }
}

// --- the CallLLM adapter ----------------------------------------------------

/**
 * A pipeline-shaped CallLLM bound to one provider/model/key: builds the
 * provider request (JSON mode on), POSTs it, and returns the model's raw text
 * for the pipeline to loose-parse + validate + repair. An optional PDF/image is
 * attached to the first user turn as a provider-native part.
 */
export function makeBrowserCallLLM(
  cfg: ProviderConfig,
  extra?: {
    attachment?: GenAttachment
    signal?: AbortSignal
    onAttempt?: (attempt: RetryAttempt) => void
    /** Enum-locked json_schema for structured-output routes (Wave 8 M5). Sent
     * on EVERY attempt — the draft shape is identical on a repair turn. */
    responseSchema?: { name: string; schema: Record<string, unknown> }
  }
): CallLLM {
  let attachmentAvailable = extra?.attachment
  return async (messages: LlmMessage[], { maxTokens }: { maxTokens: number }) => {
    // A large attachment is included only in the first model turn. If semantic
    // repair needs another turn, the conversation carries the prior output and
    // validation feedback without silently uploading the same bytes again.
    const attachment = attachmentAvailable
    attachmentAvailable = undefined
    const req = buildRequest(cfg, messages, {
      maxTokens,
      jsonMode: true,
      attachment,
      ...(extra?.responseSchema ? { responseSchema: extra.responseSchema } : {})
    })
    return withBoundedRetry(
      async () =>
        fetchWithTimeout(
          req.url,
          { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) },
          GENERATION_TIMEOUT_MS,
          async (res, signal) => {
            if (!res.ok) {
              const requestId = safeResponseRequestId(res)
              const metadata = { providerId: cfg.providerId, requestId }
              const message =
                safeHttpEvidence({ status: res.status, ...metadata }) ??
                `${cfg.providerId}: provider request failed`
              const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
              let failure: ProviderHttpError | TransportError
              if (res.status === 401 || res.status === 403) {
                failure = new TransportError('auth', message, res.status, undefined, metadata)
              } else if (res.status === 429) {
                failure = new TransportError('rate', message, res.status, retryAfterMs, metadata)
              } else {
                failure = new ProviderHttpError(res.status, message, retryAfterMs, metadata)
              }
              // The status is already authoritative. Never wait for a permanent
              // error body that can echo private data or stall long enough to
              // turn a known 4xx into a retried timeout.
              cancelUnusedResponseBody(res, failure)
              throw failure
            }

            let data: unknown
            try {
              let body: Uint8Array
              try {
                body = await readBoundedResponseBody(res, MAX_PROVIDER_RESPONSE_BODY_BYTES, signal)
              } catch (error) {
                if (error instanceof ResponseBodyLimitError) {
                  throw new ProviderResponseError('invalid-response', cfg.providerId, {
                    cause: error
                  })
                }
                throw error
              }

              try {
                data = parseBoundedJson(body)
              } catch (error) {
                throw new ProviderResponseError('invalid-json', cfg.providerId, { cause: error })
              }
              const text = extractText(cfg.providerId, data)
              if (!text.trim()) {
                throw new ProviderResponseError('empty-response', cfg.providerId)
              }
              return text
            } finally {
              recordAcceptedAiRequest(cfg, data)
            }
          },
          extra?.signal
        ),
      {
        // Do not silently resend a large attachment. The user may explicitly
        // retry after seeing the failure; text-only calls receive three tries.
        maxAttempts: attachment ? 1 : 3,
        signal: extra?.signal,
        shouldRetry: (error) =>
          (error instanceof ProviderHttpError && isTransientHttpStatus(error.status)) ||
          (error instanceof TransportError &&
            (error.code === 'network' || error.code === 'timeout' || error.code === 'rate')),
        retryAfterMs: (error) =>
          error instanceof ProviderHttpError || error instanceof TransportError
            ? error.retryAfterMs
            : undefined,
        onAttempt: extra?.onAttempt
      }
    )
  }
}

// --- public generation entry points ----------------------------------------

export interface GenerateArgs {
  description: string
  providerId: LiteProviderId
  modelId: string
  apiKey: string
  signal?: AbortSignal
  onAttempt?: (attempt: RetryAttempt) => void
  /** Workspace processes offered to the model for callActivity linking. */
  processCatalog?: Array<{ id: string; name: string }>
}

/** A generation result: the laid-out XML plus the links the model proposed. */
export interface GenerateOutput {
  xml: string
  links: ProposedLink[]
}

async function loadGenerateFromDescription(): Promise<
  (typeof import('@/generation'))['generateFromDescription']
> {
  return (await import('@/generation')).generateFromDescription
}

function toConfig(args: GenerateArgs): ProviderConfig {
  return {
    providerId: args.providerId,
    model: args.modelId,
    apiKey: args.apiKey,
    referer: typeof location !== 'undefined' ? location.origin : undefined,
    title: 'OrbitPM Process Studio Lite'
  }
}

/** Generate a laid-out BPMN 2.0 XML string (+ proposed links) from a text description. */
export async function generateDiagramXml(args: GenerateArgs): Promise<GenerateOutput> {
  const call = makeBrowserCallLLM(toConfig(args), {
    signal: args.signal,
    onAttempt: args.onAttempt
  })
  const generateFromDescription = await loadGenerateFromDescription()
  const result = await generateFromDescription(call, args.description, undefined, {
    processCatalog: args.processCatalog
  })
  return { xml: result.layoutedXml, links: collectProposedLinks(result.ir) }
}

export interface GenerateDocumentArgs extends GenerateArgs {
  attachment: GenAttachment
  hint: string
}

/** Back-compat alias — the pre-image name for {@link GenerateDocumentArgs}. */
export type GeneratePdfArgs = GenerateDocumentArgs

/**
 * Generate a laid-out BPMN 2.0 XML (+ proposed links) from an attached document
 * — a PDF or an image of a process drawing — plus an optional (Arabic-safe)
 * hint. The attachment's `kind` picks the instruction: buildPdfInstruction for
 * documents, buildImageInstruction for drawings; the bytes ride along as a
 * provider-native part either way.
 */
export async function generateDiagramXmlFromDocument(
  args: GenerateDocumentArgs
): Promise<GenerateOutput> {
  const instruction =
    args.attachment.kind === 'image'
      ? buildImageInstruction(args.hint)
      : buildPdfInstruction(args.hint)
  const call = makeBrowserCallLLM(toConfig(args), {
    attachment: args.attachment,
    signal: args.signal,
    onAttempt: args.onAttempt
  })
  const generateFromDescription = await loadGenerateFromDescription()
  const result = await generateFromDescription(call, instruction, undefined, {
    processCatalog: args.processCatalog
  })
  return { xml: result.layoutedXml, links: collectProposedLinks(result.ir) }
}

/** Back-compat alias — the pre-image name for {@link generateDiagramXmlFromDocument}. */
export const generateDiagramXmlFromPdf = generateDiagramXmlFromDocument

// --- Test connection: CORS-vs-auth discriminator ---------------------------

const DUMMY_PROBE_KEY = 'orbitpm-cors-probe-key'

/**
 * Stable verdict code so the UI can render the message from the i18n dictionary
 * (RTL-safe) instead of the English `message` below (which is kept for tests and
 * as a fallback). `reachable-other` covers 400/404/429/5xx — all "the browser
 * COULD read a response, so CORS is open" — with the status interpolated.
 */
export type TestVerdictCode =
  'reachable-ok' | 'reachable-auth' | 'reachable-other' | 'blocked' | 'timeout'

export interface TestConnectionResult {
  /** True when the browser could read ANY HTTP response (⇒ CORS is open). */
  reachable: boolean
  /** True when fetch() threw a reject the browser could not read past (NOT a
   *  timeout). Renamed from `corsBlocked` because such a reject is equally a
   *  CORS block, an offline state, a DNS/TLS failure or an unreachable host — the
   *  flag no longer overclaims "CORS" (Codex ORIG-14). */
  blockedOrUnreachable: boolean
  status?: number
  /** Machine-readable verdict for i18n rendering. */
  code: TestVerdictCode
  /** English fallback / test-facing message. */
  message: string
}

export interface TestConnectionReview {
  providerId: LiteProviderId
  modelId: string
  /** The probe always performs one physical inference request. */
  requestCount: 1
  mayBeBillable: true
  /** Exact provider body; credentials live only in headers/the Gemini URL. */
  payload: Record<string, unknown>
}

function fallbackProbeModel(providerId: LiteProviderId): string {
  const d = defaultLiteModelId(providerId)
  if (d) return d
  return providerId === 'openrouter' ? 'z-ai/glm-5.2' : 'probe'
}

const TEST_CONNECTION_MESSAGES: LlmMessage[] = [{ role: 'user', content: 'ping' }]
const TEST_CONNECTION_BUILD_OPTS: BuildOpts = {
  maxTokens: 1,
  jsonMode: false
}

function buildTestConnectionRequest(cfg: ProviderConfig): {
  cfg: ProviderConfig
  request: BuiltRequest
} {
  const probeCfg: ProviderConfig = {
    ...cfg,
    apiKey: cfg.apiKey || DUMMY_PROBE_KEY,
    model: cfg.model || fallbackProbeModel(cfg.providerId)
  }
  return {
    cfg: probeCfg,
    request: buildRequest(probeCfg, TEST_CONNECTION_MESSAGES, TEST_CONNECTION_BUILD_OPTS)
  }
}

/**
 * Exact, credential-free review data for the probe that testConnection sends.
 * The UI renders this before enabling consent, and both paths share the same
 * request builder/constants so the reviewed payload cannot drift from the
 * executed one.
 */
export function buildTestConnectionReview(cfg: ProviderConfig): TestConnectionReview {
  const built = buildTestConnectionRequest(cfg)
  return {
    providerId: built.cfg.providerId,
    modelId: built.cfg.model,
    requestCount: 1,
    mayBeBillable: true,
    payload: built.request.body
  }
}

function interpretProbe(status: number): TestConnectionResult {
  const base = { reachable: true, blockedOrUnreachable: false, status }
  if (status >= 200 && status < 300) {
    return {
      ...base,
      code: 'reachable-ok',
      message: `Reachable — request accepted (HTTP ${status}). Your key works.`
    }
  }
  if (status === 401 || status === 403) {
    return {
      ...base,
      code: 'reachable-auth',
      message: `Reachable (CORS OK) — the provider rejected the key (HTTP ${status}). Expected for a keyless test; enter a valid key to use it.`
    }
  }
  return {
    ...base,
    code: 'reachable-other',
    message: `Reachable (CORS OK) — HTTP ${status}. The endpoint is callable from the browser.`
  }
}

/**
 * Probe a provider from the browser to tell CORS from auth truthfully:
 *  - fetch() RESOLVES with any status (even 401/400) ⇒ the browser could read a
 *    response ⇒ **CORS is OPEN** (report "reachable — key invalid" for a 401).
 *  - fetch() REJECTS ⇒ the browser could not read a response. We do NOT claim
 *    that is definitely CORS: a rejection is equally a DNS failure, offline
 *    state, TLS error, or an unreachable host, so the verdict says "blocked or
 *    unreachable (CORS, offline, or DNS)". A timeout is reported distinctly.
 * Uses a dummy key when none is stored, so connectivity can be verified without
 * a key (this is also the e2e's key-free way to prove the providers are live).
 */
export async function testConnection(
  cfg: ProviderConfig,
  callerSignal?: AbortSignal
): Promise<TestConnectionResult> {
  const { cfg: probeCfg, request: req } = buildTestConnectionRequest(cfg)
  let status: number
  try {
    // The probe only needs the status (CORS-open ⇔ any readable response); it
    // deliberately does not read the body.
    status = await fetchWithTimeout(
      req.url,
      { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) },
      TEST_CONNECTION_TIMEOUT_MS,
      async (res, signal) => {
        // The probe needs only the readable status. Cancel the potentially
        // billable inference body immediately instead of leaving a background
        // stream alive after this function returns.
        cancelUnusedResponseBody(
          res,
          new DOMException('The connection probe does not consume response content.', 'AbortError')
        )
        // A 2xx probe was accepted by the provider and can be billable even
        // though this connectivity check deliberately does not consume the
        // body. Count it with unknown token/cost detail.
        if (res.ok) recordAcceptedAiRequest(probeCfg)
        if (signal.aborted) throw responseAbortReason(signal)
        return res.status
      },
      callerSignal
    )
  } catch (error) {
    if (error instanceof TransportError && error.code === 'cancelled') throw error
    if (error instanceof TransportError && error.code === 'timeout') {
      return {
        reachable: false,
        blockedOrUnreachable: false,
        code: 'timeout',
        message: 'The connection timed out. Check your network and try again.'
      }
    }
    return {
      reachable: false,
      blockedOrUnreachable: true,
      code: 'blocked',
      message:
        'Blocked or unreachable (CORS, offline, or DNS) — the browser could not read any response. ' +
        'Try OpenRouter, Anthropic, or Gemini and verify your browser network settings.'
    }
  }
  return interpretProbe(status)
}

// --- compact error classifier (browser cases) ------------------------------

/** Machine-readable error class so the UI can render an i18n (RTL-safe) message. */
export type ErrorCode =
  | 'auth'
  | 'rate'
  | 'cors'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'provider'
  | 'invalid-response'
  | 'unknown'

export interface ClassifiedError {
  /** Stable code for i18n rendering. */
  code: ErrorCode
  /** English compatibility fallback. User interfaces must localize from `code`. */
  message: string
  offline: boolean
  /** Bounded support evidence. Render only as explicitly labelled technical text. */
  technicalDetail?: string
}

export const MAX_AI_TECHNICAL_DETAIL_CODE_POINTS = 200
const MAX_AI_ERROR_CLASSIFICATION_CODE_POINTS = 4_096

function safeDiagnosticProperty(value: unknown, property: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined
  }
  try {
    return Reflect.get(value, property)
  } catch {
    return undefined
  }
}

function safeDiagnosticString(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return String(value)
  } catch {
    return ''
  }
}

function unsafeDiagnosticCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  )
}

function boundedDiagnosticText(raw: string, maxCodePoints: number, firstLineOnly = false): string {
  const characters: string[] = []
  let truncated = false
  for (const character of raw) {
    if (
      firstLineOnly &&
      (character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029')
    ) {
      break
    }
    if (characters.length >= maxCodePoints) {
      truncated = true
      break
    }
    characters.push(unsafeDiagnosticCharacter(character) ? ' ' : character)
  }

  const trimmed = characters.join('').trim()
  if (!truncated || !trimmed) return trimmed
  const bounded = Array.from(trimmed)
  if (bounded.length >= maxCodePoints) bounded[maxCodePoints - 1] = '…'
  else bounded.push('…')
  return bounded.join('')
}

function haystack(error: unknown): string {
  const parts: string[] = []
  let remaining = MAX_AI_ERROR_CLASSIFICATION_CODE_POINTS
  const appendPart = (value: unknown): void => {
    if (remaining <= 0) return
    const separatorLength = parts.length > 0 ? 1 : 0
    const allowance = remaining - separatorLength
    if (allowance <= 0) return
    const part = boundedDiagnosticText(safeDiagnosticString(value), allowance)
    if (!part) return
    const partLength = Array.from(part).length
    parts.push(part)
    remaining -= separatorLength + partLength
  }
  let cur: unknown = error
  for (let d = 0; cur != null && d < 6 && remaining > 0; d++) {
    let isError = false
    try {
      isError = cur instanceof Error
    } catch {
      isError = false
    }
    if (isError) {
      appendPart(safeDiagnosticProperty(cur, 'name'))
      appendPart(safeDiagnosticProperty(cur, 'message'))
      for (const property of ['status', 'statusCode', 'code'] as const) {
        const value = safeDiagnosticProperty(cur, property)
        if (value != null) appendPart(value)
      }
      cur = safeDiagnosticProperty(cur, 'cause')
    } else {
      appendPart(cur)
      break
    }
  }
  return parts.join(' ').toLowerCase()
}

const CANCEL_RE = /\bcancelled\b|\bcanceled\b|aborterror|operation was aborted/
const TIMEOUT_RE = /\btimeout\b|timed out|timeouterror|signal timed out/
const NETWORK_RE =
  /failed to fetch|networkerror|load failed|fetch failed|err_network|network|typeerror: failed/
const CORS_RE = /cors|cross-origin|access-control|blocked by/
const AUTH_RE =
  /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|invalid_api_key|api key|permission/
const RATE_RE = /\b429\b|rate limit|rate_limit|too many requests|quota|overloaded/

function technicalDetail(error: unknown): string | undefined {
  const message = safeDiagnosticProperty(error, 'message')
  const raw = typeof message === 'string' ? message : safeDiagnosticString(error)
  const firstLine = boundedDiagnosticText(raw, MAX_AI_TECHNICAL_DETAIL_CODE_POINTS, true)
  if (!firstLine) return undefined
  return firstLine
}

function classifyBrowserErrorUnchecked(error: unknown): ClassifiedError {
  // A typed TransportError already carries its class — trust it directly so we
  // never mis-read a 'network' code as CORS (or vice-versa).
  if (error instanceof TransportError) {
    if (error.code === 'timeout') {
      return { code: 'timeout', offline: false, message: 'The request timed out. Try again.' }
    }
    if (error.code === 'auth') {
      return {
        code: 'auth',
        offline: false,
        message:
          'The provider rejected the request (authentication). Check your API key in Settings.',
        technicalDetail: safeHttpEvidence(error)
      }
    }
    if (error.code === 'rate') {
      return {
        code: 'rate',
        offline: false,
        message:
          'The provider is rate-limiting or overloaded right now. Wait a moment and try again.',
        technicalDetail: safeHttpEvidence(error)
      }
    }
    if (error.code === 'cancelled') {
      return { code: 'cancelled', offline: false, message: 'The request was cancelled.' }
    }
    return {
      code: 'network',
      offline: true,
      message: 'Could not reach the AI provider. Check your internet connection, then try again.'
    }
  }
  if (error instanceof ProviderHttpError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: 'auth',
        offline: false,
        message:
          'The provider rejected the request (authentication). Check your API key in Settings.',
        technicalDetail: safeHttpEvidence(error)
      }
    }
    if (error.status === 429) {
      return {
        code: 'rate',
        offline: false,
        message:
          'The provider is rate-limiting or overloaded right now. Wait a moment and try again.',
        technicalDetail: safeHttpEvidence(error)
      }
    }
    return {
      code: 'provider',
      offline: false,
      message: 'The AI provider returned an error.',
      technicalDetail: safeHttpEvidence(error)
    }
  }
  if (error instanceof ProviderResponseError || error instanceof SyntaxError) {
    return {
      code: 'invalid-response',
      offline: false,
      message: 'The AI provider returned an unreadable or empty response.',
      technicalDetail:
        error instanceof ProviderResponseError
          ? `${error.providerId}: ${error.code}`
          : technicalDetail(error)
    }
  }
  const hay = haystack(error)
  if (CANCEL_RE.test(hay)) {
    return { code: 'cancelled', offline: false, message: 'The request was cancelled.' }
  }
  if (TIMEOUT_RE.test(hay)) {
    return { code: 'timeout', offline: false, message: 'The request timed out. Try again.' }
  }
  // Auth/rate next: a ProviderHttpError(401) whose body text may also mention
  // "network"-ish words should still classify as auth, not offline.
  if (AUTH_RE.test(hay) && !CORS_RE.test(hay)) {
    return {
      code: 'auth',
      offline: false,
      message: 'The provider rejected the request (authentication). Check your API key in Settings.'
    }
  }
  if (RATE_RE.test(hay)) {
    return {
      code: 'rate',
      offline: false,
      message: 'The provider is rate-limiting or overloaded right now. Wait a moment and try again.'
    }
  }
  if (CORS_RE.test(hay)) {
    return {
      code: 'cors',
      offline: false,
      message:
        'The provider blocked the browser request (CORS). ' +
        'Use OpenRouter, Anthropic, or Gemini in this Lite build.'
    }
  }
  if (NETWORK_RE.test(hay)) {
    return {
      code: 'network',
      offline: true,
      message: 'Could not reach the AI provider. Check your internet connection, then try again.'
    }
  }
  return {
    code: 'unknown',
    offline: false,
    message: 'The AI operation failed unexpectedly.',
    technicalDetail: technicalDetail(error)
  }
}

export function classifyBrowserError(error: unknown): ClassifiedError {
  try {
    return classifyBrowserErrorUnchecked(error)
  } catch {
    // `error` is an unknown trust-boundary value. Proxies can throw from
    // instanceof, property access, or string conversion; classification must
    // never replace the original failure with another unhandled exception.
    return {
      code: 'unknown',
      offline: false,
      message: 'The AI operation failed unexpectedly.'
    }
  }
}
