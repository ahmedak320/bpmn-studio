// chokidar-based watcher on the workspace root. Debounces bursts of fs
// events (e.g. an editor save = unlink+add, or an external sync tool
// touching many files) into a single 'tree-changed' callback.

import { watch, type FSWatcher } from 'chokidar'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git'])

function isIgnored(path: string): boolean {
  const segments = path.split(/[\\/]/)
  return segments.some((seg) => IGNORED_DIR_NAMES.has(seg) || (seg.startsWith('.') && seg !== '.'))
}

export interface WorkspaceWatcher {
  close(): Promise<void>
}

export function watchWorkspace(
  root: string,
  onTreeChanged: () => void,
  debounceMs = 300
): WorkspaceWatcher {
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleNotify = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onTreeChanged()
    }, debounceMs)
  }

  const fsWatcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (path: string) => isIgnored(path)
  })

  fsWatcher.on('all', () => scheduleNotify())

  return {
    async close(): Promise<void> {
      if (timer) clearTimeout(timer)
      await fsWatcher.close()
    }
  }
}
