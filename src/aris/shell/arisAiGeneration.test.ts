/**
 * Plan §16.6 steps 5–10 and §4.3, asserted on the loop itself — no DOM, no
 * provider, no network. `send` is injected, so every attempt this suite counts
 * is an attempt the real transport would have made.
 */

import { describe, expect, it } from 'vitest'

import { buildMinimalValidDraft } from '../ai/testFixtures'
import type { ArisAiDraftV1 } from '../ai'
import type { GenAttachment } from '../../ai/pdf'
import {
  isArisAiTransportFailure,
  parseArisAiResponseJson,
  runArisAiGeneration,
  type ArisAiGenerationRequest
} from './arisAiGeneration'

const ATTACHMENT: GenAttachment = {
  kind: 'pdf',
  base64: 'JVBERi0=',
  mediaType: 'application/pdf',
  fileName: 'process.pdf',
  sizeBytes: 8
}

function validDraftJson(): string {
  return JSON.stringify(buildMinimalValidDraft())
}

/** A draft whose EPC control flow is broken: two functions wired together. */
function alternationBreakingDraft(): ArisAiDraftV1 {
  const draft = buildMinimalValidDraft()
  return {
    ...draft,
    objects: draft.objects.map((object) =>
      object.logicalId === 'evt-start' ? { ...object, objectType: 'OT_FUNC' } : object
    )
  }
}

interface Recorded {
  readonly requests: ArisAiGenerationRequest[]
}

/** Replay a scripted list of provider replies; an `Error` entry is thrown. */
function recorder(replies: readonly (string | Error)[]): {
  recorded: Recorded
  send: (request: ArisAiGenerationRequest) => Promise<string>
} {
  const recorded: Recorded = { requests: [] }
  let index = 0
  return {
    recorded,
    send: async (request) => {
      recorded.requests.push(request)
      const reply = replies[Math.min(index, replies.length - 1)]!
      index += 1
      if (reply instanceof Error) throw reply
      return reply
    }
  }
}

describe('§16.6 step 5 — the attachment rides on the first attempt only', () => {
  it('never re-sends the attachment on a repair turn', async () => {
    const { recorded, send } = recorder(['not json at all', '{"still":"wrong"}', validDraftJson()])
    const controller = new AbortController()

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      attachment: ATTACHMENT,
      send,
      signal: controller.signal
    })

    expect(result.ok).toBe(true)
    expect(recorded.requests).toHaveLength(3)
    expect(recorded.requests[0]!.attachment).toBe(ATTACHMENT)
    expect(recorded.requests[1]!.attachment).toBeUndefined()
    expect(recorded.requests[2]!.attachment).toBeUndefined()
    // The repair turns say so to the model as well.
    expect(recorded.requests[1]!.user).toContain('This is a text-only repair turn')
  })

  it('does not resend the attachment after a transport failure either', async () => {
    const transport = Object.assign(new Error('HTTP 429'), { transport: true as const })
    const { recorded, send } = recorder([transport])
    const controller = new AbortController()

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      attachment: ATTACHMENT,
      send,
      signal: controller.signal
    })

    expect(result.ok).toBe(false)
    expect(recorded.requests).toHaveLength(1)
    expect(recorded.requests[0]!.attachment).toBe(ATTACHMENT)
  })
})

describe('§4.3 — transport failures do not burn semantic repair attempts', () => {
  it.each([
    ['transport-marked error', Object.assign(new Error('offline'), { transport: true as const })],
    ['TransportError by name', Object.assign(new Error('auth'), { name: 'TransportError' })],
    ['ProviderHttpError by name', Object.assign(new Error('500'), { name: 'ProviderHttpError' })],
    [
      'ProviderResponseError by name',
      Object.assign(new Error('empty'), { name: 'ProviderResponseError' })
    ]
  ])('reports %s without consuming an attempt', async (_label, error) => {
    const { recorded, send } = recorder([error])
    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('transport')
    expect(result.semanticAttemptsUsed).toBe(0)
    expect(result.error).toBe(error)
    expect(recorded.requests).toHaveLength(1)
  })

  it('classifies a semantic failure and a transport failure differently', () => {
    expect(isArisAiTransportFailure(new SyntaxError('bad json'))).toBe(false)
    expect(
      isArisAiTransportFailure(Object.assign(new Error('x'), { transport: true as const }))
    ).toBe(true)
  })

  it('leaves the counter at 1 when a transport failure follows one semantic failure', async () => {
    const error = Object.assign(new Error('offline'), { transport: true as const })
    const { send } = recorder(['not json', error])
    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('transport')
    // Exactly the one semantic failure counted; the transport failure did not.
    expect(result.semanticAttemptsUsed).toBe(1)
  })
})

