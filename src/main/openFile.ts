// Resolves .bpmn "open with" requests: the file path Windows hands us on
// first launch (process.argv) or on a relaunch caught by the single-instance
// lock ('second-instance' argv). If the path is inside the current
// workspace root, we tell the renderer to open it as a tab; if it's outside,
// we offer to import (copy) it into the workspace root first.
//
// The path-normalization + inside/outside classification below is pure
// (only 'node:path') and exported for unit testing without booting
// Electron. The orchestration functions below that use `app`/`dialog`/fs
// and are exercised via `vi.mock('electron')` in tests, same convention as
// src/main/secrets.ts.

import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { OPEN_FILE_CHANNELS, type OpenFilePayload } from './openFileContract'
import { SettingsStore } from './workspace/settingsStore'

export { OPEN_FILE_CHANNELS }
export type { OpenFilePayload }

// --- pure logic (testable without Electron) -------------------------------

/** Strips a wrapping pair of quotes (some launchers pass quoted paths) and
 *  surrounding whitespace. Does not resolve/absolutize — see classify. */
export function normalizeArgPath(raw: string): string {
  const trimmed = raw.trim()
  const unquoted = trimmed.match(/^"(.*)"$/) ?? trimmed.match(/^'(.*)'$/)
  return unquoted ? unquoted[1] : trimmed
}

/** True if `p` has a case-insensitive .bpmn extension. */
export function isBpmnPath(p: string): boolean {
  return extname(p).toLowerCase() === '.bpmn'
}

/** Scans argv (excluding argv[0], the exe/electron-binary itself) for the
 *  first plausible .bpmn file-open argument, ignoring CLI flags. Returns
 *  the raw (un-normalized) argv entry, or null if none found. */
export function findBpmnArg(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (isBpmnPath(normalizeArgPath(arg))) return arg
  }
  return null
}

export type OpenFileClassification =
  | { kind: 'not-bpmn' }
  | { kind: 'no-root' }
  | { kind: 'inside'; relPath: string }
  | { kind: 'outside'; absPath: string }

/** Classifies a raw file-open path against the (possibly unset) workspace
 *  root: not a .bpmn file at all, no workspace selected yet, inside the
 *  root (with its root-relative posix path), or outside the root (with its
 *  resolved absolute path, for the import-copy flow). */
export function classifyFilePath(root: string | null, rawPath: string): OpenFileClassification {
  const absPath = resolve(normalizeArgPath(rawPath))
  if (!isBpmnPath(absPath)) return { kind: 'not-bpmn' }
  if (!root) return { kind: 'no-root' }

  const rootAbs = resolve(root)
  const rel = relative(rootAbs, absPath)
  const isInside = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)

  if (isInside) {
    return { kind: 'inside', relPath: rel.split(sep).join('/') }
  }
  return { kind: 'outside', absPath }
}

/** Picks a non-colliding destination filename inside `root` for a copy-in
 *  import, suffixing "-2", "-3", ... before the extension on collision
 *  (same convention as the AI-generate save slug rule in src/gen). */
async function pickImportTarget(root: string, sourceAbsPath: string): Promise<string> {
  const name = basename(sourceAbsPath)
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot)

  let candidate = resolve(root, name)
  let n = 2
  while (await pathExists(candidate)) {
    candidate = resolve(root, `${stem}-${n}${ext}`)
    n++
  }
  return candidate
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

// --- orchestration (Electron-dependent) ------------------------------------

async function readWorkspaceRoot(): Promise<string | null> {
  const store = new SettingsStore(fsp, app.getPath('userData'))
  const settings = await store.read()
  return settings.root
}

function sendOpenFile(win: BrowserWindow | null, relPath: string): void {
  if (!win || win.isDestroyed()) return
  const payload: OpenFilePayload = { relPath }
  win.webContents.send(OPEN_FILE_CHANNELS.openFile, payload)
  if (win.isMinimized()) win.restore()
  win.focus()
}

/**
 * Resolves and acts on a single raw file-open path (already known to be a
 * plausible argv entry — callers should pre-filter with findBpmnArg, though
 * this also no-ops cleanly on a non-.bpmn path).
 */
export async function handleOpenFilePath(
  rawPath: string,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  const root = await readWorkspaceRoot()
  const classification = classifyFilePath(root, rawPath)

  switch (classification.kind) {
    case 'not-bpmn':
      return

    case 'inside':
      sendOpenFile(getWindow(), classification.relPath)
      return

    case 'no-root':
      await dialog.showMessageBox(getWindow() ?? undefined, {
        type: 'info',
        title: 'No Workspace Selected',
        message: 'Choose a processes folder first, then open this file again.',
        detail: normalizeArgPath(rawPath)
      })
      return

    case 'outside': {
      if (!root) return // classify() only returns 'outside' when root is set
      const choice = await dialog.showMessageBox(getWindow() ?? undefined, {
        type: 'question',
        title: 'Import File',
        message: `"${basename(classification.absPath)}" is outside your workspace folder.`,
        detail: 'Import a copy into your workspace to open it?',
        buttons: ['Import and Open', 'Cancel'],
        defaultId: 0,
        cancelId: 1
      })
      if (choice.response !== 0) return

      try {
        const target = await pickImportTarget(root, classification.absPath)
        await fsp.copyFile(classification.absPath, target)
        const relPath = relative(root, target).split(sep).join('/')
        sendOpenFile(getWindow(), relPath)
      } catch (err) {
        await dialog.showMessageBox(getWindow() ?? undefined, {
          type: 'error',
          title: 'Import Failed',
          message: 'Could not import the file into your workspace.',
          detail: err instanceof Error ? err.message : String(err)
        })
      }
      return
    }
  }
}

/** Scans argv for a .bpmn open request and handles it, if present.
 *  Fire-and-forget-safe: swallows/logs errors so a bad argv never crashes
 *  app startup or a second-instance relaunch. */
export function findAndHandleOpenFileArgs(argv: string[], getWindow: () => BrowserWindow | null): void {
  const found = findBpmnArg(argv)
  if (!found) return
  handleOpenFilePath(found, getWindow).catch((err) => {
    console.error('[openFile] failed to handle open-file argv:', err)
  })
}
