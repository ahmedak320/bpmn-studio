import { describe, expect, it, vi } from 'vitest'
import {
  ProcessOutlineError,
  createProcessOutlineController,
  type ProcessOutlineSnapshot
} from '../processOutline'
import { createOutlineTestModeler } from './outlineTestModeler'

describe('ProcessOutlineController bpmn-js synchronization', () => {
  it('tracks external canvas/model changes and drives canvas selection from the outline', () => {
    const fixture = createOutlineTestModeler()
    const start = fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    fixture.addNode('Task_1', 'bpmn:Task', 'Review')
    fixture.addFlow('Flow_1', 'Start_1', 'Task_1')
    const controller = createProcessOutlineController(fixture.modeler)
    const listener = vi.fn<(snapshot: ProcessOutlineSnapshot) => void>()
    controller.subscribe(listener)

    const externallyAdded = fixture.addNode('Task_external', 'bpmn:UserTask', 'External edit')
    fixture.emit('commandStack.changed')
    expect(controller.snapshot.nodes.map((node) => node.id)).toContain('Task_external')

    fixture.selected.splice(0, fixture.selected.length, externallyAdded)
    fixture.emit('selection.changed')
    expect(controller.snapshot.selectedIds).toEqual(['Task_external'])

    controller.select('Start_1')
    expect(fixture.selected).toEqual([start])
    expect(fixture.scrollToElement).toHaveBeenCalledWith(start, 120)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ selectedIds: ['Start_1'] }))

    const callsBeforeDestroy = listener.mock.calls.length
    controller.destroy()
    fixture.addNode('Task_after_destroy', 'bpmn:Task')
    fixture.emit('commandStack.changed')
    expect(listener).toHaveBeenCalledTimes(callsBeforeDestroy)
  })

  it('adds, edits, documents, and connects nodes through modeling commands', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    const controller = createProcessOutlineController(fixture.modeler)

    const task = controller.addNode({
      type: 'bpmn:UserTask',
      name: 'Review request',
      documentation: 'Check all required fields.',
      connectFromId: 'Start_1'
    })
    expect(task).toMatchObject({
      type: 'bpmn:UserTask',
      name: 'Review request',
      documentation: 'Check all required fields.'
    })
    expect(controller.snapshot.flows).toEqual([
      expect.objectContaining({
        sourceId: 'Start_1',
        targetId: task.id,
        type: 'bpmn:SequenceFlow'
      })
    ])

    controller.updateNode(task.id, {
      name: 'Approve request',
      documentation: 'Updated documentation.'
    })
    expect(controller.snapshot.nodes.find((node) => node.id === task.id)).toMatchObject({
      name: 'Approve request',
      documentation: 'Updated documentation.'
    })

    const end = fixture.addNode('End_1', 'bpmn:EndEvent', 'Done')
    fixture.emit('elements.changed')
    const flow = controller.connectNodes({
      sourceId: task.id,
      targetId: end.id,
      name: 'Completed'
    })
    expect(flow).toMatchObject({
      name: 'Completed',
      sourceId: task.id,
      targetId: 'End_1'
    })
  })

  it('persists gateway conditions/defaults and reconnects both endpoints', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Gateway_1', 'bpmn:ExclusiveGateway', 'Decision')
    fixture.addNode('Task_yes', 'bpmn:Task', 'Approve')
    fixture.addNode('Task_no', 'bpmn:Task', 'Reject')
    fixture.addNode('Task_other', 'bpmn:Task', 'Manual review')
    const controller = createProcessOutlineController(fixture.modeler)

    const conditional = controller.connectNodes({
      sourceId: 'Gateway_1',
      targetId: 'Task_yes',
      condition: 'approved = true'
    })
    const fallback = controller.connectNodes({
      sourceId: 'Gateway_1',
      targetId: 'Task_no',
      isDefault: true
    })
    expect(controller.snapshot.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'outline.gateway-condition-missing' })
      ])
    )
    expect(controller.snapshot.flows.find((flow) => flow.id === fallback.id)).toMatchObject({
      isDefault: true,
      condition: ''
    })

    controller.updateFlow(conditional.id, {
      sourceId: 'Task_other',
      targetId: 'Task_no',
      name: 'Rerouted',
      condition: '',
      isDefault: false
    })
    expect(fixture.reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: conditional.id }),
      expect.objectContaining({ id: 'Task_other' }),
      expect.objectContaining({ id: 'Task_no' })
    )
    expect(controller.snapshot.flows.find((flow) => flow.id === conditional.id)).toMatchObject({
      sourceId: 'Task_other',
      targetId: 'Task_no',
      name: 'Rerouted'
    })

    expect(() =>
      controller.updateFlow(fallback.id, {
        sourceId: 'Gateway_1',
        targetId: 'Task_no',
        condition: 'otherwise',
        isDefault: true
      })
    ).toThrowError(ProcessOutlineError)
  })

  it('rewires and visually swaps linear steps, then deletes with incident flows', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start', { x: 0, y: 0 })
    fixture.addNode('Task_A', 'bpmn:Task', 'A', { x: 200, y: 0 })
    fixture.addNode('Task_B', 'bpmn:Task', 'B', { x: 400, y: 0 })
    fixture.addNode('End_1', 'bpmn:EndEvent', 'End', { x: 600, y: 0 })
    fixture.addFlow('Flow_start', 'Start_1', 'Task_A')
    fixture.addFlow('Flow_between', 'Task_A', 'Task_B')
    fixture.addFlow('Flow_end', 'Task_B', 'End_1')
    const controller = createProcessOutlineController(fixture.modeler)

    controller.moveNode('Task_B', 'up')
    expect(controller.snapshot.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'Flow_start',
          sourceId: 'Start_1',
          targetId: 'Task_B'
        }),
        expect.objectContaining({
          id: 'Flow_between',
          sourceId: 'Task_B',
          targetId: 'Task_A'
        }),
        expect.objectContaining({
          id: 'Flow_end',
          sourceId: 'Task_A',
          targetId: 'End_1'
        })
      ])
    )
    expect(fixture.elements.get('Task_A')?.x).toBe(400)
    expect(fixture.elements.get('Task_B')?.x).toBe(200)
    expect(fixture.moveShape).toHaveBeenCalledTimes(2)

    controller.deleteItem('Task_A')
    expect(controller.snapshot.nodes.map((node) => node.id)).not.toContain('Task_A')
    expect(controller.snapshot.flows.map((flow) => flow.id)).not.toContain('Flow_between')
    expect(controller.snapshot.flows.map((flow) => flow.id)).not.toContain('Flow_end')
    expect(fixture.removeElements).toHaveBeenCalledOnce()
  })
})
