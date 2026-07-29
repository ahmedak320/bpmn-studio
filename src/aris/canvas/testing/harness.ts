/**
 * Shared test harness for the ARIS canvas. Test support only.
 */

import type { Element, Shape } from 'diagram-js/lib/model/Types'

import { ArisCanvas } from '../ArisCanvas'
import {
  createEmptyArisCanvasDocument,
  createEmptyArisModel,
  withAdditionalModel
} from '../emptyDocument'
import type { ArisSupportedModelType, ArisWorkingDocument } from '../../model/types'
import { createCanvasContainer, installJsdomSvgSupport } from './jsdomSvg'

export interface HarnessOptions {
  readonly modelType?: ArisSupportedModelType
  readonly modelName?: string
  readonly document?: ArisWorkingDocument
  readonly modelId?: string
  /** The minimap is off by default so tests boot the smallest useful graph. */
  readonly minimap?: boolean
}

export interface Harness {
  readonly canvas: ArisCanvas
  readonly container: HTMLElement
  readonly destroy: () => void
}

export function bootCanvas(options: HarnessOptions = {}): Harness {
  installJsdomSvgSupport()
  const container = createCanvasContainer()
  const fallback = createEmptyArisCanvasDocument({
    modelType: options.modelType ?? 'MT_EEPC',
    modelName: options.modelName ?? 'Test model'
  })
  const canvas = ArisCanvas.create({
    container,
    document: options.document ?? fallback.document,
    modelId: options.modelId ?? (options.document ? undefined : fallback.modelId),
    minimap: options.minimap ?? false
  })
  return {
    canvas,
    container,
    destroy: () => {
      canvas.destroy()
      container.remove()
    }
  }
}

/** A two-model document, for model-switch tests. */
export function twoModelDocument(): {
  readonly document: ArisWorkingDocument
  readonly first: string
  readonly second: string
} {
  const first = createEmptyArisCanvasDocument({ modelId: 'Model.A', modelName: 'A' })
  const document = withAdditionalModel(
    first.document,
    createEmptyArisModel({ id: 'Model.B', type: 'MT_VAL_ADD_CHN_DGM', name: 'B' })
  )
  return { document, first: 'Model.A', second: 'Model.B' }
}

/** The diagram-js element for an ARIS id. */
export function element(canvas: ArisCanvas, id: string): Element {
  const found = canvas.elementRegistry.get(id)
  if (!found) throw new Error(`No canvas element for ${id}.`)
  return found as Element
}

export function shape(canvas: ArisCanvas, id: string): Shape {
  return element(canvas, id) as Shape
}

/**
 * Drive a real drag through diagram-js's `move` module.
 *
 * `dragging` is put into manual mode so the gesture can be stepped without a
 * DOM event loop; everything else — `move.start`, the move preview, the rules
 * check and the final `modeling.moveElements` call — is the production path.
 */
export function dragShape(canvas: ArisCanvas, id: string, delta: { x: number; y: number }): void {
  const dragging = canvas.get<{
    setOptions: (options: { manual?: boolean }) => void
    move: (event: unknown) => void
    end: () => void
  }>('dragging')
  const move = canvas.get<{
    start: (event: unknown, element: Element, activate?: boolean) => void
  }>('move')

  dragging.setOptions({ manual: true })
  const target = shape(canvas, id)
  const start = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  move.start(mouseEvent(start.x, start.y), target, true)
  dragging.move(mouseEvent(start.x + delta.x, start.y + delta.y))
  dragging.end()
  dragging.setOptions({ manual: false })
}

function mouseEvent(clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent('mousemove', { clientX, clientY, bubbles: true })
  Object.defineProperty(event, 'target', {
    value: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
    configurable: true
  })
  return event
}
