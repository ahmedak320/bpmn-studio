/**
 * Reconciles the diagram-js element registry with the ARIS working document.
 *
 * The canvas never renders from a gesture; it renders from the document that
 * the gesture's ARIS command produced. `sync()` diffs the active model against
 * the registry and adds, updates, or removes elements accordingly. Because the
 * diff is total, undo, redo, model switching and out-of-band document changes
 * all converge on the same code path — there is no incremental view state that
 * can drift.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementFactory from 'diagram-js/lib/core/ElementFactory'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Connection, Element, Label, Root, Shape } from 'diagram-js/lib/model/Types'

import type { ArisModel, ArisObjectOccurrence } from '../model/types'
import { ArisDocumentStore } from './documentStore'
import {
  arisBusinessObject,
  freeTextElementId,
  labelElementId,
  laneElementId,
  rootElementId,
  type ArisConnectionBusinessObject,
  type ArisFreeTextBusinessObject,
  type ArisLabelBusinessObject,
  type ArisLaneBusinessObject,
  type ArisModelBusinessObject,
  type ArisOccurrenceBusinessObject
} from './elements'
import { readLocalized } from './localization'
import { connectionWaypoints } from './waypoints'
import { AT_NAME } from './vocabulary'

/** Default geometry for a lane band when the model gives no explicit extent. */
const LANE_DEFAULT_THICKNESS = 240
const LANE_DEFAULT_LENGTH = 1200
const EXTERNAL_LABEL_DEFAULT_WIDTH = 120
const EXTERNAL_LABEL_DEFAULT_HEIGHT = 24

function sameNumber(a: number | undefined, b: number): boolean {
  return typeof a === 'number' && a === b
}

export class ArisCanvasSync {
  static $inject = ['canvas', 'elementFactory', 'elementRegistry', 'eventBus', 'arisDocumentStore']

  private renderedModelId: string | null = null

  constructor(
    private readonly canvas: Canvas,
    private readonly elementFactory: ElementFactory,
    private readonly elementRegistry: ElementRegistry,
    private readonly eventBus: EventBus,
    private readonly store: ArisDocumentStore
  ) {}

  /** The model id currently projected onto the canvas. */
  get modelId(): string | null {
    return this.renderedModelId
  }

  /**
   * Rebuild the canvas from the store's active model.
   *
   * @returns every element whose view state changed, for `elements.changed`.
   */
  sync(): Element[] {
    const document = this.store.document
    const modelId = this.store.activeModelId
    const model = document.models.get(modelId)
    if (!model) throw new Error(`Active model ${modelId} vanished from the working document.`)

    if (this.renderedModelId !== modelId) {
      this.resetTo(model)
    }

    const dirty: Element[] = []
    const desiredShapeIds = new Set<string>()
    const desiredConnectionIds = new Set<string>()

    this.syncRoot(model)
    this.syncLanes(model, desiredShapeIds, dirty)
    this.syncOccurrences(model, desiredShapeIds, dirty)
    this.syncFreeText(model, desiredShapeIds, dirty)
    this.syncLabels(model, desiredShapeIds, dirty)
    this.syncConnections(model, desiredConnectionIds, dirty)
    this.removeStale(desiredShapeIds, desiredConnectionIds)

    return dirty
  }

  /** Switch to another model and rebuild from scratch (Section 11.5 "model switch"). */
  private resetTo(model: ArisModel): void {
    for (const element of this.elementRegistry.getAll().slice()) {
      const businessObject = arisBusinessObject(element)
      if (!businessObject || businessObject.kind === 'model') continue
      if (businessObject.kind === 'connection') {
        this.canvas.removeConnection(element as Connection)
      }
    }
    for (const element of this.elementRegistry.getAll().slice()) {
      const businessObject = arisBusinessObject(element)
      if (
        !businessObject ||
        businessObject.kind === 'model' ||
        businessObject.kind === 'connection'
      )
        continue
      this.canvas.removeShape(element as Shape)
    }

    // diagram-js keeps every root it has seen, so switching back to a model
    // must reuse its root element rather than mint a duplicate id.
    const rootId = rootElementId(model.id)
    const existing = this.elementRegistry.get(rootId) as Root | undefined
    if (existing) {
      existing.businessObject = this.modelBusinessObject(model)
      this.canvas.setRootElement(existing)
    } else {
      const root = this.elementFactory.createRoot({
        id: rootId,
        businessObject: this.modelBusinessObject(model)
      })
      this.canvas.setRootElement(root as Root)
    }
    this.renderedModelId = model.id
  }

  private modelBusinessObject(model: ArisModel): ArisModelBusinessObject {
    return Object.freeze({
      kind: 'model',
      modelId: model.id,
      modelType: model.type,
      name: readLocalized(model.names)
    })
  }

