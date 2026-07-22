// Pure, dependency-free path guard: resolves a user-supplied relative path
// against a workspace root and rejects anything that would escape it
// (`../` traversal, absolute paths outside the root, etc).
//
// Kept free of Electron/Node fs imports beyond `node:path` so it is directly
// unit-testable outside Electron.

import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathGuardError'
  }
}

/**
 * Resolves `relPath` against `root` and throws PathGuardError if the
 * resolved path is not equal to, or nested inside, `root`.
 *
 * Accepts either a relative path (`sub/dir/file.bpmn`) or an absolute path
 * that is already inside the root (useful when round-tripping paths handed
 * back to us by the renderer). Rejects:
 *  - `..`-based traversal that escapes the root
 *  - absolute paths outside the root
 *  - the empty string is treated as "the root itself"
 */
export function resolveWithinRoot(root: string, relPath: string): string {
  const resolvedRoot = resolve(root)
  const candidate = isAbsolute(relPath) ? resolve(relPath) : resolve(resolvedRoot, relPath)

  const rel = relative(resolvedRoot, candidate)

  // relative() returns a path starting with '..' (or an absolute path on
  // Windows if on a different drive) when `candidate` is outside `root`.
  const escapesRoot = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)

  if (escapesRoot) {
    throw new PathGuardError(`Path escapes workspace root: ${relPath}`)
  }

  return candidate === resolvedRoot ? resolvedRoot : join(resolvedRoot, rel)
}

/**
 * Note on symlinks: resolveWithinRoot only validates the *lexical* path
 * (string-level `..` / prefix checks) — it does not resolve symlinks on
 * disk (that would require an fs call, breaking purity/testability here).
 * A symlink created *inside* the workspace root that points *outside* of it
 * would pass this guard's string check yet allow escaping the sandbox when
 * the OS follows the link. Callers performing real fs I/O should additionally
 * use `fs.realpath`/`fs.realpathSync` on the resolved path and re-validate
 * the real path is within `root` before reading/writing through a symlink.
 */
