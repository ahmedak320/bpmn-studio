import { execFileSync } from 'node:child_process'
import { arch, cpus, platform, release, totalmem } from 'node:os'

const GIB = 1024 ** 3

export const RELEASE_REFERENCE_HARDWARE_PROFILE = 'github-hosted-ubuntu-24.04-x64-runner-class-v1'
export const LOCAL_DEVELOPMENT_HARDWARE_PROFILE = 'local-development-unqualified'

export interface PerformanceRuntimeObservation {
  readonly node: string
  readonly platform: string
  readonly release: string
  readonly architecture: string
  readonly cpuModel: string
  readonly logicalCpus: number
  readonly totalMemoryBytes: number
  readonly githubActions: boolean
  readonly runnerOs: string | null
  readonly runnerArch: string | null
  readonly runnerName: string | null
  readonly imageOs: string | null
  readonly imageVersion: string | null
}

export interface PerformanceHardwareProfileEvidence {
  readonly id: string
  readonly classification:
    'declared-provider-managed-reference-runner-class' | 'unqualified-development-runner'
  readonly declaredRunnerLabel: string | null
  readonly providerManagedVariableHardware: boolean
  readonly referenceDefinition: string
  readonly requirements: {
    readonly githubActions: boolean | null
    readonly runnerOs: string | null
    readonly runnerArch: string | null
    readonly imageOsPattern: string | null
    readonly minimumLogicalCpus: number | null
    readonly minimumTotalMemoryBytes: number | null
  }
  readonly observation: PerformanceRuntimeObservation
  readonly matched: boolean
  readonly referenceEligible: boolean
  readonly mismatches: readonly string[]
}

export interface PerformanceSourceEvidence {
  readonly expectedCandidateSha: string
  readonly gitHeadSha: string
  readonly exactCandidateMatch: boolean
  readonly worktreeDirty: boolean
  readonly releaseEligible: boolean
}

export interface SourceBindingInput {
  readonly expectedCandidateSha: string
  readonly gitHeadSha: string
  readonly worktreeDirty: boolean
}

function nullableEnvironmentValue(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function observePerformanceRuntime(
  environment: NodeJS.ProcessEnv = process.env
): PerformanceRuntimeObservation {
  return {
    node: process.version,
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    githubActions: environment.GITHUB_ACTIONS === 'true',
    runnerOs: nullableEnvironmentValue(environment.RUNNER_OS),
    runnerArch: nullableEnvironmentValue(environment.RUNNER_ARCH),
    runnerName: nullableEnvironmentValue(environment.RUNNER_NAME),
    imageOs: nullableEnvironmentValue(environment.ImageOS),
    imageVersion: nullableEnvironmentValue(environment.ImageVersion)
  }
}

export function evaluatePerformanceHardwareProfile(
  profileId: string,
  observation: PerformanceRuntimeObservation
): PerformanceHardwareProfileEvidence {
  if (profileId === LOCAL_DEVELOPMENT_HARDWARE_PROFILE) {
    return {
      id: profileId,
      classification: 'unqualified-development-runner',
      declaredRunnerLabel: null,
      providerManagedVariableHardware: false,
      referenceDefinition:
        'Local development timing only. This profile is deliberately ineligible for release-reference evidence.',
      requirements: {
        githubActions: null,
        runnerOs: null,
        runnerArch: null,
        imageOsPattern: null,
        minimumLogicalCpus: null,
        minimumTotalMemoryBytes: null
      },
      observation,
      matched: true,
      referenceEligible: false,
      mismatches: []
    }
  }

  if (profileId !== RELEASE_REFERENCE_HARDWARE_PROFILE) {
    throw new Error(`Unknown performance hardware profile: ${profileId}`)
  }

  const minimumLogicalCpus = 2
  const minimumTotalMemoryBytes = 6 * GIB
  const mismatches: string[] = []
  if (!observation.githubActions) mismatches.push('GITHUB_ACTIONS must be true')
  if (observation.runnerOs !== 'Linux') mismatches.push('RUNNER_OS must be Linux')
  if (observation.runnerArch !== 'X64') mismatches.push('RUNNER_ARCH must be X64')
  if (!/^ubuntu24(?:$|[-.])/u.test(observation.imageOs ?? '')) {
    mismatches.push('ImageOS must identify the ubuntu24 runner image')
  }
  if (observation.platform !== 'linux') mismatches.push('runtime platform must be linux')
  if (observation.architecture !== 'x64') mismatches.push('runtime architecture must be x64')
  if (observation.logicalCpus < minimumLogicalCpus) {
    mismatches.push(`logical CPU count must be at least ${minimumLogicalCpus}`)
  }
  if (observation.totalMemoryBytes < minimumTotalMemoryBytes) {
    mismatches.push(`total memory must be at least ${minimumTotalMemoryBytes} bytes`)
  }

  const matched = mismatches.length === 0
  return {
    id: profileId,
    classification: 'declared-provider-managed-reference-runner-class',
    declaredRunnerLabel: 'ubuntu-24.04',
    providerManagedVariableHardware: true,
    referenceDefinition:
      'Reference results apply to the declared GitHub-hosted ubuntu-24.04 x64 runner class and the exact observed CPU/memory recorded here; they do not claim a fixed physical host or CPU model.',
    requirements: {
      githubActions: true,
      runnerOs: 'Linux',
      runnerArch: 'X64',
      imageOsPattern: '^ubuntu24(?:$|[-.])',
      minimumLogicalCpus,
      minimumTotalMemoryBytes
    },
    observation,
    matched,
    referenceEligible: matched,
    mismatches
  }
}

function exactCommitSha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{40}$/u.test(normalized)) {
    throw new Error(`${label} must be an exact 40-character hexadecimal commit SHA.`)
  }
  return normalized
}

