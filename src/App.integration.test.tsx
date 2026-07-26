// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  kind: 'saved' | 'moved' | 'deleted'
  path: string
  previousPath?: string
}

interface TestWorkspaceCoordinator {
  emit(change: TestWorkspaceChange): void
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
  lang: 'en' as 'en' | 'ar',
  promptResult: 'Claims approval',
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_Test" targetNamespace="https://orbitpm.local/test">
  <bpmn:process id="Process_Test" name="Test process" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
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
  saveSvg: vi.fn(),
  saveXml: vi.fn(),
  commandSave: vi.fn(),
  commandUndo: vi.fn(),
  commandRedo: vi.fn(),
  validateBpmn: vi.fn(),
  evaluatePolicy: vi.fn(),
  validatePreservation: vi.fn(),
  pickWorkspace: vi.fn(),
  rememberWorkspace: vi.fn(),
  loadRememberedWorkspace: vi.fn(),
  ensurePermission: vi.fn(),
  classifyPickerError: vi.fn(),
  folderTreeProps: vi.fn(),
  catalogProps: vi.fn(),
  moveDialogProps: vi.fn(),
  readLibraryZipFileInWorker: vi.fn()
}))

vi.mock('./i18n', () => ({
  t: (key: string, values?: Record<string, unknown>): string => {
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
  validateUnknownExtensionPreservation: mocks.validatePreservation
}))

vi.mock('./sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sessions')>()

  class TestIndexedDbDraftJournal {
    constructor() {
      if (!sessionHarness.indexedDbAvailable) throw new Error('IndexedDB unavailable')
    }

    async put(record: TestDraftRecord): Promise<void> {
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
    IndexedDbDraftJournal: TestIndexedDbDraftJournal
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
  saveXML: (): Promise<{ xml: string }> => mocks.saveXml()
}

vi.mock('./ai/AiPanelLite', () => ({
  AiPanelLite: (props: {
    onPlaceGenerated(
      xml: string,
      options: {
        name?: string
        targetFolder?: string
        gen?: number
        localizationSource?: string
      }
    ): Promise<unknown> | unknown
    getWorkspaceGen?(): number
    onOpenSettings(): void
    onContinueInChat?(info: { description: string }): void
    spreadsheet: {
      onOpenSingle(xml: string, name: string): void
      onOpenBilingualReview(xml: string, name: string): void
    }
  }) => {
    mocks.aiProps(props)
    return (
      <div data-testid="ai-panel">
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
              localizationSource: 'ai'
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
          onClick={() => props.spreadsheet.onOpenBilingualReview(state.xml, 'bilingual-flow.bpmn')}
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
    onApplyXml?(tabKey: string, xml: string): Promise<void> | void
  }) => {
    mocks.assistantProps(props)
    return (
      <div data-testid="assistant-drawer">
        <button type="button" onClick={props.open ? props.onClose : props.onOpen}>
          {props.open ? 'mock-assistant-close' : 'mock-assistant-open'}
        </button>
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

import { asDirectoryHandle, fakeRoot } from './workspace/adapters/__tests__/fakeFileSystem'
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
import { SEEDED_GLOSSARY } from './localization/glossary'
import type { LocalizationResourcesEditorProps } from './settings/LocalizationResourcesEditor'
import App from './App'

function latestSessionController(): import('./sessions').DocumentSessionController {
  const controller = sessionHarness.controllers.at(-1)
  if (!controller) throw new Error('App did not create a document-session controller')
  return controller as import('./sessions').DocumentSessionController
}

function utf8Buffer(value: string): ArrayBuffer {
  return Uint8Array.from(new TextEncoder().encode(value)).buffer
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
  vi.stubGlobal('__APP_VERSION__', '0.4.5')
  vi.stubGlobal('BroadcastChannel', class TestBroadcastChannel {})
  sessionHarness.indexedDbAvailable = true
  sessionHarness.drafts.clear()
  sessionHarness.controllers.length = 0
  sessionHarness.coordinators.length = 0
  sessionHarness.publishedChanges.length = 0
  state.directorySupport = false
  state.opfsSupport = false
  state.lang = 'en'
  state.promptResult = 'Claims approval'
  mocks.prompt.mockReset().mockImplementation(async () => state.promptResult)
  mocks.triggerDownload.mockReset()
  mocks.setLang.mockReset()
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
  mocks.saveSvg.mockReset().mockResolvedValue({ svg: '<svg />' })
  mocks.saveXml.mockReset().mockResolvedValue({ xml: state.xml })
  mocks.commandSave.mockReset()
  mocks.commandUndo.mockReset()
  mocks.commandRedo.mockReset()
  mocks.validateBpmn.mockReset().mockResolvedValue({
    summary: { valid: true, issues: [] }
  })
  mocks.evaluatePolicy.mockReset().mockReturnValue({
    allowed: true,
    blockingIssues: []
  })
  mocks.validatePreservation.mockReset().mockResolvedValue({
    valid: true,
    issues: []
  })
  mocks.pickWorkspace.mockReset().mockResolvedValue(null)
  mocks.rememberWorkspace.mockReset().mockResolvedValue(undefined)
  mocks.loadRememberedWorkspace.mockReset().mockResolvedValue(undefined)
  mocks.ensurePermission.mockReset().mockResolvedValue('granted')
  mocks.classifyPickerError.mockReset().mockReturnValue('unknown')
  mocks.folderTreeProps.mockReset()
  mocks.catalogProps.mockReset()
  mocks.moveDialogProps.mockReset()
  mocks.readLibraryZipFileInWorker.mockReset().mockResolvedValue({
    entries: [],
    skipped: []
  })
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

function populatedDirectory() {
  const root = fakeRoot()
  root.addFile('Finance/existing.bpmn', state.xml)
  root.addFile('Finance/delete-me.bpmn', state.xml)
  root.addFile('Finance/move-me.bpmn', state.xml)
  root.addFile('Finance/drop-me.bpmn', state.xml)
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

function latestSettingsLocalization(): LocalizationResourcesEditorProps {
  const props = mocks.settingsProps.mock.calls.at(-1)?.[0] as
    { localizationResources?: LocalizationResourcesEditorProps } | undefined
  if (!props?.localizationResources) {
    throw new Error('App did not expose workspace localization Settings props')
  }
  return props.localizationResources
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
    await user.click(screen.getByRole('button', { name: 'ai.header' }))
    expect(screen.queryByTestId('ai-panel')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'ai.header' }))
    expect(screen.getByTestId('ai-panel')).not.toBeNull()

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

  it('warns when persistent browser draft recovery is unavailable', async () => {
    sessionHarness.indexedDbAvailable = false
    const user = userEvent.setup()
    await openBlankDiagram(user)
    expect(await screen.findByText('draftRecovery.degraded')).not.toBeNull()
  })

  it('creates a named process, preserves dirty work on cancel, saves, and closes it', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
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
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByTestId('editor-tab')).not.toBeNull()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'mock-editor-save' }))
    await waitFor(() => expect(mocks.validatePreservation).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'mock-editor-clean' }))
    await user.click(screen.getByTitle('tab.closeTitle'))
    expect(await screen.findByText('emptyTab.fallback')).not.toBeNull()
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
    await user.click(screen.getByRole('button', { name: 'mock-sheet-review' }))
    expect(await screen.findByText(/bilingual-flow\.bpmn/)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'mock-ai-chat' }))
    expect(await screen.findByRole('button', { name: 'mock-assistant-close' })).not.toBeNull()
  })

  it('sets up one session controller, routes save to only the active tab, and guards dirty unloads', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    const controller = latestSessionController()
    expect(controller.store.list()).toHaveLength(1)
    const firstEditor = mocks.editorProps.mock.calls.at(-1)?.[0] as {
      onCommandsReady(commands: { save(): void }): void
    }
    const firstSave = vi.fn()
    act(() => firstEditor.onCommandsReady({ save: firstSave }))

    await user.click(screen.getByRole('button', { name: 'mock-editor-dirty' }))
    const dirtyExit = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyExit)
    expect(dirtyExit.defaultPrevented).toBe(true)

    await user.click(screen.getByRole('button', { name: 'mock-editor-clean' }))
    const cleanExit = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanExit)
    expect(cleanExit.defaultPrevented).toBe(false)

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
    expect(sessionHarness.drafts.has(draft.id)).toBe(false)
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
})

