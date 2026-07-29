/**
 * ARIS engine performance gate — plan §21.4, the half that does not need a DOM.
 *
 * Phase 18 asks for eight gates. Six of them are ultimately UI facts and are
 * measured against the mounted product by `scripts/browser-performance-gate.ts`.
 * This script measures the ARIS *engine* on the same real input the product
 * loads — `../reference/AnimalWF/ARISAMLExport.xml`, the 4.4 MB customer export —
 * so that when a browser number regresses it is possible to tell whether the
 * pipeline or the rendering moved.
 *
 * Nothing here is synthetic. The fixture is the real export, the parse is
 * `createArisXmlSourcePackage`, the accounting is `buildArisStudioDocument`, the
 * export is `exportArisDerivedAml`, and the assistant answers come from
 * `routeQuestion` over digests built by the shell's own
 * `buildArisAssistantDigests`. Every module here is one the product imports.
 *
 * ## Thresholds
 *
 * Where §21.4 states a number, that number is used verbatim. Where it says only
 * "responsive" or "stable", a threshold is *declared* here with its reasoning,
 * and the raw measurement is always printed and written to the evidence file so
 * the verdict can be re-judged without re-running. Thresholds are never moved to
 * make a run pass.
 *
 * ## Usage
 *
 * ```sh
 * npm run test:performance
 * npm run test:performance -- --output=performance-results.json
 * npm run test:performance -- --fixture=/path/to/ARISAMLExport.xml
 * ```
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { setFlagsFromString } from 'node:v8'

import { AssistantIndexCache } from '../src/aris/assistant/assistantIndex'
import { routeQuestion } from '../src/aris/assistant/questionRouter'
import { buildArisAssistantDigests } from '../src/aris/shell/arisAssistantDigests'
import { exportArisDerivedAml } from '../src/aris/shell/arisDerivedExport'
import { buildArisStudioDocument } from '../src/aris/shell/arisStudioDocument'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'
import { evaluateEndurance, percentile } from './browserPerformanceEvidence'
import {
  collectPerformanceSourceBinding,
  evaluatePerformanceHardwareProfile,
  expectedPerformanceCandidateSha,
  observePerformanceRuntime,
  performanceArgumentValue,
  selectedPerformanceHardwareProfile
} from './performanceEvidence'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/**
 * §21.4 budgets. The first two are the plan's own numbers.
 *
 * `assistantFullFolderRetrievalP95` is a declared threshold: §21.4 says only
 * "keep full-folder assistant retrieval responsive". 500 ms is borrowed from the
 * plan's own budget for the other operation a user waits on with the UI already
 * on screen — the model switch — rather than invented.
 *
 * `assistantIndexFullFolder` is likewise declared: building the folder index is
 * the assistant's equivalent of the first-open cost, so it inherits the 5 s
 * first-open budget.
 */
const LIMITS_MS = Object.freeze({
  parseAndAccountAnimalWf: 5_000,
  derivedExportSourcePackage: 5_000,
  assistantIndexFullFolder: 5_000,
  assistantFullFolderRetrievalP95: 500
})

/** §21.4 "remain stable through 20 import/close cycles". */
const IMPORT_CLOSE_CYCLES = 20

/**
 * A run that leaks work gets slower; a run that is merely noisy does not trend.
 * 2.0x between the first and last fifth of the run is the declared boundary
 * between the two. Reported as a ratio so the raw medians are always visible.
 */
const ENDURANCE_DRIFT_LIMIT = 2

/**
 * Retained heap after 20 import/close cycles, relative to the heap right after
 * the first cycle, with an explicit full GC between the two readings. A product
 * that releases each closed source settles near 1.0x; 2.0x is the declared
 * boundary for "unbounded".
 */
const HEAP_GROWTH_LIMIT = 2

/**
 * The §17.4 deterministic question battery, in both interface languages. These
 * are the exact question shapes the plan lists as answerable with no key.
 */
const QUESTION_BATTERY: readonly { readonly lang: 'en' | 'ar'; readonly text: string }[] =
  Object.freeze([
    { lang: 'en', text: 'Which processes are available?' },
    { lang: 'en', text: 'What comes next after animal registration?' },
    { lang: 'en', text: 'What comes before operator registration?' },
    { lang: 'en', text: 'Who is responsible for the animal profile closure?' },
    { lang: 'en', text: 'What inputs and outputs apply to renewal?' },
    { lang: 'en', text: 'Which system is used for registration?' },
    { lang: 'en', text: 'What XOR outcomes exist in operator registration?' },
    { lang: 'en', text: 'Where does the return branch go in animal registration?' },
    { lang: 'en', text: 'Which model is assigned to the value added chain?' },
    { lang: 'en', text: 'Which information is missing?' },
    { lang: 'en', text: 'Which process matches animal profile closure?' },
    { lang: 'ar', text: 'ما هي العمليات المتاحة؟' },
    { lang: 'ar', text: 'ما الذي يأتي بعد تسجيل الحيوان؟' },
    { lang: 'ar', text: 'من المسؤول عن إغلاق ملف الحيوان؟' }
  ])

