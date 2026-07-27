import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page
} from '@playwright/test'

import { makeFreeTranslateTexts } from '../src/ai/freeTranslate'
import { CANONICAL_FIELDS_BY_SHEET } from '../src/spreadsheet/aliases'
import {
  SpreadsheetBilingualAudit,
  SpreadsheetBpmnGenerator
} from '../src/spreadsheet/bpmnGeneration'
import {
  OFFICIAL_TEMPLATE_VERSION,
  type CanonicalSheet,
  type ParsedWorkbookData,
  type WorkbookCell
} from '../src/spreadsheet/contracts'
import {
  BrowserImportDeliveryTransactionFactory,
  EmptySpreadsheetDestinationInspector
} from '../src/spreadsheet/destinationAdapters'
import { applyGraphInferencePlan, createGraphInferencePlan } from '../src/spreadsheet/inference'
import { buildProcessWorkbookModel, officialTemplatePreset } from '../src/spreadsheet/modelBuilder'
import { OFFICIAL_SHEET_NAMES } from '../src/spreadsheet/officialTemplate'
import {
  executeTransactionalImportPlan,
  prepareTransactionalImportPlan
} from '../src/spreadsheet/transaction'
import { AdapterSessionPersistence } from '../src/sessions/adapterPersistence'
import { DocumentSessionController } from '../src/sessions/controller'
import {
  DraftJournalCoordinator,
  MemoryDraftJournal,
  findDraftRecoveryComparison
} from '../src/sessions/draftJournal'
import type { FileFingerprint, WorkspaceIdentity } from '../src/sessions/types'
import {
  MemoryWorkspaceAdapter,
  type FileSnapshot,
  type WorkspaceAdapter
} from '../src/workspace/adapters'
import { PortableHistoryManager } from '../src/workspace/history/historyManager'
import { installReliabilityWorkspace } from '../tests/e2e/fixtures/reliability-fsa'

const APP_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
const DEFAULT_DURATION_MS = 48 * 60 * 60 * 1_000
const SMOKE_DURATION_MS = 60_000
const DEFAULT_CYCLE_DELAY_MS = 1_000
const DEFAULT_SAMPLE_EVERY_CYCLES = 60
const DEFAULT_EVIDENCE_EVERY_CYCLES = 60
const DEFAULT_SUPPORT_SAMPLE_INTERVAL_MINUTES = 60
const DEFAULT_BROWSER_INTERVAL_MS = 5 * 60 * 1_000
const MAX_TREND_SAMPLES = 4_096
const MAX_BROWSER_HEARTBEATS = 2_048
const MAX_BROWSER_DIAGNOSTICS = 100
const MAX_FAILURE_RECORDS = 100
const MAX_CONSECUTIVE_FAILURES = 3
const BROWSER_HEARTBEAT_GRACE_MS = 60_000
const SUPPORT_SAMPLE_GRACE_MS = 5 * 60 * 1_000
const MAX_SUPPORT_SAMPLE_INTERVAL_MINUTES = 60
const SUPPORT_SCHEMA_VERSION = 2
const JOURNAL_SCHEMA_VERSION = 1
const JOURNAL_HASH_ALGORITHM = 'sha256-canonical-json-v1'
const JOURNAL_HASH_DOMAIN = 'orbitpm-lite-soak-journal-v1\n'
const JOURNAL_GENESIS_HASH = '0'.repeat(64)
const UI_HISTORY_RETENTION_LIMIT = 20

const MIB = 1024 * 1024
export const SOAK_LOCALES = ['en', 'ar'] as const
export const SOAK_SCENARIOS = [
  'edits',
  'recovery',
  'workspace-switching',
  'imports',
  'translation-cancellation',
  'history-cleanup'
] as const
export const SOAK_RETENTION_CHECKS = [
  'draft-recovery',
  'history-retention',
  'workspace-state'
] as const
export type SoakLocale = (typeof SOAK_LOCALES)[number]
export type SoakScenario = (typeof SOAK_SCENARIOS)[number]
export type SoakRetentionCheck = (typeof SOAK_RETENTION_CHECKS)[number]

const SAMPLE_SCENARIO_MATRIX = SOAK_SCENARIOS.flatMap((scenario) =>
  SOAK_LOCALES.map((locale) => ({ locale, scenario }))
)

const LIMITS = Object.freeze({
  historyRevisionsPerProcess: 3,
  historyBytesPerWorkspace: 512 * 1024,
  draftsPerWorkspaceAfterCycle: 0,
  filesPerWorkspace: 7,
  directoriesPerWorkspace: 3,
  bytesPerWorkspace: 576 * 1024,
  retainedHeapGrowthBytes: 192 * MIB,
  retainedRssGrowthBytes: 384 * MIB,
  heapGrowthBytesPerHour: 32 * MIB,
  rssGrowthBytesPerHour: 64 * MIB,
  hardHeapGrowthBytes: 512 * MIB,
  hardRssGrowthBytes: 512 * MIB,
  memoryMinimumSamples: 20,
  memoryMinimumCycles: 100,
  memoryRateMinimumElapsedMs: 60 * 60 * 1_000,
  rendererRetainedHeapGrowthBytes: 256 * MIB,
  rendererHardHeapGrowthBytes: 512 * MIB,
  rendererHeapGrowthBytesPerHour: 64 * MIB,
  rendererStorageGrowthBytes: 64 * MIB,
  rendererHardStorageGrowthBytes: 128 * MIB,
  rendererWebStorageGrowthCodeUnits: 1_000_000,
  // One bounded imported editor remains mounted per localized context so the
  // production tab/session path is represented throughout the endurance run.
  rendererDomNodeGrowth: 8_000,
  rendererHardDomNodeGrowth: 8_000,
  rendererMinimumHeartbeats: 12,
  rendererRateMinimumElapsedMs: 60 * 60 * 1_000
})

export interface SoakConfig {
  durationMs: number
  maxCycles: number | null
  cycleDelayMs: number
  outputPath: string
  smoke: boolean
  sampleEveryCycles: number
  evidenceEveryCycles: number
  supportSampleIntervalMinutes: number
  supportOutputPath: string
  browserIntervalMs: number
  candidateSha: string | null
  artifactPath: string
  artifactExplicit: boolean
  allowDirty: boolean
}

interface OperationCounts {
  browserUiReceipts: number
  sessionOpens: number
  edits: number
  confirmedSaves: number
  conflictsDetected: number
  staleWorkspaceRejections: number
  workspaceSwitches: number
  draftRecoveryReviews: number
  draftRecoveriesCommitted: number
  historyRevisionsCreated: number
  historyRetentionPasses: number
  spreadsheetModelsBuilt: number
  spreadsheetArtifactsGenerated: number
  spreadsheetImportsCommitted: number
  translationCancellations: number
}

interface WorkspaceStorageSample {
  workspaceId: string
  files: number
  directories: number
  fileBytes: number
  historyRevisions: number
  historyBytes: number
  historyIssues: number
  drafts: number
}

interface MemorySample {
  cycle: number
  elapsedMs: number
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
  storage: readonly WorkspaceStorageSample[]
}

export interface AutomatedSoakSample {
  capturedAt: string
  elapsedMs: number
  residentMemoryBytes: number
  storageBytes: number
  locale: SoakLocale
  scenario: SoakScenario
  healthy: boolean
  sequence: number
  completedOperations: number
  completedScenarioCycles: number
}

interface ScenarioOutcome {
  locale: SoakLocale
  scenario: SoakScenario
  completedCycles: number
  lastCompletedCycle: number | null
  journalSequences: number[]
}

export interface BrowserUiAssertion {
  name: string
  passed: true
  observed: string | number | boolean
}

export interface BrowserUiReceipt {
  receiptVersion: 1
  evidenceSource: 'exact-bound-html-production-ui'
  contextId: 'persistent-en' | 'persistent-ar'
  locale: SoakLocale
  scenario: SoakScenario
  artifactSha256: string
  artifactSizeBytes: number
  documentUrl: string
  browserLocale: 'en-US' | 'ar-AE'
  direction: 'ltr' | 'rtl'
  interaction: string
  productionSelectors: readonly string[]
  interactionCount: number
  beforeStateSha256: string
  afterStateSha256: string
  assertions: readonly BrowserUiAssertion[]
}

export interface SoakJournalCheckpoint {
  sampleSequence: number
  completedOperations: number
  completedScenarioCycles: number
  residentMemoryBytes: number
  storageBytes: number
  healthy: boolean
}

export interface SoakJournalEntry {
  sequence: number
  kind: 'operation' | 'checkpoint'
  capturedAt: string
  elapsedMs: number
  locale: SoakLocale | null
  scenario: SoakScenario | null
  artifactSha256: string
  previousHash: string
  browserReceipt: BrowserUiReceipt | null
  checkpoint: SoakJournalCheckpoint | null
  entryHash: string
}

export interface DiagnosticBinding {
  url: string
  sha256: string
  sizeBytes: number
}

export interface AutomatedSoakRecord {
  schemaVersion: 2
  evidenceType: 'orbitpm-lite-soak-automation'
  candidateSha: string
  artifactSha256: string
  diagnosticEvidenceUrl: string
  diagnosticEvidenceSha256: string
  diagnosticEvidenceSizeBytes: number
  journalSchemaVersion: 1
  journalHashAlgorithm: 'sha256-canonical-json-v1'
  journalEntryCount: number
  journalRootSha256: string
  journal: readonly SoakJournalEntry[]
  status: 'passed' | 'failed' | 'interrupted' | 'smoke-passed' | 'smoke-failed'
  harnessPassed: boolean
  passed: boolean
  releaseEligible: boolean
  smoke: boolean
  uninterrupted: boolean
  restarts: 0
  startedAt: string
  completedAt: string
  durationMs: number
  durationRequirementMs: number
  durationRequirementSatisfied: boolean
  locales: readonly SoakLocale[]
  scenarios: readonly SoakScenario[]
  retentionChecks: readonly SoakRetentionCheck[]
  sampleIntervalMinutes: number
  samples: readonly AutomatedSoakSample[]
  maxResidentMemoryGrowthBytes: number
  maxStorageGrowthBytes: number
  observedResidentMemoryGrowthBytes: number
  observedStorageGrowthBytes: number
  scenarioResults: readonly {
    locale: SoakLocale
    scenario: SoakScenario
    passed: boolean
    completedCycles: number
    uiReceiptCount: number
    firstJournalSequence: number | null
    lastJournalSequence: number | null
    findings: string
  }[]
  retentionResults: readonly [
    {
      check: 'draft-recovery'
      passed: boolean
      metrics: {
        uiRecoveryReceipts: number
        restoredDrafts: number
        pendingDraftsAtCompletion: number
      }
      findings: string
    },
    {
      check: 'history-retention'
      passed: boolean
      metrics: {
        uiHistoryReceipts: number
        retentionLimit: number
        maximumVisibleRevisions: number
        retainedBpmnFiles: number
        retainedMetadataFiles: number
        oldestSeedPruned: boolean
      }
      findings: string
    },
    {
      check: 'workspace-state'
      passed: boolean
      metrics: {
        uiWorkspaceSwitchReceipts: number
        pickerCancellations: number
        workspacePreserved: boolean
        uiImportReceipts: number
      }
      findings: string
    }
  ]
  candidateEndpoints: {
    requiredSha: string | null
    headShaAtStart: string
    headShaAtEnd: string | null
    cleanAtStart: boolean
    cleanAtEnd: boolean | null
    matchedAtStart: boolean
    matchedAtEnd: boolean | null
  }
  artifactEndpoints: {
    sha256AtStart: string
    sha256AtEnd: string | null
    sizeBytesAtStart: number
    sizeBytesAtEnd: number | null
    matchedAtEnd: boolean | null
  }
  clock: {
    wallClock: 'UTC'
    elapsedClock: 'performance.now'
    timestampDerivation: 'startedAt-plus-monotonic-elapsed'
  }
  findings: string
}

interface FailureRecord {
  cycle: number
  elapsedMs: number
  phase: string
  name: string
  message: string
  check?: string
  details?: Record<string, unknown>
  stack?: string
}

interface ArtifactIdentity {
  path: string
  url: string
  sha256: string
  sizeBytes: number
  modifiedAtMs: number
}

interface CandidateIdentity {
  gitRoot: string
  requiredSha: string | null
  headShaAtStart: string
  headShaAtEnd: string | null
  dirtyAtStart: readonly string[]
  dirtyAtEnd: readonly string[] | null
  cleanRequired: boolean
  artifactAtStart: ArtifactIdentity
  artifactAtEnd: ArtifactIdentity | null
  matchedAtStart: boolean
  matchedAtEnd: boolean | null
  evidenceTargets: EvidenceOutputTargets
}

export interface EvidenceTargetIdentity {
  path: string
  parentRealpath: string
  parentDevice: number
  parentInode: number
}

export interface EvidenceOutputTargets {
  output: EvidenceTargetIdentity
  support: EvidenceTargetIdentity
  gitRoot: string
  gitDir: string
}

interface BrowserHeartbeat {
  stage: 'start' | 'interval' | 'end'
  cycle: number
  elapsedMs: number
  frameLatencyMs: number
  readyState: string
  title: string
  editorSvgVisible: boolean
  horizontalOverflow: boolean
  documentWidth: number
  viewportWidth: number
  pageErrors: readonly string[]
  consoleErrors: readonly string[]
  unexpectedRequests: readonly string[]
  diagnosticsTruncated: number
  locales: readonly BrowserLocaleHeartbeat[]
  renderer: {
    jsHeapUsedBytes: number
    jsHeapTotalBytes: number
    domNodes: number
    documents: number
    eventListeners: number
    storageUsageBytes: number | null
    storageQuotaBytes: number | null
    localStorageCodeUnits: number
    sessionStorageCodeUnits: number
  }
}

interface BrowserLocaleHeartbeat {
  locale: SoakLocale
  browserLocale: 'en-US' | 'ar-AE'
  direction: 'ltr' | 'rtl'
  frameLatencyMs: number
  readyState: string
  title: string
  editorSvgVisible: boolean
  horizontalOverflow: boolean
  documentWidth: number
  viewportWidth: number
  renderer: BrowserHeartbeat['renderer']
}

interface BrowserLocaleProbe {
  locale: SoakLocale
  browserLocale: BrowserLocaleHeartbeat['browserLocale']
  direction: BrowserLocaleHeartbeat['direction']
  context: BrowserContext
  page: Page
  cdp: CDPSession
}

interface BrowserUiWorkloadResult {
  receipt: BrowserUiReceipt
  retention?: {
    restoredDrafts?: number
    pendingDraftsAtCompletion?: number
    retentionLimit?: number
    maximumVisibleRevisions?: number
    retainedBpmnFiles?: number
    retainedMetadataFiles?: number
    oldestSeedPruned?: boolean
    pickerCancellations?: number
    workspacePreserved?: boolean
  }
}

interface UiRetentionState {
  restoredDrafts: number
  pendingDraftsAtCompletion: number
  retentionLimit: number
  maximumVisibleRevisions: number
  retainedBpmnFiles: number
  retainedMetadataFiles: number
  oldestSeedPruned: boolean
  pickerCancellations: number
  workspacePreserved: boolean
}

interface RendererAssessment {
  evaluated: boolean
  rateEvaluated: boolean
  passed: boolean
  reason?: string
  elapsedMs?: number
  retainedHeapGrowthBytes?: number
  heapGrowthBytesPerHour?: number
  storageGrowthBytes?: number | null
  webStorageGrowthCodeUnits?: number
  domNodeGrowth?: number
}

interface MemoryAssessment {
  evaluated: boolean
  passed: boolean
  reason?: string
  firstCycle?: number
  lastCycle?: number
  elapsedMs?: number
  retainedHeapGrowthBytes?: number
  retainedRssGrowthBytes?: number
  heapGrowthBytesPerHour?: number
  rssGrowthBytesPerHour?: number
  rateEvaluated?: boolean
}

interface HarnessState {
  readonly config: SoakConfig
  startedAt: string
  startedWallMs: number
  startedMonotonic: number
  readonly adapters: readonly [MemoryWorkspaceAdapter, MemoryWorkspaceAdapter]
  readonly histories: readonly [PortableHistoryManager, PortableHistoryManager]
  readonly draftJournal: MemoryDraftJournal
  readonly operations: OperationCounts
  readonly candidate: CandidateIdentity
  activeWorkspace: WorkspaceIdentity | null
  workspaceGeneration: number
  cyclesAttempted: number
  cyclesCompleted: number
  cyclesFailed: number
  failedCycleNumbers: Set<number>
  consecutiveFailures: number
  failuresTruncated: number
  failureRecords: FailureRecord[]
  trendSamples: MemorySample[]
  effectiveSampleEveryCycles: number
  evidenceSamples: AutomatedSoakSample[]
  nextEvidenceSampleElapsedMs: number
  scenarioOutcomes: ScenarioOutcome[]
  journal: SoakJournalEntry[]
  uiRetention: UiRetentionState
  browserHeartbeats: BrowserHeartbeat[]
  browserHeartbeatsCompacted: number
  browserHeartbeatCount: number
  maximumBrowserHeartbeatGapMs: number
  effectiveBrowserIntervalMs: number
  lastBrowserHeartbeatElapsedMs: number
  lastStorage: readonly WorkspaceStorageSample[]
  stopSignal: NodeJS.Signals | null
  stopReason: string | null
  currentPhase: string
}

class SoakInvariantError extends Error {
  constructor(
    readonly check: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(`Soak invariant failed: ${check}`)
    this.name = 'SoakInvariantError'
  }
}

function invariant(
  condition: unknown,
  check: string,
  details: Record<string, unknown> = {}
): asserts condition {
  if (!condition) throw new SoakInvariantError(check, details)
}

function finiteInteger(value: string, option: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${option} must be an integer >= ${minimum}; received "${value}".`)
  }
  return parsed
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue }

export function canonicalizeEvidenceJson(value: unknown): string {
  const visit = (candidate: unknown, path: string): string => {
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'string') {
      return JSON.stringify(candidate)
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate) || !Number.isSafeInteger(candidate)) {
        throw new Error(`Canonical evidence JSON requires a safe integer at ${path}.`)
      }
      return JSON.stringify(Object.is(candidate, -0) ? 0 : candidate)
    }
    if (Array.isArray(candidate)) {
      return `[${candidate.map((entry, index) => visit(entry, `${path}[${index}]`)).join(',')}]`
    }
    if (typeof candidate === 'object') {
      const prototype = Object.getPrototypeOf(candidate)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`Canonical evidence JSON requires a plain object at ${path}.`)
      }
      const record = candidate as Record<string, unknown>
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(record[key], `${path}.${key}`)}`)
        .join(',')}}`
    }
    throw new Error(`Canonical evidence JSON cannot encode ${typeof candidate} at ${path}.`)
  }
  return visit(value, '$')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sha256Canonical(value: CanonicalJsonValue): string {
  return sha256Text(canonicalizeEvidenceJson(value))
}

export function computeSoakJournalEntryHash(entry: Omit<SoakJournalEntry, 'entryHash'>): string {
  return sha256Text(`${JOURNAL_HASH_DOMAIN}${canonicalizeEvidenceJson(entry)}`)
}

export function parseArguments(args: readonly string[]): { config: SoakConfig; help: boolean } {
  let smoke = false
  let help = false
  let durationMs: number | undefined
  let maxCycles: number | null | undefined
  let cycleDelayMs: number | undefined
  let outputPath: string | undefined
  let supportOutputPath: string | undefined
  let sampleEveryCycles: number | undefined
  let evidenceEveryCycles: number | undefined
  let supportSampleIntervalMinutes: number | undefined
  let browserIntervalMs: number | undefined
  let candidateSha: string | undefined
  let artifactPath: string | undefined
  let allowDirty = false

  const valueFor = (argument: string, index: number): { value: string; consumed: number } => {
    const separator = argument.indexOf('=')
    if (separator !== -1) {
      const value = argument.slice(separator + 1)
      if (!value) throw new Error(`${argument.slice(0, separator)} requires a value.`)
      return { value, consumed: 0 }
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`)
    return { value, consumed: 1 }
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--smoke') {
      smoke = true
      continue
    }
    if (argument === '--allow-dirty') {
      allowDirty = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    const name = argument.split('=', 1)[0]
    const { value, consumed } = valueFor(argument, index)
    index += consumed
    switch (name) {
      case '--duration-ms':
        durationMs = finiteInteger(value, name, 1)
        break
      case '--cycles':
        maxCycles = finiteInteger(value, name, 1)
        break
      case '--cycle-delay-ms':
        cycleDelayMs = finiteInteger(value, name, 0)
        break
      case '--output':
        outputPath = value
        break
      case '--support-output':
        supportOutputPath = value
        break
      case '--sample-every':
        sampleEveryCycles = finiteInteger(value, name, 1)
        break
      case '--evidence-every':
        evidenceEveryCycles = finiteInteger(value, name, 1)
        break
      case '--evidence-sample-minutes':
        supportSampleIntervalMinutes = finiteInteger(value, name, 1)
        break
      case '--browser-interval-ms':
        browserIntervalMs = finiteInteger(value, name, 0)
        break
      case '--candidate-sha':
        candidateSha = value.toLowerCase()
        break
      case '--artifact':
        artifactPath = value
        break
      default:
        throw new Error(`Unknown soak option: ${name}`)
    }
  }

  if (!help && candidateSha && !/^[a-f0-9]{40}$/.test(candidateSha)) {
    throw new Error('--candidate-sha must be a full 40-character Git commit SHA.')
  }
  if (!help && !smoke && (durationMs ?? DEFAULT_DURATION_MS) < DEFAULT_DURATION_MS) {
    throw new Error('Release soak duration cannot be shorter than 172800000 ms (48 hours).')
  }
  if (!help && !smoke && !candidateSha) {
    throw new Error('--candidate-sha is required for a release soak.')
  }
  if (!help && !smoke && !artifactPath) {
    throw new Error('--artifact is required for a release soak.')
  }
  if (!help && allowDirty && !smoke) {
    throw new Error('--allow-dirty is available only for local smoke runs.')
  }
  if (
    !help &&
    (supportSampleIntervalMinutes ?? DEFAULT_SUPPORT_SAMPLE_INTERVAL_MINUTES) >
      MAX_SUPPORT_SAMPLE_INTERVAL_MINUTES
  ) {
    throw new Error(
      `--evidence-sample-minutes must be an integer from 1 through ${MAX_SUPPORT_SAMPLE_INTERVAL_MINUTES}.`
    )
  }
  const artifactExplicit = artifactPath !== undefined
  const resolvedOutputPath = resolve(outputPath ?? 'soak-results.json')
  const resolvedSupportOutputPath = resolve(supportOutputPath ?? 'soak-support.json')
  const resolvedArtifactPath = resolve(artifactPath ?? 'dist/index.html')
  if (!help && resolvedSupportOutputPath === resolvedOutputPath) {
    throw new Error('--support-output must differ from --output.')
  }
  if (
    !help &&
    (resolvedOutputPath === resolvedArtifactPath ||
      resolvedSupportOutputPath === resolvedArtifactPath)
  ) {
    throw new Error('Soak evidence output paths must not overwrite --artifact.')
  }
  return {
    help,
    config: {
      durationMs: durationMs ?? (smoke ? SMOKE_DURATION_MS : DEFAULT_DURATION_MS),
      maxCycles: maxCycles ?? (smoke ? 8 : null),
      cycleDelayMs: cycleDelayMs ?? (smoke ? 0 : DEFAULT_CYCLE_DELAY_MS),
      outputPath: resolvedOutputPath,
      supportOutputPath: resolvedSupportOutputPath,
      smoke,
      sampleEveryCycles: sampleEveryCycles ?? (smoke ? 1 : DEFAULT_SAMPLE_EVERY_CYCLES),
      evidenceEveryCycles: evidenceEveryCycles ?? (smoke ? 1 : DEFAULT_EVIDENCE_EVERY_CYCLES),
      supportSampleIntervalMinutes:
        supportSampleIntervalMinutes ?? DEFAULT_SUPPORT_SAMPLE_INTERVAL_MINUTES,
      browserIntervalMs: browserIntervalMs ?? (smoke ? 0 : DEFAULT_BROWSER_INTERVAL_MS),
      candidateSha: candidateSha ?? null,
      artifactPath: resolvedArtifactPath,
      artifactExplicit,
      allowDirty
    }
  }
}

