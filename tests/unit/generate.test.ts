/**
 * generate.ts — provider-agnostic orchestration with the conversational repair
 * loop. Providers are injected via `callLLM`; here we inject deterministic fakes
 * (no network) to prove: happy path (object AND string responses), the repair
 * loop wording/behaviour, retry exhaustion, and that layout runs end-to-end.
 */
import { describe, it, expect } from 'vitest'
import {
  generateFromDescription,
  isTransportError,
  type CallLLM,
  type LlmMessage
} from '../../src/gen/generate'

const VALID_IR = {
  process: [
    { type: 'startEvent', id: 'start' },
    { type: 'userTask', id: 't1', label: 'Do the thing' },
    { type: 'endEvent', id: 'end' }
  ]
}

interface Recorded {
  messages: LlmMessage[]
  options: { maxTokens: number }
}

function makeFakeLLM(responses: Array<string | unknown>): {
  callLLM: CallLLM
  calls: Recorded[]
} {
  const calls: Recorded[] = []
  let i = 0
  const callLLM: CallLLM = async (messages, options) => {
    calls.push({ messages: messages.map((m) => ({ ...m })), options })
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return r
  }
  return { callLLM, calls }
}

describe('generateFromDescription', () => {
  it('happy path with an already-parsed object response', async () => {
    const { callLLM, calls } = makeFakeLLM([VALID_IR])
    const result = await generateFromDescription(callLLM, 'do a thing')

    expect(calls.length).toBe(1)
    // 6000 (raised from the vendored 3000): bilingual labels + org metadata
    // roughly double the IR JSON, and truncation would defeat the repair loop.
    expect(calls[0].options.maxTokens).toBe(6000)
    expect(result.ir.map((e: Record<string, unknown>) => e.id)).toEqual(['start', 't1', 'end'])
    expect(result.semanticXml).toContain('id="definitions_1"')
    expect(result.semanticXml).toContain('<userTask id="t1" name="Do the thing">')
    expect(result.layoutedXml).toContain('BPMNDiagram')
  })

  it('happy path with a raw JSON-string response (loose-parsed)', async () => {
    const raw = 'Here is your process:\n```json\n' + JSON.stringify(VALID_IR) + '\n```'
    const { callLLM } = makeFakeLLM([raw])
    const result = await generateFromDescription(callLLM, 'do a thing')
    expect(result.ir.length).toBe(3)
    expect(result.layoutedXml).toContain('BPMNDiagram')
  })

  it('composes the create_bpmn prompt into the first user message', async () => {
    const { callLLM, calls } = makeFakeLLM([VALID_IR])
    await generateFromDescription(callLLM, 'A customer submits an order')
    expect(calls[0].messages).toHaveLength(1)
    expect(calls[0].messages[0].role).toBe('user')
    expect(calls[0].messages[0].content).toContain('# Representation of various BPMN elements')
    expect(calls[0].messages[0].content).toContain('User: A customer submits an order')
  })

  it('repairs on failure: feeds back the bad output and `Error: <e>. Try again.`', async () => {
    // First response is a structurally invalid IR (task without a label); second is valid.
    const bad = JSON.stringify({ process: [{ type: 'task', id: 't' }] })
    const { callLLM, calls } = makeFakeLLM([bad, VALID_IR])

    const result = await generateFromDescription(callLLM, 'do a thing')
    expect(calls.length).toBe(2)

    const secondTurn = calls[1].messages
    // The model's own bad output was pushed back...
    expect(secondTurn.some((m) => m.role === 'assistant' && m.content === bad)).toBe(true)
    // ...followed by the exact correction wording.
    const correction = secondTurn.find(
      (m) => m.role === 'user' && m.content.startsWith('Error:')
    )
    expect(correction).toBeDefined()
    expect(correction?.content).toMatch(/^Error: .+\. Try again\.$/)
    expect(correction?.content).toContain('Task element is missing a label')

    expect(result.ir.length).toBe(3)
  })

  it('gives up after maxRetries with a clear error', async () => {
    const bad = JSON.stringify({ process: [{ type: 'task', id: 't' }] })
    const { callLLM, calls } = makeFakeLLM([bad, bad, bad, bad])
    await expect(generateFromDescription(callLLM, 'do a thing')).rejects.toThrow(
      'Max number of retries reached'
    )
    expect(calls.length).toBe(3)
  })

  it('honours a custom maxRetries', async () => {
    const bad = 'totally not json'
    const { callLLM, calls } = makeFakeLLM([bad, bad, bad, bad, bad])
    await expect(
      generateFromDescription(callLLM, 'x', undefined, { maxRetries: 2 })
    ).rejects.toThrow('Max number of retries reached')
    expect(calls.length).toBe(2)
  })

  it('does NOT retry a transport error — surfaces it once (no re-upload of PDFs)', async () => {
    // A transport-marked failure (auth/rate/CORS/network/timeout) must break the
    // loop immediately instead of being fed back through the repair path.
    const transportErr = Object.assign(new Error('anthropic 401: invalid key'), {
      transport: true as const
    })
    let calls = 0
    const callLLM: CallLLM = async () => {
      calls += 1
      throw transportErr
    }
    await expect(generateFromDescription(callLLM, 'do a thing')).rejects.toBe(transportErr)
    // Exactly one attempt — no "Try again" retries, no re-send.
    expect(calls).toBe(1)
  })

  it('still retries a NON-transport (model-output) error up to maxRetries', async () => {
    // A plain error with no transport marker is a candidate for repair and is
    // retried the full three times (regression guard for the additive change).
    let calls = 0
    const callLLM: CallLLM = async () => {
      calls += 1
      throw new Error('transient hiccup')
    }
    await expect(generateFromDescription(callLLM, 'do a thing')).rejects.toThrow(
      'Max number of retries reached'
    )
    expect(calls).toBe(3)
  })

  it('isTransportError only trips on the duck-typed transport marker', () => {
    expect(isTransportError(Object.assign(new Error('x'), { transport: true }))).toBe(true)
    expect(isTransportError(new Error('plain'))).toBe(false)
    expect(isTransportError({ transport: false })).toBe(false)
    expect(isTransportError(null)).toBe(false)
    expect(isTransportError('nope')).toBe(false)
  })

  it('uses an explicit history when provided', async () => {
    const { callLLM, calls } = makeFakeLLM([VALID_IR])
    await generateFromDescription(callLLM, 'ignored when history given', [
      { role: 'user', content: 'First requirement' },
      { role: 'assistant', content: 'Understood' },
      { role: 'user', content: 'Second requirement' }
    ])
    const prompt = calls[0].messages[0].content
    expect(prompt).toContain('User: First requirement')
    expect(prompt).toContain('Assistant: Understood')
    expect(prompt).toContain('User: Second requirement')
    expect(prompt).not.toContain('ignored when history given')
  })
})
