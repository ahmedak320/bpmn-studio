import { writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { resolve } from 'node:path'
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
import { LiveWorkspaceIndex, type LiveWorkspaceFile } from '../src/workspace/liveWorkspaceIndex'
import { searchWorkspace } from '../src/workspace/searchIndex'

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
  details: Record<string, number>
}

function measure<T>(operation: () => T): { elapsedMs: number; value: T } {
  const started = performance.now()
  const value = operation()
  return { elapsedMs: performance.now() - started, value }
}

function ordinaryBpmn(processIndex: number, revision = 0): string {
  const tasks = Array.from({ length: 8 }, (_, index) => {
    const id = `Task_${processIndex}_${index + 1}`
    return `<bpmn:userTask id="${id}" name="Review item ${index + 1}" orbitpm:nameEn="Review item ${index + 1}" orbitpm:nameAr="مراجعة البند ${index + 1}" />`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:orbitpm="https://orbitpm.dev/schema/1.0"
  id="Definitions_${processIndex}">
  <bpmn:process id="Process_${processIndex}" name="Process ${processIndex} revision ${revision}">
    <bpmn:startEvent id="Start_${processIndex}" name="Start" orbitpm:nameEn="Start" orbitpm:nameAr="البداية" />
    ${tasks}
    <bpmn:endEvent id="End_${processIndex}" name="End" orbitpm:nameEn="End" orbitpm:nameAr="النهاية" />
  </bpmn:process>
</bpmn:definitions>`
}

function workspaceFixture(count: number): LiveWorkspaceFile[] {
  return Array.from({ length: count }, (_, index) => {
    const xml = ordinaryBpmn(index)
    return {
      relPath: `department-${String(index % 25).padStart(2, '0')}/process-${String(index).padStart(4, '0')}.bpmn`,
      xml,
      lastModified: 1_700_000_000_000 + index,
      size: new TextEncoder().encode(xml).byteLength
    }
  })
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

// Warm the parser/JIT without polluting the measured fixture sizes.
new LiveWorkspaceIndex(workspaceFixture(20))
previewSpreadsheet(20)

const files = workspaceFixture(1_000)
const initial = measure(() => {
  const index = new LiveWorkspaceIndex(files)
  const documents = index.searchDocuments()
  const matches = searchWorkspace(documents, 'Review item 4')
  return { index, documents: documents.length, matches: matches.length }
})

const incremental = measure(() => {
  for (let index = 0; index < 10; index += 1) {
    const prior = files[index]!
    const xml = ordinaryBpmn(index, 1)
    initial.value.index.updateSaved({
      ...prior,
      xml,
      lastModified: prior.lastModified + 10_000,
      size: new TextEncoder().encode(xml).byteLength
    })
  }
  const documents = initial.value.index.searchDocuments()
  const matches = searchWorkspace(documents, 'revision 1')
  return { documents: documents.length, matches: matches.length }
})

const spreadsheet500 = measure(() => previewSpreadsheet(500))
const spreadsheet1000 = measure(() => previewSpreadsheet(1_000))

const measurements: Measurement[] = [
  result('initialWorkspaceFiles1000', initial.elapsedMs, {
    files: initial.value.documents,
    searchGroups: initial.value.matches
  }),
  result('incrementalWorkspaceOnePercent', incremental.elapsedMs, {
    changedFiles: 10,
    files: incremental.value.documents,
    searchGroups: incremental.value.matches
  }),
  result('spreadsheetPreviewNodes500', spreadsheet500.elapsedMs, {
    ...spreadsheet500.value
  }),
  result('spreadsheetPreviewNodes1000', spreadsheet1000.elapsedMs, {
    ...spreadsheet1000.value
  })
]

const evidence = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: platform(),
    release: release(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length
  },
  limitsMs: LIMITS_MS,
  measurements,
  passed: measurements.every((measurement) => measurement.passed)
}

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
if (outputArgument) {
  const outputPath = resolve(outputArgument.slice('--output='.length))
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
}

for (const measurement of measurements) {
  const state = measurement.passed ? 'PASS' : 'FAIL'
  console.log(
    `${state} ${measurement.name}: ${measurement.elapsedMs.toFixed(3)} ms ` +
      `(limit ${measurement.limitMs} ms)`
  )
}

if (!evidence.passed) {
  console.error('Performance release gate failed.')
  process.exit(1)
}

console.log('Performance release gate passed.')
