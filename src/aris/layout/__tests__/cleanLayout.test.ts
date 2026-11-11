import { describe, expect, it } from 'vitest'

import { cleanLayout } from '../cleanLayout'
import { cleanLayoutRevision, resetToSourceLayout, sourceLayoutRevision } from '../modes'
import { pointOnRectBoundary } from '../geometry'
import { GapSlotAllocator } from '../routing'
import type { ArisLayoutEdgeRoute, ArisLayoutNodePlacement, ArisLayoutResult } from '../types'
import {
  attach,
  bendDiamond,
  chainWithSatellites,
  cycleGraph,
  deepFreeze,
  denseOwnerChain,
  endSpineSatellites,
  event,
  flow,
  fn,
  largeGraph,
  rule,
  satellite,
  selfLoopGraph,
  twoComponentGraph,
  xorDiamond
} from './fixtures'
import type { ArisLayoutGraphInput } from '../types'

/** Drop every satellite node and satellite edge, leaving only the backbone. */
function stripSatellites(graph: ArisLayoutGraphInput): ArisLayoutGraphInput {
  const controlIds = new Set(
    graph.nodes.filter((node) => node.role !== 'satellite').map((node) => node.id)
  )
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.role !== 'satellite'),
    edges: graph.edges.filter((edge) => controlIds.has(edge.source) && controlIds.has(edge.target))
  }
}

/**
 * The spine's geometry expressed RELATIVE to its own centroid: absolute
 * translation (which side satellites push the canvas toward) is factored out,
 * so two layouts with an identical backbone SHAPE compare equal even when they
 * sit at different absolute coordinates. This is the §13.2 invariant in its
 * two-sided form — a left-side satellite and a right-side satellite must both
 * leave the backbone shape untouched.
 */
