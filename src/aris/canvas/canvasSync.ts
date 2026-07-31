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

import type {
  ArisAttribute,
  ArisAttributeOccurrence,
  ArisBounds,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisLane,
  ArisModel,
  ArisObjectOccurrence,
  ArisPoint,
  ArisStyleCatalog,
  ArisWorkingDocument
} from '../model/types'
import { resolveArisSymbol } from '../symbols'
import { ArisDocumentStore } from './documentStore'
import { DEFAULT_LOCALE_ID } from './emptyDocument'
import {
  arisBusinessObject,
  connectionLabelElementId,
  freeTextElementId,
  labelElementId,
  laneElementId,
  rootElementId,
  type ArisAttributeSymbolFlag,
  type ArisConnectionBusinessObject,
  type ArisConnectionLabelBusinessObject,
  type ArisFreeTextBusinessObject,
  type ArisLabelBusinessObject,
  type ArisLabelFont,
  type ArisLaneBusinessObject,
  type ArisModelBusinessObject,
  type ArisOccurrenceAttributeLabel,
  type ArisOccurrenceBusinessObject
} from './elements'
import { measureTextWidth } from '../renderer/textWrap'
import { readLocalized } from './localization'
import { connectionWaypoints, type ConnectionPort } from './waypoints'
import { AT_NAME } from './vocabulary'

/** Thickness of a lane band whose model gives no usable explicit extent. */
export const LANE_DEFAULT_THICKNESS = 240
/**
 * Extent of the notional canvas a lane band is measured against when the model
 * places no content at all. A model with occurrences derives its band extent
 * from those occurrences instead — see `laneBandBounds`.
 */
export const LANE_FALLBACK_LENGTH = 1200
const EXTERNAL_LABEL_DEFAULT_WIDTH = 120
const EXTERNAL_LABEL_DEFAULT_HEIGHT = 24
/**
 * Extent of the marker a `SymbolFlag="SYMBOL"` placement draws, when its
 * `<AttrOcc>` carries no usable `<Size>` — which is every one of AnimalWF's
 * 123 connection placements (`Size.dX="0" Size.dY="0"`).
 */
export const CONNECTION_LABEL_SYMBOL_SIZE = 14
/** Height of one line of connection-label text at the canvas caption size. */
export const CONNECTION_LABEL_LINE_HEIGHT = 16
/** Caption size the canvas draws labels at; see `renderer.ts`. */
const CONNECTION_LABEL_FONT_SIZE = 12
/** Box drawn for a free-text note whose source record carries no `Size`. */
export const FREE_TEXT_DEFAULT_WIDTH = 160
export const FREE_TEXT_DEFAULT_HEIGHT = 32

function sameNumber(a: number | undefined, b: number): boolean {
  return typeof a === 'number' && a === b
}

interface SourceGeometryIndex {
  readonly boundsByOccurrenceId: ReadonlyMap<string, ArisBounds>
  readonly routeByConnectionId: ReadonlyMap<string, readonly ArisPoint[]>
}

function sourceNumber(value: number | null | undefined): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0
}

/** Immutable geometry as it appeared in the imported source index. */
function sourceGeometryIndex(document: ArisWorkingDocument): SourceGeometryIndex {
  const boundsByOccurrenceId = new Map<string, ArisBounds>()
  for (const source of document.sourceIndex.objectOccurrences.values()) {
    const id = source.parsed.objectOccurrenceId
    if (!id) continue
    boundsByOccurrenceId.set(
      id,
      Object.freeze({
        x: sourceNumber(source.parsed.x),
        y: sourceNumber(source.parsed.y),
        width: sourceNumber(source.parsed.dx),
        height: sourceNumber(source.parsed.dy)
      })
    )
  }

  const pointsByConnectionId = new Map<
    string,
    { readonly pointIndex: number; readonly point: ArisPoint }[]
  >()
  for (const source of document.sourceIndex.routePoints) {
    const id = source.connectionOccurrenceId
    if (!id) continue
    const points = pointsByConnectionId.get(id) ?? []
    points.push({
      pointIndex: source.pointIndex,
      point: Object.freeze({ x: sourceNumber(source.x), y: sourceNumber(source.y) })
    })
    pointsByConnectionId.set(id, points)
  }
  const routeByConnectionId = new Map<string, readonly ArisPoint[]>()
  for (const [id, points] of pointsByConnectionId) {
    routeByConnectionId.set(
      id,
      Object.freeze(
        points.sort((left, right) => left.pointIndex - right.pointIndex).map((entry) => entry.point)
      )
    )
  }
  return Object.freeze({ boundsByOccurrenceId, routeByConnectionId })
}

