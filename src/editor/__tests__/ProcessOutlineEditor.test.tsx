// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessOutlineEditor } from '../ProcessOutlineEditor'
import { AR_PROCESS_OUTLINE_MESSAGES, EN_PROCESS_OUTLINE_MESSAGES } from '../processOutlineMessages'
import { createOutlineTestModeler } from './outlineTestModeler'

const outlineStyles = readFileSync(resolve('src/editor/ProcessOutlineEditor.css'), 'utf8')

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    callback(0)
    return 1
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProcessOutlineEditor accessibility and authoring', () => {
  it('exposes the optional process-details integration callback', async () => {
    const fixture = createOutlineTestModeler()
    const onOpenProcessDetails = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <ProcessOutlineEditor modeler={fixture.modeler} messages={EN_PROCESS_OUTLINE_MESSAGES} />
    )

    expect(screen.queryByRole('button', { name: 'Edit process details' })).toBeNull()
    rerender(
      <ProcessOutlineEditor
        modeler={fixture.modeler}
        messages={EN_PROCESS_OUTLINE_MESSAGES}
        onOpenProcessDetails={onOpenProcessDetails}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Edit process details' }))
    expect(onOpenProcessDetails).toHaveBeenCalledOnce()
  })

  it('uses roving keyboard focus and synchronizes selection in both directions', async () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    fixture.addNode('Task_A', 'bpmn:Task', 'Review')
    fixture.addNode('Task_B', 'bpmn:UserTask', 'Approve')
    fixture.addNode('End_1', 'bpmn:EndEvent', 'Done')
    fixture.addFlow('Flow_start', 'Start_1', 'Task_A')
    fixture.addFlow('Flow_between', 'Task_A', 'Task_B')
    fixture.addFlow('Flow_end', 'Task_B', 'End_1')
    const user = userEvent.setup()

    render(
      <ProcessOutlineEditor modeler={fixture.modeler} messages={EN_PROCESS_OUTLINE_MESSAGES} />
    )

    const treeItems = screen.getAllByRole('treeitem')
    expect(treeItems).toHaveLength(7)
    expect(treeItems.filter((item) => item.tabIndex === 0)).toHaveLength(1)

    treeItems[0].focus()
    const expectedKeyboardOrder = [
      'Start_1',
      'Flow_start',
      'Task_A',
      'Flow_between',
      'Task_B',
      'Flow_end',
      'End_1'
    ]
    for (const [index, expectedId] of expectedKeyboardOrder.entries()) {
      expect(document.activeElement?.getAttribute('data-outline-id')).toBe(expectedId)
      await user.keyboard(index % 2 === 0 ? '{Enter}' : ' ')
      expect(fixture.selected[0]?.id).toBe(expectedId)
      if (index < expectedKeyboardOrder.length - 1) await user.keyboard('{ArrowDown}')
    }

    await user.keyboard('{End}')
    expect(document.activeElement?.getAttribute('data-outline-id')).toBe('End_1')
    await user.keyboard('{Home}')
    expect(document.activeElement?.getAttribute('data-outline-id')).toBe('Start_1')

    const task = screen.getByRole('treeitem', { name: 'Task: Review' })
    task.focus()
    await user.keyboard('{Enter}')
    expect(fixture.selected[0]?.id).toBe('Task_A')
    expect(fixture.scrollToElement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'Task_A' }),
      120
    )

    const externallySelected = fixture.elements.get('Task_B')
    if (!externallySelected) throw new Error('test fixture missing Task_B')
    act(() => {
      fixture.selected.splice(0, fixture.selected.length, externallySelected)
      fixture.emit('selection.changed')
    })
    await waitFor(() =>
      expect(
        screen.getByRole('treeitem', { name: 'User task: Approve' }).getAttribute('aria-selected')
      ).toBe('true')
    )
    expect(screen.getByRole('status').textContent).toContain('Task_B selected on the canvas.')
  })

  it('adds and edits metadata, then creates conditioned and default gateway flows', async () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    fixture.addNode('Gateway_1', 'bpmn:ExclusiveGateway', 'Decision')
    fixture.addNode('Task_yes', 'bpmn:Task', 'Approve')
    fixture.addNode('Task_no', 'bpmn:Task', 'Reject')
    const user = userEvent.setup()

    render(
      <ProcessOutlineEditor modeler={fixture.modeler} messages={EN_PROCESS_OUTLINE_MESSAGES} />
    )

    const addForm = screen.getByRole('heading', { name: 'Add node' }).closest('form')
    if (!addForm) throw new Error('add form missing')
    const nodeType = within(addForm).getByLabelText('Node type')
    for (const supportedType of [
      'bpmn:Transaction',
      'bpmn:AdHocSubProcess',
      'bpmn:ComplexGateway',
      'bpmn:EventBasedGateway'
    ]) {
      expect(
        within(nodeType).getByRole('option', {
          name: EN_PROCESS_OUTLINE_MESSAGES.nodeType(supportedType)
        })
      ).toHaveProperty('value', supportedType)
    }
    await user.selectOptions(nodeType, 'bpmn:UserTask')
    await user.type(within(addForm).getByLabelText('Node label'), 'Review request')
    await user.selectOptions(within(addForm).getByLabelText('Connect after'), 'Start_1')
    await user.click(within(addForm).getByRole('button', { name: 'Add node' }))

    const added = screen.getByRole('treeitem', { name: 'User task: Review request' })
    expect(added.getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Edit selected item' }))
    const nameEn = screen.getByLabelText('Name (English)')
    expect(document.activeElement).toBe(nameEn)
    await user.clear(nameEn)
    await user.type(nameEn, 'Approve request')
    await user.type(screen.getByLabelText('Name (Arabic)'), 'اعتماد الطلب')
    await user.type(screen.getByLabelText('Owner name'), 'Operations')
    await user.selectOptions(screen.getByLabelText('Owner type'), 'department')
    await user.selectOptions(screen.getByLabelText('RACI role'), 'A')
    await user.type(screen.getByLabelText('Responsible people'), 'Sara — Approver')
    await user.type(screen.getByLabelText('Linked step note'), 'Escalate incomplete requests.')
    await user.type(screen.getByLabelText('Inputs / base information'), 'Application')
    await user.type(screen.getByLabelText('Outputs'), 'Decision')
    await user.type(screen.getByLabelText('Supporting system'), 'Workflow')
    await user.type(screen.getByLabelText('CC (informed parties)'), 'Quality')
    expect(screen.queryByLabelText('Decision basis')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Channel'), 'email')
    await user.type(screen.getByLabelText('Channel detail'), 'approvals@example.test')
    await user.click(screen.getByLabelText('Mark this step as CC'))
    await user.type(screen.getByLabelText('CC recipients'), 'Audit')
    expect(screen.queryByText('Trigger type')).toBeNull()
    await user.type(screen.getByLabelText('Documentation'), 'Check all required fields.')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const createdNode = [...fixture.elements.values()].find((element) =>
      element.id.startsWith('UserTask_')
    )
    expect(createdNode?.businessObject.name).toBe('Approve request')
    expect(createdNode?.businessObject.documentation?.[0]?.text).toBe('Check all required fields.')
    expect(createdNode?.businessObject['orbitpm:nameEn']).toBe('Approve request')
    expect(createdNode?.businessObject['orbitpm:nameAr']).toBe('اعتماد الطلب')
    expect(createdNode?.businessObject['orbitpm:owner']).toBe('Operations')
    expect(createdNode?.businessObject['orbitpm:ownerType']).toBe('department')
    expect(createdNode?.businessObject['orbitpm:ownerRole']).toBe('A')
    expect(createdNode?.businessObject['orbitpm:channel']).toBe('email')
    expect(createdNode?.businessObject['orbitpm:channelDetail']).toBe('approvals@example.test')
    expect(createdNode?.businessObject['orbitpm:kind']).toBe('cc')
    expect(createdNode?.businessObject['orbitpm:ccTo']).toBe('Audit')
    expect(createdNode?.businessObject['orbitpm:inputs']).toBe('Application')
    expect(createdNode?.businessObject['orbitpm:outputs']).toBe('Decision')
    expect(createdNode?.businessObject['orbitpm:system']).toBe('Workflow')
    expect(createdNode?.businessObject['orbitpm:respList']).toBe('Sara — Approver')
    expect(createdNode?.businessObject['orbitpm:ccList']).toBe('Quality')
    expect(
      [...fixture.elements.values()].some(
        (element) =>
          element.type === 'bpmn:SequenceFlow' &&
          element.source?.id === 'Start_1' &&
          element.target?.id === createdNode?.id
      )
    ).toBe(true)
    expect(
      [...fixture.elements.values()].some(
        (element) =>
          element.type === 'bpmn:TextAnnotation' &&
          element.businessObject.text === 'Escalate incomplete requests.'
      )
    ).toBe(true)

    await user.click(screen.getByRole('treeitem', { name: 'Start event: Start' }))
    await user.click(screen.getByRole('button', { name: 'Edit selected item' }))
    expect(screen.queryByLabelText('Channel')).toBeNull()
    expect(screen.queryByLabelText('Mark this step as CC')).toBeNull()
    expect(screen.queryByLabelText('Decision basis')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add trigger' }))
    await user.selectOptions(screen.getByLabelText('Trigger type 1'), 'dmthub')
    const startSave = screen.getByRole('button', { name: 'Save changes' })
    expect((startSave as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('A DMT Hub service name is required.')
    await user.type(screen.getByLabelText('DMT Hub service'), 'intake-service')
    await user.type(screen.getByLabelText('Trigger detail'), 'New application')
    expect((startSave as HTMLButtonElement).disabled).toBe(false)
    await user.click(startSave)
    expect(fixture.elements.get('Start_1')?.businessObject['orbitpm:trigger']).toBe('dmthub')
    expect(fixture.elements.get('Start_1')?.businessObject['orbitpm:triggerService']).toBe(
      'intake-service'
    )
    expect(fixture.elements.get('Start_1')?.businessObject['orbitpm:triggerDetail']).toBe(
      'New application'
    )

    await user.click(screen.getByRole('treeitem', { name: 'Exclusive gateway: Decision' }))
    await user.click(screen.getByRole('button', { name: 'Edit selected item' }))
    expect(screen.getByLabelText('Decision basis')).not.toBeNull()
    expect(screen.queryByLabelText('Channel')).toBeNull()
    expect(screen.queryByLabelText('Mark this step as CC')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add trigger' })).toBeNull()
    await user.type(screen.getByLabelText('Decision basis'), 'Policy 42')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(fixture.elements.get('Gateway_1')?.businessObject['orbitpm:decisionBasis']).toBe(
      'Policy 42'
    )

    const connectForm = screen.getByRole('heading', { name: 'Connect nodes' }).closest('form')
    if (!connectForm) throw new Error('connect form missing')
    const source = within(connectForm).getByLabelText('Source node')
    const target = within(connectForm).getByLabelText('Target node')
    expect(within(connectForm).queryByLabelText('Set as the source node’s default flow')).toBeNull()
    await user.selectOptions(source, 'Gateway_1')
    expect(
      within(connectForm).getByLabelText('Set as the source node’s default flow')
    ).not.toBeNull()
    await user.selectOptions(target, 'Task_yes')
    await user.type(within(connectForm).getByLabelText('Condition'), 'approved = true')
    await user.click(within(connectForm).getByRole('button', { name: 'Connect nodes' }))

    await user.selectOptions(source, 'Gateway_1')
    await user.selectOptions(target, 'Task_no')
    await user.click(within(connectForm).getByLabelText('Set as the source node’s default flow'))
    await user.click(within(connectForm).getByRole('button', { name: 'Connect nodes' }))

    const gatewayFlows = [...fixture.elements.values()].filter(
      (element) => element.type === 'bpmn:SequenceFlow' && element.source?.id === 'Gateway_1'
    )
    expect(gatewayFlows).toHaveLength(2)
    expect(
      gatewayFlows.find((flow) => flow.target?.id === 'Task_yes')?.businessObject
        .conditionExpression?.body
    ).toBe('approved = true')
    expect(fixture.elements.get('Gateway_1')?.businessObject.default?.id).toBe(
      gatewayFlows.find((flow) => flow.target?.id === 'Task_no')?.id
    )
    expect(screen.queryByText('outline.gateway-condition-missing')).toBeNull()
  }, 10_000)

  it('supports keyboard reorder/delete confirmation and exposes validation findings', async () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Start_1', 'bpmn:StartEvent', 'Start')
    fixture.addNode('Task_A', 'bpmn:Task', 'First')
    fixture.addNode('Task_B', 'bpmn:Task', 'Second')
    fixture.addNode('End_1', 'bpmn:EndEvent', 'End')
    fixture.addNode('Gateway_bad', 'bpmn:ExclusiveGateway', 'Unreviewed branch')
    fixture.addNode('Task_left', 'bpmn:Task', 'Left')
    fixture.addNode('Task_right', 'bpmn:Task', 'Right')
    fixture.addFlow('Flow_start', 'Start_1', 'Task_A')
    fixture.addFlow('Flow_between', 'Task_A', 'Task_B')
    fixture.addFlow('Flow_end', 'Task_B', 'End_1')
    fixture.addFlow('Flow_left', 'Gateway_bad', 'Task_left')
    fixture.addFlow('Flow_right', 'Gateway_bad', 'Task_right')
    const confirmDelete = vi
      .fn<(item: { id: string }) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const user = userEvent.setup()

    render(
      <ProcessOutlineEditor
        modeler={fixture.modeler}
        messages={EN_PROCESS_OUTLINE_MESSAGES}
        confirmDelete={confirmDelete}
      />
    )

    expect(screen.getAllByText('outline.gateway-condition-missing')).toHaveLength(2)

    let second = screen.getByRole('treeitem', { name: 'Task: Second' })
    second.focus()
    await user.keyboard('{Control>}{ArrowUp}{/Control}')
    expect(fixture.elements.get('Flow_start')?.target?.id).toBe('Task_B')
    expect(fixture.elements.get('Flow_between')?.source?.id).toBe('Task_B')
    expect(fixture.elements.get('Flow_between')?.target?.id).toBe('Task_A')
    expect(fixture.elements.get('Flow_end')?.source?.id).toBe('Task_A')

    second = screen.getByRole('treeitem', { name: 'Task: Second' })
    second.focus()
    await user.keyboard('{Delete}')
    await waitFor(() => expect(confirmDelete).toHaveBeenCalledTimes(1))
    expect(fixture.elements.has('Task_B')).toBe(true)

    second.focus()
    await user.keyboard('{Delete}')
    await waitFor(() => expect(fixture.elements.has('Task_B')).toBe(false))
    expect(confirmDelete).toHaveBeenCalledTimes(2)
    expect(fixture.elements.has('Flow_start')).toBe(false)
    expect(fixture.elements.has('Flow_between')).toBe(false)
  })

  it('limits non-sequence connections to label editing and restores tree focus', async () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Task_A', 'bpmn:Task', 'Sender')
    fixture.addNode('Task_B', 'bpmn:Task', 'Receiver')
    fixture.addFlow('Message_1', 'Task_A', 'Task_B', {
      type: 'bpmn:MessageFlow',
      name: 'Request'
    })
    fixture.addFlow('Association_1', 'Task_A', 'Task_B', {
      type: 'bpmn:Association'
    })
    const user = userEvent.setup()

    render(
      <ProcessOutlineEditor modeler={fixture.modeler} messages={EN_PROCESS_OUTLINE_MESSAGES} />
    )

    const messageRow = screen.getByRole('treeitem', {
      name: 'Flow Request from Task_A to Task_B'
    })
    const associationRow = screen.getByRole('treeitem', {
      name: 'Flow Association_1 from Task_A to Task_B'
    })
    await user.click(messageRow)
    await user.click(screen.getByRole('button', { name: 'Edit selected item' }))
    const nameInput = screen.getByLabelText('Name or label')
    const editForm = nameInput.closest('form')
    if (!editForm) throw new Error('edit form missing')
    expect(within(editForm).queryByLabelText('Source node')).toBeNull()
    expect(within(editForm).queryByLabelText('Target node')).toBeNull()
    expect(within(editForm).queryByLabelText('Condition')).toBeNull()
    expect(within(editForm).queryByLabelText('Set as the source node’s default flow')).toBeNull()

    await user.clear(nameInput)
    await user.type(nameInput, 'Response')
    await user.click(within(editForm).getByRole('button', { name: 'Save changes' }))
    expect(fixture.elements.get('Message_1')?.businessObject.name).toBe('Response')
    expect(document.activeElement).toBe(messageRow)

    await user.click(screen.getByRole('button', { name: 'Edit selected item' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(messageRow)

    await user.click(associationRow)
    expect(fixture.selected[0]?.id).toBe('Association_1')
    expect(screen.queryByRole('button', { name: 'Edit selected item' })).toBeNull()
    associationRow.focus()
    await user.keyboard('{F2}')
    expect(screen.queryByLabelText('Name or label')).toBeNull()
  })

  it('discards an item draft when canvas selection changes instead of applying it elsewhere', async () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Task_A', 'bpmn:Task', 'Alpha')
    fixture.addNode('Task_B', 'bpmn:Task', 'Beta')
    const user = userEvent.setup()

    render(
      <ProcessOutlineEditor modeler={fixture.modeler} messages={EN_PROCESS_OUTLINE_MESSAGES} />
    )

    await user.click(screen.getByRole('treeitem', { name: 'Task: Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Edit selected item' }))
    const draftName = screen.getByLabelText('Name (English)')
    await user.clear(draftName)
    await user.type(draftName, 'Stale Alpha draft')

    const beta = fixture.elements.get('Task_B')
    if (!beta) throw new Error('test fixture missing Task_B')
    act(() => {
      fixture.selected.splice(0, fixture.selected.length, beta)
      fixture.emit('selection.changed')
    })

    await waitFor(() => expect(screen.queryByLabelText('Name (English)')).toBeNull())
    expect(fixture.elements.get('Task_A')?.businessObject.name).toBe('Alpha')
    expect(fixture.elements.get('Task_B')?.businessObject.name).toBe('Beta')

    await user.click(screen.getByRole('button', { name: 'Edit selected item' }))
    expect((screen.getByLabelText('Name (English)') as HTMLInputElement).value).toBe('Beta')
  })

  it('locale-formats outline counts and keeps checkbox targets at least 24 pixels', () => {
    const fixture = createOutlineTestModeler()
    fixture.addNode('Task_A', 'bpmn:Task', 'ألف')
    fixture.addNode('Task_B', 'bpmn:Task', 'باء')

    render(
      <ProcessOutlineEditor
        modeler={fixture.modeler}
        messages={AR_PROCESS_OUTLINE_MESSAGES}
        direction="rtl"
      />
    )

    expect(screen.getByText('٠ أخطاء، ٢ تحذيرات')).not.toBeNull()
    expect(screen.getAllByText('١')).toHaveLength(2)
    expect(screen.getAllByLabelText('٠ أخطاء، ١ تحذيرات')).toHaveLength(2)
    expect(outlineStyles).toMatch(
      /\.orbitpm-process-outline__checkbox\s*\{[^}]*min-block-size:\s*2\.75rem/s
    )
    expect(outlineStyles).toMatch(
      /\.orbitpm-process-outline__checkbox input\s*\{[^}]*inline-size:\s*1\.5rem;[^}]*min-block-size:\s*1\.5rem/s
    )
  })

  it('uses the theme primary contrast pair for outline action buttons', () => {
    expect(outlineStyles).toMatch(/--outline-action-bg:\s*var\(--orbitpm-primary-bg,\s*#2563eb\)/)
    expect(outlineStyles).toMatch(/--outline-action-fg:\s*var\(--orbitpm-primary-fg,\s*#ffffff\)/)
    expect(outlineStyles).toMatch(
      /--outline-danger:\s*var\(--orbitpm-editor-danger,\s*var\(--orbitpm-danger,\s*#b42318\)\)/
    )
    expect(outlineStyles).toMatch(
      /\.orbitpm-process-outline__actions > button:not\(\.orbitpm-process-outline__danger\)\s*\{[^}]*border-color:\s*var\(--outline-action-bg\);[^}]*color:\s*var\(--outline-action-fg\);[^}]*background:\s*var\(--outline-action-bg\)/s
    )
  })
})
