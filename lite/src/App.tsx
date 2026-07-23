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
import { installLinkBadges, type LinkBadgeModeler } from './links/linkBadges'
import { toggleDiagramLang, type LangToggleModeler } from './editor/langToggle'
import { makeBrowserCallLLM } from './ai/browserAi'
import { LITE_PROVIDERS, defaultLiteModelId } from './ai/providersLite'
import { getKey, hasKey } from './ai/keys'
import {
  collectMissingTranslations,
  translateDiagram,
  type TranslateModeler
} from './ai/translate'
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
import {
  collectDroppedBpmn,
  isInternalDrag,
  isApcName,
  isXmlName,
  looksLikeBpmnXml,
  type DroppedBpmn
} from './workspace/importDrop'
import {
  getProcessOrgProps,
  setProcessOrgProps,
  getProcessDocumentation,
  setProcessDocumentation,
  getOrgProps,
  setOrgProps,
  getLinkedNote,
  setStepNote,
  type OrgModeler,
  type OrgElementLike
} from './org/orgModel'
import { refreshOrgStyling } from './org/orgSettings'
import { StepDetailsDialog, type StepDetailsValues } from './org/StepDetailsDialog'
import { collectOwners } from './owner/ownersIndex'
import { ownersToCsv } from './owner/ownerCsv'
import { AssistantDrawer } from './assist/AssistantDrawer'
import { buildAllDigests, type ProcessDigest } from './assist/digest'
import { buildLibraryZip, zipFileName } from './library/zipExport'
import { readLibraryZip, type LibraryImportResult } from './library/zipImport'
import { convertAmlToBpmnFiles, looksLikeAml } from './library/apcImport'
import { t, tPlural, type Key } from './i18n'
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

