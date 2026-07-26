export interface XmlLineDiffSummary {
  originalLines: number
  candidateLines: number
  changedLines: number
  removedLines: number
  addedLines: number
  firstChangedLine?: number
}

function lines(xml: string): string[] {
  return xml === '' ? [] : xml.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * Bounded line-diff summary.
 *
 * We intentionally avoid an unbounded quadratic LCS calculation for large
 * imported XML. Equal prefixes/suffixes are stripped and the remaining block
 * is reported conservatively, which is enough for an apply preview.
 */
export function summarizeXmlLineDiff(
  originalXml: string,
  candidateXml: string
): XmlLineDiffSummary {
  const before = lines(originalXml)
  const after = lines(candidateXml)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1
  }

  const removedLines = Math.max(0, before.length - prefix - suffix)
  const addedLines = Math.max(0, after.length - prefix - suffix)
  return {
    originalLines: before.length,
    candidateLines: after.length,
    changedLines: Math.max(removedLines, addedLines),
    removedLines,
    addedLines,
    ...(removedLines > 0 || addedLines > 0 ? { firstChangedLine: prefix + 1 } : {})
  }
}
