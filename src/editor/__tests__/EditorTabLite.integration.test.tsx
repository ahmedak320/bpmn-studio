// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createValidationSummary,
  type ValidationIssue,
  type ValidationSummary
} from '../../validation/contracts'

type EventHandler = (event: { element?: unknown }) => unknown

const fake = vi.hoisted(() => ({
  stackIndex: 0,
  zoomLevel: 1,
  currentXml: '<definitions id="original" />',
  importWarnings: [] as string[],
  importError: null as Error | null,
  saveXmlError: null as Error | null,
  saveXmlMissing: false,
  saveSvgError: null as Error | null,
  scrollError: false,
  elements: [] as Array<{
    id?: string
    type?: string
    businessObject?: {
      id?: string
      calledElement?: string
    }
    labelTarget?: unknown
    waypoints?: unknown
  }>,
  handlers: new Map<string, EventHandler>(),
  selected: null as unknown,
  destroyed: false,
  validationSummary: null as ValidationSummary | null,
  preservationSummary: null as ValidationSummary | null
}))

const mocks = vi.hoisted(() => ({
  zoom: vi.fn(),
  scrollToElement: vi.fn(),
  selectionSelect: vi.fn(),
  modelingUpdate: vi.fn(),
  modelerReady: vi.fn(),
  triggerDownload: vi.fn(),
  validateBpmnXml: vi.fn(),
  validatePreservation: vi.fn(),
  layout: vi.fn(),
  pdf: vi.fn(),
  onValidationRun: vi.fn(),
  onSourceValidate: vi.fn(),
  onSourceApply: vi.fn(),
  onSourceAutoLayout: vi.fn()
}))

vi.mock('../../i18n', () => ({
  t: (key: string): string => key
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' => 'en'
}))

vi.mock('bpmn-js-properties-panel', () => ({
  BpmnPropertiesPanelModule: {},
  BpmnPropertiesProviderModule: {}
}))

vi.mock('bpmn-js-create-append-anything', () => ({
  CreateAppendAnythingModule: {}
}))

vi.mock('bpmn-js-bpmnlint', () => ({
  default: {}
}))

vi.mock('diagram-js-minimap', () => ({
  default: {}
}))

vi.mock('../../org/orgRenderer', () => ({
  OrgRenderModule: {}
}))

vi.mock('../../org/connectedEdgeHighlight', () => ({
  ConnectedEdgeHighlightModule: {}
}))

vi.mock('../modelingBatch', () => ({
  ModelingBatchModule: {}
}))

vi.mock('../bidiTextRenderer', () => ({
  BidiTextRendererModule: {}
}))

vi.mock('bpmn-js/lib/Modeler', () => ({
  default: class MockBpmnModeler {
    private readonly commandStack = {
      get _stackIdx(): number {
        return fake.stackIndex
      }
    }

    private readonly canvas = {
      zoom: (value?: number | 'fit-viewport'): number | void => {
        mocks.zoom(value)
        if (value === undefined) return fake.zoomLevel
        if (typeof value === 'number') fake.zoomLevel = value
      },
      viewbox: () => ({ width: 640, height: 480 }),
      getRootElement: () => ({
        id: 'Process_1',
        type: 'bpmn:Process',
        businessObject: { id: 'Process_1' }
      }),
      scrollToElement: (element: unknown, padding?: number) => {
        mocks.scrollToElement(element, padding)
        if (fake.scrollError) throw new Error('scroll failed')
      }
    }

    private readonly eventBus = {
      on: (event: string, _priority: number, handler: EventHandler): void => {
        fake.handlers.set(event, handler)
      },
      off: (event: string, handler: EventHandler): void => {
        if (fake.handlers.get(event) === handler) fake.handlers.delete(event)
      }
    }

    private readonly registry = {
      getAll: () => fake.elements,
      get: (id: string) => fake.elements.find((element) => element.id === id)
    }

    private readonly selection = {
      select: (element: unknown): void => {
        fake.selected = element
        mocks.selectionSelect(element)
      }
    }

    private readonly modeling = {
      updateProperties: (element: unknown, properties: Record<string, unknown>): void => {
        mocks.modelingUpdate(element, properties)
        fake.stackIndex += 1
        fake.handlers.get('commandStack.changed')?.({})
      }
    }

    constructor() {
      fake.destroyed = false
    }

    async importXML(xml: string): Promise<{ warnings: string[] }> {
      if (fake.importError) throw fake.importError
      fake.currentXml = xml
      return { warnings: fake.importWarnings }
    }

    async saveXML(): Promise<{ xml?: string }> {
      if (fake.saveXmlError) throw fake.saveXmlError
      return fake.saveXmlMissing ? {} : { xml: fake.currentXml }
    }

    async saveSVG(): Promise<{ svg: string }> {
      if (fake.saveSvgError) throw fake.saveSvgError
      return { svg: '<svg viewBox="0 0 640 480"></svg>' }
    }

    get(name: string): unknown {
      switch (name) {
        case 'commandStack':
          return this.commandStack
        case 'canvas':
          return this.canvas
        case 'eventBus':
          return this.eventBus
        case 'elementRegistry':
          return this.registry
        case 'selection':
          return this.selection
        case 'modeling':
          return this.modeling
        default:
          throw new Error(`Unknown service ${name}`)
      }
    }

    destroy(): void {
      fake.destroyed = true
    }
  }
}))

