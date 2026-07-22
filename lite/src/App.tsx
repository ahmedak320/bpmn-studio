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
  buildNewProcessDoc,
  buildMissingProcessDoc,
  humanizeProcessId
} from './editor/newProcessDoc'
import {
  buildTree,
  scanWorkspaceFiles,
  readFileAt,
  writeFileAt,
  createFolderAt,
  createBpmnFileAt,
  deleteAt,
  renameAt,
  moveAt,
  countDirEntries,
  bpmnSlugsIn,
  countBpmnFiles,
  dirOf,
  joinRel,
  type LiteTreeNode,
  type FileMeta
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
import { EmptyWorkspaceCard } from './workspace/EmptyWorkspaceCard'
import { AiPanelLite, type FolderOptionLite } from './ai/AiPanelLite'
import { SettingsDialogLite } from './settings/SettingsDialogLite'
import { ICON_DATA_URI } from './branding/icon'
// --- W2B: file mgmt / search / catalog / navigation / print ---
import { buildCatalog, sortCatalog, filterCatalog, type CatalogSortKey, type SortDir } from './workspace/catalog'
import { CatalogView } from './workspace/CatalogView'
import { buildSearchIndex, searchWorkspace, countHits } from './workspace/searchIndex'
import { SearchResults } from './workspace/SearchResults'
import { collectWorkspaceUnresolved, type WorkspaceUnresolvedLink } from './workspace/unresolved'
import { UnresolvedLinksPanel } from './workspace/UnresolvedLinksPanel'
import {
  emptyHistory,
  pushHistory,
  goBack,
  goForward,
  canGoBack,
  canGoForward,
  currentEntry,
  type NavHistory
} from './workspace/navHistory'
import { folderCrumbs } from './workspace/breadcrumb'
import { Toaster, type ToastMsg, type ToastTone } from './workspace/Toaster'
import { ConfirmDialog } from './workspace/ConfirmDialog'
import { MoveDialog } from './workspace/MoveDialog'
import { PrintButton } from './workspace/PrintButton'
import { PrintView, type PrintJob } from './workspace/PrintView'
import { collectDroppedBpmn, isInternalDrag, type DroppedBpmn } from './workspace/importDrop'
import './print.css'

type Phase = 'loading' | 'need-open' | 'need-reconnect' | 'ready'
type Mode = 'directory' | 'fallback'

interface Tab {
  key: string
  title: string
  /** workspace-relative path in directory mode; null for a virtual/fallback tab. */
  relPath: string | null
}

interface DeleteState {
  node: LiteTreeNode
  /** Non-empty folder → require typing this name to confirm. */
  requireTyped?: string
}

function baseName(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function collectFolders(node: LiteTreeNode | null): FolderOptionLite[] {
  if (!node) return []
  const out: FolderOptionLite[] = []
  const walk = (n: LiteTreeNode, depth: number): void => {
    if (n.type !== 'directory') return
    out.push({
      relPath: n.relPath,
      label: n.relPath === '' ? '/ (workspace root)' : `${' '.repeat(depth * 2)}${n.name}`
    })
    for (const child of n.children ?? []) walk(child, depth + 1)
  }
  walk(node, 0)
  return out
}

function downloadBpmn(fileName: string, xml: string): void {
  triggerDownload(fileName, `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`)
}

interface ModelerWithSvg {
  saveSVG?: () => Promise<{ svg: string }>
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
  const [files, setFiles] = useState<FileMeta[]>([])

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

  // W2B feature state
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catSort, setCatSort] = useState<CatalogSortKey>('name')
  const [catDir, setCatDir] = useState<SortDir>('asc')
  const [unresolvedOpen, setUnresolvedOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<LiteTreeNode | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteState | null>(null)
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [history, setHistory] = useState<NavHistory>(() => emptyHistory())
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)
  const suppressPushRef = useRef(false)
  const toastIdRef = useRef(0)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const pushToast = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, text, tone }])
  }, [])
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // --- workspace lifecycle -------------------------------------------------

  const refreshWorkspace = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const [nextTree, scanned] = await Promise.all([
      buildTree(handle, handle.name),
      scanWorkspaceFiles(handle)
    ])
    setTree(nextTree)
    setFiles(scanned)
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
      setPickError(errMsg(err))
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
      setPickError(errMsg(err))
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
      setCatalogOpen(false)
      setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, title: baseName(relPath), relPath }]))
      setActiveKey(key)
      if (contents[key] !== undefined) return
      if (!rootHandle) return
      try {
        const xml = await readFileAt(rootHandle, relPath)
        setContents((prev) => ({ ...prev, [key]: xml }))
      } catch (err) {
        setContents((prev) => ({ ...prev, [key]: '' }))
        pushToast(`Could not open ${relPath}: ${errMsg(err)}`, 'error')
      }
    },
    [contents, rootHandle, pushToast]
  )

  const openVirtualTab = useCallback((title: string, xml: string) => {
    const key = `virtual:${++virtualCounter.current}`
    setCatalogOpen(false)
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
        downloadBpmn(tab.title.endsWith('.bpmn') ? tab.title : `${tab.title}.bpmn`, xml)
      }
    },
    [rootHandle, refreshWorkspace]
  )

  // --- derived data (single source: `files`) ------------------------------

  const processIndex: ProcessIndex = useMemo(() => buildProcessIndex(files), [files])
  const searchIndex = useMemo(() => buildSearchIndex(files), [files])
  const xmlByPath = useMemo(() => new Map(files.map((f) => [f.relPath, f.xml])), [files])
  const catalogRows = useMemo(() => buildCatalog(files, processIndex), [files, processIndex])
  const visibleCatalog = useMemo(
    () => sortCatalog(filterCatalog(catalogRows, search, xmlByPath), catSort, catDir),
    [catalogRows, search, xmlByPath, catSort, catDir]
  )
  const searchGroups = useMemo(() => searchWorkspace(searchIndex, search), [searchIndex, search])
  const folders = useMemo(() => collectFolders(tree), [tree])
  const filePaths = useMemo(() => new Set(files.map((f) => f.relPath)), [files])

  const activeTab = tabs.find((t) => t.key === activeKey) ?? null
  const activeModeler = (activeKey ? modelersByKey[activeKey] : null) as SelectionLinkModeler | null

  const workspaceUnresolved = useMemo<WorkspaceUnresolvedLink[]>(() => {
    if (mode === 'directory') return collectWorkspaceUnresolved(files, processIndex)
    // Fallback: only the active in-memory tab can be inspected.
    if (!activeKey) return []
    const xml = contents[activeKey]
    if (!xml) return []
    const tab = tabs.find((t) => t.key === activeKey)
    const title = tab?.title ?? 'current diagram'
    return listUnresolvedCalledElements(xml, processIndex).map((u) => ({
      sourceRelPath: title,
      sourceFileName: title,
      sourceProcessName: undefined,
      elementId: u.elementId,
      calledElement: u.calledElement
    }))
  }, [mode, files, processIndex, activeKey, contents, tabs])
  const unresolvedCount = workspaceUnresolved.length

  // --- linking / drill-down ----------------------------------------------

  const handleCreateMissingProcess = useCallback(
    async (calledElementId: string) => {
      if (!(mode === 'directory' && rootHandle)) {
        pushToast(
          `Process “${calledElementId}” doesn't exist yet. Open a folder to create and link processes.`,
          'info'
        )
        return
      }
      const name = await promptText({
        title: 'Create linked process',
        label: 'Process name',
        initialValue: humanizeProcessId(calledElementId),
        okLabel: 'Create & open',
        hint: `Creates a new .bpmn whose process id is "${calledElementId}", so this call activity resolves.`
      })
      if (!name) return
      const taken = await bpmnSlugsIn(rootHandle, '')
      const slug = dedupeSlug(slugify(name || calledElementId), (c) => taken.has(c.toLowerCase()))
      const doc = buildMissingProcessDoc(calledElementId, name, slug)
      try {
        const relPath = await createBpmnFileAt(rootHandle, '', doc.fileBaseName, doc.xml)
        await refreshWorkspace(rootHandle)
        void openDirectoryFile(relPath)
      } catch (err) {
        pushToast(`Could not create process: ${errMsg(err)}`, 'error')
      }
    },
    [mode, rootHandle, promptText, refreshWorkspace, openDirectoryFile, pushToast]
  )

  const handleOpenCalledProcess = useCallback(
    (processId: string) => {
      const entry = processIndex.get(processId)
      if (entry) {
        void openDirectoryFile(entry.relPath)
        return
      }
      if (mode === 'directory' && rootHandle) {
        void handleCreateMissingProcess(processId)
      } else {
        pushToast(
          `No process with id “${processId}” in this workspace — link a different process or open a folder to create it.`,
          'info'
        )
      }
    },
    [processIndex, openDirectoryFile, mode, rootHandle, handleCreateMissingProcess, pushToast]
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
        hint: 'A .bpmn file with a start event is created; other processes can link to it.'
      })
      if (!name) return
      const taken = await bpmnSlugsIn(rootHandle, folderRel)
      const slug = dedupeSlug(slugify(name), (c) => taken.has(c.toLowerCase()))
      const doc = buildNewProcessDoc(name, slug)
      try {
        const relPath = await createBpmnFileAt(rootHandle, folderRel, doc.fileBaseName, doc.xml)
        await refreshWorkspace(rootHandle)
        void openDirectoryFile(relPath)
      } catch (err) {
        pushToast(`Could not create process: ${errMsg(err)}`, 'error')
      }
    },
    [rootHandle, promptText, refreshWorkspace, openDirectoryFile, pushToast]
  )

  const handleNewProcessFallback = useCallback(async () => {
    const name = await promptText({
      title: 'New Process',
      label: 'Process name',
      initialValue: 'New Process',
      okLabel: 'Create',
      hint: 'No folder is open, so Save will download the .bpmn file.'
    })
    if (!name) return
    const doc = buildNewProcessDoc(name)
    setMode('fallback')
    setPhase('ready')
    openVirtualTab(`${doc.fileBaseName}.bpmn`, doc.xml)
  }, [promptText, openVirtualTab])

  const handleNewProcessClick = useCallback(() => {
    if (mode === 'directory' && rootHandle) void handleNewProcess('')
    else void handleNewProcessFallback()
  }, [mode, rootHandle, handleNewProcess, handleNewProcessFallback])

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
        pushToast(`Could not create folder: ${errMsg(err)}`, 'error')
      }
    },
    [rootHandle, promptText, refreshWorkspace, pushToast]
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
        pushToast(`Could not rename: ${errMsg(err)}`, 'error')
      }
    },
    [rootHandle, promptText, refreshWorkspace, closeTabsUnder, pushToast]
  )

  // Delete → confirm dialog (non-empty folders require typing the name).
  const handleDeleteRequest = useCallback(
    async (node: LiteTreeNode) => {
      if (!rootHandle) return
      if (node.type === 'directory') {
        const entryCount = await countDirEntries(rootHandle, node.relPath)
        setDeleteTarget({ node, requireTyped: entryCount > 0 ? node.name : undefined })
      } else {
        setDeleteTarget({ node })
      }
    },
    [rootHandle]
  )

  const performDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target || !rootHandle) return
    setDeleteTarget(null)
    try {
      await deleteAt(rootHandle, target.node.relPath, target.node.type)
      closeTabsUnder(target.node.relPath)
      await refreshWorkspace(rootHandle)
      pushToast(`Deleted “${target.node.name}”.`, 'success')
    } catch (err) {
      pushToast(`Could not delete: ${errMsg(err)}`, 'error')
    }
  }, [deleteTarget, rootHandle, refreshWorkspace, closeTabsUnder, pushToast])

  // Move (drag-drop onto a folder, or the "Move to…" dialog).
  const performMove = useCallback(
    async (node: LiteTreeNode, toFolderRel: string) => {
      if (!rootHandle) return
      try {
        await moveAt(rootHandle, node.relPath, toFolderRel, node.type)
        closeTabsUnder(node.relPath)
        await refreshWorkspace(rootHandle)
        pushToast(`Moved “${node.name}” to ${toFolderRel || rootName}.`, 'success')
      } catch (err) {
        pushToast(`Could not move: ${errMsg(err)}`, 'error')
      }
    },
    [rootHandle, refreshWorkspace, closeTabsUnder, pushToast, rootName]
  )

  const handleMoveDrop = useCallback(
    (fromRel: string, fromType: 'file' | 'directory', toFolderRel: string) => {
      const node: LiteTreeNode = { name: baseName(fromRel), relPath: fromRel, type: fromType }
      void performMove(node, toFolderRel)
    },
    [performMove]
  )

  // --- import (.bpmn from Explorer) ---------------------------------------

  const importEntries = useCallback(
    async (entries: DroppedBpmn[], baseFolderRel: string) => {
      if (!(mode === 'directory' && rootHandle)) {
        pushToast('Open a folder first to import files into your workspace.', 'info')
        return
      }
      if (entries.length === 0) {
        pushToast('No .bpmn files found in what you dropped.', 'info')
        return
      }
      let created = 0
      let renamed = 0
      for (const entry of entries) {
        const sub = dirOf(entry.relPath)
        const targetFolder = sub ? joinRel(baseFolderRel, sub) : baseFolderRel
        const base = slugify(entry.name.replace(/\.bpmn$/i, ''))
        const taken = await bpmnSlugsIn(rootHandle, targetFolder)
        const slug = dedupeSlug(base, (c) => taken.has(c.toLowerCase()))
        if (slug !== base) renamed += 1
        try {
          const xml = await entry.getText()
          await createBpmnFileAt(rootHandle, targetFolder, slug, xml)
          created += 1
        } catch {
          /* skip an unreadable entry, keep importing the rest */
        }
      }
      await refreshWorkspace(rootHandle)
      pushToast(
        `Imported ${created} file${created === 1 ? '' : 's'}` +
          (renamed > 0 ? ` (${renamed} renamed to avoid a name clash)` : '') +
          '.',
        'success'
      )
    },
    [mode, rootHandle, refreshWorkspace, pushToast]
  )

  const handleImportDrop = useCallback(
    (dt: DataTransfer, toFolderRel: string) => {
      void (async () => {
        const entries = await collectDroppedBpmn(dt)
        await importEntries(entries, toFolderRel)
      })()
    },
    [importEntries]
  )

  const onImportInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files
      e.target.value = ''
      if (!list || list.length === 0) return
      const entries: DroppedBpmn[] = Array.from(list)
        .filter((f) => /\.bpmn$/i.test(f.name))
        .map((f) => ({ relPath: f.name, name: f.name, getText: () => f.text() }))
      await importEntries(entries, '')
    },
    [importEntries]
  )

  // Container-level drop: importing onto non-tree areas lands at the root.
  const handleAppDragOver = useCallback((e: React.DragEvent) => {
    if (isInternalDrag(e.dataTransfer)) return
    if (Array.from(e.dataTransfer.types as ArrayLike<string>).includes('Files')) {
      e.preventDefault()
    }
  }, [])
  const handleAppDrop = useCallback(
    (e: React.DragEvent) => {
      if (isInternalDrag(e.dataTransfer)) return
      if (!Array.from(e.dataTransfer.types as ArrayLike<string>).includes('Files')) return
      e.preventDefault()
      handleImportDrop(e.dataTransfer, '')
    },
    [handleImportDrop]
  )

  // --- fallback single-file open + new blank ------------------------------

  const openFileFromDisk = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
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

  // --- navigation (back / forward / Alt+Arrows) ---------------------------

  const keyExists = useCallback(
    (key: string) => {
      if (tabs.some((t) => t.key === key)) return true
      return !key.startsWith('virtual:') && filePaths.has(key)
    },
    [tabs, filePaths]
  )

  const navigateToKey = useCallback(
    (key: string) => {
      if (tabs.some((t) => t.key === key)) {
        setActiveKey(key)
        return
      }
      if (!key.startsWith('virtual:')) void openDirectoryFile(key)
    },
    [tabs, openDirectoryFile]
  )

  const handleBack = useCallback(() => {
    const next = goBack(history, keyExists)
    const key = currentEntry(next)
    if (!key || key === currentEntry(history)) return
    suppressPushRef.current = true
    setHistory(next)
    setCatalogOpen(false)
    navigateToKey(key)
  }, [history, keyExists, navigateToKey])

  const handleForward = useCallback(() => {
    const next = goForward(history, keyExists)
    const key = currentEntry(next)
    if (!key || key === currentEntry(history)) return
    suppressPushRef.current = true
    setHistory(next)
    setCatalogOpen(false)
    navigateToKey(key)
  }, [history, keyExists, navigateToKey])

  // Record every user-initiated activation (skip the ones caused by back/forward).
  useEffect(() => {
    if (!activeKey) return
    if (suppressPushRef.current) {
      suppressPushRef.current = false
      return
    }
    setHistory((h) => pushHistory(h, activeKey))
  }, [activeKey])

  const backEnabled = canGoBack(history, keyExists)
  const forwardEnabled = canGoForward(history, keyExists)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleBack()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleForward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleBack, handleForward])

  // --- print --------------------------------------------------------------

  const handlePrint = useCallback(
    async (tab: Tab) => {
      const modeler = modelersByKey[tab.key] as ModelerWithSvg | undefined
      if (!modeler?.saveSVG) {
        pushToast('The diagram is still loading — try Print again in a moment.', 'info')
        return
      }
      try {
        const { svg } = await modeler.saveSVG()
        const folderLabel = tab.relPath
          ? dirOf(tab.relPath) || rootName || 'Workspace'
          : 'Single-file'
        setPrintJob({ svg, title: tab.title.replace(/\.bpmn$/i, ''), folder: folderLabel })
      } catch (err) {
        pushToast(`Print failed: ${errMsg(err)}`, 'error')
      }
    },
    [modelersByKey, rootName, pushToast]
  )

  useEffect(() => {
    if (!printJob) {
      document.body.classList.remove('orbitpm-printing')
      return
    }
    document.body.classList.add('orbitpm-printing')
    const raf = requestAnimationFrame(() => {
      try {
        window.print()
      } catch {
        /* headless / blocked print — the print view is still in the DOM */
      }
    })
    const after = (): void => setPrintJob(null)
    window.addEventListener('afterprint', after)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('afterprint', after)
    }
  }, [printJob])

  // --- search box ---------------------------------------------------------

  const flatHits = useMemo(() => searchGroups.flatMap((g) => g.hits), [searchGroups])

  const openSearchHit = useCallback(
    (relPath: string) => {
      setSearchOpen(false)
      void openDirectoryFile(relPath)
    },
    [openDirectoryFile]
  )

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        const first = flatHits[0]
        if (first) openSearchHit(first.relPath)
      } else if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    },
    [flatHits, openSearchHit]
  )

  // Close the search dropdown on an outside click.
  useEffect(() => {
    if (!searchOpen) return
    const onDown = (e: MouseEvent): void => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [searchOpen])

  const onSortCatalog = useCallback((key: CatalogSortKey) => {
    setCatSort((prevKey) => {
      if (prevKey === key) {
        setCatDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setCatDir('asc')
      return key
    })
  }, [])

  // --- automation hook ----------------------------------------------------

  useEffect(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: Record<string, unknown> }
    w.__ORBITPM_LITE__ = {
      ...(w.__ORBITPM_LITE__ ?? {}),
      modeler: activeKey ? (modelersByKey[activeKey] ?? null) : null
    }
  }, [activeKey, modelersByKey])

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
  const hiddenImportInput = (
    <input
      ref={importInputRef}
      type="file"
      accept=".bpmn,application/xml,text/xml"
      multiple
      style={{ display: 'none' }}
      onChange={(e) => void onImportInputChange(e)}
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
          onNewProcess={() => void handleNewProcessFallback()}
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

  const showCatalog = mode === 'directory' && (tabs.length === 0 || catalogOpen)
  const crumbs = activeTab && activeTab.relPath ? folderCrumbs(activeTab.relPath, rootName || 'Workspace') : null

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100vh' }}>
      {hiddenFileInput}
      {hiddenImportInput}
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <img src={ICON_DATA_URI} width={20} height={20} alt="" style={{ borderRadius: 5 }} />
          <strong style={{ fontSize: 13 }}>OrbitPM Process Studio Lite</strong>
          <span style={{ display: 'inline-flex', gap: 2, marginLeft: 6 }}>
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={handleBack}
              disabled={!backEnabled}
              aria-label="Back"
              title="Back (Alt+Left)"
              style={{ opacity: backEnabled ? 1 : 0.4, padding: '0.2rem 0.45rem' }}
            >
              ◀
            </button>
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={handleForward}
              disabled={!forwardEnabled}
              aria-label="Forward"
              title="Forward (Alt+Right)"
              style={{ opacity: forwardEnabled ? 1 : 0.4, padding: '0.2rem 0.45rem' }}
            >
              ▶
            </button>
            {mode === 'directory' && (
              <button
                className="orbitpm-lite-chrome-btn"
                onClick={() => setCatalogOpen(true)}
                aria-label="Home — process catalog"
                title="Home — browse all processes"
                style={{ padding: '0.2rem 0.45rem' }}
              >
                🏠
              </button>
            )}
          </span>
        </span>

        {mode === 'directory' && (
          <div ref={searchBoxRef} style={{ position: 'relative', flex: '1 1 auto', maxWidth: 440 }}>
            <input
              type="search"
              value={search}
              placeholder="Search processes, files, ids, diagram text…"
              aria-label="Search the workspace"
              onChange={(e) => {
                setSearch(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => search.trim() && setSearchOpen(true)}
              onKeyDown={onSearchKeyDown}
              style={{
                width: '100%',
                padding: '0.35rem 0.6rem',
                borderRadius: 8,
                border: '1px solid rgba(127,127,127,0.4)',
                background: 'transparent',
                color: 'inherit',
                font: 'inherit',
                fontSize: 13
              }}
            />
            {searchOpen && search.trim() && (
              <SearchResults
                groups={searchGroups}
                query={search}
                rootName={rootName || 'Workspace'}
                onOpen={(rel) => openSearchHit(rel)}
                onClose={() => setSearchOpen(false)}
              />
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
          <button
            className="orbitpm-lite-chrome-btn"
            onClick={handleNewProcessClick}
            title="Create a new BPMN process"
            style={{
              background: 'var(--orbitpm-accent)',
              color: '#fff',
              borderColor: 'var(--orbitpm-accent)',
              fontWeight: 600
            }}
          >
            ＋ New process
          </button>
          {mode === 'directory' ? (
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={() => void handleOpenDifferent()}
              title="Open a different workspace folder"
            >
              Change folder…
            </button>
          ) : (
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={openFileFromDisk}
              title="Open an existing .bpmn file from disk"
            >
              Open .bpmn…
            </button>
          )}
          {aiCollapsed && (
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={() => setAiCollapsed(false)}
              title="Show the AI generation panel"
            >
              ✨ AI
            </button>
          )}
          <button
            className="orbitpm-lite-chrome-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings — manage AI provider keys"
          >
            ⚙ Settings
          </button>
        </div>
      </header>

      <div
        style={{ display: 'grid', gridTemplateColumns: '260px 1fr auto', minHeight: 0 }}
        onDragOver={handleAppDragOver}
        onDrop={handleAppDrop}
      >
        <aside
          style={{
            borderRight: '1px solid var(--orbitpm-border)',
            overflowY: 'auto',
            padding: '0.5rem 0'
          }}
        >
          {mode === 'directory' ? (
            <div>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  padding: '0 0.6rem 0.5rem',
                  marginBottom: 6,
                  borderBottom: '1px solid var(--orbitpm-border)',
                  flexWrap: 'wrap'
                }}
              >
                <button
                  className="orbitpm-lite-chrome-btn"
                  style={{ flex: '1 1 auto' }}
                  onClick={() => void handleNewProcess('')}
                  title="Create a new process at the workspace root"
                >
                  ＋ New process
                </button>
                <button
                  className="orbitpm-lite-chrome-btn"
                  onClick={() => void handleNewFolder('')}
                  title="Create a new folder at the workspace root"
                  aria-label="New folder"
                >
                  📁＋
                </button>
                <button
                  className="orbitpm-lite-chrome-btn"
                  onClick={() => importInputRef.current?.click()}
                  title="Import .bpmn files into the workspace (or drag them from Explorer onto the tree)"
                  aria-label="Import .bpmn files"
                >
                  ⤓ Import
                </button>
              </div>
              {countBpmnFiles(tree) === 0 ? (
                <EmptyWorkspaceCard
                  folderName={rootName}
                  onCreateFirst={() => void handleNewProcess('')}
                />
              ) : (
                <FolderTreeLite
                  root={tree}
                  activePath={activeTab?.relPath ?? null}
                  onOpenFile={(rel) => void openDirectoryFile(rel)}
                  onNewProcess={(f) => void handleNewProcess(f)}
                  onNewFolder={(f) => void handleNewFolder(f)}
                  onRename={(n) => void handleRename(n)}
                  onDelete={(n) => void handleDeleteRequest(n)}
                  onMove={(n) => setMoveTarget(n)}
                  onMoveDrop={handleMoveDrop}
                  onImportDrop={handleImportDrop}
                />
              )}
            </div>
          ) : (
            <div style={{ padding: '0.6rem 0.8rem', fontSize: 12.5, color: 'var(--orbitpm-muted)' }}>
              <p style={{ marginTop: 0 }}>
                Single-file mode — no folder is open. Saving downloads the <code>.bpmn</code> file.
              </p>
              <button
                className="orbitpm-lite-chrome-btn"
                style={{
                  width: '100%',
                  marginBottom: 6,
                  background: 'var(--orbitpm-accent)',
                  color: '#fff',
                  borderColor: 'var(--orbitpm-accent)',
                  fontWeight: 600
                }}
                onClick={() => void handleNewProcessFallback()}
                title="Create a new named process (Save downloads the file)"
              >
                ＋ New process
              </button>
              <button
                className="orbitpm-lite-chrome-btn"
                style={{ width: '100%', marginBottom: 6 }}
                onClick={openFileFromDisk}
                title="Open an existing .bpmn file from disk"
              >
                Open a .bpmn file…
              </button>
              <button
                className="orbitpm-lite-chrome-btn"
                style={{ width: '100%' }}
                onClick={startBlankDiagram}
                title="Start an unnamed blank diagram"
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
                  onClick={() => {
                    setCatalogOpen(false)
                    setActiveKey(tab.key)
                  }}
                  style={{
                    padding: '0.5rem 0.9rem',
                    fontSize: 13,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom:
                      isActive && !catalogOpen
                        ? '2px solid var(--orbitpm-accent)'
                        : '2px solid transparent',
                    opacity: isActive && !catalogOpen ? 1 : 0.65
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

          {crumbs && !showCatalog && (
            <nav
              aria-label="Breadcrumb"
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '0.25rem 0.8rem',
                borderBottom: '1px solid var(--orbitpm-border)',
                fontSize: 12,
                color: 'var(--orbitpm-muted)',
                overflowX: 'auto',
                whiteSpace: 'nowrap'
              }}
            >
              {crumbs.map((c, i) => (
                <span key={c.relPath || 'root'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {i > 0 && <span style={{ opacity: 0.5 }}>/</span>}
                  {i === 0 ? (
                    <button
                      type="button"
                      onClick={() => setCatalogOpen(true)}
                      title="Browse all processes"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        font: 'inherit',
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      🏠 {c.label}
                    </button>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </span>
              ))}
              <span style={{ opacity: 0.5 }}>/</span>
              <span style={{ color: 'var(--orbitpm-fg)' }}>{activeTab?.title}</span>
            </nav>
          )}

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            {tabs.length === 0 && mode === 'fallback' && (
              <div style={{ padding: '1.5rem', opacity: 0.6, lineHeight: 1.6 }}>
                Press <strong>＋ New process</strong> to start drawing, or open an existing{' '}
                <code>.bpmn</code> file.
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
                    display: isActive && !showCatalog ? 'flex' : 'none',
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
                        isActive ? (
                          <>
                            <PrintButton onPrint={() => void handlePrint(tab)} />
                            {mode === 'directory' && (
                              <SelectionLinkButton modeler={activeModeler} index={processIndex} />
                            )}
                          </>
                        ) : null
                      }
                    />
                  )}
                </div>
              )
            })}

            {showCatalog && (
              <CatalogView
                rows={visibleCatalog}
                sortKey={catSort}
                sortDir={catDir}
                onSort={onSortCatalog}
                onOpen={(rel) => void openDirectoryFile(rel)}
                query={search}
                totalCount={catalogRows.length}
                rootName={rootName || 'Workspace'}
                onNewProcess={() => void handleNewProcess('')}
                onOpenUnresolved={() => setUnresolvedOpen(true)}
              />
            )}
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
          {search.trim() && mode === 'directory' && (
            <span>· {countHits(searchGroups)} search match{countHits(searchGroups) === 1 ? '' : 'es'}</span>
          )}
          {unresolvedCount > 0 && (
            <button
              type="button"
              onClick={() => setUnresolvedOpen(true)}
              title="Show every unresolved call-activity link in the workspace"
              style={{
                padding: '0.1rem 0.5rem',
                borderRadius: 999,
                border: 'none',
                background: 'rgba(217,119,6,0.18)',
                color: '#d97706',
                fontWeight: 600,
                cursor: 'pointer',
                font: 'inherit'
              }}
            >
              {unresolvedCount} unresolved link{unresolvedCount === 1 ? '' : 's'}
            </button>
          )}
        </span>
        <span>Zero-install · runs in your browser</span>
      </footer>

      {moveTarget && (
        <MoveDialog
          node={moveTarget}
          folders={folders}
          onMove={(dest) => {
            const node = moveTarget
            setMoveTarget(null)
            void performMove(node, dest)
          }}
          onCancel={() => setMoveTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.node.type === 'directory' ? 'Delete folder' : 'Delete file'}
          danger
          confirmLabel="Delete"
          requireTyped={deleteTarget.requireTyped}
          message={
            deleteTarget.requireTyped ? (
              <>
                <strong>{deleteTarget.node.name}</strong> is not empty. Deleting it removes the
                folder and everything inside it. This cannot be undone.
              </>
            ) : (
              <>
                Delete <strong>{deleteTarget.node.name}</strong>? This cannot be undone.
              </>
            )
          }
          onConfirm={() => void performDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {unresolvedOpen && (
        <UnresolvedLinksPanel
          links={workspaceUnresolved}
          canCreate={mode === 'directory' && !!rootHandle}
          onCreate={(called) => {
            setUnresolvedOpen(false)
            void handleCreateMissingProcess(called)
          }}
          onOpenSource={(rel) => {
            if (filePaths.has(rel)) {
              setUnresolvedOpen(false)
              void openDirectoryFile(rel)
            }
          }}
          onClose={() => setUnresolvedOpen(false)}
        />
      )}

      <PrintView job={printJob} />
      <Toaster toasts={toasts} onDismiss={dismissToast} />

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
