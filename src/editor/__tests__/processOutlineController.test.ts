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
    expect(fixture.commandExecute).toHaveBeenCalledTimes(3)
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
    expect(controller.snapshot.flows.find((flow) => flow.id === fallback.id)).toMatchObject({
      sourceId: 'Gateway_1',
      targetId: 'Task_no',
      condition: '',
      isDefault: true
    })
  })

  it('prevalidates default sources and reconnect rules before mutating the diagram', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    fixture.addNode('Task_1', 'bpmn:Task', 'Review')
    fixture.addNode('End_1', 'bpmn:EndEvent', 'End')
    const existing = fixture.addFlow('Flow_1', 'Start_1', 'Task_1')
    const controller = createProcessOutlineController(fixture.modeler)

    expect(() =>
      controller.connectNodes({
        sourceId: 'Start_1',
        targetId: 'End_1',
        isDefault: true
      })
    ).toThrowError(
      expect.objectContaining<Partial<ProcessOutlineError>>({
        code: 'default-flow-source-invalid'
      })
    )
    expect(controller.snapshot.flows.map((flow) => flow.id)).toEqual(['Flow_1'])

    fixture.rulesAllowed.mockReturnValueOnce(false)
    expect(() =>
      controller.updateFlow(existing.id, {
        sourceId: 'Task_1',
        targetId: 'End_1',
        name: 'Rejected reroute',
        condition: '',
        isDefault: false
      })
    ).toThrowError(
      expect.objectContaining<Partial<ProcessOutlineError>>({
        code: 'connection-rejected'
      })
    )
    expect(existing.source?.id).toBe('Start_1')
    expect(existing.target?.id).toBe('Task_1')
    expect(existing.businessObject.name).toBeUndefined()
  })

  it('renames non-sequence connections without exposing sequence-flow mutations', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Task_A', 'bpmn:Task', 'Sender')
    fixture.addNode('Task_B', 'bpmn:Task', 'Receiver')
    const message = fixture.addFlow('Message_1', 'Task_A', 'Task_B', {
      type: 'bpmn:MessageFlow',
      name: 'Request'
    })
    const controller = createProcessOutlineController(fixture.modeler)

    controller.updateFlow(message.id, {
      sourceId: 'Task_A',
      targetId: 'Task_B',
      name: 'Response',
      condition: '',
      isDefault: false
    })
    expect(message.businessObject.name).toBe('Response')
    expect(fixture.reconnect).not.toHaveBeenCalled()

    expect(() =>
      controller.updateFlow(message.id, {
        sourceId: 'Task_B',
        targetId: 'Task_A',
        name: 'Invalid reroute',
        condition: 'approved',
        isDefault: false
      })
    ).toThrowError(
      expect.objectContaining<Partial<ProcessOutlineError>>({
        code: 'flow-edit-not-supported'
      })
    )
    expect(message.source?.id).toBe('Task_A')
    expect(message.target?.id).toBe('Task_B')
    expect(message.businessObject.name).toBe('Response')
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
    expect(fixture.commandExecute).toHaveBeenCalledTimes(1)

    fixture.undo()
    expect(fixture.elements.get('Flow_start')?.target?.id).toBe('Task_A')
    expect(fixture.elements.get('Flow_between')?.source?.id).toBe('Task_A')
    expect(fixture.elements.get('Flow_between')?.target?.id).toBe('Task_B')
    expect(fixture.elements.get('Flow_end')?.source?.id).toBe('Task_B')
    expect(fixture.elements.get('Task_A')?.x).toBe(200)
    expect(fixture.elements.get('Task_B')?.x).toBe(400)

    fixture.redo()
    expect(fixture.elements.get('Flow_start')?.target?.id).toBe('Task_B')
    expect(fixture.elements.get('Flow_end')?.source?.id).toBe('Task_A')

    controller.deleteItem('Task_A')
    expect(controller.snapshot.nodes.map((node) => node.id)).not.toContain('Task_A')
    expect(controller.snapshot.flows.map((flow) => flow.id)).not.toContain('Flow_between')
    expect(controller.snapshot.flows.map((flow) => flow.id)).not.toContain('Flow_end')
    expect(fixture.removeElements).toHaveBeenCalledOnce()
    expect(fixture.commandExecute).toHaveBeenCalledTimes(2)
  })

  it('updates the complete Step Details metadata bag in one undoable transaction', () => {
    const fixture = createOutlineTestModeler()
    fixture.root.businessObject.$attrs = { 'orbitpm:activeLang': 'ar' }
    const task = fixture.addNode('Task_1', 'bpmn:BusinessRuleTask', 'الاسم القديم')
    const firstDocumentation = {
      $type: 'bpmn:Documentation',
      id: 'Documentation_1',
      text: 'Original documentation',
      textFormat: 'text/markdown',
      $attrs: { 'vendor:doc': 'keep' },
      extensionElements: { values: [{ $type: 'vendor:DocPayload', value: 'keep' }] }
    }
    const secondDocumentation = {
      $type: 'bpmn:Documentation',
      id: 'Documentation_2',
      text: 'Secondary documentation',
      $attrs: { 'vendor:secondary': 'keep' }
    }
    const extensionElements = {
      values: [{ $type: 'vendor:Payload', token: 'opaque' }]
    }
    task.businessObject.documentation = [firstDocumentation, secondDocumentation]
    task.businessObject.$attrs = {
      'vendor:flag': 'keep',
      'orbitpm:ownerEn': 'Future paired owner'
    }
    task.businessObject.extensionElements = extensionElements
    const controller = createProcessOutlineController(fixture.modeler)

    const metadata = {
      ...controller.snapshot.nodes[0].metadata,
      owner: 'Operations',
      ownerType: 'department',
      ownerRole: 'A',
      note: 'Linked reviewer note',
      channel: 'dmthub',
      channelDetail: 'case-api',
      cc: true,
      ccTo: 'audit@example.test',
      triggers: [{ type: 'manual', service: 'desk', detail: 'reviewed' }],
      nameEn: 'Approve request',
      nameAr: 'اعتماد الطلب',
      inputs: 'Application\nEvidence',
      outputs: 'Decision',
      system: 'Case Hub',
      respList: 'Reviewer — R',
      ccList: 'Audit',
      decisionBasis: 'Policy 7'
    }

    controller.updateNode('Task_1', {
      documentation: 'Updated documentation',
      metadata
    })

    expect(fixture.commandExecute).toHaveBeenCalledTimes(1)
    expect(task.businessObject.name).toBe('اعتماد الطلب')
    expect(task.businessObject['orbitpm:nameEn']).toBe('Approve request')
    expect(task.businessObject['orbitpm:nameAr']).toBe('اعتماد الطلب')
    expect(task.businessObject['orbitpm:owner']).toBe('Operations')
    expect(task.businessObject['orbitpm:decisionBasis']).toBe('Policy 7')
    expect(task.businessObject['orbitpm:triggers']).toBe('manual — desk — reviewed')
    expect(task.businessObject.$attrs).toEqual({
      'vendor:flag': 'keep',
      'orbitpm:ownerEn': 'Future paired owner'
    })
    expect(task.businessObject.extensionElements).toBe(extensionElements)
    expect(task.businessObject.documentation?.[0]).toBe(firstDocumentation)
    expect(firstDocumentation).toMatchObject({
      text: 'Updated documentation',
      textFormat: 'text/markdown',
      $attrs: { 'vendor:doc': 'keep' }
    })
    expect(task.businessObject.documentation?.[1]).toBe(secondDocumentation)
    expect(controller.snapshot.nodes[0].metadata).toMatchObject(metadata)
    expect(controller.snapshot.nodes[0].metadata.note).toBe('Linked reviewer note')
    expect(
      [...fixture.elements.values()].filter((element) => element.type === 'bpmn:TextAnnotation')
    ).toHaveLength(1)

    fixture.undo()
    expect(task.businessObject.name).toBe('الاسم القديم')
    expect(firstDocumentation.text).toBe('Original documentation')
    expect(task.businessObject['orbitpm:owner']).toBeUndefined()
    expect(task.businessObject.$attrs?.['vendor:flag']).toBe('keep')
    expect(task.businessObject.extensionElements).toBe(extensionElements)
    expect(
      [...fixture.elements.values()].filter((element) => element.type === 'bpmn:TextAnnotation')
    ).toHaveLength(0)

    fixture.redo()
    expect(task.businessObject.name).toBe('اعتماد الطلب')
    expect(firstDocumentation.text).toBe('Updated documentation')
    expect(task.businessObject['orbitpm:owner']).toBe('Operations')
    expect(controller.snapshot.nodes[0].metadata.note).toBe('Linked reviewer note')
  })

  it('keeps a cleared active name empty while projecting only a stored opposite-language fallback', () => {
    const fixture = createOutlineTestModeler()
    fixture.root.businessObject.$attrs = { 'orbitpm:activeLang': 'en' }
    const task = fixture.addNode('Task_1', 'bpmn:Task', 'English name')
    task.businessObject['orbitpm:nameEn'] = 'English name'
    task.businessObject['orbitpm:nameAr'] = 'الاسم العربي'
    const controller = createProcessOutlineController(fixture.modeler)

    controller.updateNode('Task_1', {
      metadata: {
        ...controller.snapshot.nodes[0].metadata,
        nameEn: ''
      }
    })

    expect(task.businessObject.name).toBe('الاسم العربي')
    expect(controller.snapshot.nodes[0].metadata.nameEn).toBe('')
    expect(controller.snapshot.nodes[0].metadata.nameAr).toBe('الاسم العربي')

    fixture.undo()
    expect(task.businessObject.name).toBe('English name')
    expect(controller.snapshot.nodes[0].metadata.nameEn).toBe('English name')

    fixture.redo()
    expect(task.businessObject.name).toBe('الاسم العربي')
    expect(controller.snapshot.nodes[0].metadata.nameEn).toBe('')

    controller.updateNode('Task_1', {
      metadata: {
        ...controller.snapshot.nodes[0].metadata,
        nameEn: '',
        nameAr: ''
      }
    })
    expect(task.businessObject.name).toBeUndefined()
    expect(controller.snapshot.nodes[0]).toMatchObject({
      name: '',
      metadata: {
        nameEn: '',
        nameAr: ''
      }
    })
  })

  it('preserves a future kind when CC is false while still allowing CC to be toggled off', () => {
    const fixture = createOutlineTestModeler()
    const task = fixture.addNode('Task_1', 'bpmn:Task', 'Review')
    task.businessObject['orbitpm:kind'] = 'future-review-kind'
    const controller = createProcessOutlineController(fixture.modeler)

    controller.updateNode('Task_1', {
      metadata: {
        ...controller.snapshot.nodes[0].metadata,
        owner: 'Operations',
        cc: false
      }
    })
    expect(task.businessObject['orbitpm:kind']).toBe('future-review-kind')

    controller.updateNode('Task_1', {
      metadata: {
        ...controller.snapshot.nodes[0].metadata,
        cc: true
      }
    })
    expect(task.businessObject['orbitpm:kind']).toBe('cc')

    controller.updateNode('Task_1', {
      metadata: {
        ...controller.snapshot.nodes[0].metadata,
        cc: false
      }
    })
    expect(task.businessObject['orbitpm:kind']).toBeUndefined()
  })

  it('patches a rich FormalExpression in place and preserves it through undo/redo', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Gateway_1', 'bpmn:ExclusiveGateway', 'Decision')
    fixture.addNode('Task_1', 'bpmn:Task', 'Review')
    const flow = fixture.addFlow('Flow_1', 'Gateway_1', 'Task_1', {
      name: 'Original',
      condition: 'old = true'
    })
    const expression = {
      $type: 'bpmn:FormalExpression',
      id: 'Expression_1',
      body: 'old = true',
      language: 'FEEL',
      evaluatesToTypeRef: { $type: 'bpmn:ItemDefinition', id: 'BooleanType' },
      $attrs: { 'vendor:flag': 'keep', 'orbitpm:conditionAr': 'قديم' },
      extensionElements: { values: [{ $type: 'vendor:ExpressionData', value: 7 }] }
    }
    flow.businessObject.conditionExpression = expression
    const controller = createProcessOutlineController(fixture.modeler)

    controller.updateFlow('Flow_1', {
      sourceId: 'Gateway_1',
      targetId: 'Task_1',
      name: 'Updated',
      condition: 'approved = true',
      isDefault: false
    })

    expect(fixture.commandExecute).toHaveBeenCalledTimes(1)
    expect(flow.businessObject.conditionExpression).toBe(expression)
    expect(expression).toMatchObject({
      body: 'approved = true',
      language: 'FEEL',
      $attrs: { 'vendor:flag': 'keep', 'orbitpm:conditionAr': 'قديم' }
    })
    expect(expression.extensionElements.values[0]).toMatchObject({
      $type: 'vendor:ExpressionData',
      value: 7
    })

    fixture.undo()
    expect(flow.businessObject.name).toBe('Original')
    expect(flow.businessObject.conditionExpression).toBe(expression)
    expect(expression.body).toBe('old = true')

    fixture.redo()
    expect(flow.businessObject.name).toBe('Updated')
    expect(flow.businessObject.conditionExpression).toBe(expression)
    expect(expression.body).toBe('approved = true')
  })

  it('enforces legal condition/default sources and never writes a name onto an Association', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    fixture.addNode('Task_1', 'bpmn:Task', 'Task')
    fixture.addNode('Complex_1', 'bpmn:ComplexGateway', 'Complex')
    fixture.addNode('End_1', 'bpmn:EndEvent', 'End')
    const association = fixture.addFlow('Association_1', 'Task_1', 'End_1', {
      type: 'bpmn:Association'
    })
    const controller = createProcessOutlineController(fixture.modeler)

    expect(() =>
      controller.connectNodes({
        sourceId: 'Start_1',
        targetId: 'Task_1',
        condition: 'illegal'
      })
    ).toThrowError(
      expect.objectContaining<Partial<ProcessOutlineError>>({
        code: 'condition-flow-source-invalid'
      })
    )

    const activityDefault = controller.connectNodes({
      sourceId: 'Task_1',
      targetId: 'End_1',
      isDefault: true
    })
    expect(activityDefault.isDefault).toBe(true)
    const complexDefault = controller.connectNodes({
      sourceId: 'Complex_1',
      targetId: 'End_1',
      isDefault: true
    })
    expect(complexDefault.isDefault).toBe(true)

    const commandCount = fixture.commandExecute.mock.calls.length
    expect(() =>
      controller.updateFlow(association.id, {
        sourceId: 'Task_1',
        targetId: 'End_1',
        name: 'Invalid association label',
        condition: '',
        isDefault: false
      })
    ).toThrowError(
      expect.objectContaining<Partial<ProcessOutlineError>>({
        code: 'flow-edit-not-supported'
      })
    )
    expect(fixture.commandExecute).toHaveBeenCalledTimes(commandCount)
    expect(association.businessObject.name).toBeUndefined()
  })

  it('rolls back an add-and-connect action when connection creation fails', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    const controller = createProcessOutlineController(fixture.modeler)
    fixture.connect.mockReturnValueOnce(undefined)

    expect(() =>
      controller.addNode({
        type: 'bpmn:UserTask',
        name: 'Must not survive',
        documentation: 'Must not survive',
        metadata: {
          ...controller.snapshot.nodes[0].metadata,
          note: 'Must not survive',
          nameEn: 'Must not survive'
        },
        connectFromId: 'Start_1'
      })
    ).toThrowError(
      expect.objectContaining<Partial<ProcessOutlineError>>({
        code: 'connection-rejected'
      })
    )

    expect(fixture.commandExecute).toHaveBeenCalledTimes(1)
    expect(controller.refresh().nodes.map((node) => node.id)).toEqual(['Start_1'])
    expect(
      [...fixture.elements.values()].filter(
        (element) => element.type === 'bpmn:TextAnnotation' || element.type === 'bpmn:Association'
      )
    ).toHaveLength(0)
  })
})
