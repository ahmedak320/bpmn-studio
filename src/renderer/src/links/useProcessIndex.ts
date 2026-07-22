import { useCallback, useEffect, useRef, useState } from 'react'
import { buildProcessIndex, type ProcessIndex } from '../../../shared/processIndex'

// Files above this size are skipped when building the index (avoid reading
// huge blobs into memory just to regex-scan them for a <process id>; no
// legitimate .bpmn authored by hand or by this app's own layout step
// approaches this size).
const MAX_INDEXED_FILE_BYTES = 5 * 1024 * 1024

const DEBOUNCE_MS = 300

/** Flatten a TreeNode into a list of .bpmn file relPaths. */
function collectBpmnFiles(node: TreeNode | null, out: string[] = []): string[] {
  if (!node) return out
  if (node.type === 'file') {
    if (node.relPath.toLowerCase().endsWith('.bpmn')) out.push(node.relPath)
    return out
  }
  for (const child of node.children ?? []) collectBpmnFiles(child, out)
  return out
}

export interface UseProcessIndexResult {
  index: ProcessIndex
  loading: boolean
  /** Force an immediate (non-debounced) rebuild. */
  refresh: () => void
}

/**
 * Builds and maintains a processId -> file index for the current workspace
 * by walking the tree and reading every .bpmn file's content. Rebuilds
 * (debounced) whenever the workspace's onTreeChanged fires.
 */
export function useProcessIndex(workspace: WorkspaceApi | undefined | null): UseProcessIndexResult {
  const [index, setIndex] = useState<ProcessIndex>(() => new Map())
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)

  const rebuild = useCallback(async () => {
    if (!workspace) return
    const generation = ++generationRef.current
    setLoading(true)
    try {
      const treeResult = await workspace.listTree()
      if (!treeResult.ok || !treeResult.data) {
        if (generation === generationRef.current) setIndex(new Map())
        return
      }
      const relPaths = collectBpmnFiles(treeResult.data)
      const files: Array<{ relPath: string; xml: string }> = []
      for (const relPath of relPaths) {
        const fileResult = await workspace.readFile(relPath)
        if (!fileResult.ok || typeof fileResult.data !== 'string') continue
        if (fileResult.data.length > MAX_INDEXED_FILE_BYTES) continue
        files.push({ relPath, xml: fileResult.data })
      }
      if (generation === generationRef.current) {
        setIndex(buildProcessIndex(files))
      }
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [workspace])

  const refresh = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    void rebuild()
  }, [rebuild])

  const scheduleRebuild = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void rebuild()
    }, DEBOUNCE_MS)
  }, [rebuild])

  useEffect(() => {
    if (!workspace) return
    void rebuild()
    const unsubscribe = workspace.onTreeChanged(() => {
      scheduleRebuild()
    })
    return () => {
      unsubscribe()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])

  return { index, loading, refresh }
}
