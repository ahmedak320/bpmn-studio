import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
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

const APP_VERSION = '0.4.5'
const DEFAULT_DURATION_MS = 48 * 60 * 60 * 1_000
const SMOKE_DURATION_MS = 60_000
const DEFAULT_CYCLE_DELAY_MS = 1_000
const DEFAULT_SAMPLE_EVERY_CYCLES = 60
const DEFAULT_EVIDENCE_EVERY_CYCLES = 60
const DEFAULT_BROWSER_INTERVAL_MS = 5 * 60 * 1_000
const MAX_TREND_SAMPLES = 4_096
const MAX_BROWSER_HEARTBEATS = 2_048
const MAX_BROWSER_DIAGNOSTICS = 100
const MAX_FAILURE_RECORDS = 100
const MAX_CONSECUTIVE_FAILURES = 3
const BROWSER_HEARTBEAT_GRACE_MS = 60_000

const MIB = 1024 * 1024
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
  hardRssGrowthBytes: 1024 * MIB,
  memoryMinimumSamples: 20,
  memoryMinimumCycles: 100,
  memoryRateMinimumElapsedMs: 60 * 60 * 1_000,
  rendererRetainedHeapGrowthBytes: 256 * MIB,
  rendererHardHeapGrowthBytes: 512 * MIB,
  rendererHeapGrowthBytesPerHour: 64 * MIB,
  rendererStorageGrowthBytes: 64 * MIB,
  rendererHardStorageGrowthBytes: 128 * MIB,
  rendererWebStorageGrowthCodeUnits: 1_000_000,
  rendererDomNodeGrowth: 2_000,
  rendererHardDomNodeGrowth: 5_000,
  rendererMinimumHeartbeats: 12,
  rendererRateMinimumElapsedMs: 60 * 60 * 1_000
})

interface SoakConfig {
  durationMs: number
  maxCycles: number | null
  cycleDelayMs: number
  outputPath: string
  smoke: boolean
  sampleEveryCycles: number
  evidenceEveryCycles: number
  browserIntervalMs: number
  candidateSha: string | null
  artifactPath: string
  artifactExplicit: boolean
  allowDirty: boolean
}

