import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// --- local ports of the two bpmn-js-touching React shells (they reuse all the
// desktop app's pure editor/link logic + CSS internally) ---
import { EditorTab, type EditorTabCommands } from './editor/EditorTabLite'
import { SelectionLinkButton, type SelectionLinkModeler } from './links/SelectionLinkButtonLite'
// --- reused, unchanged, by direct import from the desktop tree ---
import { createNewDiagramXml } from '@app/renderer/src/editor/newDiagram'
import { triggerDownload } from '@app/renderer/src/editor/exportImage'
import { usePromptText } from '@app/renderer/src/common'
import {
  buildProcessIndex,
  listUnresolvedCalledElements,
  type ProcessIndex
} from '@app/shared/processIndex'
import { slugify, dedupeSlug } from '@app/shared/slug'
// --- lite-local ---
import {
  buildTree,
  listBpmnFiles,
  readFileAt,
  writeFileAt,
  createFolderAt,
  createBpmnFileAt,
  deleteAt,
  renameAt,
  bpmnSlugsIn,
  type LiteTreeNode
} from './fs/fsAccess'
import {
  directoryPickerSupported,
  pickWorkspace,
  rememberWorkspace,
  loadRememberedWorkspace,
  forgetWorkspace,
  ensurePermission
} from './fs/workspaceHandle'
import { WorkspacePickerLite } from './workspace/WorkspacePickerLite'
import { FolderTreeLite } from './workspace/FolderTreeLite'
import { AiPanelLite, type FolderOptionLite } from './ai/AiPanelLite'
import { SettingsDialogLite } from './settings/SettingsDialogLite'
import { ICON_DATA_URI } from './branding/icon'

type Phase = 'loading' | 'need-open' | 'need-reconnect' | 'ready'
type Mode = 'directory' | 'fallback'

interface Tab {
  key: string
  title: string
  /** workspace-relative path in directory mode; null for a virtual/fallback tab. */
  relPath: string | null
}

