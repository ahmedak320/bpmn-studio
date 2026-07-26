import { describe, it, expect } from 'vitest'
import {
  ccEntryLacksPurpose,
  scanDiagramGaps,
  buildDiagramSummary,
  buildInterviewQuestionPrompt,
  parseInterviewQuestions,
  buildGenerationHistory,
  digestsToCatalog,
  readProcessId,
  decideInterviewNext,
  MAX_INTERVIEW_ROUNDS,
  MAX_QUESTIONS_PER_ROUND,
  type InterviewModeler,
  type GapScan
} from '../interview'
import type { ProcessDigest } from '../digest'

// --- fakes (plain-object modelers, orgModel.test style) ----------------------

interface FakeElement {
  id?: string
  type?: string
  businessObject?: Record<string, unknown>
  labelTarget?: unknown
  waypoints?: unknown
  source?: FakeElement | null
  target?: FakeElement | null
}

function makeModeler(elements: FakeElement[], root?: FakeElement): InterviewModeler {
  return {
    get(service: string): unknown {
      if (service === 'elementRegistry') return { getAll: () => elements }
      if (service === 'canvas') return { getRootElement: () => root }
      throw new Error('unexpected service ' + service)
    }
  }
}

const bo = (name: string, attrs: Record<string, string> = {}): Record<string, unknown> => ({
  name,
  $attrs: attrs
})

// A draft with the typical fresh-generation gaps:
//  start (no trigger) -> task Review (owner only) -> gateway Complete? (no basis)
//    --Yes--> task Notify (ccList with one purposeless recipient) -> end
//    --No --> (nothing — missing else branch, for the summary's flow view)
function draftElements(): FakeElement[] {
  const start: FakeElement = { id: 'Start_1', type: 'bpmn:StartEvent', businessObject: bo('استلام الطلب') }
  const review: FakeElement = {
    id: 'Task_review',
    type: 'bpmn:UserTask',
    businessObject: bo('مراجعة الطلب', { 'orbitpm:owner': 'HR Ops' })
  }
  const gw: FakeElement = { id: 'Gw_1', type: 'bpmn:ExclusiveGateway', businessObject: bo('مكتمل؟') }
  const notify: FakeElement = {
    id: 'Task_notify',
    type: 'bpmn:SendTask',
    businessObject: bo('إشعار المالية', {
      'orbitpm:owner': 'HR Ops',
      'orbitpm:inputs': 'Exit form',
      'orbitpm:outputs': 'Notification',
      'orbitpm:ccList': 'Finance — for payroll closure\nLegal'
    })
  }
  const end: FakeElement = { id: 'End_1', type: 'bpmn:EndEvent', businessObject: bo('تم') }
  const flows: FakeElement[] = [
    { id: 'F1', type: 'bpmn:SequenceFlow', waypoints: [], source: start, target: review, businessObject: bo('') },
    { id: 'F2', type: 'bpmn:SequenceFlow', waypoints: [], source: review, target: gw, businessObject: bo('') },
    { id: 'F3', type: 'bpmn:SequenceFlow', waypoints: [], source: gw, target: notify, businessObject: bo('نعم') },
    { id: 'F4', type: 'bpmn:SequenceFlow', waypoints: [], source: notify, target: end, businessObject: bo('') }
  ]
  const label: FakeElement = { id: 'Gw_1_label', type: 'bpmn:Label', labelTarget: gw, businessObject: gw.businessObject }
  return [start, review, gw, notify, end, ...flows, label]
}

// --- ccEntryLacksPurpose -----------------------------------------------------

describe('ccEntryLacksPurpose', () => {
  it('accepts "Name — purpose" (em-dash) and "Name - purpose" (hyphen)', () => {
    expect(ccEntryLacksPurpose('Finance — for payroll closure')).toBe(false)
    expect(ccEntryLacksPurpose('Legal - contract review')).toBe(false)
  })
  it('flags a bare recipient name', () => {
    expect(ccEntryLacksPurpose('Finance')).toBe(true)
    expect(ccEntryLacksPurpose('الإدارة المالية')).toBe(true)
  })
})

// --- scanDiagramGaps ---------------------------------------------------------

