/**
 * ARIS fidelity measurement script — Lane F2.
 *
 * Loads the AnimalWF AML export, tokenizes and indexes it, builds the working
 * document, and compares each iterate model against its hand-authored fidelity
 * expectation. Prints a per-category table and writes a stable-named JSON
 * artifact per model.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildArisStudioDocument } from '../src/aris/shell/arisStudioDocument'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'
import { compareModelToExpectation } from '../src/aris/fidelity/compare'
import { loadExpectation } from '../src/aris/fidelity/loadExpectation'
import type { FidelityDiffReport } from '../src/aris/fidelity/expectationTypes'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

const ANIMALWF_DIR = resolve(REPO, '../reference/AnimalWF')
const AML_PATH = resolve(ANIMALWF_DIR, 'ARISAMLExport.xml')
const REPORT_DIR = resolve(ANIMALWF_DIR, 'fidelity-report')

const ITERATE_MODELS = ['renew-profile', 'register-owner'] as const

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function printCategoryTable(modelKey: string, report: FidelityDiffReport): void {
  console.log(`\n${modelKey}`)
  const categories = Object.entries(report.byCategory).sort(([a], [b]) => a.localeCompare(b))
  if (categories.length === 0) {
    console.log('  pass — no differences')
    return
  }
  const maxWidth = Math.max(...categories.map(([category]) => category.length), 12)
  console.log(`  ${padEnd('category', maxWidth)}  count`)
  console.log(`  ${'-'.repeat(maxWidth)}  -----`)
  for (const [category, count] of categories) {
    console.log(`  ${padEnd(category, maxWidth)}  ${count}`)
  }
  console.log(`  total: ${report.rows.length} difference(s), pass=${report.pass}`)
}

async function main(): Promise<void> {
  const bytes = new Uint8Array(readFileSync(AML_PATH))
  const pkg = await createArisXmlSourcePackage({
    name: basename(AML_PATH),
    relPath: null,
    bytes
  })
  const studio = buildArisStudioDocument(pkg)

  mkdirSync(REPORT_DIR, { recursive: true })

  let allPass = true
  for (const modelKey of ITERATE_MODELS) {
    const expectation = loadExpectation(modelKey)
    const modelId = expectation.modelIdHint
    if (!modelId) {
      throw new Error(`Expectation for ${modelKey} has no modelIdHint.`)
    }

    const report = compareModelToExpectation(studio.source, modelId, expectation)
    printCategoryTable(modelKey, report)

    const artifactPath = resolve(REPORT_DIR, `${modelKey}.json`)
    const artifact = {
      schemaVersion: 1,
      modelKey,
      modelId,
      nameEn: expectation.nameEn,
      generatedAt: new Date().toISOString(),
      pass: report.pass,
      byCategory: report.byCategory,
      rows: report.rows
    }
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    console.log(`  artifact: ${artifactPath}`)

    if (!report.pass) allPass = false
  }

  console.log('')
  if (allPass) {
    console.log('Fidelity gate: all iterate models pass.')
  } else {
    console.log('Fidelity gate: one or more iterate models failed.')
    process.exitCode = 1
  }
}

await main()
