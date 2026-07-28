import { describe, expect, it } from 'vitest'
import {
  createCommandStack,
  createCommandIdGenerator,
  serializeCommandStack,
  deserializeCommandStack
} from './index'
import { buildTestDocument } from './testFixture'
import type { ArisAttributeOccurrence } from './types'

function attributeValues(
  document: {
    readonly objectDefinitions: ReadonlyMap<
      string,
      { readonly attributes: readonly { readonly type: string; readonly values: readonly { readonly localeId: string | null; readonly text: string }[] }[] }
    >
  },
  definitionId: string,
  type: string
) {
  return document.objectDefinitions.get(definitionId)?.attributes.find((a) => a.type === type)?.values
}

describe('addAttributeValue', () => {
  it('appends an Arabic value while preserving the existing English value', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('attr')
    let stack = createCommandStack(document, { idGenerator })

    const beforeValues = attributeValues(stack.document, 'od1', 'AT_CUSTOM')!

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'addAttributeValue',
      affectedSourceIds: ['od1'],
      before: beforeValues,
      after: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        attributeType: 'AT_CUSTOM',
        value: { localeId: 'ar-SA', text: 'القيمة' }
      },
      origin: 'user'
    })

    const values = attributeValues(stack.document, 'od1', 'AT_CUSTOM')!
    expect(values).toHaveLength(3)
    expect(values.find((v) => v.localeId === 'en-US')?.text).toBe('C1-en')
    expect(values.find((v) => v.localeId === 'ar-SA')?.text).toBe('القيمة')

    stack = stack.undo()
    expect(attributeValues(stack.document, 'od1', 'AT_CUSTOM')).toEqual(beforeValues)
  })

  it('replaces an existing value when the same locale is added again', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('attr')
    let stack = createCommandStack(document, { idGenerator })

    const beforeValues = attributeValues(stack.document, 'od1', 'AT_CUSTOM')!

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'addAttributeValue',
      affectedSourceIds: ['od1'],
      before: beforeValues,
      after: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        attributeType: 'AT_CUSTOM',
        value: { localeId: 'en-US', text: 'C1-new' }
      },
      origin: 'user'
    })

    const values = attributeValues(stack.document, 'od1', 'AT_CUSTOM')!
    expect(values).toHaveLength(2)
    expect(values.find((v) => v.localeId === 'en-US')?.text).toBe('C1-new')
    expect(values.find((v) => v.localeId === 'de-DE')?.text).toBe('C1')

    stack = stack.undo()
    expect(attributeValues(stack.document, 'od1', 'AT_CUSTOM')).toEqual(beforeValues)
  })
})

describe('removeAttributeValue', () => {
  it('removes one locale and leaves the other untouched', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('attr')
    let stack = createCommandStack(document, { idGenerator })

    const beforeValues = attributeValues(stack.document, 'od1', 'AT_CUSTOM')!

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'removeAttributeValue',
      affectedSourceIds: ['od1'],
      before: beforeValues,
      after: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        attributeType: 'AT_CUSTOM',
        localeId: 'de-DE'
      },
      origin: 'user'
    })

    const values = attributeValues(stack.document, 'od1', 'AT_CUSTOM')!
    expect(values).toHaveLength(1)
    expect(values[0].localeId).toBe('en-US')

    stack = stack.undo()
    expect(attributeValues(stack.document, 'od1', 'AT_CUSTOM')).toEqual(beforeValues)
  })

  it('removes the attribute entirely when the last value is removed', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('attr')
    let stack = createCommandStack(document, { idGenerator })

    const beforeValues = attributeValues(stack.document, 'od1', 'AT_DESC')!
    expect(beforeValues).toHaveLength(1)

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'removeAttributeValue',
      affectedSourceIds: ['od1'],
      before: beforeValues,
      after: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        attributeType: 'AT_DESC',
        localeId: 'en-US'
      },
      origin: 'user'
    })

    expect(attributeValues(stack.document, 'od1', 'AT_DESC')).toBeUndefined()

    stack = stack.undo()
    expect(attributeValues(stack.document, 'od1', 'AT_DESC')).toEqual(beforeValues)
  })
})

describe('multi-locale attribute round-trip', () => {
  it('survives apply, undo, serialize, reload, and replay without loss', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('attr')
    const initialDocument = document
    let stack = createCommandStack(document, { idGenerator })

    const beforeValues = attributeValues(stack.document, 'od1', 'AT_CUSTOM')!

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'addAttributeValue',
      affectedSourceIds: ['od1'],
      before: beforeValues,
      after: {
        ownerKind: 'objectDefinition',
        ownerId: 'od1',
        attributeType: 'AT_CUSTOM',
        value: { localeId: 'ar-SA', text: 'القيمة' }
      },
      origin: 'user'
    })

    const afterApply = stack.document
    stack = stack.undo()
    expect(attributeValues(stack.document, 'od1', 'AT_CUSTOM')).toEqual(beforeValues)
    stack = stack.redo()

    const serialized = JSON.parse(JSON.stringify(serializeCommandStack(stack)))
    const restored = deserializeCommandStack(serialized, initialDocument.sourceIndex)
    let replayed = createCommandStack(initialDocument)
    for (const command of restored.undoStack) {
      replayed = replayed.apply(command)
    }

    expect(replayed.document).toEqual(afterApply)
    const values = attributeValues(replayed.document, 'od1', 'AT_CUSTOM')!
    expect(values.find((v) => v.localeId === 'en-US')?.text).toBe('C1-en')
    expect(values.find((v) => v.localeId === 'ar-SA')?.text).toBe('القيمة')
  })
})

describe('setAttributeOccurrencePlacement', () => {
  it('changes text placement on one occurrence without touching siblings or the definition', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('placement')
    let stack = createCommandStack(document, { idGenerator })

    const beforeOcc1 = stack.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ1')!
    const beforePlacement = beforeOcc1.attributeOccurrences.find((a) => a.attributeType === 'AT_NAME')!

    const afterPlacement: ArisAttributeOccurrence = {
      ...beforePlacement,
      offsetX: 99,
      offsetY: 88,
      width: 77,
      height: 66
    }

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'setAttributeOccurrencePlacement',
      affectedSourceIds: ['occ1'],
      before: { occurrenceId: 'occ1', attributeType: 'AT_NAME', placement: beforePlacement },
      after: {
        occurrenceId: 'occ1',
        attributeType: 'AT_NAME',
        placement: afterPlacement
      },
      origin: 'user'
    })

    const occ1 = stack.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ1')!
    const occ2 = stack.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ2')!
    expect(occ1.attributeOccurrences.find((a) => a.attributeType === 'AT_NAME')!.offsetX).toBe(99)
    expect(occ2.attributeOccurrences.find((a) => a.attributeType === 'AT_NAME')).toBeUndefined()
    expect(stack.document.objectDefinitions.get('od1')!.attributes).toEqual(
      document.objectDefinitions.get('od1')!.attributes
    )

    stack = stack.undo()
    const restored = stack.document.models.get('m1')!.occurrences.find((o) => o.id === 'occ1')!
    expect(restored.attributeOccurrences.find((a) => a.attributeType === 'AT_NAME')!).toEqual(beforePlacement)
  })
})
