import { describe, expect, it } from 'vitest'
import {
  ARIS_RESTORE_COMMAND_TYPE,
  ArisRevisionError,
  appendArisRevision,
  computeArisRevisionId,
  createArisBaselineRevision,
  createArisCurrentRevision,
  createArisRestoreRevision,
  createArisRevision,
  parseArisCurrentRevision,
  parseArisRevision,
  replayArisRevisions,
  serializeArisCurrentRevision,
  serializeArisRevision,
  validateArisCurrentRevision,
  validateArisRevisionPatch,
  type ArisCurrentRevisionV1,
  type ArisRevisionPatchV1
} from '../revisions'

const SOURCE = 'f'.repeat(64)

async function chain(): Promise<{
  patches: ArisRevisionPatchV1[]
  current: ArisCurrentRevisionV1
}> {
  const baseline = await createArisBaselineRevision(SOURCE)
  let current = createArisCurrentRevision(baseline)
  const patches = [baseline]
  for (const label of ['rename', 'move', 'recolor']) {
    const patch = await createArisRevision({
      sourceSha256: SOURCE,
      ordinal: current.ordinal + 1,
      parentRevisionId: current.currentRevisionId,
      kind: 'edit',
      commands: [{ type: `aris.test.${label}`, payload: { label } }]
    })
    current = appendArisRevision(current, patch)
    patches.push(patch)
  }
  return { patches, current }
}