/** Map a convertApcToBpmn error code to friendly, localized reason text. */
function apcReason(code: string): string {
  if (code === 'not-aml') return t('apc.reason.notAml')
  if (code === 'no-objects') return t('apc.reason.noObjects')
  if (code === 'no-models') return t('apc.reason.noModels')
  return code
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

/** A single selectable flow node (not a label, connection, or the process/
 *  collaboration root) — the Step-details button uses this to decide between
 *  element mode (exactly one flow node selected) and process mode. */
function isFlowNodeElement(el: OrgElementLike | undefined | null): el is OrgElementLike {
  if (!el) return false
  const type = el.type
  if (typeof type !== 'string' || !type.startsWith('bpmn:')) return false
  if (el.waypoints != null || el.labelTarget != null) return false
  return type !== 'bpmn:Process' && type !== 'bpmn:Collaboration'
}

/** The modeler surface the Step-details dialog needs: the org read/write helpers
 *  (OrgModeler) plus the selection service. */
type StepDetailsModeler = OrgModeler & {
  get(service: 'selection'): { get(): OrgElementLike[] }
}

/** A flow-node / gateway / event shape as reported by the elementRegistry. */
interface PrintShapeElement {
  type?: string
  x: number
  y: number
  width: number
  height: number
  waypoints?: unknown
  labelTarget?: unknown
}

/** Minimal shape of the canvas root's business object we read for the header. */
interface PrintRootBusinessObject {
  $type?: string
  name?: string
  participants?: Array<{ processRef?: { name?: string } | undefined } | undefined>
}

// Structural (never the concrete bpmn-js class) so it stays a local port like the
// other lite modeler shells: saveSVG for the diagram, plus the two services the
// print header needs — the element registry (band-cut rects) and the canvas
// (process display name).
interface ModelerWithSvg {
  saveSVG?: () => Promise<{ svg: string }>
  get(service: 'elementRegistry'): { getAll(): PrintShapeElement[] }
  get(service: 'canvas'): { getRootElement(): { businessObject?: PrintRootBusinessObject } | undefined }
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
  // Per-tab uninstall handles for the "linked" call-activity badge overlays,
  // installed when a tab's modeler is ready and torn down when it is replaced
  // (onModelerReady(null)) or the tab closes.
  const badgeUninstallersRef = useRef<Record<string, () => void>>({})
  const virtualCounter = useRef(0)

  // Data-safety plumbing (Codex C1 / M3 / M8).
  const workspaceGenRef = useRef(0) // bumped on every folder switch (tab-write guard)
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null) // sync mirror for async guards
  const refreshGuardRef = useRef(createRefreshGuard()) // discards stale/out-of-order scans
  const opMutexRef = useRef(createMutex()) // serializes create / import / AI-place writes
  const [switchGuard, setSwitchGuard] = useState<{ count: number } | null>(null)
  const switchResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // The Step-details dialog targets one tab's modeler; the mode (element vs
  // process), the initial values and the target element are all derived LIVE
  // from that modeler's current selection at render time (stepDetailsCtx).
  const [stepDetails, setStepDetails] = useState<{ tabKey: string } | null>(null)
  // Left sidebar (file explorer on top, AI generator on the bottom). Open by
  // default; auto-collapses when a file opens so the canvas takes the full
  // window — EXCEPT for a single tree-row click, which keeps the explorer
  // visible (double-click collapses; see openDirectoryFile's `collapse` opt).
  // The rail restores it. Deliberately NOT persisted — its state follows the
  // open/close flow, and a manual rail click wins until the next open event.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // The AI generator sub-section within the sidebar. Persisted separately so a
  // user who prefers the explorer-only sidebar keeps it collapsed across loads.
  const [aiSectionCollapsed, setAiSectionCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('orbitpm.lite.sidebarAiCollapsed') === '1'
    } catch {
      return false
    }
  })
  const [keysVersion, setKeysVersion] = useState(0)
  // Tab whose diagram is currently being AI-translated (disables its button).
  const [translatingTab, setTranslatingTab] = useState<string | null>(null)
  // A pending "fill gaps in chat" request from the AI panel: opens the
  // assistant's interview mode against the just-placed tab. Token bumps force
  // the drawer to react even for repeated requests on the same tab.
  const [interviewRequest, setInterviewRequest] = useState<{
    token: number
    tabKey: string
    description: string
  } | null>(null)
  const interviewTokenRef = useRef(0)

  const toggleAiSection = useCallback(() => {
    setAiSectionCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('orbitpm.lite.sidebarAiCollapsed', next ? '1' : '0')
      } catch {
        /* storage may be unavailable; the toggle still works for this session */
      }
      return next
    })
  }, [])

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
  const libraryInputRef = useRef<HTMLInputElement | null>(null)

  // Process assistant (B5) + whole-library import confirmation.
  const [assistOpen, setAssistOpen] = useState(false)
  const [libraryImport, setLibraryImport] = useState<LibraryImportResult | null>(null)
  // Memoize the (async) per-workspace digests: rebuilt only when the files
  // identity handed to the assistant changes (see `assistFiles` below), so a
  // repeated question over an unchanged workspace reuses the same parse.
  const digestsCacheRef = useRef<{
    files: Array<{ relPath: string; xml: string }>
    promise: Promise<ProcessDigest[]>
  } | null>(null)

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
      // A freshly-activated workspace has zero tabs (the catalog is showing), so
      // reveal the sidebar — the auto-collapse fires again the moment a file opens.
      setSidebarOpen(true)
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
    async (relPath: string, opts?: { collapse?: boolean }) => {
      const key = relPath
      // Opening a file normally hands the canvas the full window; the rail
      // restores the sidebar. A SINGLE click on a tree row opts out
      // (collapse: false) so browsing the explorer keeps it open — only a
      // double-click (and every non-tree open path: catalog, search, drill-down,
      // AI placement) takes the full window. A manual rail click after this wins
      // until the next collapsing open event.
      if (opts?.collapse !== false) setSidebarOpen(false)
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

  const openVirtualTab = useCallback((title: string, xml: string, opts?: { collapse?: boolean }) => {
    const key = `virtual:${++virtualCounter.current}`
    // Same as openDirectoryFile: an opening tab collapses the sidebar to the
    // rail — EXCEPT when the caller needs the sidebar to survive (AI placement
    // keeps the panel mounted so its success box + fill-gaps CTA can show).
    if (opts?.collapse !== false) setSidebarOpen(false)
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
      // Closing the last tab returns to an empty canvas (or the catalog) — bring
      // the sidebar back so the explorer / AI generator are reachable again.
      if (tabs.filter((t) => t.key !== key).length === 0) setSidebarOpen(true)
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
  // Offered to the AI panel so the model can propose callActivity links to the
  // workspace's existing processes; the two resolvers back the link-verification
  // dialog and the linked-summary line.
  const processCatalog = useMemo(
    () =>
      Array.from(processIndex.entries()).map(([id, e]) => ({
        id,
        name: e.processName || e.relPath
      })),
    [processIndex]
  )
  const isKnownProcess = useCallback((id: string) => processIndex.has(id), [processIndex])
  const resolveProcessName = useCallback(
    (id: string) => {
      const e = processIndex.get(id)
      return e ? e.processName || e.relPath : id
    },
    [processIndex]
  )
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
  // Owner suggestions for the Step-details picker + the "Export owners (CSV)"
  // action — aggregated across every .bpmn in the workspace (empty in fallback).
  const ownersEntries = useMemo(
    () => collectOwners(files.map((f) => ({ relPath: f.relPath, xml: f.xml }))),
    [files]
  )

  // The whole-workspace file list the assistant reasons over in DIRECTORY mode
  // (kept in sync with disk via `files`). Its stable reference keys the digest
  // memo so repeated questions over an unchanged workspace reuse one parse.
  const assistFiles = useMemo<Array<{ relPath: string; xml: string }>>(
    () => files.map((f) => ({ relPath: f.relPath, xml: f.xml })),
    [files]
  )

  const getDigests = useCallback(async (): Promise<ProcessDigest[]> => {
    if (mode === 'directory') {
      const cached = digestsCacheRef.current
      if (cached && cached.files === assistFiles) return cached.promise
      const promise = buildAllDigests(assistFiles)
      digestsCacheRef.current = { files: assistFiles, promise }
      return promise
    }
    // Fallback mode has no folder to scan: read the LIVE modeler XML for each
    // open tab so the assistant sees what is on the canvas NOW (the initial
    // `contents` XML predates any in-canvas edits), falling back to `contents`
    // when a tab's modeler isn't ready yet.
    const collected: Array<{ relPath: string; xml: string }> = []
    for (const tb of tabs) {
      const modeler = modelersByKey[tb.key] as
        | { saveXML?: (o: { format: boolean }) => Promise<{ xml?: string }> }
        | undefined
      let xml = contents[tb.key]
      if (modeler?.saveXML) {
        try {
          const r = await modeler.saveXML({ format: true })
          if (r.xml) xml = r.xml
        } catch {
          /* fall back to the initial contents for this tab */
        }
      }
      if (xml) collected.push({ relPath: tb.title, xml })
    }
    return buildAllDigests(collected)
  }, [mode, assistFiles, tabs, modelersByKey, contents])

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
        // .bpmn, plain .xml (sniffed below) and (experimental) .apc all land as
        // a <base>.bpmn file.
        const base = deriveFileBaseName(entry.name.replace(/\.(bpmn|apc|xml)$/i, ''))
        // One serialized create per output file (slug pick + write inside the
        // shared op-mutex, as everywhere else).
        const writeUnique = (slug: string, xml: string): Promise<string> =>
          opMutexRef.current.runExclusive(async () => {
            const taken = await bpmnSlugsIn(rootHandle, targetFolder)
            const guess = dedupeSlug(slug, (c) => taken.has(c.toLowerCase()))
            return createBpmnFileUnique(rootHandle, targetFolder, guess, xml)
          })
        try {
          const text = await entry.getText()
          // Routing is CONTENT-based: a `.xml` may be BPMN (many tools export
          // BPMN with a .xml extension) OR an ARIS AML database export (the
          // user's DMT exports) — and a mis-labeled `.apc` may equally carry
          // either. Only files that are neither are rejected.
          if (looksLikeBpmnXml(text)) {
            const relPath = await writeUnique(base, text)
            created += 1
            const finalBase = baseName(relPath).replace(/\.bpmn$/i, '')
            if (finalBase.toLowerCase() !== base.toLowerCase()) renamed += 1
          } else if (looksLikeAml(text)) {
            // ARIS AML → one .bpmn per contained EPC model, named from the
            // model's name in the CURRENT app language (bilingual attrs ride
            // along inside the XML either way). A failure skips this file but
            // never aborts the rest of the import.
            const conv = await convertAmlToBpmnFiles(text, { lang })
            if ('error' in conv) {
              pushToast(t('apc.failed', { reason: apcReason(conv.error) }), 'error')
              continue
            }
            for (const model of conv.files) {
              const modelName = (lang === 'ar' ? model.nameAr : model.nameEn) || model.name
              const slug = deriveFileBaseName(modelName || base)
              await writeUnique(slug, model.xml)
              created += 1
            }
            pushToast(
              conv.files.length === 1
                ? t('apc.converted', { name: entry.name })
                : t('apc.convertedMany', { count: conv.files.length, name: entry.name }),
              'success'
            )
          } else if (isXmlName(entry.name)) {
            pushToast(t('import.notBpmnXml', { name: entry.name }), 'error')
            continue
          } else if (isApcName(entry.name)) {
            pushToast(t('apc.failed', { reason: apcReason('not-aml') }), 'error')
            continue
          } else {
            // A .bpmn whose content didn't match the sniff: import it anyway —
            // the pre-sniff behavior — and let the editor surface any problem.
            const relPath = await writeUnique(base, text)
            created += 1
            const finalBase = baseName(relPath).replace(/\.bpmn$/i, '')
            if (finalBase.toLowerCase() !== base.toLowerCase()) renamed += 1
          }
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
    [mode, rootHandle, refreshWorkspace, pushToast, lang]
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
      // `e.target.files` is a LIVE FileList in Chrome: resetting `value` below
      // empties it IN PLACE, so it must be copied into a real array FIRST.
      // (Capturing the list and clearing before the copy made this handler a
      // silent no-op — the "Import does nothing" bug.)
      const files = Array.from(e.target.files ?? [])
      e.target.value = ''
      if (files.length === 0) return
      try {
        const entries: DroppedBpmn[] = files
          .filter((f) => /\.(bpmn|apc|xml)$/i.test(f.name))
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
        // Keep the sidebar (and with it the AI panel) mounted: the success box
        // carries the "fill gaps in chat" CTA, and collapsing here unmounted
        // the panel before it could ever render (found by the interview e2e).
        void openDirectoryFile(result.relPath, { collapse: false })
        return { label: result.relPath }
      }
      openVirtualTab(`${slug}.bpmn`, xml, { collapse: false })
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
        // Band-cut rects: flow-node/gateway/event shapes only — exclude edges
        // (waypoints), external labels (labelTarget), the Process/Collaboration
        // roots and anything without real coordinates (see print/printLayout).
        const shapes = modeler
          .get('elementRegistry')
          .getAll()
          .filter(
            (el) =>
              !el.waypoints &&
              !el.labelTarget &&
              el.type?.startsWith('bpmn:') &&
              el.type !== 'bpmn:Process' &&
              el.type !== 'bpmn:Collaboration' &&
              Number.isFinite(el.x)
          )
          .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }))
        // Process display name for the header: a plain process root uses its own
        // name; a collaboration uses its first participant's referenced process.
        const rootBo = modeler.get('canvas').getRootElement()?.businessObject
        let processName: string | undefined
        if (rootBo?.$type === 'bpmn:Process') {
          processName = rootBo.name || undefined
        } else if (rootBo) {
          processName = rootBo.participants?.[0]?.processRef?.name || undefined
        }
        // Owner line from the process-level org props (orbitpm:owner/ownerType).
        const org = getProcessOrgProps(modeler as unknown as OrgModeler)
        const ownerLine = org.owner
          ? t('print.ownerLine', {
              name: org.owner,
              type: t(`owner.type.${org.ownerType || 'individual'}` as Key)
            })
          : undefined
        setPrintJob({
          svg,
          title: tab.title.replace(/\.bpmn$/i, ''),
          folder: folderLabel,
          processName,
          ownerLine,
          shapes
        })
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
    // Swap the document title so the browser's "Save as PDF" defaults the
    // filename to the process name; restored idempotently on afterprint AND on
    // effect cleanup (whichever runs first) so the tab title never sticks.
    const prevTitle = document.title
    document.title = printJob.processName || printJob.title
    const restoreTitle = (): void => {
      document.title = prevTitle
    }
    const raf = requestAnimationFrame(() => {
      try {
        window.print()
      } catch {
        /* headless / blocked print — the print view is still in the DOM */
      }
    })
    const after = (): void => {
      restoreTitle()
      setPrintJob(null)
    }
    window.addEventListener('afterprint', after)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('afterprint', after)
      restoreTitle()
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

  // --- step details (org pack) --------------------------------------------

  // Derive the dialog's mode + initial values LIVE from the target tab's modeler
  // selection. Exactly one selected flow node → element mode (its org props +
  // linked note + type); anything else → process mode (process org props +
  // documentation + the first start event's trigger). Recomputed only when the
  // target or the modeler map changes; the modal overlay blocks canvas clicks so
  // the selection can't drift while it is open.
  const stepDetailsCtx = useMemo(() => {
    if (!stepDetails) return null
    const raw = modelersByKey[stepDetails.tabKey]
    if (!raw) return null
    const modeler = raw as StepDetailsModeler
    let selection: OrgElementLike[] = []
    try {
      selection = modeler.get('selection').get()
    } catch {
      selection = []
    }
    const single = selection.length === 1 ? selection[0] : undefined
    if (isFlowNodeElement(single)) {
      const org = getOrgProps(single)
      const note = getLinkedNote(modeler, single)?.text ?? ''
      const initial: StepDetailsValues = {
        owner: org.owner ?? '',
        ownerType: org.ownerType ?? '',
        ownerRole: org.ownerRole ?? '',
        note,
        channel: org.channel ?? '',
        channelDetail: org.channelDetail ?? '',
        cc: org.kind === 'cc',
        ccTo: org.ccTo ?? '',
        trigger: org.trigger ?? '',
        triggerService: org.triggerService ?? '',
        triggerDetail: org.triggerDetail ?? '',
        nameEn: org.nameEn ?? '',
        nameAr: org.nameAr ?? '',
        inputs: org.inputs ?? '',
        outputs: org.outputs ?? '',
        system: org.system ?? '',
        respList: org.respList ?? '',
        ccList: org.ccList ?? '',
        decisionBasis: org.decisionBasis ?? ''
      }
      return { mode: 'element' as const, elementType: single.type, initial, element: single, modeler }
    }
    const proc = getProcessOrgProps(modeler)
    const startEvent = modeler
      .get('elementRegistry')
      .getAll()
      .find((el) => el.type === 'bpmn:StartEvent')
    const startProps = startEvent ? getOrgProps(startEvent) : {}
    const initial: StepDetailsValues = {
      owner: proc.owner ?? '',
      ownerType: proc.ownerType ?? '',
      ownerRole: proc.ownerRole ?? '',
      note: getProcessDocumentation(modeler),
      channel: '',
      channelDetail: '',
      cc: false,
      ccTo: '',
      trigger: startProps.trigger ?? '',
      triggerService: startProps.triggerService ?? '',
      triggerDetail: startProps.triggerDetail ?? '',
      // Process mode edits only the bilingual names; the per-step data fields
      // stay blank (the dialog hides them in this mode).
      nameEn: proc.nameEn ?? '',
      nameAr: proc.nameAr ?? '',
      inputs: '',
      outputs: '',
      system: '',
      respList: '',
      ccList: '',
      decisionBasis: ''
    }
    return { mode: 'process' as const, elementType: undefined, initial, element: undefined, modeler }
  }, [stepDetails, modelersByKey])

  const applyStepDetails = useCallback(
    (v: StepDetailsValues) => {
      const ctx = stepDetailsCtx
      if (!ctx) {
        setStepDetails(null)
        return
      }
      const { modeler } = ctx
      try {
        if (ctx.mode === 'element' && ctx.element) {
          // setOrgProps has REPLACE semantics — read the current bag, layer the
          // edited fields on top, and map the CC checkbox onto the `kind` attr.
          const current = getOrgProps(ctx.element)
          setOrgProps(modeler, ctx.element, {
            ...current,
            owner: v.owner,
            ownerType: v.ownerType,
            ownerRole: v.ownerRole,
            channel: v.channel,
            channelDetail: v.channelDetail,
            ccTo: v.ccTo,
            kind: v.cc ? 'cc' : undefined,
            trigger: v.trigger,
            triggerService: v.triggerService,
            triggerDetail: v.triggerDetail,
            nameEn: v.nameEn,
            nameAr: v.nameAr,
            inputs: v.inputs,
            outputs: v.outputs,
            system: v.system,
            respList: v.respList,
            ccList: v.ccList,
            decisionBasis: v.decisionBasis
          })
          // Keep the VISIBLE label coherent with the edited translation for the
          // diagram's active language — otherwise the next language toggle's
          // write-back (visible name wins) would clobber this dialog edit.
          const activeLang = getProcessOrgProps(modeler).activeLang === 'ar' ? 'ar' : 'en'
          const activeName = (activeLang === 'ar' ? v.nameAr : v.nameEn).trim()
          if (activeName) {
            try {
              ;(modeler as unknown as {
                get(s: 'modeling'): { updateProperties(el: unknown, p: Record<string, unknown>): void }
              })
                .get('modeling')
                .updateProperties(ctx.element, { name: activeName })
            } catch {
              /* label sync is best-effort; the attrs above are already saved */
            }
          }
          // The linked TextAnnotation is only touched when the note text changed
          // (setStepNote creates / updates / deletes it as needed).
          if (v.note !== ctx.initial.note) setStepNote(modeler, ctx.element, v.note)
        } else {
          const current = getProcessOrgProps(modeler)
          setProcessOrgProps(modeler, {
            ...current,
            owner: v.owner,
            ownerType: v.ownerType,
            ownerRole: v.ownerRole,
            nameEn: v.nameEn,
            nameAr: v.nameAr
          })
          setProcessDocumentation(modeler, v.note)
          // Process-mode trigger fields land on the FIRST start event, preserving
          // its other org props.
          const startEvent = modeler
            .get('elementRegistry')
            .getAll()
            .find((el) => el.type === 'bpmn:StartEvent')
          if (startEvent) {
            const cur = getOrgProps(startEvent)
            setOrgProps(modeler, startEvent, {
              ...cur,
              trigger: v.trigger,
              triggerService: v.triggerService,
              triggerDetail: v.triggerDetail
            })
          }
        }
        pushToast(t('org.applied'), 'success')
      } catch (err) {
        pushToast(t('org.applyFailed', { error: errMsg(err) }), 'error')
      }
      setStepDetails(null)
    },
    [stepDetailsCtx, pushToast]
  )

  const exportOwners = useCallback(() => {
    const csv = ownersToCsv(ownersEntries)
    triggerDownload('process-owners.csv', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv))
  }, [ownersEntries])

  // --- whole-library export / import (.zip, B5) ---------------------------

  const exportLibrary = useCallback(() => {
    try {
      const csv = ownersToCsv(ownersEntries)
      const data = buildLibraryZip(
        files.map((f) => ({ relPath: f.relPath, xml: f.xml })),
        [{ relPath: 'process-owners.csv', content: csv }]
      )
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }))
      triggerDownload(zipFileName(rootName), url)
      // Revoke once the click-initiated download has grabbed the blob.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      pushToast(t('library.exported', { count: files.length }), 'success')
    } catch (err) {
      pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
    }
  }, [files, ownersEntries, rootName, pushToast])

  const onLibraryInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      try {
        const data = new Uint8Array(await file.arrayBuffer())
        const result = readLibraryZip(data)
        if (result.entries.length === 0) {
          pushToast(t('library.import.empty'), 'info')
          return
        }
        setLibraryImport(result)
      } catch (err) {
        pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
      }
    },
    [pushToast]
  )

  // Create every missing folder segment of a nested rel path (idempotent —
  // createFolderAt returns the existing handle when the folder is already there).
  const ensureFolders = useCallback(
    async (relDir: string) => {
      if (!rootHandle || !relDir) return
      let cur = ''
      for (const seg of relDir.split('/').filter(Boolean)) {
        try {
          await createFolderAt(rootHandle, cur, seg)
        } catch {
          /* already exists / racing external create — continue building the path */
        }
        cur = cur ? `${cur}/${seg}` : seg
      }
    },
    [rootHandle]
  )

  const confirmLibraryImport = useCallback(async () => {
    const result = libraryImport
    setLibraryImport(null)
    if (!result || !rootHandle) return
    let created = 0
    let renamed = 0
    for (const entry of result.entries) {
      const targetFolder = dirOf(entry.relPath)
      const base = deriveFileBaseName(baseName(entry.relPath).replace(/\.bpmn$/i, ''))
      try {
        // Same op-mutex as every other create so a concurrent op can't grab the
        // same free slug; nested folders are ensured inside the critical section.
        const relPath = await opMutexRef.current.runExclusive(async () => {
          await ensureFolders(targetFolder)
          const taken = await bpmnSlugsIn(rootHandle, targetFolder)
          const guess = dedupeSlug(base, (c) => taken.has(c.toLowerCase()))
          return createBpmnFileUnique(rootHandle, targetFolder, guess, entry.xml)
        })
        created += 1
        const finalBase = baseName(relPath).replace(/\.bpmn$/i, '')
        if (finalBase.toLowerCase() !== base.toLowerCase()) renamed += 1
      } catch {
        /* skip a single bad entry, keep importing the rest */
      }
    }
    await refreshWorkspace(rootHandle)
    pushToast(
      t('toast.imported.count', { count: created, plural: created === 1 ? '' : 's' }) +
        (renamed > 0 ? t('toast.imported.renamed', { renamed }) : '') +
        '.',
      'success'
    )
  }, [libraryImport, rootHandle, ensureFolders, refreshWorkspace, pushToast])

  // Settings' org-styling toggle refreshes every live modeler so the renderer
  // re-evaluates its canRender against the just-flipped flag (each guarded so a
  // single mis-shaped modeler can't abort the sweep).
  const handleOrgStylingChanged = useCallback(() => {
    for (const m of Object.values(modelersByKey)) {
      try {
        refreshOrgStyling(m as Parameters<typeof refreshOrgStyling>[0])
      } catch {
        /* a modeler that is mid-teardown has no live services — skip it */
      }
    }
  }, [modelersByKey])

  // Diagram-language toggle (EN⇄AR): swaps every element's visible name with
  // its stored orbitpm:nameEn/nameAr translation (write-back first, so manual
  // edits become the active language's translation). One command-stack entry —
  // undoable, marks the tab dirty. A diagram with no stored translations gets
  // an explanatory toast instead of a silent no-op.
  const handleDiagramLangToggle = useCallback(
    (tabKey: string) => {
      const modeler = modelersByKey[tabKey]
      if (!modeler) return
      try {
        const res = toggleDiagramLang(modeler as LangToggleModeler)
        if (res.switched === 0) pushToast(t('editor.langToggle.missing'), 'info')
      } catch (err) {
        pushToast(errMsg(err), 'error')
      }
    },
    [modelersByKey, pushToast]
  )

  // Translate-with-AI: fill every element's MISSING nameEn/nameAr via the
  // first configured browser-callable provider, writing the translations as
  // orbitpm attrs (they serialize into the .bpmn on the next save — that is
  // what makes the EN⇄AR toggle work on previously monolingual diagrams).
  // The visible labels are untouched; the toggle applies them on demand.
  const handleTranslate = useCallback(
    async (tabKey: string) => {
      const modeler = modelersByKey[tabKey]
      if (!modeler || translatingTab) return
      const provider = LITE_PROVIDERS.find((p) => !p.desktopOnly && hasKey(p.id))
      if (!provider) {
        pushToast(t('translate.noKey'), 'info')
        return
      }
      const entries = collectMissingTranslations(modeler as TranslateModeler)
      if (entries.length === 0) {
        pushToast(t('translate.nothing'), 'info')
        return
      }
      setTranslatingTab(tabKey)
      pushToast(t('translate.running', { count: entries.length }), 'info')
      try {
        const call = makeBrowserCallLLM({
          providerId: provider.id,
          model: defaultLiteModelId(provider.id),
          apiKey: getKey(provider.id) ?? '',
          referer: typeof location !== 'undefined' ? location.origin : undefined,
          title: 'OrbitPM Process Studio Lite'
        })
        const res = await translateDiagram(modeler as TranslateModeler, call)
        if (res.skipped > 0) {
          pushToast(
            t('translate.partial', { done: res.translated, total: res.total, skipped: res.skipped }),
            'info'
          )
        } else {
          pushToast(t('translate.done', { count: res.translated }), 'success')
        }
      } catch (err) {
        pushToast(t('translate.failed', { error: errMsg(err) }), 'error')
      } finally {
        setTranslatingTab(null)
      }
    },
    [modelersByKey, translatingTab, pushToast]
  )

  // Interview apply-path: the assistant regenerated the diagram from the
  // running Q&A — import it into the LIVE modeler of the target tab (bypassing
  // `contents`, which only seeds the initial mount), refit the view, and mark
  // the tab dirty via a benign same-value command (importXML resets the command
  // stack, which would otherwise leave regenerated-but-unsaved work looking
  // "saved" to the close/switch guards).
  const handleApplyInterviewXml = useCallback(
    async (tabKey: string, xml: string) => {
      const modeler = modelersByKey[tabKey] as
        | {
            importXML(x: string): Promise<{ warnings: string[] }>
            get(name: string): unknown
          }
        | undefined
      if (!modeler) throw new Error('editor not ready')
      await modeler.importXML(xml)
      try {
        ;(modeler.get('canvas') as { zoom(m: 'fit-viewport'): void }).zoom('fit-viewport')
      } catch {
        /* zoom is cosmetic */
      }
      try {
        const canvas = modeler.get('canvas') as {
          getRootElement(): { businessObject?: { get?: (k: string) => unknown } }
        }
        const root = canvas.getRootElement()
        const cur = root.businessObject?.get?.('orbitpm:activeLang')
        ;(modeler.get('modeling') as {
          updateProperties(el: unknown, p: Record<string, unknown>): void
        }).updateProperties(root, { 'orbitpm:activeLang': typeof cur === 'string' && cur ? cur : 'en' })
      } catch {
        /* dirty-marking is best-effort; the import itself already landed */
      }
    },
    [modelersByKey]
  )

  // AI panel CTA → open the assistant on the interview tab for the active
  // (just-placed) diagram.
  const handleContinueInChat = useCallback(
    (info: { description: string }) => {
      if (!activeKey) return
      setInterviewRequest({
        token: ++interviewTokenRef.current,
        tabKey: activeKey,
        description: info.description
      })
      setAssistOpen(true)
    },
    [activeKey]
  )

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
      accept=".bpmn,.apc,.xml,application/xml,text/xml"
      multiple
      style={{ display: 'none' }}
      onChange={(e) => void onImportInputChange(e)}
    />
  )
  const hiddenLibraryInput = (
    <input
      ref={libraryInputRef}
      type="file"
      accept=".zip,application/zip"
      style={{ display: 'none' }}
      onChange={(e) => void onLibraryInputChange(e)}
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
          onOrgStylingChanged={handleOrgStylingChanged}
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
      {hiddenLibraryInput}
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
          <button
            className="orbitpm-lite-chrome-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('app.settings.title')}
          >
            {t('app.settings')}
          </button>
          <button
            className="orbitpm-lite-chrome-btn"
            onClick={() => {
              setLang(lang === 'en' ? 'ar' : 'en')
              // Canvas org decorations draw localized titles (Inputs/CC/…) at
              // paint time — poke every live modeler so they repaint in the
              // newly-selected UI language.
              handleOrgStylingChanged()
            }}
            title={t('app.lang.toggle.title')}
          >
            {lang === 'en' ? t('app.lang.ar') : t('app.lang.en')}
          </button>
        </div>
      </header>

      <div
        style={{ display: 'flex', minHeight: 0 }}
        onDragOver={handleAppDragOver}
        onDrop={handleAppDrop}
      >
        {sidebarOpen && (
          <aside
            style={{
              width: 'clamp(240px, 24vw, 320px)',
              borderInlineEnd: '1px solid var(--orbitpm-border)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}
          >
            {/* TOP: file explorer — the directory tree or the fallback block —
                fills the sidebar and scrolls independently of the AI section. */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0.5rem 0' }}>
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
                  onClick={exportLibrary}
                  title={t('library.export.title')}
                  aria-label={t('library.export')}
                >
                  ⬇ {t('library.export')}
                </button>
                <button
                  className="orbitpm-lite-chrome-btn"
                  onClick={() => libraryInputRef.current?.click()}
                  title={t('library.import.title')}
                  aria-label={t('library.import')}
                >
                  ⬆ {t('library.import')}
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
                  // Single click: open but keep the explorer visible. Double
                  // click: open AND collapse the sidebar so the canvas takes the
                  // full window (the first click of the pair already opened the
                  // tab, so this handler only needs to re-activate + collapse).
                  onOpenFile={(rel) => void openDirectoryFile(rel, { collapse: false })}
                  onOpenFileFocus={(rel) => void openDirectoryFile(rel)}
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
            </div>

            {/* BOTTOM: AI generator. The header toggles the section (persisted);
                when open, the embedded AiPanelLite renders only its form body. */}
            <button
              type="button"
              onClick={toggleAiSection}
              aria-expanded={!aiSectionCollapsed}
              title={t('ai.header')}
              style={{
                width: '100%',
                padding: '0.5rem 0.8rem',
                borderTop: '1px solid var(--orbitpm-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'transparent',
                color: 'inherit',
                font: 'inherit',
                cursor: 'pointer'
              }}
            >
              <strong>{t('ai.header')}</strong>
              <span aria-hidden>{aiSectionCollapsed ? (lang === 'ar' ? '◂' : '▸') : '▾'}</span>
            </button>
            {!aiSectionCollapsed && (
              <div style={{ flex: '0 1 auto', maxHeight: '55%', overflowY: 'auto' }}>
                <AiPanelLite
                  embedded
                  folders={folders}
                  onPlaceGenerated={placeGenerated}
                  getWorkspaceGen={() => workspaceGenRef.current}
                  onOpenSettings={() => setSettingsOpen(true)}
                  collapsed={false}
                  onToggle={() => {}}
                  keysVersion={keysVersion}
                  mode={mode}
                  processCatalog={processCatalog}
                  isKnownProcess={isKnownProcess}
                  resolveProcessName={resolveProcessName}
                  onContinueInChat={handleContinueInChat}
                />
              </div>
            )}
          </aside>
        )}

        {/* RAIL: a full-height 16px toggle for the whole sidebar. The chevron
            points toward the action — inward "⟨" to hide when open, outward
            "⟩" to reveal when closed — and mirrors for RTL. */}
        <button
          type="button"
          className="orbitpm-lite-rail"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label={t('sidebar.toggle.aria')}
          aria-expanded={sidebarOpen}
          title={t(sidebarOpen ? 'sidebar.hide.title' : 'sidebar.show.title')}
        >
          <span aria-hidden>
            {lang === 'ar' ? (sidebarOpen ? '⟩' : '⟨') : sidebarOpen ? '⟨' : '⟩'}
          </span>
        </button>

        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
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
                        // Tear down any badge installer from a previous modeler for
                        // this tab before (re)installing on the new one, and on the
                        // null (unmount/replace) path.
                        badgeUninstallersRef.current[tab.key]?.()
                        delete badgeUninstallersRef.current[tab.key]
                        setModelersByKey((prev) => ({ ...prev, [tab.key]: modeler }))
                        if (modeler) {
                          try {
                            badgeUninstallersRef.current[tab.key] = installLinkBadges(
                              modeler as LinkBadgeModeler
                            )
                          } catch {
                            /* overlays service may be unavailable — badges are non-essential */
                          }
                        }
                      }}
                      toolbarExtra={
                        isActive ? (
                          <>
                            <button
                              type="button"
                              className="orbitpm-editor__button"
                              onClick={() => handleDiagramLangToggle(tab.key)}
                              title={t('editor.langToggle.title')}
                            >
                              {t('editor.langToggle')}
                            </button>
                            <button
                              type="button"
                              className="orbitpm-editor__button"
                              onClick={() => void handleTranslate(tab.key)}
                              disabled={translatingTab === tab.key}
                              title={t('editor.translate.title')}
                            >
                              {t('editor.translate')}
                            </button>
                            <PrintButton onPrint={() => void handlePrint(tab)} />
                            <button
                              type="button"
                              className="orbitpm-editor__button"
                              onClick={() => setStepDetails({ tabKey: tab.key })}
                              title={t('editor.stepDetails.title')}
                            >
                              {t('editor.stepDetails')}
                            </button>
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

      {libraryImport && (
        <ConfirmDialog
          title={t('library.import.confirmTitle')}
          confirmLabel={t('library.import.confirm')}
          message={
            <>
              <div>
                {t('library.import.summary', { count: libraryImport.entries.length })}
              </div>
              {libraryImport.skipped.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ color: 'var(--orbitpm-muted)', marginBottom: 4 }}>
                    {t('library.import.skippedNote', { skipped: libraryImport.skipped.length })}
                  </div>
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {libraryImport.skipped.slice(0, 5).map((s) => (
                      <li key={s.path} style={{ color: 'var(--orbitpm-muted)' }}>
                        {s.path} — {t(`library.skip.${s.reason}` as Key)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          }
          onConfirm={() => void confirmLibraryImport()}
          onCancel={() => setLibraryImport(null)}
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

      <AssistantDrawer
        open={assistOpen}
        onOpen={() => setAssistOpen(true)}
        onClose={() => setAssistOpen(false)}
        printing={printJob != null}
        mode={mode}
        keysVersion={keysVersion}
        getDigests={getDigests}
        onOpenProcess={(relPath) => {
          setAssistOpen(false)
          void openDirectoryFile(relPath)
        }}
        interviewRequest={
          interviewRequest
            ? { token: interviewRequest.token, tabKey: interviewRequest.tabKey }
            : null
        }
        getActiveInterviewTarget={() => {
          // Prefer the tab the CTA targeted; fall back to the active tab so a
          // manual visit to the interview tab can still bind to an open diagram.
          const key = interviewRequest?.tabKey ?? activeKey
          if (!key) return null
          const modeler = modelersByKey[key]
          if (!modeler) return null
          return { tabKey: key, modeler, description: interviewRequest?.description ?? '' }
        }}
        onApplyXml={handleApplyInterviewXml}
      />

      {stepDetailsCtx && (
        <StepDetailsDialog
          mode={stepDetailsCtx.mode}
          elementType={stepDetailsCtx.elementType}
          initial={stepDetailsCtx.initial}
          ownerEntries={ownersEntries}
          onApply={applyStepDetails}
          onCancel={() => setStepDetails(null)}
          onExportOwners={exportOwners}
        />
      )}

      <SettingsDialogLite
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          setKeysVersion((v) => v + 1)
        }}
        onKeysChanged={() => setKeysVersion((v) => v + 1)}
        onOrgStylingChanged={handleOrgStylingChanged}
      />
    </div>
  )
}

export default App
