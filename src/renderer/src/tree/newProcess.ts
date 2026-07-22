import type { PromptText } from '../common'

/** Windows-safe slug from a display name (mirrors the main-process slugify). */
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'process'
  )
}

/**
 * Shared "New Process" flow used by BOTH the folder-tree context menu and the
 * File > New Process application-menu item, so the two never drift. Prompts for
 * a display name, then creates a `.bpmn` under `folderRelPath` (empty string =
 * workspace root). Returns the new file's relPath — the caller refreshes the
 * tree and opens it as a tab — or null if the user cancelled or creation failed
 * (a failure already surfaced an alert to the user).
 */
export async function promptNewProcess(
  folderRelPath: string,
  promptText: PromptText
): Promise<string | null> {
  const name = await promptText({
    title: 'New Process',
    label: 'Process name',
    initialValue: 'Untitled Process',
    okLabel: 'Create'
  })
  if (!name) return null

  const slug = slugify(name)
  const relPath = folderRelPath ? `${folderRelPath}/${slug}.bpmn` : `${slug}.bpmn`
  const processId = `Process_${slug.replace(/-/g, '_')}`
  const result = await window.orbitpm.workspace.createBpmnFile(relPath, processId, name)
  if (!result.ok) {
    window.alert(`Could not create process: ${result.error}`)
    return null
  }
  return relPath
}
