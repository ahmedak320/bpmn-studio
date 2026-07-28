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
  deriveFileBaseName
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
import {
  applyCommittedWorkspaceProjectionDelta,
  snapshotAdapterWorkspace,
  type AdapterWorkspaceTreeSnapshot,
  type CommittedWorkspaceProjectionDelta
} from './workspace/adapterSnapshot'
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
  workspaceFailure,
  type FileSnapshot,
  type SaveOutcome,
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
  installBeforeUnloadDirtyGuard,
  planPathTransaction,
  resolveDirtyPathDecision,
  restoreHistoryRevision,
  acquireWorkspaceMutationLease,
  runWorkspaceMutation,
  type DraftRecoveryComparison,
  type DraftJournal,
  type DocumentSession,
  type ExternalConflict,
  type ExternalConflictDecision,
  type FileFingerprint,
  type PathTransactionPlan,
  type PrepareHistoryXmlResult,
  type RestoreHistoryRevisionResult,
  type SessionPersistence,
  type WorkspaceMutationLease,
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
import { getKey, hasKey, migrateLegacyCredentialsOnStartup } from './ai/keys'
import { keyStorageErrorMessage } from './ai/keyStorageErrorMessage'
import {
  buildTranslationExternalReview,
  translateReviewedDiagram,
  translateReviewedField,
  translateReviewedFieldWithTexts,
  translateReviewedDiagramWithTexts,
  type ReviewedTranslationProposal,
  type TranslateModeler
} from './ai/translate'
import { makeFreeTranslateTexts, FreeTranslateError } from './ai/freeTranslate'
import {
  boundedTranslationTechnicalDetail,
  TranslationReviewDialog,
  type TranslationFieldRetryConfirmation,
  type TranslationReviewProviderOption
} from './localization/TranslationReviewDialog'
import {
  applyDiagramLocalizationReview,
  assertLocalizationReviewCurrent,
  inspectDiagramLocalization,
  StaleLocalizationReviewError,
  type DiagramLocalizationReview
} from './localization/modelerAdapter'
import {
  grantExternalRequestConsent,
  hasExternalRequestConsent
} from './localization/externalRequestReview'
import {
  applyStagedTranslationRecoveryValues,
  buildTranslationRecoveryDisclosure,
  listTranslationRecoveryFields,
  translationRecoveryFieldId,
  validateTranslationRecoveryValue,
  InvalidTranslationRecoveryValueError,
  type TranslationRecoveryField,
  type TranslationRecoveryFieldId
} from './localization/translationRecovery'
import {
  LocalizationSource,
  type LocalizationResources,
  type LocalizationSource as LocalizationSourceType,
  type ProviderFailure
} from './localization/types'
import { auditFieldTarget } from './localization/audit'
import { SEEDED_GLOSSARY } from './localization/glossary'
import {
  reviewBpmnXmlLocalization,
  type ReviewedXmlIngestionReviewRequest
} from './localization/xmlIngestion'
import { ReviewedXmlIngestionDialog } from './localization/ReviewedXmlIngestionDialog'
import { ReviewedXmlReviewQueue } from './localization/reviewQueue'
import {
  createWorkspaceLocalizationStore,
  createWorkspaceTranslationMemoryDocument,
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_TRANSLATION_MEMORY_PATH,
  WorkspaceLocalizationConflictError,
  WorkspaceLocalizationPartialLoadError,
  WorkspaceLocalizationResourceLimitError,
  WorkspaceLocalizationValidationError,
  type WorkspaceLocalizationState,
  type WorkspaceLocalizationStore
} from './localization/workspaceStore'
import { SettingsDialogLite, type SettingsDialogLiteProps } from './settings/SettingsDialogLite'
import type { LocalizationResourcesFailureCode } from './settings/LocalizationResourcesEditor'
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
import { ActionMenu } from './common/ActionMenu'
import {
  ResponsiveDrawer,
  ResponsiveShell,
  useDetailsPreferences,
  useResponsiveShellMode
} from './shell'
import { createMutex } from './workspace/mutex'
import { partitionDirtyTabs } from './workspace/dirtySave'
import { canCommitToWorkspace } from './workspace/workspaceSession'
import { MoveDialog } from './workspace/MoveDialog'
import { PrintButton } from './workspace/PrintButton'
import { PrintView, type PrintJob } from './workspace/PrintView'
import {
  classifyImportBoundarySource,
  collectDroppedBpmn,
  isInternalDrag,
  MAX_DROPPED_IMPORT_BYTES,
  type DroppedBpmn
} from './workspace/importDrop'
import {
  getProcessOrgProps,
  mergeActiveLanguageOrgProps,
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
import { AssistantDrawer, type InterviewApplyRequest } from './assist/AssistantDrawer'
import { buildAllDigests, type ProcessDigest } from './assist/digest'
import { buildLibraryZip, zipFileName } from './library/zipExport'
import {
  LIBRARY_MANIFEST_NAME,
  buildLibraryManifest,
  serializeLibraryManifest
} from './library/libraryManifest'
import { readLibraryZipFileInWorker } from './library/browserZipImport'
import type { LibraryImportResult } from './library/zipImport'
import {
  confirmWorkspaceImportPlan,
  DEFAULT_WORKSPACE_IMPORT_LIMITS,
  executeConfirmedWorkspaceImport,
  prepareWorkspaceImportPlan,
  secureBpmnImportPreparer,
  type WorkspaceImportCollisionDecision,
  type WorkspaceImportPlan,
  type WorkspaceImportSource
} from './workspace/importTransaction'
import { WorkspaceImportReviewDialog } from './workspace/WorkspaceImportReviewDialog'
import { decodeUtf8Strict } from './workspace/utf8'
import {
  evaluateValidationPolicy,
  getRuntimeValidationAdapters,
  ReadOnlyDiagramPreview,
  validateBpmnXml,
  validateUnknownExtensionPreservation,
  type ReadOnlyDiagramPreviewStatus,
  type ValidationAction,
  type ValidationSummary
} from './validation'
import { t, tPlural, type Key } from './i18n'
import { useLang, setLang } from './i18n/useLang'
import './print.css'

type Phase = 'loading' | 'need-open' | 'need-reconnect' | 'ready'
type Mode = WorkspaceMode

const DEFAULT_LOCALIZATION_RESOURCES: LocalizationResources = Object.freeze({
  glossary: SEEDED_GLOSSARY,
  translationMemory: Object.freeze([])
})

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

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
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

interface DirtyTabClosePromptState {
  key: string
  title: string
  generation: number
  controller: DocumentSessionController | null
  sessionIncarnation: number | null
}

interface SessionSaveRequestResult {
  durable: boolean
  acceptedSubmittedXml?: boolean
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
  kind: 'rename' | 'move' | 'delete' | 'import' | 'history'
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
  binding: WorkspaceOperationBinding
  node: LiteTreeNode
  /** Non-empty folder → require typing this name to confirm. */
  requireTyped?: string
}

interface MoveState {
  binding: WorkspaceOperationBinding
  node: LiteTreeNode
}

interface TranslationReviewState {
  tabKey: string
  review: DiagramLocalizationReview
  localizationRevision: TranslationLocalizationRevision
  providerId: '' | 'selected-ai' | 'free'
  aiSelection: ProviderSelection | null
  status: string | null
  technicalDetail: string | null
  retryingFieldId: TranslationRecoveryFieldId | null
  proposals: readonly ReviewedTranslationProposal[]
  acceptedValues: readonly ReviewedTranslationProposal[]
  memoryRetry?: {
    binding: WorkspaceLocalizationBinding
    pairs: readonly AcceptedTranslationPair[]
  }
}

interface AcceptedTranslationPair {
  en: string
  ar: string
}

function canonicalAcceptedTranslationPair(pair: AcceptedTranslationPair): AcceptedTranslationPair {
  const entry = createWorkspaceTranslationMemoryDocument([
    { en: pair.en, ar: pair.ar, accepted: true }
  ]).entries[0]!
  return { en: entry.en, ar: entry.ar }
}

function acceptedTranslationPairKey(pair: AcceptedTranslationPair): string {
  return JSON.stringify([pair.en.toLocaleLowerCase('en-US'), pair.ar.toLocaleLowerCase('en-US')])
}

interface GeneratedLayoutReviewState {
  id: number
  xml: string
  renderStatus: ReadOnlyDiagramPreviewStatus['status']
}

function baseName(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function localizationFailureCode(error: unknown): LocalizationResourcesFailureCode {
  if (error instanceof WorkspaceLocalizationConflictError) return 'conflict'
  if (error instanceof WorkspaceLocalizationValidationError) return 'validation'
  if (error instanceof WorkspaceLocalizationResourceLimitError) return 'resource-limit'
  if (error instanceof WorkspaceLocalizationPartialLoadError) return 'partial-load'
  if (error instanceof WorkspaceOperationError) return error.code
  return 'unknown'
}

function hasOpenModalSurface(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
    ) !== null
  )
}

function providerFailuresFromReview(review: DiagramLocalizationReview): ProviderFailure[] {
  return review.issues
    .filter((issue) => issue.code === 'provider-failed')
    .map((issue) => ({
      processId: issue.processId,
      elementId: issue.elementId,
      field: issue.field,
      target: issue.target,
      ...(issue.originalValue === undefined ? {} : { originalValue: issue.originalValue })
    }))
}

function providerFailuresWithField(
  review: DiagramLocalizationReview,
  field: TranslationRecoveryField
): ProviderFailure[] {
  const failures = providerFailuresFromReview(review)
  const alreadyListed = failures.some(
    (failure) =>
      failure.processId === field.processId &&
      failure.elementId === field.elementId &&
      failure.field === field.field &&
      failure.target === field.target
  )
  if (!alreadyListed) {
    failures.push({
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      target: field.target,
      originalValue: field.sourceValue
    })
  }
  return failures
}

function proposalMatchesField(
  proposal: ReviewedTranslationProposal,
  field: Pick<
    TranslationRecoveryField,
    'processId' | 'elementId' | 'field' | 'target' | 'sourceLanguage' | 'sourceValue'
  >
): boolean {
  return (
    proposal.processId === field.processId &&
    proposal.elementId === field.elementId &&
    proposal.field === field.field &&
    proposal.target === field.target &&
    proposal.sourceLanguage === field.sourceLanguage &&
    proposal.sourceValue === field.sourceValue
  )
}

function proposalsWithoutField(
  proposals: readonly ReviewedTranslationProposal[],
  field: Pick<
    TranslationRecoveryField,
    'processId' | 'elementId' | 'field' | 'target' | 'sourceLanguage' | 'sourceValue'
  >
): ReviewedTranslationProposal[] {
  return proposals.filter((proposal) => !proposalMatchesField(proposal, field))
}

function providerFailuresWithoutField(
  review: DiagramLocalizationReview,
  field: Pick<TranslationRecoveryField, 'processId' | 'elementId' | 'field' | 'target'>
): ProviderFailure[] {
  return providerFailuresFromReview(review).filter(
    (failure) =>
      failure.processId !== field.processId ||
      failure.elementId !== field.elementId ||
      failure.field !== field.field ||
      failure.target !== field.target
  )
}

function rebaseTranslationReviewAfterMemorySave(
  modeler: LangToggleModeler,
  review: DiagramLocalizationReview,
  snapshot: WorkspaceLocalizationState
): DiagramLocalizationReview {
  const local = inspectDiagramLocalization(modeler, review.target, {
    source: review.source,
    ...snapshot.resources
  })
  const stillUnresolved = new Set(
    local.queue.map((item) =>
      JSON.stringify([item.processId, item.elementId, item.field, item.target])
    )
  )
  const retainedFailures = providerFailuresFromReview(review).filter((failure) =>
    stillUnresolved.has(
      JSON.stringify([failure.processId, failure.elementId, failure.field, failure.target])
    )
  )
  if (retainedFailures.length === 0) return local
  return inspectDiagramLocalization(modeler, review.target, {
    source: review.source,
    providerFailures: retainedFailures,
    ...snapshot.resources
  })
}

function acceptedPairForReviewedField(
  review: DiagramLocalizationReview,
  field: Pick<TranslationRecoveryField, 'processId' | 'elementId' | 'field'>
): AcceptedTranslationPair | null {
  const reviewed = review.fields.find(
    (candidate) =>
      candidate.processId === field.processId &&
      candidate.elementId === field.elementId &&
      candidate.field === field.field
  )
  const en = reviewed?.value.en?.trim()
  const ar = reviewed?.value.ar?.trim()
  if (!reviewed || !en || !ar) return null
  const auditOptions = { glossary: review.localResources.glossary }
  if (
    auditFieldTarget(reviewed, 'en', auditOptions).length > 0 ||
    auditFieldTarget(reviewed, 'ar', auditOptions).length > 0
  ) {
    return null
  }
  try {
    const validated = createWorkspaceTranslationMemoryDocument([{ en, ar, accepted: true }])
      .entries[0]!
    return { en: validated.en, ar: validated.ar }
  } catch {
    return null
  }
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

function assertImportAllocationSize(byteLength: number, path: string): void {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > MAX_DROPPED_IMPORT_BYTES
  ) {
    throw new WorkspaceOperationError({
      code: 'integrity-failure',
      operation: 'read',
      path,
      message: `Import file "${path}" exceeds the ${MAX_DROPPED_IMPORT_BYTES}-byte limit.`
    })
  }
}

async function readBrowserImportFile(file: File, signal?: AbortSignal): Promise<string> {
  assertImportAllocationSize(file.size, file.name)
  if (signal?.aborted) throw new DOMException('Import was cancelled.', 'AbortError')
  const buffer = await file.arrayBuffer()
  if (signal?.aborted) throw new DOMException('Import was cancelled.', 'AbortError')
  assertImportAllocationSize(buffer.byteLength, file.name)
  return decodeUtf8Strict(new Uint8Array(buffer), {
    operation: 'read',
    path: file.name
  })
}