describe('§16.6 step 10 — up to three semantic repair turns', () => {
  it('sends the first attempt plus three repairs, then gives up with the findings', async () => {
    const { recorded, send } = recorder(['{"version":"nope"}'])
    const attempts: number[] = []

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal,
      onRepairTurn: (attemptNumber) => attempts.push(attemptNumber)
    })

    expect(recorded.requests).toHaveLength(4)
    expect(attempts).toEqual([1, 2, 3])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('semantic-exhausted')
    expect(result.semanticAttemptsUsed).toBe(4)
    expect(result.findings.length).toBeGreaterThan(0)
  })

  it('carries the previous response and its findings into the repair turn', async () => {
    const { recorded, send } = recorder(['{"version":2}', validDraftJson()])

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(true)
    const repair = recorded.requests[1]!
    expect(repair.user).toContain('Repair turn 1 of 3')
    expect(repair.user).toContain('{"version":2}')
    expect(repair.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user'
    ])
  })
})

describe('§16.6 steps 6-9 — bounded parse, draft, types, EPC semantics', () => {
  it('parses a fenced JSON response', () => {
    expect(parseArisAiResponseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('refuses a response beyond the character bound instead of parsing it', () => {
    expect(() => parseArisAiResponseJson('x'.repeat(400_001))).toThrow(/character bound/u)
  })

  it('rejects a draft that breaks EPC alternation and repairs it', async () => {
    const { recorded, send } = recorder([
      JSON.stringify(alternationBreakingDraft()),
      validDraftJson()
    ])

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(true)
    expect(recorded.requests).toHaveLength(2)
    expect(recorded.requests[1]!.user).toContain('epc.alternation')
  })

  it('surfaces the §16.4 forbidden-content rejection verbatim', async () => {
    const draft = buildMinimalValidDraft()
    const poisoned = {
      ...draft,
      objects: draft.objects.map((object, index) =>
        index === 0
          ? { ...object, names: { en: '<AML><ObjDef ObjDef.ID="ObjDef.real"/></AML>' } }
          : object
      )
    }
    const { send } = recorder([JSON.stringify(poisoned)])

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.findings.some((entry) => entry.code.includes('forbidden'))).toBe(true)
  })
})

describe('Wave 8 — deterministic connection-type normalization (no repair turn)', () => {
  it('rewrites two invented but mappable codes on the first response without a repair turn', async () => {
    const base = buildMinimalValidDraft()
    const withInventedCodes: ArisAiDraftV1 = {
      ...base,
      relations: base.relations.map((relation) => {
        // evt-start → func-approve (event→function) invents CT_FLOW.
        if (relation.logicalId === 'rel-start-to-approve') {
          return { ...relation, connectionType: 'CT_FLOW' }
        }
        // func-approve → evt-end (function→event) invents CT_SEQ.
        if (relation.logicalId === 'rel-approve-to-end') {
          return { ...relation, connectionType: 'CT_SEQ' }
        }
        return relation
      })
    }
    const { recorded, send } = recorder([JSON.stringify(withInventedCodes)])

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    // One physical request, zero semantic repair turns — the normalizer fixed
    // the codes before validation ever saw them.
    expect(recorded.requests).toHaveLength(1)
    expect(result.requestsSent).toBe(1)
    expect(result.semanticAttemptsUsed).toBe(0)
    const normalized = result.warnings.filter(
      (warning) => warning.code === 'normalized-connection-type'
    )
    expect(normalized).toHaveLength(2)
    // The accepted draft carries the canonical census codes.
    const byId = new Map(result.draft.relations.map((relation) => [relation.logicalId, relation]))
    expect(byId.get('rel-start-to-approve')!.connectionType).toBe('CT_ACTIV_1')
    expect(byId.get('rel-approve-to-end')!.connectionType).toBe('CT_CRT_1')
  })
})

describe('§16.7 — cancellation', () => {
  it('returns cancelled without sending when the signal is already aborted', async () => {
    const { recorded, send } = recorder([validDraftJson()])
    const controller = new AbortController()
    controller.abort()

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: controller.signal
    })

    expect(recorded.requests).toHaveLength(0)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('cancelled')
  })

  it('treats an AbortError from the transport as cancellation, not as a failure', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const { send } = recorder([abort])

    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send,
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('cancelled')
    expect(result.semanticAttemptsUsed).toBe(0)
  })

  it('stops before another repair turn when cancelled mid-run', async () => {
    const controller = new AbortController()
    const requests: ArisAiGenerationRequest[] = []
    const result = await runArisAiGeneration({
      system: 'system',
      user: 'user',
      send: async (request) => {
        requests.push(request)
        controller.abort()
        return 'not json'
      },
      signal: controller.signal
    })

    expect(requests).toHaveLength(1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('cancelled')
  })
})
