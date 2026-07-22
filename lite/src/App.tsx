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
import { dedupeSlug } from '@app/shared/slug'
// --- lite-local ---
import {
  buildNewProcessDoc,
  buildMissingProcessDoc,
  humanizeProcessId,
  deriveFileBaseName
} from './editor/newProcessDoc'
import {
  snapshotWorkspace,
  readFileAt,
  writeFileAt,
  createFolderAt,
  createBpmnFileUnique,
  deleteAt,
  renameAt,
  moveAt,
  countDirEntries,
  bpmnSlugsIn,
  countBpmnFiles,
  hasPathSeparator,
  ensureBpmnExtension,
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
  ensurePermission,
  classifyPickerError,
  type PickerErrorCode
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
import { UnsavedSwitchDialog } from './workspace/UnsavedSwitchDialog'
import { createMutex } from './workspace/mutex'
import { partitionDirtyTabs } from './workspace/dirtySave'
import { createRefreshGuard, canCommitToWorkspace, commitIfCurrent } from './workspace/workspaceSession'
import { MoveDialog } from './workspace/MoveDialog'
import { PrintButton } from './workspace/PrintButton'
import { PrintView, type PrintJob } from './workspace/PrintView'
import { collectDroppedBpmn, isInternalDrag, type DroppedBpmn } from './workspace/importDrop'
import { t, tPlural } from './i18n'
import { useLang, setLang } from './i18n/useLang'
import './print.css'

type Phase = 'loading' | 'need-open' | 'need-reconnect' | 'ready'
type Mode = 'directory' | 'fallback'

interface Tab {
  key: string
  title: string
  /** workspace-relative path in directory mode; null for a virtual/fallback tab. */
  relPath: string | null
  /** Workspace generation this tab was opened under. A save is refused unless it
   *  still matches the live generation, so a tab from a previous folder can
   *  never write through the new root handle after a switch (Codex CRITICAL-1). */
  gen: number
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

/** Map a classified picker/reconnect failure to its i18n key (ORIG-12) — raw
 *  browser exception text is never shown to the user. `aborted` (the user
 *  dismissed the dialog) is handled by the caller as a no-op. */
function pickerErrorKey(code: PickerErrorCode): 'alert.picker.security' | 'alert.picker.notAllowed' | 'alert.picker.unknown' {
  switch (code) {
    case 'security':
      return 'alert.picker.security'
    case 'not-allowed':
      return 'alert.picker.notAllowed'
    default:
      return 'alert.picker.unknown'
  }
}

function collectFolders(node: LiteTreeNode | null): FolderOptionLite[] {
  if (!node) return []
  const out: FolderOptionLite[] = []
  const walk = (n: LiteTreeNode, depth: number): void => {
    if (n.type !== 'directory') return
    out.push({
      relPath: n.relPath,
      label: n.relPath === '' ? t('ai.folderOption.root') : `${' '.repeat(depth * 2)}${n.name}`
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
  const lang = useLang()
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

  // Data-safety plumbing (Codex C1 / M3 / M8).
  const workspaceGenRef = useRef(0) // bumped on every folder switch (tab-write guard)
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null) // sync mirror for async guards
  const refreshGuardRef = useRef(createRefreshGuard()) // discards stale/out-of-order scans
  const opMutexRef = useRef(createMutex()) // serializes create / import / AI-place writes
  const [switchGuard, setSwitchGuard] = useState<{ count: number } | null>(null)
  const switchResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null)

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
    // Each scan claims a token; a slower earlier scan (or one begun before a
    // folder switch) is discarded rather than overwriting a newer/other one.
    const token = refreshGuardRef.current.begin()
    // ONE traversal yields both the tree and the file-meta list, so the tree and
    // the indexes derived from `files` are always coherent (Codex NEW-minor).
    const { tree: nextTree, files: scanned } = await snapshotWorkspace(handle, handle.name)
    if (!refreshGuardRef.current.shouldCommit(token, handle, rootHandleRef.current)) return
    setTree(nextTree)
    setFiles(scanned)
  }, [])

  const activateWorkspace = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      // New session: bump the generation (invalidates every stale tab's save)
      // and update the sync handle mirror BEFORE any async scan can commit.
      workspaceGenRef.current += 1
      rootHandleRef.current = handle
      // Full reset BEFORE the new scan so no tab / tree / index / dirty flag /
      // modeler from the previous folder survives the switch (Codex CRITICAL-1).
      setTree(null)
      setFiles([])
      setTabs([])
      setActiveKey(null)
      setContents({})
      setDirtyByKey({})
      setModelersByKey({})
      setMounted(new Set())
      commandsRef.current = {}
      setSearch('')
      setSearchOpen(false)
      setCatalogOpen(false)
      setMoveTarget(null)
      setDeleteTarget(null)
      setUnresolvedOpen(false)
      setHistory(emptyHistory())
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

  // Manual "Refresh" (tree header): re-scan the folder for changes made outside
  // the app. The refresh guard makes concurrent/stale scans safe (Codex M7/M8).
  const handleManualRefresh = useCallback(async () => {
    const h = rootHandleRef.current
    if (!h) return
    await refreshWorkspace(h)
    pushToast(t('toast.refreshed'), 'info')
  }, [refreshWorkspace, pushToast])

  // Auto-refresh on window focus / tab visibility, debounced 2s, so external
  // filesystem changes (files added/edited/deleted outside the app) don't leave
  // the tree, search, catalog and links stale indefinitely (Codex MAJOR-7-lite).
  useEffect(() => {
    if (mode !== 'directory') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const h = rootHandleRef.current
        if (h) void refreshWorkspace(h)
      }, 2000)
    }
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [mode, refreshWorkspace])

  // Save every dirty directory-mode tab through the CURRENT root handle (called
  // before a folder switch, while the old handle is still active).
  const saveAllDirty = useCallback(async () => {
    // Partition so NO dirty tab is silently dropped: directory tabs write to disk;
    // fallback/virtual tabs (relPath === null) take the download-on-save path so
    // their unsaved work survives the switch instead of being discarded (NEW-C2).
    const { writable, downloadable } = partitionDirtyTabs(tabs, (tab) => Boolean(dirtyByKey[tab.key]))
    const readXml = async (key: string): Promise<string | undefined> => {
      const modeler = modelersByKey[key] as
        | { saveXML?: (o: { format: boolean }) => Promise<{ xml?: string }> }
        | undefined
      if (!modeler?.saveXML) return undefined
      const { xml } = await modeler.saveXML({ format: true })
      return xml
    }
    for (const tab of writable) {
      if (!tab.relPath || !rootHandle) continue
      const xml = await readXml(tab.key)
      if (xml) await writeFileAt(rootHandle, tab.relPath, xml)
    }
    for (const tab of downloadable) {
      const xml = await readXml(tab.key)
      if (xml) downloadBpmn(tab.title.endsWith('.bpmn') ? tab.title : `${tab.title}.bpmn`, xml)
    }
  }, [tabs, dirtyByKey, modelersByKey, rootHandle])

  const resolveSwitch = useCallback((choice: 'save' | 'discard' | 'cancel') => {
    setSwitchGuard(null)
    const r = switchResolveRef.current
    switchResolveRef.current = null
    r?.(choice)
  }, [])

  // Gate a folder switch on unsaved work. Returns true to proceed, false to
  // abort (keep the current folder). Prompts ONCE for all dirty tabs.
  const guardWorkspaceSwitch = useCallback(async (): Promise<boolean> => {
    const dirtyCount = tabs.filter((tb) => dirtyByKey[tb.key]).length
    if (dirtyCount === 0) return true
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
      switchResolveRef.current = resolve
      setSwitchGuard({ count: dirtyCount })
    })
    if (choice === 'cancel') return false
    if (choice === 'save') {
      try {
        await saveAllDirty()
      } catch (err) {
        pushToast(t('alert.saveAll.failed', { error: errMsg(err) }), 'error')
        return false
      }
    }
    return true
  }, [tabs, dirtyByKey, saveAllDirty, pushToast])

  const handleOpenFolder = useCallback(async () => {
    setPickBusy(true)
    setPickError(null)
    try {
      const handle = await pickWorkspace()
      if (!handle) return
      const state = await ensurePermission(handle, true)
      if (state !== 'granted') {
        setPickError(t('alert.permissionNotGranted.open'))
        return
      }
      // Prompt for unsaved work BEFORE we reset state onto the new folder.
      const proceed = await guardWorkspaceSwitch()
      if (!proceed) return
      await activateWorkspace(handle)
    } catch (err) {
      const code = classifyPickerError(err)
      if (code !== 'aborted') setPickError(t(pickerErrorKey(code)))
    } finally {
      setPickBusy(false)
    }
  }, [activateWorkspace, guardWorkspaceSwitch])

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
        setPickError(t('alert.permissionNotGranted.reconnect'))
        return
      }
      await activateWorkspace(handle)
    } catch (err) {
      const code = classifyPickerError(err)
      if (code !== 'aborted') setPickError(t(pickerErrorKey(code)))
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
      setTabs((prev) =>
        prev.some((t) => t.key === key)
          ? prev
          : [...prev, { key, title: baseName(relPath), relPath, gen: workspaceGenRef.current }]
      )
      setActiveKey(key)
      if (contents[key] !== undefined) return
      // Read through the LIVE handle mirror and guard the commit against a
      // mid-read folder switch: neither the loaded content nor its error toast is
      // committed if the workspace changed while the read was in flight, so a
      // stale read from the previous folder can never land in the new one (ORIG-1a).
      const handle = rootHandleRef.current
      if (!handle) return
      let failed: unknown = null
      const outcome = await commitIfCurrent(
        () => workspaceGenRef.current,
        async () => {
          try {
            return await readFileAt(handle, relPath)
          } catch (err) {
            failed = err
            return ''
          }
        },
        (xml) => setContents((prev) => ({ ...prev, [key]: xml }))
      )
      if (outcome === 'committed' && failed) {
        pushToast(t('alert.openFileFailed', { relPath, error: errMsg(failed) }), 'error')
      }
    },
    [contents, pushToast]
  )

  const openVirtualTab = useCallback((title: string, xml: string) => {
    const key = `virtual:${++virtualCounter.current}`
    setCatalogOpen(false)
    setTabs((prev) => [...prev, { key, title, relPath: null, gen: workspaceGenRef.current }])
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
        const tab = tabs.find((tb) => tb.key === key)
        const confirmed = window.confirm(t('confirm.discardUnsaved', { title: tab?.title ?? 'this file' }))
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
        // Refuse a write from a tab whose workspace was switched out from under
        // it — otherwise it would land its relative path in the WRONG folder.
        if (!canCommitToWorkspace(tab.gen, workspaceGenRef.current)) {
          pushToast(t('alert.staleWrite'), 'error')
          return
        }
        await writeFileAt(rootHandle, tab.relPath, xml)
        await refreshWorkspace(rootHandle)
      } else {
        downloadBpmn(tab.title.endsWith('.bpmn') ? tab.title : `${tab.title}.bpmn`, xml)
      }
    },
    [rootHandle, refreshWorkspace, pushToast]
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
  const folders = useMemo(() => collectFolders(tree), [tree, lang])
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
        pushToast(t('alert.createMissingProcessNoFolder', { calledElementId }), 'info')
        return
      }
      const name = await promptText({
        title: t('dialog.createMissingProcess.title'),
        label: t('dialog.createMissingProcess.label'),
        initialValue: humanizeProcessId(calledElementId),
        okLabel: t('dialog.createMissingProcess.okLabel'),
        hint: t('dialog.createMissingProcess.hint', { calledElementId })
      })
      if (!name) return
      try {
        const relPath = await opMutexRef.current.runExclusive(async () => {
          const taken = await bpmnSlugsIn(rootHandle, '')
          const slug = dedupeSlug(deriveFileBaseName(name || calledElementId), (c) =>
            taken.has(c.toLowerCase())
          )
          const doc = buildMissingProcessDoc(calledElementId, name, slug)
          return createBpmnFileUnique(rootHandle, '', doc.fileBaseName, doc.xml)
        })
        await refreshWorkspace(rootHandle)
        void openDirectoryFile(relPath)
      } catch (err) {
        pushToast(t('alert.createProcessFailed', { error: errMsg(err) }), 'error')
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
        pushToast(t('alert.noProcessWithId', { processId }), 'info')
      }
    },
    [processIndex, openDirectoryFile, mode, rootHandle, handleCreateMissingProcess, pushToast]
  )

  // --- tree CRUD ----------------------------------------------------------

  const handleNewProcess = useCallback(
    async (folderRel: string) => {
      if (!rootHandle) return
      const name = await promptText({
        title: t('dialog.newProcess.title'),
        label: t('dialog.newProcess.label'),
        initialValue: t('dialog.newProcess.initialValue'),
        okLabel: t('dialog.newProcess.okLabel'),
        hint: t('dialog.newProcess.hint.directory')
      })
      if (!name) return
      try {
        const relPath = await opMutexRef.current.runExclusive(async () => {
          const taken = await bpmnSlugsIn(rootHandle, folderRel)
          const slug = dedupeSlug(deriveFileBaseName(name), (c) => taken.has(c.toLowerCase()))
          // Also de-dup the derived <process id> against the LIVE process index
          // so ANY id collision (incl. a hash clash for two Arabic names) is
          // suffixed rather than silently cross-wiring their call links (ORIG-6b).
          const doc = buildNewProcessDoc(name, slug, (candidate) => processIndex.has(candidate))
          return createBpmnFileUnique(rootHandle, folderRel, doc.fileBaseName, doc.xml)
        })
        await refreshWorkspace(rootHandle)
        void openDirectoryFile(relPath)
      } catch (err) {
        pushToast(t('alert.createProcessFailed', { error: errMsg(err) }), 'error')
      }
    },
    [rootHandle, promptText, refreshWorkspace, openDirectoryFile, pushToast, processIndex]
  )

  const handleNewProcessFallback = useCallback(async () => {
    const name = await promptText({
      title: t('dialog.newProcess.title'),
      label: t('dialog.newProcess.label'),
      initialValue: t('dialog.newProcess.initialValue'),
      okLabel: t('dialog.newProcess.okLabel'),
      hint: t('dialog.newProcess.hint.fallback')
    })
    if (!name) return
    // Dedup the derived id against the (in-memory) index too, for parity with the
    // directory path (ORIG-6b); in fallback mode the index is empty, so this is a
    // no-op but keeps the two creation paths from drifting.
    const doc = buildNewProcessDoc(name, undefined, (candidate) => processIndex.has(candidate))
    setMode('fallback')
    setPhase('ready')
    openVirtualTab(`${doc.fileBaseName}.bpmn`, doc.xml)
  }, [promptText, openVirtualTab, processIndex])

  const handleNewProcessClick = useCallback(() => {
    if (mode === 'directory' && rootHandle) void handleNewProcess('')
    else void handleNewProcessFallback()
  }, [mode, rootHandle, handleNewProcess, handleNewProcessFallback])

  const handleNewFolder = useCallback(
    async (folderRel: string) => {
      if (!rootHandle) return
      const name = await promptText({
        title: t('dialog.newFolder.title'),
        label: t('dialog.newFolder.label'),
        initialValue: t('dialog.newFolder.initialValue'),
        okLabel: t('dialog.newFolder.okLabel')
      })
      if (!name) return
      try {
        await createFolderAt(rootHandle, folderRel, name.trim())
        await refreshWorkspace(rootHandle)
      } catch (err) {
        pushToast(t('alert.createFolderFailed', { error: errMsg(err) }), 'error')
      }
    },
    [rootHandle, promptText, refreshWorkspace, pushToast]
  )

  const handleRename = useCallback(
    async (node: LiteTreeNode) => {
      if (!rootHandle) return
      const name = await promptText({
        title: t('dialog.rename.title'),
        label: t('dialog.rename.label'),
        initialValue: node.name,
        okLabel: t('dialog.rename.okLabel')
      })
      if (!name || name === node.name) return
      const raw = name.trim()
      if (hasPathSeparator(raw)) {
        pushToast(t('alert.rename.invalidChars'), 'error')
        return
      }
      // Preserve the .bpmn extension for files (auto-append if the user dropped
      // it) so the renamed process never disappears from the .bpmn-only tree.
      const finalName = node.type === 'file' ? ensureBpmnExtension(raw) : raw
      if (finalName === node.name) return
      try {
        // Serialize through the SAME op-mutex as create/import/AI-place so a
        // rename can't interleave its clobber-probe→write with an in-flight
        // in-app create racing for the same name (Codex ORIG-3). `relocate`
        // re-probes the destination immediately before writing, inside this
        // critical section. RESIDUAL LIMITATION: the File System Access API has
        // no atomic create/rename, so an EXTERNAL writer (another app/tab) can
        // still land the same name between our probe and write — unavoidable
        // without native atomicity; documented in STATUS (ORIG-16/atomic-create).
        const res = await opMutexRef.current.runExclusive(() =>
          renameAt(rootHandle, node.relPath, finalName, node.type)
        )
        closeTabsUnder(node.relPath)
        await refreshWorkspace(rootHandle)
        if (res.nonBpmn > 0) {
          pushToast(
            t('toast.renamed.withCount', {
              name: finalName,
              count: res.files,
              nonBpmn: res.nonBpmn
            }),
            'success'
          )
        } else {
          pushToast(t('toast.renamed', { name: finalName }), 'success')
        }
      } catch (err) {
        pushToast(t('alert.renameFailed', { error: errMsg(err) }), 'error')
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
      pushToast(t('toast.deleted', { name: target.node.name }), 'success')
    } catch (err) {
      pushToast(t('alert.deleteFailed', { error: errMsg(err) }), 'error')
    }
  }, [deleteTarget, rootHandle, refreshWorkspace, closeTabsUnder, pushToast])

  // Move (drag-drop onto a folder, or the "Move to…" dialog).
  const performMove = useCallback(
    async (node: LiteTreeNode, toFolderRel: string) => {
      if (!rootHandle) return
      try {
        // Same op-mutex as create/import/AI-place/rename — a move re-probes the
        // destination inside the critical section immediately before writing
        // (Codex ORIG-3). Residual EXTERNAL-writer TOCTOU is unavoidable without
        // FS-API atomic create/rename (documented in STATUS).
        const res = await opMutexRef.current.runExclusive(() =>
          moveAt(rootHandle, node.relPath, toFolderRel, node.type)
        )
        closeTabsUnder(node.relPath)
        await refreshWorkspace(rootHandle)
        const dest = toFolderRel || rootName
        if (res.nonBpmn > 0) {
          pushToast(
            t('toast.moved.withCount', {
              name: node.name,
              dest,
              count: res.files,
              nonBpmn: res.nonBpmn
            }),
            'success'
          )
        } else {
          pushToast(t('toast.moved', { name: node.name, dest }), 'success')
        }
      } catch (err) {
        pushToast(t('alert.moveFailed', { error: errMsg(err) }), 'error')
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
        pushToast(t('toast.import.openFolderFirst'), 'info')
        return
      }
      if (entries.length === 0) {
        pushToast(t('toast.import.noBpmnFound'), 'info')
        return
      }
      let created = 0
      let renamed = 0
      for (const entry of entries) {
        const sub = dirOf(entry.relPath)
        const targetFolder = sub ? joinRel(baseFolderRel, sub) : baseFolderRel
        const base = deriveFileBaseName(entry.name.replace(/\.bpmn$/i, ''))
        try {
          const xml = await entry.getText()
          // Serialize the slug pick + write so two concurrent imports (or an
          // import racing an AI-place) can't both grab the same free slug.
          const relPath = await opMutexRef.current.runExclusive(async () => {
            const taken = await bpmnSlugsIn(rootHandle, targetFolder)
            const guess = dedupeSlug(base, (c) => taken.has(c.toLowerCase()))
            return createBpmnFileUnique(rootHandle, targetFolder, guess, xml)
          })
          created += 1
          const finalBase = baseName(relPath).replace(/\.bpmn$/i, '')
          if (finalBase.toLowerCase() !== base.toLowerCase()) renamed += 1
        } catch {
          /* skip an unreadable entry, keep importing the rest */
        }
      }
      await refreshWorkspace(rootHandle)
      pushToast(
        t('toast.imported.count', { count: created, plural: created === 1 ? '' : 's' }) +
          (renamed > 0 ? t('toast.imported.renamed', { renamed }) : '') +
          '.',
        'success'
      )
    },
    [mode, rootHandle, refreshWorkspace, pushToast]
  )

  const handleImportDrop = useCallback(
    (dt: DataTransfer, toFolderRel: string) => {
      void (async () => {
        try {
          const entries = await collectDroppedBpmn(dt)
          await importEntries(entries, toFolderRel)
        } catch (err) {
          pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
        }
      })()
    },
    [importEntries, pushToast]
  )

  const onImportInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files
      e.target.value = ''
      if (!list || list.length === 0) return
      try {
        const entries: DroppedBpmn[] = Array.from(list)
          .filter((f) => /\.bpmn$/i.test(f.name))
          .map((f) => ({ relPath: f.name, name: f.name, getText: () => f.text() }))
        await importEntries(entries, '')
      } catch (err) {
        pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
      }
    },
    [importEntries, pushToast]
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
      try {
        const xml = await file.text()
        setMode('fallback')
        setPhase('ready')
        openVirtualTab(file.name, xml)
      } catch (err) {
        pushToast(t('alert.open.failed', { error: errMsg(err) }), 'error')
      }
    },
    [openVirtualTab, pushToast]
  )

  const startBlankDiagram = useCallback(() => {
    setMode('fallback')
    setPhase('ready')
    openVirtualTab('untitled.bpmn', createNewDiagramXml())
  }, [openVirtualTab])

  // --- AI placement -------------------------------------------------------

  const placeGenerated = useCallback(
    async (xml: string, opts: { name: string; targetFolder: string; gen?: number }) => {
      const slug = deriveFileBaseName(opts.name || 'process')
      // Validate the workspace generation captured when generation STARTED against
      // the live one, both before enqueuing AND at write time inside the mutex: a
      // folder switch during the (slow) generation must not land the diagram in
      // the switched-in workspace's folder (Codex ORIG-1b). Read the LIVE handle.
      const handle = rootHandleRef.current
      const stale = (): boolean =>
        opts.gen !== undefined && !canCommitToWorkspace(opts.gen, workspaceGenRef.current)
      if (mode === 'directory' && handle) {
        if (stale()) {
          pushToast(t('alert.staleGeneration'), 'error')
          return null
        }
        const result = await opMutexRef.current.runExclusive(async () => {
          // Re-check at write time — a switch could have landed while queued.
          if (stale()) return { stale: true as const }
          const taken = await bpmnSlugsIn(handle, opts.targetFolder)
          const finalSlug = dedupeSlug(slug, (c) => taken.has(c.toLowerCase()))
          return {
            stale: false as const,
            relPath: await createBpmnFileUnique(handle, opts.targetFolder, finalSlug, xml)
          }
        })
        if (result.stale) {
          pushToast(t('alert.staleGeneration'), 'error')
          return null
        }
        await refreshWorkspace(handle)
        void openDirectoryFile(result.relPath)
        return { label: result.relPath }
      }
      openVirtualTab(`${slug}.bpmn`, xml)
      return null
    },
    [mode, refreshWorkspace, openDirectoryFile, openVirtualTab, pushToast]
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
        pushToast(t('toast.print.loading'), 'info')
        return
      }
      try {
        const { svg } = await modeler.saveSVG()
        const folderLabel = tab.relPath
          ? dirOf(tab.relPath) || rootName || t('breadcrumb.root')
          : 'Single-file'
        setPrintJob({ svg, title: tab.title.replace(/\.bpmn$/i, ''), folder: folderLabel })
      } catch (err) {
        pushToast(t('toast.print.failed', { error: errMsg(err) }), 'error')
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
    return <div style={{ padding: '2rem' }}>{t('app.loading')}</div>
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
  const crumbs = activeTab && activeTab.relPath ? folderCrumbs(activeTab.relPath, rootName || t('breadcrumb.root')) : null

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
          <strong style={{ fontSize: 13 }}>{t('app.title')}</strong>
          <span style={{ display: 'inline-flex', gap: 2, marginInlineStart: 6 }}>
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={handleBack}
              disabled={!backEnabled}
              aria-label={t('nav.back')}
              title={t('nav.back.title')}
              style={{ opacity: backEnabled ? 1 : 0.4, padding: '0.2rem 0.45rem' }}
            >
              {lang === 'ar' ? '▶' : '◀'}
            </button>
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={handleForward}
              disabled={!forwardEnabled}
              aria-label={t('nav.forward')}
              title={t('nav.forward.title')}
              style={{ opacity: forwardEnabled ? 1 : 0.4, padding: '0.2rem 0.45rem' }}
            >
              {lang === 'ar' ? '◀' : '▶'}
            </button>
            {mode === 'directory' && (
              <button
                className="orbitpm-lite-chrome-btn"
                onClick={() => setCatalogOpen(true)}
                aria-label={t('app.home')}
                title={t('app.home.title')}
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
              placeholder={t('tree.search.placeholder')}
              aria-label={t('tree.search.aria')}
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
                rootName={rootName || t('breadcrumb.root')}
                onOpen={(rel) => openSearchHit(rel)}
                onClose={() => setSearchOpen(false)}
              />
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto', alignItems: 'center' }}>
          <button
            className="orbitpm-lite-chrome-btn"
            onClick={handleNewProcessClick}
            title={t('app.newProcess.title')}
            style={{
              background: 'var(--orbitpm-accent)',
              color: '#fff',
              borderColor: 'var(--orbitpm-accent)',
              fontWeight: 600
            }}
          >
            {t('app.newProcess')}
          </button>
          {mode === 'directory' ? (
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={() => void handleOpenDifferent()}
              title={t('app.changeFolder.title')}
            >
              {t('app.changeFolder')}
            </button>
          ) : (
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={openFileFromDisk}
              title={t('app.openBpmn.title')}
            >
              {t('app.openBpmn')}
            </button>
          )}
          {aiCollapsed && (
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={() => setAiCollapsed(false)}
              title={t('app.showAi.title')}
            >
              {t('app.showAi')}
            </button>
          )}
          <button
            className="orbitpm-lite-chrome-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('app.settings.title')}
          >
            {t('app.settings')}
          </button>
          <button
            className="orbitpm-lite-chrome-btn"
            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            title={t('app.lang.toggle.title')}
          >
            {lang === 'en' ? t('app.lang.ar') : t('app.lang.en')}
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
            borderInlineEnd: '1px solid var(--orbitpm-border)',
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
                  title={t('tree.newProcess.title')}
                >
                  {t('tree.newProcess')}
                </button>
                <button
                  className="orbitpm-lite-chrome-btn"
                  onClick={() => void handleNewFolder('')}
                  title={t('tree.newFolder.title')}
                  aria-label={t('tree.newFolder.aria')}
                >
                  📁＋
                </button>
                <button
                  className="orbitpm-lite-chrome-btn"
                  onClick={() => importInputRef.current?.click()}
                  title={t('app.import.title')}
                  aria-label={t('app.import')}
                >
                  ⤓ {t('app.import')}
                </button>
                <button
                  className="orbitpm-lite-chrome-btn"
                  onClick={() => void handleManualRefresh()}
                  title={t('tree.refresh.title')}
                  aria-label={t('tree.refresh.aria')}
                >
                  {t('tree.refresh')}
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
              <p style={{ marginTop: 0 }}>{t('fallback.singleFileNote')}</p>
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
                title={t('fallback.newProcess.title')}
              >
                {t('fallback.newProcess')}
              </button>
              <button
                className="orbitpm-lite-chrome-btn"
                style={{ width: '100%', marginBottom: 6 }}
                onClick={openFileFromDisk}
                title={t('fallback.openBpmnFile.title')}
              >
                {t('fallback.openBpmnFile')}
              </button>
              <button
                className="orbitpm-lite-chrome-btn"
                style={{ width: '100%' }}
                onClick={startBlankDiagram}
                title={t('fallback.newBlank.title')}
              >
                {t('fallback.newBlank')}
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
                    title={t('tab.closeTitle')}
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
              aria-label={t('breadcrumb.aria')}
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
                      title={t('app.home.title')}
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
                {t('emptyTab.fallback')}
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
                    <div style={{ padding: '1.5rem', opacity: 0.6 }}>{t('editor.loadingDiagram')}</div>
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
                rootName={rootName || t('breadcrumb.root')}
                onNewProcess={() => void handleNewProcess('')}
                onOpenUnresolved={() => setUnresolvedOpen(true)}
              />
            )}
          </div>
        </section>

        <AiPanelLite
          folders={folders}
          onPlaceGenerated={placeGenerated}
          getWorkspaceGen={() => workspaceGenRef.current}
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
          {mode === 'directory' ? t('footer.folderPrefix', { folderName: rootName }) : t('footer.singleFileMode')}
          {search.trim() && mode === 'directory' && (
            <span>· {tPlural('search.matches', countHits(searchGroups))}</span>
          )}
          {unresolvedCount > 0 && (
            <button
              type="button"
              onClick={() => setUnresolvedOpen(true)}
              title={t('unresolved.badge.title')}
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
              {tPlural('footer.unresolvedLinks', unresolvedCount)}
            </button>
          )}
        </span>
        <span>{t('footer.tagline')}</span>
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
          title={
            deleteTarget.node.type === 'directory'
              ? t('confirmDialog.deleteFolder.title')
              : t('confirmDialog.deleteFile.title')
          }
          danger
          confirmLabel={t('confirmDialog.confirm')}
          requireTyped={deleteTarget.requireTyped}
          message={
            deleteTarget.requireTyped ? (
              <>
                <strong>{deleteTarget.node.name}</strong> {t('confirm.deleteFolder.notEmptyBody')}
              </>
            ) : (
              t('confirm.deleteNode', { name: deleteTarget.node.name })
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

      {switchGuard && (
        <UnsavedSwitchDialog
          count={switchGuard.count}
          onSaveAll={() => resolveSwitch('save')}
          onDiscard={() => resolveSwitch('discard')}
          onCancel={() => resolveSwitch('cancel')}
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
