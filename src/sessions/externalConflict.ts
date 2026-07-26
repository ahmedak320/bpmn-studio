import type { DocumentIdentity, FileFingerprint } from './types'

export interface ExternalDocument {
  identity: DocumentIdentity
  xml: string
  fingerprint: FileFingerprint
}

export type ExternalState =
  | { kind: 'new'; current: null }
  | { kind: 'unchanged'; current: ExternalDocument; metadataChanged: boolean }
  | { kind: 'modified'; current: ExternalDocument }
  | { kind: 'deleted'; current: null }
  | { kind: 'untracked-existing'; current: ExternalDocument }

export interface ExternalConflict {
  identity: DocumentIdentity
  reason: 'modified' | 'deleted' | 'untracked-existing'
  base: FileFingerprint | null
  localXml: string
  external: ExternalDocument | null
}

export type ExternalConflictDecision =
  | { kind: 'compare' }
  | { kind: 'reload-external' }
  | { kind: 'overwrite'; confirmed: true }
  | { kind: 'save-as'; path: string }
  | { kind: 'cancel' }

export function sameContentFingerprint(
  a: FileFingerprint,
  b: FileFingerprint
): boolean {
  return a.hash.trim().toLowerCase() === b.hash.trim().toLowerCase()
}

export function sameFileMetadata(a: FileFingerprint, b: FileFingerprint): boolean {
  return a.size === b.size && a.modifiedAt === b.modifiedAt
}

/**
 * Content hash is authoritative. A timestamp-only change is surfaced so the
 * base metadata can be refreshed, but it must not create a false conflict.
 */
export function classifyExternalState(
  base: FileFingerprint | null,
  current: ExternalDocument | null
): ExternalState {
  if (!base) {
    return current ? { kind: 'untracked-existing', current } : { kind: 'new', current: null }
  }
  if (!current) return { kind: 'deleted', current: null }
  if (sameContentFingerprint(base, current.fingerprint)) {
    return {
      kind: 'unchanged',
      current,
      metadataChanged: !sameFileMetadata(base, current.fingerprint)
    }
  }
  return { kind: 'modified', current }
}

export function toExternalConflict(
  identity: DocumentIdentity,
  base: FileFingerprint | null,
  localXml: string,
  state: Extract<ExternalState, { kind: 'modified' | 'deleted' | 'untracked-existing' }>
): ExternalConflict {
  return {
    identity,
    reason: state.kind,
    base,
    localXml,
    external: state.current
  }
}

export function isTerminalConflictDecision(decision: ExternalConflictDecision): boolean {
  return decision.kind !== 'compare'
}
