import { describe, expect, it } from 'vitest'
import {
  ArisCommandError,
  type ArisEditCommand,
  createCommandStack,
  createCommandIdGenerator,
  deserializeCommandStack,
  serializeCommandStack
} from './index'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { sha256Hex } from '../../workspace/adapters/hash'
import { SYNTHETIC_AML, buildTestDocument } from './testFixture'
import { buildFromSource } from './buildFromSource'
import type { ArisConnectionOccurrence } from './types'

describe('command system', () => {
  async function makeStack() {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('test')
    return { stack: createCommandStack(document, { idGenerator }), idGenerator }
  }

  it('rejects a command whose baseRevision is stale', async () => {
    const { stack } = await makeStack()
    const command: ArisEditCommand = {
      commandId: 'x',
      baseRevision: 99,
      kind: 'moveOccurrence',
      affectedSourceIds: [],
      before: null,
      after: { occurrenceId: 'occ1', x: 5, y: 5 },
      origin: 'user'
    }
    expect(() => stack.apply(command)).toThrow(ArisCommandError)
  })

  it('rejects a command that references a missing id', async () => {
    const { stack } = await makeStack()
    const command: ArisEditCommand = {
      commandId: 'x',
      baseRevision: 0,
      kind: 'moveOccurrence',
      affectedSourceIds: [],
      before: null,
      after: { occurrenceId: 'does-not-exist', x: 5, y: 5 },
      origin: 'user'
    }
    expect(() => stack.apply(command)).toThrow(ArisCommandError)
  })

  it('rejects a command that would create a dangling reference', async () => {
    const { stack } = await makeStack()
    const command: ArisEditCommand = {
      commandId: 'x',
      baseRevision: 0,
      kind: 'createConnectionOccurrence',
      affectedSourceIds: [],
      before: null,
      after: {
        id: 'c-new',
        definitionId: 'cd1',
        modelId: 'm1',
        sourceOccurrenceId: 'occ1',
        targetOccurrenceId: 'does-not-exist',
        route: [],
        style: {
          color: null,
          width: null,
          lineStyle: null,
          srcArrow: null,
          tgtArrow: null,
          fontStyleSheetId: null,
          zOrder: null
        },
        attributeOccurrences: [],
        rawAttributes: {}
      } satisfies ArisConnectionOccurrence,
      origin: 'user'
    }
    expect(() => stack.apply(command)).toThrow(ArisCommandError)
  })

  it('moves and resizes an occurrence atomically and undoably', async () => {
    const { stack } = await makeStack()
    const move: ArisEditCommand = {
      commandId: 'move-1',
      baseRevision: 0,
      kind: 'moveOccurrence',
      affectedSourceIds: ['occ1'],
      before: { occurrenceId: 'occ1', x: 10, y: 20 },
      after: { occurrenceId: 'occ1', x: 50, y: 60 },
      origin: 'user'
    }
    const afterMove = stack.apply(move)
    const moved = afterMove.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ1')!
    expect(moved.bounds.x).toBe(50)
    expect(moved.bounds.y).toBe(60)

    const afterUndo = afterMove.undo()
    const undone = afterUndo.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ1')!
    expect(undone.bounds.x).toBe(10)
    expect(undone.bounds.y).toBe(20)

    const afterRedo = afterUndo.redo()
    const redoed = afterRedo.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ1')!
    expect(redoed.bounds.x).toBe(50)
    expect(redoed.bounds.y).toBe(60)
  })

  it('updates a definition name through setLocalizedName', async () => {
    const { stack } = await makeStack()
    const command: ArisEditCommand = {
      commandId: 'rename-1',
      baseRevision: 0,
      kind: 'setLocalizedName',
      affectedSourceIds: ['od1'],
      before: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        localeId: 'de-DE',
        value: 'Genehmigen'
      },
      after: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        localeId: 'de-DE',
        value: 'Freigeben'
      },
      origin: 'user'
    }
    const next = stack.apply(command)
    expect(next.document.objectDefinitions.get('od1')!.names.values['de-DE']).toBe('Freigeben')
    expect(next.document.models.get('m1')!.occurrences[0].definitionId).toBe('od1')
  })

  it('groups multi-object operations into one transaction', async () => {
    const { stack } = await makeStack()
    const transaction: ArisEditCommand = {
      commandId: 'txn-1',
      baseRevision: 0,
      kind: 'transaction',
      affectedSourceIds: ['occ1', 'occ2'],
      before: null,
      after: {
        commands: [
          {
            commandId: 'sub-1',
            baseRevision: 0,
            kind: 'moveOccurrence',
            affectedSourceIds: ['occ1'],
            before: { occurrenceId: 'occ1', x: 10, y: 20 },
            after: { occurrenceId: 'occ1', x: 1, y: 2 },
            origin: 'user'
          },
          {
            commandId: 'sub-2',
            baseRevision: 0,
            kind: 'moveOccurrence',
            affectedSourceIds: ['occ2'],
            before: { occurrenceId: 'occ2', x: 220, y: 20 },
            after: { occurrenceId: 'occ2', x: 3, y: 4 },
            origin: 'user'
          }
        ]
      },
      origin: 'user'
    }
    const afterApply = stack.apply(transaction)
    expect(afterApply.document.revision).toBe(1)
    expect(afterApply.undoStack).toHaveLength(1)

    const m1 = afterApply.document.models.get('m1')!
    expect(m1.occurrences.find((o) => o.id === 'occ1')!.bounds).toEqual({
      x: 1,
      y: 2,
      width: 100,
      height: 50
    })
    expect(m1.occurrences.find((o) => o.id === 'occ2')!.bounds).toEqual({
      x: 3,
      y: 4,
      width: 100,
      height: 50
    })

    const afterUndo = afterApply.undo()
    expect(afterUndo.document.revision).toBe(0)
    expect(
      afterUndo.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ1')!.bounds.x
    ).toBe(10)
  })
})

