import { describe, expect, it } from 'vitest'
import {
  PROCESS_OUTLINE_NODE_TYPES,
  buildProcessOutlineSnapshot,
  planLinearNodeSwap,
  validateProcessOutline
} from '../processOutline'
import { processOutlineMetadataVisibility } from '../processOutlineMetadata'
import { createOutlineTestModeler } from './outlineTestModeler'

describe('process outline projection and validation', () => {
  it('projects every flow node and sequence flow in deterministic process order', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start', { x: 100, y: 100 })
    fixture.addNode('Gateway_1', 'bpmn:ExclusiveGateway', 'Decision', {
      x: 300,
      y: 100
    })
    fixture.addNode('Task_yes', 'bpmn:UserTask', 'Approve', { x: 500, y: 40 })
    fixture.addNode('Task_no', 'bpmn:ServiceTask', 'Reject', { x: 500, y: 180 })
    fixture.addFlow('Flow_start', 'Start_1', 'Gateway_1')
    fixture.addFlow('Flow_yes', 'Gateway_1', 'Task_yes', {
      condition: 'approved = true'
    })
    fixture.addFlow('Flow_no', 'Gateway_1', 'Task_no', { isDefault: true })

    const snapshot = buildProcessOutlineSnapshot([...fixture.elements.values()], ['Gateway_1'])

    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      'Start_1',
      'Gateway_1',
      'Task_yes',
      'Task_no'
    ])
    expect(snapshot.flows.map((flow) => flow.id)).toEqual(['Flow_start', 'Flow_yes', 'Flow_no'])
    expect(snapshot.items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'node:Start_1',
      'flow:Flow_start',
      'node:Gateway_1',
      'flow:Flow_yes',
      'flow:Flow_no',
      'node:Task_yes',
      'node:Task_no'
    ])
    expect(snapshot.selectedIds).toEqual(['Gateway_1'])
    expect(snapshot.issues).toEqual([])
  })

  it('reports invalid endpoints, self-flows, start/end misuse, and gateway branches', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent')
    fixture.addNode('Gateway_1', 'bpmn:ExclusiveGateway')
    fixture.addNode('End_1', 'bpmn:EndEvent')
    fixture.addNode('Task_orphan', 'bpmn:Task')
    fixture.addFlow('Flow_into_start', 'Gateway_1', 'Start_1')
    fixture.addFlow('Flow_missing_condition', 'Gateway_1', 'End_1')
    fixture.addFlow('Flow_default', 'Gateway_1', 'End_1', {
      condition: 'otherwise',
      isDefault: true
    })
    fixture.addFlow('Flow_out_of_end', 'End_1', 'Gateway_1')
    fixture.addFlow('Flow_self', 'Gateway_1', 'Gateway_1')

    const snapshot = buildProcessOutlineSnapshot([...fixture.elements.values()])
    expect(snapshot.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'outline.start-has-incoming',
        'outline.end-has-outgoing',
        'outline.default-has-condition',
        'outline.gateway-condition-missing',
        'outline.node-disconnected',
        'outline.flow-self-reference',
        'outline.flow-duplicate'
      ])
    )

    const withMissingEndpoint = validateProcessOutline({
      nodes: snapshot.nodes,
      flows: [
        ...snapshot.flows,
        {
          kind: 'flow',
          id: 'Flow_dangling',
          type: 'bpmn:SequenceFlow',
          name: '',
          sourceId: 'Gateway_1',
          targetId: 'Missing',
          condition: '',
          isDefault: false,
          labelEditable: true,
          editable: true
        }
      ]
    })
    expect(withMissingEndpoint).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'outline.flow-endpoint-missing',
          itemId: 'Flow_dangling'
        })
      ])
    )
  })

  it('keeps message flows and associations navigable but marks sequence-only editing unavailable', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Task_A', 'bpmn:Task', 'Sender')
    fixture.addNode('Task_B', 'bpmn:Task', 'Receiver')
    fixture.addFlow('Message_1', 'Task_A', 'Task_B', {
      type: 'bpmn:MessageFlow',
      name: 'Notify'
    })
    fixture.addFlow('Association_1', 'Task_A', 'Task_B', {
      type: 'bpmn:Association'
    })

    const snapshot = buildProcessOutlineSnapshot([...fixture.elements.values()])

    expect(snapshot.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['Message_1', 'Association_1'])
    )
    expect(snapshot.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'Message_1',
          type: 'bpmn:MessageFlow',
          labelEditable: true,
          editable: false
        }),
        expect.objectContaining({
          id: 'Association_1',
          type: 'bpmn:Association',
          labelEditable: false,
          editable: false
        })
      ])
    )
  })

  it('recognizes every supported activity/gateway type and mirrors Step Details visibility', () => {
    expect(PROCESS_OUTLINE_NODE_TYPES).toEqual(
      expect.arrayContaining([
        'bpmn:Transaction',
        'bpmn:AdHocSubProcess',
        'bpmn:EventBasedGateway',
        'bpmn:ComplexGateway'
      ])
    )

    expect(processOutlineMetadataVisibility('bpmn:Transaction')).toMatchObject({
      owner: true,
      note: true,
      stepData: true,
      channel: true,
      cc: false,
      triggers: false,
      decisionBasis: false
    })
    expect(processOutlineMetadataVisibility('bpmn:BusinessRuleTask')).toMatchObject({
      channel: true,
      cc: true,
      decisionBasis: true
    })
    expect(processOutlineMetadataVisibility('bpmn:StartEvent')).toMatchObject({
      stepData: true,
      channel: false,
      cc: false,
      triggers: true
    })
    for (const type of [
      'bpmn:ExclusiveGateway',
      'bpmn:InclusiveGateway',
      'bpmn:ParallelGateway',
      'bpmn:EventBasedGateway',
      'bpmn:ComplexGateway'
    ]) {
      expect(processOutlineMetadataVisibility(type).decisionBasis).toBe(true)
    }
  })

  it('keeps legal participant and annotation endpoints navigable without false dangling errors', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Task_1', 'bpmn:Task', 'Review')
    fixture.addArtifact('Annotation_1', 'bpmn:TextAnnotation', { text: 'Review note' })
    fixture.addArtifact('Participant_1', 'bpmn:Participant', { name: 'Customer' })
    fixture.addFlow('Association_1', 'Task_1', 'Annotation_1', {
      type: 'bpmn:Association'
    })
    fixture.addFlow('Message_1', 'Participant_1', 'Task_1', {
      type: 'bpmn:MessageFlow',
      name: 'Request'
    })

    const snapshot = buildProcessOutlineSnapshot([...fixture.elements.values()])

    expect(snapshot.flows.map((flow) => flow.id)).toEqual(
      expect.arrayContaining(['Association_1', 'Message_1'])
    )
    expect(snapshot.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'outline.flow-endpoint-missing' })])
    )
    expect(snapshot.nodes.find((node) => node.id === 'Task_1')?.metadata.note).toBe('Review note')
  })

  it('plans an adjacent semantic reorder only for a strict unconditional linear chain', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent')
    fixture.addNode('Task_A', 'bpmn:Task')
    fixture.addNode('Task_B', 'bpmn:UserTask')
    fixture.addNode('End_1', 'bpmn:EndEvent')
    fixture.addFlow('Flow_start', 'Start_1', 'Task_A')
    fixture.addFlow('Flow_between', 'Task_A', 'Task_B')
    fixture.addFlow('Flow_end', 'Task_B', 'End_1')
    const snapshot = buildProcessOutlineSnapshot([...fixture.elements.values()])

    expect(planLinearNodeSwap(snapshot, 'Task_B', 'up')).toEqual({
      firstNodeId: 'Task_A',
      secondNodeId: 'Task_B',
      previousFlowId: 'Flow_start',
      betweenFlowId: 'Flow_between',
      nextFlowId: 'Flow_end'
    })
    expect(planLinearNodeSwap(snapshot, 'Task_A', 'down')).toEqual(
      planLinearNodeSwap(snapshot, 'Task_B', 'up')
    )
    expect(planLinearNodeSwap(snapshot, 'Task_A', 'up')).toBeNull()
    expect(planLinearNodeSwap(snapshot, 'Start_1', 'down')).toBeNull()
  })

  it('refuses to reorder branches or conditional/default links', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Task_A', 'bpmn:Task')
    fixture.addNode('Task_B', 'bpmn:Task')
    fixture.addNode('Task_C', 'bpmn:Task')
    fixture.addFlow('Flow_AB', 'Task_A', 'Task_B', { condition: 'approved' })
    fixture.addFlow('Flow_AC', 'Task_A', 'Task_C')
    const snapshot = buildProcessOutlineSnapshot([...fixture.elements.values()])

    expect(planLinearNodeSwap(snapshot, 'Task_A', 'down')).toBeNull()
    expect(planLinearNodeSwap(snapshot, 'Task_B', 'up')).toBeNull()
  })
})
