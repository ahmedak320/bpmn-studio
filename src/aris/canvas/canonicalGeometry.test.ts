// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { canonicalJsonText } from '../packages/canonicalJson'
import type { ArisEditCommand } from '../model/commands'
import {
  assertCanonicalNumbers,
  toCanonicalBounds,
  toCanonicalNumber,
  toCanonicalRoute
} from './geometry'
import { buildLayoutGraph } from './layoutSeam'
import { bootCanvas, dragShape, shape, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

/**
 * Every command payload must survive the revision encoder in
 * `src/aris/packages/canonicalJson.ts`, which rejects fractional numbers by
 * design. `canonicalJsonText` is the real encoder, not a stand-in.
 */
function assertSurvivesCanonicalJson(commands: readonly ArisEditCommand[]): void {
  expect(commands.length).toBeGreaterThan(0)
  for (const command of commands) {
    assertCanonicalNumbers(command.before, `${command.kind}.before`)
    assertCanonicalNumbers(command.after, `${command.kind}.after`)
    expect(() => canonicalJsonText(JSON.parse(JSON.stringify(command)))).not.toThrow()
  }
}

describe('canonical integer geometry', () => {
  it('rounds fractional coordinates at the command boundary', () => {
    expect(toCanonicalNumber(10.4)).toBe(10)
    expect(toCanonicalNumber(10.5)).toBe(11)
    expect(toCanonicalNumber(-10.5)).toBe(-10)
    // `-0` normalizes to `0` so before/after snapshots compare equal.
    expect(Object.is(toCanonicalNumber(-0.2), 0)).toBe(true)
    expect(toCanonicalBounds({ x: 1.2, y: 2.7, width: 99.5, height: 0.2 })).toEqual({
      x: 1,
      y: 3,
      width: 100,
      height: 1
    })
    expect(toCanonicalRoute([{ x: 0.5, y: 1.49 }])).toEqual([{ x: 1, y: 1 }])
  })

  it('rejects non-finite and unsafe coordinates', () => {
    expect(() => toCanonicalNumber(Number.NaN)).toThrow(/not finite/u)
    expect(() => toCanonicalNumber(Number.POSITIVE_INFINITY)).toThrow(/not finite/u)
    expect(() => toCanonicalNumber(1e300)).toThrow(/safe integer range/u)
  })

  it('emits canonical payloads for every geometry-bearing gesture', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const authoring = canvas.authoring

    const a = authoring.createObject({ objectType: 'OT_EVT', name: 'A', position: { x: 0, y: 0 } })
    const b = authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'B',
      position: { x: 0, y: 300 }
    })
    const connectionId = authoring.connect(a.occurrenceId, b.occurrenceId)

    authoring.moveOccurrence(b.occurrenceId, { x: 12, y: 34 })
    authoring.resizeOccurrence(b.occurrenceId, { width: 210, height: 90 })
    authoring.rerouteConnection(connectionId, [
      { x: 10, y: 20 },
      { x: 90, y: 150 },
      { x: 10, y: 300 }
    ])
    const laneId = authoring.addLane({ name: 'Lane', startBorder: 0, endBorder: 300 })
    authoring.editLane(laneId, { endBorder: 420 })
    const freeTextId = authoring.addFreeText({
      text: 'Note',
      bounds: { x: 5, y: 5, width: 200, height: 40 }
    })
    authoring.editFreeText(freeTextId, { bounds: { x: 15, y: 15, width: 240, height: 60 } })

    assertSurvivesCanonicalJson(canvas.commandLog)

    // Everything geometric really is an integer.
    const model = canvas.document.models.get(canvas.activeModelId)
    for (const occurrence of model?.occurrences ?? []) {
      assertCanonicalNumbers(occurrence.bounds, `occurrence ${occurrence.id}`)
    }
    for (const connection of model?.connectionOccurrences ?? []) {
      assertCanonicalNumbers(connection.route, `connection ${connection.id}`)
    }
  })

  it('rounds fractional drag deltas coming from diagram-js', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })

    // Sub-pixel drag: diagram-js hands over fractional coordinates.
    dragShape(canvas, created.occurrenceId, { x: 30.4, y: 45.6 })

    const move = canvas.commandLog[canvas.commandLog.length - 1]
    expect(move.kind).toBe('moveOccurrence')
    assertSurvivesCanonicalJson([move])
    const after = move.after as { x: number; y: number }
    expect(Number.isInteger(after.x)).toBe(true)
    expect(Number.isInteger(after.y)).toBe(true)
  })

  it('rounds fractional bend points coming from a bend-point gesture', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 300 } })
    const connectionId = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)

    // `bendpoints` calls `modeling.updateWaypoints` with cropped, fractional points.
    canvas.modeling.updateWaypoints(canvas.elementRegistry.get(connectionId) as never, [
      { x: 50.4, y: 100.5 },
      { x: 120.6, y: 180.2 },
      { x: 50.1, y: 300.9 }
    ])

    const command = canvas.commandLog[canvas.commandLog.length - 1]
    expect(command.kind).toBe('setConnectionRoute')
    assertSurvivesCanonicalJson([command])
    expect((command.after as { route: { x: number; y: number }[] }).route).toEqual([
      { x: 50, y: 101 },
      { x: 121, y: 180 },
      { x: 50, y: 301 }
    ])
  })

  it('produces canonical payloads through a clean-layout gesture', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({
      objectType: 'OT_EVT',
      name: 'A',
      position: { x: 0, y: 0 }
    })
    const b = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'B',
      position: { x: 0, y: 300 }
    })
    const connectionId = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    const historyBefore = canvas.commandLog.length

    // A stand-in engine that returns fractional geometry, as a real layout
    // engine may. The seam is responsible for canonicalizing it.
    canvas.applyCleanLayout((graph) => {
      expect(graph.nodes.map((node) => node.role).sort()).toEqual(['event', 'function'])
      expect(graph.edges[0]).toMatchObject({ kind: 'control-flow' })
      return {
        nodes: graph.nodes.map((node, index) => ({
          id: node.id,
          rect: { x: 10.5, y: index * 200.25, width: node.size.width, height: node.size.height }
        })),
        edges: graph.edges.map((edge) => ({
          id: edge.id,
          points: [
            { x: 60.5, y: 70.25 },
            { x: 60.5, y: 200.75 }
          ]
        }))
      }
    })

    expect(canvas.commandLog.length).toBe(historyBefore + 3)
    assertSurvivesCanonicalJson(canvas.commandLog.slice(historyBefore))
    expect(canvas.document.models.get(canvas.activeModelId)?.occurrences[1].bounds).toMatchObject({
      x: 11,
      y: 200
    })

    canvas.undo()
    expect(canvas.document.models.get(canvas.activeModelId)?.occurrences[0].bounds).toMatchObject({
      x: 0,
      y: 0
    })
    expect(canvas.elementRegistry.get(connectionId)).toBeTruthy()
  })

  it('projects the active model into the layout seam graph', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const event = canvas.authoring.createObject({
      objectType: 'OT_EVT',
      name: 'A',
      position: { x: 0, y: 0 }
    })
    const func = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'B',
      position: { x: 0, y: 300 }
    })
    const rule = canvas.authoring.createRule('XOR', { x: 0, y: 600 })
    const person = canvas.authoring.createObject({
      objectType: 'OT_PERS',
      name: 'P',
      position: { x: 400, y: 300 }
    })
    canvas.authoring.connect(event.occurrenceId, func.occurrenceId)
    canvas.authoring.connect(func.occurrenceId, rule.occurrenceId)
    canvas.authoring.connect(person.occurrenceId, func.occurrenceId)

    const model = canvas.document.models.get(canvas.activeModelId)
    if (!model) throw new Error('missing model')
    const graph = buildLayoutGraph(canvas.document, model)

    expect(graph.id).toBe(canvas.activeModelId)
    expect(graph.nodes.map((node) => node.role)).toEqual(['event', 'function', 'rule', 'satellite'])
    expect(graph.nodes.find((node) => node.role === 'rule')?.operator).toBe('xor')
    expect(graph.edges.map((edge) => edge.kind)).toEqual([
      'control-flow',
      'control-flow',
      'satellite'
    ])
    expect(shape(canvas, event.occurrenceId).width).toBe(graph.nodes[0].size.width)
  })
})
