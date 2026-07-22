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
// and (c) attach provider-native PDF document parts. See providersLite.ts for
// which providers are reachable from a web page and why.
//
// The payload builders + response extractors are exported as pure functions and
// unit-tested (payloadBuilders.test.ts) — no network, no SDK.

import { generateFromDescription, type CallLLM, type LlmMessage } from '@app/gen'
import { defaultLiteModelId, type LiteProviderId } from './providersLite'
import { buildPdfInstruction, type PdfAttachment } from './pdf'

export type { LiteProviderId } from './providersLite'

// --- config + request shapes ----------------------------------------------

export interface ProviderConfig {
  providerId: LiteProviderId
  model: string
  apiKey: string
  /** Custom OpenAI-compatible endpoint root (no trailing /chat/completions). */
  baseURL?: string
  /** Custom endpoint extra headers (besides Authorization). */
  extraHeaders?: Record<string, string>
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
  /** Optional PDF attached to the first user turn (provider-native part). */
  attachment?: PdfAttachment
}

/** Error carrying the HTTP status so the classifier can read it. */
export class ProviderHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProviderHttpError'
    this.status = status
  }
}

export type TransportCode = 'auth' | 'rate' | 'network' | 'timeout'

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
  constructor(code: TransportCode, message: string, status?: number) {
    super(message)
    this.name = 'TransportError'
    this.code = code
    this.status = status
  }
}

// Every outbound fetch gets a timeout so a connection that never completes can't
// leave generation/testing busy forever (Codex M10). Generation is allowed to be
// slow (large PDFs, big diagrams); the connectivity probe must feel snappy.
export const GENERATION_TIMEOUT_MS = 180_000
export const TEST_CONNECTION_TIMEOUT_MS = 15_000

/** Map a raw fetch rejection to a TransportError (already-typed ones pass through). */
function toTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) return error
  const msg = error instanceof Error ? error.message : String(error)
  return new TransportError('network', msg)
}

/**
 * `fetch` with an AbortSignal timeout that COVERS THE BODY. The caller supplies
 * a `consume(res)` that reads the response (status + body); the timer stays armed
 * through it, so a server that sends headers then STALLS THE BODY still aborts
 * (Codex ORIG-10 — the old version cleared the timer once headers arrived, so a
 * hung `res.json()`/`res.text()` could block generation forever). On our timeout
 * it rejects with TransportError(code:'timeout'); a fetch-level rejection
 * (CORS/offline/DNS) becomes TransportError(code:'network'); errors thrown by
 * `consume` (HTTP status, empty body, JSON parse) keep their own type so the
 * repair loop's retry classification is unchanged. The timer is always cleared.
 */
