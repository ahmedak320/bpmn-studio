/**
 * Selection highlighting — Plan Section 11.5.
 *
 * The service computes an explicit, serializable **plan** first and only then
 * applies canvas markers. Everything Section 11.5 asks for is therefore
 * assertable without going near pixels:
 *
 * | Section 11.5 rule                              | Plan field                        |
 * | ---------------------------------------------- | --------------------------------- |
 * | highlight all incoming/outgoing typed relations | `relations[].role`, `.connectionType` |
 * | highlight the selected connection itself        | `relations[].role === 'selected'` |
 * | resolve a selected external label to its owner  | `ownerOccurrenceId`, `resolvedFromLabel` |
 * | highlight satellite relationships               | `relations[].satellite`           |
 * | deduplicate self-loops                          | one entry with `role === 'self-loop'` |
 * | colours/dashes for overlapping routes           | `relations[].colorIndex`, `.dashed` |
 * | no overlay for multi-selection / model roots    | `active === false` + `reason`     |
 *
 * Recomputation is driven by `selection.changed`, `elements.changed` and the
 * bridge's `aris.document.changed`, which together cover edit, reroute, model
 * switch, undo and redo — all five reach the canvas through the bridge.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type Selection from 'diagram-js/lib/features/selection/Selection'
import type { Element } from 'diagram-js/lib/model/Types'

import type { ArisWorkingDocument } from '../model/types'
import { ARIS_DOCUMENT_CHANGED } from './commandBridge'
import { ArisDocumentStore } from './documentStore'
import { arisBusinessObject } from './elements'
import { isSatelliteObjectType } from './vocabulary'

/** Marker applied to every highlighted element. */
export const ARIS_HIGHLIGHT_MARKER = 'aris-highlight'
/** Marker applied to the resolved owner of the selection. */
export const ARIS_HIGHLIGHT_OWNER_MARKER = 'aris-highlight-owner'
/** Marker prefix carrying the colour slot for overlapping routes. */
export const ARIS_HIGHLIGHT_COLOR_PREFIX = 'aris-highlight-color-'
/** Marker applied to the 2nd and later route between the same endpoint pair. */
export const ARIS_HIGHLIGHT_DASHED_MARKER = 'aris-highlight-dashed'

/** Distinct slots used to separate overlapping routes. */
export const ARIS_HIGHLIGHT_COLOR_SLOTS = 6

export type ArisHighlightRole = 'selected' | 'incoming' | 'outgoing' | 'self-loop'

export type ArisHighlightInactiveReason =
  | 'empty-selection'
  | 'multiple-selection'
  | 'root-selected'
  | 'unsupported-selection'

export interface ArisHighlightRelation {
  readonly connectionOccurrenceId: string
  readonly connectionType: string
  readonly role: ArisHighlightRole
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  /** The occurrence at the far end of the relation, or `null` for a self-loop. */
  readonly neighbourOccurrenceId: string | null
  /** `true` when the far end is a Section 11.3 satellite object type. */
  readonly satellite: boolean
  /** Colour slot; routes over the same endpoint pair get distinct slots. */
  readonly colorIndex: number
  /** `true` for the 2nd and later route between the same endpoint pair. */
  readonly dashed: boolean
}

export interface ArisHighlightPlan {
  readonly active: boolean
  readonly reason: ArisHighlightInactiveReason | null
  readonly ownerOccurrenceId: string | null
  readonly selectedConnectionId: string | null
  /** `true` when the selection was an external label resolved to its owner. */
  readonly resolvedFromLabel: boolean
  readonly relations: readonly ArisHighlightRelation[]
  /** Neighbour occurrences reachable through the highlighted relations. */
  readonly neighbourOccurrenceIds: readonly string[]
  /** Neighbours whose object type is a satellite type. */
  readonly satelliteOccurrenceIds: readonly string[]
}

