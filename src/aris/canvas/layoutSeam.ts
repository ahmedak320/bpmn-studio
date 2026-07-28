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
import { ArisCanvasCommandError, ArisCommandBridge } from './commandBridge'
import { ArisDocumentStore, type ArisCommandThunk } from './documentStore'
import { moveOccurrenceCommand, setConnectionRouteCommand } from './commandFactory'
import { isSatelliteObjectType, ruleOperatorOfSymbol } from './vocabulary'

export interface ArisLayoutSeamPoint {
  readonly x: number
  readonly y: number
}

export interface ArisLayoutSeamNode {
  readonly id: string
  readonly role: 'function' | 'event' | 'rule' | 'satellite' | 'other'
  readonly operator?: 'and' | 'or' | 'xor'
  readonly size: { readonly width: number; readonly height: number }
  readonly sourcePosition?: ArisLayoutSeamPoint
  readonly laneId?: string
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
  readonly lanes?: readonly { readonly id: string; readonly orientation: 'horizontal' | 'vertical' }[]
}

export interface ArisLayoutSeamResult {
  readonly nodes: readonly {
    readonly id: string
    readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  }[]
  readonly edges: readonly { readonly id: string; readonly points: readonly ArisLayoutSeamPoint[] }[]
}

export type ArisCleanLayoutEngine = (graph: ArisLayoutSeamGraph) => ArisLayoutSeamResult

/** Project the active model into the layout lane's graph shape. */
export function buildLayoutGraph(document: ArisWorkingDocument, model: ArisModel): ArisLayoutSeamGraph {
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
    return Object.freeze({
      id: occurrence.id,
      role,
      ...(role === 'rule' && operator
        ? { operator: operator.toLowerCase() as 'and' | 'or' | 'xor' }
        : {}),
      size: { width: occurrence.bounds.width, height: occurrence.bounds.height },
      sourcePosition: { x: occurrence.bounds.x, y: occurrence.bounds.y }
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
    lanes: Object.freeze(
      model.lanes.map((lane) => ({
        id: lane.id,
        orientation: (lane.orientation === 'vertical' ? 'vertical' : 'horizontal') as 'horizontal' | 'vertical'
      }))
    )
  })
}

/**
 * Apply a clean layout as one undoable gesture.
 *
 * Only the working layout revision changes: positions become `moveOccurrence`
 * commands and routes become `setConnectionRoute` commands. The imported source
 * snapshot is untouched, and undo restores the previous layout exactly.
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
  if (thunks.length === 0) return
  bridge.execute('clean-layout', thunks)
}
