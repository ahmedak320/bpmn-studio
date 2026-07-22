/**
 * validate.ts rejection tests — one per documented invalid case in §2a, with the
 * ported Python error wording asserted. Plus the transformer smoke test that
 * rejects an empty parallel branch.
 */
import { describe, it, expect } from 'vitest'
import { validateBpmn } from '../../src/gen/ir/validate'

/* eslint-disable @typescript-eslint/no-explicit-any */
const start = { type: 'startEvent', id: 'start' }
const end = { type: 'endEvent', id: 'end' }

function expectReject(process: any[], substring: string): void {
  expect(() => validateBpmn(process)).toThrow(substring)
}

describe('validate.ts: structural rejections (ported error wording)', () => {
  it('rejects a missing id', () => {
    expectReject([{ type: 'startEvent' }], 'Element is missing an ID')
  })

  it('rejects a missing type', () => {
    expectReject([{ id: 'x' }], 'Element is missing a type')
  })

  it('rejects an unsupported element type', () => {
    expectReject([{ type: 'subProcess', id: 'x' }], 'Unsupported element type: subProcess')
  })

  it('rejects a task without a label', () => {
    expectReject([start, { type: 'task', id: 't' }, end], 'Task element is missing a label')
  })

  it('rejects duplicate element ids within a level', () => {
    expectReject(
      [start, { type: 'task', id: 'dup', label: 'A' }, { type: 'task', id: 'dup', label: 'B' }, end],
      'Duplicate element ID found: dup'
    )
  })

  it('rejects zero start events', () => {
    expectReject([{ type: 'task', id: 't', label: 'A' }, end], 'exactly one start event, found 0')
  })

  it('rejects multiple start events', () => {
    expectReject(
      [start, { type: 'startEvent', id: 'start2' }, end],
      'exactly one start event, found 2'
    )
  })

  it('rejects a process with no end event anywhere', () => {
    expectReject([start, { type: 'task', id: 't', label: 'A' }], 'at least one end event')
  })

  it('rejects an exclusive gateway missing a label', () => {
    expectReject(
      [start, { type: 'exclusiveGateway', id: 'g', has_join: false, branches: [] }, end],
      'Exclusive gateway is missing a label'
    )
  })

  it("rejects an exclusive gateway with invalid 'branches'", () => {
    expectReject(
      [start, { type: 'exclusiveGateway', id: 'g', label: 'L', has_join: false }, end],
      "Exclusive gateway is missing or has invalid 'branches'"
    )
  })

  it('rejects an exclusive branch missing condition/path', () => {
    expectReject(
      [
        start,
        { type: 'exclusiveGateway', id: 'g', label: 'L', has_join: false, branches: [{ path: [] }] },
        end
      ],
      'Invalid branch in exclusive gateway'
    )
  })

  it('rejects an exclusive gateway whose branch paths are all empty', () => {
    expectReject(
      [
        start,
        {
          type: 'exclusiveGateway',
          id: 'g',
          label: 'L',
          has_join: false,
          branches: [
            { condition: 'a', path: [] },
            { condition: 'b', path: [] }
          ]
        },
        end
      ],
      'all branch paths are empty'
    )
  })

  it('rejects a non-default inclusive branch missing a condition', () => {
    expectReject(
      [
        start,
        {
          type: 'inclusiveGateway',
          id: 'g',
          label: 'L',
          has_join: false,
          branches: [{ path: [{ type: 'task', id: 't', label: 'A' }] }]
        },
        end
      ],
      "non-default branch missing 'condition'"
    )
  })

  it("rejects an inclusive gateway with invalid 'branches'", () => {
    expectReject(
      [start, { type: 'inclusiveGateway', id: 'g', label: 'L', has_join: false }, end],
      "Inclusive gateway is missing or has invalid 'branches'"
    )
  })

  it("rejects a parallel gateway with invalid 'branches'", () => {
    expectReject(
      [start, { type: 'parallelGateway', id: 'g' }, end],
      "Parallel gateway has missing or invalid 'branches'"
    )
  })

  it('rejects an empty parallel branch via the transformer smoke test', () => {
    expectReject(
      [
        start,
        {
          type: 'parallelGateway',
          id: 'p',
          branches: [[{ type: 'task', id: 't', label: 'A' }], []]
        },
        end
      ],
      'cannot have an empty branch'
    )
  })
})
