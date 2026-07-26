import { describe, it, expect } from 'vitest'
import { createMutex } from '../workspace/mutex'

// Codex ORIG-3-partial: rename/move must run through the SAME op-mutex as
// create/import/AI-place, so a rename can never interleave its probe→write with
// an in-flight create racing for the same slug. This proves the serialization
// guarantee the App wiring relies on: a rename enqueued after an in-flight
// create waits for the create's critical section to finish.

/** A task that records when its critical section starts and ends, with an
 *  awaitable delay in between so overlap is observable. */
function tracked(label: string, log: string[], delayMs = 15) {
  return async () => {
    log.push(`${label}:start`)
    await new Promise((r) => setTimeout(r, delayMs))
    log.push(`${label}:end`)
  }
}

describe('op-mutex serializes create and rename (ORIG-3-partial)', () => {
  it('a rename enqueued on the shared mutex waits for an in-flight create (no interleave)', async () => {
    const mutex = createMutex()
    const log: string[] = []
    // Enqueue a slow "create", then a "rename" on the SAME mutex.
    const create = mutex.runExclusive(tracked('create', log, 20))
    const rename = mutex.runExclusive(tracked('rename', log, 5))
    await Promise.all([create, rename])
    // The rename's critical section starts only AFTER the create's ends.
    expect(log).toEqual(['create:start', 'create:end', 'rename:start', 'rename:end'])
  })

  it('WITHOUT the shared mutex the two ops interleave — the race this wiring closes', async () => {
    const log: string[] = []
    // Run both concurrently (rename bypassing the mutex — the pre-fix behavior).
    await Promise.all([tracked('create', log, 20)(), tracked('rename', log, 5)()])
    // They overlap: rename starts before create ends.
    expect(log.indexOf('rename:start')).toBeLessThan(log.indexOf('create:end'))
  })

  it('a failing create does not stall a following rename on the shared mutex', async () => {
    const mutex = createMutex()
    const order: string[] = []
    const create = mutex.runExclusive(async () => {
      order.push('create')
      throw new Error('create failed')
    })
    const rename = mutex.runExclusive(async () => {
      order.push('rename')
    })
    await expect(create).rejects.toThrow(/create failed/)
    await rename
    expect(order).toEqual(['create', 'rename'])
  })
})
