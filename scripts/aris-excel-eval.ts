/**
 * ARIS "create from Excel workbook" fidelity eval harness — Wave 13, lane
 * P11-runner (plan lines 736-767, sub-lane P11-runner, item 3: "same shape
 * for P12").
 *
 * Drives the REAL production pipeline end to end — there is no model call in
 * this pipeline at all, so unlike `aris-description-eval.ts` there is nothing
 * to mock: passing any `.xlsx` workbook (a real ARIS workbook, or a small
 * hand-authored one built with `writeXlsx`/`ARIS_SHEET_SPECS`) already proves
 * the harness offline.
 *
 *   parseArisWorkbook(fileName, bytes)
 *     -> (rejected: captured validation-issue list, no AML/compare)
 *     -> (accepted) buildAmlFromArisWorkbook (deterministic one-column AML)
 *     -> createArisXmlSourcePackage + buildFromSource (real AML parse)
 *     -> compareStructure vs the hand-authored `<process>.expected.json`
 *        oracle
 *
 * Usage:
 *   npx vite-node scripts/aris-excel-eval.ts --workbook <xlsx> --process <key> \
 *     [--rounds-tag rN] [--out <json>]
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArisWorkbook } from '../src/aris/excel'
import {
  arisIdForWorkbookId,
  buildAmlFromArisWorkbook,
  isAcceptedArisWorkbook
} from '../src/aris/shell/arisExcelCreate'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'
import { buildFromSource } from '../src/aris/model/buildFromSource'
import { loadExpectation } from '../src/aris/fidelity/loadExpectation'
import { compareStructure, type StructureScore } from '../src/aris/fidelity/structureCompare'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const REFERENCE_DIR = resolve(REPO, '../reference')
const GEN_TESTS_DIR = resolve(REFERENCE_DIR, 'AnimalWF/gen-tests')

const DEFAULT_ROUNDS_TAG = 'adhoc'

// --- CLI -----------------------------------------------------------------------

interface CliArgs {
  readonly workbook: string
  readonly process: string
  readonly roundsTag: string
  readonly out?: string
}

function parseArgs(argv: readonly string[]): CliArgs {
  const map = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      map.set(key, 'true')
    } else {
      map.set(key, next)
      i += 1
    }
  }
  const workbook = map.get('workbook')
  const processKey = map.get('process')
  if (!workbook) fail('--workbook <xlsx> is required')
  if (!processKey) fail('--process <key> is required')
  return {
    workbook,
    process: processKey,
    roundsTag: map.get('rounds-tag') ?? DEFAULT_ROUNDS_TAG,
    out: map.get('out')
  }
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

// --- round report (markdown) — same column shape as aris-description-eval.ts ---

const REPORT_COLUMNS = [
  'process',
  'workbook',
  'controlFlowRecall',
  'controlFlowPrecision',
  'connectionRecall',
  'connectionPrecision',
  'satelliteRecall',
  'gatewayAccuracy',
  'labelSimilarityMean'
] as const

function appendMarkdownRow(
  roundDir: string,
  row: { readonly process: string; readonly workbook: string; readonly score: StructureScore }
): void {
  mkdirSync(roundDir, { recursive: true })
  const reportPath = join(roundDir, 'report.md')
  if (!existsSync(reportPath)) {
    writeFileSync(
      reportPath,
      `| ${REPORT_COLUMNS.join(' | ')} |\n| ${REPORT_COLUMNS.map(() => '---').join(' | ')} |\n`
    )
  }
  const fmt = (value: number): string => value.toFixed(3)
  const s = row.score
  const cells = [
    row.process,
    row.workbook,
    fmt(s.controlFlowRecall),
    fmt(s.controlFlowPrecision),
    fmt(s.connectionRecall),
    fmt(s.connectionPrecision),
    fmt(s.satelliteRecall),
    fmt(s.gatewayAccuracy),
    fmt(s.labelSimilarityMean)
  ]
  appendFileSync(reportPath, `| ${cells.join(' | ')} |\n`)
}

// --- main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const expected = (() => {
    try {
      return loadExpectation(args.process)
    } catch (error) {
      return fail(
        `could not load ../reference/AnimalWF/expected/${args.process}.expected.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  })()

  const workbookFileName = basename(args.workbook)
  const workbookVariant = basename(args.workbook, extname(args.workbook))
  const bytes = readFileSync(args.workbook)

  console.log(`=== aris-excel-eval: ${args.process} (${workbookFileName}) ===`)

  const parseResult = parseArisWorkbook(workbookFileName, new Uint8Array(bytes))

  const roundDir = join(GEN_TESTS_DIR, 'runs', args.roundsTag)
  const outPath = args.out ?? join(roundDir, `${args.process}-${workbookVariant}.json`)
  mkdirSync(dirname(outPath), { recursive: true })

  if (!isAcceptedArisWorkbook(parseResult)) {
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ok: false,
          process: args.process,
          workbook: workbookFileName,
          status: parseResult.status,
          issueCounts: parseResult.issueCounts,
          issues: parseResult.issues
        },
        null,
        2
      )
    )
    console.error(`REJECTED: ${parseResult.issueCounts.errors} error issue(s)`)
    for (const issue of parseResult.issues) {
      const where = issue.sheet ? ` (${issue.sheet}${issue.cell ? `!${issue.cell}` : ''})` : ''
      console.error(`  - [${issue.severity}] ${issue.code}${where}: ${issue.messageKey}`)
    }
    process.exitCode = 1
    return
  }

  const amlResult = buildAmlFromArisWorkbook(parseResult.model)
  const sourcePackage = await createArisXmlSourcePackage({
    name: `${args.process}.aml`,
    relPath: null,
    bytes: new TextEncoder().encode(amlResult.xml)
  })
  const document = buildFromSource(sourcePackage.index)

  const firstModel = parseResult.model.models[0]
  if (!firstModel) fail('the workbook declared zero models — nothing to compare')
  const modelId = arisIdForWorkbookId('Model', firstModel.modelId.value)

  const score = compareStructure(document, modelId, expected)

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ok: true,
        process: args.process,
        workbook: workbookFileName,
        generatedAt: new Date().toISOString(),
        detection: parseResult.detection,
        issueCounts: parseResult.issueCounts,
        issues: parseResult.issues,
        amlCounts: {
          models: amlResult.modelCount,
          objects: amlResult.objectCount,
          connections: amlResult.connectionCount
        },
        score
      },
      null,
      2
    )
  )
  appendMarkdownRow(roundDir, { process: args.process, workbook: workbookVariant, score })

  console.log(
    `validation issues: ${parseResult.issueCounts.errors} error / ${parseResult.issueCounts.warnings} warning / ${parseResult.issueCounts.infos} info`
  )
  console.log('--- StructureScore ---')
  console.log(JSON.stringify(score, null, 2))
  console.log(`Wrote: ${outPath}`)
}

main().catch((error: unknown) => {
  console.error('ERROR:', error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