function sameBounds(left: ArisBounds, right: ArisBounds | undefined): boolean {
  return (
    right !== undefined &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

function sameRoute(left: readonly ArisPoint[], right: readonly ArisPoint[] | undefined): boolean {
  return (
    right !== undefined &&
    left.length === right.length &&
    left.every((point, index) => point.x === right[index]?.x && point.y === right[index]?.y)
  )
}

/**
 * Source routes are preserved only while both their points and endpoint occurrences still match
 * the import. A move, reroute, clean-layout result, or authored connection deliberately leaves
 * this state and is then docked to descriptor ports.
 */
export function isUntouchedSourceConnection(
  connection: ArisConnectionOccurrence,
  source: ArisObjectOccurrence,
  target: ArisObjectOccurrence,
  sourceGeometry: SourceGeometryIndex
): boolean {
  return (
    connection.route.length > 0 &&
    sameRoute(connection.route, sourceGeometry.routeByConnectionId.get(connection.id)) &&
    sameBounds(source.bounds, sourceGeometry.boundsByOccurrenceId.get(source.id)) &&
    sameBounds(target.bounds, sourceGeometry.boundsByOccurrenceId.get(target.id))
  )
}

function sourceConnectionVisible(connection: ArisConnectionOccurrence): boolean {
  const visible = connection.rawAttributes['Visible']?.trim().toUpperCase()
  if (visible === 'NO' || visible === 'FALSE' || visible === '0' || visible === 'HIDDEN')
    return false
  return connection.style.lineStyle?.trim().toLowerCase() !== 'invisible'
}

/**
 * A size the source left unset.
 *
 * AML writes `Size.dX="0" Size.dY="0"` for "no explicit size", so `??` is the
 * wrong operator here: it only replaces `null`/`undefined` and happily lets a
 * literal `0` through, which renders an invisible 0×0 box. Any non-positive or
 * non-finite value therefore falls back to the default.
 */
function positiveOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * A sized free-text box's left edge for its horizontal `Alignment` (Wave 9
 * P6; fixplan §3.5). ARIS writes `Position` as the box's top-left only for
 * `LEFT`; a `CENTER`/`RIGHT` note anchors the box AT `Position` by its
 * alignment instead — the Reference-Laws title (`Size.dX=544` `CENTER` at
 * `x=6267`) prints its text centred ON 6267, which only happens if the box
 * itself starts 272 units (half of 544) to the left of Position, not at it.
 */
function sizedFreeTextX(x: number, width: number, alignment: string | null): number {
  switch ((alignment ?? '').trim().toUpperCase()) {
    case 'CENTER':
      return x - width / 2
    case 'RIGHT':
      return x - width
    default:
      // LEFT, and any other/absent value: Position is already the left edge.
      return x
  }
}

export type ArisLaneOrientation = 'horizontal' | 'vertical'

/**
 * Read a lane's orientation, whatever case it was written in.
 *
 * AML writes `Orientation="HORIZONTAL"` / `"VERTICAL"`; the canvas's own
 * authoring commands write the lower-case spelling. Comparing case-sensitively
 * against `'vertical'` silently classified every imported lane as horizontal,
 * which collapsed each model's horizontal/vertical pair into two identical
 * bands.
 */
export function laneOrientation(value: string | null | undefined): ArisLaneOrientation {
  return typeof value === 'string' && value.trim().toLowerCase() === 'vertical'
    ? 'vertical'
    : 'horizontal'
}

export interface ArisRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * A free-text note's drawn rectangle. An unsized note keeps `Position` as the
 * box's top-left, and a missing or non-positive size becomes a default box
 * rather than nothing. A note with an explicit `Size.dX>0`, though, anchors
 * its box BY ITS `Alignment` AT `Position` instead of always reading
 * `Position` as the top-left (Wave 9 P6; fixplan §3.5): `CENTER` anchors the
 * box's horizontal centre there, `RIGHT` its right edge, `LEFT` its left edge
 * (today's behaviour, unchanged). `alignment` defaults to `null` (the LEFT/
 * top-left reading) for callers with no source record to ask — only the
 * shape actually drawn on canvas (`syncFreeText`) needs the true anchor;
 * `modelContentBounds`'s own growth pass keeps reading the box as before.
 */
export function freeTextBounds(bounds: ArisBounds, alignment: string | null = null): ArisRect {
  const width = positiveOr(bounds.width, FREE_TEXT_DEFAULT_WIDTH)
  return Object.freeze({
    x: bounds.width > 0 ? sizedFreeTextX(bounds.x, width, alignment) : bounds.x,
    y: bounds.y,
    width,
    height: positiveOr(bounds.height, FREE_TEXT_DEFAULT_HEIGHT)
  })
}

/**
 * A free-text note's own `Alignment` attribute, read from the source record
 * the working note came from (mirrors `renderer.ts`'s private
 * `freeTextAlignment`, which does the identical lookup from the
 * `documentStore` handle it has instead of `canvasSync`'s own `this.store`;
 * neither module can reach the other's handle, so both read
 * `sourceIndex.freeTextOccurrences` independently). `null` when the note has
 * no source record (an authored-on-canvas note) or the record carries no
 * `Alignment`.
 */
function freeTextSourceAlignment(document: ArisWorkingDocument, freeTextId: string): string | null {
  const source = document.sourceIndex.freeTextOccurrences.find(
    (occurrence) => occurrence.sourceId === freeTextId
  )
  return source?.rawAttributes['Alignment'] ?? null
}

function isUsableBounds(bounds: ArisBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
  )
}

