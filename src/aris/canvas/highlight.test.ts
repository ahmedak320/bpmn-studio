// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type { ArisCanvas } from './ArisCanvas'
import {
  ARIS_HIGHLIGHT_COLOR_PREFIX,
  ARIS_HIGHLIGHT_DASHED_MARKER,
  ARIS_HIGHLIGHT_MARKER,
  ARIS_HIGHLIGHT_OWNER_MARKER
} from './highlight'
import { labelElementId, rootElementId } from './elements'
import { AT_NAME } from './vocabulary'
import { bootCanvas, shape, twoModelDocument, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

interface Fixture {
  readonly canvas: ArisCanvas
  readonly func: { definitionId: string; occurrenceId: string }
  readonly startEvent: { definitionId: string; occurrenceId: string }
  readonly endEvent: { definitionId: string; occurrenceId: string }
  readonly person: { definitionId: string; occurrenceId: string }
  readonly incomingId: string
  readonly outgoingId: string
  readonly satelliteId: string
}

/** A function with one incoming edge, one outgoing edge and one satellite. */
function buildFixture(): Fixture {
  harness = bootCanvas()
  const { canvas } = harness
  const startEvent = canvas.authoring.createObject({ objectType: 'OT_EVT', name: 'Start', position: { x: 0, y: 0 } })
  const func = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'Work', position: { x: 0, y: 300 } })
  const endEvent = canvas.authoring.createObject({ objectType: 'OT_EVT', name: 'End', position: { x: 0, y: 600 } })
  const person = canvas.authoring.createObject({ objectType: 'OT_PERS', name: 'Clerk', position: { x: 400, y: 300 } })

  const incomingId = canvas.authoring.connect(startEvent.occurrenceId, func.occurrenceId)
  const outgoingId = canvas.authoring.connect(func.occurrenceId, endEvent.occurrenceId)
  const satelliteId = canvas.authoring.connect(person.occurrenceId, func.occurrenceId)

  return { canvas, func, startEvent, endEvent, person, incomingId, outgoingId, satelliteId }
}

