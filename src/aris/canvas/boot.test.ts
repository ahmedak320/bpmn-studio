// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { ArisCanvas } from './ArisCanvas'
import {
  createEmptyArisCanvasDocument,
  createEmptyArisModel,
  withAdditionalModel
} from './emptyDocument'
import { rootElementId } from './elements'
import { bootCanvas, twoModelDocument, type Harness } from './testing/harness'
import { createCanvasContainer, installJsdomSvgSupport } from './testing/jsdomSvg'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

describe('ArisCanvas boot (Section 11.1)', () => {
  it('boots with an empty EPC model and an empty element registry', () => {
    harness = bootCanvas()
    const { canvas } = harness

    expect(canvas.activeModelId).toBe('Model.1')
    expect(canvas.activeModelType).toBe('MT_EEPC')
    expect(canvas.document.models.get('Model.1')?.occurrences).toHaveLength(0)
    expect(canvas.canvas.getRootElement().id).toBe(rootElementId('Model.1'))
    // Only the root exists on a blank canvas.
    expect(
      canvas.elementRegistry.getAll().filter((element) => element.id !== rootElementId('Model.1'))
    ).toHaveLength(0)
    expect(canvas.commandLog).toHaveLength(0)
    expect(canvas.canUndo).toBe(false)
  })

  it('exposes every Section 11.1 canvas service', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const required = [
      'canvas',
      'elementRegistry',
      'elementFactory',
      'eventBus',
      'graphicsFactory',
      'selection',
      'commandStack',
      'modeling',
      'dragging',
      'move',
      'resize',
      'bendpoints',
      'connect',
      'connectionPreview',
      'create',
      'clipboard',
      'alignElements',
      'distributeElements',
      'keyboard',
      'keyboardBindings',
      'keyboardMove',
      'keyboardMoveSelection',
      'editorActions',
      'contextPad',
      'palette',
      'overlays',
      'search',
      'rules',
      'snapping',
      'gridSnapping',
      'handTool',
      'lassoTool',
      'toolManager',
      'zoomScroll',
      'moveCanvas',
      'outline',
      'changeSupport',
      'arisDocumentStore',
      'arisCommandBridge',
      'arisCanvasSync',
      'arisAuthoring',
      'arisClipboard',
      'arisSelectionHighlight',
      'arisSearchProvider',
      'arisPaletteProvider',
      'arisContextPadProvider',
      'arisRenderer',
      'arisRules'
    ]
    for (const name of required) {
      expect(canvas.get(name), `missing service: ${name}`).toBeTruthy()
    }
  })

  it('boots the BPMN-free minimap when requested', () => {
    harness = bootCanvas({ minimap: true })
    expect(harness.canvas.get('minimap')).toBeTruthy()
  })

  it('supports zoom, fit and scroll', () => {
    harness = bootCanvas()
    const { canvas } = harness
    canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'F', position: { x: 0, y: 0 } })

    expect(canvas.zoom(2)).toBeCloseTo(2)
    expect(canvas.fit()).toBeGreaterThan(0)
    canvas.scroll({ dx: 10, dy: 20 })
    expect(canvas.canvas.viewbox()).toBeTruthy()
  })

  it('rejects a model type outside the Section 11.2 scope', () => {
    installJsdomSvgSupport()
    const container = createCanvasContainer()
    const base = createEmptyArisCanvasDocument()
    const document = withAdditionalModel(
      base.document,
      createEmptyArisModel({
        id: 'Model.X',
        type: 'MT_ORG_CHRT' as unknown as 'MT_EEPC',
        name: 'Org'
      })
    )
    expect(() =>
      ArisCanvas.create({ container, document, modelId: 'Model.X', minimap: false })
    ).toThrow(/outside the Section 11.2 scope/u)
    container.remove()
  })

  it('renders both supported model types (Section 11.2)', () => {
    const { document, second } = twoModelDocument()
    harness = bootCanvas({ document, modelId: second })
    expect(harness.canvas.activeModelType).toBe('MT_VAL_ADD_CHN_DGM')
    harness.canvas.setActiveModel('Model.A')
    expect(harness.canvas.activeModelType).toBe('MT_EEPC')
    expect(harness.canvas.canvas.getRootElement().id).toBe(rootElementId('Model.A'))
  })
})
