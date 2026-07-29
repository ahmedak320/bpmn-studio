import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ArisAccountingError,
  arisAccountingDigest,
  createArisAccountingDocument,
  parseArisAccounting,
  serializeArisAccounting,
  summarizeArisFidelity,
  validateArisAccountingDocument,
  type ArisAccountingEntry
} from '../accounting'
import { buildAccountingEntries } from '../../accounting/accounting'
import { buildLexicalCensus } from '../../accounting/lexicalCensus'
import { adaptSemanticIndex } from '../../accounting/semanticIndexAdapter'
import type { ArisAccountingEntry as ArisSourceAccountingEntry } from '../../accounting/types'
import { buildSemanticArisDocument } from '../../source/semanticIndex'
import { tokenizeXmlDocument } from '../../source/xmlTokenizer'
import { sampleAccounting } from './harness'

const DIGEST = '7'.repeat(64)

const ANIMAL_WF_PATH = '/home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/ARISAMLExport.xml'
const animalWfFixture = existsSync(ANIMAL_WF_PATH) ? readFileSync(ANIMAL_WF_PATH, 'utf8') : null
// Declared as an ordinary test (not `.skip`/`.skipIf`): it runs whenever the
// private AnimalWF fixture is present on disk and is a no-op otherwise. This
// mirrors the pattern already used by `src/aris/accounting/accounting.test.ts`.
const itIfAnimalWf = animalWfFixture
  ? it
  : (_name: string, _fn: () => void | Promise<void>) => undefined

