/**
 * `ArisModeling` — the diagram-js `modeling` service, reimplemented against the
 * ARIS command system.
 *
 * diagram-js's interaction modules (`move`, `resize`, `connect`, `bendpoints`,
 * `create`, `align-elements`, `distribute-elements`) all end their gestures by
 * calling a service named `modeling`. None of them depends on the *modeling
 * module* itself — they inject the name. This class is therefore registered
 * under `modeling`, which means every stock diagram-js gesture is captured at
 * exactly one seam and turned into ARIS commands, with no monkey-patching and
 * no second copy of model state (see `commandBridge.ts`).
 *
 * Methods diagram-js modules we do not install would call (`replaceShape`,
 * `createSpace`, `updateAttachment`, `toggleCollapse`) throw explicitly rather
 * than silently corrupting the document.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type { Connection, Element, ElementLike, Shape } from 'diagram-js/lib/model/Types'
import type { Point } from 'diagram-js/lib/util/Types'

import type { ArisEditCommand } from '../model/commands'
import type { ArisAttributeOccurrence, ArisWorkingDocument } from '../model/types'
import { ArisCanvasCommandError, ArisCommandBridge } from './commandBridge'
import { ArisDocumentStore, type ArisCommandThunk } from './documentStore'
import {
  addFreeTextCommand,
  createConnectionDefinitionCommand,
  createConnectionOccurrenceCommand,
  createDefinitionCommand,
  createOccurrenceCommand,
  deleteConnectionCommand,
  deleteFreeTextCommand,
  deleteLaneCommand,
  deleteOccurrenceCommand,
  editFreeTextCommand,
  editLaneCommand,
  findConnectionOccurrence,
  findFreeText,
  findLane,
  findOccurrence,
  moveOccurrenceCommand,
  reconnectConnectionCommand,
  resizeOccurrenceCommand,
  setConnectionRouteCommand,
  transactionCommand,
  type ArisCommandContext
} from './commandFactory'
import { arisBusinessObject, type ArisBusinessObject } from './elements'
import { toCanonicalNumber } from './geometry'
import { resolveConnectionType } from './vocabulary'
import { AT_NAME } from './vocabulary'

export interface ArisCreateShapeAttrs {
  readonly objectType: string
  readonly symbolNum: string
  /** Reuse this definition (another occurrence) instead of creating one. */
  readonly definitionId?: string
  readonly name?: string
}

export interface ArisAlignment {
  readonly left?: number
  readonly right?: number
  readonly center?: number
  readonly top?: number
  readonly bottom?: number
  readonly middle?: number
}

export interface ArisDistributeGroup {
  readonly elements: readonly Shape[]
  range: { min: number; max: number } | null
}

interface MutableBox {
  readonly id: string
  x: number
  y: number
  readonly width: number
  readonly height: number
}

export class ArisUnsupportedOperationError extends Error {
  constructor(operation: string) {
    super(`${operation} is not supported by the ARIS canvas.`)
    this.name = 'ArisUnsupportedOperationError'
  }
}

function businessObjectOf(element: ElementLike | null | undefined): ArisBusinessObject | null {
  return arisBusinessObject(element)
}

export class ArisModeling {
  static $inject = ['arisCommandBridge', 'arisDocumentStore', 'elementRegistry', 'canvas']

  constructor(
    private readonly bridge: ArisCommandBridge,
    private readonly store: ArisDocumentStore,
    private readonly elementRegistry: ElementRegistry,
    private readonly canvas: Canvas
  ) {}

  // -------------------------------------------------------------------------
  // Move
  // -------------------------------------------------------------------------

  moveElements(
    elements: readonly Element[],
    delta: Point,
    _target?: Element,
    _hints?: unknown
  ): void {
    const thunks = this.moveThunks(elements, delta)
    if (thunks.length === 0) return
    this.bridge.execute('move', thunks)
  }

  moveShape(shape: Shape, delta: Point, target?: Element, _hints?: unknown): void {
    this.moveElements([shape], delta, target)
  }

  moveConnection(_connection: Connection, _delta: Point): void {
    throw new ArisUnsupportedOperationError('moveConnection')
  }