/**
 * The rectangle the model's own content occupies — every occurrence and every
 * free-text box. Lane bands are decoration derived *from* this rectangle, so
 * they are deliberately not part of it.
 *
 * `null` when the model places nothing.
 */
export function modelContentBounds(model: ArisModel): ArisRect | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const grow = (bounds: ArisBounds): void => {
    if (!isUsableBounds(bounds)) return
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  for (const occurrence of model.occurrences) grow(occurrence.bounds)
  // The *drawn* box, so a note the source left unsized still counts.
  for (const text of model.freeText) grow(freeTextBounds(text.bounds))
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
}

/**
 * The band a lane draws, derived from the model's content.
 *
 * AML describes a lane as an orientation plus a `StartBorder`/`EndBorder` pair
 * measured *across* the lane. It says nothing at all about how far the lane
 * runs, so the band runs exactly as far as the model's own content does — a
 * constant length would either crop the content or, as before this fix,
 * dwarf it.
 *
 * A span that already covers the content end to end locates nothing, so it is
 * treated as no explicit extent. That is what AnimalWF's
 * `StartBorder=0 EndBorder=50000` is: ARIS's "spans the whole canvas"
 * sentinel. Taken literally it produced a 50000-unit frame around roughly 6000
 * units of content, which is what made every model unreadable.
 */
export function laneBandBounds(
  lane: Pick<ArisLane, 'orientation' | 'startBorder' | 'endBorder'>,
  index: number,
  content: ArisRect | null
): ArisRect {
  const area = content ?? {
    x: 0,
    y: 0,
    width: LANE_FALLBACK_LENGTH,
    height: LANE_FALLBACK_LENGTH
  }
  const horizontal = laneOrientation(lane.orientation) === 'horizontal'
  const crossMin = horizontal ? area.y : area.x
  const crossMax = horizontal ? area.y + area.height : area.x + area.width
  const span = explicitLaneSpan(lane, crossMin, crossMax)
  const offset = span ? span.start : crossMin + index * LANE_DEFAULT_THICKNESS
  const thickness = span ? span.end - span.start : LANE_DEFAULT_THICKNESS
  return Object.freeze(
    horizontal
      ? { x: area.x, y: offset, width: area.width, height: thickness }
      : { x: offset, y: area.y, width: thickness, height: area.height }
  )
}

/**
 * The lane's `StartBorder`/`EndBorder` span, clipped to the content, or `null`
 * when the pair carries no usable information: absent, empty, entirely outside
 * the content, or covering all of it (the full-canvas sentinel).
 */
function explicitLaneSpan(
  lane: Pick<ArisLane, 'startBorder' | 'endBorder'>,
  crossMin: number,
  crossMax: number
): { readonly start: number; readonly end: number } | null {
  const start = lane.startBorder
  const end = lane.endBorder
  if (typeof start !== 'number' || typeof end !== 'number') return null
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const clippedStart = Math.max(start, crossMin)
  const clippedEnd = Math.min(end, crossMax)
  if (clippedEnd <= clippedStart) return null
  if (clippedStart <= crossMin && clippedEnd >= crossMax) return null
  return { start: clippedStart, end: clippedEnd }
}

export class ArisCanvasSync {
  static $inject = ['canvas', 'elementFactory', 'elementRegistry', 'eventBus', 'arisDocumentStore']

  private renderedModelId: string | null = null
  private currentDisplayLocaleId = DEFAULT_LOCALE_ID

  constructor(
    private readonly canvas: Canvas,
    private readonly elementFactory: ElementFactory,
    private readonly elementRegistry: ElementRegistry,
    private readonly eventBus: EventBus,
    private readonly store: ArisDocumentStore
  ) {}

  /** Set the locale used for all captions on the next sync. */
  setDisplayLocale(localeId: string): void {
    this.currentDisplayLocaleId = localeId
  }

  /** The model id currently projected onto the canvas. */
  get modelId(): string | null {
    return this.renderedModelId
  }

