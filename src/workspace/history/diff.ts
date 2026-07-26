import type { HistoryDiff, HistoryDiffHunk } from './types'

const MAX_LCS_CELLS = 1_000_000

type Edit =
  | { kind: 'equal'; value: string }
  | { kind: 'remove'; value: string }
  | { kind: 'add'; value: string }

function lines(value: string): string[] {
  if (!value) return []
  return value.replace(/\r\n?/g, '\n').split('\n')
}

function coarseEdits(oldLines: string[], newLines: string[]): Edit[] {
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return [
    ...oldLines.slice(0, prefix).map((value): Edit => ({ kind: 'equal', value })),
    ...oldLines
      .slice(prefix, oldLines.length - suffix)
      .map((value): Edit => ({ kind: 'remove', value })),
    ...newLines
      .slice(prefix, newLines.length - suffix)
      .map((value): Edit => ({ kind: 'add', value })),
    ...oldLines.slice(oldLines.length - suffix).map((value): Edit => ({ kind: 'equal', value }))
  ]
}

function lcsEdits(oldLines: string[], newLines: string[]): Edit[] {
  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    return coarseEdits(oldLines, newLines)
  }
  const width = newLines.length + 1
  const table = new Uint32Array((oldLines.length + 1) * width)
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const offset = oldIndex * width + newIndex
      table[offset] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(
              table[(oldIndex + 1) * width + newIndex],
              table[oldIndex * width + newIndex + 1]
            )
    }
  }

  const edits: Edit[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      edits.push({ kind: 'equal', value: oldLines[oldIndex] })
      oldIndex += 1
      newIndex += 1
    } else if (table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1]) {
      edits.push({ kind: 'remove', value: oldLines[oldIndex] })
      oldIndex += 1
    } else {
      edits.push({ kind: 'add', value: newLines[newIndex] })
      newIndex += 1
    }
  }
  while (oldIndex < oldLines.length) {
    edits.push({ kind: 'remove', value: oldLines[oldIndex++] })
  }
  while (newIndex < newLines.length) {
    edits.push({ kind: 'add', value: newLines[newIndex++] })
  }
  return edits
}

function hunks(edits: Edit[]): HistoryDiffHunk[] {
  const result: HistoryDiffHunk[] = []
  let oldLine = 1
  let newLine = 1
  let current: HistoryDiffHunk | undefined
  const finish = (): void => {
    if (current) result.push(current)
    current = undefined
  }

  for (const edit of edits) {
    if (edit.kind === 'equal') {
      finish()
      oldLine += 1
      newLine += 1
      continue
    }
    current ??= {
      oldStart: oldLine,
      oldLines: 0,
      newStart: newLine,
      newLines: 0,
      removed: [],
      added: []
    }
    if (edit.kind === 'remove') {
      current.removed.push(edit.value)
      current.oldLines += 1
      oldLine += 1
    } else {
      current.added.push(edit.value)
      current.newLines += 1
      newLine += 1
    }
  }
  finish()
  return result
}

export function diffXml(oldXml: string, newXml: string): HistoryDiff {
  const oldLines = lines(oldXml)
  const newLines = lines(newXml)
  const edits = lcsEdits(oldLines, newLines)
  const changed = hunks(edits)
  return {
    identical: changed.length === 0,
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    hunks: changed
  }
}