function baseName(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function collectFolders(node: LiteTreeNode | null): FolderOptionLite[] {
  if (!node) return []
  const out: FolderOptionLite[] = []
  const walk = (n: LiteTreeNode, depth: number): void => {
    if (n.type !== 'directory') return
    out.push({
      relPath: n.relPath,
      label: n.relPath === '' ? '/ (workspace root)' : `${' '.repeat(depth * 2)}${n.name}`
    })
    for (const child of n.children ?? []) walk(child, depth + 1)
  }
  walk(node, 0)
  return out
}

function downloadBpmn(fileName: string, xml: string): void {
  triggerDownload(fileName, `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`)
}

function App(): JSX.Element {
  const promptText = usePromptText()
  const support = useMemo(() => directoryPickerSupported(), [])

  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<Mode>(support ? 'directory' : 'fallback')
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [rootName, setRootName] = useState<string>('')
  const rememberedRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [rememberedName, setRememberedName] = useState<string>('')
  const [pickBusy, setPickBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  const [tree, setTree] = useState<LiteTreeNode | null>(null)
  const [processIndex, setProcessIndex] = useState<ProcessIndex>(() => new Map())

  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [dirtyByKey, setDirtyByKey] = useState<Record<string, boolean>>({})
  const [mounted, setMounted] = useState<Set<string>>(() => new Set())
  const [modelersByKey, setModelersByKey] = useState<Record<string, unknown>>({})
  const commandsRef = useRef<Record<string, EditorTabCommands | null>>({})
  const virtualCounter = useRef(0)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiCollapsed, setAiCollapsed] = useState(false)
  const [keysVersion, setKeysVersion] = useState(0)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // --- workspace lifecycle -------------------------------------------------

  const refreshWorkspace = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const [nextTree, files] = await Promise.all([
      buildTree(handle, handle.name),
      listBpmnFiles(handle)
    ])
    setTree(nextTree)
    setProcessIndex(buildProcessIndex(files))
  }, [])

  const activateWorkspace = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      setRootHandle(handle)
      setRootName(handle.name)
      setMode('directory')
      setPhase('ready')
      try {
        await rememberWorkspace(handle)
      } catch {
        /* IDB may be unavailable; non-fatal */
      }
      await refreshWorkspace(handle)
    },
    [refreshWorkspace]
  )

  // First-load: fallback landing, remembered-folder reconnect, or fresh open.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!support) {
        setMode('fallback')
        setPhase('need-open')
        return
      }
      let handle: FileSystemDirectoryHandle | undefined
      try {
        handle = await loadRememberedWorkspace()
      } catch {
        handle = undefined
      }
      if (cancelled) return
      if (!handle) {
        setPhase('need-open')
        return
      }
      let state: PermissionState = 'prompt'
      try {
        state = await ensurePermission(handle, false)
      } catch {
        state = 'prompt'
      }
      if (cancelled) return
      if (state === 'granted') {
        await activateWorkspace(handle)
      } else {
        rememberedRef.current = handle
        setRememberedName(handle.name)
        setPhase('need-reconnect')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [support, activateWorkspace])

  const handleOpenFolder = useCallback(async () => {
    setPickBusy(true)
    setPickError(null)
    try {
      const handle = await pickWorkspace()
      if (!handle) return
      const state = await ensurePermission(handle, true)
      if (state !== 'granted') {
        setPickError('Permission to read/write the folder was not granted.')
        return
      }
      await activateWorkspace(handle)
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err))
    } finally {
      setPickBusy(false)
    }
  }, [activateWorkspace])

  const handleReconnect = useCallback(async () => {
    const handle = rememberedRef.current
    if (!handle) {
      setPhase('need-open')
      return
    }
    setPickBusy(true)
    setPickError(null)
    try {
      const state = await ensurePermission(handle, true)
      if (state !== 'granted') {
        setPickError('Permission was not granted. Try opening the folder again.')
        return
      }
      await activateWorkspace(handle)
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err))
    } finally {
      setPickBusy(false)
    }
  }, [activateWorkspace])

  const handleOpenDifferent = useCallback(async () => {
    await forgetWorkspace()
    rememberedRef.current = null
    await handleOpenFolder()
  }, [handleOpenFolder])

  // --- tabs ---------------------------------------------------------------

  const markMounted = useCallback((key: string) => {
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])

  useEffect(() => {
    if (activeKey) markMounted(activeKey)
  }, [activeKey, markMounted])

  const openDirectoryFile = useCallback(
    async (relPath: string) => {
      const key = relPath
      setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, title: baseName(relPath), relPath }]))
      setActiveKey(key)
      if (contents[key] !== undefined) return
      if (!rootHandle) return
      try {
        const xml = await readFileAt(rootHandle, relPath)
        setContents((prev) => ({ ...prev, [key]: xml }))
      } catch (err) {
        setContents((prev) => ({
          ...prev,
          [key]: ''
        }))
        window.alert(`Could not open ${relPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [contents, rootHandle]
  )

  const openVirtualTab = useCallback((title: string, xml: string) => {
    const key = `virtual:${++virtualCounter.current}`
    setTabs((prev) => [...prev, { key, title, relPath: null }])
    setContents((prev) => ({ ...prev, [key]: xml }))
    setActiveKey(key)
  }, [])

  const closeTabsUnder = useCallback((prefix: string) => {
    setTabs((prev) =>
      prev.filter((t) => !(t.relPath && (t.relPath === prefix || t.relPath.startsWith(prefix + '/'))))
    )
  }, [])

  const closeTab = useCallback(
    (key: string) => {
      if (dirtyByKey[key]) {
        const tab = tabs.find((t) => t.key === key)
        const confirmed = window.confirm(`Discard unsaved changes to ${tab?.title ?? 'this file'}?`)
        if (!confirmed) return
      }
      setActiveKey((prev) => {
        if (prev !== key) return prev
        const remaining = tabs.filter((t) => t.key !== key)
        return remaining.length > 0 ? remaining[remaining.length - 1].key : null
      })
      setTabs((prev) => prev.filter((t) => t.key !== key))
      const drop = <T,>(obj: Record<string, T>): Record<string, T> => {
        if (!(key in obj)) return obj
        const next = { ...obj }
        delete next[key]
        return next
      }
      setContents(drop)
      setDirtyByKey(drop)
      setModelersByKey(drop)
      delete commandsRef.current[key]
      setMounted((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    },
    [dirtyByKey, tabs]
  )

  const handleDirtyChange = useCallback((key: string, dirty: boolean) => {
    setDirtyByKey((prev) => (prev[key] === dirty ? prev : { ...prev, [key]: dirty }))
  }, [])

  const handleRequestSave = useCallback(
    async (tab: Tab, xml: string) => {
      if (tab.relPath && rootHandle) {
        await writeFileAt(rootHandle, tab.relPath, xml)
        await refreshWorkspace(rootHandle)
      } else {
        // Virtual / fallback tab: download-on-save.
        downloadBpmn(tab.title.endsWith('.bpmn') ? tab.title : `${tab.title}.bpmn`, xml)
      }
    },
    [rootHandle, refreshWorkspace]
  )

  const handleOpenCalledProcess = useCallback(
    (processId: string) => {
      const entry = processIndex.get(processId)
      if (entry) {
        void openDirectoryFile(entry.relPath)
        return
      }
      window.alert(
        `No process with id "${processId}" in this workspace — create it or link a different process.`
      )
    },
    [processIndex, openDirectoryFile]
  )

  // --- tree CRUD ----------------------------------------------------------

  const handleNewProcess = useCallback(
    async (folderRel: string) => {
      if (!rootHandle) return
      const name = await promptText({
        title: 'New Process',
        label: 'Process name',
        initialValue: 'New Process',
        okLabel: 'Create',
        hint: 'A .bpmn file will be created with a start event.'
      })
      if (!name) return
      const taken = await bpmnSlugsIn(rootHandle, folderRel)
      const slug = dedupeSlug(slugify(name), (c) => taken.has(c.toLowerCase()))
      try {
        const relPath = await createBpmnFileAt(rootHandle, folderRel, slug, createNewDiagramXml())
        await refreshWorkspace(rootHandle)
        void openDirectoryFile(relPath)
      } catch (err) {
        window.alert(`Could not create process: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [rootHandle, promptText, refreshWorkspace, openDirectoryFile]
  )

  const handleNewFolder = useCallback(
    async (folderRel: string) => {
      if (!rootHandle) return
      const name = await promptText({
        title: 'New Folder',
        label: 'Folder name',
        initialValue: 'New Folder',
        okLabel: 'Create'
      })
      if (!name) return
      try {
        await createFolderAt(rootHandle, folderRel, name.trim())
        await refreshWorkspace(rootHandle)
      } catch (err) {
        window.alert(`Could not create folder: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [rootHandle, promptText, refreshWorkspace]
  )

  const handleRename = useCallback(
    async (node: LiteTreeNode) => {
      if (!rootHandle) return
      const name = await promptText({
        title: 'Rename',
        label: 'New name',
        initialValue: node.name,
        okLabel: 'Rename'
      })
      if (!name || name === node.name) return
      try {
        await renameAt(rootHandle, node.relPath, name.trim(), node.type)
        closeTabsUnder(node.relPath)
        await refreshWorkspace(rootHandle)
      } catch (err) {
        window.alert(`Could not rename: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [rootHandle, promptText, refreshWorkspace, closeTabsUnder]
  )

  const handleDelete = useCallback(
    async (node: LiteTreeNode) => {
      if (!rootHandle) return
      const confirmed = window.confirm(`Delete "${node.name}"? This cannot be undone.`)
      if (!confirmed) return
      try {
        await deleteAt(rootHandle, node.relPath, node.type)
        closeTabsUnder(node.relPath)
        await refreshWorkspace(rootHandle)
      } catch (err) {
        window.alert(`Could not delete: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [rootHandle, refreshWorkspace, closeTabsUnder]
  )

  // --- fallback single-file open + new blank ------------------------------

  const openFileFromDisk = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // allow re-opening the same file
      if (!file) return
      const xml = await file.text()
      setMode('fallback')
      setPhase('ready')
      openVirtualTab(file.name, xml)
    },
    [openVirtualTab]
  )

  const startBlankDiagram = useCallback(() => {
    setMode('fallback')
    setPhase('ready')
    openVirtualTab('untitled.bpmn', createNewDiagramXml())
  }, [openVirtualTab])

  // --- AI placement -------------------------------------------------------

  const placeGenerated = useCallback(
    async (xml: string, opts: { name: string; targetFolder: string }) => {
      const slug = slugify(opts.name || 'process')
      if (mode === 'directory' && rootHandle) {
        const taken = await bpmnSlugsIn(rootHandle, opts.targetFolder)
        const finalSlug = dedupeSlug(slug, (c) => taken.has(c.toLowerCase()))
        const relPath = await createBpmnFileAt(rootHandle, opts.targetFolder, finalSlug, xml)
        await refreshWorkspace(rootHandle)
        void openDirectoryFile(relPath)
        return { label: relPath }
      }
      openVirtualTab(`${slug}.bpmn`, xml)
      return null
    },
    [mode, rootHandle, refreshWorkspace, openDirectoryFile, openVirtualTab]
  )

  // --- derived ------------------------------------------------------------

  const folders = useMemo(() => collectFolders(tree), [tree])
  const activeTab = tabs.find((t) => t.key === activeKey) ?? null
  const activeModeler = (activeKey ? modelersByKey[activeKey] : null) as SelectionLinkModeler | null

  const unresolvedCount = useMemo(() => {
    if (!activeKey) return 0
    const content = contents[activeKey]
    if (!content) return 0
    return listUnresolvedCalledElements(content, processIndex).length
  }, [activeKey, contents, processIndex])

  // --- render -------------------------------------------------------------

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".bpmn,application/xml,text/xml"
      style={{ display: 'none' }}
      onChange={(e) => void onFileInputChange(e)}
    />
  )

  if (phase === 'loading') {
    return <div style={{ padding: '2rem' }}>Loading…</div>
  }

  if (phase === 'need-open' || phase === 'need-reconnect') {
    return (
      <>
        {hiddenFileInput}
        <WorkspacePickerLite
          mode={phase === 'need-reconnect' ? 'reconnect' : mode === 'fallback' ? 'fallback' : 'open'}
          rememberedName={rememberedName}
          busy={pickBusy}
          error={pickError}
          onOpenFolder={phase === 'need-reconnect' ? handleReconnect : handleOpenFolder}
          onOpenDifferent={handleOpenDifferent}
          onOpenFile={openFileFromDisk}
          onNewDiagram={startBlankDiagram}
        />
        <SettingsDialogLite
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false)
            setKeysVersion((v) => v + 1)
          }}
          onKeysChanged={() => setKeysVersion((v) => v + 1)}
        />
      </>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100vh' }}>
      {hiddenFileInput}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.35rem 0.8rem',
          borderBottom: '1px solid var(--orbitpm-border)',
          gap: 12
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={ICON_DATA_URI} width={20} height={20} alt="" style={{ borderRadius: 5 }} />
          <strong style={{ fontSize: 13 }}>OrbitPM Process Studio Lite</strong>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {mode === 'directory' ? (
            <button className="orbitpm-lite-chrome-btn" onClick={() => void handleOpenDifferent()}>
              Change folder…
            </button>
          ) : (
            <button className="orbitpm-lite-chrome-btn" onClick={openFileFromDisk}>
              Open .bpmn…
            </button>
          )}
          {aiCollapsed && (
            <button className="orbitpm-lite-chrome-btn" onClick={() => setAiCollapsed(false)}>
              ✨ AI
            </button>
          )}
          <button className="orbitpm-lite-chrome-btn" onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr auto', minHeight: 0 }}>
        <aside
          style={{
            borderRight: '1px solid var(--orbitpm-border)',
            overflowY: 'auto',
            padding: '0.5rem 0'
          }}
        >
          {mode === 'directory' ? (
            <FolderTreeLite
              root={tree}
              activePath={activeTab?.relPath ?? null}
              onOpenFile={(rel) => void openDirectoryFile(rel)}
              onNewProcess={(f) => void handleNewProcess(f)}
              onNewFolder={(f) => void handleNewFolder(f)}
              onRename={(n) => void handleRename(n)}
              onDelete={(n) => void handleDelete(n)}
            />
          ) : (
            <div style={{ padding: '0.6rem 0.8rem', fontSize: 12.5, color: 'var(--orbitpm-muted)' }}>
              <p style={{ marginTop: 0 }}>
                Single-file mode — no folder is open. Saving downloads the <code>.bpmn</code> file.
              </p>
              <button
                className="orbitpm-lite-chrome-btn"
                style={{ width: '100%', marginBottom: 6 }}
                onClick={openFileFromDisk}
              >
                Open a .bpmn file…
              </button>
              <button
                className="orbitpm-lite-chrome-btn"
                style={{ width: '100%' }}
                onClick={startBlankDiagram}
              >
                New blank diagram
              </button>
            </div>
          )}
        </aside>

        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--orbitpm-border)',
              overflowX: 'auto',
              flex: '0 0 auto'
            }}
          >
            {tabs.map((tab) => {
              const isActive = activeKey === tab.key
              return (
                <div
                  key={tab.key}
                  onClick={() => setActiveKey(tab.key)}
                  style={{
                    padding: '0.5rem 0.9rem',
                    fontSize: 13,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: isActive
                      ? '2px solid var(--orbitpm-accent)'
                      : '2px solid transparent',
                    opacity: isActive ? 1 : 0.65
                  }}
                >
                  <span>
                    {dirtyByKey[tab.key] ? '● ' : ''}
                    {tab.title}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.key)
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
            {tabs.length === 0 && (
              <div style={{ padding: '1.5rem', opacity: 0.5 }}>
                {mode === 'directory'
                  ? 'Select a .bpmn file from the tree to open it, right-click a folder to create one, or generate one with AI.'
                  : 'Open a .bpmn file or start a new blank diagram.'}
              </div>
            )}
            {tabs.map((tab) => {
              const isActive = activeKey === tab.key
              if (!isActive && !mounted.has(tab.key)) return null
              const content = contents[tab.key]
              return (
                <div
                  key={tab.key}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: isActive ? 'flex' : 'none',
                    flexDirection: 'column',
                    minHeight: 0
                  }}
                >
                  {content === undefined ? (
                    <div style={{ padding: '1.5rem', opacity: 0.6 }}>Loading diagram…</div>
                  ) : (
                    <EditorTab
                      xml={content}
                      onDirtyChange={(dirty) => handleDirtyChange(tab.key, dirty)}
                      onRequestSave={(xml) => handleRequestSave(tab, xml)}
                      onOpenCalledProcess={handleOpenCalledProcess}
                      exportFileBaseName={tab.title.replace(/\.bpmn$/i, '')}
                      onCommandsReady={(commands) => {
                        commandsRef.current[tab.key] = commands
                      }}
                      onModelerReady={(modeler) => {
                        setModelersByKey((prev) => ({ ...prev, [tab.key]: modeler }))
                      }}
                      toolbarExtra={
                        isActive && mode === 'directory' ? (
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

        <AiPanelLite
          folders={folders}
          onPlaceGenerated={placeGenerated}
          onOpenSettings={() => setSettingsOpen(true)}
          collapsed={aiCollapsed}
          onToggle={() => setAiCollapsed((c) => !c)}
          keysVersion={keysVersion}
          mode={mode}
        />
      </div>

      <footer
        style={{
          borderTop: '1px solid var(--orbitpm-border)',
          padding: '0.3rem 0.8rem',
          fontSize: 12,
          color: 'var(--orbitpm-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {mode === 'directory' ? `📁 ${rootName}` : 'Single-file mode (saving downloads)'}
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
        <span>Zero-install · runs in your browser</span>
      </footer>

      <SettingsDialogLite
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          setKeysVersion((v) => v + 1)
        }}
        onKeysChanged={() => setKeysVersion((v) => v + 1)}
      />
    </div>
  )
}

export default App