export const EMPTY_HIGHLIGHT_PLAN: ArisHighlightPlan = Object.freeze({
  active: false,
  reason: 'empty-selection',
  ownerOccurrenceId: null,
  selectedConnectionId: null,
  resolvedFromLabel: false,
  relations: Object.freeze([]),
  neighbourOccurrenceIds: Object.freeze([]),
  satelliteOccurrenceIds: Object.freeze([])
})

function inactive(reason: ArisHighlightInactiveReason): ArisHighlightPlan {
  return Object.freeze({ ...EMPTY_HIGHLIGHT_PLAN, reason })
}

function endpointKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Compute the highlight plan for a selection.
 *
 * Pure: takes the document and the selected elements, returns data. This is the
 * function the Section 11.5 tests assert against.
 */
export function computeHighlightPlan(
  document: ArisWorkingDocument,
  modelId: string,
  selected: readonly Element[]
): ArisHighlightPlan {
  if (selected.length === 0) return inactive('empty-selection')
  if (selected.length > 1) return inactive('multiple-selection')

  const element = selected[0]
  const businessObject = arisBusinessObject(element)
  if (!businessObject) return inactive('unsupported-selection')
  if (businessObject.kind === 'model') return inactive('root-selected')
  if (businessObject.kind === 'lane' || businessObject.kind === 'freeText') {
    return inactive('unsupported-selection')
  }

  const model = document.models.get(modelId)
  if (!model) return inactive('unsupported-selection')

  const definitions = document.objectDefinitions
  const connectionDefinitions = document.connectionDefinitions
  const occurrenceById = new Map(model.occurrences.map((occurrence) => [occurrence.id, occurrence]))

  const objectTypeOf = (occurrenceId: string): string => {
    const occurrence = occurrenceById.get(occurrenceId)
    if (!occurrence) return 'OT_UNKNOWN'
    return definitions.get(occurrence.definitionId)?.type ?? 'OT_UNKNOWN'
  }

  let ownerOccurrenceId: string | null = null
  let selectedConnectionId: string | null = null
  let resolvedFromLabel = false

  if (businessObject.kind === 'occurrence') {
    ownerOccurrenceId = businessObject.occurrenceId
  } else if (businessObject.kind === 'label') {
    ownerOccurrenceId = businessObject.ownerOccurrenceId
    resolvedFromLabel = true
  } else {
    selectedConnectionId = businessObject.connectionOccurrenceId
  }

  // Which connections take part in the overlay.
  const candidates = model.connectionOccurrences.filter((connection) => {
    if (selectedConnectionId !== null) return connection.id === selectedConnectionId
    return (
      connection.sourceOccurrenceId === ownerOccurrenceId ||
      connection.targetOccurrenceId === ownerOccurrenceId
    )
  })

  // Colour slots are assigned per unordered endpoint pair so two routes that
  // overlap visually are always drawn apart.
  const pairCounters = new Map<string, number>()
  const relations: ArisHighlightRelation[] = []
  const neighbours: string[] = []
  const satellites: string[] = []

  for (const connection of candidates) {
    const pair = endpointKey(connection.sourceOccurrenceId, connection.targetOccurrenceId)
    const ordinal = pairCounters.get(pair) ?? 0
    pairCounters.set(pair, ordinal + 1)

    const isSelfLoop = connection.sourceOccurrenceId === connection.targetOccurrenceId
    let role: ArisHighlightRole
    if (selectedConnectionId !== null) role = 'selected'
    else if (isSelfLoop) role = 'self-loop'
    else if (connection.sourceOccurrenceId === ownerOccurrenceId) role = 'outgoing'
    else role = 'incoming'

    const neighbourOccurrenceId = isSelfLoop
      ? null
      : connection.sourceOccurrenceId === ownerOccurrenceId
        ? connection.targetOccurrenceId
        : connection.sourceOccurrenceId

    const satellite = neighbourOccurrenceId !== null && isSatelliteObjectType(objectTypeOf(neighbourOccurrenceId))

    relations.push(
      Object.freeze({
        connectionOccurrenceId: connection.id,
        connectionType: connectionDefinitions.get(connection.definitionId)?.type ?? 'CT_UNKNOWN',
        role,
        sourceOccurrenceId: connection.sourceOccurrenceId,
        targetOccurrenceId: connection.targetOccurrenceId,
        neighbourOccurrenceId,
        satellite,
        colorIndex: ordinal % ARIS_HIGHLIGHT_COLOR_SLOTS,
        dashed: ordinal > 0
      })
    )

    if (neighbourOccurrenceId !== null && !neighbours.includes(neighbourOccurrenceId)) {
      neighbours.push(neighbourOccurrenceId)
      if (satellite) satellites.push(neighbourOccurrenceId)
    }
  }

  // For a selected connection, both endpoints count as neighbours.
  if (selectedConnectionId !== null) {
    for (const relation of relations) {
      for (const endpoint of [relation.sourceOccurrenceId, relation.targetOccurrenceId]) {
        if (!neighbours.includes(endpoint)) {
          neighbours.push(endpoint)
          if (isSatelliteObjectType(objectTypeOf(endpoint))) satellites.push(endpoint)
        }
      }
    }
  }

  return Object.freeze({
    active: true,
    reason: null,
    ownerOccurrenceId,
    selectedConnectionId,
    resolvedFromLabel,
    relations: Object.freeze(relations),
    neighbourOccurrenceIds: Object.freeze(neighbours),
    satelliteOccurrenceIds: Object.freeze(satellites)
  })
}

