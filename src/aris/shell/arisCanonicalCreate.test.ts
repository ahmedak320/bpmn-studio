import { describe, expect, it } from 'vitest'

import { VALID_CANONICAL_FULL } from '../canonical/fixtures'
import { MAX_CANONICAL_REPAIR_TURNS, runCanonicalCreate } from './arisCanonicalCreate'
import type { ArisAiGenerationMessage } from './arisAiGeneration'

const VALID_TEXT = JSON.stringify(VALID_CANONICAL_FULL)

function scripted(responses: readonly string[]) {
  const calls: ArisAiGenerationMessage[][] = []
  const send = async (messages: readonly ArisAiGenerationMessage[]) => {
    calls.push([...messages])
    return responses[Math.min(calls.length - 1, responses.length - 1)]
  }
  return { calls, send }
}

const input = (send: ReturnType<typeof scripted>['send']) => ({
  system: 'system',
  user: 'user',
  send,
  signal: new AbortController().signal
})

describe('runCanonicalCreate', () => {
  it('builds the convention AML from a valid canonical process on the first turn', async () => {
    const { calls, send } = scripted([VALID_TEXT])
    const result = await runCanonicalCreate(input(send))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairTurns).toBe(0)
    expect(result.xml).toContain('<?xml')
    expect(result.modelCount).toBeGreaterThanOrEqual(1)
    expect(calls).toHaveLength(1)
  })

  it('sends the rejection back and accepts the corrected process', async () => {
    const { calls, send } = scripted(['{"version":1,', VALID_TEXT])
    const result = await runCanonicalCreate(input(send))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairTurns).toBe(1)
    expect(calls).toHaveLength(2)
    const repair = calls[1].at(-1)
    expect(repair?.role).toBe('user')
    expect(repair?.content).toContain('The JSON was rejected')
    expect(repair?.content).toContain('CanonicalProcessV1')
  })

  it('stops after the bounded repair budget and creates nothing', async () => {
    const { calls, send } = scripted(['not json'])
    const result = await runCanonicalCreate(input(send))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.repairTurns).toBe(MAX_CANONICAL_REPAIR_TURNS)
    expect(calls).toHaveLength(MAX_CANONICAL_REPAIR_TURNS + 1)
    expect(result.detail.length).toBeGreaterThan(0)
  })
})