function usage(): string {
  return `OrbitPM Lite release-candidate soak gate

Usage:
  vite-node scripts/soak-gate.ts [options]

Options:
  --duration-ms <n>       Wall-clock budget (default: 172800000 / 48 hours)
  --cycles <n>            Optional maximum completed/attempted cycles
  --cycle-delay-ms <n>    Delay between cycles (default: 1000)
  --output <path>         New crash-safe diagnostic JSON path (default: soak-results.json)
  --support-output <path> New compact automated evidence path (default: soak-support.json)
  --sample-every <n>      Initial memory/storage sample cadence in cycles (default: 60)
  --evidence-every <n>    Running evidence checkpoint cadence in cycles (default: 60)
  --evidence-sample-minutes <n>
                          Automated evidence cadence from 1 through 60 minutes (default: 60)
  --browser-interval-ms   Browser endurance heartbeat interval (default: 300000)
  --candidate-sha <sha>   Required exact Git HEAD for a release soak
  --artifact <html>       Exact built/release HTML (required for release)
  --smoke                 Eight cycles, no delay, one-minute outer budget
  --allow-dirty           Permit and record a dirty tree in smoke mode only
  --help                  Show this help

Release mode requires both evidence targets in one real directory outside the Git
worktree and Git directory. Targets must not already exist, be tracked, or resolve
through symlinked parent paths.
`
}

