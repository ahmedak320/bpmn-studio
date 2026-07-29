import { describe, expect, it } from 'vitest'

import {
  evaluateArisInteractionGate,
  evaluateEndurance,
  percentile,
  type ArisInteractionSample
} from '../../scripts/browserPerformanceEvidence'

function sample(
  name: ArisInteractionSample['name'],
  overrides: Partial<ArisInteractionSample> = {}
): ArisInteractionSample {
  return {
    name,
    trustedEvent: true,
    responseMs: 20,
    observed: `${name} observed`,
    ...overrides
  }
}

function samples(
  name: ArisInteractionSample['name'],
  count: number,
  overrides: Partial<ArisInteractionSample> = {}
): ArisInteractionSample[] {
  return Array.from({ length: count }, () => sample(name, overrides))
}

describe('nearest-rank percentile', () => {
  it('returns a value that was actually measured', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(values, 0.95)).toBe(100)
    expect(percentile(values, 0.5)).toBe(50)
    expect(percentile([], 0.95)).toBe(0)
  })

  it('rejects a fraction outside (0, 1]', () => {
    expect(() => percentile([1], 0)).toThrow(/fraction/i)
    expect(() => percentile([1], 1.5)).toThrow(/fraction/i)
  })
})

describe('ARIS selection/drag/edit interaction evidence', () => {
  it('passes only when every required interaction is trusted, observed and inside the budget', () => {
    const gate = evaluateArisInteractionGate(
      [...samples('selection', 10), ...samples('drag', 10), ...samples('edit', 10)],
      100,
      10
    )

    expect(gate.complete).toBe(true)
    expect(gate.passed).toBe(true)
    expect(gate.failures).toEqual([])
    expect(gate.overallP95Ms).toBe(20)
    expect(gate.perInteraction.map((entry) => entry.name)).toEqual(['selection', 'drag', 'edit'])
  })

  it('fails closed on too few samples, synthetic events, unobserved responses and a slow p95', () => {
    const gate = evaluateArisInteractionGate(
      [
        ...samples('selection', 9),
        ...samples('drag', 10, { trustedEvent: false }),
        ...samples('edit', 9),
        sample('edit', { observed: '   ', responseMs: 4_000 })
      ],
      100,
      10
    )

    expect(gate.complete).toBe(false)
    expect(gate.passed).toBe(false)
    expect(gate.failures).toEqual(
      expect.arrayContaining([
        'selection contributed 9 sample(s); 10 are required for a percentile',
        'drag: 10 sample(s) did not originate from a trusted browser event',
        'edit: 1 sample(s) recorded no observed product change'
      ])
    )
  })

  it('reports the p95 breach verbatim rather than rounding it away', () => {
    const gate = evaluateArisInteractionGate(
      // 60 samples, 4 of them slow: nearest-rank p95 lands on rank 57, the
      // first of the slow tail, so the reported number is a measured one.
      [
        ...samples('selection', 20),
        ...samples('drag', 20),
        ...samples('edit', 16),
        ...samples('edit', 4, { responseMs: 250.5 })
      ],
      100,
      10
    )

    expect(gate.passed).toBe(false)
    expect(gate.failures).toContain('selection/drag/edit p95 is 250.5 ms, above the 100 ms budget')
  })

  it('rejects a non-positive budget or a fractional minimum sample count', () => {
    expect(() => evaluateArisInteractionGate([], 0, 1)).toThrow(/positive/i)
    expect(() => evaluateArisInteractionGate([], 100, 0)).toThrow(/positive integer/i)
  })
})

describe('endurance evidence', () => {
  it('passes a flat run of the required length', () => {
    const evidence = evaluateEndurance(
      'model switches',
      Array.from({ length: 50 }, () => 40),
      50,
      2
    )

    expect(evidence.cycles).toBe(50)
    expect(evidence.driftRatio).toBe(1)
    expect(evidence.passed).toBe(true)
    expect(evidence.failures).toEqual([])
  })

  it('fails a short run, an errored run and a run that progressively slows down', () => {
    const short = evaluateEndurance('import/close cycles', [10, 10, 10], 20, 2)
    expect(short.passed).toBe(false)
    expect(short.failures).toContain('import/close cycles completed 3 of 20 cycles')

    const errored = evaluateEndurance(
      'import/close cycles',
      Array.from({ length: 20 }, () => 10),
      20,
      2,
      3
    )
    expect(errored.passed).toBe(false)
    expect(errored.failures).toContain('import/close cycles: 3 cycle(s) reported an error')

    const slowing = evaluateEndurance(
      'model switches',
      Array.from({ length: 50 }, (_unused, index) => 10 + index * 2),
      50,
      2
    )
    expect(slowing.passed).toBe(false)
    expect(slowing.driftRatio).toBeGreaterThan(2)
  })

  it('rejects an impossible configuration instead of quietly accepting it', () => {
    expect(() => evaluateEndurance('x', [], 4, 2)).toThrow(/five/i)
    expect(() => evaluateEndurance('x', [], 20, 1)).toThrow(/greater than 1/i)
  })
})