describe('command persistence and replay', () => {
  it('serializes the full revision log, reloads, replays, and matches', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('persist')
    const initialDocument = document
    let stack = createCommandStack(document, { idGenerator })

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'moveOccurrence',
      affectedSourceIds: ['occ1'],
      before: { occurrenceId: 'occ1', x: 10, y: 20 },
      after: { occurrenceId: 'occ1', x: 55, y: 66 },
      origin: 'user'
    })
    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 1,
      kind: 'setLocalizedName',
      affectedSourceIds: ['od1'],
      before: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        localeId: 'de-DE',
        value: 'Genehmigen'
      },
      after: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        localeId: 'de-DE',
        value: 'Freigegeben'
      },
      origin: 'user'
    })

    const serialized = JSON.parse(JSON.stringify(serializeCommandStack(stack)))
    const restored = deserializeCommandStack(serialized, initialDocument.sourceIndex)

    let replayed = createCommandStack(initialDocument)
    for (const command of restored.undoStack) {
      replayed = replayed.apply(command)
    }

    expect(replayed.document).toEqual(stack.document)
  })
})

describe('undo/redo preserves original bytes', () => {
  it('leaves imported source bytes and sha256 unchanged', async () => {
    const bytes = new TextEncoder().encode(SYNTHETIC_AML)
    const sourcePackage = await createArisXmlSourcePackage({
      name: 'synthetic.aml',
      relPath: null,
      bytes
    })
    const document = buildFromSource(sourcePackage.index)
    const idGenerator = createCommandIdGenerator('bytes')
    let stack = createCommandStack(document, { idGenerator })

    for (let i = 0; i < 5; i += 1) {
      stack = stack.apply({
        commandId: idGenerator(),
        baseRevision: i,
        kind: 'moveOccurrence',
        affectedSourceIds: ['occ1'],
        before: { occurrenceId: 'occ1', x: 10 + i * 10, y: 20 + i * 10 },
        after: { occurrenceId: 'occ1', x: (i + 1) * 10, y: (i + 1) * 10 },
        origin: 'user'
      })
    }
    while (stack.canUndo) {
      stack = stack.undo()
    }
    while (stack.canRedo) {
      stack = stack.redo()
    }
    while (stack.canUndo) {
      stack = stack.undo()
    }

    const finalBytes = sourcePackage.bytes
    const finalSha256 = await sha256Hex(finalBytes)

    expect(finalBytes).toEqual(bytes)
    expect(finalSha256).toBe(sourcePackage.sha256)
  })
})

