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
})