function gitOutput(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function relativeGitPath(gitRoot: string, path: string): string | null {
  const candidate = relative(gitRoot, path)
  if (!candidate || candidate === '..' || candidate.startsWith(`..${sep}`)) return null
  return candidate.split(sep).join('/')
}

function isInside(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`))
}

function targetDoesNotExist(path: string): boolean {
  try {
    lstatSync(path)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

function canonicalNewFileTarget(path: string): EvidenceTargetIdentity {
  invariant(targetDoesNotExist(path), 'evidence target is a new file', { path })
  const requestedParent = dirname(resolve(path))
  const parentStats = statSync(requestedParent)
  invariant(parentStats.isDirectory(), 'evidence target parent is a directory', {
    path,
    parent: requestedParent
  })
  const canonicalParent = realpathSync.native(requestedParent)
  const canonicalTarget = resolve(canonicalParent, basename(path))
  invariant(
    canonicalTarget === resolve(path),
    'evidence target has no symlinked or aliased parent path',
    {
      path,
      canonicalTarget
    }
  )
  return {
    path: canonicalTarget,
    parentRealpath: canonicalParent,
    parentDevice: parentStats.dev,
    parentInode: parentStats.ino
  }
}

function isTrackedPath(gitRoot: string, path: string): boolean {
  const relativePath = relativeGitPath(gitRoot, path)
  if (!relativePath) return false
  try {
    gitOutput(gitRoot, ['ls-files', '--error-unmatch', '--', relativePath])
    return true
  } catch {
    return false
  }
}

export function validateEvidenceOutputTargets(
  config: Pick<SoakConfig, 'artifactPath' | 'outputPath' | 'supportOutputPath' | 'smoke'>,
  repository?: { gitRoot: string; gitDir: string }
): EvidenceOutputTargets {
  const gitRoot = realpathSync.native(
    repository?.gitRoot ?? gitOutput(process.cwd(), ['rev-parse', '--show-toplevel'])
  )
  const gitDir = realpathSync.native(
    repository?.gitDir ?? gitOutput(gitRoot, ['rev-parse', '--path-format=absolute', '--git-dir'])
  )
  const output = canonicalNewFileTarget(config.outputPath)
  const support = canonicalNewFileTarget(config.supportOutputPath)
  const outputPath = output.path
  const supportOutputPath = support.path
  invariant(outputPath !== supportOutputPath, 'evidence targets are distinct', {
    outputPath,
    supportOutputPath
  })
  const artifactPath = realpathSync.native(config.artifactPath)
  invariant(
    outputPath !== artifactPath && supportOutputPath !== artifactPath,
    'evidence targets do not alias the tested artifact',
    {
      artifactPath,
      outputPath,
      supportOutputPath
    }
  )
  for (const path of [outputPath, supportOutputPath]) {
    invariant(!isTrackedPath(gitRoot, path), 'evidence target is not a tracked Git path', {
      path
    })
  }
  if (!config.smoke) {
    for (const path of [outputPath, supportOutputPath]) {
      invariant(!isInside(gitDir, path), 'release evidence target is outside the Git directory', {
        gitDir,
        path
      })
      invariant(!isInside(gitRoot, path), 'release evidence target is outside the Git worktree', {
        gitRoot,
        path
      })
    }
    invariant(
      dirname(outputPath) === dirname(supportOutputPath),
      'release evidence targets share one publication directory',
      {
        outputPath,
        supportOutputPath
      }
    )
  }
  return { output, support, gitRoot, gitDir }
}

export function revalidateEvidenceTarget(identity: EvidenceTargetIdentity): void {
  invariant(targetDoesNotExist(identity.path), 'evidence target remains a new file', {
    path: identity.path
  })
  const parentPath = dirname(identity.path)
  const parentRealpath = realpathSync.native(parentPath)
  const parentStats = statSync(parentPath)
  invariant(
    parentRealpath === identity.parentRealpath &&
      parentStats.dev === identity.parentDevice &&
      parentStats.ino === identity.parentInode,
    'evidence target parent identity is unchanged since preflight',
    {
      path: identity.path,
      expectedParentRealpath: identity.parentRealpath,
      actualParentRealpath: parentRealpath,
      expectedParentDevice: identity.parentDevice,
      actualParentDevice: parentStats.dev,
      expectedParentInode: identity.parentInode,
      actualParentInode: parentStats.ino
    }
  )
}

function dirtyGitEntries(gitRoot: string): readonly string[] {
  const output = gitOutput(gitRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    '.'
  ])
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}

function artifactIdentity(path: string): ArtifactIdentity {
  const stats = statSync(path)
  invariant(stats.isFile(), 'candidate artifact is a regular file', { path })
  invariant(path.toLowerCase().endsWith('.html'), 'candidate artifact is HTML', { path })
  const bytes = readFileSync(path)
  const prefix = bytes.subarray(0, Math.min(bytes.length, 512 * 1024)).toString('utf8')
  invariant(
    bytes.length > 0 && /<html[\s>]/i.test(prefix) && prefix.includes('OrbitPM'),
    'candidate artifact identifies OrbitPM HTML',
    { path, sizeBytes: bytes.length }
  )
  return {
    path,
    url: pathToFileURL(path).toString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    modifiedAtMs: stats.mtimeMs
  }
}

function candidateIdentity(config: SoakConfig): CandidateIdentity {
  const targets = validateEvidenceOutputTargets(config)
  const gitRoot = targets.gitRoot
  const headShaAtStart = gitOutput(gitRoot, ['rev-parse', 'HEAD']).toLowerCase()
  const dirtyAtStart = dirtyGitEntries(gitRoot)
  const artifactAtStart = artifactIdentity(config.artifactPath)
  const matchedAtStart =
    (config.candidateSha === null || config.candidateSha === headShaAtStart) &&
    (config.allowDirty || dirtyAtStart.length === 0)
  return {
    gitRoot,
    requiredSha: config.candidateSha,
    headShaAtStart,
    headShaAtEnd: null,
    dirtyAtStart,
    dirtyAtEnd: null,
    cleanRequired: !config.allowDirty,
    artifactAtStart,
    artifactAtEnd: null,
    matchedAtStart,
    matchedAtEnd: null,
    evidenceTargets: targets
  }
}

function finalizeCandidateIdentity(config: SoakConfig, candidate: CandidateIdentity): void {
  candidate.headShaAtEnd = gitOutput(candidate.gitRoot, ['rev-parse', 'HEAD']).toLowerCase()
  candidate.dirtyAtEnd = dirtyGitEntries(candidate.gitRoot)
  candidate.artifactAtEnd = artifactIdentity(config.artifactPath)
  candidate.matchedAtEnd =
    candidate.headShaAtEnd === candidate.headShaAtStart &&
    (candidate.requiredSha === null || candidate.headShaAtEnd === candidate.requiredSha) &&
    (config.allowDirty || candidate.dirtyAtEnd.length === 0) &&
    candidate.artifactAtEnd.sha256 === candidate.artifactAtStart.sha256 &&
    candidate.artifactAtEnd.sizeBytes === candidate.artifactAtStart.sizeBytes
}

interface BrowserUiText {
  chooseFolder: string
  catalog: string
  folderStorage: string
  changeFolder: string
  stepDetails: string
  openDetails: string
  nameEn: string
  nameAr: string
  apply: string
  saveTitle: string
  zoomFitTitle: string
  closeTabTitle: string
  recoveryDraft: string
  restoreDraft: string
  recoveryHistory: string
  previewRevision: string
  cancel: string
  translate: RegExp
  translationReview: string
  translationProvider: string
  translateNow: string
  cancelTranslation: string
  translationCancelled: string
  postponeTranslation: string
  toggleSidePanel: string
  generateWithAi: RegExp
  spreadsheetTab: string
  spreadsheetRegion: string
  downloadExampleSpreadsheet: string
  officialSpreadsheet: RegExp
  ordinarySpreadsheet: RegExp
  defaultNameEn: string
  defaultNameAr: string
  validateSpreadsheet: string
  noWorkbookIssues: string
  prepareBpmn: string
  commitImport: string
  importCommitted: string
}

const BROWSER_UI_TEXT: Readonly<Record<SoakLocale, BrowserUiText>> = {
  en: {
    chooseFolder: 'Choose folder workspace',
    catalog: 'Process catalog',
    folderStorage: 'Storage: Folder workspace',
    changeFolder: 'Change folder…',
    stepDetails: 'Step details',
    openDetails: 'Open Details…',
    nameEn: 'Name (English)',
    nameAr: 'Name (Arabic)',
    apply: 'Apply',
    saveTitle: 'Save (Ctrl+S)',
    zoomFitTitle: 'Zoom to fit the whole diagram (or Ctrl + mouse-wheel to zoom)',
    closeTabTitle: 'Close',
    recoveryDraft: 'Review recovery draft',
    restoreDraft: 'Restore draft',
    recoveryHistory: 'Recovery history',
    previewRevision: 'Preview revision',
    cancel: 'Cancel',
    translate: /Translate/u,
    translationReview: 'Review translation',
    translationProvider: 'Translation provider',
    translateNow: 'Translate now',
    cancelTranslation: 'Cancel translation',
    translationCancelled: 'Translation was cancelled.',
    postponeTranslation: 'Postpone',
    toggleSidePanel: 'Toggle side panel',
    generateWithAi: /Generate with AI/u,
    spreadsheetTab: 'Excel / CSV',
    spreadsheetRegion: 'Import Excel or CSV',
    downloadExampleSpreadsheet: 'Download example template',
    officialSpreadsheet: /Official OrbitPM template detected/u,
    ordinarySpreadsheet: /Ordinary spreadsheet detected/u,
    defaultNameEn: 'Default process name (English)',
    defaultNameAr: 'Default process name (Arabic)',
    validateSpreadsheet: 'Validate and preview',
    noWorkbookIssues: 'No workbook issues found.',
    prepareBpmn: 'Prepare BPMN files',
    commitImport: 'Commit import',
    importCommitted: 'Import committed successfully.'
  },
  ar: {
    chooseFolder: 'اختيار مساحة عمل في مجلد',
    catalog: 'فهرس العمليات',
    folderStorage: 'التخزين: مساحة عمل في مجلد',
    changeFolder: 'تغيير المجلد…',
    stepDetails: 'تفاصيل الخطوة',
    openDetails: 'فتح التفاصيل…',
    nameEn: 'الاسم (بالإنجليزية)',
    nameAr: 'الاسم (بالعربية)',
    apply: 'تطبيق',
    saveTitle: 'حفظ (Ctrl+S)',
    zoomFitTitle: 'ملاءمة عرض المخطط بالكامل (أو Ctrl + عجلة الفأرة للتكبير)',
    closeTabTitle: 'إغلاق',
    recoveryDraft: 'مراجعة مسودة الاسترداد',
    restoreDraft: 'استعادة المسودة',
    recoveryHistory: 'سجل الاسترداد',
    previewRevision: 'معاينة النسخة',
    cancel: 'إلغاء',
    translate: /ترجمة/u,
    translationReview: 'مراجعة الترجمة',
    translationProvider: 'مزوّد الترجمة',
    translateNow: 'ترجم الآن',
    cancelTranslation: 'إلغاء الترجمة',
    translationCancelled: 'أُلغيت الترجمة.',
    postponeTranslation: 'تأجيل',
    toggleSidePanel: 'إظهار/إخفاء اللوحة الجانبية',
    generateWithAi: /إنشاء بالذكاء الاصطناعي/u,
    spreadsheetTab: 'Excel / CSV',
    spreadsheetRegion: 'استيراد Excel أو CSV',
    downloadExampleSpreadsheet: 'تنزيل قالب مثال',
    officialSpreadsheet: /تم اكتشاف قالب OrbitPM الرسمي/u,
    ordinarySpreadsheet: /تم اكتشاف جدول عادي/u,
    defaultNameEn: 'اسم العملية الافتراضي (بالإنجليزية)',
    defaultNameAr: 'اسم العملية الافتراضي (بالعربية)',
    validateSpreadsheet: 'التحقق والمعاينة',
    noWorkbookIssues: 'لا توجد مشكلات في المصنف.',
    prepareBpmn: 'تجهيز ملفات BPMN',
    commitImport: 'تنفيذ الاستيراد',
    importCommitted: 'تم تنفيذ الاستيراد بنجاح.'
  }
}

export function browserWorkloadBpmn(locale: SoakLocale): string {
  const processName = locale === 'ar' ? 'عملية اختبار الصمود' : 'Soak UI process'
  const taskName = locale === 'ar' ? 'مهمة اختبار الصمود' : 'Soak UI task'
  const taskLocalization = `orbitpm:nameEn="Soak UI task" orbitpm:nameAr="مهمة اختبار الصمود" orbitpm:activeLang="${locale}"`
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  id="Definitions_SoakUi_${locale}" targetNamespace="https://orbitpm.ae/soak/ui">
  <bpmn:process id="Process_SoakUi_${locale}" name="${processName}" isExecutable="false"
    orbitpm:nameEn="Soak UI process" orbitpm:nameAr="عملية اختبار الصمود" orbitpm:activeLang="${locale}">
    <bpmn:startEvent id="Start_1" name="${locale === 'ar' ? 'البداية' : 'Start'}"
      orbitpm:nameEn="Start" orbitpm:nameAr="البداية">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="${taskName}" ${taskLocalization}>
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1" name="${locale === 'ar' ? 'النهاية' : 'End'}"
      orbitpm:nameEn="End" orbitpm:nameAr="النهاية">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_SoakUi_${locale}">
    <bpmndi:BPMNPlane id="Plane_SoakUi_${locale}" bpmnElement="Process_SoakUi_${locale}">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="240" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="395" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="186" y="140" /><di:waypoint x="240" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="340" y="140" /><di:waypoint x="395" y="140" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
}

function browserWorkspaceFile(locale: SoakLocale): string {
  return `soak-${locale}.bpmn`
}

class BrowserEnduranceProbe {
  readonly #artifact: ArtifactIdentity
  readonly #pageErrors: string[] = []
  readonly #consoleErrors: string[] = []
  readonly #unexpectedRequests: string[] = []
  #diagnosticsTruncated = 0
  #browser: Browser | null = null
  #probes: BrowserLocaleProbe[] = []
  #translationRequestsAllowed = false

  constructor(artifact: ArtifactIdentity) {
    this.#artifact = artifact
  }

  #record(target: string[], message: string): void {
    if (target.length < MAX_BROWSER_DIAGNOSTICS) target.push(message)
    else this.#diagnosticsTruncated += 1
  }

  async start(cycle: number, elapsedMs: number): Promise<BrowserHeartbeat> {
    this.#browser = await chromium.launch({ headless: true })
    const localeConfigurations = [
      {
        locale: 'en',
        browserLocale: 'en-US',
        direction: 'ltr',
        versionLabel: `Version ${APP_VERSION}`
      },
      {
        locale: 'ar',
        browserLocale: 'ar-AE',
        direction: 'rtl',
        versionLabel: `الإصدار ${APP_VERSION}`
      }
    ] as const
    for (const configuration of localeConfigurations) {
      const context = await this.#browser.newContext({
        colorScheme: 'light',
        locale: configuration.browserLocale,
        reducedMotion: 'reduce',
        viewport: { width: 1280, height: 800 }
      })
      const page = await context.newPage()
      await installReliabilityWorkspace(page, {
        name: `SoakGate-${configuration.locale}`,
        seed: {
          [browserWorkspaceFile(configuration.locale)]: browserWorkloadBpmn(configuration.locale)
        }
      })
      const cdp = await context.newCDPSession(page)
      await cdp.send('Performance.enable')
      const localePrefix = `[${configuration.locale}]`
      page.on('pageerror', (error) =>
        this.#record(this.#pageErrors, `${localePrefix} ${error.message}`)
      )
      page.on('console', (message) => {
        if (message.type() === 'error') {
          this.#record(this.#consoleErrors, `${localePrefix} ${message.text()}`)
        }
      })
      page.on('crash', () =>
        this.#record(this.#pageErrors, `${localePrefix} Chromium page crashed.`)
      )
      page.on('request', (request) => {
        const url = request.url()
        if (
          url === this.#artifact.url ||
          url.startsWith('data:') ||
          url.startsWith('blob:') ||
          (this.#translationRequestsAllowed &&
            (url.startsWith('https://translate.googleapis.com/') ||
              url.startsWith('https://api.mymemory.translated.net/')))
        ) {
          return
        }
        this.#record(
          this.#unexpectedRequests,
          `${localePrefix} ${request.method()} ${request.url()}`
        )
      })
      await page.addInitScript((locale) => {
        localStorage.setItem('orbitpm.lite.lang', locale)
        Object.defineProperty(window, 'showOpenFilePicker', {
          configurable: true,
          value: undefined
        })
      }, configuration.locale)
      await page.goto(this.#artifact.url, { waitUntil: 'load', timeout: 30_000 })
      await page.waitForFunction(
        ({ locale, direction }) =>
          document.documentElement.lang === locale && document.documentElement.dir === direction,
        { locale: configuration.locale, direction: configuration.direction },
        { timeout: 30_000 }
      )
      await page
        .getByRole('heading', { name: 'OrbitPM Process Studio Lite' })
        .waitFor({ state: 'visible', timeout: 30_000 })
      const ui = BROWSER_UI_TEXT[configuration.locale]
      await page.getByRole('button', { name: ui.chooseFolder, exact: true }).click()
      await page.getByRole('heading', { name: ui.catalog }).waitFor({
        state: 'visible',
        timeout: 30_000
      })
      await page
        .locator(
          `.orbitpm-tree-row[data-rel-path="${browserWorkspaceFile(configuration.locale)}"][data-canonical="true"]`
        )
        .click()
      await page.locator('.djs-container svg').first().waitFor({
        state: 'visible',
        timeout: 30_000
      })
      await page
        .locator(`[aria-label="${configuration.versionLabel}"]`)
        .waitFor({ state: 'visible', timeout: 30_000 })
      this.#probes.push({
        locale: configuration.locale,
        browserLocale: configuration.browserLocale,
        direction: configuration.direction,
        context,
        page,
        cdp
      })
    }
    return this.heartbeat('start', cycle, elapsedMs)
  }

  async #stateDigest(probe: BrowserLocaleProbe): Promise<string> {
    const state = await probe.page.evaluate(async () => {
      const modeler = (
        window as unknown as {
          __ORBITPM_LITE__?: {
            modeler?: { saveXML(options: { format: boolean }): Promise<{ xml?: string }> }
          }
        }
      ).__ORBITPM_LITE__?.modeler
      const xml = modeler ? ((await modeler.saveXML({ format: true })).xml ?? null) : null
      const activeTab = document.querySelector<HTMLElement>(
        '[role="tablist"] [role="tab"][aria-selected="true"]'
      )
      return {
        url: window.location.href,
        language: document.documentElement.lang,
        direction: document.documentElement.dir,
        activeTab: activeTab?.getAttribute('aria-label') ?? activeTab?.textContent?.trim() ?? null,
        dirty: Boolean(document.querySelector('.orbitpm-editor__dirty-flag--dirty')),
        visibleDialogs: [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
          .filter((element) => element.getClientRects().length > 0)
          .map(
            (element) => element.getAttribute('aria-label') ?? element.textContent?.slice(0, 80)
          ),
        xml,
        workspace: window.__ORBITPM_RELIABILITY_FS__.snapshot()
      }
    })
    return sha256Canonical(state as unknown as CanonicalJsonValue)
  }

  async #waitForModeler(page: Page): Promise<void> {
    await page.waitForFunction(
      () =>
        Boolean(
          (
            window as unknown as {
              __ORBITPM_LITE__?: { modeler?: unknown }
            }
          ).__ORBITPM_LITE__?.modeler
        ),
      undefined,
      { timeout: 30_000 }
    )
    await page.locator('.djs-container svg:visible').first().waitFor({
      state: 'visible',
      timeout: 30_000
    })
  }

  #sourceRow(page: Page, locale: SoakLocale) {
    return page.locator(
      `.orbitpm-tree-row[data-rel-path="${browserWorkspaceFile(locale)}"][data-canonical="true"]`
    )
  }

  async #openSourceFile(probe: BrowserLocaleProbe): Promise<void> {
    const sourceTab = probe.page.getByRole('tab', {
      name: new RegExp(browserWorkspaceFile(probe.locale).replace('.', '\\.'))
    })
    if (await sourceTab.isVisible().catch(() => false)) {
      await sourceTab.click()
    } else {
      await this.#sourceRow(probe.page, probe.locale).click()
      await sourceTab.waitFor({ state: 'visible', timeout: 20_000 })
    }
    await probe.page.waitForFunction(
      (fileName) =>
        [...document.querySelectorAll<HTMLElement>('[role="tab"]')].some(
          (tab) =>
            tab.getAttribute('aria-selected') === 'true' &&
            (tab.getAttribute('aria-label') ?? tab.textContent ?? '').includes(fileName)
        ),
      browserWorkspaceFile(probe.locale),
      { timeout: 30_000 }
    )
    await this.#waitForModeler(probe.page)
    const taskHit = probe.page
      .locator('.orbitpm-editor .djs-element[data-element-id="Task_1"] .djs-hit:visible')
      .first()
    await taskHit.waitFor({ state: 'visible', timeout: 30_000 })
    const activePanel = taskHit.locator('xpath=ancestor::*[@role="tabpanel"][1]')
    await activePanel
      .locator(`button[title="${BROWSER_UI_TEXT[probe.locale].zoomFitTitle}"]`)
      .click()
  }

  async #editTaskThroughUi(
    probe: BrowserLocaleProbe,
    label: string,
    options: { save: boolean; field?: 'source' | 'target' }
  ): Promise<void> {
    const { page, locale } = probe
    const ui = BROWSER_UI_TEXT[locale]
    await this.#openSourceFile(probe)
    const taskHit = page
      .locator('.orbitpm-editor .djs-element[data-element-id="Task_1"] .djs-hit:visible')
      .first()
    await taskHit.waitFor({ state: 'visible', timeout: 30_000 })
    const activePanel = taskHit.locator('xpath=ancestor::*[@role="tabpanel"][1]')
    await taskHit.dblclick()
    const card = activePanel.locator('.orbitpm-lite-details-card')
    await card.waitFor({ state: 'visible', timeout: 20_000 })
    await card.getByRole('button', { name: ui.openDetails, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: ui.stepDetails })
    await dialog.waitFor({ state: 'visible', timeout: 20_000 })
    const sourceField = locale === 'ar' ? ui.nameAr : ui.nameEn
    const targetField = locale === 'ar' ? ui.nameEn : ui.nameAr
    await dialog.getByLabel(options.field === 'target' ? targetField : sourceField).fill(label)
    await dialog.getByRole('button', { name: ui.apply, exact: true }).click()
    await activePanel.locator('.orbitpm-editor__dirty-flag--dirty').waitFor({
      state: 'visible',
      timeout: 20_000
    })
    await page.waitForTimeout(250)
    if (options.save) {
      await activePanel.locator(`button[title="${ui.saveTitle}"]`).click()
      await activePanel.locator('.orbitpm-editor__dirty-flag--dirty').waitFor({
        state: 'hidden',
        timeout: 30_000
      })
    }
  }

  async #receipt(
    probe: BrowserLocaleProbe,
    scenario: SoakScenario,
    interaction: string,
    productionSelectors: readonly string[],
    interactionCount: number,
    beforeStateSha256: string,
    assertions: readonly BrowserUiAssertion[],
    options: { expectStateChange?: boolean } = {}
  ): Promise<BrowserUiReceipt> {
    const afterStateSha256 = await this.#stateDigest(probe)
    if (options.expectStateChange !== false) {
      invariant(
        beforeStateSha256 !== afterStateSha256,
        'browser UI scenario changes the observed exact-artifact state',
        { locale: probe.locale, scenario }
      )
    }
    invariant(
      assertions.length > 0 && assertions.every(({ passed }) => passed),
      'browser UI receipt assertions passed',
      { locale: probe.locale, scenario }
    )
    invariant(
      probe.page.url() === this.#artifact.url,
      'browser UI receipt uses exact artifact URL',
      {
        locale: probe.locale,
        scenario,
        expected: this.#artifact.url,
        actual: probe.page.url()
      }
    )
    return {
      receiptVersion: 1,
      evidenceSource: 'exact-bound-html-production-ui',
      contextId: `persistent-${probe.locale}`,
      locale: probe.locale,
      scenario,
      artifactSha256: this.#artifact.sha256,
      artifactSizeBytes: this.#artifact.sizeBytes,
      documentUrl: probe.page.url(),
      browserLocale: probe.browserLocale,
      direction: probe.direction,
      interaction,
      productionSelectors,
      interactionCount,
      beforeStateSha256,
      afterStateSha256,
      assertions
    }
  }

  async #exerciseEdits(probe: BrowserLocaleProbe): Promise<BrowserUiWorkloadResult> {
    const before = await this.#stateDigest(probe)
    const label = probe.locale === 'ar' ? 'تعديل واجهة الصمود المحفوظ' : 'Saved soak UI interaction'
    await this.#editTaskThroughUi(probe, label, { save: true })
    const persisted = await probe.page.evaluate(
      ({ path, expected }) =>
        window.__ORBITPM_RELIABILITY_FS__.read(path)?.includes(expected) === true,
      { path: browserWorkspaceFile(probe.locale), expected: label }
    )
    invariant(persisted, 'browser edit persisted through the production save path', {
      locale: probe.locale
    })
    return {
      receipt: await this.#receipt(
        probe,
        'edits',
        'task-details-edit-and-save',
        [
          '.djs-element[data-element-id="Task_1"] .djs-hit',
          '.orbitpm-lite-details-card button',
          `dialog[aria-label="${BROWSER_UI_TEXT[probe.locale].stepDetails}"]`,
          `button[title="${BROWSER_UI_TEXT[probe.locale].saveTitle}"]`
        ],
        5,
        before,
        [{ name: 'workspace-file-contains-saved-ui-label', passed: true, observed: persisted }]
      )
    }
  }

  async #exerciseRecovery(probe: BrowserLocaleProbe): Promise<BrowserUiWorkloadResult> {
    const { page, locale } = probe
    const ui = BROWSER_UI_TEXT[locale]
    const before = await this.#stateDigest(probe)
    const label = locale === 'ar' ? 'مسودة مستعادة عبر الواجهة' : 'UI-restored recovery draft'
    await this.#editTaskThroughUi(probe, label, { save: false })
    await page.waitForTimeout(2_300)
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('heading', { name: 'OrbitPM Process Studio Lite' }).waitFor({
      state: 'visible',
      timeout: 30_000
    })
    await page.getByRole('button', { name: ui.chooseFolder, exact: true }).click()
    await page.getByRole('heading', { name: ui.catalog }).waitFor({
      state: 'visible',
      timeout: 30_000
    })
    await this.#sourceRow(page, locale).click()
    const recovery = page.getByRole('dialog', { name: ui.recoveryDraft })
    await recovery.waitFor({ state: 'visible', timeout: 30_000 })
    await recovery.getByRole('button', { name: ui.restoreDraft, exact: true }).click()
    await this.#waitForModeler(page)
    await page.locator('.orbitpm-editor__dirty-flag--dirty:visible').waitFor({
      state: 'visible',
      timeout: 20_000
    })
    await page.locator(`button[title="${ui.saveTitle}"]:visible`).click()
    await page.locator('.orbitpm-editor__dirty-flag--dirty:visible').waitFor({
      state: 'hidden',
      timeout: 30_000
    })
    const restored = await page.evaluate(
      ({ path, expected }) =>
        window.__ORBITPM_RELIABILITY_FS__.read(path)?.includes(expected) === true,
      { path: browserWorkspaceFile(locale), expected: label }
    )
    invariant(restored, 'browser recovery persisted the restored draft', { locale })
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: ui.chooseFolder, exact: true }).click()
    await this.#sourceRow(page, locale).click()
    await this.#waitForModeler(page)
    const pendingDrafts = await page.getByRole('dialog', { name: ui.recoveryDraft }).count()
    invariant(pendingDrafts === 0, 'browser recovery save clears the pending draft', {
      locale,
      pendingDrafts
    })
    return {
      receipt: await this.#receipt(
        probe,
        'recovery',
        'dirty-draft-reload-review-restore-save',
        [
          '.orbitpm-editor__dirty-flag--dirty',
          `dialog[aria-label="${ui.recoveryDraft}"]`,
          `button[title="${ui.saveTitle}"]`
        ],
        10,
        before,
        [
          { name: 'restored-label-persisted', passed: true, observed: restored },
          { name: 'pending-recovery-dialogs-after-save', passed: true, observed: pendingDrafts }
        ]
      ),
      retention: { restoredDrafts: 1, pendingDraftsAtCompletion: pendingDrafts }
    }
  }

  async #exerciseWorkspaceSwitching(probe: BrowserLocaleProbe): Promise<BrowserUiWorkloadResult> {
    const { page, locale } = probe
    const ui = BROWSER_UI_TEXT[locale]
    const before = await this.#stateDigest(probe)
    await this.#editTaskThroughUi(probe, '', { save: false, field: 'target' })
    const pickerCallsBefore = await page.evaluate(
      () => window.__ORBITPM_RELIABILITY_FS__.snapshot().pickerCalls
    )
    await page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.setPickerBehavior('abort'))
    await page.getByRole('button', { name: ui.changeFolder, exact: true }).click()
    await page
      .getByRole('tab', { name: new RegExp(browserWorkspaceFile(locale).replace('.', '\\.')) })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText(ui.folderStorage, { exact: true }).waitFor({
      state: 'attached',
      timeout: 20_000
    })
    const pickerCallsAfter = await page.evaluate(() => {
      const snapshot = window.__ORBITPM_RELIABILITY_FS__.snapshot()
      window.__ORBITPM_RELIABILITY_FS__.setPickerBehavior('resolve')
      return snapshot.pickerCalls
    })
    const pickerCancellations = pickerCallsAfter - pickerCallsBefore
    invariant(pickerCancellations === 1, 'browser workspace switch invoked and cancelled picker', {
      locale,
      pickerCallsBefore,
      pickerCallsAfter
    })
    return {
      receipt: await this.#receipt(
        probe,
        'workspace-switching',
        'folder-switch-picker-cancel-preserves-workspace',
        [`button[aria-label="${ui.changeFolder}"]`, '[role="tab"][aria-selected="true"]'],
        2,
        before,
        [
          { name: 'picker-cancellation-count', passed: true, observed: pickerCancellations },
          { name: 'source-tab-remained-visible', passed: true, observed: true }
        ]
      ),
      retention: { pickerCancellations, workspacePreserved: true }
    }
  }

  async #exerciseImports(probe: BrowserLocaleProbe): Promise<BrowserUiWorkloadResult> {
    const { page, locale } = probe
    const ui = BROWSER_UI_TEXT[locale]
    const before = await this.#stateDigest(probe)
    const generator = page.getByRole('button', { name: ui.generateWithAi }).first()
    const aside = generator.locator('xpath=ancestor::aside[1]')
    if (!(await aside.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: ui.toggleSidePanel }).click()
    }
    if ((await generator.getAttribute('aria-expanded')) === 'false') await generator.click()
    await page.getByRole('tab', { name: ui.spreadsheetTab, exact: true }).click()
    const panel = page.getByRole('region', { name: ui.spreadsheetRegion })
    await panel.waitFor({ state: 'visible', timeout: 20_000 })
    const downloadStarted = page.waitForEvent('download')
    await panel.getByRole('button', { name: ui.downloadExampleSpreadsheet, exact: true }).click()
    const download = await downloadStarted
    const downloadedPath = await download.path()
    invariant(downloadedPath !== null, 'browser retained exact UI-downloaded workbook', {
      locale,
      suggestedFilename: download.suggestedFilename()
    })
    await panel.locator('input[type="file"][accept*=".xlsx"]').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: readFileSync(downloadedPath)
    })
    await panel.getByText(ui.officialSpreadsheet).waitFor({
      state: 'visible',
      timeout: 30_000
    })
    await panel.getByRole('button', { name: ui.validateSpreadsheet, exact: true }).click()
    await panel.getByText(ui.noWorkbookIssues, { exact: true }).waitFor({
      state: 'visible',
      timeout: 30_000
    })
    await panel.getByRole('button', { name: ui.prepareBpmn, exact: true }).click()
    const commit = panel.getByRole('button', { name: ui.commitImport, exact: true })
    try {
      await commit.waitFor({ state: 'visible', timeout: 45_000 })
    } catch (error) {
      throw new SoakInvariantError('browser spreadsheet import exposes production commit', {
        locale,
        panelText: (await panel.innerText()).slice(0, 4_000),
        cause: error instanceof Error ? error.message : String(error)
      })
    }
    await commit.click()
    await panel.getByText(ui.importCommitted, { exact: true }).waitFor({
      state: 'visible',
      timeout: 45_000
    })
    const importedPaths = await page.evaluate(
      (sourcePath) =>
        window.__ORBITPM_RELIABILITY_FS__
          .paths()
          .filter((path) => path.endsWith('.bpmn') && path !== sourcePath),
      browserWorkspaceFile(locale)
    )
    invariant(importedPaths.length >= 1, 'browser spreadsheet import persisted a BPMN file', {
      locale,
      importedPaths
    })
    if (await aside.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: ui.toggleSidePanel }).click()
      await aside.waitFor({ state: 'hidden', timeout: 20_000 })
    }
    await this.#openSourceFile(probe)
    return {
      receipt: await this.#receipt(
        probe,
        'imports',
        'ui-download-xlsx-upload-validate-prepare-commit',
        [
          '[role="tab"][name="Excel / CSV"]',
          `role=button[name="${ui.downloadExampleSpreadsheet}"]`,
          'input[type="file"][accept*=".xlsx"]',
          `button[name="${ui.validateSpreadsheet}"]`,
          `button[name="${ui.prepareBpmn}"]`,
          `button[name="${ui.commitImport}"]`
        ],
        10,
        before,
        [{ name: 'persisted-imported-bpmn-count', passed: true, observed: importedPaths.length }]
      )
    }
  }

  async #exerciseTranslationCancellation(
    probe: BrowserLocaleProbe
  ): Promise<BrowserUiWorkloadResult> {
    const { page, locale } = probe
    const ui = BROWSER_UI_TEXT[locale]
    const before = await this.#stateDigest(probe)
    let requestCount = 0
    let markStarted!: () => void
    let releaseResponse!: () => void
    let markFinished!: () => void
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted
    })
    const responseGate = new Promise<void>((resolveResponse) => {
      releaseResponse = resolveResponse
    })
    const finished = new Promise<void>((resolveFinished) => {
      markFinished = resolveFinished
    })
    await page.route('https://translate.googleapis.com/**', async (route) => {
      requestCount += 1
      markStarted()
      await responseGate
      const translated = locale === 'ar' ? 'Delayed translated task' : 'ترجمة مؤجلة'
      const source = locale === 'ar' ? 'مهمة اختبار الصمود' : 'Soak UI task'
      try {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*'
          },
          body: JSON.stringify([[[translated, source, null, null]], null, locale])
        })
      } catch {
        // The production AbortController may dispose the route before fulfillment.
      } finally {
        markFinished()
      }
    })
    await page.route('https://api.mymemory.translated.net/**', (route) => route.abort())
    this.#translationRequestsAllowed = true
    try {
      await page.getByRole('button', { name: ui.translate }).click()
      const review = page.getByRole('dialog', { name: ui.translationReview })
      await review.waitFor({ state: 'visible', timeout: 30_000 })
      await review.getByLabel(ui.translationProvider).selectOption('free')
      await review.getByRole('button', { name: ui.translateNow, exact: true }).click()
      await started
      await review.getByRole('button', { name: ui.cancelTranslation, exact: true }).click()
      releaseResponse()
      await finished
      await review.getByText(ui.translationCancelled).waitFor({
        state: 'visible',
        timeout: 20_000
      })
      invariant(requestCount === 1, 'browser translation cancellation observed one request', {
        locale,
        requestCount
      })
      await review.getByRole('button', { name: ui.postponeTranslation, exact: true }).click()
      await review.waitFor({ state: 'hidden', timeout: 20_000 })
      await this.#editTaskThroughUi(
        probe,
        locale === 'ar' ? 'Restored English target' : 'استعادة التسمية العربية',
        { save: true, field: 'target' }
      )
    } finally {
      releaseResponse?.()
      this.#translationRequestsAllowed = false
      await page.unrouteAll({ behavior: 'wait' })
    }
    return {
      receipt: await this.#receipt(
        probe,
        'translation-cancellation',
        'free-translation-start-and-cancel',
        [
          `button[title="${locale === 'ar' ? 'إكمال كل تسمية إنجليزية أو عربية ناقصة ثم عرض اللغة الأخرى' : 'Fill every missing English or Arabic label, then show the other language'}"]`,
          `dialog[aria-label="${ui.translationReview}"]`,
          `button[name="${ui.cancelTranslation}"]`
        ],
        16,
        before,
        [
          {
            name: 'intercepted-cancelled-translation-requests',
            passed: true,
            observed: requestCount
          }
        ]
      )
    }
  }

  async #exerciseHistoryCleanup(probe: BrowserLocaleProbe): Promise<BrowserUiWorkloadResult> {
    const { page, locale } = probe
    const ui = BROWSER_UI_TEXT[locale]
    const before = await this.#stateDigest(probe)
    for (let revision = 1; revision <= UI_HISTORY_RETENTION_LIMIT + 1; revision += 1) {
      const suffix = String(revision).padStart(2, '0')
      const label = locale === 'ar' ? `نسخة احتفاظ ${suffix}` : `UI retention version ${suffix}`
      await this.#editTaskThroughUi(probe, label, { save: true })
    }
    await page.getByRole('button', { name: ui.recoveryHistory, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: ui.recoveryHistory })
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    const revisions = dialog.locator('article')
    await revisions.nth(UI_HISTORY_RETENTION_LIMIT - 1).waitFor({
      state: 'visible',
      timeout: 30_000
    })
    const maximumVisibleRevisions = await revisions.count()
    invariant(
      maximumVisibleRevisions === UI_HISTORY_RETENTION_LIMIT,
      'browser recovery history enforces the production revision limit',
      { locale, maximumVisibleRevisions, limit: UI_HISTORY_RETENTION_LIMIT }
    )
    await revisions.last().getByRole('button', { name: ui.previewRevision, exact: true }).click()
    const oldestRetainedLabel = locale === 'ar' ? 'نسخة احتفاظ 01' : 'UI retention version 01'
    await dialog.getByText(oldestRetainedLabel, { exact: false }).waitFor({
      state: 'visible',
      timeout: 20_000
    })
    const paths = await page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.paths())
    const historyPaths = paths.filter((path) => path.startsWith('.orbitpm/history/'))
    const retainedBpmnFiles = historyPaths.filter((path) => path.endsWith('.bpmn')).length
    const retainedMetadataFiles = historyPaths.filter((path) => path.endsWith('.json')).length
    const oldestSeedPruned = !(await dialog.textContent())?.includes(
      locale === 'ar' ? 'مهمة اختبار الصمود' : 'Soak UI task'
    )
    invariant(
      retainedBpmnFiles === UI_HISTORY_RETENTION_LIMIT &&
        retainedMetadataFiles === UI_HISTORY_RETENTION_LIMIT &&
        oldestSeedPruned,
      'browser history storage and visible retention agree',
      {
        locale,
        retainedBpmnFiles,
        retainedMetadataFiles,
        oldestSeedPruned
      }
    )
    await dialog.getByRole('button', { name: ui.cancel, exact: true }).click()
    return {
      receipt: await this.#receipt(
        probe,
        'history-cleanup',
        'save-beyond-retention-limit-and-inspect-history',
        [
          `button[title="${ui.saveTitle}"]`,
          `button[name="${ui.recoveryHistory}"]`,
          `dialog[aria-label="${ui.recoveryHistory}"] article`
        ],
        (UI_HISTORY_RETENTION_LIMIT + 1) * 5 + 4,
        before,
        [
          {
            name: 'visible-revisions-at-limit',
            passed: true,
            observed: maximumVisibleRevisions
          },
          { name: 'retained-history-bpmn-files', passed: true, observed: retainedBpmnFiles },
          {
            name: 'retained-history-metadata-files',
            passed: true,
            observed: retainedMetadataFiles
          },
          { name: 'oldest-seed-pruned', passed: true, observed: oldestSeedPruned }
        ]
      ),
      retention: {
        retentionLimit: UI_HISTORY_RETENTION_LIMIT,
        maximumVisibleRevisions,
        retainedBpmnFiles,
        retainedMetadataFiles,
        oldestSeedPruned
      }
    }
  }

  async exerciseRequiredWorkloads(
    onResult?: (result: BrowserUiWorkloadResult) => Promise<void>
  ): Promise<readonly BrowserUiWorkloadResult[]> {
    invariant(
      this.#probes.length === SOAK_LOCALES.length,
      'browser UI workloads retain both localized contexts'
    )
    const results: BrowserUiWorkloadResult[] = []
    for (const probe of this.#probes) {
      for (const exercise of [
        () => this.#exerciseEdits(probe),
        () => this.#exerciseRecovery(probe),
        () => this.#exerciseWorkspaceSwitching(probe),
        () => this.#exerciseImports(probe),
        () => this.#exerciseTranslationCancellation(probe),
        () => this.#exerciseHistoryCleanup(probe)
      ]) {
        const result = await exercise()
        results.push(result)
        await onResult?.(result)
      }
    }
    return results
  }

  async #heartbeatForLocale(
    probe: BrowserLocaleProbe,
    stage: BrowserHeartbeat['stage'],
    cycle: number
  ): Promise<BrowserLocaleHeartbeat> {
    const { page, cdp, locale, browserLocale, direction } = probe
    invariant(!page.isClosed(), 'localized browser endurance page remains open', {
      stage,
      cycle,
      locale
    })
    const frameLatencyMs = await page.evaluate(
      () =>
        new Promise<number>((resolveFrame) => {
          const started = window.performance.now()
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolveFrame(window.performance.now() - started))
          })
        })
    )
    const browserState = await page.evaluate(async () => {
      const root = document.documentElement
      const editorSurface = [
        ...document.querySelectorAll<SVGGraphicsElement>(
          '[role="tabpanel"]:not([hidden]) .djs-element .djs-hit'
        )
      ].find((candidate) => {
        const candidateBounds = candidate.getBoundingClientRect()
        return candidateBounds.width > 0 && candidateBounds.height > 0
      })
      const bounds = editorSurface?.getBoundingClientRect()
      let storageUsageBytes: number | null = null
      let storageQuotaBytes: number | null = null
      try {
        const estimate = await window.navigator.storage?.estimate()
        storageUsageBytes = typeof estimate?.usage === 'number' ? estimate.usage : null
        storageQuotaBytes = typeof estimate?.quota === 'number' ? estimate.quota : null
      } catch {
        // Some file:// engines do not expose an origin storage estimate.
      }
      const storageCodeUnits = (storage: Storage): number =>
        Array.from({ length: storage.length }, (_entry, index) => {
          const key = storage.key(index) ?? ''
          return key.length + (storage.getItem(key)?.length ?? 0)
        }).reduce((total, size) => total + size, 0)
      return {
        language: root.lang,
        direction: root.dir,
        readyState: document.readyState,
        title: document.title,
        editorSvgVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
        horizontalOverflow: root.scrollWidth > root.clientWidth,
        documentWidth: root.scrollWidth,
        viewportWidth: root.clientWidth,
        storageUsageBytes,
        storageQuotaBytes,
        localStorageCodeUnits: storageCodeUnits(window.localStorage),
        sessionStorageCodeUnits: storageCodeUnits(window.sessionStorage)
      }
    })
    const performanceMetrics = await cdp.send('Performance.getMetrics')
    const metrics = new Map(performanceMetrics.metrics.map(({ name, value }) => [name, value]))
    const metric = (name: string): number => {
      const value = metrics.get(name)
      invariant(Number.isFinite(value), `localized renderer metric ${name} is available`, {
        stage,
        cycle,
        locale,
        value
      })
      return value!
    }
    const localeHeartbeat: BrowserLocaleHeartbeat = {
      locale,
      browserLocale,
      direction,
      frameLatencyMs: Number(frameLatencyMs.toFixed(3)),
      readyState: browserState.readyState,
      title: browserState.title,
      editorSvgVisible: browserState.editorSvgVisible,
      horizontalOverflow: browserState.horizontalOverflow,
      documentWidth: browserState.documentWidth,
      viewportWidth: browserState.viewportWidth,
      renderer: {
        jsHeapUsedBytes: metric('JSHeapUsedSize'),
        jsHeapTotalBytes: metric('JSHeapTotalSize'),
        domNodes: metric('Nodes'),
        documents: metric('Documents'),
        eventListeners: metric('JSEventListeners'),
        storageUsageBytes: browserState.storageUsageBytes,
        storageQuotaBytes: browserState.storageQuotaBytes,
        localStorageCodeUnits: browserState.localStorageCodeUnits,
        sessionStorageCodeUnits: browserState.sessionStorageCodeUnits
      }
    }
    invariant(
      browserState.language === locale && browserState.direction === direction,
      'localized browser document preserves language and direction',
      {
        stage,
        cycle,
        locale,
        language: browserState.language,
        expectedDirection: direction,
        direction: browserState.direction
      }
    )
    invariant(localeHeartbeat.readyState === 'complete', 'browser document remains complete', {
      stage,
      cycle,
      locale,
      readyState: localeHeartbeat.readyState
    })
    invariant(localeHeartbeat.editorSvgVisible, 'browser editor remains visible', {
      stage,
      cycle,
      locale
    })
    invariant(!localeHeartbeat.horizontalOverflow, 'browser heartbeat has no horizontal overflow', {
      stage,
      cycle,
      locale,
      documentWidth: localeHeartbeat.documentWidth,
      viewportWidth: localeHeartbeat.viewportWidth
    })
    invariant(frameLatencyMs <= 2_000, 'browser animation heartbeat remains responsive', {
      stage,
      cycle,
      locale,
      frameLatencyMs
    })
    return localeHeartbeat
  }

  async heartbeat(
    stage: BrowserHeartbeat['stage'],
    cycle: number,
    elapsedMs: number
  ): Promise<BrowserHeartbeat> {
    invariant(
      this.#probes.length === SOAK_LOCALES.length,
      'browser endurance retains both localized contexts',
      {
        stage,
        cycle,
        locales: this.#probes.map(({ locale }) => locale)
      }
    )
    const locales = await Promise.all(
      this.#probes.map((probe) => this.#heartbeatForLocale(probe, stage, cycle))
    )
    const storageUsageBytes = locales.every(({ renderer }) => renderer.storageUsageBytes !== null)
      ? locales.reduce((total, { renderer }) => total + renderer.storageUsageBytes!, 0)
      : null
    const storageQuotaBytes = locales.every(({ renderer }) => renderer.storageQuotaBytes !== null)
      ? locales.reduce((total, { renderer }) => total + renderer.storageQuotaBytes!, 0)
      : null
    const heartbeat: BrowserHeartbeat = {
      stage,
      cycle,
      elapsedMs,
      frameLatencyMs: Math.max(...locales.map(({ frameLatencyMs }) => frameLatencyMs)),
      readyState: locales.every(({ readyState }) => readyState === 'complete')
        ? 'complete'
        : locales.map(({ readyState }) => readyState).join(','),
      title: locales[0]!.title,
      editorSvgVisible: locales.every(({ editorSvgVisible }) => editorSvgVisible),
      horizontalOverflow: locales.some(({ horizontalOverflow }) => horizontalOverflow),
      documentWidth: Math.max(...locales.map(({ documentWidth }) => documentWidth)),
      viewportWidth: Math.min(...locales.map(({ viewportWidth }) => viewportWidth)),
      pageErrors: [...this.#pageErrors],
      consoleErrors: [...this.#consoleErrors],
      unexpectedRequests: [...this.#unexpectedRequests],
      diagnosticsTruncated: this.#diagnosticsTruncated,
      locales,
      renderer: {
        jsHeapUsedBytes: locales.reduce(
          (total, { renderer }) => total + renderer.jsHeapUsedBytes,
          0
        ),
        jsHeapTotalBytes: locales.reduce(
          (total, { renderer }) => total + renderer.jsHeapTotalBytes,
          0
        ),
        domNodes: locales.reduce((total, { renderer }) => total + renderer.domNodes, 0),
        documents: locales.reduce((total, { renderer }) => total + renderer.documents, 0),
        eventListeners: locales.reduce((total, { renderer }) => total + renderer.eventListeners, 0),
        storageUsageBytes,
        storageQuotaBytes,
        localStorageCodeUnits: locales.reduce(
          (total, { renderer }) => total + renderer.localStorageCodeUnits,
          0
        ),
        sessionStorageCodeUnits: locales.reduce(
          (total, { renderer }) => total + renderer.sessionStorageCodeUnits,
          0
        )
      }
    }
    invariant(this.#pageErrors.length === 0, 'browser has no page errors', {
      pageErrors: this.#pageErrors
    })
    invariant(this.#consoleErrors.length === 0, 'browser has no console errors', {
      consoleErrors: this.#consoleErrors
    })
    invariant(this.#unexpectedRequests.length === 0, 'browser artifact remains offline', {
      unexpectedRequests: this.#unexpectedRequests
    })
    return heartbeat
  }

  async close(): Promise<void> {
    const probes = this.#probes
    this.#probes = []
    try {
      await Promise.all(probes.map(({ context }) => context.close()))
    } finally {
      await this.#browser?.close()
      this.#browser = null
    }
  }
}

function ordinaryBpmn(workspace: string, revision: number, locale: SoakLocale): string {
  const processName =
    locale === 'ar' ? `${workspace} المراجعة ${revision}` : `${workspace} revision ${revision}`
  const startName = locale === 'ar' ? 'البداية' : 'Start'
  const taskName = locale === 'ar' ? `مراجعة الإصدار ${revision}` : `Review revision ${revision}`
  const endName = locale === 'ar' ? 'النهاية' : 'End'
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_${workspace}">
  <bpmn:process id="Process_${workspace}" name="${processName}" isExecutable="false">
    <bpmn:startEvent id="Start_${workspace}" name="${startName}" />
    <bpmn:userTask id="Task_${workspace}" name="${taskName}" />
    <bpmn:endEvent id="End_${workspace}" name="${endName}" />
    <bpmn:sequenceFlow id="Flow_${workspace}_1" sourceRef="Start_${workspace}" targetRef="Task_${workspace}" />
    <bpmn:sequenceFlow id="Flow_${workspace}_2" sourceRef="Task_${workspace}" targetRef="End_${workspace}" />
  </bpmn:process>
</bpmn:definitions>`
}

function fingerprint(snapshot: FileSnapshot): FileFingerprint {
  return {
    hash: snapshot.hash,
    size: snapshot.size,
    modifiedAt: snapshot.modifiedAt
  }
}

function sameWorkspace(left: WorkspaceIdentity, right: WorkspaceIdentity | null): boolean {
  return Boolean(
    right &&
    left.id === right.id &&
    left.generation === right.generation &&
    left.mode === right.mode
  )
}

function activateWorkspace(state: HarnessState, adapter: WorkspaceAdapter): WorkspaceIdentity {
  const previousId = state.activeWorkspace?.id
  const workspace: WorkspaceIdentity = {
    id: adapter.id,
    generation: ++state.workspaceGeneration,
    mode: adapter.mode
  }
  state.activeWorkspace = workspace
  if (previousId !== undefined && previousId !== workspace.id) {
    state.operations.workspaceSwitches += 1
  }
  return workspace
}

function cell(value: WorkbookCell['value']): WorkbookCell {
  return { value }
}

function row(
  headers: readonly string[],
  values: Readonly<Record<string, WorkbookCell['value']>>
): WorkbookCell[] {
  return headers.map((header) => cell(values[header] ?? null))
}

function spreadsheetFixture(cycle: number, locale: SoakLocale): ParsedWorkbookData {
  const sheets = (Object.keys(OFFICIAL_SHEET_NAMES) as CanonicalSheet[]).map((role) => {
    const headers = CANONICAL_FIELDS_BY_SHEET[role]
    const rows: WorkbookCell[][] = [headers.map((header) => cell(header))]
    if (role === 'processes') {
      rows.push(
        row(headers, {
          process_id: 'soak_process',
          name_en: `Soak process ${cycle}`,
          name_ar: `عملية اختبار ${cycle}`,
          active_language: locale
        })
      )
    }
    if (role === 'steps') {
      for (const [index, type] of ['startEvent', 'userTask', 'endEvent'].entries()) {
        rows.push(
          row(headers, {
            process_id: 'soak_process',
            step_id: `Step_${index + 1}`,
            order: index + 1,
            type,
            name_en: index === 0 ? 'Start' : index === 2 ? 'End' : `Review cycle ${cycle}`,
            name_ar: index === 0 ? 'البداية' : index === 2 ? 'النهاية' : `مراجعة الدورة ${cycle}`
          })
        )
      }
    }
    return { name: OFFICIAL_SHEET_NAMES[role], rows }
  })
  return {
    sheets,
    customProperties: { OrbitPMTemplateVersion: OFFICIAL_TEMPLATE_VERSION }
  }
}

async function exerciseSpreadsheetCycle(
  state: HarnessState,
  cycle: number,
  locale: SoakLocale
): Promise<void> {
  const workbook = spreadsheetFixture(cycle, locale)
  const built = buildProcessWorkbookModel(workbook, {
    fileName: `soak-${cycle}.xlsx`,
    format: 'xlsx',
    preset: officialTemplatePreset(workbook),
    officialTemplate: true,
    templateVersion: OFFICIAL_TEMPLATE_VERSION
  })
  state.operations.spreadsheetModelsBuilt += 1
  const inference = createGraphInferencePlan(built.model, { flowMode: 'numeric-order' })
  const model = applyGraphInferencePlan(built.model, inference, {
    confirmSyntheticBoundaries: true
  })
  const fixedNow = (): Date => new Date(1_800_000_000_000 + cycle * 1_000)
  const plan = await prepareTransactionalImportPlan(model, {
    mode: 'single-file',
    collisionBehavior: 'error',
    inspector: new EmptySpreadsheetDestinationInspector(),
    generator: new SpreadsheetBpmnGenerator({ validationAdapters: [] }),
    bilingualAudit: new SpreadsheetBilingualAudit(),
    additionalIssues: [...built.issues, ...inference.issues],
    generatedIds: inference.generatedIds,
    inferredFlows: inference.inferredFlowRecords,
    skippedRows: built.skippedRows,
    now: fixedNow
  })
  invariant(plan.status === 'ready', 'spreadsheet import plan is ready', {
    blockingReason: plan.blockingReason,
    issues: plan.validation.issues.map(({ code, severity }) => ({ code, severity }))
  })
  invariant(plan.artifacts.length === 1, 'spreadsheet generated one artifact', {
    artifacts: plan.artifacts.length
  })
  state.operations.spreadsheetArtifactsGenerated += plan.artifacts.length

  const deliveries: Array<{ xml: string; path: string }> = []
  const report = await executeTransactionalImportPlan(plan, {
    transactionFactory: new BrowserImportDeliveryTransactionFactory({
      openSingle: (xml, path) => {
        deliveries.push({ xml, path })
      }
    }),
    now: fixedNow
  })
  invariant(report.status === 'committed', 'spreadsheet transaction committed', {
    status: report.status,
    failure: report.failure
  })
  invariant(deliveries.length === 1, 'spreadsheet single-file delivery occurred', {
    deliveries: deliveries.length
  })
  const delivered = deliveries[0]!
  invariant(
    delivered.path.endsWith('.bpmn') &&
      delivered.xml.includes('definitions') &&
      delivered.xml.includes('BPMNDiagram') &&
      delivered.xml.includes(locale === 'ar' ? 'مراجعة الدورة' : 'Review cycle'),
    'spreadsheet delivery contains layouted BPMN',
    {
      path: delivered.path,
      locale,
      bytes: new TextEncoder().encode(delivered.xml).byteLength
    }
  )
  state.operations.spreadsheetImportsCommitted += 1
}

async function exerciseTranslationCancellation(
  state: HarnessState,
  locale: SoakLocale
): Promise<void> {
  const controller = new AbortController()
  let calls = 0
  const observed: { signal: AbortSignal | null } = { signal: null }
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1
    const signal = init?.signal ?? null
    observed.signal = signal
    return await new Promise<Response>((_resolve, reject) => {
      const rejectAbort = (): void =>
        reject(signal?.reason ?? new DOMException('cancelled', 'AbortError'))
      if (signal?.aborted) rejectAbort()
      else signal?.addEventListener('abort', rejectAbort, { once: true })
    })
  }
  const pending = makeFreeTranslateTexts({
    fetchImpl,
    concurrency: 1,
    minDelayMs: 0,
    timeoutMs: 5_000
  })(
    [locale === 'ar' ? 'مراجعة الطلب' : 'Review request'],
    locale,
    locale === 'ar' ? 'en' : 'ar',
    controller.signal
  )
  controller.abort(new DOMException('soak cancellation', 'AbortError'))
  let rejection: unknown
  try {
    await pending
  } catch (error) {
    rejection = error
  }
  invariant(
    rejection instanceof Error && rejection.name === 'AbortError',
    'translation cancellation rejects with AbortError',
    { rejection: rejection instanceof Error ? rejection.name : String(rejection) }
  )
  invariant(calls === 1, 'translation cancellation used one in-flight request', { calls })
  invariant(observed.signal?.aborted === true, 'translation transport observed cancellation')
  state.operations.translationCancellations += 1
}