interface Measurement {
  readonly name: string
  readonly unit: 'ms' | 'ratio' | 'count'
  readonly value: number
  readonly limit: number
  readonly comparison: 'at-most'
  readonly passed: boolean
  readonly thresholdSource: 'plan-21.4' | 'declared-here'
  readonly planRequirement: string
  readonly details: Readonly<Record<string, number | string | boolean>>
}

function measurement(input: Measurement): Measurement {
  return { ...input, value: Number(input.value.toFixed(3)), passed: input.value <= input.limit }
}

function writeEvidenceAtomic(path: string, evidence: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
  renameSync(temporaryPath, path)
}

/**
 * Force a real full GC so the heap reading describes retention rather than
 * "whatever the collector had not got round to yet". `--expose-gc` is not set
 * for `vite-node`, so the flag is turned on for this process and the handle is
 * pulled out of a fresh context. If that ever stops working the gate says so
 * instead of silently reporting a meaningless number.
 */
function createCollector(): { collect: () => void; available: boolean } {
  const existing = (globalThis as { gc?: () => void }).gc
  if (typeof existing === 'function') return { collect: existing, available: true }
  try {
    setFlagsFromString('--expose-gc')
    const exposed = runInNewContext('gc') as unknown
    if (typeof exposed !== 'function') return { collect: () => {}, available: false }
    return { collect: exposed as () => void, available: true }
  } catch {
    return { collect: () => {}, available: false }
  } finally {
    try {
      setFlagsFromString('--no-expose-gc')
    } catch {
      /* the reading is still valid; only the flag reset failed */
    }
  }
}

