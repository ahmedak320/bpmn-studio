// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorTabCommands, EditorXmlTransaction } from './editor/EditorTabLite'

interface TestDraftRecord {
  id: string
  workspaceId: string
  path: string | null
  sessionId: string
  xml: string
  baseHash: string | null
  timestamp: number
  appVersion: string
}

interface TestWorkspaceChange {
  kind: 'saved' | 'moved' | 'deleted' | 'invalidated'
  path: string
  previousPath?: string
}

interface TestWorkspaceCoordinator {
  emit(change: TestWorkspaceChange): void
}

interface TestAiPanelProps {
  onPlaceGenerated(
    xml: string,
    options: {
      name: string
      targetFolder: string
      gen?: number
      localizationSource?: string
      signal: AbortSignal
    }
  ): Promise<import('./ai/placementOutcome').GeneratedPlacementOutcome>
  getWorkspaceGen?(): number
  onOpenSettings(): void
  onContinueInChat?(info: { description: string }): void
  spreadsheet: {
    onOpenSingle(xml: string, name: string): void
    onReviewBilingual(request: {
      processId: string
      suggestedName: string
      xml: string
      ordinal: number
      total: number
      signal: AbortSignal
    }): Promise<{ status: 'completed'; reviewedXml: string } | { status: 'cancelled' }>
  }
}

const sessionHarness = vi.hoisted(() => ({
  indexedDbAvailable: true,
  drafts: new Map<string, TestDraftRecord>(),
  controllers: [] as unknown[],
  coordinators: [] as TestWorkspaceCoordinator[],
  publishedChanges: [] as unknown[]
}))

const state = vi.hoisted(() => ({
  directorySupport: false,
  opfsSupport: false,
  emitInitialManifestWarning: false,
  failNextManifestBind: false,
  lang: 'en' as 'en' | 'ar',
  promptResult: 'Claims approval',
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  id="Definitions_Test" targetNamespace="https://orbitpm.local/test">
  <bpmn:process id="Process_Test" name="Test process" isExecutable="false"
    orbitpm:nameEn="Test process" orbitpm:nameAr="عملية اختبار" orbitpm:activeLang="en">
    <bpmn:startEvent id="StartEvent_1" name="Start"
      orbitpm:nameEn="Start" orbitpm:nameAr="بدء" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Test">
    <bpmndi:BPMNPlane id="Plane_Test" bpmnElement="Process_Test">
      <bpmndi:BPMNShape id="Shape_Start" bpmnElement="StartEvent_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
}))

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  triggerDownload: vi.fn(),
  setLang: vi.fn(),
  localizedRuntimeTranslation: vi.fn(),
  installLinkBadges: vi.fn(),
  autoSizeAll: vi.fn(),
  editorProps: vi.fn(),
  aiProps: vi.fn(),
  settingsProps: vi.fn(),
  translationReviewProps: vi.fn(),
  workspaceLocalizationFactories: vi.fn(),
  assistantProps: vi.fn(),
  printJobs: vi.fn(),
  modelerGet: vi.fn(),
  modelerDefinitions: vi.fn(),
  makeFreeTranslateTexts: vi.fn(),
  buildTranslationExternalReview: vi.fn(),
  saveSvg: vi.fn(),
  saveXml: vi.fn(),
  importXml: vi.fn(),
  commandSave: vi.fn(),
  commandUndo: vi.fn(),
  commandRedo: vi.fn(),
  validateBpmn: vi.fn(),
  evaluatePolicy: vi.fn(),
  validatePreservation: vi.fn(),
  diagramPreviewProps: vi.fn(),
  migrateLegacyCredentialsOnStartup: vi.fn(),
  pickWorkspace: vi.fn(),
  rememberWorkspace: vi.fn(),
  loadRememberedWorkspace: vi.fn(),
  ensurePermission: vi.fn(),
  classifyPickerError: vi.fn(),
  folderTreeProps: vi.fn(),
  catalogProps: vi.fn(),
  moveDialogProps: vi.fn(),
  historyProps: vi.fn(),
  workspaceImportReviewProps: vi.fn(),
  restoreHistoryRevision: vi.fn(),
  beforeDraftPut: vi.fn(),
  beforeDraftDelete: vi.fn(),
  manifestBindings: [] as unknown[],
  readLibraryZipFileInWorker: vi.fn(),
  legacyCreateFolderAt: vi.fn(),
  legacyCreateBpmnFileUnique: vi.fn()
}))

vi.mock('./i18n', () => ({
  t: (key: string, values?: Record<string, unknown>): string => {
    if (
      key.startsWith('workspace.import.postCommit') ||
      key.startsWith('workspace.backup.historyRetention') ||
      key.startsWith('workspace.backup.postCommit') ||
      key === 'workspace.sync.committedReloadEditorChanged' ||
      key.startsWith('workspace.storage.opfsOpen') ||
      key.startsWith('session.save.preservation') ||
      key === 'session.save.permissionLoss' ||
      key === 'session.save.storageFailure' ||
      key === 'session.save.storageTechnicalEvidence' ||
      key === 'session.save.retainedEditorCaptureFailed' ||
      key === 'workspace.history.restoreCancelled' ||
      key.startsWith('workspace.history.apply')
    ) {
      return mocks.localizedRuntimeTranslation(key, values) as string
    }
    if (key === 'translationReview.retry.attempt') {
      return `${key}:${values?.service}:${values?.item}/${values?.items}:${values?.attempt}/${values?.max}`
    }
    if (key === 'translationReview.retry.waiting') {
      return `${key}:${values?.service}:${values?.item}/${values?.items}:${values?.attempt}/${values?.max}:${values?.seconds}`
    }
    if (key === 'translationReview.retry.service.google') return 'Google Translate'
    if (key === 'translationReview.retry.service.mymemory') return 'MyMemory'
    return key
  },
  tPlural: (key: string, count: number): string => `${key}:${count}`
}))

vi.mock('./i18n/useLang', () => ({
  useLang: (): 'en' | 'ar' => state.lang,
  setLang: (lang: 'en' | 'ar') => {
    state.lang = lang
    mocks.setLang(lang)
  }
}))

vi.mock('./ai/keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ai/keys')>()
  return {
    ...actual,
    migrateLegacyCredentialsOnStartup: mocks.migrateLegacyCredentialsOnStartup
  }
})

vi.mock('@/common/prompt', () => ({
  usePromptText: () => mocks.prompt
}))

vi.mock('./fs/workspaceHandle', () => ({
  directoryPickerSupported: () => state.directorySupport,
  pickWorkspace: mocks.pickWorkspace,
  rememberWorkspace: mocks.rememberWorkspace,
  loadRememberedWorkspace: mocks.loadRememberedWorkspace,
  ensurePermission: mocks.ensurePermission,
  classifyPickerError: mocks.classifyPickerError
}))

vi.mock('./fs/fsAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fs/fsAccess')>()
  return {
    ...actual,
    createFolderAt: (...args: Parameters<typeof actual.createFolderAt>) => {
      mocks.legacyCreateFolderAt(...args)
      return actual.createFolderAt(...args)
    },
    createBpmnFileUnique: (...args: Parameters<typeof actual.createBpmnFileUnique>) => {
      mocks.legacyCreateBpmnFileUnique(...args)
      return actual.createBpmnFileUnique(...args)
    }
  }
})

vi.mock('./editor/exportImage', () => ({
  triggerDownload: mocks.triggerDownload
}))

vi.mock('./library/browserZipImport', () => ({
  readLibraryZipFileInWorker: mocks.readLibraryZipFileInWorker
}))

vi.mock('./ai/freeTranslate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ai/freeTranslate')>()
  return {
    ...actual,
    makeFreeTranslateTexts: mocks.makeFreeTranslateTexts
  }
})

vi.mock('./ai/translate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ai/translate')>()
  return {
    ...actual,
    buildTranslationExternalReview: (
      ...args: Parameters<typeof actual.buildTranslationExternalReview>
    ) => {
      mocks.buildTranslationExternalReview(...args)
      return actual.buildTranslationExternalReview(...args)
    }
  }
})

vi.mock('./localization/workspaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localization/workspaceStore')>()
  return {
    ...actual,
    createWorkspaceLocalizationStore: (
      ...args: Parameters<typeof actual.createWorkspaceLocalizationStore>
    ) => {
      const store = actual.createWorkspaceLocalizationStore(...args)
      mocks.workspaceLocalizationFactories(args[0], store)
      return store
    }
  }
})

vi.mock('./localization/TranslationReviewDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localization/TranslationReviewDialog')>()
  return {
    ...actual,
    TranslationReviewDialog: (
      props: React.ComponentProps<typeof actual.TranslationReviewDialog>
    ) => {
      mocks.translationReviewProps(props)
      return <actual.TranslationReviewDialog {...props} />
    }
  }
})

vi.mock('./workspace/workspaceManifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace/workspaceManifest')>()
  return {
    ...actual,
    bindWorkspaceToManifest: async (
      ...args: Parameters<typeof actual.bindWorkspaceToManifest>
    ): ReturnType<typeof actual.bindWorkspaceToManifest> => {
      const options = args[1] ?? {}
      mocks.manifestBindings.push(options)
      if (state.emitInitialManifestWarning) {
        state.emitInitialManifestWarning = false
        options.onManifestWarning?.({
          code: 'unreadable-file',
          path: 'unreadable.bpmn',
          message: 'initial warning'
        })
      }
      if (state.failNextManifestBind) {
        state.failNextManifestBind = false
        throw new Error('manifest bind failed')
      }
      return actual.bindWorkspaceToManifest(...args)
    }
  }
})

vi.mock('./workspace/HistoryDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace/HistoryDialog')>()
  return {
    ...actual,
    HistoryDialog: (props: React.ComponentProps<typeof actual.HistoryDialog>) => {
      mocks.historyProps(props)
      return <div data-testid="history-dialog" />
    }
  }
})

vi.mock('./workspace/WorkspaceImportReviewDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace/WorkspaceImportReviewDialog')>()
  return {
    ...actual,
    WorkspaceImportReviewDialog: (
      props: React.ComponentProps<typeof actual.WorkspaceImportReviewDialog>
    ) => {
      mocks.workspaceImportReviewProps(props)
      return (
        <div role="dialog" aria-label="mock-workspace-import-review">
          <output data-testid="workspace-import-digest">{props.plan.reviewDigest}</output>
          <button type="button" onClick={props.onConfirm}>
            mock-workspace-import-confirm
          </button>
          <button type="button" onClick={props.onCancel}>
            mock-workspace-import-cancel
          </button>
        </div>
      )
    }
  }
})

vi.mock('./links/linkBadges', () => ({
  installLinkBadges: mocks.installLinkBadges
}))

vi.mock('./editor/autoSize', () => ({
  autoSizeAll: mocks.autoSizeAll
}))

vi.mock('./validation', () => ({
  getRuntimeValidationAdapters: () => ({}),
  validateBpmnXml: mocks.validateBpmn,
  evaluateValidationPolicy: mocks.evaluatePolicy,
  validateUnknownExtensionPreservation: mocks.validatePreservation,
  canCreateGenerated: (summary: { valid: boolean }): boolean => summary.valid,
  ReadOnlyDiagramPreview: (props: {
    xml: string
    title: string
    ariaLabel?: string
    onStatusChange?(
      status: import('./validation/ReadOnlyDiagramPreview').ReadOnlyDiagramPreviewStatus
    ): void
  }) => {
    mocks.diagramPreviewProps(props)
    return (
      <section data-testid="mock-read-only-diagram-preview">
        <h3>{props.title}</h3>
        <div role="img" aria-label={props.ariaLabel} />
        <button
          type="button"
          onClick={() => props.onStatusChange?.({ status: 'ready', warningCount: 0 })}
        >
          mock-layout-preview-ready
        </button>
        <button
          type="button"
          onClick={() =>
            props.onStatusChange?.({ status: 'error', message: 'mock viewer import failed' })
          }
        >
          mock-layout-preview-error
        </button>
      </section>
    )
  }
}))

vi.mock('./sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sessions')>()

  class TestIndexedDbDraftJournal {
    constructor() {
      if (!sessionHarness.indexedDbAvailable) throw new Error('IndexedDB unavailable')
    }

    async put(record: TestDraftRecord): Promise<void> {
      await mocks.beforeDraftPut(record)
      sessionHarness.drafts.set(record.id, { ...record })
    }

    async get(key: { workspaceId: string; path: string | null; sessionId: string }) {
      const record = sessionHarness.drafts.get(actual.draftId(key))
      return record ? { ...record } : null
    }

    async listWorkspace(workspaceId: string) {
      return [...sessionHarness.drafts.values()]
        .filter((record) => record.workspaceId === workspaceId)
        .map((record) => ({ ...record }))
    }

    async delete(key: { workspaceId: string; path: string | null; sessionId: string }) {
      await mocks.beforeDraftDelete(key)
      sessionHarness.drafts.delete(actual.draftId(key))
    }

    async move(
      from: { workspaceId: string; path: string | null; sessionId: string },
      to: { workspaceId: string; path: string | null; sessionId: string }
    ) {
      const fromId = actual.draftId(from)
      const toId = actual.draftId(to)
      if (fromId === toId) return
      const record = sessionHarness.drafts.get(fromId)
      if (!record) return
      if (sessionHarness.drafts.has(toId)) {
        throw new Error('A recovery draft already exists at the destination path')
      }
      sessionHarness.drafts.delete(fromId)
      sessionHarness.drafts.set(toId, { ...record, ...to, id: toId })
    }

    async clearWorkspace(workspaceId: string) {
      for (const [id, record] of sessionHarness.drafts) {
        if (record.workspaceId === workspaceId) sessionHarness.drafts.delete(id)
      }
    }
  }

  class TestDocumentSessionController extends actual.DocumentSessionController {
    constructor(options: ConstructorParameters<typeof actual.DocumentSessionController>[0]) {
      super(options)
      sessionHarness.controllers.push(this)
    }
  }

  class TestBroadcastWorkspaceCoordinator {
    readonly #listeners = new Set<(change: TestWorkspaceChange) => void>()

    constructor() {
      sessionHarness.coordinators.push(this)
    }

    async acquire() {
      return {
        acquired: true as const,
        lease: { release: () => undefined }
      }
    }

    publishDocumentChange(change: unknown): void {
      sessionHarness.publishedChanges.push(change)
    }

    subscribeChanges(listener: (change: TestWorkspaceChange) => void): () => void {
      this.#listeners.add(listener)
      return () => this.#listeners.delete(listener)
    }

    emit(change: TestWorkspaceChange): void {
      for (const listener of this.#listeners) listener(change)
    }

    close(): void {
      this.#listeners.clear()
    }
  }

  return {
    ...actual,
    BroadcastWorkspaceCoordinator: TestBroadcastWorkspaceCoordinator,
    DocumentSessionController: TestDocumentSessionController,
    IndexedDbDraftJournal: TestIndexedDbDraftJournal,
    restoreHistoryRevision: mocks.restoreHistoryRevision
  }
})

vi.mock('./editor/EditorTabLite', () => ({
  EditorTab: (props: {
    xml: string
    onDirtyChange(dirty: boolean): void
    onRequestSave(
      xml: string,
      options?: { explicitDraftWithErrors?: boolean }
    ): Promise<void | { durable: boolean }> | void
    onOpenCalledProcess(processId: string): void
    onOpenStepDetails(id: string, missing: string[]): void
    onCommandsReady(commands: unknown): void
    onModelerReady(modeler: unknown): void
    toolbarExtra?: React.ReactNode
    sidePaneExtra?: React.ReactNode
  }) => {
    mocks.editorProps(props)
    return (
      <div data-testid="editor-tab">
        <output data-testid="editor-xml">{props.xml}</output>
        <button type="button" onClick={() => props.onDirtyChange(true)}>
          mock-editor-dirty
        </button>
        <button type="button" onClick={() => props.onDirtyChange(false)}>
          mock-editor-clean
        </button>
        <button type="button" onClick={() => void props.onRequestSave(state.xml)}>
          mock-editor-save
        </button>
        <button
          type="button"
          onClick={() =>
            props.onCommandsReady({
              save: mocks.commandSave,
              undo: mocks.commandUndo,
              redo: mocks.commandRedo
            })
          }
        >
          mock-editor-commands
        </button>
        <button type="button" onClick={() => props.onModelerReady(mockModeler)}>
          mock-editor-ready
        </button>
        <button type="button" onClick={() => props.onModelerReady(null)}>
          mock-editor-unready
        </button>
        <button type="button" onClick={() => props.onOpenCalledProcess('Missing_Process')}>
          mock-editor-open-called
        </button>
        <button type="button" onClick={() => props.onOpenStepDetails('Task_1', ['owner'])}>
          mock-editor-details
        </button>
        {props.toolbarExtra}
        {props.sidePaneExtra}
      </div>
    )
  }
}))

const mockModeler = {
  get: (name: string): unknown => mocks.modelerGet(name),
  getDefinitions: (): unknown => mocks.modelerDefinitions(),
  saveSVG: (): Promise<{ svg: string }> => mocks.saveSvg(),
  saveXML: (): Promise<{ xml: string }> => mocks.saveXml(),
  importXML: (xml: string): Promise<{ warnings: string[] }> => mocks.importXml(xml)
}

vi.mock('./ai/AiPanelLite', () => ({
  AiPanelLite: (props: TestAiPanelProps) => {
    mocks.aiProps(props)
    return (
      <div data-testid="ai-panel">
        <input aria-label="mock-ai-draft" defaultValue="" />
        <button type="button" onClick={props.onOpenSettings}>
          mock-ai-settings
        </button>
        <button
          type="button"
          onClick={() =>
            void props.onPlaceGenerated(state.xml, {
              name: 'AI claims',
              targetFolder: '',
              gen: props.getWorkspaceGen?.(),
              localizationSource: 'ai',
              signal: new AbortController().signal
            })
          }
        >
          mock-ai-place
        </button>
        <button
          type="button"
          onClick={() => props.spreadsheet.onOpenSingle(state.xml, 'sheet-flow.bpmn')}
        >
          mock-sheet-open
        </button>
        <button
          type="button"
          onClick={() =>
            void props.spreadsheet.onReviewBilingual({
              processId: 'Process_Test',
              suggestedName: 'bilingual-flow.bpmn',
              xml: state.xml,
              ordinal: 1,
              total: 1,
              signal: new AbortController().signal
            })
          }
        >
          mock-sheet-review
        </button>
        <button
          type="button"
          onClick={() => props.onContinueInChat?.({ description: 'Fill the missing owner' })}
        >
          mock-ai-chat
        </button>
      </div>
    )
  }
}))

vi.mock('./settings/SettingsDialogLite', () => ({
  SettingsDialogLite: (props: {
    open: boolean
    onClose(): void
    onKeysChanged(): void
    onOrgStylingChanged(): void
    localizationResources?: import('./settings/LocalizationResourcesEditor').LocalizationResourcesEditorProps
  }) => {
    mocks.settingsProps(props)
    return props.open ? (
      <div role="dialog" aria-label="mock-settings">
        {props.localizationResources?.loadError && (
          <>
            <p role="alert">{props.localizationResources.loadError}</p>
            <button type="button" onClick={() => void props.localizationResources?.onReload()}>
              settings.localization.reload
            </button>
          </>
        )}
        <button type="button" onClick={props.onKeysChanged}>
          mock-settings-keys
        </button>
        <button type="button" onClick={props.onOrgStylingChanged}>
          mock-settings-org
        </button>
        <button type="button" onClick={props.onClose}>
          mock-settings-close
        </button>
      </div>
    ) : null
  }
}))

vi.mock('./assist/AssistantDrawer', () => ({
  AssistantDrawer: (props: {
    open: boolean
    onOpen(): void
    onClose(): void
    onChangeWorkspace?(): void
    onApplyXml?(
      tabKey: string,
      xml: string,
      request: import('./assist/AssistantDrawer').InterviewApplyRequest
    ): Promise<void> | void
  }) => {
    mocks.assistantProps(props)
    return (
      <div data-testid="assistant-drawer">
        <button type="button" onClick={props.open ? props.onClose : props.onOpen}>
          {props.open ? 'mock-assistant-close' : 'mock-assistant-open'}
        </button>
        {props.open && props.onChangeWorkspace && (
          <button type="button" onClick={props.onChangeWorkspace}>
            mock-assistant-change-workspace
          </button>
        )}
      </div>
    )
  }
}))

vi.mock('./workspace/PrintButton', () => ({
  PrintButton: (props: { onPrint(): void }) => (
    <button type="button" onClick={props.onPrint}>
      mock-print
    </button>
  )
}))

vi.mock('./workspace/PrintView', () => ({
  PrintView: (props: { job: unknown }) => {
    mocks.printJobs(props.job)
    return props.job ? <div data-testid="print-view">mock-print-view</div> : null
  }
}))

vi.mock('./org/DetailsCard', () => ({
  DetailsCard: (props: { onOpenDetails(): void }) => (
    <button type="button" onClick={props.onOpenDetails}>
      mock-details-card
    </button>
  )
}))

vi.mock('./org/StepDetailsDialog', () => ({
  StepDetailsDialog: (props: { onCancel(): void }) => (
    <div role="dialog" aria-label="mock-step-details">
      <button type="button" onClick={props.onCancel}>
        mock-details-cancel
      </button>
    </div>
  )
}))

vi.mock('./org/stepDetailsCtx', () => ({
  deriveStepDetailsCtx: () => ({
    mode: 'process',
    elementType: 'bpmn:Process',
    initial: {}
  })
}))

vi.mock('./links/SelectionLinkButtonLite', () => ({
  SelectionLinkButton: () => <button type="button">mock-selection-link</button>
}))

vi.mock('./workspace/FolderTreeLite', () => ({
  FolderTreeLite: (props: {
    onOpenFile(path: string): void
    onOpenFileFocus?(path: string): void
    onNewProcess(path: string): void
    onNewFolder(path: string): void
    onRename(node: { name: string; relPath: string; type: 'file' | 'directory' }): void
    onDelete(node: { name: string; relPath: string; type: 'file' | 'directory' }): void
    onMove(node: { name: string; relPath: string; type: 'file' | 'directory' }): void
    onMoveDrop(from: string, type: 'file' | 'directory', destination: string): void
  }) => {
    mocks.folderTreeProps(props)
    const file = {
      name: 'existing.bpmn',
      relPath: 'Finance/existing.bpmn',
      type: 'file' as const
    }
    const deleteFile = {
      name: 'delete-me.bpmn',
      relPath: 'Finance/delete-me.bpmn',
      type: 'file' as const
    }
    const moveFile = {
      name: 'move-me.bpmn',
      relPath: 'Finance/move-me.bpmn',
      type: 'file' as const
    }
    const dropFile = {
      name: 'drop-me.bpmn',
      relPath: 'Finance/drop-me.bpmn',
      type: 'file' as const
    }
    return (
      <div data-testid="folder-tree">
        <button type="button" onClick={() => props.onOpenFile(file.relPath)}>
          mock-tree-open
        </button>
        <button type="button" onClick={() => props.onOpenFileFocus?.(file.relPath)}>
          mock-tree-focus
        </button>
        <button type="button" onClick={() => props.onNewProcess('Finance')}>
          mock-tree-new-process
        </button>
        <button type="button" onClick={() => props.onNewFolder('')}>
          mock-tree-new-folder
        </button>
        <button type="button" onClick={() => props.onRename(file)}>
          mock-tree-rename
        </button>
        <button type="button" onClick={() => props.onDelete(deleteFile)}>
          mock-tree-delete
        </button>
        <button type="button" onClick={() => props.onMove(moveFile)}>
          mock-tree-move
        </button>
        <button type="button" onClick={() => props.onMoveDrop(dropFile.relPath, 'file', '')}>
          mock-tree-move-drop
        </button>
      </div>
    )
  }
}))

vi.mock('./workspace/CatalogView', () => ({
  CatalogView: (props: {
    onOpen(path: string, processId?: string): void
    onNewProcess(): void
    onOpenUnresolved(): void
    onSort(key: string): void
  }) => {
    mocks.catalogProps(props)
    return (
      <div data-testid="catalog-view">
        <button type="button" onClick={() => props.onOpen('Finance/existing.bpmn')}>
          mock-catalog-open
        </button>
        <button type="button" onClick={props.onNewProcess}>
          mock-catalog-new
        </button>
        <button type="button" onClick={props.onOpenUnresolved}>
          mock-catalog-unresolved
        </button>
        <button type="button" onClick={() => props.onSort('name')}>
          mock-catalog-sort
        </button>
      </div>
    )
  }
}))

vi.mock('./workspace/MoveDialog', () => ({
  MoveDialog: (props: { onMove(path: string): void; onCancel(): void }) => {
    mocks.moveDialogProps(props)
    return (
      <div role="dialog" aria-label="mock-move">
        <button type="button" onClick={() => props.onMove('')}>
          mock-move-confirm
        </button>
        <button type="button" onClick={props.onCancel}>
          mock-move-cancel
        </button>
      </div>
    )
  }
}))

import { MemoryWorkspaceAdapter, WorkspaceOperationError, sha256Hex } from './workspace/adapters'
import { MAX_DROPPED_IMPORT_BYTES } from './workspace/importDrop'
import {
  FakeDirectoryHandle,
  asDirectoryHandle,
  fakeRoot
} from './workspace/adapters/__tests__/fakeFileSystem'
import { ManifestBoundWorkspaceAdapter } from './workspace/workspaceManifest'
import type { HistoryRevision } from './workspace/history'
import BpmnModdle from 'bpmn-moddle'
import { orbitpmModdleDescriptor } from './org/orbitpmModdle'
import {
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_TRANSLATION_MEMORY_PATH,
  WorkspaceLocalizationConflictError,
  WorkspaceLocalizationValidationError,
  createWorkspaceGlossaryDocument,
  createWorkspaceTranslationMemoryDocument,
  serializeWorkspaceGlossaryDocument,
  serializeWorkspaceTranslationMemoryDocument
} from './localization/workspaceStore'
import type { LocalizationResourcesEditorProps } from './settings/LocalizationResourcesEditor'
import { resetProviderSelectionForTests, setProviderSelection } from './ai/providerSelection'
import { clearKey, setKey } from './ai/keys'
import { FreeTranslateError } from './ai/freeTranslate'
import { ar, en } from './i18n/dictionaries'
import {
  buildTranslationRecoveryDisclosure,
  deriveTranslationReviewProgress,
  listTranslationRecoveryFields,
  type TranslationRecoveryField
} from './localization/translationRecovery'
import { grantExternalRequestConsent } from './localization/externalRequestReview'
import type { TranslationReviewDialogProps } from './localization/TranslationReviewDialog'
import App from './App'

function latestSessionController(): import('./sessions').DocumentSessionController {
  const controller = sessionHarness.controllers.at(-1)
  if (!controller) throw new Error('App did not create a document-session controller')
  return controller as import('./sessions').DocumentSessionController
}

function latestAiPanelProps(): TestAiPanelProps {
  const props = mocks.aiProps.mock.calls.at(-1)?.[0] as TestAiPanelProps | undefined
  if (!props) throw new Error('App did not render the AI panel')
  return props
}

function latestAssistantDrawerProps(): import('./assist/AssistantDrawer').AssistantDrawerProps {
  const props = mocks.assistantProps.mock.calls.at(-1)?.[0] as
    import('./assist/AssistantDrawer').AssistantDrawerProps | undefined
  if (!props) throw new Error('App did not render the assistant drawer')
  return props
}

function latestHistoryDialogProps(): import('./workspace/HistoryDialog').HistoryDialogProps {
  const props = mocks.historyProps.mock.calls.at(-1)?.[0] as
    import('./workspace/HistoryDialog').HistoryDialogProps | undefined
  if (!props) throw new Error('App did not render the history dialog')
  return props
}

function latestWorkspaceImportReviewProps(): import('./workspace/WorkspaceImportReviewDialog').WorkspaceImportReviewDialogProps {
  const props = mocks.workspaceImportReviewProps.mock.calls.at(-1)?.[0] as
    import('./workspace/WorkspaceImportReviewDialog').WorkspaceImportReviewDialogProps | undefined
  if (!props) throw new Error('App did not render the workspace import review')
  return props
}

function manifestBindingAt(
  index: number
): import('./workspace/workspaceManifest').BindWorkspaceToManifestOptions {
  const binding = mocks.manifestBindings[index] as
    import('./workspace/workspaceManifest').BindWorkspaceToManifestOptions | undefined
  if (!binding) throw new Error(`App did not create manifest binding ${index}`)
  return binding
}

function testHistoryRevision(originalPath: string): HistoryRevision {
  return {
    format: 'orbitpm-history-revision',
    version: 1,
    id: 'revision-1',
    originalPath,
    contentPath: '.orbitpm/history/revision-1/content.bpmn',
    metadataPath: '.orbitpm/history/revision-1/metadata.json',
    hash: '1'.repeat(64),
    size: 1,
    storageBytes: 2,
    createdAt: Date.UTC(2026, 0, 1),
    reason: 'restore',
    applicationVersion: '0.4.5'
  }
}

function successfulWorkspaceSave(
  path: string,
  xml: string
): import('./workspace/adapters').SuccessfulSaveOutcome {
  const bytes = new TextEncoder().encode(xml)
  return {
    ok: true,
    status: 'success',
    snapshot: {
      path,
      bytes,
      hash: 'a'.repeat(64),
      size: bytes.byteLength,
      modifiedAt: Date.UTC(2026, 0, 2),
      mimeType: 'application/xml'
    },
    created: false,
    disposition: 'workspace'
  }
}

function utf8Buffer(value: string): ArrayBuffer {
  return Uint8Array.from(new TextEncoder().encode(value)).buffer
}

