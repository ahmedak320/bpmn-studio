import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { CANONICAL_FIELDS_BY_SHEET } from '../src/spreadsheet/aliases'
import {
  OFFICIAL_TEMPLATE_VERSION,
  type CanonicalSheet,
  type ParsedWorkbookData,
  type WorkbookCell
} from '../src/spreadsheet/contracts'
import { applyGraphInferencePlan, createGraphInferencePlan } from '../src/spreadsheet/inference'
import { buildProcessWorkbookModel, officialTemplatePreset } from '../src/spreadsheet/modelBuilder'
import { OFFICIAL_SHEET_NAMES } from '../src/spreadsheet/officialTemplate'
import { validateProcessWorkbookModel } from '../src/spreadsheet/validation'
import {
  collectPerformanceSourceBinding,
  evaluatePerformanceHardwareProfile,
  expectedPerformanceCandidateSha,
  observePerformanceRuntime,
  performanceArgumentValue,
  selectedPerformanceHardwareProfile
} from './performanceEvidence'
import {
  measureProductionWorkspacePerformance,
  type WorkspacePerformanceMeasurement
} from './workspacePerformance'

const LIMITS_MS = Object.freeze({
  initialWorkspaceFiles1000: 5_000,
  incrementalWorkspaceOnePercent: 1_000,
  spreadsheetPreviewNodes500: 3_000,
  spreadsheetPreviewNodes1000: 10_000
})

interface Measurement {
  name: keyof typeof LIMITS_MS
  elapsedMs: number
  limitMs: number
  passed: boolean
  details: Readonly<Record<string, number>>
}

function measure<T>(operation: () => T): { elapsedMs: number; value: T } {
  const started = performance.now()
  const value = operation()
  return { elapsedMs: performance.now() - started, value }
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

function workbookFixture(nodeCount: number): ParsedWorkbookData {
  const sheets = (Object.keys(OFFICIAL_SHEET_NAMES) as CanonicalSheet[]).map((role) => {
    const headers = CANONICAL_FIELDS_BY_SHEET[role]
    const rows: WorkbookCell[][] = [headers.map((header) => cell(header))]
    if (role === 'processes') {
      rows.push(
        row(headers, {
          process_id: 'performance_process',
          name_en: 'Performance process',
          name_ar: 'عملية الأداء',
          active_language: 'en'
        })
      )
    }
    if (role === 'steps') {
      for (let index = 0; index < nodeCount; index += 1) {
        const first = index === 0
        const last = index === nodeCount - 1
        rows.push(
          row(headers, {
            process_id: 'performance_process',
            step_id: `Step_${index + 1}`,
            order: index + 1,
            type: first ? 'startEvent' : last ? 'endEvent' : 'userTask',
            name_en: first ? 'Start' : last ? 'End' : `Review item ${index}`,
            name_ar: first ? 'البداية' : last ? 'النهاية' : `مراجعة البند ${index}`
          })
        )
      }
    }
    return {
      name: OFFICIAL_SHEET_NAMES[role],
      rows
    }
  })
  return {
    sheets,
    customProperties: {
      OrbitPMTemplateVersion: OFFICIAL_TEMPLATE_VERSION
    }
  }
}

function previewSpreadsheet(nodeCount: number): {
  nodes: number
  flows: number
  errors: number
  reviews: number
} {
  const workbook = workbookFixture(nodeCount)
  const preset = officialTemplatePreset(workbook)
  const built = buildProcessWorkbookModel(workbook, {
    fileName: `performance-${nodeCount}.xlsx`,
    format: 'xlsx',
    preset,
    officialTemplate: true,
    templateVersion: OFFICIAL_TEMPLATE_VERSION
  })
  const inference = createGraphInferencePlan(built.model, {
    flowMode: 'numeric-order'
  })
  const model = applyGraphInferencePlan(built.model, inference, {
    confirmSyntheticBoundaries: true
  })
  const validation = validateProcessWorkbookModel(model, {
    additionalIssues: built.issues
  })
  if (model.nodes.length !== nodeCount) {
    throw new Error(`Spreadsheet preview lost nodes: ${model.nodes.length} != ${nodeCount}`)
  }
  if (validation.errorCount !== 0) {
    throw new Error(
      `Spreadsheet preview produced ${validation.errorCount} blocking validation errors.`
    )
  }
  return {
    nodes: model.nodes.length,
    flows: model.flows.length,
    errors: validation.errorCount,
    reviews: validation.reviewCount
  }
}

function result(
  name: Measurement['name'],
  elapsedMs: number,
  details: Measurement['details']
): Measurement {
  const limitMs = LIMITS_MS[name]
  return {
    name,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    limitMs,
    passed: elapsedMs <= limitMs,
    details
  }
}

function workspaceResult(measurement: WorkspacePerformanceMeasurement): Measurement {
  return result(measurement.name, measurement.elapsedMs, measurement.details)
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

// Warm spreadsheet parsing/JIT without polluting the measured fixture sizes.
previewSpreadsheet(20)

const source = collectPerformanceSourceBinding(expectedPerformanceCandidateSha())
const hardwareProfile = evaluatePerformanceHardwareProfile(
  selectedPerformanceHardwareProfile(),
  observePerformanceRuntime()
)
const workspace = await measureProductionWorkspacePerformance()
const spreadsheet500 = measure(() => previewSpreadsheet(500))
const spreadsheet1000 = measure(() => previewSpreadsheet(1_000))

const measurements: Measurement[] = [
  workspaceResult(workspace.initial),
  workspaceResult(workspace.incremental),
  result('spreadsheetPreviewNodes500', spreadsheet500.elapsedMs, {
    ...spreadsheet500.value
  }),
  result('spreadsheetPreviewNodes1000', spreadsheet1000.elapsedMs, {
    ...spreadsheet1000.value
  })
]
const functionalPassed = measurements.every((measurement) => measurement.passed)
const measuredPassed = functionalPassed && hardwareProfile.matched
const releaseEvidenceEligible =
  measuredPassed && hardwareProfile.referenceEligible && source.releaseEligible
const releaseEvidenceRequired = process.argv.slice(2).includes('--require-release-evidence')
const passed = measuredPassed && (!releaseEvidenceRequired || releaseEvidenceEligible)
const evidence = {
  schemaVersion: 2,
  gate: 'orbitpm-lite-production-performance',
  createdAt: new Date().toISOString(),
  source,
  hardwareProfile,
  limitsMs: LIMITS_MS,
  measurements,
  functionalPassed,
  releaseEvidenceRequired,
  passed,
  releaseEvidenceEligible
}

const outputArgument = performanceArgumentValue('output')
if (outputArgument) writeEvidenceAtomic(resolve(outputArgument), evidence)

for (const measurement of measurements) {
  const state = measurement.passed ? 'PASS' : 'FAIL'
  console.log(
    `${state} ${measurement.name}: ${measurement.elapsedMs.toFixed(3)} ms ` +
      `(limit ${measurement.limitMs} ms)`
  )
}
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
  console.error('Performance release gate failed.')
  process.exit(1)
}

console.log(
  `Performance gate passed; release evidence is ${
    releaseEvidenceEligible ? 'eligible' : 'development-only'
  }.`
)