interface OperationCounts {
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
  readonly startedAt: string
  readonly startedMonotonic: number
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

function parseArguments(args: readonly string[]): { config: SoakConfig; help: boolean } {
  let smoke = false
  let help = false
  let durationMs: number | undefined
  let maxCycles: number | null | undefined
  let cycleDelayMs: number | undefined
  let outputPath: string | undefined
  let sampleEveryCycles: number | undefined
  let evidenceEveryCycles: number | undefined
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
      case '--sample-every':
        sampleEveryCycles = finiteInteger(value, name, 1)
        break
      case '--evidence-every':
        evidenceEveryCycles = finiteInteger(value, name, 1)
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
  const artifactExplicit = artifactPath !== undefined
  return {
    help,
    config: {
      durationMs: durationMs ?? (smoke ? SMOKE_DURATION_MS : DEFAULT_DURATION_MS),
      maxCycles: maxCycles ?? (smoke ? 8 : null),
      cycleDelayMs: cycleDelayMs ?? (smoke ? 0 : DEFAULT_CYCLE_DELAY_MS),
      outputPath: resolve(outputPath ?? 'soak-results.json'),
      smoke,
      sampleEveryCycles: sampleEveryCycles ?? (smoke ? 1 : DEFAULT_SAMPLE_EVERY_CYCLES),
      evidenceEveryCycles: evidenceEveryCycles ?? (smoke ? 1 : DEFAULT_EVIDENCE_EVERY_CYCLES),
      browserIntervalMs: browserIntervalMs ?? (smoke ? 0 : DEFAULT_BROWSER_INTERVAL_MS),
      candidateSha: candidateSha ?? null,
      artifactPath: resolve(artifactPath ?? 'dist/index.html'),
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
  --output <path>         Atomic JSON evidence path (default: soak-results.json)
  --sample-every <n>      Initial memory/storage sample cadence in cycles (default: 60)
  --evidence-every <n>    Running evidence checkpoint cadence in cycles (default: 60)
  --browser-interval-ms   Browser endurance heartbeat interval (default: 300000)
  --candidate-sha <sha>   Required exact Git HEAD for a release soak
  --artifact <html>       Exact built/release HTML (required for release)
  --smoke                 Eight cycles, no delay, one-minute outer budget
  --allow-dirty           Permit and record a dirty tree in smoke mode only
  --help                  Show this help
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

function dirtyGitEntries(gitRoot: string, evidencePath: string): readonly string[] {
  const args = ['status', '--porcelain=v1', '--untracked-files=all', '--', '.']
  const evidenceRelative = relativeGitPath(gitRoot, evidencePath)
  if (evidenceRelative) {
    args.push(`:(exclude)${evidenceRelative}`, `:(exclude)${evidenceRelative}.tmp-*`)
  }
  const output = gitOutput(gitRoot, args)
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
  const gitRoot = gitOutput(process.cwd(), ['rev-parse', '--show-toplevel'])
  const headShaAtStart = gitOutput(gitRoot, ['rev-parse', 'HEAD']).toLowerCase()
  const dirtyAtStart = dirtyGitEntries(gitRoot, config.outputPath)
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
    matchedAtEnd: null
  }
}

function finalizeCandidateIdentity(config: SoakConfig, candidate: CandidateIdentity): void {
  candidate.headShaAtEnd = gitOutput(candidate.gitRoot, ['rev-parse', 'HEAD']).toLowerCase()
  candidate.dirtyAtEnd = dirtyGitEntries(candidate.gitRoot, config.outputPath)
  candidate.artifactAtEnd = artifactIdentity(config.artifactPath)
  candidate.matchedAtEnd =
    candidate.headShaAtEnd === candidate.headShaAtStart &&
    (candidate.requiredSha === null || candidate.headShaAtEnd === candidate.requiredSha) &&
    (config.allowDirty || candidate.dirtyAtEnd.length === 0) &&
    candidate.artifactAtEnd.sha256 === candidate.artifactAtStart.sha256 &&
    candidate.artifactAtEnd.sizeBytes === candidate.artifactAtStart.sizeBytes
}

class BrowserEnduranceProbe {
  readonly #artifact: ArtifactIdentity
  readonly #pageErrors: string[] = []
  readonly #consoleErrors: string[] = []
  readonly #unexpectedRequests: string[] = []
  #diagnosticsTruncated = 0
  #browser: Browser | null = null
  #context: BrowserContext | null = null
  #page: Page | null = null
  #cdp: CDPSession | null = null

  constructor(artifact: ArtifactIdentity) {
    this.#artifact = artifact
  }

  #record(target: string[], message: string): void {
    if (target.length < MAX_BROWSER_DIAGNOSTICS) target.push(message)
    else this.#diagnosticsTruncated += 1
  }

  async start(cycle: number, elapsedMs: number): Promise<BrowserHeartbeat> {
    this.#browser = await chromium.launch({ headless: true })
    this.#context = await this.#browser.newContext({
      colorScheme: 'light',
      locale: 'en-US',
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 800 }
    })
    const page = await this.#context.newPage()
    this.#page = page
    this.#cdp = await this.#context.newCDPSession(page)
    await this.#cdp.send('Performance.enable')
    page.on('pageerror', (error) => this.#record(this.#pageErrors, error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') this.#record(this.#consoleErrors, message.text())
    })
    page.on('crash', () => this.#record(this.#pageErrors, 'Chromium page crashed.'))
    page.on('request', (request) => {
      const url = request.url()
      if (url === this.#artifact.url || url.startsWith('data:') || url.startsWith('blob:')) {
        return
      }
      this.#record(this.#unexpectedRequests, `${request.method()} ${request.url()}`)
    })
    await page.addInitScript(() => {
      localStorage.setItem('orbitpm.lite.lang', 'en')
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: undefined
      })
    })
    await page.goto(this.#artifact.url, { waitUntil: 'load', timeout: 30_000 })
    await page
      .getByRole('heading', { name: 'OrbitPM Process Studio Lite' })
      .waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByRole('button', { name: 'New blank diagram', exact: true }).click()
    await page.locator('.djs-container svg').first().waitFor({ state: 'visible', timeout: 30_000 })
    await page
      .locator(`[aria-label="Version ${APP_VERSION}"]`)
      .waitFor({ state: 'visible', timeout: 30_000 })
    return this.heartbeat('start', cycle, elapsedMs)
  }

  async heartbeat(
    stage: BrowserHeartbeat['stage'],
    cycle: number,
    elapsedMs: number
  ): Promise<BrowserHeartbeat> {
    const page = this.#page
    invariant(page && !page.isClosed(), 'browser endurance page remains open', {
      stage,
      cycle
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
      const svg = document.querySelector('.djs-container svg')
      const bounds = svg?.getBoundingClientRect()
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
    const performanceMetrics = await this.#cdp?.send('Performance.getMetrics')
    invariant(performanceMetrics, 'renderer performance metrics are available', {
      stage,
      cycle
    })
    const metrics = new Map(performanceMetrics.metrics.map(({ name, value }) => [name, value]))
    const metric = (name: string): number => {
      const value = metrics.get(name)
      invariant(Number.isFinite(value), `renderer metric ${name} is available`, {
        stage,
        cycle,
        value
      })
      return value!
    }
    const heartbeat: BrowserHeartbeat = {
      stage,
      cycle,
      elapsedMs,
      frameLatencyMs: Number(frameLatencyMs.toFixed(3)),
      readyState: browserState.readyState,
      title: browserState.title,
      editorSvgVisible: browserState.editorSvgVisible,
      horizontalOverflow: browserState.horizontalOverflow,
      documentWidth: browserState.documentWidth,
      viewportWidth: browserState.viewportWidth,
      pageErrors: [...this.#pageErrors],
      consoleErrors: [...this.#consoleErrors],
      unexpectedRequests: [...this.#unexpectedRequests],
      diagnosticsTruncated: this.#diagnosticsTruncated,
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
    invariant(heartbeat.readyState === 'complete', 'browser document remains complete', {
      stage,
      readyState: heartbeat.readyState
    })
    invariant(heartbeat.editorSvgVisible, 'browser editor remains visible', {
      stage,
      cycle
    })
    invariant(!heartbeat.horizontalOverflow, 'browser heartbeat has no horizontal overflow', {
      stage,
      documentWidth: heartbeat.documentWidth,
      viewportWidth: heartbeat.viewportWidth
    })
    invariant(frameLatencyMs <= 2_000, 'browser animation heartbeat remains responsive', {
      stage,
      frameLatencyMs
    })
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
    await this.#context?.close()
    await this.#browser?.close()
    this.#cdp = null
    this.#page = null
    this.#context = null
    this.#browser = null
  }
}

function ordinaryBpmn(workspace: string, revision: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_${workspace}">
  <bpmn:process id="Process_${workspace}" name="${workspace} revision ${revision}" isExecutable="false">
    <bpmn:startEvent id="Start_${workspace}" name="Start" />
    <bpmn:userTask id="Task_${workspace}" name="Review revision ${revision}" />
    <bpmn:endEvent id="End_${workspace}" name="End" />
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

function spreadsheetFixture(cycle: number): ParsedWorkbookData {
  const sheets = (Object.keys(OFFICIAL_SHEET_NAMES) as CanonicalSheet[]).map((role) => {
    const headers = CANONICAL_FIELDS_BY_SHEET[role]
    const rows: WorkbookCell[][] = [headers.map((header) => cell(header))]
    if (role === 'processes') {
      rows.push(
        row(headers, {
          process_id: 'soak_process',
          name_en: `Soak process ${cycle}`,
          name_ar: `عملية اختبار ${cycle}`,
          active_language: cycle % 2 === 0 ? 'ar' : 'en'
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

async function exerciseSpreadsheetCycle(state: HarnessState, cycle: number): Promise<void> {
  const workbook = spreadsheetFixture(cycle)
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
      delivered.xml.includes('BPMNDiagram'),
    'spreadsheet delivery contains layouted BPMN',
    { path: delivered.path, bytes: new TextEncoder().encode(delivered.xml).byteLength }
  )
  state.operations.spreadsheetImportsCommitted += 1
}

async function exerciseTranslationCancellation(state: HarnessState): Promise<void> {
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
  })(['Review request'], 'en', 'ar', controller.signal)
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

async function exerciseCycle(state: HarnessState, cycle: number): Promise<void> {
  const adapterIndex = (cycle - 1) % state.adapters.length
  const adapter = state.adapters[adapterIndex]!
  const otherAdapter = state.adapters[(adapterIndex + 1) % state.adapters.length]!
  const workspaceLabel = adapterIndex === 0 ? 'A' : 'B'
  const path = 'process.bpmn'
  const resources: Array<{
    controller: DocumentSessionController
    coordinator: DraftJournalCoordinator
    sessionId: string
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
        await coordinator.confirmedSave(session.id, session.lastSavedXml)
      },
      onExplicitDiscard: async (sessionId) => {
        await coordinator.explicitDiscard(sessionId)
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
    resources.push({ controller, coordinator, sessionId })
    state.operations.sessionOpens += 1

    state.currentPhase = 'draft-review'
    session = controller.updateXml(sessionId, ordinaryBpmn(workspaceLabel, cycle * 10 + 1))
    coordinator.track(session)
    state.operations.edits += 1
    await coordinator.flush(sessionId)
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
    session = controller.updateXml(sessionId, ordinaryBpmn(workspaceLabel, cycle * 10 + 2))
    coordinator.track(session)
    state.operations.edits += 1
    await coordinator.flush(sessionId)
    adapter.replaceExternally(path, ordinaryBpmn(workspaceLabel, cycle * 10 + 3))
    const conflict = await controller.save(sessionId)
    invariant(conflict.status === 'external-conflict', 'external conflict is detected', {
      status: conflict.status
    })
    state.operations.conflictsDetected += 1
    const overwrite = await controller.save(sessionId, {
      conflictDecision: { kind: 'overwrite', confirmed: true }
    })
    invariant(overwrite.status === 'success', 'confirmed conflict overwrite succeeds', {
      status: overwrite.status
    })
    state.operations.confirmedSaves += 1

    state.currentPhase = 'stale-workspace'
    session = controller.updateXml(sessionId, ordinaryBpmn(workspaceLabel, cycle * 10 + 4))
    coordinator.track(session)
    state.operations.edits += 1
    await coordinator.flush(sessionId)
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
        await recoveryCoordinator.confirmedSave(saved.id, saved.lastSavedXml)
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
      sessionId: recoveryId
    })
    state.operations.sessionOpens += 1
    recoveryCoordinator.track(recoveredSession)
    await recoveryCoordinator.flush(recoveryId)
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
      new TextEncoder().encode(ordinaryBpmn(workspaceLabel, cycle * 10 + 5)),
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
    await exerciseSpreadsheetCycle(state, cycle)

    state.currentPhase = 'translation-cancellation'
    await exerciseTranslationCancellation(state)

    invariant(postSaveErrors.length === 0, 'post-save draft cleanup has no errors', {
      errors: postSaveErrors.map(String)
    })
  } finally {
    for (const resource of [...resources].reverse()) {
      try {
        await resource.coordinator.explicitDiscard(resource.sessionId)
      } catch {
        // The primary cycle failure remains the recorded cause.
      }
      resource.coordinator.dispose()
      try {
        await resource.coordinator.untrack(resource.sessionId)
      } catch {
        // The primary cycle failure remains the recorded cause.
      }
      resource.controller.store.close(resource.sessionId)
    }
  }
}

async function collectBoundedStorage(
  state: HarnessState
): Promise<readonly WorkspaceStorageSample[]> {
  const samples: WorkspaceStorageSample[] = []
  for (const [index, adapter] of state.adapters.entries()) {
    const retention = await state.histories[index]!.enforceRetention()
    state.operations.historyRetentionPasses += 1
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
    state.maximumBrowserHeartbeatGapMs = Math.max(
      state.maximumBrowserHeartbeatGapMs,
      gap
    )
    invariant(
      gap <=
        Math.max(
          state.config.browserIntervalMs,
          state.effectiveBrowserIntervalMs
        ) +
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

function buildEvidence(
  state: HarnessState,
  status: 'running' | 'passed' | 'failed' | 'interrupted',
  completedAt?: string
): Record<string, unknown> {
  const memoryAssessment = assessMemory(state.trendSamples)
  const rendererAssessment = assessRenderer(state.browserHeartbeats)
  const elapsedMs = Math.round(performance.now() - state.startedMonotonic)
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
      requestedSampleEveryCycles: state.config.sampleEveryCycles,
      effectiveSampleEveryCycles: state.effectiveSampleEveryCycles,
      evidenceEveryCycles: state.config.evidenceEveryCycles,
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

function writeEvidenceAtomic(path: string, evidence: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  renameSync(temporaryPath, path)
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

async function run(config: SoakConfig): Promise<boolean> {
  const candidate = candidateIdentity(config)
  let logicalClock = 1_800_000_000_000
  const now = (): number => ++logicalClock
  const adapters: [MemoryWorkspaceAdapter, MemoryWorkspaceAdapter] = [
    new MemoryWorkspaceAdapter({
      id: 'soak-workspace-a',
      files: { 'process.bpmn': ordinaryBpmn('A', 0) },
      now
    }),
    new MemoryWorkspaceAdapter({
      id: 'soak-workspace-b',
      files: { 'process.bpmn': ordinaryBpmn('B', 0) },
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
  const state: HarnessState = {
    config,
    startedAt: new Date().toISOString(),
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

  writeEvidenceAtomic(config.outputPath, buildEvidence(state, 'running'))
  try {
    state.currentPhase = 'candidate-verification'
    invariant(candidate.matchedAtStart, 'release candidate matches Git and cleanliness policy', {
      requiredSha: candidate.requiredSha,
      headSha: candidate.headShaAtStart,
      dirtyEntries: candidate.dirtyAtStart,
      cleanRequired: candidate.cleanRequired
    })
    state.currentPhase = 'browser-start'
    const startHeartbeat = await browserProbe.start(state.cyclesAttempted, 0)
    startHeartbeat.elapsedMs = Math.round(performance.now() - state.startedMonotonic)
    addBrowserHeartbeat(state, startHeartbeat)
    browserStarted = true

    while (
      !state.stopSignal &&
      performance.now() - state.startedMonotonic < config.durationMs &&
      (config.maxCycles === null || state.cyclesAttempted < config.maxCycles)
    ) {
      state.cyclesAttempted += 1
      state.currentPhase = 'cycle-start'
      try {
        await exerciseCycle(state, state.cyclesAttempted)
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

      const browserElapsedMs = Math.round(performance.now() - state.startedMonotonic)
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

      if (
        state.cyclesAttempted % config.evidenceEveryCycles === 0 ||
        state.consecutiveFailures > 0
      ) {
        writeEvidenceAtomic(config.outputPath, buildEvidence(state, 'running'))
        process.stdout.write(
          `[soak] ${state.cyclesCompleted}/${state.cyclesAttempted} cycles; ` +
            `${state.cyclesFailed} failure(s); ${Math.round(
              performance.now() - state.startedMonotonic
            )} ms\n`
        )
      }
      if (state.stopReason || state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.stopReason ??= 'consecutive-failures'
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
      state.lastStorage = await collectBoundedStorage(state)
      addTrendSample(state, state.lastStorage, true)
    } catch (error) {
      recordFailure(state, error)
    }

    state.currentPhase = 'browser-end'
    if (browserStarted) {
      try {
        addBrowserHeartbeat(
          state,
          await browserProbe.heartbeat(
            'end',
            state.cyclesAttempted,
            Math.round(performance.now() - state.startedMonotonic)
          )
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
    const elapsedMs = performance.now() - state.startedMonotonic
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
    const passed =
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
      candidate.matchedAtStart &&
      candidate.matchedAtEnd === true &&
      browserStartRecorded &&
      browserIntervalRecorded &&
      browserEndRecorded &&
      state.maximumBrowserHeartbeatGapMs <= maximumBrowserHeartbeatGapAllowedMs
    const status = interrupted ? 'interrupted' : passed ? 'passed' : 'failed'
    writeEvidenceAtomic(config.outputPath, buildEvidence(state, status, new Date().toISOString()))
    return passed
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
    writeEvidenceAtomic(config.outputPath, buildEvidence(state, 'failed', new Date().toISOString()))
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

const parsed = parseArguments(process.argv.slice(2))
if (parsed.help) {
  process.stdout.write(usage())
} else {
  const passed = await run(parsed.config)
  if (passed) {
    process.stdout.write(`Soak gate passed (${parsed.config.outputPath}).\n`)
  } else {
    process.stderr.write(`Soak gate failed (${parsed.config.outputPath}).\n`)
    process.exitCode = 1
  }
}
