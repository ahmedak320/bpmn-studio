import { describe, expect, it } from 'vitest'
import { createValidationSummary, validationIssue } from '../contracts'
import { serializeValidationReport } from '../report'
import { summarizeXmlLineDiff } from '../sourceDiff'

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
})