async function exerciseCycle(
  state: HarnessState,
  cycle: number,
  locale: SoakLocale
): Promise<void> {
  const adapterIndex = (cycle - 1) % state.adapters.length
  const adapter = state.adapters[adapterIndex]!
  const otherAdapter = state.adapters[(adapterIndex + 1) % state.adapters.length]!
  const workspaceLabel = adapterIndex === 0 ? 'A' : 'B'
  const path = 'process.bpmn'
  const resources: Array<{
    controller: DocumentSessionController
    coordinator: DraftJournalCoordinator
    sessionId: string
    incarnation: number
  }> = []
  const postSaveErrors: unknown[] = []

  try {
    state.currentPhase = 'session-open'
    const workspace = activateWorkspace(state, adapter)
    const loaded = await adapter.read(path)
    const loadedXml = new TextDecoder().decode(loaded.bytes)
    const coordinator = new DraftJournalCoordinator(state.draftJournal, {
      appVersion: APP_VERSION,
      debounceMs: 60_000,
      now: () => 1_800_000_000_000 + cycle
    })
    const controller = new DocumentSessionController({
      persistence: new AdapterSessionPersistence({ adapter, workspace }),
      isWorkspaceCurrent: (identity) => sameWorkspace(identity.workspace, state.activeWorkspace),
      createRequestId: () => `soak-save-${cycle}`,
      onConfirmedSave: async (session) => {
        await coordinator.confirmedSave(session.id, session.incarnation, session.lastSavedXml)
      },
      onExplicitDiscard: async (discarded) => {
        await coordinator.explicitDiscard(discarded.id, discarded.incarnation)
      },
      onPostSaveError: (error) => postSaveErrors.push(error)
    })
    const sessionId = `session-${workspaceLabel}-${cycle}`
    let session = controller.open({
      id: sessionId,
      identity: { workspace, path },
      title: path,
      xml: loadedXml,
      base: fingerprint(loaded)
    })
    resources.push({ controller, coordinator, sessionId, incarnation: session.incarnation })
    state.operations.sessionOpens += 1

    state.currentPhase = 'draft-review'
    session = controller.updateXml(sessionId, ordinaryBpmn(workspaceLabel, cycle * 10 + 1, locale))
    coordinator.track(session)
    state.operations.edits += 1
    await coordinator.flush(sessionId, session.incarnation)
    const initialRecovery = await findDraftRecoveryComparison(
      state.draftJournal,
      { workspaceId: workspace.id, path, sessionId },
      loadedXml,
      loaded.hash
    )
    invariant(
      initialRecovery?.requiresReview === true && initialRecovery.relation === 'same-base',
      'dirty draft requires same-base recovery review',
      { relation: initialRecovery?.relation }
    )
    state.operations.draftRecoveryReviews += 1

    state.currentPhase = 'initial-save'
    const initialSave = await controller.save(sessionId)
    invariant(initialSave.status === 'success', 'initial session save succeeds', {
      status: initialSave.status
    })
    state.operations.confirmedSaves += 1
    invariant(
      (await state.draftJournal.listWorkspace(workspace.id)).length === 0,
      'confirmed save removes draft'
    )

    state.currentPhase = 'external-conflict'
    session = controller.updateXml(sessionId, ordinaryBpmn(workspaceLabel, cycle * 10 + 2, locale))
    coordinator.track(session)
    state.operations.edits += 1
    await coordinator.flush(sessionId, session.incarnation)
    adapter.replaceExternally(path, ordinaryBpmn(workspaceLabel, cycle * 10 + 3, locale))
    const conflict = await controller.save(sessionId)
    invariant(conflict.status === 'external-conflict', 'external conflict is detected', {
      status: conflict.status
    })
    state.operations.conflictsDetected += 1
    const overwrite = await controller.save(sessionId, {
      reviewedConflict: conflict.conflict,
      conflictDecision: { kind: 'overwrite', confirmed: true }
    })
    invariant(overwrite.status === 'success', 'confirmed conflict overwrite succeeds', {
      status: overwrite.status
    })
    state.operations.confirmedSaves += 1

    state.currentPhase = 'stale-workspace'
    session = controller.updateXml(sessionId, ordinaryBpmn(workspaceLabel, cycle * 10 + 4, locale))
    coordinator.track(session)
    state.operations.edits += 1
    await coordinator.flush(sessionId, session.incarnation)
    activateWorkspace(state, otherAdapter)
    const staleSave = await controller.save(sessionId)
    invariant(staleSave.status === 'stale-workspace', 'stale workspace save is rejected', {
      status: staleSave.status
    })
    state.operations.staleWorkspaceRejections += 1

    state.currentPhase = 'draft-recovery'
    const recoveredWorkspace = activateWorkspace(state, adapter)
    const durable = await adapter.read(path)
    const durableXml = new TextDecoder().decode(durable.bytes)
    const recoveryId = `recovered-${workspaceLabel}-${cycle}`
    const recovery = await findDraftRecoveryComparison(
      state.draftJournal,
      { workspaceId: recoveredWorkspace.id, path, sessionId: recoveryId },
      durableXml,
      durable.hash
    )
    invariant(
      recovery?.requiresReview === true &&
        recovery.relation === 'same-base' &&
        recovery.draft.xml === session.currentXml,
      'workspace return finds persisted same-base draft',
      { relation: recovery?.relation }
    )
    state.operations.draftRecoveryReviews += 1

    const recoveryCoordinator = new DraftJournalCoordinator(state.draftJournal, {
      appVersion: APP_VERSION,
      debounceMs: 60_000,
      now: () => 1_800_000_100_000 + cycle
    })
    const recoveryController = new DocumentSessionController({
      persistence: new AdapterSessionPersistence({
        adapter,
        workspace: recoveredWorkspace
      }),
      isWorkspaceCurrent: (identity) => sameWorkspace(identity.workspace, state.activeWorkspace),
      createRequestId: () => `soak-recovery-save-${cycle}`,
      onConfirmedSave: async (saved) => {
        await recoveryCoordinator.confirmedSave(saved.id, saved.incarnation, saved.lastSavedXml)
      },
      onPostSaveError: (error) => postSaveErrors.push(error)
    })
    const recoveredSession = recoveryController.open({
      id: recoveryId,
      identity: { workspace: recoveredWorkspace, path },
      title: path,
      xml: recovery.draft.xml,
      lastSavedXml: durableXml,
      base: fingerprint(durable)
    })
    resources.push({
      controller: recoveryController,
      coordinator: recoveryCoordinator,
      sessionId: recoveryId,
      incarnation: recoveredSession.incarnation
    })
    state.operations.sessionOpens += 1
    recoveryCoordinator.track(recoveredSession)
    await recoveryCoordinator.flush(recoveryId, recoveredSession.incarnation)
    const recoveredSave = await recoveryController.save(recoveryId)
    invariant(recoveredSave.status === 'success', 'recovered draft save succeeds', {
      status: recoveredSave.status
    })
    state.operations.confirmedSaves += 1
    state.operations.draftRecoveriesCommitted += 1
    invariant(
      (await state.draftJournal.listWorkspace(recoveredWorkspace.id)).length === 0,
      'recovered draft is removed after durable save'
    )

    state.currentPhase = 'portable-history'
    const beforeHistoryWrite = await adapter.read(path)
    const historyWrite = await state.histories[adapterIndex]!.writeWithRevision(
      path,
      new TextEncoder().encode(ordinaryBpmn(workspaceLabel, cycle * 10 + 5, locale)),
      beforeHistoryWrite.hash,
      'manual'
    )
    invariant(
      historyWrite.outcome.status === 'success' && historyWrite.revision !== undefined,
      'portable history revision precedes write',
      { status: historyWrite.outcome.status }
    )
    state.operations.historyRevisionsCreated += 1

    state.currentPhase = 'spreadsheet-import'
    await exerciseSpreadsheetCycle(state, cycle, locale)

    state.currentPhase = 'translation-cancellation'
    await exerciseTranslationCancellation(state, locale)

    invariant(postSaveErrors.length === 0, 'post-save draft cleanup has no errors', {
      errors: postSaveErrors.map(String)
    })
  } finally {
    for (const resource of [...resources].reverse()) {
      try {
        await resource.coordinator.explicitDiscard(resource.sessionId, resource.incarnation)
      } catch {
        // The primary cycle failure remains the recorded cause.
      }
      resource.coordinator.dispose()
      try {
        await resource.coordinator.untrack(resource.sessionId, resource.incarnation)
      } catch {
        // The primary cycle failure remains the recorded cause.
      }
      resource.controller.store.close(resource.sessionId)
    }
  }
}