describe('ARIS working revisions', () => {
  it('derives revision ids from content plus a monotonic ordinal', async () => {
    const first = await createArisRevision({
      sourceSha256: SOURCE,
      ordinal: 1,
      parentRevisionId: 'r000000-0123456789abcdef01234567',
      kind: 'edit',
      commands: [{ type: 'aris.test', payload: { a: 1 } }]
    })
    const again = await createArisRevision({
      sourceSha256: SOURCE,
      ordinal: 1,
      parentRevisionId: 'r000000-0123456789abcdef01234567',
      kind: 'edit',
      commands: [{ type: 'aris.test', payload: { a: 1 } }]
    })
    expect(again.revisionId).toBe(first.revisionId)
    expect(first.revisionId).toMatch(/^r000001-[0-9a-f]{24}$/u)

    const different = await createArisRevision({
      sourceSha256: SOURCE,
      ordinal: 1,
      parentRevisionId: 'r000000-0123456789abcdef01234567',
      kind: 'edit',
      commands: [{ type: 'aris.test', payload: { a: 2 } }]
    })
    expect(different.revisionId).not.toBe(first.revisionId)
  })

  it('never uses wall-clock time or randomness for identity', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../revisions.ts', import.meta.url), 'utf8')
    )
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/u.test(line))
      .join('\n')
    expect(code).not.toMatch(/Date\.now|Math\.random|new Date\(/u)
  })

  it('appends only a revision that continues the chain', async () => {
    const { current, patches } = await chain()
    expect(current.revisions).toHaveLength(4)
    expect(current.ordinal).toBe(3)

    const wrongParent = await createArisRevision({
      sourceSha256: SOURCE,
      ordinal: 4,
      parentRevisionId: patches[0]?.revisionId ?? null,
      kind: 'edit',
      commands: []
    })
    expect(() => appendArisRevision(current, wrongParent)).toThrow(ArisRevisionError)

    const wrongOrdinal = await createArisRevision({
      sourceSha256: SOURCE,
      ordinal: 9,
      parentRevisionId: current.currentRevisionId,
      kind: 'edit',
      commands: []
    })
    expect(() => appendArisRevision(current, wrongOrdinal)).toThrow(ArisRevisionError)

    const otherSource = await createArisRevision({
      sourceSha256: '1'.repeat(64),
      ordinal: 4,
      parentRevisionId: current.currentRevisionId,
      kind: 'edit',
      commands: []
    })
    expect(() => appendArisRevision(current, otherSource)).toThrow(ArisRevisionError)
  })

  it('detects a revision id collision instead of silently replacing history', async () => {
    const { current, patches } = await chain()
    const duplicate = patches[2] as ArisRevisionPatchV1
    expect(() => appendArisRevision(current, duplicate)).toThrow(
      expect.objectContaining({ code: 'revision-collision' })
    )
  })

  it('replays from zero and reproduces every intermediate state', async () => {
    const { patches } = await chain()
    const replay = await replayArisRevisions(patches)
    expect(replay.commands.map((command) => command.type)).toEqual([
      'aris.test.rename',
      'aris.test.move',
      'aris.test.recolor'
    ])
    expect(replay.statesByRevisionId.get(patches[0]?.revisionId ?? '')).toEqual([])
    expect(replay.statesByRevisionId.get(patches[2]?.revisionId ?? '')).toHaveLength(2)

    // Replaying a shuffled input yields the same result: order comes from ordinals.
    const shuffled = await replayArisRevisions([...patches].reverse())
    expect(shuffled.commands).toEqual(replay.commands)
  })

  it('rejects a broken, forged or foreign chain during replay', async () => {
    const { patches } = await chain()
    await expect(replayArisRevisions([])).rejects.toThrow(ArisRevisionError)
    await expect(replayArisRevisions(patches.slice(1))).rejects.toThrow(ArisRevisionError)

    const forged = {
      ...(patches[1] as ArisRevisionPatchV1),
      commands: [{ type: 'aris.test.evil', payload: {} }]
    }
    await expect(replayArisRevisions([patches[0] as ArisRevisionPatchV1, forged])).rejects.toThrow(
      expect.objectContaining({ code: 'digest-mismatch' })
    )
  })

  it('restores an earlier revision by appending, never by rewriting', async () => {
    const { current, patches } = await chain()
    const target = patches[1] as ArisRevisionPatchV1
    const restore = await createArisRestoreRevision(current, target.revisionId)
    expect(restore.kind).toBe('restore')
    expect(restore.restoredFromRevisionId).toBe(target.revisionId)
    expect(restore.commands[0]?.type).toBe(ARIS_RESTORE_COMMAND_TYPE)

    const next = appendArisRevision(current, restore)
    expect(next.revisions).toHaveLength(5)
    expect(next.revisions.slice(0, 4)).toEqual(current.revisions)

    const replay = await replayArisRevisions([...patches, restore])
    expect(replay.commands.map((command) => command.type)).toEqual(['aris.test.rename'])

    await expect(
      createArisRestoreRevision(current, 'r000009-0123456789abcdef01234567')
    ).rejects.toThrow(expect.objectContaining({ code: 'unknown-revision' }))
  })

  it('serializes deterministically and round-trips', async () => {
    const { current, patches } = await chain()
    const patch = patches[1] as ArisRevisionPatchV1
    const first = serializeArisRevision(patch)
    expect(Array.from(serializeArisRevision(patch))).toEqual(Array.from(first))
    expect(parseArisRevision(first)).toEqual(patch)

    const pointer = serializeArisCurrentRevision(current)
    expect(Array.from(serializeArisCurrentRevision(current))).toEqual(Array.from(pointer))
    expect(parseArisCurrentRevision(pointer)).toEqual(current)
  })

  it('rejects malformed revision documents', async () => {
    const { current, patches } = await chain()
    const patch = patches[1] as unknown as Record<string, unknown>
    expect(() => validateArisRevisionPatch({ ...patch, extra: 1 })).toThrow(ArisRevisionError)
    expect(() => validateArisRevisionPatch({ ...patch, ordinal: 0 })).toThrow(ArisRevisionError)
    expect(() => validateArisRevisionPatch({ ...patch, kind: 'baseline' })).toThrow(
      ArisRevisionError
    )
    expect(() => validateArisRevisionPatch({ ...patch, parentRevisionId: null })).toThrow(
      ArisRevisionError
    )
    const pointer = current as unknown as Record<string, unknown>
    expect(() =>
      validateArisCurrentRevision({ ...pointer, currentRevisionId: patches[0]?.revisionId })
    ).toThrow(ArisRevisionError)
    expect(() => validateArisCurrentRevision({ ...pointer, revisions: [] })).toThrow(
      ArisRevisionError
    )
    expect(() => parseArisRevision('{')).toThrow(ArisRevisionError)
  })

  it('produces ids that match the documented derivation', async () => {
    const baseline = await createArisBaselineRevision(SOURCE)
    const expected = await computeArisRevisionId({
      sourceSha256: SOURCE,
      ordinal: 0,
      parentRevisionId: null,
      kind: 'baseline',
      commandsSha256: baseline.commandsSha256
    })
    expect(baseline.revisionId).toBe(expected)
  })
})
