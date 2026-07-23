import { describe, it, expect } from 'vitest'
import type { ProcessDigest } from '../digest'
import { answerLocally } from '../answerLocal'

const exitDigest: ProcessDigest = {
  relPath: 'HR/Employee_Exit.bpmn',
  folder: 'HR',
  processId: 'Proc_exit',
  processName: 'Employee Exit',
  trigger: { type: 'dmthub', service: 'Exit Service' },
  steps: [
    { id: 'Start_1', name: 'Request received', type: 'StartEvent', nexts: [{ targetId: 'Task_A' }] },
    {
      id: 'Task_A',
      name: 'Conduct exit interview',
      type: 'Task',
      owner: 'HR Ops',
      ownerRole: 'R',
      channel: 'dmthub',
      nexts: [{ targetId: 'Gw_1' }]
    },
    {
      id: 'Gw_1',
      name: 'Approved?',
      type: 'ExclusiveGateway',
      nexts: [
        { targetId: 'Task_B', condition: 'Yes' },
        { targetId: 'Call_1', condition: 'No' }
      ]
    },
    { id: 'Task_B', name: 'Notify finance', type: 'Task', kind: 'cc', ccTo: 'Finance', owner: 'AP Clerk', nexts: [{ targetId: 'End_1' }] },
    {
      id: 'Call_1',
      name: 'Return assets',
      type: 'CallActivity',
      calledProcess: 'proc_return_assets',
      nexts: [{ targetId: 'End_1' }]
    },
    { id: 'End_1', name: 'Done', type: 'EndEvent', nexts: [] }
  ],
  notes: ['Exit must complete within 30 days'],
  callsTo: ['proc_return_assets']
}

const procurementDigest: ProcessDigest = {
  relPath: 'Finance/Procurement.bpmn',
  folder: 'Finance',
  processId: 'Proc_procure',
  processName: 'Procurement Request',
  steps: [
    { id: 's', name: 'Start', type: 'StartEvent', nexts: [{ targetId: 't1' }] },
    { id: 't1', name: 'Raise purchase order', type: 'Task', owner: 'Buyer', nexts: [{ targetId: 'e' }] },
    { id: 'e', name: 'End', type: 'EndEvent', nexts: [] }
  ],
  notes: [],
  callsTo: []
}

const all = [exitDigest, procurementDigest]

describe('answerLocally — confident next-step', () => {
  it('names a step and resolves its next (the gateway)', () => {
    const a = answerLocally(all, 'conduct exit interview')
    expect(a.kind).toBe('next')
    expect(a.step?.id).toBe('Task_A')
    expect(a.process?.processName).toBe('Employee Exit')
    expect(a.nexts).toEqual([{ name: 'Approved?' }])
  })

  it('surfaces branch condition strings when the matched step is a gateway', () => {
    const a = answerLocally(all, 'approved')
    expect(a.kind).toBe('next')
    expect(a.step?.id).toBe('Gw_1')
    expect(a.nexts).toEqual([
      { name: 'Notify finance', owner: 'AP Clerk', condition: 'Yes' },
      { name: 'Return assets', condition: 'No' }
    ])
  })

  it('reports an empty next list at an end event (process complete)', () => {
    const a = answerLocally(all, 'done')
    expect(a.kind).toBe('next')
    expect(a.step?.id).toBe('End_1')
    expect(a.nexts).toEqual([])
  })
})

describe('answerLocally — ambiguity across processes', () => {
  const onboarding: ProcessDigest = {
    relPath: 'HR/Onboarding.bpmn',
    folder: 'HR',
    processId: 'p_on',
    processName: 'Onboarding',
    steps: [
      { id: 's', name: 'Start', type: 'StartEvent', nexts: [{ targetId: 't' }] },
      { id: 't', name: 'Order laptop', type: 'Task', owner: 'IT', nexts: [{ targetId: 'e' }] },
      { id: 'e', name: 'End', type: 'EndEvent', nexts: [] }
    ],
    notes: [],
    callsTo: []
  }
  const offboarding: ProcessDigest = {
    relPath: 'HR/Offboarding.bpmn',
    folder: 'HR',
    processId: 'p_off',
    processName: 'Offboarding',
    steps: [
      { id: 's', name: 'Start', type: 'StartEvent', nexts: [{ targetId: 't' }] },
      { id: 't', name: 'Order badge return', type: 'Task', owner: 'Security', nexts: [{ targetId: 'e' }] },
      { id: 'e', name: 'End', type: 'EndEvent', nexts: [] }
    ],
    notes: [],
    callsTo: []
  }

  it('returns candidate processes when close matches span different processes', () => {
    const a = answerLocally([onboarding, offboarding], 'order')
    expect(a.kind).toBe('candidates')
    const names = (a.candidates ?? []).map((c) => c.processName).sort()
    expect(names).toEqual(['Offboarding', 'Onboarding'])
  })
})

describe('answerLocally — no match', () => {
  it('returns none with retrieval suggestions when only a process name matches', () => {
    const a = answerLocally(all, 'employee handbook')
    expect(a.kind).toBe('none')
    expect((a.candidates ?? []).map((c) => c.processName)).toContain('Employee Exit')
  })

  it('returns none (empty candidates ok) for a query that matches nothing', () => {
    const a = answerLocally(all, 'zzzz qqqq')
    expect(a.kind).toBe('none')
    expect(Array.isArray(a.candidates)).toBe(true)
  })
})
