/**
 * The clean-layout seam — Plan Section 12.4.
 *
 * `src/aris/layout/` is owned by another lane and is still taking shape, so
 * this module deliberately does **not** import it. It declares the narrow
 * structural contract the canvas needs (build a graph → receive placements and
 * routes) and applies the result through ARIS commands like any other edit, so
 * a clean layout is one undo step and "Reset to Source Layout" is just undo.
 *
 * Wiring the real engine in is one call:
 *
 * ```ts
 * import { layoutArisGraph } from '../layout'
 * canvas.applyCleanLayout(layoutArisGraph)
 * ```
 *
 * Any function matching `ArisCleanLayoutEngine` works, which keeps the two
 * lanes independently testable.
 */

import type { ArisModel, ArisWorkingDocument } from '../model/types'
import {
  externalNamePlacement,
  externalNameRect,
  freeTextBounds,
  laneOrientation
} from './canvasSync'
import { ArisCanvasCommandError, ArisCommandBridge } from './commandBridge'
import { ArisDocumentStore, type ArisCommandThunk } from './documentStore'
import {
  editFreeTextCommand,
  moveOccurrenceCommand,
  setConnectionRouteCommand
} from './commandFactory'
import { isSatelliteObjectType, ruleOperatorOfSymbol } from './vocabulary'

export interface ArisLayoutSeamPoint {
  readonly x: number
  readonly y: number
}

export interface ArisLayoutSeamRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ArisLayoutSeamNode {
  readonly id: string
  readonly role: 'function' | 'event' | 'rule' | 'satellite' | 'other'
  readonly operator?: 'and' | 'or' | 'xor'
  readonly size: { readonly width: number; readonly height: number }
  readonly sourcePosition?: ArisLayoutSeamPoint
  /** Caption drawn at a fixed offset from the shape, when the source places one. */
  readonly externalCaption?: {
    readonly offsetX: number
    readonly offsetY: number
    readonly width: number
    readonly height: number
  }
  readonly laneId?: string
}

/**
 * A free-text note. It is passed separately from the nodes because it is not a
 * graph object: it has no connections and must never influence where the
 * control flow goes (plan §13.2). `rect` is the rectangle the canvas *draws* —
 * position from the source, size defaulted when the source declared none.
 */
export interface ArisLayoutSeamAnnotation {
  readonly id: string
  readonly rect: ArisLayoutSeamRect
}

export interface ArisLayoutSeamEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: 'control-flow' | 'satellite'
  readonly sourceRoute?: readonly ArisLayoutSeamPoint[]
}

export interface ArisLayoutSeamGraph {
  readonly id: string
  readonly nodes: readonly ArisLayoutSeamNode[]
  readonly edges: readonly ArisLayoutSeamEdge[]
  readonly lanes?: readonly {
    readonly id: string
    readonly orientation: 'horizontal' | 'vertical'
  }[]
  readonly annotations?: readonly ArisLayoutSeamAnnotation[]
}

export interface ArisLayoutSeamResult {
  readonly nodes: readonly {
    readonly id: string
    readonly rect: ArisLayoutSeamRect
  }[]
  readonly edges: readonly {
    readonly id: string
    readonly points: readonly ArisLayoutSeamPoint[]
  }[]
  /**
   * Where each free-text note ended up. Only `rect.x`/`rect.y` are applied —
   * a note's size stays whatever the source said, so a source that declared
   * none still declares none after a clean layout.
   */
  readonly annotations?: readonly ArisLayoutSeamAnnotation[]
}

export type ArisCleanLayoutEngine = (graph: ArisLayoutSeamGraph) => ArisLayoutSeamResult

