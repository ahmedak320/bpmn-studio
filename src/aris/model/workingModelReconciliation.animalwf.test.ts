import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildArisRenderModel } from '../renderer/buildRenderModel'
import type { ArisRenderSourceInput } from '../renderer/input'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { buildFromSource, resolveFreeTextModelAttributeBinding } from './buildFromSource'
import type { ArisWorkingDocument } from './types'

/**
 * Two-sided reconciliation guard for the AnimalWF reference export (plan §6.4 "retain
 * everything", §8.2 definition-vs-occurrence, §9.1 preserve-on-edit, §12.1 source visual inputs).
 *
 * Why this file exists: three separate classes of silent loss have shipped into the working model
 * (69 free-text occurrences dropped entirely; 123 connection-occurrence attribute placements with
 * nowhere to live; 42 free-text auxiliary attribute values discarded), and none was caught,
 * because the existing accounting only ever counted *source* records and reported "0 unaccounted".
 * Counting one side proves nothing. Every assertion below measures the source side AND the
 * working-model side independently and asserts they agree, so a construct that stops reaching the
 * model fails here even though the byte-span writer would still round-trip it untouched.
 *
 * The absolute constants are fixture-identity anchors: if the reference export is ever replaced,
 * they fail loudly rather than quietly re-baselining against whatever the model happens to build.
 *
 * Naming: `*.animalwf.test.ts` is excluded from the default vitest project and from
 * `check:no-skips`, and runs only via `npm run test:aris:animalwf`. The module-load guard below
 * throws if the private fixture is absent — a loud failure, never a skip.
 */
const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

type SemanticIndex = ArisWorkingDocument['sourceIndex']

let index: SemanticIndex
let document: ArisWorkingDocument

beforeAll(() => {
  const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')
  index = buildSemanticArisDocument(tokenizeXmlDocument(xml)).index
  document = buildFromSource(index)
})

function models() {
  return [...document.models.values()]
}

/** Source `AttrOcc` records grouped by the element that owns them (`ObjOcc` or `CxnOcc`). */
function sourceAttributeOccurrencesByOwnerElement(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of index.attributeOccurrences) {
    const owner =
      (record.parsed as { readonly ownerElementName?: string | null }).ownerElementName ?? 'none'
    counts[owner] = (counts[owner] ?? 0) + 1
  }
  return counts
}

/** Source `AttrDef` records grouped by owning element, counted as records and as values. */
function sourceAttributeDefinitions(ownerElementName: string): {
  readonly records: number
  readonly values: number
} {
  let records = 0
  let values = 0
  for (const record of index.attributes) {
    const parsed = record.parsed as {
      readonly ownerElementName?: string | null
      readonly values?: readonly unknown[]
    }
    if (parsed.ownerElementName !== ownerElementName) continue
    records += 1
    values += parsed.values?.length ?? 0
  }
  return { records, values }
}

describe('AnimalWF working model reconciles against the source index — structural records', () => {
  it('carries every structural record into the working model, source count === model count', () => {
    const allOccurrences = models().flatMap((model) => model.occurrences)
    const allConnections = models().flatMap((model) => model.connectionOccurrences)
    const allLanes = models().flatMap((model) => model.lanes)
    const allFreeText = models().flatMap((model) => model.freeText)

    // Source side.
    expect(index.models.size).toBe(8)
    expect(index.objectDefinitions.size).toBe(279)
    expect(index.objectOccurrences.size).toBe(494)
    expect(index.connectionDefinitions.size).toBe(465)
    expect(index.connectionOccurrences.size).toBe(465)
    expect(index.lanes.size).toBe(16)
    expect(index.freeTextOccurrences).toHaveLength(69)
    expect(index.attachmentOccurrences ?? []).toHaveLength(14)

    // Model side — measured independently, must agree with the source side.
    expect(document.models.size).toBe(index.models.size)
    expect(document.objectDefinitions.size).toBe(index.objectDefinitions.size)
    expect(document.connectionDefinitions.size).toBe(index.connectionDefinitions.size)
    expect(allOccurrences).toHaveLength(index.objectOccurrences.size)
    expect(allConnections).toHaveLength(index.connectionOccurrences.size)
    expect(allLanes).toHaveLength(index.lanes.size)
    expect(allFreeText).toHaveLength(index.freeTextOccurrences.length)

    // Embedded OLE attachments — the third construct found with zero model representation.
    const allAttachments = models().flatMap((model) => model.attachments ?? [])
    expect(allAttachments).toHaveLength((index.attachmentOccurrences ?? []).length)
    expect(new Set(allAttachments.map((entry) => entry.id)).size).toBe(14)
    for (const attachment of allAttachments) {
      expect(attachment.id).not.toBe('')
      expect(document.models.has(attachment.modelId)).toBe(true)
      // The binary payload stays in the source index; the model records that it exists.
      expect(attachment.blobCount).toBeGreaterThan(0)
    }
  })

  it('leaves zero source ids absent from the working model', () => {
    const modelSideIds = new Set<string>([
      ...document.models.keys(),
      ...document.objectDefinitions.keys(),
      ...document.connectionDefinitions.keys(),
      ...models().flatMap((model) => model.occurrences.map((entry) => entry.id)),
      ...models().flatMap((model) => model.connectionOccurrences.map((entry) => entry.id)),
      ...models().flatMap((model) => model.lanes.map((entry) => entry.id))
    ])

    const sourceIds = [
      ...index.models.keys(),
      ...index.objectDefinitions.keys(),
      ...index.connectionDefinitions.keys(),
      ...index.objectOccurrences.keys(),
      ...index.connectionOccurrences.keys(),
      ...index.lanes.keys()
    ]

    const absent = sourceIds.filter((id) => !modelSideIds.has(id))
    expect(absent).toEqual([])
  })
})