async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (res: Response) => Promise<T>
): Promise<T> {
  const ctrl = new AbortController()
  let timedOut = false
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
    if (timedOut) throw timeoutError()
    throw toTransportError(error)
  }
  try {
    // Body read runs under the SAME deadline — the timer is cleared only AFTER
    // the body is fully consumed.
    return await consume(res)
  } catch (error) {
    if (timedOut) throw timeoutError()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function truncate(s: string, n = 300): string {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > n ? `${line.slice(0, n - 1)}…` : line
}

function firstUserIndex(messages: LlmMessage[]): number {
  return messages.findIndex((m) => m.role === 'user')
}

// --- OpenAI-shaped message conversion (OpenRouter + Custom) ----------------

interface OpenAiTextPart {
  type: 'text'
  text: string
}
interface OpenAiFilePart {
  type: 'file'
  file: { filename: string; file_data: string }
}
interface OpenAiMessage {
  role: string
  content: string | Array<OpenAiTextPart | OpenAiFilePart>
}

function toOpenAiMessages(messages: LlmMessage[], attachment?: PdfAttachment): OpenAiMessage[] {
  const attachAt = attachment ? firstUserIndex(messages) : -1
  return messages.map((m, i): OpenAiMessage => {
    if (i === attachAt && attachment) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          {
            type: 'file',
            file: {
              filename: attachment.fileName,
              file_data: `data:${attachment.mediaType};base64,${attachment.base64}`
            }
          }
        ]
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
      // Document block goes BEFORE the text (Anthropic's documented ordering).
      parts.push({
        type: 'document',
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
    max_tokens: opts.maxTokens
  }
  if (opts.jsonMode) body.response_format = { type: 'json_object' }
  if (opts.attachment) {
    // Attach the file-parser plugin but DO NOT pin `pdf.engine`. Forcing
    // 'native' only works for models with native file input; the default model
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

export function buildCustomRequest(
  cfg: ProviderConfig,
  messages: LlmMessage[],
  opts: BuildOpts
): BuiltRequest {
  const base = (cfg.baseURL ?? '').replace(/\/+$/, '')
  const body: Record<string, unknown> = {
    model: cfg.model,
    // No PDF part for custom endpoints (no verified document contract).
    messages: toOpenAiMessages(messages, undefined),
    max_tokens: opts.maxTokens
  }
  if (opts.jsonMode) body.response_format = { type: 'json_object' }
  const headers: Record<string, string> = {
    authorization: `Bearer ${cfg.apiKey}`,
    'content-type': 'application/json',
    ...(cfg.extraHeaders ?? {})
  }
  return { url: `${base}/chat/completions`, headers, body }
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
    case 'custom':
      return buildCustomRequest(cfg, messages, opts)
  }
}

// --- response text extraction (pure) ---------------------------------------

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}
interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
}

export function extractText(providerId: LiteProviderId, data: unknown): string {
  if (providerId === 'anthropic') {
    const parts = (data as AnthropicResponse).content ?? []
    return parts
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('')
  }
  if (providerId === 'gemini') {
    const parts = (data as GeminiResponse).candidates?.[0]?.content?.parts ?? []
    return parts.map((p) => p.text ?? '').join('')
  }
  // openrouter + custom (OpenAI shape)
  const content = (data as OpenAiResponse).choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => c.text ?? '').join('')
  return ''
}

// --- the CallLLM adapter ----------------------------------------------------

/**
 * A pipeline-shaped CallLLM bound to one provider/model/key: builds the
 * provider request (JSON mode on), POSTs it, and returns the model's raw text
 * for the pipeline to loose-parse + validate + repair. An optional PDF is
 * attached to the first user turn as a provider-native document part.
 */
export function makeBrowserCallLLM(
  cfg: ProviderConfig,
  extra?: { attachment?: PdfAttachment }
): CallLLM {
  const attachment = extra?.attachment
  return async (messages: LlmMessage[], { maxTokens }: { maxTokens: number }) => {
    const req = buildRequest(cfg, messages, { maxTokens, jsonMode: true, attachment })
    // fetchWithTimeout throws a TransportError on network/CORS/timeout (which the
    // repair loop will NOT retry); the timeout now covers the body read too.
    return fetchWithTimeout(
      req.url,
      { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) },
      GENERATION_TIMEOUT_MS,
      async (res) => {
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          const message = `${cfg.providerId} ${res.status}: ${truncate(errText)}`
          // 401/403/429 are permanent for this call — mark them transport so the
          // repair loop surfaces them once instead of re-sending (re-uploading the
          // PDF) three times. Other statuses stay ProviderHttpError, still retriable.
          if (res.status === 401 || res.status === 403) throw new TransportError('auth', message, res.status)
          if (res.status === 429) throw new TransportError('rate', message, res.status)
          throw new ProviderHttpError(res.status, message)
        }
        const data: unknown = await res.json()
        const text = extractText(cfg.providerId, data)
        if (!text.trim()) throw new Error(`${cfg.providerId}: empty response from the model`)
        return text
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
  baseURL?: string
  extraHeaders?: Record<string, string>
}

function toConfig(args: GenerateArgs): ProviderConfig {
  return {
    providerId: args.providerId,
    model: args.modelId,
    apiKey: args.apiKey,
    baseURL: args.baseURL,
    extraHeaders: args.extraHeaders,
    referer: typeof location !== 'undefined' ? location.origin : undefined,
    title: 'OrbitPM Process Studio Lite'
  }
}

/** Generate a laid-out BPMN 2.0 XML string from a text description. */
export async function generateDiagramXml(args: GenerateArgs): Promise<string> {
  const call = makeBrowserCallLLM(toConfig(args))
  const { layoutedXml } = await generateFromDescription(call, args.description)
  return layoutedXml
}

export interface GeneratePdfArgs extends GenerateArgs {
  attachment: PdfAttachment
  hint: string
}

/** Generate a laid-out BPMN 2.0 XML from a PDF (+ optional Arabic-safe hint). */
export async function generateDiagramXmlFromPdf(args: GeneratePdfArgs): Promise<string> {
  const instruction = buildPdfInstruction(args.hint)
  const call = makeBrowserCallLLM(toConfig(args), { attachment: args.attachment })
  const { layoutedXml } = await generateFromDescription(call, instruction)
  return layoutedXml
}

// --- Test connection: CORS-vs-auth discriminator ---------------------------

const DUMMY_PROBE_KEY = 'orbitpm-cors-probe-key'

/**
 * Stable verdict code so the UI can render the message from the i18n dictionary
 * (RTL-safe) instead of the English `message` below (which is kept for tests and
 * as a fallback). `reachable-other` covers 400/404/429/5xx — all "the browser
 * COULD read a response, so CORS is open" — with the status interpolated.
 */
export type TestVerdictCode =
  | 'need-base-url'
  | 'reachable-ok'
  | 'reachable-auth'
  | 'reachable-other'
  | 'blocked'
  | 'timeout'

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

function fallbackProbeModel(providerId: LiteProviderId): string {
  const d = defaultLiteModelId(providerId)
  if (d) return d
  return providerId === 'openrouter' ? 'z-ai/glm-5.2' : 'probe'
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
export async function testConnection(cfg: ProviderConfig): Promise<TestConnectionResult> {
  if (cfg.providerId === 'custom' && !(cfg.baseURL && cfg.baseURL.trim())) {
    return { reachable: false, blockedOrUnreachable: false, code: 'need-base-url', message: 'Enter a base URL first.' }
  }
  const probeCfg: ProviderConfig = {
    ...cfg,
    apiKey: cfg.apiKey || DUMMY_PROBE_KEY,
    model: cfg.model || fallbackProbeModel(cfg.providerId)
  }
  const req = buildRequest(probeCfg, [{ role: 'user', content: 'ping' }], {
    maxTokens: 1,
    jsonMode: false
  })
  let status: number
  try {
    // The probe only needs the status (CORS-open ⇔ any readable response); it
    // deliberately does not read the body.
    status = await fetchWithTimeout(
      req.url,
      { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) },
      TEST_CONNECTION_TIMEOUT_MS,
      async (res) => res.status
    )
  } catch (error) {
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
        'Try OpenRouter, Anthropic, or Gemini, or use the desktop app.'
    }
  }
  return interpretProbe(status)
}

// --- compact error classifier (browser cases) ------------------------------

/** Machine-readable error class so the UI can render an i18n (RTL-safe) message. */
export type ErrorCode = 'auth' | 'rate' | 'cors' | 'network' | 'timeout' | 'unknown'

export interface ClassifiedError {
  /** Stable code for i18n rendering (`unknown` ⇒ show the raw `message`). */
  code: ErrorCode
  /** English fallback message (used verbatim only for `unknown`). */
  message: string
  offline: boolean
}

function haystack(error: unknown): string {
  const parts: string[] = []
  let cur: unknown = error
  for (let d = 0; cur != null && d < 6; d++) {
    if (cur instanceof Error) {
      parts.push(cur.name, cur.message)
      const x = cur as { status?: unknown; statusCode?: unknown; code?: unknown }
      if (x.status != null) parts.push(String(x.status))
      if (x.statusCode != null) parts.push(String(x.statusCode))
      if (x.code != null) parts.push(String(x.code))
      cur = (cur as { cause?: unknown }).cause
    } else {
      parts.push(String(cur))
      break
    }
  }
  return parts.join(' ').toLowerCase()
}

const TIMEOUT_RE = /\btimeout\b|timed out|timeouterror|aborterror|operation was aborted|signal timed out/
const NETWORK_RE =
  /failed to fetch|networkerror|load failed|fetch failed|err_network|network|typeerror: failed/
const CORS_RE = /cors|cross-origin|access-control|blocked by/
const AUTH_RE = /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|invalid_api_key|api key|permission/
const RATE_RE = /\b429\b|rate limit|rate_limit|too many requests|quota|overloaded/

export function classifyBrowserError(error: unknown): ClassifiedError {
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
        message: 'The provider rejected the request (authentication). Check your API key in Settings.'
      }
    }
    if (error.code === 'rate') {
      return {
        code: 'rate',
        offline: false,
        message: 'The provider is rate-limiting or overloaded right now. Wait a moment and try again.'
      }
    }
    return {
      code: 'network',
      offline: true,
      message: 'Could not reach the AI provider. Check your internet connection, then try again.'
    }
  }
  const hay = haystack(error)
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
        'The provider blocked the browser request (CORS). Use OpenRouter, Anthropic, or Gemini — ' +
        'or the desktop app for other providers.'
    }
  }
  if (NETWORK_RE.test(hay)) {
    return {
      code: 'network',
      offline: true,
      message: 'Could not reach the AI provider. Check your internet connection, then try again.'
    }
  }
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.split('\n')[0].trim()
  return {
    code: 'unknown',
    offline: false,
    message: firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine
  }
}
