/**
 * Provider-agnostic disclosure and consent model for any feature that sends
 * workspace content to an external service. It is deliberately serializable:
 * translation, generation, and interview UIs can render the same contract
 * without coupling consent to a React component or a provider transport.
 */

export interface ExternalRequestItem {
  id: string
  text: string
  context?: string
  /** The caller knows this item may contain a person's name or similar data. */
  sensitive?: boolean
}

export interface ExternalRequestEstimate {
  min: number
  max: number
}

export interface ExternalRequestDisclosure {
  schemaVersion: 1
  purpose: string
  providerId: string
  modelId?: string
  outbound: ExternalRequestItem[]
  sensitiveItemCount: number
  estimatedRequests: ExternalRequestEstimate
  /**
   * Changes whenever the provider, model, purpose, context, or exact outbound
   * text changes. A consent token for an older fingerprint is invalid.
   */
  fingerprint: string
}

export interface ExternalRequestConsent {
  fingerprint: string
  /**
   * Canonical snapshot of every reviewed disclosure field except the short
   * display fingerprint. This is the exact consent boundary.
   */
  canonicalDisclosure: string
  grantedAt: string
}

export interface ExternalRequestDisclosureInput {
  purpose: string
  providerId: string
  modelId?: string
  outbound: readonly ExternalRequestItem[]
  estimatedRequests: ExternalRequestEstimate
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Small deterministic, non-security hash used only as a change token. */
function fingerprint(value: unknown): string {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `review-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function canonicalDisclosure(disclosure: ExternalRequestDisclosure): string {
  const content: Record<string, unknown> = { ...disclosure }
  delete content.fingerprint
  return stableStringify(content)
}

export function createExternalRequestDisclosure(
  input: ExternalRequestDisclosureInput
): ExternalRequestDisclosure {
  const outbound = input.outbound.map((item) => ({
    id: item.id,
    text: item.text,
    ...(item.context === undefined ? {} : { context: item.context }),
    ...(item.sensitive === undefined ? {} : { sensitive: item.sensitive })
  }))
  const estimatedRequests = {
    min: Math.max(0, Math.floor(input.estimatedRequests.min)),
    max: Math.max(
      Math.max(0, Math.floor(input.estimatedRequests.min)),
      Math.floor(input.estimatedRequests.max)
    )
  }
  const content = {
    schemaVersion: 1 as const,
    purpose: input.purpose,
    providerId: input.providerId,
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    outbound,
    sensitiveItemCount: outbound.filter((item) => item.sensitive === true).length,
    estimatedRequests
  }
  return { ...content, fingerprint: fingerprint(content) }
}

export function grantExternalRequestConsent(
  disclosure: ExternalRequestDisclosure,
  grantedAt = new Date().toISOString()
): ExternalRequestConsent {
  return {
    fingerprint: disclosure.fingerprint,
    canonicalDisclosure: canonicalDisclosure(disclosure),
    grantedAt
  }
}

export function hasExternalRequestConsent(
  disclosure: ExternalRequestDisclosure,
  consent: ExternalRequestConsent | null | undefined
): boolean {
  return (
    consent?.fingerprint === disclosure.fingerprint &&
    consent.canonicalDisclosure === canonicalDisclosure(disclosure)
  )
}
