import { describe, it, expect } from 'vitest'
import type { ProcessDigest } from '../digest'
import {
  tokenize,
  normalizeToken,
  expandToken,
  rankDigests,
  selectContextDigests,
  digestToContext,
  buildContext,
  SMALL_WORKSPACE_ALL
} from '../retrieval'

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

describe('normalizeToken / expandToken (Arabic + light English)', () => {
  it('unifies hamza alefs, ى→ي, ة→ه and strips diacritics/tatweel', () => {
    expect(normalizeToken('إجازة')).toBe('اجازه')
    expect(normalizeToken('مُوَافَقَة')).toBe('موافقه')
    expect(normalizeToken('مستوى')).toBe('مستوي')
  })
  it('adds a definite-article-stripped variant while keeping the surface form', () => {
    expect(expandToken('الموافقة')).toContain('موافقه')
    expect(expandToken('الموافقة')).toContain('الموافقه')
    expect(expandToken('والطلب')).toContain('طلب')
  })
  it('adds an English singular variant for plural-s tokens', () => {
    expect(expandToken('forms')).toEqual(expect.arrayContaining(['forms', 'form']))
    // Short and -ss tokens are left alone.
    expect(expandToken('gas')).toEqual(['gas'])
    expect(expandToken('press')).toEqual(['press'])
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
  it('matches Arabic definite-article and orthography variants (الموافقة ↔ موافقة)', () => {
    const arabicDigest: ProcessDigest = {
      relPath: 'HR/Approve.bpmn',
      folder: 'HR',
      processId: 'p_ar',
      processName: 'اعتماد الطلبات',
      steps: [
        { id: 't', name: 'موافقة المدير', type: 'UserTask', nexts: [] }
      ],
      notes: [],
      callsTo: []
    }
    const ranked = rankDigests([procurementDigest, arabicDigest], 'ما بعد الموافقة؟')
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].digest.processId).toBe('p_ar')
  })
  it('matches English plural inflections (forms ↔ form)', () => {
    const ranked = rankDigests(all, 'leave forms')
    expect(ranked[0].digest.processName).toBe('Leave Request')
  })
  it('scores enriched org metadata (respList / inputs / ccList) in the meta band', () => {
    const enriched: ProcessDigest = {
      relPath: 'F/Payroll.bpmn',
      folder: 'F',
      processId: 'p_pay',
      processName: 'Payroll Run',
      owner: 'Finance Department',
      steps: [
        {
          id: 't',
          name: 'Close month',
          type: 'Task',
          respList: ['Huda Al Suwaidi — Approver'],
          inputs: ['Attendance sheet'],
          ccList: ['Audit Office — compliance'],
          nexts: []
        }
      ],
      notes: [],
      callsTo: []
    }
    expect(rankDigests([enriched], 'who is huda')[0]?.digest.processId).toBe('p_pay')
    expect(rankDigests([enriched], 'attendance sheet')[0]?.digest.processId).toBe('p_pay')
    expect(rankDigests([enriched], 'audit office')[0]?.digest.processId).toBe('p_pay')
  })
})

describe('selectContextDigests', () => {
  it('returns every digest for a small workspace, ranked matches first', () => {
    expect(all.length).toBeLessThanOrEqual(SMALL_WORKSPACE_ALL)
    const chosen = selectContextDigests(all, 'exit interview')
    expect(chosen).toHaveLength(all.length)
    expect(chosen[0].digest.processName).toBe('Employee Exit')
  })
  it('falls back to ALL digests (capped) when ranking finds nothing in a big workspace', () => {
    const many: ProcessDigest[] = []
    for (let i = 0; i < 8; i++) {
      many.push({
        relPath: `p${i}.bpmn`,
        folder: '',
        processId: `p${i}`,
        processName: `Process ${i}`,
        steps: [],
        notes: [],
        callsTo: []
      })
    }
    const chosen = selectContextDigests(many, 'زززز غير موجود')
    expect(chosen).toHaveLength(6)
    expect(chosen[0].digest.processId).toBe('p0')
  })
  it('keeps only the ranked matches in a big workspace when ranking succeeds', () => {
    const many: ProcessDigest[] = []
    for (let i = 0; i < 8; i++) {
      many.push({
        relPath: `p${i}.bpmn`,
        folder: '',
        processId: `p${i}`,
        processName: i === 5 ? 'Vendor Onboarding' : `Process ${i}`,
        steps: [],
        notes: [],
        callsTo: []
      })
    }
    const chosen = selectContextDigests(many, 'vendor onboarding')
    expect(chosen).toHaveLength(1)
    expect(chosen[0].digest.processId).toBe('p5')
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

  it('renders the enriched org metadata (responsible/inputs/outputs/systems/CC purposes/basis/process owner)', () => {
    const enriched: ProcessDigest = {
      relPath: 'HR/Leave.bpmn',
      folder: 'HR',
      processId: 'p',
      processName: 'Leave Request',
      owner: 'HR Department',
      steps: [
        {
          id: 't1',
          name: 'Review request',
          type: 'UserTask',
          owner: 'HR Ops',
          respList: ['Sara — Reviewer', 'Omar'],
          inputs: ['Leave form', 'Balance report'],
          outputs: ['Decision memo'],
          system: ['DMT HUB'],
          ccList: ['Finance — payroll hold', 'Legal'],
          nexts: [{ targetId: 'g1' }]
        },
        {
          id: 'g1',
          name: 'Approved?',
          type: 'ExclusiveGateway',
          decisionBasis: 'HR policy section 7',
          nexts: []
        }
      ],
      notes: [],
      callsTo: []
    }
    const text = digestToContext(enriched)
    expect(text).toContain('Process owner: HR Department')
    expect(text).toContain('— responsible: Sara — Reviewer; Omar')
    expect(text).toContain('— inputs: Leave form; Balance report')
    expect(text).toContain('— outputs: Decision memo')
    expect(text).toContain('— system: DMT HUB')
    expect(text).toContain('— CC: Finance — payroll hold, Legal')
    expect(text).toContain('— decision basis: HR policy section 7')
  })

  it('truncates on whole lines at maxChars with a +N marker', () => {
    const big: ProcessDigest = {
      relPath: 'big.bpmn',
      folder: '',
      processId: 'big',
      processName: 'Big Process',
      steps: Array.from({ length: 40 }, (_, i) => ({
        id: `t${i}`,
        name: `Step number ${i} with a reasonably long label`,
        type: 'Task',
        nexts: []
      })),
      notes: [],
      callsTo: []
    }
    const capped = digestToContext(big, 400)
    expect(capped.length).toBeLessThanOrEqual(400 + 40) // marker line may exceed slightly
    expect(capped).toMatch(/… \(\+\d+ more lines\)/)
    // Uncapped rendering has no marker.
    expect(digestToContext(big)).not.toContain('more lines')
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
