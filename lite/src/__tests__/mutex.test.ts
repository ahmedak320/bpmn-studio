import { describe, it, expect } from 'vitest'
import { createMutex } from '../workspace/mutex'
import { createBpmnFileUnique, readFileAt, writeFileAt, bpmnSlugsIn } from '../fs/fsAccess'
import { newRoot } from './mockFs'

describe('createMutex', () => {
  it('runs tasks in FIFO order, never overlapping', async () => {
    const mutex = createMutex()
    const events: string[] = []
    const task = (id: string, ms: number): Promise<void> =>
      mutex.runExclusive(async () => {
        events.push(`start:${id}`)
        await new Promise((r) => setTimeout(r, ms))
        events.push(`end:${id}`)
      })
    // A is slow, B and C are fast — without the mutex their starts/ends would
    // interleave; with it each task fully completes before the next starts.
    await Promise.all([task('A', 20), task('B', 1), task('C', 1)])
    expect(events).toEqual(['start:A', 'end:A', 'start:B', 'end:B', 'start:C', 'end:C'])
  })

  it('a rejected task does not poison the queue', async () => {
    const mutex = createMutex()
    const boom = mutex.runExclusive(async () => {
      throw new Error('boom')
    })
    await expect(boom).rejects.toThrow('boom')
    const ok = await mutex.runExclusive(async () => 42)
    expect(ok).toBe(42)
  })

  it('propagates the resolved value to the caller', async () => {
    const mutex = createMutex()
    await expect(mutex.runExclusive(async () => 'ok')).resolves.toBe('ok')
  })
})

describe('createBpmnFileUnique re-suffix at write time (MAJOR-3)', () => {
  it('re-suffixes when the exact slug is already taken on disk', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', 'EXISTING')
    // Caller's precomputed slug is stale (thinks "order" is free); the write-time
    // probe re-suffixes rather than overwriting.
    const rel = await createBpmnFileUnique(root, '', 'order', '<new/>')
    expect(rel).toBe('order-2.bpmn')
    expect(await readFileAt(root, 'order.bpmn')).toBe('EXISTING') // original intact
    expect(await readFileAt(root, 'order-2.bpmn')).toBe('<new/>')
  })

  it('uses the base slug when the folder is free', async () => {
    const root = newRoot()
    const rel = await createBpmnFileUnique(root, 'Sales', 'invoice', '<x/>')
    expect(rel).toBe('Sales/invoice.bpmn')
    expect(await readFileAt(root, 'Sales/invoice.bpmn')).toBe('<x/>')
  })

  it('serialized through the mutex, two racing creates for the same slug never clobber', async () => {
    const root = newRoot()
    const mutex = createMutex()
    const make = (body: string): Promise<string> =>
      mutex.runExclusive(async () => {
        // Mirror the App call site: recompute the slug inside the lock, then
        // create with the write-time probe.
        const taken = await bpmnSlugsIn(root, '')
        const guess = taken.has('order') ? 'order-x' : 'order'
        return createBpmnFileUnique(root, '', guess, body)
      })

    // Fire both concurrently; the mutex forces them to resolve to distinct files.
    const [a, b] = await Promise.all([make('<a/>'), make('<b/>')])
    expect(new Set([a, b]).size).toBe(2) // two distinct paths, no clobber
    // Both bodies survive (neither overwrote the other).
    const bodies = new Set([await readFileAt(root, a), await readFileAt(root, b)])
    expect(bodies).toEqual(new Set(['<a/>', '<b/>']))
  })
})
