// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { findOccurrence } from './commandFactory'
import { bootCanvas, shape, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function buildPair(canvas: Harness['canvas']): {
  a: { definitionId: string; occurrenceId: string }
  b: { definitionId: string; occurrenceId: string }
  connectionId: string
} {
  const a = canvas.authoring.createObject({ objectType: 'OT_EVT', name: 'Received', position: { x: 0, y: 0 } })
  const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'Review', position: { x: 0, y: 300 } })
  const connectionId = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
  return { a, b, connectionId }
}

describe('copy/paste identity modes (Section 11.4)', () => {
  it("'shared-definition' paste creates another occurrence of the same definition", () => {
    harness = bootCanvas()
    const { canvas } = harness
    const { a, b } = buildPair(canvas)
    const definitionsBefore = canvas.document.objectDefinitions.size

    canvas.clipboard.copy([shape(canvas, a.occurrenceId), shape(canvas, b.occurrenceId)])
    const result = canvas.clipboard.paste({ mode: 'shared-definition', delta: { x: 500, y: 0 } })

    expect(result.mode).toBe('shared-definition')
    expect(result.occurrenceIds).toHaveLength(2)
    // No new definitions: identity is shared.
    expect(canvas.document.objectDefinitions.size).toBe(definitionsBefore)
    expect(result.definitionIds).toEqual([a.definitionId, b.definitionId])
    expect(findOccurrence(canvas.document, result.occurrenceIds[0])?.definitionId).toBe(a.definitionId)

    // Renaming the original renames the pasted shape too.
    canvas.authoring.renameDefinition(a.definitionId, 'Renamed')
    expect(canvas.document.objectDefinitions.get(a.definitionId)?.names.values['en-US']).toBe('Renamed')
    expect(findOccurrence(canvas.document, result.occurrenceIds[0])?.definitionId).toBe(a.definitionId)

    // Geometry moved by the delta.
    expect(findOccurrence(canvas.document, result.occurrenceIds[0])?.bounds).toMatchObject({ x: 500, y: 0 })
  })

  it("'shared-definition' paste reuses the existing connection definition", () => {
    harness = bootCanvas()
    const { canvas } = harness
    const { a, b, connectionId } = buildPair(canvas)
    const connectionDefinitionsBefore = canvas.document.connectionDefinitions.size
    const originalDefinitionId = canvas.document.models
      .get(canvas.activeModelId)
      ?.connectionOccurrences.find((entry) => entry.id === connectionId)?.definitionId

    canvas.clipboard.copy([shape(canvas, a.occurrenceId), shape(canvas, b.occurrenceId)])
    const result = canvas.clipboard.paste({ mode: 'shared-definition', delta: { x: 500, y: 0 } })

    expect(canvas.document.connectionDefinitions.size).toBe(connectionDefinitionsBefore)
    expect(result.connectionOccurrenceIds).toHaveLength(1)
    const pasted = canvas.document.models
      .get(canvas.activeModelId)
      ?.connectionOccurrences.find((entry) => entry.id === result.connectionOccurrenceIds[0])
    expect(pasted?.definitionId).toBe(originalDefinitionId)
  })

  it("'new-definition' paste clones the definitions with copied names and attributes", () => {
    harness = bootCanvas()
    const { canvas } = harness
    const { a, b } = buildPair(canvas)
    canvas.authoring.setDefinitionAttribute(a.definitionId, 'AT_DESC', [{ localeId: 'en-US', text: 'original' }])
    const definitionsBefore = canvas.document.objectDefinitions.size

    canvas.clipboard.copy([shape(canvas, a.occurrenceId), shape(canvas, b.occurrenceId)])
    const result = canvas.clipboard.paste({ mode: 'new-definition', delta: { x: 500, y: 0 } })

    expect(result.mode).toBe('new-definition')
    expect(canvas.document.objectDefinitions.size).toBe(definitionsBefore + 2)
    expect(result.definitionIds).not.toContain(a.definitionId)
    expect(result.definitionIds).not.toContain(b.definitionId)

    const clonedDefinitionId = result.definitionIds[0]
    const cloned = canvas.document.objectDefinitions.get(clonedDefinitionId)
    expect(cloned?.type).toBe('OT_EVT')
    expect(cloned?.names.values['en-US']).toBe('Received')
    expect(cloned?.attributes.find((entry) => entry.type === 'AT_DESC')?.values[0].text).toBe('original')

    // The clone is independent: renaming the original leaves it alone.
    canvas.authoring.renameDefinition(a.definitionId, 'Renamed original')
    expect(canvas.document.objectDefinitions.get(clonedDefinitionId)?.names.values['en-US']).toBe('Received')
    expect(canvas.document.objectDefinitions.get(a.definitionId)?.names.values['en-US']).toBe('Renamed original')
  })

  it("'new-definition' paste mints a connection definition between the clones", () => {
    harness = bootCanvas()
    const { canvas } = harness
    const { a, b } = buildPair(canvas)
    const connectionDefinitionsBefore = canvas.document.connectionDefinitions.size

    canvas.clipboard.copy([shape(canvas, a.occurrenceId), shape(canvas, b.occurrenceId)])
    const result = canvas.clipboard.paste({ mode: 'new-definition', delta: { x: 500, y: 0 } })

    expect(canvas.document.connectionDefinitions.size).toBe(connectionDefinitionsBefore + 1)
    const pasted = canvas.document.models
      .get(canvas.activeModelId)
      ?.connectionOccurrences.find((entry) => entry.id === result.connectionOccurrenceIds[0])
    const definition = canvas.document.connectionDefinitions.get(pasted?.definitionId ?? '')
    expect(definition?.type).toBe('CT_ACTIV_1')
    expect(definition?.fromObjectDefinitionId).toBe(result.definitionIds[0])
    expect(definition?.toObjectDefinitionId).toBe(result.definitionIds[1])
  })

  it('undoes a paste as one gesture, in either mode', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const { a, b } = buildPair(canvas)
    canvas.clipboard.copy([shape(canvas, a.occurrenceId), shape(canvas, b.occurrenceId)])

    for (const mode of ['shared-definition', 'new-definition'] as const) {
      const occurrencesBefore = canvas.document.models.get(canvas.activeModelId)?.occurrences.length ?? 0
      const definitionsBefore = canvas.document.objectDefinitions.size
      canvas.clipboard.paste({ mode })
      expect(canvas.document.models.get(canvas.activeModelId)?.occurrences.length).toBe(occurrencesBefore + 2)
      canvas.undo()
      expect(canvas.document.models.get(canvas.activeModelId)?.occurrences.length).toBe(occurrencesBefore)
      expect(canvas.document.objectDefinitions.size).toBe(definitionsBefore)
    }
  })

  it('refuses to guess: paste requires an explicit identity mode', () => {
    harness = bootCanvas()
    const { canvas } = harness
    // Type-level guarantee, checked at runtime for an empty clipboard too.
    expect(canvas.clipboard.isEmpty()).toBe(true)
    expect(() => canvas.clipboard.paste({ mode: 'shared-definition' })).toThrow(/Nothing to paste/u)
  })

  it('cut removes the copied occurrences but keeps their definitions', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const { a, b } = buildPair(canvas)
    const definitionsBefore = canvas.document.objectDefinitions.size

    canvas.clipboard.cut([shape(canvas, a.occurrenceId), shape(canvas, b.occurrenceId)])

    expect(canvas.document.models.get(canvas.activeModelId)?.occurrences).toHaveLength(0)
    expect(canvas.document.objectDefinitions.size).toBe(definitionsBefore)

    const pasted = canvas.clipboard.paste({ mode: 'shared-definition', delta: { x: 0, y: 0 } })
    expect(pasted.definitionIds).toEqual([a.definitionId, b.definitionId])
    expect(canvas.document.models.get(canvas.activeModelId)?.occurrences).toHaveLength(2)
  })
})
