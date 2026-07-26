import {
  LITE_PROVIDERS,
  getLiteProvider,
  type LiteProviderId
} from './providersLite'
import { getPref, setPref, type KeyStorageResult } from './keys'

export interface ProviderSelection {
  providerId: LiteProviderId
  modelId: string
}

const PREF_NAME = 'ai-provider-selection.v1'
const EVENT_NAME = 'orbitpm:ai-provider-selection'
let sessionSelection: ProviderSelection | null = null

function isProviderId(value: unknown): value is LiteProviderId {
  return LITE_PROVIDERS.some((provider) => provider.id === value)
}

function validateSelection(value: unknown): ProviderSelection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ProviderSelection>
  if (!isProviderId(candidate.providerId)) return null
  if (typeof candidate.modelId !== 'string' || !candidate.modelId.trim()) return null
  return {
    providerId: candidate.providerId,
    modelId: candidate.modelId.trim()
  }
}

function dispatchSelection(selection: ProviderSelection | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<ProviderSelection | null>(EVENT_NAME, { detail: selection })
  )
}

/**
 * Returns only a choice the user previously made. There is intentionally no
 * "first configured key" or provider-order fallback.
 */
export function getProviderSelection(): ProviderSelection | null {
  if (sessionSelection) return { ...sessionSelection }
  const raw = getPref(PREF_NAME)
  if (!raw) return null
  try {
    const selection = validateSelection(JSON.parse(raw))
    if (selection) sessionSelection = selection
    return selection ? { ...selection } : null
  } catch {
    return null
  }
}

export function setProviderSelection(
  providerId: LiteProviderId,
  modelId: string
): KeyStorageResult<undefined> {
  // Also provides a runtime assertion when values originate in a select/input.
  getLiteProvider(providerId)
  const trimmedModel = modelId.trim()
  if (!trimmedModel) {
    return {
      ok: false,
      code: 'invalid-input',
      error: 'Select or enter a model before saving the AI provider.'
    }
  }
  const selection: ProviderSelection = { providerId, modelId: trimmedModel }
  sessionSelection = selection
  const result = setPref(PREF_NAME, JSON.stringify(selection))
  dispatchSelection(selection)
  return result
}

export function clearProviderSelection(): KeyStorageResult<undefined> {
  sessionSelection = null
  const result = setPref(PREF_NAME, '')
  dispatchSelection(null)
  return result
}

export function subscribeProviderSelection(
  listener: (selection: ProviderSelection | null) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handle = (event: Event): void => {
    listener((event as CustomEvent<ProviderSelection | null>).detail)
  }
  window.addEventListener(EVENT_NAME, handle)
  return () => window.removeEventListener(EVENT_NAME, handle)
}

export function resetProviderSelectionForTests(): void {
  sessionSelection = null
}