vi.mock('../dragWatchdog', () => ({
  installDragWatchdog: () => () => undefined
}))

vi.mock('../paletteDrag', () => ({
  installPaletteDrag: () => () => undefined
}))

vi.mock('../canvasDecor', () => ({
  installCanvasDecor: (
    _canvas: HTMLElement,
    _root: HTMLElement,
    options: { onBadgeClick: (elementId: string, missing: string[]) => void }
  ) => {
    ;(
      window as typeof window & {
        __orbitpmBadgeClick?: (elementId: string, missing: string[]) => void
      }
    ).__orbitpmBadgeClick = options.onBadgeClick
    return () => undefined
  }
}))

vi.mock('../labelSync', () => ({
  installLabelBilingualSync: () => () => undefined
}))

vi.mock('../autoSize', () => ({
  installAutoSize: () => () => undefined
}))

vi.mock('../../org/automaticConnectionRouting', () => ({
  installAutomaticConnectionRouting: () => () => undefined
}))

vi.mock('../../org/orgSettings', () => ({
  refreshOrgStyling: () => undefined
}))

vi.mock('../../org/ShapeLegend', () => ({
  ShapeLegend: () => <div data-testid="shape-legend">legend</div>
}))

vi.mock('../exportImage', () => ({
  computeExportSize: () => ({ width: 640, height: 480 }),
  svgToPngDataUrl: async () => 'data:image/png;base64,AQID',
  svgToDataUrl: () => 'data:image/svg+xml;base64,PHN2Zy8+',
  triggerDownload: mocks.triggerDownload
}))

vi.mock('../exportPdf', () => ({
  createDeterministicDiagramPdf: mocks.pdf
}))

vi.mock('../../generation/layout', () => ({
  layoutBpmnValidated: mocks.layout
}))

vi.mock('../../validation/model', () => ({
  validateBpmnXml: mocks.validateBpmnXml
}))

vi.mock('../../validation/runtimeAdapters', () => ({
  getRuntimeValidationAdapters: () => ({})
}))

vi.mock('../../validation/extensions', () => ({
  validateUnknownExtensionPreservation: mocks.validatePreservation
}))

vi.mock('../../validation/ValidationCenter', () => ({
  ValidationCenter: (props: {
    open: boolean
    summary: ValidationSummary | null
    onClose: () => void
    onRun: () => void
    onFocus: (issue: ValidationIssue) => void
    onRepair: (issue: ValidationIssue) => void
  }) => {
    if (!props.open) return null
    const focusIssue: ValidationIssue = {
      code: 'semantic.focus',
      severity: 'error',
      source: 'semantic',
      message: 'focus',
      blocking: true,
      elementId: 'Task_1'
    }
    const repairIssue: ValidationIssue = {
      code: 'di.repair',
      severity: 'error',
      source: 'di',
      message: 'repair',
      blocking: true,
      location: { line: 2, column: 3 }
    }
    return (
      <div role="dialog" aria-label="validation-center">
        <span>{props.summary?.blockingErrors ?? 0}</span>
        <button
          type="button"
          onClick={() => {
            mocks.onValidationRun()
            props.onRun()
          }}
        >
          validation-run
        </button>
        <button type="button" onClick={() => props.onFocus(focusIssue)}>
          validation-focus
        </button>
        <button type="button" onClick={() => props.onRepair(repairIssue)}>
          validation-repair
        </button>
        <button type="button" onClick={props.onClose}>
          validation-close
        </button>
      </div>
    )
  }
}))

