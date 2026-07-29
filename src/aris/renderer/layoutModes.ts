/**
 * Layout modes — Plan Section 12.4.
 *
 * Source Layout, Clean Layout, Reset to Source Layout, and layout undo/redo. This module only
 * manages *which* geometry is active and guarantees the source snapshot is never mutated; the
 * real clean-layout algorithm (automatic arrangement) is owned by the layout lane
 * (`src/aris/layout/`) and is injected here as `ArisCleanLayoutAlgorithm` — a narrow seam this
 * lane defines but does not implement. `DEFAULT_CLEAN_LAYOUT_ALGORITHM` below is a trivial,
 * deterministic stand-in used only so this module's plumbing is independently testable; it is
 * not a fidelity-bearing layout algorithm and callers should inject the real one.
 */

import type { RenderBounds, RenderModelDocument, RenderPoint } from './types'

export interface LayoutElementGeometry {
  readonly bounds: RenderBounds
}

export interface LayoutConnectionGeometry {
  readonly routePoints: readonly RenderPoint[]
}

export interface ArisLayoutGeometry {
  readonly elements: ReadonlyMap<string, LayoutElementGeometry>
  readonly connections: ReadonlyMap<string, LayoutConnectionGeometry>
}

export type ArisLayoutMode = 'source' | 'clean'

export type ArisCleanLayoutAlgorithm = (
  doc: RenderModelDocument,
  sourceGeometry: ArisLayoutGeometry
) => ArisLayoutGeometry

/** Extracts the exact, unmodified source geometry from a render model document. */
export function extractSourceGeometry(doc: RenderModelDocument): ArisLayoutGeometry {
  const elements = new Map<string, LayoutElementGeometry>()
  for (const element of doc.elements) {
    elements.set(element.id, { bounds: { ...element.sourceBounds } })
  }
  const connections = new Map<string, LayoutConnectionGeometry>()
  for (const connection of doc.connections) {
    connections.set(connection.id, {
      routePoints: connection.sourceRoutePoints.map((p) => ({ ...p }))
    })
  }
  return Object.freeze({ elements: freezeMap(elements), connections: freezeMap(connections) })
}

function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  for (const value of map.values()) Object.freeze(value)
  return map
}

/** Deep-clones a geometry snapshot so a stored revision can never be mutated by reference. */
export function cloneGeometry(geometry: ArisLayoutGeometry): ArisLayoutGeometry {
  const elements = new Map<string, LayoutElementGeometry>()
  for (const [id, value] of geometry.elements) {
    elements.set(id, Object.freeze({ bounds: { ...value.bounds } }))
  }
  const connections = new Map<string, LayoutConnectionGeometry>()
  for (const [id, value] of geometry.connections) {
    connections.set(id, Object.freeze({ routePoints: value.routePoints.map((p) => ({ ...p })) }))
  }
  return Object.freeze({ elements, connections })
}

/**
 * A trivial deterministic grid arrangement — NOT the plan's real clean-layout algorithm. It
 * exists only to exercise `ArisLayoutController`'s mode/undo/redo plumbing in tests without a
 * dependency on the layout lane. Production callers should inject the real algorithm from
 * `src/aris/layout/`.
 */
export const DEFAULT_CLEAN_LAYOUT_ALGORITHM: ArisCleanLayoutAlgorithm = (doc) => {
  const COLUMN_WIDTH = 200
  const ROW_HEIGHT = 120
  const COLUMNS = 4

  const elements = new Map<string, LayoutElementGeometry>()
  doc.elements.forEach((element, index) => {
    const col = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    elements.set(element.id, {
      bounds: {
        x: col * COLUMN_WIDTH,
        y: row * ROW_HEIGHT,
        width: element.sourceBounds.width,
        height: element.sourceBounds.height
      }
    })
  })

  const connections = new Map<string, LayoutConnectionGeometry>()
  for (const connection of doc.connections) {
    const from = connection.fromElementId ? elements.get(connection.fromElementId) : undefined
    const to = connection.toElementId ? elements.get(connection.toElementId) : undefined
    const start = from
      ? { x: from.bounds.x + from.bounds.width / 2, y: from.bounds.y + from.bounds.height / 2 }
      : (connection.sourceRoutePoints[0] ?? { x: 0, y: 0 })
    const end = to
      ? { x: to.bounds.x + to.bounds.width / 2, y: to.bounds.y + to.bounds.height / 2 }
      : (connection.sourceRoutePoints[connection.sourceRoutePoints.length - 1] ?? { x: 0, y: 0 })
    connections.set(connection.id, { routePoints: [start, end] })
  }

  return { elements, connections }
}

interface LayoutRevision {
  readonly mode: ArisLayoutMode
  readonly geometry: ArisLayoutGeometry
}

/**
 * Manages Source/Clean layout modes, reset-to-source, and undo/redo for one model document.
 * The original source snapshot (`getSourceGeometry`) is captured once at construction and is
 * never written to by any method on this class.
 */
export class ArisLayoutController {
  private readonly doc: RenderModelDocument
  private readonly sourceGeometry: ArisLayoutGeometry
  private readonly cleanLayoutAlgorithm: ArisCleanLayoutAlgorithm
  private history: LayoutRevision[]
  private cursor: number

  constructor(
    doc: RenderModelDocument,
    options?: { readonly cleanLayoutAlgorithm?: ArisCleanLayoutAlgorithm }
  ) {
    this.doc = doc
    this.sourceGeometry = extractSourceGeometry(doc)
    this.cleanLayoutAlgorithm = options?.cleanLayoutAlgorithm ?? DEFAULT_CLEAN_LAYOUT_ALGORITHM
    this.history = [{ mode: 'source', geometry: cloneGeometry(this.sourceGeometry) }]
    this.cursor = 0
  }

  /** The canonical, immutable source geometry. Reset always restores exactly this. */
  getSourceGeometry(): ArisLayoutGeometry {
    return this.sourceGeometry
  }

  getMode(): ArisLayoutMode {
    return this.history[this.cursor].mode
  }

  getActiveGeometry(): ArisLayoutGeometry {
    return this.history[this.cursor].geometry
  }

  /** Computes and activates a Clean Layout revision. Never touches `sourceGeometry`. */
  runCleanLayout(): void {
    const geometry = cloneGeometry(this.cleanLayoutAlgorithm(this.doc, this.sourceGeometry))
    this.pushRevision({ mode: 'clean', geometry })
  }

  /** Activates a fresh copy of the source geometry as the working revision. */
  resetToSourceLayout(): void {
    this.pushRevision({ mode: 'source', geometry: cloneGeometry(this.sourceGeometry) })
  }

  undo(): boolean {
    if (this.cursor === 0) return false
    this.cursor -= 1
    return true
  }

  redo(): boolean {
    if (this.cursor >= this.history.length - 1) return false
    this.cursor += 1
    return true
  }

  private pushRevision(revision: LayoutRevision): void {
    this.history = [...this.history.slice(0, this.cursor + 1), revision]
    this.cursor = this.history.length - 1
  }
}
