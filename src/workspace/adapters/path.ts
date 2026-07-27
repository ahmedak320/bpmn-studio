import { WorkspaceOperationError } from './workspaceError'

export interface NormalizeWorkspacePathOptions {
  allowRoot?: boolean
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/

/**
 * Convert user/import paths to a single portable relative representation.
 *
 * Backslashes are treated as separators before traversal checks so a ZIP entry
 * such as `..\secret` cannot bypass the same guard on POSIX browsers.
 */
export function normalizeWorkspacePath(
  input: string,
  options: NormalizeWorkspacePathOptions = {}
): string {
  if (typeof input !== 'string') {
    throw invalidPath(String(input), 'Workspace paths must be strings.')
  }
  if (CONTROL_CHARACTERS.test(input)) {
    throw invalidPath(input, 'Workspace paths cannot contain control characters.')
  }
  if (input.startsWith('/') || input.startsWith('\\') || WINDOWS_ABSOLUTE.test(input)) {
    throw invalidPath(input, 'Workspace paths must be relative to the workspace root.')
  }

  const segments = input
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0)

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw invalidPath(input, 'Workspace paths cannot contain "." or ".." segments.')
    }
    if (segment.trim().length === 0) {
      throw invalidPath(input, 'Workspace path segments cannot be whitespace-only.')
    }
  }

  const normalized = segments.join('/')
  if (!normalized && !options.allowRoot) {
    throw invalidPath(input, 'A file or folder path cannot be empty.')
  }
  return normalized
}

export function workspacePathName(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  const separator = normalized.lastIndexOf('/')
  return separator < 0 ? normalized : normalized.slice(separator + 1)
}

export function workspaceParentPath(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  const separator = normalized.lastIndexOf('/')
  return separator < 0 ? '' : normalized.slice(0, separator)
}

export function joinWorkspacePath(parent: string, child: string): string {
  const normalizedParent = normalizeWorkspacePath(parent, { allowRoot: true })
  const normalizedChild = normalizeWorkspacePath(child)
  return normalizeWorkspacePath(
    normalizedParent ? `${normalizedParent}/${normalizedChild}` : normalizedChild
  )
}

export function isPathWithin(path: string, possibleAncestor: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path)
  const normalizedAncestor = normalizeWorkspacePath(possibleAncestor)
  return (
    normalizedPath === normalizedAncestor || normalizedPath.startsWith(`${normalizedAncestor}/`)
  )
}

function invalidPath(path: string, message: string): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'invalid-path',
    operation: 'open',
    path,
    message
  })
}
