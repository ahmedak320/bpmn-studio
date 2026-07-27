import { describe, expect, it } from 'vitest'
import { HISTORY_DIFF_BUDGETS, diffXml } from './diff'

function returnedRows(result: ReturnType<typeof diffXml>): number {
  return result.hunks.reduce((total, hunk) => total + hunk.removed.length + hunk.added.length, 0)
}

function returnedCharacters(result: ReturnType<typeof diffXml>): number {
  return result.hunks.reduce(
    (total, hunk) =>
      total +
      hunk.removed.reduce((sum, line) => sum + line.length, 0) +
      hunk.added.reduce((sum, line) => sum + line.length, 0),
    0
  )
}

describe('bounded history XML diff', () => {
  it('keeps ordinary diffs exact', () => {
    const result = diffXml('a\nb\nc', 'a\nx\nc\nd')

    expect(result).toMatchObject({
      identical: false,
      oldLineCount: 3,
      newLineCount: 4,
      aligned: true,
      truncated: false,
      omitted: {
        oldInputCharacters: 0,
        newInputCharacters: 0,
        oldInputLines: 0,
        newInputLines: 0,
        operations: 0,
        previewRows: 0,
        previewCharacters: 0,
        hunks: 0
      }
    })
    expect(result.hunks).toEqual([
      {
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 1,
        removed: ['b'],
        added: ['x']
      },
      {
        oldStart: 4,
        oldLines: 0,
        newStart: 4,
        newLines: 1,
        removed: [],
        added: ['d']
      }
    ])
  })

  it('short-circuits an unchanged newline bomb without materializing line or DOM rows', () => {
    const newlineCount = HISTORY_DIFF_BUDGETS.maxLines * 20
    const unchanged = '\n'.repeat(newlineCount)
    const result = diffXml(unchanged, unchanged)

    expect(result).toMatchObject({
      identical: true,
      oldLineCount: newlineCount + 1,
      newLineCount: newlineCount + 1,
      aligned: true,
      truncated: false,
      hunks: []
    })
    expect(returnedRows(result)).toBe(0)
    expect(returnedCharacters(result)).toBe(0)
  })

  it('bounds work and output for huge all-changed documents', () => {
    const lineCount = HISTORY_DIFF_BUDGETS.maxLines + 10_000
    const oldXml = Array.from({ length: lineCount }, (_, index) => `old-${index}`).join('\n')
    const newXml = Array.from({ length: lineCount }, (_, index) => `new-${index}`).join('\n')
    const result = diffXml(oldXml, newXml)

    expect(result).toMatchObject({
      identical: false,
      oldLineCount: lineCount,
      newLineCount: lineCount,
      aligned: false,
      truncated: true
    })
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: lineCount,
      newStart: 1,
      newLines: lineCount
    })
    expect(result.omitted.oldInputLines).toBe(lineCount - HISTORY_DIFF_BUDGETS.maxLines)
    expect(result.omitted.newInputLines).toBe(lineCount - HISTORY_DIFF_BUDGETS.maxLines)
    expect(result.omitted.operations).toBeGreaterThan(0)
    expect(result.omitted.previewRows).toBeGreaterThan(0)
    expect(returnedRows(result)).toBeLessThanOrEqual(HISTORY_DIFF_BUDGETS.maxPreviewRows)
    expect(returnedCharacters(result)).toBeLessThanOrEqual(HISTORY_DIFF_BUDGETS.maxPreviewChars)
  })

  it('caps returned text for many attacker-sized near-equal lines', () => {
    const sharedPrefix = 'x'.repeat(24_000)
    const oldXml = Array.from(
      { length: 96 },
      (_, index) => `${sharedPrefix}:old:${index.toString().padStart(3, '0')}`
    ).join('\n')
    const newXml = Array.from(
      { length: 96 },
      (_, index) => `${sharedPrefix}:new:${index.toString().padStart(3, '0')}`
    ).join('\n')
    const result = diffXml(oldXml, newXml)

    expect(result.aligned).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.omitted.previewCharacters).toBeGreaterThan(0)
    expect(returnedRows(result)).toBeLessThanOrEqual(HISTORY_DIFF_BUDGETS.maxPreviewRows)
    expect(returnedCharacters(result)).toBe(HISTORY_DIFF_BUDGETS.maxPreviewChars)
  })

  it('caps separated change hunks as well as rendered rows', () => {
    const oldXml = Array.from({ length: 240 }, (_, index) =>
      index % 2 === 0 ? `keep-${index}` : `old-${index}`
    ).join('\n')
    const newXml = Array.from({ length: 240 }, (_, index) =>
      index % 2 === 0 ? `keep-${index}` : `new-${index}`
    ).join('\n')
    const result = diffXml(oldXml, newXml)

    expect(result.truncated).toBe(true)
    expect(result.hunks).toHaveLength(HISTORY_DIFF_BUDGETS.maxHunks)
    expect(result.omitted.hunks).toBeGreaterThan(0)
    expect(result.omitted.previewRows).toBeGreaterThan(0)
    expect(returnedRows(result)).toBeLessThanOrEqual(HISTORY_DIFF_BUDGETS.maxPreviewRows)
  })
})
