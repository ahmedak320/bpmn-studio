/**
 * Shared test harness for the ARIS canvas.
 *
 * `bootCanvas` is the literal boot recipe (`installJsdomSvgSupport()` +
 * `createCanvasContainer()` + `ArisCanvas.create({minimap:false})`) that the
 * headless render entry (`src/aris/headless`) also follows; the shim it depends
 * on (`./jsdomSvg`) is likewise shared by the canvas test suites and that
 * headless entry. Never imported by the studio browser app (`src/main.tsx`).
 */

import type { Element, Shape } from 'diagram-js/lib/model/Types'

import { ArisCanvas } from '../ArisCanvas'
import {
  createEmptyArisCanvasDocument,
  createEmptyArisDocument,
  createEmptyArisModel,
  localizedValue,
  withAdditionalModel
} from '../emptyDocument'
import type {
  ArisFreeText,
  ArisLane,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisSupportedModelType,
  ArisWorkingDocument
} from '../../model/types'
import { AT_NAME } from '../vocabulary'
import { createCanvasContainer, installJsdomSvgSupport } from './jsdomSvg'

export interface HarnessOptions {
  readonly modelType?: ArisSupportedModelType
  readonly modelName?: string
  readonly document?: ArisWorkingDocument
  readonly modelId?: string
  /** The minimap is off by default so tests boot the smallest useful graph. */
  readonly minimap?: boolean
  /**
   * Size of the container the canvas mounts into, in CSS pixels. Readability
   * assertions need a known viewport, because "how big is a symbol on screen"
   * is only meaningful relative to one.
   */
  readonly viewport?: { readonly width: number; readonly height: number }
}

export interface Harness {
  readonly canvas: ArisCanvas
  readonly container: HTMLElement
  readonly destroy: () => void
}

export function bootCanvas(options: HarnessOptions = {}): Harness {
  installJsdomSvgSupport()
  const container = createCanvasContainer(options.viewport?.width, options.viewport?.height)
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

export interface ImportedModelOptions {
  /** Number of occurrences placed on a grid across `extent`. */
  readonly occurrences?: number
  /** The rectangle the occurrences span, in AML units. */
  readonly extent?: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  /** Size of one occurrence, in AML units. */
  readonly symbolSize?: { readonly width: number; readonly height: number }
  /** Lanes to attach, written the way AML writes them. */
  readonly lanes?: readonly {
    readonly id: string
    readonly orientation: string | null
    readonly startBorder: number | null
    readonly endBorder: number | null
  }[]
  /**
   * An external caption on the first occurrence, sized exactly as a real export
   * sizes an unsized one: `<Size Size.dX="0" Size.dY="0">`.
   */
  readonly externalLabel?: {
    readonly offsetX: number
    readonly offsetY: number
    readonly width: number | null
    readonly height: number | null
  }
  /**
   * Free-text notes. A real `<FFTextOcc>` carries a `Position` and no `Size`,
   * so the default entry has a zero extent on purpose.
   */
  readonly freeText?: readonly {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }[]
}

const OCCURRENCE_STYLE = Object.freeze({
  symbol: null,
  fillColor: null,
  strokeColor: null,
  strokeWidth: null,
  lineStyle: null,
  fontStyleSheetId: null,
  zOrder: null
})

/**
 * A document shaped like a real AML import: content placed far from the
 * origin, spread over thousands of units, with lanes written in AML's own
 * upper-case orientation spelling.
 *
 * Authored documents cannot express that — `addLane` only takes the canvas's
 * lower-case orientation and an authored model starts at the origin — which is
 * precisely why every unit test passed while the imported product was
 * unreadable.
 */
export function importedLikeDocument(options: ImportedModelOptions = {}): {
  readonly document: ArisWorkingDocument
  readonly modelId: string
  readonly occurrenceIds: readonly string[]
  readonly freeTextIds: readonly string[]
  readonly extent: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly symbolSize: { readonly width: number; readonly height: number }
} {
  const count = options.occurrences ?? 12
  const extent = options.extent ?? { x: 1000, y: 1000, width: 5000, height: 6500 }
  const symbolSize = options.symbolSize ?? { width: 300, height: 150 }
  const modelId = 'Model.Imported'
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(1, Math.ceil(count / columns))

  const definitions = new Map<string, ArisObjectDefinition>()
  const occurrences: ArisObjectOccurrence[] = []
  for (let index = 0; index < count; index += 1) {
    const column = index % columns
    const row = Math.floor(index / columns)
    const definitionId = `ObjDef.${index}`
    definitions.set(
      definitionId,
      Object.freeze({
        id: definitionId,
        type: 'OT_FUNC',
        defaultSymbol: null,
        names: localizedValue(`Function ${index}`),
        attributes: Object.freeze([]),
        linkedModelIds: Object.freeze([]),
        rawAttributes: Object.freeze({})
      })
    )
    const spanX = columns > 1 ? (extent.width - symbolSize.width) / (columns - 1) : 0
    const spanY = rows > 1 ? (extent.height - symbolSize.height) / (rows - 1) : 0
    const external = index === 0 ? options.externalLabel : undefined
    occurrences.push(
      Object.freeze({
        id: `ObjOcc.${index}`,
        definitionId,
        modelId,
        symbol: 'ST_FUNC',
        bounds: Object.freeze({
          x: Math.round(extent.x + column * spanX),
          y: Math.round(extent.y + row * spanY),
          width: symbolSize.width,
          height: symbolSize.height
        }),
        style: OCCURRENCE_STYLE,
        attributeOccurrences: external
          ? Object.freeze([
              Object.freeze({
                attributeType: AT_NAME,
                port: null,
                orderNum: null,
                alignment: null,
                offsetX: external.offsetX,
                offsetY: external.offsetY,
                width: external.width,
                height: external.height,
                rotation: null,
                symbolFlag: null,
                fontStyleSheetId: null
              })
            ])
          : Object.freeze([]),
        rawAttributes: Object.freeze({})
      })
    )
  }

  const lanes: ArisLane[] = (options.lanes ?? []).map((lane) =>
    Object.freeze({
      id: lane.id,
      modelId,
      names: localizedValue(lane.id),
      laneType: 'LT_DEFAULT',
      orientation: lane.orientation,
      startBorder: lane.startBorder,
      endBorder: lane.endBorder
    })
  )

  const freeText: ArisFreeText[] = (options.freeText ?? []).map((note, index) =>
    Object.freeze({
      id: `FFTextOcc.${index}`,
      modelId,
      definitionId: `FFTextDef.${index}`,
      text: localizedValue(`Note ${index}`),
      attributes: Object.freeze([]),
      bounds: Object.freeze({ ...note }),
      style: OCCURRENCE_STYLE
    })
  )

  const base = createEmptyArisModel({ id: modelId, type: 'MT_EEPC', name: 'Imported' })
  const model: ArisModel = Object.freeze({
    ...base,
    occurrences: Object.freeze(occurrences),
    lanes: Object.freeze(lanes),
    freeText: Object.freeze(freeText)
  })
  const empty = createEmptyArisDocument({ models: [model] })
  const document: ArisWorkingDocument = Object.freeze({
    ...empty,
    objectDefinitions: Object.freeze(definitions)
  })
  return {
    document,
    modelId,
    occurrenceIds: occurrences.map((occurrence) => occurrence.id),
    freeTextIds: freeText.map((note) => note.id),
    extent,
    symbolSize
  }
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
