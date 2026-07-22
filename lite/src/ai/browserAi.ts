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
    // Parse PDFs server-side for models without native document support; native
    // pass-through for those that have it (Claude/Gemini via OpenRouter).
    body.plugins = [{ id: 'file-parser', pdf: { engine: 'native' } }]
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
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body)
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new ProviderHttpError(res.status, `${cfg.providerId} ${res.status}: ${truncate(errText)}`)
    }
    const data: unknown = await res.json()
    const text = extractText(cfg.providerId, data)
    if (!text.trim()) throw new Error(`${cfg.providerId}: empty response from the model`)
    return text
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

export interface TestConnectionResult {
  /** True when the browser could read ANY HTTP response (⇒ CORS is open). */
  reachable: boolean
  /** True when fetch() threw (CORS preflight failed / host unreachable). */
  corsBlocked: boolean
  status?: number
  message: string
}

function fallbackProbeModel(providerId: LiteProviderId): string {
  const d = defaultLiteModelId(providerId)
  if (d) return d
  return providerId === 'openrouter' ? 'z-ai/glm-5.2' : 'probe'
}

function interpretProbe(status: number): TestConnectionResult {
  const base = { reachable: true, corsBlocked: false, status }
  if (status >= 200 && status < 300) {
    return { ...base, message: `Reachable — request accepted (HTTP ${status}). Your key works.` }
  }
  if (status === 401 || status === 403) {
    return {
      ...base,
      message: `Reachable (CORS OK) — the provider rejected the key (HTTP ${status}). Expected for a keyless test; enter a valid key to use it.`
    }
  }
  if (status === 400) {
    return {
      ...base,
      message: 'Reachable (CORS OK) — provider returned 400. The endpoint is callable from the browser.'
    }
  }
  if (status === 404) {
    return {
      ...base,
      message: 'Reachable (CORS OK) — 404 (check the model id). The endpoint is callable from the browser.'
    }
  }
  if (status === 429) {
    return {
      ...base,
      message: 'Reachable (CORS OK) — rate-limited (HTTP 429). The endpoint is callable from the browser.'
    }
  }
  return {
    ...base,
    message: `Reachable (CORS OK) — HTTP ${status}. The endpoint is callable from the browser.`
  }
}

/**
 * Probe a provider from the browser to tell CORS from auth truthfully:
 *  - fetch() RESOLVES with any status (even 401/400) ⇒ the browser could read a
 *    response ⇒ **CORS is OPEN** (report "reachable — key invalid" for a 401).
 *  - fetch() REJECTS (TypeError "Failed to fetch") ⇒ the browser could not read
 *    a response ⇒ **CORS BLOCKED** (or the host is unreachable).
 * Uses a dummy key when none is stored, so connectivity can be verified without
 * a key (this is also the e2e's key-free way to prove the providers are live).
 */
export async function testConnection(cfg: ProviderConfig): Promise<TestConnectionResult> {
  if (cfg.providerId === 'custom' && !(cfg.baseURL && cfg.baseURL.trim())) {
    return { reachable: false, corsBlocked: false, message: 'Enter a base URL first.' }
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
  let res: Response
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body)
    })
  } catch {
    return {
      reachable: false,
      corsBlocked: true,
      message:
        'CORS-blocked or unreachable — the browser could not read any response. ' +
        'This endpoint likely cannot be called directly from a web page (use the desktop app or a proxy).'
    }
  }
  return interpretProbe(res.status)
}

// --- compact error classifier (browser cases) ------------------------------

export interface ClassifiedError {
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

const NETWORK_RE =
  /failed to fetch|networkerror|load failed|fetch failed|err_network|network|typeerror: failed/
const CORS_RE = /cors|cross-origin|access-control|blocked by/
const AUTH_RE = /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|invalid_api_key|api key|permission/
const RATE_RE = /\b429\b|rate limit|rate_limit|too many requests|quota|overloaded/

export function classifyBrowserError(error: unknown): ClassifiedError {
  const hay = haystack(error)
  // Auth/rate first: a ProviderHttpError(401) whose body text may also mention
  // "network"-ish words should still classify as auth, not offline.
  if (AUTH_RE.test(hay) && !CORS_RE.test(hay)) {
    return {
      offline: false,
      message: 'The provider rejected the request (authentication). Check your API key in Settings.'
    }
  }
  if (RATE_RE.test(hay)) {
    return {
      offline: false,
      message: 'The provider is rate-limiting or overloaded right now. Wait a moment and try again.'
    }
  }
  if (CORS_RE.test(hay)) {
    return {
      offline: false,
      message:
        'The provider blocked the browser request (CORS). Use OpenRouter, Anthropic, or Gemini — ' +
        'or the desktop app for other providers.'
    }
  }
  if (NETWORK_RE.test(hay)) {
    return {
      offline: true,
      message: 'Could not reach the AI provider. Check your internet connection, then try again.'
    }
  }
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.split('\n')[0].trim()
  return { offline: false, message: firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine }
}
