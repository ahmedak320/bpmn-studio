/**
 * Step 3 of Test Sequence 1 — the XML round-trip compare, run under
 * `vite-node` (see `../aris-sequence-1.spec.ts` for why the compare cannot run
 * inside Playwright's own loader: `src/aris/fidelity/compare.ts` pulls in
 * `canvas/renderer`, whose extensionless `diagram-js` ESM imports only Vite's
 * resolver understands).
 *
 * Usage: `npx vite-node tests/e2e/helpers/arisRoundtripCompare.ts <exported.aml>`
 *
 * Parses the exported AML through the same pure decode → tokenize → index →
 * document pipeline the app uses (`buildArisStudioDocument(...).source` IS
 * `buildFromSource(index)`), compares both iterate models against their
 * hand-authored expectations with the same comparator the `*.animalwf.test.ts`
 * baselines use, and prints ONE JSON line on stdout for the spec to assert.
 * Exit code 1 means the compare could not run at all; diffs are data, not an
 * exit code.
 */

import { readFileSync } from 'node:fs'

// NOTE: '@' (vite.config.ts `resolve.alias`) instead of '../../src/…' — this
// file only ever runs under `vite-node`, and vite-node 3.2.4 does not
// absolutize two-level-up relative imports from tests/e2e/helpers (the repo's
// one-level `scripts/` imports work; these do not).
import { buildFromSource } from '@/aris/model/buildFromSource'
import { buildSemanticArisDocument } from '@/aris/source/semanticIndex'
import { tokenizeXmlDocument } from '@/aris/source/xmlTokenizer'
import { decodeUtf8Strict } from '@/workspace/utf8'
import { compareModelToExpectation } from '@/aris/fidelity/compare'
import { loadExpectation } from '@/aris/fidelity/loadExpectation'

const ITERATE_MODEL_KEYS = ['register-owner', 'renew-profile'] as const

function main(): void {
  const amlPath = process.argv[2]
  if (!amlPath) {
    console.error('usage: vite-node arisRoundtripCompare.ts <exported.aml>')
    process.exit(1)
  }
  const bytes = new Uint8Array(readFileSync(amlPath))
  const text = decodeUtf8Strict(bytes, { operation: 'read' })
  const document = tokenizeXmlDocument(text)
  const semantic = buildSemanticArisDocument(document)
  const workingDocument = buildFromSource(semantic.index)

  const models = ITERATE_MODEL_KEYS.map((key) => {
    const expectation = loadExpectation(key)
    const report = compareModelToExpectation(workingDocument, expectation.modelIdHint!, expectation)
    return {
      key,
      byCategory: report.byCategory,
      rows: report.rows.map(
        (row) =>
          `[${row.category}/${row.status}] ${row.where}: expected=${row.expected ?? 'null'} actual=${row.actual ?? 'null'}`
      )
    }
  })
  // One JSON line, last on stdout — the spec parses exactly this line.
  process.stdout.write(`${JSON.stringify({ models })}\n`)
}

main()
