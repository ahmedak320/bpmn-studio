// Provider catalog shared between main (provider factory, secrets) and
// renderer (Settings UI). Pure data — no Node/Electron/AI-SDK imports here so
// it can be imported from either process and from vitest without mocking.

/** Stable ids for the seven wired providers. */
export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'deepseek'
  | 'gemini'
  | 'azure'
  | 'glm'

/** A single selectable model within a provider. */
export interface ModelSpec {
  /** Model id as sent to the provider API. */
  id: string
  /** Human-friendly label for the Settings/AI panel UI. */
  label: string
}

/** One field in a provider's credential/config form (rendered in Settings). */
export interface ProviderKeyField {
  /** Key under which this field is stored in the secrets vault for this provider. */
  name: string
  label: string
  /** Input type hint for the renderer. */
  kind: 'secret' | 'text'
  placeholder?: string
  /** Default value pre-filled in the UI / used when the field is left blank. */
  defaultValue?: string
  required: boolean
}

export interface ProviderSpec {
  id: ProviderId
  label: string
  /** Short description shown under the provider name in Settings. */
  description: string
  /** Which AI SDK package/adapter createModel() should use for this provider. */
  sdk: 'openai' | 'anthropic' | 'azure' | 'google' | 'deepseek' | 'openai-compatible'
  /** Ordered list of selectable models. First entry is the default selection. */
  models: ModelSpec[]
  /** Whether the model list is fixed or the user may type a custom model id
   * (e.g. Azure deployments, GLM's evolving model lineup). */
  allowCustomModel: boolean
  /** Credential/config fields this provider needs, in display order. */
  keyFields: ProviderKeyField[]
  /** True when this provider is reached via the openai-compatible adapter
   * against a third-party OpenAI-compatible endpoint (Moonshot, GLM today). */
  isOpenAICompatible: boolean
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT models via api.openai.com.',
    sdk: 'openai',
    allowCustomModel: false,
    isOpenAICompatible: false,
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }
    ],
    keyFields: [
      { name: 'apiKey', label: 'API key', kind: 'secret', required: true }
    ]
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models via api.anthropic.com.',
    sdk: 'anthropic',
    allowCustomModel: false,
    isOpenAICompatible: false,
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }
    ],
    keyFields: [
      { name: 'apiKey', label: 'API key', kind: 'secret', required: true }
    ]
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    description:
      'Kimi models via Moonshot’s OpenAI-compatible endpoint (no first-party AI SDK package).',
    sdk: 'openai-compatible',
    allowCustomModel: true,
    isOpenAICompatible: true,
    models: [
      { id: 'kimi-k3', label: 'Kimi K3' },
      { id: 'kimi-k2.5', label: 'Kimi K2.5' },
      { id: 'kimi-latest', label: 'Kimi Latest' }
    ],
    keyFields: [
      { name: 'apiKey', label: 'API key', kind: 'secret', required: true },
      {
        name: 'baseURL',
        label: 'Base URL',
        kind: 'text',
        defaultValue: 'https://api.moonshot.ai/v1',
        required: true
      }
    ]
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek models via api.deepseek.com.',
    sdk: 'deepseek',
    allowCustomModel: false,
    isOpenAICompatible: false,
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' }
    ],
    keyFields: [
      { name: 'apiKey', label: 'API key', kind: 'secret', required: true }
    ]
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini models via the Google Generative AI API.',
    sdk: 'google',
    allowCustomModel: false,
    isOpenAICompatible: false,
    models: [
      { id: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
      { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (preview)' }
    ],
    keyFields: [
      { name: 'apiKey', label: 'API key', kind: 'secret', required: true }
    ]
  },
  azure: {
    id: 'azure',
    label: 'Azure OpenAI',
    description: 'Deployment-driven — model id is your Azure deployment name.',
    sdk: 'azure',
    allowCustomModel: true,
    isOpenAICompatible: false,
    models: [],
    keyFields: [
      { name: 'apiKey', label: 'API key', kind: 'secret', required: true },
      {
        name: 'endpoint',
        label: 'Resource endpoint',
        kind: 'text',
        placeholder: 'https://<resource>.openai.azure.com',
        required: true
      },
      { name: 'deployment', label: 'Deployment name', kind: 'text', required: true },
      {
        name: 'apiVersion',
        label: 'API version',
        kind: 'text',
        defaultValue: '2024-10-21',
        required: true
      }
    ]
  },
  glm: {
    id: 'glm',
    label: 'GLM (Zhipu)',
    description:
      'Zhipu’s GLM models via their OpenAI-compatible endpoint. Base URL and model id are editable — verify against docs.z.ai / open.bigmodel.cn if Zhipu changes them.',
    sdk: 'openai-compatible',
    allowCustomModel: true,
    isOpenAICompatible: true,
    models: [{ id: 'glm-5.2', label: 'GLM-5.2 (default)' }],
    keyFields: [
      { name: 'apiKey', label: 'API key', kind: 'secret', required: true },
      {
        name: 'baseURL',
        label: 'Base URL',
        kind: 'text',
        defaultValue: 'https://open.bigmodel.cn/api/paas/v4/',
        required: true
      }
    ]
  }
}

export const PROVIDER_LIST: ProviderSpec[] = Object.values(PROVIDERS)

export function getProvider(id: ProviderId): ProviderSpec {
  return PROVIDERS[id]
}

export function defaultModelId(id: ProviderId): string | undefined {
  return PROVIDERS[id].models[0]?.id
}
