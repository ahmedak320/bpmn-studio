import { describe, expect, it, vi } from 'vitest'
import {
  DraftJournalCoordinator,
  MemoryDraftJournal,
  createDraftRecoveryComparison,
  draftId,
  draftKeyOf,
  findDraftRecoveryComparison,
  type DraftLifecycleTarget,
  type DraftSource,
  type DraftTimer
} from './draftJournal'

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }

function source(overrides: Partial<DraftSource> = {}): DraftSource {
  return {
    sessionId: 's',
    incarnation: 1,
    identity: { workspace, path: 'a.bpmn' },
    currentXml: '<dirty/>',
    dirty: true,
    base: { hash: 'base', size: 4, modifiedAt: 1 },
    ...overrides
  }
}

class ManualTimer implements DraftTimer {
  next = 0
  callbacks = new Map<number, () => void>()

  setTimeout(callback: () => void): unknown {
    const id = ++this.next
    this.callbacks.set(id, callback)
    return id
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number)
  }

  runAll(): void {
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const callback of callbacks) callback()
  }
}

class LifecycleTarget implements DraftLifecycleTarget {
  listeners = new Map<'blur' | 'pagehide', Set<() => void>>()

  addEventListener(type: 'blur' | 'pagehide', listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: 'blur' | 'pagehide', listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: 'blur' | 'pagehide'): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

describe('DraftJournalCoordinator', () => {
  it('uses the session id to distinguish virtual-document drafts', () => {
    const first = draftKeyOf(
      source({ sessionId: 'virtual-a', identity: { workspace, path: null } })
    )
    const second = draftKeyOf(
      source({ sessionId: 'virtual-b', identity: { workspace, path: null } })
    )
    expect(draftId(first)).not.toBe(draftId(second))
  })

  it('writes dirty XML only after the configured two-second debounce', async () => {
    const journal = new MemoryDraftJournal()
    const timer = new ManualTimer()
    const coordinator = new DraftJournalCoordinator(journal, {
      appVersion: '0.4.5',
      debounceMs: 2000,
      now: () => 123,
      timer
    })
    coordinator.track(source())
    expect(await journal.get(draftKeyOf(source()))).toBeNull()

    timer.runAll()
    await vi.waitFor(async () => {
      expect(await journal.get(draftKeyOf(source()))).toMatchObject({
        xml: '<dirty/>',
        baseHash: 'base',
        timestamp: 123,
        appVersion: '0.4.5',
        workspaceId: 'ws',
        path: 'a.bpmn'
      })
    })
  })

  it('resets the debounce and persists only the latest dirty XML', async () => {
    const journal = new MemoryDraftJournal()
    const timer = new ManualTimer()
    const coordinator = new DraftJournalCoordinator(journal, {
      appVersion: '0.4.5',
      timer
    })
    coordinator.track(source({ currentXml: '<first/>' }))
    coordinator.track(source({ currentXml: '<latest/>' }))
    expect(timer.callbacks.size).toBe(1)
    timer.runAll()
    await vi.waitFor(async () => {
      expect((await journal.get(draftKeyOf(source())))?.xml).toBe('<latest/>')
    })
  })

  it('flushes immediately on window blur and pagehide hooks', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    const target = new LifecycleTarget()
    const detach = coordinator.attachLifecycle(target)
    coordinator.track(source())

    target.dispatch('blur')
    await vi.waitFor(async () => {
      expect(await journal.get(draftKeyOf(source()))).not.toBeNull()
    })
    await journal.delete(draftKeyOf(source()))
    coordinator.track(source({ currentXml: '<pagehide/>' }))
    target.dispatch('pagehide')
    await vi.waitFor(async () => {
      expect((await journal.get(draftKeyOf(source())))?.xml).toBe('<pagehide/>')
    })

    detach()
    expect(target.listeners.get('blur')?.size).toBe(0)
    expect(target.listeners.get('pagehide')?.size).toBe(0)
    coordinator.dispose()
  })

  it('does not delete a draft merely because a source becomes clean', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    coordinator.track(source())
    await coordinator.flush('s', 1)
    coordinator.track(source({ dirty: false }))

    expect(await journal.get(draftKeyOf(source()))).not.toBeNull()
  })