describe('property: arbitrary apply/undo/redo sequences', () => {
  function mulberry32(seed: number) {
    return function () {
      let t = (seed += 0x6d2b79f5)
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('undo all returns to the starting document and redo restores', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('prop')
    let stack = createCommandStack(document, { idGenerator })
    const start = stack.document

    const rand = mulberry32(12345)
    const m1 = document.models.get('m1')!
    const occurrenceIds = m1.occurrences.map((o) => o.id)
    const connectionIds = m1.connectionOccurrences.map((c) => c.id)

    const applied: ArisEditCommand[] = []
    for (let i = 0; i < 20; i += 1) {
      const kind = Math.floor(rand() * 4)
      let command: ArisEditCommand
      if (kind === 0) {
        const occurrenceId = occurrenceIds[Math.floor(rand() * occurrenceIds.length)]
        const occurrence = m1.occurrences.find((o) => o.id === occurrenceId)!
        command = {
          commandId: idGenerator(),
          baseRevision: i,
          kind: 'moveOccurrence',
          affectedSourceIds: [occurrenceId],
          before: { occurrenceId, x: occurrence.bounds.x, y: occurrence.bounds.y },
          after: {
            occurrenceId,
            x: Math.floor(rand() * 500),
            y: Math.floor(rand() * 500)
          },
          origin: 'user'
        }
      } else if (kind === 1) {
        const occurrenceId = occurrenceIds[Math.floor(rand() * occurrenceIds.length)]
        const occurrence = m1.occurrences.find((o) => o.id === occurrenceId)!
        command = {
          commandId: idGenerator(),
          baseRevision: i,
          kind: 'resizeOccurrence',
          affectedSourceIds: [occurrenceId],
          before: {
            occurrenceId,
            width: occurrence.bounds.width,
            height: occurrence.bounds.height
          },
          after: {
            occurrenceId,
            width: Math.floor(rand() * 200),
            height: Math.floor(rand() * 200)
          },
          origin: 'user'
        }
      } else if (kind === 2) {
        const occurrenceId = occurrenceIds[Math.floor(rand() * occurrenceIds.length)]
        const occurrence = m1.occurrences.find((o) => o.id === occurrenceId)!
        command = {
          commandId: idGenerator(),
          baseRevision: i,
          kind: 'restyleOccurrence',
          affectedSourceIds: [occurrenceId],
          before: { occurrenceId, style: { fillColor: occurrence.style.fillColor } },
          after: {
            occurrenceId,
            style: { fillColor: `rgb(${Math.floor(rand() * 255)},0,0)` }
          },
          origin: 'user'
        }
      } else {
        const connectionId = connectionIds[Math.floor(rand() * connectionIds.length)]
        const connection = m1.connectionOccurrences.find((c) => c.id === connectionId)!
        command = {
          commandId: idGenerator(),
          baseRevision: i,
          kind: 'setConnectionRoute',
          affectedSourceIds: [connectionId],
          before: { connectionOccurrenceId: connectionId, route: connection.route },
          after: {
            connectionOccurrenceId: connectionId,
            route: [{ x: Math.floor(rand() * 500), y: Math.floor(rand() * 500) }]
          },
          origin: 'user'
        }
      }
      stack = stack.apply(command)
      applied.push(command)
    }

    const postApply = stack.document

    for (let i = 0; i < 20; i += 1) {
      stack = stack.undo()
    }
    expect(stack.document).toEqual(start)

    for (let i = 0; i < 20; i += 1) {
      stack = stack.redo()
    }
    expect(stack.document).toEqual(postApply)
  })
})