vi.mock('../../validation/SourceEditorDialog', () => ({
  SourceEditorDialog: (props: {
    open: boolean
    originalXml: string
    validate: (xml: string, requireDi: boolean) => Promise<ValidationSummary>
    apply: (xml: string) => Promise<void>
    autoLayout: (xml: string) => Promise<string>
    onClose: () => void
  }) => {
    if (!props.open) return null
    return (
      <div role="dialog" aria-label="source-editor">
        <span>{props.originalXml}</span>
        <button
          type="button"
          onClick={() => {
            void props.validate('<definitions id="candidate" />', true).then(() => {
              mocks.onSourceValidate()
            })
          }}
        >
          source-validate
        </button>
        <button
          type="button"
          onClick={() => {
            void props.apply('<definitions id="candidate" />').then(() => {
              mocks.onSourceApply()
            })
          }}
        >
          source-apply
        </button>
        <button
          type="button"
          onClick={() => {
            void props.autoLayout('<definitions id="candidate" />').then(() => {
              mocks.onSourceAutoLayout()
            })
          }}
        >
          source-layout
        </button>
        <button type="button" onClick={props.onClose}>
          source-close
        </button>
      </div>
    )
  }
}))

vi.mock('../../validation/SaveDraftDialog', () => ({
  SaveDraftDialog: (props: {
    summary: ValidationSummary | null
    onConfirm: () => void
    onCancel: () => void
  }) =>
    props.summary ? (
      <div role="dialog" aria-label="save-draft">
        <button type="button" onClick={props.onConfirm}>
          draft-confirm
        </button>
        <button type="button" onClick={props.onCancel}>
          draft-cancel
        </button>
      </div>
    ) : null
}))

import {
  DETAILS_OPEN_PREFERENCE_KEY,
  DETAILS_WIDTH_PREFERENCE_KEY,
  EditorTab,
  type EditorTabCommands,
  type EditorTabProps
} from '../EditorTabLite'

const validSummary = createValidationSummary([], {
  xmlWellFormed: true
})
const semanticIssue: ValidationIssue = {
  code: 'semantic.blocker',
  severity: 'error',
  source: 'semantic',
  message: 'Semantic error',
  blocking: true,
  elementId: 'Task_1'
}
const semanticSummary = createValidationSummary([semanticIssue], {
  xmlWellFormed: true
})

function renderEditor(overrides: Partial<EditorTabProps> = {}): ReturnType<typeof render> {
  return render(
    <EditorTab
      xml='<definitions id="original" />'
      onDirtyChange={vi.fn()}
      onRequestSave={vi.fn().mockResolvedValue(undefined)}
      knownProcessIds={['leave']}
      exportFileBaseName="leave-process"
      {...overrides}
    />
  )
}

function emit(event: string, payload: { element?: unknown } = {}): unknown {
  return fake.handlers.get(event)?.(payload)
}

beforeEach(() => {
  fake.stackIndex = 0
  fake.zoomLevel = 1
  fake.currentXml = '<definitions id="original" />'
  fake.importWarnings = []
  fake.importError = null
  fake.saveXmlError = null
  fake.saveXmlMissing = false
  fake.saveSvgError = null
  fake.scrollError = false
  fake.elements = [
    {
      id: 'Task_1',
      type: 'bpmn:UserTask',
      businessObject: { id: 'Task_1' }
    },
    {
      id: 'Task_2',
      type: 'bpmn:UserTask',
      businessObject: { id: 'Task_2' }
    }
  ]
  fake.handlers.clear()
  fake.selected = null
  fake.destroyed = false
  fake.validationSummary = validSummary
  fake.preservationSummary = validSummary
  mocks.zoom.mockReset()
  mocks.scrollToElement.mockReset()
  mocks.selectionSelect.mockReset()
  mocks.modelingUpdate.mockReset()
  mocks.modelerReady.mockReset()
  mocks.triggerDownload.mockReset()
  mocks.validateBpmnXml.mockReset().mockImplementation(async () => ({
    summary: fake.validationSummary
  }))
  mocks.validatePreservation.mockReset().mockImplementation(async () => fake.preservationSummary)
  mocks.layout.mockReset().mockResolvedValue({ xml: '<definitions id="layouted" />' })
  mocks.pdf.mockReset().mockReturnValue(new Uint8Array([37, 80, 68, 70]))
  mocks.onValidationRun.mockReset()
  mocks.onSourceValidate.mockReset()
  mocks.onSourceApply.mockReset()
  mocks.onSourceAutoLayout.mockReset()
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      media: '(max-width: 1199px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn()
  })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:diagram-pdf')
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  cleanup()
})