/** Project the active model into the layout lane's graph shape. */
export function buildLayoutGraph(
  document: ArisWorkingDocument,
  model: ArisModel
): ArisLayoutSeamGraph {
  const definitions = document.objectDefinitions
  const connectionDefinitions = document.connectionDefinitions

  const nodes = model.occurrences.map((occurrence) => {
    const definition = definitions.get(occurrence.definitionId)
    const objectType = definition?.type ?? 'OT_UNKNOWN'
    const operator = ruleOperatorOfSymbol(occurrence.symbol)
    const role: ArisLayoutSeamNode['role'] =
      objectType === 'OT_FUNC'
        ? 'function'
        : objectType === 'OT_EVT'
          ? 'event'
          : objectType === 'OT_RULE'
            ? 'rule'
            : isSatelliteObjectType(objectType)
              ? 'satellite'
              : 'other'
    // A caption placed outside the symbol tracks its owner rigidly, so the
    // layout only needs the offset and the extent to keep it clear of notes.
    const caption = externalNamePlacement(occurrence)
    const captionRect = caption ? externalNameRect(caption, occurrence.bounds) : null
    return Object.freeze({
      id: occurrence.id,
      role,
      ...(role === 'rule' && operator
        ? { operator: operator.toLowerCase() as 'and' | 'or' | 'xor' }
        : {}),
      size: { width: occurrence.bounds.width, height: occurrence.bounds.height },
      sourcePosition: { x: occurrence.bounds.x, y: occurrence.bounds.y },
      ...(captionRect
        ? {
            externalCaption: {
              offsetX: captionRect.x - occurrence.bounds.x,
              offsetY: captionRect.y - occurrence.bounds.y,
              width: captionRect.width,
              height: captionRect.height
            }
          }
        : {})
    })
  })

  const nodeRole = new Map(nodes.map((node) => [node.id, node.role]))
  const edges = model.connectionOccurrences.map((connection) => {
    const sourceRole = nodeRole.get(connection.sourceOccurrenceId)
    const targetRole = nodeRole.get(connection.targetOccurrenceId)
    const isFlow =
      sourceRole !== undefined &&
      targetRole !== undefined &&
      sourceRole !== 'satellite' &&
      sourceRole !== 'other' &&
      targetRole !== 'satellite' &&
      targetRole !== 'other'
    return Object.freeze({
      id: connection.id,
      source: connection.sourceOccurrenceId,
      target: connection.targetOccurrenceId,
      kind: (isFlow ? 'control-flow' : 'satellite') as ArisLayoutSeamEdge['kind'],
      ...(connection.route.length > 0 ? { sourceRoute: connection.route } : {}),
      // Kept so a future engine can key on the ARIS type without a re-lookup.
      connectionType: connectionDefinitions.get(connection.definitionId)?.type ?? 'CT_UNKNOWN'
    })
  })

  return Object.freeze({
    id: model.id,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    // The *drawn* rectangle: a real `<FFTextOcc>` carries no `<Size>` at all,
    // so the layout has to be told the box the canvas actually paints.
    annotations: Object.freeze(
      model.freeText.map((text) =>
        Object.freeze({ id: text.id, rect: freeTextBounds(text.bounds) })
      )
    ),
    lanes: Object.freeze(
      model.lanes.map((lane) => ({
        // AML writes `HORIZONTAL`/`VERTICAL`; authored lanes write the
        // lower-case spelling. `laneOrientation` reads both.
        id: lane.id,
        orientation: laneOrientation(lane.orientation)
      }))
    )
  })
}

/**
 * Apply a clean layout as one undoable gesture.
 *
 * Only the working layout revision changes: occurrence positions become
 * `moveOccurrence` commands, routes become `setConnectionRoute` commands and
 * free-text notes become `editFreeText` commands that carry a **position
 * only**. The imported source snapshot is untouched, and undo restores the
 * previous layout exactly.
 *
 * A note's size is deliberately never written. `<FFTextOcc>` in a real export
 * has no `<Size>` child — ARIS sizes the note to its text — so writing one
 * would make the derived AML export insert an element the source never had.
 * The canvas supplies the drawn box at render time instead, and the layout is
 * told what that box is rather than storing it.
 */
export function applyCleanLayout(
  bridge: ArisCommandBridge,
  store: ArisDocumentStore,
  engine: ArisCleanLayoutEngine
): void {
  const document = store.document
  const model = document.models.get(store.activeModelId)
  if (!model) throw new ArisCanvasCommandError('missing-model', 'No active model to lay out.')

  const result = engine(buildLayoutGraph(document, model))
  const thunks: ArisCommandThunk[] = []

  for (const node of result.nodes) {
    const occurrenceId = node.id
    const x = node.rect.x
    const y = node.rect.y
    thunks.push((doc, context) => moveOccurrenceCommand(context, doc, occurrenceId, { x, y }))
  }
  for (const edge of result.edges) {
    const connectionId = edge.id
    const points = edge.points
    thunks.push((doc, context) => setConnectionRouteCommand(context, doc, connectionId, points))
  }
  const known = new Set(model.freeText.map((text) => text.id))
  for (const annotation of result.annotations ?? []) {
    if (!known.has(annotation.id)) continue
    const freeTextId = annotation.id
    const position = { x: annotation.rect.x, y: annotation.rect.y }
    thunks.push((doc, context) => editFreeTextCommand(context, doc, freeTextId, { position }))
  }
  if (thunks.length === 0) return
  bridge.execute('clean-layout', thunks)
}
