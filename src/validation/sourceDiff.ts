export interface XmlLineDiffSummary {
  originalLines: number
  candidateLines: number
  changedLines: number
  removedLines: number
  addedLines: number
  firstChangedLine?: number
}

export type XmlLineDiffKind = 'context' | 'added' | 'removed'

export interface XmlLineDiffLine {
  kind: XmlLineDiffKind
  content: string
  originalLine?: number
  candidateLine?: number
}

export interface XmlLineDiffHunk {
  originalStart: number
  originalLines: number
  candidateStart: number
  candidateLines: number
  lines: XmlLineDiffLine[]
}

export interface XmlLineDiffOmitted {
  originalChars: number
  candidateChars: number
  originalLines: number
  candidateLines: number
  operations: number
  previewRows: number
  previewChars: number
  hunks: number
}

export interface XmlLineDiff extends XmlLineDiffSummary {
  hunks: XmlLineDiffHunk[]
  /** False when a bounded prefix/suffix replacement was used instead of LCS. */
  aligned: boolean
  /** True when any input, operation, or rendered-preview detail was omitted. */
  truncated: boolean
  omitted: XmlLineDiffOmitted
}

/**
 * Hard ceilings for source-diff work and output. Callers may request smaller
 * limits for a particular surface, but options never expand these ceilings.
 */
export const DEFAULT_XML_LINE_DIFF_BUDGETS = Object.freeze({
  maxInputChars: 8_000_000,
  maxLines: 20_000,
  maxMatrixCells: 1_000_000,
  maxOperations: 5_000,
  maxPreviewRows: 400,
  maxPreviewChars: 65_536,
  maxHunks: 50,
  maxContextLines: 20
})

export interface XmlLineDiffOptions {
  /** Unchanged lines shown on each side of a changed block. */
  contextLines?: number
  /** Per-input character ceiling for detailed line splitting. */
  maxInputChars?: number
  /** Per-input line ceiling for detailed line splitting. */
  maxLines?: number
  /** Upper bound for the LCS matrix. Larger documents use a linear fallback. */
  maxMatrixCells?: number
  /** Upper bound for internal diff-operation rows. */
  maxOperations?: number
  /** Upper bound for rows returned across all preview hunks. */
  maxPreviewRows?: number
  /** Upper bound for content characters returned across all preview rows. */
  maxPreviewChars?: number
  /** Upper bound for hunks returned to the renderer. */
  maxHunks?: number
}

interface DiffOperation extends XmlLineDiffLine {
  /** One-based cursor positions, including for an insertion/removal. */
  originalCursor: number
  candidateCursor: number
}

interface SourceStats {
  lines: number
  contentChars: number
}

interface PlannedHunk {
  originalStart: number
  originalLines: number
  candidateStart: number
  candidateLines: number
  operations: DiffOperation[]
}

interface DiffPlan {
  hunks: PlannedHunk[]
  totalHunks: number
  totalRows: number
  totalChars: number
  logicalOperations: number
  materializedOperations: number
}

interface ResolvedOptions {
  contextLines: number
  maxInputChars: number
  maxLines: number
  maxMatrixCells: number
  maxOperations: number
  maxPreviewRows: number
  maxPreviewChars: number
  maxHunks: number
}

const ZERO_OMISSIONS: Readonly<XmlLineDiffOmitted> = Object.freeze({
  originalChars: 0,
  candidateChars: 0,
  originalLines: 0,
  candidateLines: 0,
  operations: 0,
  previewRows: 0,
  previewChars: 0,
  hunks: 0
})

function boundedInteger(value: number | undefined, ceiling: number): number {
  if (value === undefined || !Number.isFinite(value)) return ceiling
  return Math.max(0, Math.min(ceiling, Math.floor(value)))
}

