import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FolderTree, WorkspacePicker } from './tree'
import { EditorTab } from './editor'
import { AiPanel, collectFolders } from './ai'
import { SettingsModal, type SettingsHandlers, type SettingsStatus } from './settings'

interface OpenFile {
  relPath: string
}

function baseName(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
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

  // Per-file editor state.
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({})
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, boolean>>({})
  const [mounted, setMounted] = useState<Set<string>>(() => new Set())
  const fileContentsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    fileContentsRef.current = fileContents
  }, [fileContents])

  // UI chrome state.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiCollapsed, setAiCollapsed] = useState(false)
  const [providersRefreshToken, setProvidersRefreshToken] = useState(0)

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

  // Mark a tab as mounted once it first becomes active, so switching away and
  // back preserves the live bpmn-js modeler (and its undo history) instead of
  // remounting and losing unsaved work.
  useEffect(() => {
    if (!activeFile) return
    setMounted((prev) => (prev.has(activeFile) ? prev : new Set(prev).add(activeFile)))
  }, [activeFile])

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

  const handleOpenFile = useCallback(async (relPath: string) => {
    setOpenFiles((prev) => (prev.some((f) => f.relPath === relPath) ? prev : [...prev, { relPath }]))
    setActiveFile(relPath)
    if (fileContentsRef.current[relPath] !== undefined) return
    setFileErrors((prev) => {
      if (!(relPath in prev)) return prev
      const next = { ...prev }
      delete next[relPath]
      return next
    })
    const res = await window.orbitpm.workspace.readFile(relPath)
    if (res.ok) {
      setFileContents((prev) => ({ ...prev, [relPath]: res.data ?? '' }))
    } else {
      setFileErrors((prev) => ({ ...prev, [relPath]: res.error ?? 'Could not read file.' }))
    }
  }, [])

  const handleCloseTab = useCallback(
    (relPath: string) => {
      if (dirtyByPath[relPath]) {
        const confirmed = window.confirm(`Discard unsaved changes to ${baseName(relPath)}?`)
        if (!confirmed) return
      }
      setActiveFile((prev) => {
        if (prev !== relPath) return prev
        const remaining = openFiles.filter((f) => f.relPath !== relPath)
        return remaining.length > 0 ? remaining[remaining.length - 1].relPath : null
      })
      setOpenFiles((prev) => prev.filter((f) => f.relPath !== relPath))
      const drop = <T,>(obj: Record<string, T>): Record<string, T> => {
        if (!(relPath in obj)) return obj
        const next = { ...obj }
        delete next[relPath]
        return next
      }
      setFileContents(drop)
      setFileErrors(drop)
      setDirtyByPath(drop)
      setMounted((prev) => {
        if (!prev.has(relPath)) return prev
        const next = new Set(prev)
        next.delete(relPath)
        return next
      })
    },
    [dirtyByPath, openFiles]
  )

  const handleDirtyChange = useCallback((relPath: string, dirty: boolean) => {
    setDirtyByPath((prev) => (prev[relPath] === dirty ? prev : { ...prev, [relPath]: dirty }))
  }, [])

  // Persist a save. Note: we deliberately do NOT feed the saved XML back into
  // `fileContents` (which is the EditorTab `xml` prop) — doing so would trigger
  // a re-import and reset the editor. EditorTab clears its own dirty flag on a
  // successful save.
  const handleRequestSave = useCallback(async (relPath: string, xml: string) => {
    const res = await window.orbitpm.workspace.writeFile(relPath, xml)
    if (!res.ok) throw new Error(res.error ?? 'Could not write file.')
  }, [])

  // TODO(C4 + C2): resolve a call-activity's calledElement (processId) to a
  // workspace file via the process index (src/shared/processIndex.ts +
  // src/renderer/src/links/useProcessIndex) and call handleOpenFile(relPath).
  // C2 owns the resolver; this is the wiring slot. Until stitched, drill-down
  // is a no-op beyond a console hint.
  const handleOpenCalledProcess = useCallback((processId: string) => {
    // eslint-disable-next-line no-console
    console.info('[orbitpm] call-activity drill-down requested for process id:', processId)
  }, [])

  // TODO(C4 + C3): subscribe here to a main->renderer "open this .bpmn path"
  // event (Windows file-association / single-instance second-instance args)
  // exposed via a new preload namespace, and call handleOpenFile(relPath).
  // C3 provides the main-side sender + preload snippet as a patch.

  const settingsHandlers: SettingsHandlers = useMemo(
    () => ({
      onGetStatus: () => window.orbitpm.settings.getStatus() as Promise<SettingsStatus>,
      onGetKeys: (providerId) => window.orbitpm.settings.getKeys(providerId),
      onSetKey: (providerId, fields) => window.orbitpm.settings.setKey(providerId, fields),
      onDeleteKey: (providerId) => window.orbitpm.settings.deleteKey(providerId),
      onTestConnection: (providerId, modelId) =>
        window.orbitpm.ai.testConnection(providerId, modelId)
    }),
    []
  )

  const folders = useMemo(() => collectFolders(tree), [tree])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    // Newly-added keys may change which providers are available in the AI panel.
    setProvidersRefreshToken((t) => t + 1)
  }, [])

  if (rootLoading) {
    return <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>Loading workspace…</div>
  }

  if (!root) {
    return (
      <div style={{ height: '100vh', fontFamily: 'sans-serif' }}>
        <WorkspacePicker onChoose={handleChooseRoot} busy={chooseBusy} error={chooseError} />
        <SettingsModal open={settingsOpen} onClose={closeSettings} {...settingsHandlers} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        height: '100vh',
        fontFamily: 'sans-serif'
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.35rem 0.8rem',
          borderBottom: '1px solid rgba(127,127,127,0.25)'
        }}
      >
        <strong style={{ fontSize: 13 }}>OrbitPM Process Studio</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          {aiCollapsed && (
            <button type="button" style={chromeButton} onClick={() => setAiCollapsed(false)}>
              ✨ AI
            </button>
          )}
          <button type="button" style={chromeButton} onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </button>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr auto',
          minHeight: 0
        }}
      >
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
              overflowX: 'auto',
              flex: '0 0 auto'
            }}
          >
            {openFiles.map((file) => {
              const isActive = activeFile === file.relPath
              const isDirtyTab = dirtyByPath[file.relPath]
              return (
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
                    borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
                    opacity: isActive ? 1 : 0.65
                  }}
                >
                  <span>
                    {isDirtyTab ? '● ' : ''}
                    {baseName(file.relPath)}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseTab(file.relPath)
                    }}
                    title="Close"
                    style={{ opacity: 0.5 }}
                  >
                    ×
                  </span>
                </div>
              )
            })}
          </div>

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            {openFiles.length === 0 && (
              <div style={{ padding: '1.5rem', opacity: 0.5 }}>
                Select a .bpmn file from the tree to open it, or generate one with AI.
              </div>
            )}
            {openFiles.map((file) => {
              const isActive = activeFile === file.relPath
              if (!isActive && !mounted.has(file.relPath)) return null
              const content = fileContents[file.relPath]
              const err = fileErrors[file.relPath]
              return (
                <div
                  key={file.relPath}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: isActive ? 'flex' : 'none',
                    flexDirection: 'column',
                    minHeight: 0
                  }}
                >
                  {err ? (
                    <div style={{ padding: '1.5rem', color: '#c4322f' }}>{err}</div>
                  ) : content === undefined ? (
                    <div style={{ padding: '1.5rem', opacity: 0.6 }}>Loading diagram…</div>
                  ) : (
                    <EditorTab
                      xml={content}
                      onDirtyChange={(dirty) => handleDirtyChange(file.relPath, dirty)}
                      onRequestSave={(xml) => handleRequestSave(file.relPath, xml)}
                      onOpenCalledProcess={handleOpenCalledProcess}
                      exportFileBaseName={baseName(file.relPath).replace(/\.bpmn$/i, '')}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <AiPanel
          folders={folders}
          onOpenFile={handleOpenFile}
          onGenerated={() => refreshTree()}
          onOpenSettings={() => setSettingsOpen(true)}
          collapsed={aiCollapsed}
          onToggle={() => setAiCollapsed((c) => !c)}
          refreshToken={providersRefreshToken}
        />
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

      <SettingsModal open={settingsOpen} onClose={closeSettings} {...settingsHandlers} />
    </div>
  )
}

const chromeButton: CSSProperties = {
  padding: '0.3rem 0.6rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer'
}

export default App