describe('scanDiagramGaps', () => {
  it('reports the completeness categories per element plus CC-purpose gaps', () => {
    const scan = scanDiagramGaps(makeModeler(draftElements()))
    expect(scan.clean).toBe(false)

    const byId = new Map(scan.entries.map((e) => [e.id, e]))
    expect(byId.get('Start_1')?.missing).toEqual(['trigger'])
    expect(byId.get('Task_review')?.missing).toEqual(['inputs', 'outputs'])
    expect(byId.get('Gw_1')?.missing).toEqual(['basis'])
    // Notify has owner/inputs/outputs — only the purposeless CC recipient is left.
    expect(byId.get('Task_notify')?.missing).toEqual([])
    expect(byId.get('Task_notify')?.ccMissingPurpose).toEqual(['Legal'])
    // End events are not badge-eligible and carry no CC — absent.
    expect(byId.has('End_1')).toBe(false)
  })

  it('skips labels and connections, and uses the id when a shape is unnamed', () => {
    const unnamed: FakeElement = { id: 'Task_x', type: 'bpmn:Task', businessObject: bo('') }
    const scan = scanDiagramGaps(makeModeler([unnamed]))
    expect(scan.entries).toHaveLength(1)
    expect(scan.entries[0].label).toBe('Task_x')
    expect(scan.entries[0].missing).toEqual(['owner', 'inputs', 'outputs'])
  })

  it('is clean when every element is complete', () => {
    const done: FakeElement = {
      id: 'Task_ok',
      type: 'bpmn:Task',
      businessObject: bo('Task OK', {
        'orbitpm:owner': 'Unit',
        'orbitpm:inputs': 'Form',
        'orbitpm:outputs': 'Memo',
        'orbitpm:ccList': 'Finance — records'
      })
    }
    const scan = scanDiagramGaps(makeModeler([done]))
    expect(scan.clean).toBe(true)
    expect(scan.entries).toEqual([])
  })
})

// --- buildDiagramSummary -----------------------------------------------------

describe('buildDiagramSummary', () => {
  const summary = buildDiagramSummary(makeModeler(draftElements()))

  it('lists elements with type, recorded fields and MISSING markers', () => {
    expect(summary).toContain('"مراجعة الطلب" [UserTask]')
    expect(summary).toContain('owner: HR Ops')
    expect(summary).toContain('MISSING: inputs; outputs')
    expect(summary).toContain('MISSING: decision basis')
    expect(summary).toContain('MISSING: trigger')
    expect(summary).toContain('CC purpose for: Legal')
  })

  it('resolves sequence-flow connectivity with branch conditions', () => {
    expect(summary).toContain('-> next: "مراجعة الطلب"')
    expect(summary).toContain('"إشعار المالية" (نعم)')
  })

  it('does not list flows or labels as elements', () => {
    expect(summary).not.toContain('[SequenceFlow]')
    expect(summary).not.toContain('[Label]')
  })
})

// --- buildInterviewQuestionPrompt -------------------------------------------

describe('buildInterviewQuestionPrompt', () => {
  const scan: GapScan = {
    clean: false,
    entries: [
      { id: 'T1', label: 'Review', type: 'bpmn:Task', missing: ['owner'], ccMissingPurpose: ['Legal'] }
    ]
  }

  it('carries description, summary, gaps, exchanges and the JSON contract', () => {
    const prompt = buildInterviewQuestionPrompt({
      description: 'Employee exit process',
      summary: '- "Review" [Task]',
      scan,
      exchanges: [{ questions: 'Who approves?', answer: 'The HR director' }],
      lang: 'en'
    })
    expect(prompt).toContain(`Ask AT MOST ${MAX_QUESTIONS_PER_ROUND} questions`)
    expect(prompt).toContain('Employee exit process')
    expect(prompt).toContain('- "Review" [Task]')
    expect(prompt).toContain('- "Review": responsible party (owner); CC purpose for: Legal')
    expect(prompt).toContain('Who approves?')
    expect(prompt).toContain('The HR director')
    expect(prompt).toContain('{"questions": ["question 1", "question 2"]}')
    expect(prompt).toContain('PROCESS-FLOW gaps')
    expect(prompt).toContain('Write each question in English')
  })

  it('asks in Arabic when the app language is Arabic', () => {
    const prompt = buildInterviewQuestionPrompt({
      description: 'd',
      summary: 's',
      scan,
      exchanges: [],
      lang: 'ar'
    })
    expect(prompt).toContain('Write each question in Arabic')
  })

  it('directs the model to the flow when the attribute scan is clean', () => {
    const prompt = buildInterviewQuestionPrompt({
      description: 'd',
      summary: 's',
      scan: { clean: true, entries: [] },
      exchanges: [],
      lang: 'en'
    })
    expect(prompt).toContain('none — the recorded details are complete')
    expect(prompt).toContain('{"questions": []}')
  })
})

