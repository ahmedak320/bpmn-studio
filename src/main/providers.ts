// 7-provider registry: turns a (providerId, modelId) pair + stored secrets
// into an AI SDK LanguageModel, and exposes a generateObject-first /
// generateText-fallback callLLM shape for src/gen/generate.ts (B3).
//
// All network calls are routed through Electron's `net.fetch` so system
// proxy/PAC settings are honored (corporate-proxy compatibility, risk #7).
import { net } from 'electron'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { createGoogle } from '@ai-sdk/google'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject, generateText, type LanguageModel, type ModelMessage } from 'ai'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import type { z } from 'zod'
import { PROVIDERS, type ProviderId } from '../shared/providers'
import { getAllKeys } from './secrets'

/** Electron's Chromium-stack fetch, bound so it can be passed as an AI SDK
 * `fetch` option without losing its receiver. Falls back to global fetch
 * outside a running Electron app (e.g. unit tests import this module without
 * the app being ready) — callers should inject their own fetch in that case. */
export function electronNetFetch(): FetchFunction {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    net.fetch(input as never, init as never)) as unknown as FetchFunction
}

export class ProviderConfigError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    message: string
  ) {
    super(message)
    this.name = 'ProviderConfigError'
  }
}

interface CreateModelOptions {
  /** Override fetch (tests, or a caller that wants a different net stack). */
  fetch?: FetchFunction
  /** Override the decrypted key/field lookup (tests). Defaults to secrets.getAllKeys(). */
  keysByProvider?: Partial<Record<ProviderId, Record<string, string>>>
}

function requireField(
  providerId: ProviderId,
  fields: Record<string, string>,
  name: string
): string {
  const value = fields[name]
  if (!value) {
    throw new ProviderConfigError(providerId, `Missing required field "${name}" for ${providerId}`)
  }
  return value
}

/** Build an AI SDK LanguageModel for (providerId, modelId) using stored secrets. */
export async function createModel(
  providerId: ProviderId,
  modelId: string,
  options: CreateModelOptions = {}
): Promise<LanguageModel> {
  const spec = PROVIDERS[providerId]
  if (!spec) throw new ProviderConfigError(providerId, `Unknown provider "${providerId}"`)

  const fetchImpl = options.fetch ?? electronNetFetch()
  const allKeys = options.keysByProvider ?? (await getAllKeys())
  const fields = allKeys[providerId] ?? {}

  switch (spec.sdk) {
    case 'openai': {
      const apiKey = requireField(providerId, fields, 'apiKey')
      return createOpenAI({ apiKey, fetch: fetchImpl })(modelId)
    }
    case 'anthropic': {
      const apiKey = requireField(providerId, fields, 'apiKey')
      return createAnthropic({ apiKey, fetch: fetchImpl })(modelId)
    }
    case 'deepseek': {
      const apiKey = requireField(providerId, fields, 'apiKey')
      return createDeepSeek({ apiKey, fetch: fetchImpl })(modelId)
    }
    case 'google': {
      const apiKey = requireField(providerId, fields, 'apiKey')
      return createGoogle({ apiKey, fetch: fetchImpl })(modelId)
    }
    case 'azure': {
      const apiKey = requireField(providerId, fields, 'apiKey')
      const endpoint = requireField(providerId, fields, 'endpoint')
      const deployment = fields.deployment || modelId
      const apiVersion =
        fields.apiVersion ||
        spec.keyFields.find((f) => f.name === 'apiVersion')?.defaultValue ||
        '2024-10-21'
      return createAzure({
        apiKey,
        baseURL: endpoint.replace(/\/+$/, ''),
        apiVersion,
        useDeploymentBasedUrls: true,
        fetch: fetchImpl
      })(deployment)
    }
    case 'openai-compatible': {
      const apiKey = requireField(providerId, fields, 'apiKey')
      const baseURLField = spec.keyFields.find((f) => f.name === 'baseURL')
      const baseURL = fields.baseURL || baseURLField?.defaultValue
      if (!baseURL) {
        throw new ProviderConfigError(providerId, `Missing required field "baseURL" for ${providerId}`)
      }
      return createOpenAICompatible({
        name: providerId,
        apiKey,
        baseURL,
        fetch: fetchImpl
      })(modelId)
    }
    default:
      throw new ProviderConfigError(providerId, `Unsupported sdk kind for ${providerId}`)
  }
}

export interface AvailableProvider {
  id: ProviderId
  configured: boolean
}

/** Which of the 7 providers currently have all required fields filled in. */
export async function availableProviders(
  keysByProvider?: Partial<Record<ProviderId, Record<string, string>>>
): Promise<AvailableProvider[]> {
  const allKeys = keysByProvider ?? (await getAllKeys())
  return (Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
    const spec = PROVIDERS[id]
    const fields = allKeys[id] ?? {}
    const configured = spec.keyFields
      .filter((f) => f.required)
      .every((f) => Boolean(fields[f.name]) || Boolean(f.defaultValue))
    return { id, configured }
  })
}

export interface CallLLMParams {
  /** Zod schema describing the IR (src/gen/ir/schema.ts, B3). */
  schema: z.ZodTypeAny
  system?: string
  messages: ModelMessage[]
  maxTokens?: number
}

export interface CallLLMResult {
  /** Parsed object when generateObject (or the loose-parse fallback) succeeded. */
  object?: unknown
  /** Raw text — always present on the fallback path, absent on a clean generateObject call. */
  text?: string
  usedFallback: boolean
}

export type CallLLM = (params: CallLLMParams) => Promise<CallLLMResult>

/** Providers whose structured-output support is unreliable enough that we go
 * straight to the text+loose-parse+repair path (plan.md risk #3). Empty for
 * now — flip providers in here as real-world testing (wave G) finds issues. */
const FORCE_TEXT_FALLBACK = new Set<ProviderId>([])

function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model output')
  }
  return JSON.parse(text.slice(start, end + 1))
}

/** Returns a callLLM function bound to one (providerId, modelId) pair, doing
 * generateObject first and falling back to generateText + loose JSON parse
 * when the provider is flagged (or generateObject itself throws). Temperature
 * is intentionally omitted — the vendored pipeline forces it to 1 upstream
 * (plan.md §2a), so we let each provider use its default. */
export function makeCallLLM(
  providerId: ProviderId,
  modelId: string,
  createModelOptions: CreateModelOptions = {}
): CallLLM {
  return async ({ schema, system, messages, maxTokens = 3000 }: CallLLMParams) => {
    const model = await createModel(providerId, modelId, createModelOptions)

    if (!FORCE_TEXT_FALLBACK.has(providerId)) {
      try {
        const result = await generateObject({
          model,
          schema,
          system,
          messages,
          maxOutputTokens: maxTokens
        })
        return { object: result.object, usedFallback: false }
      } catch {
        // fall through to text+loose-parse below
      }
    }

    const result = await generateText({
      model,
      system,
      messages,
      maxOutputTokens: maxTokens
    })
    return { text: result.text, object: extractJson(result.text), usedFallback: true }
  }
}
