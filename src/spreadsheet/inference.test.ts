import { describe, expect, it } from 'vitest'
import type { ProcessWorkbookModel, WorkbookNode } from './contracts'
import { SpreadsheetError } from './errors'
import {
  applyGraphInferencePlan,
  assignDeterministicIds,
  createGraphInferencePlan
} from './inference'
import { bilingual, provenance, validModel, validNodes } from './testFixtures'

function task(id: string, order: number, overrides: Partial<WorkbookNode> = {}): WorkbookNode {
  return {
    processId: 'leave_approval',
    id,
    idOrigin: id ? 'explicit' : 'generated',
    order,
    type: 'task',
    name: bilingual(`Task ${order}`, `المهمة ${order}`),
    metadata: {},
    provenance: provenance('Steps', order + 1, ['step_id', 'order']),
    ...overrides
  }
}

describe('deterministic IDs and graph inference', () => {
  it('generates stable IDs from process, normalized label, and source row', () => {
    const model = validModel({
      participants: [
        {
          processId: 'leave_approval',
          id: '',
          idOrigin: 'generated',
          type: 'lane',
          name: bilingual('Manager', 'المدير'),
          provenance: provenance('Participants', 7)
        }
      ],
      nodes: [task('', 1), task('', 2)],
      flows: [
        {
          processId: 'leave_approval',
          id: '',
          idOrigin: 'generated',
          sourceStepId: 'A',
          targetStepId: 'B',
          isDefault: false,
          origin: 'explicit',
          provenance: provenance('Flows', 3)
        }
      ]
    })
    const first = assignDeterministicIds(model)
    const second = assignDeterministicIds(model)

    expect(first.generatedIds).toEqual(second.generatedIds)
    expect(first.model.nodes[0]!.id).toMatch(/^Step_leave_approval_task_1_r2_[0-9a-f]{8}$/)
    expect(first.model.participants[0]!.id).toMatch(
      /^Participant_leave_approval_manager_r7_[0-9a-f]{8}$/
    )
    expect(first.model.flows[0]!.id).toMatch(/^Flow_leave_approval_a_b_r3_[0-9a-f]{8}$/)
  })

  it('previews numeric-order flows and bilingual synthetic boundaries, requiring confirmation', () => {
    const model = validModel({
      participants: [],
      nodes: [task('', 10), task('', 20)],
      flows: []
    })
    const plan = createGraphInferencePlan(model)

    expect(plan.generatedIds).toHaveLength(2)
    expect(plan.inferredFlows).toHaveLength(1)
    expect(plan.inferredFlowRecords[0]!.reason).toBe('numeric-order')
    expect(plan.syntheticBoundaries.map(({ kind }) => kind)).toEqual(['start', 'end'])
    expect(plan.syntheticBoundaries[0]!.node.name).toEqual({
      en: 'Start',
      ar: 'البداية',
      active: 'en'
    })
    expect(plan.requiresSyntheticBoundaryConfirmation).toBe(true)
    expect(() =>
      applyGraphInferencePlan(model, plan, { confirmSyntheticBoundaries: false })
    ).toThrowError(SpreadsheetError)

    const applied = applyGraphInferencePlan(model, plan, {
      confirmSyntheticBoundaries: true
    })
    expect(applied.nodes).toHaveLength(4)
    expect(applied.flows).toHaveLength(3)
    expect(applied.nodes.map(({ type }) => type)).toContain('startEvent')
    expect(applied.nodes.map(({ type }) => type)).toContain('endEvent')
  })

  it('gives explicit Flows priority over every inference mode', () => {
    const plan = createGraphInferencePlan(validModel())
    expect(plan.inferredFlows).toEqual([])
    expect(plan.syntheticBoundaries).toEqual([])
    expect(plan.issues).toEqual([])
  })

  it('uses a single mapped next step but refuses to guess branch conditions', () => {
    const linearNodes = validNodes().map((node, index, nodes) => ({
      ...node,
      ...(index + 1 < nodes.length ? { nextStepIds: [nodes[index + 1]!.id] } : {})
    }))
    const linear = createGraphInferencePlan(
      validModel({ participants: [], nodes: linearNodes, flows: [] })
    )
    expect(linear.inferredFlows).toHaveLength(2)
    expect(linear.issues).toEqual([])

    const gatewayNodes: WorkbookNode[] = [
      validNodes()[0]!,
      task('Gateway_1', 2, {
        type: 'exclusiveGateway',
        nextStepIds: ['A', 'B']
      }),
      task('A', 3, { type: 'endEvent' }),
      task('B', 4, { type: 'endEvent' })
    ]
    const branching = createGraphInferencePlan(
      validModel({ participants: [], nodes: gatewayNodes, flows: [] })
    )
    expect(branching.issues).toContainEqual(
      expect.objectContaining({
        code: 'branch-topology-requires-explicit-conditions',
        severity: 'error'
      })
    )
  })

  it('accepts rich mapped gateway transitions only when non-default conditions exist', () => {
    const nodes: WorkbookNode[] = [
      {
        ...validNodes()[0]!,
        mappedTransitions: [{ targetStepId: 'Gateway_1' }]
      },
      task('Gateway_1', 2, {
        type: 'exclusiveGateway',
        mappedTransitions: [
          {
            targetStepId: 'End_A',
            condition: bilingual('Approved', 'تمت الموافقة')
          },
          { targetStepId: 'End_B', isDefault: true }
        ]
      }),
      task('End_A', 3, { type: 'endEvent' }),
      task('End_B', 4, { type: 'endEvent' })
    ]
    const plan = createGraphInferencePlan(validModel({ participants: [], nodes, flows: [] }))
    expect(plan.issues).toEqual([])
    expect(plan.inferredFlows).toHaveLength(3)
    expect(plan.inferredFlows.find(({ isDefault }) => isDefault)?.condition).toBeUndefined()
  })

  it('blocks ambiguous order, gateway topology without targets, and stale plans', () => {
    const duplicateOrder = validModel({
      participants: [],
      nodes: [task('A', 1), task('B', 1)],
      flows: []
    })
    expect(createGraphInferencePlan(duplicateOrder).issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate-numeric-order' })
    )

    const gateway = validModel({
      participants: [],
      nodes: [task('Gateway', 1, { type: 'parallelGateway' })],
      flows: []
    })
    expect(createGraphInferencePlan(gateway).issues).toContainEqual(
      expect.objectContaining({ code: 'gateway-topology-not-inferred' })
    )

    const original = validModel({ participants: [], nodes: [task('A', 1)], flows: [] })
    const plan = createGraphInferencePlan(original)
    const changed: ProcessWorkbookModel = {
      ...original,
      nodes: [{ ...original.nodes[0]!, order: 99 }]
    }
    expect(() =>
      applyGraphInferencePlan(changed, plan, { confirmSyntheticBoundaries: true })
    ).toThrowError(SpreadsheetError)
  })

  it('honors explicit, next-step, and numeric-order flow modes', () => {
    const withoutFlows = validModel({
      participants: [],
      nodes: [task('A', 1), task('B', 2)],
      flows: []
    })
    expect(createGraphInferencePlan(withoutFlows, { flowMode: 'explicit' }).issues).toContainEqual(
      expect.objectContaining({ code: 'explicit-flows-required' })
    )
    expect(createGraphInferencePlan(withoutFlows, { flowMode: 'next-step' }).issues).toContainEqual(
      expect.objectContaining({ code: 'mapped-next-step-required' })
    )

    const withExplicitAndMapped = validModel({
      participants: [],
      nodes: [task('A', 1, { nextStepIds: ['B'] }), task('B', 2)]
    })
    const numeric = createGraphInferencePlan(withExplicitAndMapped, {
      flowMode: 'numeric-order'
    })
    expect(numeric.flowMode).toBe('numeric-order')
    expect(numeric.inferredFlowRecords).toContainEqual(
      expect.objectContaining({ reason: 'numeric-order' })
    )
    const applied = applyGraphInferencePlan(withExplicitAndMapped, numeric, {
      confirmSyntheticBoundaries: true
    })
    expect(applied.flows.every(({ origin }) => origin !== 'explicit')).toBe(true)
  })

  it('requires mapped gateway conditions except for parallel/default paths', () => {
    const invalid = createGraphInferencePlan(
      validModel({
        participants: [],
        flows: [],
        nodes: [
          task('Gateway', 1, {
            type: 'inclusiveGateway',
            mappedTransitions: [{ targetStepId: 'End' }]
          }),
          task('End', 2, { type: 'endEvent' })
        ]
      }),
      { flowMode: 'next-step' }
    )
    expect(invalid.issues).toContainEqual(
      expect.objectContaining({ code: 'gateway-condition-required' })
    )
    expect(() =>
      applyGraphInferencePlan(
        validModel({
          participants: [],
          flows: [],
          nodes: [
            task('Gateway', 1, {
              type: 'inclusiveGateway',
              mappedTransitions: [{ targetStepId: 'End' }]
            }),
            task('End', 2, { type: 'endEvent' })
          ]
        }),
        invalid,
        { confirmSyntheticBoundaries: true }
      )
    ).toThrowError(SpreadsheetError)

    const valid = createGraphInferencePlan(
      validModel({
        participants: [],
        flows: [],
        nodes: [
          task('Gateway', 1, {
            type: 'parallelGateway',
            mappedTransitions: [{ targetStepId: 'End' }]
          }),
          task('End', 2, { type: 'endEvent' })
        ]
      }),
      { flowMode: 'next-step' }
    )
    expect(valid.issues.some(({ code }) => code === 'gateway-condition-required')).toBe(false)
  })

  it('reports missing order and ambiguous synthetic boundary candidates', () => {
    const missingOrder = validModel({
      participants: [],
      flows: [],
      nodes: [task('A', 1), { ...task('B', 2), order: undefined }]
    })
    expect(createGraphInferencePlan(missingOrder).issues).toContainEqual(
      expect.objectContaining({ code: 'numeric-order-required' })
    )

    const isolated = validModel({
      participants: [],
      flows: [],
      nodes: [task('A', 1), task('B', 2), task('C', 3)]
    })
    const plan = createGraphInferencePlan(isolated, { flowMode: 'explicit' })
    expect(plan.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'explicit-flows-required',
        'synthetic-start-ambiguous',
        'synthetic-end-ambiguous'
      ])
    )
  })

  it('applies an already complete explicit graph without boundary confirmation', () => {
    const model = validModel()
    const plan = createGraphInferencePlan(model, { flowMode: 'explicit' })
    const applied = applyGraphInferencePlan(model, plan, {
      confirmSyntheticBoundaries: false
    })
    expect(applied.nodes).toHaveLength(model.nodes.length)
    expect(applied.flows).toHaveLength(model.flows.length)
  })
})