function deferred<T = void>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function installControllableMatchMedia(initialWidth: number): {
  setWidth(width: number): void
} {
  let width = initialWidth
  const queries = new Map<
    string,
    {
      readonly media: string
      readonly matches: boolean
      onchange: ((event: MediaQueryListEvent) => void) | null
      addEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void
      removeEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void
      addListener(listener: (event: MediaQueryListEvent) => void): void
      removeListener(listener: (event: MediaQueryListEvent) => void): void
      dispatchEvent(event: Event): boolean
    }
  >()
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>()
  const matches = (query: string, candidateWidth = width): boolean => {
    const min = /min-width:\s*(\d+)px/u.exec(query)?.[1]
    const max = /max-width:\s*(\d+)px/u.exec(query)?.[1]
    return (
      (min === undefined || candidateWidth >= Number(min)) &&
      (max === undefined || candidateWidth <= Number(max))
    )
  }
  const matchMedia = vi.fn((query: string): MediaQueryList => {
    let media = queries.get(query)
    if (!media) {
      const queryListeners = new Set<(event: MediaQueryListEvent) => void>()
      listeners.set(query, queryListeners)
      media = {
        media: query,
        get matches() {
          return matches(query)
        },
        onchange: null,
        addEventListener: (_type, listener) => queryListeners.add(listener),
        removeEventListener: (_type, listener) => queryListeners.delete(listener),
        addListener: (listener) => queryListeners.add(listener),
        removeListener: (listener) => queryListeners.delete(listener),
        dispatchEvent: (event) => {
          for (const listener of queryListeners) listener(event as MediaQueryListEvent)
          return true
        }
      }
      queries.set(query, media)
    }
    return media as MediaQueryList
  })
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    setWidth(nextWidth: number): void {
      const previousWidth = width
      width = nextWidth
      for (const [query, media] of queries) {
        if (matches(query, previousWidth) === matches(query, nextWidth)) continue
        const event = {
          matches: media.matches,
          media: query
        } as MediaQueryListEvent
        media.onchange?.(event)
        for (const listener of listeners.get(query) ?? []) listener(event)
      }
    }
  }
}

function withProcessId(xml: string, processId: string): string {
  return xml.replaceAll('Process_Test', processId)
}

function withoutArabicMetadata(xml: string): string {
  return xml.replaceAll(/\s+orbitpm:nameAr="[^"]*"/gu, '')
}

function withoutDiagramInterchange(xml: string): string {
  return xml.replace(/<bpmndi:BPMNDiagram\b[\s\S]*?<\/bpmndi:BPMNDiagram>\s*/u, '')
}

function validationResultForXml(xml: string) {
  const processId = /<bpmn:process\b[^>]*\bid="([^"]+)"/u.exec(xml)?.[1] ?? 'Process_Test'
  return {
    summary: { valid: true, xmlWellFormed: true, issues: [] },
    definitions: {
      rootElements: [{ $type: 'bpmn:Process', id: processId }]
    }
  }
}

async function parsedValidationResultForXml(xml: string) {
  const moddle = new BpmnModdle({
    orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
  })
  const parsed = await moddle.fromXML(xml)
  return {
    summary: { valid: true, xmlWellFormed: true, issues: [] },
    definitions: parsed.rootElement
  }
}

function configureMissingDiValidation(sourceXml: string): void {
  mocks.validateBpmn.mockImplementation(async (xml: string, options?: { requireDi?: boolean }) => {
    const parsed = await parsedValidationResultForXml(xml)
    if (xml === sourceXml && options?.requireDi === false) {
      return {
        ...parsed,
        summary: {
          valid: true,
          xmlWellFormed: true,
          issues: [
            {
              source: 'orbitpm',
              code: 'di.process-missing',
              severity: 'warning',
              blocking: false,
              message: 'BPMN DI is missing.'
            }
          ]
        }
      }
    }
    return parsed
  })
}

function missingArabicValidationResult(processId: string) {
  const process: Record<string, unknown> = {
    $type: 'bpmn:Process',
    id: processId,
    name: 'Legacy process',
    $attrs: {
      'orbitpm:nameEn': 'Legacy process',
      'orbitpm:activeLang': 'en'
    }
  }
  const start: Record<string, unknown> = {
    $type: 'bpmn:StartEvent',
    id: `${processId}_Start`,
    name: 'Start',
    $attrs: { 'orbitpm:nameEn': 'Start' },
    $parent: process
  }
  process.flowElements = [start]
  return {
    summary: { valid: true, xmlWellFormed: true, issues: [] },
    definitions: {
      $type: 'bpmn:Definitions',
      rootElements: [process]
    }
  }
}

function seedUntitledDraft(xml: string): TestDraftRecord {
  return seedDraft('single-file:untitled.bpmn', 'untitled.bpmn', xml)
}

function seedDraft(workspaceId: string, path: string, xml: string): TestDraftRecord {
  const id = JSON.stringify([workspaceId, path, null])
  const record: TestDraftRecord = {
    id,
    workspaceId,
    path,
    sessionId: path,
    xml,
    baseHash: null,
    timestamp: Date.UTC(2026, 0, 2, 12, 30),
    appVersion: '0.4.5'
  }
  sessionHarness.drafts.set(id, record)
  return record
}

beforeEach(() => {
  resetProviderSelectionForTests()
  localStorage.removeItem('orbitpm.lite.cfg.ai-provider-selection.v1')
  vi.stubGlobal('__APP_VERSION__', '0.4.5')
  vi.stubGlobal('BroadcastChannel', class TestBroadcastChannel {})
  sessionHarness.indexedDbAvailable = true
  sessionHarness.drafts.clear()
  sessionHarness.controllers.length = 0
  sessionHarness.coordinators.length = 0
  sessionHarness.publishedChanges.length = 0
  state.directorySupport = false
  state.opfsSupport = false
  state.emitInitialManifestWarning = false
  state.failNextManifestBind = false
  state.lang = 'en'
  state.promptResult = 'Claims approval'
  mocks.prompt.mockReset().mockImplementation(async () => state.promptResult)
  mocks.triggerDownload.mockReset()
  mocks.setLang.mockReset()
  mocks.localizedRuntimeTranslation
    .mockReset()
    .mockImplementation((key: string, values?: Record<string, unknown>) => {
      const dictionary = state.lang === 'ar' ? ar : en
      const raw = dictionary[key as keyof typeof en] ?? key
      if (!values) return raw
      return raw.replace(/\{(\w+)\}/gu, (_, name: string) => String(values[name] ?? `{${name}}`))
    })
  mocks.installLinkBadges.mockReset().mockReturnValue(vi.fn())
  mocks.autoSizeAll.mockReset().mockReturnValue(1)
  mocks.editorProps.mockReset()
  mocks.aiProps.mockReset()
  mocks.settingsProps.mockReset()
  mocks.translationReviewProps.mockReset()
  mocks.workspaceLocalizationFactories.mockReset()
  mocks.assistantProps.mockReset()
  mocks.printJobs.mockReset()
  mocks.modelerDefinitions.mockReset().mockReturnValue(undefined)
  mocks.makeFreeTranslateTexts.mockReset().mockReturnValue(async () => [])
  mocks.buildTranslationExternalReview.mockReset()
  mocks.saveSvg.mockReset().mockResolvedValue({ svg: '<svg />' })
  mocks.saveXml.mockReset().mockResolvedValue({ xml: state.xml })
  mocks.importXml.mockReset().mockResolvedValue({ warnings: [] })
  mocks.commandSave.mockReset()
  mocks.commandUndo.mockReset()
  mocks.commandRedo.mockReset()
  mocks.validateBpmn
    .mockReset()
    .mockImplementation(async (xml: string) => validationResultForXml(xml))
  mocks.evaluatePolicy.mockReset().mockReturnValue({
    allowed: true,
    blockingIssues: []
  })
  mocks.validatePreservation.mockReset().mockResolvedValue({
    valid: true,
    issues: []
  })
  mocks.diagramPreviewProps.mockReset()
  mocks.migrateLegacyCredentialsOnStartup.mockReset().mockReturnValue({
    ok: true,
    value: 0
  })
  mocks.pickWorkspace.mockReset().mockResolvedValue(null)
  mocks.rememberWorkspace.mockReset().mockResolvedValue(undefined)
  mocks.loadRememberedWorkspace.mockReset().mockResolvedValue(undefined)
  mocks.ensurePermission.mockReset().mockResolvedValue('granted')
  mocks.classifyPickerError.mockReset().mockReturnValue('unknown')
  mocks.folderTreeProps.mockReset()
  mocks.catalogProps.mockReset()
  mocks.moveDialogProps.mockReset()
  mocks.historyProps.mockReset()
  mocks.workspaceImportReviewProps.mockReset()
  mocks.restoreHistoryRevision.mockReset().mockResolvedValue({
    status: 'failed',
    sessionId: null,
    error: new Error('history restore mock was not configured')
  })
  mocks.beforeDraftPut.mockReset().mockResolvedValue(undefined)
  mocks.beforeDraftDelete.mockReset().mockResolvedValue(undefined)
  mocks.manifestBindings.length = 0
  mocks.readLibraryZipFileInWorker.mockReset().mockResolvedValue({
    entries: [],
    skipped: []
  })
  mocks.legacyCreateFolderAt.mockReset()
  mocks.legacyCreateBpmnFileUnique.mockReset()
  mocks.modelerGet.mockReset().mockImplementation((name: string) => {
    if (name === 'eventBus') {
      return { on: vi.fn(), off: vi.fn() }
    }
    if (name === 'elementRegistry') {
      return { getAll: () => [] }
    }
    if (name === 'canvas') {
      return {
        getRootElement: () => ({
          businessObject: { $type: 'bpmn:Process', name: 'Claims approval' }
        })
      }
    }
    return {}
  })
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:orbitpm-test')
  })
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  })
  Object.defineProperty(window, 'print', {
    configurable: true,
    value: vi.fn()
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})

afterEach(() => {
  resetProviderSelectionForTests()
  localStorage.removeItem('orbitpm.lite.cfg.ai-provider-selection.v1')
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.className = ''
  document.title = ''
  delete (window as Window & { __ORBITPM_LITE__?: unknown }).__ORBITPM_LITE__
})

async function openBlankDiagram(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'picker.fallback.newDiagram' }))
  expect(await screen.findByText('app.title')).not.toBeNull()
  expect(await screen.findByTestId('editor-tab')).not.toBeNull()
}

function configureTranslationModel(
  options: {
    includeMixed?: boolean
    duplicateSource?: boolean
    sourceValue?: string
  } = {}
): {
  process: Record<string, unknown>
  task: Record<string, unknown>
  duplicateTask: Record<string, unknown> | null
  batchExecutions(): number
} {
  const sourceValue = options.sourceValue ?? 'Review request'
  const process: Record<string, unknown> = {
    $type: 'bpmn:Process',
    id: 'Process_1',
    $attrs: { 'orbitpm:activeLang': 'en' }
  }
  const task: Record<string, unknown> = {
    $type: 'bpmn:Task',
    id: 'Task_1',
    name: sourceValue,
    $attrs: { 'orbitpm:nameEn': sourceValue },
    $parent: process
  }
  const mixedTask: Record<string, unknown> | null = options.includeMixed
    ? {
        $type: 'bpmn:Task',
        id: 'Task_Mixed',
        name: 'Review طلب',
        $attrs: { 'orbitpm:nameEn': 'Review طلب' },
        $parent: process
      }
    : null
  const duplicateTask: Record<string, unknown> | null = options.duplicateSource
    ? {
        $type: 'bpmn:Task',
        id: 'Task_2',
        name: sourceValue,
        $attrs: { 'orbitpm:nameEn': sourceValue },
        $parent: process
      }
    : null
  process.flowElements = [
    task,
    ...(duplicateTask ? [duplicateTask] : []),
    ...(mixedTask ? [mixedTask] : [])
  ]
  const definitions = {
    $type: 'bpmn:Definitions',
    id: 'Definitions_1',
    rootElements: [process]
  }
  const root = { id: 'Process_1', businessObject: process }
  const taskElement = { id: 'Task_1', businessObject: task }
  const mixedTaskElement = mixedTask ? { id: 'Task_Mixed', businessObject: mixedTask } : null
  const duplicateTaskElement = duplicateTask
    ? { id: 'Task_2', businessObject: duplicateTask }
    : null
  let batches = 0
  const applyProperties = (
    element: unknown,
    properties: Readonly<Record<string, unknown>>
  ): void => {
    const businessObject = (element as { businessObject?: Record<string, unknown> }).businessObject
    if (!businessObject) return
    for (const [key, value] of Object.entries(properties)) {
      if (key.includes(':')) {
        businessObject.$attrs = {
          ...((businessObject.$attrs as Record<string, unknown> | undefined) ?? {}),
          [key]: value
        }
      } else {
        businessObject[key] = value
      }
    }
  }

  mocks.modelerDefinitions.mockReturnValue(definitions)
  mocks.modelerGet.mockImplementation((name: string) => {
    if (name === 'eventBus') return { on: vi.fn(), off: vi.fn() }
    if (name === 'canvas') return { getRootElement: () => root }
    if (name === 'elementRegistry') {
      return {
        getAll: () => [
          taskElement,
          ...(duplicateTaskElement ? [duplicateTaskElement] : []),
          ...(mixedTaskElement ? [mixedTaskElement] : [])
        ]
      }
    }
    if (name === 'modeling') return { updateProperties: applyProperties }
    if (name === 'orbitpmModelingBatch') {
      return {
        execute: (
          updates: ReadonlyArray<{
            kind: 'properties' | 'waypoints'
            element: unknown
            properties?: Record<string, unknown>
          }>
        ) => {
          batches += 1
          for (const update of updates) {
            if (update.kind === 'properties' && update.properties) {
              applyProperties(update.element, update.properties)
            }
          }
        }
      }
    }
    if (name === 'commandStack') return { undo: vi.fn() }
    return {}
  })
  return {
    process,
    task,
    duplicateTask,
    batchExecutions: () => batches
  }
}

function latestTranslationReviewProps(): TranslationReviewDialogProps {
  const props = mocks.translationReviewProps.mock.calls.at(-1)?.[0] as
    TranslationReviewDialogProps | undefined
  if (!props) throw new Error('expected translation review props')
  return props
}

async function acceptTranslationProposal(
  proposal: NonNullable<TranslationReviewDialogProps['proposals']>[number]
): Promise<void> {
  const props = latestTranslationReviewProps()
  const field = listTranslationRecoveryFields(props.review).find(
    (candidate) =>
      candidate.processId === proposal.processId &&
      candidate.elementId === proposal.elementId &&
      candidate.field === proposal.field &&
      candidate.target === proposal.target
  )
  if (!field || !props.onAcceptProposal) throw new Error('missing proposed translation field')
  await act(async () => {
    await props.onAcceptProposal?.(field, proposal)
  })
}

async function applyCompletedTranslationReview(): Promise<void> {
  const apply = latestTranslationReviewProps().onApplyCompleted
  if (!apply) throw new Error('missing completed translation apply action')
  await act(async () => {
    await apply()
  })
}

function confirmedFieldRetry(
  props: TranslationReviewDialogProps,
  field: TranslationRecoveryField
): Parameters<NonNullable<TranslationReviewDialogProps['onRetryField']>>[1] {
  const batchDisclosure = props.disclosure
  if (!batchDisclosure) throw new Error('expected selected provider disclosure')
  const disclosure = buildTranslationRecoveryDisclosure(field, {
    providerId: batchDisclosure.providerId,
    ...(batchDisclosure.modelId === undefined ? {} : { modelId: batchDisclosure.modelId })
  })
  return {
    disclosure,
    consent: grantExternalRequestConsent(disclosure)
  }
}

function installMockEditorXmlTransactionCommands(options?: {
  applyExternalXml?: EditorTabCommands['applyExternalXml']
  markDirty?: () => void
  restoreDirtyState?: () => void
}): void {
  const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as
    | {
        onCommandsReady(commands: EditorTabCommands): void
      }
    | undefined
  if (!editor) throw new Error('missing editor command registration callback')
  let tail: Promise<void> = Promise.resolve()
  const runExclusiveXmlTransaction: EditorTabCommands['runExclusiveXmlTransaction'] = <Result,>(
    operation: (transaction: EditorXmlTransaction) => Promise<Result> | Result
  ): Promise<Result> => {
    const queued = tail
      .catch(() => undefined)
      .then(() =>
        operation({
          modeler: mockModeler,
          importXml: (xml) => mocks.importXml(xml),
          assertActive: () => undefined,
          markDirty: options?.markDirty ?? (() => undefined),
          restoreDirtyState: options?.restoreDirtyState ?? (() => undefined)
        })
      )
    tail = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }
  act(() => {
    editor.onCommandsReady({
      save: mocks.commandSave,
      exportSvg: vi.fn(),
      exportPng: vi.fn(),
      exportPdf: vi.fn(),
      applyExternalXml:
        options?.applyExternalXml ??
        (async (xml) => {
          await mocks.importXml(xml)
        }),
      runExclusiveXmlTransaction
    })
  })
}

async function completeReviewedXmlReview(
  user: ReturnType<typeof userEvent.setup>,
  values: readonly string[] = ['عملية قديمة', 'بداية قديمة']
): Promise<void> {
  const dialog = await screen.findByRole('dialog', { name: 'reviewedXmlReview.title' })
  const inputs = within(dialog).getAllByRole('textbox')
  expect(inputs).toHaveLength(values.length)
  for (const [index, input] of inputs.entries()) {
    await user.clear(input)
    await user.type(input, values[index]!)
  }
  const complete = within(dialog).getByRole('button', {
    name: 'reviewedXmlReview.complete'
  }) as HTMLButtonElement
  await waitFor(() => expect(complete.disabled).toBe(false))
  await user.click(complete)
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'reviewedXmlReview.title' })).toBeNull()
  )
}

function populatedDirectory() {
  const root = fakeRoot()
  root.addFile('Finance/existing.bpmn', state.xml)
  root.addFile('Finance/delete-me.bpmn', state.xml)
  root.addFile('Finance/move-me.bpmn', state.xml)
  root.addFile('Finance/drop-me.bpmn', state.xml)
  return root
}

function duplicateProcessDirectory() {
  const root = fakeRoot()
  root.addFile('Finance/a.bpmn', state.xml)
  root.addFile('Finance/existing.bpmn', state.xml)
  return root
}

function seedWorkspaceLocalization(
  root: ReturnType<typeof fakeRoot>,
  glossary: Parameters<typeof createWorkspaceGlossaryDocument>[0],
  translationMemory: Parameters<typeof createWorkspaceTranslationMemoryDocument>[0]
): void {
  root.addFile(
    WORKSPACE_GLOSSARY_PATH,
    serializeWorkspaceGlossaryDocument(createWorkspaceGlossaryDocument(glossary))
  )
  root.addFile(
    WORKSPACE_TRANSLATION_MEMORY_PATH,
    serializeWorkspaceTranslationMemoryDocument(
      createWorkspaceTranslationMemoryDocument(translationMemory)
    )
  )
}

function fakeFileText(root: ReturnType<typeof fakeRoot>, path: string): string {
  return new TextDecoder().decode(root.file(path).bytes)
}

function replaceFakeFile(root: ReturnType<typeof fakeRoot>, path: string, xml: string): void {
  const file = root.file(path)
  file.bytes = new TextEncoder().encode(xml)
  file.lastModified += 1
}

function latestSettingsLocalization(): LocalizationResourcesEditorProps {
  const props = mocks.settingsProps.mock.calls.at(-1)?.[0] as
    { localizationResources?: LocalizationResourcesEditorProps } | undefined
  if (!props?.localizationResources) {
    throw new Error('App did not expose workspace localization Settings props')
  }
  return props.localizationResources
}

function latestWorkspaceLocalizationStore(): import('./localization/workspaceStore').WorkspaceLocalizationStore {
  const store = mocks.workspaceLocalizationFactories.mock.calls.at(-1)?.[1] as
    import('./localization/workspaceStore').WorkspaceLocalizationStore | undefined
  if (!store) throw new Error('App did not create a workspace localization store')
  return store
}

function latestWorkspaceLocalizationAdapter(): import('./workspace/adapters').WorkspaceAdapter {
  const adapter = mocks.workspaceLocalizationFactories.mock.calls.at(-1)?.[0] as
    import('./workspace/adapters').WorkspaceAdapter | undefined
  if (!adapter) throw new Error('App did not bind a workspace localization adapter')
  return adapter
}

async function openDirectoryWorkspace(
  user: ReturnType<typeof userEvent.setup>,
  root = populatedDirectory()
): Promise<ReturnType<typeof populatedDirectory>> {
  state.directorySupport = true
  mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(root))
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'workspace.storage.chooseDirectory' }))
  expect(await screen.findByTestId('catalog-view')).not.toBeNull()
  expect(await screen.findByTestId('folder-tree')).not.toBeNull()
  return root
}

