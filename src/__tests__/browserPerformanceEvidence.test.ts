import { describe, expect, it } from 'vitest'

import {
  evaluateWorkerInteractionGate,
  type WorkerInteractionReceipt
} from '../../scripts/browserPerformanceEvidence'

function receipt(
  name: WorkerInteractionReceipt['name'],
  overrides: Partial<WorkerInteractionReceipt> = {}
): WorkerInteractionReceipt {
  return {
    name,
    requestType: 'parse',
    trustedEvent: true,
    workerOverlapMs: 8,
    responseLatencyMs: 20,
    observed: name === 'typing' ? 'Responsive probe' : 'true',
    ...overrides
  }
}

describe('browser worker interaction evidence', () => {
  it('requires one trusted, overlapping, responsive receipt for every real action', () => {
    const gate = evaluateWorkerInteractionGate(
      [receipt('typing'), receipt('selection'), receipt('pane')],
      250
    )

    expect(gate.complete).toBe(true)
    expect(gate.passed).toBe(true)
    expect(gate.failures).toEqual([])
  })

  it('fails closed for missing, synthetic, non-overlapping, or slow interactions', () => {
    const gate = evaluateWorkerInteractionGate(
      [
        receipt('typing', { trustedEvent: false, requestType: 'review' }),
        receipt('selection', { workerOverlapMs: 0 }),
        receipt('selection'),
        receipt('pane', { responseLatencyMs: 251 })
      ],
      250
    )

    expect(gate.complete).toBe(false)
    expect(gate.passed).toBe(false)
    expect(gate.failures).toEqual(
      expect.arrayContaining([
        'typing did not originate from a trusted browser event',
        'typing did not overlap the worker parse phase',
        'selection must have exactly one receipt (found 2)',
        'pane exceeded the 250 ms response budget'
      ])
    )
  })
})