function resolveOptions(options: XmlLineDiffOptions): ResolvedOptions {
  return {
    contextLines:
      options.contextLines === undefined || !Number.isFinite(options.contextLines)
        ? 3
        : Math.max(
            0,
            Math.min(
              DEFAULT_XML_LINE_DIFF_BUDGETS.maxContextLines,
              Math.floor(options.contextLines)
            )
          ),
    maxInputChars: boundedInteger(
      options.maxInputChars,
      DEFAULT_XML_LINE_DIFF_BUDGETS.maxInputChars
    ),
    maxLines: boundedInteger(options.maxLines, DEFAULT_XML_LINE_DIFF_BUDGETS.maxLines),
    maxMatrixCells: boundedInteger(
      options.maxMatrixCells,
      DEFAULT_XML_LINE_DIFF_BUDGETS.maxMatrixCells
    ),
    maxOperations: boundedInteger(
      options.maxOperations,
      DEFAULT_XML_LINE_DIFF_BUDGETS.maxOperations
    ),
    maxPreviewRows: boundedInteger(
      options.maxPreviewRows,
      DEFAULT_XML_LINE_DIFF_BUDGETS.maxPreviewRows
    ),
    maxPreviewChars: boundedInteger(
      options.maxPreviewChars,
      DEFAULT_XML_LINE_DIFF_BUDGETS.maxPreviewChars
    ),
    maxHunks: boundedInteger(options.maxHunks, DEFAULT_XML_LINE_DIFF_BUDGETS.maxHunks)
  }
}

function codePointWidthAt(value: string, index: number, end = value.length): 1 | 2 {
  const first = value.charCodeAt(index)
  const second = index + 1 < end ? value.charCodeAt(index + 1) : 0
  return first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? 2 : 1
}

function codePointLength(value: string): number {
  let count = 0
  for (let index = 0; index < value.length; index += codePointWidthAt(value, index)) {
    count += 1
  }
  return count
}

function boundedCodePointSlice(
  value: string,
  start: number,
  end: number,
  maximumCodePoints: number
): { content: string; codePoints: number } {
  let index = start
  let codePoints = 0
  while (index < end && codePoints < maximumCodePoints) {
    index += codePointWidthAt(value, index, end)
    codePoints += 1
  }
  return {
    content: value.slice(start, index),
    codePoints
  }
}

/** Count normalized lines without allocating a line array. */
function sourceStats(xml: string): SourceStats {
  if (xml === '') return { lines: 0, contentChars: 0 }

  let breaks = 0
  let contentChars = 0
  for (let index = 0; index < xml.length; index += 1) {
    const code = xml.charCodeAt(index)
    if (code === 13) {
      breaks += 1
      if (xml.charCodeAt(index + 1) === 10) index += 1
    } else if (code === 10) {
      breaks += 1
    } else {
      contentChars += 1
      index += codePointWidthAt(xml, index) - 1
    }
  }
  return { lines: breaks + 1, contentChars }
}