  private moveThunks(elements: readonly Element[], delta: Point): ArisCommandThunk[] {
    const dx = toCanonicalNumber(delta.x, 'dx')
    const dy = toCanonicalNumber(delta.y, 'dy')
    if (dx === 0 && dy === 0) return []

    const movedOccurrenceIds = new Set<string>()
    for (const element of elements) {
      const businessObject = businessObjectOf(element)
      if (businessObject?.kind === 'occurrence') movedOccurrenceIds.add(businessObject.occurrenceId)
    }

    const thunks: ArisCommandThunk[] = []
    for (const element of elements) {
      const businessObject = businessObjectOf(element)
      if (!businessObject) continue

      if (businessObject.kind === 'occurrence') {
        const occurrenceId = businessObject.occurrenceId
        thunks.push((document, context) => {
          const occurrence = findOccurrence(document, occurrenceId)
          if (!occurrence)
            throw new ArisCanvasCommandError(
              'missing-occurrence',
              `Unknown occurrence ${occurrenceId}.`
            )
          return moveOccurrenceCommand(context, document, occurrenceId, {
            x: occurrence.bounds.x + dx,
            y: occurrence.bounds.y + dy
          })
        })
        continue
      }

      if (businessObject.kind === 'label') {
        // A label follows its owner automatically (the caption offset is stored
        // relative to the occurrence), so only an independently dragged label
        // records a placement change.
        if (movedOccurrenceIds.has(businessObject.ownerOccurrenceId)) continue
        const ownerId = businessObject.ownerOccurrenceId
        thunks.push((document, context) =>
          setAttributeOccurrencePlacementCommand(context, document, ownerId, dx, dy)
        )
        continue
      }

      if (businessObject.kind === 'freeText') {
        const freeTextId = businessObject.freeTextId
        thunks.push((document, context) => {
          const text = findFreeText(document, freeTextId)
          if (!text)
            throw new ArisCanvasCommandError(
              'missing-free-text',
              `Unknown free text ${freeTextId}.`
            )
          return editFreeTextCommand(context, document, freeTextId, {
            bounds: { ...text.bounds, x: text.bounds.x + dx, y: text.bounds.y + dy }
          })
        })
        continue
      }

      if (businessObject.kind === 'lane') {
        const laneId = businessObject.laneId
        const shift = businessObject.orientation === 'vertical' ? dx : dy
        if (shift === 0) continue
        thunks.push((document, context) => {
          const lane = findLane(document, laneId)
          if (!lane) throw new ArisCanvasCommandError('missing-lane', `Unknown lane ${laneId}.`)
          return editLaneCommand(context, document, laneId, {
            startBorder: (lane.startBorder ?? 0) + shift,
            endBorder: (lane.endBorder ?? 0) + shift
          })
        })
      }
    }
    return thunks
  }

  // -------------------------------------------------------------------------
  // Resize
  // -------------------------------------------------------------------------