describe('AnimalWF working model reconciles against the source index — attribute placements', () => {
  it('carries all 774 attribute occurrences, including the 123 owned by connections', () => {
    const bySourceOwner = sourceAttributeOccurrencesByOwnerElement()

    // Source side: `<AttrOcc>` is a legal child of both `<ObjOcc>` and `<CxnOcc>`.
    expect(bySourceOwner).toEqual({ ObjOcc: 651, CxnOcc: 123 })

    const onObjects = models()
      .flatMap((model) => model.occurrences)
      .reduce((total, occurrence) => total + occurrence.attributeOccurrences.length, 0)
    const onConnections = models()
      .flatMap((model) => model.connectionOccurrences)
      .reduce((total, connection) => total + (connection.attributeOccurrences?.length ?? 0), 0)

    expect(onObjects).toBe(bySourceOwner.ObjOcc)
    // The regression this guard exists for: this was 0 while the source carried 123.
    expect(onConnections).toBe(bySourceOwner.CxnOcc)
    expect(onObjects + onConnections).toBe(index.attributeOccurrences.length)
  })

  it('exposes every connection placement field the renderer needs (plan §12.1)', () => {
    const placements = models()
      .flatMap((model) => model.connectionOccurrences)
      .flatMap((connection) => connection.attributeOccurrences ?? [])

    expect(placements).toHaveLength(123)
    for (const placement of placements) {
      expect(placement.attributeType).not.toBe('')
      // Placement is fully specified: no field silently collapses to `undefined`.
      expect(placement.port).not.toBeUndefined()
      expect(placement.alignment).not.toBeUndefined()
      expect(placement.offsetX).not.toBeUndefined()
      expect(placement.offsetY).not.toBeUndefined()
      expect(placement.symbolFlag).not.toBeUndefined()
      expect(placement.fontStyleSheetId).not.toBeUndefined()
    }
    // Every placement carries a symbol/text discriminator and a font, not just geometry.
    expect(placements.every((placement) => placement.symbolFlag !== null)).toBe(true)
    expect(placements.every((placement) => placement.fontStyleSheetId !== null)).toBe(true)
  })

  it('keeps connection placements occurrence-local, never on the definition (plan §8.2)', () => {
    const connections = models().flatMap((model) => model.connectionOccurrences)
    const withPlacements = connections.filter(
      (connection) => (connection.attributeOccurrences?.length ?? 0) > 0
    )
    expect(withPlacements.length).toBeGreaterThan(0)

    // Group occurrences by the definition they share, then prove that sharing a definition does
    // not imply sharing placements: at least one definition has sibling occurrences that differ.
    const byDefinition = new Map<string, typeof connections>()
    for (const connection of connections) {
      const siblings = byDefinition.get(connection.definitionId) ?? []
      siblings.push(connection)
      byDefinition.set(connection.definitionId, siblings)
    }

    for (const connection of withPlacements) {
      const siblings = byDefinition.get(connection.definitionId) ?? []
      for (const sibling of siblings) {
        if (sibling.id === connection.id) continue
        // A sibling must not have inherited this occurrence's placement array by reference.
        expect(sibling.attributeOccurrences).not.toBe(connection.attributeOccurrences)
      }
      // No connection *definition* grew an occurrence-level placement field.
      const definition = document.connectionDefinitions.get(connection.definitionId)
      expect(definition).toBeDefined()
      expect('attributeOccurrences' in (definition as object)).toBe(false)
    }
  })
})

