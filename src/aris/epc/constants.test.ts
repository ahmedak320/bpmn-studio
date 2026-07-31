import { describe, expect, it } from 'vitest'

import { FLOW_CONNECTION_TYPES, OT_EVT, OT_FUNC, OT_RULE, isControlFlowTriple } from './constants'

describe('isControlFlowTriple', () => {
  it('classifies the DMT predecessor connector as flow for only Function→Function', () => {
    expect(isControlFlowTriple('CT_IS_PREDEC_OF_1', OT_FUNC, OT_FUNC)).toBe(true)

    const rejectedTuples = [
      [OT_EVT, OT_FUNC],
      [OT_FUNC, OT_EVT],
      [OT_EVT, OT_EVT],
      [OT_RULE, OT_FUNC],
      [OT_FUNC, OT_RULE],
      [OT_RULE, OT_RULE],
      [OT_FUNC, 'OT_APPL_SYS'],
      ['OT_APPL_SYS', OT_FUNC]
    ] as const
    for (const [fromType, toType] of rejectedTuples) {
      expect(isControlFlowTriple('CT_IS_PREDEC_OF_1', fromType, toType)).toBe(false)
    }
  })

  it('keeps the predecessor connector out of the unsafe type-only flow set', () => {
    expect(FLOW_CONNECTION_TYPES.has('CT_IS_PREDEC_OF_1')).toBe(false)
  })

  it('requires flow-node endpoints for established flow connection types', () => {
    expect(isControlFlowTriple('CT_ACTIV_1', OT_EVT, OT_FUNC)).toBe(true)
    expect(isControlFlowTriple('CT_ACTIV_1', OT_FUNC, OT_FUNC)).toBe(true)
    expect(isControlFlowTriple('CT_ACTIV_1', 'OT_APPL_SYS', OT_FUNC)).toBe(false)
    expect(isControlFlowTriple('CT_SUPP_3', OT_EVT, OT_FUNC)).toBe(false)
  })
})
