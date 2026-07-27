import { DEFAULT_XML_LINE_DIFF_BUDGETS, diffXmlLines } from '../../validation/sourceDiff'
import type { HistoryDiff } from './types'

/**
 * History previews share the source editor's hard CPU, allocation, and output
 * ceilings. Context is disabled because this surface renders only changed
 * revision/current lines.
 */
export const HISTORY_DIFF_BUDGETS = Object.freeze({
  maxInputChars: DEFAULT_XML_LINE_DIFF_BUDGETS.maxInputChars,
  maxLines: DEFAULT_XML_LINE_DIFF_BUDGETS.maxLines,
  maxMatrixCells: DEFAULT_XML_LINE_DIFF_BUDGETS.maxMatrixCells,
  maxOperations: DEFAULT_XML_LINE_DIFF_BUDGETS.maxOperations,
  maxPreviewRows: DEFAULT_XML_LINE_DIFF_BUDGETS.maxPreviewRows,
  maxPreviewChars: DEFAULT_XML_LINE_DIFF_BUDGETS.maxPreviewChars,
  maxHunks: DEFAULT_XML_LINE_DIFF_BUDGETS.maxHunks
})

export function diffXml(oldXml: string, newXml: string): HistoryDiff {
  const bounded = diffXmlLines(oldXml, newXml, { contextLines: 0 })
  return {
    identical: bounded.changedLines === 0,
    oldLineCount: bounded.originalLines,
    newLineCount: bounded.candidateLines,
    hunks: bounded.hunks.map((hunk) => ({
      oldStart: hunk.originalStart,
      oldLines: hunk.originalLines,
      newStart: hunk.candidateStart,
      newLines: hunk.candidateLines,
      removed: hunk.lines.filter((line) => line.kind === 'removed').map((line) => line.content),
      added: hunk.lines.filter((line) => line.kind === 'added').map((line) => line.content)
    })),
    aligned: bounded.aligned,
    truncated: bounded.truncated,
    omitted: {
      oldInputCharacters: bounded.omitted.originalChars,
      newInputCharacters: bounded.omitted.candidateChars,
      oldInputLines: bounded.omitted.originalLines,
      newInputLines: bounded.omitted.candidateLines,
      operations: bounded.omitted.operations,
      previewRows: bounded.omitted.previewRows,
      previewCharacters: bounded.omitted.previewChars,
      hunks: bounded.omitted.hunks
    }
  }
}