async function collectBoundedStorage(
  state: HarnessState,
  options: { countRetentionOperation?: boolean } = {}
): Promise<readonly WorkspaceStorageSample[]> {
  const samples: WorkspaceStorageSample[] = []
  for (const [index, adapter] of state.adapters.entries()) {
    const retention = await state.histories[index]!.enforceRetention()
    if (options.countRetentionOperation !== false) {
      state.operations.historyRetentionPasses += 1
    }
    invariant(retention.issues.length === 0, 'history retention completed without issues', {
      workspaceId: adapter.id,
      issues: retention.issues
    })
    invariant(
      !retention.overLimitBecauseNewestAreProtected,
      'history retention remains below byte cap',
      { workspaceId: adapter.id, totalBytes: retention.totalBytes }
    )
    const listing = await state.histories[index]!.listRevisions('process.bpmn')
    const entries = await adapter.list()
    const files = entries.filter(({ kind }) => kind === 'file')
    const directories = entries.filter(({ kind }) => kind === 'directory')
    const drafts = await state.draftJournal.listWorkspace(adapter.id)
    const sample: WorkspaceStorageSample = {
      workspaceId: adapter.id,
      files: files.length,
      directories: directories.length,
      fileBytes: files.reduce((total, entry) => total + (entry.size ?? 0), 0),
      historyRevisions: listing.revisions.length,
      historyBytes: listing.totalBytes,
      historyIssues: listing.issues.length,
      drafts: drafts.length
    }
    invariant(
      sample.historyRevisions <= LIMITS.historyRevisionsPerProcess,
      'history revision count is bounded',
      { ...sample }
    )
    invariant(
      sample.historyBytes <= LIMITS.historyBytesPerWorkspace,
      'history storage bytes are bounded',
      { ...sample }
    )
    invariant(sample.historyIssues === 0, 'history listing has no integrity issues', {
      ...sample
    })
    invariant(
      sample.drafts <= LIMITS.draftsPerWorkspaceAfterCycle,
      'draft count is bounded after cycle',
      { ...sample }
    )
    invariant(sample.files <= LIMITS.filesPerWorkspace, 'workspace file count is bounded', {
      ...sample
    })
    invariant(
      sample.directories <= LIMITS.directoriesPerWorkspace,
      'workspace directory count is bounded',
      { ...sample }
    )
    invariant(sample.fileBytes <= LIMITS.bytesPerWorkspace, 'workspace storage bytes are bounded', {
      ...sample
    })
    samples.push(sample)
  }
  return samples
}

function memoryUsage(): Omit<MemorySample, 'cycle' | 'elapsedMs' | 'storage'> {
  const usage = process.memoryUsage()
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function assessMemory(samples: readonly MemorySample[]): MemoryAssessment {
  if (samples.length < LIMITS.memoryMinimumSamples) {
    return {
      evaluated: false,
      passed: true,
      reason: `requires at least ${LIMITS.memoryMinimumSamples} samples`
    }
  }
  const warmupIndex = Math.min(2, Math.max(0, samples.length - 10))
  const firstWindow = samples.slice(warmupIndex, warmupIndex + 5)
  const lastWindow = samples.slice(-5)
  const firstCycle = firstWindow[0]!.cycle
  const lastCycle = lastWindow.at(-1)!.cycle
  if (lastCycle - firstCycle < LIMITS.memoryMinimumCycles) {
    return {
      evaluated: false,
      passed: true,
      reason: `requires at least ${LIMITS.memoryMinimumCycles} observed cycles`,
      firstCycle,
      lastCycle
    }
  }
  const elapsedMs =
    average(lastWindow.map(({ elapsedMs }) => elapsedMs)) -
    average(firstWindow.map(({ elapsedMs }) => elapsedMs))
  const retainedHeapGrowthBytes =
    median(lastWindow.map(({ heapUsed }) => heapUsed)) -
    median(firstWindow.map(({ heapUsed }) => heapUsed))
  const retainedRssGrowthBytes =
    median(lastWindow.map(({ rss }) => rss)) - median(firstWindow.map(({ rss }) => rss))
  const rateEvaluated = elapsedMs >= LIMITS.memoryRateMinimumElapsedMs
  const elapsedHours = elapsedMs / (60 * 60 * 1_000)
  const heapGrowthBytesPerHour =
    elapsedHours > 0 ? Math.max(0, retainedHeapGrowthBytes) / elapsedHours : 0
  const rssGrowthBytesPerHour =
    elapsedHours > 0 ? Math.max(0, retainedRssGrowthBytes) / elapsedHours : 0
  const passed =
    retainedHeapGrowthBytes <= LIMITS.retainedHeapGrowthBytes &&
    retainedRssGrowthBytes <= LIMITS.retainedRssGrowthBytes &&
    (!rateEvaluated ||
      (heapGrowthBytesPerHour <= LIMITS.heapGrowthBytesPerHour &&
        rssGrowthBytesPerHour <= LIMITS.rssGrowthBytesPerHour))
  return {
    evaluated: true,
    passed,
    firstCycle,
    lastCycle,
    elapsedMs: Math.round(elapsedMs),
    retainedHeapGrowthBytes: Math.round(retainedHeapGrowthBytes),
    retainedRssGrowthBytes: Math.round(retainedRssGrowthBytes),
    heapGrowthBytesPerHour: Math.round(heapGrowthBytesPerHour),
    rssGrowthBytesPerHour: Math.round(rssGrowthBytesPerHour),
    rateEvaluated
  }
}

function assessRenderer(heartbeats: readonly BrowserHeartbeat[]): RendererAssessment {
  if (heartbeats.length < LIMITS.rendererMinimumHeartbeats) {
    return {
      evaluated: false,
      rateEvaluated: false,
      passed: true,
      reason: `requires at least ${LIMITS.rendererMinimumHeartbeats} browser heartbeats`
    }
  }
  const firstWindow = heartbeats.slice(2, 7)
  const lastWindow = heartbeats.slice(-5)
  const elapsedMs =
    average(lastWindow.map(({ elapsedMs }) => elapsedMs)) -
    average(firstWindow.map(({ elapsedMs }) => elapsedMs))
  const retainedHeapGrowthBytes =
    median(lastWindow.map(({ renderer }) => renderer.jsHeapUsedBytes)) -
    median(firstWindow.map(({ renderer }) => renderer.jsHeapUsedBytes))
  const elapsedHours = elapsedMs / (60 * 60 * 1_000)
  const heapGrowthBytesPerHour =
    elapsedHours > 0 ? Math.max(0, retainedHeapGrowthBytes) / elapsedHours : 0
  const firstStorage = firstWindow
    .map(({ renderer }) => renderer.storageUsageBytes)
    .filter((value): value is number => value !== null)
  const lastStorage = lastWindow
    .map(({ renderer }) => renderer.storageUsageBytes)
    .filter((value): value is number => value !== null)
  const storageGrowthBytes =
    firstStorage.length === firstWindow.length && lastStorage.length === lastWindow.length
      ? median(lastStorage) - median(firstStorage)
      : null
  const firstWebStorage = median(
    firstWindow.map(
      ({ renderer }) => renderer.localStorageCodeUnits + renderer.sessionStorageCodeUnits
    )
  )
  const lastWebStorage = median(
    lastWindow.map(
      ({ renderer }) => renderer.localStorageCodeUnits + renderer.sessionStorageCodeUnits
    )
  )
  const webStorageGrowthCodeUnits = lastWebStorage - firstWebStorage
  const domNodeGrowth =
    median(lastWindow.map(({ renderer }) => renderer.domNodes)) -
    median(firstWindow.map(({ renderer }) => renderer.domNodes))
  const rateEvaluated = elapsedMs >= LIMITS.rendererRateMinimumElapsedMs
  const passed =
    retainedHeapGrowthBytes <= LIMITS.rendererRetainedHeapGrowthBytes &&
    (!rateEvaluated || heapGrowthBytesPerHour <= LIMITS.rendererHeapGrowthBytesPerHour) &&
    (storageGrowthBytes === null || storageGrowthBytes <= LIMITS.rendererStorageGrowthBytes) &&
    webStorageGrowthCodeUnits <= LIMITS.rendererWebStorageGrowthCodeUnits &&
    domNodeGrowth <= LIMITS.rendererDomNodeGrowth
  return {
    evaluated: true,
    rateEvaluated,
    passed,
    elapsedMs: Math.round(elapsedMs),
    retainedHeapGrowthBytes: Math.round(retainedHeapGrowthBytes),
    heapGrowthBytesPerHour: Math.round(heapGrowthBytesPerHour),
    storageGrowthBytes: storageGrowthBytes === null ? null : Math.round(storageGrowthBytes),
    webStorageGrowthCodeUnits: Math.round(webStorageGrowthCodeUnits),
    domNodeGrowth: Math.round(domNodeGrowth)
  }
}

function addTrendSample(
  state: HarnessState,
  storage: readonly WorkspaceStorageSample[],
  force = false
): void {
  const cycle = state.cyclesAttempted
  if (!force && cycle !== 1 && cycle % state.effectiveSampleEveryCycles !== 0) {
    return
  }
  const existing = state.trendSamples.at(-1)
  if (existing?.cycle === cycle) state.trendSamples.pop()
  if (state.trendSamples.length >= MAX_TREND_SAMPLES) {
    state.trendSamples = state.trendSamples.filter((_sample, index) => index % 2 === 0)
    state.effectiveSampleEveryCycles *= 2
  }
  const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc
  collectGarbage?.()
  state.trendSamples.push({
    cycle,
    elapsedMs: Math.round(performance.now() - state.startedMonotonic),
    ...memoryUsage(),
    storage
  })
  const assessment = assessMemory(state.trendSamples)
  if (assessment.evaluated) {
    const first = state.trendSamples.find(({ cycle: sampleCycle }) => {
      return sampleCycle === assessment.firstCycle
    })
    const latest = state.trendSamples.at(-1)
    if (
      first &&
      latest &&
      (latest.heapUsed - first.heapUsed > LIMITS.hardHeapGrowthBytes ||
        latest.rss - first.rss > LIMITS.hardRssGrowthBytes)
    ) {
      throw new SoakInvariantError('memory hard growth limit is bounded', {
        heapGrowthBytes: latest.heapUsed - first.heapUsed,
        rssGrowthBytes: latest.rss - first.rss
      })
    }
  }
}

function addBrowserHeartbeat(state: HarnessState, heartbeat: BrowserHeartbeat): void {
  if (state.browserHeartbeatCount > 0) {
    const gap = heartbeat.elapsedMs - state.lastBrowserHeartbeatElapsedMs
    state.maximumBrowserHeartbeatGapMs = Math.max(state.maximumBrowserHeartbeatGapMs, gap)
    invariant(
      gap <=
        Math.max(state.config.browserIntervalMs, state.effectiveBrowserIntervalMs) +
          BROWSER_HEARTBEAT_GRACE_MS,
      'browser heartbeat gap remains bounded',
      {
        gap,
        intervalMs: state.effectiveBrowserIntervalMs,
        graceMs: BROWSER_HEARTBEAT_GRACE_MS
      }
    )
  }
  state.browserHeartbeatCount += 1
  if (state.browserHeartbeats.length >= MAX_BROWSER_HEARTBEATS) {
    const before = state.browserHeartbeats.length
    state.browserHeartbeats = state.browserHeartbeats.filter((_entry, index) => index % 2 === 0)
    state.browserHeartbeatsCompacted += before - state.browserHeartbeats.length
    state.effectiveBrowserIntervalMs = Math.max(1, state.effectiveBrowserIntervalMs * 2)
  }
  state.browserHeartbeats.push(heartbeat)
  state.lastBrowserHeartbeatElapsedMs = heartbeat.elapsedMs
  const first = state.browserHeartbeats[0]
  if (first && heartbeat !== first) {
    const heapGrowth = heartbeat.renderer.jsHeapUsedBytes - first.renderer.jsHeapUsedBytes
    const domNodeGrowth = heartbeat.renderer.domNodes - first.renderer.domNodes
    const storageGrowth =
      first.renderer.storageUsageBytes !== null && heartbeat.renderer.storageUsageBytes !== null
        ? heartbeat.renderer.storageUsageBytes - first.renderer.storageUsageBytes
        : null
    invariant(
      heapGrowth <= LIMITS.rendererHardHeapGrowthBytes,
      'renderer hard heap growth remains bounded',
      { heapGrowth }
    )
    invariant(
      storageGrowth === null || storageGrowth <= LIMITS.rendererHardStorageGrowthBytes,
      'renderer hard storage growth remains bounded',
      { storageGrowth }
    )
    invariant(
      domNodeGrowth <= LIMITS.rendererHardDomNodeGrowth,
      'renderer hard DOM growth remains bounded',
      { domNodeGrowth }
    )
  }
}

function serializeFailure(error: unknown, state: HarnessState): FailureRecord {
  const record: FailureRecord = {
    cycle: state.cyclesAttempted,
    elapsedMs: Math.round(performance.now() - state.startedMonotonic),
    phase: state.currentPhase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error)
  }
  if (error instanceof SoakInvariantError) {
    record.check = error.check
    record.details = error.details
  }
  if (error instanceof Error && error.stack) record.stack = error.stack
  return record
}

function recordFailure(state: HarnessState, error: unknown): void {
  if (state.cyclesAttempted > 0 && !state.failedCycleNumbers.has(state.cyclesAttempted)) {
    state.failedCycleNumbers.add(state.cyclesAttempted)
    state.cyclesFailed = state.failedCycleNumbers.size
    state.consecutiveFailures += 1
  }
  if (state.failureRecords.length < MAX_FAILURE_RECORDS) {
    state.failureRecords.push(serializeFailure(error, state))
  } else {
    state.failuresTruncated += 1
  }
}

function scenarioOutcomes(): ScenarioOutcome[] {
  return SAMPLE_SCENARIO_MATRIX.map(({ locale, scenario }) => ({
    locale,
    scenario,
    completedCycles: 0,
    lastCompletedCycle: null,
    journalSequences: []
  }))
}

function appendJournalEntry(
  state: HarnessState,
  input: Omit<SoakJournalEntry, 'sequence' | 'previousHash' | 'entryHash'>
): SoakJournalEntry {
  const sequence = state.journal.length
  const previousHash = state.journal.at(-1)?.entryHash ?? JOURNAL_GENESIS_HASH
  const unsigned: Omit<SoakJournalEntry, 'entryHash'> = {
    sequence,
    previousHash,
    ...input
  }
  const entry: SoakJournalEntry = {
    ...unsigned,
    entryHash: computeSoakJournalEntryHash(unsigned)
  }
  state.journal.push(entry)
  return entry
}

function recordBrowserUiWorkload(state: HarnessState, result: BrowserUiWorkloadResult): void {
  const { receipt, retention } = result
  const elapsedMs = monotonicElapsedMs(state)
  const entry = appendJournalEntry(state, {
    kind: 'operation',
    capturedAt: timestampAtElapsed(state, elapsedMs),
    elapsedMs,
    locale: receipt.locale,
    scenario: receipt.scenario,
    artifactSha256: receipt.artifactSha256,
    browserReceipt: receipt,
    checkpoint: null
  })
  const outcome = scenarioOutcome(state, receipt.locale, receipt.scenario)
  state.operations.browserUiReceipts += 1
  outcome.completedCycles += 1
  outcome.lastCompletedCycle = state.cyclesAttempted
  outcome.journalSequences.push(entry.sequence)
  if (!retention) return
  state.uiRetention.restoredDrafts += retention.restoredDrafts ?? 0
  state.uiRetention.pendingDraftsAtCompletion += retention.pendingDraftsAtCompletion ?? 0
  state.uiRetention.retentionLimit = Math.max(
    state.uiRetention.retentionLimit,
    retention.retentionLimit ?? 0
  )
  state.uiRetention.maximumVisibleRevisions = Math.max(
    state.uiRetention.maximumVisibleRevisions,
    retention.maximumVisibleRevisions ?? 0
  )
  state.uiRetention.retainedBpmnFiles += retention.retainedBpmnFiles ?? 0
  state.uiRetention.retainedMetadataFiles += retention.retainedMetadataFiles ?? 0
  state.uiRetention.oldestSeedPruned ||= retention.oldestSeedPruned ?? false
  state.uiRetention.pickerCancellations += retention.pickerCancellations ?? 0
  state.uiRetention.workspacePreserved &&= retention.workspacePreserved ?? true
}

function totalCompletedOperations(operations: OperationCounts): number {
  return Object.values(operations).reduce((total, count) => total + count, 0)
}

function totalStorageBytes(storage: readonly WorkspaceStorageSample[]): number {
  return storage.reduce((total, workspace) => total + workspace.fileBytes, 0)
}

function monotonicElapsedMs(state: HarnessState): number {
  return Math.max(0, Math.floor(performance.now() - state.startedMonotonic))
}

function timestampAtElapsed(state: HarnessState, elapsedMs: number): string {
  return new Date(state.startedWallMs + elapsedMs).toISOString()
}

function scenarioOutcome(
  state: HarnessState,
  locale: SoakLocale,
  scenario: SoakScenario
): ScenarioOutcome {
  return state.scenarioOutcomes.find(
    (outcome) => outcome.locale === locale && outcome.scenario === scenario
  )!
}

function sampleScenario(state: HarnessState, sequence: number): ScenarioOutcome {
  const preferredIndex = sequence % SAMPLE_SCENARIO_MATRIX.length
  const preferred = SAMPLE_SCENARIO_MATRIX[preferredIndex]!
  if (sequence === 0) return scenarioOutcome(state, preferred.locale, preferred.scenario)
  for (let offset = 0; offset < SAMPLE_SCENARIO_MATRIX.length; offset += 1) {
    const candidate =
      SAMPLE_SCENARIO_MATRIX[(preferredIndex + offset) % SAMPLE_SCENARIO_MATRIX.length]!
    const outcome = scenarioOutcome(state, candidate.locale, candidate.scenario)
    if (outcome.completedCycles > 0) return outcome
  }
  return scenarioOutcome(state, preferred.locale, preferred.scenario)
}

function sampledGrowth(samples: readonly AutomatedSoakSample[]): {
  residentMemoryBytes: number
  storageBytes: number
} {
  const first = samples[0]
  if (!first) return { residentMemoryBytes: 0, storageBytes: 0 }
  const peakResidentMemory = Math.max(
    ...samples.map(({ residentMemoryBytes }) => residentMemoryBytes)
  )
  const peakStorage = Math.max(...samples.map(({ storageBytes }) => storageBytes))
  return {
    residentMemoryBytes: Math.max(0, peakResidentMemory - first.residentMemoryBytes),
    storageBytes: Math.max(0, peakStorage - first.storageBytes)
  }
}