function splitLines(xml: string): string[] {
  return xml === '' ? [] : xml.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * Give each distinct bounded line a numeric id before LCS. The quadratic loop
 * then compares integers instead of repeatedly comparing attacker-sized
 * near-equal strings.
 */
function indexLines(
  before: readonly string[],
  after: readonly string[]
): { beforeIds: Uint32Array; afterIds: Uint32Array } {
  const ids = new Map<string, number>()
  let nextId = 1
  const encode = (line: string): number => {
    const known = ids.get(line)
    if (known !== undefined) return known
    const id = nextId
    nextId += 1
    ids.set(line, id)
    return id
  }
  return {
    beforeIds: Uint32Array.from(before, encode),
    afterIds: Uint32Array.from(after, encode)
  }
}

function alignedOperations(
  before: readonly string[],
  after: readonly string[],
  beforeIds: Uint32Array,
  afterIds: Uint32Array
): DiffOperation[] {
  const width = after.length + 1
  const matrix = new Uint32Array((before.length + 1) * width)
  for (let originalIndex = before.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let candidateIndex = after.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const offset = originalIndex * width + candidateIndex
      matrix[offset] =
        beforeIds[originalIndex] === afterIds[candidateIndex]
          ? matrix[(originalIndex + 1) * width + candidateIndex + 1] + 1
          : Math.max(
              matrix[(originalIndex + 1) * width + candidateIndex],
              matrix[originalIndex * width + candidateIndex + 1]
            )
    }
  }

  const operations: DiffOperation[] = []
  let originalIndex = 0
  let candidateIndex = 0
  while (originalIndex < before.length || candidateIndex < after.length) {
    const originalCursor = originalIndex + 1
    const candidateCursor = candidateIndex + 1
    if (
      originalIndex < before.length &&
      candidateIndex < after.length &&
      beforeIds[originalIndex] === afterIds[candidateIndex]
    ) {
      operations.push({
        kind: 'context',
        content: before[originalIndex],
        originalLine: originalCursor,
        candidateLine: candidateCursor,
        originalCursor,
        candidateCursor
      })
      originalIndex += 1
      candidateIndex += 1
      continue
    }
    const removeScore =
      originalIndex < before.length ? matrix[(originalIndex + 1) * width + candidateIndex] : -1
    const addScore =
      candidateIndex < after.length ? matrix[originalIndex * width + candidateIndex + 1] : -1
    if (originalIndex < before.length && removeScore >= addScore) {
      operations.push({
        kind: 'removed',
        content: before[originalIndex],
        originalLine: originalCursor,
        originalCursor,
        candidateCursor
      })
      originalIndex += 1
    } else {
      operations.push({
        kind: 'added',
        content: after[candidateIndex],
        candidateLine: candidateCursor,
        originalCursor,
        candidateCursor
      })
      candidateIndex += 1
    }
  }
  return operations
}

function operationLine(operation: DiffOperation, maximumChars: number): XmlLineDiffLine {
  const { content } = boundedCodePointSlice(
    operation.content,
    0,
    operation.content.length,
    maximumChars
  )
  return {
    kind: operation.kind,
    content,
    ...(operation.originalLine === undefined ? {} : { originalLine: operation.originalLine }),
    ...(operation.candidateLine === undefined ? {} : { candidateLine: operation.candidateLine })
  }
}

function planAlignedHunks(
  operations: readonly DiffOperation[],
  contextLines: number,
  maxHunks: number
): DiffPlan {
  const hunks: PlannedHunk[] = []
  let totalHunks = 0
  let totalRows = 0
  let totalChars = 0
  let activeStart = -1
  let activeEnd = -1

  const finishRange = (): void => {
    if (activeStart < 0) return
    totalHunks += 1
    totalRows += activeEnd - activeStart
    let originalLines = 0
    let candidateLines = 0
    for (let index = activeStart; index < activeEnd; index += 1) {
      const operation = operations[index]
      totalChars += codePointLength(operation.content)
      if (operation.kind !== 'added') originalLines += 1
      if (operation.kind !== 'removed') candidateLines += 1
    }
    if (hunks.length < maxHunks) {
      const first = operations[activeStart]
      hunks.push({
        originalStart: first.originalLine ?? first.originalCursor,
        originalLines,
        candidateStart: first.candidateLine ?? first.candidateCursor,
        candidateLines,
        operations: operations.slice(activeStart, activeEnd)
      })
    }
  }

  for (let index = 0; index < operations.length; index += 1) {
    if (operations[index].kind === 'context') continue
    const start = Math.max(0, index - contextLines)
    const end = Math.min(operations.length, index + contextLines + 1)
    if (activeStart >= 0 && start <= activeEnd) {
      activeEnd = Math.max(activeEnd, end)
    } else {
      finishRange()
      activeStart = start
      activeEnd = end
    }
  }
  finishRange()

  return {
    hunks,
    totalHunks,
    totalRows,
    totalChars,
    logicalOperations: operations.length,
    materializedOperations: operations.length
  }
}

function sumLineChars(lines: readonly string[], start: number, end: number): number {
  let total = 0
  for (let index = start; index < end; index += 1) total += codePointLength(lines[index])
  return total
}

