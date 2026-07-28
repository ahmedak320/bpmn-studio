// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { ArisCanvasCommandError } from './commandBridge'
import { findConnectionOccurrence, findFreeText, findLane, findOccurrence } from './commandFactory'
import { arisBusinessObject, freeTextElementId, laneElementId } from './elements'
import { bytesToBase64 } from './attachments'
import { bootCanvas, shape, twoModelDocument, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

describe('authoring operations (Section 11.4)', () => {
  it('creates a definition and its occurrence in one gesture', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 20, y: 30 }
    })
    expect(canvas.document.objectDefinitions.get(created.definitionId)?.type).toBe('OT_FUNC')
    expect(findOccurrence(canvas.document, created.occurrenceId)?.definitionId).toBe(created.definitionId)
    expect(created.commands).toHaveLength(1)
    expect(created.commands[0].kind).toBe('transaction')
  })

  it('creates another occurrence of an existing definition', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const first = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'Approve', position: { x: 0, y: 0 } })
    const definitionCountBefore = canvas.document.objectDefinitions.size

    const secondOccurrenceId = canvas.authoring.createAdditionalOccurrence({
      definitionId: first.definitionId,
      position: { x: 400, y: 0 }
    })

    expect(canvas.document.objectDefinitions.size).toBe(definitionCountBefore)
    expect(findOccurrence(canvas.document, secondOccurrenceId)?.definitionId).toBe(first.definitionId)
    // Renaming the definition renames both shapes.
    canvas.authoring.renameDefinition(first.definitionId, 'Approve v2')
    expect(arisBusinessObject(shape(canvas, first.occurrenceId))).toMatchObject({ name: 'Approve v2' })
    expect(arisBusinessObject(shape(canvas, secondOccurrenceId))).toMatchObject({ name: 'Approve v2' })
  })

  it('renames a definition and edits its attributes', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'Old', position: { x: 0, y: 0 } })

    canvas.authoring.renameDefinition(created.definitionId, 'New')
    expect(canvas.commandLog[canvas.commandLog.length - 1]).toMatchObject({
      kind: 'setLocalizedName',
      before: { value: 'Old' },
      after: { value: 'New' }
    })

    canvas.authoring.setDefinitionAttribute(created.definitionId, 'AT_DESC', [
      { localeId: 'en-US', text: 'Approve the application' }
    ])
    const attribute = canvas.document.objectDefinitions
      .get(created.definitionId)
      ?.attributes.find((entry) => entry.type === 'AT_DESC')
    expect(attribute?.values).toEqual([{ localeId: 'en-US', text: 'Approve the application' }])

    canvas.undo()
    // `setAttribute` restores the previous value list. The model lane's
    // `updateAttributes` writes an entry rather than removing one, so undo
    // leaves an empty-valued `AT_DESC` record behind — no values, and the
    // writer emits nothing for it.
    expect(
      canvas.document.objectDefinitions.get(created.definitionId)?.attributes.find((entry) => entry.type === 'AT_DESC')
        ?.values
    ).toEqual([])
  })

  it('moves, resizes and restyles an occurrence', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 0 } })

    canvas.authoring.moveOccurrence(created.occurrenceId, { x: 12, y: 34 })
    canvas.authoring.resizeOccurrence(created.occurrenceId, { width: 210, height: 90 })
    canvas.authoring.restyleOccurrence(created.occurrenceId, { fillColor: '#123456', strokeWidth: 3 })

    expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toEqual({
      x: 12,
      y: 34,
      width: 210,
      height: 90
    })
    expect(findOccurrence(canvas.document, created.occurrenceId)?.style).toMatchObject({
      fillColor: '#123456',
      strokeWidth: 3
    })
    const element = shape(canvas, created.occurrenceId)
    expect([element.x, element.y, element.width, element.height]).toEqual([12, 34, 210, 90])
  })

  it('creates a typed connection definition and occurrence, then reroutes it', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 300 } })
    const connectionId = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)

    const occurrence = findConnectionOccurrence(canvas.document, connectionId)
    expect(canvas.document.connectionDefinitions.get(occurrence?.definitionId ?? '')).toMatchObject({
      type: 'CT_ACTIV_1',
      fromObjectDefinitionId: a.definitionId,
      toObjectDefinitionId: b.definitionId
    })

    canvas.authoring.rerouteConnection(connectionId, [
      { x: 50, y: 100 },
      { x: 150, y: 150 },
      { x: 50, y: 300 }
    ])
    expect(findConnectionOccurrence(canvas.document, connectionId)?.route).toHaveLength(3)
    const connectionElement = canvas.elementRegistry.get(connectionId) as unknown as {
      waypoints: { x: number; y: number }[]
    }
    expect(connectionElement.waypoints[1]).toEqual({ x: 150, y: 150 })

    canvas.undo()
    expect(findConnectionOccurrence(canvas.document, connectionId)?.route).toHaveLength(0)
  })

  it('reuses one connection definition for a second occurrence of the same pair', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 300 } })
    canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    const definitionCount = canvas.document.connectionDefinitions.size

    canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    expect(canvas.document.connectionDefinitions.size).toBe(definitionCount)
    expect(canvas.document.models.get(canvas.activeModelId)?.connectionOccurrences).toHaveLength(2)
  })

  it('reconnects a connection to a new target', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 300 } })
    const c = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 400, y: 300 } })
    const connectionId = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)

    canvas.authoring.reconnect(connectionId, a.occurrenceId, c.occurrenceId)

    const model = canvas.document.models.get(canvas.activeModelId)
    expect(model?.connectionOccurrences).toHaveLength(1)
    const reconnected = model?.connectionOccurrences[0]
    expect(reconnected?.targetOccurrenceId).toBe(c.occurrenceId)
    // The definition matches the new endpoint definitions.
    expect(canvas.document.connectionDefinitions.get(reconnected?.definitionId ?? '')).toMatchObject({
      fromObjectDefinitionId: a.definitionId,
      toObjectDefinitionId: c.definitionId
    })

    canvas.undo()
    expect(canvas.document.models.get(canvas.activeModelId)?.connectionOccurrences[0].targetOccurrenceId).toBe(
      b.occurrenceId
    )
  })

  it('adds and edits a lane', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const laneId = canvas.authoring.addLane({ name: 'Registry', orientation: 'horizontal', startBorder: 0, endBorder: 300 })

    expect(findLane(canvas.document, laneId)?.names.fallback).toBe('Registry')
    expect(canvas.elementRegistry.get(laneElementId(laneId))).toBeTruthy()

    canvas.authoring.editLane(laneId, { name: 'Licensing', endBorder: 420 })
    expect(findLane(canvas.document, laneId)?.names.fallback).toBe('Licensing')
    expect(findLane(canvas.document, laneId)?.endBorder).toBe(420)
    expect(shape(canvas, laneElementId(laneId)).height).toBe(420)

    canvas.undo()
    expect(findLane(canvas.document, laneId)?.names.fallback).toBe('Registry')
  })

  it('adds and edits free text', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const freeTextId = canvas.authoring.addFreeText({
      text: 'Draft',
      bounds: { x: 10, y: 10, width: 200, height: 40 }
    })
    expect(findFreeText(canvas.document, freeTextId)?.text.fallback).toBe('Draft')
    expect(canvas.elementRegistry.get(freeTextElementId(freeTextId))).toBeTruthy()

    canvas.authoring.editFreeText(freeTextId, { text: 'Final', bounds: { x: 20, y: 20, width: 240, height: 60 } })
    expect(findFreeText(canvas.document, freeTextId)?.text.fallback).toBe('Final')
    expect(shape(canvas, freeTextElementId(freeTextId)).width).toBe(240)

    canvas.undo()
    expect(findFreeText(canvas.document, freeTextId)?.text.fallback).toBe('Draft')
  })

  it('adds and removes a linked-model assignment', () => {
    const { document, first, second } = twoModelDocument()
    harness = bootCanvas({ document, modelId: first })
    const { canvas } = harness
    const created = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 0 } })

    canvas.authoring.addModelAssignment(created.definitionId, second)
    expect(canvas.document.objectDefinitions.get(created.definitionId)?.linkedModelIds).toEqual([second])

    canvas.authoring.removeModelAssignment(created.definitionId, second)
    expect(canvas.document.objectDefinitions.get(created.definitionId)?.linkedModelIds).toEqual([])

    canvas.undo()
    expect(canvas.document.objectDefinitions.get(created.definitionId)?.linkedModelIds).toEqual([second])
  })

  it('adds, downloads and removes an attachment', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 0 } })
    const payload = new Uint8Array([0x41, 0x52, 0x49, 0x53])

    canvas.authoring.addAttachment(created.definitionId, {
      id: 'att-1',
      fileName: 'policy.txt',
      mimeType: 'text/plain',
      size: payload.byteLength,
      dataBase64: bytesToBase64(payload)
    })

    expect(canvas.authoring.listAttachments(created.definitionId)).toHaveLength(1)
    const downloaded = canvas.authoring.downloadAttachment(created.definitionId, 'att-1')
    expect(downloaded.fileName).toBe('policy.txt')
    expect([...downloaded.bytes]).toEqual([...payload])

    canvas.authoring.removeAttachment(created.definitionId, 'att-1')
    expect(canvas.authoring.listAttachments(created.definitionId)).toHaveLength(0)

    canvas.undo()
    expect(canvas.authoring.listAttachments(created.definitionId)).toHaveLength(1)
    expect(() => canvas.authoring.downloadAttachment(created.definitionId, 'nope')).toThrow(/No attachment/u)
  })

  it('deletes an occurrence without deleting its definition', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 0 } })

    canvas.authoring.deleteOccurrence(created.occurrenceId)

    expect(findOccurrence(canvas.document, created.occurrenceId)).toBeUndefined()
    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(true)
    canvas.undo()
    expect(findOccurrence(canvas.document, created.occurrenceId)).toBeTruthy()
  })

  it('requires a separate confirmation to delete an unused definition', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'Approve', position: { x: 0, y: 0 } })

    // While an occurrence exists the request reports it and refuses deletion.
    const inUse = canvas.authoring.requestDeleteDefinition(created.definitionId)
    expect(inUse).toMatchObject({ occurrenceCount: 1, unused: false, deletable: false, name: 'Approve' })
    expect(() => canvas.authoring.confirmDeleteDefinition(created.definitionId, { confirmed: true })).toThrow(
      /still has 1 occurrence/u
    )
    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(true)

    // Remove the occurrence; the definition is now unused but still present.
    canvas.authoring.deleteOccurrence(created.occurrenceId)
    const unused = canvas.authoring.requestDeleteDefinition(created.definitionId)
    expect(unused).toMatchObject({ occurrenceCount: 0, unused: true, deletable: true })
    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(true)

    // Requesting alone deletes nothing; confirmation is mandatory.
    expect(() => canvas.authoring.confirmDeleteDefinition(created.definitionId, { confirmed: false })).toThrow(
      ArisCanvasCommandError
    )
    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(true)

    canvas.authoring.confirmDeleteDefinition(created.definitionId, { confirmed: true })
    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(false)
    expect(canvas.commandLog[canvas.commandLog.length - 1].kind).toBe('deleteDefinition')

    canvas.undo()
    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(true)
  })

  it('aligns and distributes occurrences in one gesture each', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 50, y: 300 } })
    const c = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 90, y: 600 } })
    const historyBefore = canvas.commandLog.length

    canvas.modeling.alignElements(
      [shape(canvas, a.occurrenceId), shape(canvas, b.occurrenceId), shape(canvas, c.occurrenceId)],
      { left: 0 }
    )

    expect(canvas.commandLog).toHaveLength(historyBefore + 2)
    expect(findOccurrence(canvas.document, b.occurrenceId)?.bounds.x).toBe(0)
    expect(findOccurrence(canvas.document, c.occurrenceId)?.bounds.x).toBe(0)

    canvas.undo()
    expect(findOccurrence(canvas.document, b.occurrenceId)?.bounds.x).toBe(50)
    expect(findOccurrence(canvas.document, c.occurrenceId)?.bounds.x).toBe(90)
  })

  it('finds and selects an element by caption (search/select)', () => {
    harness = bootCanvas()
    const { canvas } = harness
    canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'Register animal', position: { x: 0, y: 0 } })
    const other = canvas.authoring.createObject({ objectType: 'OT_EVT', name: 'Animal registered', position: { x: 0, y: 300 } })

    const hits = canvas.search.find('registered')
    expect(hits.map((hit) => hit.elementId)).toEqual([other.occurrenceId])

    const selected = canvas.search.findAndSelect('registered')
    expect(selected?.elementId).toBe(other.occurrenceId)
    expect(canvas.selection.get().map((entry) => entry.id)).toEqual([other.occurrenceId])
  })
})