describe('source accounting document', () => {
  it('orders entries and recomputes totals', () => {
    const document = createArisAccountingDocument({
      sourceSha256: DIGEST,
      censusRecords: 3,
      entries: [
        { sourcePath: '/b', kind: 'model', disposition: 'editable-native', targetIds: ['M2'] },
        { sourcePath: '/a', kind: 'group', disposition: 'side-panel', targetIds: ['G1'] },
        { sourcePath: '/c', kind: 'blob', disposition: 'raw-source-only', targetIds: [] }
      ]
    })
    expect(document.entries.map((entry) => entry.sourcePath)).toEqual(['/a', '/b', '/c'])
    expect(document.totals).toEqual({
      'editable-native': 1,
      'visual-only': 0,
      'side-panel': 1,
      attachment: 0,
      'raw-source-only': 1,
      'proposed-repair': 0,
      unsupported: 0,
      total: 3
    })
  })

  it('serializes deterministically and round-trips', async () => {
    const document = sampleAccounting(DIGEST)
    const first = serializeArisAccounting(document)
    expect(Array.from(serializeArisAccounting(document))).toEqual(Array.from(first))
    expect(parseArisAccounting(first)).toEqual(document)
    expect(await arisAccountingDigest(document)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('rejects malformed documents', () => {
    const document = sampleAccounting(DIGEST) as unknown as Record<string, unknown>
    const cases: Array<[string, unknown]> = [
      ['unknown key', { ...document, extra: 1 }],
      ['bad version', { ...document, version: 1 }],
      ['bad digest', { ...document, sourceSha256: 'nope' }],
      ['tampered totals', { ...document, totals: { ...(document.totals as object), total: 99 } }],
      ['census below entries', { ...document, censusRecords: 1 }],
      [
        'unknown disposition',
        {
          ...document,
          entries: [
            {
              sourcePath: '/x',
              kind: 'model',
              disposition: 'teleported',
              targetIds: []
            }
          ]
        }
      ],
      [
        'duplicate source paths',
        {
          ...document,
          entries: [
            { sourcePath: '/x', kind: 'model', disposition: 'unsupported', targetIds: [] },
            { sourcePath: '/x', kind: 'model', disposition: 'unsupported', targetIds: [] }
          ]
        }
      ]
    ]
    for (const [label, value] of cases) {
      expect(() => validateArisAccountingDocument(value), label).toThrow(ArisAccountingError)
    }
    expect(() => parseArisAccounting('nope')).toThrow(ArisAccountingError)
  })

  it('summarizes fidelity and surfaces unaccounted records instead of dropping them', () => {
    const document = createArisAccountingDocument({
      sourceSha256: DIGEST,
      censusRecords: 5,
      entries: [
        { sourcePath: '/a', kind: 'model', disposition: 'editable-native', targetIds: [] },
        { sourcePath: '/b', kind: 'font', disposition: 'visual-only', targetIds: [] },
        { sourcePath: '/c', kind: 'ole', disposition: 'unsupported', targetIds: [] }
      ]
    })
    const summary = summarizeArisFidelity(document, [
      { code: 'missing-font', count: 1 },
      { code: 'missing-font', count: 2 },
      { code: 'unsupported-ole', count: 1 }
    ])
    expect(summary).toMatchObject({
      totalRecords: 5,
      accountedRecords: 3,
      unaccountedRecords: 2,
      editableNative: 1,
      visualOnly: 1,
      unsupported: 1
    })
    expect(summary.issues).toEqual([
      { code: 'missing-font', count: 3 },
      { code: 'unsupported-ole', count: 1 }
    ])
    expect(() =>
      summarizeArisFidelity(document, [
        { code: 'not-a-code' as unknown as 'missing-font', count: 1 }
      ])
    ).toThrow(ArisAccountingError)
  })

  it('accepts derived entries beyond the census without caller-side filtering (Phase 4/7 contract)', () => {
    // Regression test for the Phase 4/Phase 7 census contract mismatch: Phase 7
    // emits synthetic `assignment` entries marked `derived: true` for records
    // that are not literal XML constructs, so the independent lexical census
    // cannot count them. A caller must be able to pass the *full, unfiltered*
    // entry list straight through; `createArisAccountingDocument` partitions by
    // `derived` itself rather than requiring callers to know this contract.
    const document = createArisAccountingDocument({
      sourceSha256: DIGEST,
      // Only two entries are literal source constructs.
      censusRecords: 2,
      entries: [
        { sourcePath: '/a', kind: 'model', disposition: 'editable-native', targetIds: [] },
        { sourcePath: '/b', kind: 'group', disposition: 'side-panel', targetIds: [] },
        // Two derived (synthetic) entries, unbounded by the census.
        {
          sourcePath: '/a#assignment[1]',
          kind: 'assignment',
          disposition: 'side-panel',
          targetIds: [],
          derived: true
        },
        {
          sourcePath: '/a#assignment[2]',
          kind: 'assignment',
          disposition: 'side-panel',
          targetIds: [],
          derived: true
        }
      ]
    })

    // Every entry, derived or not, is preserved and counted in `totals`.
    expect(document.entries).toHaveLength(4)
    expect(document.totals.total).toBe(4)
    expect(document.censusRecords).toBe(2)

    // `summarizeArisFidelity` reports zero unaccounted, in terms of the raw
    // (non-derived) subset, without dropping the derived rows from `entries`.
    const summary = summarizeArisFidelity(document)
    expect(summary.totalRecords).toBe(2)
    expect(summary.accountedRecords).toBe(2)
    expect(summary.unaccountedRecords).toBe(0)

    // A caller-side filter is unnecessary and would only lose provenance —
    // proving the invariant holds without one.
    expect(document.entries.filter((entry) => entry.derived === true)).toHaveLength(2)
  })

  it('still rejects an accounting document that under-reports raw-source records', () => {
    // The census invariant continues to guard against real omissions: only
    // `derived: true` entries are exempt from the census bound.
    expect(() =>
      createArisAccountingDocument({
        sourceSha256: DIGEST,
        censusRecords: 1,
        entries: [
          { sourcePath: '/a', kind: 'model', disposition: 'editable-native', targetIds: [] },
          { sourcePath: '/b', kind: 'group', disposition: 'side-panel', targetIds: [] }
        ]
      })
    ).toThrow(ArisAccountingError)
  })

  // The private AnimalWF export is not committed to the repository; only the
  // aggregate numbers below (68,043 total / 7 derived / 68,036 raw-source) may
  // ever appear in source. See `../../../../reference/AnimalWF/ARISAMLExport.xml`.
  itIfAnimalWf(
    'reconciles the real AnimalWF numbers through the public API with no caller-side filtering',
    async () => {
      const xml = animalWfFixture as string
      const tokenized = tokenizeXmlDocument(xml)
      const semantic = buildSemanticArisDocument(tokenized)
      const source = adaptSemanticIndex(semantic.index)
      const census = buildLexicalCensus(tokenized)
      const entries = buildAccountingEntries(tokenized, source)

      // Known-good aggregate counts (see `src/aris/accounting/accounting.test.ts`
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
