// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  assistantProps: vi.fn(),
  printJobs: vi.fn(),
  modelerGet: vi.fn(),
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
  moveDialogProps: vi.fn()
}))

vi.mock('./i18n', () => ({
  t: (key: string): string => key,
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

vi.mock('./editor/EditorTabLite', () => ({
  EditorTab: (props: {
    xml: string
    onDirtyChange(dirty: boolean): void
    onRequestSave(
      xml: string,
      options?: { explicitDraftWithErrors?: boolean }
    ): Promise<void> | void
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
  }) => {
    mocks.settingsProps(props)
    return props.open ? (
      <div role="dialog" aria-label="mock-settings">
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
import App from './App'

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', '0.4.5')
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
  mocks.assistantProps.mockReset()
  mocks.printJobs.mockReset()
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
  it('opens a blank diagram and drives shell, settings, assistant, and language state', async () => {
    const user = userEvent.setup()
    await openBlankDiagram(user)

    expect(screen.getByLabelText('Version 0.4.5')).not.toBeNull()
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

  it('creates a named process, preserves dirty work on cancel, saves, and closes it', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'picker.fallback.newProcess' }))
    expect((await screen.findAllByText('claims-approval.bpmn')).length).toBeGreaterThan(0)
    expect(mocks.prompt).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'mock-editor-dirty' }))
    expect(screen.getByText(/● claims-approval\.bpmn/)).not.toBeNull()
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
    await waitFor(() => expect(screen.getByText('ai-claims.bpmn')).not.toBeNull())
    expect(mocks.validateBpmn).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'mock-sheet-open' }))
    expect(await screen.findByText('sheet-flow.bpmn')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'mock-sheet-review' }))
    expect(await screen.findByText('bilingual-flow.bpmn')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'mock-ai-chat' }))
    expect(await screen.findByRole('button', { name: 'mock-assistant-close' })).not.toBeNull()
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
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: async () => state.xml
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
    Object.defineProperty(bad, 'text', {
      configurable: true,
      value: async () => 'bad'
    })
    fireEvent.change(badInput, { target: { files: [bad] } })
    expect(await screen.findByText('alert.open.failed')).not.toBeNull()
    expect(user).toBeDefined()
  })
})

describe('App directory workspace orchestration', () => {
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

    const search = screen.getByRole('searchbox', { name: 'tree.search.aria' })
    await user.type(search, 'Test process')
    fireEvent.keyDown(search, { key: 'Escape' })
    fireEvent.keyDown(search, { key: 'Enter' })

    await user.click(screen.getByRole('button', { name: 'tree.refresh.aria' }))
    expect(await screen.findByText('toast.refreshed')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'library.export' }))
    expect(mocks.triggerDownload).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'workspace.storage.backupExport' }))
    expect(await screen.findByText('workspace.storage.backupExport')).not.toBeNull()

    fireEvent.keyDown(window, { altKey: true, key: 'ArrowLeft' })
    fireEvent.keyDown(window, { altKey: true, key: 'ArrowRight' })
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
})
