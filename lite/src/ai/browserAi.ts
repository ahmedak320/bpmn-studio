// Browser-direct AI generation for Lite.
//
// Reuses the desktop app's generation pipeline VERBATIM — the same
// `generateFromDescription(callLLM, ...)` orchestration and the same Zod IR
// schema — and only swaps the provider layer: instead of the desktop's
// Electron-net-fetch registry (7 providers), Lite calls the two providers that
// permit direct browser (CORS) access with a user-supplied key:
//   - Anthropic, via the `anthropic-dangerous-direct-browser-access` header
//     (the API otherwise refuses cross-origin browser requests);
//   - Google Gemini, whose Generative Language API allows browser CORS.
// GLM / Kimi / DeepSeek / OpenAI / Azure do NOT send CORS headers, so they
// cannot be called from a web page and require the desktop app (or a future
// server backend). See providersLite.ts for the user-facing note.

import { generateObject, generateText, type LanguageModel, type ModelMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { ProcessModelSchema } from '@app/gen/ir/schema'
import { generateFromDescription, type CallLLM, type LlmMessage } from '@app/gen'

export type LiteProviderId = 'anthropic' | 'gemini'

function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content }
    if (m.role === 'system') return { role: 'system', content: m.content }
    return { role: 'user', content: m.content }
  })
}

function createBrowserModel(
  providerId: LiteProviderId,
  modelId: string,
  apiKey: string
): LanguageModel {
  if (providerId === 'anthropic') {
    return createAnthropic({
      apiKey,
      // Required for direct browser use; without it the Anthropic API rejects
      // the cross-origin request. The user has explicitly opted in by pasting
      // their key into a browser page (Settings shows the storage warning).
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' }
    })(modelId)
  }
  return createGoogle({ apiKey })(modelId)
}

/**
 * A pipeline-shaped CallLLM bound to one browser provider/model/key: schema-
 * constrained `generateObject` first, falling back to plain text (which the
 * pipeline loose-parses) if the provider can't honor the recursive IR schema.
 */
export function makeBrowserCallLLM(
  providerId: LiteProviderId,
  modelId: string,
  apiKey: string
): CallLLM {
  const model = createBrowserModel(providerId, modelId, apiKey)
  return async (messages: LlmMessage[], { maxTokens }: { maxTokens: number }) => {
    const modelMessages = toModelMessages(messages)
    try {
      const { object } = await generateObject({
        model,
        schema: ProcessModelSchema,
        messages: modelMessages,
        maxOutputTokens: maxTokens
      })
      return object
    } catch {
      // Fall back to free-text + the pipeline's own loose JSON parse + repair.
      const { text } = await generateText({
        model,
        messages: modelMessages,
        maxOutputTokens: maxTokens
      })
      return text
    }
  }
}

export interface GenerateArgs {
  description: string
  providerId: LiteProviderId
  modelId: string
  apiKey: string
}

/** Generate a laid-out BPMN 2.0 XML string from a description, browser-direct. */
export async function generateDiagramXml(args: GenerateArgs): Promise<string> {
  const call = makeBrowserCallLLM(args.providerId, args.modelId, args.apiKey)
  const { layoutedXml } = await generateFromDescription(call, args.description)
  return layoutedXml
}

// --- compact error classifier (ported from the desktop adapter, trimmed to
// the browser cases) ------------------------------------------------------

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
  if (CORS_RE.test(hay)) {
    return {
      offline: false,
      message:
        'The provider blocked the browser request (CORS). Only Anthropic and Gemini support ' +
        'direct browser calls; other providers need the desktop app.'
    }
  }
  if (NETWORK_RE.test(hay)) {
    return {
      offline: true,
      message: 'Could not reach the AI provider. Check your internet connection, then try again.'
    }
  }
  if (AUTH_RE.test(hay)) {
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
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.split('\n')[0].trim()
  return { offline: false, message: firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine }
}
