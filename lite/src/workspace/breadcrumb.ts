// Pure breadcrumb helper: turn the active process's file path into the folder
// trail shown above the editor (Workspace / Sales / Onboarding). No React/DOM,
// so it's unit-tested in plain node.

import { segments, dirOf } from '../fs/fsAccess'

export interface Crumb {
  label: string
  /** Folder relPath this crumb represents ('' for the workspace root). */
  relPath: string
}

/**
 * Folder crumbs for a file relPath, from the workspace root down to (but NOT
 * including) the file itself. `rootLabel` names the first crumb (the opened
 * folder). A file at the root yields just the root crumb.
 *
 *   folderCrumbs('Sales/Onboarding/hire.bpmn', 'Workspace')
 *     → [{root ''}, {Sales 'Sales'}, {Onboarding 'Sales/Onboarding'}]
 */
export function folderCrumbs(fileRelPath: string, rootLabel: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: rootLabel, relPath: '' }]
  const folder = dirOf(fileRelPath)
  let acc = ''
  for (const seg of segments(folder)) {
    acc = acc ? `${acc}/${seg}` : seg
    crumbs.push({ label: seg, relPath: acc })
  }
  return crumbs
}