// --- parseInterviewQuestions -------------------------------------------------

describe('parseInterviewQuestions', () => {
  it('parses the JSON contract and caps at the per-round max', () => {
    expect(parseInterviewQuestions('{"questions": ["Q1?", "Q2?"]}')).toEqual(['Q1?', 'Q2?'])
    expect(
      parseInterviewQuestions('{"questions": ["a?", "b?", "c?", "d?"]}')
    ).toHaveLength(MAX_QUESTIONS_PER_ROUND)
  })

  it('treats an empty questions array as a VALID "interview complete" verdict', () => {
    expect(parseInterviewQuestions('{"questions": []}')).toEqual([])
  })

  it('accepts fenced JSON and a renamed array key', () => {
    expect(parseInterviewQuestions('```json\n{"questions": ["من المسؤول؟"]}\n```')).toEqual([
      'من المسؤول؟'
    ])
    expect(parseInterviewQuestions('{"nextQuestions": ["Q?"]}')).toEqual(['Q?'])
  })

  it('falls back to plain lines with list markers stripped', () => {
    expect(parseInterviewQuestions('1. Who owns Review?\n- What inputs does it need?')).toEqual([
      'Who owns Review?',
      'What inputs does it need?'
    ])
  })

  it('returns null (failed round, NOT completion) for unusable output', () => {
    expect(parseInterviewQuestions('')).toBeNull()
    expect(parseInterviewQuestions('ok')).toBeNull()
    expect(parseInterviewQuestions('{"foo": 42}')).toBeNull()
  })
})

// --- generation history / catalog / process id -------------------------------

describe('buildGenerationHistory', () => {
  it('opens with the description then alternates questions/answers', () => {
    const history = buildGenerationHistory('Exit process', [
      { questions: 'Q1?\nQ2?', answer: 'A1' },
      { questions: 'Q3?', answer: 'A3' }
    ])
    expect(history).toEqual([
      { role: 'user', content: 'Exit process' },
      { role: 'assistant', content: 'Q1?\nQ2?' },
      { role: 'user', content: 'A1' },
      { role: 'assistant', content: 'Q3?' },
      { role: 'user', content: 'A3' }
    ])
  })

  it('substitutes a stub opening when the description is empty', () => {
    const history = buildGenerationHistory('   ', [])
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe('user')
    expect(history[0].content.length).toBeGreaterThan(0)
  })
})

describe('digestsToCatalog', () => {
  const digest = (processId: string, processName: string): ProcessDigest => ({
    relPath: `${processName}.bpmn`,
    folder: '',
    processId,
    processName,
    steps: [],
    notes: [],
    callsTo: []
  })

  it('maps digests to {id, name}, dropping empty ids and the interviewed process', () => {
    const catalog = digestsToCatalog(
      [digest('p1', 'One'), digest('', 'NoId'), digest('p2', 'Two')],
      'p2'
    )
    expect(catalog).toEqual([{ id: 'p1', name: 'One' }])
  })
})

describe('readProcessId', () => {
  it('reads the plain process root id', () => {
    const root: FakeElement = {
      id: 'Proc_1',
      businessObject: { $type: 'bpmn:Process', id: 'Proc_1' }
    }
    expect(readProcessId(makeModeler([], root))).toBe('Proc_1')
  })

  it('digs out the collaboration participant processRef id', () => {
    const root: FakeElement = {
      id: 'Collab_1',
      businessObject: {
        $type: 'bpmn:Collaboration',
        participants: [{ processRef: { $type: 'bpmn:Process', id: 'Proc_inner' } }]
      }
    }
    expect(readProcessId(makeModeler([], root))).toBe('Proc_inner')
  })

  it('returns "" without a root', () => {
    expect(readProcessId(makeModeler([]))).toBe('')
  })
})

// --- round / stop logic ------------------------------------------------------

describe('decideInterviewNext', () => {
  it('stops when the model has no questions left', () => {
    expect(decideInterviewNext(1, [])).toBe('done')
  })
  it('asks while questions remain within the round budget', () => {
    expect(decideInterviewNext(1, ['Q?'])).toBe('ask')
    expect(decideInterviewNext(MAX_INTERVIEW_ROUNDS, ['Q?'])).toBe('ask')
  })
  it('stops after the maximum number of rounds', () => {
    expect(decideInterviewNext(MAX_INTERVIEW_ROUNDS + 1, ['Q?'])).toBe('done')
  })
})