describe('App directory workspace orchestration', () => {
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
      savedState = await initial.onSaveGlossary(savedGlossary)
    })
    await waitFor(() => expect(latestSettingsLocalization().snapshot).toBe(savedState!))
    expect(JSON.parse(fakeFileText(root, WORKSPACE_GLOSSARY_PATH)).entries).toEqual(savedGlossary)

    const beforeRejectedMemory = fakeFileText(root, WORKSPACE_TRANSLATION_MEMORY_PATH)
    const beforeRejectedSnapshot = latestSettingsLocalization().snapshot
    await expect(
      latestSettingsLocalization().onSaveTranslationMemory([
        {
          en: 'Unreviewed result',
          ar: 'نتيجة غير مراجعة',
          accepted: false
        } as never
      ])
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
      stale.onSaveGlossary([{ en: 'Stale term', ar: 'مصطلح قديم' }])
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
      firstSettings.onSaveGlossary([{ en: 'Late write', ar: 'كتابة متأخرة' }])
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fakeFileText(first, WORKSPACE_GLOSSARY_PATH)).toBe(firstGlossaryBytes)
    expect(JSON.parse(fakeFileText(second, WORKSPACE_GLOSSARY_PATH)).entries).toEqual([
      { en: 'Second term', ar: 'المصطلح الثاني' }
    ])
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
      failed.onSaveGlossary([{ en: 'Must not write', ar: 'يجب ألا يكتب' }])
    ).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    expect(fakeFileText(root, WORKSPACE_GLOSSARY_PATH)).toBe(corrupt)

    await user.click(within(settingsDialog).getByRole('button', { name: 'mock-settings-close' }))
    await user.click(screen.getByRole('button', { name: 'mock-tree-open' }))
    await user.click(await screen.findByRole('button', { name: 'mock-editor-ready' }))
    await user.click(screen.getByRole('button', { name: 'editor.translate' }))
    const safeReview = mocks.translationReviewProps.mock.calls.at(-1)?.[0]
      .review as import('./localization/modelerAdapter').DiagramLocalizationReview
    expect(safeReview.localResources).toEqual({
      glossary: SEEDED_GLOSSARY,
      translationMemory: []
    })
    await user.click(screen.getByRole('button', { name: 'translationReview.postpone' }))

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
  })

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
      await latestSettingsLocalization().onSaveGlossary(updatedGlossary)
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

  it('hands library ZIP Files directly to the browser worker boundary', async () => {
    const user = userEvent.setup()
    await openDirectoryWorkspace(user)
    mocks.readLibraryZipFileInWorker.mockResolvedValueOnce({
      entries: [{ relPath: 'worker-result.bpmn', xml: state.xml }],
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

    await waitFor(() => expect(mocks.readLibraryZipFileInWorker).toHaveBeenCalledWith(file))
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('dialog', { name: 'library.import.confirmTitle' })
    ).not.toBeNull()
  })

  it('cancels the active and queued draft reviews when the workspace switches', async () => {
    const user = userEvent.setup()
    const first = populatedDirectory()
    const second = fakeRoot()
    second.addFile('second.bpmn', state.xml)
    seedDraft('directory:workspace', 'Finance/existing.bpmn', `${state.xml}\n<!-- first -->`)
    seedDraft('directory:workspace', 'Finance/delete-me.bpmn', `${state.xml}\n<!-- second -->`)
    await openDirectoryWorkspace(user, first)
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

    const rail = screen.getByRole('button', { name: 'sidebar.toggle.aria' })
    if (rail.getAttribute('aria-expanded') === 'false') await user.click(rail)
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

    await user.click(screen.getByRole('button', { name: 'mock-tree-move-drop' }))
    await waitFor(() => expect(root.file('drop-me.bpmn')).toBeDefined())
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