function isWorkspaceLocalizationResourcePath(path: string): boolean {
  try {
    const normalized = normalizeWorkspacePath(path).toLocaleLowerCase('en-US')
    return (
      normalized === WORKSPACE_GLOSSARY_PATH.toLocaleLowerCase('en-US') ||
      normalized === WORKSPACE_TRANSLATION_MEMORY_PATH.toLocaleLowerCase('en-US')
    )
  } catch {
    return false
  }
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

interface TranslationLocalizationRevision {
  binding: WorkspaceLocalizationBinding | null
  glossaryHash: string | null
  translationMemoryHash: string | null
}

function translationLocalizationRevision(
  binding: WorkspaceLocalizationBinding | null,
  snapshot: WorkspaceLocalizationState | null
): TranslationLocalizationRevision {
  return {
    binding,
    glossaryHash: snapshot?.files.glossary.hash ?? null,
    translationMemoryHash: snapshot?.files.translationMemory.hash ?? null
  }
}

function translationLocalizationRevisionMatches(
  revision: TranslationLocalizationRevision,
  binding: WorkspaceLocalizationBinding | null,
  snapshot: WorkspaceLocalizationState | null
): boolean {
  return (
    revision.binding === binding &&
    revision.glossaryHash === (snapshot?.files.glossary.hash ?? null) &&
    revision.translationMemoryHash === (snapshot?.files.translationMemory.hash ?? null)
  )
}

interface WorkspaceOperationBinding {
  adapter: WorkspaceAdapter | null
  coordination: BroadcastWorkspaceCoordinator | null
  controller: DocumentSessionController | null
  drafts: DraftJournalCoordinator | null
  generation: number
  history: PortableHistoryManager | null
  identity: WorkspaceIdentity | null
  index: LiveWorkspaceIndex
}

interface LibraryImportState {
  binding: WorkspaceOperationBinding
  name: string
  result: LibraryImportResult
}

interface WorkspaceImportReviewState {
  binding: WorkspaceOperationBinding
  controller: AbortController
  plan: WorkspaceImportPlan
  sources: readonly WorkspaceImportSource[]
  targetFolder: string
  decisions: Readonly<Record<string, WorkspaceImportCollisionDecision>>
  busy: boolean
  error: string | null
}

interface BackupImportState {
  binding: WorkspaceOperationBinding
  controller: AbortController
  backup: File
  plan: WorkspaceBackupImportPlan
}

interface OpenSessionCommitGuard {
  id: string
  incarnation: number
  revision: number
  currentXml: string
  uiDirty: boolean
}

type LiveSessionCaptureResult =
  | { status: 'captured'; session: DocumentSession }
  | { status: 'stale' }
  | { status: 'unavailable'; error: unknown; session: DocumentSession }

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
  const langRef = useRef(lang)
  langRef.current = lang
  const [credentialMigration] = useState(() => migrateLegacyCredentialsOnStartup())
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
  const workspaceRuntimeIssuesRef = useRef<Set<string>>(new Set())
  const [workspaceLocalizationError, setWorkspaceLocalizationError] = useState<string | null>(null)
  const [workspaceLocalizationErrorCode, setWorkspaceLocalizationErrorCode] =
    useState<LocalizationResourcesFailureCode | null>(null)
  const liveWorkspaceIndexRef = useRef(new LiveWorkspaceIndex())
  const [liveWorkspaceVersion, setLiveWorkspaceVersion] = useState(0)

  const [tabs, setTabs] = useState<Tab[]>([])
  const tabsRef = useRef<readonly Tab[]>([])
  tabsRef.current = tabs
  const [dirtyTabClosePrompt, setDirtyTabClosePrompt] = useState<DirtyTabClosePromptState | null>(
    null
  )
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const activeKeyRef = useRef<string | null>(null)
  activeKeyRef.current = activeKey
  const [contents, setContents] = useState<Record<string, string>>({})
  const [dirtyByKey, setDirtyByKey] = useState<Record<string, boolean>>({})
  const dirtyByKeyRef = useRef<Record<string, boolean>>({})
  dirtyByKeyRef.current = dirtyByKey
  const forcedUndurableDirtyByKeyRef = useRef<Set<string>>(new Set())
  const baseHashByPathRef = useRef<Record<string, string>>({})
  const liveXmlTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const liveXmlCaptureEpochByKeyRef = useRef<Record<string, number>>({})
  const duplicateRepairTokenByPathRef = useRef<Map<string, symbol>>(new Map())
  const [mounted, setMounted] = useState<Set<string>>(() => new Set())
  const [modelersByKey, setModelersByKey] = useState<Record<string, unknown>>({})
  const modelersByKeyRef = useRef<Readonly<Record<string, unknown>>>({})
  modelersByKeyRef.current = modelersByKey
  const commandsRef = useRef<Record<string, EditorTabCommands | null>>({})
  const commandUnregisterersRef = useRef<Record<string, () => void>>({})
  const commandRouterRef = useRef<ActiveSessionCommandRouter | null>(null)
  const persistenceInteractionLockedRef = useRef(false)
  const persistenceInteractionLocksRef = useRef<Set<symbol>>(new Set())
  const acquirePersistenceInteractionLock = useCallback((): (() => void) => {
    const token = Symbol('persistence-interaction')
    persistenceInteractionLocksRef.current.add(token)
    persistenceInteractionLockedRef.current = true
    return () => {
      persistenceInteractionLocksRef.current.delete(token)
      persistenceInteractionLockedRef.current = persistenceInteractionLocksRef.current.size > 0
    }
  }, [])
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
  const [reviewedXmlReviewRequest, setReviewedXmlReviewRequest] =
    useState<ReviewedXmlIngestionReviewRequest | null>(null)
  const reviewedXmlReviewMountedRef = useRef(true)
  const reviewedXmlReviewQueueRef = useRef<ReviewedXmlReviewQueue | null>(null)
  if (!reviewedXmlReviewQueueRef.current) {
    reviewedXmlReviewQueueRef.current = new ReviewedXmlReviewQueue((request) => {
      if (reviewedXmlReviewMountedRef.current) setReviewedXmlReviewRequest(request)
    })
  }
  const historyManagerRef = useRef<PortableHistoryManager | null>(null)
  const historyRestoreAbortRef = useRef<AbortController | null>(null)
  const workspaceIdentityRef = useRef<WorkspaceIdentity | null>(null)
  const sessionControllerRef = useRef<DocumentSessionController | null>(null)
  const draftJournalRef = useRef<DraftJournal | null>(null)
  const draftJournalDurableRef = useRef(true)
  const draftJournalWarningShownRef = useRef(false)
  const draftCoordinatorRef = useRef<DraftJournalCoordinator | null>(null)
  const workspaceCoordinatorRef = useRef<BroadcastWorkspaceCoordinator | null>(null)
  const sessionStoreUnsubscribeRef = useRef<(() => void) | null>(null)
  const workspaceChangeUnsubscribeRef = useRef<(() => void) | null>(null)
  const workspaceChangeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  // Claimed before any picker, decode, permission, or dirty-work prompt. A
  // newer activation intent invalidates older asynchronous work immediately,
  // even before the newer request reaches activateWorkspace.
  const workspaceActivationIntentRef = useRef(0)
  const refreshSequenceRef = useRef(0)
  const workspaceRefreshAbortRef = useRef<AbortController | null>(null)
  const workspaceProjectionRef = useRef<{
    adapter: WorkspaceAdapter
    generation: number
    snapshot: AdapterWorkspaceTreeSnapshot
  } | null>(null)
  const opMutexRef = useRef(createMutex()) // serializes create / import / AI-place writes
  const rememberWorkspaceMutexRef = useRef(createMutex())
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
  const draftRecoveryFlowQueueRef = useRef<Promise<void>>(Promise.resolve())
  const skipDraftTrackingOnceRef = useRef<Set<string>>(new Set())
  const draftRecoveryPendingRef = useRef<{
    requestId: number
    resolve: (decision: DraftRecoveryDecision | 'cancel') => void
  } | null>(null)
  const captureWorkspaceOperation = useCallback(
    (): WorkspaceOperationBinding => ({
      adapter: workspaceAdapterRef.current,
      coordination: workspaceCoordinatorRef.current,
      controller: sessionControllerRef.current,
      drafts: draftCoordinatorRef.current,
      generation: workspaceGenRef.current,
      history: historyManagerRef.current,
      identity: workspaceIdentityRef.current,
      index: liveWorkspaceIndexRef.current
    }),
    []
  )
  const isWorkspaceOperationCurrent = useCallback(
    (binding: WorkspaceOperationBinding): boolean =>
      workspaceAdapterRef.current === binding.adapter &&
      workspaceCoordinatorRef.current === binding.coordination &&
      sessionControllerRef.current === binding.controller &&
      draftCoordinatorRef.current === binding.drafts &&
      workspaceGenRef.current === binding.generation &&
      historyManagerRef.current === binding.history &&
      workspaceIdentityRef.current === binding.identity &&
      liveWorkspaceIndexRef.current === binding.index,
    []
  )
  const workspaceMutationReleaseErrorRef = useRef<(error: unknown) => void>(() => undefined)

  const acquireCoordinatedWorkspaceMutation = useCallback(
    async (
      binding: WorkspaceOperationBinding,
      signal?: AbortSignal
    ): Promise<WorkspaceMutationLease> => {
      if (!binding.identity) throw new Error(t('workspace.path.unavailable'))
      return acquireWorkspaceMutationLease({
        coordination: binding.coordination,
        workspace: binding.identity,
        signal,
        isCurrent: () => isWorkspaceOperationCurrent(binding)
      })
    },
    [isWorkspaceOperationCurrent]
  )

  const runCoordinatedWorkspaceMutation = useCallback(
    async <Result,>(
      binding: WorkspaceOperationBinding,
      operation: (lease: WorkspaceMutationLease) => Promise<Result>,
      signal?: AbortSignal
    ): Promise<Result> => {
      const workspace = binding.identity
      if (!workspace) throw new Error(t('workspace.path.unavailable'))
      return opMutexRef.current.runExclusive(() =>
        runWorkspaceMutation(
          {
            coordination: binding.coordination,
            workspace,
            signal,
            isCurrent: () => isWorkspaceOperationCurrent(binding),
            onReleaseError: (error) => workspaceMutationReleaseErrorRef.current(error)
          },
          operation
        )
      )
    },
    [isWorkspaceOperationCurrent]
  )

  const [settingsOpen, setSettingsOpen] = useState(false)
  // The Step-details dialog targets one tab's modeler; the mode (element vs
  // process), the initial values and the target element are all derived LIVE
  // from that modeler's current selection at render time (stepDetailsCtx).
  // `highlight` carries the missing-info categories a canvas badge click wants
  // ringed inside the dialog (MissingCategory names).
  const [stepDetails, setStepDetails] = useState<{ tabKey: string; highlight?: string[] } | null>(
    null
  )
  // The application shell owns both side-pane breakpoints. Keeping the
  // explorer's React subtree mounted is deliberate: collapsing it or opening a
  // process must not discard an AI attachment, prompt, mapping wizard, or
  // destination choice.
  const responsiveMode = useResponsiveShellMode()
  const responsiveModeRef = useRef(responsiveMode)
  responsiveModeRef.current = responsiveMode
  const detailsController = useDetailsPreferences()
  const detailsOpen = detailsController.preferences.open
  const setDetailsOpen = detailsController.setOpen
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [outlineOpenTabKey, setOutlineOpenTabKey] = useState<string | null>(null)
  const explorerToggleRef = useRef<HTMLButtonElement | null>(null)
  const explorerCloseRef = useRef<HTMLButtonElement | null>(null)
  const explorerReturnFocusRef = useRef<HTMLElement | null>(null)
  const setExplorerOpen = useCallback(
    (open: boolean): void => {
      if (open && responsiveModeRef.current !== 'docked') {
        setDetailsOpen(false)
        setOutlineOpenTabKey(null)
      }
      setSidebarOpen(open)
    },
    [setDetailsOpen]
  )
  const handleDetailsOpenChange = useCallback((open: boolean): void => {
    if (open && responsiveModeRef.current !== 'docked') {
      setSidebarOpen(false)
      setOutlineOpenTabKey(null)
    }
  }, [])
  const handleOutlineOpenChange = useCallback(
    (tabKey: string, open: boolean): void => {
      setOutlineOpenTabKey((current) => {
        if (!open) return current === tabKey ? null : current
        return tabKey
      })
      if (open && responsiveModeRef.current !== 'docked') {
        setSidebarOpen(false)
        setDetailsOpen(false)
      }
    },
    [setDetailsOpen]
  )

  useEffect(() => {
    if (responsiveMode === 'docked') return
    if (detailsOpen) {
      // A viewport can cross a breakpoint while several docked panes are open.
      // Details is the active editor context, so retain it and close both
      // competing modal drawers.
      setSidebarOpen(false)
      setOutlineOpenTabKey(null)
      return
    }
    if (outlineOpenTabKey) {
      setSidebarOpen(false)
    }
  }, [detailsOpen, outlineOpenTabKey, responsiveMode])
  const explorerOpen =
    sidebarOpen && (responsiveMode === 'docked' || (!detailsOpen && outlineOpenTabKey === null))
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
  const [translationFinalizingTab, setTranslationFinalizingTab] = useState<string | null>(null)
  const [translationReview, setTranslationReviewState] = useState<TranslationReviewState | null>(
    null
  )
  const translationReviewRef = useRef<TranslationReviewState | null>(translationReview)
  const setTranslationReview = useCallback(
    (
      update:
        | TranslationReviewState
        | null
        | ((current: TranslationReviewState | null) => TranslationReviewState | null)
    ): void => {
      const current = translationReviewRef.current
      const next = typeof update === 'function' ? update(current) : update
      translationReviewRef.current = next
      setTranslationReviewState(next)
    },
    []
  )
  const translationAbortRef = useRef<AbortController | null>(null)
  const translationOperationNonceRef = useRef(0)
  const translationFinalizationOperationRef = useRef<{
    kind: 'apply' | 'memory'
    nonce: number
    tabKey: string
  } | null>(null)
  const translationReviewOpenOperationRef = useRef<{
    nonce: number
    tabKey: string
    modeler: LangToggleModeler
  } | null>(null)
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
  const interviewApplyTokenByTabRef = useRef(new Map<string, number>())

  useEffect(() => {
    if (stepDetails && stepDetails.tabKey !== activeKey) {
      setStepDetails(null)
    }
    if (translationReview && translationReview.tabKey !== activeKey) {
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      translationFinalizationOperationRef.current = null
      setTranslatingTab(null)
      setTranslationFinalizingTab(null)
      setTranslationReview(null)
    }
    if (translationReviewOpenOperationRef.current?.tabKey !== activeKey) {
      translationReviewOpenOperationRef.current = null
    }
  }, [activeKey, setTranslationReview, stepDetails, translationReview])

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

  const translationDisclosureReview = translationReview?.review ?? null
  const translationDisclosureProviderId = translationReview?.providerId ?? ''
  const translationDisclosureAiProviderId = translationReview?.aiSelection?.providerId
  const translationDisclosureAiModelId = translationReview?.aiSelection?.modelId
  const translationDisclosure = useMemo(() => {
    if (!translationDisclosureReview || !translationDisclosureProviderId) return null
    if (translationDisclosureProviderId === 'free') {
      return buildTranslationExternalReview(translationDisclosureReview, {
        providerId: 'google-translate+mymemory',
        kind: 'free'
      })
    }
    if (!translationDisclosureAiProviderId || !translationDisclosureAiModelId) return null
    return buildTranslationExternalReview(translationDisclosureReview, {
      providerId: translationDisclosureAiProviderId,
      modelId: translationDisclosureAiModelId,
      kind: 'ai'
    })
  }, [
    translationDisclosureAiModelId,
    translationDisclosureAiProviderId,
    translationDisclosureProviderId,
    translationDisclosureReview
  ])
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
        setWorkspaceLocalizationErrorCode(null)
      }
      return next
    },
    []
  )

  const loadWorkspaceLocalizationCoordinated = useCallback(
    async (
      binding: WorkspaceLocalizationBinding,
      operationBinding: WorkspaceOperationBinding = captureWorkspaceOperation()
    ): Promise<WorkspaceLocalizationState> => {
      if (
        operationBinding.adapter !== binding.adapter ||
        operationBinding.generation !== binding.generation
      ) {
        throw new Error(t('alert.staleWrite'))
      }
      return runCoordinatedWorkspaceMutation(
        operationBinding,
        async (lease) => {
          const previous = binding.store.current
          try {
            const next = await binding.store.load({ signal: binding.controller.signal })
            const changes = [
              ...(previous?.files.glossary.hash !== next.files.glossary.hash
                ? [
                    {
                      kind: 'saved' as const,
                      path: WORKSPACE_GLOSSARY_PATH,
                      fingerprint: {
                        hash: next.files.glossary.hash,
                        size: next.files.glossary.size,
                        modifiedAt: next.files.glossary.modifiedAt
                      }
                    }
                  ]
                : []),
              ...(previous?.files.translationMemory.hash !== next.files.translationMemory.hash
                ? [
                    {
                      kind: 'saved' as const,
                      path: WORKSPACE_TRANSLATION_MEMORY_PATH,
                      fingerprint: {
                        hash: next.files.translationMemory.hash,
                        size: next.files.translationMemory.size,
                        modifiedAt: next.files.translationMemory.modifiedAt
                      }
                    }
                  ]
                : [])
            ]
            lease.publish(changes)
            return next
          } catch (error) {
            if (error instanceof WorkspaceLocalizationPartialLoadError) {
              lease.publish(
                error.committedPaths.map((path) => ({
                  kind: 'invalidated',
                  path
                }))
              )
            }
            throw error
          }
        },
        binding.controller.signal
      )
    },
    [captureWorkspaceOperation, runCoordinatedWorkspaceMutation]
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
      operation: (signal: AbortSignal) => Promise<WorkspaceLocalizationState>,
      changed: (
        next: WorkspaceLocalizationState
      ) => readonly (typeof WORKSPACE_GLOSSARY_PATH | typeof WORKSPACE_TRANSLATION_MEMORY_PATH)[]
    ): Promise<WorkspaceLocalizationState> => {
      assertCurrent()
      const operationBinding = captureWorkspaceOperation()
      if (
        operationBinding.adapter !== binding.adapter ||
        operationBinding.generation !== binding.generation
      ) {
        throw new Error(t('alert.staleWrite'))
      }
      return runCoordinatedWorkspaceMutation(
        operationBinding,
        async (lease) => {
          const previous = binding.store.current
          let next: WorkspaceLocalizationState
          try {
            next = await operation(binding.controller.signal)
          } catch (error) {
            if (error instanceof WorkspaceLocalizationPartialLoadError) {
              lease.publish(
                error.committedPaths.map((path) => ({
                  kind: 'invalidated',
                  path
                }))
              )
            }
            throw error
          }
          assertCurrent()
          const changedPaths = changed(next).filter((path) => {
            if (!previous) return true
            return path === WORKSPACE_GLOSSARY_PATH
              ? previous.files.glossary.hash !== next.files.glossary.hash
              : previous.files.translationMemory.hash !== next.files.translationMemory.hash
          })
          lease.publish(
            changedPaths.map((path) => {
              const file =
                path === WORKSPACE_GLOSSARY_PATH
                  ? next.files.glossary
                  : next.files.translationMemory
              return {
                kind: 'saved',
                path,
                fingerprint: {
                  hash: file.hash,
                  size: file.size,
                  modifiedAt: file.modifiedAt
                }
              }
            })
          )
          return commitWorkspaceLocalizationSnapshot(binding, next)
        },
        binding.controller.signal
      )
    }
    return {
      workspaceBindingKey: `${binding.adapter.id}:${binding.generation}`,
      snapshot: workspaceLocalizationSnapshot,
      loadError: workspaceLocalizationError,
      loadErrorCode: workspaceLocalizationErrorCode,
      onSaveGlossary: async (entries, expectedHash) =>
        run(
          (signal) => binding.store.replaceGlossary(entries, { signal, expectedHash }),
          () => [WORKSPACE_GLOSSARY_PATH]
        ),
      onSaveTranslationMemory: async (entries, expectedHash) =>
        run(
          (signal) => binding.store.replaceTranslationMemory(entries, { signal, expectedHash }),
          () => [WORKSPACE_TRANSLATION_MEMORY_PATH]
        ),
      onReload: async () => {
        try {
          return await run(
            (signal) => binding.store.load({ signal }),
            () => [WORKSPACE_GLOSSARY_PATH, WORKSPACE_TRANSLATION_MEMORY_PATH]
          )
        } catch (error) {
          if (
            workspaceLocalizationBindingRef.current === binding &&
            !binding.controller.signal.aborted
          ) {
            workspaceLocalizationSnapshotRef.current = null
            setWorkspaceLocalizationSnapshot(null)
            const message = errMsg(error)
            setWorkspaceLocalizationError(message)
            setWorkspaceLocalizationErrorCode(localizationFailureCode(error))
          }
          throw error
        }
      },
      onSnapshotChange: (next) => {
        commitWorkspaceLocalizationSnapshot(binding, next)
      }
    }
  }, [
    captureWorkspaceOperation,
    commitWorkspaceLocalizationSnapshot,
    runCoordinatedWorkspaceMutation,
    workspaceLocalizationError,
    workspaceLocalizationErrorCode,
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

  const persistAcceptedTranslationPairs = useCallback(
    async (
      binding: WorkspaceLocalizationBinding | null,
      pairs: readonly AcceptedTranslationPair[],
      options: { reloadBeforeWrite?: boolean } = {}
    ): Promise<{
      status: 'not-needed' | 'saved' | 'stale' | 'failed'
      error?: unknown
      snapshot?: WorkspaceLocalizationState
    }> => {
      if (!binding || pairs.length === 0) return { status: 'not-needed' }
      const isCurrent = (): boolean =>
        workspaceLocalizationBindingRef.current === binding &&
        workspaceAdapterRef.current === binding.adapter &&
        workspaceGenRef.current === binding.generation &&
        !binding.controller.signal.aborted
      const operationBinding = captureWorkspaceOperation()
      if (
        operationBinding.adapter !== binding.adapter ||
        operationBinding.generation !== binding.generation
      ) {
        return { status: 'stale' }
      }
      let reloadedSnapshot: WorkspaceLocalizationState | undefined
      try {
        return await runCoordinatedWorkspaceMutation(
          operationBinding,
          async (lease) => {
            const changed = new Map<
              string,
              Parameters<WorkspaceMutationLease['publish']>[0][number]
            >()
            const recordSnapshot = (
              snapshot: WorkspaceLocalizationState,
              previous: WorkspaceLocalizationState | undefined,
              paths: readonly (
                typeof WORKSPACE_GLOSSARY_PATH | typeof WORKSPACE_TRANSLATION_MEMORY_PATH
              )[]
            ): void => {
              for (const path of paths) {
                const file =
                  path === WORKSPACE_GLOSSARY_PATH
                    ? snapshot.files.glossary
                    : snapshot.files.translationMemory
                const previousFile =
                  path === WORKSPACE_GLOSSARY_PATH
                    ? previous?.files.glossary
                    : previous?.files.translationMemory
                if (previousFile?.hash === file.hash) continue
                changed.set(path, {
                  kind: 'saved',
                  path,
                  fingerprint: {
                    hash: file.hash,
                    size: file.size,
                    modifiedAt: file.modifiedAt
                  }
                })
              }
            }
            try {
              const unique = new Map<string, AcceptedTranslationPair>()
              for (const pair of pairs) {
                const canonical = canonicalAcceptedTranslationPair(pair)
                unique.set(acceptedTranslationPairKey(canonical), canonical)
              }
              let pairsToPersist = [...unique.values()]
              if (options.reloadBeforeWrite) {
                const previous = binding.store.current
                const reloaded = await binding.store.load({ signal: binding.controller.signal })
                reloadedSnapshot = reloaded
                recordSnapshot(reloaded, previous, [
                  WORKSPACE_GLOSSARY_PATH,
                  WORKSPACE_TRANSLATION_MEMORY_PATH
                ])
                if (!isCurrent()) {
                  lease.publish([...changed.values()])
                  return { status: 'stale' }
                }
                commitWorkspaceLocalizationSnapshot(binding, reloaded)
                const durablePairs = new Set(
                  reloaded.resources.translationMemory.map((entry) =>
                    acceptedTranslationPairKey({ en: entry.en, ar: entry.ar })
                  )
                )
                pairsToPersist = pairsToPersist.filter(
                  (pair) => !durablePairs.has(acceptedTranslationPairKey(pair))
                )
                if (pairsToPersist.length === 0) {
                  lease.publish([...changed.values()])
                  return { status: 'saved', snapshot: reloaded }
                }
              }
              if (!isCurrent()) return { status: 'stale' }
              const previous = binding.store.current
              const next = await binding.store.acceptTranslationPairs(pairsToPersist, {
                signal: binding.controller.signal
              })
              recordSnapshot(next, previous, [WORKSPACE_TRANSLATION_MEMORY_PATH])
              lease.publish([...changed.values()])
              if (!isCurrent()) return { status: 'stale' }
              commitWorkspaceLocalizationSnapshot(binding, next)
              return { status: 'saved', snapshot: next }
            } catch (error) {
              if (error instanceof WorkspaceLocalizationPartialLoadError) {
                for (const path of error.committedPaths) {
                  changed.set(path, { kind: 'invalidated', path })
                }
              }
              lease.publish([...changed.values()])
              throw error
            }
          },
          binding.controller.signal
        )
      } catch (error) {
        return isCurrent()
          ? { status: 'failed', error, snapshot: reloadedSnapshot }
          : { status: 'stale' }
      }
    },
    [
      captureWorkspaceOperation,
      commitWorkspaceLocalizationSnapshot,
      runCoordinatedWorkspaceMutation
    ]
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
  const [moveTarget, setMoveTarget] = useState<MoveState | null>(null)
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
  const [backupImportState, setBackupImportState] = useState<BackupImportState | null>(null)
  const backupImportAbortRef = useRef<AbortController | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Process assistant (B5) + whole-library import confirmation.
  const [assistOpen, setAssistOpen] = useState(false)
  const [libraryImport, setLibraryImport] = useState<LibraryImportState | null>(null)
  const libraryImportAbortRef = useRef<AbortController | null>(null)
  const [workspaceImportReview, setWorkspaceImportReview] =
    useState<WorkspaceImportReviewState | null>(null)
  const workspaceImportAbortRef = useRef<AbortController | null>(null)
  const singleFileImportAbortRef = useRef<AbortController | null>(null)
  const singleFileRecoveryAbortRef = useRef<AbortController | null>(null)
  const [generatedLayoutReview, setGeneratedLayoutReview] =
    useState<GeneratedLayoutReviewState | null>(null)
  const generatedLayoutReviewRef = useRef<GeneratedLayoutReviewState | null>(null)
  generatedLayoutReviewRef.current = generatedLayoutReview
  const generatedLayoutReviewSequenceRef = useRef(0)
  const generatedLayoutReviewPendingRef = useRef<{
    id: number
    signal: AbortSignal
    onAbort(): void
    resolve(accepted: boolean): void
  } | null>(null)
  const directoryOpenAbortRef = useRef<Map<string, AbortController>>(new Map())
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
  workspaceMutationReleaseErrorRef.current = (error) => {
    pushToast(t('workspace.coordination.error', { error: errMsg(error) }), 'error')
  }

  const settleGeneratedLayoutReview = useCallback((id: number, accepted: boolean): void => {
    const pending = generatedLayoutReviewPendingRef.current
    if (!pending || pending.id !== id) return
    if (
      accepted &&
      (generatedLayoutReviewRef.current?.id !== id ||
        generatedLayoutReviewRef.current.renderStatus !== 'ready')
    ) {
      return
    }
    generatedLayoutReviewPendingRef.current = null
    pending.signal.removeEventListener('abort', pending.onAbort)
    setGeneratedLayoutReview((current) => (current?.id === id ? null : current))
    pending.resolve(accepted)
  }, [])

  const requestGeneratedLayoutReview = useCallback(
    (xml: string, signal: AbortSignal): Promise<boolean> => {
      if (signal.aborted) return Promise.resolve(false)
      const previous = generatedLayoutReviewPendingRef.current
      if (previous) {
        generatedLayoutReviewPendingRef.current = null
        previous.signal.removeEventListener('abort', previous.onAbort)
        previous.resolve(false)
      }
      const id = ++generatedLayoutReviewSequenceRef.current
      return new Promise<boolean>((resolve) => {
        const onAbort = (): void => settleGeneratedLayoutReview(id, false)
        generatedLayoutReviewPendingRef.current = {
          id,
          signal,
          onAbort,
          resolve
        }
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) {
          onAbort()
          return
        }
        setGeneratedLayoutReview({ id, xml, renderStatus: 'loading' })
      })
    },
    [settleGeneratedLayoutReview]
  )

  useEffect(
    () => () => {
      const pending = generatedLayoutReviewPendingRef.current
      if (!pending) return
      generatedLayoutReviewPendingRef.current = null
      pending.signal.removeEventListener('abort', pending.onAbort)
      pending.resolve(false)
    },
    []
  )

  const recordWorkspaceIssue = useCallback(
    (issue: string, binding?: WorkspaceOperationBinding): void => {
      if (
        binding &&
        (workspaceGenRef.current !== binding.generation ||
          workspaceAdapterRef.current !== binding.adapter ||
          sessionControllerRef.current !== binding.controller)
      ) {
        return
      }
      workspaceRuntimeIssuesRef.current.add(issue)
      setWorkspaceIssues((current) => (current.includes(issue) ? current : [...current, issue]))
    },
    []
  )
  useEffect(() => {
    reviewedXmlReviewMountedRef.current = true
    const queue = reviewedXmlReviewQueueRef.current!
    return () => {
      reviewedXmlReviewMountedRef.current = false
      queue.dispose()
    }
  }, [])
  const credentialMigrationToastShownRef = useRef(false)
  useEffect(() => {
    if (credentialMigration.ok || credentialMigrationToastShownRef.current) return
    credentialMigrationToastShownRef.current = true
    pushToast(
      t('settings.storageError.startup', {
        error: keyStorageErrorMessage(credentialMigration.code)
      }),
      'error'
    )
  }, [credentialMigration, pushToast])
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
      controller: DocumentSessionController,
      incarnation: number
    ): Promise<DraftRecoveryDecision | 'cancel'> => {
      const epoch = draftRecoveryEpochRef.current
      const run = async (): Promise<DraftRecoveryDecision | 'cancel'> => {
        if (
          draftRecoveryEpochRef.current !== epoch ||
          sessionControllerRef.current !== controller ||
          workspaceGenRef.current !== tab.gen ||
          controller.store.get(tab.key)?.incarnation !== incarnation
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
    const directoryOpenControllers = directoryOpenAbortRef.current
    const skipDraftTrackingOnce = skipDraftTrackingOnceRef.current
    const persistenceInteractionLocks = persistenceInteractionLocksRef.current
    const onApplicationShortcut = (event: KeyboardEvent): void => {
      const saveCombo =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 's'
      if (persistenceInteractionLockedRef.current || hasOpenModalSurface()) {
        // Keep the browser's page-save dialog suppressed while an App modal or
        // persistence transaction owns interaction, but do not route a hidden
        // editor command behind that surface.
        if (saveCombo) event.preventDefault()
        return
      }
      router.handleKeyDown(event)
    }
    window.addEventListener('keydown', onApplicationShortcut)
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
      window.removeEventListener('keydown', onApplicationShortcut)
      removeBeforeUnload()
      const drafts = draftCoordinatorRef.current
      if (drafts) {
        void drafts.flushAll().finally(() => drafts.dispose())
      }
      sessionStoreUnsubscribeRef.current?.()
      workspaceChangeUnsubscribeRef.current?.()
      if (workspaceChangeRefreshTimerRef.current !== null) {
        clearTimeout(workspaceChangeRefreshTimerRef.current)
        workspaceChangeRefreshTimerRef.current = null
      }
      workspaceCoordinatorRef.current?.close()
      workspaceActivationSequenceRef.current += 1
      workspaceActivationIntentRef.current += 1
      workspaceRefreshAbortRef.current?.abort()
      workspaceRefreshAbortRef.current = null
      workspaceProjectionRef.current = null
      workspaceLocalizationBindingRef.current?.controller.abort()
      historyRestoreAbortRef.current?.abort()
      historyRestoreAbortRef.current = null
      workspaceImportAbortRef.current?.abort()
      workspaceImportAbortRef.current = null
      libraryImportAbortRef.current?.abort()
      libraryImportAbortRef.current = null
      singleFileImportAbortRef.current?.abort()
      singleFileImportAbortRef.current = null
      singleFileRecoveryAbortRef.current?.abort()
      singleFileRecoveryAbortRef.current = null
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      translationFinalizationOperationRef.current = null
      translationReviewOpenOperationRef.current = null
      for (const controller of directoryOpenControllers.values()) controller.abort()
      directoryOpenControllers.clear()
      skipDraftTrackingOnce.clear()
      backupImportAbortRef.current?.abort()
      backupImportAbortRef.current = null
      persistenceInteractionLocks.clear()
      persistenceInteractionLockedRef.current = false
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
      workspaceRefreshAbortRef.current?.abort()
      const controller = new AbortController()
      workspaceRefreshAbortRef.current = controller
      workspaceProjectionRef.current = null
      const token = ++refreshSequenceRef.current
      try {
        const snapshot = await snapshotAdapterWorkspace(
          adapter,
          displayName || rootNameRef.current || (adapter.mode === 'opfs' ? 'OrbitPM' : 'Workspace'),
          { signal: controller.signal }
        )
        if (
          controller.signal.aborted ||
          token !== refreshSequenceRef.current ||
          workspaceAdapterRef.current !== adapter
        ) {
          return
        }
        liveWorkspaceIndexRef.current.replaceSavedFiles(snapshot.files)
        setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
        setTree(snapshot.tree)
        workspaceProjectionRef.current = {
          adapter,
          generation: workspaceGenRef.current,
          snapshot: { tree: snapshot.tree, issues: snapshot.issues }
        }
        setWorkspaceIssues([
          ...new Set([
            ...snapshot.issues.map(
              (issue) => `${issue.path ?? t('breadcrumb.root')}: ${issue.message}`
            ),
            ...workspaceRuntimeIssuesRef.current
          ])
        ])
      } catch (error) {
        if (!controller.signal.aborted) throw error
      } finally {
        if (workspaceRefreshAbortRef.current === controller) {
          workspaceRefreshAbortRef.current = null
        }
      }
    },
    []
  )

  const applyCommittedWorkspaceProjection = useCallback(
    (binding: WorkspaceOperationBinding, delta: CommittedWorkspaceProjectionDelta): boolean => {
      const current = workspaceProjectionRef.current
      if (
        !binding.adapter ||
        current?.adapter !== binding.adapter ||
        current.generation !== binding.generation ||
        workspaceAdapterRef.current !== binding.adapter ||
        workspaceGenRef.current !== binding.generation
      ) {
        workspaceProjectionRef.current = null
        return false
      }
      const next = applyCommittedWorkspaceProjectionDelta(current.snapshot, delta)
      if (!next) {
        workspaceProjectionRef.current = null
        return false
      }
      refreshSequenceRef.current += 1
      workspaceRefreshAbortRef.current?.abort()
      workspaceRefreshAbortRef.current = null
      workspaceProjectionRef.current = { ...current, snapshot: next }
      setTree(next.tree)
      setWorkspaceIssues([
        ...new Set([
          ...next.issues.map((issue) => `${issue.path ?? t('breadcrumb.root')}: ${issue.message}`),
          ...workspaceRuntimeIssuesRef.current
        ])
      ])
      return true
    },
    []
  )

  const retryManifestReconciliation = useCallback(async () => {
    const repair = manifestRepair
    const binding = captureWorkspaceOperation()
    if (
      !repair ||
      binding.adapter !== repair.adapter ||
      binding.generation !== repair.generation ||
      !isWorkspaceOperationCurrent(binding)
    ) {
      setManifestRepair(null)
      return
    }
    try {
      await runCoordinatedWorkspaceMutation(binding, async (lease) => {
        await repair.adapter.reconcileManifest()
        lease.publish([{ kind: 'saved', path: '.orbitpm/manifest.json' }])
      })
      if (
        workspaceAdapterRef.current === repair.adapter &&
        workspaceGenRef.current === repair.generation
      ) {
        setManifestRepair(null)
        pushToast(t('workspace.manifest.repaired'), 'success')
      }
    } catch (error) {
      if (
        workspaceAdapterRef.current === repair.adapter &&
        workspaceGenRef.current === repair.generation
      ) {
        setManifestRepair({ ...repair, error })
        pushToast(t('workspace.manifest.retryFailed', { error: errMsg(error) }), 'error')
      }
    }
  }, [
    captureWorkspaceOperation,
    isWorkspaceOperationCurrent,
    manifestRepair,
    pushToast,
    runCoordinatedWorkspaceMutation
  ])

  const retryPathRecoveryCleanup = useCallback(async () => {
    const recovery = pathRecovery
    const binding = captureWorkspaceOperation()
    if (
      !recovery ||
      binding.adapter !== recovery.adapter ||
      binding.generation !== recovery.generation ||
      !isWorkspaceOperationCurrent(binding)
    ) {
      setPathRecovery(null)
      return
    }
    try {
      await runCoordinatedWorkspaceMutation(binding, async (lease) => {
        if (
          workspaceAdapterRef.current !== recovery.adapter ||
          workspaceGenRef.current !== recovery.generation
        ) {
          throw new Error(t('workspace.create.stale'))
        }
        await recovery.retry()
        lease.publish([
          { kind: 'invalidated', path: recovery.stagingPath },
          { kind: 'invalidated', path: recovery.payloadPath }
        ])
      })
      if (
        workspaceAdapterRef.current !== recovery.adapter ||
        workspaceGenRef.current !== recovery.generation
      ) {
        return
      }
      setPathRecovery(null)
      pushToast(t('workspace.path.recoverySuccess'), 'success')
    } catch (error) {
      if (
        workspaceAdapterRef.current === recovery.adapter &&
        workspaceGenRef.current === recovery.generation
      ) {
        setPathRecovery({ ...recovery, error })
        pushToast(t('workspace.path.recoveryFailed', { error: errMsg(error) }), 'error')
      }
    }
  }, [
    captureWorkspaceOperation,
    isWorkspaceOperationCurrent,
    pathRecovery,
    pushToast,
    runCoordinatedWorkspaceMutation
  ])

  const beginWorkspaceActivationIntent = useCallback((): number => {
    const intent = ++workspaceActivationIntentRef.current
    historyRestoreAbortRef.current?.abort()
    historyRestoreAbortRef.current = null
    singleFileImportAbortRef.current?.abort()
    singleFileImportAbortRef.current = null
    singleFileRecoveryAbortRef.current?.abort()
    singleFileRecoveryAbortRef.current = null
    workspaceImportAbortRef.current?.abort()
    workspaceImportAbortRef.current = null
    libraryImportAbortRef.current?.abort()
    libraryImportAbortRef.current = null
    for (const controller of directoryOpenAbortRef.current.values()) controller.abort()
    directoryOpenAbortRef.current.clear()
    backupImportAbortRef.current?.abort()
    backupImportAbortRef.current = null
    if (workspaceChangeRefreshTimerRef.current !== null) {
      clearTimeout(workspaceChangeRefreshTimerRef.current)
      workspaceChangeRefreshTimerRef.current = null
    }
    persistenceInteractionLocksRef.current.clear()
    persistenceInteractionLockedRef.current = false
    setWorkspaceImportReview(null)
    setBackupImportState(null)
    setDirtyTabClosePrompt(null)
    // These dialogs use singleton resolvers. Superseding a workspace request
    // must settle an older decision before the newer request can install one.
    switchResolveRef.current?.('cancel')
    switchResolveRef.current = null
    setSwitchGuard(null)
    pathDirtyResolveRef.current?.('cancel')
    pathDirtyResolveRef.current = null
    setPathDirtyPrompt(null)
    downloadSwitchResolveRef.current?.('cancel')
    downloadSwitchResolveRef.current = null
    setDownloadSwitchGuard(null)
    return intent
  }, [])

  const isWorkspaceActivationIntentCurrent = useCallback(
    (intent: number): boolean => workspaceActivationIntentRef.current === intent,
    []
  )

  const activateWorkspace = useCallback(
    async (
      adapter: WorkspaceAdapter,
      handle: FileSystemDirectoryHandle | null,
      displayName: string,
      claimedIntent?: number
    ) => {
      const activationIntent = claimedIntent ?? beginWorkspaceActivationIntent()
      if (!isWorkspaceActivationIntentCurrent(activationIntent)) return
      historyRestoreAbortRef.current?.abort()
      historyRestoreAbortRef.current = null
      reviewedXmlReviewQueueRef.current?.cancelAll()
      const activationSequence = ++workspaceActivationSequenceRef.current
      const activationIsCurrent = (): boolean =>
        isWorkspaceActivationIntentCurrent(activationIntent) &&
        workspaceActivationSequenceRef.current === activationSequence
      let activeAdapter = adapter
      let manifestAdapter: ManifestBoundWorkspaceAdapter | null = null
      let manifestGeneration: number | null = null
      let manifestBindingCommitted = false
      const pendingManifestWarnings: WorkspaceManifestWarning[] = []
      const pendingManifestErrors: unknown[] = []
      const manifestBindingIsCurrent = (): boolean =>
        manifestBindingCommitted &&
        manifestAdapter !== null &&
        manifestGeneration !== null &&
        workspaceAdapterRef.current === manifestAdapter &&
        workspaceGenRef.current === manifestGeneration
      const surfaceManifestWarning = (warning: WorkspaceManifestWarning): void => {
        pushToast(
          t('workspace.manifest.warning', {
            path: warning.path,
            error: warning.message
          }),
          'error'
        )
      }
      const surfaceManifestError = (error: unknown): void => {
        if (!manifestAdapter || manifestGeneration === null) return
        setManifestRepair({
          adapter: manifestAdapter,
          error,
          generation: manifestGeneration
        })
        pushToast(t('workspace.manifest.postCommitError', { error: errMsg(error) }), 'error')
      }
      if (adapter.storage.capabilities.multipleFiles && adapter.storage.capabilities.directories) {
        const bound = await bindWorkspaceToManifest(adapter, {
          onManifestWarning: (warning: WorkspaceManifestWarning) => {
            if (!manifestBindingCommitted) {
              if (activationIsCurrent()) {
                pendingManifestWarnings.push(warning)
              }
              return
            }
            if (!manifestBindingIsCurrent()) return
            surfaceManifestWarning(warning)
          },
          onManifestError: (error) => {
            if (!manifestBindingCommitted) {
              if (activationIsCurrent()) {
                pendingManifestErrors.push(error)
              }
              return
            }
            if (!manifestBindingIsCurrent()) return
            surfaceManifestError(error)
          }
        })
        if (!activationIsCurrent()) return
        manifestAdapter = bound.adapter
        activeAdapter = bound.adapter
      }
      let coordination: BroadcastWorkspaceCoordinator | undefined
      if (activeAdapter.storage.capabilities.multipleFiles) {
        try {
          coordination = new BroadcastWorkspaceCoordinator({
            workspaceId: activeAdapter.id,
            instanceId: pageInstanceIdRef.current!
          })
        } catch (error) {
          pushToast(t('workspace.coordination.error', { error: errMsg(error) }), 'error')
        }
      }
      const candidateWorkspaceIdentity: WorkspaceIdentity = {
        id: activeAdapter.id,
        generation: workspaceGenRef.current + 1,
        mode: activeAdapter.mode
      }
      let localizationCandidate: {
        controller: AbortController
        error: string | null
        errorCode: LocalizationResourcesFailureCode | null
        snapshot: WorkspaceLocalizationState | null
        store: WorkspaceLocalizationStore
      } | null = null
      if (
        activeAdapter.storage.capabilities.multipleFiles &&
        activeAdapter.storage.capabilities.directories
      ) {
        const controller = new AbortController()
        const store = createWorkspaceLocalizationStore(activeAdapter)
        localizationCandidate = {
          controller,
          error: null,
          errorCode: null,
          snapshot: null,
          store
        }
        try {
          localizationCandidate.snapshot = await runWorkspaceMutation(
            {
              coordination,
              workspace: candidateWorkspaceIdentity,
              signal: controller.signal,
              isCurrent: activationIsCurrent
            },
            async (lease) => {
              try {
                const snapshot = await store.load({ signal: controller.signal })
                lease.publish([
                  {
                    kind: 'saved',
                    path: WORKSPACE_GLOSSARY_PATH,
                    fingerprint: {
                      hash: snapshot.files.glossary.hash,
                      size: snapshot.files.glossary.size,
                      modifiedAt: snapshot.files.glossary.modifiedAt
                    }
                  },
                  {
                    kind: 'saved',
                    path: WORKSPACE_TRANSLATION_MEMORY_PATH,
                    fingerprint: {
                      hash: snapshot.files.translationMemory.hash,
                      size: snapshot.files.translationMemory.size,
                      modifiedAt: snapshot.files.translationMemory.modifiedAt
                    }
                  }
                ])
                return snapshot
              } catch (error) {
                if (error instanceof WorkspaceLocalizationPartialLoadError) {
                  lease.publish(
                    error.committedPaths.map((path) => ({
                      kind: 'invalidated',
                      path
                    }))
                  )
                }
                throw error
              }
            }
          )
        } catch (error) {
          if (controller.signal.aborted || !activationIsCurrent()) {
            controller.abort()
            coordination?.close()
            return
          }
          localizationCandidate.error = errMsg(error)
          localizationCandidate.errorCode = localizationFailureCode(error)
          pushToast(localizationCandidate.error, 'error')
        }
        if (!activationIsCurrent()) {
          localizationCandidate.controller.abort()
          coordination?.close()
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
          localizationCandidate?.controller.abort()
          coordination?.close()
          throw error
        }
        if (!activationIsCurrent()) {
          localizationCandidate?.controller.abort()
          coordination?.close()
          return
        }
        previousDrafts.dispose()
      }
      if (!activationIsCurrent()) {
        localizationCandidate?.controller.abort()
        coordination?.close()
        return
      }
      sessionStoreUnsubscribeRef.current?.()
      sessionStoreUnsubscribeRef.current = null
      workspaceChangeUnsubscribeRef.current?.()
      workspaceChangeUnsubscribeRef.current = null
      if (workspaceChangeRefreshTimerRef.current !== null) {
        clearTimeout(workspaceChangeRefreshTimerRef.current)
        workspaceChangeRefreshTimerRef.current = null
      }
      workspaceCoordinatorRef.current?.close()
      workspaceCoordinatorRef.current = coordination ?? null
      sessionControllerRef.current = null
      draftCoordinatorRef.current = null

      // New session: bump the generation (invalidates every stale tab's save)
      // and update the sync handle mirror BEFORE any async scan can commit.
      workspaceGenRef.current += 1
      const workspaceGeneration = workspaceGenRef.current
      manifestGeneration = workspaceGeneration
      refreshSequenceRef.current += 1
      workspaceRefreshAbortRef.current?.abort()
      workspaceRefreshAbortRef.current = null
      workspaceProjectionRef.current = null
      workspaceLocalizationBindingRef.current?.controller.abort()
      workspaceAdapterRef.current = activeAdapter
      workspaceLocalizationSnapshotRef.current = null
      setWorkspaceLocalizationSnapshot(null)
      setWorkspaceLocalizationError(localizationCandidate?.error ?? null)
      setWorkspaceLocalizationErrorCode(localizationCandidate?.errorCode ?? null)
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

      const controller = new DocumentSessionController({
        persistence: sessionPersistenceWithHistory(activeAdapter, workspaceIdentity, history),
        coordination,
        requireCoordination: activeAdapter.storage.capabilities.multipleFiles,
        isWorkspaceCurrent: (identity) =>
          workspaceIdentityRef.current !== null &&
          identity.workspace.id === workspaceIdentityRef.current.id &&
          identity.workspace.generation === workspaceIdentityRef.current.generation &&
          workspaceAdapterRef.current === activeAdapter,
        prepareExternal: async (external, context) => {
          const resources = workspaceLocalizationSnapshotRef.current?.resources
          const isCurrent = (): boolean =>
            !context.signal?.aborted &&
            sessionControllerRef.current === controller &&
            controller.store.get(context.session.id)?.incarnation === context.session.incarnation &&
            workspaceAdapterRef.current === activeAdapter &&
            workspaceGenRef.current === workspaceGeneration
          if (!resources || !isCurrent()) return { status: 'cancelled' }
          const outcome = await reviewBpmnXmlLocalization(external.xml, {
            source: LocalizationSource.Xml,
            target: langRef.current,
            defaultActive: langRef.current,
            resources,
            validation: {
              adapters: getRuntimeValidationAdapters(),
              knownProcessIds: liveWorkspaceIndexRef.current.processIndex().keys(),
              requireDi: true
            },
            validationAction: 'apply-editor',
            review: reviewedXmlReviewQueueRef.current!.review,
            signal: context.signal,
            isCurrent
          })
          return outcome.status === 'completed' && isCurrent()
            ? { status: 'completed', xml: outcome.xml }
            : { status: 'cancelled' }
        },
        onConfirmedSave: (session) =>
          drafts.confirmedSave(session.id, session.incarnation, session.lastSavedXml),
        onExplicitDiscard: (session) => drafts.explicitDiscard(session.id, session.incarnation),
        onPreparedExternal: async (session) => {
          drafts.track(session)
          await drafts.flush(session.id, session.incarnation)
        },
        onPostSaveError: (error) =>
          pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
      })
      sessionControllerRef.current = controller
      sessionStoreUnsubscribeRef.current = controller.store.subscribe(() => {
        for (const session of controller.store.list()) {
          const token = `${session.id}\u0000${session.incarnation}`
          if (skipDraftTrackingOnceRef.current.delete(token)) continue
          drafts.track(session)
        }
      })
      if (coordination) {
        workspaceChangeUnsubscribeRef.current = coordination.subscribeChanges((change) => {
          if (workspaceAdapterRef.current !== activeAdapter) return
          const openSession = controller.store
            .list()
            .find(
              (session) =>
                session.identity.path === change.path ||
                (change.previousPath !== undefined && session.identity.path === change.previousPath)
            )
          if (openSession?.dirty) {
            pushToast(t('workspace.coordination.changed', { path: change.path }), 'error')
          }
          if (
            !activeAdapter.storage.capabilities.multipleFiles ||
            workspaceChangeRefreshTimerRef.current !== null
          ) {
            return
          }
          workspaceChangeRefreshTimerRef.current = setTimeout(() => {
            workspaceChangeRefreshTimerRef.current = null
            if (
              workspaceCoordinatorRef.current !== coordination ||
              workspaceAdapterRef.current !== activeAdapter ||
              workspaceGenRef.current !== workspaceGeneration
            ) {
              return
            }
            void refreshWorkspace(handle ?? undefined, displayName)
          }, 50)
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
      translationFinalizationOperationRef.current = null
      translationReviewOpenOperationRef.current = null
      liveWorkspaceIndexRef.current = new LiveWorkspaceIndex()
      setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
      setTree(null)
      workspaceRuntimeIssuesRef.current.clear()
      setWorkspaceIssues([])
      skipDraftTrackingOnceRef.current.clear()
      setDirtyTabClosePrompt(null)
      setTabs([])
      setActiveKey(null)
      setContents({})
      forcedUndurableDirtyByKeyRef.current.clear()
      dirtyByKeyRef.current = {}
      setDirtyByKey({})
      baseHashByPathRef.current = {}
      for (const timer of Object.values(liveXmlTimersRef.current)) clearTimeout(timer)
      liveXmlTimersRef.current = {}
      liveXmlCaptureEpochByKeyRef.current = {}
      duplicateRepairTokenByPathRef.current.clear()
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
      setTranslationFinalizingTab(null)
      setInterviewRequest(null)
      interviewApplyTokenByTabRef.current.clear()
      setAssistOpen(false)
      digestsCacheRef.current = null
      setLibraryImport(null)
      workspaceImportAbortRef.current?.abort()
      workspaceImportAbortRef.current = null
      setWorkspaceImportReview(null)
      backupImportAbortRef.current?.abort()
      backupImportAbortRef.current = null
      setBackupImportState(null)
      setBackupBusy(false)
      setHistoryOpen(false)
      setPrintJob(null)
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
      setExplorerOpen(true)
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
      if (manifestAdapter) {
        manifestBindingCommitted = true
        if (manifestBindingIsCurrent()) {
          for (const warning of pendingManifestWarnings) surfaceManifestWarning(warning)
          for (const error of pendingManifestErrors) surfaceManifestError(error)
        }
      }
      if (activeAdapter.mode === 'directory' && handle) {
        try {
          await rememberWorkspaceMutexRef.current.runExclusive(() => rememberWorkspace(handle))
          if (
            !activationIsCurrent() ||
            workspaceAdapterRef.current !== activeAdapter ||
            workspaceGenRef.current !== workspaceGeneration
          ) {
            return
          }
          rememberedRef.current = handle
          setRememberedName(handle.name)
        } catch {
          /* IDB may be unavailable; non-fatal */
        }
      }
      if (
        !activationIsCurrent() ||
        workspaceAdapterRef.current !== activeAdapter ||
        workspaceGenRef.current !== workspaceGeneration
      ) {
        return
      }
      if (activeAdapter.storage.capabilities.multipleFiles) {
        await refreshWorkspace(handle ?? undefined, displayName)
      }
    },
    [
      beginWorkspaceActivationIntent,
      cancelPendingDraftRecovery,
      isWorkspaceActivationIntentCurrent,
      refreshWorkspace,
      pushToast,
      resolveSaveConflictPrompt,
      setExplorerOpen,
      setTranslationReview
    ]
  )

  // First-load: fallback landing, remembered-folder reconnect, or fresh open.
  useEffect(() => {
    // Callback identities can legitimately change as responsive shell state
    // reconciles. Startup is nevertheless a loading-phase operation only:
    // never re-run it across breakpoints after a live workspace is active.
    if (phase !== 'loading') return
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
  }, [phase, support, browserWorkspaceAvailable, activateWorkspace])

  // Manual "Refresh" (tree header): re-scan the folder for changes made outside
  // the app. The refresh guard makes concurrent/stale scans safe (Codex M7/M8).
  const handleManualRefresh = useCallback(async () => {
    const h = rootHandleRef.current
    if (!h) return
    await refreshWorkspace(h)
    pushToast(t('toast.refreshed'), 'info')
    const binding = workspaceLocalizationBindingRef.current
    if (binding) {
      try {
        const next = await loadWorkspaceLocalizationCoordinated(binding)
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
        setWorkspaceLocalizationErrorCode(localizationFailureCode(error))
        pushToast(message, 'error')
        return
      }
    }
  }, [
    commitWorkspaceLocalizationSnapshot,
    loadWorkspaceLocalizationCoordinated,
    refreshWorkspace,
    pushToast
  ])

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
    const controller = sessionControllerRef.current
    const { writable, downloadable } = partitionDirtyTabs(tabs, (tab) =>
      Boolean(dirtyByKey[tab.key] || controller?.store.get(tab.key)?.dirty)
    )
    const dirtySessionWithoutTab = controller?.store
      .list()
      .find((session) => session.dirty && !tabs.some((tab) => tab.key === session.id))
    if (dirtySessionWithoutTab) {
      throw new Error(`Dirty session "${dirtySessionWithoutTab.title}" has no open tab.`)
    }
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
    const controller = sessionControllerRef.current
    const dirtyIds = new Set<string>()
    for (const tab of tabs) {
      if (dirtyByKey[tab.key] || controller?.store.get(tab.key)?.dirty) dirtyIds.add(tab.key)
    }
    for (const session of controller?.store.list() ?? []) {
      if (session.dirty) dirtyIds.add(session.id)
    }
    if (dirtyIds.size === 0) return true
    const capturedDirtySessions = [...dirtyIds]
      .map((sessionId) => controller?.store.get(sessionId))
      .filter((session) => session !== undefined)
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
      switchResolveRef.current = resolve
      setSwitchGuard({ count: dirtyIds.size })
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
            capturedDirtySessions.map((session) =>
              drafts.explicitDiscard(session.id, session.incarnation)
            )
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
    const intent = beginWorkspaceActivationIntent()
    setPickBusy(true)
    setPickError(null)
    try {
      const handle = await pickWorkspace()
      if (!handle || !isWorkspaceActivationIntentCurrent(intent)) return
      const state = await ensurePermission(handle, true)
      if (!isWorkspaceActivationIntentCurrent(intent)) return
      if (state !== 'granted') {
        setPickError(t('alert.permissionNotGranted.open'))
        return
      }
      // Prompt for unsaved work BEFORE we reset state onto the new folder.
      const proceed = await guardWorkspaceSwitch()
      if (!proceed || !isWorkspaceActivationIntentCurrent(intent)) return
      await activateWorkspace(
        new DirectoryWorkspaceAdapter(handle, {
          workspaceId: directoryWorkspaceId(handle)
        }),
        handle,
        handle.name,
        intent
      )
    } catch (err) {
      if (!isWorkspaceActivationIntentCurrent(intent)) return
      const code = classifyPickerError(err)
      if (code !== 'aborted') {
        const message = t(pickerErrorKey(code))
        setPickError(message)
        if (workspaceAdapterRef.current) pushToast(message, 'error')
      }
    } finally {
      if (isWorkspaceActivationIntentCurrent(intent)) setPickBusy(false)
    }
  }, [
    activateWorkspace,
    beginWorkspaceActivationIntent,
    guardWorkspaceSwitch,
    isWorkspaceActivationIntentCurrent,
    pushToast
  ])

  const handleReconnect = useCallback(async () => {
    const intent = beginWorkspaceActivationIntent()
    const handle = rememberedRef.current
    if (!handle) {
      setPhase('need-open')
      return
    }
    setPickBusy(true)
    setPickError(null)
    try {
      const state = await ensurePermission(handle, true)
      if (!isWorkspaceActivationIntentCurrent(intent)) return
      if (state !== 'granted') {
        setPickError(t('alert.permissionNotGranted.reconnect'))
        return
      }
      await activateWorkspace(
        new DirectoryWorkspaceAdapter(handle, {
          workspaceId: directoryWorkspaceId(handle)
        }),
        handle,
        handle.name,
        intent
      )
    } catch (err) {
      if (!isWorkspaceActivationIntentCurrent(intent)) return
      const code = classifyPickerError(err)
      if (code !== 'aborted') {
        const message = t(pickerErrorKey(code))
        setPickError(message)
        if (workspaceAdapterRef.current) pushToast(message, 'error')
      }
    } finally {
      if (isWorkspaceActivationIntentCurrent(intent)) setPickBusy(false)
    }
  }, [
    activateWorkspace,
    beginWorkspaceActivationIntent,
    isWorkspaceActivationIntentCurrent,
    pushToast
  ])

  const handleOpenDifferent = useCallback(async () => {
    await handleOpenFolder()
  }, [handleOpenFolder])

  const handleOpenOpfs = useCallback(async () => {
    const intent = beginWorkspaceActivationIntent()
    const binding = captureWorkspaceOperation()
    setPickBusy(true)
    setPickError(null)
    try {
      const adapter = await OpfsWorkspaceAdapter.open({
        workspaceId: workspaceInstanceId('opfs', 'orbitpm'),
        directoryName: 'orbitpm',
        requestPersistence: true
      })
      if (!isWorkspaceActivationIntentCurrent(intent)) return
      const proceed = await guardWorkspaceSwitch()
      if (!proceed || !isWorkspaceActivationIntentCurrent(intent)) return
      await activateWorkspace(
        adapter,
        adapter.directoryHandle,
        t('workspace.storage.mode.opfs'),
        intent
      )
    } catch (error) {
      if (!isWorkspaceActivationIntentCurrent(intent)) return
      const message = t('workspace.storage.opfsOpenFailed')
      setPickError(message)
      if (workspaceAdapterRef.current) {
        recordWorkspaceIssue(
          t('workspace.storage.opfsOpenTechnicalEvidence', {
            error: errMsg(error)
          }),
          binding
        )
        pushToast(message, 'error')
      }
    } finally {
      if (isWorkspaceActivationIntentCurrent(intent)) setPickBusy(false)
    }
  }, [
    activateWorkspace,
    beginWorkspaceActivationIntent,
    captureWorkspaceOperation,
    guardWorkspaceSwitch,
    isWorkspaceActivationIntentCurrent,
    pushToast,
    recordWorkspaceIssue
  ])

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
    async (
      tab: Tab,
      loadedXml: string,
      loadedBase: FileFingerprint | null,
      context?: {
        signal?: AbortSignal
        isCurrent?: () => boolean
        resources?: LocalizationResources
        reviewedXml?: string
      }
    ): Promise<string> => {
      const run = async (): Promise<string> => {
        const controller = sessionControllerRef.current
        const journal = draftJournalRef.current
        const drafts = draftCoordinatorRef.current
        const session = controller?.store.get(tab.key)
        if (!controller || !journal || !drafts || !session) return loadedXml
        const incarnation = session.incarnation
        const reviewedDiskXml = context?.reviewedXml ?? loadedXml
        const isCurrentSession = (): boolean =>
          !context?.signal?.aborted &&
          (context?.isCurrent?.() ?? true) &&
          sessionControllerRef.current === controller &&
          workspaceGenRef.current === tab.gen &&
          controller.store.get(session.id)?.incarnation === incarnation
        const currentVisibleXml = (): string =>
          controller.store.get(session.id)?.currentXml ?? loadedXml
        const applyVisibleXml = (xml: string, preserveExistingDraft: boolean): string => {
          if (!isCurrentSession()) return currentVisibleXml()
          const current = controller.store.get(session.id)
          if (!current || current.currentXml === xml) return current?.currentXml ?? loadedXml
          if (preserveExistingDraft) {
            skipDraftTrackingOnceRef.current.add(`${session.id}\u0000${incarnation}`)
          }
          const updated = controller.updateXml(session.id, xml)
          setDirtyByKey((previous) => ({ ...previous, [tab.key]: updated.dirty }))
          if (updated.dirty) {
            const latestSession = sessionControllerRef.current?.store.get(tab.key)
            if (latestSession?.dirty || forcedUndurableDirtyByKeyRef.current.has(tab.key)) {
              liveWorkspaceIndexRef.current.updateDirty(liveIndexPath(tab), xml)
            } else {
              liveWorkspaceIndexRef.current.clearDirty(liveIndexPath(tab))
            }
          } else if (tab.relPath) {
            liveWorkspaceIndexRef.current.clearDirty(tab.relPath)
          }
          setLiveWorkspaceVersion(liveWorkspaceIndexRef.current.version)
          return updated.currentXml
        }
        let comparison: DraftRecoveryComparison | null = null
        try {
          comparison = await findDraftRecoveryComparison(
            journal,
            {
              workspaceId: session.identity.workspace.id,
              path: session.identity.path,
              sessionId: session.id
            },
            loadedXml,
            loadedBase?.hash ?? null
          )
          if (!isCurrentSession()) return currentVisibleXml()
          if (!comparison) return applyVisibleXml(reviewedDiskXml, false)
          if (comparison.relation === 'same-content') {
            // The durable file itself proves this journal record is obsolete.
            await drafts.explicitDiscard(session.id, incarnation)
            return applyVisibleXml(reviewedDiskXml, false)
          }
          controller.store.setDraftRecovery(session.id, {
            status: 'available',
            draftId: comparison.draft.id,
            timestamp: comparison.draft.timestamp,
            baseHash: comparison.draft.baseHash
          })
          const decision = await promptForDraftRecovery(tab, comparison, controller, incarnation)
          if (!isCurrentSession()) return currentVisibleXml()
          if (decision === 'cancel') {
            return applyVisibleXml(reviewedDiskXml, true)
          }
          if (decision === 'discard') {
            await drafts.explicitDiscard(session.id, incarnation)
            if (!isCurrentSession()) return currentVisibleXml()
            controller.store.setDraftRecovery(session.id, {
              status: 'dismissed',
              draftId: comparison.draft.id,
              timestamp: comparison.draft.timestamp
            })
            return applyVisibleXml(reviewedDiskXml, false)
          }
          const reviewedDraft = await reviewBpmnXmlLocalization(comparison.draft.xml, {
            source: LocalizationSource.Editor,
            target: langRef.current,
            defaultActive: langRef.current,
            resources:
              context?.resources ??
              workspaceLocalizationSnapshotRef.current?.resources ??
              DEFAULT_LOCALIZATION_RESOURCES,
            validation: {
              adapters: getRuntimeValidationAdapters(),
              knownProcessIds: liveWorkspaceIndexRef.current.processIndex().keys(),
              requireDi: true
            },
            validationAction: 'apply-editor',
            review: reviewedXmlReviewQueueRef.current!.review,
            signal: context?.signal,
            isCurrent: isCurrentSession
          })
          if (reviewedDraft.status !== 'completed' || !isCurrentSession()) {
            return applyVisibleXml(reviewedDiskXml, true)
          }
          const restoredXml = applyVisibleXml(reviewedDraft.xml, false)
          controller.store.setDraftRecovery(session.id, {
            status: 'restored',
            draftId: comparison.draft.id,
            timestamp: comparison.draft.timestamp
          })
          localizationSourceByTabRef.current.set(tab.key, LocalizationSource.Editor)
          drafts.track(controller.store.get(session.id)!)
          return restoredXml
        } catch (error) {
          if (!isCurrentSession()) return currentVisibleXml()
          controller.store.setDraftRecovery(session.id, {
            status: 'error',
            message: errMsg(error)
          })
          pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
          return applyVisibleXml(reviewedDiskXml, comparison !== null)
        }
      }
      const queued = draftRecoveryFlowQueueRef.current.catch(() => undefined).then(run)
      draftRecoveryFlowQueueRef.current = queued.then(
        () => undefined,
        () => undefined
      )
      return queued
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
      const binding = captureWorkspaceOperation()
      const workspace = binding.identity
      const existingSession =
        workspace && binding.controller
          ? binding.controller.store.getByIdentity({ workspace, path: relPath })
          : undefined
      const key = existingSession?.id ?? relPath
      const tab: Tab = {
        key,
        title: baseName(relPath),
        relPath,
        gen: binding.generation
      }
      const activateReviewedTab = (): void => {
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
        if (opts?.collapse !== false) setExplorerOpen(false)
        setCatalogOpen(false)
        setTabs((previous) =>
          previous.some((candidate) => candidate.key === key) ? previous : [...previous, tab]
        )
        setActiveKey(key)
      }
      if (existingSession || contents[key] !== undefined) {
        activateReviewedTab()
        if (existingSession) {
          binding.controller?.setActive(existingSession.id)
          if (contents[key] === undefined) {
            setContents((previous) => ({ ...previous, [key]: existingSession.currentXml }))
          }
        }
        return
      }
      const adapter = binding.adapter
      const resources = workspaceLocalizationSnapshotRef.current?.resources
      if (
        !adapter ||
        !binding.controller ||
        !workspace ||
        !resources ||
        !isWorkspaceOperationCurrent(binding)
      ) {
        if (adapter && !resources && isWorkspaceOperationCurrent(binding)) {
          pushToast(
            t('settings.localization.loadFailed', {
              error: workspaceLocalizationError ?? t('workspace.history.unknownError')
            }),
            'error'
          )
        }
        return
      }
      const openKey = normalizeWorkspacePath(relPath).toLocaleLowerCase('en-US')
      directoryOpenAbortRef.current.get(openKey)?.abort()
      const openController = new AbortController()
      directoryOpenAbortRef.current.set(openKey, openController)
      const isCurrent = (): boolean =>
        !openController.signal.aborted &&
        directoryOpenAbortRef.current.get(openKey) === openController &&
        isWorkspaceOperationCurrent(binding)
      try {
        const snapshot = await adapter.read(relPath)
        if (!isCurrent()) return
        baseHashByPathRef.current[relPath] = snapshot.hash
        const loadedXml = decodeUtf8Strict(snapshot.bytes, {
          operation: 'read',
          path: relPath
        })
        const reviewed = await reviewBpmnXmlLocalization(loadedXml, {
          source: opts?.localizationSource ?? LocalizationSource.Xml,
          target: langRef.current,
          defaultActive: langRef.current,
          resources,
          validation: {
            adapters: getRuntimeValidationAdapters(),
            knownProcessIds: binding.index.processIndex().keys(),
            requireDi: true
          },
          validationAction: 'apply-editor',
          review: reviewedXmlReviewQueueRef.current!.review,
          signal: openController.signal,
          isCurrent
        })
        if (!isCurrent() || reviewed.status !== 'completed') return
        const opened = ensureDocumentSession(tab, loadedXml, {
          lastSavedXml: loadedXml,
          base: fingerprintFromSnapshot(snapshot)
        })
        if (!opened || !isCurrent()) return
        activateReviewedTab()
        const visibleXml = await reviewRecoveryDraft(
          tab,
          loadedXml,
          fingerprintFromSnapshot(snapshot),
          {
            signal: openController.signal,
            isCurrent,
            resources,
            reviewedXml: reviewed.xml
          }
        )
        if (!isCurrent()) return
        const visibleSession = binding.controller.store.get(opened.id)
        setDirtyByKey((previous) => ({
          ...previous,
          [key]: visibleSession?.dirty ?? visibleXml !== loadedXml
        }))
        if (visibleSession?.dirty ?? visibleXml !== loadedXml) {
          binding.index.updateDirty(relPath, visibleXml)
          setLiveWorkspaceVersion(binding.index.version)
        }
        setContents((previous) => ({ ...previous, [key]: visibleXml }))
      } catch (error) {
        if (isCurrent()) {
          pushToast(t('alert.openFileFailed', { relPath, error: errMsg(error) }), 'error')
        }
      } finally {
        if (directoryOpenAbortRef.current.get(openKey) === openController) {
          directoryOpenAbortRef.current.delete(openKey)
        }
        openController.abort()
      }
    },
    [
      captureWorkspaceOperation,
      contents,
      ensureDocumentSession,
      isWorkspaceOperationCurrent,
      pushToast,
      reviewRecoveryDraft,
      setExplorerOpen,
      workspaceLocalizationError
    ]
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
      if (opts?.collapse !== false) setExplorerOpen(false)
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
    [ensureDocumentSession, setExplorerOpen]
  )

  const activateSingleFileDocument = useCallback(
    async (
      title: string,
      xml: string,
      source: LocalizationSourceType,
      options?: {
        claimedIntent?: number
        durableXml?: string
        initiallyDirty?: boolean
        signal?: AbortSignal
      }
    ): Promise<void> => {
      const activationIntent = options?.claimedIntent ?? beginWorkspaceActivationIntent()
      if (!isWorkspaceActivationIntentCurrent(activationIntent)) return
      const path = title.toLocaleLowerCase('en-US').endsWith('.bpmn') ? title : `${title}.bpmn`
      const durableXml = options?.durableXml ?? xml
      const adapter = new SingleFileWorkspaceAdapter({
        workspaceId: workspaceInstanceId('single-file', path),
        path,
        bytes: new TextEncoder().encode(durableXml),
        modifiedAt: Date.now(),
        mimeType: 'application/xml'
      })
      await activateWorkspace(adapter, null, path, activationIntent)
      if (
        !isWorkspaceActivationIntentCurrent(activationIntent) ||
        workspaceAdapterRef.current !== adapter
      ) {
        return
      }
      const binding = captureWorkspaceOperation()
      if (binding.adapter !== adapter || binding.identity?.generation !== binding.generation) {
        return
      }
      singleFileRecoveryAbortRef.current?.abort()
      const recoveryController = new AbortController()
      singleFileRecoveryAbortRef.current = recoveryController
      const abortRecovery = (): void => recoveryController.abort()
      if (options?.signal?.aborted) recoveryController.abort()
      else options?.signal?.addEventListener('abort', abortRecovery, { once: true })
      const isCurrent = (): boolean =>
        !recoveryController.signal.aborted &&
        singleFileRecoveryAbortRef.current === recoveryController &&
        isWorkspaceActivationIntentCurrent(activationIntent) &&
        isWorkspaceOperationCurrent(binding)
      try {
        const snapshot = await adapter.read(path)
        if (!isCurrent()) return
        const fingerprint = fingerprintFromSnapshot(snapshot)
        const saved = fileMetaFromSnapshot(snapshot)
        baseHashByPathRef.current[path] = snapshot.hash
        binding.index.updateSaved(saved)
        setLiveWorkspaceVersion(binding.index.version)
        const tab: Tab = {
          key: path,
          title: path,
          relPath: path,
          gen: binding.generation
        }
        const opened = ensureDocumentSession(tab, durableXml, {
          lastSavedXml: durableXml,
          base: fingerprint
        })
        if (!opened || !isCurrent()) return
        localizationSourceByTabRef.current.set(path, source)
        const visibleXml = await reviewRecoveryDraft(tab, durableXml, fingerprint, {
          signal: recoveryController.signal,
          isCurrent,
          resources: DEFAULT_LOCALIZATION_RESOURCES,
          reviewedXml: xml
        })
        if (!isCurrent()) {
          binding.controller?.store.close(opened.id)
          await binding.drafts?.untrack(opened.id, opened.incarnation)
          return
        }
        let visibleSession = binding.controller?.store.get(opened.id)
        const retainedPriorDraft =
          visibleSession?.draftRecovery.status === 'available' ||
          visibleSession?.draftRecovery.status === 'error'
        if (options?.initiallyDirty && visibleSession && !visibleSession.dirty) {
          if (!retainedPriorDraft) {
            visibleSession = binding.controller!.store.replaceWithExternal(visibleSession.id, {
              xml: '',
              reviewedXml: visibleXml,
              fingerprint
            })
            binding.drafts?.track(visibleSession)
            try {
              await binding.drafts?.flush(visibleSession.id, visibleSession.incarnation)
            } catch (error) {
              if (isCurrent()) {
                pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
              }
            }
            if (!isCurrent()) return
          }
        }
        const visibleDirty = Boolean(visibleSession?.dirty || options?.initiallyDirty)
        if (visibleDirty) {
          binding.index.updateDirty(path, visibleXml)
          setLiveWorkspaceVersion(binding.index.version)
        }
        if (options?.initiallyDirty) {
          forcedUndurableDirtyByKeyRef.current.add(path)
        } else {
          forcedUndurableDirtyByKeyRef.current.delete(path)
        }
        setTabs([tab])
        setContents({ [path]: visibleXml })
        dirtyByKeyRef.current = { [path]: visibleDirty }
        setDirtyByKey({ [path]: visibleDirty })
        setActiveKey(path)
        setExplorerOpen(false)
      } finally {
        options?.signal?.removeEventListener('abort', abortRecovery)
        if (singleFileRecoveryAbortRef.current === recoveryController) {
          singleFileRecoveryAbortRef.current = null
        }
        recoveryController.abort()
      }
    },
    [
      activateWorkspace,
      beginWorkspaceActivationIntent,
      captureWorkspaceOperation,
      ensureDocumentSession,
      isWorkspaceActivationIntentCurrent,
      isWorkspaceOperationCurrent,
      pushToast,
      reviewRecoveryDraft,
      setExplorerOpen
    ]
  )

  const performTabClose = useCallback(
    (key: string): boolean => {
      const currentTabs = tabsRef.current
      const closingTab = currentTabs.find((tab) => tab.key === key)
      if (!closingTab) return false
      pendingProcessFocusRef.current.delete(key)
      const controller = sessionControllerRef.current
      const closingSession = controller?.store.get(key)
      const explicitlyDiscarded = Boolean(dirtyByKeyRef.current[key] || closingSession?.dirty)
      forcedUndurableDirtyByKeyRef.current.delete(key)
      if (key in dirtyByKeyRef.current) {
        const nextDirty = { ...dirtyByKeyRef.current }
        delete nextDirty[key]
        dirtyByKeyRef.current = nextDirty
      }
      // Closing the last tab returns to an empty canvas (or the catalog) — bring
      // the sidebar back so the explorer / AI generator are reachable again.
      if (currentTabs.filter((tab) => tab.key !== key).length === 0) setExplorerOpen(true)
      setActiveKey((prev) => {
        if (prev !== key) return prev
        const remaining = currentTabs.filter((tab) => tab.key !== key)
        return remaining.length > 0 ? remaining[remaining.length - 1].key : null
      })
      setTabs((prev) => prev.filter((t) => t.key !== key))
      const drafts = draftCoordinatorRef.current
      // Remove the exact live session before any asynchronous journal cleanup.
      // A rapid reopen may reuse the tab key; delayed cleanup must never close
      // that replacement session.
      controller?.store.close(key)
      const closeSession = async (): Promise<void> => {
        if (!closingSession) return
        if (explicitlyDiscarded) {
          await drafts?.explicitDiscard(key, closingSession.incarnation)
        }
        await drafts?.untrack(key, closingSession.incarnation)
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
      interviewApplyTokenByTabRef.current.delete(key)
      liveXmlUninstallersRef.current[key]?.()
      delete liveXmlUninstallersRef.current[key]
      const timer = liveXmlTimersRef.current[key]
      if (timer) clearTimeout(timer)
      delete liveXmlTimersRef.current[key]
      delete liveXmlCaptureEpochByKeyRef.current[key]
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
    [pushToast, setExplorerOpen]
  )

  const closeTab = useCallback(
    (key: string): boolean => {
      const closingTab = tabsRef.current.find((tab) => tab.key === key)
      if (!closingTab) return false
      const controller = sessionControllerRef.current
      const closingSession = controller?.store.get(key)
      if (dirtyByKeyRef.current[key] || closingSession?.dirty) {
        setDirtyTabClosePrompt({
          key,
          title: closingTab.title,
          generation: closingTab.gen,
          controller,
          sessionIncarnation: closingSession?.incarnation ?? null
        })
        // ProcessTabList's synchronous contract treats a pending decision like
        // a cancelled close. The dialog completes the exact captured close.
        return false
      }
      return performTabClose(key)
    },
    [performTabClose]
  )

  const confirmDirtyTabClose = useCallback(() => {
    if (!dirtyTabClosePrompt) return
    const prompt = dirtyTabClosePrompt
    setDirtyTabClosePrompt(null)

    const currentTabs = tabsRef.current
    const closingIndex = currentTabs.findIndex((tab) => tab.key === prompt.key)
    const currentTab = currentTabs[closingIndex]
    const currentController = sessionControllerRef.current
    const currentSession = currentController?.store.get(prompt.key)
    if (
      !currentTab ||
      currentTab.gen !== prompt.generation ||
      currentController !== prompt.controller ||
      (currentSession?.incarnation ?? null) !== prompt.sessionIncarnation
    ) {
      return
    }

    const remaining = currentTabs.filter((tab) => tab.key !== prompt.key)
    const focusKey =
      prompt.key === activeKeyRef.current
        ? (remaining[Math.min(closingIndex, remaining.length - 1)]?.key ?? null)
        : (activeKeyRef.current ??
          remaining[Math.min(closingIndex, remaining.length - 1)]?.key ??
          null)
    if (!performTabClose(prompt.key)) return
    if (focusKey) setActiveKey(focusKey)
    requestAnimationFrame(() => {
      if (focusKey) {
        document.getElementById(processTabId(focusKey))?.focus()
      } else {
        editorRegionRef.current?.focus()
      }
    })
  }, [dirtyTabClosePrompt, performTabClose])

  useEffect(() => {
    if (!dirtyTabClosePrompt) return
    const currentTab = tabs.find((tab) => tab.key === dirtyTabClosePrompt.key)
    const currentController = sessionControllerRef.current
    const currentSession = currentController?.store.get(dirtyTabClosePrompt.key)
    if (
      !currentTab ||
      currentTab.gen !== dirtyTabClosePrompt.generation ||
      currentController !== dirtyTabClosePrompt.controller ||
      (currentSession?.incarnation ?? null) !== dirtyTabClosePrompt.sessionIncarnation
    ) {
      setDirtyTabClosePrompt(null)
    }
  }, [dirtyByKey, dirtyTabClosePrompt, tabs])

  const discardAndCloseSessions = useCallback(
    async (
      binding: WorkspaceOperationBinding,
      sessions: readonly DocumentSession[],
      isCurrent: () => boolean
    ): Promise<void> => {
      const controller = binding.controller
      if (!controller || sessions.length === 0) return
      for (const captured of sessions) {
        const current = controller.store.get(captured.id)
        if (!isCurrent() || !current || current.incarnation !== captured.incarnation) {
          throw new Error(t('alert.staleWrite'))
        }
        await binding.drafts?.explicitDiscard(captured.id, captured.incarnation)
        await binding.drafts?.untrack(captured.id, captured.incarnation)
      }
      if (!isCurrent()) throw new Error(t('alert.staleWrite'))

      const ids = new Set(sessions.map((session) => session.id))
      const previousTabs = tabsRef.current
      controller.store.closeMany([...ids])
      if ([...ids].some((id) => id in dirtyByKeyRef.current)) {
        const nextDirty = { ...dirtyByKeyRef.current }
        for (const id of ids) delete nextDirty[id]
        dirtyByKeyRef.current = nextDirty
      }
      for (const session of sessions) {
        const id = session.id
        forcedUndurableDirtyByKeyRef.current.delete(id)
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
        delete liveXmlCaptureEpochByKeyRef.current[id]
        localizationSourceByTabRef.current.delete(id)
        localizationReviewByTabRef.current.delete(id)
        interviewApplyTokenByTabRef.current.delete(id)
        pendingProcessFocusRef.current.delete(id)
        pendingAiAutoSizeRef.current.delete(id)
        delete commandsRef.current[id]
        if (session.identity.path) binding.index.clearDirty(session.identity.path)
      }
      const dropClosed = <T,>(record: Record<string, T>): Record<string, T> => {
        if (![...ids].some((id) => id in record)) return record
        const next = { ...record }
        for (const id of ids) delete next[id]
        return next
      }
      const remainingTabs = previousTabs.filter((tab) => !ids.has(tab.key))
      setTabs((current) => current.filter((tab) => !ids.has(tab.key)))
      setActiveKey((current) =>
        current && ids.has(current) ? (remainingTabs.at(-1)?.key ?? null) : current
      )
      if (remainingTabs.length === 0) setExplorerOpen(true)
      setContents(dropClosed)
      setDirtyByKey(dropClosed)
      setModelersByKey(dropClosed)
      setMounted((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next.size === current.size ? current : next
      })
      setLiveWorkspaceVersion(binding.index.version)
    },
    [setExplorerOpen]
  )

  const handleDirtyChange = useCallback((key: string, dirty: boolean) => {
    const session = sessionControllerRef.current?.store.get(key)
    const effectiveDirty =
      dirty || Boolean(session?.dirty) || forcedUndurableDirtyByKeyRef.current.has(key)
    dirtyByKeyRef.current =
      dirtyByKeyRef.current[key] === effectiveDirty
        ? dirtyByKeyRef.current
        : { ...dirtyByKeyRef.current, [key]: effectiveDirty }
    setDirtyByKey((prev) =>
      prev[key] === effectiveDirty ? prev : { ...prev, [key]: effectiveDirty }
    )
    if (session) draftCoordinatorRef.current?.track(session)
  }, [])

  const scheduleLiveXmlCapture = useCallback(
    (
      tab: Tab,
      modeler: {
        saveXML?: (options: { format: boolean }) => Promise<{ xml?: string }>
      }
    ) => {
      const captureEpoch = (liveXmlCaptureEpochByKeyRef.current[tab.key] ?? 0) + 1
      liveXmlCaptureEpochByKeyRef.current[tab.key] = captureEpoch
      const existing = liveXmlTimersRef.current[tab.key]
      if (existing) clearTimeout(existing)
      liveXmlTimersRef.current[tab.key] = setTimeout(() => {
        delete liveXmlTimersRef.current[tab.key]
        void modeler
          .saveXML?.({ format: true })
          .then(({ xml }) => {
            if (
              !xml ||
              workspaceGenRef.current !== tab.gen ||
              liveXmlCaptureEpochByKeyRef.current[tab.key] !== captureEpoch ||
              modelersByKeyRef.current[tab.key] !== modeler
            ) {
              return
            }
            const currentSession = sessionControllerRef.current?.store.get(tab.key)
            const baseline = currentSession?.lastSavedXml ?? contents[tab.key] ?? xml
            const baseHash = tab.relPath ? baseHashByPathRef.current[tab.relPath] : undefined
            const existing =
              currentSession ??
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
            let effectiveDirty = forcedUndurableDirtyByKeyRef.current.has(tab.key)
            if (existing) {
              const updated = sessionControllerRef.current!.updateXml(tab.key, xml)
              draftCoordinatorRef.current?.track(updated)
              effectiveDirty = updated.dirty || effectiveDirty
              dirtyByKeyRef.current = {
                ...dirtyByKeyRef.current,
                [tab.key]: effectiveDirty
              }
              setDirtyByKey((previous) =>
                previous[tab.key] === effectiveDirty
                  ? previous
                  : {
                      ...previous,
                      [tab.key]: effectiveDirty
                    }
              )
            }
            if (effectiveDirty) {
              liveWorkspaceIndexRef.current.updateDirty(liveIndexPath(tab), xml)
            } else {
              liveWorkspaceIndexRef.current.clearDirty(liveIndexPath(tab))
            }
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

  const invalidateLiveXmlCapture = useCallback((key: string): void => {
    liveXmlCaptureEpochByKeyRef.current[key] = (liveXmlCaptureEpochByKeyRef.current[key] ?? 0) + 1
    const timer = liveXmlTimersRef.current[key]
    if (timer) {
      clearTimeout(timer)
      delete liveXmlTimersRef.current[key]
    }
  }, [])

  const captureLiveSession = useCallback(
    async (
      controller: DocumentSessionController,
      candidate: DocumentSession,
      requireLiveRead = false,
      isCurrent?: () => boolean
    ): Promise<LiveSessionCaptureResult> => {
      const { id, incarnation } = candidate
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (isCurrent && !isCurrent()) return { status: 'stale' }
        const current = controller.store.get(id)
        if (!current || current.incarnation !== incarnation) return { status: 'stale' }
        if (!requireLiveRead && !dirtyByKeyRef.current[id]) {
          return { status: 'captured', session: current }
        }
        if (!current.readXml) {
          return {
            status: 'unavailable',
            error: new Error('The live editor does not expose XML serialization.'),
            session: current
          }
        }

        const capturedRevision = current.revision
        const capturedXml = current.currentXml
        let serialized: string
        try {
          serialized = await current.readXml()
        } catch (error) {
          if (isCurrent && !isCurrent()) return { status: 'stale' }
          const latest = controller.store.get(id)
          if (!latest || latest.incarnation !== incarnation) return { status: 'stale' }
          if (latest.revision !== capturedRevision || latest.currentXml !== capturedXml) {
            continue
          }
          return { status: 'unavailable', error, session: latest }
        }

        if (isCurrent && !isCurrent()) return { status: 'stale' }
        const latest = controller.store.get(id)
        if (!latest || latest.incarnation !== incarnation) return { status: 'stale' }
        if (latest.revision !== capturedRevision || latest.currentXml !== capturedXml) {
          continue
        }
        return {
          status: 'captured',
          session: controller.updateXml(id, serialized)
        }
      }
      const latest = controller.store.get(id)
      if ((isCurrent && !isCurrent()) || !latest || latest.incarnation !== incarnation) {
        return { status: 'stale' }
      }
      return {
        status: 'unavailable',
        error: new Error('The live editor kept changing while XML was being captured.'),
        session: latest
      }
    },
    []
  )

  const handleRequestSave = useCallback(
    async (tab: Tab, xml: string, options?: { explicitDraftWithErrors?: boolean }) => {
      const binding = captureWorkspaceOperation()
      const controller = binding.controller
      if (!controller) throw new Error('Document-session controller is unavailable.')
      const adapter = binding.adapter
      const drafts = binding.drafts
      const isWorkspaceCurrent = (): boolean =>
        isWorkspaceOperationCurrent(binding) && tab.gen === binding.generation
      const baseHash = tab.relPath ? baseHashByPathRef.current[tab.relPath] : undefined
      const existingSession = controller.store.get(tab.key)
      const baseline = existingSession?.lastSavedXml ?? contents[tab.key] ?? xml
      const session =
        existingSession ??
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
      const sessionIncarnation = current.incarnation
      const submittedRevision = current.revision
      const isCurrent = (): boolean =>
        isWorkspaceCurrent() && controller.store.get(tab.key)?.incarnation === sessionIncarnation
      const submittedSession = (): DocumentSession | null => {
        const live = controller.store.get(tab.key)
        return live?.incarnation === sessionIncarnation ? live : null
      }
      const requireSubmittedSnapshot = async (): Promise<DocumentSession> => {
        if (!isCurrent()) throw new Error(t('alert.staleWrite'))
        const live = submittedSession()
        if (!live || live.revision !== submittedRevision || live.currentXml !== xml) {
          throw new Error(t('session.save.newerEdits'))
        }
        if (!live.readXml) return live
        const captured = await captureLiveSession(controller, live, true, isCurrent)
        if (captured.status === 'stale') throw new Error(t('alert.staleWrite'))
        if (captured.status === 'unavailable') {
          const evidence = `${tab.relPath ?? tab.title}: ${errMsg(captured.error)}`
          recordWorkspaceIssue(evidence, binding)
          throw new Error(t('session.save.reloadEditorFailed', { error: evidence }))
        }
        if (
          captured.session.revision !== submittedRevision ||
          captured.session.currentXml !== xml
        ) {
          throw new Error(t('session.save.newerEdits'))
        }
        return captured.session
      }
      drafts?.track(current)

      if (baseline) {
        const preservation = await validateUnknownExtensionPreservation(baseline, xml)
        const live = submittedSession()
        if (
          !isCurrent() ||
          !live ||
          live.revision !== submittedRevision ||
          live.currentXml !== xml
        ) {
          throw new Error(t('session.save.newerEdits'))
        }
        if (!preservation.valid) {
          const evidence = t('session.save.preservationTechnicalEvidence', {
            codes:
              preservation.issues.map((issue) => issue.code).join(', ') ||
              t('workspace.diagnostic.unknown')
          })
          recordWorkspaceIssue(`${tab.relPath ?? tab.title}: ${evidence}`, binding)
          throw new Error(t('session.save.preservationBlocked'))
        }
      }
      await validateReleaseXml(xml, {
        action: options?.explicitDraftWithErrors ? 'save-draft-with-errors' : 'save',
        knownProcessIds: binding.index.processIndex().keys(),
        requireBilingual: !options?.explicitDraftWithErrors,
        requireDi: true,
        explicitDraftWithErrors: options?.explicitDraftWithErrors
      })
      await requireSubmittedSnapshot()
      if (!tab.relPath || adapter?.storage.persistence === 'download') {
        await drafts?.flush(tab.key, sessionIncarnation)
        await requireSubmittedSnapshot()
        downloadBpmn(tab.title.endsWith('.bpmn') ? tab.title : `${tab.title}.bpmn`, xml)
        const remainsUndurable = current.dirty || forcedUndurableDirtyByKeyRef.current.has(tab.key)
        dirtyByKeyRef.current = {
          ...dirtyByKeyRef.current,
          [tab.key]: remainsUndurable
        }
        setDirtyByKey((previous) => ({
          ...previous,
          [tab.key]: remainsUndurable
        }))
        pushToast(t('session.download.draftRetained'), 'info')
        return { durable: false }
      }
      if (tab.relPath && adapter) {
        // Refuse a write from a tab whose workspace was switched out from under
        // it — otherwise it would land its relative path in the WRONG folder.
        if (!isCurrent()) throw new Error(t('alert.staleWrite'))
        let outcome = await controller.save(tab.key, {
          xml,
          expectedRevision: submittedRevision
        })
        if (!isCurrent()) throw new Error(t('alert.staleWrite'))
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
          await requireSubmittedSnapshot()
          outcome = await controller.save(tab.key, {
            xml,
            expectedRevision: submittedRevision,
            conflictDecision: decision,
            reviewedConflict: outcome.conflict
          })
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
        }
        if (outcome.status === 'clean') {
          await drafts?.confirmedSave(tab.key, sessionIncarnation, xml)
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          let finalized = controller.store.get(tab.key)
          if (!finalized || finalized.incarnation !== sessionIncarnation) {
            throw new Error(t('alert.staleWrite'))
          }
          if (finalized.readXml || dirtyByKeyRef.current[tab.key]) {
            const captured = await captureLiveSession(controller, finalized, true, isCurrent)
            if (captured.status === 'stale') throw new Error(t('alert.staleWrite'))
            if (captured.status === 'unavailable') {
              const evidence = `${tab.relPath}: ${errMsg(captured.error)}`
              recordWorkspaceIssue(evidence, binding)
              binding.index.updateDirty(tab.relPath, captured.session.currentXml)
              drafts?.track(captured.session)
              try {
                await drafts?.flush(captured.session.id, captured.session.incarnation)
              } catch (draftError) {
                if (isCurrent()) {
                  recordWorkspaceIssue(`${tab.relPath}: ${errMsg(draftError)}`, binding)
                }
              }
              dirtyByKeyRef.current = {
                ...dirtyByKeyRef.current,
                [tab.key]: true
              }
              setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
              setLiveWorkspaceVersion(binding.index.version)
              throw new Error(t('session.save.reloadEditorFailed', { error: evidence }))
            }
            finalized = captured.session
          }
          if (
            finalized.revision !== submittedRevision ||
            finalized.dirty ||
            finalized.currentXml !== xml ||
            dirtyByKeyRef.current[tab.key]
          ) {
            drafts?.track(finalized)
            try {
              await drafts?.flush(finalized.id, finalized.incarnation)
            } catch (draftError) {
              if (isCurrent()) {
                recordWorkspaceIssue(`${tab.relPath}: ${errMsg(draftError)}`, binding)
              }
            }
            if (!isCurrent()) throw new Error(t('alert.staleWrite'))
            binding.index.updateDirty(tab.relPath, finalized.currentXml)
            dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: true }
            setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
            setLiveWorkspaceVersion(binding.index.version)
            throw new Error(t('session.save.newerEdits'))
          }
          dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: false }
          setDirtyByKey((previous) => ({ ...previous, [tab.key]: false }))
          return { durable: true }
        }
        if (outcome.status === 'reloaded') {
          const external = outcome.external
          const externalPath = external.identity.path
          if (!externalPath) {
            throw new Error(t('session.save.failed', { status: 'missing-path' }))
          }
          const modeler = modelersByKey[tab.key] as
            { importXML?: (candidate: string) => Promise<unknown> } | undefined
          const reloadedSession = controller.store.get(tab.key)
          if (!reloadedSession || reloadedSession.incarnation !== sessionIncarnation) {
            throw new Error(t('alert.staleWrite'))
          }
          const visibleXml = reloadedSession.currentXml
          const hasReviewedChanges = reloadedSession.dirty
          baseHashByPathRef.current[externalPath] = external.fingerprint.hash
          if (externalPath !== tab.relPath) {
            binding.index.clearDirty(tab.relPath)
            setTabs((previous) =>
              previous.map((candidate) =>
                candidate.key === tab.key
                  ? { ...candidate, relPath: externalPath, title: baseName(externalPath) }
                  : candidate
              )
            )
          }
          binding.index.updateSaved({
            relPath: externalPath,
            xml: external.xml,
            lastModified: external.fingerprint.modifiedAt,
            size: external.fingerprint.size
          })
          if (hasReviewedChanges) {
            binding.index.updateDirty(externalPath, visibleXml)
          } else {
            binding.index.clearDirty(externalPath)
          }
          invalidateLiveXmlCapture(tab.key)
          try {
            const coordinatedApply = commandsRef.current[tab.key]?.applyExternalXml
            if (coordinatedApply) {
              await coordinatedApply(visibleXml, {
                dirty: hasReviewedChanges,
                baselineXml: external.xml
              })
            } else if (modeler?.importXML) {
              throw new Error('The editor synchronization command is not ready.')
            }
          } catch (error) {
            // The controller has already accepted the external file and
            // discarded the prior journal record. The submitted XML is the last
            // verified local snapshot from before that replacement, so restore
            // it first instead of trusting a partially mutated/unserializable
            // canvas after a failed import.
            let currentAfterFailure = controller.store.get(tab.key)
            if (!currentAfterFailure || currentAfterFailure.incarnation !== sessionIncarnation) {
              throw new Error(t('alert.staleWrite'))
            }
            if (
              (currentAfterFailure.revision !== reloadedSession.revision ||
                currentAfterFailure.currentXml !== visibleXml ||
                dirtyByKeyRef.current[tab.key]) &&
              currentAfterFailure.readXml
            ) {
              const captured = await captureLiveSession(
                controller,
                currentAfterFailure,
                true,
                isCurrent
              )
              if (captured.status === 'stale') throw new Error(t('alert.staleWrite'))
              if (captured.status === 'unavailable') {
                const knownLocalXml =
                  captured.session.revision !== reloadedSession.revision ||
                  captured.session.currentXml !== visibleXml
                    ? captured.session.currentXml
                    : xml
                const retained = controller.store.replaceWithExternal(tab.key, {
                  xml: external.xml,
                  reviewedXml: knownLocalXml,
                  fingerprint: external.fingerprint,
                  identity: external.identity
                })
                drafts?.track(retained)
                let draftRecoveryError: unknown
                try {
                  await drafts?.flush(retained.id, retained.incarnation)
                } catch (draftError) {
                  draftRecoveryError = draftError
                }
                if (!isCurrent()) throw new Error(t('alert.staleWrite'))
                const retainedAfterFlush = controller.store.get(tab.key)
                if (!retainedAfterFlush || retainedAfterFlush.incarnation !== sessionIncarnation) {
                  throw new Error(t('alert.staleWrite'))
                }
                // The canvas could not be serialized after the failed reload.
                // Keep it untouched and preserve the last verified local XML as
                // a dirty journal/index snapshot for explicit recovery.
                binding.index.updateDirty(externalPath, retainedAfterFlush.currentXml)
                setLiveWorkspaceVersion(binding.index.version)
                dirtyByKeyRef.current = {
                  ...dirtyByKeyRef.current,
                  [tab.key]: true
                }
                setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
                const captureDetail = t('session.save.liveXmlCaptureDetail', {
                  error: errMsg(error),
                  captureError: errMsg(captured.error)
                })
                const recoveryDetail = draftRecoveryError
                  ? `${captureDetail}; ${errMsg(draftRecoveryError)}`
                  : captureDetail
                recordWorkspaceIssue(`${externalPath}: ${recoveryDetail}`, binding)
                throw new Error(t('session.save.reloadEditorFailed', { error: recoveryDetail }))
              }
              currentAfterFailure = captured.session
            }
            const newerLocalExists =
              currentAfterFailure.revision !== reloadedSession.revision ||
              currentAfterFailure.currentXml !== visibleXml
            const restoredLocal = newerLocalExists
              ? currentAfterFailure
              : controller.store.replaceWithExternal(tab.key, {
                  xml: external.xml,
                  reviewedXml: xml,
                  fingerprint: external.fingerprint,
                  identity: external.identity
                })
            const retainedXml = restoredLocal.currentXml
            let canvasRecoveryError: unknown
            const coordinatedRestore = commandsRef.current[tab.key]?.applyExternalXml
            if (coordinatedRestore) {
              invalidateLiveXmlCapture(tab.key)
              try {
                await coordinatedRestore(retainedXml, {
                  dirty: true,
                  baselineXml: external.xml
                })
              } catch (restoreError) {
                canvasRecoveryError = restoreError
              }
            } else if (modeler?.importXML) {
              canvasRecoveryError = new Error('The editor synchronization command is not ready.')
            } else {
              setContents((previous) => ({ ...previous, [tab.key]: retainedXml }))
            }
            drafts?.track(restoredLocal)
            let draftRecoveryError: unknown
            try {
              await drafts?.flush(tab.key, sessionIncarnation)
            } catch (draftError) {
              draftRecoveryError = draftError
              if (isCurrent()) {
                pushToast(t('draftRecovery.error', { error: errMsg(draftError) }), 'error')
              }
            }
            if (!isCurrent()) throw new Error(t('alert.staleWrite'))
            const retainedAfterFlush = controller.store.get(tab.key)
            if (!retainedAfterFlush || retainedAfterFlush.incarnation !== sessionIncarnation) {
              throw new Error(t('alert.staleWrite'))
            }
            binding.index.updateDirty(externalPath, retainedAfterFlush.currentXml)
            setLiveWorkspaceVersion(binding.index.version)
            dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: true }
            setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
            if (canvasRecoveryError === undefined && coordinatedRestore) {
              setContents((previous) => ({ ...previous, [tab.key]: retainedXml }))
            }
            const recoveryDetail =
              canvasRecoveryError === undefined
                ? errMsg(error)
                : t('session.save.localCanvasRecoveryDetail', {
                    error: errMsg(error),
                    recoveryError: errMsg(canvasRecoveryError)
                  })
            recordWorkspaceIssue(`${externalPath}: ${recoveryDetail}`, binding)
            throw new Error(
              t('session.save.reloadEditorFailed', {
                error: draftRecoveryError
                  ? `${recoveryDetail}; ${errMsg(draftRecoveryError)}`
                  : recoveryDetail
              })
            )
          }
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          let finalReloadedSession = controller.store.get(tab.key)
          if (!finalReloadedSession || finalReloadedSession.incarnation !== sessionIncarnation) {
            throw new Error(t('alert.staleWrite'))
          }
          if (dirtyByKeyRef.current[tab.key]) {
            const captured = await captureLiveSession(
              controller,
              finalReloadedSession,
              true,
              isCurrent
            )
            if (captured.status === 'stale') throw new Error(t('alert.staleWrite'))
            if (captured.status === 'unavailable') {
              const evidence = `${externalPath}: ${errMsg(captured.error)}`
              recordWorkspaceIssue(evidence, binding)
              binding.index.updateDirty(externalPath, captured.session.currentXml)
              dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: true }
              setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
              setLiveWorkspaceVersion(binding.index.version)
              throw new Error(t('session.save.reloadEditorFailed', { error: evidence }))
            }
            finalReloadedSession = captured.session
          }
          if (
            finalReloadedSession.revision !== reloadedSession.revision ||
            finalReloadedSession.currentXml !== visibleXml
          ) {
            drafts?.track(finalReloadedSession)
            try {
              await drafts?.flush(finalReloadedSession.id, finalReloadedSession.incarnation)
            } catch (draftError) {
              if (isCurrent()) {
                recordWorkspaceIssue(`${externalPath}: ${errMsg(draftError)}`, binding)
              }
            }
            if (!isCurrent()) throw new Error(t('alert.staleWrite'))
            binding.index.updateDirty(externalPath, finalReloadedSession.currentXml)
            dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: true }
            setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
            setLiveWorkspaceVersion(binding.index.version)
            throw new Error(t('session.save.newerEdits'))
          }
          setLiveWorkspaceVersion(binding.index.version)
          setContents((previous) => ({ ...previous, [tab.key]: visibleXml }))
          dirtyByKeyRef.current = {
            ...dirtyByKeyRef.current,
            [tab.key]: hasReviewedChanges
          }
          setDirtyByKey((previous) => ({
            ...previous,
            [tab.key]: hasReviewedChanges
          }))
          return {
            durable: !hasReviewedChanges,
            acceptedSubmittedXml: false
          }
        }
        if (outcome.status !== 'success' && outcome.status !== 'saved-as') {
          if (outcome.status === 'locked') {
            throw new Error(t('session.save.locked'))
          }
          if (outcome.status === 'stale-workspace' || outcome.status === 'stale-capture') {
            throw new Error(t('alert.staleWrite'))
          }
          if (outcome.status === 'permission-loss' || outcome.status === 'storage-failure') {
            recordWorkspaceIssue(
              `${tab.relPath}: ${t('session.save.storageTechnicalEvidence', {
                code: outcome.failure.code,
                error: outcome.failure.message
              })}`,
              binding
            )
            throw new Error(
              t(
                outcome.status === 'permission-loss'
                  ? 'session.save.permissionLoss'
                  : 'session.save.storageFailure'
              )
            )
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
          binding.index.clearDirty(tab.relPath)
          setTabs((previous) =>
            previous.map((candidate) =>
              candidate.key === tab.key
                ? { ...candidate, relPath: savedPath, title: baseName(savedPath) }
                : candidate
            )
          )
        }
        binding.index.updateSaved(saved)
        let savedSession = controller.store.get(tab.key)
        if (!savedSession || savedSession.incarnation !== sessionIncarnation) {
          throw new Error(t('alert.staleWrite'))
        }
        if (savedSession.readXml) {
          const captured = await captureLiveSession(controller, savedSession, true, isCurrent)
          if (captured.status === 'stale') throw new Error(t('alert.staleWrite'))
          if (captured.status === 'unavailable') {
            const evidence = `${savedPath}: ${errMsg(captured.error)}`
            recordWorkspaceIssue(evidence, binding)
            binding.index.updateDirty(savedPath, captured.session.currentXml)
            dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: true }
            setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
            setLiveWorkspaceVersion(binding.index.version)
            throw new Error(t('session.save.reloadEditorFailed', { error: evidence }))
          }
          savedSession = captured.session
        }
        if (savedSession.currentXml === xml && !savedSession.dirty) {
          dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: false }
        }
        const remainingDirty =
          outcome.remainingDirty ||
          savedSession.revision !== submittedRevision ||
          savedSession.currentXml !== xml ||
          savedSession.dirty ||
          dirtyByKeyRef.current[tab.key]
        if (remainingDirty) {
          binding.index.updateDirty(savedPath, savedSession.currentXml)
          drafts?.track(savedSession)
          try {
            await drafts?.flush(savedSession.id, savedSession.incarnation)
          } catch (draftError) {
            if (isCurrent()) {
              recordWorkspaceIssue(`${savedPath}: ${errMsg(draftError)}`, binding)
            }
          }
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: true }
          setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
          setLiveWorkspaceVersion(binding.index.version)
          // The newer XML already lives in the modeler. Replacing the React
          // prop with the older saved XML would silently erase that edit.
          throw new Error(t('session.save.newerEdits'))
        }
        binding.index.clearDirty(savedPath)
        setLiveWorkspaceVersion(binding.index.version)
        setContents((previous) => ({ ...previous, [tab.key]: xml }))
        dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: false }
        setDirtyByKey((previous) => ({ ...previous, [tab.key]: false }))
        if (outcome.status === 'saved-as') {
          const projected = applyCommittedWorkspaceProjection(binding, {
            kind: 'upsert-bpmn',
            path: savedPath
          })
          if (!projected) {
            await refreshWorkspace()
            if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          }
        }
        return { durable: true }
      }
      throw new Error(t('session.save.failed', { status: 'missing-workspace' }))
    },
    [
      contents,
      captureLiveSession,
      captureWorkspaceOperation,
      applyCommittedWorkspaceProjection,
      ensureDocumentSession,
      invalidateLiveXmlCapture,
      isWorkspaceOperationCurrent,
      modelersByKey,
      promptForSaveConflict,
      pushToast,
      recordWorkspaceIssue,
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
      const binding = captureWorkspaceOperation()
      const diagnostic = binding.index
        .duplicateDiagnostics()
        .find((item) => item.processId === processId)
      if (!diagnostic) return
      const target = diagnostic.occurrences[diagnostic.occurrences.length - 1]
      const attemptToken = Symbol(`duplicate-repair:${target.relPath}`)
      duplicateRepairTokenByPathRef.current.set(target.relPath, attemptToken)
      const isCurrent = (): boolean =>
        isWorkspaceOperationCurrent(binding) &&
        duplicateRepairTokenByPathRef.current.get(target.relPath) === attemptToken
      const assertCurrent = (): void => {
        if (!isCurrent()) throw new Error(t('alert.staleWrite'))
      }
      const controller = binding.controller
      const workspace = binding.identity

      try {
        const indexedSource = binding.index
          .files()
          .find((file) => file.relPath === target.relPath)?.xml
        let source = indexedSource
        if (!source) return
        let guardedSession =
          controller && workspace
            ? controller.store.getByIdentity({
                workspace,
                path: target.relPath
              })
            : undefined
        if (controller && guardedSession?.readXml) {
          const captured = await captureLiveSession(controller, guardedSession, true, isCurrent)
          if (captured.status === 'stale') throw new Error(t('alert.staleWrite'))
          if (captured.status === 'unavailable') {
            throw new Error(
              t('session.save.reloadEditorFailed', {
                error: errMsg(captured.error)
              })
            )
          }
          assertCurrent()
          guardedSession = captured.session
          source = guardedSession.currentXml
          const effectiveDirty =
            guardedSession.dirty ||
            Boolean(dirtyByKeyRef.current[guardedSession.id]) ||
            forcedUndurableDirtyByKeyRef.current.has(guardedSession.id)
          if (effectiveDirty) {
            binding.index.updateDirty(target.relPath, source)
          } else {
            binding.index.clearDirty(target.relPath)
          }
          setLiveWorkspaceVersion(binding.index.version)
        }
        assertCurrent()
        const sessionGuard = guardedSession
          ? {
              id: guardedSession.id,
              incarnation: guardedSession.incarnation,
              revision: guardedSession.revision,
              currentXml: guardedSession.currentXml,
              uiDirty: Boolean(dirtyByKeyRef.current[guardedSession.id])
            }
          : null
        const sessionGuardMatches = (): boolean => {
          if (!sessionGuard || !controller) return true
          const current = controller.store.get(sessionGuard.id)
          return Boolean(
            current &&
            current.incarnation === sessionGuard.incarnation &&
            current.revision === sessionGuard.revision &&
            current.currentXml === sessionGuard.currentXml &&
            Boolean(dirtyByKeyRef.current[sessionGuard.id]) === sessionGuard.uiDirty
          )
        }
        const assertSessionCurrent = (): void => {
          assertCurrent()
          if (!sessionGuardMatches()) throw new Error(t('alert.staleWrite'))
        }

        await validateReleaseXml(source, {
          action: 'apply-editor',
          knownProcessIds: binding.index.processIndex().keys(),
          requireBilingual: false,
          requireDi: true
        })
        assertSessionCurrent()
        const prepared = await binding.index.prepareDuplicateProcessIdRepair(
          target.relPath,
          processId,
          {
            occurrence: target.occurrence
          }
        )
        assertSessionCurrent()
        if (
          prepared.relPath !== target.relPath ||
          prepared.target.relPath !== target.relPath ||
          prepared.target.effectiveXml !== source
        ) {
          throw new Error(t('session.save.newerEdits'))
        }
        await validateReleaseXml(prepared.xml, {
          action: 'apply-editor',
          knownProcessIds: binding.index.processIndex().keys(),
          requireBilingual: false,
          requireDi: true
        })
        assertSessionCurrent()
        const preservation = await validateUnknownExtensionPreservation(source, prepared.xml)
        assertSessionCurrent()
        if (!preservation.valid) {
          throw new Error(t('sourceEditor.preservationBlocked'))
        }

        let tab = tabsRef.current.find((item) => item.relPath === target.relPath)
        const tabKey = guardedSession?.id ?? tab?.key ?? target.relPath
        const modeler = modelersByKeyRef.current[tabKey] as
          | {
              saveXML(options: { format: boolean }): Promise<{ xml?: string }>
              get(name: string): unknown
            }
          | undefined
        let finalXml = prepared.xml
        let updatedSession: DocumentSession | null = null
        let editorTransactionApplied = false

        const restorePreparedIndexTarget = (): void => {
          if (prepared.target.dirtyXml !== null) {
            binding.index.updateDirty(prepared.target.relPath, prepared.target.dirtyXml)
          } else {
            binding.index.clearDirty(prepared.target.relPath)
          }
        }

        if (modeler) {
          const runExclusiveXmlTransaction = commandsRef.current[tabKey]?.runExclusiveXmlTransaction
          if (!runExclusiveXmlTransaction) {
            throw new Error('The editor synchronization command is not ready.')
          }
          invalidateLiveXmlCapture(tabKey)
          await runExclusiveXmlTransaction(async (transaction) => {
            if (transaction.modeler !== modeler) {
              throw new DOMException('The editor modeler is no longer active.', 'AbortError')
            }
            const assertTransactionCurrent = (): void => {
              transaction.assertActive()
              assertSessionCurrent()
              if (modelersByKeyRef.current[tabKey] !== modeler) {
                throw new Error(t('alert.staleWrite'))
              }
            }
            assertTransactionCurrent()
            const { xml: currentEditorXml } = await transaction.modeler.saveXML({
              format: true
            })
            assertTransactionCurrent()
            if (!currentEditorXml || currentEditorXml !== source) {
              throw new Error(t('session.save.newerEdits'))
            }

            let mutationAttempted = false
            let indexCommitted = false
            let acceptedSessionXml: string | null = null
            try {
              mutationAttempted = true
              await transaction.importXml(prepared.xml)
              invalidateLiveXmlCapture(tabKey)
              assertTransactionCurrent()
              const { xml: roundTripXml } = await transaction.modeler.saveXML({
                format: true
              })
              assertTransactionCurrent()
              if (!roundTripXml) {
                throw new Error('editor returned no XML after duplicate-id repair')
              }
              const roundTripPreservation = await validateUnknownExtensionPreservation(
                prepared.xml,
                roundTripXml
              )
              assertTransactionCurrent()
              if (!roundTripPreservation.valid) {
                throw new Error(t('sourceEditor.preservationBlocked'))
              }
              await validateReleaseXml(roundTripXml, {
                action: 'apply-editor',
                knownProcessIds: binding.index.processIndex().keys(),
                requireBilingual: false,
                requireDi: true
              })
              assertTransactionCurrent()

              binding.index.commitDuplicateProcessIdRepair(prepared)
              indexCommitted = true
              if (roundTripXml !== prepared.xml) {
                binding.index.updateDirty(target.relPath, roundTripXml)
              }
              if (!controller || !sessionGuard) {
                throw new Error(t('alert.staleWrite'))
              }
              const currentSession = controller.store.get(sessionGuard.id)
              if (
                !currentSession ||
                currentSession.incarnation !== sessionGuard.incarnation ||
                currentSession.revision !== sessionGuard.revision ||
                currentSession.currentXml !== sessionGuard.currentXml
              ) {
                throw new Error(t('alert.staleWrite'))
              }
              updatedSession = controller.updateXml(sessionGuard.id, roundTripXml)
              acceptedSessionXml = roundTripXml
              transaction.markDirty()
              finalXml = roundTripXml
              editorTransactionApplied = true
            } catch (error) {
              if (acceptedSessionXml !== null && controller && sessionGuard) {
                const currentSession = controller.store.get(sessionGuard.id)
                if (
                  currentSession?.incarnation === sessionGuard.incarnation &&
                  currentSession.currentXml === acceptedSessionXml
                ) {
                  try {
                    controller.updateXml(sessionGuard.id, source)
                  } catch {
                    /* the original repair error remains authoritative */
                  }
                }
                updatedSession = null
              }
              if (indexCommitted) restorePreparedIndexTarget()
              if (mutationAttempted) {
                try {
                  transaction.assertActive()
                  await transaction.importXml(source)
                  invalidateLiveXmlCapture(tabKey)
                  transaction.restoreDirtyState()
                } catch {
                  /* preserve the original repair error */
                }
              }
              throw error
            }
          })
        } else {
          assertSessionCurrent()
          binding.index.commitDuplicateProcessIdRepair(prepared)
          if (guardedSession && controller) {
            updatedSession = controller.updateXml(guardedSession.id, prepared.xml)
          }
        }
        assertCurrent()

        if (!tab) {
          tab = {
            key: tabKey,
            title: baseName(target.relPath),
            relPath: target.relPath,
            gen: binding.generation
          }
          const openedTab = tab
          setTabs((previous) =>
            previous.some((item) => item.key === openedTab.key)
              ? previous
              : [...previous, openedTab]
          )
        }
        if (!updatedSession && controller) {
          const sourceHash = baseHashByPathRef.current[target.relPath]
          const durableXml = prepared.target.saved?.xml ?? ''
          updatedSession =
            ensureDocumentSession(tab, finalXml, {
              lastSavedXml: durableXml,
              base:
                prepared.target.saved && sourceHash
                  ? {
                      hash: sourceHash,
                      size: prepared.target.saved.size,
                      modifiedAt: prepared.target.saved.lastModified
                    }
                  : null
            }) ?? null
        }
        if (updatedSession) binding.drafts?.track(updatedSession)
        if (!editorTransactionApplied) {
          setContents((previous) => ({ ...previous, [tab.key]: finalXml }))
        }
        localizationSourceByTabRef.current.set(tab.key, LocalizationSource.Editor)
        dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [tab.key]: true }
        setDirtyByKey((previous) => ({ ...previous, [tab.key]: true }))
        setLiveWorkspaceVersion(binding.index.version)
        setActiveKey(tab.key)
        setCatalogOpen(false)
      } catch (error) {
        if (isCurrent()) {
          const evidence = `${target.relPath}: ${errMsg(error)}`
          recordWorkspaceIssue(evidence, binding)
          pushToast(t('session.save.reloadEditorFailed', { error: evidence }), 'error')
        }
      } finally {
        if (duplicateRepairTokenByPathRef.current.get(target.relPath) === attemptToken) {
          duplicateRepairTokenByPathRef.current.delete(target.relPath)
        }
      }
    },
    [
      captureLiveSession,
      captureWorkspaceOperation,
      ensureDocumentSession,
      invalidateLiveXmlCapture,
      isWorkspaceOperationCurrent,
      pushToast,
      recordWorkspaceIssue
    ]
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
      setExplorerOpen(true)
      requestTreeReveal(undefined, relPath)
      void openDirectoryFile(relPath, { collapse: false })
    },
    [openDirectoryFile, requestTreeReveal, setExplorerOpen]
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
      setExplorerOpen(true)
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
      queueProcessFocus,
      setExplorerOpen
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
      const binding = captureWorkspaceOperation()
      const adapter = binding.adapter
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
      const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
      if (!isCurrent()) return
      try {
        const relPath = await runCoordinatedWorkspaceMutation(binding, async (lease) => {
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          const taken = await directBpmnSlugs(adapter, '')
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          const slug = dedupeSlug(deriveFileBaseName(name || calledElementId), (c) =>
            taken.has(c.toLowerCase())
          )
          const doc = buildMissingProcessDoc(calledElementId, name, slug)
          const created = await writeUniqueBpmn(adapter, '', doc.fileBaseName, doc.xml)
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          lease.publish([{ kind: 'saved', path: created }])
          return created
        })
        if (!isCurrent()) return
        await refreshWorkspace()
        if (!isCurrent()) return
        setExplorerOpen(true)
        requestTreeReveal(calledElementId, relPath)
        void openDirectoryFile(relPath, { collapse: false })
      } catch (err) {
        if (isCurrent()) {
          pushToast(t('alert.createProcessFailed', { error: errMsg(err) }), 'error')
        }
      }
    },
    [
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      mode,
      promptText,
      refreshWorkspace,
      openDirectoryFile,
      pushToast,
      requestTreeReveal,
      runCoordinatedWorkspaceMutation,
      setExplorerOpen
    ]
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
      const binding = captureWorkspaceOperation()
      const adapter = binding.adapter
      if (!adapter?.storage.capabilities.multipleFiles) return
      const name = await promptText({
        title: t('dialog.newProcess.title'),
        label: t('dialog.newProcess.label'),
        initialValue: t('dialog.newProcess.initialValue'),
        okLabel: t('dialog.newProcess.okLabel'),
        hint: t('dialog.newProcess.hint.directory')
      })
      if (!name) return
      const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
      if (!isCurrent()) return
      try {
        // Commit the canvas/sidebar intent before the storage write becomes
        // externally observable; this prevents a late post-create collapse
        // from overriding a user's immediate rail toggle.
        setExplorerOpen(false)
        const relPath = await runCoordinatedWorkspaceMutation(binding, async (lease) => {
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          const taken = await directBpmnSlugs(adapter, folderRel)
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          const slug = dedupeSlug(deriveFileBaseName(name), (c) => taken.has(c.toLowerCase()))
          // Also de-dup the derived <process id> against the LIVE process index
          // so ANY id collision (incl. a hash clash for two Arabic names) is
          // suffixed rather than silently cross-wiring their call links (ORIG-6b).
          const doc = buildNewProcessDoc(name, slug, (candidate) =>
            binding.index.processIndex().has(candidate)
          )
          const created = await writeUniqueBpmn(adapter, folderRel, doc.fileBaseName, doc.xml)
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          lease.publish([{ kind: 'saved', path: created }])
          return created
        })
        if (!isCurrent()) return
        await refreshWorkspace()
        if (!isCurrent()) return
        void openDirectoryFile(relPath)
      } catch (err) {
        if (isCurrent()) {
          pushToast(t('alert.createProcessFailed', { error: errMsg(err) }), 'error')
        }
      }
    },
    [
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      promptText,
      refreshWorkspace,
      openDirectoryFile,
      pushToast,
      runCoordinatedWorkspaceMutation,
      setExplorerOpen
    ]
  )

  const handleNewProcessFallback = useCallback(async () => {
    const intent = beginWorkspaceActivationIntent()
    const name = await promptText({
      title: t('dialog.newProcess.title'),
      label: t('dialog.newProcess.label'),
      initialValue: t('dialog.newProcess.initialValue'),
      okLabel: t('dialog.newProcess.okLabel'),
      hint: t('dialog.newProcess.hint.fallback')
    })
    if (!name || !isWorkspaceActivationIntentCurrent(intent)) return
    // Dedup the derived id against the (in-memory) index too, for parity with the
    // directory path (ORIG-6b); in fallback mode the index is empty, so this is a
    // no-op but keeps the two creation paths from drifting.
    const doc = buildNewProcessDoc(name, undefined, (candidate) => processIndex.has(candidate))
    const proceed = await guardWorkspaceSwitch()
    if (!proceed || !isWorkspaceActivationIntentCurrent(intent)) return
    await activateSingleFileDocument(
      `${doc.fileBaseName}.bpmn`,
      doc.xml,
      LocalizationSource.Editor,
      { claimedIntent: intent, initiallyDirty: true }
    )
  }, [
    activateSingleFileDocument,
    beginWorkspaceActivationIntent,
    guardWorkspaceSwitch,
    isWorkspaceActivationIntentCurrent,
    processIndex,
    promptText
  ])

  const handleNewProcessClick = useCallback(() => {
    if (workspaceAdapter?.storage.capabilities.multipleFiles) void handleNewProcess('')
    else void handleNewProcessFallback()
  }, [workspaceAdapter, handleNewProcess, handleNewProcessFallback])

  const handleNewFolder = useCallback(
    async (folderRel: string) => {
      const binding = captureWorkspaceOperation()
      const adapter = binding.adapter
      if (!adapter?.storage.capabilities.directories) return
      const name = await promptText({
        title: t('dialog.newFolder.title'),
        label: t('dialog.newFolder.label'),
        initialValue: t('dialog.newFolder.initialValue'),
        okLabel: t('dialog.newFolder.okLabel')
      })
      if (!name) return
      const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
      if (!isCurrent()) return
      try {
        const createdPath = joinRel(folderRel, name.trim())
        await runCoordinatedWorkspaceMutation(binding, async (lease) => {
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          await adapter.createFolder(createdPath)
          if (!isCurrent()) throw new Error(t('alert.staleWrite'))
          lease.publish([{ kind: 'invalidated', path: createdPath }])
        })
        if (!isCurrent()) return
        const projected = applyCommittedWorkspaceProjection(binding, {
          kind: 'create-directory',
          path: createdPath
        })
        if (!projected) {
          await refreshWorkspace()
          if (!isCurrent()) return
        }
      } catch (err) {
        if (isCurrent()) {
          pushToast(t('alert.createFolderFailed', { error: errMsg(err) }), 'error')
        }
      }
    },
    [
      applyCommittedWorkspaceProjection,
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      promptText,
      refreshWorkspace,
      runCoordinatedWorkspaceMutation,
      pushToast
    ]
  )

  const requestPathDirtyDecision = useCallback(
    (
      count: number,
      request: { kind: PathDirtyPromptState['kind']; sourcePath: string }
    ): Promise<'save' | 'discard' | 'cancel'> =>
      new Promise((resolve) => {
        pathDirtyResolveRef.current?.('cancel')
        pathDirtyResolveRef.current = resolve
        setPathDirtyPrompt({ count, kind: request.kind, path: request.sourcePath })
      }),
    []
  )

  const updateUiAfterPathCommit = useCallback(
    async (
      plan: PathTransactionPlan,
      index: LiveWorkspaceIndex,
      drafts: DraftJournalCoordinator | null,
      isCurrent: () => boolean
    ): Promise<void> => {
      if (!isCurrent()) return
      const deletedIds = new Set(plan.request.kind === 'delete' ? plan.affectedSessionIds : [])
      const previousTabs = tabs

      if (plan.request.kind === 'delete') {
        const deletedMigrationById = new Map(
          plan.migrations.map((migration) => [migration.sessionId, migration] as const)
        )
        const isDeletedTab = (tab: Tab): boolean =>
          deletedIds.has(tab.key) ||
          Boolean(tab.relPath && migratedPathForPlan(plan, tab.relPath) === null)
        const deletedUiIds = new Set([
          ...deletedIds,
          ...previousTabs.filter(isDeletedTab).map((tab) => tab.key)
        ])
        for (const id of deletedUiIds) {
          if (!isCurrent()) return
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
          const migration = deletedMigrationById.get(id)
          if (migration) await drafts?.untrack(id, migration.incarnation)
          if (!isCurrent()) return
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
      const binding = captureWorkspaceOperation()
      const adapter = binding.adapter
      const controller = binding.controller
      if (!adapter || !controller) throw new Error(t('workspace.path.unavailable'))
      const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
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
        if (!isCurrent()) return 'failed'
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
      const releasePersistenceInteractionLock = acquirePersistenceInteractionLock()
      try {
        const history = binding.history
        const drafts = binding.drafts
        const mutatePath = createAdapterPathMutation(adapter, { history: history ?? undefined })
        let retryFinalize: (() => Promise<void>) | undefined
        const result = await opMutexRef.current
          .runExclusive(async () => {
            if (!isCurrent()) throw new Error(t('alert.staleWrite'))
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
                const lease = await acquireCoordinatedWorkspaceMutation(binding)
                let leaseReleased = false
                const releaseLease = async (): Promise<void> => {
                  if (leaseReleased) return
                  leaseReleased = true
                  try {
                    await lease.release()
                  } catch (error) {
                    pushToast(t('workspace.coordination.error', { error: errMsg(error) }), 'error')
                  }
                }
                const changedPaths =
                  readyPlan.request.kind === 'delete'
                    ? [
                        {
                          kind: 'deleted' as const,
                          path: readyPlan.request.sourcePath
                        }
                      ]
                    : [
                        {
                          kind: 'moved' as const,
                          path: readyPlan.request.destinationPath!,
                          previousPath: readyPlan.request.sourcePath
                        }
                      ]
                const invalidatedPaths = [
                  {
                    kind: 'invalidated' as const,
                    path: readyPlan.request.sourcePath
                  },
                  ...(readyPlan.request.destinationPath
                    ? [
                        {
                          kind: 'invalidated' as const,
                          path: readyPlan.request.destinationPath
                        }
                      ]
                    : [])
                ]
                try {
                  const mutation = await mutatePath(readyPlan)
                  retryFinalize = mutation.finalize
                  return {
                    rollback: async () => {
                      try {
                        await mutation.rollback()
                      } finally {
                        lease.publish(invalidatedPaths)
                        await releaseLease()
                      }
                    },
                    finalize: async () => {
                      try {
                        await mutation.finalize?.()
                      } finally {
                        lease.publish(changedPaths)
                        await releaseLease()
                      }
                    }
                  }
                } catch (error) {
                  lease.publish(invalidatedPaths)
                  await releaseLease()
                  throw error
                }
              },
              migrateDrafts: drafts
                ? (migrations) => drafts.migrateDraftRecords(migrations)
                : undefined
            })
          })
          .catch((error: unknown) => {
            if (!isCurrent()) return null
            throw error
          })
        if (!result) return 'failed'
        if (!isCurrent()) return 'failed'
        if (result.status === 'cancelled') return 'cancelled'
        if (result.status !== 'committed') {
          if (result.status === 'failed') {
            if (!result.rolledBack) {
              const evidence = `${result.plan.request.sourcePath}: ${errMsg(result.error)}`
              setPathRecovery(null)
              await refreshWorkspace()
              if (!isCurrent()) return 'failed'
              recordWorkspaceIssue(evidence, binding)
              if (binding.history) setHistoryOpen(true)
              pushToast(t('workspace.path.failed', { error: evidence }), 'error')
              return 'failed'
            }
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
        await updateUiAfterPathCommit(result.plan, binding.index, drafts, isCurrent)
        if (!isCurrent()) return 'failed'
        const projected = applyCommittedWorkspaceProjection(
          binding,
          result.plan.request.kind === 'delete'
            ? {
                kind: 'remove',
                path: result.plan.request.sourcePath,
                entryKind: result.plan.request.entryKind
              }
            : {
                kind: 'relocate',
                from: result.plan.request.sourcePath,
                to: result.plan.request.destinationPath!,
                entryKind: result.plan.request.entryKind
              }
        )
        if (!projected) {
          await refreshWorkspace()
          if (!isCurrent()) return 'failed'
        }
        if (result.finalizeError) {
          const transactionHash = await sha256Hex(new TextEncoder().encode(result.plan.id))
          if (!isCurrent()) return 'failed'
          const stagingPath = `${PATH_TRANSACTION_STAGING_ROOT}/tx-${transactionHash.slice(0, 32)}`
          const payloadPath = `${stagingPath}/payload`
          if (retryFinalize) {
            setPathRecovery({
              adapter,
              error: result.finalizeError,
              generation: binding.generation,
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
      } finally {
        releasePersistenceInteractionLock()
      }
    },
    [
      acquirePersistenceInteractionLock,
      acquireCoordinatedWorkspaceMutation,
      applyCommittedWorkspaceProjection,
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      refreshWorkspace,
      recordWorkspaceIssue,
      requestPathDirtyDecision,
      tabs,
      updateUiAfterPathCommit,
      pushToast
    ]
  )

  const handleRename = useCallback(
    async (node: LiteTreeNode) => {
      const binding = captureWorkspaceOperation()
      if (!binding.adapter) return
      const name = await promptText({
        title: t('dialog.rename.title'),
        label: t('dialog.rename.label'),
        initialValue: node.name,
        okLabel: t('dialog.rename.okLabel')
      })
      if (!name || name === node.name) return
      if (!isWorkspaceOperationCurrent(binding)) return
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
    [
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      promptText,
      runPathTransaction,
      pushToast
    ]
  )

  // Delete → confirm dialog (non-empty folders require typing the name).
  const handleDeleteRequest = useCallback(
    async (node: LiteTreeNode) => {
      const binding = captureWorkspaceOperation()
      const adapter = binding.adapter
      if (!adapter) return
      try {
        if (node.type === 'directory') {
          // Fail closed: an unreadable/failed listing must never weaken a
          // non-empty-folder confirmation into the simple delete dialog.
          const entries = await adapter.list(node.relPath)
          if (!isWorkspaceOperationCurrent(binding)) return
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
            binding,
            node,
            requireTyped: entries.length > 0 ? node.name : undefined
          })
        } else {
          if (!isWorkspaceOperationCurrent(binding)) return
          setDeleteTarget({ binding, node })
        }
      } catch (error) {
        if (isWorkspaceOperationCurrent(binding)) {
          pushToast(t('alert.deleteFailed', { error: errMsg(error) }), 'error')
        }
      }
    },
    [captureWorkspaceOperation, isWorkspaceOperationCurrent, pushToast]
  )

  const performDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    setDeleteTarget(null)
    if (!isWorkspaceOperationCurrent(target.binding)) return
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
  }, [deleteTarget, isWorkspaceOperationCurrent, runPathTransaction, pushToast])

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

  // --- import (ARIS AML/XML and explicit BPMN rejection) -------------------

  const beginWorkspaceImportOperation = useCallback((): AbortController => {
    workspaceImportAbortRef.current?.abort()
    const controller = new AbortController()
    workspaceImportAbortRef.current = controller
    setWorkspaceImportReview(null)
    return controller
  }, [])

  const materializeWorkspaceImportSources = useCallback(
    async (
      entries: readonly DroppedBpmn[],
      controller: AbortController,
      isCurrent: () => boolean
    ): Promise<readonly WorkspaceImportSource[]> => {
      if (entries.length > DEFAULT_WORKSPACE_IMPORT_LIMITS.maxSources) {
        throw new Error(
          `Workspace import has ${entries.length} sources; limit is ${DEFAULT_WORKSPACE_IMPORT_LIMITS.maxSources}.`
        )
      }
      const sources: WorkspaceImportSource[] = []
      let totalBytes = 0
      for (const [index, entry] of entries.entries()) {
        if (controller.signal.aborted || !isCurrent()) {
          throw new DOMException('Workspace import was cancelled.', 'AbortError')
        }
        const text = await entry.getText()
        if (controller.signal.aborted || !isCurrent()) {
          throw new DOMException('Workspace import was cancelled.', 'AbortError')
        }
        const bytes = new TextEncoder().encode(text).byteLength
        assertImportAllocationSize(bytes, entry.relPath)
        totalBytes += bytes
        if (totalBytes > DEFAULT_WORKSPACE_IMPORT_LIMITS.maxTotalSourceCharacters) {
          throw new Error(
            `Workspace import exceeds the ${DEFAULT_WORKSPACE_IMPORT_LIMITS.maxTotalSourceCharacters}-byte total limit.`
          )
        }
        sources.push({
          kind: 'document',
          id: `document:${String(index + 1).padStart(6, '0')}:${entry.relPath}`,
          name: entry.name,
          relPath: entry.relPath,
          text
        })
      }
      return Object.freeze(sources)
    },
    []
  )

  const prepareWorkspaceImportReview = useCallback(
    async (
      sources: readonly WorkspaceImportSource[],
      targetFolder: string,
      binding: WorkspaceOperationBinding,
      controller: AbortController
    ): Promise<boolean> => {
      const adapter = binding.adapter
      const isCurrent = (): boolean =>
        !controller.signal.aborted &&
        workspaceImportAbortRef.current === controller &&
        isWorkspaceOperationCurrent(binding)
      if (!adapter?.storage.capabilities.multipleFiles) {
        if (isCurrent()) pushToast(t('toast.import.openFolderFirst'), 'info')
        return false
      }
      const acceptedSources = sources.filter((source) => {
        if (source.kind !== 'document') return true
        return classifyImportBoundarySource(source.name, source.text) === 'candidate'
      })
      const rejectedBpmnCount = sources.length - acceptedSources.length
      if (rejectedBpmnCount > 0 && isCurrent()) {
        pushToast(t('toast.import.arisOnly'), 'info')
      }
      if (acceptedSources.length === 0) {
        if (rejectedBpmnCount > 0) return false
        if (isCurrent()) pushToast(t('toast.import.noBpmnFound'), 'info')
        return false
      }
      const localizationSnapshot = workspaceLocalizationSnapshotRef.current
      if (!localizationSnapshot) {
        if (isCurrent()) {
          pushToast(
            t('settings.localization.loadFailed', {
              error: workspaceLocalizationError ?? t('workspace.history.unknownError')
            }),
            'error'
          )
        }
        return false
      }
      try {
        const plan = await prepareWorkspaceImportPlan({
          adapter,
          sources: acceptedSources,
          targetFolder,
          language: langRef.current,
          existingProcessIndex: binding.index.processIndex(),
          localizationResources: localizationSnapshot.resources,
          localizationReview: reviewedXmlReviewQueueRef.current!.review,
          validationAdapters: getRuntimeValidationAdapters(),
          signal: controller.signal
        })
        if (!isCurrent()) return false
        setWorkspaceImportReview({
          binding,
          controller,
          plan,
          sources,
          targetFolder,
          decisions: Object.freeze({}),
          busy: false,
          error: null
        })
        return true
      } catch (error) {
        if (isCurrent()) {
          pushToast(t('alert.import.failed', { error: errMsg(error) }), 'error')
        }
        return false
      }
    },
    [isWorkspaceOperationCurrent, pushToast, workspaceLocalizationError]
  )

  const handleImportDrop = useCallback(
    (dt: DataTransfer, toFolderRel: string) => {
      const binding = captureWorkspaceOperation()
      const controller = beginWorkspaceImportOperation()
      void (async () => {
        try {
          const entries = await collectDroppedBpmn(dt)
          const isCurrent = (): boolean =>
            !controller.signal.aborted &&
            workspaceImportAbortRef.current === controller &&
            isWorkspaceOperationCurrent(binding)
          if (!isCurrent()) return
          const sources = await materializeWorkspaceImportSources(entries, controller, isCurrent)
          if (!isCurrent()) return
          await prepareWorkspaceImportReview(sources, toFolderRel, binding, controller)
        } catch (err) {
          if (
            !controller.signal.aborted &&
            workspaceImportAbortRef.current === controller &&
            isWorkspaceOperationCurrent(binding)
          ) {
            pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
          }
        }
      })()
    },
    [
      beginWorkspaceImportOperation,
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      materializeWorkspaceImportSources,
      prepareWorkspaceImportReview,
      pushToast
    ]
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
      const binding = captureWorkspaceOperation()
      const controller = beginWorkspaceImportOperation()
      try {
        const entries: DroppedBpmn[] = files
          .filter((f) => /\.(bpmn|aml|apc|xml)$/i.test(f.name))
          .map((f) => ({
            relPath: f.name,
            name: f.name,
            getText: () => readBrowserImportFile(f, controller.signal)
          }))
        const isCurrent = (): boolean =>
          !controller.signal.aborted &&
          workspaceImportAbortRef.current === controller &&
          isWorkspaceOperationCurrent(binding)
        const sources = await materializeWorkspaceImportSources(entries, controller, isCurrent)
        if (!isCurrent()) return
        await prepareWorkspaceImportReview(sources, '', binding, controller)
      } catch (err) {
        if (
          !controller.signal.aborted &&
          workspaceImportAbortRef.current === controller &&
          isWorkspaceOperationCurrent(binding)
        ) {
          pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
        }
      }
    },
    [
      beginWorkspaceImportOperation,
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      materializeWorkspaceImportSources,
      prepareWorkspaceImportReview,
      pushToast
    ]
  )

  const cancelWorkspaceImportReview = useCallback(() => {
    const current = workspaceImportReview
    if (current?.busy) return
    current?.controller.abort()
    if (workspaceImportAbortRef.current === current?.controller) {
      workspaceImportAbortRef.current = null
    }
    setWorkspaceImportReview(null)
  }, [workspaceImportReview])

  const updateWorkspaceImportDecision = useCallback(
    (artifactId: string, decision: WorkspaceImportCollisionDecision | undefined): void => {
      setWorkspaceImportReview((current) => {
        if (!current || current.busy) return current
        const decisions = { ...current.decisions }
        if (decision) decisions[artifactId] = decision
        else delete decisions[artifactId]
        return { ...current, decisions: Object.freeze(decisions), error: null }
      })
    },
    []
  )

  const reloadWorkspaceLocalizationResources = useCallback(
    async (binding: WorkspaceOperationBinding, reason: string): Promise<boolean> => {
      const localizationBinding = workspaceLocalizationBindingRef.current
      const isCurrent = (): boolean =>
        isWorkspaceOperationCurrent(binding) &&
        workspaceLocalizationBindingRef.current === localizationBinding &&
        localizationBinding !== null &&
        localizationBinding.adapter === binding.adapter &&
        localizationBinding.generation === binding.generation &&
        !localizationBinding.controller.signal.aborted
      if (!localizationBinding || !isCurrent()) return false
      try {
        const next = await loadWorkspaceLocalizationCoordinated(localizationBinding, binding)
        if (!isCurrent()) return false
        commitWorkspaceLocalizationSnapshot(localizationBinding, next)
        return true
      } catch (error) {
        if (!isCurrent()) return false
        const message = `${reason}: ${errMsg(error)}`
        workspaceLocalizationSnapshotRef.current = null
        setWorkspaceLocalizationSnapshot(null)
        setWorkspaceLocalizationError(message)
        setWorkspaceLocalizationErrorCode(localizationFailureCode(error))
        recordWorkspaceIssue(message, binding)
        pushToast(
          t('settings.localization.loadFailed', {
            error: message
          }),
          'error'
        )
        return false
      }
    },
    [
      commitWorkspaceLocalizationSnapshot,
      isWorkspaceOperationCurrent,
      loadWorkspaceLocalizationCoordinated,
      pushToast,
      recordWorkspaceIssue
    ]
  )

  const synchronizeCommittedBpmnSnapshot = useCallback(
    async (
      binding: WorkspaceOperationBinding,
      destinationPath: string,
      snapshot: FileSnapshot,
      source: LocalizationSourceType,
      isCurrent: () => boolean,
      expectedSession: OpenSessionCommitGuard | null
    ): Promise<boolean> => {
      const sessionController = binding.controller
      const workspace = binding.identity
      if (!sessionController || !workspace || !isCurrent()) return false
      let xml: string
      try {
        xml = decodeUtf8Strict(snapshot.bytes, {
          operation: 'read',
          path: destinationPath
        })
      } catch (error) {
        const evidence = `${destinationPath}: ${errMsg(error)}`
        recordWorkspaceIssue(evidence, binding)
        pushToast(t('session.save.reloadEditorFailed', { error: evidence }), 'error')
        return true
      }
      baseHashByPathRef.current[destinationPath] = snapshot.hash
      binding.index.updateSaved({
        relPath: destinationPath,
        xml,
        lastModified: snapshot.modifiedAt,
        size: snapshot.size
      })
      localizationSourceByTabRef.current.set(destinationPath, source)

      const foundSession = sessionController.store.getByIdentity({
        workspace,
        path: destinationPath
      })
      if (!foundSession) return true
      let openSession: DocumentSession = foundSession
      localizationSourceByTabRef.current.set(openSession.id, source)
      const fingerprint = fingerprintFromSnapshot(snapshot)
      const modeler = modelersByKeyRef.current[openSession.id] as
        { importXML?: (candidate: string) => Promise<unknown> } | undefined
      const applyToEditor = async (
        candidate: string,
        options?: { dirty?: boolean; baselineXml?: string }
      ): Promise<void> => {
        const coordinatedApply = commandsRef.current[openSession.id]?.applyExternalXml
        invalidateLiveXmlCapture(openSession.id)
        if (coordinatedApply) {
          await coordinatedApply(candidate, options)
          return
        }
        if (modeler?.importXML) {
          throw new Error('The editor synchronization command is not ready.')
        }
      }

      const currentSession = (): DocumentSession | null => {
        const current = sessionController.store.get(openSession.id)
        return current?.incarnation === openSession.incarnation ? current : null
      }
      const updateUi = (
        session: DocumentSession,
        options: { replaceContents?: boolean; forceDirty?: boolean } = {}
      ): void => {
        const dirty = options.forceDirty || session.dirty
        if (options.replaceContents) {
          setContents((current) => ({ ...current, [session.id]: session.currentXml }))
        }
        dirtyByKeyRef.current = {
          ...dirtyByKeyRef.current,
          [session.id]: dirty
        }
        setDirtyByKey((current) => ({ ...current, [session.id]: dirty }))
        if (dirty) {
          binding.index.updateDirty(destinationPath, session.currentXml)
        } else {
          binding.index.clearDirty(destinationPath)
        }
      }
      const reportRetainedEditor = (reason: string): void => {
        if (!isCurrent()) return
        const evidence = `${destinationPath}: ${reason}`
        recordWorkspaceIssue(evidence, binding)
        pushToast(t('session.save.reloadEditorFailed', { error: evidence }), 'error')
      }
      const preserveUncapturedEditor = async (
        fallbackXml: string,
        reason: string,
        captureError: unknown
      ): Promise<boolean> => {
        if (!isCurrent()) return false
        const current = currentSession()
        if (!current) return false
        const retainedXml = current.currentXml !== xml ? current.currentXml : fallbackXml
        const retained = sessionController.store.replaceWithExternal(current.id, {
          xml,
          reviewedXml: retainedXml,
          fingerprint
        })
        localizationSourceByTabRef.current.set(destinationPath, LocalizationSource.Editor)
        localizationSourceByTabRef.current.set(retained.id, LocalizationSource.Editor)
        binding.drafts?.track(retained)
        try {
          await binding.drafts?.flush(retained.id, retained.incarnation)
        } catch (draftError) {
          if (isCurrent()) {
            recordWorkspaceIssue(`${destinationPath}: ${errMsg(draftError)}`, binding)
          }
        }
        if (!isCurrent()) return false
        const latest = currentSession()
        if (!latest) return false
        if (latest.dirty) binding.drafts?.track(latest)
        // The canvas contains XML that could not be serialized. Never change
        // the React `xml` prop or import a fallback over that live canvas.
        updateUi(latest, { forceDirty: true })
        reportRetainedEditor(
          t('session.save.retainedEditorCaptureFailed', {
            reason,
            error: errMsg(captureError)
          })
        )
        return true
      }
      const retainLocalXml = async (
        preferredXml: string,
        reason: string,
        restoreModeler: boolean
      ): Promise<boolean> => {
        if (!isCurrent()) return false
        const current = currentSession()
        if (!current) return false
        const retainedXml =
          current.currentXml !== xml && current.revision !== openSession.revision
            ? current.currentXml
            : preferredXml
        let retained = sessionController.store.replaceWithExternal(current.id, {
          xml,
          reviewedXml: retainedXml,
          fingerprint
        })
        let replaceContents = restoreModeler
        localizationSourceByTabRef.current.set(destinationPath, LocalizationSource.Editor)
        localizationSourceByTabRef.current.set(retained.id, LocalizationSource.Editor)
        if (restoreModeler && retained.currentXml !== xml) {
          const restoreRevision = retained.revision
          const restoreXml = retained.currentXml
          try {
            await applyToEditor(retained.currentXml, {
              dirty: true,
              baselineXml: xml
            })
          } catch (restoreError) {
            replaceContents = false
            if (isCurrent()) {
              recordWorkspaceIssue(`${destinationPath}: ${errMsg(restoreError)}`, binding)
            }
          }
          if (!isCurrent()) return false
          const afterRestore = currentSession()
          if (!afterRestore) return false
          if (
            afterRestore.revision !== restoreRevision ||
            afterRestore.currentXml !== restoreXml ||
            dirtyByKeyRef.current[afterRestore.id]
          ) {
            replaceContents = false
          }
          retained = afterRestore
        }

        let stable = false
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (dirtyByKeyRef.current[retained.id]) {
            const captured = await captureLiveSession(sessionController, retained, true, isCurrent)
            if (captured.status === 'stale') return false
            if (captured.status === 'unavailable') {
              return preserveUncapturedEditor(preferredXml, reason, captured.error)
            }
            if (
              captured.session.revision !== retained.revision ||
              captured.session.currentXml !== retained.currentXml
            ) {
              replaceContents = false
            }
            retained = captured.session
          }

          binding.drafts?.track(retained)
          try {
            await binding.drafts?.flush(retained.id, retained.incarnation)
          } catch (draftError) {
            if (isCurrent()) {
              recordWorkspaceIssue(`${destinationPath}: ${errMsg(draftError)}`, binding)
            }
          }
          if (!isCurrent()) return false

          let latest = currentSession()
          if (!latest) return false
          if (dirtyByKeyRef.current[latest.id]) {
            const captured = await captureLiveSession(sessionController, latest, true, isCurrent)
            if (captured.status === 'stale') return false
            if (captured.status === 'unavailable') {
              return preserveUncapturedEditor(preferredXml, reason, captured.error)
            }
            latest = captured.session
          }
          if (latest.revision === retained.revision && latest.currentXml === retained.currentXml) {
            retained = latest
            stable = true
            break
          }
          replaceContents = false
          retained = latest
        }

        if (!stable) {
          binding.drafts?.track(retained)
          updateUi(retained, { forceDirty: true })
          reportRetainedEditor(t('session.save.retainedEditorChangedDuringRecovery', { reason }))
          return true
        }
        // Retained XML is already visible in the live modeler. Changing the
        // React prop here would import it again and erase newer command-stack
        // state, so update only dirty/index evidence.
        updateUi(retained, { replaceContents })
        reportRetainedEditor(reason)
        return true
      }

      const guardMatches =
        expectedSession !== null &&
        openSession.id === expectedSession.id &&
        openSession.incarnation === expectedSession.incarnation &&
        openSession.revision === expectedSession.revision &&
        openSession.currentXml === expectedSession.currentXml &&
        !expectedSession.uiDirty &&
        !dirtyByKeyRef.current[openSession.id]
      if (!guardMatches) {
        if (dirtyByKeyRef.current[openSession.id]) {
          const captured = await captureLiveSession(sessionController, openSession, true, isCurrent)
          if (captured.status === 'stale') return false
          if (captured.status === 'unavailable') {
            return preserveUncapturedEditor(
              openSession.currentXml,
              t('workspace.sync.reviewedImportEditorChanged'),
              captured.error
            )
          }
          openSession = captured.session
        }
        return retainLocalXml(
          openSession.currentXml,
          t('workspace.sync.reviewedImportLocalRetained'),
          false
        )
      }

      const previousXml = openSession.currentXml
      const replaced = sessionController.store.replaceWithExternal(openSession.id, {
        xml,
        fingerprint
      })
      const synchronizedRevision = replaced.revision
      try {
        await applyToEditor(xml)
      } catch (error) {
        return retainLocalXml(previousXml, errMsg(error), true)
      }
      if (!isCurrent()) return false
      const afterImport = currentSession()
      if (!afterImport) return false
      if (
        afterImport.revision !== synchronizedRevision ||
        afterImport.currentXml !== xml ||
        dirtyByKeyRef.current[afterImport.id]
      ) {
        let retained = afterImport
        const immediateEditorDirty = Boolean(dirtyByKeyRef.current[afterImport.id])
        if (dirtyByKeyRef.current[afterImport.id]) {
          const captured = await captureLiveSession(sessionController, afterImport, true, isCurrent)
          if (captured.status === 'stale') return false
          if (captured.status === 'unavailable') {
            return preserveUncapturedEditor(
              previousXml,
              t('workspace.sync.committedReloadEditorChanged'),
              captured.error
            )
          }
          retained = captured.session
        }
        openSession = retained
        return retainLocalXml(
          retained.currentXml,
          t('workspace.sync.committedReloadLocalRetained'),
          !immediateEditorDirty
        )
      }

      try {
        await binding.drafts?.confirmedSave(afterImport.id, afterImport.incarnation, xml)
      } catch (draftError) {
        if (isCurrent()) {
          recordWorkspaceIssue(`${destinationPath}: ${errMsg(draftError)}`, binding)
        }
      }
      if (!isCurrent()) return false
      const finalSession = currentSession()
      if (!finalSession) return false
      if (
        finalSession.revision !== synchronizedRevision ||
        finalSession.currentXml !== xml ||
        finalSession.dirty ||
        dirtyByKeyRef.current[finalSession.id]
      ) {
        openSession = finalSession
        return retainLocalXml(
          finalSession.currentXml,
          t('workspace.sync.postCommitCleanupLocalRetained'),
          !dirtyByKeyRef.current[finalSession.id]
        )
      }
      updateUi(finalSession, { replaceContents: true })
      return true
    },
    [captureLiveSession, invalidateLiveXmlCapture, pushToast, recordWorkspaceIssue]
  )

  const reconcileBpmnPathsFromStorage = useCallback(
    async (
      binding: WorkspaceOperationBinding,
      paths: readonly string[],
      source: LocalizationSourceType,
      guards: ReadonlyMap<string, OpenSessionCommitGuard | null>
    ): Promise<void> => {
      const adapter = binding.adapter
      if (!adapter) return
      const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
      const uniquePaths = [
        ...new Set(
          paths
            .flatMap((path) => {
              try {
                return [normalizeWorkspacePath(path)]
              } catch (error) {
                recordWorkspaceIssue(`${path}: ${errMsg(error)}`, binding)
                return []
              }
            })
            .filter(
              (path) =>
                /\.bpmn$/iu.test(path) && !path.toLocaleLowerCase('en-US').startsWith('.orbitpm/')
            )
        )
      ]
      for (const path of uniquePaths) {
        if (!isCurrent()) return
        try {
          const snapshot = await adapter.read(path)
          if (!isCurrent()) return
          const synchronized = await synchronizeCommittedBpmnSnapshot(
            binding,
            path,
            snapshot,
            source,
            isCurrent,
            guards.get(path.toLocaleLowerCase('en-US')) ?? null
          )
          if (!synchronized || !isCurrent()) return
        } catch (error) {
          if (!isCurrent()) return
          const evidence = `${path}: ${errMsg(error)}`
          recordWorkspaceIssue(evidence, binding)
          pushToast(t('session.save.reloadEditorFailed', { error: evidence }), 'error')
        }
      }
      if (!isCurrent()) return
      setLiveWorkspaceVersion(binding.index.version)
    },
    [isWorkspaceOperationCurrent, pushToast, recordWorkspaceIssue, synchronizeCommittedBpmnSnapshot]
  )

  const handleConfirmWorkspaceImport = useCallback(async () => {
    const state = workspaceImportReview
    const adapter = state?.binding.adapter
    const sessionController = state?.binding.controller
    if (!state || !adapter || !sessionController || state.busy) return
    const { binding, controller, plan } = state
    const operationIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      workspaceImportAbortRef.current === controller &&
      isWorkspaceOperationCurrent(binding)
    const bindingIsCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
    if (!operationIsCurrent()) return
    let storageCommitted = false
    setWorkspaceImportReview((current) =>
      current?.controller === controller ? { ...current, busy: true, error: null } : current
    )
    const releasePersistenceInteractionLock = acquirePersistenceInteractionLock()
    try {
      const confirmed = confirmWorkspaceImportPlan(plan, {
        accepted: true,
        reviewedDigest: plan.reviewDigest,
        collisionDecisions: state.decisions
      })
      const replacedPaths = new Set(
        plan.collisions
          .filter(
            (collision) => confirmed.collisionDecisions[collision.artifactId]?.action === 'replace'
          )
          .map((collision) => collision.path.toLocaleLowerCase('en-US'))
      )
      const affectedSessions = sessionController.store
        .list()
        .filter(
          (session) =>
            session.identity.path !== null &&
            replacedPaths.has(session.identity.path.toLocaleLowerCase('en-US'))
        )
      const dirtySessions = affectedSessions.filter(
        (session) => session.dirty || Boolean(dirtyByKeyRef.current[session.id])
      )
      if (dirtySessions.length > 0) {
        const choice = await requestPathDirtyDecision(dirtySessions.length, {
          kind: 'import',
          sourcePath: [...replacedPaths].join(', ')
        })
        if (!operationIsCurrent()) return
        if (choice === 'cancel') {
          setWorkspaceImportReview((current) =>
            current?.controller === controller ? { ...current, busy: false } : current
          )
          return
        }
        if (choice === 'save') {
          let saveError: unknown
          try {
            for (const captured of dirtySessions) {
              const current = sessionController.store.get(captured.id)
              if (
                !operationIsCurrent() ||
                !current ||
                current.incarnation !== captured.incarnation
              ) {
                throw new Error(t('alert.staleWrite'))
              }
              const tab = tabsRef.current.find((candidate) => candidate.key === captured.id)
              if (!tab) throw new Error(t('session.save.failed', { status: 'missing-tab' }))
              const live = await captureLiveSession(
                sessionController,
                current,
                true,
                operationIsCurrent
              )
              if (live.status === 'stale') throw new Error(t('alert.staleWrite'))
              if (live.status === 'unavailable') {
                throw new Error(
                  t('session.save.reloadEditorFailed', {
                    error: errMsg(live.error)
                  })
                )
              }
              const saved = await requestSaveRef.current(tab, live.session.currentXml)
              if (!saved.durable) {
                throw new Error(t('session.save.failed', { status: 'not-durable' }))
              }
            }
          } catch (error) {
            saveError = error
          }
          if (!operationIsCurrent()) return
          setWorkspaceImportReview(null)
          await prepareWorkspaceImportReview(state.sources, state.targetFolder, binding, controller)
          if (saveError) throw saveError
          return
        }
        await discardAndCloseSessions(binding, dirtySessions, operationIsCurrent)
        if (!operationIsCurrent()) return
        setWorkspaceImportReview(null)
        await prepareWorkspaceImportReview(state.sources, state.targetFolder, binding, controller)
        return
      }

      const sessionGuards = new Map<string, OpenSessionCommitGuard | null>()
      for (const session of sessionController.store.list()) {
        if (!session.identity.path) continue
        sessionGuards.set(
          normalizeWorkspacePath(session.identity.path).toLocaleLowerCase('en-US'),
          {
            id: session.id,
            incarnation: session.incarnation,
            revision: session.revision,
            currentXml: session.currentXml,
            uiDirty: Boolean(dirtyByKeyRef.current[session.id])
          }
        )
      }
      const outcome = await executeConfirmedWorkspaceImport(confirmed, {
        adapter,
        history: binding.history ?? undefined,
        currentProcessIndex: binding.index.processIndex(),
        signal: controller.signal,
        runExclusive: (operation) =>
          runCoordinatedWorkspaceMutation(
            binding,
            async (lease) => {
              const result = await operation()
              if (result.status === 'committed') {
                lease.publish([
                  ...result.applied.map((item) => ({
                    kind: 'saved' as const,
                    path: item.destinationPath,
                    fingerprint: {
                      hash: item.snapshot.hash,
                      size: item.snapshot.size,
                      modifiedAt: item.snapshot.modifiedAt
                    }
                  })),
                  ...(binding.history
                    ? [{ kind: 'invalidated' as const, path: '.orbitpm/history' }]
                    : [])
                ])
              } else if (result.status === 'rolled-back') {
                lease.publish([
                  ...result.appliedBeforeFailure.map((item) => ({
                    kind: item.replaced ? ('saved' as const) : ('deleted' as const),
                    path: item.destinationPath
                  })),
                  ...(binding.history
                    ? [{ kind: 'invalidated' as const, path: '.orbitpm/history' }]
                    : [])
                ])
              } else if (result.status === 'rollback-failed') {
                lease.publish([
                  ...result.appliedBeforeFailure.map((item) => ({
                    kind: 'invalidated' as const,
                    path: item.destinationPath
                  })),
                  ...(binding.history
                    ? [{ kind: 'invalidated' as const, path: '.orbitpm/history' }]
                    : [])
                ])
              }
              return result
            },
            controller.signal
          )
      })
      if (outcome.status !== 'committed') {
        if (!bindingIsCurrent()) return
        const applied = outcome.appliedBeforeFailure.map((item) => item.destinationPath).join(', ')
        const rollback = outcome.rollbackErrors
          .map((failure) => `${failure.path ?? '?'}: ${failure.message}`)
          .join('; ')
        const evidence = t('workspace.import.rollbackEvidence', {
          error: outcome.error.message,
          review: outcome.evidence.reviewDigest,
          applied: applied || t('workspace.diagnostic.none'),
          rollback: rollback || t('workspace.diagnostic.complete')
        })
        if (outcome.status === 'rollback-failed') {
          try {
            await refreshWorkspace(rootHandleRef.current ?? undefined)
          } catch (refreshError) {
            recordWorkspaceIssue(`${t('breadcrumb.root')}: ${errMsg(refreshError)}`, binding)
          }
          if (!bindingIsCurrent()) return
          const affectedPaths = [
            ...outcome.appliedBeforeFailure.map((item) => item.destinationPath),
            ...outcome.rollbackErrors.flatMap((failure) => (failure.path ? [failure.path] : []))
          ]
          await reconcileBpmnPathsFromStorage(
            binding,
            affectedPaths,
            LocalizationSource.Xml,
            sessionGuards
          )
          if (affectedPaths.some(isWorkspaceLocalizationResourcePath)) {
            await reloadWorkspaceLocalizationResources(
              binding,
              t('workspace.localization.workspaceImportRollbackUncertain')
            )
          }
          if (!bindingIsCurrent()) return
          recordWorkspaceIssue(evidence, binding)
          if (binding.history) setHistoryOpen(true)
          setWorkspaceImportReview(null)
          controller.abort()
          if (workspaceImportAbortRef.current === controller) {
            workspaceImportAbortRef.current = null
          }
        } else {
          setWorkspaceImportReview((current) =>
            current?.controller === controller
              ? { ...current, busy: false, error: evidence }
              : current
          )
        }
        pushToast(t('alert.import.failed', { error: evidence }), 'error')
        return
      }

      storageCommitted = true
      if (!bindingIsCurrent()) return
      const artifactsBySourcePath = new Map(
        plan.artifacts.map((artifact) => [
          artifact.destinationPath.toLocaleLowerCase('en-US'),
          artifact
        ])
      )
      for (const applied of outcome.applied) {
        if (!bindingIsCurrent()) return
        const artifact = artifactsBySourcePath.get(applied.sourcePath.toLocaleLowerCase('en-US'))
        const synchronized = await synchronizeCommittedBpmnSnapshot(
          binding,
          applied.destinationPath,
          applied.snapshot,
          artifact?.sourceKind === 'aml' ? LocalizationSource.Aris : LocalizationSource.Xml,
          bindingIsCurrent,
          sessionGuards.get(
            normalizeWorkspacePath(applied.destinationPath).toLocaleLowerCase('en-US')
          ) ?? null
        )
        if (!synchronized) return
      }
      setLiveWorkspaceVersion(binding.index.version)
      try {
        await refreshWorkspace(rootHandleRef.current ?? undefined)
      } catch (refreshError) {
        recordWorkspaceIssue(`${t('breadcrumb.root')}: ${errMsg(refreshError)}`, binding)
      }
      if (!bindingIsCurrent()) return
      for (const warning of outcome.postCommitWarnings) {
        recordWorkspaceIssue(
          t('workspace.import.postCommitTechnicalEvidence', {
            error: warning
          }),
          binding
        )
        pushToast(t('workspace.import.postCommitWarning'), 'error')
      }
      setWorkspaceImportReview(null)
      pushToast(
        t('toast.imported.count', {
          count: outcome.applied.length,
          plural: outcome.applied.length === 1 ? '' : 's'
        }),
        'success'
      )
    } catch (error) {
      if (storageCommitted && bindingIsCurrent()) {
        const evidence = t('workspace.import.postCommitTechnicalEvidence', {
          error: errMsg(error)
        })
        setWorkspaceImportReview(null)
        recordWorkspaceIssue(evidence, binding)
        pushToast(t('workspace.import.postCommitReconciliationFailed'), 'error')
      } else if (operationIsCurrent()) {
        const message = errMsg(error)
        setWorkspaceImportReview((current) =>
          current?.controller === controller ? { ...current, busy: false, error: message } : current
        )
        pushToast(t('alert.import.failed', { error: message }), 'error')
      }
    } finally {
      releasePersistenceInteractionLock()
      if (storageCommitted) {
        controller.abort()
        if (workspaceImportAbortRef.current === controller) {
          workspaceImportAbortRef.current = null
        }
      }
    }
  }, [
    acquirePersistenceInteractionLock,
    captureLiveSession,
    discardAndCloseSessions,
    isWorkspaceOperationCurrent,
    prepareWorkspaceImportReview,
    pushToast,
    reconcileBpmnPathsFromStorage,
    recordWorkspaceIssue,
    refreshWorkspace,
    reloadWorkspaceLocalizationResources,
    requestPathDirtyDecision,
    runCoordinatedWorkspaceMutation,
    synchronizeCommittedBpmnSnapshot,
    workspaceImportReview
  ])

  const downloadWorkspaceImportArisReport = useCallback(
    (sourceId: string) => {
      const evidence = workspaceImportReview?.plan.arisReports.find(
        (candidate) => candidate.sourceId === sourceId
      )
      if (!evidence) return
      downloadBlob(
        evidence.download.fileName,
        new Blob([evidence.download.text], { type: evidence.download.mimeType })
      )
    },
    [workspaceImportReview]
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
      const intent = beginWorkspaceActivationIntent()
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const controller = new AbortController()
      singleFileImportAbortRef.current = controller
      const isCurrent = (): boolean =>
        !controller.signal.aborted &&
        singleFileImportAbortRef.current === controller &&
        isWorkspaceActivationIntentCurrent(intent)
      try {
        const sourceXml = await readBrowserImportFile(file, controller.signal)
        if (!isCurrent()) return
        const inspected = await secureBpmnImportPreparer.inspect(sourceXml, controller.signal)
        if (!isCurrent()) return
        const prepared = await secureBpmnImportPreparer.prepare(sourceXml, {
          knownProcessIds: new Set(inspected.processIds),
          validationAdapters: getRuntimeValidationAdapters(),
          signal: controller.signal
        })
        if (!isCurrent()) return
        if (
          prepared.autoLayouted &&
          !(await requestGeneratedLayoutReview(prepared.xml, controller.signal))
        ) {
          return
        }
        if (!isCurrent()) return
        const reviewed = await reviewBpmnXmlLocalization(prepared.xml, {
          source: LocalizationSource.Xml,
          target: langRef.current,
          defaultActive: langRef.current,
          resources: DEFAULT_LOCALIZATION_RESOURCES,
          validation: {
            adapters: getRuntimeValidationAdapters(),
            knownProcessIds: inspected.processIds,
            requireDi: true
          },
          validationAction: 'commit-import',
          review: reviewedXmlReviewQueueRef.current!.review,
          signal: controller.signal,
          isCurrent
        })
        if (!isCurrent() || reviewed.status !== 'completed') return
        const proceed = await guardWorkspaceSwitch()
        if (!proceed || !isCurrent()) return
        await activateSingleFileDocument(file.name, reviewed.xml, LocalizationSource.Xml, {
          claimedIntent: intent,
          durableXml: sourceXml,
          signal: controller.signal
        })
      } catch (err) {
        if (isCurrent()) {
          pushToast(t('alert.open.failed', { error: errMsg(err) }), 'error')
        }
      } finally {
        if (singleFileImportAbortRef.current === controller) {
          singleFileImportAbortRef.current = null
        }
      }
    },
    [
      activateSingleFileDocument,
      beginWorkspaceActivationIntent,
      guardWorkspaceSwitch,
      isWorkspaceActivationIntentCurrent,
      pushToast,
      requestGeneratedLayoutReview
    ]
  )

  const startBlankDiagram = useCallback(() => {
    const intent = beginWorkspaceActivationIntent()
    void (async () => {
      const proceed = await guardWorkspaceSwitch()
      if (!proceed || !isWorkspaceActivationIntentCurrent(intent)) return
      await activateSingleFileDocument(
        'untitled.bpmn',
        createNewDiagramXml(),
        LocalizationSource.Editor,
        { claimedIntent: intent, initiallyDirty: true }
      )
    })()
  }, [
    activateSingleFileDocument,
    beginWorkspaceActivationIntent,
    guardWorkspaceSwitch,
    isWorkspaceActivationIntentCurrent
  ])

  const handleExportWorkspaceBackup = useCallback(async () => {
    const binding = captureWorkspaceOperation()
    const adapter = binding.adapter
    if (!adapter) return
    const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
    setBackupBusy(true)
    try {
      if (tabs.some((tab) => dirtyByKey[tab.key])) await saveAllDirty()
      if (!isCurrent()) return
      const blob = await adapter.exportBackup()
      if (!isCurrent()) return
      const safeName =
        (rootName || 'orbitpm-workspace')
          .replace(/[^A-Za-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'orbitpm-workspace'
      downloadBlob(`${safeName}-backup.zip`, blob)
      pushToast(t('workspace.storage.backupExport'), 'success')
    } catch (error) {
      if (isCurrent()) {
        pushToast(t('alert.import.failed', { error: errMsg(error) }), 'error')
      }
    } finally {
      if (isCurrent()) setBackupBusy(false)
    }
  }, [
    captureWorkspaceOperation,
    dirtyByKey,
    isWorkspaceOperationCurrent,
    pushToast,
    rootName,
    saveAllDirty,
    tabs
  ])

  const onBackupInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const backup = event.target.files?.[0]
      event.target.value = ''
      const binding = captureWorkspaceOperation()
      const adapter = binding.adapter
      if (!backup || !adapter || !adapter.storage.capabilities.multipleFiles) {
        return
      }
      backupImportAbortRef.current?.abort()
      setBackupImportState(null)
      const controller = new AbortController()
      backupImportAbortRef.current = controller
      const isCurrent = (): boolean =>
        !controller.signal.aborted &&
        backupImportAbortRef.current === controller &&
        isWorkspaceOperationCurrent(binding)
      const localizationSnapshot = workspaceLocalizationSnapshotRef.current
      if (!localizationSnapshot) {
        controller.abort()
        if (backupImportAbortRef.current === controller) {
          backupImportAbortRef.current = null
        }
        pushToast(
          t('settings.localization.loadFailed', {
            error: workspaceLocalizationError ?? t('workspace.history.unknownError')
          }),
          'error'
        )
        return
      }
      setBackupBusy(true)
      const releasePersistenceInteractionLock = acquirePersistenceInteractionLock()
      try {
        const plan = await inspectWorkspaceBackup(adapter, backup, {
          targetLanguage: langRef.current,
          localizationResources: localizationSnapshot.resources,
          localizationReview: reviewedXmlReviewQueueRef.current!.review,
          validationAdapters: getRuntimeValidationAdapters(),
          signal: controller.signal,
          isCurrent
        })
        if (!isCurrent()) return
        setBackupImportState({ binding, controller, backup, plan })
      } catch (error) {
        if (isCurrent()) {
          pushToast(t('alert.import.failed', { error: errMsg(error) }), 'error')
        }
        controller.abort()
        if (backupImportAbortRef.current === controller) {
          backupImportAbortRef.current = null
        }
      } finally {
        releasePersistenceInteractionLock()
        if (isWorkspaceOperationCurrent(binding)) setBackupBusy(false)
      }
    },
    [
      acquirePersistenceInteractionLock,
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      pushToast,
      workspaceLocalizationError
    ]
  )

  const handleApplyBackupImport = useCallback(
    async (decisions: Readonly<Record<string, WorkspaceBackupCollisionDecision>>) => {
      const state = backupImportState
      const binding = state?.binding
      const adapter = binding?.adapter
      const plan = state?.plan
      const controller = state?.controller
      const sessionController = binding?.controller
      if (
        !binding ||
        !adapter ||
        !plan ||
        !controller ||
        !sessionController ||
        !isWorkspaceOperationCurrent(binding)
      ) {
        return
      }
      const operationIsCurrent = (): boolean =>
        !controller.signal.aborted &&
        backupImportAbortRef.current === controller &&
        isWorkspaceOperationCurrent(binding)
      const bindingIsCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
      const history = binding.history
      let historyRevisions = 0
      let storageCommitted = false
      const reprepareReview = async (): Promise<void> => {
        const localizationSnapshot = workspaceLocalizationSnapshotRef.current
        if (!localizationSnapshot) {
          setBackupImportState(null)
          throw new Error(
            t('settings.localization.loadFailed', {
              error: workspaceLocalizationError ?? t('workspace.history.unknownError')
            })
          )
        }
        setBackupImportState(null)
        const refreshedPlan = await inspectWorkspaceBackup(adapter, state.backup, {
          targetLanguage: langRef.current,
          localizationResources: localizationSnapshot.resources,
          localizationReview: reviewedXmlReviewQueueRef.current!.review,
          validationAdapters: getRuntimeValidationAdapters(),
          signal: controller.signal,
          isCurrent: operationIsCurrent
        })
        if (!operationIsCurrent()) return
        setBackupImportState({ ...state, plan: refreshedPlan })
      }
      setBackupBusy(true)
      const releasePersistenceInteractionLock = acquirePersistenceInteractionLock()
      try {
        const replacedPaths = new Set(
          plan.collisions
            .filter((collision) => decisions[collision.path]?.action === 'replace')
            .map((collision) => normalizeWorkspacePath(collision.path).toLocaleLowerCase('en-US'))
        )
        const dirtySessions = sessionController.store
          .list()
          .filter(
            (session) =>
              (session.dirty || Boolean(dirtyByKeyRef.current[session.id])) &&
              session.identity.path !== null &&
              replacedPaths.has(
                normalizeWorkspacePath(session.identity.path).toLocaleLowerCase('en-US')
              )
          )
        if (dirtySessions.length > 0) {
          const choice = await requestPathDirtyDecision(dirtySessions.length, {
            kind: 'import',
            sourcePath: [...replacedPaths].join(', ')
          })
          if (!operationIsCurrent()) return
          if (choice === 'cancel') return
          if (choice === 'save') {
            let saveError: unknown
            try {
              for (const captured of dirtySessions) {
                const current = sessionController.store.get(captured.id)
                if (
                  !operationIsCurrent() ||
                  !current ||
                  current.incarnation !== captured.incarnation
                ) {
                  throw new Error(t('alert.staleWrite'))
                }
                const tab = tabsRef.current.find((candidate) => candidate.key === captured.id)
                if (!tab) throw new Error(t('session.save.failed', { status: 'missing-tab' }))
                const live = await captureLiveSession(
                  sessionController,
                  current,
                  true,
                  operationIsCurrent
                )
                if (live.status === 'stale') throw new Error(t('alert.staleWrite'))
                if (live.status === 'unavailable') {
                  throw new Error(
                    t('session.save.reloadEditorFailed', {
                      error: errMsg(live.error)
                    })
                  )
                }
                const saved = await requestSaveRef.current(tab, live.session.currentXml)
                if (!saved.durable) {
                  throw new Error(t('session.save.failed', { status: 'not-durable' }))
                }
              }
            } catch (error) {
              saveError = error
            }
            if (!operationIsCurrent()) return
            await reprepareReview()
            if (saveError) throw saveError
            return
          }
          await discardAndCloseSessions(binding, dirtySessions, operationIsCurrent)
          if (!operationIsCurrent()) return
          await reprepareReview()
          return
        }

        const sessionGuards = new Map<string, OpenSessionCommitGuard | null>()
        for (const session of sessionController.store.list()) {
          if (!session.identity.path) continue
          sessionGuards.set(
            normalizeWorkspacePath(session.identity.path).toLocaleLowerCase('en-US'),
            {
              id: session.id,
              incarnation: session.incarnation,
              revision: session.revision,
              currentXml: session.currentXml,
              uiDirty: Boolean(dirtyByKeyRef.current[session.id])
            }
          )
        }
        const result = await runCoordinatedWorkspaceMutation(
          binding,
          async (lease) => {
            if (!operationIsCurrent()) throw new Error(t('alert.staleWrite'))
            const outcome = await applyWorkspaceBackupImport(adapter, plan, {
              decisions,
              reviewedDigest: plan.reviewDigest,
              currentProcessIndex: binding.index.processIndex(),
              signal: controller.signal,
              beforeOverwrite: async (path, existing) => {
                if (!operationIsCurrent()) throw new Error(t('alert.staleWrite'))
                const normalized = normalizeWorkspacePath(path)
                const lower = normalized.toLocaleLowerCase('en-US')
                if (/\.bpmn$/iu.test(normalized) && !lower.startsWith('.orbitpm/')) {
                  await history?.createRevision(path, {
                    reason: 'backup-import',
                    snapshot: existing,
                    prune: false,
                    signal: controller.signal
                  })
                  if (history) historyRevisions += 1
                  if (!operationIsCurrent()) throw new Error(t('alert.staleWrite'))
                }
              }
            })
            if (outcome.status === 'committed') {
              lease.publish(
                outcome.applied.map((item) => ({
                  kind: 'saved',
                  path: item.destinationPath,
                  fingerprint: {
                    hash: item.snapshot.hash,
                    size: item.snapshot.size,
                    modifiedAt: item.snapshot.modifiedAt
                  }
                }))
              )
            } else if (outcome.status === 'rolled-back') {
              lease.publish(
                outcome.appliedBeforeFailure.map((item) => ({
                  kind: item.replaced ? ('saved' as const) : ('deleted' as const),
                  path: item.destinationPath
                }))
              )
            } else if (outcome.status === 'rollback-failed') {
              lease.publish(
                outcome.appliedBeforeFailure.map((item) => ({
                  kind: 'invalidated',
                  path: item.destinationPath
                }))
              )
            }
            return outcome
          },
          controller.signal
        )
        if (result.status === 'rollback-failed') {
          if (!bindingIsCurrent()) return
          const applied = result.appliedBeforeFailure.map((item) => item.destinationPath).join(', ')
          const rollback = result.rollbackErrors
            .map((failure) => `${failure.path ?? '?'}: ${failure.message}`)
            .join('; ')
          const evidence = t('workspace.backup.rollbackEvidence', {
            error: result.error.message,
            applied: applied || t('workspace.diagnostic.none'),
            rollback: rollback || t('workspace.diagnostic.unknown')
          })
          try {
            await refreshWorkspace(rootHandleRef.current ?? undefined)
          } catch (refreshError) {
            recordWorkspaceIssue(`${t('breadcrumb.root')}: ${errMsg(refreshError)}`, binding)
          }
          if (!bindingIsCurrent()) return
          const affectedPaths = [
            ...result.appliedBeforeFailure.map((item) => item.destinationPath),
            ...result.rollbackErrors.flatMap((failure) => (failure.path ? [failure.path] : []))
          ]
          await reconcileBpmnPathsFromStorage(
            binding,
            affectedPaths,
            LocalizationSource.Backup,
            sessionGuards
          )
          if (affectedPaths.some(isWorkspaceLocalizationResourcePath)) {
            await reloadWorkspaceLocalizationResources(
              binding,
              t('workspace.localization.backupRollbackUncertain')
            )
          }
          if (!bindingIsCurrent()) return
          recordWorkspaceIssue(evidence, binding)
          if (history) setHistoryOpen(true)
          setBackupImportState(null)
          pushToast(t('alert.import.failed', { error: evidence }), 'error')
          controller.abort()
          if (backupImportAbortRef.current === controller) {
            backupImportAbortRef.current = null
          }
          return
        }
        if (result.status !== 'committed') {
          const detail =
            result.status === 'needs-review'
              ? `${result.unresolvedCollisions.length}`
              : result.error.message
          throw new Error(`${result.status}: ${detail}`)
        }
        storageCommitted = true
        if (!bindingIsCurrent()) return
        if (historyRevisions > 0) {
          try {
            await runCoordinatedWorkspaceMutation(
              binding,
              async (lease) => {
                await history?.enforceRetention()
                lease.publish([{ kind: 'invalidated', path: '.orbitpm/history' }])
              },
              controller.signal
            )
          } catch (retentionError) {
            if (!bindingIsCurrent()) return
            const evidence = t('workspace.backup.historyRetentionTechnicalEvidence', {
              error: errMsg(retentionError)
            })
            recordWorkspaceIssue(evidence, binding)
            pushToast(t('workspace.backup.historyRetentionFailed'), 'error')
          }
        }
        for (const applied of result.applied) {
          const normalized = normalizeWorkspacePath(applied.destinationPath)
          if (
            !/\.bpmn$/iu.test(normalized) ||
            normalized.toLocaleLowerCase('en-US').startsWith('.orbitpm/')
          ) {
            continue
          }
          const synchronized = await synchronizeCommittedBpmnSnapshot(
            binding,
            applied.destinationPath,
            applied.snapshot,
            LocalizationSource.Backup,
            bindingIsCurrent,
            sessionGuards.get(normalized.toLocaleLowerCase('en-US')) ?? null
          )
          if (!synchronized) return
        }
        setLiveWorkspaceVersion(binding.index.version)
        if (
          result.applied.some((applied) =>
            isWorkspaceLocalizationResourcePath(applied.destinationPath)
          )
        ) {
          await reloadWorkspaceLocalizationResources(
            binding,
            t('workspace.localization.backupCommittedReloadFailed')
          )
          if (!bindingIsCurrent()) return
        }
        try {
          await refreshWorkspace(rootHandleRef.current ?? undefined)
        } catch (refreshError) {
          recordWorkspaceIssue(`${t('breadcrumb.root')}: ${errMsg(refreshError)}`, binding)
        }
        if (!bindingIsCurrent()) return
        setBackupImportState(null)
        pushToast(
          t('toast.imported.count', {
            count: result.applied.length,
            plural: result.applied.length === 1 ? '' : 's'
          }),
          'success'
        )
      } catch (error) {
        if (storageCommitted && bindingIsCurrent()) {
          const evidence = t('workspace.backup.postCommitTechnicalEvidence', {
            error: errMsg(error)
          })
          setBackupImportState(null)
          recordWorkspaceIssue(evidence, binding)
          pushToast(t('workspace.backup.postCommitReconciliationFailed'), 'error')
        } else if (operationIsCurrent()) {
          pushToast(t('alert.import.failed', { error: errMsg(error) }), 'error')
        }
      } finally {
        releasePersistenceInteractionLock()
        if (storageCommitted) {
          controller.abort()
          if (backupImportAbortRef.current === controller) {
            backupImportAbortRef.current = null
          }
        }
        if (bindingIsCurrent()) setBackupBusy(false)
      }
    },
    [
      acquirePersistenceInteractionLock,
      backupImportState,
      captureLiveSession,
      discardAndCloseSessions,
      isWorkspaceOperationCurrent,
      pushToast,
      reconcileBpmnPathsFromStorage,
      recordWorkspaceIssue,
      refreshWorkspace,
      reloadWorkspaceLocalizationResources,
      requestPathDirtyDecision,
      runCoordinatedWorkspaceMutation,
      synchronizeCommittedBpmnSnapshot,
      workspaceLocalizationError
    ]
  )

  const prepareHistoryXmlForRestore = useCallback(
    async (
      verifiedXml: string,
      options: {
        binding: WorkspaceOperationBinding
        resources: LocalizationResources
        signal: AbortSignal
        isCurrent: () => boolean
      }
    ): Promise<PrepareHistoryXmlResult> => {
      const { binding, resources, signal, isCurrent } = options
      if (signal.aborted || !isCurrent()) return { status: 'cancelled' }
      const inspected = await secureBpmnImportPreparer.inspect(verifiedXml, signal)
      const prepared = await secureBpmnImportPreparer.prepare(verifiedXml, {
        knownProcessIds: new Set(binding.index.processIndex().keys()),
        validationAdapters: getRuntimeValidationAdapters(),
        signal
      })
      if (prepared.autoLayouted) return { status: 'review-required' }
      const outcome = await reviewBpmnXmlLocalization(prepared.xml, {
        source: LocalizationSource.Xml,
        target: langRef.current,
        defaultActive: langRef.current,
        resources,
        validation: {
          adapters: getRuntimeValidationAdapters(),
          knownProcessIds:
            inspected.processIds.length > 0
              ? inspected.processIds
              : binding.index.processIndex().keys(),
          requireDi: true
        },
        validationAction: 'commit-import',
        review: reviewedXmlReviewQueueRef.current!.review,
        signal,
        isCurrent: () => !signal.aborted && isCurrent()
      })
      if (outcome.status === 'completed' && !signal.aborted && isCurrent()) {
        return { status: 'completed', xml: outcome.xml }
      }
      return {
        status: outcome.status === 'review-required' ? 'review-required' : 'cancelled'
      }
    },
    []
  )

  const handleHistoryRestore = useCallback(
    async (
      revision: HistoryRevision,
      operationBinding?: WorkspaceOperationBinding
    ): Promise<RestoreHistoryRevisionResult> => {
      const binding = operationBinding ?? captureWorkspaceOperation()
      const adapter = binding.adapter
      const manager = binding.history
      const controller = binding.controller
      const workspace = binding.identity
      if (!adapter || !manager || !controller || !workspace) {
        return {
          status: 'failed',
          sessionId: null,
          error: new Error(t('workspace.history.unavailable'))
        }
      }
      const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
      historyRestoreAbortRef.current?.abort()
      const restoreController = new AbortController()
      historyRestoreAbortRef.current = restoreController
      const signal = restoreController.signal
      const resources = workspaceLocalizationSnapshotRef.current?.resources
      if (!isCurrent()) {
        return {
          status: 'failed',
          sessionId: null,
          error: new Error(t('alert.staleWrite'))
        }
      }
      if (!resources) {
        return {
          status: 'failed',
          sessionId: null,
          error: new Error(
            t('settings.localization.loadFailed', {
              error: workspaceLocalizationError ?? t('workspace.history.unknownError')
            })
          )
        }
      }

      const releasePersistenceInteractionLock = acquirePersistenceInteractionLock()
      try {
        const currentTargetSession = (): DocumentSession | undefined =>
          controller.store
            .list()
            .find(
              (session) =>
                session.identity.workspace.id === workspace.id &&
                session.identity.path === revision.originalPath
            )
        const settleTargetSession = async (): Promise<
          | { status: 'ready'; guard: OpenSessionCommitGuard | null }
          | { status: 'result'; result: RestoreHistoryRevisionResult }
        > => {
          let target = currentTargetSession()
          if (!target) return { status: 'ready', guard: null }
          if (target.readXml || dirtyByKeyRef.current[target.id]) {
            const captured = await captureLiveSession(controller, target, true, isCurrent)
            if (captured.status === 'stale') {
              return {
                status: 'result',
                result: {
                  status: 'failed',
                  sessionId: target.id,
                  error: new Error(t('alert.staleWrite'))
                }
              }
            }
            if (captured.status === 'unavailable') {
              return {
                status: 'result',
                result: {
                  status: 'failed',
                  sessionId: target.id,
                  error: new Error(
                    t('session.save.reloadEditorFailed', {
                      error: errMsg(captured.error)
                    })
                  )
                }
              }
            }
            target = captured.session
          }

          if (target.dirty || dirtyByKeyRef.current[target.id]) {
            const choice = await requestPathDirtyDecision(1, {
              kind: 'history',
              sourcePath: revision.originalPath
            })
            if (!isCurrent()) {
              return {
                status: 'result',
                result: {
                  status: 'failed',
                  sessionId: target.id,
                  error: new Error(t('alert.staleWrite'))
                }
              }
            }
            if (choice === 'cancel') {
              return {
                status: 'result',
                result: {
                  status: 'preparation-not-completed',
                  sessionId: target.id,
                  reason: 'cancelled'
                }
              }
            }
            if (choice === 'save') {
              const tab = tabsRef.current.find((candidate) => candidate.key === target!.id)
              if (!tab) {
                return {
                  status: 'result',
                  result: {
                    status: 'failed',
                    sessionId: target.id,
                    error: new Error(t('session.save.failed', { status: 'missing-tab' }))
                  }
                }
              }
              try {
                const saved = await requestSaveRef.current(tab, target.currentXml)
                if (!saved.durable) {
                  throw new Error(t('session.save.failed', { status: 'not-durable' }))
                }
              } catch (error) {
                return {
                  status: 'result',
                  result: { status: 'failed', sessionId: target.id, error }
                }
              }
            } else {
              await discardAndCloseSessions(binding, [target], isCurrent)
            }
            if (!isCurrent()) {
              return {
                status: 'result',
                result: {
                  status: 'failed',
                  sessionId: target.id,
                  error: new Error(t('alert.staleWrite'))
                }
              }
            }
            target = currentTargetSession()
            if (!target) return { status: 'ready', guard: null }
          }

          return {
            status: 'ready',
            guard: {
              id: target.id,
              incarnation: target.incarnation,
              revision: target.revision,
              currentXml: target.currentXml,
              uiDirty: Boolean(dirtyByKeyRef.current[target.id])
            }
          }
        }

        let expectedCurrentHash: string | null = null
        let targetStable = false
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const settled = await settleTargetSession()
          if (settled.status === 'result') return settled.result
          try {
            expectedCurrentHash = (await adapter.read(revision.originalPath)).hash
          } catch (error) {
            if (error instanceof WorkspaceOperationError && error.code === 'not-found') {
              expectedCurrentHash = null
            } else {
              return { status: 'failed', sessionId: settled.guard?.id ?? null, error }
            }
          }
          if (!isCurrent()) {
            return {
              status: 'failed',
              sessionId: settled.guard?.id ?? null,
              error: new Error(t('alert.staleWrite'))
            }
          }
          const live = currentTargetSession()
          targetStable = settled.guard
            ? Boolean(
                live &&
                live.id === settled.guard.id &&
                live.incarnation === settled.guard.incarnation &&
                live.revision === settled.guard.revision &&
                live.currentXml === settled.guard.currentXml &&
                !live.dirty &&
                !dirtyByKeyRef.current[live.id]
              )
            : live === undefined
          if (targetStable) break
        }
        if (!targetStable) {
          return {
            status: 'preparation-not-completed',
            sessionId: currentTargetSession()?.id ?? null,
            reason: 'stale'
          }
        }

        const result = await restoreHistoryRevision({
          manager,
          store: controller.store,
          revision,
          workspace,
          expectedCurrentHash,
          signal,
          isWorkspaceCurrent: () => isCurrent(),
          prepareXml: (verifiedXml, context) =>
            prepareHistoryXmlForRestore(verifiedXml, {
              binding,
              resources,
              signal: context.signal ?? signal,
              isCurrent
            }),
          writePreparedXml: async (input) => {
            const bytes = new TextEncoder().encode(input.xml)
            if (input.signal?.aborted || !isCurrent()) {
              throw new DOMException(t('workspace.history.restoreCancelled'), 'AbortError')
            }
            return runCoordinatedWorkspaceMutation(
              binding,
              async (lease) => {
                const written =
                  input.expectedCurrentHash === null
                    ? {
                        outcome: await adapter.writeAtomic(
                          input.revision.originalPath,
                          bytes,
                          undefined,
                          {
                            expectedWorkspaceId: adapter.id,
                            expectedMissing: true,
                            signal: input.signal
                          }
                        )
                      }
                    : await manager.writeWithRevision(
                        input.revision.originalPath,
                        bytes,
                        input.expectedCurrentHash,
                        'restore',
                        input.signal
                      )
                if (written.outcome.status === 'success') {
                  lease.publish([
                    {
                      kind: 'saved',
                      path: written.outcome.snapshot.path,
                      fingerprint: {
                        hash: written.outcome.snapshot.hash,
                        size: written.outcome.snapshot.size,
                        modifiedAt: written.outcome.snapshot.modifiedAt
                      }
                    }
                  ])
                }
                return written
              },
              input.signal
            )
          },
          applyXml: async (session, restoredXml) => {
            if (signal.aborted || !isCurrent()) throw new Error(t('alert.staleWrite'))
            const beforeImport = controller.store.get(session.id)
            if (
              !beforeImport ||
              beforeImport.incarnation !== session.incarnation ||
              beforeImport.revision !== session.revision ||
              beforeImport.currentXml !== session.currentXml
            ) {
              throw new Error(t('workspace.history.applyEditorChangedBefore'))
            }
            const modeler = (modelersByKeyRef.current[session.id] ?? session.modeler) as {
              importXML?: (xml: string) => Promise<unknown>
            } | null
            const coordinatedApply = commandsRef.current[session.id]?.applyExternalXml
            invalidateLiveXmlCapture(session.id)
            if (coordinatedApply) await coordinatedApply(restoredXml)
            else if (modeler?.importXML) {
              throw new Error(t('workspace.history.applyEditorSynchronizationUnavailable'))
            }
            if (signal.aborted || !isCurrent()) throw new Error(t('alert.staleWrite'))
            const afterImport = controller.store.get(session.id)
            if (!afterImport || afterImport.incarnation !== session.incarnation) {
              throw new Error(t('workspace.history.applyTargetSessionChanged'))
            }
            if (dirtyByKeyRef.current[session.id]) {
              const captured = await captureLiveSession(controller, afterImport, true, isCurrent)
              if (captured.status === 'stale') throw new Error(t('alert.staleWrite'))
              if (captured.status === 'unavailable') {
                throw new Error(
                  t('workspace.history.applyLiveEditorUnverified', {
                    error: errMsg(captured.error)
                  })
                )
              }
              throw new Error(t('workspace.history.applyEditorChangedDuring'))
            }
            if (
              afterImport.revision !== session.revision ||
              afterImport.currentXml !== session.currentXml ||
              dirtyByKeyRef.current[session.id]
            ) {
              throw new Error(t('workspace.history.applyEditorChangedDuring'))
            }
          }
        })
        if (!isCurrent()) return result
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
        if (!isCurrent()) return result
        baseHashByPathRef.current[revision.originalPath] = snapshot.hash
        binding.index.updateSaved({
          relPath: revision.originalPath,
          xml: restoredXml,
          lastModified: snapshot.modifiedAt,
          size: snapshot.size
        })
        const editorRefreshFailure = (message: string): RestoreHistoryRevisionResult => ({
          status: 'storage-restored-session-refresh-failed',
          sessionId: result.sessionId,
          previousRevision: result.previousRevision,
          outcome: result.outcome,
          error: new Error(message)
        })
        const liveSession = result.sessionId ? controller.store.get(result.sessionId) : undefined
        const retainHistoryEditor = async (
          initial: DocumentSession,
          reason: string,
          existingCaptureError?: unknown
        ): Promise<void> => {
          let retained = initial
          let captureError = existingCaptureError
          if (
            captureError === undefined &&
            (retained.readXml || dirtyByKeyRef.current[retained.id])
          ) {
            const captured = await captureLiveSession(controller, retained, true, isCurrent)
            if (captured.status === 'stale') return
            if (captured.status === 'unavailable') {
              retained = captured.session
              captureError = captured.error
            } else {
              retained = captured.session
            }
          }
          if (retained.dirty) {
            binding.drafts?.track(retained)
            try {
              await binding.drafts?.flush(retained.id, retained.incarnation)
            } catch (error) {
              if (isCurrent()) {
                recordWorkspaceIssue(`${revision.originalPath}: ${errMsg(error)}`, binding)
              }
            }
          }
          if (!isCurrent()) return
          const latest = controller.store.get(retained.id)
          if (!latest || latest.incarnation !== retained.incarnation) return
          if (latest.dirty) binding.drafts?.track(latest)
          binding.index.updateDirty(revision.originalPath, latest.currentXml)
          dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [latest.id]: true }
          setDirtyByKey((previous) => ({ ...previous, [latest.id]: true }))
          const evidence = `${revision.originalPath}: ${reason}${
            captureError === undefined ? '' : ` ${errMsg(captureError)}`
          }`
          recordWorkspaceIssue(evidence, binding)
          pushToast(t('session.save.reloadEditorFailed', { error: evidence }), 'error')
        }

        if (result.status === 'restored' && liveSession) {
          let beforeCleanup = liveSession
          if (dirtyByKeyRef.current[beforeCleanup.id]) {
            const captured = await captureLiveSession(controller, beforeCleanup, true, isCurrent)
            if (captured.status === 'stale') return result
            if (captured.status === 'unavailable') {
              const reason = t('workspace.history.liveEditorUnverifiedAfterRestore')
              await retainHistoryEditor(captured.session, reason, captured.error)
              setLiveWorkspaceVersion(binding.index.version)
              return editorRefreshFailure(reason)
            }
            beforeCleanup = captured.session
            if (beforeCleanup.currentXml === restoredXml && !beforeCleanup.dirty) {
              dirtyByKeyRef.current = {
                ...dirtyByKeyRef.current,
                [beforeCleanup.id]: false
              }
            }
          }
          if (
            beforeCleanup.currentXml !== restoredXml ||
            beforeCleanup.dirty ||
            dirtyByKeyRef.current[beforeCleanup.id]
          ) {
            const reason = t('workspace.history.newerRevisionBeforeCleanup')
            await retainHistoryEditor(beforeCleanup, reason)
            setLiveWorkspaceVersion(binding.index.version)
            return editorRefreshFailure(reason)
          }
          try {
            await binding.drafts?.confirmedSave(
              beforeCleanup.id,
              beforeCleanup.incarnation,
              restoredXml
            )
          } catch (error) {
            if (isCurrent()) {
              pushToast(t('draftRecovery.error', { error: errMsg(error) }), 'error')
            }
          }
          if (!isCurrent()) return result
          let afterCleanup = controller.store.get(beforeCleanup.id)
          if (!afterCleanup || afterCleanup.incarnation !== beforeCleanup.incarnation) {
            return result
          }
          if (dirtyByKeyRef.current[afterCleanup.id]) {
            const captured = await captureLiveSession(controller, afterCleanup, true, isCurrent)
            if (captured.status === 'stale') return result
            if (captured.status === 'unavailable') {
              const reason = t('workspace.history.liveEditorUnverifiedAfterCleanup')
              await retainHistoryEditor(captured.session, reason, captured.error)
              setLiveWorkspaceVersion(binding.index.version)
              return editorRefreshFailure(reason)
            }
            afterCleanup = captured.session
            if (afterCleanup.currentXml === restoredXml && !afterCleanup.dirty) {
              dirtyByKeyRef.current = {
                ...dirtyByKeyRef.current,
                [afterCleanup.id]: false
              }
            }
          }
          if (
            afterCleanup.revision !== beforeCleanup.revision ||
            afterCleanup.currentXml !== restoredXml ||
            afterCleanup.dirty ||
            dirtyByKeyRef.current[afterCleanup.id]
          ) {
            const reason = t('workspace.history.newerRevisionDuringCleanup')
            await retainHistoryEditor(afterCleanup, reason)
            setLiveWorkspaceVersion(binding.index.version)
            return editorRefreshFailure(reason)
          }
          setContents((previous) => ({ ...previous, [afterCleanup.id]: restoredXml }))
          dirtyByKeyRef.current = { ...dirtyByKeyRef.current, [afterCleanup.id]: false }
          setDirtyByKey((previous) => ({ ...previous, [afterCleanup.id]: false }))
          binding.index.clearDirty(revision.originalPath)
        } else if (liveSession) {
          // Storage committed but editor refresh did not. Preserve and continue
          // indexing the local draft instead of presenting the restored disk copy
          // as the active editor content.
          await retainHistoryEditor(
            liveSession,
            t('workspace.history.editorRefreshIncompleteAfterRestore')
          )
        }
        setLiveWorkspaceVersion(binding.index.version)
        digestsCacheRef.current = null
        return result
      } finally {
        releasePersistenceInteractionLock()
      }
    },
    [
      acquirePersistenceInteractionLock,
      captureLiveSession,
      captureWorkspaceOperation,
      discardAndCloseSessions,
      invalidateLiveXmlCapture,
      isWorkspaceOperationCurrent,
      prepareHistoryXmlForRestore,
      pushToast,
      recordWorkspaceIssue,
      requestPathDirtyDecision,
      runCoordinatedWorkspaceMutation,
      workspaceLocalizationError
    ]
  )

  const handleHistoryRestoreCopy = useCallback(
    async (
      revision: HistoryRevision,
      destination: string,
      dialogSignal: AbortSignal,
      operationBinding?: WorkspaceOperationBinding
    ): Promise<SaveOutcome> => {
      const binding = operationBinding ?? captureWorkspaceOperation()
      const adapter = binding.adapter
      const manager = binding.history
      const workspace = binding.identity
      const resources = workspaceLocalizationSnapshotRef.current?.resources
      const isCurrent = (): boolean => isWorkspaceOperationCurrent(binding)
      const staleOutcome = (): SaveOutcome => ({
        ok: false,
        status: 'stale-workspace',
        expectedWorkspaceId: adapter?.id ?? workspace?.id ?? 'unavailable',
        actualWorkspaceId: workspaceAdapterRef.current?.id ?? 'unavailable'
      })
      const cancelledOutcome = (): SaveOutcome => ({
        ok: false,
        status: 'cancelled',
        error: {
          code: 'cancelled',
          operation: 'write',
          path: destination,
          message: t('workspace.history.restoreCancelled'),
          name: 'AbortError'
        }
      })

      if (!adapter || !manager || !binding.controller || !workspace) {
        return {
          ok: false,
          status: 'storage-failure',
          error: {
            code: 'storage-failure',
            operation: 'write',
            path: destination,
            message: t('workspace.history.unavailable')
          }
        }
      }
      if (!isCurrent()) return staleOutcome()
      if (dialogSignal.aborted) return cancelledOutcome()
      if (!resources) {
        return {
          ok: false,
          status: 'storage-failure',
          error: {
            code: 'storage-failure',
            operation: 'write',
            path: destination,
            message: t('settings.localization.loadFailed', {
              error: workspaceLocalizationError ?? t('workspace.history.unknownError')
            })
          }
        }
      }

      historyRestoreAbortRef.current?.abort()
      const restoreController = new AbortController()
      historyRestoreAbortRef.current = restoreController
      const abortFromDialog = (): void => restoreController.abort(dialogSignal.reason)
      dialogSignal.addEventListener('abort', abortFromDialog, { once: true })
      if (dialogSignal.aborted) abortFromDialog()

      const releasePersistenceInteractionLock = acquirePersistenceInteractionLock()
      try {
        if (restoreController.signal.aborted) return cancelledOutcome()
        if (!isCurrent()) return staleOutcome()
        try {
          const signal = restoreController.signal
          const destinationPath = normalizeWorkspacePath(destination)
          const preview = await manager.preview(revision)
          if (signal.aborted) return cancelledOutcome()
          if (!isCurrent()) return staleOutcome()

          const prepared = await prepareHistoryXmlForRestore(preview.xml, {
            binding,
            resources,
            signal,
            isCurrent
          })
          if (prepared.status === 'cancelled') return cancelledOutcome()
          if (prepared.status === 'review-required') {
            return {
              ok: false,
              status: 'storage-failure',
              error: {
                code: 'storage-failure',
                operation: 'write',
                path: destinationPath,
                message: t('workspace.history.restoreReason.reviewRequired')
              }
            }
          }
          if (signal.aborted) return cancelledOutcome()
          if (!isCurrent()) return staleOutcome()

          // The historical source is immutable only by convention. Re-read and
          // checksum-verify it after the asynchronous review so the reviewed
          // decision can never authorize different revision bytes.
          const reverified = await manager.preview(revision)
          if (
            reverified.revision.id !== preview.revision.id ||
            !byteArraysEqual(reverified.bytes, preview.bytes)
          ) {
            throw new WorkspaceOperationError({
              code: 'integrity-failure',
              operation: 'read',
              path: revision.contentPath,
              message: 'History revision changed while its copy was being reviewed.'
            })
          }
          if (signal.aborted) return cancelledOutcome()
          if (!isCurrent()) return staleOutcome()

          const reviewedBytes = new TextEncoder().encode(prepared.xml)
          const reviewedHash = await sha256Hex(reviewedBytes)
          if (signal.aborted) return cancelledOutcome()
          if (!isCurrent()) return staleOutcome()
          return runCoordinatedWorkspaceMutation(
            binding,
            async (lease) => {
              const outcome = await adapter.writeAtomic(destinationPath, reviewedBytes, undefined, {
                expectedWorkspaceId: adapter.id,
                expectedMissing: true,
                signal
              })
              if (outcome.status !== 'success') return outcome

              // writeAtomic's successful snapshot is the post-close storage
              // evidence. Validate it against the exact reviewed payload before
              // reporting success. Do not turn a committed success into
              // cancellation merely because the workspace switches after commit.
              if (
                outcome.snapshot.path !== destinationPath ||
                outcome.snapshot.hash !== reviewedHash ||
                outcome.snapshot.size !== reviewedBytes.byteLength ||
                !byteArraysEqual(outcome.snapshot.bytes, reviewedBytes)
              ) {
                throw new WorkspaceOperationError({
                  code: 'integrity-failure',
                  operation: 'write',
                  path: destinationPath,
                  message: 'History copy storage did not persist the reviewed XML exactly.'
                })
              }
              lease.publish([
                {
                  kind: 'saved',
                  path: destinationPath,
                  fingerprint: {
                    hash: outcome.snapshot.hash,
                    size: outcome.snapshot.size,
                    modifiedAt: outcome.snapshot.modifiedAt
                  }
                }
              ])
              return outcome
            },
            signal
          )
        } catch (error) {
          const failure = workspaceFailure(error, 'write', destination)
          if (failure.code === 'cancelled') {
            return { ok: false, status: 'cancelled', error: failure }
          }
          if (failure.code === 'permission-loss') {
            return { ok: false, status: 'permission-loss', error: failure }
          }
          return { ok: false, status: 'storage-failure', error: failure }
        }
      } finally {
        dialogSignal.removeEventListener('abort', abortFromDialog)
        if (historyRestoreAbortRef.current === restoreController) {
          historyRestoreAbortRef.current = null
        }
        releasePersistenceInteractionLock()
      }
    },
    [
      acquirePersistenceInteractionLock,
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      prepareHistoryXmlForRestore,
      runCoordinatedWorkspaceMutation,
      workspaceLocalizationError
    ]
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
      const binding = captureWorkspaceOperation()
      const slug = deriveFileBaseName(opts.name || 'process')
      const expectsMultiFile = isMultiFileMode(mode)
      const adapter = binding.adapter
      const stale = (): boolean =>
        !isWorkspaceOperationCurrent(binding) ||
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
        const result = await runCoordinatedWorkspaceMutation(
          binding,
          async (lease) => {
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
                lease.publish([
                  {
                    kind: 'saved',
                    path: outcome.snapshot.path,
                    fingerprint: {
                      hash: outcome.snapshot.hash,
                      size: outcome.snapshot.size,
                      modifiedAt: outcome.snapshot.modifiedAt
                    }
                  }
                ])
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
          },
          opts.signal
        )
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
    [
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      mode,
      refreshWorkspace,
      openDirectoryFile,
      openVirtualTab,
      pushToast,
      processIndex,
      runCoordinatedWorkspaceMutation
    ]
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
      if (persistenceInteractionLockedRef.current || hasOpenModalSurface()) return
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
      const binding = captureWorkspaceOperation()
      const isCurrent = (): boolean =>
        isWorkspaceOperationCurrent(binding) &&
        tab.gen === binding.generation &&
        tabsRef.current.some(
          (candidate) => candidate.key === tab.key && candidate.gen === tab.gen
        ) &&
        modelersByKeyRef.current[tab.key] === modeler
      try {
        const { svg } = await modeler.saveSVG()
        if (!isCurrent()) return
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
        if (!isCurrent()) return
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
        if (isCurrent()) {
          pushToast(t('toast.print.failed', { error: errMsg(err) }), 'error')
        }
      }
    },
    [captureWorkspaceOperation, isWorkspaceOperationCurrent, modelersByKey, rootName, pushToast]
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
          const activeLang = getProcessOrgProps(modeler).activeLang === 'ar' ? 'ar' : 'en'
          setOrgProps(
            modeler,
            ctx.element,
            mergeActiveLanguageOrgProps(
              current,
              {
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
              },
              activeLang
            )
          )
          // Keep the VISIBLE label coherent with the edited translation for the
          // diagram's active language — otherwise the next language toggle's
          // write-back (visible name wins) would clobber this dialog edit.
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
          if (v.note !== ctx.initial.note) {
            setStepNote(modeler, ctx.element, v.note, activeLang)
          }
        } else {
          const current = getProcessOrgProps(modeler)
          const activeLang = current.activeLang === 'ar' ? 'ar' : 'en'
          setProcessOrgProps(
            modeler,
            mergeActiveLanguageOrgProps(
              current,
              {
                owner: v.owner,
                ownerType: v.ownerType,
                ownerRole: v.ownerRole,
                nameEn: v.nameEn,
                nameAr: v.nameAr
              },
              activeLang
            )
          )
          setProcessDocumentation(modeler, v.note, activeLang)
          // Process-mode trigger fields land on the FIRST start event, preserving
          // its other org props.
          const startEvent = modeler
            .get('elementRegistry')
            .getAll()
            .find((el) => el.type === 'bpmn:StartEvent')
          if (startEvent) {
            const cur = getOrgProps(startEvent)
            setOrgProps(
              modeler,
              startEvent,
              mergeActiveLanguageOrgProps(cur, serializeTriggers(v.triggers), activeLang)
            )
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
      const binding = captureWorkspaceOperation()
      libraryImportAbortRef.current?.abort()
      setLibraryImport(null)
      const controller = new AbortController()
      libraryImportAbortRef.current = controller
      const isCurrent = (): boolean =>
        !controller.signal.aborted &&
        libraryImportAbortRef.current === controller &&
        isWorkspaceOperationCurrent(binding)
      try {
        const result = await readLibraryZipFileInWorker(file, {
          signal: controller.signal
        })
        if (!isCurrent()) return
        if (result.entries.length === 0) {
          pushToast(t('library.import.empty'), 'info')
          return
        }
        setLibraryImport({ binding, name: file.name, result })
      } catch (err) {
        if (isCurrent()) {
          pushToast(t('alert.import.failed', { error: errMsg(err) }), 'error')
        }
      } finally {
        if (libraryImportAbortRef.current === controller) {
          libraryImportAbortRef.current = null
        }
        controller.abort()
      }
    },
    [captureWorkspaceOperation, isWorkspaceOperationCurrent, pushToast]
  )

  const confirmLibraryImport = useCallback(async () => {
    const state = libraryImport
    const binding = state?.binding
    const adapter = binding?.adapter
    if (
      !state ||
      !binding ||
      !adapter?.storage.capabilities.multipleFiles ||
      !isWorkspaceOperationCurrent(binding)
    ) {
      return
    }
    const controller = beginWorkspaceImportOperation()
    const prepared = await prepareWorkspaceImportReview(
      [
        {
          kind: 'library',
          id: `library:${state.name}`,
          name: state.name,
          result: state.result
        }
      ],
      '',
      binding,
      controller
    )
    if (prepared) {
      setLibraryImport((current) => (current === state ? null : current))
    }
  }, [
    beginWorkspaceImportOperation,
    isWorkspaceOperationCurrent,
    libraryImport,
    prepareWorkspaceImportReview
  ])

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
    async (tabKey: string, intent: 'switch' | 'repair'): Promise<void> => {
      const modeler = modelersByKeyRef.current[tabKey] as LangToggleModeler | undefined
      if (
        !modeler ||
        activeKeyRef.current !== tabKey ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current ||
        translationReviewOpenOperationRef.current
      ) {
        return
      }
      const localizationBinding = workspaceLocalizationBindingRef.current
      const operation = {
        nonce: ++translationOperationNonceRef.current,
        tabKey,
        modeler
      }
      const operationIsCurrent = (): boolean =>
        translationReviewOpenOperationRef.current === operation &&
        activeKeyRef.current === tabKey &&
        modelersByKeyRef.current[tabKey] === modeler &&
        workspaceLocalizationBindingRef.current === localizationBinding &&
        (localizationBinding === null ||
          (workspaceAdapterRef.current === localizationBinding.adapter &&
            workspaceGenRef.current === localizationBinding.generation &&
            !localizationBinding.controller.signal.aborted))
      translationReviewOpenOperationRef.current = operation
      try {
        const currentLang = getDiagramLang(modeler)
        const targetLang = currentLang === 'en' ? 'ar' : 'en'
        const source = localizationSourceByTabRef.current.get(tabKey) ?? LocalizationSource.Editor
        let localizationSnapshot = workspaceLocalizationSnapshotRef.current
        if (localizationBinding) {
          localizationSnapshot = await loadWorkspaceLocalizationCoordinated(localizationBinding)
          if (!operationIsCurrent()) return
          commitWorkspaceLocalizationSnapshot(localizationBinding, localizationSnapshot)
        }
        if (!operationIsCurrent()) return
        const review = inspectDiagramLocalization(modeler, targetLang, {
          source,
          ...(localizationSnapshot?.resources ?? DEFAULT_LOCALIZATION_RESOURCES)
        })
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
          localizationRevision: translationLocalizationRevision(
            localizationBinding,
            localizationSnapshot
          ),
          // A language switch is local-only: even though the completion review
          // exposes provider choices, it must not pre-arm an external service.
          // The explicit repair command may carry the user's configured
          // provider into that same disclosure/consent gate.
          providerId: intent === 'repair' && selection ? 'selected-ai' : '',
          aiSelection: selection,
          status: null,
          technicalDetail: null,
          retryingFieldId: null,
          proposals: [],
          acceptedValues: []
        })
      } catch (err) {
        if (!operationIsCurrent()) return
        console.error('Translation review could not be opened.', err)
        pushToast(t('translate.failed'), 'error')
      } finally {
        if (translationReviewOpenOperationRef.current === operation) {
          translationReviewOpenOperationRef.current = null
        }
      }
    },
    [
      commitWorkspaceLocalizationSnapshot,
      loadWorkspaceLocalizationCoordinated,
      pushToast,
      setTranslationReview
    ]
  )

  // Switching is a local projection command. Repair is the only command that
  // preselects a configured translation provider; both still stop at the
  // explicit disclosure/consent review before any network operation.
  const handleDiagramLangToggle = useCallback(
    (tabKey: string) => void openTranslationReview(tabKey, 'switch'),
    [openTranslationReview]
  )
  const handleTranslate = useCallback(
    (tabKey: string) => void openTranslationReview(tabKey, 'repair'),
    [openTranslationReview]
  )

  const handleTranslationPartialPreview = useCallback(() => {
    const state = translationReviewRef.current
    if (
      !state ||
      state !== translationReview ||
      translationAbortRef.current ||
      translationFinalizationOperationRef.current ||
      translationReviewOpenOperationRef.current ||
      state.retryingFieldId ||
      state.memoryRetry ||
      state.acceptedValues.length > 0
    ) {
      return
    }
    const modeler = modelersByKeyRef.current[state.tabKey] as LangToggleModeler | undefined
    if (!modeler) return
    try {
      const result = applyDiagramLocalizationReview(modeler, state.review, {
        allowPartial: true
      })
      setTranslationReview((current) => (current === state ? null : current))
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
        setTranslationReview((current) =>
          current === state
            ? {
                ...state,
                review: fresh,
                status: t('translationReview.stale'),
                technicalDetail: null,
                proposals: [],
                acceptedValues: []
              }
            : current
        )
      } else {
        setTranslationReview((current) =>
          current === state
            ? {
                ...state,
                status: t('translate.failed'),
                technicalDetail: boundedTranslationTechnicalDetail(err)
              }
            : current
        )
      }
    }
  }, [pushToast, setTranslationReview, translationReview])

  const handleTranslationManualEdit = useCallback(
    async (requestedField: TranslationRecoveryField, value: string): Promise<void> => {
      const state = translationReviewRef.current
      if (
        !state ||
        state !== translationReview ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current ||
        translationReviewOpenOperationRef.current ||
        state.retryingFieldId ||
        state.memoryRetry
      ) {
        return
      }
      const field = listTranslationRecoveryFields(state.review).find(
        (candidate) =>
          candidate.id === requestedField.id &&
          candidate.sourceLanguage === requestedField.sourceLanguage &&
          candidate.sourceValue === requestedField.sourceValue &&
          candidate.target === requestedField.target
      )
      if (!field) return
      const modeler = modelersByKeyRef.current[state.tabKey] as LangToggleModeler | undefined
      if (!modeler) return
      const binding = captureWorkspaceOperation()
      if (!isWorkspaceOperationCurrent(binding)) return
      try {
        assertLocalizationReviewCurrent(modeler, state.review)
        const validation = validateTranslationRecoveryValue(state.review, field, value)
        if (!validation.valid) {
          throw new InvalidTranslationRecoveryValueError(validation.issues)
        }
        const accepted: ReviewedTranslationProposal = {
          processId: field.processId,
          elementId: field.elementId,
          field: field.field,
          sourceLanguage: field.sourceLanguage,
          sourceValue: field.sourceValue,
          target: field.target,
          value: validation.value
        }
        setTranslationReview((current) =>
          current === state
            ? (() => {
                const acceptedValues = [
                  ...proposalsWithoutField(current.acceptedValues, field),
                  accepted
                ]
                return {
                  ...current,
                  acceptedValues,
                  proposals: proposalsWithoutField(current.proposals, field),
                  status: t('translationReview.stagedStatus', {
                    count: acceptedValues.length
                  }),
                  technicalDetail: null,
                  retryingFieldId: null
                }
              })()
            : current
        )
      } catch (error) {
        if (error instanceof StaleLocalizationReviewError) {
          const fresh = inspectDiagramLocalization(modeler, state.review.target, {
            source: state.review.source,
            ...state.review.localResources
          })
          if (!isWorkspaceOperationCurrent(binding)) return
          setTranslationReview((current) =>
            current === state
              ? {
                  ...current,
                  review: fresh,
                  status: t('translationReview.stale'),
                  technicalDetail: null,
                  retryingFieldId: null,
                  proposals: [],
                  acceptedValues: []
                }
              : current
          )
          return
        }
        throw error
      }
    },
    [
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      setTranslationReview,
      translationReview
    ]
  )

  const handleTranslationAcceptProposal = useCallback(
    async (
      field: TranslationRecoveryField,
      proposal: ReviewedTranslationProposal
    ): Promise<void> => {
      const state = translationReviewRef.current
      const stillCurrent =
        !!state &&
        state === translationReview &&
        !translationAbortRef.current &&
        !translationFinalizationOperationRef.current &&
        !translationReviewOpenOperationRef.current &&
        !state.retryingFieldId &&
        !state.memoryRetry &&
        state.proposals.some(
          (candidate) =>
            proposalMatchesField(candidate, field) && candidate.value === proposal.value
        )
      if (!stillCurrent) return
      await handleTranslationManualEdit(field, proposal.value)
    },
    [handleTranslationManualEdit, translationReview]
  )

  const handleTranslationRejectProposal = useCallback(
    async (
      requestedField: TranslationRecoveryField,
      proposal: ReviewedTranslationProposal
    ): Promise<void> => {
      const state = translationReviewRef.current
      if (
        !state ||
        state !== translationReview ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current ||
        translationReviewOpenOperationRef.current ||
        state.retryingFieldId ||
        state.memoryRetry ||
        !state.proposals.some(
          (candidate) =>
            proposalMatchesField(candidate, requestedField) && candidate.value === proposal.value
        )
      ) {
        return
      }
      const field = listTranslationRecoveryFields(state.review).find(
        (candidate) =>
          candidate.id === requestedField.id &&
          candidate.sourceLanguage === requestedField.sourceLanguage &&
          candidate.sourceValue === requestedField.sourceValue &&
          candidate.target === requestedField.target
      )
      if (!field) return
      const modeler = modelersByKeyRef.current[state.tabKey] as LangToggleModeler | undefined
      if (!modeler) return
      try {
        assertLocalizationReviewCurrent(modeler, state.review)
      } catch (error) {
        if (!(error instanceof StaleLocalizationReviewError)) throw error
        const fresh = inspectDiagramLocalization(modeler, state.review.target, {
          source: state.review.source,
          ...state.review.localResources
        })
        setTranslationReview((current) =>
          current === state
            ? {
                ...current,
                review: fresh,
                proposals: [],
                acceptedValues: [],
                status: t('translationReview.stale'),
                technicalDetail: null,
                retryingFieldId: null
              }
            : current
        )
        return
      }
      const review = inspectDiagramLocalization(modeler, state.review.target, {
        source: state.review.source,
        providerFailures: providerFailuresWithField(state.review, field),
        ...state.review.localResources
      })
      setTranslationReview((current) =>
        current === state &&
        current.proposals.some(
          (candidate) =>
            proposalMatchesField(candidate, field) && candidate.value === proposal.value
        )
          ? {
              ...current,
              review,
              proposals: proposalsWithoutField(current.proposals, field),
              status:
                proposalsWithoutField(current.proposals, field).length > 0
                  ? t('translationReview.proposalStatus', {
                      count: proposalsWithoutField(current.proposals, field).length
                    })
                  : t('translationReview.partialStatus'),
              technicalDetail: null,
              retryingFieldId: null
            }
          : current
      )
    },
    [setTranslationReview, translationReview]
  )

  const handleTranslationApplyCompleted = useCallback(
    async (expectedState: TranslationReviewState): Promise<void> => {
      const state = translationReviewRef.current
      if (
        !state ||
        state !== expectedState ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current ||
        state.retryingFieldId ||
        state.memoryRetry ||
        state.proposals.length > 0
      ) {
        return
      }
      const modeler = modelersByKeyRef.current[state.tabKey] as LangToggleModeler | undefined
      if (!modeler) return
      const binding = captureWorkspaceOperation()
      const localizationBinding = workspaceLocalizationBindingRef.current
      if (!isWorkspaceOperationCurrent(binding)) return
      const operation = {
        kind: 'apply' as const,
        nonce: ++translationOperationNonceRef.current,
        tabKey: state.tabKey
      }
      const operationBelongs = (): boolean =>
        translationFinalizationOperationRef.current === operation &&
        isWorkspaceOperationCurrent(binding)
      translationFinalizationOperationRef.current = operation
      setTranslatingTab(state.tabKey)
      setTranslationFinalizingTab(state.tabKey)
      setTranslationReview((current) =>
        current?.tabKey === state.tabKey && current.review === state.review
          ? {
              ...current,
              status: t('translationReview.applying'),
              technicalDetail: null
            }
          : current
      )
      try {
        let localizationSnapshot = workspaceLocalizationSnapshotRef.current
        if (state.localizationRevision.binding !== localizationBinding) {
          const fresh = inspectDiagramLocalization(modeler, state.review.target, {
            source: state.review.source,
            ...(localizationSnapshot?.resources ?? DEFAULT_LOCALIZATION_RESOURCES)
          })
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey && current.review === state.review
              ? {
                  ...current,
                  review: fresh,
                  localizationRevision: translationLocalizationRevision(
                    localizationBinding,
                    localizationSnapshot
                  ),
                  status: t('translationReview.stale'),
                  technicalDetail: null,
                  retryingFieldId: null,
                  proposals: [],
                  acceptedValues: []
                }
              : current
          )
          return
        }
        if (localizationBinding) {
          localizationSnapshot = await loadWorkspaceLocalizationCoordinated(
            localizationBinding,
            binding
          )
          if (!operationBelongs()) return
          commitWorkspaceLocalizationSnapshot(localizationBinding, localizationSnapshot)
        }
        if (
          !translationLocalizationRevisionMatches(
            state.localizationRevision,
            localizationBinding,
            localizationSnapshot
          )
        ) {
          const fresh = inspectDiagramLocalization(modeler, state.review.target, {
            source: state.review.source,
            ...(localizationSnapshot?.resources ?? DEFAULT_LOCALIZATION_RESOURCES)
          })
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey && current.review === state.review
              ? {
                  ...current,
                  review: fresh,
                  localizationRevision: translationLocalizationRevision(
                    localizationBinding,
                    localizationSnapshot
                  ),
                  status: t('translationReview.stale'),
                  technicalDetail: null,
                  retryingFieldId: null,
                  proposals: [],
                  acceptedValues: []
                }
              : current
          )
          return
        }
        const latest = translationReviewRef.current
        if (
          !operationBelongs() ||
          latest?.tabKey !== state.tabKey ||
          latest.review !== state.review ||
          latest.acceptedValues !== state.acceptedValues ||
          latest.proposals.length > 0 ||
          latest.memoryRetry
        ) {
          return
        }
        const post =
          state.acceptedValues.length > 0
            ? applyStagedTranslationRecoveryValues(
                modeler,
                state.review,
                state.acceptedValues.map((accepted) => ({
                  fieldId: translationRecoveryFieldId(accepted),
                  value: accepted.value
                }))
              )
            : (() => {
                const fresh = inspectDiagramLocalization(modeler, state.review.target, {
                  source: state.review.source,
                  ...state.review.localResources
                })
                if (!fresh.complete) return null
                const result = applyDiagramLocalizationReview(modeler, fresh)
                return result.complete ? result.review : null
              })()
        if (!post) {
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey && current.review === state.review
              ? {
                  ...current,
                  status: t('translationReview.partialStatus'),
                  technicalDetail: null,
                  retryingFieldId: null
                }
              : current
          )
          return
        }
        if (!operationBelongs()) return
        const acceptedPairs = state.acceptedValues
          .map((accepted) => acceptedPairForReviewedField(post, accepted))
          .filter((pair): pair is AcceptedTranslationPair => pair !== null)
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.review === state.review
            ? {
                ...current,
                review: post,
                localizationRevision: translationLocalizationRevision(
                  localizationBinding,
                  localizationSnapshot
                ),
                proposals: [],
                acceptedValues: [],
                status: t('translationReview.memorySaving'),
                technicalDetail: null,
                retryingFieldId: null
              }
            : current
        )
        const memory = await persistAcceptedTranslationPairs(localizationBinding, acceptedPairs)
        if (!operationBelongs() || memory.status === 'stale') return
        const finalReview =
          memory.status === 'saved' && memory.snapshot
            ? rebaseTranslationReviewAfterMemorySave(modeler, post, memory.snapshot)
            : post
        if (memory.status === 'failed' && localizationBinding) {
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey && current.review === post
              ? {
                  ...current,
                  review: finalReview,
                  localizationRevision: translationLocalizationRevision(
                    localizationBinding,
                    memory.snapshot ?? localizationSnapshot
                  ),
                  status: t('translationReview.memorySaveFailed'),
                  technicalDetail: boundedTranslationTechnicalDetail(memory.error),
                  memoryRetry: {
                    binding: localizationBinding,
                    pairs: acceptedPairs
                  }
                }
              : current
          )
          return
        }
        setTranslationReview((current) => (current?.tabKey === state.tabKey ? null : current))
        pushToast(t('translate.nothing.switched'), 'info')
      } catch (error) {
        if (!operationBelongs()) return
        if (error instanceof StaleLocalizationReviewError) {
          const fresh = inspectDiagramLocalization(modeler, state.review.target, {
            source: state.review.source,
            ...state.review.localResources
          })
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey
              ? {
                  ...current,
                  review: fresh,
                  status: t('translationReview.stale'),
                  technicalDetail: null,
                  retryingFieldId: null,
                  proposals: [],
                  acceptedValues: []
                }
              : current
          )
        } else {
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey
              ? {
                  ...current,
                  status: t('translate.failed'),
                  technicalDetail: boundedTranslationTechnicalDetail(error)
                }
              : current
          )
        }
      } finally {
        const owned = translationFinalizationOperationRef.current === operation
        if (owned) {
          translationFinalizationOperationRef.current = null
          setTranslationFinalizingTab((current) => (current === state.tabKey ? null : current))
          setTranslatingTab((current) => (current === state.tabKey ? null : current))
        }
      }
    },
    [
      captureWorkspaceOperation,
      commitWorkspaceLocalizationSnapshot,
      isWorkspaceOperationCurrent,
      loadWorkspaceLocalizationCoordinated,
      persistAcceptedTranslationPairs,
      pushToast,
      setTranslationReview
    ]
  )

  const handleTranslationRetryField = useCallback(
    async (
      expectedState: TranslationReviewState,
      requestedField: TranslationRecoveryField,
      confirmation: TranslationFieldRetryConfirmation
    ): Promise<void> => {
      const state = translationReviewRef.current
      if (
        !state ||
        state !== expectedState ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current ||
        state.retryingFieldId ||
        state.memoryRetry
      ) {
        return
      }
      const field = listTranslationRecoveryFields(state.review).find(
        (candidate) =>
          candidate.id === requestedField.id &&
          candidate.sourceLanguage === requestedField.sourceLanguage &&
          candidate.sourceValue === requestedField.sourceValue &&
          candidate.target === requestedField.target
      )
      if (!field) return
      if (state.acceptedValues.some((accepted) => proposalMatchesField(accepted, field))) return
      if (!state.providerId) {
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey
            ? {
                ...current,
                status: t('translationReview.noProvider'),
                technicalDetail: null
              }
            : current
        )
        return
      }
      const modeler = modelersByKeyRef.current[state.tabKey] as
        (TranslateModeler & LangToggleModeler) | undefined
      if (!modeler) return
      try {
        // Refuse to disclose stale text. The same assertion runs again before a
        // provider result may be surfaced as an acceptance proposal.
        assertLocalizationReviewCurrent(modeler, state.review)
      } catch (error) {
        if (!(error instanceof StaleLocalizationReviewError)) throw error
        const fresh = inspectDiagramLocalization(modeler, state.review.target, {
          source: state.review.source,
          ...state.review.localResources
        })
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.review === state.review
            ? {
                ...current,
                review: fresh,
                status: t('translationReview.stale'),
                technicalDetail: null,
                retryingFieldId: null,
                proposals: [],
                acceptedValues: []
              }
            : current
        )
        return
      }

      const provider =
        state.providerId === 'free'
          ? { providerId: 'google-translate+mymemory' }
          : state.aiSelection
            ? {
                providerId: state.aiSelection.providerId,
                modelId: state.aiSelection.modelId
              }
            : null
      if (!provider) {
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey
            ? {
                ...current,
                status: t('translationReview.noProvider'),
                technicalDetail: null
              }
            : current
        )
        return
      }
      if (
        state.providerId === 'selected-ai' &&
        (!state.aiSelection || !hasKey(state.aiSelection.providerId))
      ) {
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey
            ? { ...current, status: t('translate.noKey'), technicalDetail: null }
            : current
        )
        return
      }

      const disclosure = buildTranslationRecoveryDisclosure(field, provider)
      if (
        confirmation.disclosure.fingerprint !== disclosure.fingerprint ||
        !hasExternalRequestConsent(disclosure, confirmation.consent)
      ) {
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.review === state.review
            ? {
                ...current,
                status: t('translationReview.field.consentRequired'),
                technicalDetail: null,
                retryingFieldId: null
              }
            : current
        )
        return
      }
      const consent = confirmation.consent
      const binding = captureWorkspaceOperation()
      if (!isWorkspaceOperationCurrent(binding) || translationAbortRef.current) return
      const controller = new AbortController()
      const operationBelongs = (): boolean =>
        translationAbortRef.current === controller && isWorkspaceOperationCurrent(binding)
      const operationIsCurrent = (): boolean => !controller.signal.aborted && operationBelongs()
      translationAbortRef.current = controller
      setTranslatingTab(state.tabKey)
      setTranslationReview((current) =>
        current?.tabKey === state.tabKey && current.review === state.review
          ? {
              ...current,
              status: t('translationReview.running'),
              technicalDetail: null,
              retryingFieldId: field.id
            }
          : current
      )

      try {
        const run = {
          field,
          disclosure,
          consent,
          signal: controller.signal
        }
        const value =
          state.providerId === 'free'
            ? await translateReviewedFieldWithTexts(
                makeFreeTranslateTexts({
                  onAttempt: (attempt) => {
                    if (controller.signal.aborted || !operationIsCurrent()) return
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
                      operationIsCurrent() &&
                      current?.tabKey === state.tabKey &&
                      current.review === state.review
                        ? { ...current, status }
                        : current
                    )
                  }
                }),
                run
              )
            : await translateReviewedField(
                makeBrowserCallLLM(
                  {
                    providerId: state.aiSelection!.providerId,
                    model: state.aiSelection!.modelId,
                    apiKey: getKey(state.aiSelection!.providerId) ?? '',
                    referer: typeof location !== 'undefined' ? location.origin : undefined,
                    title: 'OrbitPM Process Studio Lite'
                  },
                  { signal: controller.signal }
                ),
                run
              )
        if (!operationIsCurrent()) return
        const latest = translationReviewRef.current
        if (
          latest?.tabKey !== state.tabKey ||
          latest.review !== state.review ||
          latest.providerId !== state.providerId ||
          latest.aiSelection !== state.aiSelection
        ) {
          return
        }
        assertLocalizationReviewCurrent(modeler, state.review)
        const validation =
          value === undefined ? null : validateTranslationRecoveryValue(state.review, field, value)
        if (!validation?.valid) {
          const failedReview = inspectDiagramLocalization(modeler, state.review.target, {
            source: state.review.source,
            providerFailures: providerFailuresWithField(state.review, field),
            ...state.review.localResources
          })
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey && current.review === state.review
              ? {
                  ...current,
                  review: failedReview,
                  status: t('translationReview.partialStatus'),
                  technicalDetail: null,
                  retryingFieldId: null
                }
              : current
          )
          return
        }
        // A successful provider response is only a proposal. It remains
        // unresolved and cannot reach BPMN or translation memory until the user
        // explicitly accepts it (or edits and saves a corrected value).
        const proposal: ReviewedTranslationProposal = {
          processId: field.processId,
          elementId: field.elementId,
          field: field.field,
          sourceLanguage: field.sourceLanguage,
          sourceValue: field.sourceValue,
          target: field.target,
          value: validation.value
        }
        const proposals = [...proposalsWithoutField(state.proposals, field), proposal]
        const review = inspectDiagramLocalization(modeler, state.review.target, {
          source: state.review.source,
          providerFailures: providerFailuresWithoutField(state.review, field),
          ...state.review.localResources
        })
        if (!operationIsCurrent()) return
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.review === state.review
            ? {
                ...current,
                review,
                proposals,
                status: t('translationReview.proposalStatus', { count: proposals.length }),
                technicalDetail: null,
                retryingFieldId: null
              }
            : current
        )
      } catch (error) {
        if (!operationBelongs()) return
        const cancelled =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        let stale = error instanceof StaleLocalizationReviewError
        if (!cancelled && !stale) {
          try {
            assertLocalizationReviewCurrent(modeler, state.review)
          } catch (currentError) {
            stale = currentError instanceof StaleLocalizationReviewError
          }
        }
        const review = stale
          ? inspectDiagramLocalization(modeler, state.review.target, {
              source: state.review.source,
              ...state.review.localResources
            })
          : cancelled
            ? state.review
            : inspectDiagramLocalization(modeler, state.review.target, {
                source: state.review.source,
                providerFailures: providerFailuresWithField(state.review, field),
                ...state.review.localResources
              })
        const status = cancelled
          ? t('translationReview.cancelled')
          : stale
            ? t('translationReview.stale')
            : error instanceof FreeTranslateError
              ? t(
                  error.code === 'rate'
                    ? 'translate.free.rate'
                    : error.code === 'offline'
                      ? 'translate.free.offline'
                      : 'translate.free.down'
                )
              : t('translate.failed')
        const technicalDetail =
          cancelled || stale || error instanceof FreeTranslateError
            ? null
            : boundedTranslationTechnicalDetail(error)
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.review === state.review
            ? {
                ...current,
                review,
                status,
                technicalDetail,
                retryingFieldId: null,
                proposals: stale ? [] : current.proposals,
                acceptedValues: stale ? [] : current.acceptedValues
              }
            : current
        )
      } finally {
        if (translationAbortRef.current === controller) {
          translationAbortRef.current = null
          if (isWorkspaceOperationCurrent(binding)) {
            setTranslationReview((current) =>
              current?.tabKey === state.tabKey && current.retryingFieldId === field.id
                ? { ...current, retryingFieldId: null }
                : current
            )
            setTranslationFinalizingTab((current) => (current === state.tabKey ? null : current))
            setTranslatingTab((current) => (current === state.tabKey ? null : current))
          }
        }
      }
    },
    [captureWorkspaceOperation, isWorkspaceOperationCurrent, setTranslationReview]
  )

  const handleTranslationRetryMemory = useCallback(
    async (
      expectedState: TranslationReviewState,
      expectedPending: NonNullable<TranslationReviewState['memoryRetry']>
    ): Promise<void> => {
      const state = translationReviewRef.current
      const pending = state?.memoryRetry
      if (
        !state ||
        state !== expectedState ||
        !pending ||
        pending !== expectedPending ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current
      ) {
        return
      }
      const modeler = modelersByKeyRef.current[state.tabKey] as LangToggleModeler | undefined
      if (!modeler) return
      const binding = captureWorkspaceOperation()
      if (
        !isWorkspaceOperationCurrent(binding) ||
        workspaceLocalizationBindingRef.current !== pending.binding ||
        pending.binding.controller.signal.aborted
      ) {
        return
      }
      const operation = {
        kind: 'memory' as const,
        nonce: ++translationOperationNonceRef.current,
        tabKey: state.tabKey
      }
      const operationBelongs = (): boolean =>
        translationFinalizationOperationRef.current === operation &&
        isWorkspaceOperationCurrent(binding) &&
        workspaceLocalizationBindingRef.current === pending.binding
      translationFinalizationOperationRef.current = operation

      setTranslatingTab(state.tabKey)
      setTranslationFinalizingTab(state.tabKey)
      setTranslationReview((current) =>
        current?.tabKey === state.tabKey && current.memoryRetry === pending
          ? {
              ...current,
              status: t('translationReview.memorySaving'),
              technicalDetail: null
            }
          : current
      )
      try {
        const memory = await persistAcceptedTranslationPairs(pending.binding, pending.pairs, {
          reloadBeforeWrite: true
        })
        if (!operationBelongs() || memory.status === 'stale') {
          return
        }
        if (memory.status === 'failed') {
          const review = memory.snapshot
            ? rebaseTranslationReviewAfterMemorySave(modeler, state.review, memory.snapshot)
            : state.review
          setTranslationReview((current) =>
            current?.tabKey === state.tabKey && current.memoryRetry === pending
              ? {
                  ...current,
                  review,
                  localizationRevision: translationLocalizationRevision(
                    pending.binding,
                    memory.snapshot ?? workspaceLocalizationSnapshotRef.current
                  ),
                  status: t('translationReview.memorySaveFailed'),
                  technicalDetail: boundedTranslationTechnicalDetail(memory.error)
                }
              : current
          )
          return
        }
        const review =
          memory.status === 'saved' && memory.snapshot
            ? rebaseTranslationReviewAfterMemorySave(modeler, state.review, memory.snapshot)
            : state.review
        if (!review.complete) {
          setTranslationReview((current) => {
            if (current?.tabKey !== state.tabKey || current.memoryRetry !== pending) return current
            const { memoryRetry: _completed, ...withoutMemoryRetry } = current
            return {
              ...withoutMemoryRetry,
              review,
              localizationRevision: translationLocalizationRevision(
                pending.binding,
                memory.snapshot ?? workspaceLocalizationSnapshotRef.current
              ),
              status: t('translationReview.partialStatus'),
              technicalDetail: null,
              retryingFieldId: null
            }
          })
          return
        }
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.memoryRetry === pending ? null : current
        )
        pushToast(t('translate.nothing.switched'), 'info')
      } finally {
        const owned = translationFinalizationOperationRef.current === operation
        if (owned) {
          translationFinalizationOperationRef.current = null
          setTranslationFinalizingTab((current) => (current === state.tabKey ? null : current))
          setTranslatingTab((current) => (current === state.tabKey ? null : current))
        }
      }
    },
    [
      captureWorkspaceOperation,
      isWorkspaceOperationCurrent,
      persistAcceptedTranslationPairs,
      pushToast,
      setTranslationReview
    ]
  )

  const handleTranslationContinueWithoutMemory = useCallback(
    (
      expectedState: TranslationReviewState,
      expectedPending: NonNullable<TranslationReviewState['memoryRetry']>
    ): void => {
      const state = translationReviewRef.current
      const pending = state?.memoryRetry
      if (
        !state ||
        state !== expectedState ||
        !pending ||
        pending !== expectedPending ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current
      ) {
        return
      }
      let skipped = false
      setTranslationReview((current) => {
        if (current?.tabKey !== state.tabKey || current.memoryRetry !== pending) return current
        skipped = true
        return null
      })
      if (skipped) {
        pushToast(t('translationReview.memorySkipped'), 'info')
      }
    },
    [pushToast, setTranslationReview]
  )

  const handleTranslationCancel = useCallback((expectedState: TranslationReviewState) => {
    if (
      translationReviewRef.current !== expectedState ||
      translationFinalizationOperationRef.current
    ) {
      return
    }
    translationAbortRef.current?.abort()
  }, [])

  const handleTranslationNow = useCallback(
    async (
      expectedState: TranslationReviewState,
      expectedDisclosure: typeof translationDisclosure
    ) => {
      const state = translationReviewRef.current
      if (
        !state ||
        state !== expectedState ||
        translationAbortRef.current ||
        translationFinalizationOperationRef.current ||
        state.memoryRetry ||
        state.proposals.length > 0 ||
        state.acceptedValues.length > 0
      ) {
        return
      }
      if (!state.providerId) {
        setTranslationReview((current) =>
          current === state
            ? {
                ...current,
                status: t('translationReview.noProvider'),
                technicalDetail: null
              }
            : current
        )
        return
      }
      const disclosure = expectedDisclosure
      if (!disclosure || translationAbortRef.current) {
        return
      }
      const modeler = modelersByKeyRef.current[state.tabKey] as
        (TranslateModeler & LangToggleModeler) | undefined
      if (!modeler) return
      const binding = captureWorkspaceOperation()
      if (!isWorkspaceOperationCurrent(binding) || translationAbortRef.current) return
      const controller = new AbortController()
      const operationBelongs = (): boolean =>
        translationAbortRef.current === controller && isWorkspaceOperationCurrent(binding)
      const operationIsCurrent = (): boolean => !controller.signal.aborted && operationBelongs()
      translationAbortRef.current = controller
      setTranslatingTab(state.tabKey)
      setTranslationReview({
        ...state,
        status: t('translationReview.running'),
        technicalDetail: null
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
                    if (controller.signal.aborted || !operationIsCurrent()) {
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
                      operationIsCurrent() &&
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
        if (!operationIsCurrent()) return
        const latest = translationReviewRef.current
        if (
          latest?.tabKey !== state.tabKey ||
          latest.review !== state.review ||
          latest.providerId !== state.providerId ||
          latest.aiSelection !== state.aiSelection
        ) {
          return
        }
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.review === state.review
            ? {
                ...current,
                review: result.review,
                proposals: result.proposals,
                status:
                  result.proposals.length > 0
                    ? t('translationReview.proposalStatus', {
                        count: result.proposals.length
                      })
                    : t('translationReview.partialStatus'),
                technicalDetail: null,
                retryingFieldId: null
              }
            : current
        )
      } catch (err) {
        if (!operationBelongs()) return
        const cancelled =
          controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')
        const stale = err instanceof StaleLocalizationReviewError
        const failures = stale
          ? []
          : state.review.queue
              .filter((item) => item.requiresSegmentationReview !== true)
              .map((item) => ({
                processId: item.processId,
                elementId: item.elementId,
                field: item.field,
                target: item.target,
                originalValue: item.sourceValue
              }))
        const failedReview = cancelled
          ? state.review
          : inspectDiagramLocalization(modeler, state.review.target, {
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
              : t('translate.failed')
        const technicalDetail =
          cancelled || stale || err instanceof FreeTranslateError
            ? null
            : boundedTranslationTechnicalDetail(err)
        setTranslationReview((current) =>
          current?.tabKey === state.tabKey && current.review === state.review
            ? {
                ...current,
                review: failedReview,
                status,
                technicalDetail,
                proposals: stale ? [] : current.proposals,
                acceptedValues: stale ? [] : current.acceptedValues
              }
            : current
        )
      } finally {
        if (translationAbortRef.current === controller) {
          translationAbortRef.current = null
          if (isWorkspaceOperationCurrent(binding)) {
            setTranslationFinalizingTab((current) => (current === state.tabKey ? null : current))
            setTranslatingTab((current) => (current === state.tabKey ? null : current))
          }
        }
      }
    },
    [captureWorkspaceOperation, isWorkspaceOperationCurrent, setTranslationReview]
  )

  // Interview apply-path: the assistant regenerated the diagram from the
  // running Q&A — import it into the LIVE modeler of the target tab (bypassing
  // `contents`, which only seeds the initial mount), refit the view, and mark
  // the tab dirty via a benign same-value command (importXML resets the command
  // stack, which would otherwise leave regenerated-but-unsaved work looking
  // "saved" to the close/switch guards).
  const handleApplyInterviewXml = useCallback(
    async (tabKey: string, xml: string, request: InterviewApplyRequest) => {
      const binding = captureWorkspaceOperation()
      const controller = binding.controller
      const tab = tabsRef.current.find((candidate) => candidate.key === tabKey)
      const modeler = modelersByKeyRef.current[tabKey] as
        | {
            saveXML(options: { format: boolean }): Promise<{ xml?: string }>
            get(name: string): unknown
          }
        | undefined
      const session = controller?.store.get(tabKey)
      const runExclusiveXmlTransaction = commandsRef.current[tabKey]?.runExclusiveXmlTransaction
      if (
        !controller ||
        !tab ||
        !modeler ||
        !session ||
        session.modeler !== modeler ||
        !runExclusiveXmlTransaction
      ) {
        throw new Error('editor not ready')
      }
      const sessionIncarnation = session.incarnation
      const sessionRevision = session.revision
      const sessionXml = session.currentXml

      const previousToken = interviewApplyTokenByTabRef.current.get(tabKey)
      if (previousToken !== undefined && request.requestToken < previousToken) {
        throw new DOMException('Interview request was superseded.', 'AbortError')
      }
      interviewApplyTokenByTabRef.current.set(tabKey, request.requestToken)
      const isCurrent = (): boolean =>
        !request.signal.aborted &&
        interviewApplyTokenByTabRef.current.get(tabKey) === request.requestToken &&
        isWorkspaceOperationCurrent(binding) &&
        tab.gen === binding.generation &&
        tabsRef.current.some(
          (candidate) => candidate.key === tabKey && candidate.gen === tab.gen
        ) &&
        modelersByKeyRef.current[tabKey] === modeler &&
        controller.store.get(tabKey)?.incarnation === sessionIncarnation &&
        controller.store.get(tabKey)?.modeler === modeler
      const assertCurrent = (): void => {
        if (request.signal.aborted) {
          throw (
            request.signal.reason ??
            new DOMException('Interview request was cancelled.', 'AbortError')
          )
        }
        if (interviewApplyTokenByTabRef.current.get(tabKey) !== request.requestToken) {
          throw new DOMException('Interview request was superseded.', 'AbortError')
        }
        if (!isCurrent()) throw new Error(t('alert.staleWrite'))
      }

      assertCurrent()
      invalidateLiveXmlCapture(tabKey)
      try {
        await runExclusiveXmlTransaction(async (transaction) => {
          if (transaction.modeler !== modeler) {
            throw new DOMException('The editor modeler is no longer active.', 'AbortError')
          }
          const assertTransactionCurrent = (): void => {
            transaction.assertActive()
            assertCurrent()
          }

          assertTransactionCurrent()
          const { xml: previousXml } = await transaction.modeler.saveXML({
            format: true
          })
          assertTransactionCurrent()
          if (!previousXml) throw new Error('editor returned no XML')
          await validateReleaseXml(xml, {
            action: 'create-generated',
            knownProcessIds: binding.index.processIndex().keys(),
            requireBilingual: true,
            requireDi: true
          })
          assertTransactionCurrent()
          const replacementPreservation = await validateUnknownExtensionPreservation(
            previousXml,
            xml
          )
          assertTransactionCurrent()
          if (!replacementPreservation.valid) {
            throw new Error(t('sourceEditor.preservationBlocked'))
          }

          // Validation can yield long enough for a programmatic or not-yet
          // inert command to change the canvas. Re-read immediately before the
          // first import so the reviewed replacement never overwrites it.
          const { xml: preImportXml } = await transaction.modeler.saveXML({
            format: true
          })
          assertTransactionCurrent()
          if (!preImportXml || preImportXml !== previousXml) {
            throw new Error(t('session.save.newerEdits'))
          }

          let mutationAttempted = false
          try {
            mutationAttempted = true
            await transaction.importXml(xml)
            invalidateLiveXmlCapture(tabKey)
            assertTransactionCurrent()
            const { xml: roundTripXml } = await transaction.modeler.saveXML({
              format: true
            })
            assertTransactionCurrent()
            if (!roundTripXml) throw new Error('editor returned no XML after import')
            const roundTripPreservation = await validateUnknownExtensionPreservation(
              xml,
              roundTripXml
            )
            assertTransactionCurrent()
            if (!roundTripPreservation.valid) {
              throw new Error(t('sourceEditor.preservationBlocked'))
            }
            await validateReleaseXml(roundTripXml, {
              action: 'create-generated',
              knownProcessIds: binding.index.processIndex().keys(),
              requireBilingual: true,
              requireDi: true
            })
            assertTransactionCurrent()

            autoSizeAll(transaction.modeler)
            invalidateLiveXmlCapture(tabKey)
            assertTransactionCurrent()
            try {
              ;(
                transaction.modeler.get('canvas') as {
                  zoom(m: 'fit-viewport'): void
                }
              ).zoom('fit-viewport')
            } catch {
              /* zoom is cosmetic */
            }
            assertTransactionCurrent()
            const canvas = transaction.modeler.get('canvas') as {
              getRootElement(): {
                businessObject?: { get?: (key: string) => unknown }
              }
            }
            const root = canvas.getRootElement()
            const currentLanguage = root.businessObject?.get?.('orbitpm:activeLang')
            ;(
              transaction.modeler.get('modeling') as {
                updateProperties(element: unknown, properties: Record<string, unknown>): void
              }
            ).updateProperties(root, {
              'orbitpm:activeLang':
                typeof currentLanguage === 'string' && currentLanguage ? currentLanguage : 'en'
            })
            invalidateLiveXmlCapture(tabKey)
            assertTransactionCurrent()

            const { xml: finalXml } = await transaction.modeler.saveXML({
              format: true
            })
            assertTransactionCurrent()
            if (!finalXml) throw new Error('editor returned no XML after import')
            const finalPreservation = await validateUnknownExtensionPreservation(xml, finalXml)
            assertTransactionCurrent()
            if (!finalPreservation.valid) {
              throw new Error(t('sourceEditor.preservationBlocked'))
            }
            await validateReleaseXml(finalXml, {
              action: 'create-generated',
              knownProcessIds: binding.index.processIndex().keys(),
              requireBilingual: true,
              requireDi: true
            })
            assertTransactionCurrent()

            const currentSession = controller.store.get(tabKey)
            if (
              !currentSession ||
              currentSession.incarnation !== sessionIncarnation ||
              currentSession.modeler !== modeler ||
              currentSession.revision !== sessionRevision ||
              currentSession.currentXml !== sessionXml
            ) {
              throw new Error(t('alert.staleWrite'))
            }
            const updated = controller.updateXml(tabKey, finalXml)
            binding.drafts?.track(updated)
            binding.index.updateDirty(liveIndexPath(tab), finalXml)
            dirtyByKeyRef.current = {
              ...dirtyByKeyRef.current,
              [tabKey]: true
            }
            setDirtyByKey((previous) => ({ ...previous, [tabKey]: true }))
            setLiveWorkspaceVersion(binding.index.version)
            digestsCacheRef.current = null
            localizationSourceByTabRef.current.set(tabKey, LocalizationSource.Ai)
          } catch (error) {
            if (mutationAttempted) {
              try {
                transaction.assertActive()
                await transaction.importXml(previousXml)
                invalidateLiveXmlCapture(tabKey)
                transaction.restoreDirtyState()
              } catch {
                /* preserve the original replacement error */
              }
            }
            throw error
          }
        })
      } finally {
        // App also listens to command-stack events for debounced live indexing.
        // This transaction publishes its exact final XML synchronously, so any
        // import/autosize timer is stale on either success or rollback.
        invalidateLiveXmlCapture(tabKey)
      }
    },
    [captureWorkspaceOperation, invalidateLiveXmlCapture, isWorkspaceOperationCurrent]
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
      accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
      style={{ display: 'none' }}
      onChange={(e) => void onFileInputChange(e)}
    />
  )
  const hiddenImportInput = (
    <input
      ref={importInputRef}
      type="file"
      accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
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
  const reviewedXmlDialog = reviewedXmlReviewRequest ? (
    <ReviewedXmlIngestionDialog
      request={reviewedXmlReviewRequest}
      onDecision={(decision) => {
        reviewedXmlReviewQueueRef.current?.decide(decision)
      }}
    />
  ) : null
  const generatedLayoutReviewDialog = generatedLayoutReview ? (
    <AccessibleDialog
      ariaLabelledby="single-file-layout-review-title"
      ariaDescribedby="single-file-layout-review-description"
      onClose={() => settleGeneratedLayoutReview(generatedLayoutReview.id, false)}
      closeOnEscape
      closeOnBackdrop={false}
      backdropClassName="orbitpm-validation__backdrop"
      dialogClassName="orbitpm-source-editor"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <header className="orbitpm-validation__header">
        <div>
          <h2 id="single-file-layout-review-title" tabIndex={-1}>
            {t('sourceEditor.layoutReady')}
          </h2>
          <p id="single-file-layout-review-description">{t('sourceEditor.missingDi')}</p>
        </div>
        <button
          type="button"
          onClick={() => settleGeneratedLayoutReview(generatedLayoutReview.id, false)}
          aria-label={t('modal.close.aria')}
        >
          ×
        </button>
      </header>
      <div
        className="orbitpm-source-editor__layout-preview orbitpm-single-file-layout-review__body"
        data-single-file-layout-scroll-region
      >
        <ReadOnlyDiagramPreview
          xml={generatedLayoutReview.xml}
          title={t('sourceEditor.layoutDiagramTitle')}
          ariaLabel={t('sourceEditor.layoutDiagramAria')}
          onStatusChange={(status) => {
            setGeneratedLayoutReview((current) =>
              current?.id === generatedLayoutReview.id
                ? { ...current, renderStatus: status.status }
                : current
            )
          }}
        />
      </div>
      <footer className="orbitpm-validation__footer">
        <button
          type="button"
          onClick={() => settleGeneratedLayoutReview(generatedLayoutReview.id, false)}
        >
          {t('modal.cancel')}
        </button>
        <button
          type="button"
          className="orbitpm-validation__primary"
          disabled={generatedLayoutReview.renderStatus !== 'ready'}
          onClick={() => settleGeneratedLayoutReview(generatedLayoutReview.id, true)}
        >
          {t('sourceEditor.layoutAccept')}
        </button>
      </footer>
    </AccessibleDialog>
  ) : null

  if (phase === 'loading') {
    return (
      <>
        <div style={{ padding: '2rem' }}>{t('app.loading')}</div>
        {generatedLayoutReviewDialog}
      </>
    )
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
        {reviewedXmlDialog}
        {generatedLayoutReviewDialog}
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
  const renderedWorkspaceBinding = captureWorkspaceOperation()

  return (
    <ResponsiveShell direction={dir} mode={responsiveMode} className="orbitpm-workspace-shell">
      <a className="orbitpm-skip-link" href="#orbitpm-process-workspace">
        {t('app.skipToMain')}
      </a>
      {hiddenFileInput}
      {hiddenImportInput}
      {hiddenLibraryInput}
      {hiddenBackupInput}
      <header className="orbitpm-workspace-header">
        <span className="orbitpm-workspace-header__identity">
          <img src={ICON_DATA_URI} width={20} height={20} alt="" style={{ borderRadius: 5 }} />
          <strong style={{ fontSize: 13 }}>{t('app.title')}</strong>
          <span
            aria-label={t('app.version.aria', { version: __APP_VERSION__ })}
            style={{ fontSize: 11, opacity: 0.65 }}
          >
            v{__APP_VERSION__}
          </span>
          <span
            className="orbitpm-workspace-header__storage"
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
          <span className="orbitpm-workspace-header__navigation">
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
          <div ref={searchBoxRef} className="orbitpm-workspace-header__search">
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

        <div className="orbitpm-workspace-header__actions">
          {responsiveMode !== 'docked' && (
            <button
              ref={explorerToggleRef}
              type="button"
              className="orbitpm-lite-chrome-btn orbitpm-workspace-header__explorer"
              onClick={(event) => {
                if (!explorerOpen) explorerReturnFocusRef.current = event.currentTarget
                setExplorerOpen(!explorerOpen)
              }}
              aria-label={t('sidebar.toggle.aria')}
              aria-expanded={explorerOpen}
              aria-controls="orbitpm-workspace-explorer"
              title={t(explorerOpen ? 'sidebar.hide.title' : 'sidebar.show.title')}
            >
              <span aria-hidden="true">☰</span>
            </button>
          )}
          <button
            type="button"
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
          <ActionMenu
            mode={responsiveMode === 'compact' ? 'menu' : 'inline'}
            label={t('app.actions.aria')}
            direction={dir}
            triggerClassName="orbitpm-lite-chrome-btn orbitpm-workspace-header__more"
          >
            {responsiveMode === 'compact' && (
              <>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  onClick={handleBack}
                  disabled={!backEnabled}
                >
                  {t('nav.back')}
                </button>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  onClick={handleForward}
                  disabled={!forwardEnabled}
                >
                  {t('nav.forward')}
                </button>
                {isMultiFileMode(mode) && (
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    onClick={() => setCatalogOpen(true)}
                  >
                    {t('app.home')}
                  </button>
                )}
              </>
            )}
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
          </ActionMenu>
        </div>
      </header>

      <div className="orbitpm-workspace-body" onDragOver={handleAppDragOver} onDrop={handleAppDrop}>
        <ResponsiveDrawer
          id="orbitpm-workspace-explorer"
          className="orbitpm-workspace-explorer"
          open={explorerOpen}
          mode={responsiveMode}
          side="inline-start"
          label={t('sidebar.explorer.aria')}
          direction={dir}
          onClose={() => setExplorerOpen(false)}
          initialFocusRef={explorerCloseRef}
          returnFocusRef={explorerReturnFocusRef}
          inlineSize={sidebarWidth ?? 'clamp(240px, 24vw, 320px)'}
          keepMounted
          modalChrome={
            responsiveMode !== 'docked' ? (
              <button
                ref={explorerCloseRef}
                type="button"
                className="orbitpm-workspace-explorer__close"
                onClick={() => setExplorerOpen(false)}
                aria-label={t('sidebar.close.aria')}
                title={t('sidebar.close.aria')}
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : undefined
          }
        >
          <div className="orbitpm-workspace-explorer__content">
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
                      onMove={(node) =>
                        setMoveTarget({
                          binding: renderedWorkspaceBinding,
                          node
                        })
                      }
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
            <div
              hidden={aiSectionCollapsed}
              style={{ flex: '0 1 auto', maxHeight: '55%', overflowY: 'auto' }}
            >
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
                  historyManager: renderedWorkspaceBinding.history,
                  folders,
                  knownProcessIds: processCatalog.map(({ id }) => id),
                  getCurrentWorkspaceId: () => workspaceAdapterRef.current?.id,
                  runWorkspaceExclusive: (operation) =>
                    runCoordinatedWorkspaceMutation(renderedWorkspaceBinding, async (lease) =>
                      operation((changes) => lease.publish(changes))
                    ),
                  onOpenSingle: (xml, name) => {
                    openVirtualTab(baseName(name), xml, {
                      collapse: false,
                      autoSizeOnImport: true,
                      localizationSource: LocalizationSource.Excel
                    })
                  },
                  onReviewBilingual: async (request) => {
                    const binding = renderedWorkspaceBinding
                    const isCurrent = (): boolean =>
                      !request.signal.aborted && isWorkspaceOperationCurrent(binding)
                    try {
                      const outcome = await reviewBpmnXmlLocalization(request.xml, {
                        source: LocalizationSource.Excel,
                        target: lang,
                        defaultActive: lang,
                        resources:
                          workspaceLocalizationSnapshot?.resources ??
                          DEFAULT_LOCALIZATION_RESOURCES,
                        validation: {
                          adapters: getRuntimeValidationAdapters(),
                          knownProcessIds: processCatalog.map(({ id }) => id),
                          requireDi: true
                        },
                        validationAction: 'create-generated',
                        review: reviewedXmlReviewQueueRef.current!.review,
                        signal: request.signal,
                        isCurrent
                      })
                      if (!isCurrent() || outcome.status !== 'completed') {
                        return { status: 'cancelled' }
                      }
                      return {
                        status: 'completed',
                        reviewedXml: outcome.xml
                      }
                    } catch (error) {
                      if (request.signal.aborted || !isCurrent()) {
                        return { status: 'cancelled' }
                      }
                      throw error
                    }
                  },
                  onCommitted: async (report) => {
                    if (
                      !workspaceAdapter?.storage.capabilities.multipleFiles ||
                      renderedWorkspaceBinding.adapter !== workspaceAdapter ||
                      !isWorkspaceOperationCurrent(renderedWorkspaceBinding)
                    ) {
                      return
                    }
                    await refreshWorkspace(rootHandleRef.current ?? undefined)
                    if (!isWorkspaceOperationCurrent(renderedWorkspaceBinding)) return
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
          </div>
        </ResponsiveDrawer>

        {/* Drag handle for the explorer width — sits on the aside's inline-end
            edge, before the rail. dir-aware so RTL drags resize correctly. */}
        {explorerOpen && responsiveMode === 'docked' && (
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
          onClick={(event) => {
            if (!explorerOpen) explorerReturnFocusRef.current = event.currentTarget
            setExplorerOpen(!explorerOpen)
          }}
          aria-label={t('sidebar.toggle.aria')}
          aria-expanded={explorerOpen}
          aria-controls="orbitpm-workspace-explorer"
          title={t(explorerOpen ? 'sidebar.hide.title' : 'sidebar.show.title')}
        >
          <span aria-hidden>
            {lang === 'ar' ? (explorerOpen ? '⟩' : '⟨') : explorerOpen ? '⟨' : '⟩'}
          </span>
        </button>

        <main
          id="orbitpm-process-workspace"
          ref={editorRegionRef}
          tabIndex={-1}
          aria-label={t('app.main.aria')}
          className="orbitpm-workspace-main"
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
              const liveSession = sessionControllerRef.current?.store.get(tab.key)
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
                      baselineXml={liveSession?.lastSavedXml}
                      initiallyDirty={Boolean(dirtyByKey[tab.key] || liveSession?.dirty)}
                      sourceLocalizationResources={
                        workspaceLocalizationSnapshot?.resources ?? DEFAULT_LOCALIZATION_RESOURCES
                      }
                      onReviewSourceBilingual={reviewedXmlReviewQueueRef.current!.review}
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
                      detailsController={detailsController}
                      responsiveMode={responsiveMode}
                      onDetailsOpenChange={handleDetailsOpenChange}
                      outlineOpen={outlineOpenTabKey === tab.key}
                      onOutlineOpenChange={(open) => handleOutlineOpenChange(tab.key, open)}
                      sidePanesActive={isActive && !showCatalog}
                      exportFileBaseName={tab.title.replace(/\.bpmn$/i, '')}
                      onCommandsReady={(commands) => {
                        commandUnregisterersRef.current[tab.key]?.()
                        delete commandUnregisterersRef.current[tab.key]
                        commandsRef.current[tab.key] = commands
                        if (commands) {
                          commandUnregisterersRef.current[tab.key] =
                            commandRouterRef.current!.register(tab.key, {
                              save: () => {
                                if (!persistenceInteractionLockedRef.current) {
                                  commands.save()
                                }
                              },
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
        className="orbitpm-workspace-footer"
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

      {reviewedXmlDialog}
      {generatedLayoutReviewDialog}

      {translationReview && (
        <TranslationReviewDialog
          review={translationReview.review}
          documentName={
            tabs.find((candidate) => candidate.key === translationReview.tabKey)?.title ??
            translationReview.tabKey
          }
          disclosure={translationDisclosure}
          providers={translationProviders}
          providerId={translationReview.providerId}
          busy={translatingTab === translationReview.tabKey}
          cancellable={translationFinalizingTab !== translationReview.tabKey}
          status={translationReview.status}
          technicalDetail={translationReview.technicalDetail}
          retryingFieldId={translationReview.retryingFieldId}
          proposals={translationReview.proposals}
          acceptedValues={translationReview.acceptedValues}
          onProviderChange={(providerId) => {
            if (providerId !== '' && providerId !== 'selected-ai' && providerId !== 'free') {
              return
            }
            if (
              translationReviewRef.current !== translationReview ||
              translationAbortRef.current ||
              translationFinalizationOperationRef.current
            ) {
              return
            }
            setTranslationReview((current) => {
              if (current !== translationReview || current.memoryRetry) return current
              return {
                ...current,
                providerId,
                // Provider/model changes invalidate any prior consent. The
                // disclosure fingerprint is regenerated from this state.
                status: null,
                technicalDetail: null,
                proposals: []
              }
            })
          }}
          onTranslateNow={handleTranslationNow.bind(null, translationReview, translationDisclosure)}
          onPartialPreview={handleTranslationPartialPreview}
          onApplyCompleted={handleTranslationApplyCompleted.bind(null, translationReview)}
          onRetryField={handleTranslationRetryField.bind(null, translationReview)}
          onManualEdit={handleTranslationManualEdit}
          onAcceptProposal={handleTranslationAcceptProposal}
          onRejectProposal={handleTranslationRejectProposal}
          onRetryMemorySave={
            translationReview.memoryRetry
              ? handleTranslationRetryMemory.bind(
                  null,
                  translationReview,
                  translationReview.memoryRetry
                )
              : undefined
          }
          onContinueWithoutMemorySave={
            translationReview.memoryRetry
              ? handleTranslationContinueWithoutMemory.bind(
                  null,
                  translationReview,
                  translationReview.memoryRetry
                )
              : undefined
          }
          onPostpone={() =>
            setTranslationReview((current) =>
              current !== translationReview || current.memoryRetry ? current : null
            )
          }
          onCancelTranslation={handleTranslationCancel.bind(null, translationReview)}
        />
      )}

      {dirtyTabClosePrompt && (
        <ConfirmDialog
          title={t('confirm.discardUnsaved.title')}
          message={t('confirm.discardUnsaved', { title: dirtyTabClosePrompt.title })}
          confirmLabel={t('confirm.discardUnsaved.confirm')}
          danger
          role="alertdialog"
          onConfirm={confirmDirtyTabClose}
          onCancel={() => setDirtyTabClosePrompt(null)}
        />
      )}

      {moveTarget && (
        <MoveDialog
          node={moveTarget.node}
          folders={folders}
          onMove={(dest) => {
            const state = moveTarget
            setMoveTarget(null)
            if (isWorkspaceOperationCurrent(state.binding)) {
              void performMove(state.node, dest)
            }
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
                {t('library.import.summary', { count: libraryImport.result.entries.length })}
              </div>
              {libraryImport.result.manifest && (
                <div style={{ marginTop: 8, color: 'var(--orbitpm-muted)' }}>
                  {t('library.manifestInfo', {
                    files: libraryImport.result.manifest.files.length,
                    links: libraryImport.result.manifest.hierarchy.length
                  })}
                </div>
              )}
              {libraryImport.result.ownersCsv !== undefined && (
                <div style={{ marginTop: 4, color: 'var(--orbitpm-muted)' }}>
                  {t('library.ownersCsvInfo')}
                </div>
              )}
              {libraryImport.result.skipped.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ color: 'var(--orbitpm-muted)', marginBottom: 4 }}>
                    {t('library.import.skippedNote', {
                      skipped: libraryImport.result.skipped.length
                    })}
                  </div>
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {libraryImport.result.skipped.slice(0, 5).map((s) => (
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

      {workspaceImportReview && (
        <WorkspaceImportReviewDialog
          plan={workspaceImportReview.plan}
          decisions={workspaceImportReview.decisions}
          busy={workspaceImportReview.busy}
          error={workspaceImportReview.error ?? undefined}
          onDecision={updateWorkspaceImportDecision}
          onConfirm={() => void handleConfirmWorkspaceImport()}
          onCancel={cancelWorkspaceImportReview}
          onDownloadArisReport={downloadWorkspaceImportArisReport}
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

      {backupImportState && (
        <BackupImportDialog
          plan={backupImportState.plan}
          busy={backupBusy}
          onApply={(decisions) => void handleApplyBackupImport(decisions)}
          onCancel={() => {
            backupImportState.controller.abort()
            if (backupImportAbortRef.current === backupImportState.controller) {
              backupImportAbortRef.current = null
            }
            setBackupImportState(null)
          }}
        />
      )}

      {historyOpen && historyManagerRef.current && (
        <HistoryDialog
          manager={historyManagerRef.current}
          currentXml={(path) => liveFiles.find((file) => file.relPath === path)?.xml}
          onRestore={(revision) => handleHistoryRestore(revision, renderedWorkspaceBinding)}
          onRestoreCopy={(revision, destination, signal) =>
            handleHistoryRestoreCopy(revision, destination, signal, renderedWorkspaceBinding)
          }
          onChanged={() =>
            isWorkspaceOperationCurrent(renderedWorkspaceBinding)
              ? refreshWorkspace(rootHandleRef.current ?? undefined)
              : Promise.resolve()
          }
          onClose={() => {
            historyRestoreAbortRef.current?.abort()
            historyRestoreAbortRef.current = null
            setHistoryOpen(false)
          }}
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
              operation:
                pathDirtyPrompt.kind === 'import'
                  ? t('workspaceImportReview.title')
                  : t(`workspace.path.operation.${pathDirtyPrompt.kind}` as Key),
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
        onChangeWorkspace={
          isMultiFileMode(mode) && support ? () => void handleOpenDifferent() : undefined
        }
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
    </ResponsiveShell>
  )
}

export default App
