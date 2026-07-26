import { describe, it, expect } from 'vitest'
import { formatLocalAnswer } from '../formatLocal'
import type { LocalAnswer } from '../answerLocal'
import type { ProcessDigest, DigestStep } from '../digest'

const step = (over: Partial<DigestStep>): DigestStep => ({
  id: 's',
  name: 'Review request',
  type: 'Task',
  nexts: [],
  ...over
})

const digest = (over: Partial<ProcessDigest>): ProcessDigest => ({
  relPath: 'HR/Purchase.bpmn',
  folder: 'HR',
  processId: 'Proc_1',
  processName: 'Purchase Approval',
  steps: [],
  notes: [],
  callsTo: [],
  ...over
})

describe('formatLocalAnswer', () => {
  it('renders a next-step answer with owner + condition bullets and a source', () => {
    const answer: LocalAnswer = {
      kind: 'next',
      process: digest({}),
      step: step({}),
      nexts: [
        { name: 'Approve payment', owner: 'Finance', condition: 'amount > 1000' },
        { name: 'Reject' }
      ]
    }
    const { text, sources } = formatLocalAnswer(answer)
    expect(text).toContain('Purchase Approval')
    expect(text).toContain('Review request')
    expect(text).toContain('• Approve payment — Finance (amount > 1000)')
    expect(text).toContain('• Reject')
    expect(sources).toEqual([{ processName: 'Purchase Approval', relPath: 'HR/Purchase.bpmn' }])
  })

  it('words an empty next list as process-complete', () => {
    const answer: LocalAnswer = {
      kind: 'next',
      process: digest({}),
      step: step({ name: 'Archive record', type: 'EndEvent' }),
      nexts: []
    }
    const { text } = formatLocalAnswer(answer)
    expect(text).toContain('Archive record')
    expect(text).toContain('Purchase Approval')
    // The complete phrasing, not the next-step phrasing.
    expect(text).not.toContain('•')
  })

  it('lists candidate processes with openable sources', () => {
    const answer: LocalAnswer = {
      kind: 'candidates',
      candidates: [
        { processName: 'Onboarding', relPath: 'HR/Onboarding.bpmn' },
        { processName: 'Offboarding', relPath: 'HR/Offboarding.bpmn' }
      ]
    }
    const { text, sources } = formatLocalAnswer(answer)
    expect(text).toContain('• Onboarding')
    expect(text).toContain('• Offboarding')
    expect(sources).toHaveLength(2)
    expect(sources[0]).toEqual({ processName: 'Onboarding', relPath: 'HR/Onboarding.bpmn' })
  })

  it('renders a none answer, with suggestions when present', () => {
    const withSuggestions: LocalAnswer = {
      kind: 'none',
      candidates: [{ processName: 'Procurement', relPath: 'Procurement.bpmn' }]
    }
    expect(formatLocalAnswer(withSuggestions).text).toContain('• Procurement')

    const bare: LocalAnswer = { kind: 'none', candidates: [] }
    const { text, sources } = formatLocalAnswer(bare)
    expect(text).not.toContain('•')
    expect(sources).toEqual([])
  })
})