describe('EditorTab browser integration', () => {
  it('mounts the modeler, scopes dirty events, badges, double-clicks, and zoom commands', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    const onModelerReady = vi.fn()
    const onOpenCalledProcess = vi.fn()
    const onOpenStepDetails = vi.fn()
    const { unmount } = renderEditor({
      onDirtyChange,
      onModelerReady,
      onOpenCalledProcess,
      onOpenStepDetails,
      toolbarExtra: <span>extra-toolbar</span>
    })

    await waitFor(() => expect(onModelerReady).toHaveBeenCalledOnce())
    expect(screen.getByTestId('shape-legend')).not.toBeNull()
    expect(screen.getByText('extra-toolbar')).not.toBeNull()
    expect(mocks.zoom).toHaveBeenCalledWith('fit-viewport')

    fake.stackIndex = 1
    emit('commandStack.changed')
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
    expect(screen.getByText('editor.dirtyFlag.dirty')).not.toBeNull()

    const call = {
      id: 'Call_1',
      type: 'bpmn:CallActivity',
      businessObject: { id: 'Call_1', calledElement: 'leave' }
    }
    expect(emit('element.dblclick', { element: call })).toBe(false)
    expect(onOpenCalledProcess).toHaveBeenCalledWith('leave')

    ;(
      window as typeof window & {
        __orbitpmBadgeClick?: (elementId: string, missing: string[]) => void
      }
    ).__orbitpmBadgeClick?.('Task_1', ['owner'])
    expect(mocks.selectionSelect).toHaveBeenCalledWith(fake.elements[0])
    expect(onOpenStepDetails).toHaveBeenCalledWith('Task_1', ['owner'])

    await user.click(screen.getByRole('button', { name: 'editor.zoomOut.title' }))
    await user.click(screen.getByRole('button', { name: 'editor.zoomIn.title' }))
    await user.click(screen.getByRole('button', { name: 'editor.zoomFit' }))
    expect(mocks.zoom).toHaveBeenCalledWith(expect.closeTo(1 / 1.15))
    expect(mocks.zoom).toHaveBeenCalledWith('fit-viewport')

    unmount()
    expect(fake.destroyed).toBe(true)
    expect(onModelerReady).toHaveBeenLastCalledWith(null)
  })

  it('persists the details rail state and traps the responsive drawer focus', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        media: '(max-width: 1199px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    })
    const user = userEvent.setup()
    renderEditor({ sidePaneExtra: <button type="button">details-action</button> })

    const toggle = screen.getByRole('button', { name: 'pane.details.toggle' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.keyboard('{Tab}')
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'pane.details.aria' })).not.toBeNull()
    expect(localStorage.getItem(DETAILS_OPEN_PREFERENCE_KEY)).toBe('1')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'))
    expect(localStorage.getItem(DETAILS_OPEN_PREFERENCE_KEY)).toBe('0')
    expect(document.activeElement).toBe(toggle)

    await user.click(toggle)
    await user.dblClick(screen.getByRole('separator', { name: 'pane.resize.props.aria' }))
    expect(localStorage.getItem(DETAILS_WIDTH_PREFERENCE_KEY)).toBeNull()
    await user.click(document.querySelector<HTMLElement>('.orbitpm-details-backdrop')!)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('saves valid XML through toolbar, shortcut, and application commands, then exports', async () => {
    const user = userEvent.setup()
    const onRequestSave = vi.fn().mockResolvedValue(undefined)
    let commands: EditorTabCommands | null = null
    renderEditor({
      onRequestSave,
      onCommandsReady: (next) => {
        commands = next
      }
    })
    await waitFor(() => expect(commands).not.toBeNull())

    fake.stackIndex = 1
    emit('commandStack.changed')
    await user.click(screen.getByRole('button', { name: 'editor.save' }))
    await waitFor(() =>
      expect(onRequestSave).toHaveBeenCalledWith('<definitions id="original" />', {
        explicitDraftWithErrors: false
      })
    )

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(onRequestSave).toHaveBeenCalledTimes(2))

    commands!.save()
    await waitFor(() => expect(onRequestSave).toHaveBeenCalledTimes(3))
    commands!.exportSvg()
    commands!.exportPng()
    commands!.exportPdf()
    await waitFor(() => expect(mocks.triggerDownload).toHaveBeenCalledTimes(3))
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'leave-process.svg',
      'data:image/svg+xml;base64,PHN2Zy8+'
    )
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'leave-process.png',
      'data:image/png;base64,AQID'
    )
    expect(mocks.triggerDownload).toHaveBeenCalledWith('leave-process.pdf', 'blob:diagram-pdf')
  })

  it('runs validation, focuses an issue, opens source repair, applies, and rolls back', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'validation.open' }))
    expect(await screen.findByRole('dialog', { name: 'validation-center' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'validation-run' }))
    expect(mocks.onValidationRun).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'validation-focus' }))
    expect(mocks.selectionSelect).toHaveBeenCalledWith(fake.elements[0])
    expect(mocks.scrollToElement).toHaveBeenCalledWith(fake.elements[0], 120)

    await user.click(screen.getByRole('button', { name: 'validation.open' }))
    await user.click(screen.getByRole('button', { name: 'validation-repair' }))
    expect(await screen.findByRole('dialog', { name: 'source-editor' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'source-validate' }))
    await user.click(screen.getByRole('button', { name: 'source-layout' }))
    await waitFor(() => expect(mocks.onSourceValidate).toHaveBeenCalledOnce())
    await waitFor(() => expect(mocks.onSourceAutoLayout).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'source-apply' }))
    await waitFor(() => expect(mocks.onSourceApply).toHaveBeenCalledOnce())
    expect(mocks.modelingUpdate).toHaveBeenCalled()
    expect(await screen.findByText('sourceEditor.rollback')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'sourceEditor.rollback' }))
    await waitFor(() => expect(fake.currentXml).toBe('<definitions id="original" />'))
  })

  it('requires and honors explicit draft confirmation for semantic blockers', async () => {
    fake.validationSummary = semanticSummary
    const user = userEvent.setup()
    const onRequestSave = vi.fn().mockResolvedValue(undefined)
    renderEditor({ onRequestSave })

    await user.click(screen.getByRole('button', { name: 'editor.save' }))
    expect(await screen.findByRole('dialog', { name: 'save-draft' })).not.toBeNull()
    expect(onRequestSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'draft-confirm' }))
    await waitFor(() =>
      expect(onRequestSave).toHaveBeenCalledWith('<definitions id="original" />', {
        explicitDraftWithErrors: true
      })
    )

    fake.validationSummary = semanticSummary
    await user.click(screen.getByRole('button', { name: 'editor.save' }))
    await user.click(screen.getByRole('button', { name: 'draft-cancel' }))
    expect(screen.queryByRole('dialog', { name: 'save-draft' })).toBeNull()
  })

  it('surfaces import, save, validation, and export failures truthfully', async () => {
    fake.importError = new Error('bad import')
    const { rerender } = renderEditor()
    expect(await screen.findByText('editor.error.loadFailed')).not.toBeNull()

    fake.importError = null
    fake.saveXmlError = new Error('serialization failed')
    rerender(
      <EditorTab xml='<definitions id="next" />' onDirtyChange={vi.fn()} onRequestSave={vi.fn()} />
    )
    await waitFor(() => expect(fake.currentXml).toBe('<definitions id="next" />'))
    await userEvent.click(screen.getByRole('button', { name: 'editor.save' }))
    expect(await screen.findByText('editor.error.saveFailed')).not.toBeNull()

    fake.saveXmlError = null
    fake.saveSvgError = new Error('svg failed')
    await userEvent.click(screen.getByRole('button', { name: 'editor.exportSvg' }))
    expect(await screen.findByText('editor.error.exportSvgFailed')).not.toBeNull()

    fake.saveXmlMissing = true
    await userEvent.click(screen.getByRole('button', { name: 'validation.open' }))
    expect(await screen.findByText('editor.error.loadFailed')).not.toBeNull()
  })
})
