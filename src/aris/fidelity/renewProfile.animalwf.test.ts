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
 * Fidelity acceptance for the "Renew an Animal's profile" EPC (plan §20, R4 item 1) — one of the
 * two Wave-1 "iterate" models compared in full detail against a hand-authored expectation built
 * from the real AnimalWF export (see `../reference/AnimalWF/expected/renew-profile.expected.json`,
 * OUTSIDE the repo, authored in Wave 1 from the real per-model occurrence/connection data).
 *
 * The AnimalWF export is private customer data and is never committed or reproduced here — only
 * the comparator's structured diff (counts and categories) reaches the assertions.
 *
 * Naming: `*.animalwf.test.ts` is excluded from the default vitest project and from
 * `check:no-skips`, and runs only via `npm run test:aris:animalwf`. The module-load guard below
 * throws if the private fixture is absent — a loud failure, never a skip and never an early
 * return.
 *
 * BASELINE: Wave-1 rendering (the EPC flow-graph classification in `src/aris/epc/constants.ts`,
 * the palette/convention wiring landing in later waves) has known gaps against this hand-authored,
 * source-faithful expectation — most materially, `CT_IS_PREDEC_OF_1` (used in this export as a
 * direct Function→Function sequence connector) is not in `FLOW_CONNECTION_TYPES`, so the spine
 * walk cannot yet follow it. `BASELINE` records the current per-category diff count as a ceiling
 * (a threshold, never a skip): the suite is green at merge, and C8's measured fidelity fix loop
 * (Wave 3) ratchets each number down to 0 as the underlying gaps close. Raising a number here is
 * never permitted as a fix; only lowering one, once the real gap has closed, is.
 */
const ANIMAL_WF_PATH = resolve(process.cwd(), '../reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

/** Wave-1 ceiling per diff category (see file banner). C8 ratchets these toward 0. */
const BASELINE: Readonly<Record<string, number>> = Object.freeze({
  spine: 27,
  numbering: 13,
  satellite: 4,
  symbol: 13,
  color: 12,
  gate: 1,
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

describe("AnimalWF fidelity acceptance: Renew an Animal's profile (iterate, plan §20)", () => {
  it('stays within the Wave-1 baseline diff budget against the hand-authored expectation', () => {
    const expected = loadExpectation('renew-profile')
    expect(expected.modelIdHint).not.toBeNull()

    const report = compareModelToExpectation(workingDocument, expected.modelIdHint!, expected)

    const overBudget = Object.entries(report.byCategory).filter(
      ([category, count]) => count > (BASELINE[category] ?? 0)
    )
    expect(overBudget, formatRows(report)).toEqual([])
  })
})