function allocateChangedRows(
  removedLines: number,
  addedLines: number,
  capacity: number
): { removed: number; added: number } {
  let removed = Math.min(removedLines, Math.ceil(capacity / 2))
  let added = Math.min(addedLines, capacity - removed)
  removed += Math.min(removedLines - removed, capacity - removed - added)
  added += Math.min(addedLines - added, capacity - removed - added)
  return { removed, added }
}

function planFallbackFromLines(
  before: readonly string[],
  after: readonly string[],
  beforeIds: Uint32Array,
  afterIds: Uint32Array,
  options: ResolvedOptions
): {
  plan: DiffPlan
  removedLines: number
  addedLines: number
  firstChangedLine?: number
} {
  let prefix = 0
  while (
    prefix < before.length &&
    prefix < after.length &&
    beforeIds[prefix] === afterIds[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    beforeIds[before.length - suffix - 1] === afterIds[after.length - suffix - 1]
  ) {
    suffix += 1
  }

  const removedLines = before.length - prefix - suffix
  const addedLines = after.length - prefix - suffix
  if (removedLines === 0 && addedLines === 0) {
    return {
      plan: {
        hunks: [],
        totalHunks: 0,
        totalRows: 0,
        totalChars: 0,
        logicalOperations: 0,
        materializedOperations: 0
      },
      removedLines,
      addedLines
    }
  }

  const beforeContext = Math.min(prefix, options.contextLines)
  const afterContext = Math.min(suffix, options.contextLines)
  const totalRows = beforeContext + removedLines + addedLines + afterContext
  const totalChars =
    sumLineChars(before, prefix - beforeContext, before.length - suffix + afterContext) +
    sumLineChars(after, prefix, after.length - suffix)
  let capacity = options.maxOperations
  const beforeContextTake = Math.min(beforeContext, capacity)
  capacity -= beforeContextTake
  const afterContextTake = Math.min(afterContext, capacity)
  capacity -= afterContextTake
  const changedTake = allocateChangedRows(removedLines, addedLines, capacity)
  const operations: DiffOperation[] = []

  for (let index = prefix - beforeContextTake; index < prefix; index += 1) {
    operations.push({
      kind: 'context',
      content: before[index],
      originalLine: index + 1,
      candidateLine: index + 1,
      originalCursor: index + 1,
      candidateCursor: index + 1
    })
  }
  for (let offset = 0; offset < changedTake.removed; offset += 1) {
    const index = prefix + offset
    operations.push({
      kind: 'removed',
      content: before[index],
      originalLine: index + 1,
      originalCursor: index + 1,
      candidateCursor: prefix + 1
    })
  }
  for (let offset = 0; offset < changedTake.added; offset += 1) {
    const index = prefix + offset
    operations.push({
      kind: 'added',
      content: after[index],
      candidateLine: index + 1,
      originalCursor: before.length - suffix + 1,
      candidateCursor: index + 1
    })
  }
  for (let offset = 0; offset < afterContextTake; offset += 1) {
    const originalIndex = before.length - suffix + offset
    const candidateIndex = after.length - suffix + offset
    operations.push({
      kind: 'context',
      content: before[originalIndex],
      originalLine: originalIndex + 1,
      candidateLine: candidateIndex + 1,
      originalCursor: originalIndex + 1,
      candidateCursor: candidateIndex + 1
    })
  }

  return {
    plan: {
      hunks: [
        {
          originalStart: prefix - beforeContext + 1,
          originalLines: beforeContext + removedLines + afterContext,
          candidateStart: prefix - beforeContext + 1,
          candidateLines: beforeContext + addedLines + afterContext,
          operations
        }
      ],
      totalHunks: 1,
      totalRows,
      totalChars,
      logicalOperations: totalRows,
      materializedOperations: operations.length
    },
    removedLines,
    addedLines,
    firstChangedLine: prefix + 1
  }
}

function firstLineOperations(
  xml: string,
  count: number,
  kind: 'added' | 'removed',
  otherCursor: number,
  capture: { remainingChars: number }
): DiffOperation[] {
  const operations: DiffOperation[] = []
  let start = 0
  let line = 1

  while (line <= count) {
    let end = start
    while (end < xml.length) {
      const code = xml.charCodeAt(end)
      if (code === 10 || code === 13) break
      end += 1
    }
    const captured = boundedCodePointSlice(xml, start, end, capture.remainingChars)
    const content = captured.content
    capture.remainingChars -= captured.codePoints
    operations.push({
      kind,
      content,
      ...(kind === 'removed' ? { originalLine: line } : { candidateLine: line }),
      originalCursor: kind === 'removed' ? line : otherCursor,
      candidateCursor: kind === 'added' ? line : otherCursor
    })
    line += 1
    if (end >= xml.length) break
    start = end + (xml.charCodeAt(end) === 13 && xml.charCodeAt(end + 1) === 10 ? 2 : 1)
  }
  return operations
}

function planCoarseReplacement(
  originalXml: string,
  candidateXml: string,
  originalStats: SourceStats,
  candidateStats: SourceStats,
  options: ResolvedOptions
): DiffPlan {
  const totalRows = originalStats.lines + candidateStats.lines
  if (totalRows === 0) {
    return {
      hunks: [],
      totalHunks: 0,
      totalRows: 0,
      totalChars: 0,
      logicalOperations: 0,
      materializedOperations: 0
    }
  }
  const changedTake = allocateChangedRows(
    originalStats.lines,
    candidateStats.lines,
    options.maxOperations
  )
  const capture = { remainingChars: options.maxPreviewChars }
  const removed = firstLineOperations(originalXml, changedTake.removed, 'removed', 1, capture)
  const added = firstLineOperations(
    candidateXml,
    changedTake.added,
    'added',
    originalStats.lines + 1,
    capture
  )
  const operations = [...removed, ...added]
  return {
    hunks: [
      {
        originalStart: 1,
        originalLines: originalStats.lines,
        candidateStart: 1,
        candidateLines: candidateStats.lines,
        operations
      }
    ],
    totalHunks: 1,
    totalRows,
    totalChars: originalStats.contentChars + candidateStats.contentChars,
    logicalOperations: totalRows,
    materializedOperations: operations.length
  }
}

function renderPlan(
  plan: DiffPlan,
  options: ResolvedOptions
): {
  hunks: XmlLineDiffHunk[]
  displayedRows: number
  displayedChars: number
} {
  const hunks: XmlLineDiffHunk[] = []
  let displayedRows = 0
  let displayedChars = 0

  for (const planned of plan.hunks) {
    if (hunks.length >= options.maxHunks || displayedRows >= options.maxPreviewRows) break
    const lines: XmlLineDiffLine[] = []
    for (const operation of planned.operations) {
      if (displayedRows >= options.maxPreviewRows) break
      const remainingChars = options.maxPreviewChars - displayedChars
      const line = operationLine(operation, Math.max(0, remainingChars))
      displayedChars += codePointLength(line.content)
      displayedRows += 1
      lines.push(line)
    }
    if (lines.length > 0) {
      hunks.push({
        originalStart: planned.originalStart,
        originalLines: planned.originalLines,
        candidateStart: planned.candidateStart,
        candidateLines: planned.candidateLines,
        lines
      })
    }
  }
  return { hunks, displayedRows, displayedChars }
}

function hasOmissions(omitted: XmlLineDiffOmitted): boolean {
  return Object.values(omitted).some((count) => count > 0)
}

function unchangedDiff(lineCount: number): XmlLineDiff {
  return {
    originalLines: lineCount,
    candidateLines: lineCount,
    changedLines: 0,
    removedLines: 0,
    addedLines: 0,
    hunks: [],
    aligned: true,
    truncated: false,
    omitted: { ...ZERO_OMISSIONS }
  }
}

/**
 * A content-bearing line diff with hard work and output ceilings.
 *
 * Exact equality returns before line splitting. Detailed inputs use numeric-id
 * LCS alignment; over-budget inputs use a count-only, bounded replacement plan.
 * The caller's XML strings are never normalized in place or returned altered.
 */
export function diffXmlLines(
  originalXml: string,
  candidateXml: string,
  options: XmlLineDiffOptions = {}
): XmlLineDiff {
  if (originalXml === candidateXml) {
    return unchangedDiff(sourceStats(originalXml).lines)
  }

  const resolved = resolveOptions(options)
  const originalStats = sourceStats(originalXml)
  const candidateStats = sourceStats(candidateXml)
  const inputOmissions = {
    originalChars: Math.max(0, originalXml.length - resolved.maxInputChars),
    candidateChars: Math.max(0, candidateXml.length - resolved.maxInputChars),
    originalLines: Math.max(0, originalStats.lines - resolved.maxLines),
    candidateLines: Math.max(0, candidateStats.lines - resolved.maxLines)
  }
  const inputBoundExceeded = Object.values(inputOmissions).some((count) => count > 0)

  let aligned = false
  let plan: DiffPlan
  let removedLines: number
  let addedLines: number
  let firstChangedLine: number | undefined

  if (inputBoundExceeded) {
    plan = planCoarseReplacement(originalXml, candidateXml, originalStats, candidateStats, resolved)
    removedLines = originalStats.lines
    addedLines = candidateStats.lines
    firstChangedLine = removedLines > 0 || addedLines > 0 ? 1 : undefined
  } else {
    const before = splitLines(originalXml)
    const after = splitLines(candidateXml)
    const { beforeIds, afterIds } = indexLines(before, after)
    const matrixCells = (before.length + 1) * (after.length + 1)
    const operationUpperBound = before.length + after.length
    aligned =
      matrixCells <= resolved.maxMatrixCells && operationUpperBound <= resolved.maxOperations

    if (aligned) {
      const operations = alignedOperations(before, after, beforeIds, afterIds)
      removedLines = 0
      addedLines = 0
      for (const operation of operations) {
        if (operation.kind === 'removed') removedLines += 1
        if (operation.kind === 'added') addedLines += 1
        if (firstChangedLine === undefined && operation.kind !== 'context') {
          firstChangedLine = operation.originalLine ?? operation.originalCursor
        }
      }
      plan = planAlignedHunks(operations, resolved.contextLines, resolved.maxHunks)
    } else {
      const fallback = planFallbackFromLines(before, after, beforeIds, afterIds, resolved)
      plan = fallback.plan
      removedLines = fallback.removedLines
      addedLines = fallback.addedLines
      firstChangedLine = fallback.firstChangedLine
    }
  }

  const rendered = renderPlan(plan, resolved)
  const omitted: XmlLineDiffOmitted = {
    ...inputOmissions,
    operations: Math.max(0, plan.logicalOperations - plan.materializedOperations),
    previewRows: Math.max(0, plan.totalRows - rendered.displayedRows),
    previewChars: Math.max(0, plan.totalChars - rendered.displayedChars),
    hunks: Math.max(0, plan.totalHunks - rendered.hunks.length)
  }
  return {
    originalLines: originalStats.lines,
    candidateLines: candidateStats.lines,
    changedLines: Math.max(removedLines, addedLines),
    removedLines,
    addedLines,
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
    hunks: rendered.hunks,
    aligned,
    truncated: hasOmissions(omitted),
    omitted
  }
}

/**
 * Compatibility helper for count-only consumers.
 */
export function summarizeXmlLineDiff(
  originalXml: string,
  candidateXml: string
): XmlLineDiffSummary {
  const {
    originalLines,
    candidateLines,
    changedLines,
    removedLines,
    addedLines,
    firstChangedLine
  } = diffXmlLines(originalXml, candidateXml)
  return {
    originalLines,
    candidateLines,
    changedLines,
    removedLines,
    addedLines,
    ...(firstChangedLine === undefined ? {} : { firstChangedLine })
  }
}
