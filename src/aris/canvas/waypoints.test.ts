import { describe, expect, it } from 'vitest'

import { cleanConnectionWaypoints, connectionWaypoints, dockDescriptorPort } from './waypoints'

const CARD_PORTS = Object.freeze([
  Object.freeze({ name: 'N', nx: 0.5, ny: 0 }),
  Object.freeze({ name: 'E', nx: 1, ny: 0.5 }),
  Object.freeze({ name: 'S', nx: 0.5, ny: 1 }),
  Object.freeze({ name: 'W', nx: 0, ny: 0.5 }),
  Object.freeze({ name: 'CENTER', nx: 0.5, ny: 0.5 })
])

describe('connectionWaypoints source-layout contract', () => {
  it('preserves every imported route point verbatim, including off-border endpoints', () => {
    const source = { x: 100, y: 100, width: 200, height: 80 }
    const target = { x: 600, y: 300, width: 200, height: 80 }
    const route = Object.freeze([
      Object.freeze({ x: 291.25, y: 137.75 }),
      Object.freeze({ x: 420, y: 137.75 }),
      Object.freeze({ x: 420, y: 341.5 }),
      Object.freeze({ x: 607.125, y: 341.5 })
    ])

    const projected = connectionWaypoints(source, target, route, {
      preserveRoute: true,
      sourcePorts: CARD_PORTS,
      targetPorts: CARD_PORTS
    })

    expect(projected).toEqual(route)
    expect(projected[0]).toEqual(route[0])
    expect(projected.at(-1)).toEqual(route.at(-1))
  })

  it('docks authored geometry to descriptor ports and keeps the route orthogonal', () => {
    const source = { x: 0, y: 0, width: 100, height: 60 }
    const target = { x: 260, y: 160, width: 100, height: 60 }

    const projected = connectionWaypoints(source, target, [], {
      preserveRoute: false,
      sourcePorts: CARD_PORTS,
      targetPorts: CARD_PORTS
    })

    expect(projected[0]).toEqual({ x: 100, y: 30 })
    expect(projected.at(-1)).toEqual({ x: 260, y: 190 })
    expect(
      projected.slice(1).every((point, index) => {
        const previous = projected[index]!
        return point.x === previous.x || point.y === previous.y
      })
    ).toBe(true)
  })

  it('uses descriptor-specific normalized silhouette ports', () => {
    const chevronPorts = Object.freeze([
      Object.freeze({ name: 'E', nx: 0.89, ny: 0.5 }),
      Object.freeze({ name: 'W', nx: 0.11, ny: 0.5 })
    ])
    expect(
      dockDescriptorPort(
        { x: 100, y: 200, width: 200, height: 100 },
        { x: 500, y: 250 },
        chevronPorts
      )
    ).toEqual({ name: 'E', point: { x: 278, y: 250 } })
  })

  it('re-routes an imported route once a block has moved, dropping its stale guides', () => {
    const source = { x: 0, y: 0, width: 100, height: 60 }
    const target = { x: 0, y: 300, width: 100, height: 60 }
    const staleRoute = Object.freeze([
      Object.freeze({ x: 50, y: 60 }),
      Object.freeze({ x: 400, y: 60 }),
      Object.freeze({ x: 400, y: 330 }),
      Object.freeze({ x: 50, y: 330 })
    ])
    const projected = connectionWaypoints(source, target, staleRoute, {
      preserveRoute: false,
      reroute: true,
      sourcePorts: CARD_PORTS,
      targetPorts: CARD_PORTS
    })
    expect(projected).toEqual([
      { x: 50, y: 60 },
      { x: 50, y: 300 }
    ])
  })

  it('keeps the guides of an authored route that was not marked for re-routing', () => {
    const source = { x: 0, y: 0, width: 100, height: 60 }
    const target = { x: 0, y: 300, width: 100, height: 60 }
    const authored = Object.freeze([
      Object.freeze({ x: 20, y: 30 }),
      Object.freeze({ x: 400, y: 30 }),
      Object.freeze({ x: 400, y: 330 }),
      Object.freeze({ x: 20, y: 330 })
    ])
    const projected = connectionWaypoints(source, target, authored, {
      preserveRoute: false,
      sourcePorts: CARD_PORTS,
      targetPorts: CARD_PORTS
    })
    expect(projected).toContainEqual({ x: 400, y: 30 })
    expect(projected).toContainEqual({ x: 400, y: 330 })
  })
})

describe('cleanConnectionWaypoints', () => {
  it('draws one vertical line through the shared horizontal span', () => {
    const a = { x: 0, y: 0, width: 100, height: 60 }
    const b = { x: 40, y: 200, width: 100, height: 60 }
    expect(cleanConnectionWaypoints(a, b)).toEqual([
      { x: 70, y: 60 },
      { x: 70, y: 200 }
    ])
  })

  it('draws one horizontal line through the shared vertical span, right or left', () => {
    const a = { x: 0, y: 0, width: 100, height: 60 }
    const right = { x: 300, y: 20, width: 100, height: 60 }
    expect(cleanConnectionWaypoints(a, right)).toEqual([
      { x: 100, y: 40 },
      { x: 300, y: 40 }
    ])
    const left = { x: -300, y: 20, width: 100, height: 60 }
    expect(cleanConnectionWaypoints(a, left)).toEqual([
      { x: 0, y: 40 },
      { x: -200, y: 40 }
    ])
  })

  it('never produces a diagonal segment for any pair of positions', () => {
    const base = { x: 0, y: 0, width: 100, height: 60 }
    const offsets = [-400, -150, -20, 0, 30, 150, 400]
    for (const dx of offsets) {
      for (const dy of offsets) {
        const target = { x: dx, y: dy, width: 80, height: 50 }
        const points = cleanConnectionWaypoints(base, target)
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1]!
          const to = points[index]!
          expect(from.x === to.x || from.y === to.y).toBe(true)
        }
      }
    }
  })
})
