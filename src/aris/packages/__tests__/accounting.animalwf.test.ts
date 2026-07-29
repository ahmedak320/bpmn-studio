import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  arisAccountingDigest,
  createArisAccountingDocument,
  summarizeArisFidelity,
  type ArisAccountingEntry
} from '../accounting'
import { buildAccountingEntries } from '../../accounting/accounting'
import { buildLexicalCensus } from '../../accounting/lexicalCensus'
import { adaptSemanticIndex } from '../../accounting/semanticIndexAdapter'
import type { ArisAccountingEntry as ArisSourceAccountingEntry } from '../../accounting/types'
import { buildSemanticArisDocument } from '../../source/semanticIndex'
import { tokenizeXmlDocument } from '../../source/xmlTokenizer'

/**
 * AnimalWF integration split out of accounting.test.ts (public-API reconciliation evidence).
 *
 * The private AnimalWF export is not committed to the repository; only the aggregate numbers
 * below (68,043 total / 7 derived / 68,036 raw-source) may ever appear in source. See
 * `../../../../../reference/AnimalWF/ARISAMLExport.xml`.
 *
 * This file is named `*.animalwf.test.ts` — a convention excluded from the default `vitest run`
 * project (see vitest.config.ts) and from `check:no-skips`'s scan — so it never runs as part of
 * the ordinary test suite and never needs a `.skip`/`.runIf` guard. It only ever runs through the
 * dedicated `npm run test:aris:animalwf` entry point (vitest.animalwf.config.ts), which is
 * unconditional: if the fixture is absent, the module-load guard below throws immediately with a
 * clear message — a loud failure, never a silent skip or a soft pass.
 */
const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

describe('source accounting document', () => {
  it(
    'reconciles the real AnimalWF numbers through the public API with no caller-side filtering',
    { timeout: 120_000 },
    async () => {
      const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')
      const tokenized = tokenizeXmlDocument(xml)
      const semantic = buildSemanticArisDocument(tokenized)
      const source = adaptSemanticIndex(semantic.index)
      const census = buildLexicalCensus(tokenized)
      const entries = buildAccountingEntries(tokenized, source)

      // Known-good aggregate counts (see `src/aris/accounting/accounting.animalwf.test.ts`
      // for the full per-kind breakdown against the same fixture).
      expect(entries).toHaveLength(68_043)
      const derivedCount = entries.filter((entry) => entry.derived === true).length
      expect(derivedCount).toBe(7)
      expect(entries.length - derivedCount).toBe(census.totalSourceRecords)
      expect(census.totalSourceRecords).toBe(68_036)

      // This is the exact mapping `arisPackageImport.ts` performs — minus the
      // `entries.filter((entry) => entry.kind !== 'assignment')` workaround it
      // currently applies before calling in. No filtering happens here.
      const mapped: readonly ArisAccountingEntry[] = entries.map(
        (entry: ArisSourceAccountingEntry) => ({
          sourcePath: entry.sourcePath,
          ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
          kind: entry.kind,
          disposition: entry.disposition,
          targetIds: entry.targetIds,
          ...(entry.reason ? { reason: entry.reason } : {}),
          ...(entry.derived ? { derived: true as const } : {})
        })
      )

      const document = createArisAccountingDocument({
        sourceSha256: 'a'.repeat(64),
        censusRecords: census.totalSourceRecords,
        entries: mapped
      })

      // Every source and derived record survives into the persisted document.
      expect(document.entries).toHaveLength(68_043)
      expect(document.totals.total).toBe(68_043)
      expect(document.censusRecords).toBe(68_036)

      // Zero unaccounted, computed the same way the manifest fidelity summary
      // (and the import review UI) will see it.
      const summary = summarizeArisFidelity(document)
      expect(summary.totalRecords).toBe(68_036)
      expect(summary.accountedRecords).toBe(68_036)
      expect(summary.unaccountedRecords).toBe(0)

      // The document round-trips deterministically, matching the digest that
      // gets recorded in the manifest.
      expect(await arisAccountingDigest(document)).toMatch(/^[0-9a-f]{64}$/u)
    }
  )
})
