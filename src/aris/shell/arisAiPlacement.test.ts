/** Plan §16.7 — placement refusal and recoverable download. */

import { describe, expect, it } from 'vitest'

import {
  arisAiRecoveryArtifact,
  arisAiRecoveryFileName,
  resolveArisAiPlacement
} from './arisAiPlacement'

describe('resolveArisAiPlacement', () => {
  it('places when the workspace is unchanged and nothing was cancelled', () => {
    expect(
      resolveArisAiPlacement({
        requestedWorkspaceId: 'directory:Docs',
        currentWorkspaceId: 'directory:Docs',
        aborted: false
      })
    ).toEqual({ status: 'place' })
  })

  it('refuses to write into a workspace that changed during generation', () => {
    expect(
      resolveArisAiPlacement({
        requestedWorkspaceId: 'directory:Docs',
        currentWorkspaceId: 'directory:Other',
        aborted: false
      })
    ).toEqual({ status: 'discarded', reason: 'stale-workspace' })
  })

  it('refuses when the workspace was closed entirely', () => {
    expect(
      resolveArisAiPlacement({
        requestedWorkspaceId: 'directory:Docs',
        currentWorkspaceId: null,
        aborted: false
      })
    ).toEqual({ status: 'discarded', reason: 'stale-workspace' })
  })

  it('reports cancellation ahead of workspace identity', () => {
    expect(
      resolveArisAiPlacement({
        requestedWorkspaceId: 'directory:Docs',
        currentWorkspaceId: 'directory:Other',
        aborted: true
      })
    ).toEqual({ status: 'discarded', reason: 'cancelled' })
  })
})

describe('recovery artifact', () => {
  it('derives a filesystem-safe .aml name', () => {
    expect(arisAiRecoveryFileName('Permit renewal')).toBe('Permit-renewal-recovery.aml')
    expect(arisAiRecoveryFileName('  ../../etc/passwd ')).toBe('etc-passwd-recovery.aml')
    expect(arisAiRecoveryFileName('')).toBe('aris-model-recovery.aml')
    expect(arisAiRecoveryFileName('طلب الموافقة')).toBe('طلب-الموافقة-recovery.aml')
  })

  it('preserves the exact generated AML bytes for download', () => {
    const xml = '<?xml version="1.0"?>\n<AML/>\n'
    const artifact = arisAiRecoveryArtifact('Permit renewal', xml, 'stale-workspace')
    expect(artifact.fileName).toBe('Permit-renewal-recovery.aml')
    expect(artifact.mimeType).toBe('application/xml')
    expect(artifact.reason).toBe('stale-workspace')
    expect(new TextDecoder().decode(artifact.bytes)).toBe(xml)
  })
})
