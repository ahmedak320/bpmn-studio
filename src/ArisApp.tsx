import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ICON_DATA_URI } from './branding/icon'
import { ProcessTabList, processTabId, processTabPanelId } from './common/ProcessTabList'
import { PaneResizer, usePaneWidth } from './common/PaneResizer'
import { PromptProvider } from './common/prompt'
import {
  classifyPickerError,
  directoryPickerSupported,
  ensurePermission,
  loadRememberedWorkspace,
  pickWorkspace,
  rememberWorkspace
} from './fs/workspaceHandle'
import { t } from './i18n'
import { setLang, useLang } from './i18n/useLang'
import { SettingsDialogLite } from './settings/SettingsDialogLite'
import { ArisGenerationPanel } from './ArisGenerationPanel'
import { ResponsiveDrawer, ResponsiveShell, useResponsiveShellMode } from './shell'
import { Toaster, type ToastMsg, type ToastTone } from './workspace/Toaster'
import { WorkspacePickerLite, type PickerMode } from './workspace/WorkspacePickerLite'
import {
  type FileSnapshot,
  type WorkspaceAdapter,
  type WorkspaceEntry,
  type WorkspaceMode
} from './workspace/adapters/types'
import { DirectoryWorkspaceAdapter } from './workspace/adapters/directory'
import { sha256Hex } from './workspace/adapters/hash'
import { OpfsWorkspaceAdapter, opfsSupported } from './workspace/adapters/opfs'
import { SingleFileWorkspaceAdapter } from './workspace/adapters/singleFile'
import { classifyImportBoundarySource } from './workspace/importDrop'
import {
  createWorkspaceLocalizationStore,
  type WorkspaceLocalizationStore
} from './localization/workspaceStore'
import type { LocalizationResources } from './localization/types'
import { buildLiteTreeFromEntries, uniquePathIn } from './workspace/liteTreeFromEntries'
import { buildProcessHierarchy, type HierarchyNavigation } from './workspace/processHierarchy'
import type { TreeRevealRequest } from './workspace/FolderTreeLite'
import {
  createArisLinkScanCache,
  scanArisWorkspaceLinks,
  mergeArisLinkState,
  deriveArisLinksFromDocument,
  EMPTY_ARIS_LINK_STATE,
  type ArisWorkspaceLinkState
} from './aris/links/arisWorkspaceLinks'
import type { ArisModelScanResult } from './aris/links/arisModelScan'
import type { ArisExplorerTabsController } from './aris/shell/arisExplorerActions'
import { ArisNewModelDialog } from './aris/shell/ArisNewModelDialog'
import { buildBlankArisAml, deriveArisSourceFileName } from './aris/shell/arisBlankModel'
import type { ArisBlankModelType } from './aris/shell/arisBlankModel'
import { createArisXmlSourcePackage, type ArisXmlSourcePackage } from './aris/source/sourcePackage'
import {
  prepareArisSplitImport,
  executeArisSplitImport,
  type ArisSplitImportPlan,
  type ArisSplitImportTarget
} from './aris/shell/arisSplitImport'
import { ArisSplitImportDialog } from './aris/shell/ArisSplitImportDialog'
import type { ArisOpenAssignedModelRequest } from './aris/shell/ArisStudioTab'
import {
  ArisChatDrawer,
  ArisExplorerPane,
  ArisImportReviewDialog,
  ArisStudioTab,
  AssistantIndexCache,
  buildArisAssistantDigests,
  buildArisStudioDocument,
  commitArisWorkspaceImport,
  prepareArisWorkspaceImport,
  tk,
  type ArisChatDrawerTarget,
  type ArisChatInterviewRequest,
  type ArisPreparedImport,
  type ArisSelectionRequest,
  type ArisStudioDocument,
  type ArisTabChatHost
} from './aris/shell'
import type { ArisAnswerChip } from './aris/assistant/answer'

type Phase = 'loading' | 'need-open' | 'need-reconnect' | 'ready'

type ArisSourceKind = 'aml' | 'apc' | 'xml' | 'generated'

interface ArisTab {
  key: string
  title: string
  relPath: string | null
  sourceKind: ArisSourceKind
  content: string
  bytes: Uint8Array
  sha256: string
  mimeType?: string
  rootElementName?: string | null
  xmlTokenCount?: number
  xmlNodeCount?: number
  doctypeExternalId?: string | null
  modelCount?: number
  objectDefinitionCount?: number
  objectOccurrenceCount?: number
  connectionDefinitionCount?: number
  connectionOccurrenceCount?: number
  attributeCount?: number
  diagnosticCount?: number
  unknownRecordCount?: number
  /**
   * The lossless source package this tab was opened from. Kept so an import
   * into the workspace package store re-uses the exact imported bytes and the
   * exact semantic index that produced the on-canvas document — §7.3 refuses to
   * stage a source that was not parsed and indexed.
   */
  pkg?: ArisXmlSourcePackage
  /**
   * Everything the mounted shell renders: working document, render/fidelity
   * report, details projection and complete source accounting. `undefined` for
   * a source with no ARIS records (an empty AML shell or a generated draft).
   */
  studio?: ArisStudioDocument
}