  private syncRoot(model: ArisModel): void {
    const root = this.canvas.getRootElement() as Root | undefined
    if (!root || root.id !== rootElementId(model.id)) {
      this.resetTo(model)
      return
    }
    // Keep the root's business object current so the model name/type is fresh.
    ;(root as { businessObject?: unknown }).businessObject = this.modelBusinessObject(model)
  }

  private root(): Root {
    return this.canvas.getRootElement() as Root
  }

  private syncLanes(model: ArisModel, desired: Set<string>, dirty: Element[]): void {
    model.lanes.forEach((lane, index) => {
      const id = laneElementId(lane.id)
      desired.add(id)
      const horizontal = (lane.orientation ?? 'horizontal') !== 'vertical'
      const start = lane.startBorder ?? 0
      const end = lane.endBorder ?? 0
      const thickness = end > start ? end - start : LANE_DEFAULT_THICKNESS
      const offset = end > start ? start : index * LANE_DEFAULT_THICKNESS
      const bounds = horizontal
        ? { x: 0, y: offset, width: LANE_DEFAULT_LENGTH, height: thickness }
        : { x: offset, y: 0, width: thickness, height: LANE_DEFAULT_LENGTH }
      const businessObject: ArisLaneBusinessObject = Object.freeze({
        kind: 'lane',
        modelId: model.id,
        laneId: lane.id,
        orientation: horizontal ? 'horizontal' : 'vertical',
        name: readLocalized(lane.names)
      })
      this.upsertShape(id, bounds, businessObject, dirty, { isFrame: true })
    })
  }

  private syncOccurrences(model: ArisModel, desired: Set<string>, dirty: Element[]): void {
    const definitions = this.store.document.objectDefinitions
    for (const occurrence of model.occurrences) {
      desired.add(occurrence.id)
      const definition = definitions.get(occurrence.definitionId)
      const businessObject: ArisOccurrenceBusinessObject = Object.freeze({
        kind: 'occurrence',
        modelId: model.id,
        modelType: model.type,
        occurrenceId: occurrence.id,
        definitionId: occurrence.definitionId,
        objectType: definition?.type ?? 'OT_UNKNOWN',
        symbolNum: occurrence.symbol,
        name: readLocalized(definition?.names)
      })
      this.upsertShape(occurrence.id, occurrence.bounds, businessObject, dirty)
    }
  }

  private syncFreeText(model: ArisModel, desired: Set<string>, dirty: Element[]): void {
    for (const text of model.freeText) {
      const id = freeTextElementId(text.id)
      desired.add(id)
      const businessObject: ArisFreeTextBusinessObject = Object.freeze({
        kind: 'freeText',
        modelId: model.id,
        freeTextId: text.id,
        text: readLocalized(text.text)
      })
      this.upsertShape(id, text.bounds, businessObject, dirty)
    }
  }

  /**
   * Create an external caption element for every occurrence whose `AT_NAME`
   * attribute occurrence carries an explicit offset. Occurrences without one
   * render their caption inside the symbol and get no label element.
   */
  private syncLabels(model: ArisModel, desired: Set<string>, dirty: Element[]): void {
    const definitions = this.store.document.objectDefinitions
    for (const occurrence of model.occurrences) {
      const placement = externalNamePlacement(occurrence)
      if (!placement) continue
      const id = labelElementId(occurrence.id)
      desired.add(id)
      const definition = definitions.get(occurrence.definitionId)
      const businessObject: ArisLabelBusinessObject = Object.freeze({
        kind: 'label',
        modelId: model.id,
        ownerOccurrenceId: occurrence.id,
        attributeType: AT_NAME,
        text: readLocalized(definition?.names)
      })
      const bounds = {
        x: occurrence.bounds.x + (placement.offsetX ?? 0),
        y: occurrence.bounds.y + (placement.offsetY ?? 0),
        width: placement.width ?? EXTERNAL_LABEL_DEFAULT_WIDTH,
        height: placement.height ?? EXTERNAL_LABEL_DEFAULT_HEIGHT
      }
      const owner = this.elementRegistry.get(occurrence.id) as Shape | undefined
      this.upsertShape(id, bounds, businessObject, dirty, { label: true, labelTarget: owner })
    }
  }

