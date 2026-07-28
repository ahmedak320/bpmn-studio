import { deriveFileBaseName } from '../core/newProcessDoc'

export type GeneratedPlacementDiscardReason = 'stale-workspace' | 'cancelled'

/**
 * Host result for one generated BPMN placement. Every success names where the
 * diagram actually landed; a discarded result is never interchangeable with
 * the fallback mode's successful in-memory tab.
 */
export type GeneratedPlacementOutcome =
  | {
      status: 'persisted'
      label: string
    }
  | {
      status: 'opened-in-memory'
      label: string
    }
  | {
      status: 'discarded'
      reason: GeneratedPlacementDiscardReason
    }

/** Stable, filesystem-safe name for downloading an otherwise discarded result. */
export function generatedRecoveryFileName(requestedName: string): string {
  return `${deriveFileBaseName(requestedName || 'process')}-recovery.bpmn`
}

/** Exact generated XML represented as the same browser-download URL used elsewhere. */
export function generatedBpmnDataUrl(xml: string): string {
  return `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`
}

export interface GeneratedRecoveryArtifact {
  xml: string
  fileName: string
  reason: GeneratedPlacementDiscardReason
}

type GeneratedRecoveryListener = () => void

let retainedRecovery: GeneratedRecoveryArtifact | null = null
const recoveryListeners = new Set<GeneratedRecoveryListener>()

function emitRecoveryChange(): void {
  for (const listener of recoveryListeners) listener()
}

/**
 * Retain one exact discarded output in session memory. The store intentionally
 * outlives AiPanel's workspace-keyed React instance, so switching workspaces
 * cannot erase the recovery control along with the old panel.
 */
export function retainGeneratedRecovery(
  xml: string,
  requestedName: string,
  reason: GeneratedPlacementDiscardReason
): void {
  retainedRecovery = Object.freeze({
    xml,
    fileName: generatedRecoveryFileName(requestedName),
    reason
  })
  emitRecoveryChange()
}

export function clearGeneratedRecovery(): void {
  if (retainedRecovery === null) return
  retainedRecovery = null
  emitRecoveryChange()
}

export function getGeneratedRecoverySnapshot(): GeneratedRecoveryArtifact | null {
  return retainedRecovery
}

export function subscribeGeneratedRecovery(listener: GeneratedRecoveryListener): () => void {
  recoveryListeners.add(listener)
  return () => recoveryListeners.delete(listener)
}
