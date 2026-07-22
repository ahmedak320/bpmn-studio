import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FolderTree, WorkspacePicker } from './tree'
import { EditorTab, type EditorTabCommands } from './editor'
import { AiPanel, collectFolders } from './ai'
import { SettingsModal, type SettingsHandlers, type SettingsStatus } from './settings'
import {
  useProcessIndex,
  SelectionLinkButton,
  listUnresolvedCalledElements,
  type SelectionLinkModeler
} from './links'

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

  // Cross-process linking: workspace-wide processId -> file index, and the
  // live bpmn-js modeler of whichever tab is active (for the call-activity
  // link button + the unresolved-link status-bar badge).
  const { index: processIndex } = useProcessIndex(window.orbitpm?.workspace ?? null)
  // Every mounted tab reports its live modeler instance here (keyed by
  // relPath) as it's created/destroyed; `activeModeler` below just looks up
  // whichever entry belongs to the currently-active tab. State (not a ref)
  // because SelectionLinkButton needs to re-render when it changes.
  const [modelersByPath, setModelersByPath] = useState<Record<string, unknown>>({})
  const activeModeler = (activeFile ? modelersByPath[activeFile] : null) as
    | SelectionLinkModeler
    | null
  // Native-menu command bus: every mounted tab reports its own imperative
  // save/export commands here (keyed by relPath); Save/Export menu items
  // just look up whichever entry belongs to the currently-active tab. A
  // ref (not state) since it never needs to trigger a re-render itself.
  const commandsByPathRef = useRef<Record<string, EditorTabCommands | null>>({})

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
      setModelersByPath(drop)
      delete commandsByPathRef.current[relPath]
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

  // Call-activity drill-down: resolve the double-clicked calledElement
  // (processId) to a workspace file via the process index and open it as a
  // tab. Unresolved (no such process indexed) -> explanatory alert; no
  // toast infra exists yet (see C2 report).
  const handleOpenCalledProcess = useCallback(
    (processId: string) => {
      const entry = processIndex.get(processId)
      if (entry) {
        handleOpenFile(entry.relPath)
        return
      }
      window.alert(
        `No process with id "${processId}" in this workspace — create it or link a different process.`
      )
    },
    [processIndex, handleOpenFile]
  )

  // Windows file-association / single-instance open-path: main pushes the
  // relPath once it has classified & (if needed) imported the file.
  useEffect(() => {
    const api = window.orbitpm
    if (!api?.openFile) return
    return api.openFile.onOpenFile(({ relPath }) => {
      void handleOpenFile(relPath)
    })
  }, [handleOpenFile])

  // Native application-menu round-trips (File menu items that need renderer
  // state). "Open Workspace Folder…" reuses the same picker as first-run.
  useEffect(() => {
    const api = window.orbitpm
    if (!api?.menu) return
    const unsubscribers = [
      api.menu.onAction(api.menu.channels.newProcess, () => setAiCollapsed(false)),
      api.menu.onAction(api.menu.channels.openWorkspaceFolder, () => void handleChooseRoot()),
      api.menu.onAction(api.menu.channels.save, () => {
        if (activeFile) commandsByPathRef.current[activeFile]?.save()
      }),
      api.menu.onAction(api.menu.channels.exportSvg, () => {
        if (activeFile) commandsByPathRef.current[activeFile]?.exportSvg()
      }),
      api.menu.onAction(api.menu.channels.exportPng, () => {
        if (activeFile) commandsByPathRef.current[activeFile]?.exportPng()
      })
    ]
    return () => unsubscribers.forEach((unsub) => unsub())
  }, [handleChooseRoot, activeFile])

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

  // Unresolved call-activity links in the currently active tab's in-memory
  // content (cheap single regex pass; re-checked whenever the active file,
  // its loaded content, or the process index changes).
  const unresolvedCount = useMemo(() => {
    if (!activeFile) return 0
    const content = fileContents[activeFile]
    if (!content) return 0
    return listUnresolvedCalledElements(content, processIndex).length
  }, [activeFile, fileContents, processIndex])

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
                      onCommandsReady={(commands) => {
                        commandsByPathRef.current[file.relPath] = commands
                      }}
                      onModelerReady={(modeler) => {
                        setModelersByPath((prev) => ({ ...prev, [file.relPath]: modeler }))
                      }}
                      toolbarExtra={
                        isActive ? (
                          <SelectionLinkButton modeler={activeModeler} index={processIndex} />
                        ) : null
                      }
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
        <span title={root} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {root}
          {unresolvedCount > 0 && (
            <span
              title="Call activities linked to a process id not found in this workspace"
              style={{
                padding: '0.1rem 0.5rem',
                borderRadius: 999,
                background: 'rgba(217,119,6,0.18)',
                color: '#d97706',
                fontWeight: 600
              }}
            >
              {unresolvedCount} unresolved link{unresolvedCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
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