  private syncConnections(model: ArisModel, desired: Set<string>, dirty: Element[]): void {
    const definitions = this.store.document.connectionDefinitions
    const occurrenceById = new Map(
      model.occurrences.map((occurrence) => [occurrence.id, occurrence])
    )
    for (const connection of model.connectionOccurrences) {
      const source = occurrenceById.get(connection.sourceOccurrenceId)
      const target = occurrenceById.get(connection.targetOccurrenceId)
      if (!source || !target) continue
      desired.add(connection.id)
      const definition = definitions.get(connection.definitionId)
      const businessObject: ArisConnectionBusinessObject = Object.freeze({
        kind: 'connection',
        modelId: model.id,
        connectionOccurrenceId: connection.id,
        definitionId: connection.definitionId,
        connectionType: definition?.type ?? 'CT_UNKNOWN',
        sourceOccurrenceId: connection.sourceOccurrenceId,
        targetOccurrenceId: connection.targetOccurrenceId,
        name: readLocalized(definition?.names)
      })
      const waypoints = connectionWaypoints(source.bounds, target.bounds, connection.route, {
        selfLoop: source.id === target.id
      })
      const sourceElement = this.elementRegistry.get(connection.sourceOccurrenceId) as
        Shape | undefined
      const targetElement = this.elementRegistry.get(connection.targetOccurrenceId) as
        Shape | undefined
      if (!sourceElement || !targetElement) continue

      const existing = this.elementRegistry.get(connection.id) as Connection | undefined
      if (!existing) {
        const created = this.elementFactory.createConnection({
          id: connection.id,
          businessObject,
          waypoints: waypoints.map((point) => ({ x: point.x, y: point.y })),
          source: sourceElement,
          target: targetElement
        })
        this.canvas.addConnection(created as Connection, this.root())
        continue
      }
      existing.businessObject = businessObject
      existing.source = sourceElement
      existing.target = targetElement
      existing.waypoints = waypoints.map((point) => ({ x: point.x, y: point.y }))
      dirty.push(existing)
    }
  }

  private upsertShape(
    id: string,
    bounds: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    },
    businessObject: unknown,
    dirty: Element[],
    options: {
      readonly isFrame?: boolean
      readonly label?: boolean
      readonly labelTarget?: Shape
    } = {}
  ): void {
    const existing = this.elementRegistry.get(id) as Shape | undefined
    if (!existing) {
      const attrs = {
        id,
        businessObject,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        ...(options.isFrame ? { isFrame: true } : {}),
        ...(options.labelTarget ? { labelTarget: options.labelTarget } : {})
      }
      const created = options.label
        ? (this.elementFactory.createLabel(attrs) as Label)
        : (this.elementFactory.createShape(attrs) as Shape)
      this.canvas.addShape(created, this.root())
      return
    }
    const changed =
      !sameNumber(existing.x, bounds.x) ||
      !sameNumber(existing.y, bounds.y) ||
      !sameNumber(existing.width, bounds.width) ||
      !sameNumber(existing.height, bounds.height) ||
      JSON.stringify(existing.businessObject) !== JSON.stringify(businessObject)
    existing.x = bounds.x
    existing.y = bounds.y
    existing.width = bounds.width
    existing.height = bounds.height
    existing.businessObject = businessObject
    if (options.labelTarget && (existing as Label).labelTarget !== options.labelTarget) {
      ;(existing as Label).labelTarget = options.labelTarget
    }
    if (changed) dirty.push(existing)
  }

  private removeStale(
    desiredShapeIds: ReadonlySet<string>,
    desiredConnectionIds: ReadonlySet<string>
  ): void {
    for (const element of this.elementRegistry.getAll().slice()) {
      const businessObject = arisBusinessObject(element)
      if (!businessObject || businessObject.kind !== 'connection') continue
      if (!desiredConnectionIds.has(element.id)) {
        this.canvas.removeConnection(element as Connection)
      }
    }
    // Labels before their owners: removing an owner first would orphan them.
    for (const pass of ['label', 'other'] as const) {
      for (const element of this.elementRegistry.getAll().slice()) {
        const businessObject = arisBusinessObject(element)
        if (
          !businessObject ||
          businessObject.kind === 'model' ||
          businessObject.kind === 'connection'
        )
          continue
        const isLabel = businessObject.kind === 'label'
        if (pass === 'label' ? !isLabel : isLabel) continue
        if (!desiredShapeIds.has(element.id)) {
          this.canvas.removeShape(element as Shape)
        }
      }
    }
  }

  /** Fire `elements.changed` so `change-support` repaints the dirty set. */
  notify(dirty: readonly Element[]): void {
    if (dirty.length === 0) return
    this.eventBus.fire('elements.changed', { elements: [...dirty] })
  }
}

export interface ExternalNamePlacement {
  readonly offsetX: number | null
  readonly offsetY: number | null
  readonly width: number | null
  readonly height: number | null
}

/**
 * The `AT_NAME` attribute occurrence, when it places the caption outside the
 * symbol. A zero/absent offset means the caption renders inside the shape.
 */
export function externalNamePlacement(
  occurrence: ArisObjectOccurrence
): ExternalNamePlacement | null {
  const placement = occurrence.attributeOccurrences.find((entry) => entry.attributeType === AT_NAME)
  if (!placement) return null
  const offsetX = placement.offsetX ?? 0
  const offsetY = placement.offsetY ?? 0
  if (offsetX === 0 && offsetY === 0) return null
  return Object.freeze({
    offsetX,
    offsetY,
    width: placement.width,
    height: placement.height
  })
}