export function evaluatePerformanceSourceBinding(
  input: SourceBindingInput
): PerformanceSourceEvidence {
  const expectedCandidateSha = exactCommitSha(
    input.expectedCandidateSha,
    'Expected performance candidate SHA'
  )
  const gitHeadSha = exactCommitSha(input.gitHeadSha, 'Performance checkout HEAD')
  const exactCandidateMatch = expectedCandidateSha === gitHeadSha
  return {
    expectedCandidateSha,
    gitHeadSha,
    exactCandidateMatch,
    worktreeDirty: input.worktreeDirty,
    releaseEligible: exactCandidateMatch && !input.worktreeDirty
  }
}

function gitOutput(arguments_: readonly string[], cwd: string): string {
  return execFileSync('git', arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

export function collectPerformanceSourceBinding(
  expectedCandidateSha: string | undefined,
  cwd = process.cwd()
): PerformanceSourceEvidence {
  const gitHeadSha = gitOutput(['rev-parse', 'HEAD'], cwd)
  const expected = expectedCandidateSha?.trim() || gitHeadSha
  const worktreeDirty = gitOutput(['status', '--porcelain=v1', '--untracked-files=all'], cwd) !== ''
  return evaluatePerformanceSourceBinding({
    expectedCandidateSha: expected,
    gitHeadSha,
    worktreeDirty
  })
}

export function performanceArgumentValue(
  name: string,
  arguments_: readonly string[] = process.argv.slice(2)
): string | undefined {
  const prefix = `--${name}=`
  return arguments_.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

export function selectedPerformanceHardwareProfile(
  arguments_: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env
): string {
  return (
    performanceArgumentValue('hardware-profile', arguments_) ??
    environment.ORBITPM_PERFORMANCE_HARDWARE_PROFILE ??
    LOCAL_DEVELOPMENT_HARDWARE_PROFILE
  )
}

export function expectedPerformanceCandidateSha(
  arguments_: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env
): string | undefined {
  return (
    performanceArgumentValue('candidate-sha', arguments_) ??
    environment.ORBITPM_PERFORMANCE_EXPECTED_SHA ??
    environment.GITHUB_SHA
  )
}
