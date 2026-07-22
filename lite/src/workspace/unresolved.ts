// Pure aggregation of every unresolved call-activity link across the whole
// workspace — the data behind the footer badge's panel (source process →
// missing calledElement, with per-row create-now / open-source actions). Built
// on the shared per-file linter so the definition of "unresolved" is identical
// to the editor's inline badge. No React/DOM: unit-tested in plain node.

import {
  parseProcessesFromXml,
  listUnresolvedCalledElements
} from '@app/shared/processIndex'
import type { ProcessIndex } from '@app/shared/processIndex'
import { baseOf } from '../fs/fsAccess'

export interface WorkspaceUnresolvedLink {
  /** File that CONTAINS the dangling call activity. */
  sourceRelPath: string
  sourceFileName: string
  /** Best-effort display name of the source file's (first) process. */
  sourceProcessName?: string
  /** The call activity's own element id, if the XML carried one. */
  elementId?: string
  /** The calledElement value that resolves to no process in the workspace. */
  calledElement: string
}

/**
 * Scan every file for call activities whose `calledElement` doesn't resolve to
 * any process id in the index. Returns a flat, stably-sorted list (by source
 * file, then by calledElement) — one entry per dangling link.
 */
export function collectWorkspaceUnresolved(
  files: Array<{ relPath: string; xml: string }>,
  index: ProcessIndex
): WorkspaceUnresolvedLink[] {
  const out: WorkspaceUnresolvedLink[] = []
  for (const file of files) {
    const unresolved = listUnresolvedCalledElements(file.xml, index)
    if (unresolved.length === 0) continue
    const firstProcess = parseProcessesFromXml(file.xml, file.relPath)[0]
    const sourceFileName = baseOf(file.relPath)
    for (const link of unresolved) {
      out.push({
        sourceRelPath: file.relPath,
        sourceFileName,
        sourceProcessName: firstProcess?.processName,
        elementId: link.elementId,
        calledElement: link.calledElement
      })
    }
  }
  return out.sort((a, b) => {
    const f = a.sourceRelPath.localeCompare(b.sourceRelPath, undefined, { sensitivity: 'base' })
    if (f !== 0) return f
    return a.calledElement.localeCompare(b.calledElement, undefined, { sensitivity: 'base' })
  })
}