describe('App single-file browser orchestration', () => {
  it('shows a localized Arabic summary when browser-workspace activation fails', async () => {
    state.lang = 'ar'
    const nativeFailure = new Error('native OPFS failure sentinel')
    const testNavigator = Object.create(navigator) as Navigator
    Object.defineProperty(testNavigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockRejectedValue(nativeFailure)
      }
    })
    vi.stubGlobal('navigator', testNavigator)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'workspace.storage.openOpfs' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      ar['workspace.storage.opfsOpenFailed']
    )
    expect(screen.queryByText(nativeFailure.message)).toBeNull()
    expect(mocks.localizedRuntimeTranslation).toHaveBeenCalledWith(
      'workspace.storage.opfsOpenFailed',
      undefined
    )
  })

  it('runs legacy credential migration once and surfaces startup cleanup failures', async () => {
    const user = userEvent.setup()
    mocks.migrateLegacyCredentialsOnStartup.mockReturnValueOnce({
      ok: false,
      code: 'storage-failed',
      error: 'legacy credential cleanup blocked'
    })

    await openBlankDiagram(user)

    expect(mocks.migrateLegacyCredentialsOnStartup).toHaveBeenCalledOnce()
    expect(await screen.findByText('settings.storageError.startup')).not.toBeNull()
    expect(screen.queryByText('legacy credential cleanup blocked')).toBeNull()
  })

  it('does not construct or expose public localization persistence in single-file mode', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    expect(mocks.workspaceLocalizationFactories).not.toHaveBeenCalled()
    const settings = mocks.settingsProps.mock.calls.at(-1)?.[0] as {
      localizationResources?: LocalizationResourcesEditorProps
    }
    expect(settings.localizationResources).toBeUndefined()
  })

  it('opens a blank diagram and drives shell, settings, assistant, and language state', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    expect(screen.getByLabelText('app.version.aria').textContent).toBe('v0.4.5')
    expect(screen.getAllByTitle('workspace.storage.persistence.singleFile').length).toBeGreaterThan(
      0
    )
    const rail = screen.getByRole('button', { name: 'sidebar.toggle.aria' })
    expect(rail.getAttribute('aria-expanded')).toBe('false')
    await user.click(rail)
    expect(rail.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('fallback.singleFileNote')).not.toBeNull()
    expect(screen.getByRole('main', { name: 'app.main.aria' })).not.toBeNull()
    expect(screen.getByRole('link', { name: 'app.skipToMain' }).getAttribute('href')).toBe(
      '#orbitpm-process-workspace'
    )
    const aiDraft = screen.getByLabelText<HTMLInputElement>('mock-ai-draft')
    await user.type(aiDraft, 'retained prompt')
    await user.click(rail)
    expect(aiDraft.isConnected).toBe(true)
    expect(aiDraft.value).toBe('retained prompt')
    await user.click(rail)
    expect(screen.getByLabelText('mock-ai-draft')).toBe(aiDraft)
    await user.click(screen.getByRole('button', { name: 'ai.header' }))
    expect(screen.getByTestId('ai-panel').closest('[hidden]')).not.toBeNull()
    expect(aiDraft.value).toBe('retained prompt')
    await user.click(screen.getByRole('button', { name: 'ai.header' }))
    expect(screen.getByTestId('ai-panel')).toBe(aiDraft.closest('[data-testid="ai-panel"]'))
    expect(aiDraft.value).toBe('retained prompt')

    await user.click(screen.getByRole('button', { name: 'app.settings' }))
    const settings = await screen.findByRole('dialog', { name: 'mock-settings' })
    await user.click(within(settings).getByRole('button', { name: 'mock-settings-keys' }))
    await user.click(within(settings).getByRole('button', { name: 'mock-settings-org' }))
    await user.click(within(settings).getByRole('button', { name: 'mock-settings-close' }))
    expect(screen.queryByRole('dialog', { name: 'mock-settings' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'app.lang.control' }))
    expect(mocks.setLang).toHaveBeenCalledWith('ar')
    await user.click(screen.getByRole('button', { name: 'mock-assistant-open' }))
    expect(await screen.findByRole('button', { name: 'mock-assistant-close' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'mock-assistant-close' }))
  })

  it('uses compact App chrome and a full modal explorer below 768px', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('max-width: 767px'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true)
      }))
    )
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.click(await screen.findByRole('button', { name: 'picker.fallback.newDiagram' }))
    await screen.findByTestId('editor-tab')

    expect(
      container.querySelector(
        ".orbitpm-responsive-shell[data-responsive-mode='compact'].orbitpm-workspace-shell"
      )
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: 'app.actions.aria' })).not.toBeNull()
    const explorerToggle = container.querySelector<HTMLButtonElement>(
      '.orbitpm-workspace-header__explorer'
    )
    if (!explorerToggle) throw new Error('missing compact explorer control')
    await user.click(explorerToggle)

    const explorer = await screen.findByRole('dialog', { name: 'sidebar.explorer.aria' })
    expect(explorer.classList.contains('orbitpm-responsive-drawer--compact')).toBe(true)
    const editorProps = mocks.editorProps.mock.calls.at(-1)?.[0] as
      | {
          detailsController: {
            preferences: { open: boolean }
            setOpen(open: boolean): void
          }
          onDetailsOpenChange(open: boolean): void
        }
      | undefined
    if (!editorProps) throw new Error('missing responsive editor shell props')
    act(() => {
      editorProps.detailsController.setOpen(true)
      editorProps.onDetailsOpenChange(true)
    })
    expect(screen.queryByRole('dialog', { name: 'sidebar.explorer.aria' })).toBeNull()

    await user.click(explorerToggle)
    expect(await screen.findByRole('dialog', { name: 'sidebar.explorer.aria' })).not.toBeNull()
    const updatedEditorProps = mocks.editorProps.mock.calls.at(-1)?.[0] as typeof editorProps
    expect(updatedEditorProps?.detailsController.preferences.open).toBe(false)

    await user.click(screen.getByRole('button', { name: 'sidebar.close.aria' }))
    await waitFor(() => expect(document.activeElement).toBe(explorerToggle))
    const rail = container.querySelector<HTMLButtonElement>('.orbitpm-lite-rail')
    if (!rail) throw new Error('missing compact explorer rail control')
    await user.click(rail)
    expect(await screen.findByRole('dialog', { name: 'sidebar.explorer.aria' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'sidebar.close.aria' }))
    await waitFor(() => expect(document.activeElement).toBe(rail))
  })

  it('preserves the live workspace and pane state across docked, overlay, and compact changes', async () => {
    const viewport = installControllableMatchMedia(1440)
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    act(() => {
      latestAiPanelProps().spreadsheet.onOpenSingle(state.xml, 'responsive-second.bpmn')
    })
    await screen.findByText(/responsive-second\.bpmn/)
    await user.click(screen.getByRole('button', { name: 'mock-editor-dirty' }))
    const aiDraft = screen.getByLabelText<HTMLInputElement>('mock-ai-draft')
    await user.type(aiDraft, 'retain this responsive draft')

    const controller = latestSessionController()
    const localizationAdapter = latestWorkspaceLocalizationAdapter()
    const activeBefore = controller.store.getActive()
    const tabCount = controller.store.list().length
    if (!activeBefore) throw new Error('expected an active responsive test session')
    const dockedEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      responsiveMode: 'docked' | 'overlay' | 'compact'
      outlineOpen?: boolean
      onOutlineOpenChange?(open: boolean): void
      detailsController: {
        preferences: { open: boolean }
        setOpen(open: boolean): void
      }
      onDetailsOpenChange(open: boolean): void
    }
    act(() => {
      dockedEditor.onOutlineOpenChange?.(true)
      dockedEditor.detailsController.setOpen(true)
      dockedEditor.onDetailsOpenChange(true)
    })

    for (const [width, expectedMode] of [
      [1024, 'overlay'],
      [640, 'compact'],
      [1440, 'docked']
    ] as const) {
      act(() => viewport.setWidth(width))
      await waitFor(() =>
        expect(
          (
            mocks.editorProps.mock.calls.at(-1)?.[0] as {
              responsiveMode?: string
            }
          )?.responsiveMode
        ).toBe(expectedMode)
      )
      expect(mocks.pickWorkspace).toHaveBeenCalledOnce()
      expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledOnce()
      expect(latestSessionController()).toBe(controller)
      expect(latestWorkspaceLocalizationAdapter()).toBe(localizationAdapter)
      expect(controller.store.list()).toHaveLength(tabCount)
      expect(controller.store.getActive()).toMatchObject({
        id: activeBefore.id,
        dirty: true
      })
      expect(aiDraft.isConnected).toBe(true)
      expect(aiDraft.value).toBe('retain this responsive draft')
      expect(document.querySelectorAll('[aria-modal="true"]').length).toBeLessThanOrEqual(1)
    }
  })

  it('hands raw Outline ownership to an inactive editor so it cannot reopen from catalog', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const activeEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      outlineOpen?: boolean
      onOutlineOpenChange?(open: boolean): void
      sidePanesActive?: boolean
    }
    act(() => activeEditor.onOutlineOpenChange?.(true))
    expect(
      (
        mocks.editorProps.mock.calls.at(-1)?.[0] as {
          outlineOpen?: boolean
        }
      ).outlineOpen
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: 'app.home' }))
    await screen.findByTestId('catalog-view')
    const inactiveEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      outlineOpen?: boolean
      onOutlineOpenChange?(open: boolean): void
      sidePanesActive?: boolean
    }
    expect(inactiveEditor.sidePanesActive).toBe(false)
    expect(inactiveEditor.outlineOpen).toBe(true)
    act(() => inactiveEditor.onOutlineOpenChange?.(false))

    await user.click(screen.getByRole('tab', { name: /existing\.bpmn/ }))
    const reopenedEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      outlineOpen?: boolean
      sidePanesActive?: boolean
    }
    expect(reopenedEditor.sidePanesActive).toBe(true)
    expect(reopenedEditor.outlineOpen).toBe(false)
  })

  it('keeps language switching local while only Translate preselects a repair provider', async () => {
    const process: Record<string, unknown> = {
      $type: 'bpmn:Process',
      id: 'Process_1',
      $attrs: { 'orbitpm:activeLang': 'en' }
    }
    const task: Record<string, unknown> = {
      $type: 'bpmn:Task',
      id: 'Task_1',
      name: 'Review request',
      $attrs: { 'orbitpm:nameEn': 'Review request' },
      $parent: process
    }
    process.flowElements = [task]
    mocks.modelerDefinitions.mockReturnValue({
      $type: 'bpmn:Definitions',
      rootElements: [process]
    })
    mocks.modelerGet.mockImplementation((name: string) => {
      if (name === 'eventBus') return { on: vi.fn(), off: vi.fn() }
      if (name === 'canvas') {
        return {
          getRootElement: () => ({ id: 'Process_1', businessObject: process })
        }
      }
      if (name === 'elementRegistry') {
        return {
          getAll: () => [{ id: 'Task_1', businessObject: task }]
        }
      }
      return {}
    })
    expect(setProviderSelection('anthropic', 'claude-sonnet-5').ok).toBe(true)

    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.langToggle' }))
    expect(mocks.translationReviewProps.mock.calls.at(-1)?.[0].providerId).toBe('')

    await user.click(screen.getByRole('button', { name: 'translationReview.postpone' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    expect(mocks.translationReviewProps.mock.calls.at(-1)?.[0].providerId).toBe('selected-ai')
  })

  it('stages a reviewed manual field privately, then applies metadata and projection in one batch', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))

    const initial = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(initial.review)[0]
    if (!field || !initial.onManualEdit) throw new Error('missing manual translation recovery')
    await act(async () => {
      await initial.onManualEdit?.(field, 'مراجعة الطلب')
    })

    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(model.task.name).toBe('Review request')
    expect((model.process.$attrs as Record<string, unknown>)['orbitpm:activeLang']).toBe('en')
    expect(model.batchExecutions()).toBe(0)
    const completed = latestTranslationReviewProps()
    expect(completed.acceptedValues).toEqual([
      expect.objectContaining({ elementId: 'Task_1', value: 'مراجعة الطلب' })
    ])
    expect(completed.onApplyCompleted).toEqual(expect.any(Function))

    await applyCompletedTranslationReview()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    )
    expect(model.task.name).toBe('مراجعة الطلب')
    expect((model.process.$attrs as Record<string, unknown>)['orbitpm:activeLang']).toBe('ar')
    expect(model.batchExecutions()).toBe(1)
  })

  it('retries exactly one consented field and requires acceptance before one final model batch', async () => {
    const model = configureTranslationModel()
    const calls: Array<{
      texts: string[]
      from: 'en' | 'ar'
      to: 'en' | 'ar'
      signal?: AbortSignal
    }> = []
    mocks.makeFreeTranslateTexts.mockImplementation(() => {
      return async (texts: string[], from: 'en' | 'ar', to: 'en' | 'ar', signal?: AbortSignal) => {
        calls.push({ texts, from, to, signal })
        return ['مراجعة الطلب']
      }
    })
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable translation field')

    await act(async () => {
      await selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })

    expect(calls).toEqual([
      {
        texts: ['Review request'],
        from: 'en',
        to: 'ar',
        signal: expect.any(AbortSignal)
      }
    ])
    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledWith({
      onAttempt: expect.any(Function)
    })
    expect(latestTranslationReviewProps().proposals).toEqual([
      expect.objectContaining({ elementId: 'Task_1', value: 'مراجعة الطلب' })
    ])
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(model.task.name).toBe('Review request')
    expect((model.process.$attrs as Record<string, unknown>)['orbitpm:activeLang']).toBe('en')
    expect(model.batchExecutions()).toBe(0)

    await acceptTranslationProposal(latestTranslationReviewProps().proposals![0]!)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(model.batchExecutions()).toBe(0)
    await applyCompletedTranslationReview()
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect(model.task.name).toBe('مراجعة الطلب')
    expect((model.process.$attrs as Record<string, unknown>)['orbitpm:activeLang']).toBe('ar')
    expect(model.batchExecutions()).toBe(1)
  })

  it('single-flights a double field retry and cancellation aborts its only transport', async () => {
    const model = configureTranslationModel()
    const transportStarted = deferred()
    let transportCalls = 0
    let transportSignal: AbortSignal | undefined
    mocks.makeFreeTranslateTexts.mockReturnValue(
      async (_texts: string[], _from: 'en' | 'ar', _to: 'en' | 'ar', signal?: AbortSignal) => {
        transportCalls += 1
        transportSignal = signal
        transportStarted.resolve()
        return await new Promise<Array<string | undefined>>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true }
          )
        })
      }
    )
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const captured = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(captured.review)[0]
    if (!field || !captured.onRetryField) throw new Error('missing retryable translation field')
    const confirmation = confirmedFieldRetry(captured, field)
    const partialPreview = captured.onPartialPreview
    let first: Promise<void> | void
    let second: Promise<void> | void

    act(() => {
      first = captured.onRetryField?.(field, confirmation)
      second = captured.onRetryField?.(field, confirmation)
      partialPreview()
    })
    await transportStarted.promise

    expect(transportCalls).toBe(1)
    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()
    expect(model.batchExecutions()).toBe(0)
    act(() => latestTranslationReviewProps().onCancelTranslation())
    await act(async () => {
      await Promise.all([first, second])
    })

    expect(transportSignal?.aborted).toBe(true)
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
  })

  it('stages multiple provider approvals without mutation and commits one undoable batch', async () => {
    const model = configureTranslationModel({ duplicateSource: true })
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب', 'تدقيق الطلب'])
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    await act(async () => {
      await latestTranslationReviewProps().onTranslateNow()
    })

    const proposals = [...(latestTranslationReviewProps().proposals ?? [])]
    expect(proposals).toHaveLength(2)
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(
      (model.duplicateTask?.$attrs as Record<string, unknown>)['orbitpm:nameAr']
    ).toBeUndefined()

    for (const proposal of proposals) await acceptTranslationProposal(proposal)
    expect(model.batchExecutions()).toBe(0)
    expect(latestTranslationReviewProps().acceptedValues).toHaveLength(2)

    await applyCompletedTranslationReview()

    expect(model.batchExecutions()).toBe(1)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect((model.duplicateTask?.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe(
      'تدقيق الطلب'
    )
    expect(model.task.name).toBe('مراجعة الطلب')
    expect(model.duplicateTask?.name).toBe('تدقيق الطلب')
    expect((model.process.$attrs as Record<string, unknown>)['orbitpm:activeLang']).toBe('ar')
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
  })

  it('discards staged review values on postpone without touching the model', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    const review = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(review.review)[0]
    if (!field || !review.onManualEdit) throw new Error('missing manual translation field')
    await act(async () => {
      await review.onManualEdit?.(field, 'مراجعة الطلب')
    })

    expect(latestTranslationReviewProps().acceptedValues).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'translationReview.postpone' }))

    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(model.task.name).toBe('Review request')
    expect((model.process.$attrs as Record<string, unknown>)['orbitpm:activeLang']).toBe('en')
  })

  it('reuses the disclosure across in-flight progress-only renders', async () => {
    configureTranslationModel()
    let onAttempt:
      | ((attempt: {
          service: 'google' | 'mymemory'
          item: number
          itemCount: number
          attempt: number
          maxAttempts: number
          retryInMs?: number
        }) => void)
      | undefined
    mocks.makeFreeTranslateTexts.mockImplementation(
      (options: {
        onAttempt?: (attempt: {
          service: 'google' | 'mymemory'
          item: number
          itemCount: number
          attempt: number
          maxAttempts: number
          retryInMs?: number
        }) => void
      }) => {
        onAttempt = options.onAttempt
        return async (
          _texts: string[],
          _from: 'en' | 'ar',
          _to: 'en' | 'ar',
          signal?: AbortSignal
        ) =>
          new Promise<Array<string | undefined>>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      }
    )
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const disclosure = latestTranslationReviewProps().disclosure
    expect(disclosure).not.toBeNull()
    expect(mocks.buildTranslationExternalReview).toHaveBeenCalledTimes(1)

    let run: Promise<void> | void
    act(() => {
      run = latestTranslationReviewProps().onTranslateNow()
    })
    await waitFor(() => expect(onAttempt).toEqual(expect.any(Function)))
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      act(() => {
        onAttempt?.({
          service: 'google',
          item: 1,
          itemCount: 1,
          attempt,
          maxAttempts: 3,
          ...(attempt === 1 ? { retryInMs: 2_000 } : {})
        })
      })
    }

    expect(latestTranslationReviewProps().disclosure).toBe(disclosure)
    expect(mocks.buildTranslationExternalReview).toHaveBeenCalledTimes(1)
    act(() => latestTranslationReviewProps().onCancelTranslation())
    await act(async () => {
      await run
    })
    expect(mocks.buildTranslationExternalReview).toHaveBeenCalledTimes(1)
  })

  it('invalidates unaccepted proposals and outbound consent state on provider change', async () => {
    const model = configureTranslationModel()
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب'])
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    await act(async () => {
      await latestTranslationReviewProps().onTranslateNow()
    })
    const captured = latestTranslationReviewProps()
    const proposal = captured.proposals?.[0]
    const field = listTranslationRecoveryFields(captured.review)[0]
    if (!proposal || !field || !captured.onAcceptProposal || !captured.onRejectProposal) {
      throw new Error('missing captured provider proposal actions')
    }

    act(() => latestTranslationReviewProps().onProviderChange(''))
    await act(async () => {
      await captured.onAcceptProposal?.(field, proposal)
      await captured.onRejectProposal?.(field, proposal)
    })

    const changed = latestTranslationReviewProps()
    expect(changed.proposals).toEqual([])
    expect(changed.acceptedValues).toEqual([])
    expect(changed.disclosure).toBeNull()
    expect(
      listTranslationRecoveryFields(changed.review).find((candidate) => candidate.id === field.id)
        ?.failed
    ).toBe(false)
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
  })

  it('ignores every stale rendered review action after a replacement review opens', async () => {
    const model = configureTranslationModel()
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب'])
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const captured = latestTranslationReviewProps()
    const capturedField = listTranslationRecoveryFields(captured.review)[0]
    if (!capturedField || !captured.onRetryField || !captured.onApplyCompleted) {
      throw new Error('missing captured translation review actions')
    }
    const capturedConfirmation = confirmedFieldRetry(captured, capturedField)

    await user.click(screen.getByRole('button', { name: 'translationReview.postpone' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const replacement = latestTranslationReviewProps()

    act(() => captured.onProviderChange(''))
    expect(latestTranslationReviewProps().providerId).toBe('free')
    act(() => captured.onPostpone())
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()
    act(() => captured.onPartialPreview())
    await act(async () => {
      await captured.onTranslateNow()
      await captured.onRetryField?.(capturedField, capturedConfirmation)
    })

    expect(mocks.makeFreeTranslateTexts).not.toHaveBeenCalled()
    expect(latestTranslationReviewProps()).toMatchObject({
      providerId: 'free',
      proposals: [],
      acceptedValues: [],
      status: null
    })
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()

    const replacementField = listTranslationRecoveryFields(replacement.review)[0]
    if (!replacementField || !replacement.onManualEdit) {
      throw new Error('missing replacement translation field')
    }
    await act(async () => {
      await replacement.onManualEdit?.(replacementField, 'مراجعة الطلب')
    })
    await act(async () => {
      await captured.onApplyCompleted?.()
    })

    expect(latestTranslationReviewProps().acceptedValues).toHaveLength(1)
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()

    act(() => latestTranslationReviewProps().onPostpone())
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    )

    const transportStarted = deferred()
    let transportSignal: AbortSignal | undefined
    mocks.makeFreeTranslateTexts.mockReturnValue(
      async (_texts: string[], _from: 'en' | 'ar', _to: 'en' | 'ar', signal?: AbortSignal) => {
        transportSignal = signal
        transportStarted.resolve()
        return await new Promise<Array<string | undefined>>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true }
          )
        })
      }
    )
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const current = latestTranslationReviewProps()
    const currentField = listTranslationRecoveryFields(current.review)[0]
    if (!currentField || !current.onRetryField) {
      throw new Error('missing current translation field')
    }
    let retry: Promise<void> | void
    act(() => {
      retry = current.onRetryField?.(currentField, confirmedFieldRetry(current, currentField))
    })
    await transportStarted.promise

    act(() => captured.onCancelTranslation())
    expect(transportSignal?.aborted).toBe(false)
    act(() => latestTranslationReviewProps().onCancelTranslation())
    await act(async () => {
      await retry
    })
    expect(transportSignal?.aborted).toBe(true)
    expect(model.batchExecutions()).toBe(0)
  })

  it('re-resolves the latest model and rejects an old captured field consent before transport', async () => {
    const model = configureTranslationModel()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(setKey('anthropic', 'test-key').ok).toBe(true)
    expect(setProviderSelection('anthropic', 'claude-sonnet-5').ok).toBe(true)
    const user = userEvent.setup()
    try {
      await openBlankDiagram(user)
      await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
      await user.click(screen.getByRole('button', { name: 'editor.translate' }))
      const captured = latestTranslationReviewProps()
      const field = listTranslationRecoveryFields(captured.review)[0]
      if (!field || !captured.onRetryField) throw new Error('missing captured translation retry')
      const oldConfirmation = confirmedFieldRetry(captured, field)

      await user.click(screen.getByRole('button', { name: 'translationReview.postpone' }))
      expect(setProviderSelection('anthropic', 'claude-opus-4-8').ok).toBe(true)
      await user.click(screen.getByRole('button', { name: 'editor.translate' }))

      await act(async () => {
        await captured.onRetryField?.(field, oldConfirmation)
      })

      expect(fetch).not.toHaveBeenCalled()
      expect(mocks.makeFreeTranslateTexts).not.toHaveBeenCalled()
      expect(latestTranslationReviewProps().status).toBeNull()
      expect(model.batchExecutions()).toBe(0)
      expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    } finally {
      clearKey('anthropic')
    }
  })

  it('rejects a non-neutral wrong-script field response before mutation and retains provider failure', async () => {
    const model = configureTranslationModel()
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['Still English'])
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable translation field')

    await act(async () => {
      await selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })

    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(model.task.name).toBe('Review request')
    expect((model.process.$attrs as Record<string, unknown>)['orbitpm:activeLang']).toBe('en')
    expect(model.batchExecutions()).toBe(0)
    expect(listTranslationRecoveryFields(latestTranslationReviewProps().review)).toEqual([
      expect.objectContaining({
        id: field.id,
        failed: true,
        retryable: true
      })
    ])
  })

  it('retains a rate-limited field with retry/manual actions and a truthful failure status', async () => {
    configureTranslationModel()
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => {
      throw new FreeTranslateError('rate', 'chain')
    })
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable translation field')

    await act(async () => {
      await selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })

    const failed = latestTranslationReviewProps()
    expect(failed.status).toBe('translate.free.rate')
    expect(listTranslationRecoveryFields(failed.review)).toEqual([
      expect.objectContaining({
        id: field.id,
        failed: true,
        retryable: true
      })
    ])
    expect(failed.onRetryField).toEqual(expect.any(Function))
    expect(failed.onManualEdit).toEqual(expect.any(Function))
    expect(screen.getByRole('button', { name: 'translationReview.field.retry' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'translationReview.field.manual' })).not.toBeNull()
  })

  it('refuses stale field text before transport and refreshes the recovery review', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable translation field')
    model.task.name = 'Changed after review'
    model.task.$attrs = {
      ...(model.task.$attrs as Record<string, unknown>),
      'orbitpm:nameEn': 'Changed after review'
    }

    await act(async () => {
      await selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })

    expect(mocks.makeFreeTranslateTexts).not.toHaveBeenCalled()
    const refreshed = latestTranslationReviewProps()
    expect(refreshed.status).toBe('translationReview.stale')
    expect(listTranslationRecoveryFields(refreshed.review)[0]?.sourceValue).toBe(
      'Changed after review'
    )
    expect(model.batchExecutions()).toBe(0)
  })

  it('clears staged values when another source changes before an invalid field response returns', async () => {
    const model = configureTranslationModel({ duplicateSource: true })
    let resolveTransport: ((value: Array<string | undefined>) => void) | undefined
    mocks.makeFreeTranslateTexts.mockReturnValue(
      async () =>
        await new Promise<Array<string | undefined>>((resolve) => {
          resolveTransport = resolve
        })
    )
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const initial = latestTranslationReviewProps()
    const fields = listTranslationRecoveryFields(initial.review)
    const first = fields.find((field) => field.elementId === 'Task_1')
    if (!first || !initial.onManualEdit) throw new Error('missing first staged translation field')
    await act(async () => {
      await initial.onManualEdit?.(first, 'مراجعة الطلب')
    })
    const staged = latestTranslationReviewProps()
    const second = listTranslationRecoveryFields(staged.review).find(
      (field) => field.elementId === 'Task_2'
    )
    if (!second || !staged.onRetryField) throw new Error('missing second retryable field')
    let retry: Promise<void> | void
    act(() => {
      retry = staged.onRetryField?.(second, confirmedFieldRetry(staged, second))
    })
    await waitFor(() => expect(resolveTransport).toEqual(expect.any(Function)))

    model.task.name = 'Changed while retrying'
    model.task.$attrs = {
      ...(model.task.$attrs as Record<string, unknown>),
      'orbitpm:nameEn': 'Changed while retrying'
    }
    await act(async () => {
      resolveTransport?.([undefined])
      await retry
    })

    const refreshed = latestTranslationReviewProps()
    expect(refreshed.status).toBe('translationReview.stale')
    expect(refreshed.acceptedValues).toEqual([])
    expect(refreshed.proposals).toEqual([])
    expect(listTranslationRecoveryFields(refreshed.review)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: 'Task_1',
          sourceValue: 'Changed while retrying'
        })
      ])
    )
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
  })

  it('fails a stale proposal rejection closed and refreshes the reviewed source', async () => {
    const model = configureTranslationModel()
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب'])
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    await act(async () => {
      await latestTranslationReviewProps().onTranslateNow()
    })
    const proposed = latestTranslationReviewProps()
    const proposal = proposed.proposals?.[0]
    const field = listTranslationRecoveryFields(proposed.review)[0]
    if (!proposal || !field || !proposed.onRejectProposal) {
      throw new Error('missing provider proposal rejection action')
    }
    model.task.name = 'Changed after provider response'
    model.task.$attrs = {
      ...(model.task.$attrs as Record<string, unknown>),
      'orbitpm:nameEn': 'Changed after provider response'
    }

    await act(async () => {
      await proposed.onRejectProposal?.(field, proposal)
    })

    const refreshed = latestTranslationReviewProps()
    expect(refreshed.status).toBe('translationReview.stale')
    expect(refreshed.proposals).toEqual([])
    expect(refreshed.acceptedValues).toEqual([])
    expect(listTranslationRecoveryFields(refreshed.review)[0]?.sourceValue).toBe(
      'Changed after provider response'
    )
    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
  })

  it('aborts and discards a late field retry when the workspace generation changes', async () => {
    const model = configureTranslationModel()
    let transportSignal: AbortSignal | undefined
    let resolveTransport: ((value: Array<string | undefined>) => void) | undefined
    mocks.makeFreeTranslateTexts.mockReturnValue(
      async (_texts: string[], _from: 'en' | 'ar', _to: 'en' | 'ar', signal?: AbortSignal) => {
        transportSignal = signal
        return await new Promise<Array<string | undefined>>((resolve) => {
          resolveTransport = resolve
        })
      }
    )
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable translation field')
    let retry: Promise<void> | void
    act(() => {
      retry = selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })
    await waitFor(() => expect(transportSignal).toEqual(expect.any(AbortSignal)))

    const replacement = new FakeDirectoryHandle('replacement-workspace')
    replacement.addFile('replacement.bpmn', state.xml)
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(replacement))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() => expect(transportSignal?.aborted).toBe(true))
    await act(async () => {
      resolveTransport?.(['مراجعة الطلب'])
      await retry
    })

    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(model.batchExecutions()).toBe(0)
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    expect(screen.getByTestId('catalog-view')).not.toBeNull()
  })

  it('aborts a late translation when generated placement activates another tab', async () => {
    const model = configureTranslationModel()
    let transportSignal: AbortSignal | undefined
    let resolveTransport: ((value: Array<string | undefined>) => void) | undefined
    mocks.makeFreeTranslateTexts.mockReturnValue(
      async (_texts: string[], _from: 'en' | 'ar', _to: 'en' | 'ar', signal?: AbortSignal) => {
        transportSignal = signal
        return await new Promise<Array<string | undefined>>((resolve) => {
          resolveTransport = resolve
        })
      }
    )
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable translation field')
    let retry: Promise<void> | void
    act(() => {
      retry = selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })
    await waitFor(() => expect(transportSignal).toEqual(expect.any(AbortSignal)))

    const placement = latestAiPanelProps()
    await act(async () => {
      await placement.onPlaceGenerated(state.xml, {
        name: 'Superseding generated tab',
        targetFolder: '',
        gen: placement.getWorkspaceGen?.(),
        localizationSource: 'ai',
        signal: new AbortController().signal
      })
    })
    await waitFor(() => expect(transportSignal?.aborted).toBe(true))
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()

    await act(async () => {
      resolveTransport?.(['مراجعة الطلب'])
      await retry
    })

    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(model.batchExecutions()).toBe(0)
    const supersedingTab = screen.getByRole('tab', {
      name: /superseding-generated-tab\.bpmn/
    })
    expect(supersedingTab.getAttribute('aria-selected')).toBe('true')
    expect(
      screen
        .getAllByRole('tab')
        .filter((tab) => tab !== supersedingTab)
        .every((tab) => tab.getAttribute('aria-selected') === 'false')
    ).toBe(true)
    expect(screen.queryByText('translate.done')).toBeNull()
  })

  it('shows per-item retry status and ignores a stale same-tab callback', async () => {
    const process: Record<string, unknown> = {
      $type: 'bpmn:Process',
      id: 'Process_1',
      $attrs: { 'orbitpm:activeLang': 'en' }
    }
    const task: Record<string, unknown> = {
      $type: 'bpmn:Task',
      id: 'Task_1',
      name: 'Review request',
      $attrs: { 'orbitpm:nameEn': 'Review request' },
      $parent: process
    }
    process.flowElements = [task]
    mocks.modelerDefinitions.mockReturnValue({
      $type: 'bpmn:Definitions',
      rootElements: [process]
    })
    const eventBus = { on: vi.fn(), off: vi.fn() }
    mocks.modelerGet.mockImplementation((name: string) => {
      if (name === 'eventBus') return eventBus
      if (name === 'canvas') {
        return {
          getRootElement: () => ({ id: 'Process_1', businessObject: process })
        }
      }
      if (name === 'elementRegistry') {
        return {
          getAll: () => [{ id: 'Task_1', businessObject: task }]
        }
      }
      return {}
    })
    type Attempt = {
      attempt: number
      maxAttempts: number
      retryInMs?: number
      service: 'google' | 'mymemory'
      item: number
      itemCount: number
    }
    const attemptCallbacks: Array<(attempt: Attempt) => void> = []
    let transportIndex = 0
    mocks.makeFreeTranslateTexts.mockImplementation(
      (options: { onAttempt?: (attempt: Attempt) => void }) => {
        const currentTransport = transportIndex
        transportIndex += 1
        if (options.onAttempt) attemptCallbacks.push(options.onAttempt)
        return async (
          _texts: string[],
          _from: 'en' | 'ar',
          _to: 'en' | 'ar',
          signal?: AbortSignal
        ) => {
          if (currentTransport === 0) {
            options.onAttempt?.({
              attempt: 1,
              maxAttempts: 3,
              service: 'google',
              item: 2,
              itemCount: 4
            })
            options.onAttempt?.({
              attempt: 1,
              maxAttempts: 3,
              retryInMs: 1_500,
              service: 'google',
              item: 2,
              itemCount: 4
            })
          }
          return await new Promise<Array<string | undefined>>((_resolve, reject) => {
            const abort = (): void =>
              reject(signal?.reason ?? new DOMException('cancelled', 'AbortError'))
            if (signal?.aborted) abort()
            else signal?.addEventListener('abort', abort, { once: true })
          })
        }
      }
    )

    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await user.selectOptions(await screen.findByRole('combobox'), 'free')
    await user.click(screen.getByRole('button', { name: 'translationReview.translateNow' }))

    expect(
      await screen.findByText('translationReview.retry.waiting:Google Translate:2/4:1/3:2')
    ).not.toBeNull()
    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledWith({
      onAttempt: expect.any(Function)
    })
    act(() =>
      attemptCallbacks[0]?.({
        attempt: 2,
        maxAttempts: 3,
        service: 'google',
        item: 2,
        itemCount: 4
      })
    )
    expect(
      await screen.findByText('translationReview.retry.attempt:Google Translate:2/4:2/3')
    ).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'translationReview.cancel' }))
    expect(await screen.findByText('translationReview.cancelled')).not.toBeNull()
    const cancelled = latestTranslationReviewProps()
    expect(deriveTranslationReviewProgress(cancelled.review)).toEqual({
      total: 1,
      resolved: 0,
      unresolved: 1,
      failed: 0,
      complete: false
    })
    expect(listTranslationRecoveryFields(cancelled.review)).toEqual([
      expect.objectContaining({
        failed: false,
        retryable: true
      })
    ])
    expect(screen.getByRole('button', { name: 'translationReview.field.retry' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'translationReview.field.manual' })).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'translationReview.postpone' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await user.selectOptions(await screen.findByRole('combobox'), 'free')
    await user.click(screen.getByRole('button', { name: 'translationReview.translateNow' }))
    expect(await screen.findByText('translationReview.running')).not.toBeNull()
    expect(attemptCallbacks).toHaveLength(2)

    act(() =>
      attemptCallbacks[0]?.({
        attempt: 3,
        maxAttempts: 3,
        service: 'mymemory',
        item: 4,
        itemCount: 4
      })
    )
    expect(screen.getByText('translationReview.running')).not.toBeNull()
    expect(screen.queryByText('translationReview.retry.attempt:MyMemory:4/4:3/3')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'translationReview.cancel' }))
    expect(await screen.findByText('translationReview.cancelled')).not.toBeNull()
  })

  it('does not report a provider failure for a manual-only row after a batch transport error', async () => {
    configureTranslationModel({ includeMixed: true })
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => {
      throw new FreeTranslateError('rate', 'chain')
    })
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await user.selectOptions(await screen.findByRole('combobox'), 'free')
    await user.click(screen.getByRole('button', { name: 'translationReview.translateNow' }))

    expect(await screen.findByText('translate.free.rate')).not.toBeNull()
    const review = latestTranslationReviewProps().review
    const rows = listTranslationRecoveryFields(review)
    expect(rows.find((row) => row.elementId === 'Task_1')).toMatchObject({
      failed: true,
      retryable: true
    })
    expect(rows.find((row) => row.elementId === 'Task_Mixed')).toMatchObject({
      failed: false,
      requiresManualReview: true
    })
    expect(deriveTranslationReviewProgress(review)).toMatchObject({
      unresolved: 2,
      failed: 1,
      complete: false
    })
  })

  it('warns when persistent browser draft recovery is unavailable', async () => {
    sessionHarness.indexedDbAvailable = false
    const user = userEvent.setup()
    await openBlankDiagram(user)
    expect(await screen.findByText('draftRecovery.degraded')).not.toBeNull()
  })

  it('creates a named process, preserves dirty work on cancel, saves, and closes it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'picker.fallback.newProcess' }))
    expect((await screen.findAllByText('claims-approval.bpmn')).length).toBeGreaterThan(0)
    expect(mocks.prompt).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'mock-editor-dirty' }))
    const processTab = screen.getByRole('tab', {
      name: /claims-approval\.bpmn.*tab\.dirty\.aria/
    })
    expect(screen.getByRole('tablist', { name: 'tab.list.aria' })).not.toBeNull()
    expect(processTab.getAttribute('aria-selected')).toBe('true')
    const controlledPanel = processTab.getAttribute('aria-controls')
    expect(controlledPanel).toBeTruthy()
    expect(screen.getByRole('tabpanel').id).toBe(controlledPanel)
    await user.click(screen.getByTitle('tab.closeTitle'))
    const discardDialog = screen.getByRole('alertdialog', {
      name: 'confirm.discardUnsaved.title'
    })
    expect(document.activeElement).toBe(
      within(discardDialog).getByRole('button', { name: 'confirmDialog.cancel' })
    )
    expect(window.confirm).not.toHaveBeenCalled()
    expect(screen.getByTestId('editor-tab')).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog', { name: 'confirm.discardUnsaved.title' })).toBeNull()
    expect(document.activeElement).toBe(processTab)

    const session = latestSessionController().store.getActive()
    if (!session) throw new Error('expected the created process session')
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    await act(async () => {
      await editor.onRequestSave(session.currentXml)
    })
    expect(mocks.validatePreservation).not.toHaveBeenCalled()
    expect(mocks.validateBpmn).toHaveBeenCalled()
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'claims-approval.bpmn',
      expect.stringContaining('data:application/xml')
    )
    await user.click(screen.getByRole('button', { name: 'mock-editor-clean' }))
    await user.click(screen.getByTitle('tab.closeTitle'))
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'confirm.discardUnsaved.title' })).getByRole(
        'button',
        { name: 'confirm.discardUnsaved.confirm' }
      )
    )
    expect(await screen.findByText('emptyTab.fallback')).not.toBeNull()
  })

  it('focuses the adjacent tab and then the workspace when confirmed dirty closes complete', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    await user.click(screen.getByRole('button', { name: 'sidebar.toggle.aria' }))
    await user.click(screen.getByRole('button', { name: 'mock-ai-place' }))
    const generatedTab = await screen.findByRole('tab', {
      name: /ai-claims\.bpmn.*tab\.dirty\.aria/
    })
    const originalTab = screen.getByRole('tab', {
      name: /untitled\.bpmn.*tab\.dirty\.aria/
    })

    generatedTab.focus()
    await user.keyboard('{Delete}')
    let discardDialog = screen.getByRole('alertdialog', {
      name: 'confirm.discardUnsaved.title'
    })
    await user.click(
      within(discardDialog).getByRole('button', { name: 'confirm.discardUnsaved.confirm' })
    )
    await waitFor(() => expect(screen.queryByText('ai-claims.bpmn')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(originalTab))

    await user.keyboard('{Delete}')
    discardDialog = screen.getByRole('alertdialog', {
      name: 'confirm.discardUnsaved.title'
    })
    await user.click(
      within(discardDialog).getByRole('button', { name: 'confirm.discardUnsaved.confirm' })
    )
    expect(await screen.findByText('emptyTab.fallback')).not.toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('main', { name: 'app.main.aria' }))
    )
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('clears a dirty-close prompt before a superseding workspace activation decision', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    const originalTab = screen.getByRole('tab', {
      name: /untitled\.bpmn.*tab\.dirty\.aria/
    })
    originalTab.focus()
    await user.keyboard('{Delete}')
    expect(screen.getByRole('alertdialog', { name: 'confirm.discardUnsaved.title' })).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'app.newProcess' }))

    expect(screen.queryByRole('alertdialog', { name: 'confirm.discardUnsaved.title' })).toBeNull()
    const switchGuard = await screen.findByRole('dialog', { name: 'confirm.switch.title' })
    await user.click(within(switchGuard).getByRole('button', { name: 'confirm.switch.cancel' }))
    expect(screen.getByTestId('editor-tab')).not.toBeNull()
    expect(screen.getByRole('tab', { name: /untitled\.bpmn/ })).not.toBeNull()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('places AI and spreadsheet results as live tabs and starts the interview drawer', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    await user.click(screen.getByRole('button', { name: 'sidebar.toggle.aria' }))
    await user.click(screen.getByRole('button', { name: 'mock-ai-place' }))
    await waitFor(() => expect(screen.getByText(/ai-claims\.bpmn/)).not.toBeNull())
    expect(mocks.validateBpmn).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'mock-sheet-open' }))
    expect(await screen.findByText(/sheet-flow\.bpmn/)).not.toBeNull()
    expect(typeof latestAiPanelProps().spreadsheet.onReviewBilingual).toBe('function')

    await user.click(screen.getByRole('button', { name: 'mock-ai-chat' }))
    expect(await screen.findByRole('button', { name: 'mock-assistant-close' })).not.toBeNull()
  })

  it('reports a validated fallback placement as a true in-memory success', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    const rail = screen.getByRole('button', { name: 'sidebar.toggle.aria' })
    if (rail.getAttribute('aria-expanded') === 'false') await user.click(rail)
    await screen.findByTestId('ai-panel')
    const props = latestAiPanelProps()
    const controller = new AbortController()
    let outcome: import('./ai/placementOutcome').GeneratedPlacementOutcome | undefined

    await act(async () => {
      outcome = await props.onPlaceGenerated(state.xml, {
        name: 'AI outcome',
        targetFolder: '',
        gen: props.getWorkspaceGen?.(),
        localizationSource: 'ai',
        signal: controller.signal
      })
    })

    expect(outcome).toEqual({ status: 'opened-in-memory', label: 'ai-outcome.bpmn' })
    expect(await screen.findByText(/ai-outcome\.bpmn/)).not.toBeNull()
  })

  it('discards a pre-aborted fallback placement before validation', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    const props = latestAiPanelProps()
    const controller = new AbortController()
    controller.abort()
    mocks.validateBpmn.mockClear()

    await expect(
      props.onPlaceGenerated(state.xml, {
        name: 'Pre-aborted placement',
        targetFolder: '',
        gen: props.getWorkspaceGen?.(),
        localizationSource: 'ai',
        signal: controller.signal
      })
    ).resolves.toEqual({ status: 'discarded', reason: 'cancelled' })

    expect(mocks.validateBpmn).not.toHaveBeenCalled()
    expect(screen.queryByText(/pre-aborted-placement\.bpmn/)).toBeNull()
  })

  it('guards the virtual open when cancellation arrives during validation', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    const props = latestAiPanelProps()
    const controller = new AbortController()
    let resolveValidation!: (value: { summary: { valid: true; issues: never[] } }) => void
    mocks.validateBpmn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveValidation = resolve
        })
    )

    const pending = props.onPlaceGenerated(state.xml, {
      name: 'Cancelled virtual',
      targetFolder: '',
      gen: props.getWorkspaceGen?.(),
      localizationSource: 'ai',
      signal: controller.signal
    })
    await waitFor(() => expect(mocks.validateBpmn).toHaveBeenCalledOnce())
    controller.abort()
    resolveValidation({ summary: { valid: true, issues: [] } })

    await expect(pending).resolves.toEqual({ status: 'discarded', reason: 'cancelled' })
    expect(screen.queryByText(/cancelled-virtual\.bpmn/)).toBeNull()
  })

  it('sets up one session controller, routes save to only the active tab, and guards dirty unloads', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    const controller = latestSessionController()
    expect(controller.store.list()).toHaveLength(1)
    expect(controller.store.getActive()?.dirty).toBe(true)
    expect(
      screen.getByRole('tab', {
        name: /untitled\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
    await waitFor(() =>
      expect(
        [...sessionHarness.drafts.values()].some(
          (draft) =>
            draft.path === 'untitled.bpmn' && draft.xml === controller.store.getActive()?.currentXml
        )
      ).toBe(true)
    )
    const firstEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onCommandsReady(commands: { save(): void }): void
    }
    const firstSave = vi.fn()
    act(() => firstEditor.onCommandsReady({ save: firstSave }))

    const dirtyExit = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyExit)
    expect(dirtyExit.defaultPrevented).toBe(true)

    await user.click(screen.getByRole('button', { name: 'mock-editor-clean' }))
    const stillDirtyExit = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(stillDirtyExit)
    expect(stillDirtyExit.defaultPrevented).toBe(true)

    await user.click(screen.getByRole('button', { name: 'sidebar.toggle.aria' }))
    await user.click(screen.getByRole('button', { name: 'mock-ai-place' }))
    await screen.findByText(/ai-claims\.bpmn/)
    expect(controller.store.list()).toHaveLength(2)
    const secondEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onCommandsReady(commands: { save(): void }): void
    }
    const secondSave = vi.fn()
    act(() => secondEditor.onCommandsReady({ save: secondSave }))

    const activeSave = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true
    })
    window.dispatchEvent(activeSave)
    expect(activeSave.defaultPrevented).toBe(true)
    expect(secondSave).toHaveBeenCalledOnce()
    expect(firstSave).not.toHaveBeenCalled()

    await user.click(screen.getAllByText('untitled.bpmn')[0]!)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    )
    expect(firstSave).toHaveBeenCalledOnce()
    expect(secondSave).toHaveBeenCalledOnce()
  })

  it('does not route navigation or save shortcuts behind a modal review', async () => {
    configureTranslationModel()
    const user = userEvent.setup()
    await openBlankDiagram(user)
    const rail = screen.getByRole('button', { name: 'sidebar.toggle.aria' })
    if (rail.getAttribute('aria-expanded') === 'false') await user.click(rail)
    await user.click(screen.getByRole('button', { name: 'mock-ai-place' }))
    await screen.findByText(/ai-claims\.bpmn/)
    await user.click(
      screen.getByRole('tab', {
        name: /untitled\.bpmn/
      })
    )
    await user.click(screen.getByRole('button', { name: 'mock-editor-commands' }))
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    const controller = latestSessionController()
    const activeBefore = controller.store.getActive()?.id

    fireEvent.keyDown(window, { altKey: true, key: 'ArrowLeft' })
    fireEvent.keyDown(window, { altKey: true, key: 'ArrowRight' })
    const save = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true
    })
    window.dispatchEvent(save)

    expect(controller.store.getActive()?.id).toBe(activeBefore)
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()
    expect(save.defaultPrevented).toBe(true)
    expect(mocks.commandSave).not.toHaveBeenCalled()
  })

  it('retains a recovery draft and dirty state when a virtual document is downloaded', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'sidebar.toggle.aria' }))
    await user.click(screen.getByRole('button', { name: 'mock-ai-place' }))
    await screen.findByText(/ai-claims\.bpmn/)

    const activeEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    let outcome: void | { durable: boolean }
    await act(async () => {
      outcome = await activeEditor.onRequestSave(state.xml)
    })

    expect(outcome!).toEqual({ durable: false })
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'ai-claims.bpmn',
      expect.stringContaining('data:application/xml')
    )
    expect(
      screen.getByRole('tab', {
        name: /ai-claims\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
    expect([...sessionHarness.drafts.values()].some((draft) => draft.xml === state.xml)).toBe(true)
    expect(latestSessionController().store.getActive()?.dirty).toBe(true)
  })

  it('reviews a persisted draft side by side, downloads it, and restores it explicitly', async () => {
    const user = userEvent.setup()
    const draft = seedUntitledDraft(state.xml)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'picker.fallback.newDiagram' }))

    const dialog = await screen.findByRole('dialog', { name: 'draftRecovery.title' })
    expect(within(dialog).getByText('draftRecovery.saved')).not.toBeNull()
    expect(within(dialog).getByText('draftRecovery.draft')).not.toBeNull()
    expect(dialog.querySelectorAll('pre')[1]?.textContent).toBe(state.xml)
    const restore = within(dialog).getByRole('button', { name: 'draftRecovery.restore' })
    expect(document.activeElement).toBe(restore)

    await user.click(within(dialog).getByRole('button', { name: 'draftRecovery.download' }))
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'untitled-recovery-draft.bpmn',
      expect.stringContaining('data:application/xml')
    )
    expect(sessionHarness.drafts.has(draft.id)).toBe(true)

    await user.click(restore)
    expect(await screen.findByTestId('editor-tab')).not.toBeNull()
    expect(screen.getByTestId('editor-xml').textContent).toBe(state.xml)
    expect(
      screen.getByRole('tab', {
        name: /untitled\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
    expect(sessionHarness.drafts.has(draft.id)).toBe(true)
  })

  it('keeps the saved file and deletes a recovery draft only after explicit discard', async () => {
    const user = userEvent.setup()
    const draft = seedUntitledDraft(state.xml)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'picker.fallback.newDiagram' }))

    const dialog = await screen.findByRole('dialog', { name: 'draftRecovery.title' })
    expect(sessionHarness.drafts.has(draft.id)).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'draftRecovery.discard' }))

    expect(await screen.findByTestId('editor-tab')).not.toBeNull()
    expect(screen.getByTestId('editor-xml').textContent).not.toBe(state.xml)
    await waitFor(() => {
      const replacement = sessionHarness.drafts.get(draft.id)
      expect(replacement?.xml).toBe(latestSessionController().store.getActive()?.currentXml)
      expect(replacement?.xml).not.toBe(state.xml)
    })
  })

  it('wires modeler lifecycle, details, called-process feedback, printing, and automation', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    await user.click(screen.getByRole('button', { name: 'mock-editor-commands' }))
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    expect(mocks.installLinkBadges).toHaveBeenCalledOnce()
    expect(
      (window as Window & { __ORBITPM_LITE__?: { modeler?: unknown } }).__ORBITPM_LITE__?.modeler
    ).toBe(mockModeler)

    await user.click(screen.getByRole('button', { name: 'mock-editor-open-called' }))
    expect(await screen.findByText('alert.noProcessWithId')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'mock-editor-details' }))
    expect(await screen.findByRole('dialog', { name: 'mock-step-details' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'mock-details-cancel' }))
    await user.click(screen.getByRole('button', { name: 'mock-details-card' }))
    await user.click(screen.getByRole('button', { name: 'mock-details-cancel' }))

    await user.click(screen.getByRole('button', { name: 'mock-print' }))
    expect(await screen.findByTestId('print-view')).not.toBeNull()
    expect(mocks.saveSvg).toHaveBeenCalledOnce()
    fireEvent(window, new Event('afterprint'))
    await waitFor(() => expect(screen.queryByTestId('print-view')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'mock-editor-unready' }))
    await waitFor(() =>
      expect(
        (window as Window & { __ORBITPM_LITE__?: { modeler?: unknown } }).__ORBITPM_LITE__?.modeler
      ).toBeNull()
    )
  })

  it('closes step details when a late placement activates another tab', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'mock-editor-details' }))
    expect(screen.getByRole('dialog', { name: 'mock-step-details' })).not.toBeNull()

    act(() => {
      latestAiPanelProps().spreadsheet.onOpenSingle(state.xml, 'details-superseder.bpmn')
    })

    await screen.findByText(/details-superseder\.bpmn/)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'mock-step-details' })).toBeNull()
    )
  })

  it('does not commit a print job after its tab closes during SVG serialization', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))

    let resolveSvg!: (value: { svg: string }) => void
    mocks.saveSvg.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSvg = resolve
        })
    )
    await user.click(screen.getByRole('button', { name: 'mock-print' }))
    await waitFor(() => expect(mocks.saveSvg).toHaveBeenCalledOnce())

    await user.click(screen.getByTitle('tab.closeTitle'))
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'confirm.discardUnsaved.title' })).getByRole(
        'button',
        { name: 'confirm.discardUnsaved.confirm' }
      )
    )
    expect(await screen.findByText('emptyTab.fallback')).not.toBeNull()
    await act(async () => {
      resolveSvg({ svg: '<svg data-stale="true" />' })
      await Promise.resolve()
    })

    expect(screen.queryByTestId('print-view')).toBeNull()
    expect(window.print).not.toHaveBeenCalled()
  })

  it('aborts interview replacement before import when its reviewed request is cancelled', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    installMockEditorXmlTransactionCommands()

    let resolveXml!: (value: { xml: string }) => void
    mocks.saveXml.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveXml = resolve
        })
    )
    const sessionId = latestSessionController().store.getActive()?.id
    if (!sessionId) throw new Error('missing active test session')
    const controller = new AbortController()
    const apply = latestAssistantDrawerProps().onApplyXml?.(sessionId, state.xml, {
      signal: controller.signal,
      requestToken: 41
    })
    if (!apply) throw new Error('missing interview Apply callback')
    await act(async () => {
      await Promise.resolve()
    })
    controller.abort()
    resolveXml({ xml: state.xml })

    await expect(apply).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.importXml).not.toHaveBeenCalled()
  })

  it('rolls back a superseded interview transaction before the newer request imports', async () => {
    const user = userEvent.setup()
    const rootElement = {
      id: 'Process_Test',
      businessObject: {
        get: (name: string) => (name === 'orbitpm:activeLang' ? 'en' : undefined)
      }
    }
    mocks.modelerGet.mockImplementation((name: string) => {
      if (name === 'eventBus') return { on: vi.fn(), off: vi.fn() }
      if (name === 'canvas') {
        return {
          getRootElement: () => rootElement,
          zoom: vi.fn()
        }
      }
      if (name === 'modeling') return { updateProperties: vi.fn() }
      if (name === 'elementRegistry') return { getAll: () => [] }
      return {}
    })
    await openBlankDiagram(user)
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    installMockEditorXmlTransactionCommands()

    const firstXml = `${state.xml}\n<!-- superseded interview -->`
    const secondXml = `${state.xml}\n<!-- current interview -->`
    let liveXml = state.xml
    mocks.saveXml.mockImplementation(async () => ({ xml: liveXml }))
    const firstImportStarted = deferred()
    const releaseFirstImport = deferred()
    let firstImport = true
    mocks.importXml.mockImplementation(async (candidate: string) => {
      liveXml = candidate
      if (candidate === firstXml && firstImport) {
        firstImport = false
        firstImportStarted.resolve()
        await releaseFirstImport.promise
      }
      return { warnings: [] }
    })

    const sessionId = latestSessionController().store.getActive()?.id
    const applyInterview = latestAssistantDrawerProps().onApplyXml
    if (!sessionId || !applyInterview) throw new Error('missing interview Apply callback')
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstApply = Promise.resolve(
      applyInterview(sessionId, firstXml, {
        signal: firstController.signal,
        requestToken: 51
      })
    )
    const firstOutcome = firstApply.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    )
    await firstImportStarted.promise

    const secondApply = applyInterview(sessionId, secondXml, {
      signal: secondController.signal,
      requestToken: 52
    })
    releaseFirstImport.resolve()
    await act(async () => {
      await secondApply
    })
    const result = await firstOutcome

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({ name: 'AbortError' })
    })
    expect(mocks.importXml.mock.calls.map(([candidate]) => candidate)).toEqual([
      firstXml,
      state.xml,
      secondXml
    ])
    expect(liveXml).toBe(secondXml)
    expect(latestSessionController().store.get(sessionId)).toMatchObject({
      currentXml: secondXml,
      dirty: true
    })
    expect(
      screen.getByRole('tab', {
        name: /tab\.dirty\.aria/
      })
    ).not.toBeNull()
  })

  it('restores a clean editor state when interview validation is cancelled after autosize', async () => {
    const user = userEvent.setup()
    const editorDirty = {
      change: undefined as ((dirty: boolean) => void) | undefined
    }
    const rootElement = {
      id: 'Process_Test',
      businessObject: {
        get: (name: string) => (name === 'orbitpm:activeLang' ? 'en' : undefined)
      }
    }
    mocks.modelerGet.mockImplementation((name: string) => {
      if (name === 'eventBus') return { on: vi.fn(), off: vi.fn() }
      if (name === 'canvas') {
        return {
          getRootElement: () => rootElement,
          zoom: vi.fn()
        }
      }
      if (name === 'modeling') {
        return {
          updateProperties: () => editorDirty.change?.(true)
        }
      }
      if (name === 'elementRegistry') return { getAll: () => [] }
      return {}
    })
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
    }
    editorDirty.change = editor.onDirtyChange
    installMockEditorXmlTransactionCommands({
      restoreDirtyState: () => editor.onDirtyChange(false)
    })

    const replacementXml = `${state.xml}\n<!-- cancelled after autosize -->`
    let liveXml = state.xml
    let saveCount = 0
    const finalSaveStarted = deferred()
    const releaseFinalSave = deferred()
    mocks.saveXml.mockImplementation(async () => {
      saveCount += 1
      if (saveCount === 4) {
        finalSaveStarted.resolve()
        await releaseFinalSave.promise
      }
      return { xml: liveXml }
    })
    mocks.importXml.mockImplementation(async (candidate: string) => {
      liveXml = candidate
      return { warnings: [] }
    })

    const session = latestSessionController().store.getActive()
    const applyInterview = latestAssistantDrawerProps().onApplyXml
    if (!session || !applyInterview) throw new Error('missing interview Apply callback')
    const request = new AbortController()
    const apply = Promise.resolve(
      applyInterview(session.id, replacementXml, {
        signal: request.signal,
        requestToken: 61
      })
    )
    await finalSaveStarted.promise
    request.abort()
    releaseFinalSave.resolve()

    await expect(apply).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.autoSizeAll).toHaveBeenCalled()
    expect(mocks.importXml.mock.calls.map(([candidate]) => candidate)).toEqual([
      replacementXml,
      state.xml
    ])
    expect(liveXml).toBe(state.xml)
    expect(latestSessionController().store.get(session.id)).toMatchObject({
      currentXml: state.xml,
      lastSavedXml: state.xml,
      dirty: false
    })
    expect(
      screen.queryByRole('tab', {
        name: /tab\.dirty\.aria/
      })
    ).toBeNull()
  })

  it('opens an uploaded BPMN file from the landing input and reports invalid input', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('button', { name: 'picker.fallback.openFile' })
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
    const file = new File([state.xml], 'uploaded.bpmn', { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(state.xml)
    })
    fireEvent.change(input, { target: { files: [file] } })
    expect((await screen.findAllByText('uploaded.bpmn')).length).toBeGreaterThan(0)

    cleanup()
    mocks.validateBpmn.mockRejectedValueOnce(new Error('invalid BPMN'))
    const second = render(<App />)
    await screen.findByRole('button', { name: 'picker.fallback.openFile' })
    const badInput = second.container.querySelector('input[type="file"]')
    if (!(badInput instanceof HTMLInputElement)) throw new Error('missing second file input')
    const bad = new File(['bad'], 'bad.bpmn', { type: 'application/xml' })
    Object.defineProperty(bad, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer('bad')
    })
    fireEvent.change(badInput, { target: { files: [bad] } })
    expect(await screen.findByText('alert.open.failed')).not.toBeNull()
    expect(user).toBeDefined()
  })

  it('renders a missing-DI candidate read-only and keeps acceptance gated until it is ready', async () => {
    const user = userEvent.setup()
    const sourceXml = withoutDiagramInterchange(state.xml)
    configureMissingDiValidation(sourceXml)
    const { container } = render(<App />)
    await screen.findByRole('button', { name: 'picker.fallback.openFile' })
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
    const file = new File([sourceXml], 'missing-layout.bpmn', {
      type: 'application/xml'
    })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(sourceXml)
    })

    fireEvent.change(input, { target: { files: [file] } })

    const dialog = await screen.findByRole('dialog', {
      name: 'sourceEditor.layoutReady'
    })
    const scrollRegion = dialog.querySelector('[data-single-file-layout-scroll-region]')
    expect(scrollRegion).not.toBeNull()
    expect(scrollRegion?.parentElement).toBe(dialog)
    expect(scrollRegion?.previousElementSibling?.classList).toContain('orbitpm-validation__header')
    expect(scrollRegion?.nextElementSibling?.classList).toContain('orbitpm-validation__footer')
    const preview = mocks.diagramPreviewProps.mock.calls.at(-1)?.[0] as
      | {
          xml: string
          onStatusChange?(status: {
            status: 'loading' | 'ready' | 'error'
            warningCount?: number
            message?: string
          }): void
        }
      | undefined
    if (!preview) throw new Error('missing read-only layout preview')
    expect(preview.xml).not.toBe(sourceXml)
    expect(preview.xml).toContain('<bpmndi:BPMNDiagram')
    expect(screen.getByRole('img', { name: 'sourceEditor.layoutDiagramAria' })).not.toBeNull()
    const accept = within(dialog).getByRole('button', {
      name: 'sourceEditor.layoutAccept'
    }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    expect(sessionHarness.controllers).toHaveLength(0)
    expect(window.confirm).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'mock-layout-preview-ready' }))
    expect(accept.disabled).toBe(false)
    await user.click(accept)

    expect((await screen.findAllByText('missing-layout.bpmn')).length).toBeGreaterThan(0)
    const session = latestSessionController().store.get('missing-layout.bpmn')
    expect(session?.lastSavedXml).toBe(sourceXml)
    expect(session?.currentXml).toContain('<bpmndi:BPMNDiagram')
    expect(session?.dirty).toBe(true)
  })

  it('keeps missing-DI acceptance disabled on viewer error and cancels without mutation', async () => {
    const user = userEvent.setup()
    const sourceXml = withoutDiagramInterchange(state.xml)
    configureMissingDiValidation(sourceXml)
    const { container } = render(<App />)
    await screen.findByRole('button', { name: 'picker.fallback.openFile' })
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
    const file = new File([sourceXml], 'cancelled-layout.bpmn', {
      type: 'application/xml'
    })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(sourceXml)
    })
    fireEvent.change(input, { target: { files: [file] } })
    const dialog = await screen.findByRole('dialog', {
      name: 'sourceEditor.layoutReady'
    })
    const accept = within(dialog).getByRole('button', {
      name: 'sourceEditor.layoutAccept'
    }) as HTMLButtonElement

    await user.click(within(dialog).getByRole('button', { name: 'mock-layout-preview-error' }))
    expect(accept.disabled).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'modal.cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'sourceEditor.layoutReady' })).toBeNull()
    )
    expect(sessionHarness.controllers).toHaveLength(0)
    expect(screen.queryByText('cancelled-layout.bpmn')).toBeNull()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('aborts a stale missing-DI preview when a newer file activation supersedes it', async () => {
    const sourceXml = withoutDiagramInterchange(state.xml)
    configureMissingDiValidation(sourceXml)
    const { container } = render(<App />)
    await screen.findByRole('button', { name: 'picker.fallback.openFile' })
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
    const staleFile = new File([sourceXml], 'stale-layout.bpmn', {
      type: 'application/xml'
    })
    Object.defineProperty(staleFile, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(sourceXml)
    })
    fireEvent.change(input, { target: { files: [staleFile] } })
    await screen.findByRole('dialog', { name: 'sourceEditor.layoutReady' })
    const stalePreview = mocks.diagramPreviewProps.mock.calls.at(-1)?.[0] as
      | {
          onStatusChange?(status: {
            status: 'loading' | 'ready' | 'error'
            warningCount?: number
          }): void
        }
      | undefined
    if (!stalePreview) throw new Error('missing stale preview callback')

    const replacement = new File([state.xml], 'replacement-upload.bpmn', {
      type: 'application/xml'
    })
    Object.defineProperty(replacement, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(state.xml)
    })
    fireEvent.change(input, { target: { files: [replacement] } })

    expect((await screen.findAllByText('replacement-upload.bpmn')).length).toBeGreaterThan(0)
    act(() => stalePreview.onStatusChange?.({ status: 'ready', warningCount: 0 }))
    expect(screen.queryByRole('dialog', { name: 'sourceEditor.layoutReady' })).toBeNull()
    expect(latestSessionController().store.get('replacement-upload.bpmn')).toBeDefined()
    expect(latestSessionController().store.get('stale-layout.bpmn')).toBeUndefined()
  })

  it('keeps reviewed single-file localization dirty over the exact uploaded baseline', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('button', { name: 'picker.fallback.openFile' })
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
    const processId = 'Process_Single_File_Reviewed'
    const uploadedXml = withoutArabicMetadata(withProcessId(state.xml, processId))
    mocks.validateBpmn.mockImplementation(parsedValidationResultForXml)
    const file = new File([uploadedXml], 'reviewed-upload.bpmn', {
      type: 'application/xml'
    })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(uploadedXml)
    })

    fireEvent.change(input, { target: { files: [file] } })
    await completeReviewedXmlReview(user, ['عملية ملف', 'بداية ملف'])

    const session = await waitFor(() => {
      const current = latestSessionController().store.get('reviewed-upload.bpmn')
      expect(current).toBeDefined()
      return current!
    })
    expect(session.lastSavedXml).toBe(uploadedXml)
    expect(session.currentXml).not.toBe(uploadedXml)
    expect(session.currentXml).toContain('عملية ملف')
    expect(session.dirty).toBe(true)
    expect(screen.getByTestId('editor-xml').textContent).toBe(session.currentXml)
  })

  it('rejects an oversized single-file upload before allocating its bytes', async () => {
    const { container } = render(<App />)
    await screen.findByRole('button', { name: 'picker.fallback.openFile' })
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing file input')
    const file = new File(['small'], 'oversized.bpmn', { type: 'application/xml' })
    const arrayBuffer = vi.fn(async () => utf8Buffer('small'))
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: MAX_DROPPED_IMPORT_BYTES + 1
    })
    Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: arrayBuffer })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('alert.open.failed')).not.toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(screen.queryByTestId('editor-tab')).toBeNull()
  })
})