  /** The locale currently used for caption rendering. */
  get displayLocaleId(): string {
    return this.currentDisplayLocaleId
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
    const sourceGeometry = sourceGeometryIndex(document)

    this.syncRoot(model)
    this.syncLanes(model, desiredShapeIds, dirty)
    this.syncOccurrences(model, desiredShapeIds, dirty)
    this.syncFreeText(model, desiredShapeIds, dirty)
    this.syncLabels(model, desiredShapeIds, dirty)
    this.syncConnections(model, desiredConnectionIds, dirty, sourceGeometry)
    // After the connections: a connection label's `labelTarget` is its
    // connection element, which only exists once `syncConnections` has run.
    this.syncConnectionLabels(model, desiredShapeIds, dirty, sourceGeometry)
    this.removeStale(desiredShapeIds, desiredConnectionIds)
    this.applyDrawOrder()

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
      name: readLocalized(model.names, this.displayLocaleId)
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
    const content = modelContentBounds(model)
    model.lanes.forEach((lane, index) => {
      const id = laneElementId(lane.id)
      desired.add(id)
      const bounds = laneBandBounds(lane, index, content)
      const businessObject: ArisLaneBusinessObject = Object.freeze({
        kind: 'lane',
        modelId: model.id,
        laneId: lane.id,
        orientation: laneOrientation(lane.orientation),
        name: readLocalized(lane.names, this.displayLocaleId)
      })
      this.upsertShape(id, bounds, businessObject, dirty, { isFrame: true })
    })
  }

  private syncOccurrences(model: ArisModel, desired: Set<string>, dirty: Element[]): void {
    const definitions = this.store.document.objectDefinitions
    for (const occurrence of model.occurrences) {
      desired.add(occurrence.id)
      const definition = definitions.get(occurrence.definitionId)
      const businessObject: ArisOccurrenceBusinessObject & {
        readonly zOrder: number | null
      } = Object.freeze({
        kind: 'occurrence',
        modelId: model.id,
        modelType: model.type,
        occurrenceId: occurrence.id,
        definitionId: occurrence.definitionId,
        objectType: definition?.type ?? 'OT_UNKNOWN',
        symbolNum: occurrence.symbol,
        name: readLocalized(definition?.names, this.displayLocaleId),
        // §12.2: the occurrence's own pen/brush overrides the symbol's authored
        // appearance. The renderer cannot reach the working document, so a
        // style that is not carried here is a style that never draws.
        style: Object.freeze({
          fillColor: occurrence.style.fillColor,
          strokeColor: occurrence.style.strokeColor,
          strokeWidth: occurrence.style.strokeWidth,
          lineStyle: occurrence.style.lineStyle
        }),
        attributeLabels: occurrenceAttributeLabels(this.store.document, occurrence),
        zOrder: occurrence.style.zOrder
      })
      this.upsertShape(occurrence.id, occurrence.bounds, businessObject, dirty)
    }
  }

  private syncFreeText(model: ArisModel, desired: Set<string>, dirty: Element[]): void {
    const catalog = this.store.document.styleCatalog
    for (const text of model.freeText) {
      const id = freeTextElementId(text.id)
      desired.add(id)
      const businessObject: ArisFreeTextBusinessObject & {
        readonly font: ArisLabelFont | null
        readonly zOrder: number | null
      } = Object.freeze({
        kind: 'freeText',
        modelId: model.id,
        freeTextId: text.id,
        text: readLocalized(text.text, this.displayLocaleId),
        font: resolveLabelFont(catalog, text.style.fontStyleSheetId),
        zOrder: text.style.zOrder
      })
      // Real exports write `<FFTextOcc>` with a `Position` and no `Size` at
      // all — ARIS sizes the note to its text. Rendering that literally draws
      // a 0x0 box, i.e. nothing at all, so an unset size takes a default. A
      // note WITH an explicit `Size.dX>0` anchors its box by its `Alignment`
      // at `Position` instead of always reading `Position` as the top-left
      // (Wave 9 P6; fixplan §3.5).
      const alignment = freeTextSourceAlignment(this.store.document, text.id)
      this.upsertShape(id, freeTextBounds(text.bounds, alignment), businessObject, dirty)
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
      const businessObject: ArisLabelBusinessObject & {
        readonly zOrder: number | null
      } = Object.freeze({
        kind: 'label',
        modelId: model.id,
        ownerOccurrenceId: occurrence.id,
        attributeType: AT_NAME,
        text: readLocalized(definition?.names, this.displayLocaleId),
        zOrder: occurrence.style.zOrder
      })
      const bounds = externalNameRect(placement, occurrence.bounds)
      const owner = this.elementRegistry.get(occurrence.id) as Shape | undefined
      this.upsertShape(id, bounds, businessObject, dirty, { label: true, labelTarget: owner })
    }
  }

