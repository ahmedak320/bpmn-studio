import { describe, expect, it } from 'vitest'

import { buildLibraryZip, zipFileName } from '../zipExport'
import { readLibraryZip } from '../zipImport'

const SAMPLE_BPMN = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><definitions id="${name}"><process id="p_${name}" /></definitions>`

describe('buildLibraryZip / readLibraryZip round-trip', () => {
  it('round-trips nested folders and Arabic filenames', () => {
    const files = [
      { relPath: 'top.bpmn', xml: SAMPLE_BPMN('top') },
      { relPath: 'nested/child.bpmn', xml: SAMPLE_BPMN('child') },
      { relPath: 'nested/deep/grandchild.bpmn', xml: SAMPLE_BPMN('grandchild') },
      { relPath: 'عربي/عملية.bpmn', xml: SAMPLE_BPMN('arabic') },
    ]

    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.skipped).toEqual([])
    expect(result.entries).toHaveLength(files.length)

    const byPath = new Map(result.entries.map((e) => [e.relPath, e.xml]))
    for (const f of files) {
      expect(byPath.get(f.relPath)).toBe(f.xml)
    }
  })

  it('produces deterministic entry order regardless of input order', () => {
    const filesA = [
      { relPath: 'b.bpmn', xml: SAMPLE_BPMN('b') },
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
    ]
    const filesB = [
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
      { relPath: 'b.bpmn', xml: SAMPLE_BPMN('b') },
    ]

    const zipA = buildLibraryZip(filesA)
    const zipB = buildLibraryZip(filesB)

    expect(Array.from(zipA)).toEqual(Array.from(zipB))
  })

  it('includes extras in the zip, and import lists them as not-bpmn skipped', () => {
    const files = [{ relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') }]
    const extras = [{ relPath: 'manifest.csv', content: 'relPath,size\na.bpmn,123\n' }]

    const zip = buildLibraryZip(files, extras)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].relPath).toBe('a.bpmn')

    expect(result.skipped).toContainEqual({ path: 'manifest.csv', reason: 'not-bpmn' })
  })

  it('skips unsafe paths with reason unsafe-path', () => {
    const files = [
      { relPath: '../x.bpmn', xml: SAMPLE_BPMN('escape') },
      { relPath: '/abs.bpmn', xml: SAMPLE_BPMN('abs') },
      { relPath: 'C:\\evil.bpmn', xml: SAMPLE_BPMN('winabs') },
    ]

    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toHaveLength(3)
    for (const s of result.skipped) {
      expect(s.reason).toBe('unsafe-path')
    }
  })

  it('skips oversize entries with reason too-large', () => {
    const bigXml = 'x'.repeat(5 * 1024 * 1024 + 1)
    const files = [
      { relPath: 'huge.bpmn', xml: bigXml },
      { relPath: 'small.bpmn', xml: SAMPLE_BPMN('small') },
    ]

    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].relPath).toBe('small.bpmn')
    expect(result.skipped).toContainEqual({ path: 'huge.bpmn', reason: 'too-large' })
  })

  it('skips non-bpmn files with reason not-bpmn', () => {
    const files = [{ relPath: 'notes.txt', xml: 'hello' }]
    // buildLibraryZip is typed around {relPath, xml} so reuse it for a non-bpmn entry.
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: 'notes.txt', reason: 'not-bpmn' }])
  })

  it('throws when total accepted size exceeds 50MB', () => {
    const chunk = 'x'.repeat(5 * 1024 * 1024) // exactly at per-entry cap
    const files = Array.from({ length: 11 }, (_, i) => ({
      relPath: `f${i}.bpmn`,
      xml: chunk,
    }))

    const zip = buildLibraryZip(files)
    expect(() => readLibraryZip(zip)).toThrow(/Library too large/)
  })
})

describe('zipFileName', () => {
  it('slugifies the root name and formats the date deterministically', () => {
    const date = new Date(2026, 6, 23) // 2026-07-23 (local, month is 0-indexed)
    expect(zipFileName('My Process Library', date)).toBe('process-library-My-Process-Library-2026-07-23.zip')
  })

  it('strips characters outside letters/numbers/._- after replacing spaces', () => {
    const date = new Date(2024, 0, 5)
    expect(zipFileName('  Root: Name! (v2)  ', date)).toBe('process-library-Root-Name-v2-2024-01-05.zip')
  })

  it('falls back to "workspace" for an empty/whitespace-only name', () => {
    const date = new Date(2024, 0, 5)
    expect(zipFileName('   ', date)).toBe('process-library-workspace-2024-01-05.zip')
  })

  it('is deterministic for a fixed injected Date', () => {
    const date = new Date(2025, 11, 1)
    const first = zipFileName('workspace', date)
    const second = zipFileName('workspace', date)
    expect(first).toBe(second)
    expect(first).toBe('process-library-workspace-2025-12-01.zip')
  })
})
