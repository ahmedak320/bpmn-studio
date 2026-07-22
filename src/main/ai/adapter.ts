// Pure glue between B4's provider layer and B3's generation pipeline, plus
// error classification. Deliberately free of any *value* import from
// ../providers or electron so it can be unit-tested without mocking Electron:
//  - the B4 CallLLM is passed in (its types are erased type-only imports),
//  - ProcessModelSchema is imported straight from the schema module (zod only).

import type { ModelMessage } from 'ai'
import { ProcessModelSchema } from '../../gen/ir/schema'
import type { CallLLM as GenCallLLM, LlmMessage } from '../../gen'
import type { CallLLMParams, CallLLMResult } from '../providers'

/** A B4-style provider call: schema-first generateObject with text fallback. */
export type B4CallLLM = (params: CallLLMParams) => Promise<CallLLMResult>

function toModelMessage(m: LlmMessage): ModelMessage {
  if (m.role === 'assistant') return { role: 'assistant', content: m.content }
  if (m.role === 'system') return { role: 'system', content: m.content }
  // B3 only ever emits user/assistant; anything else is treated as user input.
  return { role: 'user', content: m.content }
}

/**
 * Adapt a B4 CallLLM (`{ object?, text?, usedFallback }`) into the B3 CallLLM
 * the pipeline expects (`(messages, { maxTokens }) => Promise<string|unknown>`):
 * return the parsed `object` when the provider produced one, otherwise the raw
 * `text` string (which the pipeline loose-parses itself). `onResult` lets the
 * caller observe the raw B4 result (e.g. to surface `usedFallback`).
 */
export function bridgeCallLLM(call: B4CallLLM, onResult?: (r: CallLLMResult) => void): GenCallLLM {
  return async (messages: LlmMessage[], options: { maxTokens: number }) => {
    const result = await call({
      schema: ProcessModelSchema,
      messages: messages.map(toModelMessage),
      maxTokens: options.maxTokens
    })
    onResult?.(result)
    if (result.object !== undefined) return result.object
    return result.text ?? ''
  }
}

/** A classified, user-safe view of a failure. */
export interface ClassifiedError {
  /** Short message safe to show in the panel (no stack, no secrets). */
  message: string
  /** True when the failure looks like a connectivity problem. */
  offline: boolean
}

/** Flatten an error (and its `cause` chain) into one lowercased haystack. */
function errorHaystack(error: unknown): string {
  const parts: string[] = []
  let cur: unknown = error
  for (let depth = 0; cur != null && depth < 6; depth++) {
    if (cur instanceof Error) {
      parts.push(cur.name, cur.message)
      const withExtras = cur as { code?: unknown; status?: unknown; statusCode?: unknown }
      if (withExtras.code != null) parts.push(String(withExtras.code))
      if (withExtras.status != null) parts.push(String(withExtras.status))
      if (withExtras.statusCode != null) parts.push(String(withExtras.statusCode))
      cur = (cur as { cause?: unknown }).cause
    } else {
      parts.push(String(cur))
      break
    }
  }
  return parts.join(' ').toLowerCase()
}

function shortMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.split('\n')[0].trim()
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine
}

const NETWORK_RE =
  /enotfound|eai_again|econnrefused|econnreset|etimedout|enetunreach|ehostunreach|epipe|fetch failed|failed to fetch|network|getaddrinfo|dns|socket hang up|connect timeout|und_err|networkerror|err_network/
const AUTH_RE =
  /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|invalid_api_key|authentication|permission denied|api key/
const RATE_RE = /\b429\b|rate limit|rate_limit|too many requests|quota|insufficient_quota|overloaded/
const CONFIG_RE = /missing required field|unknown provider|unsupported sdk/

/**
 * Map any thrown error into a short, actionable, secret-free message plus an
 * `offline` flag. Order matters: provider-config problems and connectivity are
 * checked first (a proxy/DNS failure often surfaces as a generic fetch error),
 * then auth, then rate limiting, then a generic fallback that surfaces the
 * pipeline's own (already sentence-like) message.
 */
export function classifyError(error: unknown): ClassifiedError {
  const hay = errorHaystack(error)

  if (CONFIG_RE.test(hay)) {
    return {
      offline: false,
      message: 'This provider is not fully configured. Open Settings to add its API key and fields.'
    }
  }
  if (NETWORK_RE.test(hay)) {
    return {
      offline: true,
      message:
        'Could not reach the AI provider. Check your internet connection or corporate proxy, then try again.'
    }
  }
  if (AUTH_RE.test(hay)) {
    return {
      offline: false,
      message: 'The provider rejected the request (authentication). Check the API key in Settings.'
    }
  }
  if (RATE_RE.test(hay)) {
    return {
      offline: false,
      message: 'The provider is rate-limiting or overloaded right now. Wait a moment and try again.'
    }
  }
  return { offline: false, message: shortMessage(error) }
}