export class ArisSelectionHighlight {
  static $inject = ['eventBus', 'canvas', 'elementRegistry', 'selection', 'arisDocumentStore']

  private plan: ArisHighlightPlan = EMPTY_HIGHLIGHT_PLAN
  private applied: string[] = []

  constructor(
    eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly elementRegistry: ElementRegistry,
    private readonly selection: Selection,
    private readonly store: ArisDocumentStore
  ) {
    // `elements.changed` covers edit and reroute; `aris.document.changed` is
    // fired by the bridge after every apply, undo, redo and model switch.
    eventBus.on(['selection.changed', 'elements.changed', ARIS_DOCUMENT_CHANGED], () => {
      this.recompute()
    })
  }

  get currentPlan(): ArisHighlightPlan {
    return this.plan
  }

  recompute(): ArisHighlightPlan {
    const selected = this.selection.get() as Element[]
    this.plan = computeHighlightPlan(this.store.document, this.store.activeModelId, selected)
    this.apply()
    return this.plan
  }

  private apply(): void {
    for (const entry of this.applied) {
      const [id, marker] = entry.split(' ')
      const element = this.elementRegistry.get(id)
      if (element) this.canvas.removeMarker(id, marker)
    }
    this.applied = []

    if (!this.plan.active) return

    const add = (id: string, marker: string): void => {
      const element = this.elementRegistry.get(id)
      if (!element) return
      this.canvas.addMarker(id, marker)
      this.applied.push(`${id} ${marker}`)
    }

    if (this.plan.ownerOccurrenceId) add(this.plan.ownerOccurrenceId, ARIS_HIGHLIGHT_OWNER_MARKER)
    for (const relation of this.plan.relations) {
      add(relation.connectionOccurrenceId, ARIS_HIGHLIGHT_MARKER)
      add(relation.connectionOccurrenceId, `${ARIS_HIGHLIGHT_COLOR_PREFIX}${relation.colorIndex}`)
      if (relation.dashed) add(relation.connectionOccurrenceId, ARIS_HIGHLIGHT_DASHED_MARKER)
    }
    for (const occurrenceId of this.plan.neighbourOccurrenceIds) {
      add(occurrenceId, ARIS_HIGHLIGHT_MARKER)
    }
  }
}
