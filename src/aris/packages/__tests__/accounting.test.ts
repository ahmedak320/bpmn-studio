import { describe, expect, it } from 'vitest'
import {
  ArisAccountingError,
  arisAccountingDigest,
  createArisAccountingDocument,
  parseArisAccounting,
  serializeArisAccounting,
  summarizeArisFidelity,
  validateArisAccountingDocument
} from '../accounting'
import { sampleAccounting } from './harness'

const DIGEST = '7'.repeat(64)

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

  // The AnimalWF-fixture-dependent reconciliation test lives in
  // ./accounting.animalwf.test.ts — see that file for the real-data 68,043/7/68,036 evidence. It
  // is excluded from this default project and runs only via `npm run test:aris:animalwf`.
})