function settledHeapBytes(collect: () => void): number {
  for (let round = 0; round < 4; round += 1) collect()
  return process.memoryUsage().heapUsed
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const fixtureArgument = performanceArgumentValue('fixture')
const fixturePath = isAbsolute(fixtureArgument ?? '')
  ? (fixtureArgument as string)
  : resolve(REPO, fixtureArgument ?? '../reference/AnimalWF/ARISAMLExport.xml')

if (!existsSync(fixturePath)) {
  console.error(
    `The AnimalWF reference export is missing at ${fixturePath}. The §21.4 gates measure the ` +
      'real customer export and cannot run against a substitute; pass --fixture=<path>.'
  )
  process.exit(1)
}

const fixtureBytes = new Uint8Array(readFileSync(fixturePath))

async function importSource(): Promise<ReturnType<typeof buildArisStudioDocument>> {
  const pkg = await createArisXmlSourcePackage({
    name: 'ARISAMLExport.xml',
    relPath: 'ARISAMLExport.xml',
    bytes: fixtureBytes
  })
  return buildArisStudioDocument(pkg)
}

// A warm pass so the first measured number is not a JIT/module-load artefact.
// It is discarded, never reported.
await importSource()

const collector = createCollector()

// ---------------------------------------------------------------------------
// §21.4 #1 (engine half) — parse, account and project the first model
// ---------------------------------------------------------------------------

const parseStart = performance.now()
const parsedPackage = await createArisXmlSourcePackage({
  name: 'ARISAMLExport.xml',
  relPath: 'ARISAMLExport.xml',
  bytes: fixtureBytes
})
const studio = buildArisStudioDocument(parsedPackage)
const firstModelId = studio.models.find((model) => model.renderable)?.id ?? null
const firstRenderModel = studio.renderModels.find((model) => model.modelId === firstModelId) ?? null
const parseElapsedMs = performance.now() - parseStart

if (firstModelId === null || firstRenderModel === null) {
  console.error('The reference export produced no renderable model; §21.4 #1 cannot be measured.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// §21.4 #4 — export the 4.4 MB source package
// ---------------------------------------------------------------------------

const exportStart = performance.now()
const exported = exportArisDerivedAml({
  originalText: parsedPackage.text,
  original: studio.source,
  live: studio.source
})
const exportElapsedMs = performance.now() - exportStart

// ---------------------------------------------------------------------------
// §21.4 #7 — full-folder assistant retrieval
// ---------------------------------------------------------------------------

const indexStart = performance.now()
const digests = buildArisAssistantDigests(
  [
    {
      relPath: 'ARISAMLExport.xml',
      document: studio.source,
      sourceDigest: parsedPackage.sha256
    }
  ],
  new AssistantIndexCache(),
  'single-file'
)
const indexElapsedMs = performance.now() - indexStart

const retrievalSamples: number[] = []
let answeredQuestions = 0
for (let round = 0; round < 5; round += 1) {
  for (const question of QUESTION_BATTERY) {
    const started = performance.now()
    const answer = routeQuestion(digests, question.text, question.lang)
    retrievalSamples.push(performance.now() - started)
    if (answer.kind !== 'none') answeredQuestions += 1
  }
}
const retrievalP95Ms = percentile(retrievalSamples, 0.95)

// ---------------------------------------------------------------------------
// §21.4 #6 — 20 import/close cycles
// ---------------------------------------------------------------------------

const cycleDurations: number[] = []
let failedCycles = 0
let heapAfterFirstCycle = 0
let heapAfterLastCycle = 0

for (let cycle = 1; cycle <= IMPORT_CLOSE_CYCLES; cycle += 1) {
  const started = performance.now()
  try {
    // "Import": parse, index, account and project, exactly as opening a source
    // tab does. "Close": drop the only reference, which is what closing the tab
    // does in the shell.
    const opened = await importSource()
    if (opened.models.length !== studio.models.length) failedCycles += 1
    if (opened.accounting.unaccountedCount !== studio.accounting.unaccountedCount) failedCycles += 1
    cycleDurations.push(performance.now() - started)
  } catch {
    failedCycles += 1
    cycleDurations.push(performance.now() - started)
  }
  if (cycle === 1) heapAfterFirstCycle = settledHeapBytes(collector.collect)
  if (cycle === IMPORT_CLOSE_CYCLES) heapAfterLastCycle = settledHeapBytes(collector.collect)
}

const importCloseEndurance = evaluateEndurance(
  'import/close cycles',
  cycleDurations,
  IMPORT_CLOSE_CYCLES,
  ENDURANCE_DRIFT_LIMIT,
  failedCycles
)
const heapGrowthRatio = heapAfterFirstCycle > 0 ? heapAfterLastCycle / heapAfterFirstCycle : 0

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const measurements: Measurement[] = [
  measurement({
    name: 'parseAndAccountAnimalWf',
    unit: 'ms',
    value: parseElapsedMs,
    limit: LIMITS_MS.parseAndAccountAnimalWf,
    comparison: 'at-most',
    passed: false,
    thresholdSource: 'plan-21.4',
    planRequirement: 'Parse/account/show first AnimalWF model within 5 seconds (engine half)',
    details: {
      fixtureBytes: fixtureBytes.byteLength,
      models: studio.models.length,
      objectOccurrences: parsedPackage.index.objectOccurrences.size,
      unaccountedRecords: studio.accounting.unaccountedCount,
      firstModelRenderElements: firstRenderModel.elements.length,
      firstModelRenderConnections: firstRenderModel.connections.length
    }
  }),
  measurement({
    name: 'derivedExportSourcePackage',
    unit: 'ms',
    value: exportElapsedMs,
    limit: LIMITS_MS.derivedExportSourcePackage,
    comparison: 'at-most',
    passed: false,
    thresholdSource: 'plan-21.4',
    planRequirement: 'Export 4.4 MiB source package within 5 seconds',
    details: {
      sourceBytes: fixtureBytes.byteLength,
      exportedCharacters: exported.result.text.length,
      edits: exported.editCount,
      unmapped: exported.unmapped.length
    }
  }),
  measurement({
    name: 'assistantIndexFullFolder',
    unit: 'ms',
    value: indexElapsedMs,
    limit: LIMITS_MS.assistantIndexFullFolder,
    comparison: 'at-most',
    passed: false,
    thresholdSource: 'declared-here',
    planRequirement: 'Keep full-folder assistant retrieval responsive (index build)',
    details: { digests: digests.length }
  }),
  measurement({
    name: 'assistantFullFolderRetrievalP95',
    unit: 'ms',
    value: retrievalP95Ms,
    limit: LIMITS_MS.assistantFullFolderRetrievalP95,
    comparison: 'at-most',
    passed: false,
    thresholdSource: 'declared-here',
    planRequirement: 'Keep full-folder assistant retrieval responsive (query)',
    details: {
      questions: retrievalSamples.length,
      confidentAnswers: answeredQuestions,
      medianMs: Number(percentile(retrievalSamples, 0.5).toFixed(3)),
      maxMs: Number(Math.max(...retrievalSamples).toFixed(3))
    }
  }),
  measurement({
    name: 'importCloseCycleDrift',
    unit: 'ratio',
    value: importCloseEndurance.driftRatio,
    limit: ENDURANCE_DRIFT_LIMIT,
    comparison: 'at-most',
    passed: false,
    thresholdSource: 'declared-here',
    planRequirement: 'Remain stable through 20 import/close cycles',
    details: {
      cycles: importCloseEndurance.cycles,
      failedCycles: importCloseEndurance.failedCycles,
      totalMs: importCloseEndurance.totalMs,
      firstFifthMedianMs: importCloseEndurance.firstFifthMedianMs,
      lastFifthMedianMs: importCloseEndurance.lastFifthMedianMs
    }
  }),
  measurement({
    name: 'importCloseHeapGrowth',
    unit: 'ratio',
    value: heapGrowthRatio,
    limit: HEAP_GROWTH_LIMIT,
    comparison: 'at-most',
    passed: false,
    thresholdSource: 'declared-here',
    planRequirement: 'Avoid unbounded memory growth across repeated import/close',
    details: {
      forcedGarbageCollection: collector.available,
      heapAfterFirstCycleBytes: heapAfterFirstCycle,
      heapAfterLastCycleBytes: heapAfterLastCycle
    }
  })
]

const structurallyComplete =
  importCloseEndurance.cycles === IMPORT_CLOSE_CYCLES &&
  importCloseEndurance.failedCycles === 0 &&
  collector.available &&
  digests.length > 0 &&
  studio.accounting.unaccountedCount === 0

const functionalPassed = measurements.every((entry) => entry.passed) && structurallyComplete
const source = collectPerformanceSourceBinding(expectedPerformanceCandidateSha())
const hardwareProfile = evaluatePerformanceHardwareProfile(
  selectedPerformanceHardwareProfile(),
  observePerformanceRuntime()
)
const measuredPassed = functionalPassed && hardwareProfile.matched
const releaseEvidenceEligible =
  measuredPassed && hardwareProfile.referenceEligible && source.releaseEligible
const releaseEvidenceRequired = process.argv.slice(2).includes('--require-release-evidence')
const passed = measuredPassed && (!releaseEvidenceRequired || releaseEvidenceEligible)

const evidence = {
  schemaVersion: 3,
  gate: 'orbitpm-aris-engine-performance',
  planSection: '21.4',
  createdAt: new Date().toISOString(),
  source,
  hardwareProfile,
  fixture: {
    path: fixturePath,
    bytes: fixtureBytes.byteLength,
    sha256: parsedPackage.sha256,
    models: studio.models.length
  },
  limitsMs: LIMITS_MS,
  enduranceDriftLimit: ENDURANCE_DRIFT_LIMIT,
  heapGrowthLimit: HEAP_GROWTH_LIMIT,
  forcedGarbageCollection: collector.available,
  measurements,
  importCloseEndurance,
  structurallyComplete,
  functionalPassed,
  releaseEvidenceRequired,
  passed,
  releaseEvidenceEligible
}

const outputArgument = performanceArgumentValue('output')
if (outputArgument) writeEvidenceAtomic(resolve(outputArgument), evidence)

for (const entry of measurements) {
  console.log(
    `${entry.passed ? 'PASS' : 'FAIL'} ${entry.name}: ${entry.value} ${entry.unit} ` +
      `(limit ${entry.limit} ${entry.unit}, ${entry.thresholdSource}) — ${entry.planRequirement}`
  )
}
for (const failure of importCloseEndurance.failures) console.error(`endurance: ${failure}`)
if (!collector.available) {
  console.error('Forced garbage collection was unavailable; the heap ratio is not conclusive.')
}
console.log(
  `Fixture ${fixturePath}: ${fixtureBytes.byteLength} bytes, ${studio.models.length} models, ` +
    `${studio.accounting.unaccountedCount} unaccounted record(s).`
)
console.log(
  `Hardware profile ${hardwareProfile.id}: ` +
    `${hardwareProfile.matched ? 'matched' : `mismatch (${hardwareProfile.mismatches.join('; ')})`}; ` +
    `release-reference=${hardwareProfile.referenceEligible ? 'eligible' : 'ineligible'}`
)
console.log(
  `Candidate ${source.gitHeadSha}: ` +
    `${source.releaseEligible ? 'clean exact binding' : 'development/non-final binding'}`
)

if (!passed) {
  console.error('ARIS engine performance gate failed.')
  process.exit(1)
}

console.log(
  `ARIS engine performance gate passed; release evidence is ${
    releaseEvidenceEligible ? 'eligible' : 'development-only'
  }.`
)
