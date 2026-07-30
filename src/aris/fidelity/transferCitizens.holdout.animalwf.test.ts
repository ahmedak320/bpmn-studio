import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { buildArisStudioDocument } from '../shell/arisStudioDocument'
import type { ArisWorkingDocument } from '../model/types'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { compareModelToExpectation } from './compare'
import type { FidelityDiffReport } from './expectationTypes'
import { loadExpectation } from './loadExpectation'

/**
 * Fidelity HOLDOUT for "Animal Ownership Transfer between Citizens" (plan §20, R4 item 3) —
 * strictly authored from the real per-model occurrence/connection data (see
 * `../reference/AnimalWF/expected/transfer-citizens.expected.json`, OUTSIDE the repo) but never
 * tuned against the render pipeline: this is a held-out acceptance model, only re-examined against
 * the real render in Wave 5.
 *
 * `*.holdout.animalwf.test.ts` is a superset-named sibling of `*.animalwf.test.ts`: excluded from
 * the default vitest project (see `vitest.config.ts`) AND from the `test:aris:animalwf` project
 * (see `vitest.animalwf.config.ts`'s `exclude`), and from `check:no-skips`'s scan. It runs only via
 * its own dedicated config, `vitest.animalwf.holdout.config.ts` — deliberately not part of the
 * ordinary Wave-1..4 gate loop, so nothing downstream can (even accidentally) tune the render
 * pipeline against it before Wave 5's holdout run.
 *
 * The AnimalWF export is private customer data and is never committed or reproduced here — only
 * the comparator's structured diff (counts and categories) reaches the assertions. The module-load
 * guard below throws if the private fixture is absent — a loud failure, never a skip.
 *
 * BASELINE: see `renewProfile.animalwf.test.ts` for the full rationale (most materially,
 * `CT_IS_PREDEC_OF_1` — this export's direct Function→Function sequence connector — is not yet in
 * `FLOW_CONNECTION_TYPES`). A threshold, never a skip, and — per the holdout contract — not
 * ratcheted by C8's Wave-3 loop; it is re-verified once, deliberately, in Wave 5.
 */
const ANIMAL_WF_PATH = resolve(process.cwd(), '../reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via its dedicated ` +
      '`vitest.animalwf.holdout.config.ts` with the private reference export present locally; it ' +
      'is never run as part of the default test suite and never skips.'
  )
}

/** Wave-1 ceiling per diff category (see file banner). Re-verified once in Wave 5, not before. */
const BASELINE: Readonly<Record<string, number>> = Object.freeze({
  spine: 1,
  numbering: 0,
  satellite: 4,
  symbol: 0,
  color: 0,
  gate: 0,
  note: 10,
  count: 0
})

let workingDocument: ArisWorkingDocument

beforeAll(async () => {
  const bytes = readFileSync(ANIMAL_WF_PATH)
  const sourcePackage = await createArisXmlSourcePackage({
    name: 'ARISAMLExport.xml',
    relPath: null,
    bytes: new Uint8Array(bytes)
  })
  workingDocument = buildArisStudioDocument(sourcePackage).source
}, 60_000)

function formatRows(report: FidelityDiffReport): string {
  if (report.rows.length === 0) return 'no diff rows'
  return report.rows
    .map(
      (row) =>
        `[${row.category}/${row.status}] ${row.where}: expected=${row.expected ?? 'null'} actual=${row.actual ?? 'null'}`
    )
    .join('\n')
}

describe('AnimalWF fidelity HOLDOUT: Animal Ownership Transfer between Citizens (plan §20)', () => {
  it('stays within the Wave-1 baseline diff budget against the strict hand-authored expectation', () => {
    const expected = loadExpectation('transfer-citizens')
    expect(expected.modelIdHint).not.toBeNull()

    const report = compareModelToExpectation(workingDocument, expected.modelIdHint!, expected)

    const overBudget = Object.entries(report.byCategory).filter(
      ([category, count]) => count > (BASELINE[category] ?? 0)
    )
    expect(overBudget, formatRows(report)).toEqual([])
  })
})