describe('selection highlighting (Section 11.5)', () => {
  it('highlights all incoming and outgoing typed relations of one selected element', () => {
    const fixture = buildFixture()
    fixture.canvas.select(fixture.func.occurrenceId)
    const plan = fixture.canvas.currentHighlight()

    expect(plan.active).toBe(true)
    expect(plan.ownerOccurrenceId).toBe(fixture.func.occurrenceId)
    expect(plan.relations).toHaveLength(3)

    const byId = new Map(plan.relations.map((relation) => [relation.connectionOccurrenceId, relation]))
    expect(byId.get(fixture.incomingId)).toMatchObject({ role: 'incoming', connectionType: 'CT_ACTIV_1' })
    expect(byId.get(fixture.outgoingId)).toMatchObject({ role: 'outgoing', connectionType: 'CT_CRT_1' })
    expect(byId.get(fixture.satelliteId)).toMatchObject({ role: 'incoming', connectionType: 'CT_EXEC_1' })

    // Markers reached the canvas.
    expect(fixture.canvas.canvas.hasMarker(fixture.func.occurrenceId, ARIS_HIGHLIGHT_OWNER_MARKER)).toBe(true)
    expect(fixture.canvas.canvas.hasMarker(fixture.incomingId, ARIS_HIGHLIGHT_MARKER)).toBe(true)
    expect(fixture.canvas.canvas.hasMarker(fixture.startEvent.occurrenceId, ARIS_HIGHLIGHT_MARKER)).toBe(true)
  })

  it('highlights the selected connection itself', () => {
    const fixture = buildFixture()
    fixture.canvas.select(fixture.incomingId)
    const plan = fixture.canvas.currentHighlight()

    expect(plan.active).toBe(true)
    expect(plan.selectedConnectionId).toBe(fixture.incomingId)
    expect(plan.relations).toHaveLength(1)
    expect(plan.relations[0]).toMatchObject({ connectionOccurrenceId: fixture.incomingId, role: 'selected' })
    // Both endpoints are highlighted with it.
    expect(plan.neighbourOccurrenceIds).toEqual(
      expect.arrayContaining([fixture.startEvent.occurrenceId, fixture.func.occurrenceId])
    )
    expect(fixture.canvas.canvas.hasMarker(fixture.incomingId, ARIS_HIGHLIGHT_MARKER)).toBe(true)
  })

  it('resolves a selected external label to its owner', () => {
    const fixture = buildFixture()
    const { canvas } = fixture

    // Drag the caption out of the symbol: that is what creates an external label.
    canvas.bridge.execute('place-label', (document, context) => ({
      commandId: context.commandId,
      baseRevision: context.baseRevision,
      kind: 'setAttributeOccurrencePlacement',
      affectedSourceIds: [fixture.func.occurrenceId],
      before: {
        occurrenceId: fixture.func.occurrenceId,
        attributeType: AT_NAME,
        placement: {
          attributeType: AT_NAME,
          port: null,
          orderNum: null,
          alignment: null,
          offsetX: 0,
          offsetY: 0,
          width: null,
          height: null,
          rotation: null
        }
      },
      after: {
        occurrenceId: fixture.func.occurrenceId,
        attributeType: AT_NAME,
        placement: {
          attributeType: AT_NAME,
          port: null,
          orderNum: null,
          alignment: null,
          offsetX: 140,
          offsetY: -40,
          width: 120,
          height: 24,
          rotation: null
        }
      },
      origin: 'user' as const,
      _unusedDocument: document.revision
    }))

    const labelId = labelElementId(fixture.func.occurrenceId)
    expect(canvas.elementRegistry.get(labelId)).toBeTruthy()

    canvas.select(labelId)
    const plan = canvas.currentHighlight()

    expect(plan.active).toBe(true)
    expect(plan.resolvedFromLabel).toBe(true)
    expect(plan.ownerOccurrenceId).toBe(fixture.func.occurrenceId)
    // The owner's relations are highlighted, exactly as if the shape was picked.
    expect(plan.relations.map((relation) => relation.connectionOccurrenceId).sort()).toEqual(
      [fixture.incomingId, fixture.outgoingId, fixture.satelliteId].sort()
    )
  })

  it('marks satellite relationships', () => {
    const fixture = buildFixture()
    fixture.canvas.select(fixture.func.occurrenceId)
    const plan = fixture.canvas.currentHighlight()

    const satellite = plan.relations.find((relation) => relation.connectionOccurrenceId === fixture.satelliteId)
    expect(satellite?.satellite).toBe(true)
    expect(plan.satelliteOccurrenceIds).toEqual([fixture.person.occurrenceId])

    // The control-flow neighbours are not satellites.
    const controlFlow = plan.relations.filter(
      (relation) => relation.connectionOccurrenceId !== fixture.satelliteId
    )
    expect(controlFlow.every((relation) => relation.satellite === false)).toBe(true)
  })

  it('deduplicates self-loops into a single relation', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const func = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'Retry', position: { x: 0, y: 0 } })
    const selfLoopId = canvas.authoring.connect(func.occurrenceId, func.occurrenceId)

    canvas.select(func.occurrenceId)
    const plan = canvas.currentHighlight()

    // The loop is both incoming and outgoing; it appears exactly once.
    expect(plan.relations).toHaveLength(1)
    expect(plan.relations[0]).toMatchObject({
      connectionOccurrenceId: selfLoopId,
      role: 'self-loop',
      neighbourOccurrenceId: null
    })
    expect(plan.neighbourOccurrenceIds).toHaveLength(0)
  })

  it('separates overlapping routes with distinct colours and dashes', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', name: 'A', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'B', position: { x: 0, y: 300 } })
    const first = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    const second = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    const third = canvas.authoring.connect(b.occurrenceId, a.occurrenceId)

    canvas.select(a.occurrenceId)
    const plan = canvas.currentHighlight()

    expect(plan.relations).toHaveLength(3)
    const byId = new Map(plan.relations.map((relation) => [relation.connectionOccurrenceId, relation]))
    // Same unordered endpoint pair ⇒ distinct colour slots, dashes after the first.
    expect(byId.get(first)).toMatchObject({ colorIndex: 0, dashed: false })
    expect(byId.get(second)).toMatchObject({ colorIndex: 1, dashed: true })
    expect(byId.get(third)).toMatchObject({ colorIndex: 2, dashed: true })
    expect(new Set(plan.relations.map((relation) => relation.colorIndex)).size).toBe(3)

    expect(canvas.canvas.hasMarker(second, `${ARIS_HIGHLIGHT_COLOR_PREFIX}1`)).toBe(true)
    expect(canvas.canvas.hasMarker(second, ARIS_HIGHLIGHT_DASHED_MARKER)).toBe(true)
    expect(canvas.canvas.hasMarker(first, ARIS_HIGHLIGHT_DASHED_MARKER)).toBe(false)
  })

  it('shows no overlay for a multiple selection', () => {
    const fixture = buildFixture()
    fixture.canvas.selection.select([
      shape(fixture.canvas, fixture.func.occurrenceId),
      shape(fixture.canvas, fixture.startEvent.occurrenceId)
    ])
    const plan = fixture.canvas.currentHighlight()

    expect(plan.active).toBe(false)
    expect(plan.reason).toBe('multiple-selection')
    expect(plan.relations).toHaveLength(0)
    expect(fixture.canvas.canvas.hasMarker(fixture.incomingId, ARIS_HIGHLIGHT_MARKER)).toBe(false)
  })

  it('shows no overlay for the model root', () => {
    const fixture = buildFixture()
    const root = fixture.canvas.canvas.getRootElement()
    expect(root.id).toBe(rootElementId(fixture.canvas.activeModelId))

    fixture.canvas.selection.select(root)
    const plan = fixture.canvas.currentHighlight()

    expect(plan.active).toBe(false)
    expect(plan.reason).toBe('root-selected')
    expect(plan.relations).toHaveLength(0)
  })

  it('shows no overlay for an empty selection', () => {
    const fixture = buildFixture()
    fixture.canvas.select(fixture.func.occurrenceId)
    expect(fixture.canvas.currentHighlight().active).toBe(true)

    fixture.canvas.select(null)
    const plan = fixture.canvas.currentHighlight()
    expect(plan.active).toBe(false)
    expect(plan.reason).toBe('empty-selection')
    expect(fixture.canvas.canvas.hasMarker(fixture.incomingId, ARIS_HIGHLIGHT_MARKER)).toBe(false)
  })

  it('recomputes after an edit', () => {
    const fixture = buildFixture()
    const { canvas } = fixture
    canvas.select(fixture.func.occurrenceId)
    expect(canvas.currentHighlight().relations).toHaveLength(3)

    const extra = canvas.authoring.createObject({ objectType: 'OT_APPL_SYS', name: 'System', position: { x: -400, y: 300 } })
    const extraConnection = canvas.authoring.connect(extra.occurrenceId, fixture.func.occurrenceId)

    const plan = canvas.currentHighlight()
    expect(plan.relations).toHaveLength(4)
    expect(plan.relations.map((relation) => relation.connectionOccurrenceId)).toContain(extraConnection)
    expect(plan.satelliteOccurrenceIds).toEqual(
      expect.arrayContaining([fixture.person.occurrenceId, extra.occurrenceId])
    )
  })

  it('recomputes after a reroute', () => {
    const fixture = buildFixture()
    const { canvas } = fixture
    canvas.select(fixture.func.occurrenceId)
    const before = canvas.currentHighlight()

    canvas.authoring.rerouteConnection(fixture.incomingId, [
      { x: 10, y: 20 },
      { x: 90, y: 150 },
      { x: 10, y: 300 }
    ])

    const after = canvas.currentHighlight()
    expect(after.active).toBe(true)
    expect(after.relations).toHaveLength(before.relations.length)
    expect(canvas.canvas.hasMarker(fixture.incomingId, ARIS_HIGHLIGHT_MARKER)).toBe(true)
  })

  it('recomputes after undo and redo', () => {
    const fixture = buildFixture()
    const { canvas } = fixture
    canvas.select(fixture.func.occurrenceId)
    expect(canvas.currentHighlight().relations).toHaveLength(3)

    // Undo the satellite connection gesture (2 commands, 1 gesture).
    canvas.undo()
    expect(canvas.currentHighlight().relations).toHaveLength(2)

    canvas.redo()
    expect(canvas.currentHighlight().relations).toHaveLength(3)
  })

  it('recomputes after a model switch', () => {
    const { document, first, second } = twoModelDocument()
    harness = bootCanvas({ document, modelId: first })
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', name: 'A', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'B', position: { x: 0, y: 300 } })
    canvas.authoring.connect(a.occurrenceId, b.occurrenceId)

    canvas.select(a.occurrenceId)
    expect(canvas.currentHighlight().relations).toHaveLength(1)

    canvas.setActiveModel(second)
    const plan = canvas.currentHighlight()
    expect(plan.active).toBe(false)
    expect(plan.reason).toBe('empty-selection')
    expect(canvas.elementRegistry.get(a.occurrenceId)).toBeUndefined()

    canvas.setActiveModel(first)
    canvas.select(a.occurrenceId)
    expect(canvas.currentHighlight().relations).toHaveLength(1)
  })
})
