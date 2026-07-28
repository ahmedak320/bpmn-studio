/**
 * Transcript and privacy — plan section 18.7.
 *
 * - The chat transcript (`ArisChatSessionTranscript`) is session-local by default: an in-memory
 *   list with no persistence call anywhere in this file. A caller that wants to export it does
 *   so explicitly via `exportTranscript`, which is the one function in this module that
 *   produces a payload meant to leave the session.
 * - `ArisChatProvenanceEntry` is the *only* shape that belongs in revision history — it carries
 *   a command id, kind, target ids, origin, and gap kinds, never a prompt or a provider
 *   response. `buildProvenanceEntry` converts an `ArisChatReceiptEntry` (see `applyEngine.ts`)
 *   into one.
 * - Full prompts/provider responses are represented here only as `ArisChatTranscriptMessage`,
 *   which never leaves the session unless `exportTranscript` is called explicitly.
 * - API keys are never stored: `assertTranscriptSafeToExport` and `assertProvenanceSafeToStore`
 *   both reuse `findSecretLikeMatches` from `src/aris/packages/secrets.ts` (plan §7.4's
 *   credential scanner, already built and read-only reused here through the narrow seam the
 *   brief asked for) to fail closed on anything credential-shaped before a transcript export or
 *   a revision-history write.
 */

import { findSecretLikeMatches, type SecretFinding } from '../packages/secrets'
import type { ArisChatCommandKind } from './patchSchema'

export type ArisChatTranscriptRole = 'user' | 'assistant' | 'system'

export interface ArisChatTranscriptMessage {
  readonly id: string
  readonly role: ArisChatTranscriptRole
  readonly text: string
  readonly createdAt: string
}

/** What goes into revision history alongside an applied change. Never a prompt or response. */
export interface ArisChatProvenanceEntry {
  readonly commandId: string
  readonly kind: ArisChatCommandKind
  readonly targetIds: readonly string[]
  readonly origin: 'ai-auto' | 'ai-confirmed'
  readonly gapKinds: readonly string[]
  readonly appliedAt: string
}

export interface ArisChatReceiptEntryLike {
  readonly commandId: string
  readonly kind: ArisChatCommandKind
  readonly targetIds: readonly string[]
  readonly origin: 'ai-auto' | 'ai-confirmed'
}

export function buildProvenanceEntry(entry: ArisChatReceiptEntryLike, gapKinds: readonly string[], appliedAt: string): ArisChatProvenanceEntry {
  return Object.freeze({
    commandId: entry.commandId,
    kind: entry.kind,
    targetIds: Object.freeze([...entry.targetIds]),
    origin: entry.origin,
    gapKinds: Object.freeze([...gapKinds]),
    appliedAt
  })
}

/** A session-local, in-memory transcript. Nothing here is ever written to disk by this class. */
export class ArisChatSessionTranscript {
  private readonly messages: ArisChatTranscriptMessage[] = []

  append(message: ArisChatTranscriptMessage): void {
    this.messages.push(Object.freeze({ ...message }))
  }

  getAll(): readonly ArisChatTranscriptMessage[] {
    return Object.freeze([...this.messages])
  }

  clear(): void {
    this.messages.length = 0
  }
}

export class ArisChatCredentialMaterialError extends Error {
  readonly findings: readonly SecretFinding[]
  readonly location: string

  constructor(location: string, findings: readonly SecretFinding[]) {
    super(`Credential-shaped content was rejected in "${location}" before it could leave the session.`)
    this.name = 'ArisChatCredentialMaterialError'
    this.location = location
    this.findings = Object.freeze([...findings])
  }
}

function assertNoCredentialMaterial(location: string, text: string): void {
  const findings = findSecretLikeMatches(text)
  if (findings.length > 0) throw new ArisChatCredentialMaterialError(location, findings)
}

/**
 * Explicit transcript export (plan 18.7: "full prompts/provider responses are not stored unless
 * the user explicitly exports them"). Scans every message for credential-shaped content first
 * and throws rather than exporting if any is found.
 */
export function exportTranscript(transcript: ArisChatSessionTranscript): readonly ArisChatTranscriptMessage[] {
  const messages = transcript.getAll()
  for (const message of messages) {
    assertNoCredentialMaterial(`transcript message ${message.id}`, message.text)
  }
  return messages
}

/** Fail-closed guard before any transcript payload leaves the session. */
export function assertTranscriptSafeToExport(messages: readonly ArisChatTranscriptMessage[]): void {
  for (const message of messages) {
    assertNoCredentialMaterial(`transcript message ${message.id}`, message.text)
  }
}

/** Fail-closed guard before a provenance payload is written to revision history. */
export function assertProvenanceSafeToStore(entries: readonly ArisChatProvenanceEntry[]): void {
  for (const entry of entries) {
    assertNoCredentialMaterial(`provenance entry ${entry.commandId}`, JSON.stringify(entry))
  }
}