  private syncConnections(
    model: ArisModel,
    desired: Set<string>,
    dirty: Element[],
    sourceGeometry: SourceGeometryIndex
  ): void {
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
      const businessObject: ArisConnectionBusinessObject & {
        readonly color: string | null
        readonly width: number | null
        readonly lineStyle: string | null
        readonly srcArrow: string | null
        readonly tgtArrow: string | null
        readonly visible: boolean
        readonly zOrder: number | null
      } = Object.freeze({
        kind: 'connection',
        modelId: model.id,
        connectionOccurrenceId: connection.id,
        definitionId: connection.definitionId,
        connectionType: definition?.type ?? 'CT_UNKNOWN',
        sourceOccurrenceId: connection.sourceOccurrenceId,
        targetOccurrenceId: connection.targetOccurrenceId,
        name: readLocalized(definition?.names, this.displayLocaleId),
        color: connection.style.color,
        width: connection.style.width,
        lineStyle: connection.style.lineStyle,
        srcArrow: connection.style.srcArrow,
        tgtArrow: connection.style.tgtArrow,
        visible: sourceConnectionVisible(connection),
        zOrder: connection.style.zOrder
      })
      const waypoints = this.projectConnectionWaypoints(
        model,
        connection,
        source,
        target,
        sourceGeometry
      )
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

  /**
   * Create a label element for every `<AttrOcc>` child of every `<CxnOcc>`.
   *
   * This is the connection-side twin of `syncLabels`: same projection (one
   * `ArisAttributeOccurrence` becomes one diagram-js label), same `upsertShape`
   * path, same renderer. Only the anchor differs — an external caption is
   * placed relative to its occurrence's box, a connection label relative to its
   * route's midpoint (plan §12.1, "attribute occurrence placement").
   *
   * Unlike `syncLabels` there is no zero-offset short circuit: a connection has
   * no interior to fall back into, so `OffsetX="0" OffsetY="0"` means "sit on
   * the midpoint", which is exactly where 95 of AnimalWF's 123 placements sit.
   */
  private syncConnectionLabels(
    model: ArisModel,
    desired: Set<string>,
    dirty: Element[],
    sourceGeometry: SourceGeometryIndex
  ): void {
    const definitions = this.store.document.connectionDefinitions
    const catalog = this.store.document.styleCatalog
    const occurrenceById = new Map(
      model.occurrences.map((occurrence) => [occurrence.id, occurrence])
    )
    for (const connection of model.connectionOccurrences) {
      if (connection.attributeOccurrences.length === 0) continue
      const source = occurrenceById.get(connection.sourceOccurrenceId)
      const target = occurrenceById.get(connection.targetOccurrenceId)
      if (!source || !target) continue
      const waypoints = this.projectConnectionWaypoints(
        model,
        connection,
        source,
        target,
        sourceGeometry
      )
      const midpoint = routeMidpoint(waypoints)
      if (!midpoint) continue
      const definition = definitions.get(connection.definitionId)
      const owner = this.elementRegistry.get(connection.id) as Connection | undefined
      connection.attributeOccurrences.forEach((placement, index) => {
        const id = connectionLabelElementId(connection.id, index, placement.attributeType)
        desired.add(id)
        const businessObject: ArisConnectionLabelBusinessObject & {
          readonly zOrder: number | null
        } = Object.freeze({
          kind: 'connectionLabel',
          modelId: model.id,
          ownerConnectionOccurrenceId: connection.id,
          attributeType: placement.attributeType,
          symbolFlag: attributeSymbolFlag(placement.symbolFlag),
          alignment: placement.alignment,
          port: placement.port,
          orderNum: placement.orderNum,
          rotation: placement.rotation,
          fontStyleSheetId: placement.fontStyleSheetId,
          font: resolveLabelFont(catalog, placement.fontStyleSheetId),
          text: connectionLabelText(placement, definition, this.displayLocaleId),
          zOrder: connection.style.zOrder
        })
        const bounds = connectionLabelRect(placement, midpoint, {
          symbolFlag: businessObject.symbolFlag,
          text: businessObject.text
        })
        this.upsertShape(id, bounds, businessObject, dirty, {
          label: true,
          labelTarget: owner
        })
      })
    }
  }

  private projectConnectionWaypoints(
    model: ArisModel,
    connection: ArisConnectionOccurrence,
    source: ArisObjectOccurrence,
    target: ArisObjectOccurrence,
    sourceGeometry: SourceGeometryIndex
  ): readonly ArisPoint[] {
    return connectionWaypoints(source.bounds, target.bounds, connection.route, {
      selfLoop: source.id === target.id,
      preserveRoute: isUntouchedSourceConnection(connection, source, target, sourceGeometry),
      sourcePorts: this.descriptorPorts(model, source),
      targetPorts: this.descriptorPorts(model, target)
    })
  }

  private descriptorPorts(
    model: ArisModel,
    occurrence: ArisObjectOccurrence
  ): readonly ConnectionPort[] {
    const definition = this.store.document.objectDefinitions.get(occurrence.definitionId)
    return resolveArisSymbol({
      modelType: model.type,
      objectType: definition?.type ?? 'OT_UNKNOWN',
      symbolNum: occurrence.symbol
    }).descriptor.ports
  }

  /**
   * diagram-js normally keeps shapes and connections in creation order. AML has one Zorder axis
   * for every visual record, so reconcile both the element tree and each shared SVG parent onto
   * that axis after all records exist. Attribute labels inherit their owner's z-order and sort
   * immediately after it.
   */
  private applyDrawOrder(): void {
    const root = this.root() as Root & { children?: Element[] }
    const children = root.children
    if (!children || children.length < 2) return
    const originalIndex = new Map(children.map((element, index) => [element.id, index]))
    const zOrderOf = (element: Element): number => {
      const businessObject = arisBusinessObject(element)
      if (businessObject?.kind === 'lane') return Number.NEGATIVE_INFINITY
      const value = (businessObject as ({ readonly zOrder?: number | null } & object) | null)
        ?.zOrder
      return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
    }
    const labelRank = (element: Element): number => {
      const kind = arisBusinessObject(element)?.kind
      return kind === 'label' || kind === 'connectionLabel' ? 1 : 0
    }
    children.sort(
      (left, right) =>
        zOrderOf(left) - zOrderOf(right) ||
        labelRank(left) - labelRank(right) ||
        (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
    )

    const graphicsByParent = new Map<Node, SVGElement[]>()
    for (const element of children) {
      const graphics = this.elementRegistry.getGraphics(element.id) as SVGElement | undefined
      if (!graphics?.parentNode) continue
      const zOrder = zOrderOf(element)
      if (Number.isFinite(zOrder)) graphics.setAttribute('data-aris-z-order', String(zOrder))
      const siblings = graphicsByParent.get(graphics.parentNode) ?? []
      siblings.push(graphics)
      graphicsByParent.set(graphics.parentNode, siblings)
    }
    for (const [parent, graphics] of graphicsByParent) {
      for (const node of graphics) parent.appendChild(node)
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
      readonly labelTarget?: Shape | Connection
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
 *
 * A non-positive `width`/`height` is normalized to `null`: real exports carry
 * `<Size Size.dX="0" Size.dY="0">` for captions they never sized, and a caller
 * defaulting with `??` would otherwise render a 0×0 label.
 */
export function externalNamePlacement(
  occurrence: ArisObjectOccurrence
): ExternalNamePlacement | null {
  const placement = occurrence.attributeOccurrences.find((entry) => entry.attributeType === AT_NAME)
  if (!placement) return null
  const offsetX = placement.offsetX ?? 0
  const offsetY = placement.offsetY ?? 0
  if (offsetX === 0 && offsetY === 0) return null
  // A small positive offset is an *interior* caption nudge, not a truly
  // external caption: ARIS keeps the name inside the box (e.g. the Requirements
  // card's AT_NAME `OffsetX=6 OffsetY=25`, the sheet's only non-zero AT_NAME
  // offset). Treating it as external created a second 120×24 label that wrapped
  // to a tall narrow column spilling over the neighbouring satellites *and*
  // duplicated the in-shape caption (fidelity plan §6.1). Only anchors that
  // actually land outside the owner box are external.
  const { width, height } = occurrence.bounds
  const anchorInsideBox =
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0 &&
    offsetX >= 0 &&
    offsetY >= 0 &&
    offsetX < width &&
    offsetY < height
  if (anchorInsideBox) return null
  return Object.freeze({
    offsetX,
    offsetY,
    width: positiveOrNull(placement.width),
    height: positiveOrNull(placement.height)
  })
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * The rectangle an external caption occupies for an owner drawn at `owner`.
 * The caption tracks its owner rigidly, so this is the one place that knows
 * how to derive it — the renderer and the clean layout both read it here.
 */
export function externalNameRect(placement: ExternalNamePlacement, owner: ArisRect): ArisRect {
  return Object.freeze({
    x: owner.x + (placement.offsetX ?? 0),
    y: owner.y + (placement.offsetY ?? 0),
    width: placement.width ?? EXTERNAL_LABEL_DEFAULT_WIDTH,
    height: placement.height ?? EXTERNAL_LABEL_DEFAULT_HEIGHT
  })
}

/**
 * The stored text of one attribute type for an occurrence: the occurrence-local source attribute
 * value first (an occurrence may override its definition), then the definition's own attribute.
 * `null` when neither carries a non-empty value. Reads only the working document — never a canvas
 * element — so it is safe to call every sync.
 */
function resolveOccurrenceAttributeText(
  document: ArisWorkingDocument,
  occurrence: ArisObjectOccurrence,
  attributeType: string
): string | null {
  for (const attribute of document.sourceIndex.attributes) {
    if (attribute.parsed.ownerSourceId !== occurrence.id) continue
    if (attribute.parsed.attributeType !== attributeType) continue
    for (const value of attribute.parsed.values) {
      const text = value.text.trim()
      if (text) return text
    }
  }
  const definition = document.objectDefinitions.get(occurrence.definitionId)
  if (definition) {
    for (const attribute of definition.attributes) {
      if (attribute.type !== attributeType) continue
      const text = attribute.values[0]?.text.trim()
      if (text) return text
    }
  }
  return null
}

/**
 * The read-only attribute annotations drawn inside an occurrence's group: every non-`AT_NAME`
 * `<AttrOcc>` that both (a) places itself outside the symbol — a non-zero offset, since a zero
 * offset means "inside", which the caption already owns — and (b) resolves to stored text. This is
 * what paints a function's `AT_PROC_CODE` / `AT_ID` numbering beside its symbol. The source
 * `<AttrOcc>` records are read, never rewritten (§12.2).
 *
 * ## Placement anchor (Wave 6, GEOM)
 *
 * The offset is measured from the occurrence's *centre* and the label box is *centred* on the
 * offset point — the same anchor rule `connectionLabelRect` uses for the connection-side twin
 * (plan §12.1). Verified against the paired AnimalWF PDFs (33 placements across the
 * register-owner / renew-profile / transfer sheets, three print scales): the numbering's text
 * centre lands at `occurrence centre + (OffsetX, OffsetY)` in raw canvas units with sub-unit
 * residuals, which puts "01" just below its card instead of on the wrapped caption's third line.
 * The offsets are plain canvas units, not twips: `OffsetX="215"` lands 530 units right of the
 * card's left edge (`670/2 + 215`), where 215 twips would be 38. The box keeps the source `<Size>`
 * when the placement carries one, and the default label extent otherwise — the renderer centres
 * the text in the box, so the box centre is what must sit on the anchor.
 */
export function occurrenceAttributeLabels(
  document: ArisWorkingDocument,
  occurrence: ArisObjectOccurrence
): readonly ArisOccurrenceAttributeLabel[] {
  const labels: ArisOccurrenceAttributeLabel[] = []
  for (const placement of occurrence.attributeOccurrences) {
    if (placement.attributeType === AT_NAME) continue
    const offsetX = placement.offsetX ?? 0
    const offsetY = placement.offsetY ?? 0
    if (offsetX === 0 && offsetY === 0) continue
    const text = resolveOccurrenceAttributeText(document, occurrence, placement.attributeType)
    if (!text) continue
    const width = positiveOrNull(placement.width) ?? EXTERNAL_LABEL_DEFAULT_WIDTH
    const height = positiveOrNull(placement.height) ?? EXTERNAL_LABEL_DEFAULT_HEIGHT
    const centerX = occurrence.bounds.width / 2 + offsetX
    const centerY = occurrence.bounds.height / 2 + offsetY
    labels.push(
      Object.freeze({
        attributeType: placement.attributeType,
        text,
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height
      })
    )
  }
  return Object.freeze(labels)
}

/**
 * The point halfway *along* a route, not the middle entry of its waypoint list.
 *
 * ARIS anchors a connection's labels to the middle of the drawn line, so a
 * route whose segments differ in length must measure by arc length: taking
 * `waypoints[Math.floor(n / 2)]` would drift toward whichever end carries the
 * most bends, which is precisely the L-shaped and Z-shaped routes AnimalWF is
 * full of.
 *
 * `null` when the route has no drawable extent at all.
 */
export function routeMidpoint(waypoints: readonly ArisPoint[]): ArisPoint | null {
  if (waypoints.length === 0) return null
  const first = waypoints[0] as ArisPoint
  if (waypoints.length === 1) return Object.freeze({ x: first.x, y: first.y })

  let total = 0
  for (let index = 1; index < waypoints.length; index += 1) {
    total += segmentLength(waypoints[index - 1] as ArisPoint, waypoints[index] as ArisPoint)
  }
  if (!Number.isFinite(total)) return null
  if (total === 0) return Object.freeze({ x: first.x, y: first.y })

  let remaining = total / 2
  for (let index = 1; index < waypoints.length; index += 1) {
    const from = waypoints[index - 1] as ArisPoint
    const to = waypoints[index] as ArisPoint
    const length = segmentLength(from, to)
    if (length >= remaining) {
      const ratio = length === 0 ? 0 : remaining / length
      return Object.freeze({
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio
      })
    }
    remaining -= length
  }
  const last = waypoints[waypoints.length - 1] as ArisPoint
  return Object.freeze({ x: last.x, y: last.y })
}

function segmentLength(from: ArisPoint, to: ArisPoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.sqrt(dx * dx + dy * dy)
  return Number.isFinite(length) ? length : 0
}

/**
 * The rectangle one connection label occupies.
 *
 * `OffsetX`/`OffsetY` are measured from the route midpoint, and the box is
 * *centred* on the offset point — a connection label straddles the line rather
 * than hanging off its top-left corner, which is what makes `Alignment="CENTER"`
 * (every one of AnimalWF's 123 placements) mean what it says.
 *
 * The extent is the source's when the `<AttrOcc>` sized it, and otherwise the
 * extent of what is actually drawn: a symbol marker is a fixed square, a text
 * placement is as wide as its text, and a placement whose attribute has no
 * stored value occupies nothing at all. That last case matters — 95 of the 123
 * AnimalWF placements name attributes the export never gave a value, and ARIS
 * draws nothing for them. Giving each of those a nominal box instead would put
 * dozens of invisible rectangles on the canvas and count them as overlaps in
 * every layout metric that measures labels.
 */
export function connectionLabelRect(
  placement: Pick<ArisAttributeOccurrence, 'offsetX' | 'offsetY' | 'width' | 'height'>,
  midpoint: ArisPoint,
  content: { readonly symbolFlag: ArisAttributeSymbolFlag; readonly text: string } = {
    symbolFlag: 'TEXT',
    text: ''
  }
): ArisRect {
  const drawn =
    content.symbolFlag === 'SYMBOL'
      ? { width: CONNECTION_LABEL_SYMBOL_SIZE, height: CONNECTION_LABEL_SYMBOL_SIZE }
      : content.text.length === 0
        ? { width: 0, height: 0 }
        : {
            width: measureTextWidth(content.text, CONNECTION_LABEL_FONT_SIZE),
            height: CONNECTION_LABEL_LINE_HEIGHT
          }
  const width = positiveOrNull(placement.width) ?? drawn.width
  const height = positiveOrNull(placement.height) ?? drawn.height
  return Object.freeze({
    x: midpoint.x + (placement.offsetX ?? 0) - width / 2,
    y: midpoint.y + (placement.offsetY ?? 0) - height / 2,
    width,
    height
  })
}

/**
 * `SymbolFlag`, normalized. Anything other than an explicit `SYMBOL` draws text:
 * the AML default when the attribute is absent is the textual placement, and an
 * unrecognized value must not silently blank a label.
 */
export function attributeSymbolFlag(value: string | null | undefined): ArisAttributeSymbolFlag {
  return typeof value === 'string' && value.trim().toUpperCase() === 'SYMBOL' ? 'SYMBOL' : 'TEXT'
}

/**
 * The text a `TEXT` placement draws: the value the connection *definition*
 * stores for that attribute type, with `AT_NAME` falling back to the
 * definition's name.
 *
 * An attribute the source never gave a value renders empty, exactly as ARIS
 * renders it. The placement element still exists — it is a real, positioned
 * source record (§6.4) and the canvas must not invent content for it.
 */
export function connectionLabelText(
  placement: Pick<ArisAttributeOccurrence, 'attributeType'>,
  definition: ArisConnectionDefinition | undefined,
  localeId = DEFAULT_LOCALE_ID
): string {
  if (!definition) return ''
  const attribute: ArisAttribute | undefined = definition.attributes.find(
    (entry) => entry.type === placement.attributeType
  )
  if (attribute) {
    const localized = readLocalized(
      Object.freeze({
        values: Object.freeze(
          Object.fromEntries(
            attribute.values.map((value) => [value.localeId ?? '', value.text] as const)
          )
        ),
        fallback: attribute.values[0]?.text ?? null
      }),
      localeId
    )
    if (localized.length > 0) return localized
  }
  return placement.attributeType === AT_NAME ? readLocalized(definition.names, localeId) : ''
}

/** The font a placement's `FontSS.IdRef` names, as far as the working style catalog knows it. */
export function resolveLabelFont(
  catalog: ArisStyleCatalog,
  fontStyleSheetId: string | null
): ArisLabelFont | null {
  if (!fontStyleSheetId) return null
  const style = catalog.styles.get(fontStyleSheetId)
  if (!style) return null
  return Object.freeze({
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    textColor: style.textColor
  })
}
