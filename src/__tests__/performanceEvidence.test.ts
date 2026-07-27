import { describe, expect, it } from 'vitest'

import {
  LOCAL_DEVELOPMENT_HARDWARE_PROFILE,
  RELEASE_REFERENCE_HARDWARE_PROFILE,
  evaluatePerformanceHardwareProfile,
  evaluatePerformanceSourceBinding,
  type PerformanceRuntimeObservation
} from '../../scripts/performanceEvidence'

const SHA = 'a'.repeat(40)

function runtime(
  overrides: Partial<PerformanceRuntimeObservation> = {}
): PerformanceRuntimeObservation {
  return {
    node: 'v22.22.0',
    platform: 'linux',
    release: '6.11.0',
    architecture: 'x64',
    cpuModel: 'Observed CI processor',
    logicalCpus: 4,
    totalMemoryBytes: 16 * 1024 ** 3,
    githubActions: true,
    runnerOs: 'Linux',
    runnerArch: 'X64',
    runnerName: 'GitHub Actions 1',
    imageOs: 'ubuntu24',
    imageVersion: '20260720.1',
    ...overrides
  }
}

describe('performance evidence binding', () => {
  it('qualifies only an observed runner matching the declared reference class', () => {
    const evidence = evaluatePerformanceHardwareProfile(
      RELEASE_REFERENCE_HARDWARE_PROFILE,
      runtime()
    )

    expect(evidence.matched).toBe(true)
    expect(evidence.referenceEligible).toBe(true)
    expect(evidence.providerManagedVariableHardware).toBe(true)
    expect(evidence.referenceDefinition).toContain('do not claim a fixed physical host')
  })

  it('rejects a mislabeled, undersized, or non-CI runner', () => {
    const evidence = evaluatePerformanceHardwareProfile(
      RELEASE_REFERENCE_HARDWARE_PROFILE,
      runtime({
        githubActions: false,
        runnerOs: null,
        runnerArch: 'ARM64',
        imageOs: 'ubuntu22',
        logicalCpus: 1,
        totalMemoryBytes: 2 * 1024 ** 3
      })
    )

    expect(evidence.matched).toBe(false)
    expect(evidence.referenceEligible).toBe(false)
    expect(evidence.mismatches).toEqual(
      expect.arrayContaining([
        'GITHUB_ACTIONS must be true',
        'RUNNER_OS must be Linux',
        'RUNNER_ARCH must be X64',
        'ImageOS must identify the ubuntu24 runner image',
        'logical CPU count must be at least 2'
      ])
    )
  })

  it('labels local timings as development-only instead of reference evidence', () => {
    const evidence = evaluatePerformanceHardwareProfile(
      LOCAL_DEVELOPMENT_HARDWARE_PROFILE,
      runtime({ githubActions: false })
    )

    expect(evidence.matched).toBe(true)
    expect(evidence.referenceEligible).toBe(false)
    expect(evidence.classification).toBe('unqualified-development-runner')
    expect(evidence.providerManagedVariableHardware).toBe(false)
  })

  it('requires a clean exact candidate binding for release eligibility', () => {
    expect(
      evaluatePerformanceSourceBinding({
        expectedCandidateSha: SHA,
        gitHeadSha: SHA.toUpperCase(),
        worktreeDirty: false
      }).releaseEligible
    ).toBe(true)
    expect(
      evaluatePerformanceSourceBinding({
        expectedCandidateSha: SHA,
        gitHeadSha: 'b'.repeat(40),
        worktreeDirty: false
      }).releaseEligible
    ).toBe(false)
    expect(
      evaluatePerformanceSourceBinding({
        expectedCandidateSha: SHA,
        gitHeadSha: SHA,
        worktreeDirty: true
      }).releaseEligible
    ).toBe(false)
  })
})
