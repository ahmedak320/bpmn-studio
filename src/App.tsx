import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// --- local ports of the two bpmn-js-touching React shells (they reuse all the
// desktop app's pure editor/link logic + CSS internally) ---
import { EditorTab, type EditorTabCommands } from './editor/EditorTabLite'
import { SelectionLinkButton, type SelectionLinkModeler } from './links/SelectionLinkButtonLite'
// --- reused, unchanged, by direct import from the desktop tree ---
import { createNewDiagramXml } from '@/editor/newDiagram'
import { triggerDownload } from '@/editor/exportImage'
import { usePromptText } from '@/common/prompt'
import { ProcessTabList, processTabId, processTabPanelId } from './common/ProcessTabList'
import { listUnresolvedCalledElements, type ProcessIndex } from '@/core/processIndex'
import { dedupeSlug } from '@/core/slug'
// --- lite-local ---
import {
  buildNewProcessDoc,
  buildMissingProcessDoc,
  humanizeProcessId,
  deriveFileBaseName,
  sanitizeFolderName
} from './editor/newProcessDoc'
import {
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
  ensurePermission,
  classifyPickerError,
  type PickerErrorCode
} from './fs/workspaceHandle'
import { WorkspacePickerLite } from './workspace/WorkspacePickerLite'
import { BackupImportDialog } from './workspace/BackupImportDialog'
import { HistoryDialog } from './workspace/HistoryDialog'
import { snapshotAdapterWorkspace } from './workspace/adapterSnapshot'
import {
  ManifestBoundWorkspaceAdapter,
  bindWorkspaceToManifest,
  type WorkspaceManifestWarning
} from './workspace/workspaceManifest'
import {
  DirectoryWorkspaceAdapter,
  OpfsWorkspaceAdapter,
  SingleFileWorkspaceAdapter,
  WorkspaceOperationError,
  applyWorkspaceBackupImport,
  inspectWorkspaceBackup,
  normalizeWorkspacePath,
  opfsSupported,
  sha256Hex,
  type FileSnapshot,
  type WorkspaceAdapter,
  type WorkspaceBackupCollisionDecision,
  type WorkspaceBackupImportPlan,
  type WorkspaceMode
} from './workspace/adapters'
import { PortableHistoryManager, type HistoryRevision } from './workspace/history'
import {
  ActiveSessionCommandRouter,
  BroadcastWorkspaceCoordinator,
  DocumentSessionController,
  DraftJournalCoordinator,
  IndexedDbDraftJournal,
  MemoryDraftJournal,
  PATH_TRANSACTION_STAGING_ROOT,
  confirmPathDelete,
  createAdapterPathMutation,
  createAdapterSessionPersistence,
  executePathTransaction,
  findDraftRecoveryComparison,
  installApplicationShortcuts,
  installBeforeUnloadDirtyGuard,
  planPathTransaction,
  resolveDirtyPathDecision,
  restoreHistoryRevision,
  type DraftRecoveryComparison,
  type DraftJournal,
  type ExternalConflict,
  type ExternalConflictDecision,
  type FileFingerprint,
  type PathTransactionPlan,
  type RestoreHistoryRevisionResult,
  type SessionPersistence,
  type WorkspaceIdentity
} from './sessions'
import { DraftRecoveryDialog, type DraftRecoveryDecision } from './sessions/DraftRecoveryDialog'
import { LiveWorkspaceIndex } from './workspace/liveWorkspaceIndex'
import { FolderTreeLite } from './workspace/FolderTreeLite'
import { buildProcessHierarchy } from './workspace/processHierarchy'
import { EmptyWorkspaceCard } from './workspace/EmptyWorkspaceCard'
import { AiPanelLite, type FolderOptionLite } from './ai/AiPanelLite'
import type {
  GeneratedPlacementDiscardReason,
  GeneratedPlacementOutcome
} from './ai/placementOutcome'
import { installLinkBadges, type LinkBadgeModeler } from './links/linkBadges'
import { buildLinkGraph } from './links/linkGraph'
import { getDiagramLang, type LangToggleModeler } from './editor/langToggle'
import { autoSizeAll } from './editor/autoSize'
import { makeBrowserCallLLM } from './ai/browserAi'
import { getProviderSelection, type ProviderSelection } from './ai/providerSelection'
import { getLiteProvider } from './ai/providersLite'
import { getKey, hasKey } from './ai/keys'
import {
  buildTranslationExternalReview,
  translateReviewedDiagram,
  translateReviewedDiagramWithTexts,
  type TranslateModeler
} from './ai/translate'
import { makeFreeTranslateTexts, FreeTranslateError } from './ai/freeTranslate'
import {
  TranslationReviewDialog,
  type TranslationReviewProviderOption
} from './localization/TranslationReviewDialog'
import {
  applyDiagramLocalizationReview,
  inspectDiagramLocalization,
  StaleLocalizationReviewError,
  type DiagramLocalizationReview
} from './localization/modelerAdapter'
import { grantExternalRequestConsent } from './localization/externalRequestReview'
import {
  LocalizationSource,
  type LocalizationSource as LocalizationSourceType
} from './localization/types'
import {
  createWorkspaceLocalizationStore,
  type WorkspaceLocalizationState,
  type WorkspaceLocalizationStore
} from './localization/workspaceStore'
import { SettingsDialogLite, type SettingsDialogLiteProps } from './settings/SettingsDialogLite'
import { ICON_DATA_URI } from './branding/icon'
// --- W2B: file mgmt / search / catalog / navigation / print ---
import {
  buildCatalog,
  sortCatalog,
  filterCatalog,
  type CatalogSortKey,
  type SortDir
} from './workspace/catalog'
import { CatalogView } from './workspace/CatalogView'
import { searchWorkspace, countHits } from './workspace/searchIndex'
import { SEARCH_RESULTS_ID, SearchResults, searchResultOptionId } from './workspace/SearchResults'
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
import { AccessibleDialog } from './common/AccessibleDialog'
import { createMutex } from './workspace/mutex'
import { partitionDirtyTabs } from './workspace/dirtySave'
import { canCommitToWorkspace, commitIfCurrent } from './workspace/workspaceSession'
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
  setProcessDocumentation,
  getOrgProps,
  setOrgProps,
  setStepNote,
  serializeTriggers,
  type OrgModeler
} from './org/orgModel'
import { refreshOrgStyling } from './org/orgSettings'
import { StepDetailsDialog, type StepDetailsValues } from './org/StepDetailsDialog'
import { DetailsCard } from './org/DetailsCard'
import { deriveStepDetailsCtx, type StepDetailsModeler } from './org/stepDetailsCtx'
import {
  collectOwners,
  mergeOwners,
  upsertSessionOwners,
  ownerAdditionsFromValues,
  type SessionOwner
} from './owner/ownersIndex'
import { ownersToCsv } from './owner/ownerCsv'
import { PaneResizer, usePaneWidth } from './common/PaneResizer'
import { AssistantDrawer } from './assist/AssistantDrawer'
import { buildAllDigests, type ProcessDigest } from './assist/digest'
import { buildLibraryZip, zipFileName } from './library/zipExport'
import {
  LIBRARY_MANIFEST_NAME,
  buildLibraryManifest,
  serializeLibraryManifest
} from './library/libraryManifest'
import { readLibraryZipFileInWorker } from './library/browserZipImport'
import type { LibraryImportResult } from './library/zipImport'
import { convertAmlToBpmnFiles, looksLikeAml } from './library/apcImport'
import { decodeUtf8Strict } from './workspace/utf8'
import {
  evaluateValidationPolicy,
  getRuntimeValidationAdapters,
  validateBpmnXml,
  validateUnknownExtensionPreservation,
  type ValidationAction,
  type ValidationSummary
} from './validation'
import { layoutBpmnValidated } from './generation'
import { t, tPlural, type Key } from './i18n'
import { useLang, setLang } from './i18n/useLang'
import './print.css'

type Phase = 'loading' | 'need-open' | 'need-reconnect' | 'ready'
type Mode = WorkspaceMode

function isMultiFileMode(mode: Mode): boolean {
  return mode === 'directory' || mode === 'opfs'
}

function workspaceInstanceId(kind: WorkspaceMode, name: string): string {
  // Draft recovery and cross-tab coordination both require an identity that is
  // stable across reloads and independent browser tabs. Directory handles do
  // not expose an absolute path, so the picker-scoped display name is the
  // strongest portable browser identifier available without writing metadata
  // into the user's folder. OPFS and single-file names are naturally stable.
  return `${kind}:${encodeURIComponent(name || 'workspace')}`
}

function directoryWorkspaceId(handle: FileSystemDirectoryHandle): string {
  return workspaceInstanceId('directory', handle.name)
}

function fileMetaFromSnapshot(snapshot: FileSnapshot): FileMeta {
  return {
    relPath: snapshot.path,
    xml: decodeUtf8Strict(snapshot.bytes, {
      operation: 'read',
      path: snapshot.path
    }),
    lastModified: snapshot.modifiedAt,
    size: snapshot.size
  }
}

function fingerprintFromSnapshot(snapshot: FileSnapshot): FileFingerprint {
  return {
    hash: snapshot.hash,
    size: snapshot.size,
    modifiedAt: snapshot.modifiedAt
  }
}

function sessionPersistenceWithHistory(
  adapter: WorkspaceAdapter,
  workspace: WorkspaceIdentity,
  history: PortableHistoryManager | null
): SessionPersistence {
  const direct = createAdapterSessionPersistence({ adapter, workspace })
  if (!history) return direct
  const encoder = new TextEncoder()
  const decoder = new TextDecoder('utf-8', { fatal: true })

  return {
    inspect: (identity, signal) => direct.inspect(identity, signal),
    writeAs: direct.writeAs
      ? (identity, path, xml, options) => direct.writeAs!(identity, path, xml, options)
      : undefined,
    async write(identity, xml, options) {
      if (identity.path === null) return direct.write(identity, xml, options)

      // A null base means "the reviewed destination is absent". Preserve that
      // creation-only contract rather than letting history turn a TOCTOU create
      // into an overwrite if another writer creates the file after inspection.
      if (options.expectedBase === null) {
        return direct.write(identity, xml, options)
      }

      const result = await history.writeWithRevision(
        identity.path,
        encoder.encode(xml),
        options.expectedBase.hash,
        'overwrite'
      )
      const outcome = result.outcome
      if (outcome.status === 'success') {
        return {
          status: 'written',
          fingerprint: fingerprintFromSnapshot(outcome.snapshot)
        }
      }
      if (outcome.status === 'external-conflict') {
        return {
          status: 'external-conflict',
          external: outcome.actual
            ? {
                identity,
                xml: decoder.decode(outcome.actual.bytes),
                fingerprint: fingerprintFromSnapshot(outcome.actual)
              }
            : null
        }
      }
      if ('error' in outcome) throw outcome.error
      throw new Error(`Workspace save did not complete (${outcome.status}).`)
    }
  }
}

function createBrowserDraftJournal(): { journal: DraftJournal; durable: boolean } {
  try {
    return { journal: new IndexedDbDraftJournal(), durable: true }
  } catch {
    // Private browsing or a restricted embedding may omit IndexedDB. The
    // in-memory fallback keeps the live safety controller coherent while the
    // caller explicitly reports that recovery will not survive a reload.
    return { journal: new MemoryDraftJournal(), durable: false }
  }
}

function createPageInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `page-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

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

interface SessionSaveRequestResult {
  durable: boolean
}

interface SaveConflictPromptState {
  tabKey: string
  path: string
  conflict: ExternalConflict
  saveAsPath: string
  saveAsError: string | null
  showComparison: boolean
}

interface PathDirtyPromptState {
  count: number
  kind: 'rename' | 'move' | 'delete'
  path: string
}

interface PathRecoveryState {
  adapter: WorkspaceAdapter
  error: unknown
  generation: number
  payloadPath: string
  retry: () => Promise<void>
  stagingPath: string
}

interface ManifestRepairState {
  adapter: ManifestBoundWorkspaceAdapter
  error: unknown
  generation: number
}

function liveIndexPath(tab: Tab): string {
  return tab.relPath ?? `.orbitpm/live/${encodeURIComponent(tab.key)}/${tab.title}`
}

interface DeleteState {
  node: LiteTreeNode
  /** Non-empty folder → require typing this name to confirm. */
  requireTyped?: string
}

interface TranslationReviewState {
  tabKey: string
  review: DiagramLocalizationReview
  providerId: '' | 'selected-ai' | 'free'
  aiSelection: ProviderSelection | null
  status: string | null
}

function baseName(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function directBpmnSlugs(
  adapter: WorkspaceAdapter,
  folderPath: string
): Promise<Set<string>> {
  const entries = await adapter.list(folderPath || undefined)
  return new Set(
    entries
      .filter(
        (entry) =>
          entry.kind === 'file' &&
          entry.parentPath === folderPath &&
          entry.name.toLocaleLowerCase('en-US').endsWith('.bpmn')
      )
      .map((entry) => entry.name.replace(/\.bpmn$/iu, '').toLocaleLowerCase('en-US'))
  )
}

/**
 * Creation-only write routed through the active workspace adapter. The
 * expected-missing CAS closes the external-writer race; a newly occupied name
 * is simply added to the de-dup set and retried.
 */
async function writeUniqueBpmn(
  adapter: WorkspaceAdapter,
  folderPath: string,
  requestedSlug: string,
  xml: string
): Promise<string> {
  if (folderPath) await adapter.createFolder(folderPath)
  const taken = await directBpmnSlugs(adapter, folderPath)
  const bytes = new TextEncoder().encode(xml)
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const slug = dedupeSlug(requestedSlug, (candidate) =>
      taken.has(candidate.toLocaleLowerCase('en-US'))
    )
    const path = joinRel(folderPath, `${slug}.bpmn`)
    const outcome = await adapter.writeAtomic(path, bytes, undefined, {
      expectedWorkspaceId: adapter.id,
      expectedMissing: true
    })
    if (outcome.status === 'success') return outcome.snapshot.path
    if (outcome.status === 'external-conflict' && outcome.reason === 'already-exists') {
      taken.add(slug.toLocaleLowerCase('en-US'))
      continue
    }
    if ('error' in outcome) throw new Error(outcome.error.message)
    if (outcome.status === 'stale-workspace') {
      throw new Error(t('workspace.create.stale'))
    }
    throw new Error(t('workspace.create.failed', { status: outcome.status }))
  }
  throw new Error(t('workspace.create.noAvailableName'))
}

async function directoryEntryCount(adapter: WorkspaceAdapter, path: string): Promise<number> {
  try {
    return (await adapter.list(path)).length
  } catch (error) {
    if (error instanceof WorkspaceOperationError && error.code === 'not-found') return 0
    throw error
  }
}

function migratedPathForPlan(plan: PathTransactionPlan, path: string): string | null {
  const source = plan.request.sourcePath
  const affected =
    path === source || (plan.request.entryKind === 'directory' && path.startsWith(`${source}/`))
  if (!affected) return path
  if (plan.request.kind === 'delete') return null
  const destination = plan.request.destinationPath!
  return plan.request.entryKind === 'file'
    ? destination
    : `${destination}${path.slice(source.length)}`
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
function pickerErrorKey(
  code: PickerErrorCode
): 'alert.picker.security' | 'alert.picker.notAllowed' | 'alert.picker.unknown' {
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

interface ReleaseValidationOptions {
  action: ValidationAction
  knownProcessIds: Iterable<string>
  requireBilingual: boolean
  requireDi: boolean
  explicitDraftWithErrors?: boolean
}

async function validateReleaseXml(
  xml: string,
  options: ReleaseValidationOptions
): Promise<ValidationSummary> {
  const parsed = await validateBpmnXml(xml, {
    adapters: getRuntimeValidationAdapters(),
    knownProcessIds: options.knownProcessIds,
    requireBilingual: options.requireBilingual,
    requireDi: options.requireDi
  })
  const decision = evaluateValidationPolicy(parsed.summary, options.action, {
    explicitDraftConfirmation: options.explicitDraftWithErrors === true
  })
  if (!decision.allowed) {
    const codes = decision.blockingIssues
      .slice(0, 8)
      .map((issue) => issue.code)
      .join(', ')
    throw new Error(`BPMN validation blocked this operation${codes ? `: ${codes}` : ''}`)
  }
  return parsed.summary
}

async function prepareImportedBpmnXml(
  xml: string,
  knownProcessIds: Iterable<string>
): Promise<{ xml: string; autoLayouted: boolean; summary: ValidationSummary }> {
  const processIds = [...knownProcessIds]
  const preview = await validateReleaseXml(xml, {
    action: 'commit-import',
    knownProcessIds: processIds,
    requireBilingual: false,
    requireDi: false
  })
  const missingDi = preview.issues.some(
    (issue) => issue.code === 'di.process-missing' || issue.code === 'bpmnlint.no-bpmndi'
  )
  if (!missingDi) {
    const summary = await validateReleaseXml(xml, {
      action: 'commit-import',
      knownProcessIds: processIds,
      requireBilingual: false,
      requireDi: true
    })
    return { xml, autoLayouted: false, summary }
  }

  const layout = await layoutBpmnValidated(xml, {
    validation: {
      knownProcessIds: processIds,
      requireBilingual: false
    }
  })
  const preservation = await validateUnknownExtensionPreservation(xml, layout.xml)
  if (!preservation.valid) {
    throw new Error('Auto-layout would discard or mutate opaque BPMN extension data.')
  }
  const summary = await validateReleaseXml(layout.xml, {
    action: 'commit-import',
    knownProcessIds: processIds,
    requireBilingual: false,
    requireDi: true
  })
  return { xml: layout.xml, autoLayouted: true, summary }
}

function confirmGeneratedImportLayout(): boolean {
  return window.confirm(`${t('sourceEditor.layoutReady')}\n\n${t('sourceEditor.layoutAccept')}?`)
}

// Structural (never the concrete bpmn-js class) so it stays a local port like the
// other lite modeler shells: saveSVG for the diagram, plus the two services the
// print header needs — the element registry (band-cut rects) and the canvas
// (process display name).
interface ModelerWithSvg {
  saveSVG?: () => Promise<{ svg: string }>
  get(service: 'elementRegistry'): { getAll(): PrintShapeElement[] }
  get(service: 'canvas'): {
    getRootElement(): { businessObject?: PrintRootBusinessObject } | undefined
  }
}

interface ProcessRootElement {
  id?: string
  businessObject?: { id?: string }
}

interface ProcessDiagram {
  id?: string
  plane?: { bpmnElement?: { id?: string } }
}

interface ProcessRootModeler {
  get(service: 'canvas'): {
    getRootElements(): ProcessRootElement[]
    setRootElement(root: ProcessRootElement): void
    zoom(mode: 'fit-viewport'): void
  }
  getDefinitions?(): { diagrams?: ProcessDiagram[] }
  open?(diagram: ProcessDiagram): Promise<unknown>
}

interface WorkspaceLocalizationBinding {
  adapter: WorkspaceAdapter
  controller: AbortController
  generation: number
  store: WorkspaceLocalizationStore
}

/** Switch a multi-process BPMN file to the root selected by semantic id. */
async function focusProcessRoot(modeler: unknown, processId: string): Promise<boolean> {
  try {
    const target = modeler as ProcessRootModeler
    const canvas = target.get('canvas')
    const root = canvas
      .getRootElements()
      .find((candidate) => candidate.businessObject?.id === processId || candidate.id === processId)
    if (root) {
      canvas.setRootElement(root)
      canvas.zoom('fit-viewport')
      return true
    }

    // bpmn-js imports one BPMNDiagram plane at a time. When the selected
    // process lives in another plane of the same file, open that exact diagram
    // instead of treating the physical file's first root as identity.
    const diagram = target
      .getDefinitions?.()
      .diagrams?.find((candidate) => candidate.plane?.bpmnElement?.id === processId)
    if (!diagram || !target.open) return false
    await target.open(diagram)
    canvas.zoom('fit-viewport')
    return true
  } catch {
    return false
  }
}

function App(): JSX.Element {
  const promptText = usePromptText()
  const lang = useLang()
  const support = useMemo(() => directoryPickerSupported(), [])
  const browserWorkspaceAvailable = useMemo(() => opfsSupported(), [])

  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<Mode>(
    support ? 'directory' : browserWorkspaceAvailable ? 'opfs' : 'single-file'
  )
  const [workspaceAdapter, setWorkspaceAdapter] = useState<WorkspaceAdapter | null>(null)
  const [rootName, setRootName] = useState<string>('')
  const rootNameRef = useRef('')
  const rememberedRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [rememberedName, setRememberedName] = useState<string>('')
  const [pickBusy, setPickBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  const [tree, setTree] = useState<LiteTreeNode | null>(null)
  const [workspaceIssues, setWorkspaceIssues] = useState<string[]>([])
  const [workspaceLocalizationError, setWorkspaceLocalizationError] = useState<string | null>(null)
  const liveWorkspaceIndexRef = useRef(new LiveWorkspaceIndex())
  const [liveWorkspaceVersion, setLiveWorkspaceVersion] = useState(0)

  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const activeKeyRef = useRef<string | null>(null)
  activeKeyRef.current = activeKey
  const [contents, setContents] = useState<Record<string, string>>({})
  const [dirtyByKey, setDirtyByKey] = useState<Record<string, boolean>>({})
  const dirtyByKeyRef = useRef<Record<string, boolean>>({})
  dirtyByKeyRef.current = dirtyByKey
  const baseHashByPathRef = useRef<Record<string, string>>({})
  const liveXmlTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [mounted, setMounted] = useState<Set<string>>(() => new Set())
  const [modelersByKey, setModelersByKey] = useState<Record<string, unknown>>({})
  const commandsRef = useRef<Record<string, EditorTabCommands | null>>({})
  const commandUnregisterersRef = useRef<Record<string, () => void>>({})
  const commandRouterRef = useRef<ActiveSessionCommandRouter | null>(null)
  if (!commandRouterRef.current) {
    commandRouterRef.current = new ActiveSessionCommandRouter(() => activeKeyRef.current)
  }
  // Per-tab uninstall handles for the "linked" call-activity badge overlays,
  // installed when a tab's modeler is ready and torn down when it is replaced
  // (onModelerReady(null)) or the tab closes.
  const badgeUninstallersRef = useRef<Record<string, () => void>>({})
  const liveXmlUninstallersRef = useRef<Record<string, () => void>>({})
  // Fresh AI placements share EditorTabLite's import path with ordinary
  // file-open/tab-restore. Mark only their tab keys so App can run the
  // post-import auto-size sweep without resizing an existing saved diagram.
  const pendingAiAutoSizeRef = useRef<Set<string>>(new Set())
  // A stable-id open may target the second (or later) process root inside one
  // physical BPMN file. Latch that id until the modeler's import.done event.
  const pendingProcessFocusRef = useRef<Map<string, string>>(new Map())
  // Serialize diagram-plane changes per physical file. Two rapid stable-id
  // opens must finish in request order so an earlier async modeler.open()
  // cannot overwrite the later selection.
  const processFocusQueueRef = useRef<Map<string, Promise<void>>>(new Map())
  const virtualCounter = useRef(0)

  // Data-safety plumbing (Codex C1 / M3 / M8).
  const workspaceGenRef = useRef(0) // bumped on every folder switch (tab-write guard)
  const workspaceAdapterRef = useRef<WorkspaceAdapter | null>(null)
  const workspaceLocalizationBindingRef = useRef<WorkspaceLocalizationBinding | null>(null)
  const workspaceLocalizationSnapshotRef = useRef<WorkspaceLocalizationState | null>(null)
  const [workspaceLocalizationSnapshot, setWorkspaceLocalizationSnapshot] =
    useState<WorkspaceLocalizationState | null>(null)
  const historyManagerRef = useRef<PortableHistoryManager | null>(null)
  const workspaceIdentityRef = useRef<WorkspaceIdentity | null>(null)
  const sessionControllerRef = useRef<DocumentSessionController | null>(null)
  const draftJournalRef = useRef<DraftJournal | null>(null)
  const draftJournalDurableRef = useRef(true)
  const draftJournalWarningShownRef = useRef(false)
  const draftCoordinatorRef = useRef<DraftJournalCoordinator | null>(null)
  const workspaceCoordinatorRef = useRef<BroadcastWorkspaceCoordinator | null>(null)
  const sessionStoreUnsubscribeRef = useRef<(() => void) | null>(null)
  const workspaceChangeUnsubscribeRef = useRef<(() => void) | null>(null)
  const pageInstanceIdRef = useRef<string | null>(null)
  pageInstanceIdRef.current ??= createPageInstanceId()
  const requestSaveRef = useRef<
    (
      tab: Tab,
      xml: string,
      options?: { explicitDraftWithErrors?: boolean }
    ) => Promise<SessionSaveRequestResult>
  >(async () => {
    throw new Error('Document-session save controller is not ready.')
  })
  const [saveConflictPrompt, setSaveConflictPrompt] = useState<SaveConflictPromptState | null>(null)
  const saveConflictResolveRef = useRef<((decision: ExternalConflictDecision) => void) | null>(null)
  const [manifestRepair, setManifestRepair] = useState<ManifestRepairState | null>(null)
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null) // sync mirror for async guards
  const workspaceActivationSequenceRef = useRef(0)
  const refreshSequenceRef = useRef(0)
  const opMutexRef = useRef(createMutex()) // serializes create / import / AI-place writes
  const [switchGuard, setSwitchGuard] = useState<{ count: number } | null>(null)
  const switchResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null)
  const [pathDirtyPrompt, setPathDirtyPrompt] = useState<PathDirtyPromptState | null>(null)
  const pathDirtyResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null)
  const [pathRecovery, setPathRecovery] = useState<PathRecoveryState | null>(null)
  const [downloadSwitchGuard, setDownloadSwitchGuard] = useState<{ count: number } | null>(null)
  const downloadSwitchResolveRef = useRef<((choice: 'continue' | 'cancel') => void) | null>(null)
  const [draftRecoveryPrompt, setDraftRecoveryPrompt] = useState<{
    requestId: number
    tab: Tab
    comparison: DraftRecoveryComparison
  } | null>(null)
  const draftRecoveryRequestIdRef = useRef(0)
  const draftRecoveryEpochRef = useRef(0)
  const draftRecoveryQueueRef = useRef<Promise<void>>(Promise.resolve())
  const draftRecoveryPendingRef = useRef<{
    requestId: number
    resolve: (decision: DraftRecoveryDecision | 'cancel') => void
  } | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // The Step-details dialog targets one tab's modeler; the mode (element vs
  // process), the initial values and the target element are all derived LIVE
  // from that modeler's current selection at render time (stepDetailsCtx).
  // `highlight` carries the missing-info categories a canvas badge click wants
  // ringed inside the dialog (MissingCategory names).
  const [stepDetails, setStepDetails] = useState<{ tabKey: string; highlight?: string[] } | null>(
    null
  )
  // Left sidebar (file explorer on top, AI generator on the bottom). Open by
  // default; auto-collapses when a file opens so the canvas takes the full
  // window — EXCEPT for a single tree-row click, which keeps the explorer
  // visible (double-click collapses; see openDirectoryFile's `collapse` opt).
  // The rail restores it. Deliberately NOT persisted — its state follows the
  // open/close flow, and a manual rail click wins until the next open event.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // User-resized explorer width (persisted); null falls back to the responsive
  // clamp() default. The PaneResizer between the aside and the rail drives it.
  const [sidebarWidth, setSidebarWidth, resetSidebarWidth] = usePaneWidth(
    'orbitpm.lite.sidebarWidth',
    { min: 200, max: 560 }
  )
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
  const [translationReview, setTranslationReview] = useState<TranslationReviewState | null>(null)
  const translationAbortRef = useRef<AbortController | null>(null)
  // Provenance survives file placement/opening so the same read-only
  // localization ingestion adapter can audit every reachable boundary.
  const localizationSourceByTabRef = useRef<Map<string, LocalizationSourceType>>(new Map())
  const localizationReviewByTabRef = useRef<Map<string, DiagramLocalizationReview>>(new Map())
  // A pending "fill gaps in chat" request from the AI panel: opens the
  // assistant's interview mode against the just-placed tab. Token bumps force
  // the drawer to react even for repeated requests on the same tab.
  const [interviewRequest, setInterviewRequest] = useState<{
    token: number
    tabKey: string
    description: string
  } | null>(null)
  const interviewTokenRef = useRef(0)

  const translationProviders: TranslationReviewProviderOption[] = (() => {
    if (!translationReview) return []
    const options: TranslationReviewProviderOption[] = []
    if (translationReview.aiSelection) {
      const spec = getLiteProvider(translationReview.aiSelection.providerId)
      options.push({
        id: 'selected-ai',
        label: `${spec.label} · ${translationReview.aiSelection.modelId}`,
        description: t('translationReview.provider.ai'),
        disabled: !hasKey(translationReview.aiSelection.providerId)
      })
    }
    options.push({
      id: 'free',
      label: 'Google Translate → MyMemory',
      description: t('translationReview.provider.free')
    })
    return options
  })()

  const translationDisclosure = useMemo(() => {
    if (!translationReview || !translationReview.providerId) return null
    if (translationReview.providerId === 'free') {
      return buildTranslationExternalReview(translationReview.review, {
        providerId: 'google-translate+mymemory',
        kind: 'free'
      })
    }
    const selection = translationReview.aiSelection
    if (!selection) return null
    return buildTranslationExternalReview(translationReview.review, {
      providerId: selection.providerId,
      modelId: selection.modelId,
      kind: 'ai'
    })
  }, [translationReview])

  const commitWorkspaceLocalizationSnapshot = useCallback(
    (
      binding: WorkspaceLocalizationBinding,
      next: WorkspaceLocalizationState
    ): WorkspaceLocalizationState => {
      if (
        workspaceLocalizationBindingRef.current === binding &&
        workspaceAdapterRef.current === binding.adapter &&
        workspaceGenRef.current === binding.generation &&
        binding.store.current === next
      ) {
        workspaceLocalizationSnapshotRef.current = next
        setWorkspaceLocalizationSnapshot(next)
        setWorkspaceLocalizationError(null)
      }
      return next
    },
    []
  )

  const settingsLocalizationResources = useMemo<
    SettingsDialogLiteProps['localizationResources']
  >(() => {
    const binding = workspaceLocalizationBindingRef.current
    if (
      !binding ||
      (!workspaceLocalizationSnapshot && !workspaceLocalizationError) ||
      workspaceAdapterRef.current !== binding.adapter ||
      workspaceGenRef.current !== binding.generation
    ) {
      return undefined
    }
    const assertCurrent = (): void => {
      if (
        workspaceLocalizationBindingRef.current === binding &&
        workspaceAdapterRef.current === binding.adapter &&
        workspaceGenRef.current === binding.generation &&
        !binding.controller.signal.aborted
      ) {
        return
      }
      if (!binding.controller.signal.aborted) binding.controller.abort()
      throw binding.controller.signal.reason
    }
    const run = async (
      operation: (signal: AbortSignal) => Promise<WorkspaceLocalizationState>
    ): Promise<WorkspaceLocalizationState> => {
      assertCurrent()
      const next = await operation(binding.controller.signal)
      assertCurrent()
      return commitWorkspaceLocalizationSnapshot(binding, next)
    }
    return {
      snapshot: workspaceLocalizationSnapshot,
      loadError: workspaceLocalizationError,
      onSaveGlossary: async (entries) =>
        run((signal) => binding.store.replaceGlossary(entries, { signal })),
      onSaveTranslationMemory: async (entries) =>
        run((signal) => binding.store.replaceTranslationMemory(entries, { signal })),
      onReload: async () => {
        try {
          return await run((signal) => binding.store.load({ signal }))
        } catch (error) {
          if (
            workspaceLocalizationBindingRef.current === binding &&
            !binding.controller.signal.aborted
          ) {
            workspaceLocalizationSnapshotRef.current = null
            setWorkspaceLocalizationSnapshot(null)
            const message = errMsg(error)
            setWorkspaceLocalizationError(message)
          }
          throw error
        }
      },
      onSnapshotChange: (next) => {
        commitWorkspaceLocalizationSnapshot(binding, next)
      }
    }
  }, [
    commitWorkspaceLocalizationSnapshot,
    workspaceLocalizationError,
    workspaceLocalizationSnapshot
  ])

  const inspectWithWorkspaceLocalization = useCallback(
    (modeler: LangToggleModeler, target: 'en' | 'ar', source: LocalizationSourceType) =>
      inspectDiagramLocalization(modeler, target, {
        source,
        ...(workspaceLocalizationSnapshotRef.current?.resources ?? {})
      }),
    []
  )

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
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catSort, setCatSort] = useState<CatalogSortKey>('name')
  const [catDir, setCatDir] = useState<SortDir>('asc')
  const [unresolvedOpen, setUnresolvedOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<LiteTreeNode | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteState | null>(null)
  const [treeRevealRequest, setTreeRevealRequest] = useState<{
    token: number
    processId?: string
    relPath?: string
  } | null>(null)
  const treeRevealTokenRef = useRef(0)
  // Owners applied via the Step-details dialog THIS session but possibly not
  // yet saved to disk — merged into the picker suggestions (disk wins) so an
  // Apply on one step immediately offers that owner on the next step.
  const [sessionOwners, setSessionOwners] = useState<SessionOwner[]>([])
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [history, setHistory] = useState<NavHistory>(() => emptyHistory())
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)
  const suppressPushRef = useRef(false)
  const toastIdRef = useRef(0)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)
  const editorRegionRef = useRef<HTMLElement | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const backupInputRef = useRef<HTMLInputElement | null>(null)
  const [backupImportPlan, setBackupImportPlan] = useState<WorkspaceBackupImportPlan | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

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
  const resolveSaveConflictPrompt = useCallback((decision: ExternalConflictDecision) => {
    setSaveConflictPrompt(null)
    const resolve = saveConflictResolveRef.current
    saveConflictResolveRef.current = null
    resolve?.(decision)
  }, [])
  const promptForSaveConflict = useCallback(
    (tab: Tab, conflict: ExternalConflict): Promise<ExternalConflictDecision> => {
      saveConflictResolveRef.current?.({ kind: 'cancel' })
      const originalPath = conflict.identity.path ?? tab.relPath ?? tab.title
      const copyName = baseName(originalPath).replace(/\.bpmn$/iu, '') + '-copy.bpmn'
      const saveAsPath = joinRel(dirOf(originalPath), copyName)
      return new Promise((resolve) => {
        saveConflictResolveRef.current = resolve
        setSaveConflictPrompt({
          tabKey: tab.key,
          path: originalPath,
          conflict,
          saveAsPath,
          saveAsError: null,
          showComparison: false
        })
      })
    },
    []
  )
  const liveFiles = useMemo(() => {
    void liveWorkspaceVersion
    return liveWorkspaceIndexRef.current.files()
  }, [liveWorkspaceVersion])

  const cancelPendingDraftRecovery = useCallback((hidePrompt = true) => {
    draftRecoveryEpochRef.current += 1
    const pending = draftRecoveryPendingRef.current
    draftRecoveryPendingRef.current = null
    pending?.resolve('cancel')
    if (hidePrompt) setDraftRecoveryPrompt(null)
  }, [])

  const promptForDraftRecovery = useCallback(
    (
      tab: Tab,
      comparison: DraftRecoveryComparison,
      controller: DocumentSessionController
    ): Promise<DraftRecoveryDecision | 'cancel'> => {
      const epoch = draftRecoveryEpochRef.current
      const run = async (): Promise<DraftRecoveryDecision | 'cancel'> => {
        if (
          draftRecoveryEpochRef.current !== epoch ||
          sessionControllerRef.current !== controller ||
          workspaceGenRef.current !== tab.gen ||
          !controller.store.get(tab.key)
        ) {
          return 'cancel'
        }
        const requestId = ++draftRecoveryRequestIdRef.current
        const decision = await new Promise<DraftRecoveryDecision | 'cancel'>((resolve) => {
          draftRecoveryPendingRef.current = { requestId, resolve }
          setDraftRecoveryPrompt({ requestId, tab, comparison })
        })
        if (draftRecoveryPendingRef.current?.requestId === requestId) {
          draftRecoveryPendingRef.current = null
        }
        setDraftRecoveryPrompt((current) => (current?.requestId === requestId ? null : current))
        return draftRecoveryEpochRef.current === epoch ? decision : 'cancel'
      }
      const queued = draftRecoveryQueueRef.current.catch(() => undefined).then(run)
      draftRecoveryQueueRef.current = queued.then(
        () => undefined,
        () => undefined
      )
      return queued
    },
    []
  )

  // One application-level shortcut listener routes only to the active tab.
  // Dirty exit protection reads the controller snapshot, with the immediate
  // editor dirty event as a conservative fallback until async XML capture
  // updates that session.
  useEffect(() => {
    const router = commandRouterRef.current!
    const removeShortcuts = installApplicationShortcuts(window, router)
    const removeBeforeUnload = installBeforeUnloadDirtyGuard(window, () => {
      const controller = sessionControllerRef.current
      if (!controller) {
        return Object.values(dirtyByKeyRef.current).map((dirty) => ({ dirty }))
      }
      const sessions = controller.store.list()
      const known = new Set(sessions.map((session) => session.id))
      return [
        ...sessions.map((session) => ({
          dirty: session.dirty || Boolean(dirtyByKeyRef.current[session.id])
        })),
        ...Object.entries(dirtyByKeyRef.current)
          .filter(([id]) => !known.has(id))
          .map(([, dirty]) => ({ dirty }))
      ]
    })
    return () => {
      removeShortcuts()
      removeBeforeUnload()
      const drafts = draftCoordinatorRef.current
      if (drafts) {
        void drafts.flushAll().finally(() => drafts.dispose())
      }
      sessionStoreUnsubscribeRef.current?.()
      workspaceChangeUnsubscribeRef.current?.()
      workspaceCoordinatorRef.current?.close()
      workspaceActivationSequenceRef.current += 1
      workspaceLocalizationBindingRef.current?.controller.abort()
      cancelPendingDraftRecovery(false)
      saveConflictResolveRef.current?.({ kind: 'cancel' })
      saveConflictResolveRef.current = null
      switchResolveRef.current?.('cancel')
      switchResolveRef.current = null
      pathDirtyResolveRef.current?.('cancel')
      pathDirtyResolveRef.current = null
      downloadSwitchResolveRef.current?.('cancel')
      downloadSwitchResolveRef.current = null
      for (const unregister of Object.values(commandUnregisterersRef.current)) unregister()
      commandUnregisterersRef.current = {}
    }
  }, [cancelPendingDraftRecovery])

  useEffect(() => {
    const controller = sessionControllerRef.current
    if (!controller) return
    if (activeKey && controller.store.get(activeKey)) {
      controller.setActive(activeKey)
    } else if (!activeKey) {
      controller.setActive(null)
    }
  }, [activeKey])

  // --- workspace lifecycle -------------------------------------------------

  const refreshWorkspace = useCallback(
    async (_handle?: FileSystemDirectoryHandle, displayName?: string) => {
      const adapter = workspaceAdapterRef.current
      if (!adapter || !adapter.storage.capabilities.multipleFiles) return
      const token = ++refreshSequenceRef.current
      const snapshot = await snapshotAdapterWorkspace(
        adapter,
        displayName || rootNameRef.current || (adapter.mode === 'opfs' ? 'OrbitPM' : 'Workspace')
      )
      if (token !== refreshSequenceRef.current || workspaceAdapterRef.current !== adapter) {
        return
      }
      liveWorkspaceIndexRef.current.replaceSavedFiles(snapshot.files)
      setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      setTree(snapshot.tree)
      setWorkspaceIssues(
        snapshot.issues.map((issue) => `${issue.path ?? t('breadcrumb.root')}: ${issue.message}`)
      )
    },
    []
  )

  const retryManifestReconciliation = useCallback(async () => {
    const repair = manifestRepair
    if (
      !repair ||
      workspaceAdapterRef.current !== repair.adapter ||
      workspaceGenRef.current !== repair.generation
    ) {
      setManifestRepair(null)
      return
    }
    try {
      await repair.adapter.reconcileManifest()
      if (
        workspaceAdapterRef.current === repair.adapter &&
        workspaceGenRef.current === repair.generation
      ) {
        setManifestRepair(null)
        pushToast(t('workspace.manifest.repaired'), 'success')
      }
    } catch (error) {
      setManifestRepair({ ...repair, error })
      pushToast(t('workspace.manifest.retryFailed', { error: errMsg(error) }), 'error')
    }
  }, [manifestRepair, pushToast])

  const retryPathRecoveryCleanup = useCallback(async () => {
    const recovery = pathRecovery
    if (
      !recovery ||
      workspaceAdapterRef.current !== recovery.adapter ||
      workspaceGenRef.current !== recovery.generation
    ) {
      setPathRecovery(null)
      return
    }
    try {
      await opMutexRef.current.runExclusive(async () => {
        if (
          workspaceAdapterRef.current !== recovery.adapter ||
          workspaceGenRef.current !== recovery.generation
        ) {
          throw new Error(t('workspace.create.stale'))
        }
        await recovery.retry()
      })
      setPathRecovery(null)
      pushToast(t('workspace.path.recoverySuccess'), 'success')
    } catch (error) {
      setPathRecovery({ ...recovery, error })
      pushToast(t('workspace.path.recoveryFailed', { error: errMsg(error) }), 'error')
    }
  }, [pathRecovery, pushToast])

  const activateWorkspace = useCallback(
    async (
      adapter: WorkspaceAdapter,
      handle: FileSystemDirectoryHandle | null,
      displayName: string
    ) => {
      const activationSequence = ++workspaceActivationSequenceRef.current
      let activeAdapter = adapter
      let manifestAdapter: ManifestBoundWorkspaceAdapter | null = null
      if (adapter.storage.capabilities.multipleFiles && adapter.storage.capabilities.directories) {
        const bound = await bindWorkspaceToManifest(adapter, {
          onManifestWarning: (warning: WorkspaceManifestWarning) => {
            if (workspaceActivationSequenceRef.current !== activationSequence) return
            pushToast(
              t('workspace.manifest.warning', {
                path: warning.path,
                error: warning.message
              }),
              'error'
            )
          },
          onManifestError: (error) => {
            if (
              !manifestAdapter ||
              workspaceAdapterRef.current !== manifestAdapter ||
              workspaceActivationSequenceRef.current !== activationSequence
            ) {
              return
            }
            setManifestRepair({
              adapter: manifestAdapter,
              error,
              generation: workspaceGenRef.current
            })
            pushToast(t('workspace.manifest.postCommitError', { error: errMsg(error) }), 'error')
          }
        })
        if (workspaceActivationSequenceRef.current !== activationSequence) return
        manifestAdapter = bound.adapter
        activeAdapter = bound.adapter
      }
      let localizationCandidate: {
        controller: AbortController
        error: string | null
        snapshot: WorkspaceLocalizationState | null
        store: WorkspaceLocalizationStore
      } | null = null
      if (
        activeAdapter.storage.capabilities.multipleFiles &&
        activeAdapter.storage.capabilities.directories
      ) {
        const controller = new AbortController()
        const store = createWorkspaceLocalizationStore(activeAdapter)
        localizationCandidate = { controller, error: null, snapshot: null, store }
        try {
          localizationCandidate.snapshot = await store.load({ signal: controller.signal })
        } catch (error) {
          if (
            controller.signal.aborted ||
            workspaceActivationSequenceRef.current !== activationSequence
          ) {
            controller.abort()
            return
          }
          localizationCandidate.error = errMsg(error)
          pushToast(localizationCandidate.error, 'error')
        }
        if (workspaceActivationSequenceRef.current !== activationSequence) {
          localizationCandidate.controller.abort()
          return
        }
      }

      cancelPendingDraftRecovery()
      const previousDrafts = draftCoordinatorRef.current
      if (previousDrafts) {
        try {
          await previousDrafts.flushAll()
        } catch (error) {
          pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
        }
        if (workspaceActivationSequenceRef.current !== activationSequence) {
          localizationCandidate?.controller.abort()
          return
        }
        previousDrafts.dispose()
      }
      if (workspaceActivationSequenceRef.current !== activationSequence) {
        localizationCandidate?.controller.abort()
        return
      }
      sessionStoreUnsubscribeRef.current?.()
      sessionStoreUnsubscribeRef.current = null
      workspaceChangeUnsubscribeRef.current?.()
      workspaceChangeUnsubscribeRef.current = null
      workspaceCoordinatorRef.current?.close()
      workspaceCoordinatorRef.current = null
      sessionControllerRef.current = null
      draftCoordinatorRef.current = null

      // New session: bump the generation (invalidates every stale tab's save)
      // and update the sync handle mirror BEFORE any async scan can commit.
      workspaceGenRef.current += 1
      const workspaceGeneration = workspaceGenRef.current
      refreshSequenceRef.current += 1
      workspaceLocalizationBindingRef.current?.controller.abort()
      workspaceAdapterRef.current = activeAdapter
      workspaceLocalizationSnapshotRef.current = null
      setWorkspaceLocalizationSnapshot(null)
      setWorkspaceLocalizationError(localizationCandidate?.error ?? null)
      const workspaceLocalizationBinding = localizationCandidate
        ? {
            adapter: activeAdapter,
            controller: localizationCandidate.controller,
            generation: workspaceGeneration,
            store: localizationCandidate.store
          }
        : null
      workspaceLocalizationBindingRef.current = workspaceLocalizationBinding
      rootHandleRef.current = handle
      const history = activeAdapter.storage.capabilities.directories
        ? new PortableHistoryManager({
            adapter: activeAdapter,
            applicationVersion: __APP_VERSION__
          })
        : null
      historyManagerRef.current = history
      const workspaceIdentity: WorkspaceIdentity = {
        id: activeAdapter.id,
        generation: workspaceGenRef.current,
        mode: activeAdapter.mode
      }
      workspaceIdentityRef.current = workspaceIdentity

      if (!draftJournalRef.current) {
        const created = createBrowserDraftJournal()
        draftJournalRef.current = created.journal
        draftJournalDurableRef.current = created.durable
      }
      if (!draftJournalDurableRef.current && !draftJournalWarningShownRef.current) {
        draftJournalWarningShownRef.current = true
        pushToast(t('draftRecovery.degraded'), 'error')
      }
      const drafts = new DraftJournalCoordinator(draftJournalRef.current, {
        appVersion: __APP_VERSION__,
        debounceMs: 2000,
        onError: (error) => pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
      })
      drafts.attachLifecycle(window)
      draftCoordinatorRef.current = drafts

      let coordination: BroadcastWorkspaceCoordinator | undefined
      if (typeof globalThis.BroadcastChannel === 'function') {
        try {
          coordination = new BroadcastWorkspaceCoordinator({
            workspaceId: activeAdapter.id,
            instanceId: pageInstanceIdRef.current!
          })
          workspaceCoordinatorRef.current = coordination
        } catch (error) {
          pushToast(t('workspace.coordination.error', { error: errMsg(error) }), 'error')
        }
      }

      const controller = new DocumentSessionController({
        persistence: sessionPersistenceWithHistory(activeAdapter, workspaceIdentity, history),
        coordination,
        isWorkspaceCurrent: (identity) =>
          workspaceIdentityRef.current !== null &&
          identity.workspace.id === workspaceIdentityRef.current.id &&
          identity.workspace.generation === workspaceIdentityRef.current.generation &&
          workspaceAdapterRef.current === activeAdapter,
        onConfirmedSave: (session) => drafts.confirmedSave(session.id, session.lastSavedXml),
        onExplicitDiscard: (sessionId) => drafts.explicitDiscard(sessionId),
        onPostSaveError: (error) =>
          pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
      })
      sessionControllerRef.current = controller
      sessionStoreUnsubscribeRef.current = controller.store.subscribe(() => {
        for (const session of controller.store.list()) drafts.track(session)
      })
      if (coordination) {
        workspaceChangeUnsubscribeRef.current = coordination.subscribeChanges((change) => {
          if (workspaceAdapterRef.current !== activeAdapter) return
          const openSession = controller.store
            .list()
            .find((session) => session.identity.path === change.path)
          if (openSession?.dirty) {
            pushToast(t('workspace.coordination.changed', { path: change.path }), 'error')
          }
          if (activeAdapter.storage.capabilities.multipleFiles) {
            void refreshWorkspace(handle ?? undefined, displayName)
          }
        })
      }

      // Full reset BEFORE the new scan so no tab / tree / index / dirty flag /
      // modeler from the previous folder survives the switch (Codex CRITICAL-1).
      for (const uninstall of Object.values(badgeUninstallersRef.current)) {
        uninstall()
      }
      badgeUninstallersRef.current = {}
      for (const uninstall of Object.values(liveXmlUninstallersRef.current)) {
        uninstall()
      }
      liveXmlUninstallersRef.current = {}
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      liveWorkspaceIndexRef.current = new LiveWorkspaceIndex()
      setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      setTree(null)
      setWorkspaceIssues([])
      setTabs([])
      setActiveKey(null)
      setContents({})
      setDirtyByKey({})
      baseHashByPathRef.current = {}
      for (const timer of Object.values(liveXmlTimersRef.current)) clearTimeout(timer)
      liveXmlTimersRef.current = {}
      setModelersByKey({})
      setMounted(new Set())
      commandsRef.current = {}
      for (const unregister of Object.values(commandUnregisterersRef.current)) unregister()
      commandUnregisterersRef.current = {}
      pendingProcessFocusRef.current.clear()
      processFocusQueueRef.current.clear()
      pendingAiAutoSizeRef.current.clear()
      localizationSourceByTabRef.current.clear()
      localizationReviewByTabRef.current.clear()
      setTranslationReview(null)
      setTranslatingTab(null)
      setInterviewRequest(null)
      setAssistOpen(false)
      digestsCacheRef.current = null
      setLibraryImport(null)
      setBackupImportPlan(null)
      setHistoryOpen(false)
      setSearch('')
      setSearchOpen(false)
      setCatalogOpen(false)
      setMoveTarget(null)
      setDeleteTarget(null)
      setManifestRepair(null)
      setPathRecovery(null)
      pathDirtyResolveRef.current?.('cancel')
      pathDirtyResolveRef.current = null
      setPathDirtyPrompt(null)
      resolveSaveConflictPrompt({ kind: 'cancel' })
      setTreeRevealRequest(null)
      setSessionOwners([])
      setUnresolvedOpen(false)
      setHistory(emptyHistory())
      // A freshly-activated workspace has zero tabs (the catalog is showing), so
      // reveal the sidebar — the auto-collapse fires again the moment a file opens.
      setSidebarOpen(true)
      if (workspaceLocalizationBinding && localizationCandidate?.snapshot) {
        if (
          workspaceLocalizationBindingRef.current !== workspaceLocalizationBinding ||
          workspaceAdapterRef.current !== activeAdapter ||
          workspaceGenRef.current !== workspaceGeneration
        ) {
          return
        }
        workspaceLocalizationSnapshotRef.current = localizationCandidate.snapshot
        setWorkspaceLocalizationSnapshot(localizationCandidate.snapshot)
      }
      setWorkspaceAdapter(activeAdapter)
      rootNameRef.current = displayName
      setRootName(displayName)
      setMode(activeAdapter.mode)
      setPhase('ready')
      if (activeAdapter.mode === 'directory' && handle) {
        try {
          await rememberWorkspace(handle)
          rememberedRef.current = handle
          setRememberedName(handle.name)
        } catch {
          /* IDB may be unavailable; non-fatal */
        }
      }
      if (activeAdapter.storage.capabilities.multipleFiles) {
        await refreshWorkspace(handle ?? undefined, displayName)
      }
    },
    [cancelPendingDraftRecovery, refreshWorkspace, pushToast, resolveSaveConflictPrompt]
  )

  // First-load: fallback landing, remembered-folder reconnect, or fresh open.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!support) {
        setMode(browserWorkspaceAvailable ? 'opfs' : 'single-file')
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
        await activateWorkspace(
          new DirectoryWorkspaceAdapter(handle, {
            workspaceId: directoryWorkspaceId(handle)
          }),
          handle,
          handle.name
        )
      } else {
        rememberedRef.current = handle
        setRememberedName(handle.name)
        setPhase('need-reconnect')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [support, browserWorkspaceAvailable, activateWorkspace])

  // Manual "Refresh" (tree header): re-scan the folder for changes made outside
  // the app. The refresh guard makes concurrent/stale scans safe (Codex M7/M8).
  const handleManualRefresh = useCallback(async () => {
    const h = rootHandleRef.current
    if (!h) return
    await refreshWorkspace(h)
    const binding = workspaceLocalizationBindingRef.current
    if (binding) {
      try {
        const next = await binding.store.load({ signal: binding.controller.signal })
        if (
          workspaceLocalizationBindingRef.current !== binding ||
          workspaceAdapterRef.current !== binding.adapter ||
          workspaceGenRef.current !== binding.generation
        ) {
          return
        }
        commitWorkspaceLocalizationSnapshot(binding, next)
      } catch (error) {
        if (
          workspaceLocalizationBindingRef.current !== binding ||
          binding.controller.signal.aborted
        ) {
          return
        }
        workspaceLocalizationSnapshotRef.current = null
        setWorkspaceLocalizationSnapshot(null)
        const message = errMsg(error)
        setWorkspaceLocalizationError(message)
        pushToast(message, 'error')
        return
      }
    }
    pushToast(t('toast.refreshed'), 'info')
  }, [commitWorkspaceLocalizationSnapshot, refreshWorkspace, pushToast])

  // Auto-refresh on window focus / tab visibility, debounced 2s, so external
  // filesystem changes (files added/edited/deleted outside the app) don't leave
  // the tree, search, catalog and links stale indefinitely (Codex MAJOR-7-lite).
  useEffect(() => {
    if (!isMultiFileMode(mode)) return
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
  const saveAllDirty = useCallback(async (): Promise<{ downloaded: number }> => {
    // Partition so NO dirty tab is silently dropped: directory tabs write to disk;
    // fallback/virtual tabs (relPath === null) take the download-on-save path so
    // their unsaved work survives the switch instead of being discarded (NEW-C2).
    const { writable, downloadable } = partitionDirtyTabs(tabs, (tab) =>
      Boolean(dirtyByKey[tab.key])
    )
    const indexedXmlByPath = new Map(
      liveWorkspaceIndexRef.current.files().map((file) => [file.relPath, file.xml])
    )
    const readXml = async (tab: Tab): Promise<string> => {
      const modeler = modelersByKey[tab.key] as
        { saveXML?: (o: { format: boolean }) => Promise<{ xml?: string }> } | undefined
      if (modeler?.saveXML) {
        const { xml } = await modeler.saveXML({ format: true })
        if (xml) return xml
      }
      const fallback = indexedXmlByPath.get(liveIndexPath(tab)) ?? contents[tab.key]
      if (!fallback) {
        throw new Error(`Could not serialize the unsaved tab "${tab.title}".`)
      }
      return fallback
    }
    let downloaded = 0
    for (const tab of [...writable, ...downloadable]) {
      const xml = await readXml(tab)
      if (xml) {
        const result = await requestSaveRef.current(tab, xml)
        if (!result.durable) downloaded += 1
      }
    }
    return { downloaded }
  }, [tabs, dirtyByKey, modelersByKey, contents])

  const resolveSwitch = useCallback((choice: 'save' | 'discard' | 'cancel') => {
    setSwitchGuard(null)
    const r = switchResolveRef.current
    switchResolveRef.current = null
    r?.(choice)
  }, [])

  const resolvePathDirtyPrompt = useCallback((choice: 'save' | 'discard' | 'cancel') => {
    setPathDirtyPrompt(null)
    const resolve = pathDirtyResolveRef.current
    pathDirtyResolveRef.current = null
    resolve?.(choice)
  }, [])

  const resolveDownloadedSwitch = useCallback((choice: 'continue' | 'cancel') => {
    setDownloadSwitchGuard(null)
    const resolve = downloadSwitchResolveRef.current
    downloadSwitchResolveRef.current = null
    resolve?.(choice)
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
        const { downloaded } = await saveAllDirty()
        if (downloaded > 0) {
          const proceed = await new Promise<'continue' | 'cancel'>((resolve) => {
            downloadSwitchResolveRef.current = resolve
            setDownloadSwitchGuard({ count: downloaded })
          })
          if (proceed === 'cancel') return false
        }
      } catch (err) {
        pushToast(t('alert.saveAll.failed', { error: errMsg(err) }), 'error')
        return false
      }
    } else {
      const drafts = draftCoordinatorRef.current
      if (drafts) {
        try {
          await Promise.all(
            tabs.filter((tab) => dirtyByKey[tab.key]).map((tab) => drafts.explicitDiscard(tab.key))
          )
        } catch (error) {
          pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
          return false
        }
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
      await activateWorkspace(
        new DirectoryWorkspaceAdapter(handle, {
          workspaceId: directoryWorkspaceId(handle)
        }),
        handle,
        handle.name
      )
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
      await activateWorkspace(
        new DirectoryWorkspaceAdapter(handle, {
          workspaceId: directoryWorkspaceId(handle)
        }),
        handle,
        handle.name
      )
    } catch (err) {
      const code = classifyPickerError(err)
      if (code !== 'aborted') setPickError(t(pickerErrorKey(code)))
    } finally {
      setPickBusy(false)
    }
  }, [activateWorkspace])

  const handleOpenDifferent = useCallback(async () => {
    await handleOpenFolder()
  }, [handleOpenFolder])

  const handleOpenOpfs = useCallback(async () => {
    setPickBusy(true)
    setPickError(null)
    try {
      const adapter = await OpfsWorkspaceAdapter.open({
        workspaceId: workspaceInstanceId('opfs', 'orbitpm'),
        directoryName: 'orbitpm',
        requestPersistence: true
      })
      const proceed = await guardWorkspaceSwitch()
      if (!proceed) return
      await activateWorkspace(adapter, adapter.directoryHandle, t('workspace.storage.mode.opfs'))
    } catch (error) {
      setPickError(error instanceof Error ? error.message : String(error))
    } finally {
      setPickBusy(false)
    }
  }, [activateWorkspace, guardWorkspaceSwitch])

  // --- tabs ---------------------------------------------------------------

  const ensureDocumentSession = useCallback(
    (
      tab: Tab,
      xml: string,
      options?: {
        lastSavedXml?: string
        base?: FileFingerprint | null
      }
    ) => {
      const controller = sessionControllerRef.current
      const workspace = workspaceIdentityRef.current
      if (!controller || !workspace || tab.gen !== workspace.generation) return null
      const existing = controller.store.get(tab.key)
      if (existing) return existing
      const opened = controller.open({
        id: tab.key,
        identity: { workspace, path: tab.relPath },
        title: tab.title,
        xml,
        lastSavedXml: options?.lastSavedXml ?? xml,
        base: options?.base ?? null
      })
      if (activeKeyRef.current === tab.key) controller.setActive(tab.key)
      return opened
    },
    []
  )

  const reviewRecoveryDraft = useCallback(
    async (tab: Tab, loadedXml: string, loadedBase: FileFingerprint | null): Promise<string> => {
      const controller = sessionControllerRef.current
      const journal = draftJournalRef.current
      const drafts = draftCoordinatorRef.current
      const session = controller?.store.get(tab.key)
      if (!controller || !journal || !drafts || !session) return loadedXml
      try {
        const comparison = await findDraftRecoveryComparison(
          journal,
          {
            workspaceId: session.identity.workspace.id,
            path: session.identity.path,
            sessionId: session.id
          },
          loadedXml,
          loadedBase?.hash ?? null
        )
        if (!comparison) return loadedXml
        if (comparison.relation === 'same-content') {
          // The durable file itself proves this journal record is obsolete.
          await drafts.explicitDiscard(session.id)
          return loadedXml
        }
        controller.store.setDraftRecovery(session.id, {
          status: 'available',
          draftId: comparison.draft.id,
          timestamp: comparison.draft.timestamp,
          baseHash: comparison.draft.baseHash
        })
        const decision = await promptForDraftRecovery(tab, comparison, controller)
        if (
          decision === 'cancel' ||
          sessionControllerRef.current !== controller ||
          workspaceGenRef.current !== tab.gen ||
          !controller.store.get(session.id)
        ) {
          return loadedXml
        }
        if (decision === 'discard') {
          await drafts.explicitDiscard(session.id)
          controller.store.setDraftRecovery(session.id, {
            status: 'dismissed',
            draftId: comparison.draft.id,
            timestamp: comparison.draft.timestamp
          })
          return loadedXml
        }
        controller.updateXml(session.id, comparison.draft.xml)
        controller.store.setDraftRecovery(session.id, {
          status: 'restored',
          draftId: comparison.draft.id,
          timestamp: comparison.draft.timestamp
        })
        drafts.track(controller.store.get(session.id)!)
        setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
        return comparison.draft.xml
      } catch (error) {
        controller.store.setDraftRecovery(session.id, {
          status: 'error',
          message: errMsg(error)
        })
        pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
        return loadedXml
      }
    },
    [promptForDraftRecovery, pushToast]
  )

  const markMounted = useCallback((key: string) => {
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])

  useEffect(() => {
    if (activeKey) markMounted(activeKey)
  }, [activeKey, markMounted])

  const openDirectoryFile = useCallback(
    async (
      relPath: string,
      opts?: {
        collapse?: boolean
        autoSizeOnImport?: boolean
        localizationSource?: LocalizationSourceType
      }
    ) => {
      const workspace = workspaceIdentityRef.current
      const existingSession =
        workspace && sessionControllerRef.current
          ? sessionControllerRef.current.store.getByIdentity({ workspace, path: relPath })
          : undefined
      const key = existingSession?.id ?? relPath
      const tab: Tab = {
        key,
        title: baseName(relPath),
        relPath,
        gen: workspaceGenRef.current
      }
      if (opts?.localizationSource || !localizationSourceByTabRef.current.has(key)) {
        localizationSourceByTabRef.current.set(
          key,
          opts?.localizationSource ?? LocalizationSource.Xml
        )
      }
      if (opts?.autoSizeOnImport) pendingAiAutoSizeRef.current.add(key)
      // Opening a file normally hands the canvas the full window; the rail
      // restores the sidebar. A SINGLE click on a tree row opts out
      // (collapse: false) so browsing the explorer keeps it open — only a
      // double-click (and every non-tree open path: catalog, search, drill-down,
      // AI placement) takes the full window. A manual rail click after this wins
      // until the next collapsing open event.
      if (opts?.collapse !== false) setSidebarOpen(false)
      setCatalogOpen(false)
      setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, tab]))
      setActiveKey(key)
      if (contents[key] !== undefined) {
        const controller = sessionControllerRef.current
        if (controller?.store.get(key)) controller.setActive(key)
        return
      }
      // Read through the LIVE adapter mirror and guard the commit against a
      // mid-read folder switch: neither the loaded content nor its error toast is
      // committed if the workspace changed while the read was in flight, so a
      // stale read from the previous folder can never land in the new one (ORIG-1a).
      const adapter = workspaceAdapterRef.current
      if (!adapter) return
      let failed: unknown = null
      let loaded: FileSnapshot | null = null
      const outcome = await commitIfCurrent(
        () => workspaceGenRef.current,
        async () => {
          try {
            const snapshot = await adapter.read(relPath)
            return snapshot
          } catch (err) {
            failed = err
            return null
          }
        },
        (snapshot) => {
          loaded = snapshot
        }
      )
      if (outcome === 'committed' && failed) {
        setContents((prev) => ({ ...prev, [key]: '' }))
        pushToast(t('alert.openFileFailed', { relPath, error: errMsg(failed) }), 'error')
        return
      }
      if (outcome === 'committed' && loaded) {
        const snapshot = loaded as FileSnapshot
        baseHashByPathRef.current[relPath] = snapshot.hash
        const loadedXml = decodeUtf8Strict(snapshot.bytes, {
          operation: 'read',
          path: relPath
        })
        ensureDocumentSession(tab, loadedXml, {
          lastSavedXml: loadedXml,
          base: fingerprintFromSnapshot(snapshot)
        })
        const visibleXml = await reviewRecoveryDraft(
          tab,
          loadedXml,
          fingerprintFromSnapshot(snapshot)
        )
        if (!canCommitToWorkspace(tab.gen, workspaceGenRef.current)) return
        setContents((prev) => ({ ...prev, [key]: visibleXml }))
      }
    },
    [contents, ensureDocumentSession, pushToast, reviewRecoveryDraft]
  )

  const openVirtualTab = useCallback(
    (
      title: string,
      xml: string,
      opts?: {
        collapse?: boolean
        autoSizeOnImport?: boolean
        localizationSource?: LocalizationSourceType
      }
    ) => {
      const key = `virtual:${++virtualCounter.current}`
      localizationSourceByTabRef.current.set(
        key,
        opts?.localizationSource ?? LocalizationSource.Editor
      )
      if (opts?.autoSizeOnImport) pendingAiAutoSizeRef.current.add(key)
      // Same as openDirectoryFile: an opening tab collapses the sidebar to the
      // rail — EXCEPT when the caller needs the sidebar to survive (AI placement
      // keeps the panel mounted so its success box + fill-gaps CTA can show).
      if (opts?.collapse !== false) setSidebarOpen(false)
      setCatalogOpen(false)
      const tab: Tab = {
        key,
        title,
        relPath: null,
        gen: workspaceGenRef.current
      }
      ensureDocumentSession(tab, xml, { lastSavedXml: '' })
      setTabs((prev) => [...prev, tab])
      setContents((prev) => ({ ...prev, [key]: xml }))
      setDirtyByKey((prev) => ({ ...prev, [key]: true }))
      liveWorkspaceIndexRef.current.updateDirty(liveIndexPath(tab), xml)
      setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      setActiveKey(key)
      return key
    },
    [ensureDocumentSession]
  )

  const activateSingleFileDocument = useCallback(
    async (title: string, xml: string, source: LocalizationSourceType): Promise<void> => {
      const path = title.toLocaleLowerCase('en-US').endsWith('.bpmn') ? title : `${title}.bpmn`
      const adapter = new SingleFileWorkspaceAdapter({
        workspaceId: workspaceInstanceId('single-file', path),
        path,
        bytes: new TextEncoder().encode(xml),
        modifiedAt: Date.now(),
        mimeType: 'application/xml'
      })
      await activateWorkspace(adapter, null, path)
      const snapshot = await adapter.read(path)
      const saved = fileMetaFromSnapshot(snapshot)
      baseHashByPathRef.current[path] = snapshot.hash
      liveWorkspaceIndexRef.current.updateSaved(saved)
      setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      const tab: Tab = {
        key: path,
        title: path,
        relPath: path,
        gen: workspaceGenRef.current
      }
      ensureDocumentSession(tab, xml, {
        lastSavedXml: xml,
        base: fingerprintFromSnapshot(snapshot)
      })
      const visibleXml = await reviewRecoveryDraft(tab, xml, fingerprintFromSnapshot(snapshot))
      if (!canCommitToWorkspace(tab.gen, workspaceGenRef.current)) return
      localizationSourceByTabRef.current.set(path, source)
      setTabs([tab])
      setContents({ [path]: visibleXml })
      setActiveKey(path)
      setSidebarOpen(false)
    },
    [activateWorkspace, ensureDocumentSession, reviewRecoveryDraft]
  )

  const closeTab = useCallback(
    (key: string): boolean => {
      pendingProcessFocusRef.current.delete(key)
      const closingTab = tabs.find((tab) => tab.key === key)
      const explicitlyDiscarded = Boolean(dirtyByKey[key])
      if (explicitlyDiscarded) {
        const confirmed = window.confirm(
          t('confirm.discardUnsaved', { title: closingTab?.title ?? 'this file' })
        )
        if (!confirmed) return false
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
      const controller = sessionControllerRef.current
      const drafts = draftCoordinatorRef.current
      const closeSession = async (): Promise<void> => {
        if (explicitlyDiscarded) await drafts?.explicitDiscard(key)
        await drafts?.untrack(key)
        controller?.store.close(key)
      }
      void closeSession().catch((error) =>
        pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
      )
      commandUnregisterersRef.current[key]?.()
      delete commandUnregisterersRef.current[key]
      commandRouterRef.current?.unregister(key)
      const drop = <T,>(obj: Record<string, T>): Record<string, T> => {
        if (!(key in obj)) return obj
        const next = { ...obj }
        delete next[key]
        return next
      }
      setContents(drop)
      setDirtyByKey(drop)
      setModelersByKey(drop)
      localizationSourceByTabRef.current.delete(key)
      localizationReviewByTabRef.current.delete(key)
      liveXmlUninstallersRef.current[key]?.()
      delete liveXmlUninstallersRef.current[key]
      const timer = liveXmlTimersRef.current[key]
      if (timer) clearTimeout(timer)
      delete liveXmlTimersRef.current[key]
      if (closingTab) {
        liveWorkspaceIndexRef.current.clearDirty(liveIndexPath(closingTab))
        setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      }
      delete commandsRef.current[key]
      setMounted((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      return true
    },
    [dirtyByKey, pushToast, tabs]
  )

  const handleDirtyChange = useCallback((key: string, dirty: boolean) => {
    setDirtyByKey((prev) => (prev[key] === dirty ? prev : { ...prev, [key]: dirty }))
    const session = sessionControllerRef.current?.store.get(key)
    if (session) draftCoordinatorRef.current?.track(session)
  }, [])

  const scheduleLiveXmlCapture = useCallback(
    (
      tab: Tab,
      modeler: {
        saveXML?: (options: { format: boolean }) => Promise<{ xml?: string }>
      }
    ) => {
      const existing = liveXmlTimersRef.current[tab.key]
      if (existing) clearTimeout(existing)
      liveXmlTimersRef.current[tab.key] = setTimeout(() => {
        delete liveXmlTimersRef.current[tab.key]
        void modeler
          .saveXML?.({ format: true })
          .then(({ xml }) => {
            if (!xml || workspaceGenRef.current !== tab.gen) return
            const baseline = contents[tab.key] ?? xml
            const baseHash = tab.relPath ? baseHashByPathRef.current[tab.relPath] : undefined
            const existing =
              sessionControllerRef.current?.store.get(tab.key) ??
              ensureDocumentSession(tab, xml, {
                lastSavedXml: baseline,
                base: baseHash
                  ? {
                      hash: baseHash,
                      size: new TextEncoder().encode(baseline).byteLength,
                      modifiedAt: 0
                    }
                  : null
              })
            if (existing) {
              const updated = sessionControllerRef.current!.updateXml(tab.key, xml)
              draftCoordinatorRef.current?.track(updated)
              setDirtyByKey((previous) =>
                previous[tab.key] === updated.dirty
                  ? previous
                  : { ...previous, [tab.key]: updated.dirty }
              )
            }
            liveWorkspaceIndexRef.current.updateDirty(liveIndexPath(tab), xml)
            setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
            digestsCacheRef.current = null
          })
          .catch(() => {
            // A transient serialization error must not discard the last coherent
            // live index snapshot.
          })
      }, 120)
    },
    [contents, ensureDocumentSession]
  )

  const handleRequestSave = useCallback(
    async (tab: Tab, xml: string, options?: { explicitDraftWithErrors?: boolean }) => {
      const controller = sessionControllerRef.current
      if (!controller) throw new Error('Document-session controller is unavailable.')
      const baseHash = tab.relPath ? baseHashByPathRef.current[tab.relPath] : undefined
      const baseline = contents[tab.key] ?? xml
      const session =
        controller.store.get(tab.key) ??
        ensureDocumentSession(tab, xml, {
          lastSavedXml: baseline,
          base: baseHash
            ? {
                hash: baseHash,
                size: new TextEncoder().encode(baseline).byteLength,
                modifiedAt: 0
              }
            : null
        })
      if (!session) throw new Error(t('alert.staleWrite'))
      const current = controller.updateXml(tab.key, xml)
      draftCoordinatorRef.current?.track(current)

      if (baseline) {
        const preservation = await validateUnknownExtensionPreservation(baseline, xml)
        if (!preservation.valid) {
          throw new Error(
            `Save blocked because opaque BPMN extension data changed: ${preservation.issues.map((issue) => issue.code).join(', ')}`
          )
        }
      }
      await validateReleaseXml(xml, {
        action: options?.explicitDraftWithErrors ? 'save-draft-with-errors' : 'save',
        knownProcessIds: liveWorkspaceIndexRef.current.processIndex().keys(),
        requireBilingual: false,
        requireDi: true,
        explicitDraftWithErrors: options?.explicitDraftWithErrors
      })
      const adapter = workspaceAdapterRef.current
      if (!tab.relPath || adapter?.storage.persistence === 'download') {
        await draftCoordinatorRef.current?.flush(tab.key)
        downloadBpmn(tab.title.endsWith('.bpmn') ? tab.title : `${tab.title}.bpmn`, xml)
        setDirtyByKey((previous) => ({ ...previous, [tab.key]: current.dirty }))
        pushToast(t('session.download.draftRetained'), 'info')
        return { durable: false }
      }
      if (tab.relPath && adapter) {
        // Refuse a write from a tab whose workspace was switched out from under
        // it — otherwise it would land its relative path in the WRONG folder.
        if (!canCommitToWorkspace(tab.gen, workspaceGenRef.current)) {
          pushToast(t('alert.staleWrite'), 'error')
          throw new Error(t('alert.staleWrite'))
        }
        const capturedRevision = controller.store.get(tab.key)!.revision
        let outcome = await controller.save(tab.key, {
          xml,
          expectedRevision: capturedRevision
        })
        while (outcome.status === 'external-conflict') {
          const decision = await promptForSaveConflict(tab, outcome.conflict)
          if (
            decision.kind === 'cancel' ||
            sessionControllerRef.current !== controller ||
            workspaceAdapterRef.current !== adapter ||
            !canCommitToWorkspace(tab.gen, workspaceGenRef.current)
          ) {
            throw new Error(t('session.save.failed', { status: 'cancelled' }))
          }
          outcome = await controller.save(tab.key, {
            xml,
            expectedRevision: capturedRevision,
            conflictDecision: decision
          })
        }
        if (outcome.status === 'clean') {
          await draftCoordinatorRef.current?.confirmedSave(tab.key, xml)
          setDirtyByKey((previous) => ({ ...previous, [tab.key]: false }))
          return { durable: true }
        }
        if (outcome.status === 'reloaded') {
          const external = outcome.external
          const modeler = modelersByKey[tab.key] as
            { importXML?: (candidate: string) => Promise<unknown> } | undefined
          baseHashByPathRef.current[tab.relPath] = external.fingerprint.hash
          liveWorkspaceIndexRef.current.updateSaved({
            relPath: tab.relPath,
            xml: external.xml,
            lastModified: external.fingerprint.modifiedAt,
            size: external.fingerprint.size
          })
          try {
            await modeler?.importXML?.(external.xml)
          } catch (error) {
            // The controller has already accepted the external file and
            // discarded the prior journal record. Re-track and synchronously
            // flush the captured local XML so a failed canvas refresh cannot
            // silently lose the edits still visible to the user.
            const restoredLocal = controller.updateXml(tab.key, xml)
            draftCoordinatorRef.current?.track(restoredLocal)
            let draftRecoveryError: unknown
            try {
              await draftCoordinatorRef.current?.flush(tab.key)
            } catch (draftError) {
              draftRecoveryError = draftError
              pushToast(t('draftRecovery.error', { error: errMsg(draftError) }), 'error')
            }
            liveWorkspaceIndexRef.current.updateDirty(tab.relPath, xml)
            setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
            setContents((previous) => ({ ...previous, [tab.key]: xml }))
            setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
            throw new Error(
              t('session.save.reloadEditorFailed', {
                error: draftRecoveryError
                  ? `${errMsg(error)}; ${errMsg(draftRecoveryError)}`
                  : errMsg(error)
              })
            )
          }
          liveWorkspaceIndexRef.current.clearDirty(tab.relPath)
          setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
          setContents((previous) => ({ ...previous, [tab.key]: external.xml }))
          setDirtyByKey((previous) => ({ ...previous, [tab.key]: false }))
          return { durable: true }
        }
        if (outcome.status !== 'success' && outcome.status !== 'saved-as') {
          if (outcome.status === 'locked') {
            throw new Error(t('session.save.locked'))
          }
          if (outcome.status === 'stale-workspace' || outcome.status === 'stale-capture') {
            throw new Error(t('alert.staleWrite'))
          }
          if (outcome.status === 'permission-loss' || outcome.status === 'storage-failure') {
            throw new Error(outcome.failure.message)
          }
          throw new Error(t('session.save.failed', { status: outcome.status }))
        }
        const savedPath = outcome.status === 'saved-as' ? outcome.identity.path : tab.relPath
        if (!savedPath) throw new Error(t('session.save.failed', { status: 'missing-path' }))
        baseHashByPathRef.current[savedPath] = outcome.fingerprint.hash
        const saved: FileMeta = {
          relPath: savedPath,
          xml,
          lastModified: outcome.fingerprint.modifiedAt,
          size: outcome.fingerprint.size
        }
        if (outcome.status === 'saved-as') {
          liveWorkspaceIndexRef.current.clearDirty(tab.relPath)
          setTabs((previous) =>
            previous.map((candidate) =>
              candidate.key === tab.key
                ? { ...candidate, relPath: savedPath, title: baseName(savedPath) }
                : candidate
            )
          )
        }
        liveWorkspaceIndexRef.current.updateSaved(saved)
        const savedSession = controller.store.get(tab.key)
        if (outcome.remainingDirty && savedSession) {
          liveWorkspaceIndexRef.current.updateDirty(savedPath, savedSession.currentXml)
        } else {
          liveWorkspaceIndexRef.current.clearDirty(savedPath)
        }
        setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
        setContents((previous) => ({ ...previous, [tab.key]: xml }))
        setDirtyByKey((previous) => ({
          ...previous,
          [tab.key]: outcome.remainingDirty
        }))
        if (outcome.remainingDirty) {
          throw new Error(t('session.save.newerEdits'))
        }
        if (outcome.status === 'saved-as') await refreshWorkspace()
        return { durable: true }
      }
      throw new Error(t('session.save.failed', { status: 'missing-workspace' }))
    },
    [
      contents,
      ensureDocumentSession,
      modelersByKey,
      promptForSaveConflict,
      pushToast,
      refreshWorkspace
    ]
  )
  requestSaveRef.current = handleRequestSave

  // --- derived data (saved files overlaid with live dirty XML) ------------

  const processIndex: ProcessIndex = useMemo(() => {
    void liveWorkspaceVersion
    return liveWorkspaceIndexRef.current.processIndex()
  }, [liveWorkspaceVersion])
  const duplicateProcessDiagnostics = useMemo(() => {
    void liveWorkspaceVersion
    return liveWorkspaceIndexRef.current.duplicateDiagnostics()
  }, [liveWorkspaceVersion])
  const handleRepairDuplicateProcessId = useCallback(
    async (processId: string) => {
      const diagnostic = liveWorkspaceIndexRef.current
        .duplicateDiagnostics()
        .find((item) => item.processId === processId)
      if (!diagnostic) return
      const target = diagnostic.occurrences[diagnostic.occurrences.length - 1]
      const source = liveWorkspaceIndexRef.current
        .files()
        .find((file) => file.relPath === target.relPath)?.xml
      if (!source) return
      await validateReleaseXml(source, {
        action: 'apply-editor',
        knownProcessIds: liveWorkspaceIndexRef.current.processIndex().keys(),
        requireBilingual: false,
        requireDi: true
      })
      const repair = await liveWorkspaceIndexRef.current.repairDuplicateProcessId(
        target.relPath,
        processId,
        { occurrence: target.occurrence }
      )
      await validateReleaseXml(repair.xml, {
        action: 'apply-editor',
        knownProcessIds: liveWorkspaceIndexRef.current.processIndex().keys(),
        requireBilingual: false,
        requireDi: true
      })
      setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      let tab = tabs.find((item) => item.relPath === target.relPath)
      if (!tab) {
        tab = {
          key: target.relPath,
          title: baseName(target.relPath),
          relPath: target.relPath,
          gen: workspaceGenRef.current
        }
        setTabs((previous) => [...previous, tab!])
      }
      localizationSourceByTabRef.current.set(tab.key, LocalizationSource.Editor)
      setContents((previous) => ({ ...previous, [tab!.key]: repair.xml }))
      setDirtyByKey((previous) => ({ ...previous, [tab!.key]: true }))
      setActiveKey(tab.key)
      setCatalogOpen(false)
      const modeler = modelersByKey[tab.key] as
        { importXML?: (xml: string) => Promise<unknown> } | undefined
      if (modeler?.importXML) {
        await modeler.importXML(repair.xml)
        setDirtyByKey((previous) => ({ ...previous, [tab!.key]: true }))
      }
    },
    [tabs, modelersByKey]
  )
  // Parent→child callActivity links across the workspace — drives the
  // explorer's nested 🔗 rows and the exported library manifest.
  const linkGraph = useMemo(
    () => buildLinkGraph(liveFiles, processIndex),
    [liveFiles, processIndex]
  )
  // One deterministic projection for physical canonical rows plus read-only
  // process references. relPath is carried only as the canonical file's
  // current locator; process ids remain the semantic identity.
  const processHierarchy = useMemo(
    () => buildProcessHierarchy(tree, processIndex, linkGraph),
    [tree, processIndex, linkGraph]
  )
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
  const searchIndex = useMemo(() => {
    void liveWorkspaceVersion
    return liveWorkspaceIndexRef.current.searchDocuments()
  }, [liveWorkspaceVersion])
  const xmlByPath = useMemo(
    () => new Map(liveFiles.map((file) => [file.relPath, file.xml])),
    [liveFiles]
  )
  const catalogRows = useMemo(
    () => buildCatalog(liveFiles, processIndex),
    [liveFiles, processIndex]
  )
  const visibleCatalog = useMemo(
    () => sortCatalog(filterCatalog(catalogRows, search, xmlByPath), catSort, catDir),
    [catalogRows, search, xmlByPath, catSort, catDir]
  )
  const searchGroups = useMemo(() => searchWorkspace(searchIndex, search), [searchIndex, search])
  const folders = useMemo(() => collectFolders(tree), [tree])
  const filePaths = useMemo(() => new Set(liveFiles.map((file) => file.relPath)), [liveFiles])
  const dirtyFilePaths = useMemo(
    () =>
      new Set(
        tabs.filter((tab) => tab.relPath && dirtyByKey[tab.key]).map((tab) => tab.relPath as string)
      ),
    [tabs, dirtyByKey]
  )

  const requestTreeReveal = useCallback((processId?: string, relPath?: string) => {
    setTreeRevealRequest({
      token: ++treeRevealTokenRef.current,
      processId,
      relPath
    })
  }, [])

  const queueProcessFocus = useCallback(
    (relPath: string, modeler: unknown, processId: string): void => {
      const previous = processFocusQueueRef.current.get(relPath) ?? Promise.resolve()
      const queued = previous
        .catch(() => undefined)
        .then(async () => {
          // A newer request for this file supersedes one that has not started.
          if (pendingProcessFocusRef.current.get(relPath) !== processId) return
          const focused = await focusProcessRoot(modeler, processId)
          if (focused && pendingProcessFocusRef.current.get(relPath) === processId) {
            pendingProcessFocusRef.current.delete(relPath)
          }
        })
      processFocusQueueRef.current.set(relPath, queued)
      void queued.then(() => {
        if (processFocusQueueRef.current.get(relPath) === queued) {
          processFocusQueueRef.current.delete(relPath)
        }
      })
    },
    []
  )

  /** Open an explicitly selected physical file and reveal its sole actionable
   * canonical row. This path is for file-level UI that has no process id. */
  const openFileAndReveal = useCallback(
    (relPath: string) => {
      setSidebarOpen(true)
      requestTreeReveal(undefined, relPath)
      void openDirectoryFile(relPath, { collapse: false })
    },
    [openDirectoryFile, requestTreeReveal]
  )

  /**
   * Resolve semantic identity to the canonical row's current locator. An
   * ambiguous id is never resolved through ProcessIndex's last-wins entry.
   * Physical search/catalog results may still open their explicit file through
   * openFileAndReveal, without claiming that the duplicate process was found.
   */
  const openCanonicalProcess = useCallback(
    (processId: string): boolean => {
      // A duplicate semantic id has no canonical process occurrence. Search
      // may still fall back to opening its explicit physical file, but it must
      // not use that mutable path to pretend the process itself was resolved.
      if (linkGraph.ambiguousProcessIds.has(processId)) return false
      const relPath =
        processHierarchy.canonicalPathByProcessId.get(processId) ??
        processIndex.get(processId)?.relPath
      if (!relPath) return false

      pendingProcessFocusRef.current.set(relPath, processId)
      const mountedModeler = modelersByKey[relPath]
      if (mountedModeler) {
        queueProcessFocus(relPath, mountedModeler, processId)
      }
      setSidebarOpen(true)
      requestTreeReveal(processId, relPath)
      void openDirectoryFile(relPath, { collapse: false })
      return true
    },
    [
      linkGraph,
      processHierarchy,
      processIndex,
      modelersByKey,
      openDirectoryFile,
      requestTreeReveal,
      queueProcessFocus
    ]
  )
  // Owner suggestions for the Step-details picker + the "Export owners (CSV)"
  // action — aggregated across every .bpmn in the workspace (empty in fallback)
  // and merged with the session's applied-but-unsaved owners (disk wins).
  const ownersEntries = useMemo(
    () =>
      mergeOwners(
        collectOwners(liveFiles.map((f) => ({ relPath: f.relPath, xml: f.xml }))),
        sessionOwners
      ),
    [liveFiles, sessionOwners]
  )

  // The whole-workspace file list the assistant reasons over in DIRECTORY mode
  // (kept in sync with disk via `files`). Its stable reference keys the digest
  // memo so repeated questions over an unchanged workspace reuse one parse.
  const assistFiles = useMemo<Array<{ relPath: string; xml: string }>>(
    () => liveFiles.map((f) => ({ relPath: f.relPath, xml: f.xml })),
    [liveFiles]
  )

  const getDigests = useCallback(async (): Promise<ProcessDigest[]> => {
    if (isMultiFileMode(mode)) {
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
        { saveXML?: (o: { format: boolean }) => Promise<{ xml?: string }> } | undefined
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
    if (isMultiFileMode(mode)) {
      return collectWorkspaceUnresolved(liveFiles, processIndex)
    }
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
  }, [mode, liveFiles, processIndex, activeKey, contents, tabs])
  const unresolvedCount = workspaceUnresolved.length

  // --- linking / drill-down ----------------------------------------------

  const handleCreateMissingProcess = useCallback(
    async (calledElementId: string) => {
      const adapter = workspaceAdapterRef.current
      if (!(isMultiFileMode(mode) && adapter?.storage.capabilities.multipleFiles)) {
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
          if (workspaceAdapterRef.current !== adapter) throw new Error(t('alert.staleWrite'))
          const taken = await directBpmnSlugs(adapter, '')
          const slug = dedupeSlug(deriveFileBaseName(name || calledElementId), (c) =>
            taken.has(c.toLowerCase())
          )
          const doc = buildMissingProcessDoc(calledElementId, name, slug)
          return writeUniqueBpmn(adapter, '', doc.fileBaseName, doc.xml)
        })
        await refreshWorkspace()
        setSidebarOpen(true)
        requestTreeReveal(calledElementId, relPath)
        void openDirectoryFile(relPath, { collapse: false })
      } catch (err) {
        pushToast(t('alert.createProcessFailed', { error: errMsg(err) }), 'error')
      }
    },
    [mode, promptText, refreshWorkspace, openDirectoryFile, pushToast, requestTreeReveal]
  )

  const handleOpenCalledProcess = useCallback(
    (processId: string) => {
      if (openCanonicalProcess(processId)) return
      // Duplicate ids are an ambiguous workspace-authoring error, not a
      // missing target. Never create a third process or choose a last-wins
      // locator for a canvas drill-down.
      if (linkGraph.ambiguousProcessIds.has(processId)) {
        pushToast(t('alert.noProcessWithId', { processId }), 'info')
        return
      }
      if (workspaceAdapter?.storage.capabilities.multipleFiles) {
        void handleCreateMissingProcess(processId)
      } else {
        pushToast(t('alert.noProcessWithId', { processId }), 'info')
      }
    },
    [openCanonicalProcess, linkGraph, workspaceAdapter, handleCreateMissingProcess, pushToast]
  )

  // --- tree CRUD ----------------------------------------------------------

  const handleNewProcess = useCallback(
    async (folderRel: string) => {
      const adapter = workspaceAdapterRef.current
      if (!adapter?.storage.capabilities.multipleFiles) return
      const name = await promptText({
        title: t('dialog.newProcess.title'),
        label: t('dialog.newProcess.label'),
        initialValue: t('dialog.newProcess.initialValue'),
        okLabel: t('dialog.newProcess.okLabel'),
        hint: t('dialog.newProcess.hint.directory')
      })
      if (!name) return
      try {
        // Commit the canvas/sidebar intent before the storage write becomes
        // externally observable; this prevents a late post-create collapse
        // from overriding a user's immediate rail toggle.
        setSidebarOpen(false)
        const relPath = await opMutexRef.current.runExclusive(async () => {
          if (workspaceAdapterRef.current !== adapter) throw new Error(t('alert.staleWrite'))
          const taken = await directBpmnSlugs(adapter, folderRel)
          const slug = dedupeSlug(deriveFileBaseName(name), (c) => taken.has(c.toLowerCase()))
          // Also de-dup the derived <process id> against the LIVE process index
          // so ANY id collision (incl. a hash clash for two Arabic names) is
          // suffixed rather than silently cross-wiring their call links (ORIG-6b).
          const doc = buildNewProcessDoc(name, slug, (candidate) => processIndex.has(candidate))
          return writeUniqueBpmn(adapter, folderRel, doc.fileBaseName, doc.xml)
        })
        await refreshWorkspace()
        void openDirectoryFile(relPath)
      } catch (err) {
        pushToast(t('alert.createProcessFailed', { error: errMsg(err) }), 'error')
      }
    },
    [promptText, refreshWorkspace, openDirectoryFile, pushToast, processIndex]
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
    const proceed = await guardWorkspaceSwitch()
    if (!proceed) return
    await activateSingleFileDocument(`${doc.fileBaseName}.bpmn`, doc.xml, LocalizationSource.Editor)
  }, [promptText, processIndex, guardWorkspaceSwitch, activateSingleFileDocument])

  const handleNewProcessClick = useCallback(() => {
    if (workspaceAdapter?.storage.capabilities.multipleFiles) void handleNewProcess('')
    else void handleNewProcessFallback()
  }, [workspaceAdapter, handleNewProcess, handleNewProcessFallback])

  const handleNewFolder = useCallback(
    async (folderRel: string) => {
      const adapter = workspaceAdapterRef.current
      if (!adapter?.storage.capabilities.directories) return
      const name = await promptText({
        title: t('dialog.newFolder.title'),
        label: t('dialog.newFolder.label'),
        initialValue: t('dialog.newFolder.initialValue'),
        okLabel: t('dialog.newFolder.okLabel')
      })
      if (!name) return
      try {
        await opMutexRef.current.runExclusive(async () => {
          if (workspaceAdapterRef.current !== adapter) throw new Error(t('alert.staleWrite'))
          await adapter.createFolder(joinRel(folderRel, name.trim()))
        })
        await refreshWorkspace()
      } catch (err) {
        pushToast(t('alert.createFolderFailed', { error: errMsg(err) }), 'error')
      }
    },
    [promptText, refreshWorkspace, pushToast]
  )

  const requestPathDirtyDecision = useCallback(
    (
      count: number,
      request: Pick<PathTransactionPlan['request'], 'kind' | 'sourcePath'>
    ): Promise<'save' | 'discard' | 'cancel'> =>
      new Promise((resolve) => {
        pathDirtyResolveRef.current = resolve
        setPathDirtyPrompt({ count, kind: request.kind, path: request.sourcePath })
      }),
    []
  )

  const updateUiAfterPathCommit = useCallback(
    async (plan: PathTransactionPlan): Promise<void> => {
      const deletedIds = new Set(plan.request.kind === 'delete' ? plan.affectedSessionIds : [])
      const previousTabs = tabs

      if (plan.request.kind === 'delete') {
        const isDeletedTab = (tab: Tab): boolean =>
          deletedIds.has(tab.key) ||
          Boolean(tab.relPath && migratedPathForPlan(plan, tab.relPath) === null)
        const deletedUiIds = new Set([
          ...deletedIds,
          ...previousTabs.filter(isDeletedTab).map((tab) => tab.key)
        ])
        const drafts = draftCoordinatorRef.current
        for (const id of deletedUiIds) {
          commandUnregisterersRef.current[id]?.()
          delete commandUnregisterersRef.current[id]
          commandRouterRef.current?.unregister(id)
          liveXmlUninstallersRef.current[id]?.()
          delete liveXmlUninstallersRef.current[id]
          badgeUninstallersRef.current[id]?.()
          delete badgeUninstallersRef.current[id]
          const timer = liveXmlTimersRef.current[id]
          if (timer) clearTimeout(timer)
          delete liveXmlTimersRef.current[id]
          localizationSourceByTabRef.current.delete(id)
          localizationReviewByTabRef.current.delete(id)
          pendingProcessFocusRef.current.delete(id)
          pendingAiAutoSizeRef.current.delete(id)
          delete commandsRef.current[id]
          await drafts?.untrack(id)
        }
        setTabs((previous) => previous.filter((tab) => !isDeletedTab(tab)))
        setActiveKey((previous) => {
          if (!previous || !deletedUiIds.has(previous)) return previous
          const remaining = previousTabs.filter((tab) => !isDeletedTab(tab))
          return remaining.at(-1)?.key ?? null
        })
        const dropDeleted = <T,>(record: Record<string, T>): Record<string, T> => {
          if (![...deletedUiIds].some((id) => id in record)) return record
          const next = { ...record }
          for (const id of deletedUiIds) delete next[id]
          return next
        }
        setContents(dropDeleted)
        setDirtyByKey(dropDeleted)
        setModelersByKey(dropDeleted)
        setMounted((previous) => {
          const next = new Set(previous)
          for (const id of deletedUiIds) next.delete(id)
          return next.size === previous.size ? previous : next
        })
      } else {
        setTabs((previous) =>
          previous.map((tab) => {
            if (!tab.relPath) return tab
            const relPath = migratedPathForPlan(plan, tab.relPath)
            return relPath && relPath !== tab.relPath
              ? { ...tab, relPath, title: baseName(relPath) }
              : tab
          })
        )
      }

      const nextHashes: Record<string, string> = {}
      for (const [path, hash] of Object.entries(baseHashByPathRef.current)) {
        const migrated = migratedPathForPlan(plan, path)
        if (migrated) nextHashes[migrated] = hash
      }
      baseHashByPathRef.current = nextHashes

      const index = liveWorkspaceIndexRef.current
      const affectedPaths = index
        .files()
        .map((file) => file.relPath)
        .filter((path) => migratedPathForPlan(plan, path) !== path)
        .sort((left, right) => right.length - left.length)
      for (const path of affectedPaths) {
        const migrated = migratedPathForPlan(plan, path)
        if (migrated) index.move(path, migrated)
        else {
          index.clearDirty(path)
          index.removeSaved(path)
        }
      }
      setLiveWorkspaceVersion(index.version)
      digestsCacheRef.current = null
    },
    [tabs]
  )

  const runPathTransaction = useCallback(
    async (request: {
      kind: 'rename' | 'move' | 'delete'
      entryKind: 'file' | 'directory'
      sourcePath: string
      destinationPath?: string
      deleteConfirmed?: boolean
    }): Promise<'committed' | 'cancelled' | 'failed'> => {
      const adapter = workspaceAdapterRef.current
      const controller = sessionControllerRef.current
      if (!adapter || !controller) throw new Error(t('workspace.path.unavailable'))
      let plan = planPathTransaction(controller.store.list(), {
        id:
          typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID()
            : `path-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        workspaceId: adapter.id,
        ...request,
        deleteConfirmed: request.kind === 'delete' ? false : request.deleteConfirmed
      })
      if (request.kind === 'delete' && request.deleteConfirmed) {
        plan = confirmPathDelete(plan)
      }
      if (plan.phase === 'awaiting-dirty-decision') {
        const choice = await requestPathDirtyDecision(plan.dirtySessionIds.length, plan.request)
        plan = resolveDirtyPathDecision(
          plan,
          choice === 'save'
            ? 'save-and-continue'
            : choice === 'discard'
              ? 'continue-without-saving'
              : 'cancel'
        )
      }
      if (plan.phase === 'cancelled') return 'cancelled'
      const history = historyManagerRef.current
      const drafts = draftCoordinatorRef.current
      const mutatePath = createAdapterPathMutation(adapter, { history: history ?? undefined })
      let retryFinalize: (() => Promise<void>) | undefined
      const result = await opMutexRef.current.runExclusive(async () => {
        if (
          workspaceAdapterRef.current !== adapter ||
          sessionControllerRef.current !== controller
        ) {
          throw new Error(t('alert.staleWrite'))
        }
        return executePathTransaction(controller.store, plan, {
          saveSession: async (sessionId) => {
            const session = controller.store.get(sessionId)
            const tab = tabs.find((candidate) => candidate.key === sessionId)
            if (!session || !tab) {
              return { sessionId, ok: false, status: 'missing-session' }
            }
            try {
              const xml = session.readXml ? await session.readXml() : session.currentXml
              const save = await requestSaveRef.current(tab, xml)
              return {
                sessionId,
                ok: save.durable,
                status: save.durable ? 'success' : 'not-durable',
                remainingDirty: controller.store.get(sessionId)?.dirty ?? true
              }
            } catch (error) {
              return { sessionId, ok: false, status: errMsg(error), remainingDirty: true }
            }
          },
          mutateStorage: async (readyPlan) => {
            const mutation = await mutatePath(readyPlan)
            retryFinalize = mutation.finalize
            return mutation
          },
          migrateDrafts: drafts ? (migrations) => drafts.migrateDraftRecords(migrations) : undefined
        })
      })
      if (result.status === 'cancelled') return 'cancelled'
      if (result.status !== 'committed') {
        if (result.status === 'failed') {
          throw new Error(t('workspace.path.failed', { error: errMsg(result.error) }))
        }
        if (result.status === 'save-failed') {
          throw new Error(
            t('workspace.path.saveFailed', {
              error: result.outcomes.map((outcome) => outcome.status).join(', ')
            })
          )
        }
        throw new Error(t('workspace.path.unavailable'))
      }
      await updateUiAfterPathCommit(result.plan)
      await refreshWorkspace()
      if (result.finalizeError) {
        const transactionHash = await sha256Hex(new TextEncoder().encode(result.plan.id))
        const stagingPath = `${PATH_TRANSACTION_STAGING_ROOT}/tx-${transactionHash.slice(0, 32)}`
        const payloadPath = `${stagingPath}/payload`
        if (retryFinalize) {
          setPathRecovery({
            adapter,
            error: result.finalizeError,
            generation: workspaceGenRef.current,
            payloadPath,
            retry: retryFinalize,
            stagingPath
          })
        }
        pushToast(
          t('workspace.path.finalizeWarning', {
            error: errMsg(result.finalizeError),
            path: payloadPath
          }),
          'error'
        )
      }
      return 'committed'
    },
    [refreshWorkspace, requestPathDirtyDecision, tabs, updateUiAfterPathCommit, pushToast]
  )

  const handleRename = useCallback(
    async (node: LiteTreeNode) => {
      if (!workspaceAdapterRef.current) return
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
      const finalName = node.type === 'file' ? ensureBpmnExtension(raw) : raw
      if (finalName === node.name) return
      try {
        const status = await runPathTransaction({
          kind: 'rename',
          entryKind: node.type,
          sourcePath: node.relPath,
          destinationPath: joinRel(dirOf(node.relPath), finalName)
        })
        if (status === 'committed') pushToast(t('toast.renamed', { name: finalName }), 'success')
      } catch (err) {
        pushToast(t('alert.renameFailed', { error: errMsg(err) }), 'error')
      }
    },
    [promptText, runPathTransaction, pushToast]
  )

  // Delete → confirm dialog (non-empty folders require typing the name).
  const handleDeleteRequest = useCallback(
    async (node: LiteTreeNode) => {
      const adapter = workspaceAdapterRef.current
      if (!adapter) return
      try {
        if (node.type === 'directory') {
          // Fail closed: an unreadable/failed listing must never weaken a
          // non-empty-folder confirmation into the simple delete dialog.
          const entries = await adapter.list(node.relPath)
          const unreadable = entries.find((entry) => !entry.readable)
          if (unreadable) {
            throw new WorkspaceOperationError(
              unreadable.issue ?? {
                code: 'storage-failure',
                operation: 'list',
                path: unreadable.path,
                message: t('workspace.path.unavailable')
              }
            )
          }
          setDeleteTarget({
            node,
            requireTyped: entries.length > 0 ? node.name : undefined
          })
        } else {
          setDeleteTarget({ node })
        }
      } catch (error) {
        pushToast(t('alert.deleteFailed', { error: errMsg(error) }), 'error')
      }
    },
    [pushToast]
  )

  const performDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    setDeleteTarget(null)
    try {
      const status = await runPathTransaction({
        kind: 'delete',
        entryKind: target.node.type,
        sourcePath: target.node.relPath,
        deleteConfirmed: true
      })
      if (status === 'committed') {
        pushToast(t('toast.deleted', { name: target.node.name }), 'success')
      }
    } catch (err) {
      pushToast(t('alert.deleteFailed', { error: errMsg(err) }), 'error')
    }
  }, [deleteTarget, runPathTransaction, pushToast])

  // Move (drag-drop onto a folder, or the "Move to…" dialog).
  const performMove = useCallback(
    async (node: LiteTreeNode, toFolderRel: string) => {
      try {
        const status = await runPathTransaction({
          kind: 'move',
          entryKind: node.type,
          sourcePath: node.relPath,
          destinationPath: joinRel(toFolderRel, node.name)
        })
        if (status === 'committed') {
          pushToast(t('toast.moved', { name: node.name, dest: toFolderRel || rootName }), 'success')
        }
      } catch (err) {
        pushToast(t('alert.moveFailed', { error: errMsg(err) }), 'error')
      }
    },
    [runPathTransaction, pushToast, rootName]
  )

  const handleMoveDrop = useCallback(
    (fromRel: string, fromType: 'file' | 'directory', toFolderRel: string) => {
      const node: LiteTreeNode = { name: baseName(fromRel), relPath: fromRel, type: fromType }
      void performMove(node, toFolderRel)
    },
    [performMove]
  )

  // --- import (.bpmn from Explorer) ---------------------------------------

  // Adapter createFolder is recursive and idempotent. Keeping folder creation
  // behind this helper ensures imports never bypass the manifest-bound adapter.
  const ensureFolders = useCallback(async (relDir: string) => {
    const adapter = workspaceAdapterRef.current
    if (!adapter || !relDir) return
    await adapter.createFolder(relDir)
  }, [])

  const importEntries = useCallback(
    async (entries: DroppedBpmn[], baseFolderRel: string) => {
      const adapter = workspaceAdapterRef.current
      if (!(isMultiFileMode(mode) && adapter?.storage.capabilities.multipleFiles)) {
        pushToast(t('toast.import.openFolderFirst'), 'info')
        return
      }
      if (entries.length === 0) {
        pushToast(t('toast.import.noBpmnFound'), 'info')
        return
      }
      let created = 0
      let renamed = 0
      const knownProcessIds = [...processIndex.keys()]
      for (const entry of entries) {
        const sub = dirOf(entry.relPath)
        const targetFolder = sub ? joinRel(baseFolderRel, sub) : baseFolderRel
        // .bpmn, plain .xml (sniffed below) and (experimental) .apc all land as
        // a <base>.bpmn file.
        const base = deriveFileBaseName(entry.name.replace(/\.(bpmn|apc|xml)$/i, ''))
        // One serialized create per output file (slug pick + write inside the
        // shared op-mutex, as everywhere else). The optional `folder` override
        // lets the multi-model AML path land its files in a subfolder.
        const writeUnique = (
          slug: string,
          xml: string,
          folder: string = targetFolder
        ): Promise<string> =>
          opMutexRef.current.runExclusive(async () => {
            if (workspaceAdapterRef.current !== adapter) throw new Error(t('alert.staleWrite'))
            const taken = await directBpmnSlugs(adapter, folder)
            const guess = dedupeSlug(slug, (c) => taken.has(c.toLowerCase()))
            return writeUniqueBpmn(adapter, folder, guess, xml)
          })
        try {
          const text = await entry.getText()
          const prepareXml = async (candidateXml: string): Promise<string | null> => {
            const prepared = await prepareImportedBpmnXml(candidateXml, knownProcessIds)
            if (prepared.autoLayouted && !confirmGeneratedImportLayout()) {
              return null
            }
            return prepared.xml
          }
          // Routing is CONTENT-based: a `.xml` may be BPMN (many tools export
          // BPMN with a .xml extension) OR an ARIS AML database export (the
          // user's DMT exports) — and a mis-labeled `.apc` may equally carry
          // either. Only files that are neither are rejected.
          if (looksLikeBpmnXml(text)) {
            const candidateXml = await prepareXml(text)
            if (!candidateXml) continue
            const relPath = await writeUnique(base, candidateXml)
            localizationSourceByTabRef.current.set(relPath, LocalizationSource.Xml)
            created += 1
            const finalBase = baseName(relPath).replace(/\.bpmn$/i, '')
            if (finalBase.toLowerCase() !== base.toLowerCase()) renamed += 1
          } else if (looksLikeAml(text)) {
            // ARIS AML → one .bpmn per contained EPC model, named from the
            // model's name in the CURRENT app language (bilingual attrs ride
            // along inside the XML either way). A failure skips this file but
            // never aborts the rest of the import. A MULTI-model conversion
            // lands in its own subfolder (named after the export's landscape /
            // database when the converter suggests one) so a single AML never
            // floods the drop target; single-file conversions stay flat.
            const conv = await convertAmlToBpmnFiles(text, { lang })
            if ('error' in conv) {
              pushToast(t('apc.failed', { reason: apcReason(conv.error) }), 'error')
              continue
            }
            let modelFolder = targetFolder
            let folderName: string | null = null
            if (conv.files.length > 1) {
              // `folderName` is added by the importer rewrite landing alongside
              // this change — read it defensively so either merge order compiles.
              const suggested = (conv as { folderName?: string }).folderName
              const baseFolderName = sanitizeFolderName(
                suggested || '',
                deriveFileBaseName(suggested || base)
              )
              // Never silently merge into an existing NON-EMPTY folder — suffix
              // -2, -3… (the dedupeSlug convention). A missing or still-empty
              // folder is fair game: ensureFolders creates or reuses it.
              let cand = baseFolderName
              for (
                let n = 2;
                (await directoryEntryCount(adapter, joinRel(targetFolder, cand))) > 0;
                n += 1
              ) {
                cand = `${baseFolderName}-${n}`
              }
              folderName = cand
              modelFolder = joinRel(targetFolder, folderName)
              await ensureFolders(modelFolder)
            }
            for (const model of conv.files) {
              const modelName = (lang === 'ar' ? model.nameAr : model.nameEn) || model.name
              const slug = deriveFileBaseName(modelName || base)
              const candidateXml = await prepareXml(model.xml)
              if (!candidateXml) continue
              const relPath = await writeUnique(slug, candidateXml, modelFolder)
              localizationSourceByTabRef.current.set(relPath, LocalizationSource.Aris)
              created += 1
            }
            pushToast(
              conv.files.length === 1
                ? t('apc.converted', { name: entry.name })
                : folderName
                  ? t('apc.convertedInto', { count: conv.files.length, folder: folderName })
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
            // A .bpmn whose content did not match the fast sniff still goes
            // through the authoritative validators. Invalid input never
            // reaches the workspace.
            const candidateXml = await prepareXml(text)
            if (!candidateXml) continue
            const relPath = await writeUnique(base, candidateXml)
            localizationSourceByTabRef.current.set(relPath, LocalizationSource.Xml)
            created += 1
            const finalBase = baseName(relPath).replace(/\.bpmn$/i, '')
            if (finalBase.toLowerCase() !== base.toLowerCase()) renamed += 1
          }
        } catch (error) {
          pushToast(
            t('alert.importFailed', {
              name: entry.name,
              error: errMsg(error)
            }),
            'error'
          )
        }
      }
      await refreshWorkspace()
      pushToast(
        t('toast.imported.count', { count: created, plural: created === 1 ? '' : 's' }) +
          (renamed > 0 ? t('toast.imported.renamed', { renamed }) : '') +
          '.',
        'success'
      )
    },
    [mode, refreshWorkspace, pushToast, lang, ensureFolders, processIndex]
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
          .map((f) => ({
            relPath: f.name,
            name: f.name,
            getText: async () =>
              decodeUtf8Strict(new Uint8Array(await f.arrayBuffer()), {
                operation: 'read',
                path: f.name
              })
          }))
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
        const sourceXml = decodeUtf8Strict(new Uint8Array(await file.arrayBuffer()), {
          operation: 'read',
          path: file.name
        })
        const prepared = await prepareImportedBpmnXml(sourceXml, processIndex.keys())
        if (prepared.autoLayouted && !confirmGeneratedImportLayout()) {
          return
        }
        const proceed = await guardWorkspaceSwitch()
        if (!proceed) return
        await activateSingleFileDocument(file.name, prepared.xml, LocalizationSource.Xml)
      } catch (err) {
        pushToast(t('alert.open.failed', { error: errMsg(err) }), 'error')
      }
    },
    [processIndex, pushToast, guardWorkspaceSwitch, activateSingleFileDocument]
  )

  const startBlankDiagram = useCallback(() => {
    void (async () => {
      const proceed = await guardWorkspaceSwitch()
      if (!proceed) return
      await activateSingleFileDocument(
        'untitled.bpmn',
        createNewDiagramXml(),
        LocalizationSource.Editor
      )
    })()
  }, [guardWorkspaceSwitch, activateSingleFileDocument])

  const handleExportWorkspaceBackup = useCallback(async () => {
    const adapter = workspaceAdapterRef.current
    if (!adapter) return
    setBackupBusy(true)
    try {
      if (tabs.some((tab) => dirtyByKey[tab.key])) await saveAllDirty()
      const blob = await adapter.exportBackup()
      const safeName =
        (rootName || 'orbitpm-workspace')
          .replace(/[^A-Za-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'orbitpm-workspace'
      downloadBlob(`${safeName}-backup.zip`, blob)
      pushToast(t('workspace.storage.backupExport'), 'success')
    } catch (error) {
      pushToast(t('alert.import.failed', { error: errMsg(error) }), 'error')
    } finally {
      setBackupBusy(false)
    }
  }, [tabs, dirtyByKey, saveAllDirty, rootName, pushToast])

  const onBackupInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const backup = event.target.files?.[0]
      event.target.value = ''
      const adapter = workspaceAdapterRef.current
      if (!backup || !adapter || !adapter.storage.capabilities.multipleFiles) {
        return
      }
      setBackupBusy(true)
      try {
        const plan = await inspectWorkspaceBackup(adapter, backup)
        setBackupImportPlan(plan)
      } catch (error) {
        pushToast(t('alert.import.failed', { error: errMsg(error) }), 'error')
      } finally {
        setBackupBusy(false)
      }
    },
    [pushToast]
  )

  const handleApplyBackupImport = useCallback(
    async (decisions: Readonly<Record<string, WorkspaceBackupCollisionDecision>>) => {
      const adapter = workspaceAdapterRef.current
      const plan = backupImportPlan
      if (!adapter || !plan) return
      setBackupBusy(true)
      try {
        const result = await opMutexRef.current.runExclusive(() =>
          applyWorkspaceBackupImport(adapter, plan, {
            decisions,
            beforeOverwrite: async (path, existing) => {
              if (!path.startsWith('.orbitpm/')) {
                await historyManagerRef.current?.createRevision(path, {
                  reason: 'backup-import',
                  snapshot: existing
                })
              }
            }
          })
        )
        if (result.status !== 'committed') {
          const detail =
            result.status === 'needs-review'
              ? `${result.unresolvedCollisions.length}`
              : result.error.message
          throw new Error(`${result.status}: ${detail}`)
        }
        setBackupImportPlan(null)
        await refreshWorkspace(rootHandleRef.current ?? undefined)
        pushToast(
          t('toast.imported.count', {
            count: result.applied.length,
            plural: result.applied.length === 1 ? '' : 's'
          }),
          'success'
        )
      } catch (error) {
        pushToast(t('alert.import.failed', { error: errMsg(error) }), 'error')
      } finally {
        setBackupBusy(false)
      }
    },
    [backupImportPlan, refreshWorkspace, pushToast]
  )

  const handleHistoryRestore = useCallback(
    async (revision: HistoryRevision): Promise<RestoreHistoryRevisionResult> => {
      const adapter = workspaceAdapterRef.current
      const manager = historyManagerRef.current
      const controller = sessionControllerRef.current
      const workspace = workspaceIdentityRef.current
      if (!adapter || !manager || !controller || !workspace) {
        return {
          status: 'failed',
          sessionId: null,
          error: new Error(t('workspace.history.unavailable'))
        }
      }
      let current: FileSnapshot
      try {
        current = await adapter.read(revision.originalPath)
      } catch (error) {
        return { status: 'failed', sessionId: null, error }
      }
      if (
        workspaceAdapterRef.current !== adapter ||
        sessionControllerRef.current !== controller ||
        workspaceIdentityRef.current !== workspace
      ) {
        return {
          status: 'failed',
          sessionId: null,
          error: new Error(t('alert.staleWrite'))
        }
      }
      const result = await restoreHistoryRevision({
        manager,
        store: controller.store,
        revision,
        workspace,
        expectedCurrentHash: current.hash,
        applyXml: async (session, restoredXml) => {
          const modeler = (modelersByKey[session.id] ?? session.modeler) as {
            importXML?: (xml: string) => Promise<unknown>
          } | null
          await modeler?.importXML?.(restoredXml)
        }
      })
      if (
        result.status !== 'restored' &&
        result.status !== 'storage-restored-session-refresh-failed'
      ) {
        return result
      }

      const snapshot = result.outcome.snapshot
      let restoredXml: string
      try {
        restoredXml = decodeUtf8Strict(snapshot.bytes, {
          operation: 'read',
          path: revision.originalPath
        })
      } catch {
        return result
      }
      baseHashByPathRef.current[revision.originalPath] = snapshot.hash
      liveWorkspaceIndexRef.current.updateSaved({
        relPath: revision.originalPath,
        xml: restoredXml,
        lastModified: snapshot.modifiedAt,
        size: snapshot.size
      })
      const liveSession = result.sessionId ? controller.store.get(result.sessionId) : undefined
      if (result.status === 'restored' && liveSession) {
        setContents((previous) => ({ ...previous, [liveSession.id]: restoredXml }))
        setDirtyByKey((previous) => ({ ...previous, [liveSession.id]: false }))
        liveWorkspaceIndexRef.current.clearDirty(revision.originalPath)
      } else if (liveSession?.dirty) {
        // Storage committed but editor refresh did not. Preserve and continue
        // indexing the local draft instead of presenting the restored disk copy
        // as the active editor content.
        liveWorkspaceIndexRef.current.updateDirty(revision.originalPath, liveSession.currentXml)
        setDirtyByKey((previous) => ({ ...previous, [liveSession.id]: true }))
      }
      setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      digestsCacheRef.current = null
      return result
    },
    [modelersByKey]
  )

  // --- AI placement -------------------------------------------------------

  const placeGenerated = useCallback(
    async (
      xml: string,
      opts: {
        name: string
        targetFolder: string
        gen?: number
        localizationSource?: LocalizationSourceType
        signal: AbortSignal
      }
    ): Promise<GeneratedPlacementOutcome> => {
      const slug = deriveFileBaseName(opts.name || 'process')
      const expectsMultiFile = isMultiFileMode(mode)
      const adapter = workspaceAdapterRef.current
      const stale = (): boolean =>
        workspaceAdapterRef.current !== adapter ||
        Boolean(adapter?.storage.capabilities.multipleFiles) !== expectsMultiFile ||
        (opts.gen !== undefined && !canCommitToWorkspace(opts.gen, workspaceGenRef.current))
      const discardReason = (): GeneratedPlacementDiscardReason | null => {
        // A workspace switch wins over cancellation so the recovery message
        // explains why the requested destination is no longer available.
        if (stale()) return 'stale-workspace'
        if (opts.signal.aborted) return 'cancelled'
        return null
      }
      const reportDiscarded = (
        reason: GeneratedPlacementDiscardReason
      ): GeneratedPlacementOutcome => {
        if (reason === 'stale-workspace') {
          pushToast(t('alert.staleGeneration'), 'error')
        }
        return { status: 'discarded', reason }
      }

      const beforeValidation = discardReason()
      if (beforeValidation) return reportDiscarded(beforeValidation)
      try {
        await validateReleaseXml(xml, {
          action: 'create-generated',
          knownProcessIds: processIndex.keys(),
          requireBilingual: true,
          requireDi: true
        })
      } catch (error) {
        const reason = discardReason()
        if (reason) return reportDiscarded(reason)
        throw error
      }
      const afterValidation = discardReason()
      if (afterValidation) return reportDiscarded(afterValidation)

      // Validate the workspace generation captured when generation STARTED against
      // the live one, both before enqueuing AND at write time inside the mutex: a
      // folder switch during the (slow) generation must not land the diagram in
      // the switched-in workspace's folder (Codex ORIG-1b). Capture the bound
      // adapter and reject it if activation changes while the task is queued.
      if (expectsMultiFile) {
        if (!adapter?.storage.capabilities.multipleFiles) {
          return reportDiscarded('stale-workspace')
        }
        const folderPath = normalizeWorkspacePath(opts.targetFolder, { allowRoot: true })
        const bytes = new TextEncoder().encode(xml)
        const result = await opMutexRef.current.runExclusive(async () => {
          const beforeList = discardReason()
          if (beforeList) {
            return { status: 'discarded' as const, reason: beforeList }
          }
          let taken: Set<string>
          try {
            taken = await directBpmnSlugs(adapter, folderPath)
          } catch (error) {
            const reason = discardReason()
            if (reason) return { status: 'discarded' as const, reason }
            throw error
          }
          const beforeFinalValidation = discardReason()
          if (beforeFinalValidation) {
            return { status: 'discarded' as const, reason: beforeFinalValidation }
          }
          // Generation can be slow enough for another local operation to add a
          // process after the first validation. Revalidate against the live
          // index while holding the same mutation mutex, immediately before
          // this callback's first write.
          try {
            await validateReleaseXml(xml, {
              action: 'create-generated',
              knownProcessIds: liveWorkspaceIndexRef.current.processIndex().keys(),
              requireBilingual: true,
              requireDi: true
            })
          } catch (error) {
            const reason = discardReason()
            if (reason) return { status: 'discarded' as const, reason }
            throw error
          }
          for (let attempt = 0; attempt < 1000; attempt += 1) {
            // This is the final guard before the first mutation. Listing and
            // collision retries are read-only; writeAtomic receives the same
            // signal so an abort while writing is also fail-closed.
            const beforeWrite = discardReason()
            if (beforeWrite) {
              return { status: 'discarded' as const, reason: beforeWrite }
            }
            const finalSlug = dedupeSlug(slug, (candidate) =>
              taken.has(candidate.toLocaleLowerCase('en-US'))
            )
            const relPath = joinRel(folderPath, `${finalSlug}.bpmn`)
            let outcome
            try {
              outcome = await adapter.writeAtomic(relPath, bytes, undefined, {
                expectedWorkspaceId: adapter.id,
                expectedMissing: true,
                signal: opts.signal
              })
            } catch (error) {
              const reason = discardReason()
              if (reason) return { status: 'discarded' as const, reason }
              throw error
            }
            if (outcome.status === 'success') {
              return { status: 'persisted' as const, label: outcome.snapshot.path }
            }
            const afterWrite = discardReason()
            if (afterWrite) {
              return { status: 'discarded' as const, reason: afterWrite }
            }
            if (outcome.status === 'cancelled') {
              return { status: 'discarded' as const, reason: 'cancelled' as const }
            }
            if (outcome.status === 'stale-workspace') {
              return { status: 'discarded' as const, reason: 'stale-workspace' as const }
            }
            if (outcome.status === 'external-conflict' && outcome.reason === 'already-exists') {
              taken.add(finalSlug.toLocaleLowerCase('en-US'))
              continue
            }
            if ('error' in outcome) throw new Error(outcome.error.message)
            throw new Error(t('workspace.create.failed', { status: outcome.status }))
          }
          throw new Error(t('workspace.create.noAvailableName'))
        })
        if (result.status === 'discarded') {
          return reportDiscarded(result.reason)
        }
        // A successful adapter outcome is durable truth. If activation changed
        // after commit, report persistence but never refresh/open that old path
        // through the newly active workspace.
        if (stale()) return result
        try {
          await refreshWorkspace()
        } catch {
          return result
        }
        if (stale()) return result
        // Keep the sidebar (and with it the AI panel) mounted: the success box
        // carries the "fill gaps in chat" CTA, and collapsing here unmounted
        // the panel before it could ever render (found by the interview e2e).
        void openDirectoryFile(result.label, {
          collapse: false,
          autoSizeOnImport: true,
          localizationSource: opts.localizationSource ?? LocalizationSource.Ai
        })
        return result
      }
      // The virtual-tab open is synchronous. Re-check immediately beforehand
      // so a callback captured in another workspace cannot fall through here.
      const beforeVirtualOpen = discardReason()
      if (beforeVirtualOpen) return reportDiscarded(beforeVirtualOpen)
      const label = `${slug}.bpmn`
      openVirtualTab(label, xml, {
        collapse: false,
        autoSizeOnImport: true,
        localizationSource: opts.localizationSource ?? LocalizationSource.Ai
      })
      return { status: 'opened-in-memory', label }
    },
    [mode, refreshWorkspace, openDirectoryFile, openVirtualTab, pushToast, processIndex]
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
    (relPath: string, processId?: string) => {
      setSearchOpen(false)
      setSearchActiveIndex(-1)
      if (processId && openCanonicalProcess(processId)) return
      openFileAndReveal(relPath)
    },
    [openCanonicalProcess, openFileAndReveal]
  )

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const moveTo = (index: number): void => {
        if (flatHits.length === 0) return
        e.preventDefault()
        setSearchOpen(true)
        setSearchActiveIndex((index + flatHits.length) % flatHits.length)
      }
      if (e.key === 'ArrowDown') {
        moveTo(searchActiveIndex < 0 ? 0 : searchActiveIndex + 1)
        return
      }
      if (e.key === 'ArrowUp') {
        moveTo(searchActiveIndex < 0 ? flatHits.length - 1 : searchActiveIndex - 1)
        return
      }
      if (searchOpen && e.key === 'Home') {
        moveTo(0)
        return
      }
      if (searchOpen && e.key === 'End') {
        moveTo(flatHits.length - 1)
        return
      }
      if (e.key === 'Enter') {
        const selected = flatHits[searchActiveIndex] ?? flatHits[0]
        if (selected) {
          e.preventDefault()
          openSearchHit(selected.relPath, selected.processId)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setSearchOpen(false)
        setSearchActiveIndex(-1)
      }
    },
    [flatHits, openSearchHit, searchActiveIndex, searchOpen]
  )

  useEffect(() => {
    if (!searchOpen || !search.trim() || flatHits.length === 0) {
      setSearchActiveIndex(-1)
      return
    }
    setSearchActiveIndex((current) => (current >= 0 && current < flatHits.length ? current : 0))
  }, [flatHits, search, searchOpen])

  // Close the search dropdown on an outside click.
  useEffect(() => {
    if (!searchOpen) return
    const onDown = (e: MouseEvent): void => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
        setSearchActiveIndex(-1)
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
  // selection (element mode for exactly one selected flow node, process mode
  // otherwise) — the shared derivation in org/stepDetailsCtx.ts, which the
  // right-pane DetailsCard uses too, so card, badge and dialog always agree.
  // Recomputed only when the target or the modeler map changes; the modal
  // overlay blocks canvas clicks so the selection can't drift while open.
  const stepDetailsCtx = useMemo(() => {
    if (!stepDetails) return null
    const raw = modelersByKey[stepDetails.tabKey]
    return raw ? deriveStepDetailsCtx(raw as StepDetailsModeler) : null
  }, [stepDetails, modelersByKey])

  // Canvas missing-badge click → select the clicked element in that tab's
  // modeler (synchronous, so the ctx derivation above sees it) and open the
  // dialog with the missing categories highlighted. EditorTabLite already
  // selected the element before invoking this; re-selecting here keeps the
  // handler correct for any other caller too.
  const handleOpenStepDetails = useCallback(
    (tabKey: string, elementId: string, missing: string[]) => {
      const raw = modelersByKey[tabKey]
      if (raw) {
        try {
          const modeler = raw as {
            get(s: 'elementRegistry'): { get(id: string): unknown }
            get(s: 'selection'): { select(el: unknown): void }
          }
          const el = modeler.get('elementRegistry').get(elementId)
          if (el) modeler.get('selection').select(el)
        } catch {
          /* selection is best-effort — the dialog still opens */
        }
      }
      setStepDetails({ tabKey, highlight: missing })
    },
    [modelersByKey]
  )

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
            ...serializeTriggers(v.triggers),
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
              ;(
                modeler as unknown as {
                  get(s: 'modeling'): {
                    updateProperties(el: unknown, p: Record<string, unknown>): void
                  }
                }
              )
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
              ...serializeTriggers(v.triggers)
            })
          }
        }
        // The just-applied owner (+ responsible-list people) become picker
        // suggestions IMMEDIATELY — before any disk save (disk wins on merge).
        setSessionOwners((prev) => upsertSessionOwners(prev, ownerAdditionsFromValues(v)))
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
        liveFiles.map((f) => ({ relPath: f.relPath, xml: f.xml })),
        [
          { relPath: 'process-owners.csv', content: csv },
          {
            // Machine-readable nesting (parent→child callActivity links) so a
            // re-import — here or in another standards-aware tool — can rebuild
            // the hierarchy without re-scanning every diagram.
            relPath: LIBRARY_MANIFEST_NAME,
            content: serializeLibraryManifest(
              buildLibraryManifest(liveFiles, processIndex, linkGraph)
            )
          }
        ]
      )
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }))
      triggerDownload(zipFileName(rootName), url)
      // Revoke once the click-initiated download has grabbed the blob.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      pushToast(t('library.exported', { count: liveFiles.length }), 'success')
    } catch (err) {
      pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
    }
  }, [liveFiles, ownersEntries, processIndex, linkGraph, rootName, pushToast])

  const onLibraryInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      try {
        const result = await readLibraryZipFileInWorker(file)
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

  const confirmLibraryImport = useCallback(async () => {
    const result = libraryImport
    setLibraryImport(null)
    const adapter = workspaceAdapterRef.current
    if (!result || !adapter?.storage.capabilities.multipleFiles) return
    let created = 0
    let renamed = 0
    for (const entry of result.entries) {
      const targetFolder = dirOf(entry.relPath)
      const base = deriveFileBaseName(baseName(entry.relPath).replace(/\.bpmn$/i, ''))
      try {
        const prepared = await prepareImportedBpmnXml(entry.xml, processIndex.keys())
        if (prepared.autoLayouted && !confirmGeneratedImportLayout()) {
          continue
        }
        // Same op-mutex as every other create so a concurrent op can't grab the
        // same free slug; nested folders are ensured inside the critical section.
        const relPath = await opMutexRef.current.runExclusive(async () => {
          if (workspaceAdapterRef.current !== adapter) throw new Error(t('alert.staleWrite'))
          await ensureFolders(targetFolder)
          const taken = await directBpmnSlugs(adapter, targetFolder)
          const guess = dedupeSlug(base, (c) => taken.has(c.toLowerCase()))
          return writeUniqueBpmn(adapter, targetFolder, guess, prepared.xml)
        })
        localizationSourceByTabRef.current.set(relPath, LocalizationSource.Backup)
        created += 1
        const finalBase = baseName(relPath).replace(/\.bpmn$/i, '')
        if (finalBase.toLowerCase() !== base.toLowerCase()) renamed += 1
      } catch (error) {
        pushToast(
          t('alert.importFailed', {
            name: entry.relPath,
            error: errMsg(error)
          }),
          'error'
        )
      }
    }
    await refreshWorkspace()
    pushToast(
      t('toast.imported.count', { count: created, plural: created === 1 ? '' : 's' }) +
        (renamed > 0 ? t('toast.imported.renamed', { renamed }) : '') +
        '.',
      'success'
    )
  }, [libraryImport, ensureFolders, refreshWorkspace, pushToast, processIndex])

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

  const openTranslationReview = useCallback(
    (tabKey: string) => {
      const modeler = modelersByKey[tabKey] as LangToggleModeler | undefined
      if (!modeler || translatingTab) return
      try {
        const currentLang = getDiagramLang(modeler)
        const targetLang = currentLang === 'en' ? 'ar' : 'en'
        const source = localizationSourceByTabRef.current.get(tabKey) ?? LocalizationSource.Editor
        const review = inspectWithWorkspaceLocalization(modeler, targetLang, source)
        if (review.complete) {
          const projected = applyDiagramLocalizationReview(modeler, review)
          pushToast(
            t(
              projected.active === targetLang
                ? 'translate.nothing.switched'
                : 'translate.nothing.alreadyArabic'
            ),
            'info'
          )
          return
        }
        const selection = getProviderSelection()
        setTranslationReview({
          tabKey,
          review,
          providerId: selection ? 'selected-ai' : '',
          aiSelection: selection,
          status: null
        })
      } catch (err) {
        pushToast(errMsg(err), 'error')
      }
    },
    [inspectWithWorkspaceLocalization, modelersByKey, translatingTab, pushToast]
  )

  // Both toolbar actions perform the same audited read first. Only complete,
  // valid targets project immediately; incomplete/wrong-script targets open
  // the disclosure review and perform no mutation or network operation.
  const handleDiagramLangToggle = useCallback(
    (tabKey: string) => openTranslationReview(tabKey),
    [openTranslationReview]
  )
  const handleTranslate = useCallback(
    (tabKey: string) => openTranslationReview(tabKey),
    [openTranslationReview]
  )

  const handleTranslationPartialPreview = useCallback(() => {
    const state = translationReview
    if (!state || translatingTab) return
    const modeler = modelersByKey[state.tabKey] as LangToggleModeler | undefined
    if (!modeler) return
    try {
      const result = applyDiagramLocalizationReview(modeler, state.review, {
        allowPartial: true
      })
      setTranslationReview(null)
      pushToast(
        t('editor.langToggle.partial', {
          switched: result.switched,
          missing: result.missing
        }),
        'info'
      )
    } catch (err) {
      if (err instanceof StaleLocalizationReviewError) {
        const fresh = inspectDiagramLocalization(modeler, state.review.target, {
          source: state.review.source,
          ...state.review.localResources
        })
        setTranslationReview({
          ...state,
          review: fresh,
          status: t('translationReview.stale')
        })
      } else {
        pushToast(errMsg(err), 'error')
      }
    }
  }, [translationReview, translatingTab, modelersByKey, pushToast])

  const handleTranslationCancel = useCallback(() => {
    translationAbortRef.current?.abort()
  }, [])

  const handleTranslationNow = useCallback(async () => {
    const state = translationReview
    const disclosure = translationDisclosure
    if (!state || !disclosure || !state.providerId || translatingTab) {
      if (state && !state.providerId) {
        setTranslationReview({
          ...state,
          status: t('translationReview.noProvider')
        })
      }
      return
    }
    const modeler = modelersByKey[state.tabKey] as
      (TranslateModeler & LangToggleModeler) | undefined
    if (!modeler) return
    const controller = new AbortController()
    translationAbortRef.current = controller
    setTranslatingTab(state.tabKey)
    setTranslationReview({
      ...state,
      status: t('translationReview.running')
    })
    const consent = grantExternalRequestConsent(disclosure)
    try {
      const run = {
        review: state.review,
        disclosure,
        consent,
        signal: controller.signal
      }
      const result =
        state.providerId === 'free'
          ? await translateReviewedDiagramWithTexts(
              modeler,
              makeFreeTranslateTexts({
                onAttempt: (attempt) => {
                  if (controller.signal.aborted || translationAbortRef.current !== controller) {
                    return
                  }
                  const service = t(
                    attempt.service === 'google'
                      ? 'translationReview.retry.service.google'
                      : 'translationReview.retry.service.mymemory'
                  )
                  const status =
                    attempt.retryInMs === undefined
                      ? t('translationReview.retry.attempt', {
                          service,
                          item: attempt.item,
                          items: attempt.itemCount,
                          attempt: attempt.attempt,
                          max: attempt.maxAttempts
                        })
                      : t('translationReview.retry.waiting', {
                          service,
                          item: attempt.item,
                          items: attempt.itemCount,
                          attempt: attempt.attempt,
                          max: attempt.maxAttempts,
                          seconds: Math.max(1, Math.ceil(attempt.retryInMs / 1000))
                        })
                  setTranslationReview((current) =>
                    !controller.signal.aborted &&
                    translationAbortRef.current === controller &&
                    current?.tabKey === state.tabKey &&
                    current.review === state.review
                      ? { ...current, status }
                      : current
                  )
                }
              }),
              run
            )
          : await (() => {
              const selection = state.aiSelection
              if (!selection || !hasKey(selection.providerId)) {
                throw new Error(t('translate.noKey'))
              }
              return translateReviewedDiagram(
                modeler,
                makeBrowserCallLLM(
                  {
                    providerId: selection.providerId,
                    model: selection.modelId,
                    apiKey: getKey(selection.providerId) ?? '',
                    referer: typeof location !== 'undefined' ? location.origin : undefined,
                    title: 'OrbitPM Process Studio Lite'
                  },
                  { signal: controller.signal }
                ),
                run
              )
            })()
      if (result.complete) {
        setTranslationReview(null)
        pushToast(t('translate.done', { count: result.translated }), 'success')
      } else {
        setTranslationReview({
          ...state,
          review: result.review,
          status: t('translationReview.partialStatus')
        })
      }
    } catch (err) {
      const cancelled =
        controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')
      const stale = err instanceof StaleLocalizationReviewError
      const failures = stale
        ? []
        : state.review.queue.map((item) => ({
            processId: item.processId,
            elementId: item.elementId,
            field: item.field,
            target: item.target,
            originalValue: item.sourceValue
          }))
      const failedReview = inspectDiagramLocalization(modeler, state.review.target, {
        source: state.review.source,
        providerFailures: failures,
        ...state.review.localResources
      })
      const status = cancelled
        ? t('translationReview.cancelled')
        : stale
          ? t('translationReview.stale')
          : err instanceof FreeTranslateError
            ? t(
                err.code === 'rate'
                  ? 'translate.free.rate'
                  : err.code === 'offline'
                    ? 'translate.free.offline'
                    : 'translate.free.down'
              )
            : t('translate.failed', { error: errMsg(err) })
      setTranslationReview({
        ...state,
        review: failedReview,
        status
      })
    } finally {
      translationAbortRef.current = null
      setTranslatingTab(null)
    }
  }, [translationReview, translationDisclosure, translatingTab, modelersByKey, pushToast])

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
            saveXML(options: { format: boolean }): Promise<{ xml?: string }>
            get(name: string): unknown
          }
        | undefined
      if (!modeler) throw new Error('editor not ready')
      const { xml: previousXml } = await modeler.saveXML({ format: true })
      if (!previousXml) throw new Error('editor returned no XML')
      await validateReleaseXml(xml, {
        action: 'create-generated',
        knownProcessIds: processIndex.keys(),
        requireBilingual: true,
        requireDi: true
      })
      const replacementPreservation = await validateUnknownExtensionPreservation(previousXml, xml)
      if (!replacementPreservation.valid) {
        throw new Error(t('sourceEditor.preservationBlocked'))
      }
      localizationSourceByTabRef.current.set(tabKey, LocalizationSource.Ai)
      try {
        await modeler.importXML(xml)
        const { xml: roundTripXml } = await modeler.saveXML({ format: true })
        if (!roundTripXml) throw new Error('editor returned no XML after import')
        const roundTripPreservation = await validateUnknownExtensionPreservation(xml, roundTripXml)
        if (!roundTripPreservation.valid) {
          throw new Error(t('sourceEditor.preservationBlocked'))
        }
      } catch (error) {
        try {
          await modeler.importXML(previousXml)
        } catch {
          /* preserve the original replacement error */
        }
        throw error
      }
      autoSizeAll(modeler)
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
        ;(
          modeler.get('modeling') as {
            updateProperties(el: unknown, p: Record<string, unknown>): void
          }
        ).updateProperties(root, {
          'orbitpm:activeLang': typeof cur === 'string' && cur ? cur : 'en'
        })
      } catch {
        /* dirty-marking is best-effort; the import itself already landed */
      }
    },
    [modelersByKey, processIndex]
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
    const activeModeler = activeKey ? (modelersByKey[activeKey] ?? null) : null
    w.__ORBITPM_LITE__ = {
      ...(w.__ORBITPM_LITE__ ?? {}),
      modeler: activeModeler,
      // E2E/live verification fallback for AI generation, whose provider calls
      // cannot be made without user credentials. It exercises the same sweep
      // invoked by the two App-owned AI import paths above.
      autoSizeAll: () =>
        activeModeler ? autoSizeAll(activeModeler as { get(name: string): unknown }) : 0
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
  const hiddenBackupInput = (
    <input
      ref={backupInputRef}
      type="file"
      accept=".zip,application/zip"
      style={{ display: 'none' }}
      onChange={(event) => void onBackupInputChange(event)}
    />
  )

  if (phase === 'loading') {
    return <div style={{ padding: '2rem' }}>{t('app.loading')}</div>
  }

  if (phase === 'need-open' || phase === 'need-reconnect') {
    return (
      <>
        {hiddenFileInput}
        {hiddenBackupInput}
        <WorkspacePickerLite
          mode={phase === 'need-reconnect' ? 'reconnect' : support ? 'open' : 'fallback'}
          rememberedName={rememberedName}
          busy={pickBusy}
          error={pickError}
          directoryAvailable={support}
          opfsAvailable={browserWorkspaceAvailable}
          onOpenFolder={phase === 'need-reconnect' ? handleReconnect : handleOpenFolder}
          onOpenDifferent={handleOpenDifferent}
          onOpenOpfs={handleOpenOpfs}
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
        <Toaster toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  const showCatalog = isMultiFileMode(mode) && (tabs.length === 0 || catalogOpen)
  const crumbs =
    activeTab && activeTab.relPath
      ? folderCrumbs(activeTab.relPath, rootName || t('breadcrumb.root'))
      : null
  const storageModeLabel = t(
    mode === 'directory'
      ? 'workspace.storage.mode.directory'
      : mode === 'opfs'
        ? 'workspace.storage.mode.opfs'
        : 'workspace.storage.mode.singleFile'
  )
  const storagePersistence = t(
    mode === 'directory'
      ? 'workspace.storage.persistence.directory'
      : workspaceAdapter?.storage.persistence === 'origin-private-durable'
        ? 'workspace.storage.persistence.opfsDurable'
        : mode === 'opfs'
          ? 'workspace.storage.persistence.opfsBestEffort'
          : 'workspace.storage.persistence.singleFile'
  )
  // Shell layout direction (the <html dir> follows the UI language) — the
  // sidebar resizer's drag math needs it; the editor island stays LTR.
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100vh' }}>
      {hiddenFileInput}
      {hiddenImportInput}
      {hiddenLibraryInput}
      {hiddenBackupInput}
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
          <span
            aria-label={t('app.version.aria', { version: __APP_VERSION__ })}
            style={{ fontSize: 11, opacity: 0.65 }}
          >
            v{__APP_VERSION__}
          </span>
          <span
            title={storagePersistence}
            style={{
              maxWidth: 190,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              opacity: 0.72
            }}
          >
            {t('workspace.storage.current', { mode: storageModeLabel })}
          </span>
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
            {isMultiFileMode(mode) && (
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

        {isMultiFileMode(mode) && (
          <div ref={searchBoxRef} style={{ position: 'relative', flex: '1 1 auto', maxWidth: 440 }}>
            <input
              type="search"
              role="combobox"
              value={search}
              placeholder={t('tree.search.placeholder')}
              aria-label={t('tree.search.aria')}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={searchOpen && Boolean(search.trim())}
              aria-controls={SEARCH_RESULTS_ID}
              aria-activedescendant={
                searchOpen && searchActiveIndex >= 0 && flatHits[searchActiveIndex]
                  ? searchResultOptionId(searchActiveIndex)
                  : undefined
              }
              onChange={(e) => {
                setSearch(e.target.value)
                setSearchOpen(true)
                setSearchActiveIndex(-1)
              }}
              onFocus={() => {
                if (!search.trim()) return
                setSearchOpen(true)
                setSearchActiveIndex(flatHits.length > 0 ? 0 : -1)
              }}
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
                onOpen={openSearchHit}
                onClose={() => {
                  setSearchOpen(false)
                  setSearchActiveIndex(-1)
                }}
                activeIndex={searchActiveIndex}
                onActiveIndexChange={setSearchActiveIndex}
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
              background: 'var(--orbitpm-primary-bg)',
              color: 'var(--orbitpm-primary-fg)',
              borderColor: 'var(--orbitpm-primary-bg)',
              fontWeight: 600
            }}
          >
            {t('app.newProcess')}
          </button>
          {isMultiFileMode(mode) && support ? (
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
          {workspaceAdapter?.storage.capabilities.backup && (
            <button
              className="orbitpm-lite-chrome-btn"
              onClick={() => void handleExportWorkspaceBackup()}
              disabled={backupBusy}
              title={storagePersistence}
            >
              {t('workspace.storage.backupExport')}
            </button>
          )}
          {workspaceAdapter?.storage.capabilities.multipleFiles && (
            <>
              <button
                className="orbitpm-lite-chrome-btn"
                onClick={() => backupInputRef.current?.click()}
                disabled={backupBusy}
              >
                {t('workspace.storage.backupImport')}
              </button>
              <button className="orbitpm-lite-chrome-btn" onClick={() => setHistoryOpen(true)}>
                {t('workspace.storage.history')}
              </button>
            </>
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
            {t('app.lang.control', {
              language: lang === 'en' ? t('app.lang.ar') : t('app.lang.en')
            })}
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
              width: sidebarWidth ?? 'clamp(240px, 24vw, 320px)',
              flex: '0 0 auto',
              borderInlineEnd: '1px solid var(--orbitpm-border)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}
          >
            {/* TOP: file explorer — the directory tree or the fallback block —
                fills the sidebar and scrolls independently of the AI section. */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0.5rem 0' }}>
              {isMultiFileMode(mode) ? (
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
                      hierarchy={processHierarchy}
                      activePath={activeTab?.relPath ?? null}
                      dirtyPaths={dirtyFilePaths}
                      revealRequest={treeRevealRequest}
                      // Single click: open but keep the explorer visible. Double
                      // click: open AND collapse the sidebar so the canvas takes the
                      // full window (the first click of the pair already opened the
                      // tab, so this handler only needs to re-activate + collapse).
                      onOpenFile={openFileAndReveal}
                      onOpenFileFocus={(rel) => void openDirectoryFile(rel)}
                      onOpenProcess={(navigation) => {
                        openCanonicalProcess(navigation.processId)
                      }}
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
                <div
                  style={{
                    padding: '0.6rem 0.8rem',
                    fontSize: 12.5,
                    color: 'var(--orbitpm-muted)'
                  }}
                >
                  <p style={{ marginTop: 0 }}>{t('fallback.singleFileNote')}</p>
                  <button
                    className="orbitpm-lite-chrome-btn"
                    style={{
                      width: '100%',
                      marginBottom: 6,
                      background: 'var(--orbitpm-primary-bg)',
                      color: 'var(--orbitpm-primary-fg)',
                      borderColor: 'var(--orbitpm-primary-bg)',
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
                  key={`ai:${workspaceAdapter?.id ?? 'none'}:${workspaceGenRef.current}`}
                  embedded
                  folders={folders}
                  onPlaceGenerated={placeGenerated}
                  getWorkspaceGen={() => workspaceGenRef.current}
                  onOpenSettings={() => setSettingsOpen(true)}
                  collapsed={false}
                  onToggle={() => {}}
                  keysVersion={keysVersion}
                  mode={isMultiFileMode(mode) ? 'directory' : 'fallback'}
                  processCatalog={processCatalog}
                  isKnownProcess={isKnownProcess}
                  resolveProcessName={resolveProcessName}
                  onContinueInChat={handleContinueInChat}
                  spreadsheet={{
                    workspaceId:
                      workspaceAdapter?.id ?? `browser-delivery:${workspaceGenRef.current}`,
                    workspaceAdapter,
                    folders,
                    knownProcessIds: processCatalog.map(({ id }) => id),
                    getCurrentWorkspaceId: () => workspaceAdapterRef.current?.id,
                    runWorkspaceExclusive: (operation) =>
                      opMutexRef.current.runExclusive(operation),
                    onOpenSingle: (xml, name) => {
                      openVirtualTab(baseName(name), xml, {
                        collapse: false,
                        autoSizeOnImport: true,
                        localizationSource: LocalizationSource.Excel
                      })
                    },
                    onOpenBilingualReview: (xml, name) => {
                      openVirtualTab(baseName(name), xml, {
                        collapse: false,
                        autoSizeOnImport: true,
                        localizationSource: LocalizationSource.Excel
                      })
                    },
                    onCommitted: async (report) => {
                      if (
                        !workspaceAdapter?.storage.capabilities.multipleFiles ||
                        workspaceAdapterRef.current?.id !== workspaceAdapter.id
                      ) {
                        return
                      }
                      await refreshWorkspace(rootHandleRef.current ?? undefined)
                      const first = report.artifacts[0]
                      if (first) {
                        void openDirectoryFile(first.destinationPath, {
                          collapse: false,
                          autoSizeOnImport: true,
                          localizationSource: LocalizationSource.Excel
                        })
                      }
                    }
                  }}
                />
              </div>
            )}
          </aside>
        )}

        {/* Drag handle for the explorer width — sits on the aside's inline-end
            edge, before the rail. dir-aware so RTL drags resize correctly. */}
        {sidebarOpen && (
          <PaneResizer
            edge="inline-end"
            dir={dir}
            width={sidebarWidth ?? 320}
            min={200}
            max={560}
            onWidthChange={setSidebarWidth}
            onReset={resetSidebarWidth}
            ariaLabel={t('pane.resize.sidebar.aria')}
          />
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

        <main
          ref={editorRegionRef}
          tabIndex={-1}
          style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}
        >
          <ProcessTabList
            tabs={tabs}
            activeKey={activeKey}
            dirtyKeys={
              new Set(
                Object.entries(dirtyByKey)
                  .filter(([, dirty]) => dirty)
                  .map(([key]) => key)
              )
            }
            dir={dir}
            ariaLabel={t('tab.list.aria')}
            closeTitle={t('tab.closeTitle')}
            dirtyLabel={t('tab.dirty.aria')}
            onActivate={(key) => {
              setCatalogOpen(false)
              setActiveKey(key)
            }}
            onClose={closeTab}
            onEmptyFocus={() => editorRegionRef.current?.focus()}
          />

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
                <span
                  key={c.relPath || 'root'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
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
            {tabs.length === 0 && mode === 'single-file' && (
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
                  id={processTabPanelId(tab.key)}
                  role="tabpanel"
                  aria-labelledby={processTabId(tab.key)}
                  tabIndex={isActive && !showCatalog ? 0 : -1}
                  hidden={!isActive || showCatalog}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: isActive && !showCatalog ? 'flex' : 'none',
                    flexDirection: 'column',
                    minHeight: 0
                  }}
                >
                  {content === undefined ? (
                    <div style={{ padding: '1.5rem', opacity: 0.6 }}>
                      {t('editor.loadingDiagram')}
                    </div>
                  ) : (
                    <EditorTab
                      xml={content}
                      onDirtyChange={(dirty) => handleDirtyChange(tab.key, dirty)}
                      onRequestSave={(xml, options) => handleRequestSave(tab, xml, options)}
                      knownProcessIds={[...processIndex.keys()]}
                      onOpenCalledProcess={handleOpenCalledProcess}
                      onOpenStepDetails={(id, missing) =>
                        handleOpenStepDetails(tab.key, id, missing)
                      }
                      sidePaneExtra={
                        <DetailsCard
                          modeler={(modelersByKey[tab.key] ?? null) as StepDetailsModeler | null}
                          onOpenDetails={() => setStepDetails({ tabKey: tab.key })}
                        />
                      }
                      exportFileBaseName={tab.title.replace(/\.bpmn$/i, '')}
                      onCommandsReady={(commands) => {
                        commandUnregisterersRef.current[tab.key]?.()
                        delete commandUnregisterersRef.current[tab.key]
                        commandsRef.current[tab.key] = commands
                        if (commands) {
                          commandUnregisterersRef.current[tab.key] =
                            commandRouterRef.current!.register(tab.key, {
                              save: commands.save,
                              exportSvg: commands.exportSvg,
                              exportPng: commands.exportPng
                            })
                        } else {
                          commandRouterRef.current?.unregister(tab.key)
                        }
                      }}
                      onModelerReady={(modeler) => {
                        // Tear down any badge installer from a previous modeler for
                        // this tab before (re)installing on the new one, and on the
                        // null (unmount/replace) path.
                        badgeUninstallersRef.current[tab.key]?.()
                        delete badgeUninstallersRef.current[tab.key]
                        liveXmlUninstallersRef.current[tab.key]?.()
                        delete liveXmlUninstallersRef.current[tab.key]
                        setModelersByKey((prev) => ({ ...prev, [tab.key]: modeler }))
                        const controller = sessionControllerRef.current
                        const session =
                          controller?.store.get(tab.key) ??
                          (content !== undefined
                            ? ensureDocumentSession(tab, content, {
                                lastSavedXml: content,
                                base:
                                  tab.relPath && baseHashByPathRef.current[tab.relPath]
                                    ? {
                                        hash: baseHashByPathRef.current[tab.relPath]!,
                                        size: new TextEncoder().encode(content).byteLength,
                                        modifiedAt: 0
                                      }
                                    : null
                              })
                            : null)
                        if (controller && session) {
                          let commandStack: unknown | null = null
                          if (modeler) {
                            try {
                              commandStack = (modeler as { get(name: string): unknown }).get(
                                'commandStack'
                              )
                            } catch {
                              commandStack = null
                            }
                          }
                          controller.store.bindEditor(tab.key, {
                            modeler,
                            commandStack,
                            readXml: modeler
                              ? async () => {
                                  const result = await (
                                    modeler as {
                                      saveXML(options: {
                                        format: boolean
                                      }): Promise<{ xml?: string }>
                                    }
                                  ).saveXML({ format: true })
                                  if (typeof result.xml !== 'string') {
                                    throw new Error('bpmn-js returned no XML')
                                  }
                                  return result.xml
                                }
                              : null
                          })
                        }
                        if (modeler) {
                          try {
                            const eventBus = (modeler as { get(name: string): unknown }).get(
                              'eventBus'
                            ) as {
                              on(event: string, callback: () => void): void
                              off(event: string, callback: () => void): void
                            }
                            const capture = (): void =>
                              scheduleLiveXmlCapture(
                                tab,
                                modeler as {
                                  saveXML?: (options: {
                                    format: boolean
                                  }) => Promise<{ xml?: string }>
                                }
                              )
                            eventBus.on('commandStack.changed', capture)
                            liveXmlUninstallersRef.current[tab.key] = () => {
                              eventBus.off('commandStack.changed', capture)
                            }
                          } catch {
                            /* live indexing falls back to the last saved snapshot */
                          }
                          try {
                            const modelerWorkspaceAdapter = workspaceAdapterRef.current
                            const eventBus = (modeler as { get(name: string): unknown }).get(
                              'eventBus'
                            ) as {
                              on(event: string, callback: () => void): void
                            }
                            eventBus.on('import.done', () => {
                              if (
                                tab.gen !== workspaceGenRef.current ||
                                workspaceAdapterRef.current !== modelerWorkspaceAdapter
                              ) {
                                return
                              }
                              try {
                                const langModeler = modeler as LangToggleModeler
                                const current = getDiagramLang(langModeler)
                                const target = current === 'en' ? 'ar' : 'en'
                                const source =
                                  localizationSourceByTabRef.current.get(tab.key) ??
                                  LocalizationSource.Editor
                                localizationReviewByTabRef.current.set(
                                  tab.key,
                                  inspectWithWorkspaceLocalization(langModeler, target, source)
                                )
                              } catch {
                                // Localization audit is non-destructive and
                                // best-effort; import diagnostics remain owned
                                // by the editor/validation center.
                              }
                              const processId = pendingProcessFocusRef.current.get(tab.key)
                              if (!processId) return
                              // Let the import promise settle before opening
                              // another BPMNDiagram plane from the same file.
                              setTimeout(() => {
                                queueProcessFocus(tab.key, modeler, processId)
                              }, 0)
                            })
                          } catch {
                            /* a single-root file still opens normally */
                          }
                          if (pendingAiAutoSizeRef.current.has(tab.key)) {
                            try {
                              const eventBus = (modeler as { get(name: string): unknown }).get(
                                'eventBus'
                              ) as {
                                on(event: string, callback: () => void): void
                                off(event: string, callback: () => void): void
                              }
                              const sweepAfterImport = (): void => {
                                pendingAiAutoSizeRef.current.delete(tab.key)
                                eventBus.off('import.done', sweepAfterImport)
                                autoSizeAll(modeler as { get(name: string): unknown })
                              }
                              eventBus.on('import.done', sweepAfterImport)
                            } catch {
                              // Import still proceeds; sizing is best-effort.
                              pendingAiAutoSizeRef.current.delete(tab.key)
                            }
                          }
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
                            {isMultiFileMode(mode) && (
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
                onOpen={openSearchHit}
                query={search}
                totalCount={catalogRows.length}
                rootName={rootName || t('breadcrumb.root')}
                onNewProcess={() => void handleNewProcess('')}
                onOpenUnresolved={() => setUnresolvedOpen(true)}
              />
            )}
          </div>
        </main>
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
          {isMultiFileMode(mode)
            ? t('footer.folderPrefix', { folderName: rootName })
            : t('footer.singleFileMode')}
          {search.trim() && isMultiFileMode(mode) && (
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
          {workspaceLocalizationError && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={`${t('settings.localization.title')}: ${t(
                'settings.localization.loadFailed',
                { error: workspaceLocalizationError }
              )}`}
              title={t('settings.localization.loadFailed', {
                error: workspaceLocalizationError
              })}
              style={{
                padding: '0.1rem 0.5rem',
                border: '1px solid rgba(185,28,28,0.35)',
                borderRadius: 999,
                background: 'rgba(185,28,28,0.12)',
                color: 'var(--orbitpm-fg)',
                fontWeight: 600,
                cursor: 'pointer',
                font: 'inherit'
              }}
            >
              ⚠ {workspaceLocalizationError}
            </button>
          )}
          {workspaceIssues.length > 0 && (
            <span
              role="status"
              title={workspaceIssues.join('\n')}
              style={{ color: '#d97706', fontWeight: 600 }}
            >
              ⚠ {workspaceIssues.length}
            </span>
          )}
          {duplicateProcessDiagnostics.map((diagnostic) => (
            <button
              key={diagnostic.processId}
              type="button"
              onClick={() => void handleRepairDuplicateProcessId(diagnostic.processId)}
              title={t('workspace.duplicate.title', {
                id: diagnostic.processId,
                paths: diagnostic.paths.join(' ↔ ')
              })}
              style={{
                padding: '0.1rem 0.5rem',
                borderRadius: 999,
                border: '1px solid rgba(217,119,6,0.45)',
                background: 'rgba(217,119,6,0.12)',
                color: '#d97706',
                cursor: 'pointer',
                font: 'inherit'
              }}
            >
              {diagnostic.processId} · {t('workspace.duplicate.repair')}
            </button>
          ))}
        </span>
        <span>{t('footer.tagline')}</span>
      </footer>

      {translationReview && (
        <TranslationReviewDialog
          review={translationReview.review}
          disclosure={translationDisclosure}
          providers={translationProviders}
          providerId={translationReview.providerId}
          busy={translatingTab === translationReview.tabKey}
          status={translationReview.status}
          onProviderChange={(providerId) => {
            if (providerId !== '' && providerId !== 'selected-ai' && providerId !== 'free') {
              return
            }
            setTranslationReview((current) =>
              current
                ? {
                    ...current,
                    providerId,
                    // Provider/model changes invalidate any prior consent. The
                    // disclosure fingerprint is regenerated from this state.
                    status: null
                  }
                : null
            )
          }}
          onTranslateNow={() => void handleTranslationNow()}
          onPartialPreview={handleTranslationPartialPreview}
          onPostpone={() => setTranslationReview(null)}
          onCancelTranslation={handleTranslationCancel}
        />
      )}

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
              <div>{t('library.import.summary', { count: libraryImport.entries.length })}</div>
              {libraryImport.manifest && (
                <div style={{ marginTop: 8, color: 'var(--orbitpm-muted)' }}>
                  {t('library.manifestInfo', {
                    files: libraryImport.manifest.files.length,
                    links: libraryImport.manifest.hierarchy.length
                  })}
                </div>
              )}
              {libraryImport.ownersCsv !== undefined && (
                <div style={{ marginTop: 4, color: 'var(--orbitpm-muted)' }}>
                  {t('library.ownersCsvInfo')}
                </div>
              )}
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
          canCreate={Boolean(workspaceAdapter?.storage.capabilities.multipleFiles)}
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

      {saveConflictPrompt && (
        <AccessibleDialog
          ariaLabelledby="save-conflict-title"
          onClose={() => resolveSaveConflictPrompt({ kind: 'cancel' })}
          closeOnEscape
          closeOnBackdrop={false}
          backdropStyle={{
            position: 'fixed',
            inset: 0,
            zIndex: 10060,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            background: 'rgba(0,0,0,0.52)'
          }}
          dialogStyle={{
            width: 'min(900px, 96vw)',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: 18,
            border: '1px solid var(--orbitpm-border)',
            borderRadius: 12,
            background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))',
            color: 'var(--orbitpm-fg)'
          }}
        >
          <h2 id="save-conflict-title" style={{ marginTop: 0 }}>
            {t('session.conflict.title', { path: saveConflictPrompt.path })}
          </h2>
          <p>{t('session.conflict.message')}</p>
          {saveConflictPrompt.showComparison && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 12,
                direction: 'ltr',
                textAlign: 'left'
              }}
            >
              <section>
                <h3>{t('session.conflict.local')}</h3>
                <pre style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {saveConflictPrompt.conflict.localXml}
                </pre>
              </section>
              <section>
                <h3>{t('session.conflict.external')}</h3>
                <pre style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {saveConflictPrompt.conflict.external?.xml ??
                    t('session.conflict.externalMissing')}
                </pre>
              </section>
            </div>
          )}
          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            <span>{t('session.conflict.saveAsLabel')}</span>
            <input
              value={saveConflictPrompt.saveAsPath}
              onChange={(event) =>
                setSaveConflictPrompt((current) =>
                  current
                    ? { ...current, saveAsPath: event.target.value, saveAsError: null }
                    : current
                )
              }
              dir="ltr"
            />
          </label>
          {saveConflictPrompt.saveAsError && (
            <p role="alert" style={{ color: '#c4322f' }}>
              {saveConflictPrompt.saveAsError}
            </p>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: 16
            }}
          >
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() =>
                setSaveConflictPrompt((current) =>
                  current ? { ...current, showComparison: true } : current
                )
              }
            >
              {t('session.conflict.compare')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              disabled={!saveConflictPrompt.conflict.external}
              onClick={() => resolveSaveConflictPrompt({ kind: 'reload-external' })}
            >
              {t('session.conflict.reload')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => resolveSaveConflictPrompt({ kind: 'overwrite', confirmed: true })}
            >
              {t('session.conflict.overwrite')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              disabled={!saveConflictPrompt.saveAsPath.trim()}
              onClick={() => {
                const path = saveConflictPrompt.saveAsPath.trim()
                if (!path) return
                try {
                  const normalized = normalizeWorkspacePath(
                    /\.bpmn$/iu.test(path) ? path : `${path}.bpmn`
                  )
                  if (
                    normalized === saveConflictPrompt.conflict.identity.path ||
                    normalized === '.orbitpm' ||
                    normalized.startsWith('.orbitpm/')
                  ) {
                    setSaveConflictPrompt((current) =>
                      current
                        ? {
                            ...current,
                            saveAsError: t('session.conflict.invalidDestination')
                          }
                        : current
                    )
                    return
                  }
                  resolveSaveConflictPrompt({ kind: 'save-as', path: normalized })
                } catch {
                  setSaveConflictPrompt((current) =>
                    current
                      ? {
                          ...current,
                          saveAsError: t('session.conflict.invalidDestination')
                        }
                      : current
                  )
                }
              }}
            >
              {t('session.conflict.saveAs')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => resolveSaveConflictPrompt({ kind: 'cancel' })}
            >
              {t('session.conflict.cancel')}
            </button>
          </div>
        </AccessibleDialog>
      )}

      {manifestRepair && (
        <ConfirmDialog
          title={t('workspace.manifest.retryTitle')}
          message={t('workspace.manifest.retryMessage', {
            error: errMsg(manifestRepair.error)
          })}
          confirmLabel={t('workspace.manifest.retryAction')}
          onConfirm={() => void retryManifestReconciliation()}
          onCancel={() => setManifestRepair(null)}
        />
      )}

      {pathRecovery && (
        <ConfirmDialog
          title={t('workspace.path.recoveryTitle')}
          message={t('workspace.path.recoveryMessage', {
            error: errMsg(pathRecovery.error),
            path: pathRecovery.payloadPath
          })}
          confirmLabel={t('workspace.path.recoveryRetry')}
          cancelLabel={t('workspace.path.recoveryLater')}
          onConfirm={() => void retryPathRecoveryCleanup()}
          onCancel={() => setPathRecovery(null)}
        />
      )}

      {draftRecoveryPrompt && (
        <DraftRecoveryDialog
          lang={lang}
          title={draftRecoveryPrompt.tab.title}
          comparison={draftRecoveryPrompt.comparison}
          onDecision={(decision) => {
            const pending = draftRecoveryPendingRef.current
            if (pending?.requestId === draftRecoveryPrompt.requestId) {
              pending.resolve(decision)
            }
          }}
          onDownload={() => {
            const base = draftRecoveryPrompt.tab.title.replace(/\.bpmn$/i, '')
            downloadBpmn(
              `${base || 'process'}-recovery-draft.bpmn`,
              draftRecoveryPrompt.comparison.draft.xml
            )
          }}
        />
      )}

      {backupImportPlan && (
        <BackupImportDialog
          plan={backupImportPlan}
          busy={backupBusy}
          onApply={(decisions) => void handleApplyBackupImport(decisions)}
          onCancel={() => setBackupImportPlan(null)}
        />
      )}

      {historyOpen && historyManagerRef.current && (
        <HistoryDialog
          manager={historyManagerRef.current}
          currentXml={(path) => liveFiles.find((file) => file.relPath === path)?.xml}
          onRestore={handleHistoryRestore}
          onChanged={() => refreshWorkspace(rootHandleRef.current ?? undefined)}
          onClose={() => setHistoryOpen(false)}
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

      {pathDirtyPrompt && (
        <AccessibleDialog
          ariaLabelledby="path-dirty-title"
          onClose={() => resolvePathDirtyPrompt('cancel')}
          closeOnEscape
          closeOnBackdrop={false}
          backdropStyle={{
            position: 'fixed',
            inset: 0,
            zIndex: 10070,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            background: 'rgba(0,0,0,0.52)'
          }}
          dialogStyle={{
            width: 'min(520px, 94vw)',
            padding: 18,
            border: '1px solid var(--orbitpm-border)',
            borderRadius: 12,
            background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))',
            color: 'var(--orbitpm-fg)'
          }}
        >
          <h2 id="path-dirty-title" style={{ marginTop: 0 }}>
            {t('workspace.path.dirtyTitle')}
          </h2>
          <p>
            {t('workspace.path.dirtyMessage', {
              count: pathDirtyPrompt.count,
              operation: t(`workspace.path.operation.${pathDirtyPrompt.kind}` as Key),
              path: pathDirtyPrompt.path
            })}
          </p>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 8
            }}
          >
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => resolvePathDirtyPrompt('save')}
            >
              {t('workspace.path.saveContinue')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => resolvePathDirtyPrompt('discard')}
            >
              {t('workspace.path.continueWithoutSaving')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => resolvePathDirtyPrompt('cancel')}
            >
              {t('workspace.path.cancel')}
            </button>
          </div>
        </AccessibleDialog>
      )}

      {downloadSwitchGuard && (
        <ConfirmDialog
          title={t('confirm.switch.downloadedTitle')}
          confirmLabel={t('confirm.switch.continue')}
          message={t('confirm.switch.downloadedBody', {
            count: downloadSwitchGuard.count
          })}
          onConfirm={() => resolveDownloadedSwitch('continue')}
          onCancel={() => resolveDownloadedSwitch('cancel')}
        />
      )}

      <PrintView job={printJob} />
      <Toaster toasts={toasts} onDismiss={dismissToast} />

      <AssistantDrawer
        key={`assistant:${workspaceAdapter?.id ?? 'none'}:${workspaceGenRef.current}`}
        open={assistOpen}
        onOpen={() => setAssistOpen(true)}
        onClose={() => setAssistOpen(false)}
        printing={printJob != null}
        mode={isMultiFileMode(mode) ? 'directory' : 'fallback'}
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
          highlightFields={stepDetails?.highlight}
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
        localizationResources={settingsLocalizationResources}
      />
    </div>
  )
}

export default App
