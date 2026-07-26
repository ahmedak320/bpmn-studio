import { describe, expect, it } from 'vitest'
import { planAutomaticConnectionRepairs } from '../automaticConnectionRouting'

interface Element {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  source?: Element
  target?: Element
  waypoints?: Array<{ x: number; y: number }>
  businessObject?: {
    $type?: string
    $attrs?: Record<string, unknown>
  }
}

function task(
  id: string,
  x: number,
  y: number,
  attrs: Record<string, unknown> = {}
): Element {
  return {
    id,
    type: 'bpmn:Task',
    x,
    y,
    width: 100,
    height: 80,
    businessObject: { $type: 'bpmn:Task', $attrs: attrs }
  }
}

function flow(
  id: string,
  source: Element,
  target: Element,
  waypoints: Array<{ x: number; y: number }>
): Element {
  const connection: Element = {
    id,
    type: 'bpmn:SequenceFlow',
    source,
    target,
    waypoints
  }
  return connection
}

describe('planAutomaticConnectionRepairs', () => {
  const directionSource = {
    getOrientation: () => 'horizontal' as const,
    getDirectionFor: () => 'right' as const,
    getFlipFor: () => false
  }

  it('routes around a non-endpoint shape instead of crossing through it', () => {
    const source = task('Source', 0, 0)
    const blocker = task('Blocker', 140, 0)
    const target = task('Target', 300, 0)
    const connection = flow('Flow_1', source, target, [
      { x: 100, y: 40 },
      { x: 300, y: 40 }
    ])

    const updates = planAutomaticConnectionRepairs(
      [source, blocker, target, connection],
      directionSource
    )

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      kind: 'waypoints',
      connection
    })
    const points =
      updates[0].kind === 'waypoints' ? updates[0].waypoints : []
    expect(points[0]).toEqual({ x: 100, y: 40 })
    expect(points.at(-1)).toEqual({ x: 300, y: 40 })
    expect(points.some((point) => point.y <= -7 || point.y >= 87)).toBe(true)
  })

  it('removes a needless unobstructed detour but leaves a direct route alone', () => {
    const source = task('Source', 0, 0)
    const target = task('Target', 300, 0)
    const detour = flow('Flow_Detour', source, target, [
      { x: 100, y: 40 },
      { x: 100, y: 150 },
      { x: 300, y: 150 },
      { x: 300, y: 40 }
    ])
    const direct = flow('Flow_Direct', source, target, [
      { x: 100, y: 60 },
      { x: 300, y: 60 }
    ])

    const updates = planAutomaticConnectionRepairs(
      [source, target, detour, direct],
      directionSource
    )

    expect(updates.map((update) =>
      update.kind === 'waypoints'
        ? (update.connection as Element).id
        : ''
    )).toContain('Flow_Detour')
    expect(updates.map((update) =>
      update.kind === 'waypoints'
        ? (update.connection as Element).id
        : ''
    )).not.toContain('Flow_Direct')
  })

  it('treats an external output block as an obstacle', () => {
    const decorated = task('Decorated', 130, 0, {
      'orbitpm:outputs': 'Approval record'
    })
    const source = task('Source', 0, 70)
    const target = task('Target', 380, 70)
    // The decorated task's horizontal-flow output box is below it and extends
    // into this straight route.
    const connection = flow('Flow_Output', source, target, [
      { x: 100, y: 110 },
      { x: 380, y: 110 }
    ])

    const updates = planAutomaticConnectionRepairs(
      [source, decorated, target, connection],
      directionSource
    )

    expect(updates).toHaveLength(1)
    expect(updates[0].kind).toBe('waypoints')
  })

  it('preserves a self-loop instead of shortening it through its own activity', () => {
    const source = task('Loop_Task', 100, 100)
    const selfLoop = flow('Flow_Loop', source, source, [
      { x: 200, y: 140 },
      { x: 260, y: 140 },
      { x: 260, y: 60 },
      { x: 150, y: 60 },
      { x: 150, y: 100 }
    ])

    expect(
      planAutomaticConnectionRepairs([source, selfLoop], directionSource)
    ).toEqual([])
  })
})