function addEvidenceSample(
  state: HarnessState,
  elapsedMs: number,
  healthy: boolean,
  options: {
    requireOperationIncrease?: boolean
    enforceGap?: boolean
    enforceGrowth?: boolean
  } = {}
): AutomatedSoakSample {
  const sequence = state.evidenceSamples.length
  const outcome = sampleScenario(state, sequence)
  const sample: AutomatedSoakSample = {
    capturedAt: timestampAtElapsed(state, elapsedMs),
    elapsedMs,
    residentMemoryBytes: memoryUsage().rss,
    storageBytes: totalStorageBytes(state.lastStorage),
    locale: outcome.locale,
    scenario: outcome.scenario,
    healthy,
    sequence,
    completedOperations: totalCompletedOperations(state.operations),
    completedScenarioCycles: outcome.completedCycles
  }
  const previous = state.evidenceSamples.at(-1)
  if (previous) {
    const allowedGapMs =
      state.config.supportSampleIntervalMinutes * 60_000 + SUPPORT_SAMPLE_GRACE_MS
    invariant(
      sample.elapsedMs > previous.elapsedMs,
      'automated samples are strictly chronological',
      {
        previousElapsedMs: previous.elapsedMs,
        elapsedMs: sample.elapsedMs
      }
    )
    if (options.enforceGap !== false) {
      invariant(
        sample.elapsedMs - previous.elapsedMs <= allowedGapMs,
        'automated sample gap remains bounded',
        {
          gapMs: sample.elapsedMs - previous.elapsedMs,
          allowedGapMs
        }
      )
    }
    if (options.requireOperationIncrease !== false) {
      invariant(
        sample.completedOperations > previous.completedOperations,
        'automated sample operations strictly increase',
        {
          previousCompletedOperations: previous.completedOperations,
          completedOperations: sample.completedOperations
        }
      )
    }
  } else {
    invariant(sample.elapsedMs === 0, 'first automated sample is the exact start')
    invariant(sample.completedOperations === 0, 'first automated sample has zero operations')
  }
  state.evidenceSamples.push(sample)
  appendJournalEntry(state, {
    kind: 'checkpoint',
    capturedAt: sample.capturedAt,
    elapsedMs: sample.elapsedMs,
    locale: null,
    scenario: null,
    artifactSha256: state.candidate.artifactAtStart.sha256,
    browserReceipt: null,
    checkpoint: {
      sampleSequence: sample.sequence,
      completedOperations: sample.completedOperations,
      completedScenarioCycles: sample.completedScenarioCycles,
      residentMemoryBytes: sample.residentMemoryBytes,
      storageBytes: sample.storageBytes,
      healthy: sample.healthy
    }
  })
  const growth = sampledGrowth(state.evidenceSamples)
  if (options.enforceGrowth !== false) {
    invariant(
      growth.residentMemoryBytes <= LIMITS.hardRssGrowthBytes,
      'sampled RSS growth remains at or below 512 MiB',
      {
        growthBytes: growth.residentMemoryBytes,
        limitBytes: LIMITS.hardRssGrowthBytes
      }
    )
    invariant(
      growth.storageBytes <= LIMITS.bytesPerWorkspace * state.adapters.length,
      'sampled storage growth remains bounded',
      {
        growthBytes: growth.storageBytes,
        limitBytes: LIMITS.bytesPerWorkspace * state.adapters.length
      }
    )
  }
  return sample
}

function captureDueEvidenceSample(state: HarnessState): boolean {
  const elapsedMs = monotonicElapsedMs(state)
  if (elapsedMs < state.nextEvidenceSampleElapsedMs) return false
  addEvidenceSample(state, elapsedMs, state.failureRecords.length === 0 && !state.stopSignal)
  const intervalMs = state.config.supportSampleIntervalMinutes * 60_000
  while (state.nextEvidenceSampleElapsedMs <= elapsedMs) {
    state.nextEvidenceSampleElapsedMs += intervalMs
  }
  return true
}

const ARABIC_SCENARIO_NAMES: Readonly<Record<SoakScenario, string>> = {
  edits: 'التعديلات',
  recovery: 'استعادة المسودة',
  'workspace-switching': 'التبديل بين مساحات العمل',
  imports: 'استيراد جدول البيانات',
  'translation-cancellation': 'إلغاء الترجمة',
  'history-cleanup': 'تنظيف سجل الإصدارات'
}

function buildScenarioResults(state: HarnessState): AutomatedSoakRecord['scenarioResults'] {
  return state.scenarioOutcomes.map(({ locale, scenario, completedCycles, journalSequences }) => ({
    locale,
    scenario,
    passed: completedCycles > 0,
    completedCycles,
    uiReceiptCount: journalSequences.length,
    firstJournalSequence: journalSequences[0] ?? null,
    lastJournalSequence: journalSequences.at(-1) ?? null,
    findings:
      locale === 'ar'
        ? `اكتملت ${completedCycles} تفاعلات موثقة عبر واجهة HTML المطابقة لسيناريو ${ARABIC_SCENARIO_NAMES[scenario]} ضمن سياق المتصفح العربي الدائم.`
        : `Completed ${completedCycles} exact-artifact production-UI ${scenario} interaction receipts in the persistent English browser context.`
  }))
}

function buildRetentionResults(state: HarnessState): AutomatedSoakRecord['retentionResults'] {
  const uiRecoveryReceipts = state.scenarioOutcomes
    .filter(({ scenario }) => scenario === 'recovery')
    .reduce((total, { completedCycles }) => total + completedCycles, 0)
  const uiHistoryReceipts = state.scenarioOutcomes
    .filter(({ scenario }) => scenario === 'history-cleanup')
    .reduce((total, { completedCycles }) => total + completedCycles, 0)
  const uiWorkspaceSwitchReceipts = state.scenarioOutcomes
    .filter(({ scenario }) => scenario === 'workspace-switching')
    .reduce((total, { completedCycles }) => total + completedCycles, 0)
  const uiImportReceipts = state.scenarioOutcomes
    .filter(({ scenario }) => scenario === 'imports')
    .reduce((total, { completedCycles }) => total + completedCycles, 0)
  const draftPassed =
    uiRecoveryReceipts === SOAK_LOCALES.length &&
    state.uiRetention.restoredDrafts === SOAK_LOCALES.length &&
    state.uiRetention.pendingDraftsAtCompletion === 0
  const historyPassed =
    uiHistoryReceipts === SOAK_LOCALES.length &&
    state.uiRetention.retentionLimit === UI_HISTORY_RETENTION_LIMIT &&
    state.uiRetention.maximumVisibleRevisions === UI_HISTORY_RETENTION_LIMIT &&
    state.uiRetention.retainedBpmnFiles === UI_HISTORY_RETENTION_LIMIT * SOAK_LOCALES.length &&
    state.uiRetention.retainedMetadataFiles === UI_HISTORY_RETENTION_LIMIT * SOAK_LOCALES.length &&
    state.uiRetention.oldestSeedPruned
  const workspacePassed =
    uiWorkspaceSwitchReceipts === SOAK_LOCALES.length &&
    state.uiRetention.pickerCancellations === SOAK_LOCALES.length &&
    state.uiRetention.workspacePreserved &&
    uiImportReceipts === SOAK_LOCALES.length
  return [
    {
      check: 'draft-recovery',
      passed: draftPassed,
      metrics: {
        uiRecoveryReceipts,
        restoredDrafts: state.uiRetention.restoredDrafts,
        pendingDraftsAtCompletion: state.uiRetention.pendingDraftsAtCompletion
      },
      findings: `The exact HTML produced ${uiRecoveryReceipts} production-UI recovery receipts, restored ${state.uiRetention.restoredDrafts} drafts, and left ${state.uiRetention.pendingDraftsAtCompletion} pending drafts.`
    },
    {
      check: 'history-retention',
      passed: historyPassed,
      metrics: {
        uiHistoryReceipts,
        retentionLimit: state.uiRetention.retentionLimit,
        maximumVisibleRevisions: state.uiRetention.maximumVisibleRevisions,
        retainedBpmnFiles: state.uiRetention.retainedBpmnFiles,
        retainedMetadataFiles: state.uiRetention.retainedMetadataFiles,
        oldestSeedPruned: state.uiRetention.oldestSeedPruned
      },
      findings: `The exact HTML produced ${uiHistoryReceipts} history-cleanup receipts and retained ${state.uiRetention.retainedBpmnFiles} BPMN plus ${state.uiRetention.retainedMetadataFiles} metadata revisions across both localized contexts.`
    },
    {
      check: 'workspace-state',
      passed: workspacePassed,
      metrics: {
        uiWorkspaceSwitchReceipts,
        pickerCancellations: state.uiRetention.pickerCancellations,
        workspacePreserved: state.uiRetention.workspacePreserved,
        uiImportReceipts
      },
      findings: `The exact HTML preserved both localized workspaces across ${state.uiRetention.pickerCancellations} production picker cancellations and committed ${uiImportReceipts} UI spreadsheet imports.`
    }
  ]
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === expected.length &&
    expected.every((entry) => actual.includes(entry))
  )
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index])
}

function canonicalTimestamp(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null
}

function safeDecodedPathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return decoded &&
      decoded !== '.' &&
      decoded !== '..' &&
      !decoded.includes('/') &&
      !decoded.includes('\\')
      ? decoded
      : null
  } catch {
    return null
  }
}

