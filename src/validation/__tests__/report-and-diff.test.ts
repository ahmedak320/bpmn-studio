import { describe, expect, it, vi } from 'vitest'
import { createValidationSummary, validationIssue } from '../contracts'
import { serializeValidationReport } from '../report'
import { DEFAULT_XML_LINE_DIFF_BUDGETS, diffXmlLines, summarizeXmlLineDiff } from '../sourceDiff'

describe('validation reports and source previews', () => {
  it('serializes a deterministic report without volatile timestamps', () => {
    const summary = createValidationSummary([
      validationIssue({
        code: 'semantic.disconnected-node',
        severity: 'error',
        source: 'semantic',
        message: 'Task is disconnected.',
        elementId: 'Task_1'
      })
    ])

    const first = serializeValidationReport(summary, 'review.bpmn')
    const second = serializeValidationReport(summary, 'review.bpmn')

    expect(first).toBe(second)
    expect(first).toContain('"format": "orbitpm-validation-report"')
    expect(first).toContain('"documentName": "review.bpmn"')
    expect(first).not.toMatch(/generatedAt|timestamp/i)
  })

  it('summarizes a bounded changed block with a one-based location', () => {
    expect(
      summarizeXmlLineDiff(
        ['<definitions>', '  <process id="a"/>', '</definitions>'].join('\n'),
        [
          '<definitions>',
          '  <process id="a">',
          '    <startEvent id="s"/>',
          '  </process>',
          '</definitions>'
        ].join('\n')
      )
    ).toEqual({
      originalLines: 3,
      candidateLines: 5,
      changedLines: 3,
      removedLines: 1,
      addedLines: 3,
      firstChangedLine: 2
    })
  })

  it('reports no source change across CRLF/LF normalization', () => {
    expect(summarizeXmlLineDiff('<a>\r\n</a>', '<a>\n</a>').changedLines).toBe(0)
  })

  it('returns separated content-bearing hunks instead of a counts-only preview', () => {
    const diff = diffXmlLines(
      [
        '<definitions>',
        '  <task id="a"/>',
        '  <task id="b"/>',
        '  <task id="c"/>',
        '</definitions>'
      ].join('\n'),
      [
        '<definitions>',
        '  <task id="a" name="Changed A"/>',
        '  <task id="b"/>',
        '  <task id="c" name="Changed C"/>',
        '</definitions>'
      ].join('\n'),
      { contextLines: 0 }
    )

    expect(diff.aligned).toBe(true)
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks.flatMap((hunk) => hunk.lines)).toEqual([
      {
        kind: 'removed',
        content: '  <task id="a"/>',
        originalLine: 2
      },
      {
        kind: 'added',
        content: '  <task id="a" name="Changed A"/>',
        candidateLine: 2
      },
      {
        kind: 'removed',
        content: '  <task id="c"/>',
        originalLine: 4
      },
      {
        kind: 'added',
        content: '  <task id="c" name="Changed C"/>',
        candidateLine: 4
      }
    ])
  })

  it('uses a linear full-content replacement when the alignment bound is exceeded', () => {
    const diff = diffXmlLines('same\nold one\nold two\ntail', 'same\nnew one\nnew two\ntail', {
      contextLines: 0,
      maxMatrixCells: 1
    })

    expect(diff.aligned).toBe(false)
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.lines.map((line) => [line.kind, line.content])).toEqual([
      ['removed', 'old one'],
      ['removed', 'old two'],
      ['added', 'new one'],
      ['added', 'new two']
    ])
  })

  it('takes the exact-string fast path without splitting an unchanged newline bomb', () => {
    const xml = ' \n'.repeat(DEFAULT_XML_LINE_DIFF_BUDGETS.maxLines + 1)
    const split = vi.spyOn(String.prototype, 'split')

    try {
      const diff = diffXmlLines(xml, xml)

      expect(split).not.toHaveBeenCalled()
      expect(diff).toMatchObject({
        originalLines: DEFAULT_XML_LINE_DIFF_BUDGETS.maxLines + 2,
        candidateLines: DEFAULT_XML_LINE_DIFF_BUDGETS.maxLines + 2,
        changedLines: 0,
        hunks: [],
        aligned: true,
        truncated: false
      })
      expect(diff.omitted).toEqual({
        originalChars: 0,
        candidateChars: 0,
        originalLines: 0,
        candidateLines: 0,
        operations: 0,
        previewRows: 0,
        previewChars: 0,
        hunks: 0
      })
    } finally {
      split.mockRestore()
    }
  })

  it('bounds operations and rendered content for an all-changed fallback', () => {
    const originalXml = Array.from({ length: 6_000 }, (_, index) => `old-${index}`).join('\n')
    const candidateXml = Array.from({ length: 6_000 }, (_, index) => `new-${index}`).join('\n')
    const originalSnapshot = originalXml
    const candidateSnapshot = candidateXml

    const diff = diffXmlLines(originalXml, candidateXml, {
      contextLines: 0,
      maxOperations: 100,
      maxPreviewRows: 20,
      maxPreviewChars: 120,
      maxHunks: 1
    })
    const rows = diff.hunks.flatMap((hunk) => hunk.lines)

    expect(diff.aligned).toBe(false)
    expect(diff.removedLines).toBe(6_000)
    expect(diff.addedLines).toBe(6_000)
    expect(diff.hunks.length).toBeLessThanOrEqual(1)
    expect(rows.length).toBeLessThanOrEqual(20)
    expect(rows.reduce((total, line) => total + line.content.length, 0)).toBeLessThanOrEqual(120)
    expect(diff.omitted.operations).toBe(11_900)
    expect(diff.omitted.previewRows).toBe(11_980)
    expect(diff.omitted.previewChars).toBeGreaterThan(0)
    expect(diff.truncated).toBe(true)
    expect(originalXml).toBe(originalSnapshot)
    expect(candidateXml).toBe(candidateSnapshot)
  })

  it('uses the operation ceiling when a one-side-tiny matrix would otherwise fit', () => {
    const originalXml = Array.from({ length: 6_000 }, (_, index) => `line-${index}`).join('\n')
    const diff = diffXmlLines(originalXml, 'replacement', {
      contextLines: 0,
      maxPreviewRows: 8
    })

    expect((6_000 + 1) * 2).toBeLessThan(DEFAULT_XML_LINE_DIFF_BUDGETS.maxMatrixCells)
    expect(diff.aligned).toBe(false)
    expect(diff.removedLines).toBe(6_000)
    expect(diff.addedLines).toBe(1)
    expect(diff.hunks.flatMap((hunk) => hunk.lines)).toHaveLength(8)
    expect(diff.omitted.operations).toBe(1_001)
    expect(diff.truncated).toBe(true)
  })

  it('bounds hunk, row, and character output for changed long single lines', () => {
    const originalXml = 'a'.repeat(2_000)
    const candidateXml = 'b'.repeat(2_000)
    const diff = diffXmlLines(originalXml, candidateXml, {
      maxInputChars: 1_000,
      maxOperations: 2,
      maxPreviewRows: 2,
      maxPreviewChars: 17,
      maxHunks: 1
    })
    const rows = diff.hunks.flatMap((hunk) => hunk.lines)

    expect(diff.hunks.length).toBeLessThanOrEqual(1)
    expect(rows.length).toBeLessThanOrEqual(2)
    expect(rows.reduce((total, line) => total + line.content.length, 0)).toBeLessThanOrEqual(17)
    expect(diff.omitted.originalChars).toBe(1_000)
    expect(diff.omitted.candidateChars).toBe(1_000)
    expect(diff.omitted.previewChars).toBe(3_983)
    expect(diff.truncated).toBe(true)
  })

  it('truncates aligned preview rows on Unicode code-point boundaries with exact counts', () => {
    const originalXml = '😀😀😀'
    const candidateXml = '😁😁😁'
    const diff = diffXmlLines(originalXml, candidateXml, {
      contextLines: 0,
      maxPreviewRows: 2,
      maxPreviewChars: 3
    })
    const rows = diff.hunks.flatMap((hunk) => hunk.lines)

    expect(diff.aligned).toBe(true)
    expect(rows.map((line) => line.content)).toEqual([originalXml, ''])
    expect(rows.reduce((total, line) => total + Array.from(line.content).length, 0)).toBe(3)
    expect(diff.omitted.previewChars).toBe(3)
    expect(diff.truncated).toBe(true)
  })

  it('captures coarse long-line previews without slicing a surrogate pair', () => {
    const originalXml = '😀😀😀'
    const candidateXml = '😁😁😁'
    const diff = diffXmlLines(originalXml, candidateXml, {
      contextLines: 0,
      maxInputChars: 1,
      maxOperations: 2,
      maxPreviewRows: 2,
      maxPreviewChars: 1
    })
    const rows = diff.hunks.flatMap((hunk) => hunk.lines)

    expect(diff.aligned).toBe(false)
    expect(rows.map((line) => line.content)).toEqual(['😀', ''])
    expect(rows.reduce((total, line) => total + Array.from(line.content).length, 0)).toBe(1)
    expect(diff.omitted.previewChars).toBe(5)
    expect(diff.truncated).toBe(true)
  })

  // V8 coverage instrumentation can push this adversarial ~14 MB fixture past
  // Vitest's default timeout on contended runners. Production work/output
  // ceilings remain asserted here; dedicated performance gates own latency.
  it('aligns long near-equal lines through bounded numeric ids', () => {
    const shared = 'x'.repeat(9_980)
    const originalXml = Array.from({ length: 700 }, (_, index) => `${shared}:${index}:before`).join(
      '\n'
    )
    const candidateXml = Array.from({ length: 700 }, (_, index) => `${shared}:${index}:after`).join(
      '\n'
    )

    const diff = diffXmlLines(originalXml, candidateXml, {
      contextLines: 0,
      maxPreviewRows: 4,
      maxPreviewChars: 64
    })

    expect(diff.aligned).toBe(true)
    expect(diff.removedLines).toBe(700)
    expect(diff.addedLines).toBe(700)
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.lines).toHaveLength(4)
    expect(
      diff.hunks[0]?.lines.reduce((total, line) => total + line.content.length, 0)
    ).toBeLessThanOrEqual(64)
    expect(diff.omitted.previewRows).toBe(1_396)
    expect(diff.omitted.previewChars).toBeGreaterThan(13_000_000)
  }, 15_000)
})
