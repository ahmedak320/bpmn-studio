/**
 * §16.2 Description input — optional workspace context, redaction, and
 * consent for the Create-with-AI panel.
 *
 * This module deliberately reuses the same retrieval and redaction path the
 * assistant uses (§17.5, `arisAssistantAi.ts`) so the two surfaces cannot
 * drift on what "relevant workspace context" means. `buildArisAssistantAiContext`
 * ranks digests with `selectContextDigests` from `../assistant/retrieval`, which
 * is positive-confidence-only: an unrelated description yields an EMPTY context,
 * never a default selection.
 *
 * The consent fingerprint is separate from the assistant's because the Create
 * payload has a different shape (model name/type, optional attachment, repair
 * envelope), but it follows the same contract: consent is bound to a canonical
 * snapshot of the exact outbound request, and any change to inputs invalidates it.
 */

import { inspectContextSensitivity, type ContextSensitivity } from '../../ai/requestPrivacy'
import type { ArisProcessDigest } from '../assistant/types'
import { buildArisAssistantAiContext, type ArisAssistantAiContext } from './arisAssistantAi'

// ---------------------------------------------------------------------------
// Workspace context — §16.2 "optional relevant workspace context"
// ---------------------------------------------------------------------------

export { type ArisAssistantAiContext }

/**
 * Rank the workspace's models against the typed description and include only
 * genuinely relevant ones. Zero relevance means zero context.
 *
 * `redactNames` is applied BEFORE any prompt text is built, exactly as the
 * assistant does (§17.5.5).
 */
export function buildArisCreateDescriptionContext(
  digests: readonly ArisProcessDigest[],
  description: string,
  redactNames: boolean
): ArisAssistantAiContext {
  return buildArisAssistantAiContext(digests, description, redactNames)
}

// ---------------------------------------------------------------------------
// Sensitivity classification — §16.2 "sensitivity classification"
// ---------------------------------------------------------------------------

/**
 * Classify the outbound sensitivity of the description plus the workspace
 * context that will actually be sent. When context is off or empty, only the
 * description is inspected.
 */
export function buildArisCreateDescriptionSensitivity(
  description: string,
  context: ArisAssistantAiContext
): ContextSensitivity {
  const catalog = context.chips.map((chip) => ({ id: chip.modelId, name: chip.modelName }))
  return inspectContextSensitivity(description, catalog)
}

// ---------------------------------------------------------------------------
// Disclosure + consent — §16.2 "exact outbound preview" + "consent checkbox"
// ---------------------------------------------------------------------------

export type ArisCreateDescriptionTab = 'description' | 'document' | 'excel'

export interface ArisCreateDescriptionDisclosure {
  readonly purpose: 'aris-create-description'
  readonly tab: ArisCreateDescriptionTab
  readonly providerId: string
  readonly modelId: string
  readonly modelName: string
  readonly modelType: string
  readonly includeContext: boolean
  readonly redactNames: boolean
  readonly contextModelIds: readonly string[]
  readonly attachmentName: string
  readonly attachmentSizeBytes: number
  /** The exact system prompt the provider will receive. */
  readonly outboundSystem: string
  /** The exact user prompt the provider will receive. */
  readonly outboundUser: string
  /** Changes whenever any disclosed field changes. */
  readonly fingerprint: string
}

export interface ArisCreateDescriptionConsent {
  readonly fingerprint: string
  readonly canonical: string
  readonly grantedAt: string
}

export interface ArisCreateDescriptionDisclosureInput {
  readonly tab: ArisCreateDescriptionTab
  readonly providerId: string
  readonly modelId: string
  readonly modelName: string
  readonly modelType: string
  readonly includeContext: boolean
  readonly redactNames: boolean
  readonly context: ArisAssistantAiContext
  readonly attachmentName: string
  readonly attachmentSizeBytes: number
  readonly outboundSystem: string
  readonly outboundUser: string
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Small deterministic, non-cryptographic hash used only as a change token. */
function fingerprintOf(value: unknown): string {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `aris-create-description-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function canonicalOf(disclosure: ArisCreateDescriptionDisclosure): string {
  const { fingerprint: _fingerprint, ...rest } = disclosure
  return stableStringify(rest)
}

/**
 * Build the canonical disclosure the user reviews and consents to. The
 * returned `outboundSystem`/`outboundUser` are byte-identical to what the
 * provider request will send, and the `fingerprint` changes when any input
 * changes.
 */
export function buildArisCreateDescriptionDisclosure(
  input: ArisCreateDescriptionDisclosureInput
): ArisCreateDescriptionDisclosure {
  const content = {
    purpose: 'aris-create-description' as const,
    tab: input.tab,
    providerId: input.providerId,
    modelId: input.modelId,
    modelName: input.modelName,
    modelType: input.modelType,
    includeContext: input.includeContext,
    redactNames: input.redactNames,
    contextModelIds: input.context.includedModelIds,
    attachmentName: input.attachmentName,
    attachmentSizeBytes: input.attachmentSizeBytes,
    outboundSystem: input.outboundSystem,
    outboundUser: input.outboundUser
  }
  return { ...content, fingerprint: fingerprintOf(content) }
}

/** Grant consent to EXACTLY this disclosure (and nothing it might later become). */
export function grantArisCreateDescriptionConsent(
  disclosure: ArisCreateDescriptionDisclosure,
  grantedAt = new Date().toISOString()
): ArisCreateDescriptionConsent {
  return { fingerprint: disclosure.fingerprint, canonical: canonicalOf(disclosure), grantedAt }
}

/**
 * Consent is valid only for the disclosure it was granted against — changing
 * the description, provider, model, context inclusion, redaction, selected
 * models, or attachment invalidates it.
 */
export function hasArisCreateDescriptionConsent(
  disclosure: ArisCreateDescriptionDisclosure,
  consent: ArisCreateDescriptionConsent | null
): boolean {
  return (
    consent !== null &&
    consent.fingerprint === disclosure.fingerprint &&
    consent.canonical === canonicalOf(disclosure)
  )
}