function pushSortedSources(entries: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function isVisibleWorkspaceSource(entry: WorkspaceEntry): boolean {
  return (
    entry.kind === 'file' &&
    /\.(?:aml|apc|xml|bpmn)$/iu.test(entry.name) &&
    !entry.path.startsWith('.orbitpm/')
  )
}

function inferSourceKind(name: string, generated = false): ArisSourceKind {
  if (generated) return 'generated'
  if (/\.aml$/iu.test(name)) return 'aml'
  if (/\.apc$/iu.test(name)) return 'apc'
  return 'xml'
}

function rootLabel(mode: WorkspaceMode, adapter: WorkspaceAdapter | null): string {
  if (mode === 'directory') return adapter?.id.replace(/^directory:/u, '') ?? t('breadcrumb.root')
  if (mode === 'opfs') return t('workspace.storage.mode.opfs')
  return t('workspace.storage.mode.singleFile')
}

export function downloadBytes(
  fileName: string,
  bytes: Uint8Array,
  mimeType = 'application/xml'
): void {
  // `bytes` is typed `Uint8Array` without a pinned buffer type parameter, so
  // TS 5.7's stricter `BlobPart` (which requires an `ArrayBuffer`-backed
  // view, not the wider `ArrayBufferLike` that also covers
  // `SharedArrayBuffer`) rejects it directly. `.slice()` with no arguments
  // copies the full byte range into a fresh, always-`ArrayBuffer`-backed
  // `Uint8Array` — same bytes, same length, and a type Blob accepts without
  // a cast.
  const blob = new Blob([bytes.slice()], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function snapshotToTab(snapshot: FileSnapshot, text: string): ArisTab {
  return {
    key: `source:${snapshot.path}`,
    title: snapshot.path.split('/').pop() ?? snapshot.path,
    relPath: snapshot.path,
    sourceKind: inferSourceKind(snapshot.path),
    content: text,
    bytes: snapshot.bytes,
    sha256: snapshot.hash,
    mimeType: snapshot.mimeType,
    rootElementName: null,
    xmlTokenCount: undefined,
    xmlNodeCount: undefined,
    doctypeExternalId: null,
    modelCount: undefined,
    objectDefinitionCount: undefined,
    objectOccurrenceCount: undefined,
    connectionDefinitionCount: undefined,
    connectionOccurrenceCount: undefined,
    attributeCount: undefined,
    diagnosticCount: undefined,
    unknownRecordCount: undefined
  }
}

function generatedToTab(name: string, xml: string, bytes: Uint8Array, sha256: string): ArisTab {
  return {
    key: `generated:${sha256}`,
    title: name.trim() || t('aris.generated.fallbackName'),
    relPath: null,
    sourceKind: 'generated',
    content: xml,
    bytes,
    sha256,
    mimeType: 'application/xml'
  }
}

function upsertTab(current: readonly ArisTab[], next: ArisTab): ArisTab[] {
  const index = current.findIndex((candidate) => candidate.key === next.key)
  if (index === -1) return [...current, next]
  const copy = [...current]
  copy[index] = next
  return copy
}

/** The workspace-relative folder holding `relPath` ('' for a root-level file). */
function parentFolderOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? '' : relPath.slice(0, index)
}

/** A human name for a dangling model id: the `Model.` prefix is dropped. */
function humanizeModelId(modelId: string): string {
  return modelId.replace(/^Model\./u, '')
}

function pickerErrorMessage(code: ReturnType<typeof classifyPickerError>): string {
  switch (code) {
    case 'security':
      return t('alert.picker.security')
    case 'not-allowed':
      return t('alert.picker.notAllowed')
    default:
      return t('alert.picker.unknown')
  }
}

export default function ArisApp(): JSX.Element {
  const lang = useLang()
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'
  const responsiveMode = useResponsiveShellMode()
  const [sidebarWidth, setSidebarWidth, resetSidebarWidth] = usePaneWidth(
    'orbitpm-aris-shell.sidebar-width',
    { min: 240, max: 520 }
  )
  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<WorkspaceMode>('single-file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  // Bumped whenever Settings closes after a key change; passed to the chat
  // drawer so its provider/key read (which gates the §17.5 AI offer) re-runs
  // after credentials change.
  const [keysVersion, setKeysVersion] = useState(0)
  const [workspaceAdapter, setWorkspaceAdapter] = useState<WorkspaceAdapter | null>(null)
  const [workspaceSources, setWorkspaceSources] = useState<WorkspaceEntry[]>([])
  /**
   * The unfiltered `adapter.list()` result (directory entries included). The
   * folder tree is built from this; `workspaceSources` stays filtered to the
   * visible ARIS/BPMN files the flat single-file block and footer count show.
   */
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([])
  const [tabs, setTabs] = useState<ArisTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [rememberedName, setRememberedName] = useState<string | undefined>(undefined)
  const [toasts, setToasts] = useState<ToastMsg<string>[]>([])
  /** Which model each open source is showing. Keyed by tab key. */
  const [activeModelByTab, setActiveModelByTab] = useState<Record<string, string>>({})
  const [preparedImport, setPreparedImport] = useState<ArisPreparedImport | null>(null)
  /**
   * A staged multi-file split-import awaiting the user's review. Confirming
   * writes one `.aml` per model under the group folder; cancelling writes
   * nothing. `null` when no split import is pending.
   */
  const [splitImportPlan, setSplitImportPlan] = useState<ArisSplitImportPlan | null>(null)
  const [splitImportBusy, setSplitImportBusy] = useState(false)
  /**
   * The open "New model" request. `folderRel` is the multi-file folder target,
   * or `null` when there is no writable multi-file destination (single-file /
   * picker phase) — the dialog only reads it to pick its hint copy.
   */
  const [newModelRequest, setNewModelRequest] = useState<{
    folderRel: string | null
    /**
     * When set, the created model is forced to this source id so a dangling
     * cross-file assignment resolves the moment the child is written — no parent
     * edit is needed. Only the multi-file create-missing flow supplies it.
     */
    forcedModelId?: string
    presetName?: string
    linkContext?: string
  } | null>(null)
  /**
   * The public workspace glossary + translation memory, loaded once per bound
   * multi-file adapter. `null` in single-file mode (and until a load lands),
   * which the translation review reads as "built-in glossary + empty memory".
   */
  const [localizationResources, setLocalizationResources] = useState<LocalizationResources | null>(
    null
  )
  const localizationStoreRef = useRef<WorkspaceLocalizationStore | null>(null)
  /** The §17.6 chip request the active tab must honour, if any. */
  const [selectionRequest, setSelectionRequest] = useState<ArisSelectionRequest | null>(null)
  const selectionTokenRef = useRef(0)
  // §17.2: one cache for the session, so an unchanged model keeps its digest.
  const assistantIndexRef = useRef(new AssistantIndexCache())
  const [importBusy, setImportBusy] = useState(false)
  const openFileInputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const rememberedHandleRef = useRef<FileSystemDirectoryHandle | null>(null)

  const directoryAvailable = directoryPickerSupported()
  const opfsAvailable = opfsSupported()
  const pickerMode: PickerMode =
    phase === 'need-reconnect' ? 'reconnect' : directoryAvailable ? 'open' : 'fallback'

  const activeTab = useMemo(
    () => tabs.find((candidate) => candidate.key === activeKey) ?? null,
    [activeKey, tabs]
  )

  // Each mounted ArisStudioTab registers its live chat host here (keyed by tab
  // key); the drawer reads the ACTIVE tab's host to run its interview against
  // the on-canvas document.
  const chatHostsRef = useRef(new Map<string, ArisTabChatHost>())
  const registerChatHost = useCallback((key: string, host: ArisTabChatHost | null) => {
    if (host) chatHostsRef.current.set(key, host)
    else chatHostsRef.current.delete(key)
  }, [])
  // Render-time mirrors so the stable callbacks below read the latest active tab
  // and tab list without being re-created (and re-subscribing the drawer) on
  // every keystroke.
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  // The active source's workspace path, mirrored so the (stable) assignment
  // handlers can read it without being re-created on every tab switch.
  const activeTabRelPathRef = useRef<string | null>(null)
  activeTabRelPathRef.current = activeTab?.relPath ?? null
  const interviewTokenRef = useRef(0)
  const [interviewRequest, setInterviewRequest] = useState<ArisChatInterviewRequest | null>(null)
  const getActiveChatTarget = useCallback((): ArisChatDrawerTarget | null => {
    const key = activeKeyRef.current
    if (!key) return null
    const host = chatHostsRef.current.get(key)
    const tab = tabsRef.current.find((candidate) => candidate.key === key)
    return host && tab ? { tabKey: key, title: tab.title, host } : null
  }, [])
  const handleContinueInChat = useCallback(() => {
    const tabKey = activeKeyRef.current
    if (!tabKey) return
    interviewTokenRef.current += 1
    setInterviewRequest({ token: interviewTokenRef.current, tabKey })
    setAssistantOpen(true)
  }, [])

  /**
   * The model a tab shows: the user's explicit pick when it is still valid,
   * otherwise the first model the canvas can actually render.
   */
  const activeModelIdForTab = useCallback(
    (tab: ArisTab): string | null => {
      const chosen = activeModelByTab[tab.key]
      if (chosen && tab.studio?.models.some((model) => model.id === chosen)) return chosen
      return (
        tab.studio?.models.find((model) => model.renderable)?.id ??
        tab.studio?.models[0]?.id ??
        null
      )
    },
    [activeModelByTab]
  )

  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id =
      typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts((current) => [...current, { id, text: message, tone }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  /**
   * Persist an accepted bilingual pair to the workspace translation memory
   * (fire-and-forget). A missing store (single-file) is a no-op; a write
   * failure is surfaced as a toast only — the applied translation still stands.
   */
  const handleAcceptedTranslationPair = useCallback(
    (pair: { en: string; ar: string }) => {
      const store = localizationStoreRef.current
      if (!store) return
      void (async () => {
        try {
          const state = await store.acceptTranslationPair(pair)
          if (localizationStoreRef.current === store) setLocalizationResources(state.resources)
        } catch (error) {
          pushToast(
            tk(
              'aris.translate.memoryFailed',
              'The translation could not be saved to memory: {error}',
              {
                error: error instanceof Error ? error.message : String(error)
              }
            ),
            'error'
          )
        }
      })()
    },
    [pushToast]
  )

  const multiFile = workspaceAdapter?.storage.capabilities.multipleFiles === true

  // A workspace-wide ARIS link scan turns the flat file listing into the process
  // index + hierarchy graph the folder tree nests owned subprocesses by. The
  // cache reuses unchanged files across rescans; per-file read/decode failures
  // are swallowed by the scanner so one bad file cannot break the whole tree.
  const arisLinkScanCacheRef = useRef(createArisLinkScanCache())
  const [arisLinkScanState, setArisLinkScanState] =
    useState<ArisWorkspaceLinkState>(EMPTY_ARIS_LINK_STATE)
  // Live per-tab overlays: an open canvas's edited links replace that file's
  // scanned contribution without a re-read. The PRODUCER is wired in a later
  // wave — here only the state and the merge exist, ready for a caller.
  const [liveScanOverlays, setLiveScanOverlays] = useState<Map<string, ArisModelScanResult>>(
    () => new Map()
  )

  useEffect(() => {
    if (!multiFile || !workspaceAdapter) {
      setArisLinkScanState(EMPTY_ARIS_LINK_STATE)
      return
    }
    let cancelled = false
    void (async () => {
      const state = await scanArisWorkspaceLinks(
        workspaceAdapter,
        workspaceEntries,
        arisLinkScanCacheRef.current
      )
      if (!cancelled) setArisLinkScanState(state)
    })()
    return () => {
      cancelled = true
    }
  }, [multiFile, workspaceAdapter, workspaceEntries])

  const handleLiveScanChange = useCallback(
    (relPath: string, result: ArisModelScanResult | null) => {
      setLiveScanOverlays((current) => {
        if (result === null) {
          if (!current.has(relPath)) return current
          const next = new Map(current)
          next.delete(relPath)
          return next
        }
        const existing = current.get(relPath)
        // A move/resize that leaves the link shape identical must not churn the
        // whole tree, so bail out on an unchanged JSON signature.
        if (existing && JSON.stringify(existing) === JSON.stringify(result)) return current
        const next = new Map(current)
        next.set(relPath, result)
        return next
      })
    },
    []
  )
  // The live-overlay producer is wired in a later wave; a stable ref keeps the
  // setter reachable from that wave's canvas host without re-subscribing it.
  const liveScanChangeRef = useRef(handleLiveScanChange)
  liveScanChangeRef.current = handleLiveScanChange

  const mergedLinks = useMemo(
    () => mergeArisLinkState(arisLinkScanState, liveScanOverlays),
    [arisLinkScanState, liveScanOverlays]
  )

  /**
   * Turn a batch of parsed ARIS sources into ONE combined split-import plan:
   * every model becomes its own `.aml` under the group folder, models that
   * already exist in the workspace (or that a duplicate id made ambiguous) are
   * marked skipped, and paths are threaded through a shared `taken` set so no
   * two staged files collide. A source with zero models is not staged — its name
   * is returned in `emptyNames` so a drop caller can fall back to a verbatim
   * write and the import-input caller can toast "nothing found".
   */
  const stageSplitImportBatch = useCallback(
    async (
      sources: readonly { name: string; bytes: Uint8Array; mimeType?: string }[],
      baseFolderRel: string
    ): Promise<{ plan: ArisSplitImportPlan | null; staged: Set<string>; emptyNames: string[] }> => {
      const existingModelIds = new Set<string>([
        ...mergedLinks.index.keys(),
        ...mergedLinks.graph.ambiguousProcessIds
      ])
      const taken = new Set(workspaceEntries.map((entry) => entry.path))
      const staged = new Set<string>()
      const emptyNames: string[] = []
      const targets: ArisSplitImportTarget[] = []
      let sourceName = ''
      for (const source of sources) {
        const pkg = await createArisXmlSourcePackage({
          name: source.name,
          relPath: null,
          bytes: source.bytes,
          mimeType: source.mimeType
        })
        if (pkg.index.models.size === 0) {
          emptyNames.push(source.name)
          continue
        }
        const partial = prepareArisSplitImport({
          pkg,
          baseFolderRel,
          takenPaths: taken,
          existingModelIds
        })
        for (const target of partial.targets) {
          targets.push(target)
          if (target.status === 'write') {
            taken.add(target.relPath)
            // A later source in the same batch that re-declares this id must skip
            // it, exactly as a re-import against the committed workspace would.
            existingModelIds.add(target.modelId)
          }
        }
        staged.add(source.name)
        if (!sourceName) sourceName = source.name
      }
      if (targets.length === 0) return { plan: null, staged, emptyNames }
      const writeCount = targets.filter((target) => target.status === 'write').length
      const plan: ArisSplitImportPlan = {
        sourceName,
        targets,
        writeCount,
        skipCount: targets.length - writeCount
      }
      return { plan, staged, emptyNames }
    },
    [mergedLinks, workspaceEntries]
  )

  // The physical folder tree for directory/OPFS workspaces, nested by the merged
  // scan: owned subprocess files move under their owner, reused ones become
  // read-only reference rows.
  const explorerTree = useMemo(
    () =>
      multiFile
        ? buildLiteTreeFromEntries(workspaceEntries, rootLabel(mode, workspaceAdapter))
        : null,
    [multiFile, mode, workspaceAdapter, workspaceEntries]
  )
  const explorerHierarchy = useMemo(
    () =>
      explorerTree
        ? buildProcessHierarchy(explorerTree, mergedLinks.index, mergedLinks.graph)
        : null,
    [explorerTree, mergedLinks]
  )

  // Rename/move keep an open tab pointing at the new path WITHOUT changing
  // `tab.key` (a key change remounts the canvas and destroys undo history);
  // delete closes any tab at or under the removed node and repairs activeKey the
  // way ProcessTabList's onClose does.
  const closeTabsUnder = useCallback((path: string, kind: 'file' | 'directory') => {
    const matches = (relPath: string | null): boolean =>
      relPath !== null &&
      (kind === 'directory' ? relPath === path || relPath.startsWith(`${path}/`) : relPath === path)
    let closedKeys = new Set<string>()
    let neighborKey: string | null = null
    setTabs((current) => {
      const firstIndex = current.findIndex((tab) => matches(tab.relPath))
      if (firstIndex === -1) return current
      const remaining = current.filter((tab) => !matches(tab.relPath))
      closedKeys = new Set(current.filter((tab) => matches(tab.relPath)).map((tab) => tab.key))
      neighborKey =
        remaining.length === 0
          ? null
          : (remaining[Math.min(firstIndex, remaining.length - 1)]?.key ??
            remaining[0]?.key ??
            null)
      return remaining
    })
    setActiveKey((current) => (current !== null && closedKeys.has(current) ? neighborKey : current))
    // A removed source can no longer contribute a live overlay: drop any overlay
    // at or under the removed node so the tree stops nesting by it.
    setLiveScanOverlays((current) => {
      let next: Map<string, ArisModelScanResult> | null = null
      for (const overlayPath of current.keys()) {
        if (!matches(overlayPath)) continue
        if (!next) next = new Map(current)
        next.delete(overlayPath)
      }
      return next ?? current
    })
  }, [])

  const remapTabs = useCallback((from: string, to: string, kind: 'file' | 'directory') => {
    setTabs((current) => {
      let changed = false
      const next = current.map((tab) => {
        if (tab.relPath === null) return tab
        let nextRel: string | null = null
        if (tab.relPath === from) nextRel = to
        else if (kind === 'directory' && tab.relPath.startsWith(`${from}/`)) {
          nextRel = to + tab.relPath.slice(from.length)
        }
        if (nextRel === null) return tab
        changed = true
        return { ...tab, relPath: nextRel, title: nextRel.split('/').pop() ?? tab.title }
      })
      return changed ? next : current
    })
    // Keep a live overlay pointing at the source's NEW path so a rename/move does
    // not drop the open canvas's contribution from the scan.
    setLiveScanOverlays((current) => {
      let next: Map<string, ArisModelScanResult> | null = null
      for (const [overlayPath, result] of current) {
        let nextPath: string | null = null
        if (overlayPath === from) nextPath = to
        else if (kind === 'directory' && overlayPath.startsWith(`${from}/`)) {
          nextPath = to + overlayPath.slice(from.length)
        }
        if (nextPath === null) continue
        if (!next) next = new Map(current)
        next.delete(overlayPath)
        next.set(nextPath, result)
      }
      return next ?? current
    })
  }, [])

  const explorerTabsController = useMemo<ArisExplorerTabsController>(
    () => ({ closeUnder: closeTabsUnder, remap: remapTabs }),
    [closeTabsUnder, remapTabs]
  )

  const refreshWorkspaceSources = useCallback(async (adapter: WorkspaceAdapter) => {
    if (!adapter.storage.capabilities.multipleFiles) {
      const listed = await adapter.list()
      setWorkspaceEntries(listed)
      setWorkspaceSources(listed)
      return
    }
    const listed = await adapter.list('', { maxEntries: 2_500, maxDepth: 32 })
    setWorkspaceEntries(listed)
    setWorkspaceSources(pushSortedSources(listed.filter(isVisibleWorkspaceSource)))
  }, [])

  const activateAdapter = useCallback(
    async (adapter: WorkspaceAdapter) => {
      setWorkspaceAdapter(adapter)
      setMode(adapter.mode)
      await refreshWorkspaceSources(adapter)
      setPhase('ready')
      setError(null)
      setExplorerOpen(true)
    },
    [refreshWorkspaceSources]
  )

  const openTab = useCallback((tab: ArisTab) => {
    setTabs((current) => upsertTab(current, tab))
    setActiveKey(tab.key)
  }, [])

  const openImportedBytes = useCallback(
    async (name: string, relPath: string | null, bytes: Uint8Array, mimeType?: string) => {
      const sourcePackage = await createArisXmlSourcePackage({
        name,
        relPath,
        bytes,
        mimeType
      })
      const text = sourcePackage.text
      if (classifyImportBoundarySource(name, text) === 'reject-bpmn') {
        pushToast(t('toast.import.arisOnly'))
        return false
      }
      // Only past the BPMN boundary do we build the working document, render
      // model, details projection and accounting report: a rejected file must
      // cost the workspace nothing at all.
      const studio = buildArisStudioDocument(sourcePackage)
      const shellFields = { pkg: sourcePackage, studio }
      openTab(
        relPath
          ? {
              ...shellFields,
              ...snapshotToTab(
                {
                  path: relPath,
                  bytes,
                  hash: sourcePackage.sha256,
                  size: bytes.byteLength,
                  modifiedAt: 0,
                  mimeType
                },
                text
              ),
              rootElementName: sourcePackage.document.rootElementName,
              xmlTokenCount: sourcePackage.document.tokens.length,
              xmlNodeCount: sourcePackage.document.nodeCount,
              doctypeExternalId: sourcePackage.document.doctype?.externalIdLiteral ?? null,
              modelCount: sourcePackage.index.models.size,
              objectDefinitionCount: sourcePackage.index.objectDefinitions.size,
              objectOccurrenceCount: sourcePackage.index.objectOccurrences.size,
              connectionDefinitionCount: sourcePackage.index.connectionDefinitions.size,
              connectionOccurrenceCount: sourcePackage.index.connectionOccurrences.size,
              attributeCount: sourcePackage.index.attributes.length,
              diagnosticCount: sourcePackage.diagnostics.length,
              unknownRecordCount: sourcePackage.index.unknownRecords.length
            }
          : {
              ...shellFields,
              key: `source:${name}:${sourcePackage.sha256}`,
              title: name,
              relPath: null,
              sourceKind: inferSourceKind(name),
              content: text,
              bytes,
              sha256: sourcePackage.sha256,
              mimeType,
              rootElementName: sourcePackage.document.rootElementName,
              xmlTokenCount: sourcePackage.document.tokens.length,
              xmlNodeCount: sourcePackage.document.nodeCount,
              doctypeExternalId: sourcePackage.document.doctype?.externalIdLiteral ?? null,
              modelCount: sourcePackage.index.models.size,
              objectDefinitionCount: sourcePackage.index.objectDefinitions.size,
              objectOccurrenceCount: sourcePackage.index.objectOccurrences.size,
              connectionDefinitionCount: sourcePackage.index.connectionDefinitions.size,
              connectionOccurrenceCount: sourcePackage.index.connectionOccurrences.size,
              attributeCount: sourcePackage.index.attributes.length,
              diagnosticCount: sourcePackage.diagnostics.length,
              unknownRecordCount: sourcePackage.index.unknownRecords.length
            }
      )
      return true
    },
    [openTab, pushToast]
  )

  const handleOpenWorkspaceFile = useCallback(
    async (path: string) => {
      const adapter = workspaceAdapter
      if (!adapter) return
      // A source is identified by its workspace relPath: reopening one that is
      // already open re-activates that tab (its key never changed on rename).
      const existing = tabs.find((tab) => tab.relPath === path)
      if (existing) {
        setActiveKey(existing.key)
        return
      }
      try {
        const snapshot = await adapter.read(path)
        await openImportedBytes(
          path.split('/').pop() ?? path,
          path,
          snapshot.bytes,
          snapshot.mimeType
        )
      } catch (openError) {
        pushToast(String(openError), 'error')
      }
    },
    [openImportedBytes, pushToast, tabs, workspaceAdapter]
  )

  const handleRefreshWorkspace = useCallback(async () => {
    if (workspaceAdapter) await refreshWorkspaceSources(workspaceAdapter)
  }, [refreshWorkspaceSources, workspaceAdapter])

  const handleOpenFileFocus = useCallback(
    (relPath: string) => {
      void handleOpenWorkspaceFile(relPath)
      if (responsiveMode !== 'docked') setExplorerOpen(false)
    },
    [handleOpenWorkspaceFile, responsiveMode]
  )

  // Open the "New model" dialog. `folderRel` is '' for the workspace root; it is
  // only meaningful in a multi-file workspace, so single-file/picker sessions
  // carry `null` and fall back to an in-memory tab.
  const handleNewModel = useCallback(
    (folderRel: string) => {
      setNewModelRequest({ folderRel: multiFile ? folderRel : null })
    },
    [multiFile]
  )

  const handleOpenFolder = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const handle =
        phase === 'need-reconnect' && rememberedHandleRef.current
          ? rememberedHandleRef.current
          : await pickWorkspace()
      if (!handle) return
      const permission = await ensurePermission(handle, true)
      if (permission !== 'granted') {
        setError(t('alert.permissionNotGranted.open'))
        return
      }
      await rememberWorkspace(handle)
      rememberedHandleRef.current = handle
      setRememberedName(handle.name)
      await activateAdapter(
        new DirectoryWorkspaceAdapter(handle, {
          workspaceId: `directory:${encodeURIComponent(handle.name)}`
        })
      )
    } catch (openError) {
      setError(
        openError instanceof Error
          ? pickerErrorMessage(classifyPickerError(openError))
          : t('alert.picker.unknown')
      )
    } finally {
      setBusy(false)
    }
  }, [activateAdapter, phase])

  const handleOpenDifferent = useCallback(async () => {
    rememberedHandleRef.current = null
    setRememberedName(undefined)
    await handleOpenFolder()
  }, [handleOpenFolder])

  const handleOpenOpfs = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const adapter = await OpfsWorkspaceAdapter.open({ requestPersistence: true })
      await activateAdapter(adapter)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : t('alert.picker.unknown'))
    } finally {
      setBusy(false)
    }
  }, [activateAdapter])

  const handleOpenPickedFile = useCallback(
    async (file: File) => {
      const adapter = await SingleFileWorkspaceAdapter.fromFile(file)
      await activateAdapter(adapter)
      const bytes = new Uint8Array(await file.arrayBuffer())
      await openImportedBytes(file.name, file.name, bytes, file.type || undefined)
    },
    [activateAdapter, openImportedBytes]
  )

  const handleOpenFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const [file] = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        if (phase === 'ready') {
          const bytes = new Uint8Array(await file.arrayBuffer())
          await openImportedBytes(file.name, null, bytes, file.type || undefined)
        } else {
          await handleOpenPickedFile(file)
        }
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : String(openError))
      } finally {
        setBusy(false)
      }
    },
    [handleOpenPickedFile, openImportedBytes, phase]
  )

  const handleImportInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (files.length === 0) return
      setBusy(true)
      try {
        // Single-file workspaces have no writable multi-file destination, so an
        // import opens in-memory review tabs exactly as before.
        if (!multiFile) {
          for (const file of files) {
            const bytes = new Uint8Array(await file.arrayBuffer())
            await openImportedBytes(file.name, null, bytes, file.type || undefined)
          }
          return
        }
        // Multi-file workspaces split each import into one `.aml` per model: a
        // BPMN file is refused as always, an ARIS source with no models earns a
        // "nothing found" toast, and everything else is accumulated into ONE
        // combined review dialog before a single byte is written.
        const sources: { name: string; bytes: Uint8Array; mimeType?: string }[] = []
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const text = new TextDecoder('utf-8').decode(bytes)
          if (classifyImportBoundarySource(file.name, text) === 'reject-bpmn') {
            pushToast(t('toast.import.arisOnly'))
            continue
          }
          sources.push({ name: file.name, bytes, mimeType: file.type || undefined })
        }
        if (sources.length === 0) return
        const { plan, emptyNames } = await stageSplitImportBatch(sources, '')
        for (const name of emptyNames) pushToast(t('aris.import.split.nothing', { name }))
        if (plan) setSplitImportPlan(plan)
      } finally {
        setBusy(false)
      }
    },
    [multiFile, openImportedBytes, pushToast, stageSplitImportBatch]
  )

  /**
   * Open a generated AML document (AI draft or workbook) as a real source tab.
   *
   * The bytes go through the SAME lossless pipeline an imported file does, so a
   * created model gets the same canvas, the same details rail and the same
   * complete source accounting — there is no second, weaker path for generated
   * content.
   */
  const handleCreateModel = useCallback(
    async ({ name, xml }: { name: string; xml: string }) => {
      const bytes = new TextEncoder().encode(xml)
      const hash = await sha256Hex(bytes)
      const sourcePackage = await createArisXmlSourcePackage({
        name: `${name || 'draft'}.aml`,
        relPath: null,
        bytes
      })
      openTab({
        ...generatedToTab(name, xml, bytes, hash),
        pkg: sourcePackage,
        studio: buildArisStudioDocument(sourcePackage)
      })
    },
    [openTab]
  )

  /**
   * Create a blank ARIS model from the New-model dialog. Three destinations:
   *  - a multi-file folder target writes a real `.aml` source, refreshes the
   *    tree and opens it for drawing immediately;
   *  - a bound single-file workspace opens an in-memory generated tab (persisted
   *    later through "Import into workspace…");
   *  - the picker phase (no workspace) binds a single-file adapter around the
   *    new source and opens it.
   */
  // A single reveal token drives the tree's scroll-to + focus effect; bumping it
  // re-fires even for the same target.
  const [treeReveal, setTreeReveal] = useState<TreeRevealRequest | null>(null)
  const treeRevealTokenRef = useRef(0)
  const requestTreeReveal = useCallback((processId?: string, relPath?: string) => {
    treeRevealTokenRef.current += 1
    setTreeReveal({ token: treeRevealTokenRef.current, processId, relPath })
  }, [])

  const handleCreateBlankModel = useCallback(
    async ({ name, modelType }: { name: string; modelType: ArisBlankModelType }) => {
      const request = newModelRequest
      if (!request) return
      setNewModelRequest(null)
      // A forced model id (create-missing) makes the child's Model.ID equal the
      // dangling assignment target, so the assignment resolves with no parent edit.
      const { xml } = buildBlankArisAml({
        names: { [lang]: name },
        modelType,
        modelId: request.forcedModelId
      })
      const bytes = new TextEncoder().encode(xml)
      const { folderRel } = request

      if (folderRel !== null) {
        const adapter = workspaceAdapter
        if (!adapter) return
        const path = uniquePathIn(
          new Set(workspaceEntries.map((entry) => entry.path)),
          folderRel,
          deriveArisSourceFileName(name)
        )
        const outcome = await adapter.writeAtomic(path, bytes, undefined, { expectedMissing: true })
        if (!outcome.ok) {
          pushToast(
            t('aris.newModel.failed', {
              error: 'error' in outcome ? outcome.error.message : outcome.status
            }),
            'error'
          )
          return
        }
        await refreshWorkspaceSources(adapter)
        if (request.forcedModelId) {
          requestTreeReveal(request.forcedModelId, path)
          await handleOpenWorkspaceFile(path)
          pushToast(t('aris.assign.created', { path, name: request.linkContext ?? '' }), 'success')
        } else {
          await handleOpenWorkspaceFile(path)
          pushToast(t('aris.newModel.created', { name: path }), 'success')
        }
        return
      }

      if (workspaceAdapter) {
        await handleCreateModel({ name, xml })
        return
      }

      const fileName = deriveArisSourceFileName(name)
      const adapter = new SingleFileWorkspaceAdapter({
        path: fileName,
        bytes,
        workspaceId: `aris-new:${fileName}`
      })
      await activateAdapter(adapter)
      await openImportedBytes(fileName, fileName, bytes)
    },
    [
      activateAdapter,
      handleCreateModel,
      handleOpenWorkspaceFile,
      lang,
      newModelRequest,
      openImportedBytes,
      pushToast,
      refreshWorkspaceSources,
      requestTreeReveal,
      workspaceAdapter,
      workspaceEntries
    ]
  )

  const handleSelectModel = useCallback((tabKey: string, modelId: string) => {
    setActiveModelByTab((current) =>
      current[tabKey] === modelId ? current : { ...current, [tabKey]: modelId }
    )
  }, [])

  /**
   * Open a process by its stable identity: resolve its canonical file, reveal it
   * in the tree, open that source and select the exact model. Reference rows and
   * chips route here so navigation never depends on a file's physical location.
   */
  const openCanonicalProcess = useCallback(
    (processId: string) => {
      const path = explorerHierarchy?.canonicalPathByProcessId.get(processId)
      if (!path) return
      setExplorerOpen(true)
      requestTreeReveal(processId, path)
      void handleOpenWorkspaceFile(path)
      handleSelectModel(`source:${path}`, processId)
    },
    [explorerHierarchy, handleOpenWorkspaceFile, handleSelectModel, requestTreeReveal]
  )

  const handleOpenProcess = useCallback(
    (navigation: HierarchyNavigation) => {
      openCanonicalProcess(navigation.processId)
    },
    [openCanonicalProcess]
  )

  /** Commit a staged split import, then reveal the first written source. */
  const handleConfirmSplitImport = useCallback(async () => {
    const plan = splitImportPlan
    const adapter = workspaceAdapter
    if (!plan || !adapter) return
    setSplitImportBusy(true)
    try {
      const outcome = await executeArisSplitImport(adapter, plan)
      await refreshWorkspaceSources(adapter)
      if (outcome.failed.length > 0) {
        pushToast(t('aris.import.split.failed', { error: outcome.failed[0]!.message }), 'error')
      }
      pushToast(
        t('aris.import.split.done', {
          written: outcome.written.length,
          skipped: outcome.skipped.length
        }),
        'success'
      )
      const firstWritten = outcome.written[0]
      if (firstWritten) requestTreeReveal(undefined, firstWritten)
    } finally {
      setSplitImportBusy(false)
      setSplitImportPlan(null)
    }
  }, [pushToast, refreshWorkspaceSources, requestTreeReveal, splitImportPlan, workspaceAdapter])

  /**
   * Stage a tree-drop of ARIS sources through the same split-import review. AML
   * sources that carry models are staged and their names returned so the drop
   * handler skips them; everything else falls back to the legacy verbatim write.
   */
  const handleStageImport = useCallback(
    async (
      files: readonly { name: string; bytes: Uint8Array }[],
      baseFolderRel: string
    ): Promise<ReadonlySet<string>> => {
      const { plan, staged } = await stageSplitImportBatch(files, baseFolderRel)
      if (plan) setSplitImportPlan(plan)
      return staged
    },
    [stageSplitImportBatch]
  )

  /**
   * Resolve a cross-file assignment drill-down (T6 delegates it here):
   *  - a linked id already indexed in the workspace opens its canonical source;
   *  - an id made ambiguous by a duplicate declaration refuses, with guidance;
   *  - an unknown id in a multi-file workspace opens the New-model dialog forced
   *    to that id, so creating the child resolves the assignment with no parent
   *    edit; a single-file workspace can only report the id is missing.
   */
  const handleOpenAssignedModel = useCallback(
    (request: ArisOpenAssignedModelRequest) => {
      const ids = request.linkedModelIds
      const known = ids.find((id) => mergedLinks.index.has(id))
      if (known) {
        openCanonicalProcess(known)
        return
      }
      const ambiguous = ids.find((id) => mergedLinks.graph.ambiguousProcessIds.has(id))
      if (ambiguous) {
        pushToast(t('aris.assign.ambiguous', { id: ambiguous }), 'error')
        return
      }
      const firstId = ids[0]
      if (firstId === undefined) return
      if (multiFile) {
        setNewModelRequest({
          folderRel: parentFolderOf(activeTabRelPathRef.current ?? ''),
          forcedModelId: firstId,
          presetName: humanizeModelId(firstId),
          linkContext: request.definitionName
        })
      } else {
        pushToast(t('aris.assign.missing', { id: firstId }))
      }
    },
    [mergedLinks, multiFile, openCanonicalProcess, pushToast]
  )

  /**
   * The §17.2 assistant index over every open source.
   *
   * Only opened sources are indexed: a workspace listing gives a path, not the
   * parsed models a digest needs, and re-reading every file on every render is
   * not something a folder assistant may do silently. Opening a source adds it.
   */
  const assistantDigests = useMemo(
    () =>
      buildArisAssistantDigests(
        tabs
          .filter(
            (tab): tab is ArisTab & { studio: ArisStudioDocument } => tab.studio !== undefined
          )
          .map((tab) => ({
            // A source with no workspace path still needs an indexable name:
            // directory mode filters on the AML/XML extension.
            relPath: tab.relPath ?? `${tab.title}.aml`,
            document: tab.studio.source,
            sourceDigest: tab.sha256
          })),
        assistantIndexRef.current,
        mode === 'directory' ? 'directory' : mode === 'opfs' ? 'portable' : 'single-file'
      ),
    [mode, tabs]
  )

  /** §17.6: a chip selects the exact ARIS element it names. */
  const handleOpenChip = useCallback(
    (chip: ArisAnswerChip): boolean => {
      const owner = tabs.find(
        (tab) => (tab.relPath ?? `${tab.title}.aml`) === chip.relPath && tab.studio?.models.length
      )
      if (!owner) return false
      setActiveKey(owner.key)
      if (chip.modelId) handleSelectModel(owner.key, chip.modelId)
      const elementId = chip.occurrenceId ?? chip.modelId
      if (!elementId) return false
      selectionTokenRef.current += 1
      setSelectionRequest({
        token: selectionTokenRef.current,
        modelId: chip.modelId,
        elementId
      })
      setAssistantOpen(false)
      return true
    },
    [handleSelectModel, tabs]
  )

  /** §7.3 phase one: stage every write in memory and open the review gate. */
  const handlePrepareImport = useCallback(
    async (tab: ArisTab) => {
      const adapter = workspaceAdapter
      if (!adapter || !tab.pkg || !tab.studio) return
      setImportBusy(true)
      try {
        setPreparedImport(await prepareArisWorkspaceImport(adapter, tab.pkg, tab.studio))
      } catch (importError) {
        pushToast(
          tk('aris.import.failed', 'The import could not be prepared: {error}', {
            error: importError instanceof Error ? importError.message : String(importError)
          }),
          'error'
        )
      } finally {
        setImportBusy(false)
      }
    },
    [pushToast, workspaceAdapter]
  )

  /** §7.3 phase two: echo the reviewed digest, commit atomically, then flush. */
  const handleConfirmImport = useCallback(async () => {
    const prepared = preparedImport
    if (!prepared) return
    setImportBusy(true)
    try {
      const { outcome, flush } = await commitArisWorkspaceImport(prepared)
      if (outcome.status === 'rolled-back' || outcome.status === 'rollback-failed') {
        pushToast(
          tk('aris.import.rolledBack', 'The import failed and was rolled back: {error}', {
            error: outcome.error.message
          }),
          'error'
        )
        return
      }
      // A committed package that could not be flushed is NOT a successful
      // import: in portable mode the container file still holds its old bytes.
      if (flush.status === 'failed') {
        pushToast(
          tk(
            'aris.import.flushFailed',
            'The workspace package was written but the file save failed: {error}',
            { error: flush.message }
          ),
          'error'
        )
        return
      }
      const sourceName = prepared.plan.review.sourceName
      pushToast(
        outcome.status === 'deduplicated'
          ? tk(
              'aris.import.deduplicated',
              'That exact source is already stored; nothing was written.'
            )
          : flush.status === 'flushed' && flush.disposition === 'download'
            ? tk(
                'aris.import.downloaded',
                'Imported {name}; the portable workspace container was downloaded rather than written in place.',
                { name: sourceName }
              )
            : tk('aris.import.committed', 'Imported {name} into the workspace package store.', {
                name: sourceName
              }),
        'success'
      )
      if (workspaceAdapter) await refreshWorkspaceSources(workspaceAdapter)
    } catch (commitError) {
      pushToast(
        tk('aris.import.failed', 'The import could not be prepared: {error}', {
          error: commitError instanceof Error ? commitError.message : String(commitError)
        }),
        'error'
      )
    } finally {
      setImportBusy(false)
      setPreparedImport(null)
    }
  }, [preparedImport, pushToast, refreshWorkspaceSources, workspaceAdapter])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const remembered = directoryAvailable ? await loadRememberedWorkspace() : undefined
        if (!active) return
        if (remembered) {
          rememberedHandleRef.current = remembered
          setRememberedName(remembered.name)
          const permission = await ensurePermission(remembered, false)
          if (!active) return
          if (permission === 'granted') {
            await activateAdapter(
              new DirectoryWorkspaceAdapter(remembered, {
                workspaceId: `directory:${encodeURIComponent(remembered.name)}`
              })
            )
            return
          }
          setPhase('need-reconnect')
          return
        }
        setPhase('need-open')
      } catch {
        if (!active) return
        setPhase('need-open')
      }
    })()
    return () => {
      active = false
    }
  }, [activateAdapter, directoryAvailable])

  // Bind the public localization store to the current multi-file adapter and
  // load its glossary + translation memory. Single-file workspaces (and any
  // load failure/absence) leave the resources null → built-in defaults.
  useEffect(() => {
    const adapter = workspaceAdapter
    localizationStoreRef.current = null
    setLocalizationResources(null)
    if (
      !adapter ||
      !adapter.storage.capabilities.multipleFiles ||
      !adapter.storage.capabilities.directories
    ) {
      return
    }
    let store: WorkspaceLocalizationStore
    try {
      store = createWorkspaceLocalizationStore(adapter)
    } catch {
      return
    }
    localizationStoreRef.current = store
    let cancelled = false
    void (async () => {
      try {
        const state = await store.load()
        if (!cancelled && localizationStoreRef.current === store) {
          setLocalizationResources(state.resources)
        }
      } catch {
        if (!cancelled && localizationStoreRef.current === store) setLocalizationResources(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceAdapter])

  if (phase !== 'ready') {
    return (
      <>
        <input
          ref={openFileInputRef}
          type="file"
          hidden
          accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
          onChange={handleOpenFileInput}
        />
        <WorkspacePickerLite
          mode={pickerMode}
          rememberedName={rememberedName}
          busy={busy}
          error={error}
          directoryAvailable={directoryAvailable}
          opfsAvailable={opfsAvailable}
          onOpenFolder={() => void handleOpenFolder()}
          onOpenDifferent={() => void handleOpenDifferent()}
          onOpenOpfs={() => void handleOpenOpfs()}
          onOpenFile={() => openFileInputRef.current?.click()}
          onNewDiagram={() => setNewModelRequest({ folderRel: null })}
          onNewProcess={() => setNewModelRequest({ folderRel: null })}
        />
        <SettingsDialogLite
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onKeysChanged={() => setKeysVersion((current) => current + 1)}
        />
        <ArisNewModelDialog
          open={newModelRequest !== null}
          folderRel={newModelRequest?.folderRel ?? null}
          preset={
            newModelRequest?.forcedModelId
              ? {
                  name: newModelRequest.presetName ?? '',
                  modelId: newModelRequest.forcedModelId,
                  linkContext: newModelRequest.linkContext ?? ''
                }
              : null
          }
          lang={lang}
          onCreate={(spec) => void handleCreateBlankModel(spec)}
          onCancel={() => setNewModelRequest(null)}
        />
        <Toaster toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  const storageModeLabel = t(
    mode === 'directory'
      ? 'workspace.storage.mode.directory'
      : mode === 'opfs'
        ? 'workspace.storage.mode.opfs'
        : 'workspace.storage.mode.singleFile'
  )

  return (
    <PromptProvider>
      <input
        ref={openFileInputRef}
        type="file"
        hidden
        accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
        onChange={handleOpenFileInput}
      />
      <input
        ref={importInputRef}
        type="file"
        hidden
        multiple
        accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
        onChange={handleImportInput}
      />
      <ResponsiveShell direction={dir} mode={responsiveMode} className="orbitpm-workspace-shell">
        <header className="orbitpm-workspace-header">
          <span className="orbitpm-workspace-header__identity">
            <img src={ICON_DATA_URI} width={20} height={20} alt="" style={{ borderRadius: 5 }} />
            <strong style={{ fontSize: 13 }}>{t('app.title')}</strong>
            <span style={{ fontSize: 11, opacity: 0.65 }}>{storageModeLabel}</span>
          </span>
          <div className="orbitpm-workspace-header__actions">
            {responsiveMode !== 'docked' && (
              <button
                type="button"
                className="orbitpm-lite-chrome-btn orbitpm-workspace-header__explorer"
                onClick={() => setExplorerOpen((current) => !current)}
                aria-label={t('sidebar.toggle.aria')}
                aria-expanded={explorerOpen}
                aria-controls="orbitpm-aris-explorer"
              >
                <span aria-hidden="true">☰</span>
              </button>
            )}
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => setAssistantOpen(true)}
            >
              {t('aris.header.assistant')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => setSettingsOpen(true)}
            >
              {t('app.settings')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => {
                setLang(lang === 'en' ? 'ar' : 'en')
              }}
            >
              {t('app.lang.control', {
                language: lang === 'en' ? t('app.lang.ar') : t('app.lang.en')
              })}
            </button>
          </div>
        </header>

        <div className="orbitpm-workspace-body">
          <ResponsiveDrawer
            id="orbitpm-aris-explorer"
            className="orbitpm-workspace-explorer"
            open={explorerOpen}
            mode={responsiveMode}
            side="inline-start"
            label={t('aris.explorer.aria')}
            direction={dir}
            onClose={() => setExplorerOpen(false)}
            inlineSize={sidebarWidth ?? 'clamp(240px, 24vw, 320px)'}
            keepMounted
          >
            <ArisExplorerPane
              lang={lang}
              dir={dir}
              directoryAvailable={directoryAvailable}
              onImportClick={() => importInputRef.current?.click()}
              onOpenFileClick={() => openFileInputRef.current?.click()}
              onChangeFolder={() => void handleOpenDifferent()}
              activeTab={
                activeTab?.studio
                  ? { key: activeTab.key, title: activeTab.title, models: activeTab.studio.models }
                  : null
              }
              activeModelId={activeTab ? activeModelIdForTab(activeTab) : null}
              onSelectModel={handleSelectModel}
              workspaceSources={workspaceSources}
              openPaths={
                new Set(
                  tabs.map((tab) => tab.relPath).filter((path): path is string => path !== null)
                )
              }
              onOpenWorkspaceFile={handleOpenWorkspaceFile}
              onRejectUnsupported={() => pushToast(t('toast.import.arisOnly'))}
              multiFile={multiFile}
              adapter={workspaceAdapter}
              tree={explorerTree}
              hierarchy={explorerHierarchy}
              revealRequest={treeReveal}
              onOpenProcess={handleOpenProcess}
              activePath={activeTab?.relPath ?? null}
              rootName={rootLabel(mode, workspaceAdapter)}
              tabsController={explorerTabsController}
              onRefreshWorkspace={handleRefreshWorkspace}
              onOpenFileFocus={handleOpenFileFocus}
              onNewModel={handleNewModel}
              onStageImport={handleStageImport}
              onToast={pushToast}
            />
          </ResponsiveDrawer>

          {explorerOpen && responsiveMode === 'docked' && (
            <PaneResizer
              edge="inline-end"
              dir={dir}
              width={sidebarWidth ?? 320}
              min={240}
              max={560}
              onWidthChange={setSidebarWidth}
              onReset={resetSidebarWidth}
              ariaLabel={t('aris.pane.resize.sidebar.aria')}
            />
          )}

          <button
            type="button"
            className="orbitpm-lite-rail"
            onClick={() => setExplorerOpen((current) => !current)}
            aria-label={t('sidebar.toggle.aria')}
            aria-expanded={explorerOpen}
            aria-controls="orbitpm-aris-explorer"
          >
            <span aria-hidden>
              {lang === 'ar' ? (explorerOpen ? '⟩' : '⟨') : explorerOpen ? '⟨' : '⟩'}
            </span>
          </button>

          <main
            id="orbitpm-process-workspace"
            aria-label={t('aris.main.aria')}
            className="orbitpm-workspace-main"
            style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}
          >
            <ProcessTabList
              tabs={tabs.map((tab) => ({
                key: tab.key,
                title: tab.title
              }))}
              activeKey={activeKey}
              dirtyKeys={new Set()}
              dir={dir}
              ariaLabel={t('aris.tab.list.aria')}
              closeTitle={t('aris.tab.closeTitle')}
              dirtyLabel={t('tab.dirty.aria')}
              onActivate={setActiveKey}
              onClose={(key) => {
                // A closed canvas no longer has a live document, so its overlay
                // contribution must be dropped and the tree re-scanned from disk.
                const closingRelPath = tabsRef.current.find((tab) => tab.key === key)?.relPath
                if (closingRelPath) handleLiveScanChange(closingRelPath, null)
                let nextActiveKey: string | null = null
                setTabs((current) => {
                  const closingIndex = current.findIndex((tab) => tab.key === key)
                  const remaining = current.filter((tab) => tab.key !== key)
                  if (remaining.length === 0) {
                    nextActiveKey = null
                  } else if (closingIndex === -1) {
                    nextActiveKey = remaining[0]?.key ?? null
                  } else {
                    nextActiveKey =
                      remaining[Math.min(closingIndex, remaining.length - 1)]?.key ??
                      remaining[0]?.key ??
                      null
                  }
                  return remaining
                })
                setActiveKey((current) => (current === key ? nextActiveKey : current))
                return true
              }}
              onEmptyFocus={() => undefined}
            />

            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              {tabs.length === 0 ? (
                <div style={{ padding: '1.5rem', overflow: 'auto' }}>
                  <p style={{ marginTop: 0, opacity: 0.7, lineHeight: 1.6 }}>
                    {t('aris.emptyMain')}
                  </p>
                  <ArisGenerationPanel
                    embedded
                    workspaceId={workspaceAdapter?.id ?? null}
                    onCreateModel={handleCreateModel}
                    onDownloadFile={downloadBytes}
                    onOpenAssistant={() => setAssistantOpen(true)}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onContinueInChat={handleContinueInChat}
                  />
                </div>
              ) : (
                tabs.map((tab) => {
                  const isActive = activeKey === tab.key
                  return (
                    <div
                      key={tab.key}
                      id={processTabPanelId(tab.key)}
                      role="tabpanel"
                      aria-labelledby={processTabId(tab.key)}
                      tabIndex={isActive ? 0 : -1}
                      hidden={!isActive}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: isActive ? 'block' : 'none',
                        minHeight: 0
                      }}
                    >
                      {tab.studio ? (
                        <ArisStudioTab
                          title={tab.title}
                          studio={tab.studio}
                          modelId={activeModelIdForTab(tab)}
                          active={isActive}
                          chatHostKey={tab.key}
                          onChatHostChange={registerChatHost}
                          sourceKind={tab.sourceKind}
                          localizationResources={localizationResources}
                          onAcceptedTranslationPair={handleAcceptedTranslationPair}
                          onOpenInterview={handleContinueInChat}
                          lang={lang}
                          sourceText={tab.content}
                          canImport={workspaceAdapter !== null && tab.pkg !== undefined}
                          onModelChange={(modelId) => handleSelectModel(tab.key, modelId)}
                          onDownloadSource={() =>
                            downloadBytes(
                              tab.relPath?.split('/').pop() ?? `${tab.title}.xml`,
                              tab.bytes
                            )
                          }
                          onDownloadAttachment={(filename, bytes, mimeType) =>
                            downloadBytes(filename, bytes, mimeType)
                          }
                          workspaceId={workspaceAdapter?.id ?? null}
                          onCreateModel={handleCreateModel}
                          onDownloadFile={downloadBytes}
                          onOpenAssistant={() => setAssistantOpen(true)}
                          onOpenSettings={() => setSettingsOpen(true)}
                          onContinueInChat={handleContinueInChat}
                          onImportPackage={() => void handlePrepareImport(tab)}
                          onToast={pushToast}
                          sourceFileName={tab.relPath?.split('/').pop() ?? `${tab.title}.aml`}
                          selectionRequest={isActive ? selectionRequest : null}
                          onSelectionResolved={(_token, revealed) => {
                            if (!revealed) pushToast(t('aris.assistant.none'))
                            setSelectionRequest(null)
                          }}
                          workspaceModelIndex={mergedLinks.index}
                          onOpenAssignedModel={handleOpenAssignedModel}
                          onLiveDocumentChange={(doc) => {
                            if (tab.relPath) {
                              handleLiveScanChange(tab.relPath, deriveArisLinksFromDocument(doc))
                            }
                          }}
                        />
                      ) : (
                        <div style={{ padding: '1.5rem', opacity: 0.7, lineHeight: 1.6 }}>
                          {t('aris.emptyMain')}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </main>
        </div>

        <footer
          className="orbitpm-workspace-footer"
          style={{
            borderTop: '1px solid var(--orbitpm-border)',
            padding: '0.3rem 0.8rem',
            fontSize: 12,
            color: 'var(--orbitpm-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap'
          }}
        >
          <span>{rootLabel(mode, workspaceAdapter)}</span>
          <span>
            {t('aris.footer.summary', {
              files: workspaceSources.length,
              tabs: tabs.length
            })}
          </span>
        </footer>
      </ResponsiveShell>

      <SettingsDialogLite
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onKeysChanged={() => setKeysVersion((current) => current + 1)}
      />
      <ArisNewModelDialog
        open={newModelRequest !== null}
        folderRel={newModelRequest?.folderRel ?? null}
        preset={
          newModelRequest?.forcedModelId
            ? {
                name: newModelRequest.presetName ?? '',
                modelId: newModelRequest.forcedModelId,
                linkContext: newModelRequest.linkContext ?? ''
              }
            : null
        }
        lang={lang}
        onCreate={(spec) => void handleCreateBlankModel(spec)}
        onCancel={() => setNewModelRequest(null)}
      />
      <ArisChatDrawer
        open={assistantOpen}
        onOpen={() => setAssistantOpen(true)}
        onClose={() => setAssistantOpen(false)}
        keysVersion={keysVersion}
        digests={assistantDigests}
        onOpenChip={handleOpenChip}
        onOpenSettings={() => setSettingsOpen(true)}
        onChangeWorkspace={directoryAvailable ? () => void handleOpenDifferent() : undefined}
        getActiveChatTarget={getActiveChatTarget}
        interviewRequest={interviewRequest}
      />
      <ArisImportReviewDialog
        open={preparedImport !== null}
        plan={preparedImport?.plan ?? null}
        busy={importBusy}
        dir={dir}
        onConfirm={() => void handleConfirmImport()}
        onCancel={() => setPreparedImport(null)}
      />
      <ArisSplitImportDialog
        open={splitImportPlan !== null}
        plan={splitImportPlan}
        busy={splitImportBusy}
        dir={dir}
        onConfirm={() => void handleConfirmSplitImport()}
        onCancel={() => setSplitImportPlan(null)}
      />
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </PromptProvider>
  )
}
