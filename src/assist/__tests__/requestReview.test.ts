import { describe, expect, it } from 'vitest'
import type { ProcessDigest } from '../digest'
import {
  assertLlmMessagesMatchDisclosure,
  buildReviewedLibraryRequest,
  createLlmMessageDisclosure,
  inspectOutboundSensitivity,
  redactAssistantDigests,
  redactPersonNames
} from '../requestReview'

const digest: ProcessDigest = {
  relPath: 'HR/Private employee exit.bpmn',
  folder: 'HR',
  processId: 'Process_Exit',
  processName: 'Employee exit for Alice',
  owner: 'Alice Example',
  trigger: {
    type: 'Oscar message',
    service: 'Zuleika Delivery',
    detail: 'alice@example.test'
  },
  steps: [
    {
      id: 'Task_Notify',
      name: 'Notify Alice and Payroll',
      type: 'Task',
      owner: 'Bob Manager',
      ownerRole: 'Manager',
      respList: ['Alice — employee'],
      ccList: ['Payroll — final settlement'],
      system: ['Private HR'],
      inputs: ['Carol personnel file'],
      outputs: ['Diana exit checklist'],
      decisionBasis: 'Grace approved Alice',
      nexts: [{ targetId: 'End_1', condition: 'Alice notified' }]
    },
    {
      id: 'End_1',
      name: 'Alice offboarded',
      type: 'EndEvent',
      nexts: []
    }
  ],
  notes: ['Call Alice on her private number'],
  callsTo: []
}

describe('assistant external-request review', () => {
  it('redacts names and free-text metadata while preserving stable topology', () => {
    const [redacted] = redactAssistantDigests([{ digest, score: 12 }])
    expect(redacted.score).toBe(12)
    expect(redacted.digest.processId).toBe('Process_Exit')
    expect(redacted.digest.processName).toBe('Process 1')
    expect(redacted.digest.relPath).toBe('Process_Exit.bpmn')
    expect(redacted.digest.owner).toBeUndefined()
    expect(redacted.digest.notes).toEqual([])
    expect(redacted.digest.steps.map((step) => step.name)).toEqual(['Step 1', 'Step 2'])
    expect(redacted.digest.steps[0].nexts).toEqual([
      { targetId: 'End_1', condition: '[redacted condition]' }
    ])
    expect(JSON.stringify(redacted)).not.toContain('Alice')
    expect(JSON.stringify(redacted)).not.toContain('Bob')
    expect(JSON.stringify(redacted)).not.toContain('Payroll')
    expect(JSON.stringify(redacted)).not.toContain('Carol')
    expect(JSON.stringify(redacted)).not.toContain('Diana')
    expect(JSON.stringify(redacted)).not.toContain('Zuleika')
    expect(JSON.stringify(redacted)).not.toContain('Grace')
    expect(JSON.stringify(redacted)).not.toContain('Oscar')
  })

  it('shows the exact final prompt and changes the consent fingerprint with privacy controls', () => {
    const base = {
      providerId: 'openrouter',
      modelId: 'anthropic/claude-sonnet-5',
      question: 'What happens next?',
      history: [{ role: 'assistant' as const, content: 'Earlier answer' }],
      rankedDigests: [{ digest, score: 12 }],
      lang: 'en' as const
    }
    const excluded = buildReviewedLibraryRequest({
      ...base,
      includeWorkspaceContext: false,
      redactNames: true
    })
    const redacted = buildReviewedLibraryRequest({
      ...base,
      includeWorkspaceContext: true,
      redactNames: true
    })
    const raw = buildReviewedLibraryRequest({
      ...base,
      includeWorkspaceContext: true,
      redactNames: false
    })

    expect(excluded.disclosure.outbound.map((item) => item.text)).toEqual(
      excluded.messages.map((message) => message.content)
    )
    expect(excluded.messages.at(-1)?.content).not.toContain('Process_Exit')
    expect(redacted.messages.at(-1)?.content).toContain('Process_Exit')
    expect(redacted.messages.at(-1)?.content).not.toContain('Alice')
    expect(raw.messages.at(-1)?.content).toContain('Alice')
    expect(
      new Set([
        excluded.disclosure.fingerprint,
        redacted.disclosure.fingerprint,
        raw.disclosure.fingerprint
      ]).size
    ).toBe(3)
  })

  it('normalizes request estimates and marks only declared messages sensitive', () => {
    const disclosure = createLlmMessageDisclosure({
      purpose: 'interview-question',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      messages: [
        { role: 'assistant', content: 'prior' },
        { role: 'user', content: 'current workspace summary' }
      ],
      estimatedRequests: { min: -2, max: 0 },
      sensitiveMessageIndexes: [1]
    })
    expect(disclosure.estimatedRequests).toEqual({ min: 0, max: 0 })
    expect(disclosure.sensitiveItemCount).toBe(1)
    expect(disclosure.outbound[0].sensitive).toBe(false)
    expect(disclosure.outbound[1].sensitive).toBe(true)
  })

  it('derives separate name and sensitive-metadata flags from exact outbound data', () => {
    const reviewed = buildReviewedLibraryRequest({
      providerId: 'anthropic',
      modelId: 'claude',
      question: 'What does Alice Smith approve?',
      history: [
        {
          role: 'assistant',
          content: 'Contact alice@example.test for the earlier answer.'
        }
      ],
      rankedDigests: [],
      lang: 'en',
      includeWorkspaceContext: false,
      redactNames: false
    })

    expect(reviewed.disclosure.containsNames).toBe(true)
    expect(reviewed.disclosure.containsSensitiveMetadata).toBe(true)
    expect(reviewed.disclosure.outbound.map((item) => item.text)).toEqual(
      reviewed.messages.map((message) => message.content)
    )

    const redacted = buildReviewedLibraryRequest({
      providerId: 'anthropic',
      modelId: 'claude',
      question: 'What does Alice Smith approve?',
      history: [
        {
          role: 'assistant',
          content: 'Contact alice@example.test for the earlier answer.'
        }
      ],
      rankedDigests: [],
      lang: 'en',
      includeWorkspaceContext: false,
      redactNames: true
    })
    const sent = redacted.messages.map((message) => message.content).join('\n')
    expect(redacted.disclosure.containsNames).toBe(false)
    expect(redacted.disclosure.containsSensitiveMetadata).toBe(false)
    expect(sent).not.toContain('Alice')
    expect(sent).not.toContain('Smith')
    expect(sent).not.toContain('alice@example.test')
  })

  it('conservatively detects and removes unlabelled Arabic names in free text', () => {
    const texts = ['هل يوافق أحمد علي؟', 'أحمد علي يوافق على الطلب']
    expect(inspectOutboundSensitivity(texts).containsNames).toBe(true)

    const redacted = texts.map((text) => redactPersonNames(text))
    expect(redacted.join('\n')).not.toContain('أحمد')
    expect(redacted.join('\n')).not.toContain('علي')
    expect(inspectOutboundSensitivity(redacted).containsNames).toBe(false)
  })

  it('fails closed when execution messages differ from the consent preview', () => {
    const disclosure = createLlmMessageDisclosure({
      purpose: 'test',
      providerId: 'anthropic',
      modelId: 'claude',
      messages: [{ role: 'user', content: 'Reviewed text' }]
    })
    expect(() =>
      assertLlmMessagesMatchDisclosure(
        [{ role: 'user', content: 'Changed after consent' }],
        disclosure
      )
    ).toThrow(/review it again/i)
  })
})