function relativeBackbone(result: ArisLayoutResult): string {
  const control = result.nodes.filter((node) => node.kind === 'control-flow')
  const centersX = control.map((node) => node.rect.x + node.rect.width / 2)
  const centersY = control.map((node) => node.rect.y + node.rect.height / 2)
  const meanX = centersX.reduce((sum, value) => sum + value, 0) / (control.length || 1)
  const meanY = centersY.reduce((sum, value) => sum + value, 0) / (control.length || 1)
  const round = (value: number): number => Math.round(value * 1e6) / 1e6
  return JSON.stringify(
    control
      .map((node, index) => ({
        id: node.id,
        rank: node.rank,
        dx: round((centersX[index] as number) - meanX),
        dy: round((centersY[index] as number) - meanY),
        width: node.rect.width,
        height: node.rect.height
      }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  )
}

/**
 * The spine's CROSS geometry only (each spine node's cross offset from the
 * spine's cross-centroid). This is the part of §13.2 that must hold ABSOLUTELY
 * even with the satellite-density rank-gap expansion: satellites may grow the
 * VERTICAL spacing between ranks, but they must NEVER move a spine node
 * sideways. `dy` is deliberately excluded because vertical growth is now the
 * intended behaviour below a dense owner.
 */
function relativeBackboneCross(result: ArisLayoutResult): string {
  const control = result.nodes.filter((node) => node.kind === 'control-flow')
  const centersX = control.map((node) => node.rect.x + node.rect.width / 2)
  const meanX = centersX.reduce((sum, value) => sum + value, 0) / (control.length || 1)
  const round = (value: number): number => Math.round(value * 1e6) / 1e6
  return JSON.stringify(
    control
      .map((node, index) => ({
        id: node.id,
        rank: node.rank,
        dx: round((centersX[index] as number) - meanX),
        width: node.rect.width,
        height: node.rect.height
      }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  )
}

/**
 * The relative backbone of the spine PREFIX — control nodes at rank <= maxRank,
 * i.e. down to and INCLUDING the first dense owner. Density expansion only ever
 * pushes ranks strictly BELOW a dense owner downward, so the prefix is
 * unaffected and compares equal between a decorated and a satellite-stripped
 * layout.
 */
function relativeBackbonePrefix(result: ArisLayoutResult, maxRank: number): string {
  return relativeBackbone({
    ...result,
    nodes: result.nodes.filter((node) => node.kind !== 'control-flow' || node.rank <= maxRank)
  })
}

/** Control-flow bounding box across x (min left edge, max right edge). */
function controlXBounds(result: ArisLayoutResult): { min: number; max: number } {
  const control = result.nodes.filter((node) => node.kind === 'control-flow')
  return {
    min: Math.min(...control.map((node) => node.rect.x)),
    max: Math.max(...control.map((node) => node.rect.x + node.rect.width))
  }
}

function nodeById(result: ArisLayoutResult, id: string): ArisLayoutNodePlacement {
  const found = result.nodes.find((node) => node.id === id)
  if (!found) throw new Error(`node ${id} is missing from the layout`)
  return found
}

function edgeById(result: ArisLayoutResult, id: string): ArisLayoutEdgeRoute {
  const found = result.edges.find((edge) => edge.id === id)
  if (!found) throw new Error(`edge ${id} is missing from the layout`)
  return found
}

function centerX(node: ArisLayoutNodePlacement): number {
  return node.rect.x + node.rect.width / 2
}

function centerY(node: ArisLayoutNodePlacement): number {
  return node.rect.y + node.rect.height / 2
}

function expectClean(result: ArisLayoutResult): void {
  expect(result.findings.map((finding) => finding.code)).toEqual([])
  expect(result.accepted).toBe(true)
  expect(result.metrics.shapeOverlaps).toBe(0)
  expect(result.metrics.labelSatelliteOverlaps).toBe(0)
  expect(result.metrics.edgeShapeCrossings).toBe(0)
  expect(result.metrics.detachedEndpoints).toBe(0)
  expect(result.metrics.missingEdges).toBe(0)
  expect(result.metrics.duplicateEdges).toBe(0)
  expect(result.metrics.zeroLengthEdges).toBe(0)
}

describe('a simple chain', () => {
  const result = cleanLayout(chainWithSatellites(0))

  it('produces an accepted layout', () => {
    expectClean(result)
  })

  it('keeps the whole chain on one spine and in flow order', () => {
    const ids = ['E.start', 'F.a', 'F.b', 'F.c', 'E.end']
    const ranks = ids.map((id) => nodeById(result, id).rank)
    expect(ranks).toEqual([0, 1, 2, 3, 4])
    const centers = ids.map((id) => centerX(nodeById(result, id)))
    for (const value of centers) expect(value).toBeCloseTo(centers[0] as number, 9)
    const tops = ids.map((id) => nodeById(result, id).rect.y)
    for (let index = 1; index < tops.length; index += 1) {
      expect(tops[index] as number).toBeGreaterThan(tops[index - 1] as number)
    }
  })

  it('attaches every route to both of its shapes', () => {
    for (const edge of result.edges) {
      const source = nodeById(result, edge.source)
      const target = nodeById(result, edge.target)
      expect(
        pointOnRectBoundary(edge.points[0] as { x: number; y: number }, source.rect, 1e-6)
      ).toBe(true)
      expect(
        pointOnRectBoundary(
          edge.points[edge.points.length - 1] as { x: number; y: number },
          target.rect,
          1e-6
        )
      ).toBe(true)
    }
  })
})

describe('steps 7 and 8 — symmetric XOR branches around the spine', () => {
  for (const branchCount of [2, 3, 5]) {
    describe(`${branchCount} branches`, () => {
      const result = cleanLayout(xorDiamond(branchCount))

      it('is accepted', () => {
        expectClean(result)
      })

      it('pairs the split rule with the merge rule', () => {
        const pair = result.splitMergePairs.find((entry) => entry.splitId === 'R.split')
        expect(pair).toBeDefined()
        expect(pair?.mergeId).toBe('R.merge')
        expect(pair?.operator).toBe('xor')
        expect(pair?.branchEntryIds).toHaveLength(branchCount)
      })

      it('places the branches symmetrically about the spine', () => {
        const spine = centerX(nodeById(result, 'R.split'))
        expect(centerX(nodeById(result, 'R.merge'))).toBeCloseTo(spine, 9)
        expect(centerX(nodeById(result, 'E.start'))).toBeCloseTo(spine, 9)
        expect(centerX(nodeById(result, 'E.end'))).toBeCloseTo(spine, 9)

        const normalize = (value: number): number => (value === 0 ? 0 : value)
        const offsets = Array.from({ length: branchCount }, (_value, index) =>
          normalize(Number((centerX(nodeById(result, `F.${index}`)) - spine).toFixed(6)))
        ).sort((left, right) => left - right)
        const mirrored = offsets
          .map((value) => normalize(-value))
          .sort((left, right) => left - right)
        expect(offsets).toEqual(mirrored)
        // Branch columns are evenly pitched.
        for (let index = 1; index < offsets.length; index += 1) {
          expect((offsets[index] as number) - (offsets[index - 1] as number)).toBeCloseTo(
            (offsets[1] as number) - (offsets[0] as number),
            6
          )
        }
      })

      it('keeps all branches on the same rank', () => {
        const ranks = Array.from(
          { length: branchCount },
          (_value, index) => nodeById(result, `F.${index}`).rank
        )
        expect(new Set(ranks).size).toBe(1)
      })
    })
  }
})

describe('a cycle with an explicit return path', () => {
  const result = cleanLayout(cycleGraph())

  it('is accepted', () => {
    expectClean(result)
  })

  it('keeps the return connection visible and traceable', () => {
    const back = edgeById(result, 'F.c->F.a')
    expect(back.classification).toBe('back')
    expect(back.points.length).toBeGreaterThanOrEqual(2)
    const length = back.points.reduce((total, point, index) => {
      if (index === 0) return 0
      const previous = back.points[index - 1] as { x: number; y: number }
      return total + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0)
    expect(length).toBeGreaterThan(0)
  })

  it('preserves the cycle in the strongly connected component data', () => {
    const inCycle = ['F.a', 'F.b', 'F.c'].map((id) => nodeById(result, id).stronglyConnectedIndex)
    expect(new Set(inCycle).size).toBe(1)
    expect(nodeById(result, 'E.start').stronglyConnectedIndex).not.toBe(inCycle[0])
  })

  it('leaves the outer side of its source and enters the outer side of its target', () => {
    const back = edgeById(result, 'F.c->F.a')
    const source = nodeById(result, 'F.c')
    const target = nodeById(result, 'F.a')
    const first = back.points[0] as { x: number; y: number }
    const last = back.points[back.points.length - 1] as { x: number; y: number }
    const exitSecond = back.points[1] as { x: number; y: number }
    const entryPrevious = back.points[back.points.length - 2] as { x: number; y: number }
    const onSourceSide =
      Math.abs(first.x - source.rect.x) < 1 || Math.abs(first.x - (source.rect.x + source.rect.width)) < 1
    const onTargetSide =
      Math.abs(last.x - target.rect.x) < 1 || Math.abs(last.x - (target.rect.x + target.rect.width)) < 1
    expect(onSourceSide).toBe(true)
    expect(onTargetSide).toBe(true)
    expect(first.y).toBeCloseTo(centerY(source), 0)
    expect(last.y).toBeCloseTo(centerY(target), 0)
    expect(exitSecond.y).toBeCloseTo(first.y, 0)
    expect(entryPrevious.y).toBeCloseTo(last.y, 0)
  })

  it('routes the return outside the control-flow body', () => {
    const back = edgeById(result, 'F.c->F.a')
    const bodyMin = Math.min(...result.nodes.map((node) => node.rect.x))
    const bodyMax = Math.max(...result.nodes.map((node) => node.rect.x + node.rect.width))
    const outside = back.points.some((point) => point.x < bodyMin || point.x > bodyMax)
    expect(outside).toBe(true)
  })
})

describe('a self loop', () => {
  const result = cleanLayout(selfLoopGraph())

  it('is accepted and keeps the loop drawn', () => {
    expectClean(result)
    const loop = edgeById(result, 'F.a->F.a')
    expect(loop.classification).toBe('self-loop')
    expect(loop.points.length).toBeGreaterThanOrEqual(4)
    const shape = nodeById(result, 'F.a').rect
    expect(pointOnRectBoundary(loop.points[0] as { x: number; y: number }, shape, 1e-6)).toBe(true)
    expect(
      pointOnRectBoundary(
        loop.points[loop.points.length - 1] as { x: number; y: number },
        shape,
        1e-6
      )
    ).toBe(true)
  })
})

describe('two disconnected components', () => {
  const result = cleanLayout(twoComponentGraph())

  it('is accepted', () => {
    expectClean(result)
  })

  it('separates the components across the flow axis', () => {
    expect(nodeById(result, 'E.1').componentIndex).toBe(0)
    expect(nodeById(result, 'F.1').componentIndex).toBe(0)
    expect(nodeById(result, 'E.2').componentIndex).toBe(1)
    expect(nodeById(result, 'F.2').componentIndex).toBe(1)
    const first = Math.max(
      nodeById(result, 'E.1').rect.x + nodeById(result, 'E.1').rect.width,
      nodeById(result, 'F.1').rect.x + nodeById(result, 'F.1').rect.width
    )
    const second = Math.min(nodeById(result, 'E.2').rect.x, nodeById(result, 'F.2').rect.x)
    expect(second).toBeGreaterThan(first)
  })
})

describe('step 10 — satellites never expand the core flow grid (plan 13.2)', () => {
  const bare = cleanLayout(chainWithSatellites(0))
  const decorated = cleanLayout(chainWithSatellites(12))

  it('accepts both layouts', () => {
    expectClean(bare)
    expectClean(decorated)
  })

  it('draws every satellite and every attachment', () => {
    expect(decorated.nodes.filter((node) => node.kind === 'satellite')).toHaveLength(12)
    expect(decorated.edges.filter((edge) => edge.kind === 'satellite')).toHaveLength(12)
  })

  it('never moves the spine sideways and leaves it unchanged up to the dense owner', () => {
    // §13.2 in its density-aware form. `chainWithSatellites(12)` hangs all 12
    // satellites on owner F.b (rank 2), which is now DENSE: its stack is taller
    // than the gap to the next step, so the satellite-cascade fix grows the
    // rank-gap AFTER F.b, pushing F.c and E.end down. What must still hold:
    //   (a) the spine never moves SIDEWAYS — cross offsets are byte-identical;
    //   (b) the spine is byte-identical down to and INCLUDING the dense owner.
    // Only ranks strictly below F.b move, and only vertically, by design.
    expect(relativeBackboneCross(decorated)).toBe(relativeBackboneCross(bare))
    expect(relativeBackbonePrefix(decorated, 2)).toBe(relativeBackbonePrefix(bare, 2))
  })

  it('grows the rank-gap AFTER the dense owner (satellite cascade fix)', () => {
    // The gap F.b -> F.c grows; the gap E.start -> F.a above the dense owner
    // keeps the baseline. Total diagram height therefore grows.
    const gap = (result: ArisLayoutResult, from: string, to: string): number =>
      centerY(nodeById(result, to)) - centerY(nodeById(result, from))
    expect(gap(decorated, 'F.b', 'F.c')).toBeGreaterThan(gap(bare, 'F.b', 'F.c'))
    expect(gap(decorated, 'E.start', 'F.a')).toBe(gap(bare, 'E.start', 'F.a'))
  })

  it('leaves the control-flow routes byte-identical up to the dense owner', () => {
    // Routes among ranks at or above the dense owner (E.start->F.a, F.a->F.b)
    // are untouched; only routes below F.b shift down with the expansion.
    const upstream = new Set(['E.start->F.a', 'F.a->F.b'])
    const routes = (result: ArisLayoutResult): unknown =>
      result.edges
        .filter((edge) => edge.kind === 'control-flow' && upstream.has(edge.id))
        .map((edge) => ({ id: edge.id, points: edge.points }))
    expect(JSON.stringify(routes(decorated))).toBe(JSON.stringify(routes(bare)))
  })

  it("shares ONE trunk for all of an owner's satellites (item 1)", () => {
    // Owner F.b carries all 6 satellites. Every satellite route must share an
    // identical trunk prefix (owner exit + gap crossing), so the routes overlap
    // into one line near the owner and only branch inside the corridor.
    const withSix = cleanLayout(chainWithSatellites(6))
    const satRoutes = withSix.edges.filter((edge) => edge.kind === 'satellite')
    expect(satRoutes.length).toBe(6)
    const trunk = satRoutes[0]?.points.slice(0, 2)
    for (const route of satRoutes) {
      expect(route.points[0]).toEqual(trunk?.[0])
      expect(route.points[1]).toEqual(trunk?.[1])
    }
    // The branches diverge afterwards: the 4th point (corridor->satellite row)
    // differs per satellite, so this is genuinely trunk-and-branch, not one
    // route drawn six times.
    const branchRows = new Set(
      satRoutes.map((route) => JSON.stringify(route.points[route.points.length - 1]))
    )
    expect(branchRows.size).toBe(6)
  })

  it('keeps every satellite outside the control-flow bounding box (either side)', () => {
    // Rewritten from the all-right assumption (`rect.x > controlMax`) to the
    // RELATIVE invariant: a satellite may sit on EITHER side of the spine, but
    // never inside the control-flow bounding box. Each satellite is therefore
    // fully to the right of `controlMax` OR fully to the left of `controlMin`.
    const { min: controlMin, max: controlMax } = controlXBounds(decorated)
    for (const node of decorated.nodes) {
      if (node.kind !== 'satellite') continue
      const fullyRight = node.rect.x >= controlMax
      const fullyLeft = node.rect.x + node.rect.width <= controlMin
      expect(fullyRight || fullyLeft).toBe(true)
    }
  })
})

describe('step 10 — outer-side (L/R) satellite placement', () => {
  const gapValue = 0

  it("places a left-branch owner's satellites on the LEFT (spine bends right)", () => {
    const result = cleanLayout(bendDiamond('left', 3))
    expectClean(result)
    const { min: controlMin } = controlXBounds(result)
    const sats = result.nodes.filter((node) => node.kind === 'satellite')
    expect(sats.length).toBe(3)
    for (const sat of sats) {
      expect(sat.rect.x + sat.rect.width).toBeLessThanOrEqual(controlMin + gapValue)
    }
  })

  it("places a right-branch owner's satellites on the RIGHT (spine bends left)", () => {
    const result = cleanLayout(bendDiamond('right', 3))
    expectClean(result)
    const { max: controlMax } = controlXBounds(result)
    const sats = result.nodes.filter((node) => node.kind === 'satellite')
    expect(sats.length).toBe(3)
    for (const sat of sats) {
      expect(sat.rect.x).toBeGreaterThanOrEqual(controlMax - gapValue)
    }
  })

  it("defaults a straight-spine owner's satellites to the RIGHT", () => {
    const result = cleanLayout(chainWithSatellites(4))
    expectClean(result)
    const { max: controlMax } = controlXBounds(result)
    const sats = result.nodes.filter((node) => node.kind === 'satellite')
    expect(sats.length).toBe(4)
    for (const sat of sats) {
      expect(sat.rect.x).toBeGreaterThanOrEqual(controlMax - gapValue)
    }
  })

  it('uses the incoming edge for an end-of-spine owner (defaults RIGHT when straight)', () => {
    const result = cleanLayout(endSpineSatellites(3))
    expectClean(result)
    // The end event has NO outgoing edge, so the decision falls through to its
    // incoming edge; a straight arrival ties to RIGHT.
    const { max: controlMax } = controlXBounds(result)
    const sats = result.nodes.filter((node) => node.kind === 'satellite')
    expect(sats.length).toBe(3)
    for (const sat of sats) {
      expect(sat.rect.x).toBeGreaterThanOrEqual(controlMax - gapValue)
    }
  })

  it('never moves the spine sideways vs the satellite-stripped fixture (relative geometry)', () => {
    // The surviving absolute half of §13.2 across every side/shape: satellites
    // may grow VERTICAL spacing below a dense owner, but they never move a spine
    // node SIDEWAYS. Cross offsets stay byte-identical for all of these.
    const fixtures: ArisLayoutGraphInput[] = [
      bendDiamond('left', 3),
      bendDiamond('right', 3),
      chainWithSatellites(6),
      endSpineSatellites(4)
    ]
    for (const fixture of fixtures) {
      const decorated = cleanLayout(fixture)
      const bare = cleanLayout(stripSatellites(fixture))
      expect(relativeBackboneCross(decorated)).toBe(relativeBackboneCross(bare))
    }
  })
})

describe('step 10 — crossing-aware L/R side (Rule A)', () => {
  /**
   * A symmetric two-branch XOR diamond with `count` satellites hung on BOTH
   * branch owners. Placing F.left's satellites on the RIGHT would drive their
   * connectors across F.right's branch flow line (and vice-versa), so the
   * crossing scorer must push each owner's satellites to its OUTER side.
   */
  function parallelBranches(count: number): ArisLayoutGraphInput {
    const nodes = [
      event('E.start'),
      rule('R.split', 'xor'),
      fn('F.left'),
      fn('F.right'),
      rule('R.merge', 'xor'),
      event('E.end')
    ]
    const edges = [
      flow('E.start', 'R.split'),
      flow('R.split', 'F.left'),
      flow('R.split', 'F.right'),
      flow('F.left', 'R.merge'),
      flow('F.right', 'R.merge'),
      flow('R.merge', 'E.end')
    ]
    for (let index = 0; index < count; index += 1) {
      nodes.push(satellite(`S.L.${index}`), satellite(`S.R.${index}`))
      edges.push(attach('F.left', `S.L.${index}`), attach('F.right', `S.R.${index}`))
    }
    return { id: `parallel-branches-${count}`, nodes, edges }
  }

  it('sends each branch owner’s satellites to its OUTER side, so no connector crosses the sibling branch', () => {
    const result = cleanLayout(parallelBranches(2))
    // The whole point: a crossing-free layout (the acceptance gate proves it).
    expectClean(result)
    const left = nodeById(result, 'F.left')
    const right = nodeById(result, 'F.right')
    const satsL = result.nodes.filter((node) => node.id.startsWith('S.L.'))
    const satsR = result.nodes.filter((node) => node.id.startsWith('S.R.'))
    expect(satsL).toHaveLength(2)
    expect(satsR).toHaveLength(2)
    // F.left would cross F.right's flow if it went RIGHT → the scorer chose LEFT
    // (every S.L satellite sits fully left of F.left's left edge).
    for (const sat of satsL) {
      expect(sat.rect.x + sat.rect.width).toBeLessThanOrEqual(left.rect.x + 0.001)
    }
    // F.right mirrors: its satellites sit fully right of F.right's right edge.
    for (const sat of satsR) {
      expect(sat.rect.x).toBeGreaterThanOrEqual(right.rect.x + right.rect.width - 0.001)
    }
  })
})

describe('step 10 — per-owner LOCAL cluster (Rule B)', () => {
  /**
   * Three owners at three DISTINCT cross positions, each with a clear outer
   * side so their local clusters fit: the centred start event and the two
   * branch functions of a two-way diamond. One satellite each.
   */
  function threeDistinctOwners(): ArisLayoutGraphInput {
    const base = bendDiamond('left', 0) // start→split→{left,right}→merge→end
    const nodes = [
      ...base.nodes,
      satellite('S.start'),
      satellite('S.left'),
      satellite('S.right')
    ]
    const edges = [
      ...base.edges,
      attach('E.start', 'S.start'),
      attach('F.left', 'S.left'),
      attach('F.right', 'S.right')
    ]
    return { id: 'three-distinct-owners', nodes, edges }
  }

  it('places each owner’s cluster immediately beside THAT owner (distinct columns, one shared local offset)', () => {
    const result = cleanLayout(threeDistinctOwners())
    expectClean(result)
    const pairs: readonly [string, string][] = [
      ['E.start', 'S.start'],
      ['F.left', 'S.left'],
      ['F.right', 'S.right']
    ]
    const offsets: number[] = []
    const ownerCentres: number[] = []
    for (const [ownerId, satId] of pairs) {
      const owner = nodeById(result, ownerId)
      const sat = nodeById(result, satId)
      ownerCentres.push(owner.rect.x + owner.rect.width / 2)
      // Edge-to-edge horizontal gap between the satellite box and its owner box.
      const gap =
        sat.rect.x >= owner.rect.x + owner.rect.width
          ? sat.rect.x - (owner.rect.x + owner.rect.width) // satellite on the right
          : owner.rect.x - (sat.rect.x + sat.rect.width) // satellite on the left
      offsets.push(gap)
    }
    // The three owners sit at three DISTINCT cross positions, so their clusters
    // are three DISTINCT local columns — NOT one shared far-side column.
    const distinct = new Set(ownerCentres.map((value) => Math.round(value)))
    expect(distinct.size).toBe(3)
    // Every owner uses the SAME modest local offset (owner.edge ± smallGap): the
    // per-owner rule, not a shared column that would give three different gaps.
    for (const gap of offsets) {
      expect(gap).toBeGreaterThan(0)
      expect(gap).toBeCloseTo(offsets[0] as number, 6)
      // A modest gap, well under a full owner width (proves "local", not "far").
      expect(gap).toBeLessThan(nodeById(result, 'F.left').rect.width)
    }
  })
})

describe('step 10 — §13.2 satellite-free byte-identical (Rule B preserved)', () => {
  it('leaves a branchy control flow byte-identical whether or not satellites are attached', () => {
    // The relative backbone of the spine is unchanged when satellites are added,
    // proving local clusters never move a control-flow node. We pin
    // maxIterations to 1 so the acceptance-repair scaling loop cannot choose
    // different effective spacing for the decorated graph vs. the bare one;
    // this isolates the satellite effect from any later iteration decisions.
    const options = { maxIterations: 1 }
    const decorated = cleanLayout(
      (() => {
        const base = xorDiamond(3)
        const nodes = [...base.nodes, satellite('S.0'), satellite('S.1'), satellite('S.2')]
        const edges = [
          ...base.edges,
          attach('F.0', 'S.0'),
          attach('F.1', 'S.1'),
          attach('F.2', 'S.2')
        ]
        return { id: 'branchy-decorated', nodes, edges }
      })(),
      options
    )
    const bare = cleanLayout(xorDiamond(3), options)
    expect(relativeBackbone(decorated)).toBe(relativeBackbone(bare))
  })
})

describe('step 10 — satellite-density rank-gap expansion (cascade fix)', () => {
  // The along-gap between two consecutive owners, measured centre-to-centre.
  const ownerGap = (result: ArisLayoutResult, from: string, to: string): number =>
    centerY(nodeById(result, to)) - centerY(nodeById(result, from))

  it('grows ONLY the gap after a single dense owner, leaving the others baseline', () => {
    // Owners F.0 (1 sat, sparse) -> F.1 (5 sats, DENSE) -> F.2 (1 sat, sparse).
    const dense = cleanLayout(denseOwnerChain([1, 5, 1]))
    const baseline = cleanLayout(denseOwnerChain([0, 0, 0]))
    expectClean(dense)

    // The gap AFTER the dense owner (F.1 -> F.2) is expanded...
    expect(ownerGap(dense, 'F.1', 'F.2')).toBeGreaterThan(ownerGap(baseline, 'F.1', 'F.2'))
    // ...while every other rank gap stays exactly at baseline.
    expect(ownerGap(dense, 'E.start', 'F.0')).toBe(ownerGap(baseline, 'E.start', 'F.0'))
    expect(ownerGap(dense, 'F.0', 'F.1')).toBe(ownerGap(baseline, 'F.0', 'F.1'))
    expect(ownerGap(dense, 'F.2', 'E.end')).toBe(ownerGap(baseline, 'F.2', 'E.end'))
  })

  it('grows both gaps after two consecutive dense owners', () => {
    // Owners F.0 (5 sats, DENSE) -> F.1 (5 sats, DENSE) -> F.2 (1 sat, sparse).
    const dense = cleanLayout(denseOwnerChain([5, 5, 1]))
    const baseline = cleanLayout(denseOwnerChain([0, 0, 0]))
    expectClean(dense)

    expect(ownerGap(dense, 'F.0', 'F.1')).toBeGreaterThan(ownerGap(baseline, 'F.0', 'F.1'))
    expect(ownerGap(dense, 'F.1', 'F.2')).toBeGreaterThan(ownerGap(baseline, 'F.1', 'F.2'))
    // The gap before the first dense owner is untouched.
    expect(ownerGap(dense, 'E.start', 'F.0')).toBe(ownerGap(baseline, 'E.start', 'F.0'))
  })

  it('each dense owner ends its satellite stack above the next spine step (no cascade)', () => {
    // The whole point of the fix: a dense owner's satellites must not run past
    // the top of the next control-flow step below it.
    const dense = cleanLayout(denseOwnerChain([1, 5, 1]))
    expectClean(dense)
    const nextTop = nodeById(dense, 'F.2').rect.y
    const ownerSats = dense.nodes.filter(
      (node) => node.kind === 'satellite' && node.id.startsWith('S.1.')
    )
    expect(ownerSats).toHaveLength(5)
    for (const sat of ownerSats) {
      expect(sat.rect.y + sat.rect.height).toBeLessThanOrEqual(nextTop)
    }
  })

  it('is byte-identical to the baseline when every owner is sparse (0-1 satellites)', () => {
    // Sparse owners (0-1 satellites) never trigger expansion: the whole layout
    // — spine AND satellites — must match the zero-satellite baseline spine
    // exactly (backbone), with no rank gap grown.
    const sparse = cleanLayout(denseOwnerChain([1, 0, 1]))
    const baseline = cleanLayout(denseOwnerChain([0, 0, 0]))
    expectClean(sparse)
    expect(relativeBackbone(sparse)).toBe(relativeBackbone(baseline))
    for (const from of ['E.start', 'F.0', 'F.1', 'F.2'] as const) {
      const to = from === 'E.start' ? 'F.0' : from === 'F.2' ? 'E.end' : `F.${Number(from.at(-1)) + 1}`
      expect(ownerGap(sparse, from, to)).toBe(ownerGap(baseline, from, to))
    }
  })

  it('is deterministic for a dense layout (byte-identical over repeated runs)', () => {
    const once = cleanLayout(denseOwnerChain([1, 5, 1]))
    const twice = cleanLayout(denseOwnerChain([1, 5, 1]))
    expect(JSON.stringify(twice.nodes)).toBe(JSON.stringify(once.nodes))
  })
})

describe('straight-first routing — a straight run keeps a single segment', () => {
  // Item 6: an edge whose source and target sit on the same cross line and on
  // adjacent ranks must be a single straight segment (exactly 2 points). No
  // pass may decorate an already-straight route with a mid-bend.
  it('routes an aligned adjacent-rank edge as a 2-point straight line', () => {
    const result = cleanLayout({
      id: 'straight',
      nodes: [
        fn('A', { sourcePosition: { x: 0, y: 0 } }),
        fn('B', { sourcePosition: { x: 0, y: 600 } })
      ],
      edges: [flow('A', 'B')]
    })
    const edge = edgeById(result, 'A->B')
    expect(edge.points.length).toBe(2)
    // Straight => the two endpoints share a cross coordinate (x in TTB).
    expect((edge.points[1] as { x: number }).x).toBeCloseTo((edge.points[0] as { x: number }).x, 9)
    expectClean(result)
  })
})

describe('level-locked splits — every branch leaves at the same along-coord', () => {
  // Item 2: when a split (XOR gate or a fan-out function) emits N branches,
  // all branch routes must exit the source at exactly the same along
  // coordinate (y in top-to-bottom). `routeForwardEdge` derives the source
  // exit from `shapeAlongMax(source)`, which is a per-source constant, so this
  // holds by construction — this test locks it against a regression that would
  // stagger the source stub per branch.
  it('emits all XOR-gate branches at one source y', () => {
    const result = cleanLayout(xorDiamond(4))
    expect(result.orientation).toBe('top-to-bottom')
    const splitOut = result.edges.filter(
      (edge) => edge.source === 'R.split' && edge.classification === 'forward'
    )
    expect(splitOut.length).toBe(4)
    const ys = splitOut.map((edge) => (edge.points[0] as { y: number }).y)
    for (const y of ys) expect(y).toBeCloseTo(ys[0] as number, 9)
    expectClean(result)
  })

  it('emits all fan-out-function branches at one source y', () => {
    const result = cleanLayout({
      id: 'fan-out',
      nodes: [
        fn('Determine', { sourcePosition: { x: 0, y: 0 } }),
        fn('Annual', { sourcePosition: { x: 0, y: 600 } }),
        fn('Adhoc', { sourcePosition: { x: 0, y: 1200 } })
      ],
      edges: [flow('Determine', 'Annual'), flow('Determine', 'Adhoc')]
    })
    const out = result.edges.filter((edge) => edge.source === 'Determine')
    expect(out.length).toBe(2)
    const ys = out.map((edge) => (edge.points[0] as { y: number }).y)
    expect(ys[1]).toBeCloseTo(ys[0] as number, 9)
    expectClean(result)
  })
})

describe('shared-source split turns — every branch turns at one horizontal y', () => {
  // Bug fix (2026-08-09): branches leaving the SAME split (XOR/AND gate or a
  // fan-out function) were each allocated their OWN gap slot, so their L-shaped
  // horizontal turns landed at DIFFERENT cross coords and looked mis-stacked.
  // `GapSlotAllocator.nextForSource` now SHARES one source-side slot per
  // (source, rank-gap), so all branch horizontal turns share a coordinate. The
  // turn coord is the second-to-last point of the branch route (the point right
  // before the target's near-side vertical stub); a branch that happens to sit
  // straight below the source has only 2 points and thus no turn to misalign.
  function turnY(edge: ArisLayoutEdgeRoute): number | null {
    if (edge.points.length < 3) return null
    return (edge.points[edge.points.length - 2] as { y: number }).y
  }
  function branchTurnYs(result: ArisLayoutResult, splitId: string): number[] {
    return result.edges
      .filter((edge) => edge.source === splitId && edge.classification === 'forward')
      .map((edge) => turnY(edge))
      .filter((value): value is number => value !== null)
  }
  function andDiamond(branchCount: number): ArisLayoutGraphInput {
    const nodes = [
      event('E.start'),
      rule('R.split', 'and'),
      rule('R.merge', 'and'),
      event('E.end')
    ]
    const edges = [flow('E.start', 'R.split')]
    for (let index = 0; index < branchCount; index += 1) {
      nodes.push(fn(`F.${index}`))
      edges.push(flow('R.split', `F.${index}`))
      edges.push(flow(`F.${index}`, 'R.merge'))
    }
    edges.push(flow('R.merge', 'E.end'))
    return { id: `and-${branchCount}`, nodes, edges }
  }

  it('XOR split N=2: both branches turn at the same horizontal y', () => {
    const result = cleanLayout(xorDiamond(2))
    const ys = branchTurnYs(result, 'R.split')
    expect(ys.length).toBe(2)
    for (const y of ys) expect(y).toBeCloseTo(ys[0] as number, 9)
    expectClean(result)
  })

  it('XOR split N=3: all bending branches turn at the same horizontal y', () => {
    const result = cleanLayout(xorDiamond(3))
    const ys = branchTurnYs(result, 'R.split')
    expect(ys.length).toBeGreaterThanOrEqual(2)
    for (const y of ys) expect(y).toBeCloseTo(ys[0] as number, 9)
    expectClean(result)
  })

  it('AND split (fan-out) N=3: all bending branches turn at the same horizontal y', () => {
    const result = cleanLayout(andDiamond(3))
    const ys = branchTurnYs(result, 'R.split')
    expect(ys.length).toBeGreaterThanOrEqual(2)
    for (const y of ys) expect(y).toBeCloseTo(ys[0] as number, 9)
    expectClean(result)
  })

  it('fan-out function (no gate) N=3: all bending branches turn at the same horizontal y', () => {
    const result = cleanLayout({
      id: 'fan-out-3',
      nodes: [
        fn('D', { sourcePosition: { x: 0, y: 0 } }),
        fn('A', { sourcePosition: { x: -400, y: 600 } }),
        fn('B', { sourcePosition: { x: 0, y: 600 } }),
        fn('C', { sourcePosition: { x: 400, y: 600 } })
      ],
      edges: [flow('D', 'A'), flow('D', 'B'), flow('D', 'C')]
    })
    const ys = branchTurnYs(result, 'D')
    expect(ys.length).toBeGreaterThanOrEqual(2)
    for (const y of ys) expect(y).toBeCloseTo(ys[0] as number, 9)
    expectClean(result)
  })

  it('regression: distinct single-out sources still get their OWN slot', () => {
    // Per-source SHARING must only collapse repeated calls for the SAME source;
    // two different sources in the same rank gap must still get distinct slots.
    const alloc = new GapSlotAllocator([0, 0], [100, 100])
    const a1 = alloc.nextForSource(0, 7)
    const a2 = alloc.nextForSource(0, 7) // same source -> reuse
    const b1 = alloc.nextForSource(0, 9) // different source -> own slot
    expect(a2).toBe(a1)
    expect(b1).not.toBe(a1)
    // A different rank gap allocates independently of gap 0: source 7 in gap 1
    // is the FIRST ticket of band 1, so it lands at that band's centre.
    const c1 = alloc.nextForSource(1, 7)
    expect(c1).toBe(50) // centre of gap 1's [0,100] band, untouched by gap 0
  })
})

describe('step 11 — minimal label reservation', () => {
  it('reserves nothing when the caption fits inside the shape', () => {
    const result = cleanLayout({
      id: 'label-fits',
      nodes: [
        fn('A', { label: { width: 100, height: 30 } }),
        fn('B', { label: { width: 100, height: 30 } })
      ],
      edges: [flow('A', 'B')]
    })
    expect(nodeById(result, 'A').labelRect).toBeNull()
    expectClean(result)
  })

  it('reserves a caption box below the shape when the caption overflows', () => {
    const result = cleanLayout({
      id: 'label-overflows',
      nodes: [
        rule('A', 'xor', { label: { width: 300, height: 40 } }),
        rule('B', 'xor', { label: { width: 300, height: 40 } })
      ],
      edges: [flow('A', 'B')]
    })
    const node = nodeById(result, 'A')
    expect(node.labelRect).not.toBeNull()
    expect(node.labelRect?.width).toBe(300)
    expect(node.labelRect?.height).toBe(40)
    expect(node.labelRect?.y).toBeGreaterThanOrEqual(node.rect.y + node.rect.height)
    expectClean(result)
  })
})

describe('step 5 — the produced orientation follows the source', () => {
  it('lays a horizontally drawn source out left-to-right', () => {
    const result = cleanLayout({
      id: 'ltr',
      nodes: [
        fn('A', { sourcePosition: { x: 0, y: 0 } }),
        fn('B', { sourcePosition: { x: 600, y: 0 } }),
        fn('C', { sourcePosition: { x: 1200, y: 0 } })
      ],
      edges: [flow('A', 'B'), flow('B', 'C')]
    })
    expect(result.orientation).toBe('left-to-right')
    expect(nodeById(result, 'B').rect.x).toBeGreaterThan(nodeById(result, 'A').rect.x)
    expect(centerY(nodeById(result, 'B'))).toBeCloseTo(centerY(nodeById(result, 'A')), 9)
    expectClean(result)
  })

  it('lays a vertically drawn source out top-to-bottom', () => {
    const result = cleanLayout({
      id: 'ttb',
      nodes: [
        fn('A', { sourcePosition: { x: 0, y: 0 } }),
        fn('B', { sourcePosition: { x: 0, y: 600 } }),
        fn('C', { sourcePosition: { x: 0, y: 1200 } })
      ],
      edges: [flow('A', 'B'), flow('B', 'C')]
    })
    expect(result.orientation).toBe('top-to-bottom')
    expect(nodeById(result, 'B').rect.y).toBeGreaterThan(nodeById(result, 'A').rect.y)
    expectClean(result)
  })
})

describe('parallel connections', () => {
  it('never emits two geometrically identical routes', () => {
    const result = cleanLayout({
      id: 'parallel',
      nodes: [fn('A'), fn('B')],
      edges: [
        { id: 'p1', source: 'A', target: 'B', kind: 'control-flow' },
        { id: 'p2', source: 'A', target: 'B', kind: 'control-flow' }
      ]
    })
    expectClean(result)
    expect(JSON.stringify(edgeById(result, 'p1').points)).not.toBe(
      JSON.stringify(edgeById(result, 'p2').points)
    )
  })
})

describe('step 13 — determinism', () => {
  it('produces byte-identical output over 100 runs of the same graph', () => {
    const graph = chainWithSatellites(6)
    const baseline = JSON.stringify(cleanLayout(graph))
    for (let run = 0; run < 100; run += 1) {
      expect(JSON.stringify(cleanLayout(graph))).toBe(baseline)
    }
  })

  it('produces byte-identical output over 100 runs of a branching, cyclic graph', () => {
    const graph = {
      id: 'mixed',
      nodes: [
        event('E.start'),
        rule('R.split', 'xor'),
        fn('F.1'),
        fn('F.2'),
        fn('F.3'),
        rule('R.merge', 'xor'),
        event('E.end'),
        satellite('S.1'),
        satellite('S.2')
      ],
      edges: [
        flow('E.start', 'R.split'),
        flow('R.split', 'F.1'),
        flow('R.split', 'F.2'),
        flow('R.split', 'F.3'),
        flow('F.1', 'R.merge'),
        flow('F.2', 'R.merge'),
        flow('F.3', 'R.merge'),
        flow('R.merge', 'E.end'),
        flow('E.end', 'R.split'),
        { id: 'F.1~S.1', source: 'F.1', target: 'S.1', kind: 'satellite' as const },
        { id: 'S.2~F.2', source: 'S.2', target: 'F.2', kind: 'satellite' as const }
      ]
    }
    const baseline = JSON.stringify(cleanLayout(graph))
    for (let run = 0; run < 100; run += 1) {
      expect(JSON.stringify(cleanLayout(graph))).toBe(baseline)
    }
  })

  it('does not depend on the order the caller happens to hold the arrays in', () => {
    const graph = xorDiamond(3)
    const first = cleanLayout(graph)
    const second = cleanLayout({
      id: graph.id,
      nodes: [...graph.nodes],
      edges: [...graph.edges]
    })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('plan 12.4 — layout modes', () => {
  const graph = deepFreeze({
    id: 'modes',
    nodes: [
      fn('A', { sourcePosition: { x: 100, y: 100 } }),
      fn('B', { sourcePosition: { x: 100, y: 400 } })
    ],
    edges: [
      {
        id: 'A->B',
        source: 'A',
        target: 'B',
        kind: 'control-flow' as const,
        sourceRoute: [
          { x: 200, y: 180 },
          { x: 200, y: 400 }
        ]
      }
    ]
  })

  it('never mutates the graph it is given', () => {
    const before = JSON.stringify(graph)
    cleanLayout(graph)
    cleanLayoutRevision(graph)
    sourceLayoutRevision(graph)
    resetToSourceLayout(graph)
    expect(JSON.stringify(graph)).toBe(before)
  })

  it('builds the source revision from the imported coordinates and routes', () => {
    const revision = sourceLayoutRevision(graph)
    expect(revision.mode).toBe('source')
    expect(revision.nodes.find((node) => node.id === 'A')?.rect).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 80
    })
    expect(revision.edges[0]?.points).toEqual([
      { x: 200, y: 180 },
      { x: 200, y: 400 }
    ])
  })

  it('writes clean coordinates into a working revision only', () => {
    const working = cleanLayoutRevision(graph)
    expect(working.mode).toBe('clean')
    const source = sourceLayoutRevision(graph)
    expect(JSON.stringify(working.nodes)).not.toBe(JSON.stringify(source.nodes))
  })

  it('restores the source layout exactly after any number of clean runs', () => {
    const before = JSON.stringify(sourceLayoutRevision(graph))
    cleanLayoutRevision(graph)
    cleanLayoutRevision(graph)
    cleanLayoutRevision(graph)
    expect(JSON.stringify(resetToSourceLayout(graph))).toBe(before)
  })

  it('synthesizes an attached connector when the source carried no route', () => {
    const revision = sourceLayoutRevision({
      id: 'no-route',
      nodes: [
        fn('A', { sourcePosition: { x: 0, y: 0 } }),
        fn('B', { sourcePosition: { x: 0, y: 300 } })
      ],
      edges: [flow('A', 'B')]
    })
    const points = revision.edges[0]?.points ?? []
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ x: 100, y: 80 })
    expect(points[1]).toEqual({ x: 100, y: 300 })
  })
})

describe('a 500-node graph', () => {
  const graph = largeGraph(500)
  const started = Date.now()
  const result = cleanLayout(graph)
  const elapsed = Date.now() - started

  it('completes well inside a sane wall-clock bound', () => {
    expect(elapsed).toBeLessThan(20000)
  })

  it('places every node exactly once', () => {
    expect(result.nodes).toHaveLength(500)
    expect(new Set(result.nodes.map((node) => node.id)).size).toBe(500)
  })

  it('draws every connection', () => {
    expect(result.metrics.missingEdges).toBe(0)
    expect(result.edges).toHaveLength(graph.edges.length)
  })

  it('produces zero overlaps and zero edges through unrelated shapes', () => {
    expect(result.metrics.shapeOverlaps).toBe(0)
    expect(result.metrics.labelSatelliteOverlaps).toBe(0)
    expect(result.metrics.edgeShapeCrossings).toBe(0)
    expect(result.metrics.detachedEndpoints).toBe(0)
    expect(result.metrics.zeroLengthEdges).toBe(0)
    expect(result.metrics.duplicateEdges).toBe(0)
  })

  it('is accepted by the rejection gate', () => {
    expect(result.findings.map((finding) => finding.code)).toEqual([])
    expect(result.accepted).toBe(true)
  })
})
