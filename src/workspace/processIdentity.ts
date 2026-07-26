import { validateBpmnXml } from '../validation'
import { equalHash, sha256Hex } from './adapters/hash'
import { normalizeWorkspacePath } from './adapters/path'
import type {
  WorkspaceAdapter,
  WorkspaceProcessIdentityInspector,
  WorkspaceProcessIdentitySnapshotEntry
} from './adapters/types'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function isReservedOrbitPmPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path, { allowRoot: true })
  const first = normalized.split('/')[0] ?? ''
  return first.toLocaleLowerCase('en-US') === '.orbitpm'
}

export function assertNonReservedImportPath(path: string, label: string): void {
  if (isReservedOrbitPmPath(path)) {
    throw new Error(`${label} cannot target the reserved ".orbitpm" workspace namespace.`)
  }
}

function processIdsFromDefinitions(definitions: unknown): readonly string[] {
  const roots =
    (definitions as { rootElements?: Array<{ $type?: string; id?: string }> } | undefined)
      ?.rootElements ?? []
  return Object.freeze(
    [
      ...new Set(
        roots
          .filter((root) => root.$type === 'bpmn:Process')
          .map((root) => root.id?.trim() ?? '')
          .filter(Boolean)
      )
    ].sort((left, right) => left.localeCompare(right, 'en'))
  )
}

export const secureWorkspaceProcessIdentityInspector: WorkspaceProcessIdentityInspector =
  async (xml, signal) => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const parsed = await validateBpmnXml(xml, {
      requireBilingual: false,
      requireDi: false
    })
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (!parsed.summary.xmlWellFormed || !parsed.definitions) {
      throw new Error('A workspace BPMN file could not be securely parsed for process identity.')
    }
    return Object.freeze({ processIds: processIdsFromDefinitions(parsed.definitions) })
  }

export function normalizeProcessIdentitySnapshot(
  processIndex: ReadonlyMap<string, { readonly relPath: string }> | undefined,
  processIds: ReadonlySet<string> | undefined = undefined
): readonly WorkspaceProcessIdentitySnapshotEntry[] {
  const entries = new Map<string, string | null>()
  for (const processId of processIds ?? []) {
    const id = processId.trim()
    if (id) entries.set(id, null)
  }
  for (const [processIdInput, entry] of processIndex ?? []) {
    const processId = processIdInput.trim()
    if (!processId) throw new Error('Workspace process identity cannot be empty.')
    entries.set(processId, normalizeWorkspacePath(entry.relPath).normalize('NFC'))
  }
  return Object.freeze(
    [...entries]
      .map(([processId, path]) => Object.freeze({ processId, path }))
      .sort(
        (left, right) =>
          left.processId.localeCompare(right.processId, 'en') ||
          String(left.path).localeCompare(String(right.path), 'en')
      )
  )
}

export async function digestProcessIdentitySnapshot(
  entries: readonly WorkspaceProcessIdentitySnapshotEntry[]
): Promise<string> {
  return sha256Hex(encoder.encode(JSON.stringify(entries)))
}

export async function scanWorkspaceProcessIdentities(
  adapter: WorkspaceAdapter,
  options: {
    readonly inspector?: WorkspaceProcessIdentityInspector
    readonly signal?: AbortSignal
  } = {}
): Promise<readonly WorkspaceProcessIdentitySnapshotEntry[]> {
  const inspector = options.inspector ?? secureWorkspaceProcessIdentityInspector
  const listed = await adapter.list()
  const files = listed
    .filter(
      (entry) =>
        entry.kind === 'file' &&
        /\.bpmn$/i.test(entry.path) &&
        !isReservedOrbitPmPath(entry.path)
    )
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const byId = new Map<string, string>()
  for (const entry of files) {
    if (!entry.readable) {
      throw new Error(`Workspace identity file "${entry.path}" is unreadable.`)
    }
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    const snapshot = await adapter.read(entry.path)
    if (!equalHash(await sha256Hex(snapshot.bytes), snapshot.hash)) {
      throw new Error(`Workspace identity file "${entry.path}" failed checksum verification.`)
    }
    let xml: string
    try {
      xml = decoder.decode(snapshot.bytes)
    } catch {
      throw new Error(`Workspace identity file "${entry.path}" is not valid UTF-8.`)
    }
    const inspected = await inspector(xml, options.signal)
    const normalizedPath = normalizeWorkspacePath(entry.path)
    for (const idInput of inspected.processIds) {
      const processId = idInput.trim()
      if (!processId) throw new Error(`Workspace file "${entry.path}" has an empty process id.`)
      const previous = byId.get(processId)
      if (previous && previous !== normalizedPath) {
        throw new Error(
          `Process id "${processId}" is duplicated by "${previous}" and "${normalizedPath}".`
        )
      }
      byId.set(processId, normalizedPath)
    }
  }
  return normalizeProcessIdentitySnapshot(
    new Map([...byId].map(([processId, relPath]) => [processId, { relPath }]))
  )
}