  it('deletes only after confirmed save or explicit discard', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    coordinator.track(source())
    await coordinator.flush('s', 1)
    await coordinator.confirmedSave('s', 1, '<dirty/>')
    expect(await journal.get(draftKeyOf(source()))).toBeNull()

    coordinator.track(source({ currentXml: '<again/>' }))
    await coordinator.flush('s', 1)
    await coordinator.explicitDiscard('s', 1)
    expect(await journal.get(draftKeyOf(source()))).toBeNull()
  })

  it('preserves a newer draft when an older in-flight save succeeds', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    coordinator.track(source({ currentXml: '<save-snapshot/>' }))
    await coordinator.flush('s', 1)
    coordinator.track(source({ currentXml: '<newer-edit/>' }))

    await coordinator.confirmedSave('s', 1, '<save-snapshot/>')

    expect(await journal.get(draftKeyOf(source()))).toMatchObject({
      xml: '<newer-edit/>'
    })
  })

  it('migrates an existing draft when the live session path changes', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    const oldSource = source()
    const movedSource = source({
      identity: { workspace, path: 'folder/moved.bpmn' }
    })
    coordinator.track(oldSource)
    await coordinator.flush('s', 1)
    coordinator.track(movedSource)
    await coordinator.flush('s', 1)

    expect(await journal.get(draftKeyOf(oldSource))).toBeNull()
    expect(await journal.get(draftKeyOf(movedSource))).toMatchObject({
      path: 'folder/moved.bpmn',
      xml: '<dirty/>'
    })
  })

  it('provides a rollback hook for transactional path draft migration', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    const oldSource = source()
    const newIdentity = { workspace, path: 'moved/a.bpmn' }
    coordinator.track(oldSource)
    await coordinator.flush('s', 1)

    const transaction = await coordinator.migrateDraftRecords([
      { sessionId: 's', incarnation: 1, from: oldSource.identity, to: newIdentity }
    ])
    expect(await journal.get(draftKeyOf(oldSource))).toBeNull()
    expect(
      await journal.get({
        workspaceId: 'ws',
        path: 'moved/a.bpmn',
        sessionId: 's'
      })
    ).not.toBeNull()

    await transaction.rollback()
    expect(await journal.get(draftKeyOf(oldSource))).not.toBeNull()
    expect(
      await journal.get({
        workspaceId: 'ws',
        path: 'moved/a.bpmn',
        sessionId: 's'
      })
    ).toBeNull()
  })

  it('never overwrites an unrelated recovery draft at a migration destination', async () => {
    const journal = new MemoryDraftJournal()
    const from = source()
    const to = source({
      sessionId: 'other',
      identity: { workspace, path: 'occupied.bpmn' },
      currentXml: '<occupied/>'
    })
    const first = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    first.track(from)
    first.track(to)
    await first.flushAll()

    await expect(
      first.migrateDraftRecords([
        { sessionId: 's', incarnation: 1, from: from.identity, to: to.identity }
      ])
    ).rejects.toThrow(/already exists/)
    expect((await journal.get(draftKeyOf(from)))?.xml).toBe('<dirty/>')
    expect((await journal.get(draftKeyOf(to)))?.xml).toBe('<occupied/>')
  })

  it('isolates and clears drafts by workspace', async () => {
    const journal = new MemoryDraftJournal()
    const a = source()
    const b = source({
      sessionId: 'other',
      identity: {
        workspace: { ...workspace, id: 'other-ws' },
        path: 'a.bpmn'
      }
    })
    await journal.put({
      ...draftKeyOf(a),
      id: JSON.stringify(['ws', 'a.bpmn', 's']),
      xml: 'a',
      baseHash: null,
      timestamp: 1,
      appVersion: '0.4.5'
    })
    await journal.put({
      ...draftKeyOf(b),
      id: JSON.stringify(['other-ws', 'a.bpmn', 'other']),
      xml: 'b',
      baseHash: null,
      timestamp: 2,
      appVersion: '0.4.5'
    })
    await journal.clearWorkspace('ws')
    expect(await journal.listWorkspace('ws')).toEqual([])
    expect(await journal.listWorkspace('other-ws')).toHaveLength(1)
  })

  it('discovers a persisted path draft after restart with a new session id', async () => {
    const journal = new MemoryDraftJournal()
    const firstRun = source({ sessionId: 'old-session' })
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    coordinator.track(firstRun)
    await coordinator.flush(firstRun.sessionId, firstRun.incarnation)

    const comparison = await findDraftRecoveryComparison(
      journal,
      draftKeyOf(source({ sessionId: 'new-session' })),
      '<loaded/>',
      'base'
    )
    expect(comparison).toMatchObject({
      relation: 'same-base',
      requiresReview: true,
      draft: { sessionId: 'old-session', xml: '<dirty/>' }
    })
  })
})

describe('draft recovery comparison', () => {
  const draft = {
    id: 'd',
    sessionId: 's',
    workspaceId: 'ws',
    path: 'a.bpmn',
    xml: '<draft/>',
    baseHash: 'base',
    timestamp: 10,
    appVersion: '0.4.5'
  }

  it('always requires review and describes whether the loaded base diverged', () => {
    expect(createDraftRecoveryComparison(draft, '<loaded/>', 'base')).toMatchObject({
      relation: 'same-base',
      requiresReview: true
    })
    expect(createDraftRecoveryComparison(draft, '<loaded/>', 'new-base')).toMatchObject({
      relation: 'base-diverged',
      requiresReview: true
    })
    expect(createDraftRecoveryComparison(draft, '<draft/>', 'new-base').relation).toBe(
      'same-content'
    )
  })
})