describe('AnimalWF working model reconciles against the source index — attribute values', () => {
  it('reconciles object-definition, model and lane attributes exactly', () => {
    const objectDefinitions = sourceAttributeDefinitions('ObjDef')
    const modelAttributes = sourceAttributeDefinitions('Model')
    const laneAttributes = sourceAttributeDefinitions('Lane')

    expect(objectDefinitions.records).toBe(367)
    expect(modelAttributes.records).toBe(22)
    expect(laneAttributes.records).toBe(16)

    // Model side: names live in `names`, everything else in `attributes`. The two together must
    // account for every source `AttrDef` record.
    const definitions = [...document.objectDefinitions.values()]
    const namedDefinitions = definitions.filter(
      (definition) => Object.keys(definition.names.values).length > 0
    ).length
    const definitionAttributes = definitions.reduce(
      (total, definition) => total + definition.attributes.length,
      0
    )
    expect(namedDefinitions + definitionAttributes).toBe(objectDefinitions.records)

    const namedModels = models().filter(
      (model) => Object.keys(model.names.values).length > 0
    ).length
    const modelOwnAttributes = models().reduce((total, model) => total + model.attributes.length, 0)
    expect(namedModels + modelOwnAttributes).toBe(modelAttributes.records)

    const lanes = models().flatMap((model) => model.lanes)
    const namedLanes = lanes.filter((lane) => Object.keys(lane.names.values).length > 0).length
    expect(namedLanes).toBe(laneAttributes.records)
  })

  it('carries all 132 free-text attribute values, including the 42 model-attribute bindings', () => {
    const freeTextSource = sourceAttributeDefinitions('FFTextDef')
    expect(freeTextSource.records).toBe(90)
    expect(freeTextSource.values).toBe(132)

    const notes = models().flatMap((model) => model.freeText)
    expect(notes).toHaveLength(69)

    // One `<FFTextDef>` may in principle be referenced by more than one `<FFTextOcc>`; count each
    // definition once so the model side is a true reconciliation and not a double count.
    const seenDefinitions = new Set<string>()
    let textValues = 0
    let auxiliaryValues = 0
    for (const note of notes) {
      const definitionId = note.definitionId
      if (definitionId === null || seenDefinitions.has(definitionId)) continue
      seenDefinitions.add(definitionId)
      textValues += Object.keys(note.text.values).length
      for (const attribute of note.attributes ?? []) auxiliaryValues += attribute.values.length
    }

    expect(textValues).toBe(90)
    // The regression this guard exists for: this was 0 while the source carried 42.
    expect(auxiliaryValues).toBe(42)
    expect(textValues + auxiliaryValues).toBe(freeTextSource.values)
  })

  it('resolves the 21 model-attribute placeholder notes that carry no static text', () => {
    const notes = models().flatMap((model) => model.freeText)
    const bindings = notes
      .map((note) => ({ note, binding: resolveFreeTextModelAttributeBinding(note) }))
      .filter((entry) => entry.binding !== null)

    expect(bindings).toHaveLength(21)
    for (const { note, binding } of bindings) {
      // These notes have no `AT_NAME` at all — the binding is their entire content, so dropping
      // it left them permanently blank.
      expect(note.text.fallback).toBeNull()
      expect(binding?.attributeType).toMatch(/^AT_/)
      expect(binding?.typeNumber).not.toBeNull()
    }

    const byAttributeType = new Map<string, number>()
    for (const { binding } of bindings) {
      const key = binding?.attributeType ?? ''
      byAttributeType.set(key, (byAttributeType.get(key) ?? 0) + 1)
    }
    expect(Object.fromEntries(byAttributeType)).toEqual({
      AT_NAME: 7,
      AT_ID: 7,
      AT_PERS_RESP: 7
    })

    // The remaining notes are static text and must still carry it.
    const staticNotes = notes.filter((note) => resolveFreeTextModelAttributeBinding(note) === null)
    expect(staticNotes).toHaveLength(48)
    expect(staticNotes.every((note) => note.text.fallback !== null)).toBe(true)
  })
})

describe('AnimalWF render model reconciles too — the model layer is not the only consumer', () => {
  // The renderer reads the *source index* directly rather than the working model, so closing a
  // gap in `buildFromSource` does not close it for rendering. Both consumers are asserted here so
  // a construct cannot reach one and be dropped by the other (plan §12.1).
  function renderModel() {
    const result = buildArisRenderModel(index as unknown as ArisRenderSourceInput)
    return result.models
  }

  it('carries all 123 connection label placements into the render model', () => {
    const placements = renderModel()
      .flatMap((model) => model.connections)
      .flatMap((connection) => connection.attributeOccurrences)

    // Before the fix `RenderConnection` had no placement field at all and this was 0.
    expect(placements).toHaveLength(123)
    expect(placements.every((placement) => placement.symbolFlag !== null)).toBe(true)
  })

  it('renders the 21 model-attribute placeholder notes instead of drawing them blank', () => {
    const notes = renderModel().flatMap((model) => model.freeText)
    expect(notes).toHaveLength(69)

    const bound = notes.filter((note) => note.modelAttributeBinding !== null)
    expect(bound).toHaveLength(21)
    // The point of the binding: each of these resolves to real text from its owning model.
    for (const note of bound) {
      expect(note.text).not.toBeNull()
      expect(note.text?.rawText.trim()).not.toBe('')
    }

    // Static notes keep rendering their own text — the binding path did not displace them.
    const staticNotes = notes.filter((note) => note.modelAttributeBinding === null)
    expect(staticNotes).toHaveLength(48)
  })
})