  resizeShape(
    shape: Shape,
    newBounds: { x: number; y: number; width: number; height: number }
  ): void {
    const businessObject = businessObjectOf(shape)
    if (businessObject?.kind === 'freeText') {
      const freeTextId = businessObject.freeTextId
      this.bridge.execute('resize', (document, context) =>
        editFreeTextCommand(context, document, freeTextId, { bounds: newBounds })
      )
      return
    }
    if (businessObject?.kind !== 'occurrence') {
      throw new ArisUnsupportedOperationError(`resizeShape(${businessObject?.kind ?? 'unknown'})`)
    }
    const occurrenceId = businessObject.occurrenceId
    this.bridge.execute('resize', [
      (document, context) => resizeOccurrenceCommand(context, document, occurrenceId, newBounds),
      (document, context) => moveOccurrenceCommand(context, document, occurrenceId, newBounds)
    ])
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  connect(
    source: Element,
    target: Element,
    attrs?: { readonly connectionType?: string } | null,
    _hints?: unknown
  ): Connection {
    const sourceBo = businessObjectOf(source)
    const targetBo = businessObjectOf(target)
    if (sourceBo?.kind !== 'occurrence' || targetBo?.kind !== 'occurrence') {
      throw new ArisCanvasCommandError(
        'invalid-endpoints',
        'Connections must join two object occurrences.'
      )
    }
    const modelId = sourceBo.modelId
    const resolved =
      attrs?.connectionType ??
      resolveConnectionType(sourceBo.modelType, sourceBo.objectType, targetBo.objectType)
        .connectionType

    const connectionOccurrenceId = this.store.nextId('connectionOccurrence')
    const existingDefinitionId = findConnectionDefinitionId(
      this.store.document,
      sourceBo.definitionId,
      targetBo.definitionId,
      resolved
    )

    const thunks: ArisCommandThunk[] = []
    const definitionId = existingDefinitionId ?? this.store.nextId('connectionDefinition')
    if (!existingDefinitionId) {
      thunks.push((_document, context) =>
        createConnectionDefinitionCommand(context, {
          definitionId,
          connectionType: resolved,
          fromObjectDefinitionId: sourceBo.definitionId,
          toObjectDefinitionId: targetBo.definitionId
        })
      )
    }
    thunks.push((_document, context) =>
      createConnectionOccurrenceCommand(context, {
        connectionOccurrenceId,
        definitionId,
        modelId,
        sourceOccurrenceId: sourceBo.occurrenceId,
        targetOccurrenceId: targetBo.occurrenceId
      })
    )

    this.bridge.execute('connect', thunks)
    const created = this.elementRegistry.get(connectionOccurrenceId) as Connection | undefined
    if (!created)
      throw new ArisCanvasCommandError(
        'connection-not-rendered',
        'The connection was not rendered.'
      )
    return created
  }

  createConnection(
    source: Element,
    target: Element,
    attrs?: { readonly connectionType?: string } | null,
    _parent?: Element,
    _hints?: unknown
  ): Connection {
    return this.connect(source, target, attrs)
  }

  updateWaypoints(connection: Connection, waypoints: readonly Point[], _hints?: unknown): void {
    const businessObject = businessObjectOf(connection)
    if (businessObject?.kind !== 'connection') {
      throw new ArisUnsupportedOperationError('updateWaypoints')
    }
    const id = businessObject.connectionOccurrenceId
    this.bridge.execute('reroute', (document, context) =>
      setConnectionRouteCommand(context, document, id, waypoints)
    )
  }

  reconnect(
    connection: Connection,
    source: Element,
    target: Element,
    _docking?: Point | Point[],
    _hints?: unknown
  ): void {
    const connectionBo = businessObjectOf(connection)
    const sourceBo = businessObjectOf(source)
    const targetBo = businessObjectOf(target)
    if (
      connectionBo?.kind !== 'connection' ||
      sourceBo?.kind !== 'occurrence' ||
      targetBo?.kind !== 'occurrence'
    ) {
      throw new ArisCanvasCommandError(
        'invalid-endpoints',
        'Reconnect requires a connection and two occurrences.'
      )
    }

    const document = this.store.document
    const definition = document.connectionDefinitions.get(connectionBo.definitionId)
    const definitionStillValid =
      definition !== undefined &&
      definition.fromObjectDefinitionId === sourceBo.definitionId &&
      definition.toObjectDefinitionId === targetBo.definitionId

    if (definitionStillValid) {
      const id = connectionBo.connectionOccurrenceId
      this.bridge.execute('reconnect', (doc, context) =>
        reconnectConnectionCommand(context, doc, id, {
          sourceOccurrenceId: sourceBo.occurrenceId,
          targetOccurrenceId: targetBo.occurrenceId
        })
      )
      return
    }

    // The connection *definition* is typed by its endpoint definitions, and no
    // command retypes an existing occurrence. Replacing the occurrence keeps
    // definition and occurrence consistent, inside a single undo unit.
    const oldId = connectionBo.connectionOccurrenceId
    const newId = this.store.nextId('connectionOccurrence')
    const connectionType =
      definition?.type ??
      resolveConnectionType(sourceBo.modelType, sourceBo.objectType, targetBo.objectType)
        .connectionType
    const existingDefinitionId = findConnectionDefinitionId(
      document,
      sourceBo.definitionId,
      targetBo.definitionId,
      connectionType
    )
    const definitionId = existingDefinitionId ?? this.store.nextId('connectionDefinition')

    const thunks: ArisCommandThunk[] = [
      (doc, context) => deleteConnectionCommand(context, doc, oldId)
    ]
    if (!existingDefinitionId) {
      thunks.push((_doc, context) =>
        createConnectionDefinitionCommand(context, {
          definitionId,
          connectionType,
          fromObjectDefinitionId: sourceBo.definitionId,
          toObjectDefinitionId: targetBo.definitionId
        })
      )
    }
    thunks.push((_doc, context) =>
      createConnectionOccurrenceCommand(context, {
        connectionOccurrenceId: newId,
        definitionId,
        modelId: connectionBo.modelId,
        sourceOccurrenceId: sourceBo.occurrenceId,
        targetOccurrenceId: targetBo.occurrenceId
      })
    )
    this.bridge.execute('reconnect', thunks)
  }

  reconnectStart(
    connection: Connection,
    newSource: Element,
    docking?: Point | Point[],
    hints?: unknown
  ): void {
    const target = connection.target
    if (!target) throw new ArisCanvasCommandError('invalid-endpoints', 'Connection has no target.')
    this.reconnect(connection, newSource, target, docking, hints)
  }

  reconnectEnd(
    connection: Connection,
    newTarget: Element,
    docking?: Point | Point[],
    hints?: unknown
  ): void {
    const source = connection.source
    if (!source) throw new ArisCanvasCommandError('invalid-endpoints', 'Connection has no source.')
    this.reconnect(connection, source, newTarget, docking, hints)
  }

  layoutConnection(_connection: Connection, _hints?: unknown): void {
    throw new ArisUnsupportedOperationError('layoutConnection')
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  createShape(
    shape: Shape & { readonly arisAttrs?: ArisCreateShapeAttrs },
    position: Point,
    _target?: Element,
    _hints?: unknown
  ): Shape {
    const attrs = readCreateAttrs(shape)
    const occurrenceId = this.store.nextId('objectOccurrence')
    const thunks = this.createOccurrenceThunks(attrs, occurrenceId, position, shape)
    this.bridge.execute('create', thunks)
    const created = this.elementRegistry.get(occurrenceId) as Shape | undefined
    if (!created)
      throw new ArisCanvasCommandError('shape-not-rendered', 'The shape was not rendered.')
    return created
  }

  createElements(
    elements: readonly Shape[],
    position: Point,
    target?: Element,
    hints?: unknown
  ): Element[] {
    return elements.map((element) => this.createShape(element, position, target, hints))
  }

  appendShape(
    source: Element,
    shape: Shape & { readonly arisAttrs?: ArisCreateShapeAttrs },
    position: Point,
    _target?: Element,
    _hints?: unknown
  ): Shape {
    const sourceBo = businessObjectOf(source)
    if (sourceBo?.kind !== 'occurrence') {
      throw new ArisCanvasCommandError(
        'invalid-endpoints',
        'Append requires an object occurrence as source.'
      )
    }
    const attrs = readCreateAttrs(shape)
    const occurrenceId = this.store.nextId('objectOccurrence')
    const connectionOccurrenceId = this.store.nextId('connectionOccurrence')
    const connectionDefinitionId = this.store.nextId('connectionDefinition')
    const connectionType = resolveConnectionType(
      sourceBo.modelType,
      sourceBo.objectType,
      attrs.objectType
    ).connectionType

    const thunks = this.createOccurrenceThunks(attrs, occurrenceId, position, shape)
    thunks.push((document, context) => {
      const created = findOccurrence(document, occurrenceId)
      if (!created)
        throw new ArisCanvasCommandError('missing-occurrence', 'Appended occurrence missing.')
      return createConnectionDefinitionCommand(context, {
        definitionId: connectionDefinitionId,
        connectionType,
        fromObjectDefinitionId: sourceBo.definitionId,
        toObjectDefinitionId: created.definitionId
      })
    })
    thunks.push((_document, context) =>
      createConnectionOccurrenceCommand(context, {
        connectionOccurrenceId,
        definitionId: connectionDefinitionId,
        modelId: sourceBo.modelId,
        sourceOccurrenceId: sourceBo.occurrenceId,
        targetOccurrenceId: occurrenceId
      })
    )
    this.bridge.execute('append', thunks)
    const created = this.elementRegistry.get(occurrenceId) as Shape | undefined
    if (!created)
      throw new ArisCanvasCommandError('shape-not-rendered', 'The appended shape was not rendered.')
    return created
  }

  private createOccurrenceThunks(
    attrs: ArisCreateShapeAttrs,
    occurrenceId: string,
    position: Point,
    shape: { width?: number; height?: number }
  ): ArisCommandThunk[] {
    const modelId = this.store.activeModelId
    const width = shape.width ?? 100
    const height = shape.height ?? 70
    const bounds = {
      x: position.x - width / 2,
      y: position.y - height / 2,
      width,
      height
    }
    const thunks: ArisCommandThunk[] = []
    if (attrs.definitionId) {
      const definitionId = attrs.definitionId
      thunks.push((_document, context) =>
        createOccurrenceCommand(context, {
          occurrenceId,
          definitionId,
          modelId,
          symbolNum: attrs.symbolNum,
          bounds
        })
      )
      return thunks
    }
    const definitionId = this.store.nextId('objectDefinition')
    thunks.push((_document, context) =>
      transactionCommand(context, [
        createDefinitionCommand(context, {
          definitionId,
          objectType: attrs.objectType,
          symbolNum: attrs.symbolNum,
          name: attrs.name
        }),
        createOccurrenceCommand(context, {
          occurrenceId,
          definitionId,
          modelId,
          symbolNum: attrs.symbolNum,
          bounds
        })
      ])
    )
    return thunks
  }

  // -------------------------------------------------------------------------
  // Deletion
  // -------------------------------------------------------------------------

  removeElements(elements: readonly ElementLike[]): void {
    const thunks = this.removeThunks(elements)
    if (thunks.length === 0) return
    this.bridge.execute('delete', thunks)
  }

  removeShape(shape: Shape, _hints?: unknown): void {
    this.removeElements([shape])
  }

  removeConnection(connection: Connection, _hints?: unknown): void {
    this.removeElements([connection])
  }

  /**
   * Delete occurrences (with the connection occurrences that touch them),
   * free text and lanes. Object *definitions* are never removed here — Section
   * 11.4 requires a separate confirmation, handled by `ArisAuthoring`.
   */
  private removeThunks(elements: readonly ElementLike[]): ArisCommandThunk[] {
    const document = this.store.document
    const model = document.models.get(this.store.activeModelId)
    if (!model) return []

    const occurrenceIds = new Set<string>()
    const connectionIds = new Set<string>()
    const freeTextIds = new Set<string>()
    const laneIds = new Set<string>()

    for (const element of elements) {
      const businessObject = businessObjectOf(element)
      if (!businessObject) continue
      if (businessObject.kind === 'occurrence') occurrenceIds.add(businessObject.occurrenceId)
      else if (businessObject.kind === 'connection')
        connectionIds.add(businessObject.connectionOccurrenceId)
      else if (businessObject.kind === 'freeText') freeTextIds.add(businessObject.freeTextId)
      else if (businessObject.kind === 'lane') laneIds.add(businessObject.laneId)
      // Labels are projections of their owner's attribute placement and cannot
      // be deleted independently.
    }

    for (const connection of model.connectionOccurrences) {
      if (
        occurrenceIds.has(connection.sourceOccurrenceId) ||
        occurrenceIds.has(connection.targetOccurrenceId)
      ) {
        connectionIds.add(connection.id)
      }
    }

    const thunks: ArisCommandThunk[] = []
    for (const id of connectionIds) {
      thunks.push((doc, context) => deleteConnectionCommand(context, doc, id))
    }
    for (const id of occurrenceIds) {
      thunks.push((doc, context) => deleteOccurrenceCommand(context, doc, id))
    }
    for (const id of freeTextIds) {
      thunks.push((doc, context) => deleteFreeTextCommand(context, doc, id))
    }
    for (const id of laneIds) {
      thunks.push((doc, context) => deleteLaneCommand(context, doc, id))
    }
    return thunks
  }

  // -------------------------------------------------------------------------
  // Align / distribute
  // -------------------------------------------------------------------------

  /**
   * diagram-js's stock handler calls `moveElements` once per element, which
   * would produce one undo step per element. The geometry is the same; the
   * deltas are computed up front and issued as a single gesture.
   */
  alignElements(elements: readonly Shape[], alignment: ArisAlignment): void {
    const thunks: ArisCommandThunk[] = []
    for (const element of elements) {
      const businessObject = businessObjectOf(element)
      if (businessObject?.kind !== 'occurrence') continue
      let x = element.x
      let y = element.y
      if (alignment.left !== undefined) x = alignment.left
      else if (alignment.right !== undefined) x = alignment.right - element.width
      else if (alignment.center !== undefined) x = alignment.center - Math.round(element.width / 2)
      else if (alignment.top !== undefined) y = alignment.top
      else if (alignment.bottom !== undefined) y = alignment.bottom - element.height
      else if (alignment.middle !== undefined) y = alignment.middle - Math.round(element.height / 2)
      if (x === element.x && y === element.y) continue
      const occurrenceId = businessObject.occurrenceId
      thunks.push((document, context) =>
        moveOccurrenceCommand(context, document, occurrenceId, { x, y })
      )
    }
    if (thunks.length === 0) return
    this.bridge.execute('align', thunks)
  }

  /**
   * Even out the gaps between groups along `axis`, then emit one gesture.
   *
   * Ported from diagram-js's `DistributeElementsHandler`, with the per-element
   * `moveElements` calls replaced by delta accumulation on local boxes.
   */
  distributeElements(
    groups: readonly ArisDistributeGroup[],
    axis: 'x' | 'y',
    dimension: 'width' | 'height'
  ): void {
    if (groups.length < 3) return
    const boxes = new Map<string, MutableBox>()
    const groupBoxes = groups.map((group) =>
      group.elements.map((element) => {
        const box: MutableBox = {
          id: element.id,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height
        }
        boxes.set(element.id, box)
        return box
      })
    )

    const along = (box: MutableBox): number => (axis === 'x' ? box.x : box.y)
    const size = (box: MutableBox): number => (dimension === 'width' ? box.width : box.height)
    const setAlong = (box: MutableBox, value: number): void => {
      if (axis === 'x') box.x = value
      else box.y = value
    }
    const centreOf = (box: MutableBox): number => along(box) + size(box) / 2

    const ranges: { min: number; max: number }[] = []
    let groupsSize = 0

    groupBoxes.forEach((group, index) => {
      const sorted = [...group].sort((a, b) => along(a) - along(b))
      const reference = index === groupBoxes.length - 1 ? sorted[sorted.length - 1] : sorted[0]
      const referenceCentre = centreOf(reference)
      let range: { min: number; max: number } | null = null
      for (const box of sorted) {
        setAlong(box, along(box) + (referenceCentre - centreOf(box)))
        if (range === null) range = { min: along(box), max: along(box) + size(box) }
        else {
          range.min = Math.min(along(box), range.min)
          range.max = Math.max(along(box) + size(box), range.max)
        }
      }
      const resolved = range ?? { min: 0, max: 0 }
      ranges.push(resolved)
      if (index !== 0 && index !== groupBoxes.length - 1) groupsSize += resolved.max - resolved.min
    })

    const first = ranges[0]
    const last = ranges[ranges.length - 1]
    const spaceInBetween = Math.abs(last.min - first.max)
    const margin = Math.round((spaceInBetween - groupsSize) / (groups.length - 1))
    if (margin < groups.length - 1) return

    for (let index = 1; index < groupBoxes.length - 1; index += 1) {
      const previous = ranges[index - 1]
      const range = ranges[index]
      const groupMin = range.min
      let newMax = 0
      groupBoxes[index].forEach((box, elementIndex) => {
        let delta = previous.max - along(box) + margin
        if (groupMin !== along(box)) delta += along(box) - groupMin
        setAlong(box, along(box) + delta)
        newMax = Math.max(along(box) + size(box), elementIndex ? newMax : 0)
      })
      range.max = newMax
    }

    const thunks: ArisCommandThunk[] = []
    for (const [id, box] of boxes) {
      const element = this.elementRegistry.get(id) as Shape | undefined
      if (!element) continue
      const businessObject = businessObjectOf(element)
      if (businessObject?.kind !== 'occurrence') continue
      if (box.x === element.x && box.y === element.y) continue
      const occurrenceId = businessObject.occurrenceId
      const x = box.x
      const y = box.y
      thunks.push((document, context) =>
        moveOccurrenceCommand(context, document, occurrenceId, { x, y })
      )
    }
    if (thunks.length === 0) return
    this.bridge.execute('distribute', thunks)
  }

  // -------------------------------------------------------------------------
  // Free text (used by the palette)
  // -------------------------------------------------------------------------

  createFreeText(text: string, position: Point, size = { width: 200, height: 40 }): string {
    const freeTextId = this.store.nextId('freeText')
    const modelId = this.store.activeModelId
    this.bridge.execute('create-free-text', (_document, context) =>
      addFreeTextCommand(context, {
        freeTextId,
        modelId,
        text,
        bounds: { x: position.x, y: position.y, width: size.width, height: size.height }
      })
    )
    return freeTextId
  }

  // -------------------------------------------------------------------------
  // Explicitly unsupported diagram-js modeling operations
  // -------------------------------------------------------------------------

  replaceShape(): never {
    throw new ArisUnsupportedOperationError('replaceShape')
  }

  createSpace(): never {
    throw new ArisUnsupportedOperationError('createSpace')
  }

  updateAttachment(): never {
    throw new ArisUnsupportedOperationError('updateAttachment')
  }

  toggleCollapse(): never {
    throw new ArisUnsupportedOperationError('toggleCollapse')
  }

  /** Exposed so behaviours can reach the canvas without a second injection. */
  getCanvas(): Canvas {
    return this.canvas
  }
}

function readCreateAttrs(shape: {
  arisAttrs?: ArisCreateShapeAttrs
  businessObject?: unknown
}): ArisCreateShapeAttrs {
  const direct = shape.arisAttrs
  if (direct) return direct
  const businessObject = shape.businessObject
  if (businessObject && typeof businessObject === 'object') {
    const candidate = businessObject as {
      objectType?: unknown
      symbolNum?: unknown
      definitionId?: unknown
      name?: unknown
    }
    if (typeof candidate.objectType === 'string' && typeof candidate.symbolNum === 'string') {
      return {
        objectType: candidate.objectType,
        symbolNum: candidate.symbolNum,
        definitionId:
          typeof candidate.definitionId === 'string' ? candidate.definitionId : undefined,
        name: typeof candidate.name === 'string' ? candidate.name : undefined
      }
    }
  }
  throw new ArisCanvasCommandError(
    'missing-create-attrs',
    'Shape has no ARIS object type/symbol to create.'
  )
}

/** Reuse an existing `CxnDef` for the same (from, to, type) triple. */
export function findConnectionDefinitionId(
  document: ArisWorkingDocument,
  fromObjectDefinitionId: string,
  toObjectDefinitionId: string,
  connectionType: string
): string | null {
  for (const [id, definition] of document.connectionDefinitions) {
    if (
      definition.fromObjectDefinitionId === fromObjectDefinitionId &&
      definition.toObjectDefinitionId === toObjectDefinitionId &&
      definition.type === connectionType
    ) {
      return id
    }
  }
  return null
}

/** Shift an occurrence's external `AT_NAME` caption by a delta. */
function setAttributeOccurrencePlacementCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  occurrenceId: string,
  dx: number,
  dy: number
): ArisEditCommand {
  const occurrence = findOccurrence(document, occurrenceId)
  if (!occurrence)
    throw new ArisCanvasCommandError('missing-occurrence', `Unknown occurrence ${occurrenceId}.`)
  const existing = occurrence.attributeOccurrences.find((entry) => entry.attributeType === AT_NAME)
  // `invertCommand` inverts this kind by swapping `before`/`after`, so `before`
  // must be a *complete* placement rather than `null`: a zero offset is how the
  // model expresses "caption sits inside the symbol".
  const previous: ArisAttributeOccurrence = Object.freeze({
    attributeType: AT_NAME,
    port: existing?.port ?? null,
    orderNum: existing?.orderNum ?? null,
    alignment: existing?.alignment ?? null,
    offsetX: existing?.offsetX ?? 0,
    offsetY: existing?.offsetY ?? 0,
    width: existing?.width ?? null,
    height: existing?.height ?? null,
    rotation: existing?.rotation ?? null,
    symbolFlag: existing?.symbolFlag ?? null,
    fontStyleSheetId: existing?.fontStyleSheetId ?? null
  })
  const placement: ArisAttributeOccurrence = Object.freeze({
    ...previous,
    offsetX: (previous.offsetX ?? 0) + dx,
    offsetY: (previous.offsetY ?? 0) + dy
  })
  return Object.freeze({
    commandId: context.commandId,
    baseRevision: context.baseRevision,
    kind: 'setAttributeOccurrencePlacement',
    affectedSourceIds: Object.freeze([occurrenceId]),
    before: Object.freeze({ occurrenceId, attributeType: AT_NAME, placement: previous }),
    after: Object.freeze({ occurrenceId, attributeType: AT_NAME, placement }),
    origin: context.origin ?? 'user'
  })
}

export { findConnectionOccurrence }
