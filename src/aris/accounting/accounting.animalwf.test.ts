import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'

import { buildAccountingEntries } from './accounting'
import { buildLexicalCensus } from './lexicalCensus'
import { reconcile } from './reconcile'
import { buildAccountingReport, serializeAccountingReport } from './report'
import { adaptSemanticIndex } from './semanticIndexAdapter'

/**
 * AnimalWF integration split out of accounting.test.ts (plan reconciliation evidence).
 *
 * The fixture is private customer data and is never committed, copied, or reproduced here — only
 * aggregate counts reach the assertions. This file is named `*.animalwf.test.ts` — a convention
 * excluded from the default `vitest run` project (see vitest.config.ts) and from
 * `check:no-skips`'s scan — so it never runs as part of the ordinary test suite and never needs a
 * `.skip`/`.runIf` guard. It only ever runs through the dedicated `npm run test:aris:animalwf`
 * entry point (vitest.animalwf.config.ts), which is unconditional: if the fixture is absent, the
 * module-load guard below throws immediately with a clear message — a loud failure, never a
 * silent skip or a soft pass.
 */
const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

function readAnimalWfExport(): string {
  return readFileSync(ANIMAL_WF_PATH, 'utf8')
}

describe('AnimalWF integration', () => {
  it(
    'accounts for every AnimalWF source construct with zero unaccounted records',
    { timeout: 120_000 },
    () => {
      const xml = readAnimalWfExport()
      const document = tokenizeXmlDocument(xml)
      const semantic = buildSemanticArisDocument(document)
      const source = adaptSemanticIndex(semantic.index)
      const census = buildLexicalCensus(document)
      const entries = buildAccountingEntries(document, source)
      const result = reconcile(census, entries)

      expect(result.ok).toBe(true)
      expect(result.unaccountedCount).toBe(0)
      expect(entries.filter((e) => !e.disposition)).toHaveLength(0)

      // Known-good aggregate counts from the transformation plan.
      const byKind = (kind: string) => entries.filter((e) => e.kind === kind).length
      expect(byKind('model')).toBe(8)
      expect(byKind('object-definition')).toBe(279)
      expect(byKind('object-occurrence')).toBe(494)
      expect(byKind('connection-definition')).toBe(465)
      expect(byKind('connection-occurrence')).toBe(465)
      expect(byKind('model-attribute') + byKind('attribute-definition')).toBe(516)
      expect(byKind('attribute-occurrence')).toBe(774)
      expect(byKind('lane')).toBe(16)
      expect(byKind('free-text')).toBe(69)
      expect(byKind('free-text-occurrence')).toBe(69)
      expect(byKind('ole-definition')).toBe(14)
      expect(byKind('ole-occurrence')).toBe(14)
      expect(byKind('blob')).toBe(28)
      expect(byKind('font-style-sheet')).toBe(6)
      expect(byKind('route-point')).toBe(1339)
      expect(byKind('language')).toBe(2)
      expect(byKind('group')).toBe(2)

      // Report determinism and SHA-256 on real data.
      const report = buildAccountingReport(entries, result)
      const serialized = serializeAccountingReport(report)
      expect(serializeAccountingReport(buildAccountingReport(entries, result))).toBe(serialized)
    }
  )

  it('reports exact total source records and total accounted', { timeout: 120_000 }, () => {
    const xml = readAnimalWfExport()
    const document = tokenizeXmlDocument(xml)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const census = buildLexicalCensus(document)
    const entries = buildAccountingEntries(document, source)
    const result = reconcile(census, entries)

    // Expose the numbers in the test output for the final report.
    expect(result.totalSourceRecords).toBeGreaterThan(0)
    // `totalAccounted` counts only raw-source (non-derived) entries, so on a source with zero
    // unaccounted records it is exactly `totalSourceRecords` — never more. Regression guard for
    // the false "68043 of 68036 source records accounted for" sentence (totalAccounted used to
    // include derived rows and could exceed the source-record total).
    expect(result.totalAccounted).toBe(result.totalSourceRecords)
    expect(result.totalDerived).toBeGreaterThanOrEqual(0)
    expect(result.unaccountedCount).toBe(0)
  })
})