export function automatedSoakRecordIssues(
  record: AutomatedSoakRecord,
  diagnosticBytes?: Uint8Array
): string[] {
  const issues: string[] = []
  const startedAt = canonicalTimestamp(record.startedAt)
  const completedAt = canonicalTimestamp(record.completedAt)
  if (record.schemaVersion !== SUPPORT_SCHEMA_VERSION) issues.push('schemaVersion')
  if (record.evidenceType !== 'orbitpm-lite-soak-automation') issues.push('evidenceType')
  if (!/^[a-f0-9]{40}$/.test(record.candidateSha) || /^0{40}$/.test(record.candidateSha)) {
    issues.push('candidateSha')
  }
  if (!/^[a-f0-9]{64}$/.test(record.artifactSha256) || /^0{64}$/.test(record.artifactSha256)) {
    issues.push('artifactSha256')
  }
  if (
    typeof record.diagnosticEvidenceUrl !== 'string' ||
    !/^\.\/[^/?#]+$/u.test(record.diagnosticEvidenceUrl) ||
    safeDecodedPathSegment(record.diagnosticEvidenceUrl.slice(2)) === null
  ) {
    issues.push('diagnosticEvidenceUrl')
  }
  if (
    !/^[a-f0-9]{64}$/.test(record.diagnosticEvidenceSha256) ||
    /^0{64}$/.test(record.diagnosticEvidenceSha256) ||
    !Number.isSafeInteger(record.diagnosticEvidenceSizeBytes) ||
    record.diagnosticEvidenceSizeBytes <= 0
  ) {
    issues.push('diagnosticEvidenceBinding')
  }
  if (
    !['passed', 'failed', 'interrupted', 'smoke-passed', 'smoke-failed'].includes(record.status)
  ) {
    issues.push('status')
  }
  if (
    record.restarts !== 0 ||
    typeof record.uninterrupted !== 'boolean' ||
    record.passed !== record.releaseEligible ||
    (record.passed &&
      (!record.harnessPassed || !record.uninterrupted || record.status !== 'passed'))
  ) {
    issues.push('continuityFlags')
  }
  if (
    record.durationRequirementMs !== DEFAULT_DURATION_MS ||
    record.durationRequirementSatisfied !== record.durationMs >= DEFAULT_DURATION_MS
  ) {
    issues.push('durationRequirement')
  }
  if (
    record.clock?.wallClock !== 'UTC' ||
    record.clock?.elapsedClock !== 'performance.now' ||
    record.clock?.timestampDerivation !== 'startedAt-plus-monotonic-elapsed'
  ) {
    issues.push('clock')
  }
  if (
    startedAt === null ||
    completedAt === null ||
    completedAt < startedAt ||
    completedAt - startedAt !== record.durationMs
  ) {
    issues.push('chronology')
  }
  if (
    !Number.isInteger(record.sampleIntervalMinutes) ||
    record.sampleIntervalMinutes < 1 ||
    record.sampleIntervalMinutes > MAX_SUPPORT_SAMPLE_INTERVAL_MINUTES
  ) {
    issues.push('sampleIntervalMinutes')
  }
  if (!exactStringSet(record.locales, SOAK_LOCALES)) issues.push('locales')
  if (!exactStringSet(record.scenarios, SOAK_SCENARIOS)) issues.push('scenarios')
  if (!exactStringSet(record.retentionChecks, SOAK_RETENTION_CHECKS)) {
    issues.push('retentionChecks')
  }
  if (
    record.journalSchemaVersion !== JOURNAL_SCHEMA_VERSION ||
    record.journalHashAlgorithm !== JOURNAL_HASH_ALGORITHM ||
    !Number.isSafeInteger(record.journalEntryCount) ||
    record.journalEntryCount !== record.journal.length ||
    !/^[a-f0-9]{64}$/.test(record.journalRootSha256)
  ) {
    issues.push('journalHeader')
  }
  const operationSequences = new Map<string, number[]>()
  const checkpointsBySample = new Map<number, SoakJournalCheckpoint>()
  let previousJournalHash = JOURNAL_GENESIS_HASH
  let previousJournalElapsedMs = -1
  for (const [index, entry] of record.journal.entries()) {
    const capturedAt = canonicalTimestamp(entry.capturedAt)
    const unsignedWithHash = structuredClone(entry) as Omit<SoakJournalEntry, 'entryHash'> &
      Partial<Pick<SoakJournalEntry, 'entryHash'>>
    delete unsignedWithHash.entryHash
    const unsigned = unsignedWithHash as Omit<SoakJournalEntry, 'entryHash'>
    let recomputedHash: string | null = null
    try {
      recomputedHash = computeSoakJournalEntryHash(unsigned)
    } catch {
      recomputedHash = null
    }
    if (
      !hasExactKeys(entry, [
        'sequence',
        'kind',
        'capturedAt',
        'elapsedMs',
        'locale',
        'scenario',
        'artifactSha256',
        'previousHash',
        'browserReceipt',
        'checkpoint',
        'entryHash'
      ]) ||
      entry.sequence !== index ||
      !['operation', 'checkpoint'].includes(entry.kind) ||
      capturedAt === null ||
      startedAt === null ||
      capturedAt !== startedAt + entry.elapsedMs ||
      !Number.isSafeInteger(entry.elapsedMs) ||
      entry.elapsedMs < previousJournalElapsedMs ||
      entry.previousHash !== previousJournalHash ||
      entry.artifactSha256 !== record.artifactSha256 ||
      !/^[a-f0-9]{64}$/.test(entry.entryHash) ||
      recomputedHash !== entry.entryHash
    ) {
      issues.push(`journal[${index}]`)
    }
    if (entry.kind === 'operation') {
      const receipt = entry.browserReceipt
      if (
        entry.checkpoint !== null ||
        !receipt ||
        entry.locale === null ||
        entry.scenario === null ||
        receipt.locale !== entry.locale ||
        receipt.scenario !== entry.scenario ||
        !hasExactKeys(receipt, [
          'receiptVersion',
          'evidenceSource',
          'contextId',
          'locale',
          'scenario',
          'artifactSha256',
          'artifactSizeBytes',
          'documentUrl',
          'browserLocale',
          'direction',
          'interaction',
          'productionSelectors',
          'interactionCount',
          'beforeStateSha256',
          'afterStateSha256',
          'assertions'
        ]) ||
        receipt.receiptVersion !== 1 ||
        receipt.evidenceSource !== 'exact-bound-html-production-ui' ||
        receipt.contextId !== `persistent-${receipt.locale}` ||
        receipt.artifactSha256 !== record.artifactSha256 ||
        receipt.artifactSizeBytes !== record.artifactEndpoints.sizeBytesAtStart ||
        typeof receipt.documentUrl !== 'string' ||
        !receipt.documentUrl.startsWith('file://') ||
        receipt.browserLocale !== (receipt.locale === 'ar' ? 'ar-AE' : 'en-US') ||
        receipt.direction !== (receipt.locale === 'ar' ? 'rtl' : 'ltr') ||
        typeof receipt.interaction !== 'string' ||
        receipt.interaction.length < 12 ||
        !Array.isArray(receipt.productionSelectors) ||
        receipt.productionSelectors.length < 2 ||
        receipt.productionSelectors.some(
          (selector) => typeof selector !== 'string' || selector.length < 5
        ) ||
        !Number.isSafeInteger(receipt.interactionCount) ||
        receipt.interactionCount < 1 ||
        !/^[a-f0-9]{64}$/.test(receipt.beforeStateSha256) ||
        !/^[a-f0-9]{64}$/.test(receipt.afterStateSha256) ||
        !Array.isArray(receipt.assertions) ||
        receipt.assertions.length < 1 ||
        receipt.assertions.some(
          (assertion) =>
            !hasExactKeys(assertion, ['name', 'passed', 'observed']) ||
            typeof assertion.name !== 'string' ||
            assertion.name.length < 5 ||
            assertion.passed !== true ||
            !['string', 'number', 'boolean'].includes(typeof assertion.observed) ||
            (typeof assertion.observed === 'number' &&
              (!Number.isSafeInteger(assertion.observed) || assertion.observed < 0))
        )
      ) {
        issues.push(`journal[${index}].browserReceipt`)
      } else {
        const key = `${entry.locale}:${entry.scenario}`
        const sequences = operationSequences.get(key) ?? []
        sequences.push(index)
        operationSequences.set(key, sequences)
      }
    } else {
      const checkpoint = entry.checkpoint
      if (
        entry.locale !== null ||
        entry.scenario !== null ||
        entry.browserReceipt !== null ||
        !checkpoint ||
        !hasExactKeys(checkpoint, [
          'sampleSequence',
          'completedOperations',
          'completedScenarioCycles',
          'residentMemoryBytes',
          'storageBytes',
          'healthy'
        ]) ||
        !Number.isSafeInteger(checkpoint.sampleSequence) ||
        checkpoint.sampleSequence < 0 ||
        !Number.isSafeInteger(checkpoint.completedOperations) ||
        checkpoint.completedOperations < 0 ||
        !Number.isSafeInteger(checkpoint.completedScenarioCycles) ||
        checkpoint.completedScenarioCycles < 0 ||
        !Number.isSafeInteger(checkpoint.residentMemoryBytes) ||
        checkpoint.residentMemoryBytes <= 0 ||
        !Number.isSafeInteger(checkpoint.storageBytes) ||
        checkpoint.storageBytes < 0 ||
        typeof checkpoint.healthy !== 'boolean' ||
        checkpointsBySample.has(checkpoint.sampleSequence)
      ) {
        issues.push(`journal[${index}].checkpoint`)
      } else {
        checkpointsBySample.set(checkpoint.sampleSequence, checkpoint)
      }
    }
    previousJournalHash = entry.entryHash
    previousJournalElapsedMs = entry.elapsedMs
  }
  if (
    record.journal.length === 0 ||
    record.journalRootSha256 !== record.journal.at(-1)?.entryHash
  ) {
    issues.push('journalRootSha256')
  }
  const sampleCoverage = new Set<string>()
  const sampleLocaleCounts = new Map<SoakLocale, number>(SOAK_LOCALES.map((locale) => [locale, 0]))
  let previous: AutomatedSoakSample | undefined
  for (const [index, sample] of record.samples.entries()) {
    const capturedAt = canonicalTimestamp(sample.capturedAt)
    if (
      sample.sequence !== index ||
      capturedAt === null ||
      startedAt === null ||
      capturedAt !== startedAt + sample.elapsedMs ||
      !Number.isSafeInteger(sample.elapsedMs) ||
      sample.elapsedMs < 0 ||
      !Number.isSafeInteger(sample.residentMemoryBytes) ||
      sample.residentMemoryBytes <= 0 ||
      !Number.isSafeInteger(sample.storageBytes) ||
      sample.storageBytes < 0 ||
      !Number.isSafeInteger(sample.completedOperations) ||
      sample.completedOperations < 0 ||
      !Number.isSafeInteger(sample.completedScenarioCycles) ||
      sample.completedScenarioCycles < 0 ||
      typeof sample.healthy !== 'boolean' ||
      !SOAK_LOCALES.includes(sample.locale) ||
      !SOAK_SCENARIOS.includes(sample.scenario)
    ) {
      issues.push(`samples[${index}]`)
    }
    if (previous) {
      if (
        sample.elapsedMs <= previous.elapsedMs ||
        sample.completedOperations < previous.completedOperations ||
        (record.passed &&
          (sample.elapsedMs - previous.elapsedMs >
            record.sampleIntervalMinutes * 60_000 + SUPPORT_SAMPLE_GRACE_MS ||
            sample.completedOperations === previous.completedOperations))
      ) {
        issues.push(`samples[${index}].continuity`)
      }
    } else if (
      sample.elapsedMs !== 0 ||
      sample.completedOperations !== 0 ||
      sample.completedScenarioCycles !== 0
    ) {
      issues.push('samples[0].boundary')
    }
    if (record.passed && sample.healthy !== true) issues.push(`samples[${index}].healthy`)
    const checkpoint = checkpointsBySample.get(index)
    if (
      !checkpoint ||
      checkpoint.completedOperations !== sample.completedOperations ||
      checkpoint.completedScenarioCycles !== sample.completedScenarioCycles ||
      checkpoint.residentMemoryBytes !== sample.residentMemoryBytes ||
      checkpoint.storageBytes !== sample.storageBytes ||
      checkpoint.healthy !== sample.healthy
    ) {
      issues.push(`samples[${index}].checkpoint`)
    }
    sampleCoverage.add(`${sample.locale}:${sample.scenario}`)
    sampleLocaleCounts.set(sample.locale, (sampleLocaleCounts.get(sample.locale) ?? 0) + 1)
    previous = sample
  }
  const firstSample = record.samples[0]
  const finalSample = record.samples.at(-1)
  if (
    !firstSample ||
    !finalSample ||
    checkpointsBySample.size !== record.samples.length ||
    firstSample.capturedAt !== record.startedAt ||
    finalSample.capturedAt !== record.completedAt ||
    finalSample.elapsedMs !== record.durationMs
  ) {
    issues.push('sampleBoundaries')
  }
  const growth = sampledGrowth(record.samples)
  if (
    growth.residentMemoryBytes !== record.observedResidentMemoryGrowthBytes ||
    growth.storageBytes !== record.observedStorageGrowthBytes ||
    record.maxResidentMemoryGrowthBytes !== LIMITS.hardRssGrowthBytes ||
    record.maxStorageGrowthBytes !== LIMITS.bytesPerWorkspace * 2 ||
    (record.passed &&
      (growth.residentMemoryBytes > record.maxResidentMemoryGrowthBytes ||
        growth.storageBytes > record.maxStorageGrowthBytes))
  ) {
    issues.push('sampledGrowth')
  }
  const resultCoverage = new Set(
    record.scenarioResults.map(({ locale, scenario }) => `${locale}:${scenario}`)
  )
  if (
    record.scenarioResults.length !== SAMPLE_SCENARIO_MATRIX.length ||
    resultCoverage.size !== SAMPLE_SCENARIO_MATRIX.length ||
    SAMPLE_SCENARIO_MATRIX.some(
      ({ locale, scenario }) => !resultCoverage.has(`${locale}:${scenario}`)
    ) ||
    record.scenarioResults.some(
      ({
        locale,
        scenario,
        passed,
        completedCycles,
        uiReceiptCount,
        firstJournalSequence,
        lastJournalSequence,
        findings
      }) => {
        const operationReceiptSequences = operationSequences.get(`${locale}:${scenario}`) ?? []
        return (
          !hasExactKeys(
            record.scenarioResults.find(
              (candidate) => candidate.locale === locale && candidate.scenario === scenario
            ),
            [
              'locale',
              'scenario',
              'passed',
              'completedCycles',
              'uiReceiptCount',
              'firstJournalSequence',
              'lastJournalSequence',
              'findings'
            ]
          ) ||
          !SOAK_LOCALES.includes(locale) ||
          !SOAK_SCENARIOS.includes(scenario) ||
          typeof passed !== 'boolean' ||
          !Number.isSafeInteger(completedCycles) ||
          completedCycles < 0 ||
          !Number.isSafeInteger(uiReceiptCount) ||
          uiReceiptCount < 0 ||
          completedCycles !== uiReceiptCount ||
          uiReceiptCount !== operationReceiptSequences.length ||
          firstJournalSequence !== (operationReceiptSequences[0] ?? null) ||
          lastJournalSequence !== (operationReceiptSequences.at(-1) ?? null) ||
          passed !== uiReceiptCount > 0 ||
          typeof findings !== 'string' ||
          findings.trim().length < 20
        )
      }
    )
  ) {
    issues.push('scenarioResults')
  }
  for (const sample of record.samples) {
    const result = record.scenarioResults.find(
      ({ locale, scenario }) => locale === sample.locale && scenario === sample.scenario
    )
    if (result && sample.completedScenarioCycles > result.completedCycles) {
      issues.push(`sampleScenarioCount:${sample.sequence}`)
    }
  }
  const retentionCoverage = new Set(record.retentionResults.map(({ check }) => check))
  if (
    record.retentionResults.length !== SOAK_RETENTION_CHECKS.length ||
    !exactStringSet([...retentionCoverage], SOAK_RETENTION_CHECKS)
  ) {
    issues.push('retentionResults')
  }
  const draftRetention = record.retentionResults.find((result) => result.check === 'draft-recovery')
  if (
    !draftRetention ||
    !hasExactKeys(draftRetention, ['check', 'passed', 'metrics', 'findings']) ||
    !hasExactKeys(draftRetention.metrics, [
      'uiRecoveryReceipts',
      'restoredDrafts',
      'pendingDraftsAtCompletion'
    ]) ||
    !Number.isSafeInteger(draftRetention.metrics.uiRecoveryReceipts) ||
    draftRetention.metrics.uiRecoveryReceipts < 0 ||
    !Number.isSafeInteger(draftRetention.metrics.restoredDrafts) ||
    draftRetention.metrics.restoredDrafts < 0 ||
    !Number.isSafeInteger(draftRetention.metrics.pendingDraftsAtCompletion) ||
    draftRetention.metrics.pendingDraftsAtCompletion < 0 ||
    draftRetention.metrics.uiRecoveryReceipts !==
      (operationSequences.get('en:recovery')?.length ?? 0) +
        (operationSequences.get('ar:recovery')?.length ?? 0) ||
    draftRetention.passed !==
      (draftRetention.metrics.uiRecoveryReceipts === SOAK_LOCALES.length &&
        draftRetention.metrics.restoredDrafts === SOAK_LOCALES.length &&
        draftRetention.metrics.pendingDraftsAtCompletion === 0) ||
    typeof draftRetention.findings !== 'string' ||
    draftRetention.findings.trim().length < 20
  ) {
    issues.push('retentionResults:draft-recovery')
  }
  const historyRetention = record.retentionResults.find(
    (result) => result.check === 'history-retention'
  )
  if (
    !historyRetention ||
    !hasExactKeys(historyRetention, ['check', 'passed', 'metrics', 'findings']) ||
    !hasExactKeys(historyRetention.metrics, [
      'uiHistoryReceipts',
      'retentionLimit',
      'maximumVisibleRevisions',
      'retainedBpmnFiles',
      'retainedMetadataFiles',
      'oldestSeedPruned'
    ]) ||
    !Number.isSafeInteger(historyRetention.metrics.uiHistoryReceipts) ||
    historyRetention.metrics.uiHistoryReceipts < 0 ||
    historyRetention.metrics.retentionLimit !== UI_HISTORY_RETENTION_LIMIT ||
    historyRetention.metrics.maximumVisibleRevisions !== UI_HISTORY_RETENTION_LIMIT ||
    historyRetention.metrics.retainedBpmnFiles !==
      UI_HISTORY_RETENTION_LIMIT * historyRetention.metrics.uiHistoryReceipts ||
    historyRetention.metrics.retainedMetadataFiles !==
      UI_HISTORY_RETENTION_LIMIT * historyRetention.metrics.uiHistoryReceipts ||
    typeof historyRetention.metrics.oldestSeedPruned !== 'boolean' ||
    historyRetention.metrics.uiHistoryReceipts !==
      (operationSequences.get('en:history-cleanup')?.length ?? 0) +
        (operationSequences.get('ar:history-cleanup')?.length ?? 0) ||
    historyRetention.passed !==
      (historyRetention.metrics.uiHistoryReceipts === SOAK_LOCALES.length &&
        historyRetention.metrics.oldestSeedPruned) ||
    typeof historyRetention.findings !== 'string' ||
    historyRetention.findings.trim().length < 20
  ) {
    issues.push('retentionResults:history-retention')
  }
  const workspaceRetention = record.retentionResults.find(
    (result) => result.check === 'workspace-state'
  )
  if (
    !workspaceRetention ||
    !hasExactKeys(workspaceRetention, ['check', 'passed', 'metrics', 'findings']) ||
    !hasExactKeys(workspaceRetention.metrics, [
      'uiWorkspaceSwitchReceipts',
      'pickerCancellations',
      'workspacePreserved',
      'uiImportReceipts'
    ]) ||
    !Number.isSafeInteger(workspaceRetention.metrics.uiWorkspaceSwitchReceipts) ||
    workspaceRetention.metrics.uiWorkspaceSwitchReceipts < 0 ||
    !Number.isSafeInteger(workspaceRetention.metrics.pickerCancellations) ||
    workspaceRetention.metrics.pickerCancellations < 0 ||
    typeof workspaceRetention.metrics.workspacePreserved !== 'boolean' ||
    !Number.isSafeInteger(workspaceRetention.metrics.uiImportReceipts) ||
    workspaceRetention.metrics.uiImportReceipts < 0 ||
    workspaceRetention.metrics.uiWorkspaceSwitchReceipts !==
      (operationSequences.get('en:workspace-switching')?.length ?? 0) +
        (operationSequences.get('ar:workspace-switching')?.length ?? 0) ||
    workspaceRetention.metrics.uiImportReceipts !==
      (operationSequences.get('en:imports')?.length ?? 0) +
        (operationSequences.get('ar:imports')?.length ?? 0) ||
    workspaceRetention.passed !==
      (workspaceRetention.metrics.uiWorkspaceSwitchReceipts === SOAK_LOCALES.length &&
        workspaceRetention.metrics.pickerCancellations === SOAK_LOCALES.length &&
        workspaceRetention.metrics.workspacePreserved &&
        workspaceRetention.metrics.uiImportReceipts === SOAK_LOCALES.length) ||
    typeof workspaceRetention.findings !== 'string' ||
    workspaceRetention.findings.trim().length < 20
  ) {
    issues.push('retentionResults:workspace-state')
  }
  if (
    record.smoke &&
    (record.passed ||
      record.releaseEligible ||
      !['smoke-passed', 'smoke-failed'].includes(record.status))
  ) {
    issues.push('smokeEligibility')
  }
  if (!record.smoke && record.status.startsWith('smoke-')) issues.push('smokeEligibility')
  if (typeof record.findings !== 'string' || record.findings.trim().length < 40) {
    issues.push('findings')
  }
  if (record.passed) {
    const minimumSamples =
      Math.ceil(record.durationMs / (record.sampleIntervalMinutes * 60_000)) + 1
    if (
      !record.harnessPassed ||
      !record.releaseEligible ||
      !record.durationRequirementSatisfied ||
      record.durationMs < record.durationRequirementMs ||
      record.samples.length < minimumSamples
    ) {
      issues.push('releaseEligibility')
    }
    const minimumSamplesPerLocale = Math.ceil(record.samples.length / 4)
    for (const locale of SOAK_LOCALES) {
      if ((sampleLocaleCounts.get(locale) ?? 0) < minimumSamplesPerLocale) {
        issues.push(`sampleLocaleCoverage:${locale}`)
      }
      for (const scenario of SOAK_SCENARIOS) {
        if (!sampleCoverage.has(`${locale}:${scenario}`)) {
          issues.push(`sampleScenarioCoverage:${locale}:${scenario}`)
        }
      }
    }
    if (record.scenarioResults.some((result) => !result.passed || result.completedCycles < 1)) {
      issues.push('scenarioResultFailures')
    }
    if (record.retentionResults.some((result) => !result.passed)) {
      issues.push('retentionResultFailures')
    }
    if (
      record.candidateEndpoints.requiredSha !== record.candidateSha ||
      record.candidateEndpoints.headShaAtStart !== record.candidateSha ||
      record.candidateEndpoints.headShaAtEnd !== record.candidateSha ||
      record.candidateEndpoints.cleanAtStart !== true ||
      record.candidateEndpoints.cleanAtEnd !== true ||
      record.candidateEndpoints.matchedAtStart !== true ||
      record.candidateEndpoints.matchedAtEnd !== true ||
      record.artifactEndpoints.sha256AtStart !== record.artifactSha256 ||
      record.artifactEndpoints.sha256AtEnd !== record.artifactSha256 ||
      !Number.isSafeInteger(record.artifactEndpoints.sizeBytesAtStart) ||
      record.artifactEndpoints.sizeBytesAtStart <= 0 ||
      record.artifactEndpoints.sizeBytesAtEnd !== record.artifactEndpoints.sizeBytesAtStart ||
      record.artifactEndpoints.matchedAtEnd !== true
    ) {
      issues.push('endpointBinding')
    }
  }
  if (!diagnosticBytes) {
    issues.push('diagnosticEvidenceBytesRequired')
  } else {
    const diagnosticSha256 = createHash('sha256').update(diagnosticBytes).digest('hex')
    if (
      diagnosticBytes.byteLength !== record.diagnosticEvidenceSizeBytes ||
      diagnosticSha256 !== record.diagnosticEvidenceSha256
    ) {
      issues.push('diagnosticEvidenceBinding')
    }
    try {
      const diagnostic = JSON.parse(Buffer.from(diagnosticBytes).toString('utf8')) as {
        candidate?: {
          artifactAtStart?: { sha256?: unknown; sizeBytes?: unknown }
          requiredSha?: unknown
        }
        operationJournal?: {
          schemaVersion?: unknown
          hashAlgorithm?: unknown
          entryCount?: unknown
          rootSha256?: unknown
          entries?: unknown
        }
      }
      if (
        diagnostic.candidate?.requiredSha !== record.candidateEndpoints.requiredSha ||
        diagnostic.candidate?.artifactAtStart?.sha256 !== record.artifactSha256 ||
        diagnostic.candidate?.artifactAtStart?.sizeBytes !==
          record.artifactEndpoints.sizeBytesAtStart ||
        diagnostic.operationJournal?.schemaVersion !== record.journalSchemaVersion ||
        diagnostic.operationJournal?.hashAlgorithm !== record.journalHashAlgorithm ||
        diagnostic.operationJournal?.entryCount !== record.journalEntryCount ||
        diagnostic.operationJournal?.rootSha256 !== record.journalRootSha256 ||
        canonicalizeEvidenceJson(diagnostic.operationJournal?.entries) !==
          canonicalizeEvidenceJson(record.journal)
      ) {
        issues.push('diagnosticJournalBinding')
      }
    } catch {
      issues.push('diagnosticEvidenceJson')
    }
  }
  return [...new Set(issues)]
}

export function validateAutomatedSoakRecord(
  record: AutomatedSoakRecord,
  diagnosticBytes?: Uint8Array
): void {
  const issues = automatedSoakRecordIssues(record, diagnosticBytes)
  if (issues.length > 0) {
    throw new Error(`Automated soak evidence is invalid: ${issues.join(', ')}.`)
  }
}

function buildAutomatedSoakRecord(
  state: HarnessState,
  diagnosticStatus: 'passed' | 'failed' | 'interrupted',
  completedAt: string,
  durationMs: number,
  harnessPassed: boolean,
  diagnosticBinding: DiagnosticBinding,
  diagnosticBytes: Uint8Array
): AutomatedSoakRecord {
  const growth = sampledGrowth(state.evidenceSamples)
  const scenarioResults = buildScenarioResults(state)
  const retentionResults = buildRetentionResults(state)
  const observedBrowserLocales = [
    ...new Set(
      state.browserHeartbeats.flatMap(({ locales }) =>
        locales.map(({ locale, direction }) => `${locale.toUpperCase()}/${direction.toUpperCase()}`)
      )
    )
  ]
  const durationRequirementSatisfied = durationMs >= DEFAULT_DURATION_MS
  const endpointsMatched =
    state.candidate.requiredSha !== null &&
    state.config.artifactExplicit &&
    state.candidate.matchedAtStart &&
    state.candidate.matchedAtEnd === true &&
    state.candidate.dirtyAtStart.length === 0 &&
    state.candidate.dirtyAtEnd?.length === 0
  const objectiveChecksPassed =
    scenarioResults.every(({ passed }) => passed) &&
    retentionResults.every(({ passed }) => passed) &&
    growth.residentMemoryBytes <= LIMITS.hardRssGrowthBytes &&
    growth.storageBytes <= LIMITS.bytesPerWorkspace * state.adapters.length
  const releaseEligible =
    harnessPassed &&
    !state.config.smoke &&
    durationRequirementSatisfied &&
    endpointsMatched &&
    objectiveChecksPassed
  const status: AutomatedSoakRecord['status'] = state.config.smoke
    ? harnessPassed
      ? 'smoke-passed'
      : 'smoke-failed'
    : diagnosticStatus
  const record: AutomatedSoakRecord = {
    schemaVersion: SUPPORT_SCHEMA_VERSION,
    evidenceType: 'orbitpm-lite-soak-automation',
    candidateSha: state.candidate.requiredSha ?? state.candidate.headShaAtStart,
    artifactSha256: state.candidate.artifactAtStart.sha256,
    diagnosticEvidenceUrl: diagnosticBinding.url,
    diagnosticEvidenceSha256: diagnosticBinding.sha256,
    diagnosticEvidenceSizeBytes: diagnosticBinding.sizeBytes,
    journalSchemaVersion: JOURNAL_SCHEMA_VERSION,
    journalHashAlgorithm: JOURNAL_HASH_ALGORITHM,
    journalEntryCount: state.journal.length,
    journalRootSha256: state.journal.at(-1)?.entryHash ?? JOURNAL_GENESIS_HASH,
    journal: state.journal,
    status,
    harnessPassed,
    passed: releaseEligible,
    releaseEligible,
    smoke: state.config.smoke,
    uninterrupted: state.stopSignal === null && diagnosticStatus !== 'interrupted',
    restarts: 0,
    startedAt: state.startedAt,
    completedAt,
    durationMs,
    durationRequirementMs: DEFAULT_DURATION_MS,
    durationRequirementSatisfied,
    locales: SOAK_LOCALES,
    scenarios: SOAK_SCENARIOS,
    retentionChecks: SOAK_RETENTION_CHECKS,
    sampleIntervalMinutes: state.config.supportSampleIntervalMinutes,
    samples: state.evidenceSamples,
    maxResidentMemoryGrowthBytes: LIMITS.hardRssGrowthBytes,
    maxStorageGrowthBytes: LIMITS.bytesPerWorkspace * state.adapters.length,
    observedResidentMemoryGrowthBytes: growth.residentMemoryBytes,
    observedStorageGrowthBytes: growth.storageBytes,
    scenarioResults,
    retentionResults,
    candidateEndpoints: {
      requiredSha: state.candidate.requiredSha,
      headShaAtStart: state.candidate.headShaAtStart,
      headShaAtEnd: state.candidate.headShaAtEnd,
      cleanAtStart: state.candidate.dirtyAtStart.length === 0,
      cleanAtEnd:
        state.candidate.dirtyAtEnd === null ? null : state.candidate.dirtyAtEnd.length === 0,
      matchedAtStart: state.candidate.matchedAtStart,
      matchedAtEnd: state.candidate.matchedAtEnd
    },
    artifactEndpoints: {
      sha256AtStart: state.candidate.artifactAtStart.sha256,
      sha256AtEnd: state.candidate.artifactAtEnd?.sha256 ?? null,
      sizeBytesAtStart: state.candidate.artifactAtStart.sizeBytes,
      sizeBytesAtEnd: state.candidate.artifactAtEnd?.sizeBytes ?? null,
      matchedAtEnd:
        state.candidate.artifactAtEnd === null
          ? null
          : state.candidate.artifactAtEnd.sha256 === state.candidate.artifactAtStart.sha256 &&
            state.candidate.artifactAtEnd.sizeBytes === state.candidate.artifactAtStart.sizeBytes
    },
    clock: {
      wallClock: 'UTC',
      elapsedClock: 'performance.now',
      timestampDerivation: 'startedAt-plus-monotonic-elapsed'
    },
    findings: `The automated harness completed ${state.cyclesCompleted} of ${state.cyclesAttempted} supplemental core-stress cycles with ${state.failureRecords.length} recorded failures. ${state.browserHeartbeats.length} aggregate browser heartbeats covered ${observedBrowserLocales.join(' and ') || 'no initialized browser locale'}, while ${state.journal.filter(({ kind }) => kind === 'operation').length} exact-artifact production-UI operation receipts were hash-chained with the sampled checkpoints. Sampled RSS growth was ${growth.residentMemoryBytes} bytes and sampled storage growth was ${growth.storageBytes} bytes.`
  }
  validateAutomatedSoakRecord(record, diagnosticBytes)
  return record
}

function buildEvidence(
  state: HarnessState,
  status: 'running' | 'passed' | 'failed' | 'interrupted',
  completedAt?: string
): Record<string, unknown> {
  const memoryAssessment = assessMemory(state.trendSamples)
  const rendererAssessment = assessRenderer(state.browserHeartbeats)
  const elapsedMs = monotonicElapsedMs(state)
  const releaseDurationSatisfied = elapsedMs >= DEFAULT_DURATION_MS
  const maximumBrowserHeartbeatGapAllowedMs =
    Math.max(state.config.browserIntervalMs, state.effectiveBrowserIntervalMs) +
    BROWSER_HEARTBEAT_GRACE_MS
  return {
    schemaVersion: 1,
    gate: 'orbitpm-lite-release-candidate-soak',
    appVersion: APP_VERSION,
    status,
    passed: status === 'passed',
    startedAt: state.startedAt,
    ...(completedAt ? { completedAt } : {}),
    elapsedMs,
    releaseDurationRequirementMs: DEFAULT_DURATION_MS,
    releaseDurationSatisfied,
    releaseDurationRequired: !state.config.smoke,
    smokeDurationWaiverApplied: state.config.smoke && !releaseDurationSatisfied,
    runtime: {
      node: process.version,
      platform: platform(),
      platformRelease: release(),
      arch: arch(),
      cpuModel: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      garbageCollectionExposed:
        typeof (globalThis as typeof globalThis & { gc?: () => void }).gc === 'function'
    },
    config: {
      durationMs: state.config.durationMs,
      defaultReleaseDurationMs: DEFAULT_DURATION_MS,
      maxCycles: state.config.maxCycles,
      cycleDelayMs: state.config.cycleDelayMs,
      smoke: state.config.smoke,
      outputPath: state.config.outputPath,
      supportOutputPath: state.config.supportOutputPath,
      requestedSampleEveryCycles: state.config.sampleEveryCycles,
      effectiveSampleEveryCycles: state.effectiveSampleEveryCycles,
      evidenceEveryCycles: state.config.evidenceEveryCycles,
      supportSampleIntervalMinutes: state.config.supportSampleIntervalMinutes,
      browserIntervalMs: state.config.browserIntervalMs,
      effectiveBrowserIntervalMs: state.effectiveBrowserIntervalMs,
      candidateSha: state.config.candidateSha,
      artifactPath: state.config.artifactPath,
      artifactExplicit: state.config.artifactExplicit,
      allowDirty: state.config.allowDirty
    },
    limits: {
      ...LIMITS,
      maximumTrendSamples: MAX_TREND_SAMPLES,
      maximumBrowserHeartbeats: MAX_BROWSER_HEARTBEATS,
      maximumBrowserDiagnostics: MAX_BROWSER_DIAGNOSTICS,
      browserHeartbeatGraceMs: BROWSER_HEARTBEAT_GRACE_MS,
      maximumFailureRecords: MAX_FAILURE_RECORDS,
      consecutiveFailureStopThreshold: MAX_CONSECUTIVE_FAILURES
    },
    summary: {
      cyclesAttempted: state.cyclesAttempted,
      cyclesCompleted: state.cyclesCompleted,
      cyclesFailed: state.cyclesFailed,
      consecutiveFailures: state.consecutiveFailures,
      failureRecordsTruncated: state.failuresTruncated,
      stopReason: state.stopReason,
      stopSignal: state.stopSignal
    },
    operations: state.operations,
    automatedEvidence: {
      evidenceType: 'orbitpm-lite-soak-automation',
      outputPath: state.config.supportOutputPath,
      sampleIntervalMinutes: state.config.supportSampleIntervalMinutes,
      nextSampleElapsedMs: state.nextEvidenceSampleElapsedMs,
      samples: state.evidenceSamples,
      scenarioOutcomes: state.scenarioOutcomes
    },
    operationJournal: {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      hashAlgorithm: JOURNAL_HASH_ALGORITHM,
      entryCount: state.journal.length,
      rootSha256: state.journal.at(-1)?.entryHash ?? JOURNAL_GENESIS_HASH,
      entries: state.journal
    },
    candidate: state.candidate,
    failures: state.failureRecords,
    trends: {
      bounded: true,
      samplesRetained: state.trendSamples.length,
      memoryAssessment,
      samples: state.trendSamples
    },
    browserEndurance: {
      bounded: true,
      heartbeatCount: state.browserHeartbeatCount,
      heartbeatsRetained: state.browserHeartbeats.length,
      heartbeatsCompacted: state.browserHeartbeatsCompacted,
      maximumHeartbeatGapMs: state.maximumBrowserHeartbeatGapMs,
      maximumHeartbeatGapAllowedMs: maximumBrowserHeartbeatGapAllowedMs,
      heartbeatGapPassed: state.maximumBrowserHeartbeatGapMs <= maximumBrowserHeartbeatGapAllowedMs,
      rendererAssessment,
      heartbeats: state.browserHeartbeats
    },
    finalStorage: state.lastStorage
  }
}

function diagnosticEvidenceBytes(evidence: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

function supportEvidenceBytes(evidence: AutomatedSoakRecord): Buffer {
  return Buffer.from(`${JSON.stringify(evidence)}\n`, 'utf8')
}

export function writeNewEvidenceFileCrashSafe(
  path: string,
  bytes: Uint8Array,
  preflightIdentity = canonicalNewFileTarget(path)
): void {
  invariant(bytes.byteLength > 0, 'evidence bytes are non-empty', { path })
  invariant(resolve(path) === preflightIdentity.path, 'evidence write matches preflight target', {
    path,
    preflightPath: preflightIdentity.path
  })
  revalidateEvidenceTarget(preflightIdentity)
  const parent = dirname(path)
  const temporaryPath = resolve(
    parent,
    `.${basename(path)}.tmp-${process.pid}-${randomBytes(12).toString('hex')}`
  )
  let descriptor: number | null = null
  let linked = false
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    let offset = 0
    while (offset < bytes.byteLength) {
      offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset)
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    revalidateEvidenceTarget(preflightIdentity)
    linkSync(temporaryPath, path)
    linked = true
    const directoryDescriptor = openSync(parent, 'r')
    try {
      fsyncSync(directoryDescriptor)
    } finally {
      closeSync(directoryDescriptor)
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    try {
      unlinkSync(temporaryPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  invariant(linked, 'evidence target was linked atomically', { path })
}

function prepareDiagnosticEvidence(
  path: string,
  evidence: unknown
): { binding: DiagnosticBinding; bytes: Buffer } {
  const bytes = diagnosticEvidenceBytes(evidence)
  return {
    bytes,
    binding: {
      url: `./${encodeURIComponent(basename(path))}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength
    }
  }
}

function persistSupportEvidence(
  path: string,
  evidence: AutomatedSoakRecord,
  identity: EvidenceTargetIdentity
): void {
  writeNewEvidenceFileCrashSafe(path, supportEvidenceBytes(evidence), identity)
}

async function delay(milliseconds: number, state: HarnessState): Promise<void> {
  if (milliseconds <= 0 || state.stopSignal) return
  await new Promise<void>((resolveDelay) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      resolveDelay()
    }
    const timer = setTimeout(finish, milliseconds)
    const poll = setInterval(
      () => {
        if (state.stopSignal) finish()
      },
      Math.min(250, Math.max(10, milliseconds))
    )
  })
}

function operationCounts(): OperationCounts {
  return {
    browserUiReceipts: 0,
    sessionOpens: 0,
    edits: 0,
    confirmedSaves: 0,
    conflictsDetected: 0,
    staleWorkspaceRejections: 0,
    workspaceSwitches: 0,
    draftRecoveryReviews: 0,
    draftRecoveriesCommitted: 0,
    historyRevisionsCreated: 0,
    historyRetentionPasses: 0,
    spreadsheetModelsBuilt: 0,
    spreadsheetArtifactsGenerated: 0,
    spreadsheetImportsCommitted: 0,
    translationCancellations: 0
  }
}

export async function run(config: SoakConfig): Promise<boolean> {
  const candidate = candidateIdentity(config)
  let logicalClock = 1_800_000_000_000
  const now = (): number => ++logicalClock
  const adapters: [MemoryWorkspaceAdapter, MemoryWorkspaceAdapter] = [
    new MemoryWorkspaceAdapter({
      id: 'soak-workspace-a',
      files: { 'process.bpmn': ordinaryBpmn('A', 0, 'en') },
      now
    }),
    new MemoryWorkspaceAdapter({
      id: 'soak-workspace-b',
      files: { 'process.bpmn': ordinaryBpmn('B', 0, 'en') },
      now
    })
  ]
  const histories: [PortableHistoryManager, PortableHistoryManager] = adapters.map(
    (adapter) =>
      new PortableHistoryManager({
        adapter,
        now,
        maxPerProcess: LIMITS.historyRevisionsPerProcess,
        maxTotalBytes: LIMITS.historyBytesPerWorkspace,
        applicationVersion: APP_VERSION
      })
  ) as [PortableHistoryManager, PortableHistoryManager]
  const startedWallMs = Date.now()
  const state: HarnessState = {
    config,
    startedAt: new Date(startedWallMs).toISOString(),
    startedWallMs,
    startedMonotonic: performance.now(),
    adapters,
    histories,
    draftJournal: new MemoryDraftJournal(),
    operations: operationCounts(),
    candidate,
    activeWorkspace: null,
    workspaceGeneration: 0,
    cyclesAttempted: 0,
    cyclesCompleted: 0,
    cyclesFailed: 0,
    failedCycleNumbers: new Set(),
    consecutiveFailures: 0,
    failuresTruncated: 0,
    failureRecords: [],
    trendSamples: [],
    effectiveSampleEveryCycles: config.sampleEveryCycles,
    evidenceSamples: [],
    nextEvidenceSampleElapsedMs: config.supportSampleIntervalMinutes * 60_000,
    scenarioOutcomes: scenarioOutcomes(),
    journal: [],
    uiRetention: {
      restoredDrafts: 0,
      pendingDraftsAtCompletion: 0,
      retentionLimit: 0,
      maximumVisibleRevisions: 0,
      retainedBpmnFiles: 0,
      retainedMetadataFiles: 0,
      oldestSeedPruned: false,
      pickerCancellations: 0,
      workspacePreserved: true
    },
    browserHeartbeats: [],
    browserHeartbeatsCompacted: 0,
    browserHeartbeatCount: 0,
    maximumBrowserHeartbeatGapMs: 0,
    effectiveBrowserIntervalMs: config.browserIntervalMs,
    lastBrowserHeartbeatElapsedMs: 0,
    lastStorage: [],
    stopSignal: null,
    stopReason: null,
    currentPhase: 'initializing'
  }
  const browserProbe = new BrowserEnduranceProbe(candidate.artifactAtStart)
  let browserStarted = false

  const stopSigint = (): void => {
    state.stopSignal ??= 'SIGINT'
  }
  const stopSigterm = (): void => {
    state.stopSignal ??= 'SIGTERM'
  }
  process.once('SIGINT', stopSigint)
  process.once('SIGTERM', stopSigterm)

  try {
    state.currentPhase = 'baseline-storage'
    state.lastStorage = await collectBoundedStorage(state, { countRetentionOperation: false })
    state.startedWallMs = Date.now()
    state.startedAt = new Date(state.startedWallMs).toISOString()
    state.startedMonotonic = performance.now()
    addEvidenceSample(state, 0, true)

    state.currentPhase = 'candidate-verification'
    invariant(candidate.matchedAtStart, 'release candidate matches Git and cleanliness policy', {
      requiredSha: candidate.requiredSha,
      headSha: candidate.headShaAtStart,
      dirtyEntries: candidate.dirtyAtStart,
      cleanRequired: candidate.cleanRequired
    })
    state.currentPhase = 'browser-start'
    const startHeartbeat = await browserProbe.start(state.cyclesAttempted, 0)
    startHeartbeat.elapsedMs = monotonicElapsedMs(state)
    addBrowserHeartbeat(state, startHeartbeat)
    browserStarted = true
    state.currentPhase = 'browser-production-ui-workloads'
    await browserProbe.exerciseRequiredWorkloads(async (workload) => {
      recordBrowserUiWorkload(state, workload)
      addBrowserHeartbeat(
        state,
        await browserProbe.heartbeat('interval', state.cyclesAttempted, monotonicElapsedMs(state))
      )
    })

    let durationBoundarySampleCycle: number | null = null
    while (
      !state.stopSignal &&
      (config.maxCycles === null || state.cyclesAttempted < config.maxCycles)
    ) {
      const elapsedBeforeCycle = monotonicElapsedMs(state)
      if (
        elapsedBeforeCycle >= config.durationMs &&
        ((config.smoke && state.cyclesAttempted > 0) ||
          (durationBoundarySampleCycle !== null &&
            state.cyclesCompleted > durationBoundarySampleCycle))
      ) {
        break
      }
      state.cyclesAttempted += 1
      const locale = SOAK_LOCALES[(state.cyclesAttempted - 1) % SOAK_LOCALES.length]!
      state.currentPhase = 'cycle-start'
      try {
        await exerciseCycle(state, state.cyclesAttempted, locale)
        state.currentPhase = 'retention-enforcement'
        state.lastStorage = await collectBoundedStorage(state)
        state.cyclesCompleted += 1
        state.consecutiveFailures = 0
      } catch (error) {
        recordFailure(state, error)
        try {
          state.lastStorage = await collectBoundedStorage(state)
        } catch (storageError) {
          recordFailure(state, storageError)
        }
      }

      try {
        addTrendSample(state, state.lastStorage)
      } catch (error) {
        recordFailure(state, error)
        state.stopReason = 'memory-hard-limit'
      }

      try {
        captureDueEvidenceSample(state)
      } catch (error) {
        recordFailure(state, error)
        state.stopReason = 'automated-evidence-sampling'
      }

      const browserElapsedMs = monotonicElapsedMs(state)
      if (
        !state.stopReason &&
        (state.effectiveBrowserIntervalMs === 0 ||
          browserElapsedMs - state.lastBrowserHeartbeatElapsedMs >=
            state.effectiveBrowserIntervalMs)
      ) {
        state.currentPhase = 'browser-interval'
        try {
          addBrowserHeartbeat(
            state,
            await browserProbe.heartbeat('interval', state.cyclesAttempted, browserElapsedMs)
          )
        } catch (error) {
          recordFailure(state, error)
          state.stopReason = 'browser-heartbeat'
        }
      }

      const elapsedAfterCycle = monotonicElapsedMs(state)
      if (
        !config.smoke &&
        !state.stopReason &&
        elapsedAfterCycle >= config.durationMs &&
        durationBoundarySampleCycle === null
      ) {
        const latestEvidenceSample = state.evidenceSamples.at(-1)
        if (!latestEvidenceSample || latestEvidenceSample.elapsedMs < config.durationMs) {
          try {
            addEvidenceSample(
              state,
              elapsedAfterCycle,
              state.failureRecords.length === 0 && !state.stopSignal
            )
          } catch (error) {
            recordFailure(state, error)
            state.stopReason = 'automated-evidence-boundary'
          }
        }
        durationBoundarySampleCycle = state.cyclesCompleted
      }

      if (
        state.cyclesAttempted % config.evidenceEveryCycles === 0 ||
        state.consecutiveFailures > 0
      ) {
        process.stdout.write(
          `[soak] ${state.cyclesCompleted}/${state.cyclesAttempted} cycles; ` +
            `${state.cyclesFailed} failure(s); ${monotonicElapsedMs(state)} ms\n`
        )
      }
      if (state.stopReason || state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.stopReason ??= 'consecutive-failures'
        break
      }
      if (
        (config.smoke && elapsedAfterCycle >= config.durationMs) ||
        (!config.smoke &&
          durationBoundarySampleCycle !== null &&
          state.cyclesCompleted > durationBoundarySampleCycle)
      ) {
        break
      }
      await delay(config.cycleDelayMs, state)
    }

    if (!state.stopReason) {
      state.stopReason = state.stopSignal
        ? 'signal'
        : config.maxCycles !== null && state.cyclesAttempted >= config.maxCycles
          ? 'cycle-limit'
          : 'duration'
    }
    try {
      state.lastStorage = await collectBoundedStorage(state, { countRetentionOperation: false })
      addTrendSample(state, state.lastStorage, true)
    } catch (error) {
      recordFailure(state, error)
    }

    state.currentPhase = 'browser-end'
    if (browserStarted) {
      try {
        addBrowserHeartbeat(
          state,
          await browserProbe.heartbeat('end', state.cyclesAttempted, monotonicElapsedMs(state))
        )
      } catch (error) {
        recordFailure(state, error)
      }
    }
    try {
      await browserProbe.close()
      browserStarted = false
    } catch (error) {
      recordFailure(state, error)
    }

    state.currentPhase = 'candidate-final-verification'
    try {
      finalizeCandidateIdentity(config, candidate)
      invariant(candidate.matchedAtEnd, 'release candidate stayed unchanged through soak', {
        headShaAtStart: candidate.headShaAtStart,
        headShaAtEnd: candidate.headShaAtEnd,
        dirtyAtEnd: candidate.dirtyAtEnd,
        artifactShaAtStart: candidate.artifactAtStart.sha256,
        artifactShaAtEnd: candidate.artifactAtEnd?.sha256
      })
    } catch (error) {
      recordFailure(state, error)
    }

    const assessment = assessMemory(state.trendSamples)
    const rendererAssessment = assessRenderer(state.browserHeartbeats)
    const interrupted = state.stopSignal !== null
    const elapsedMs = monotonicElapsedMs(state)
    const releaseDurationSatisfied = elapsedMs >= DEFAULT_DURATION_MS
    const durationGatePassed = config.smoke || releaseDurationSatisfied
    const browserStartRecorded = state.browserHeartbeats.some(({ stage }) => stage === 'start')
    const browserEndRecorded = state.browserHeartbeats.some(({ stage }) => stage === 'end')
    const browserIntervalRecorded = state.browserHeartbeats.some(
      ({ stage }) => stage === 'interval'
    )
    const maximumBrowserHeartbeatGapAllowedMs =
      Math.max(config.browserIntervalMs, state.effectiveBrowserIntervalMs) +
      BROWSER_HEARTBEAT_GRACE_MS
    const memoryEvidenceComplete =
      config.smoke || (assessment.evaluated && assessment.rateEvaluated === true)
    const rendererEvidenceComplete =
      config.smoke || (rendererAssessment.evaluated && rendererAssessment.rateEvaluated)
    const localizedScenarioEvidenceComplete = state.scenarioOutcomes.every(
      ({ completedCycles }) => completedCycles > 0
    )
    const retentionEvidenceComplete = buildRetentionResults(state).every(({ passed }) => passed)
    let harnessPassed =
      !interrupted &&
      durationGatePassed &&
      state.cyclesAttempted > 0 &&
      state.cyclesCompleted === state.cyclesAttempted &&
      state.cyclesFailed === 0 &&
      state.failureRecords.length === 0 &&
      assessment.passed &&
      memoryEvidenceComplete &&
      rendererAssessment.passed &&
      rendererEvidenceComplete &&
      localizedScenarioEvidenceComplete &&
      retentionEvidenceComplete &&
      candidate.matchedAtStart &&
      candidate.matchedAtEnd === true &&
      browserStartRecorded &&
      browserIntervalRecorded &&
      browserEndRecorded &&
      state.maximumBrowserHeartbeatGapMs <= maximumBrowserHeartbeatGapAllowedMs
    let finalElapsedMs = monotonicElapsedMs(state)
    while (finalElapsedMs <= state.evidenceSamples.at(-1)!.elapsedMs) {
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 1))
      finalElapsedMs = monotonicElapsedMs(state)
    }
    try {
      addEvidenceSample(state, finalElapsedMs, harnessPassed, {
        requireOperationIncrease: harnessPassed && !config.smoke,
        enforceGap: harnessPassed
      })
    } catch (error) {
      recordFailure(state, error)
      harnessPassed = false
      finalElapsedMs = monotonicElapsedMs(state)
      while (finalElapsedMs <= state.evidenceSamples.at(-1)!.elapsedMs) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 1))
        finalElapsedMs = monotonicElapsedMs(state)
      }
      addEvidenceSample(state, finalElapsedMs, false, {
        requireOperationIncrease: false,
        enforceGap: false,
        enforceGrowth: false
      })
    }
    const finalSample = state.evidenceSamples.at(-1)!
    const completedAt = finalSample.capturedAt
    const durationMs = finalSample.elapsedMs
    let status: 'passed' | 'failed' | 'interrupted' = interrupted
      ? 'interrupted'
      : harnessPassed
        ? 'passed'
        : 'failed'
    let automatedRecord: AutomatedSoakRecord
    let preparedDiagnostic: { binding: DiagnosticBinding; bytes: Buffer }
    try {
      preparedDiagnostic = prepareDiagnosticEvidence(
        config.outputPath,
        buildEvidence(state, status, completedAt)
      )
      automatedRecord = buildAutomatedSoakRecord(
        state,
        status,
        completedAt,
        durationMs,
        harnessPassed,
        preparedDiagnostic.binding,
        preparedDiagnostic.bytes
      )
    } catch (error) {
      recordFailure(state, error)
      harnessPassed = false
      status = interrupted ? 'interrupted' : 'failed'
      preparedDiagnostic = prepareDiagnosticEvidence(
        config.outputPath,
        buildEvidence(state, status, completedAt)
      )
      automatedRecord = buildAutomatedSoakRecord(
        state,
        status,
        completedAt,
        durationMs,
        false,
        preparedDiagnostic.binding,
        preparedDiagnostic.bytes
      )
    }
    writeNewEvidenceFileCrashSafe(
      config.outputPath,
      preparedDiagnostic.bytes,
      candidate.evidenceTargets.output
    )
    revalidateEvidenceTarget(candidate.evidenceTargets.support)
    persistSupportEvidence(
      config.supportOutputPath,
      automatedRecord,
      candidate.evidenceTargets.support
    )
    return config.smoke ? harnessPassed : automatedRecord.releaseEligible
  } catch (error) {
    state.stopReason = 'fatal'
    recordFailure(state, error)
    try {
      await browserProbe.close()
      browserStarted = false
    } catch (closeError) {
      recordFailure(state, closeError)
    }
    try {
      finalizeCandidateIdentity(config, candidate)
    } catch (candidateError) {
      recordFailure(state, candidateError)
    }
    try {
      state.lastStorage = await collectBoundedStorage(state, { countRetentionOperation: false })
    } catch (storageError) {
      recordFailure(state, storageError)
    }
    if (state.evidenceSamples.length === 0) {
      state.startedWallMs = Date.now()
      state.startedAt = new Date(state.startedWallMs).toISOString()
      state.startedMonotonic = performance.now()
      addEvidenceSample(state, 0, false, {
        requireOperationIncrease: false,
        enforceGap: false,
        enforceGrowth: false
      })
    }
    let failedElapsedMs = monotonicElapsedMs(state)
    while (failedElapsedMs <= state.evidenceSamples.at(-1)!.elapsedMs) {
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 1))
      failedElapsedMs = monotonicElapsedMs(state)
    }
    addEvidenceSample(state, failedElapsedMs, false, {
      requireOperationIncrease: false,
      enforceGap: false,
      enforceGrowth: false
    })
    const failedFinalSample = state.evidenceSamples.at(-1)!
    if (targetDoesNotExist(config.outputPath) && targetDoesNotExist(config.supportOutputPath)) {
      try {
        const failedStatus = state.stopSignal ? 'interrupted' : 'failed'
        const preparedDiagnostic = prepareDiagnosticEvidence(
          config.outputPath,
          buildEvidence(state, failedStatus, failedFinalSample.capturedAt)
        )
        writeNewEvidenceFileCrashSafe(
          config.outputPath,
          preparedDiagnostic.bytes,
          candidate.evidenceTargets.output
        )
        const automatedRecord = buildAutomatedSoakRecord(
          state,
          failedStatus,
          failedFinalSample.capturedAt,
          failedFinalSample.elapsedMs,
          false,
          preparedDiagnostic.binding,
          preparedDiagnostic.bytes
        )
        revalidateEvidenceTarget(candidate.evidenceTargets.support)
        persistSupportEvidence(
          config.supportOutputPath,
          automatedRecord,
          candidate.evidenceTargets.support
        )
      } catch (supportError) {
        recordFailure(state, supportError)
      }
    }
    return false
  } finally {
    if (browserStarted) {
      try {
        await browserProbe.close()
      } catch {
        // A prior failure already determines the gate result.
      }
    }
    process.removeListener('SIGINT', stopSigint)
    process.removeListener('SIGTERM', stopSigterm)
  }
}

const invokedAsEntryPoint =
  process.env.VITEST !== 'true' &&
  (process.argv[1]?.endsWith('/vite-node') === true ||
    process.argv.some((argument) => {
      if (!argument || argument.startsWith('-')) return false
      try {
        return pathToFileURL(resolve(argument)).toString() === import.meta.url
      } catch {
        return false
      }
    }))

if (invokedAsEntryPoint) {
  const parsed = parseArguments(process.argv.slice(2))
  if (parsed.help) {
    process.stdout.write(usage())
  } else {
    const passed = await run(parsed.config)
    if (passed) {
      process.stdout.write(
        `Soak gate passed (${parsed.config.outputPath}; ${parsed.config.supportOutputPath}).\n`
      )
    } else {
      process.stderr.write(
        `Soak gate failed (${parsed.config.outputPath}; ${parsed.config.supportOutputPath}).\n`
      )
      process.exitCode = 1
    }
  }
}
