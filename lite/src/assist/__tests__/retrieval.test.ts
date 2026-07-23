import { describe, it, expect } from 'vitest'
import type { ProcessDigest } from '../digest'
import { tokenize, rankDigests, digestToContext, buildContext } from '../retrieval'

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
    { id: 'Task_B', name: 'Notify finance', type: 'Task', kind: 'cc', ccTo: 'Finance', nexts: [{ targetId: 'End_1' }] },
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
  trigger: { type: 'email', service: 'Vendor Desk' },
  steps: [
    { id: 's', name: 'Start', type: 'StartEvent', nexts: [{ targetId: 't1' }] },
    { id: 't1', name: 'Raise purchase order', type: 'Task', owner: 'Buyer', nexts: [{ targetId: 't2' }] },
    { id: 't2', name: 'Approve budget', type: 'Task', owner: 'Finance Lead', nexts: [{ targetId: 'e' }] },
    { id: 'e', name: 'End', type: 'EndEvent', nexts: [] }
  ],
  notes: ['Orders above 50k need CFO sign-off'],
  callsTo: []
}

const leaveDigest: ProcessDigest = {
  relPath: 'HR/Leave.bpmn',
  folder: 'HR',
  processId: 'Proc_leave',
  processName: 'Leave Request',
  steps: [
    { id: 's', name: 'Start', type: 'StartEvent', nexts: [{ targetId: 't1' }] },
    { id: 't1', name: 'Submit leave form', type: 'UserTask', owner: 'Employee', nexts: [{ targetId: 't2' }] },
    { id: 't2', name: 'Manager approval', type: 'UserTask', owner: 'Manager', nexts: [{ targetId: 'e' }] },
    { id: 'e', name: 'End', type: 'EndEvent', nexts: [] }
  ],
  notes: [],
  callsTo: []
}

const all = [procurementDigest, leaveDigest, exitDigest]

describe('tokenize', () => {
  it('lowercases, splits on punctuation, and drops sub-2-char tokens', () => {
    expect(tokenize('Conduct exit-interview! (a)')).toEqual(['conduct', 'exit', 'interview'])
  })
  it('keeps Arabic letters as tokens', () => {
    expect(tokenize('طلب إجازة')).toEqual(['طلب', 'إجازة'])
  })
})

describe('rankDigests', () => {
  it('ranks the matching process first among several', () => {
    const ranked = rankDigests(all, 'exit interview next')
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].digest.processName).toBe('Employee Exit')
  })
  it('returns nothing for a query that shares no tokens', () => {
    expect(rankDigests(all, 'zzzz qqqq')).toEqual([])
  })
})

describe('digestToContext', () => {
  const ctx = digestToContext(exitDigest)
  it('renders a header, trigger, and numbered steps with short types', () => {
    expect(ctx).toContain('## Employee Exit (HR/Employee_Exit.bpmn)')
    expect(ctx).toContain('Trigger: dmthub — service: Exit Service')
    expect(ctx).toContain('1. Request received [start]')
    expect(ctx).toContain('[gateway]')
  })
  it('renders owner, channel, CC and next suffixes with resolved names + conditions', () => {
    expect(ctx).toContain('— owner: HR Ops (R)')
    expect(ctx).toContain('via DMT Hub')
    expect(ctx).toContain('— CC: Finance')
    expect(ctx).toContain('-> next: Notify finance (Yes) | Return assets (No)')
  })
  it('renders called processes and the notes block', () => {
    expect(ctx).toContain('Calls process: proc_return_assets')
    expect(ctx).toContain('Notes:')
    expect(ctx).toContain('- Exit must complete within 30 days')
  })
})

describe('buildContext', () => {
  it('concatenates digests in rank order within the budget', () => {
    const ranked = [
      { digest: exitDigest, score: 7 },
      { digest: procurementDigest, score: 1 },
      { digest: leaveDigest, score: 1 }
    ]
    const full = buildContext(ranked, 12000)
    expect((full.match(/## /g) ?? []).length).toBe(3)
  })
  it('respects a small budget, truncating to one digest (but always at least one)', () => {
    const ranked = [
      { digest: exitDigest, score: 7 },
      { digest: procurementDigest, score: 1 },
      { digest: leaveDigest, score: 1 }
    ]
    const small = buildContext(ranked, 300)
    expect((small.match(/## /g) ?? []).length).toBe(1)
    expect(small).toContain('Employee Exit')
  })
})