describe('App directory workspace orchestration', () => {
  it('surfaces warnings emitted before the manifest-bound adapter is committed', async () => {
    const user = userEvent.setup()
    state.emitInitialManifestWarning = true

    await openDirectoryWorkspace(user)

    expect(await screen.findByText('workspace.manifest.warning')).not.toBeNull()
    expect(mocks.manifestBindings).toHaveLength(1)
  })

  it('keeps active manifest callbacks live when a replacement workspace fails to bind', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    await openDirectoryWorkspace(user, first)
    const activeManifestBinding = manifestBindingAt(0)

    state.failNextManifestBind = true
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() => expect(mocks.manifestBindings).toHaveLength(2))

    act(() => {
      activeManifestBinding.onManifestError?.(new Error('post-commit manifest failure'))
    })

    expect(
      await screen.findByRole('dialog', { name: 'workspace.manifest.retryTitle' })
    ).not.toBeNull()
    expect(screen.getByTestId('catalog-view')).not.toBeNull()
  })

  it('opens a different directory with one picker call and keeps the current workspace when cancelled', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    const activeController = latestSessionController()
    const activeLocalizationAdapter = mocks.workspaceLocalizationFactories.mock.calls[0]?.[0]

    mocks.pickWorkspace.mockClear().mockResolvedValue(null)
    mocks.rememberWorkspace.mockClear()
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))

    await waitFor(() => expect(mocks.pickWorkspace).toHaveBeenCalledOnce())
    expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(1)
    expect(mocks.workspaceLocalizationFactories.mock.calls[0]?.[0]).toBe(activeLocalizationAdapter)
    expect(latestSessionController()).toBe(activeController)
    expect(mocks.rememberWorkspace).not.toHaveBeenCalled()
    expect(screen.getByTestId('catalog-view')).not.toBeNull()
    expect(screen.getByTestId('folder-tree')).not.toBeNull()

    await user.click(await screen.findByRole('button', { name: 'mock-tree-open' }))
    expect(await screen.findByTestId('editor-tab')).not.toBeNull()
    expect(latestSessionController().store.getActive()?.identity.workspace.id).toBe(
      (activeLocalizationAdapter as { id: string }).id
    )
  })

  it('lets the assistant invoke the picker without closing until a workspace commits', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-assistant-open' }))

    mocks.pickWorkspace.mockClear().mockResolvedValue(null)
    await user.click(screen.getByRole('button', { name: 'mock-assistant-change-workspace' }))
    await waitFor(() => expect(mocks.pickWorkspace).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'mock-assistant-close' })).not.toBeNull()

    const replacement = fakeRoot()
    replacement.addFile('replacement.bpmn', state.xml)
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(replacement))
    await user.click(screen.getByRole('button', { name: 'mock-assistant-change-workspace' }))

    await waitFor(() => expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'mock-assistant-open' })).not.toBeNull()
    )
    expect(screen.queryByRole('button', { name: 'mock-assistant-close' })).toBeNull()
  })

  it('lets the newest folder-picker intent win when an older picker resolves later', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    const older = new FakeDirectoryHandle('older-workspace')
    older.addFile('older.bpmn', state.xml)
    const newer = new FakeDirectoryHandle('newer-workspace')
    newer.addFile('newer.bpmn', state.xml)
    let resolveOlder!: (handle: FileSystemDirectoryHandle | null) => void
    let resolveNewer!: (handle: FileSystemDirectoryHandle | null) => void
    mocks.pickWorkspace
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlder = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewer = resolve
          })
      )

    const change = screen.getByRole('button', { name: 'app.changeFolder' })
    fireEvent.click(change)
    fireEvent.click(change)
    expect(mocks.pickWorkspace).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveNewer(asDirectoryHandle(newer))
    })
    await waitFor(() => expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2))
    const newerAdapter = mocks.workspaceLocalizationFactories.mock.calls.at(-1)?.[0] as {
      id: string
    }
    const controllerAfterNewer = latestSessionController()
    expect(controllerAfterNewer.store.getActive()?.identity.workspace.id).toBeUndefined()

    await act(async () => {
      resolveOlder(asDirectoryHandle(older))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestSessionController()).toBe(controllerAfterNewer)
    expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2)
    expect((mocks.workspaceLocalizationFactories.mock.calls.at(-1)?.[0] as { id: string }).id).toBe(
      newerAdapter.id
    )
    expect(screen.getByTestId('catalog-view')).not.toBeNull()
  })

  it('binds localization and document sessions to the persisted manifest UUID across reopen', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    const handle = asDirectoryHandle(root)
    state.directorySupport = true
    mocks.pickWorkspace.mockResolvedValue(handle)

    const firstRender = render(<App />)
    await user.click(
      await screen.findByRole('button', { name: 'workspace.storage.chooseDirectory' })
    )
    await waitFor(() => expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(1))
    const firstAdapter = mocks.workspaceLocalizationFactories.mock.calls[0]?.[0] as {
      id: string
    }
    expect(firstAdapter.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
    const persistedManifest = JSON.parse(fakeFileText(root, '.orbitpm/manifest.json')) as {
      workspace: { id: string }
    }
    expect(persistedManifest.workspace.id).toBe(firstAdapter.id)

    await user.click(await screen.findByRole('button', { name: 'mock-tree-open' }))
    expect(await screen.findByTestId('editor-tab')).not.toBeNull()
    expect(latestSessionController().store.getActive()?.identity.workspace.id).toBe(firstAdapter.id)

    firstRender.unmount()
    mocks.pickWorkspace.mockResolvedValue(handle)
    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: 'workspace.storage.chooseDirectory' })
    )
    await waitFor(() => expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2))
    const reopenedAdapter = mocks.workspaceLocalizationFactories.mock.calls[1]?.[0] as {
      id: string
    }
    expect(reopenedAdapter.id).toBe(firstAdapter.id)

    await user.click(await screen.findByRole('button', { name: 'mock-tree-open' }))
    expect(await screen.findByTestId('editor-tab')).not.toBeNull()
    expect(latestSessionController().store.getActive()?.identity.workspace.id).toBe(firstAdapter.id)
  })

  it('uses creation-only history restore only for a confirmed missing destination', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    const revision = testHistoryRevision('Finance/deleted.bpmn')

    await act(async () => {
      await latestHistoryDialogProps().onRestore?.(revision)
    })

    expect(mocks.restoreHistoryRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        revision,
        expectedCurrentHash: null,
        signal: expect.any(AbortSignal),
        isWorkspaceCurrent: expect.any(Function),
        prepareXml: expect.any(Function),
        writePreparedXml: expect.any(Function)
      })
    )
  })

  it('fails history restore preflight on non-not-found storage errors', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    const adapter = mocks.workspaceLocalizationFactories.mock.calls.at(
      -1
    )?.[0] as import('./workspace/adapters').WorkspaceAdapter
    const failure = new WorkspaceOperationError({
      code: 'permission-loss',
      operation: 'read',
      path: 'Finance/existing.bpmn',
      message: 'permission denied'
    })
    vi.spyOn(adapter, 'read').mockRejectedValueOnce(failure)
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')

    let result: import('./sessions').RestoreHistoryRevisionResult | undefined
    await act(async () => {
      result = await latestHistoryDialogProps().onRestore?.(
        testHistoryRevision('Finance/existing.bpmn')
      )
    })

    expect(result).toEqual({ status: 'failed', sessionId: null, error: failure })
    expect(mocks.restoreHistoryRevision).not.toHaveBeenCalled()
  })

  it('aborts an old history restore-as-copy before it can write during a workspace switch', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    await openDirectoryWorkspace(user, first)
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    const historyProps = latestHistoryDialogProps()
    const revision = await historyProps.manager.createRevision('Finance/existing.bpmn', {
      reason: 'manual'
    })
    const originalPreview = historyProps.manager.preview.bind(historyProps.manager)
    const previewStarted = deferred()
    const releasePreview = deferred()
    vi.spyOn(historyProps.manager, 'preview').mockImplementationOnce(async (candidate) => {
      previewStarted.resolve()
      await releasePreview.promise
      return originalPreview(candidate)
    })
    const dialogController = new AbortController()
    const pending = historyProps.onRestoreCopy!(
      revision,
      'Finance/old-workspace-copy.bpmn',
      dialogController.signal
    )
    await previewStarted.promise

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() => expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2))
    releasePreview.resolve()

    await expect(pending).resolves.toMatchObject({ ok: false, status: 'cancelled' })
    expect(() => first.file('Finance/old-workspace-copy.bpmn')).toThrow(/Missing fake file/u)
    expect(() => second.file('Finance/old-workspace-copy.bpmn')).toThrow(/Missing fake/u)
  })

  it('preserves a committed history copy success across a switch and gates stale reconciliation', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    await openDirectoryWorkspace(user, first)
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    const historyProps = latestHistoryDialogProps()
    const revision = await historyProps.manager.createRevision('Finance/existing.bpmn', {
      reason: 'manual'
    })
    const adapter = latestWorkspaceLocalizationAdapter()
    const originalWriteAtomic = adapter.writeAtomic.bind(adapter)
    const copyCommitted = deferred()
    const releaseOutcome = deferred()
    vi.spyOn(adapter, 'writeAtomic').mockImplementation(
      async (path, bytes, expectedHash, options) => {
        const outcome = await originalWriteAtomic(path, bytes, expectedHash, options)
        if (path === 'Finance/committed-history-copy.bpmn' && outcome.status === 'success') {
          copyCommitted.resolve()
          await releaseOutcome.promise
        }
        return outcome
      }
    )
    const pending = historyProps.onRestoreCopy!(
      revision,
      'Finance/committed-history-copy.bpmn',
      new AbortController().signal
    )
    await copyCommitted.promise
    expect(fakeFileText(first, 'Finance/committed-history-copy.bpmn')).toBe(state.xml)

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() => expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2))
    releaseOutcome.resolve()

    await expect(pending).resolves.toMatchObject({
      ok: true,
      status: 'success',
      snapshot: { path: 'Finance/committed-history-copy.bpmn' }
    })
    expect(() => second.file('Finance/committed-history-copy.bpmn')).toThrow(/Missing fake/u)

    const currentAdapter = latestWorkspaceLocalizationAdapter()
    const currentList = vi.spyOn(currentAdapter, 'list')
    await expect(historyProps.onChanged()).resolves.toBeUndefined()
    expect(currentList).not.toHaveBeenCalled()
  })

  it('leaves the destination missing when an English-only history copy review is cancelled', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    const sourcePath = 'Finance/existing.bpmn'
    const destinationPath = 'Finance/cancelled-reviewed-history-copy.bpmn'
    const processId = 'Process_History_Copy_Cancel'
    const legacyXml = withoutArabicMetadata(withProcessId(state.xml, processId))
    replaceFakeFile(root, sourcePath, legacyXml)
    await openDirectoryWorkspace(user, root)
    mocks.validateBpmn.mockImplementation(parsedValidationResultForXml)
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    const historyProps = latestHistoryDialogProps()
    const revision = await historyProps.manager.createRevision(sourcePath, {
      reason: 'manual'
    })

    const pending = historyProps.onRestoreCopy!(
      revision,
      destinationPath,
      new AbortController().signal
    )
    const review = await screen.findByRole('dialog', { name: 'reviewedXmlReview.title' })
    await user.click(
      within(review).getByRole('button', {
        name: 'reviewedXmlReview.cancel'
      })
    )

    await expect(pending).resolves.toMatchObject({ ok: false, status: 'cancelled' })
    expect(() => root.file(destinationPath)).toThrow(/Missing fake file/u)
  })

  it('creation-only CAS-writes and postvalidates the exact reviewed English-only history copy', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    const sourcePath = 'Finance/existing.bpmn'
    const destinationPath = 'Finance/reviewed-history-copy.bpmn'
    const processId = 'Process_History_Copy_Accept'
    const legacyXml = withoutArabicMetadata(withProcessId(state.xml, processId))
    replaceFakeFile(root, sourcePath, legacyXml)
    await openDirectoryWorkspace(user, root)
    mocks.validateBpmn.mockImplementation(parsedValidationResultForXml)
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    const historyProps = latestHistoryDialogProps()
    const revision = await historyProps.manager.createRevision(sourcePath, {
      reason: 'manual'
    })
    const adapter = latestWorkspaceLocalizationAdapter()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')

    const pending = historyProps.onRestoreCopy!(
      revision,
      destinationPath,
      new AbortController().signal
    )
    await completeReviewedXmlReview(user, ['عملية نسخة السجل', 'بداية نسخة السجل'])
    const outcome = await pending

    expect(outcome).toMatchObject({
      ok: true,
      status: 'success',
      created: true,
      snapshot: { path: destinationPath }
    })
    if (outcome.status !== 'success') throw new Error('history copy did not succeed')
    const destinationWrite = writeAtomic.mock.calls.find(([path]) => path === destinationPath)
    expect(destinationWrite).toBeDefined()
    const reviewedBytes = destinationWrite?.[1]
    expect(reviewedBytes?.byteLength).toBeGreaterThan(0)
    if (!reviewedBytes) throw new Error('reviewed history bytes were not written')
    expect(destinationWrite?.[2]).toBeUndefined()
    expect(destinationWrite?.[3]).toMatchObject({
      expectedWorkspaceId: adapter.id,
      expectedMissing: true
    })
    expect(outcome.snapshot.hash).toBe(await sha256Hex(reviewedBytes))
    expect(Array.from(outcome.snapshot.bytes)).toEqual(Array.from(reviewedBytes))
    expect(fakeFileText(root, destinationPath)).toBe(new TextDecoder().decode(reviewedBytes))
    expect(fakeFileText(root, destinationPath)).toContain('عملية نسخة السجل')
    expect(fakeFileText(root, destinationPath)).not.toBe(legacyXml)
  })

  it('blocks extension-destructive saves with an Arabic summary and labeled evidence', async () => {
    state.lang = 'ar'
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const issueCode = 'preservation.extension-element-changed'
    mocks.validatePreservation.mockResolvedValueOnce({
      valid: false,
      issues: [
        {
          source: 'preservation',
          code: issueCode,
          severity: 'error',
          blocking: true,
          message: 'native preservation detail sentinel'
        }
      ]
    })
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    const candidateXml = `${state.xml}\n<!-- extension-destructive candidate -->`
    let result!: { ok: true } | { ok: false; error: unknown }
    await act(async () => {
      result = await editor.onRequestSave(candidateXml).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      )
    })

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: ar['session.save.preservationBlocked']
      })
    })
    expect((result as { ok: false; error: Error }).error.message).not.toContain(issueCode)
    await waitFor(() => {
      const evidence = screen.getByTitle(new RegExp(issueCode, 'u'))
      expect(evidence.getAttribute('title')).toContain(
        ar['session.save.preservationTechnicalEvidence'].split('{codes}')[0]
      )
    })
  })

  it('reports a storage failure in Arabic while retaining backend detail as technical evidence', async () => {
    state.lang = 'ar'
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const backendDetail = 'native quota failure sentinel'
    vi.spyOn(controller, 'save').mockResolvedValueOnce({
      status: 'storage-failure',
      ok: false,
      sessionId: session.id,
      failure: {
        code: 'quota-exceeded',
        message: backendDetail,
        retriable: true,
        cause: new DOMException(backendDetail, 'QuotaExceededError')
      }
    })
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    let result!: { ok: true } | { ok: false; error: unknown }
    await act(async () => {
      result = await editor.onRequestSave(`${state.xml}\n<!-- storage failure candidate -->`).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      )
    })

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: ar['session.save.storageFailure']
      })
    })
    expect((result as { ok: false; error: Error }).error.message).not.toContain(backendDetail)
    await waitFor(() => {
      const evidence = screen.getByTitle(new RegExp(backendDetail, 'u'))
      expect(evidence.getAttribute('title')).toContain(
        ar['session.save.storageTechnicalEvidence'].split('{code}')[0]
      )
    })
  })

  it('clears the matching recovery draft after a fully synchronized history restore', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const session = latestSessionController().store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const draft = seedDraft(session.identity.workspace.id, session.identity.path, state.xml)
    const revision = testHistoryRevision(session.identity.path)
    mocks.restoreHistoryRevision.mockResolvedValueOnce({
      status: 'restored',
      sessionId: session.id,
      outcome: successfulWorkspaceSave(session.identity.path, state.xml)
    })

    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    await act(async () => {
      await latestHistoryDialogProps().onRestore?.(revision)
    })

    await waitFor(() => expect(sessionHarness.drafts.has(draft.id)).toBe(false))
    expect(latestSessionController().store.get(session.id)?.dirty).toBe(false)
  })

  it('returns an Arabic error when the open editor changes before history XML is applied', async () => {
    state.lang = 'ar'
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const restoredXml = `${state.xml}\n<!-- restored history revision -->`
    const outcome = successfulWorkspaceSave(session.identity.path, restoredXml)
    mocks.restoreHistoryRevision.mockImplementationOnce(
      async (
        options: import('./sessions').RestoreHistoryRevisionOptions
      ): Promise<import('./sessions').RestoreHistoryRevisionResult> => {
        const captured = controller.store.get(session.id)
        if (!captured) throw new Error('history target disappeared')
        try {
          await options.applyXml?.(
            {
              ...captured,
              revision: captured.revision + 1
            },
            restoredXml
          )
        } catch (error) {
          return {
            status: 'storage-restored-session-refresh-failed',
            sessionId: session.id,
            outcome,
            error
          }
        }
        throw new Error('expected the stale history apply guard to reject')
      }
    )

    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    let result!: import('./sessions').RestoreHistoryRevisionResult
    await act(async () => {
      result = await latestHistoryDialogProps().onRestore!(
        testHistoryRevision(session.identity.path!)
      )
    })

    expect(result).toMatchObject({
      status: 'storage-restored-session-refresh-failed',
      sessionId: session.id,
      error: expect.objectContaining({
        message: ar['workspace.history.applyEditorChangedBefore']
      })
    })
    expect(ar['workspace.history.applyEditorChangedBefore']).not.toContain(
      'The open editor changed'
    )
    expect(mocks.localizedRuntimeTranslation).toHaveBeenCalledWith(
      'workspace.history.applyEditorChangedBefore',
      undefined
    )
  })

  it('keeps a coordinated history restore clean when live serialization reformats the XML', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const path = session.identity.path
    const restoredXml = `${state.xml}\n<!-- restored formatting baseline -->`
    const reformattedXml = restoredXml.replaceAll(/>\s+</gu, '><').trim()
    expect(reformattedXml).not.toBe(restoredXml)
    let liveXml = state.xml
    mocks.saveXml.mockImplementation(async () => ({ xml: liveXml }))
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: vi.fn(),
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async (xml) => {
          expect(xml).toBe(restoredXml)
          liveXml = reformattedXml
        }
      })
    })
    const outcome = successfulWorkspaceSave(path, restoredXml)
    const draft = seedDraft(
      session.identity.workspace.id,
      path,
      `${state.xml}\n<!-- obsolete before formatting restore -->`
    )
    mocks.restoreHistoryRevision.mockImplementationOnce(
      async (options: import('./sessions').RestoreHistoryRevisionOptions) => {
        const captured = controller.store.get(session.id)
        if (!captured) throw new Error('history target disappeared')
        await options.applyXml?.(captured, restoredXml)
        replaceFakeFile(root, path, restoredXml)
        controller.store.replaceWithExternal(session.id, {
          xml: restoredXml,
          fingerprint: {
            hash: outcome.snapshot.hash,
            size: outcome.snapshot.size,
            modifiedAt: outcome.snapshot.modifiedAt
          }
        })
        return {
          status: 'restored',
          sessionId: session.id,
          outcome
        }
      }
    )
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')

    let result!: import('./sessions').RestoreHistoryRevisionResult
    await act(async () => {
      result = await latestHistoryDialogProps().onRestore!(
        testHistoryRevision(session.identity.path!)
      )
    })

    expect(result).toMatchObject({ status: 'restored', sessionId: session.id, outcome })
    expect(mocks.saveXml).toHaveBeenCalledOnce()
    expect(fakeFileText(root, path)).toBe(restoredXml)
    expect(controller.store.get(session.id)).toMatchObject({
      currentXml: restoredXml,
      lastSavedXml: restoredXml,
      dirty: false
    })
    expect(sessionHarness.drafts.has(draft.id)).toBe(false)
    expect(
      screen.queryByRole('tab', {
        name: /existing\.bpmn.*tab\.dirty\.aria/
      })
    ).toBeNull()
  })

  it('flushes a retained local draft when storage restores but editor refresh fails', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const localXml = `${state.xml}\n<!-- retained local edit -->`
    const outcome = successfulWorkspaceSave(session.identity.path, state.xml)
    mocks.restoreHistoryRevision.mockImplementationOnce(async () => {
      controller.store.replaceWithExternal(session.id, {
        xml: state.xml,
        fingerprint: {
          hash: outcome.snapshot.hash,
          size: outcome.snapshot.size,
          modifiedAt: outcome.snapshot.modifiedAt
        }
      })
      controller.updateXml(session.id, localXml)
      return {
        status: 'storage-restored-session-refresh-failed',
        sessionId: session.id,
        outcome,
        error: new Error('editor refresh failed')
      }
    })

    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    await act(async () => {
      await latestHistoryDialogProps().onRestore?.(testHistoryRevision(session.identity.path!))
    })

    await waitFor(() =>
      expect([...sessionHarness.drafts.values()].some((draft) => draft.xml === localXml)).toBe(true)
    )
    expect(controller.store.get(session.id)?.dirty).toBe(true)
    expect(
      screen.getByRole('tab', {
        name: /existing\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
  })

  it('re-journals a newer edit that arrives while history cleanup deletes the restored draft', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const path = session.identity.path
    const restoredXml = `${state.xml}\n<!-- restored history revision -->`
    const newerXml = `${state.xml}\n<!-- edit during history cleanup -->`
    const outcome = successfulWorkspaceSave(path, restoredXml)
    const draft = seedDraft(
      session.identity.workspace.id,
      path,
      `${state.xml}\n<!-- obsolete recovery draft -->`
    )
    let liveXml = state.xml
    mocks.saveXml.mockImplementation(async () => ({ xml: liveXml }))
    mocks.restoreHistoryRevision.mockImplementationOnce(async () => {
      replaceFakeFile(root, path, restoredXml)
      controller.store.replaceWithExternal(session.id, {
        xml: restoredXml,
        fingerprint: {
          hash: outcome.snapshot.hash,
          size: outcome.snapshot.size,
          modifiedAt: outcome.snapshot.modifiedAt
        }
      })
      liveXml = restoredXml
      return {
        status: 'restored',
        sessionId: session.id,
        outcome
      }
    })
    const deleteStarted = deferred()
    const releaseDelete = deferred()
    mocks.beforeDraftDelete.mockImplementationOnce(async () => {
      deleteStarted.resolve()
      await releaseDelete.promise
    })
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
    }
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    let restore!: Promise<import('./sessions').RestoreHistoryRevisionResult>
    act(() => {
      restore = latestHistoryDialogProps().onRestore!(testHistoryRevision(session.identity.path!))
    })
    await deleteStarted.promise

    liveXml = newerXml
    act(() => {
      controller.updateXml(session.id, newerXml)
      editor.onDirtyChange(true)
    })
    releaseDelete.resolve()
    let result!: import('./sessions').RestoreHistoryRevisionResult
    await act(async () => {
      result = await restore
    })

    expect(result).toMatchObject({
      status: 'storage-restored-session-refresh-failed',
      sessionId: session.id,
      outcome
    })
    expect(fakeFileText(root, path)).toBe(restoredXml)
    expect(controller.store.get(session.id)).toMatchObject({
      currentXml: newerXml,
      lastSavedXml: restoredXml,
      dirty: true
    })
    await waitFor(() => expect(sessionHarness.drafts.get(draft.id)?.xml).toBe(newerXml))
    expect(
      screen.getByRole('tab', {
        name: /existing\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
  })

  it('fails history restore before storage preflight when immediate dirty XML cannot be read', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const adapter = mocks.workspaceLocalizationFactories.mock.calls.at(
      -1
    )?.[0] as import('./workspace/adapters').WorkspaceAdapter
    const adapterRead = vi.spyOn(adapter, 'read')
    const readError = new Error('live editor serialization rejected')
    mocks.saveXml.mockRejectedValueOnce(readError)
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
    }
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')

    let result!: import('./sessions').RestoreHistoryRevisionResult
    await act(async () => {
      editor.onDirtyChange(true)
      result = await latestHistoryDialogProps().onRestore!(
        testHistoryRevision(session.identity.path!)
      )
    })

    expect(result).toMatchObject({
      status: 'failed',
      sessionId: session.id,
      error: expect.objectContaining({
        message: 'session.save.reloadEditorFailed'
      })
    })
    expect(mocks.saveXml).toHaveBeenCalledOnce()
    expect(adapterRead).not.toHaveBeenCalled()
    expect(mocks.restoreHistoryRevision).not.toHaveBeenCalled()
    expect(fakeFileText(root, session.identity.path)).toBe(state.xml)
    expect(
      screen.getByRole('tab', {
        name: /existing\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
  })

  it('requires a fresh decision when the history target changes during storage preflight', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const adapter = mocks.workspaceLocalizationFactories.mock.calls.at(
      -1
    )?.[0] as import('./workspace/adapters').WorkspaceAdapter
    const originalRead = adapter.read.bind(adapter)
    const readStarted = deferred()
    const releaseRead = deferred()
    const adapterRead = vi.spyOn(adapter, 'read').mockImplementationOnce(async (path) => {
      readStarted.resolve()
      await releaseRead.promise
      return originalRead(path)
    })
    const coreResult = {
      status: 'failed' as const,
      sessionId: null,
      error: new Error('history core sentinel')
    }
    mocks.restoreHistoryRevision.mockResolvedValueOnce(coreResult)
    const revision = testHistoryRevision(session.identity.path)
    await user.click(screen.getByRole('button', { name: 'workspace.storage.history' }))
    await screen.findByTestId('history-dialog')
    let restore!: Promise<import('./sessions').RestoreHistoryRevisionResult>
    act(() => {
      restore = latestHistoryDialogProps().onRestore!(revision)
    })
    await readStarted.promise

    act(() => {
      controller.updateXml(session.id, `${state.xml}\n<!-- edit during history preflight -->`)
    })
    releaseRead.resolve()

    const dirtyPrompt = await screen.findByRole('dialog', {
      name: 'workspace.path.dirtyTitle'
    })
    expect(adapterRead).toHaveBeenCalledOnce()
    expect(mocks.restoreHistoryRevision).not.toHaveBeenCalled()
    await user.click(
      within(dirtyPrompt).getByRole('button', {
        name: 'workspace.path.continueWithoutSaving'
      })
    )

    await expect(restore).resolves.toEqual(coreResult)
    expect(adapterRead).toHaveBeenCalledTimes(2)
    expect(mocks.restoreHistoryRevision).toHaveBeenCalledOnce()
    expect(mocks.restoreHistoryRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        revision,
        expectedCurrentHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
    )
  })

  it('re-prompts instead of overwriting when the reviewed external file changes again', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    const path = 'Finance/existing.bpmn'
    const firstExternal = `${state.xml}\n<!-- first external edit -->`
    const secondExternal = `${state.xml}\n<!-- second external edit -->`
    const localXml = `${state.xml}\n<!-- local edit -->`
    replaceFakeFile(root, path, firstExternal)

    let pending!: Promise<void | { durable: boolean }>
    act(() => {
      pending = editor.onRequestSave(localXml)
    })
    let dialog = await screen.findByRole('dialog', { name: 'session.conflict.title' })
    replaceFakeFile(root, path, secondExternal)
    await user.click(within(dialog).getByRole('button', { name: 'session.conflict.overwrite' }))

    dialog = await screen.findByRole('dialog', { name: 'session.conflict.title' })
    await user.click(within(dialog).getByRole('button', { name: 'session.conflict.compare' }))
    await waitFor(() => expect(dialog.textContent).toContain(secondExternal))
    expect(fakeFileText(root, path)).toBe(secondExternal)

    await user.click(within(dialog).getByRole('button', { name: 'session.conflict.overwrite' }))
    await act(async () => {
      await pending
    })
    expect(fakeFileText(root, path)).toBe(localXml)
  })

  it('keeps a newer edit dirty and journaled when it arrives after the save write commits', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const path = session.identity.path
    const submittedXml = `${state.xml}\n<!-- submitted durable save -->`
    const newestXml = `${state.xml}\n<!-- edit after durable write -->`
    let liveXml = submittedXml
    mocks.saveXml.mockImplementation(async () => ({ xml: liveXml }))
    const adapter = mocks.workspaceLocalizationFactories.mock.calls.at(
      -1
    )?.[0] as ManifestBoundWorkspaceAdapter
    const originalWriteAtomic = adapter.writeAtomic.bind(adapter)
    const writeCommitted = deferred()
    const releaseWriteOutcome = deferred()
    vi.spyOn(adapter, 'writeAtomic').mockImplementation(
      async (destination, bytes, expectedHash, options) => {
        const outcome = await originalWriteAtomic(destination, bytes, expectedHash, options)
        if (destination === path && outcome.status === 'success') {
          writeCommitted.resolve()
          await releaseWriteOutcome.promise
        }
        return outcome
      }
    )
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    let save!: Promise<
      { ok: true; value: void | { durable: boolean } } | { ok: false; error: unknown }
    >
    act(() => {
      save = editor.onRequestSave(submittedXml).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    })
    await writeCommitted.promise
    expect(fakeFileText(root, path)).toBe(submittedXml)

    liveXml = newestXml
    act(() => {
      controller.updateXml(session.id, newestXml)
      editor.onDirtyChange(true)
    })
    releaseWriteOutcome.resolve()
    const saveResult = await save

    expect(saveResult).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: 'session.save.newerEdits' })
    })
    expect(fakeFileText(root, path)).toBe(submittedXml)
    expect(controller.store.get(session.id)).toMatchObject({
      currentXml: newestXml,
      lastSavedXml: submittedXml,
      dirty: true
    })
    await waitFor(() =>
      expect(
        [...sessionHarness.drafts.values()].some(
          (draft) => draft.path === path && draft.xml === newestXml
        )
      ).toBe(true)
    )
    expect(
      screen.getByRole('tab', {
        name: /existing\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
    expect(mocks.importXml).not.toHaveBeenCalled()
  })

  it('keeps reviewed external reload changes dirty over the raw disk baseline', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))

    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const rawExternal = `${state.xml}\n<!-- raw external -->`
    const reviewedExternal = `${state.xml}\n<!-- reviewed external -->`
    const fingerprint = {
      hash: 'b'.repeat(64),
      size: new TextEncoder().encode(rawExternal).byteLength,
      modifiedAt: Date.UTC(2026, 0, 3)
    }
    vi.spyOn(controller, 'save').mockImplementationOnce(async () => {
      controller.store.replaceWithExternal(session.id, {
        xml: rawExternal,
        reviewedXml: reviewedExternal,
        fingerprint,
        identity: session.identity
      })
      return {
        status: 'reloaded',
        ok: true,
        sessionId: session.id,
        external: {
          identity: session.identity,
          xml: rawExternal,
          fingerprint
        }
      }
    })
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        exportPdf(): void
        applyExternalXml(xml: string, options?: { dirty?: boolean }): Promise<void>
      }): void
    }
    const localXml = `${state.xml}\n<!-- local -->`
    mocks.saveXml.mockResolvedValue({ xml: localXml })
    act(() => {
      editor.onCommandsReady({
        save: vi.fn(),
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        exportPdf: vi.fn(),
        applyExternalXml: async (xml) => {
          await mocks.importXml(xml)
          mocks.saveXml.mockResolvedValue({ xml })
        }
      })
    })

    await act(async () => {
      await editor.onRequestSave(localXml)
    })

    expect(mocks.importXml).toHaveBeenCalledWith(reviewedExternal)
    expect(controller.store.get(session.id)).toMatchObject({
      currentXml: reviewedExternal,
      lastSavedXml: rawExternal,
      dirty: true
    })
    expect(screen.getByTestId('editor-xml').textContent).toBe(reviewedExternal)
    expect(
      screen.getByRole('tab', {
        name: /existing\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
  })

  it('leaves an unserializable canvas untouched when save-conflict reload also fails', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))

    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session?.identity.path) throw new Error('expected an active persisted session')
    const submittedXml = `${state.xml}\n<!-- verified local before failed reload -->`
    const externalXml = `${state.xml}\n<!-- external durable file -->`
    const fingerprint = {
      hash: 'c'.repeat(64),
      size: new TextEncoder().encode(externalXml).byteLength,
      modifiedAt: Date.UTC(2026, 0, 4)
    }
    vi.spyOn(controller, 'save').mockImplementationOnce(async () => {
      controller.store.replaceWithExternal(session.id, {
        xml: externalXml,
        fingerprint,
        identity: session.identity
      })
      return {
        status: 'reloaded',
        ok: true,
        sessionId: session.id,
        external: {
          identity: session.identity,
          xml: externalXml,
          fingerprint
        }
      }
    })
    const applyExternalXml = vi.fn(async () => {
      throw new Error('external import failed after touching the canvas')
    })
    installMockEditorXmlTransactionCommands({ applyExternalXml })
    const liveReadFailure = new Error('canvas serialization unavailable')
    mocks.saveXml
      .mockResolvedValueOnce({ xml: submittedXml })
      .mockRejectedValueOnce(liveReadFailure)

    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    act(() => {
      editor.onDirtyChange(true)
    })
    let outcome: { ok: true } | { ok: false; error: unknown }
    await act(async () => {
      outcome = await editor.onRequestSave(submittedXml).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      )
    })

    expect(outcome!).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: 'session.save.reloadEditorFailed'
      })
    })
    expect(applyExternalXml).toHaveBeenCalledOnce()
    expect(mocks.saveXml).toHaveBeenCalledTimes(2)
    expect(mocks.importXml).not.toHaveBeenCalled()
    expect(controller.store.get(session.id)).toMatchObject({
      currentXml: submittedXml,
      lastSavedXml: externalXml,
      dirty: true
    })
    await waitFor(() =>
      expect(
        [...sessionHarness.drafts.values()].some(
          (draft) => draft.path === session.identity.path && draft.xml === submittedXml
        )
      ).toBe(true)
    )
    expect(
      screen.getByRole('tab', {
        name: /existing\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()
  })

  it('scopes Save As collision review and overwrite to the destination file', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    const sourcePath = 'Finance/existing.bpmn'
    const destinationPath = 'Finance/review-copy.bpmn'
    const destinationExternal = `${state.xml}\n<!-- destination owner -->`
    root.addFile(destinationPath, destinationExternal)
    await openDirectoryWorkspace(user, root)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onRequestSave(xml: string): Promise<void | { durable: boolean }>
    }
    const sourceExternal = `${state.xml}\n<!-- source owner -->`
    const localXml = `${state.xml}\n<!-- save-as local -->`
    replaceFakeFile(root, sourcePath, sourceExternal)

    let pending!: Promise<void | { durable: boolean }>
    act(() => {
      pending = editor.onRequestSave(localXml)
    })
    let dialog = await screen.findByRole('dialog', { name: 'session.conflict.title' })
    const destination = within(dialog).getByRole('textbox')
    await user.clear(destination)
    await user.type(destination, destinationPath)
    await user.click(within(dialog).getByRole('button', { name: 'session.conflict.saveAs' }))

    dialog = await screen.findByRole('dialog', { name: 'session.conflict.title' })
    expect(fakeFileText(root, destinationPath)).toBe(destinationExternal)
    await user.click(within(dialog).getByRole('button', { name: 'session.conflict.overwrite' }))
    await act(async () => {
      await pending
    })

    expect(fakeFileText(root, sourcePath)).toBe(sourceExternal)
    expect(fakeFileText(root, destinationPath)).toBe(localXml)
    expect(latestSessionController().store.getActive()?.identity.path).toBe(destinationPath)
  })

  it('creates folders, processes, and AI results without legacy raw-handle write helpers', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    const unrelatedRead = vi.spyOn(root.file('Finance/existing.bpmn'), 'getFile')
    unrelatedRead.mockClear()
    mocks.legacyCreateFolderAt.mockClear()
    mocks.legacyCreateBpmnFileUnique.mockClear()
    mocks.prompt.mockResolvedValueOnce('Archive').mockResolvedValueOnce('New approval')

    await user.click(screen.getByRole('button', { name: 'mock-tree-new-folder' }))
    await waitFor(() => expect(root.directory('Archive')).toBeDefined())
    expect(unrelatedRead).not.toHaveBeenCalled()
    unrelatedRead.mockRestore()

    await user.click(screen.getByRole('button', { name: 'mock-tree-new-process' }))
    await waitFor(() => expect(root.file('Finance/new-approval.bpmn')).toBeDefined())
    await screen.findByRole('tab', { name: 'new-approval.bpmn' })

    const rail = screen.getByRole('button', { name: 'sidebar.toggle.aria' })
    await waitFor(() => expect(rail.getAttribute('aria-expanded')).toBe('false'))
    await user.click(rail)
    await user.click(screen.getByRole('button', { name: 'mock-ai-place' }))
    await waitFor(() => expect(root.file('ai-claims.bpmn')).toBeDefined())

    expect(mocks.legacyCreateFolderAt).not.toHaveBeenCalled()
    expect(mocks.legacyCreateBpmnFileUnique).not.toHaveBeenCalled()
  })

  it('revalidates generated XML against the live process index immediately before writing', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    root.addFile('seed-process.bpmn', state.xml.replaceAll('Process_Test', 'Process_Seed'))
    await openDirectoryWorkspace(user, root)
    const props = latestAiPanelProps()
    const initialGeneration = props.getWorkspaceGen?.()
    const originalList = ManifestBoundWorkspaceAdapter.prototype.list
    let enteredList!: () => void
    const listEntered = new Promise<void>((resolve) => {
      enteredList = resolve
    })
    let releaseList!: () => void
    const listRelease = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    vi.spyOn(ManifestBoundWorkspaceAdapter.prototype, 'list').mockImplementationOnce(
      async function (this: ManifestBoundWorkspaceAdapter, path) {
        const entries = await originalList.call(this, path)
        enteredList()
        await listRelease
        return entries
      }
    )
    mocks.validateBpmn.mockClear()

    const pending = props.onPlaceGenerated(state.xml, {
      name: 'Live index check',
      targetFolder: '',
      gen: initialGeneration,
      localizationSource: 'ai',
      signal: new AbortController().signal
    })
    await listEntered
    expect([
      ...((
        mocks.validateBpmn.mock.calls[0]?.[1] as { knownProcessIds: Iterable<string> } | undefined
      )?.knownProcessIds ?? [])
    ]).not.toContain('Process_Test')

    root.addFile('late-process.bpmn', state.xml)
    await user.click(screen.getByRole('button', { name: 'tree.refresh.aria' }))
    await screen.findByText('toast.refreshed')
    releaseList()

    await expect(pending).resolves.toEqual({
      status: 'persisted',
      label: 'live-index-check.bpmn'
    })
    expect(mocks.validateBpmn).toHaveBeenCalledTimes(2)
    expect([
      ...((
        mocks.validateBpmn.mock.calls[1]?.[1] as { knownProcessIds: Iterable<string> } | undefined
      )?.knownProcessIds ?? [])
    ]).toContain('Process_Test')
  })

  it('honors cancellation after final validation starts but before the first mutation', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    const props = latestAiPanelProps()
    const controller = new AbortController()
    let resolveFinalValidation!: (value: { summary: { valid: true; issues: never[] } }) => void
    mocks.validateBpmn
      .mockClear()
      .mockResolvedValueOnce({ summary: { valid: true, issues: [] } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFinalValidation = resolve
          })
      )
    const write = vi.spyOn(ManifestBoundWorkspaceAdapter.prototype, 'writeAtomic')

    const pending = props.onPlaceGenerated(state.xml, {
      name: 'Cancelled before mutation',
      targetFolder: '',
      gen: props.getWorkspaceGen?.(),
      localizationSource: 'ai',
      signal: controller.signal
    })
    await waitFor(() => expect(mocks.validateBpmn).toHaveBeenCalledTimes(2))
    controller.abort()
    resolveFinalValidation({ summary: { valid: true, issues: [] } })

    await expect(pending).resolves.toEqual({ status: 'discarded', reason: 'cancelled' })
    expect(write).not.toHaveBeenCalled()
    expect(() => root.file('cancelled-before-mutation.bpmn')).toThrow(/Missing fake file/)
  })

  it('passes cancellation into the bound AI write and leaves no generated file', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    const props = latestAiPanelProps()
    const controller = new AbortController()
    let enteredWrite!: () => void
    const writeEntered = new Promise<void>((resolve) => {
      enteredWrite = resolve
    })
    let observedSignal: AbortSignal | undefined
    vi.spyOn(ManifestBoundWorkspaceAdapter.prototype, 'writeAtomic').mockImplementationOnce(
      async (path, _bytes, _expectedHash, options) => {
        observedSignal = options?.signal
        enteredWrite()
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            resolve()
            return
          }
          options?.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return {
          ok: false,
          status: 'cancelled',
          error: {
            code: 'cancelled',
            operation: 'write',
            path,
            message: 'cancelled in test'
          }
        }
      }
    )

    const pending = props.onPlaceGenerated(state.xml, {
      name: 'Cancelled placement',
      targetFolder: '',
      gen: props.getWorkspaceGen?.(),
      localizationSource: 'ai',
      signal: controller.signal
    })
    await writeEntered
    expect(observedSignal).toBe(controller.signal)
    controller.abort()

    await expect(pending).resolves.toEqual({ status: 'discarded', reason: 'cancelled' })
    expect(() => root.file('cancelled-placement.bpmn')).toThrow(/Missing fake file/)
  })

  it('discards an old-generation AI callback before validation or mutation', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    await openDirectoryWorkspace(user, first)
    const oldProps = latestAiPanelProps()
    const oldGeneration = oldProps.getWorkspaceGen?.()

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() => {
      expect(latestAiPanelProps().getWorkspaceGen?.()).not.toBe(oldGeneration)
    })
    mocks.validateBpmn.mockClear()

    let outcome: import('./ai/placementOutcome').GeneratedPlacementOutcome | undefined
    await act(async () => {
      outcome = await oldProps.onPlaceGenerated(state.xml, {
        name: 'Stale placement',
        targetFolder: '',
        gen: oldGeneration,
        localizationSource: 'ai',
        signal: new AbortController().signal
      })
    })

    expect(outcome).toEqual({ status: 'discarded', reason: 'stale-workspace' })
    expect(mocks.validateBpmn).not.toHaveBeenCalled()
    expect(() => first.file('stale-placement.bpmn')).toThrow(/Missing fake file/)
    expect(() => second.file('stale-placement.bpmn')).toThrow(/Missing fake file/)
  })

  it('reports a committed AI file as persisted but never opens it after activation switches', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    await openDirectoryWorkspace(user, first)
    const props = latestAiPanelProps()
    const generation = props.getWorkspaceGen?.()
    const originalWriteAtomic = ManifestBoundWorkspaceAdapter.prototype.writeAtomic
    let committed!: () => void
    const committedWrite = new Promise<void>((resolve) => {
      committed = resolve
    })
    let release!: () => void
    const releaseOutcome = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(ManifestBoundWorkspaceAdapter.prototype, 'writeAtomic').mockImplementation(
      async function (this: ManifestBoundWorkspaceAdapter, path, bytes, expectedHash, options) {
        const outcome = await originalWriteAtomic.call(this, path, bytes, expectedHash, options)
        if (path === 'committed-before-switch.bpmn' && outcome.status === 'success') {
          committed()
          await releaseOutcome
        }
        return outcome
      }
    )

    const pending = props.onPlaceGenerated(state.xml, {
      name: 'Committed before switch',
      targetFolder: '',
      gen: generation,
      localizationSource: 'ai',
      signal: new AbortController().signal
    })
    await committedWrite
    expect(fakeFileText(first, 'committed-before-switch.bpmn')).toBe(state.xml)

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() => {
      expect(latestAiPanelProps().getWorkspaceGen?.()).not.toBe(generation)
    })
    release()

    await expect(pending).resolves.toEqual({
      status: 'persisted',
      label: 'committed-before-switch.bpmn'
    })
    expect(() => second.file('committed-before-switch.bpmn')).toThrow(/Missing fake file/)
    expect(screen.queryByText(/committed-before-switch\.bpmn/)).toBeNull()
  })

  it('loads exact ordered resources and preserves CAS and accepted-only write boundaries', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    const glossary = [
      { en: 'API', ar: 'API', neutral: true },
      { en: 'Review request', ar: 'مراجعة الطلب' }
    ] as const
    const translationMemory = [
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        accepted: true as const,
        acceptedAt: '2026-07-26T01:00:00.000Z'
      }
    ]
    seedWorkspaceLocalization(root, glossary, translationMemory)
    await openDirectoryWorkspace(user, root)

    expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(1)
    const initial = latestSettingsLocalization()
    expect(initial.loadError).toBeNull()
    expect(initial.snapshot?.resources).toEqual({ glossary, translationMemory })
    expect(initial.snapshot?.resources.glossary).toBe(
      initial.snapshot?.files.glossary.document.entries
    )
    expect(initial.snapshot?.resources.translationMemory).toBe(
      initial.snapshot?.files.translationMemory.document.entries
    )

    const savedGlossary = [glossary[1], glossary[0], { en: 'Case code', ar: 'رمز الحالة' }] as const
    let savedState: Awaited<ReturnType<LocalizationResourcesEditorProps['onSaveGlossary']>>
    await act(async () => {
      savedState = await initial.onSaveGlossary(
        savedGlossary,
        initial.snapshot!.files.glossary.hash
      )
    })
    await waitFor(() => expect(latestSettingsLocalization().snapshot).toBe(savedState!))
    expect(JSON.parse(fakeFileText(root, WORKSPACE_GLOSSARY_PATH)).entries).toEqual(savedGlossary)

    const beforeRejectedMemory = fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)
    const beforeRejectedSnapshot = latestSettingsLocalization().snapshot
    await expect(
      latestSettingsLocalization().onSaveTranslationMemory(
        [
          {
            en: 'Unreviewed result',
            ar: 'نتيجة غير مراجعة',
            accepted: false
          } as never
        ],
        latestSettingsLocalization().snapshot!.files.translationMemory.hash
      )
    ).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    expect(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).toBe(beforeRejectedMemory)
    expect(latestSettingsLocalization().snapshot).toBe(beforeRejectedSnapshot)

    const stale = latestSettingsLocalization()
    const externalGlossary = [{ en: 'External term', ar: 'مصطلح خارجي' }]
    const glossaryFile = root.file(WORKSPACE_GLOSSARY_PATH)
    glossaryFile.bytes = new TextEncoder().encode(
      serializeWorkspaceGlossaryDocument(createWorkspaceGlossaryDocument(externalGlossary))
    )
    glossaryFile.lastModified += 1
    await expect(
      stale.onSaveGlossary(
        [{ en: 'Stale term', ar: 'مصطلح قديم' }],
        stale.snapshot!.files.glossary.hash
      )
    ).rejects.toBeInstanceOf(WorkspaceLocalizationConflictError)
    expect(latestSettingsLocalization().snapshot).toBe(stale.snapshot)

    let reloaded: Awaited<ReturnType<LocalizationResourcesEditorProps['onReload']>>
    await act(async () => {
      reloaded = await stale.onReload()
    })
    await waitFor(() => expect(latestSettingsLocalization().snapshot).toBe(reloaded!))
    expect(reloaded!.resources.glossary).toEqual(externalGlossary)
    expect(reloaded!.resources.translationMemory).toEqual(translationMemory)
  })

  it('persists a reviewed manual value and rejects a stale Settings replacement', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    await openDirectoryWorkspace(user, root)
    const staleSettings = latestSettingsLocalization()
    const staleMemoryHash = staleSettings.snapshot!.files.translationMemory.hash
    const store = latestWorkspaceLocalizationStore()
    const accept = vi.spyOn(store, 'acceptTranslationPairs')
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    const review = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(review.review)[0]
    if (!field || !review.onManualEdit) throw new Error('missing manual translation field')

    await act(async () => {
      await review.onManualEdit?.(field, 'مراجعة الطلب')
    })

    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(accept).not.toHaveBeenCalled()
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([])

    await applyCompletedTranslationReview()

    expect(model.batchExecutions()).toBe(1)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect(accept).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledWith(
      [{ en: 'Review request', ar: 'مراجعة الطلب' }],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([
      expect.objectContaining({
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true,
        acceptedAt: expect.any(String)
      })
    ])
    expect(latestWorkspaceLocalizationStore().current?.resources.translationMemory).toEqual([
      expect.objectContaining({ en: 'Review request', ar: 'مراجعة الطلب', accepted: true })
    ])

    await expect(staleSettings.onSaveTranslationMemory([], staleMemoryHash)).rejects.toBeInstanceOf(
      WorkspaceLocalizationConflictError
    )
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toHaveLength(
      1
    )
  })

  it('fails final Apply closed when glossary and memory hashes changed after review', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    await openDirectoryWorkspace(user, root)
    const store = latestWorkspaceLocalizationStore()
    const accept = vi.spyOn(store, 'acceptTranslationPairs')
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    const opened = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(opened.review)[0]
    if (!field || !opened.onManualEdit) throw new Error('missing manual translation field')
    await act(async () => {
      await opened.onManualEdit?.(field, 'مراجعة الطلب')
    })
    replaceFakeFile(
      root,
      WORKSPACE_GLOSSARY_PATH,
      serializeWorkspaceGlossaryDocument(
        createWorkspaceGlossaryDocument([{ en: 'External term', ar: 'مصطلح خارجي' }])
      )
    )
    replaceFakeFile(
      root,
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(
        createWorkspaceTranslationMemoryDocument([
          { en: 'External pair', ar: 'زوج خارجي', accepted: true }
        ])
      )
    )

    await applyCompletedTranslationReview()

    const refreshed = latestTranslationReviewProps()
    expect(refreshed.status).toBe('translationReview.stale')
    expect(refreshed.acceptedValues).toEqual([])
    expect(refreshed.proposals).toEqual([])
    expect(refreshed.review.localResources.glossary).toEqual([
      { en: 'External term', ar: 'مصطلح خارجي' }
    ])
    expect(refreshed.review.localResources.translationMemory).toEqual([
      expect.objectContaining({ en: 'External pair', ar: 'زوج خارجي', accepted: true })
    ])
    expect(model.batchExecutions()).toBe(0)
    expect(accept).not.toHaveBeenCalled()
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toHaveLength(
      1
    )
  })

  it.each([
    ['blank opposite language', ''],
    ['mixed-script opposite language', 'Review طلب']
  ])('does not cache a manual recovery with a %s', async (_caseName, sourceValue) => {
    const model = configureTranslationModel({ sourceValue })
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    await openDirectoryWorkspace(user, root)
    const accept = vi.spyOn(latestWorkspaceLocalizationStore(), 'acceptTranslationPairs')
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    const review = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(review.review)[0]
    if (!field || !review.onManualEdit) throw new Error('missing manual-only recovery field')

    await act(async () => {
      await review.onManualEdit?.(field, 'مراجعة الطلب')
    })

    expect(model.batchExecutions()).toBe(0)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    await applyCompletedTranslationReview()
    expect(model.batchExecutions()).toBe(1)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect(accept).not.toHaveBeenCalled()
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([])
    expect(screen.queryByRole('button', { name: 'translationReview.memoryRetry' })).toBeNull()
    expect(screen.queryByText(/translationReview\.memorySaveFailed/)).toBeNull()
  })

  it('single-flights double final Apply while its accepted pair is being saved', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    let transportSignal: AbortSignal | undefined
    mocks.makeFreeTranslateTexts.mockReturnValue(
      async (_texts: string[], _from: 'en' | 'ar', _to: 'en' | 'ar', signal?: AbortSignal) => {
        transportSignal = signal
        return ['مراجعة الطلب']
      }
    )
    await openDirectoryWorkspace(user, root)
    const store = latestWorkspaceLocalizationStore()
    const originalAccept = store.acceptTranslationPairs.bind(store)
    const saveStarted = deferred()
    const releaseSave = deferred()
    vi.spyOn(store, 'acceptTranslationPairs').mockImplementation(async (pairs, options) => {
      saveStarted.resolve()
      await releaseSave.promise
      return originalAccept(pairs, options)
    })
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable field')
    await act(async () => {
      await selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })
    const proposal = latestTranslationReviewProps().proposals?.[0]
    if (!proposal) throw new Error('missing reviewed provider proposal')
    await acceptTranslationProposal(proposal)
    const applyAction = latestTranslationReviewProps().onApplyCompleted
    if (!applyAction) throw new Error('missing completed translation apply action')
    let firstApply: Promise<void> | void
    let secondApply: Promise<void> | void
    act(() => {
      firstApply = applyAction()
      secondApply = applyAction()
    })
    await saveStarted.promise

    expect(model.batchExecutions()).toBe(1)
    expect(store.acceptTranslationPairs).toHaveBeenCalledOnce()
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect(latestTranslationReviewProps()).toMatchObject({
      busy: true,
      cancellable: false,
      status: 'translationReview.memorySaving',
      technicalDetail: null
    })
    expect(screen.queryByRole('button', { name: 'translationReview.cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'translationReview.translateNow' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'modal.close.aria' })).toBeNull()
    act(() => latestTranslationReviewProps().onCancelTranslation())
    expect(transportSignal?.aborted).toBe(false)

    releaseSave.resolve()
    await act(async () => {
      await Promise.all([firstApply, secondApply])
    })
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toHaveLength(
      1
    )
  })

  it('clears finalization on workspace activation and keeps a same-key retry cancellable', async () => {
    const firstModel = configureTranslationModel()
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = populatedDirectory()
    seedWorkspaceLocalization(first, [], [])
    seedWorkspaceLocalization(second, [], [])
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب'])
    await openDirectoryWorkspace(user, first)
    const firstStore = latestWorkspaceLocalizationStore()
    const originalAccept = firstStore.acceptTranslationPairs.bind(firstStore)
    const saveStarted = deferred()
    const releaseSave = deferred()
    vi.spyOn(firstStore, 'acceptTranslationPairs').mockImplementation(async (pairs, options) => {
      saveStarted.resolve()
      await releaseSave.promise
      return originalAccept(pairs, options)
    })
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing first workspace field')
    await act(async () => {
      await selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })
    const firstProposal = latestTranslationReviewProps().proposals?.[0]
    if (!firstProposal) throw new Error('missing first workspace proposal')
    await acceptTranslationProposal(firstProposal)
    let firstApply: Promise<void> | void
    act(() => {
      firstApply = latestTranslationReviewProps().onApplyCompleted?.()
    })
    await saveStarted.promise
    expect(firstModel.batchExecutions()).toBe(1)

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    fireEvent.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    )
    await screen.findByTestId('catalog-view')
    releaseSave.resolve()
    await act(async () => {
      await firstApply
    })
    expect(JSON.parse(fakeFileText(second, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([])

    const secondModel = configureTranslationModel()
    let secondSignal: AbortSignal | undefined
    mocks.makeFreeTranslateTexts.mockReturnValue(
      async (_texts: string[], _from: 'en' | 'ar', _to: 'en' | 'ar', signal?: AbortSignal) => {
        secondSignal = signal
        return await new Promise<Array<string | undefined>>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true }
          )
        })
      }
    )
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const secondReview = latestTranslationReviewProps()
    const secondField = listTranslationRecoveryFields(secondReview.review)[0]
    if (!secondField || !secondReview.onRetryField) {
      throw new Error('missing second workspace field')
    }
    act(() => {
      void secondReview.onRetryField?.(secondField, confirmedFieldRetry(secondReview, secondField))
    })
    await waitFor(() => expect(secondSignal).toEqual(expect.any(AbortSignal)))
    expect(latestTranslationReviewProps().cancellable).toBe(true)
    await user.click(screen.getByRole('button', { name: 'translationReview.cancel' }))
    expect(await screen.findByText('translationReview.cancelled')).not.toBeNull()
    expect(secondSignal?.aborted).toBe(true)
    expect(secondModel.batchExecutions()).toBe(0)
  })

  it('retries the exact accepted batch after storage failure without repeating provider or modeler work', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب'])
    await openDirectoryWorkspace(user, root)
    const adapter = latestWorkspaceLocalizationAdapter()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic').mockRejectedValueOnce(new Error('quota'))
    const store = latestWorkspaceLocalizationStore()
    const accept = vi.spyOn(store, 'acceptTranslationPairs')
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    act(() => latestTranslationReviewProps().onProviderChange('free'))
    const selected = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(selected.review)[0]
    if (!field || !selected.onRetryField) throw new Error('missing retryable field')

    await act(async () => {
      await selected.onRetryField?.(field, confirmedFieldRetry(selected, field))
    })
    const proposal = latestTranslationReviewProps().proposals?.[0]
    if (!proposal) throw new Error('missing reviewed provider proposal')
    await acceptTranslationProposal(proposal)
    await applyCompletedTranslationReview()

    expect(await screen.findByText(/translationReview\.memorySaveFailed/)).not.toBeNull()
    expect(latestTranslationReviewProps()).toMatchObject({
      status: 'translationReview.memorySaveFailed',
      technicalDetail: 'quota'
    })
    expect(screen.getByLabelText('translationReview.error.technicalDetail').textContent).toContain(
      'quota'
    )
    expect(model.batchExecutions()).toBe(1)
    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledTimes(1)
    const memoryFailureDialog = screen.getByRole('dialog', {
      name: 'translationReview.title'
    })
    expect((within(memoryFailureDialog).getByRole('combobox') as HTMLSelectElement).disabled).toBe(
      true
    )
    expect(
      (
        screen.getByRole('button', {
          name: 'translationReview.postpone'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'modal.close.aria' })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'translationReview.memoryRetry' })
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector<HTMLElement>('[role="presentation"]')!)
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()
    act(() => latestTranslationReviewProps().onProviderChange(''))
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'translationReview.memoryRetry' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'translationReview.memoryRetry' })).toBeNull()
    )
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    expect(accept).toHaveBeenCalledTimes(2)
    expect(accept.mock.calls[1]?.[0]).toEqual(accept.mock.calls[0]?.[0])
    expect(writeAtomic).toHaveBeenCalledTimes(2)
    expect(model.batchExecutions()).toBe(1)
    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledOnce()
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([
      expect.objectContaining({
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true
      })
    ])
  })

  it('single-flights a double translation-memory retry without reapplying the model', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    await openDirectoryWorkspace(user, root)
    vi.spyOn(latestWorkspaceLocalizationAdapter(), 'writeAtomic').mockRejectedValueOnce(
      new Error('quota')
    )
    const store = latestWorkspaceLocalizationStore()
    const originalAccept = store.acceptTranslationPairs.bind(store)
    const retryStarted = deferred()
    const releaseRetry = deferred()
    let acceptCalls = 0
    const accept = vi
      .spyOn(store, 'acceptTranslationPairs')
      .mockImplementation(async (pairs, options) => {
        acceptCalls += 1
        if (acceptCalls === 2) {
          retryStarted.resolve()
          await releaseRetry.promise
        }
        return originalAccept(pairs, options)
      })
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    const opened = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(opened.review)[0]
    if (!field || !opened.onManualEdit) throw new Error('missing manual translation field')
    await act(async () => {
      await opened.onManualEdit?.(field, 'مراجعة الطلب')
    })
    await applyCompletedTranslationReview()
    expect(await screen.findByText(/translationReview\.memorySaveFailed/)).not.toBeNull()
    const retryAction = latestTranslationReviewProps().onRetryMemorySave
    const continueAction = latestTranslationReviewProps().onContinueWithoutMemorySave
    if (!retryAction || !continueAction) {
      throw new Error('missing translation-memory recovery actions')
    }
    let firstRetry: Promise<void> | void
    let secondRetry: Promise<void> | void

    act(() => {
      firstRetry = retryAction()
      secondRetry = retryAction()
    })
    await retryStarted.promise

    expect(accept).toHaveBeenCalledTimes(2)
    expect(model.batchExecutions()).toBe(1)
    act(() => continueAction())
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()
    expect(screen.queryByText('translationReview.memorySkipped')).toBeNull()
    releaseRetry.resolve()
    await act(async () => {
      await Promise.all([firstRetry, secondRetry])
    })

    expect(accept).toHaveBeenCalledTimes(2)
    expect(model.batchExecutions()).toBe(1)
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([
      expect.objectContaining({
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true
      })
    ])
  })

  it('allows an explicit truthful continuation after repeated translation-memory failure', async () => {
    const model = configureTranslationModel()
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    await openDirectoryWorkspace(user, root)
    const writeAtomic = vi
      .spyOn(latestWorkspaceLocalizationAdapter(), 'writeAtomic')
      .mockRejectedValue(new Error('permission denied'))
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    const review = latestTranslationReviewProps()
    const field = listTranslationRecoveryFields(review.review)[0]
    if (!field || !review.onManualEdit) throw new Error('missing manual translation field')
    await act(async () => {
      await review.onManualEdit?.(field, 'مراجعة الطلب')
    })
    await applyCompletedTranslationReview()
    await user.click(screen.getByRole('button', { name: 'translationReview.memoryRetry' }))
    expect(await screen.findByText(/translationReview\.memorySaveFailed/)).not.toBeNull()
    const staleRetryMemory = latestTranslationReviewProps().onRetryMemorySave
    const staleContinue = latestTranslationReviewProps().onContinueWithoutMemorySave
    if (!staleRetryMemory || !staleContinue) {
      throw new Error('missing stale translation-memory recovery actions')
    }

    await user.click(screen.getByRole('button', { name: 'translationReview.memoryContinue' }))

    expect(await screen.findByText('translationReview.memorySkipped')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'translationReview.memoryRetry' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    expect(model.batchExecutions()).toBe(1)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([])

    delete (model.task.$attrs as Record<string, unknown>)['orbitpm:nameEn']
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    const replacement = latestTranslationReviewProps()
    const replacementField = listTranslationRecoveryFields(replacement.review)[0]
    if (!replacementField || !replacement.onManualEdit) {
      throw new Error('missing replacement memory-failure field')
    }
    await act(async () => {
      await replacement.onManualEdit?.(replacementField, 'Review request')
    })
    await applyCompletedTranslationReview()
    expect(await screen.findByText(/translationReview\.memorySaveFailed/)).not.toBeNull()
    const writesBeforeStaleRetry = writeAtomic.mock.calls.length

    await act(async () => {
      await staleRetryMemory()
    })
    expect(writeAtomic).toHaveBeenCalledTimes(writesBeforeStaleRetry)
    act(() => staleContinue())
    expect(screen.getByRole('dialog', { name: 'translationReview.title' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'translationReview.memoryRetry' })).not.toBeNull()
    expect(model.batchExecutions()).toBe(2)

    await user.click(screen.getByRole('button', { name: 'translationReview.memoryContinue' }))
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
  })

  it('treats an externally durable exact pair as a successful idempotent memory retry', async () => {
    const model = configureTranslationModel({ duplicateSource: true })
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب', undefined])
    await openDirectoryWorkspace(user, root)
    const writeAtomic = vi
      .spyOn(latestWorkspaceLocalizationAdapter(), 'writeAtomic')
      .mockRejectedValue(new Error('read-only workspace'))
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await user.selectOptions(
      within(await screen.findByRole('dialog', { name: 'translationReview.title' })).getByRole(
        'combobox'
      ),
      'free'
    )
    await user.click(screen.getByRole('button', { name: 'translationReview.translateNow' }))
    const proposal = latestTranslationReviewProps().proposals?.[0]
    if (!proposal) throw new Error('missing partial provider proposal')
    await acceptTranslationProposal(proposal)
    const remaining = latestTranslationReviewProps()
    const remainingField = listTranslationRecoveryFields(remaining.review).find(
      (field) => field.elementId === 'Task_2'
    )
    if (!remainingField || !remaining.onManualEdit) {
      throw new Error('missing remaining duplicate translation field')
    }
    await act(async () => {
      await remaining.onManualEdit?.(remainingField, 'مراجعة الطلب')
    })
    await applyCompletedTranslationReview()
    expect(await screen.findByText(/translationReview\.memorySaveFailed/)).not.toBeNull()
    expect(model.batchExecutions()).toBe(1)
    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledOnce()

    const externalGlossary = [{ en: 'EXTERNAL', ar: 'EXTERNAL', neutral: true }]
    replaceFakeFile(
      root,
      WORKSPACE_GLOSSARY_PATH,
      serializeWorkspaceGlossaryDocument(createWorkspaceGlossaryDocument(externalGlossary))
    )
    replaceFakeFile(
      root,
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(
        createWorkspaceTranslationMemoryDocument([
          { en: 'Review request', ar: 'مراجعة الطلب', accepted: true }
        ])
      )
    )

    await user.click(screen.getByRole('button', { name: 'translationReview.memoryRetry' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    )
    expect(screen.queryByText(/translationReview\.memorySaveFailed/)).toBeNull()
    expect(latestWorkspaceLocalizationStore().current?.resources.glossary).toEqual(externalGlossary)
    expect(latestWorkspaceLocalizationStore().current?.resources.translationMemory).toEqual([
      expect.objectContaining({
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true
      })
    ])

    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledOnce()
    expect(writeAtomic).toHaveBeenCalledOnce()
    expect((model.duplicateTask?.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe(
      'مراجعة الطلب'
    )
    expect(model.batchExecutions()).toBe(1)
  })

  it('keeps a partial provider result private until every duplicate is reviewed and one final apply commits', async () => {
    const model = configureTranslationModel({ duplicateSource: true })
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['مراجعة الطلب', undefined])
    await openDirectoryWorkspace(user, root)
    const accept = vi.spyOn(latestWorkspaceLocalizationStore(), 'acceptTranslationPairs')
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await user.selectOptions(
      within(await screen.findByRole('dialog', { name: 'translationReview.title' })).getByRole(
        'combobox'
      ),
      'free'
    )
    await user.click(screen.getByRole('button', { name: 'translationReview.translateNow' }))

    await waitFor(() => expect(latestTranslationReviewProps().busy).toBe(false))
    const proposal = latestTranslationReviewProps().proposals?.[0]
    if (!proposal) throw new Error('missing partial duplicate proposal')
    await acceptTranslationProposal(proposal)
    expect(accept).not.toHaveBeenCalled()
    expect(model.batchExecutions()).toBe(0)
    const staged = latestTranslationReviewProps()
    const remainingField = listTranslationRecoveryFields(staged.review).find(
      (field) => field.elementId === 'Task_2'
    )
    if (!remainingField || !staged.onManualEdit) {
      throw new Error('missing remaining duplicate field')
    }
    await act(async () => {
      await staged.onManualEdit?.(remainingField, 'مراجعة الطلب')
    })
    await applyCompletedTranslationReview()

    expect(accept).toHaveBeenCalledOnce()
    expect(accept.mock.calls[0]?.[0]).toEqual([{ en: 'Review request', ar: 'مراجعة الطلب' }])
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect((model.duplicateTask?.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe(
      'مراجعة الطلب'
    )
    expect(model.batchExecutions()).toBe(1)
    expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    expect(mocks.makeFreeTranslateTexts).toHaveBeenCalledOnce()
  })

  it('accepts a workspace-approved neutral provider result without caching an invalid TM pair', async () => {
    const model = configureTranslationModel({
      sourceValue: 'Application programming interface'
    })
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [{ en: 'API', ar: 'API', neutral: true }], [])
    mocks.makeFreeTranslateTexts.mockReturnValue(async () => ['API'])
    await openDirectoryWorkspace(user, root)
    const accept = vi.spyOn(latestWorkspaceLocalizationStore(), 'acceptTranslationPairs')
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await user.selectOptions(
      within(await screen.findByRole('dialog', { name: 'translationReview.title' })).getByRole(
        'combobox'
      ),
      'free'
    )
    await user.click(screen.getByRole('button', { name: 'translationReview.translateNow' }))
    const proposal = latestTranslationReviewProps().proposals?.[0]
    if (!proposal) throw new Error('missing neutral provider proposal')
    await acceptTranslationProposal(proposal)
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBeUndefined()
    expect(accept).not.toHaveBeenCalled()
    await applyCompletedTranslationReview()

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'translationReview.title' })).toBeNull()
    )
    expect((model.task.$attrs as Record<string, unknown>)['orbitpm:nameAr']).toBe('API')
    expect(accept).not.toHaveBeenCalled()
    expect(JSON.parse(fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([])
    expect(screen.queryByText(/translationReview\.memorySaveFailed/)).toBeNull()
  })

  it('reloads restored workspace localization resources after a backup commit', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const originalGlossary = [{ en: 'Original term', ar: 'مصطلح أصلي' }]
    const restoredGlossary = [{ en: 'Restored term', ar: 'مصطلح مستعاد' }]
    seedWorkspaceLocalization(root, originalGlossary, [])
    root.addFile('existing.bpmn', state.xml)
    await openDirectoryWorkspace(user, root)
    expect(latestSettingsLocalization().snapshot?.resources.glossary).toEqual(originalGlossary)

    const backupAdapter = new MemoryWorkspaceAdapter({
      id: 'backup-localization-source',
      files: {
        [WORKSPACE_GLOSSARY_PATH]: serializeWorkspaceGlossaryDocument(
          createWorkspaceGlossaryDocument(restoredGlossary)
        ),
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: serializeWorkspaceTranslationMemoryDocument(
          createWorkspaceTranslationMemoryDocument([])
        )
      }
    })
    const backupBlob = await backupAdapter.exportBackup()
    const backupFile = new File([await backupBlob.arrayBuffer()], 'localization-backup.zip', {
      type: 'application/zip'
    })
    const input = document.querySelectorAll<HTMLInputElement>(
      'input[type="file"][accept=".zip,application/zip"]'
    )[1]
    if (!input) throw new Error('missing backup ZIP input')

    fireEvent.change(input, { target: { files: [backupFile] } })
    const dialog = await screen.findByRole('dialog', {
      name: 'workspace.storage.collisionReview'
    })
    for (const select of within(dialog).getAllByRole('combobox') as HTMLSelectElement[]) {
      if (!select.disabled) await user.selectOptions(select, 'replace')
    }
    await user.click(
      within(dialog).getByRole('button', {
        name: 'workspace.storage.backupApply'
      })
    )

    await waitFor(() =>
      expect(latestSettingsLocalization().snapshot?.resources.glossary).toEqual(restoredGlossary)
    )
    expect(JSON.parse(fakeFileText(root, WORKSPACE_GLOSSARY_PATH)).entries).toEqual(
      restoredGlossary
    )
    expect(screen.queryByRole('dialog', { name: 'workspace.storage.collisionReview' })).toBeNull()
  })

  it('suppresses save shortcuts until committed backup reconciliation finishes', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'shortcut-backup-lock.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const applyStarted = deferred()
    const releaseApply = deferred()
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: mocks.commandSave,
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async () => {
          applyStarted.resolve()
          await releaseApply.promise
        }
      })
    })
    const restoredXml = `${state.xml}\n<!-- shortcut-locked backup -->`
    const backupAdapter = new MemoryWorkspaceAdapter({
      id: 'backup-shortcut-source',
      files: { [path]: restoredXml }
    })
    const backupBlob = await backupAdapter.exportBackup()
    const backupFile = new File([await backupBlob.arrayBuffer()], 'shortcut-lock-backup.zip', {
      type: 'application/zip'
    })
    const input = document.querySelectorAll<HTMLInputElement>(
      'input[type="file"][accept=".zip,application/zip"]'
    )[1]
    if (!input) throw new Error('missing backup ZIP input')
    fireEvent.change(input, { target: { files: [backupFile] } })
    const dialog = await screen.findByRole('dialog', {
      name: 'workspace.storage.collisionReview'
    })
    for (const select of within(dialog).getAllByRole('combobox') as HTMLSelectElement[]) {
      if (!select.disabled) await user.selectOptions(select, 'replace')
    }
    await user.click(
      within(dialog).getByRole('button', {
        name: 'workspace.storage.backupApply'
      })
    )
    await applyStarted.promise
    expect(fakeFileText(root, path)).toBe(restoredXml)

    const ctrlSave = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true
    })
    const metaSave = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      cancelable: true
    })
    window.dispatchEvent(ctrlSave)
    window.dispatchEvent(metaSave)
    expect(ctrlSave.defaultPrevented).toBe(true)
    expect(metaSave.defaultPrevented).toBe(true)
    expect(mocks.commandSave).not.toHaveBeenCalled()

    releaseApply.resolve()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'workspace.storage.collisionReview' })).toBeNull()
    )
    await act(async () => {
      await Promise.resolve()
    })
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    )
    expect(mocks.commandSave).toHaveBeenCalledOnce()
  })

  it('keeps stores generation-scoped across same-id folder switches and rejects stale callbacks', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    seedWorkspaceLocalization(first, [{ en: 'First term', ar: 'المصطلح الأول' }], [])
    seedWorkspaceLocalization(second, [{ en: 'Second term', ar: 'المصطلح الثاني' }], [])
    await openDirectoryWorkspace(user, first)

    const firstSettings = latestSettingsLocalization()
    const firstGlossaryBytes = fakeFileText(first, WORKSPACE_GLOSSARY_PATH)
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() =>
      expect(latestSettingsLocalization().snapshot?.resources.glossary).toEqual([
        { en: 'Second term', ar: 'المصطلح الثاني' }
      ])
    )

    expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2)
    expect(mocks.workspaceLocalizationFactories.mock.calls[0]?.[0]).not.toBe(
      mocks.workspaceLocalizationFactories.mock.calls[1]?.[0]
    )
    expect(mocks.workspaceLocalizationFactories.mock.calls[0]?.[1]).not.toBe(
      mocks.workspaceLocalizationFactories.mock.calls[1]?.[1]
    )
    await expect(
      firstSettings.onSaveGlossary(
        [{ en: 'Late write', ar: 'كتابة متأخرة' }],
        firstSettings.snapshot!.files.glossary.hash
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fakeFileText(first, WORKSPACE_GLOSSARY_PATH)).toBe(firstGlossaryBytes)
    expect(JSON.parse(fakeFileText(second, WORKSPACE_GLOSSARY_PATH)).entries).toEqual([
      { en: 'Second term', ar: 'المصطلح الثاني' }
    ])
  })

  it('changes the Settings binding key across same-id workspaces with identical localization hashes', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    seedWorkspaceLocalization(first, [], [])
    seedWorkspaceLocalization(second, [], [])
    await openDirectoryWorkspace(user, first)

    const firstSettings = latestSettingsLocalization()
    const firstBindingKey = firstSettings.workspaceBindingKey
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() => expect(mocks.workspaceLocalizationFactories).toHaveBeenCalledTimes(2))
    const secondSettings = latestSettingsLocalization()

    expect(secondSettings.snapshot?.files.glossary.hash).toBe(
      firstSettings.snapshot?.files.glossary.hash
    )
    expect(secondSettings.snapshot?.files.translationMemory.hash).toBe(
      firstSettings.snapshot?.files.translationMemory.hash
    )
    expect(secondSettings.workspaceBindingKey).toBeTruthy()
    expect(secondSettings.workspaceBindingKey).not.toBe(firstBindingKey)
  })

  it('does not publish a peer refresh for an unchanged localization reload', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    seedWorkspaceLocalization(root, [], [])
    await openDirectoryWorkspace(user, root)
    sessionHarness.publishedChanges.length = 0

    await act(async () => {
      await latestSettingsLocalization().onReload()
    })

    expect(sessionHarness.publishedChanges).toEqual([])
  })

  it('keeps a failed reload unavailable and rejects peer saves until both resources recover', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    const glossary = [{ en: 'Review request', ar: 'مراجعة الطلب' }]
    seedWorkspaceLocalization(root, glossary, [])
    await openDirectoryWorkspace(user, root)
    const initial = latestSettingsLocalization()
    const glossaryBefore = fakeFileText(root, WORKSPACE_GLOSSARY_PATH)
    replaceFakeFile(
      root,
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      '{"format":"broken","version":1,"entries":[]}'
    )

    await act(async () => {
      await expect(initial.onReload()).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    })
    await waitFor(() => expect(latestSettingsLocalization().snapshot).toBeNull())
    const failed = latestSettingsLocalization()
    expect(failed.loadError).toContain(WORKSPACE_TRANSLATION_MEMORY_PATH)
    await expect(
      failed.onSaveGlossary(
        [{ en: 'Must not save', ar: 'يجب ألا يحفظ' }],
        initial.snapshot!.files.glossary.hash
      )
    ).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    expect(fakeFileText(root, WORKSPACE_GLOSSARY_PATH)).toBe(glossaryBefore)
    expect(latestSettingsLocalization().snapshot).toBeNull()
    expect(latestSettingsLocalization().loadError).toContain(WORKSPACE_TRANSLATION_MEMORY_PATH)

    replaceFakeFile(
      root,
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(createWorkspaceTranslationMemoryDocument([]))
    )
    let recovered!: Awaited<ReturnType<LocalizationResourcesEditorProps['onReload']>>
    await act(async () => {
      recovered = await latestSettingsLocalization().onReload()
    })
    await waitFor(() => expect(latestSettingsLocalization().snapshot).toBe(recovered))
    expect(latestSettingsLocalization().loadError).toBeNull()
    expect(recovered.resources.glossary).toEqual(glossary)
  })

  it('retains the structured glossary resource-limit code for localized Settings recovery', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    root.addFile(WORKSPACE_GLOSSARY_PATH, `${'['.repeat(9)}0${']'.repeat(9)}`)
    root.addFile(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(createWorkspaceTranslationMemoryDocument([]))
    )

    await openDirectoryWorkspace(user, root)

    const failed = latestSettingsLocalization()
    expect(failed.snapshot).toBeNull()
    expect(failed.loadErrorCode).toBe('resource-limit')
    expect(failed.loadError).toContain('Glossary json-depth limit')
  })

  it('keeps corrupt localization bytes read-only, shows Settings recovery, and retries explicitly', async () => {
    const user = userEvent.setup()
    const root = populatedDirectory()
    const corrupt = '{"format":"not-orbitpm","version":1,"entries":[]}'
    root.addFile(WORKSPACE_GLOSSARY_PATH, corrupt)
    root.addFile(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(createWorkspaceTranslationMemoryDocument([]))
    )
    await openDirectoryWorkspace(user, root)

    const failed = latestSettingsLocalization()
    expect(failed.snapshot).toBeNull()
    expect(failed.loadError).toContain(WORKSPACE_GLOSSARY_PATH)
    expect(fakeFileText(root, WORKSPACE_GLOSSARY_PATH)).toBe(corrupt)

    const recoveryButton = screen.getByRole('button', {
      name: /settings\.localization\.title/
    })
    expect(recoveryButton.getAttribute('title')).toBe('settings.localization.loadFailed')
    await user.click(recoveryButton)
    const settingsDialog = await screen.findByRole('dialog', { name: 'mock-settings' })
    expect(within(settingsDialog).getByRole('alert').textContent).toContain(WORKSPACE_GLOSSARY_PATH)
    await expect(
      failed.onSaveGlossary(
        [{ en: 'Must not write', ar: 'يجب ألا يكتب' }],
        'unavailable-caller-view'
      )
    ).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    expect(fakeFileText(root, WORKSPACE_GLOSSARY_PATH)).toBe(corrupt)

    await user.click(within(settingsDialog).getByRole('button', { name: 'mock-settings-close' }))
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    expect(await screen.findByText('settings.localization.loadFailed')).not.toBeNull()
    expect(screen.queryByTestId('editor-tab')).toBeNull()
    expect(latestSessionController().store.list()).toHaveLength(0)

    const repaired = [{ en: 'Repaired term', ar: 'مصطلح مُصلح' }]
    const glossaryFile = root.file(WORKSPACE_GLOSSARY_PATH)
    glossaryFile.bytes = new TextEncoder().encode(
      serializeWorkspaceGlossaryDocument(createWorkspaceGlossaryDocument(repaired))
    )
    glossaryFile.lastModified += 1
    await user.click(screen.getByRole('button', { name: 'app.settings' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'mock-settings' })).getByRole('button', {
        name: 'settings.localization.reload'
      })
    )
    await waitFor(() => expect(latestSettingsLocalization().loadError).toBeNull())
    expect(latestSettingsLocalization().snapshot?.resources.glossary).toEqual(repaired)
    expect(
      within(screen.getByRole('dialog', { name: 'mock-settings' })).queryByRole('alert')
    ).toBeNull()
    await user.click(
      within(screen.getByRole('dialog', { name: 'mock-settings' })).getByRole('button', {
        name: 'mock-settings-close'
      })
    )
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    await screen.findByRole('dialog', { name: 'translationReview.title' })
    const safeReview = mocks.translationReviewProps.mock.calls.at(-1)?.[0]
      .review as import('./localization/modelerAdapter').DiagramLocalizationReview
    expect(safeReview.localResources).toEqual({
      glossary: repaired,
      translationMemory: []
    })
  })

  it('opens well-formed historical BPMN under the apply-editor validation policy', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'repairable.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    mocks.validateBpmn.mockImplementation(parsedValidationResultForXml)
    mocks.evaluatePolicy.mockImplementation((_summary, action: string) => ({
      allowed: action === 'apply-editor',
      blockingIssues: []
    }))
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }

    act(() => tree.onOpenFile(path))

    expect(await screen.findByTestId('editor-tab')).not.toBeNull()
    expect(latestSessionController().store.get(path)).toBeDefined()
    expect(mocks.evaluatePolicy).toHaveBeenCalled()
    expect(mocks.evaluatePolicy.mock.calls.every(([, action]) => action === 'apply-editor')).toBe(
      true
    )
  })

  it('opens no tab or session when historical XML review is cancelled', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'legacy.bpmn'
    const processId = 'Process_Legacy'
    const legacyXml = withoutArabicMetadata(withProcessId(state.xml, processId))
    root.addFile(path, legacyXml)
    await openDirectoryWorkspace(user, root)
    mocks.validateBpmn.mockImplementation(async (xml: string) =>
      xml.includes(processId)
        ? missingArabicValidationResult(processId)
        : validationResultForXml(xml)
    )
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }

    act(() => tree.onOpenFile(path))

    const review = await screen.findByRole('dialog', { name: 'reviewedXmlReview.title' })
    expect(screen.queryByTestId('editor-tab')).toBeNull()
    expect(latestSessionController().store.list()).toHaveLength(0)
    expect(fakeFileText(root, path)).toBe(legacyXml)

    await user.click(
      within(review).getByRole('button', {
        name: 'reviewedXmlReview.cancel'
      })
    )

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'reviewedXmlReview.title' })).toBeNull()
    )
    expect(screen.queryByTestId('editor-tab')).toBeNull()
    expect(latestSessionController().store.list()).toHaveLength(0)
    expect(fakeFileText(root, path)).toBe(legacyXml)
  })

  it('aborts historical XML review on workspace switch and ignores a late decision', async () => {
    const user = userEvent.setup()
    const first = fakeRoot()
    const path = 'legacy.bpmn'
    const processId = 'Process_Legacy_Switch'
    const legacyXml = withoutArabicMetadata(withProcessId(state.xml, processId))
    first.addFile(path, legacyXml)
    const second = fakeRoot()
    second.addFile('second.bpmn', withProcessId(state.xml, 'Process_Second'))
    await openDirectoryWorkspace(user, first)
    mocks.validateBpmn.mockImplementation(async (xml: string) =>
      xml.includes(processId)
        ? missingArabicValidationResult(processId)
        : validationResultForXml(xml)
    )
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    const review = await screen.findByRole('dialog', { name: 'reviewedXmlReview.title' })
    const staleCancel = within(review).getByRole('button', {
      name: 'reviewedXmlReview.cancel'
    })

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'reviewedXmlReview.title' })).toBeNull()
    )
    await screen.findByTestId('catalog-view')
    fireEvent.click(staleCancel)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByTestId('editor-tab')).toBeNull()
    expect(latestSessionController().store.list()).toHaveLength(0)
    expect(fakeFileText(first, path)).toBe(legacyXml)
    expect(() => second.file(path)).toThrow(/Missing fake file/)
  })

  it('reviews a recovery draft independently and preserves it when restore review is cancelled', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'Finance/existing.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const adapter = mocks.workspaceLocalizationFactories.mock.calls.at(-1)?.[0] as {
      id: string
    }
    const processId = 'Process_Draft_Review'
    const draftXml = withoutArabicMetadata(withProcessId(state.xml, processId))
    const draft = seedDraft(adapter.id, path, draftXml)
    mocks.validateBpmn.mockImplementation(async (xml: string) =>
      xml.includes(processId)
        ? missingArabicValidationResult(processId)
        : validationResultForXml(xml)
    )

    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    const recovery = await screen.findByRole('dialog', { name: 'draftRecovery.title' })
    await user.click(
      within(recovery).getByRole('button', {
        name: 'draftRecovery.restore'
      })
    )

    const review = await screen.findByRole('dialog', { name: 'reviewedXmlReview.title' })
    const session = latestSessionController().store.get(path)
    expect(session).toMatchObject({ currentXml: state.xml, lastSavedXml: state.xml, dirty: false })
    expect(sessionHarness.drafts.has(draft.id)).toBe(true)
    await user.click(
      within(review).getByRole('button', {
        name: 'reviewedXmlReview.cancel'
      })
    )

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'reviewedXmlReview.title' })).toBeNull()
    )
    expect(screen.getByTestId('editor-xml').textContent).toBe(state.xml)
    expect(latestSessionController().store.get(path)?.dirty).toBe(false)
    expect(sessionHarness.drafts.has(draft.id)).toBe(true)
    expect(fakeFileText(root, path)).toBe(state.xml)
  })

  // This observes two complete 2 s journal debounce windows; keep production
  // timing real while allowing React/user-event overhead beyond Vitest's 5 s default.
  it('never overwrites an older recovery draft with reviewed disk localization', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'reviewed-disk-with-draft.bpmn'
    const diskProcessId = 'Process_Reviewed_Disk'
    const draftProcessId = 'Process_Older_Draft'
    const diskXml = withoutArabicMetadata(withProcessId(state.xml, diskProcessId))
    const draftXml = withoutArabicMetadata(withProcessId(state.xml, draftProcessId))
    root.addFile(path, diskXml)
    await openDirectoryWorkspace(user, root)
    const workspace = mocks.workspaceLocalizationFactories.mock.calls.at(-1)?.[0] as {
      id: string
    }
    const draft = seedDraft(workspace.id, path, draftXml)
    mocks.validateBpmn.mockImplementation(parsedValidationResultForXml)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }

    act(() => tree.onOpenFile(path))
    await completeReviewedXmlReview(user, ['عملية القرص', 'بداية القرص'])
    const recovery = await screen.findByRole('dialog', { name: 'draftRecovery.title' })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_200))
    })
    expect(sessionHarness.drafts.get(draft.id)?.xml).toBe(draftXml)

    await user.click(
      within(recovery).getByRole('button', {
        name: 'draftRecovery.restore'
      })
    )
    const draftReview = await screen.findByRole('dialog', {
      name: 'reviewedXmlReview.title'
    })
    await user.click(
      within(draftReview).getByRole('button', {
        name: 'reviewedXmlReview.cancel'
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'reviewedXmlReview.title' })).toBeNull()
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_200))
    })

    const session = latestSessionController().store.get(path)
    expect(session?.lastSavedXml).toBe(diskXml)
    expect(session?.currentXml).toContain('عملية القرص')
    expect(session?.dirty).toBe(true)
    expect(sessionHarness.drafts.get(draft.id)?.xml).toBe(draftXml)
    expect(fakeFileText(root, path)).toBe(diskXml)
  }, 10_000)

  it('freezes the exact loaded resources for an active review and uses updates only next time', async () => {
    const process: Record<string, unknown> = {
      $type: 'bpmn:Process',
      id: 'Process_1',
      $attrs: { 'orbitpm:activeLang': 'en' }
    }
    const task: Record<string, unknown> = {
      $type: 'bpmn:Task',
      id: 'Task_1',
      name: 'Review request',
      $attrs: { 'orbitpm:nameEn': 'Review request' },
      $parent: process
    }
    process.flowElements = [task]
    mocks.modelerDefinitions.mockReturnValue({
      $type: 'bpmn:Definitions',
      rootElements: [process]
    })
    mocks.modelerGet.mockImplementation((name: string) => {
      if (name === 'eventBus') return { on: vi.fn(), off: vi.fn() }
      if (name === 'canvas') {
        return {
          getRootElement: () => ({ id: 'Process_1', businessObject: process })
        }
      }
      if (name === 'elementRegistry') {
        return {
          getAll: () => [{ id: 'Task_1', businessObject: task }]
        }
      }
      return {}
    })

    const user = userEvent.setup()
    const root = populatedDirectory()
    const originalGlossary = [{ en: 'Case code', ar: 'رمز الحالة' }]
    seedWorkspaceLocalization(root, originalGlossary, [])
    await openDirectoryWorkspace(user, root)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))

    const initialReview = mocks.translationReviewProps.mock.calls.at(-1)?.[0].review as
      import('./localization/modelerAdapter').DiagramLocalizationReview | undefined
    if (!initialReview) throw new Error('expected a translation review')
    expect(initialReview.localResources).toEqual({
      glossary: originalGlossary,
      translationMemory: []
    })

    const updatedGlossary = [{ en: 'Updated term', ar: 'مصطلح محدث' }]
    await act(async () => {
      const settings = latestSettingsLocalization()
      await settings.onSaveGlossary(updatedGlossary, settings.snapshot!.files.glossary.hash)
    })
    expect(
      (mocks.translationReviewProps.mock.calls.at(-1)?.[0].review as typeof initialReview)
        .localResources
    ).toEqual({
      glossary: originalGlossary,
      translationMemory: []
    })

    await user.click(screen.getByRole('button', { name: 'translationReview.postpone' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    const nextReview = mocks.translationReviewProps.mock.calls.at(-1)?.[0]
      .review as import('./localization/modelerAdapter').DiagramLocalizationReview
    expect(nextReview.localResources).toEqual({
      glossary: updatedGlossary,
      translationMemory: []
    })
  })

  it('activates, searches, navigates, refreshes, and exports a real directory adapter', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)

    expect(mocks.rememberWorkspace).toHaveBeenCalledOnce()
    expect(screen.getByText('workspace.storage.current')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'mock-catalog-sort' }))
    await user.click(screen.getByRole('button', { name: 'mock-catalog-sort' }))
    await user.click(screen.getByRole('button', { name: 'mock-catalog-open' }))
    expect(await screen.findByTestId('editor-tab')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'app.home' }))
    expect(await screen.findByTestId('catalog-view')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    expect((await screen.findAllByText('existing.bpmn')).length).toBeGreaterThan(0)

    const search = screen.getByRole('combobox', { name: 'tree.search.aria' })
    await user.type(search, 'Test process')
    await waitFor(() => expect(search.getAttribute('aria-expanded')).toBe('true'))
    const listbox = screen.getByRole('listbox', { name: 'search.results.title' })
    expect(search.getAttribute('aria-controls')).toBe(listbox.id)
    expect(search.getAttribute('aria-activedescendant')).toBe(
      'orbitpm-workspace-search-results-option-0'
    )
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(search, { key: 'Enter' })

    await user.click(screen.getByRole('button', { name: 'tree.refresh.aria' }))
    expect(await screen.findByText('toast.refreshed')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'library.export' }))
    expect(mocks.triggerDownload).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'workspace.storage.backupExport' }))
    await waitFor(() =>
      expect(screen.getAllByText('workspace.storage.backupExport').length).toBeGreaterThan(1)
    )

    fireEvent.keyDown(window, { altKey: true, key: 'ArrowLeft' })
    fireEvent.keyDown(window, { altKey: true, key: 'ArrowRight' })
  })

  it('notifies a dirty session when another tab publishes a workspace change', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')

    const controller = latestSessionController()
    const session = controller.store.getActive()
    if (!session) throw new Error('expected an active directory session')
    act(() => {
      controller.updateXml(session.id, `${session.currentXml}\n<!-- local edit -->`)
      sessionHarness.coordinators.at(-1)?.emit({
        kind: 'saved',
        path: 'Finance/existing.bpmn'
      })
    })

    expect(await screen.findByText('workspace.coordination.changed')).not.toBeNull()
    expect(controller.store.get(session.id)?.dirty).toBe(true)
  })

  it('coalesces a burst of remote workspace changes into one refresh', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    const adapter = latestWorkspaceLocalizationAdapter()
    const list = vi.spyOn(adapter, 'list')
    list.mockClear()
    const coordinator = sessionHarness.coordinators.at(-1)
    if (!coordinator) throw new Error('expected workspace coordination')

    act(() => {
      for (let index = 0; index < 1_000; index += 1) {
        coordinator.emit({
          kind: 'saved',
          path: `Finance/peer-${index}.bpmn`
        })
      }
    })

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('keeps a baseline-identical live capture clean so refresh can expose external XML', async () => {
    const user = userEvent.setup()
    let commandStackChanged: (() => void) | undefined
    const eventBus = {
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'commandStack.changed') commandStackChanged = callback
      }),
      off: vi.fn()
    }
    mocks.modelerGet.mockImplementation((name: string) => {
      if (name === 'eventBus') return eventBus
      if (name === 'elementRegistry') return { getAll: () => [] }
      if (name === 'canvas') {
        return {
          getRootElement: () => ({
            businessObject: { $type: 'bpmn:Process', name: 'Test process' }
          })
        }
      }
      return {}
    })
    const root = await openDirectoryWorkspace(user)
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    if (!commandStackChanged) throw new Error('missing live XML capture listener')

    act(() => {
      commandStackChanged?.()
    })
    await waitFor(() => expect(mocks.saveXml).toHaveBeenCalled(), { timeout: 1_000 })
    await waitFor(() => expect(latestSessionController().store.getActive()?.dirty).toBe(false))
    expect(
      screen.queryByRole('tab', {
        name: /tab\.dirty\.aria/
      })
    ).toBeNull()

    const externalProcessId = 'Process_External_Refresh'
    replaceFakeFile(root, 'Finance/existing.bpmn', withProcessId(state.xml, externalProcessId))
    await user.click(screen.getByRole('button', { name: 'tree.refresh.aria' }))
    await screen.findByText('toast.refreshed')
    const digests = await latestAssistantDrawerProps().getDigests()

    expect(digests.some((digest) => digest.processId === externalProcessId)).toBe(true)
    expect(digests.some((digest) => digest.processId === 'Process_Test')).toBe(true)
  })

  it('does not import a duplicate-id repair prepared from a refreshed index snapshot', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user, duplicateProcessDirectory())
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    installMockEditorXmlTransactionCommands()
    mocks.saveXml.mockResolvedValue({ xml: state.xml })
    const validationStarted = deferred()
    const releaseValidation = deferred()
    mocks.validateBpmn
      .mockImplementationOnce(async (xml: string) => {
        validationStarted.resolve()
        await releaseValidation.promise
        return parsedValidationResultForXml(xml)
      })
      .mockImplementation(parsedValidationResultForXml)

    await user.click(
      screen.getByRole('button', {
        name: /Process_Test.*workspace\.duplicate\.repair/
      })
    )
    await validationStarted.promise
    replaceFakeFile(
      root,
      'Finance/existing.bpmn',
      `${state.xml}\n<!-- refreshed before repair preparation -->`
    )
    await user.click(screen.getByRole('button', { name: 'tree.refresh.aria' }))
    await screen.findByText('toast.refreshed')
    releaseValidation.resolve()

    expect(await screen.findByText('session.save.reloadEditorFailed')).not.toBeNull()
    expect(mocks.importXml).not.toHaveBeenCalled()
    expect(latestSessionController().store.getActive()).toMatchObject({
      currentXml: state.xml,
      lastSavedXml: state.xml,
      dirty: false
    })
    expect(
      screen.queryByRole('tab', {
        name: /tab\.dirty\.aria/
      })
    ).toBeNull()
  })

  it('does not overwrite a live edit made before duplicate repair validation settles', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user, duplicateProcessDirectory())
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    installMockEditorXmlTransactionCommands()
    let liveXml = state.xml
    mocks.saveXml.mockImplementation(async () => ({ xml: liveXml }))
    const validationStarted = deferred()
    const releaseValidation = deferred()
    mocks.validateBpmn
      .mockImplementationOnce(async (xml: string) => {
        validationStarted.resolve()
        await releaseValidation.promise
        return parsedValidationResultForXml(xml)
      })
      .mockImplementation(parsedValidationResultForXml)
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
    }

    await user.click(
      screen.getByRole('button', {
        name: /Process_Test.*workspace\.duplicate\.repair/
      })
    )
    await validationStarted.promise
    liveXml = `${state.xml}\n<!-- sub-debounce user edit -->`
    act(() => {
      editor.onDirtyChange(true)
    })
    releaseValidation.resolve()

    expect(await screen.findByText('session.save.reloadEditorFailed')).not.toBeNull()
    expect(mocks.importXml).not.toHaveBeenCalled()
    expect(liveXml).toContain('sub-debounce user edit')
    expect(
      screen.getByRole('tab', {
        name: /tab\.dirty\.aria/
      })
    ).not.toBeNull()
  })

  it('lets only the current duplicate-repair click commit', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user, duplicateProcessDirectory())
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const markDirty = vi.fn()
    installMockEditorXmlTransactionCommands({ markDirty })
    let liveXml = state.xml
    mocks.saveXml.mockImplementation(async () => ({ xml: liveXml }))
    mocks.importXml.mockImplementation(async (candidate: string) => {
      liveXml = candidate
      return { warnings: [] }
    })
    const firstValidationStarted = deferred()
    const releaseFirstValidation = deferred()
    mocks.validateBpmn
      .mockImplementationOnce(async (xml: string) => {
        firstValidationStarted.resolve()
        await releaseFirstValidation.promise
        return parsedValidationResultForXml(xml)
      })
      .mockImplementation(parsedValidationResultForXml)
    const repairButton = screen.getByRole('button', {
      name: /Process_Test.*workspace\.duplicate\.repair/
    })

    await user.click(repairButton)
    await firstValidationStarted.promise
    await user.click(repairButton)
    releaseFirstValidation.resolve()

    await waitFor(() => expect(mocks.importXml).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: /Process_Test.*workspace\.duplicate\.repair/
        })
      ).toBeNull()
    )
    expect(liveXml).not.toBe(state.xml)
    expect(markDirty).toHaveBeenCalledOnce()
    expect(latestSessionController().store.getActive()).toMatchObject({
      currentXml: liveXml,
      dirty: true
    })
  })

  it('rolls back a partial duplicate-id editor import without dirtying a clean session', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user, duplicateProcessDirectory())
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    installMockEditorXmlTransactionCommands()
    mocks.validateBpmn.mockImplementation(parsedValidationResultForXml)
    let liveXml = state.xml
    mocks.saveXml.mockImplementation(async () => ({ xml: liveXml }))
    mocks.importXml
      .mockImplementationOnce(async (candidate: string) => {
        liveXml = candidate
        throw new Error('partial repair import failed')
      })
      .mockImplementation(async (candidate: string) => {
        liveXml = candidate
        return { warnings: [] }
      })

    await user.click(
      screen.getByRole('button', {
        name: /Process_Test.*workspace\.duplicate\.repair/
      })
    )

    expect(await screen.findByText('session.save.reloadEditorFailed')).not.toBeNull()
    expect(mocks.importXml).toHaveBeenCalledTimes(2)
    expect(liveXml).toBe(state.xml)
    expect(latestSessionController().store.getActive()).toMatchObject({
      currentXml: state.xml,
      lastSavedXml: state.xml,
      dirty: false
    })
    expect(
      screen.queryByRole('tab', {
        name: /tab\.dirty\.aria/
      })
    ).toBeNull()
  })

  it('hands library ZIP Files directly to the browser worker boundary', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    const libraryXml = withProcessId(state.xml, 'Process_Library')
    mocks.readLibraryZipFileInWorker.mockResolvedValueOnce({
      entries: [{ relPath: 'worker-result.bpmn', xml: libraryXml }],
      skipped: []
    })
    const input = document.querySelectorAll<HTMLInputElement>(
      'input[type="file"][accept=".zip,application/zip"]'
    )[0]
    if (!input) throw new Error('missing library ZIP input')
    const file = new File(['worker bytes'], 'library.zip', { type: 'application/zip' })
    const arrayBuffer = vi.fn(async () => utf8Buffer('worker bytes'))
    Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: arrayBuffer })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(mocks.readLibraryZipFileInWorker).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('dialog', { name: 'library.import.confirmTitle' })
    ).not.toBeNull()

    expect(() => root.file('worker-result.bpmn')).toThrow(/Missing fake file/)
    await user.click(screen.getByRole('button', { name: 'library.import.confirm' }))
    expect(
      await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    ).not.toBeNull()
    expect(latestWorkspaceImportReviewProps().plan.artifacts[0]?.sourceKind).toBe('library')
    expect(() => root.file('worker-result.bpmn')).toThrow(/Missing fake file/)
    await user.click(screen.getByRole('button', { name: 'mock-workspace-import-cancel' }))
    expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
    expect(() => root.file('worker-result.bpmn')).toThrow(/Missing fake file/)
  })

  it('reviews all picker files before a digest-bound workspace import commit', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    root.addFile('Finance/existing.bpmn', state.xml)
    await openDirectoryWorkspace(user, root)
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    const xml = withProcessId(state.xml, 'Process_Imported')
    const file = new File([xml], 'incoming.bpmn', { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(xml)
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(
      await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    ).not.toBeNull()
    const review = latestWorkspaceImportReviewProps()
    expect(review.plan.status).toBe('ready')
    expect(review.plan.reviewDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(review.plan.artifacts).toHaveLength(1)
    expect(() => root.file(review.plan.artifacts[0]!.destinationPath)).toThrow(/Missing fake file/)

    await act(async () => {
      review.onConfirm()
    })

    await waitFor(() => expect(root.file(review.plan.artifacts[0]!.destinationPath)).toBeDefined())
    expect(fakeFileText(root, review.plan.artifacts[0]!.destinationPath)).toBe(
      review.plan.artifacts[0]!.xml
    )
    expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
  })

  it('ignores cancellation after workspace import storage has committed', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    root.addFile('existing.bpmn', state.xml)
    await openDirectoryWorkspace(user, root)
    const incomingXml = withProcessId(state.xml, 'Process_Committed_Boundary')
    const file = new File([incomingXml], 'committed-boundary.bpmn', {
      type: 'application/xml'
    })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    const originalWriteAtomic = ManifestBoundWorkspaceAdapter.prototype.writeAtomic
    let committed!: () => void
    const committedWrite = new Promise<void>((resolve) => {
      committed = resolve
    })
    let release!: () => void
    const releaseOutcome = new Promise<void>((resolve) => {
      release = resolve
    })
    let operationSignal: AbortSignal | undefined
    vi.spyOn(ManifestBoundWorkspaceAdapter.prototype, 'writeAtomic').mockImplementation(
      async function (this: ManifestBoundWorkspaceAdapter, path, bytes, expectedHash, options) {
        const outcome = await originalWriteAtomic.call(this, path, bytes, expectedHash, options)
        if (path === 'committed-boundary.bpmn' && outcome.status === 'success') {
          operationSignal = options?.signal
          committed()
          await releaseOutcome
        }
        return outcome
      }
    )

    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    act(() => latestWorkspaceImportReviewProps().onConfirm())
    await committedWrite
    expect(fakeFileText(root, 'committed-boundary.bpmn')).toBe(incomingXml)
    const busyReview = latestWorkspaceImportReviewProps()
    expect(busyReview.busy).toBe(true)

    act(() => busyReview.onCancel())
    expect(operationSignal?.aborted).toBe(false)
    expect(latestWorkspaceImportReviewProps().busy).toBe(true)
    release()

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
    )
    expect(fakeFileText(root, 'committed-boundary.bpmn')).toBe(incomingXml)
  })

  it('suppresses save shortcuts until committed import reconciliation finishes', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'shortcut-import-lock.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const applyStarted = deferred()
    const releaseApply = deferred()
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: mocks.commandSave,
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async () => {
          applyStarted.resolve()
          await releaseApply.promise
        }
      })
    })
    const incomingXml = `${state.xml}\n<!-- shortcut-locked import -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    let review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    review = latestWorkspaceImportReviewProps()
    act(() => review.onConfirm())
    await applyStarted.promise
    expect(fakeFileText(root, path)).toBe(review.plan.artifacts[0]!.xml)
    expect(latestWorkspaceImportReviewProps().busy).toBe(true)

    const ctrlSave = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true
    })
    const metaSave = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      cancelable: true
    })
    window.dispatchEvent(ctrlSave)
    window.dispatchEvent(metaSave)
    expect(ctrlSave.defaultPrevented).toBe(true)
    expect(metaSave.defaultPrevented).toBe(true)
    expect(mocks.commandSave).not.toHaveBeenCalled()

    releaseApply.resolve()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
    )
    await act(async () => {
      await Promise.resolve()
    })
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    )
    expect(mocks.commandSave).toHaveBeenCalledOnce()
  })

  it('prompts for an immediate editor dirty signal before its XML debounce runs', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'immediate-dirty.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    const controller = latestSessionController()
    expect(controller.store.get(path)?.dirty).toBe(false)
    await user.click(screen.getByRole('button', { name: 'mock-editor-dirty' }))
    expect(controller.store.get(path)?.dirty).toBe(false)

    const incomingXml = `${state.xml}\n<!-- immediate dirty replacement -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    let review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    review = latestWorkspaceImportReviewProps()
    act(() => review.onConfirm())

    const dirtyPrompt = await screen.findByRole('dialog', {
      name: 'workspace.path.dirtyTitle'
    })
    await user.click(
      within(dirtyPrompt).getByRole('button', {
        name: 'workspace.path.cancel'
      })
    )
    expect(fakeFileText(root, path)).toBe(state.xml)
    expect(controller.store.get(path)).toBeDefined()
    expect(latestWorkspaceImportReviewProps().busy).toBe(false)
  })

  it('keeps the committed import baseline while an immediate dirty editor read fails', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'read-failure-after-commit.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: vi.fn(),
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async (xml) => {
          await mocks.importXml(xml)
        }
      })
    })
    const committedImport = deferred<{ warnings: string[] }>()
    mocks.importXml.mockImplementationOnce(() => committedImport.promise)
    const incomingXml = `${state.xml}\n<!-- committed read-failure replacement -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    let review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    review = latestWorkspaceImportReviewProps()
    act(() => review.onConfirm())
    await waitFor(() => expect(mocks.importXml).toHaveBeenCalledOnce())

    const readError = new Error('post-commit live editor serialization rejected')
    mocks.saveXml.mockRejectedValue(readError)
    act(() => editor.onDirtyChange(true))
    committedImport.resolve({ warnings: [] })

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
    )
    const committedXml = review.plan.artifacts[0]!.xml
    const session = latestSessionController().store.get(path)
    expect(fakeFileText(root, path)).toBe(committedXml)
    expect(session).toMatchObject({
      currentXml: state.xml,
      lastSavedXml: committedXml,
      dirty: true
    })
    expect(screen.getByTestId('editor-xml').textContent).toBe(state.xml)
    await waitFor(() =>
      expect(
        [...sessionHarness.drafts.values()].some(
          (draft) => draft.path === path && draft.xml === state.xml
        )
      ).toBe(true)
    )
    expect(mocks.importXml).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle(/post-commit live editor serialization rejected/u)).not.toBeNull()
  })

  it('re-captures and journals the newest edit when it changes during import draft flush', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'draft-flush-after-commit.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: vi.fn(),
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async (xml) => {
          await mocks.importXml(xml)
        }
      })
    })
    const committedImport = deferred<{ warnings: string[] }>()
    mocks.importXml.mockImplementationOnce(() => committedImport.promise)
    const incomingXml = `${state.xml}\n<!-- committed flush-race replacement -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    let review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    review = latestWorkspaceImportReviewProps()
    act(() => review.onConfirm())
    await waitFor(() => expect(mocks.importXml).toHaveBeenCalledOnce())

    const controller = latestSessionController()
    const session = controller.store.get(path)
    if (!session) throw new Error('expected an open persisted session')
    const firstLocalXml = `${state.xml}\n<!-- first edit during committed import -->`
    const newestLocalXml = `${state.xml}\n<!-- newest edit during draft flush -->`
    const putStarted = deferred()
    const releasePut = deferred()
    mocks.beforeDraftPut.mockImplementationOnce(async (record: TestDraftRecord) => {
      expect(record.xml).toBe(firstLocalXml)
      putStarted.resolve()
      await releasePut.promise
    })
    mocks.saveXml.mockResolvedValue({ xml: firstLocalXml })
    act(() => {
      controller.updateXml(session.id, firstLocalXml)
      editor.onDirtyChange(true)
    })
    committedImport.resolve({ warnings: [] })
    await putStarted.promise

    mocks.saveXml.mockResolvedValue({ xml: newestLocalXml })
    act(() => {
      controller.updateXml(session.id, newestLocalXml)
      editor.onDirtyChange(true)
    })
    releasePut.resolve()

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
    )
    const committedXml = review.plan.artifacts[0]!.xml
    expect(fakeFileText(root, path)).toBe(committedXml)
    expect(controller.store.get(session.id)).toMatchObject({
      currentXml: newestLocalXml,
      lastSavedXml: committedXml,
      dirty: true
    })
    await waitFor(() =>
      expect([...sessionHarness.drafts.values()].find((draft) => draft.path === path)?.xml).toBe(
        newestLocalXml
      )
    )
    expect(mocks.importXml).toHaveBeenCalledTimes(1)
    expect(mocks.importXml).toHaveBeenCalledWith(committedXml)
  })

  it('retains a newer local revision when it arrives during committed editor synchronization', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'concurrent-sync.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: vi.fn(),
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async (xml) => {
          await mocks.importXml(xml)
        }
      })
    })
    const controller = latestSessionController()
    const opened = controller.store.get(path)
    if (!opened) throw new Error('expected an open persisted session')
    let resolveCommittedImport!: (value: { warnings: string[] }) => void
    mocks.importXml.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCommittedImport = resolve
        })
    )

    const incomingXml = `${state.xml}\n<!-- committed replacement -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    let review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    review = latestWorkspaceImportReviewProps()
    act(() => review.onConfirm())
    await waitFor(() => expect(mocks.importXml).toHaveBeenCalledOnce())

    const concurrentXml = `${state.xml}\n<!-- newer local revision -->`
    act(() => {
      controller.updateXml(opened.id, concurrentXml)
    })
    await act(async () => {
      resolveCommittedImport({ warnings: [] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(fakeFileText(root, path)).toBe(review.plan.artifacts[0]!.xml)
      expect(controller.store.get(opened.id)).toMatchObject({
        currentXml: concurrentXml,
        lastSavedXml: review.plan.artifacts[0]!.xml,
        dirty: true,
        incarnation: opened.incarnation
      })
    })
    expect(screen.getByTestId('editor-xml').textContent).toBe(concurrentXml)
    expect(
      [...sessionHarness.drafts.values()].some(
        (draft) => draft.path === path && draft.xml === concurrentXml
      )
    ).toBe(true)
    expect(mocks.importXml).toHaveBeenLastCalledWith(concurrentXml)
  })

  it('preserves a dirty replacement on cancel and discards only the exact confirmed session', async () => {
    const user = userEvent.setup()
    const root = fakeRoot()
    const path = 'existing.bpmn'
    root.addFile(path, state.xml)
    await openDirectoryWorkspace(user, root)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    const controller = latestSessionController()
    const session = controller.store.get(path)
    if (!session) throw new Error('expected an open persisted session')
    const localXml = `${state.xml}\n<!-- retained local edit -->`
    controller.updateXml(session.id, localXml)
    const draft = seedDraft(session.identity.workspace.id, path, localXml)
    const incomingXml = `${state.xml}\n<!-- reviewed replacement -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')

    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    let review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a reviewed replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    review = latestWorkspaceImportReviewProps()
    act(() => review.onConfirm())
    let dirtyPrompt = await screen.findByRole('dialog', {
      name: 'workspace.path.dirtyTitle'
    })
    await user.click(
      within(dirtyPrompt).getByRole('button', {
        name: 'workspace.path.cancel'
      })
    )

    expect(fakeFileText(root, path)).toBe(state.xml)
    expect(controller.store.get(session.id)).toMatchObject({
      currentXml: localXml,
      dirty: true,
      incarnation: session.incarnation
    })
    expect(sessionHarness.drafts.has(draft.id)).toBe(true)
    expect(latestWorkspaceImportReviewProps().busy).toBe(false)

    act(() => latestWorkspaceImportReviewProps().onConfirm())
    dirtyPrompt = await screen.findByRole('dialog', {
      name: 'workspace.path.dirtyTitle'
    })
    await user.click(
      within(dirtyPrompt).getByRole('button', {
        name: 'workspace.path.continueWithoutSaving'
      })
    )

    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    review = latestWorkspaceImportReviewProps()
    const replannedCollision = review.plan.collisions[0]
    if (!replannedCollision) throw new Error('expected the discarded workspace to be re-planned')
    act(() => review.onDecision(replannedCollision.artifactId, { action: 'replace' }))
    act(() => latestWorkspaceImportReviewProps().onConfirm())

    await waitFor(() => expect(fakeFileText(root, path)).toBe(incomingXml))
    expect(controller.store.get(session.id)).toBeUndefined()
    expect(sessionHarness.drafts.has(draft.id)).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
  })

  it('aborts a reviewed import plan on workspace switch and ignores late confirmation', async () => {
    const user = userEvent.setup()
    const first = fakeRoot()
    first.addFile('first.bpmn', withProcessId(state.xml, 'Process_First'))
    const second = fakeRoot()
    second.addFile('second.bpmn', withProcessId(state.xml, 'Process_Second'))
    await openDirectoryWorkspace(user, first)
    const incomingXml = withProcessId(state.xml, 'Process_Reviewed_Switch')
    const file = new File([incomingXml], 'late-import.bpmn', { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })
    const review = await screen.findByRole('dialog', {
      name: 'mock-workspace-import-review'
    })
    const staleConfirm = within(review).getByRole('button', {
      name: 'mock-workspace-import-confirm'
    })

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'mock-workspace-import-review' })).toBeNull()
    )
    fireEvent.click(staleConfirm)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(() => first.file('late-import.bpmn')).toThrow(/Missing fake file/)
    expect(() => second.file('late-import.bpmn')).toThrow(/Missing fake file/)
    expect(latestSessionController().store.list()).toHaveLength(0)
  })

  it('does not leak a rejected old-workspace live read into the next workspace', async () => {
    const user = userEvent.setup()
    const first = fakeRoot()
    const path = 'stale-live-read.bpmn'
    first.addFile(path, state.xml)
    const second = fakeRoot()
    second.addFile('second.bpmn', withProcessId(state.xml, 'Process_Second_Live_Read'))
    await openDirectoryWorkspace(user, first)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const applyStarted = deferred()
    const releaseApply = deferred()
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: vi.fn(),
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async () => {
          applyStarted.resolve()
          await releaseApply.promise
        }
      })
    })
    const readStarted = deferred()
    const liveRead = deferred<{ xml: string }>()
    mocks.saveXml.mockImplementationOnce(() => {
      readStarted.resolve()
      return liveRead.promise
    })
    const incomingXml = `${state.xml}\n<!-- committed before stale live read -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    const review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    act(() => latestWorkspaceImportReviewProps().onConfirm())
    await applyStarted.promise
    act(() => editor.onDirtyChange(true))
    releaseApply.resolve()
    await readStarted.promise

    const oldController = latestSessionController()
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    const switchGuard = await screen.findByRole('dialog', { name: 'confirm.switch.title' })
    await user.click(within(switchGuard).getByRole('button', { name: 'confirm.switch.discard' }))
    await waitFor(() => expect(latestSessionController()).not.toBe(oldController))
    expect(await screen.findByTestId('catalog-view')).not.toBeNull()

    liveRead.reject(new Error('late stale old-workspace live read'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByTitle(/late stale old-workspace live read/u)).toBeNull()
    expect(screen.queryByText('session.save.reloadEditorFailed')).toBeNull()
    expect(latestSessionController().store.list()).toHaveLength(0)
  })

  it('does not carry an old-workspace draft flush rejection into the next workspace', async () => {
    const user = userEvent.setup()
    const first = fakeRoot()
    const path = 'stale-draft-flush.bpmn'
    first.addFile(path, state.xml)
    const second = fakeRoot()
    second.addFile('second.bpmn', withProcessId(state.xml, 'Process_Second_Draft_Flush'))
    await openDirectoryWorkspace(user, first)
    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => tree.onOpenFile(path))
    await screen.findByTestId('editor-tab')
    await user.click(screen.getByRole('button', { name: 'mock-editor-ready' }))
    const applyStarted = deferred()
    const releaseApply = deferred()
    const editor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onDirtyChange(dirty: boolean): void
      onCommandsReady(commands: {
        save(): void
        exportSvg(): void
        exportPng(): void
        applyExternalXml(xml: string): Promise<void>
      }): void
    }
    act(() => {
      editor.onCommandsReady({
        save: vi.fn(),
        exportSvg: vi.fn(),
        exportPng: vi.fn(),
        applyExternalXml: async () => {
          applyStarted.resolve()
          await releaseApply.promise
        }
      })
    })
    const localXml = `${state.xml}\n<!-- retained before stale draft rejection -->`
    const putStarted = deferred()
    const rejectPut = deferred()
    mocks.beforeDraftPut.mockImplementationOnce(async (record: TestDraftRecord) => {
      expect(record.xml).toBe(localXml)
      putStarted.resolve()
      await rejectPut.promise
    })
    mocks.saveXml.mockResolvedValue({ xml: localXml })
    const incomingXml = `${state.xml}\n<!-- committed before stale draft rejection -->`
    const file = new File([incomingXml], path, { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => utf8Buffer(incomingXml)
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByRole('dialog', { name: 'mock-workspace-import-review' })
    const review = latestWorkspaceImportReviewProps()
    const collision = review.plan.collisions[0]
    if (!collision) throw new Error('expected a replacement collision')
    act(() => review.onDecision(collision.artifactId, { action: 'replace' }))
    act(() => latestWorkspaceImportReviewProps().onConfirm())
    await applyStarted.promise
    const oldController = latestSessionController()
    const session = oldController.store.get(path)
    if (!session) throw new Error('expected an open persisted session')
    act(() => {
      oldController.updateXml(session.id, localXml)
      editor.onDirtyChange(true)
    })
    releaseApply.resolve()
    await putStarted.promise

    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    const switchGuard = await screen.findByRole('dialog', { name: 'confirm.switch.title' })
    rejectPut.reject(new Error('late stale old-workspace draft flush'))
    await user.click(within(switchGuard).getByRole('button', { name: 'confirm.switch.discard' }))
    await waitFor(() => expect(latestSessionController()).not.toBe(oldController))
    expect(await screen.findByTestId('catalog-view')).not.toBeNull()

    expect(screen.queryByTitle(/late stale old-workspace draft flush/u)).toBeNull()
    expect(screen.queryByText('draftRecovery.error')).toBeNull()
    expect(latestSessionController().store.list()).toHaveLength(0)
  })

  it('rejects an oversized multi-file picker item before allocating its bytes', async () => {
    await openDirectoryWorkspace(userEvent.setup())
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing workspace import input')
    const file = new File(['small'], 'oversized.bpmn', { type: 'application/xml' })
    const arrayBuffer = vi.fn(async () => utf8Buffer('small'))
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: MAX_DROPPED_IMPORT_BYTES + 1
    })
    Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: arrayBuffer })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('alert.import.failed')).not.toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mocks.workspaceImportReviewProps).not.toHaveBeenCalled()
  })

  it('cancels the active and queued draft reviews when the workspace switches', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    await openDirectoryWorkspace(user, first)
    const workspaceId = (
      mocks.workspaceLocalizationFactories.mock.calls.at(-1)?.[0] as { id: string }
    ).id
    seedDraft(workspaceId, 'Finance/existing.bpmn', `${state.xml}\n<!-- first -->`)
    seedDraft(workspaceId, 'Finance/delete-me.bpmn', `${state.xml}\n<!-- second -->`)
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))

    const tree = mocks.folderTreeProps.mock.calls.at(-1)?.[0] as {
      onOpenFile(path: string): void
    }
    act(() => {
      tree.onOpenFile('Finance/existing.bpmn')
      tree.onOpenFile('Finance/delete-me.bpmn')
    })
    expect(await screen.findByRole('dialog', { name: 'draftRecovery.title' })).not.toBeNull()
    expect(screen.getAllByRole('dialog', { name: 'draftRecovery.title' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'draftRecovery.title' })).toBeNull()
    )
    expect(await screen.findByTestId('catalog-view')).not.toBeNull()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog', { name: 'draftRecovery.title' })).toBeNull()
  })

  it('creates, renames, deletes, and moves directory entries through guarded UI flows', async () => {
    const user = userEvent.setup()
    const root = await openDirectoryWorkspace(user)
    mocks.prompt
      .mockResolvedValueOnce('Archive')
      .mockResolvedValueOnce('New approval')
      .mockResolvedValueOnce('renamed')

    await user.click(screen.getByRole('button', { name: 'mock-tree-new-folder' }))
    await waitFor(() => expect(root.directory('Archive')).toBeDefined())

    await user.click(screen.getByRole('button', { name: 'mock-tree-new-process' }))
    await waitFor(() => expect(root.file('Finance/new-approval.bpmn')).toBeDefined())
    await screen.findByRole('tab', { name: 'new-approval.bpmn' })

    const rail = screen.getByRole('button', { name: 'sidebar.toggle.aria' })
    await waitFor(() => expect(rail.getAttribute('aria-expanded')).toBe('false'))
    await user.click(rail)
    await user.click(screen.getByRole('button', { name: 'mock-tree-rename' }))
    await waitFor(() => expect(root.file('Finance/renamed.bpmn')).toBeDefined())

    await user.click(screen.getByRole('button', { name: 'mock-tree-delete' }))
    const deleteDialog = await screen.findByRole('dialog')
    await user.click(within(deleteDialog).getByRole('button', { name: 'confirmDialog.confirm' }))
    await waitFor(() =>
      expect(() => root.file('Finance/delete-me.bpmn')).toThrow(/Missing fake file/)
    )

    await user.click(screen.getByRole('button', { name: 'mock-tree-move' }))
    const moveDialog = await screen.findByRole('dialog', { name: 'mock-move' })
    await user.click(within(moveDialog).getByRole('button', { name: 'mock-move-confirm' }))
    await waitFor(() => expect(root.file('move-me.bpmn')).toBeDefined())
    await waitFor(() => expect(screen.getAllByText('toast.moved')).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'mock-tree-move-drop' }))
    await waitFor(() => expect(root.file('drop-me.bpmn')).toBeDefined())
    await waitFor(() => expect(screen.getAllByText('toast.moved')).toHaveLength(2))
  })

  it('prompts once for dirty work and honors cancel then discard during folder switches', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    state.directorySupport = true
    mocks.pickWorkspace
      .mockResolvedValueOnce(asDirectoryHandle(first))
      .mockResolvedValueOnce(asDirectoryHandle(second))
      .mockResolvedValueOnce(asDirectoryHandle(second))
    render(<App />)

    await user.click(
      await screen.findByRole('button', { name: 'workspace.storage.chooseDirectory' })
    )
    await user.click(await screen.findByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-dirty' }))
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))

    let guard = await screen.findByRole('dialog')
    await user.click(within(guard).getByRole('button', { name: 'confirm.switch.cancel' }))
    expect((await screen.findAllByText('existing.bpmn')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    guard = await screen.findByRole('dialog')
    await user.click(within(guard).getByRole('button', { name: 'confirm.switch.discard' }))
    await waitFor(() => expect(screen.queryByText('existing.bpmn')).toBeNull())
    expect(await screen.findByTestId('catalog-view')).not.toBeNull()
  })

  it('requires explicit confirmation after Save all downloads a virtual draft', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    await openDirectoryWorkspace(user, first)
    mocks.pickWorkspace.mockResolvedValue(asDirectoryHandle(second))

    const rail = screen.getByRole('button', { name: 'sidebar.toggle.aria' })
    if (rail.getAttribute('aria-expanded') === 'false') await user.click(rail)
    await user.click(await screen.findByRole('button', { name: 'mock-sheet-open' }))
    expect(
      await screen.findByRole('tab', {
        name: /sheet-flow\.bpmn.*tab\.dirty\.aria/
      })
    ).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    const unsaved = await screen.findByRole('dialog', { name: 'confirm.switch.title' })
    await user.click(within(unsaved).getByRole('button', { name: 'confirm.switch.saveAll' }))

    const downloaded = await screen.findByRole('dialog', {
      name: 'confirm.switch.downloadedTitle'
    })
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'sheet-flow.bpmn',
      expect.stringContaining('data:application/xml')
    )
    expect(latestSessionController().store.getActive()?.dirty).toBe(true)
    await user.click(within(downloaded).getByRole('button', { name: 'confirm.switch.continue' }))
    expect(await screen.findByTestId('catalog-view')).not.toBeNull()
    await waitFor(() => expect(screen.queryByText(/sheet-flow\.bpmn/)).toBeNull())
  })
})
