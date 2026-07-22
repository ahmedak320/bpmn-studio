import { useCallback, useEffect, useState } from 'react'
import { FolderTree, WorkspacePicker } from './tree'

interface OpenFile {
  relPath: string
}

function App(): JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  const [rootLoading, setRootLoading] = useState(true)
  const [chooseError, setChooseError] = useState<string | null>(null)
  const [chooseBusy, setChooseBusy] = useState(false)
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [versions, setVersions] = useState<string>('')

  const refreshTree = useCallback(async () => {
    const result = await window.orbitpm.workspace.listTree()
    if (result.ok && result.data) setTree(result.data)
  }, [])

  useEffect(() => {
    const api = window.orbitpm
    if (api) {
      setVersions(
        `electron ${api.versions.electron} · chrome ${api.versions.chrome} · node ${api.versions.node}`
      )
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await window.orbitpm.workspace.getRoot()
      if (cancelled) return
      if (result.ok) setRoot(result.data ?? null)
      setRootLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!root) return
    refreshTree()
    const unsubscribe = window.orbitpm.workspace.onTreeChanged(() => {
      refreshTree()
    })
    return unsubscribe
  }, [root, refreshTree])

  const handleChooseRoot = useCallback(async () => {
    setChooseBusy(true)
    setChooseError(null)
    const result = await window.orbitpm.workspace.chooseRoot()
    setChooseBusy(false)
    if (!result.ok) {
      setChooseError(result.error ?? 'Could not choose a folder.')
      return
    }
    if (result.data) setRoot(result.data)
  }, [])

  const handleOpenFile = useCallback((relPath: string) => {
    setOpenFiles((prev) => (prev.some((f) => f.relPath === relPath) ? prev : [...prev, { relPath }]))
    setActiveFile(relPath)
  }, [])

  const handleCloseTab = useCallback(
    (relPath: string) => {
      setOpenFiles((prev) => prev.filter((f) => f.relPath !== relPath))
      setActiveFile((prev) => {
        if (prev !== relPath) return prev
        const remaining = openFiles.filter((f) => f.relPath !== relPath)
        return remaining.length > 0 ? remaining[remaining.length - 1].relPath : null
      })
    },
    [openFiles]
  )

  if (rootLoading) {
    return <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>Loading workspace…</div>
  }

  if (!root) {
    return (
      <div style={{ height: '100vh', fontFamily: 'sans-serif' }}>
        <WorkspacePicker onChoose={handleChooseRoot} busy={chooseBusy} error={chooseError} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '1fr auto',
        height: '100vh',
        fontFamily: 'sans-serif'
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 0 }}>
        <aside
          style={{
            borderRight: '1px solid rgba(127,127,127,0.25)',
            overflowY: 'auto',
            padding: '0.5rem 0'
          }}
        >
          <FolderTree root={tree} onOpenFile={handleOpenFile} onRefresh={refreshTree} />
        </aside>

        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid rgba(127,127,127,0.25)',
              overflowX: 'auto'
            }}
          >
            {openFiles.map((file) => (
              <div
                key={file.relPath}
                onClick={() => setActiveFile(file.relPath)}
                style={{
                  padding: '0.5rem 0.9rem',
                  fontSize: 13,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderBottom:
                    activeFile === file.relPath ? '2px solid #2563eb' : '2px solid transparent',
                  opacity: activeFile === file.relPath ? 1 : 0.65
                }}
              >
                <span>{file.relPath.split('/').pop()}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(file.relPath)
                  }}
                  style={{ opacity: 0.5 }}
                >
                  ×
                </span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
            {activeFile ? (
              <p style={{ opacity: 0.75 }}>
                open: <code>{activeFile}</code>
                <br />
                <span style={{ fontSize: 12 }}>
                  (the BPMN editor lands in another lane this wave — this is a placeholder)
                </span>
              </p>
            ) : (
              <p style={{ opacity: 0.5 }}>Select a .bpmn file from the tree to open it.</p>
            )}
          </div>
        </section>
      </div>

      <footer
        style={{
          borderTop: '1px solid rgba(127,127,127,0.25)',
          padding: '0.3rem 0.8rem',
          fontSize: 12,
          opacity: 0.65,
          display: 'flex',
          justifyContent: 'space-between'
        }}
      >
        <span title={root}>{root}</span>
        <span>{versions}</span>
      </footer>
    </div>
  )
}

export default App
