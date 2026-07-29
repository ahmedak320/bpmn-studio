import { describe, expect, it } from 'vitest'
import { buildFromSource } from '../model/buildFromSource'
import { applyCommand, type ArisEditCommand, type ArisCommandKind } from '../model/commands'
import type {
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisFreeText,
  ArisLane,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisWorkingDocument
} from '../model/types'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import {
  applyAmlEdits,
  buildWriterSourceView,
  declaredIds,
  parseArisId,
  readWriterSourceView,
  verifyUnchangedRegions,
  type WriterSourceView
} from '../writer'
import {
  FIXTURE_IDS,
  FIXTURE_LOCALE_AR,
  FIXTURE_LOCALE_EN,
  SAMPLE_AML
} from '../writer/testFixture'
import {
  buildArisDerivedEdits,
  derivedAmlFileName,
  exportArisDerivedAml,
  prepareArisDerivedExport
} from './arisDerivedExport'

/**
 * Derived-export mapping tests (plan §9.4).
 *
 * The fixture is the writer's own synthetic AnimalWF-shaped export, because it is the only
 * fixture in the repository that reproduces the things the mapping has to survive: locale ids
 * written as entity references, an unknown `<VendorExtension>` element, a comment between
 * records, a single-quoted attribute, and a `ToCxnOccs.IdRefs` list with trailing whitespace.
 *
 * Every live document below is produced by running REAL commands through `applyCommand`, so a
 * test can only pass if the mapping understands what the canvas actually publishes.
 */

interface Fixture {
  readonly document: ArisWorkingDocument
  readonly view: WriterSourceView
}

let cached: Fixture | null = null

async function fixture(): Promise<Fixture> {
  if (cached) return cached
  const bytes = new TextEncoder().encode(SAMPLE_AML)
  const sourcePackage = await createArisXmlSourcePackage({
    name: 'fixture.aml',
    relPath: null,
    bytes
  })
  cached = {
    document: buildFromSource(sourcePackage.index),
    view: readWriterSourceView(SAMPLE_AML)
  }
  return cached
}

let sequence = 0

function run(
  document: ArisWorkingDocument,
  kind: ArisCommandKind,
  after: unknown,
  affected: readonly string[] = []
): ArisWorkingDocument {
  sequence += 1
  const command: ArisEditCommand = {
    commandId: `cmd.${sequence}`,
    baseRevision: document.revision,
    kind,
    affectedSourceIds: affected,
    before: null,
    after,
    origin: 'user'
  }
  return applyCommand(document, command)
}

/** A deterministic random source so an allocated id is assertable. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function derive(
  original: ArisWorkingDocument,
  live: ArisWorkingDocument
): ReturnType<typeof prepareArisDerivedExport> {
  return prepareArisDerivedExport({
    originalText: SAMPLE_AML,
    original,
    live,
    random: seededRandom(20_260_729)
  })
}

function expectClean(preview: ReturnType<typeof prepareArisDerivedExport>): void {
  const failed = preview.result.validation.checks.filter((check) => !check.passed)
  expect(failed.map((check) => ({ check: check.check, first: check.issues[0]?.message }))).toEqual(
    []
  )
  expect(preview.unmapped).toEqual([])
}

/** Re-parse the derived document through the lossless tokenizer and project it again. */
function reparse(text: string): WriterSourceView {
  return buildWriterSourceView(text, tokenizeXmlDocument(text))
}

describe('derived AML export mapping', () => {
  it('renames a definition by patching only the name it changed', async () => {
    const { document, view } = await fixture()
    const live = run(document, 'setLocalizedName', {
      ownerKind: 'objectDefinition',
      ownerId: FIXTURE_IDS.activity,
      localeId: FIXTURE_LOCALE_EN,
      value: 'Register animal (revised)'
    })

    const preview = derive(document, live)
    expectClean(preview)
    expect(preview.editCount).toBe(1)
    expect(preview.result.text).toContain('TextValue="Register animal (revised)"')
    expect(preview.result.text).not.toContain('TextValue="Register animal"')

    // Unknown siblings, comments, quote style and the untouched Arabic value all survive.
    expect(preview.result.text).toContain(
      '<VendorExtension vendor:flavour="internal" retained="yes"/>'
    )
    expect(preview.result.text).toContain('<!-- one business group, kept verbatim on export -->')
    expect(preview.result.text).toContain("Creator='fixture'")
    expect(preview.result.text).toContain('TextValue="&#1578;&#1587;&#1580;&#1610;&#1604;"')

    // Every byte outside the one replaced value is identical to the original.
    const patched = applyAmlEdits(SAMPLE_AML, buildArisDerivedEdits(view, document, live).edits)
    const unchanged = verifyUnchangedRegions(SAMPLE_AML, patched)
    expect(unchanged.replacedCharacters).toBe('Register animal'.length)
    expect(unchanged.insertedCharacters).toBe('Register animal (revised)'.length)
    expect(unchanged.unchangedCharacters).toBe(SAMPLE_AML.length - 'Register animal'.length)

    // The derived document re-parses with exactly the same record shape.
    const derived = reparse(preview.result.text)
    expect(declaredIds(derived)).toEqual(declaredIds(view))
  })

  it('adds an Arabic value beside an existing English one without moving it', async () => {
    const { document } = await fixture()
    const live = run(document, 'setLocalizedName', {
      ownerKind: 'objectDefinition',
      ownerId: FIXTURE_IDS.startEvent,
      localeId: FIXTURE_LOCALE_AR,
      value: 'طلب وارد'
    })

    const preview = derive(document, live)
    expectClean(preview)
    // The locale id is the source's own raw entity reference, not an expanded number.
    expect(preview.result.text).toContain(`<AttrValue LocaleId="${FIXTURE_LOCALE_AR}">`)
    expect(preview.result.text).toContain('TextValue="طلب وارد"')
    // The English value it sits beside is untouched.
    expect(preview.result.text).toContain('TextValue="Request received"')

    const derived = reparse(preview.result.text)
    expect(declaredIds(derived)).toEqual(declaredIds(await fixture().then((f) => f.view)))
  })

  it('renames a model and a connection definition through the same mapping', async () => {
    const { document } = await fixture()
    let live = run(document, 'setLocalizedName', {
      ownerKind: 'model',
      ownerId: FIXTURE_IDS.model,
      localeId: FIXTURE_LOCALE_EN,
      value: 'Animal registration v2'
    })
    live = run(live, 'setLocalizedName', {
      ownerKind: 'connectionDefinition',
      ownerId: FIXTURE_IDS.connectionDefinition,
      localeId: FIXTURE_LOCALE_EN,
      value: 'leads to'
    })

    const preview = derive(document, live)
    expectClean(preview)
    expect(preview.result.text).toContain('TextValue="Animal registration v2"')
    expect(preview.result.text).toContain('TextValue="leads to"')
    // The connection definition had no <AttrDef> at all, so one was created inside <CxnDef>.
    const derived = reparse(preview.result.text)
    const connection = derived.byId.get(FIXTURE_IDS.connectionDefinition)
    expect(connection?.name).toBe('CxnDef')
  })

  it('sets and adds attribute values on a definition', async () => {
    const { document } = await fixture()
    let live = run(document, 'setAttribute', {
      ownerKind: 'objectDefinition',
      ownerId: FIXTURE_IDS.activity,
      attributeType: 'AT_DESC',
      values: [{ localeId: FIXTURE_LOCALE_EN, text: 'Registers a new animal.' }]
    })
    live = run(live, 'addAttributeValue', {
      ownerKind: 'objectDefinition',
      ownerId: FIXTURE_IDS.activity,
      attributeType: 'AT_DESC',
      value: { localeId: FIXTURE_LOCALE_AR, text: 'تسجيل حيوان جديد' }
    })

    const preview = derive(document, live)
    expectClean(preview)
    expect(preview.result.text).toContain('<AttrDef AttrDef.Type="AT_DESC">')
    expect(preview.result.text).toContain('TextValue="Registers a new animal."')
    expect(preview.result.text).toContain('TextValue="تسجيل حيوان جديد"')
  })

  it('removes a localized value, and the whole AttrDef when it was the last one', async () => {
    const { document } = await fixture()
    // Name values are not reachable through `removeAttributeValue` (the command system keeps
    // names out of the generic attribute list), so the working document is edited directly —
    // which is exactly the shape the chat lane hands over when it proposes dropping a value.
    const activity = document.objectDefinitions.get(FIXTURE_IDS.activity)!
    const startEvent = document.objectDefinitions.get(FIXTURE_IDS.startEvent)!
    const live: ArisWorkingDocument = {
      ...document,
      objectDefinitions: new Map([
        ...document.objectDefinitions,
        [
          activity.id,
          {
            ...activity,
            names: {
              values: { [FIXTURE_LOCALE_EN]: activity.names.values[FIXTURE_LOCALE_EN]! },
              fallback: activity.names.fallback
            }
          }
        ],
        [startEvent.id, { ...startEvent, names: { values: {}, fallback: null } }]
      ])
    }

    const preview = derive(document, live)
    expectClean(preview)
    // One `<AttrValue>` removed, its English sibling and the `<AttrDef>` around it kept.
    expect(preview.result.text).not.toContain('TextValue="&#1578;&#1587;&#1580;&#1610;&#1604;"')
    expect(preview.result.text).toContain('TextValue="Register animal"')
    // The start event's only value went, so the whole `<AttrDef>` went with it.
    expect(preview.result.text).not.toContain('TextValue="Request received"')
    const derived = reparse(preview.result.text)
    const start = derived.byId.get(FIXTURE_IDS.startEvent)!
    expect(start.childPaths.map((path) => derived.byPath.get(path)!.name)).toEqual([
      'GUID',
      'CxnDef'
    ])
  })

  it('creates an object definition and its occurrence with source-style ids', async () => {
    const { document } = await fixture()
    const definition: ArisObjectDefinition = {
      id: 'ObjDef.7',
      type: 'OT_FUNC',
      defaultSymbol: 'ST_FUNC',
      names: { values: { [FIXTURE_LOCALE_EN]: 'Issue licence' }, fallback: 'Issue licence' },
      attributes: [],
      linkedModelIds: [],
      rawAttributes: {}
    }
    const occurrence: ArisObjectOccurrence = {
      id: 'ObjOcc.7',
      definitionId: 'ObjDef.7',
      modelId: FIXTURE_IDS.model,
      symbol: 'ST_FUNC',
      bounds: { x: 1000, y: 2800, width: 554, height: 151 },
      style: {
        symbol: 'ST_FUNC',
        fillColor: 'ffffff',
        strokeColor: null,
        strokeWidth: null,
        lineStyle: null,
        fontStyleSheetId: null,
        zOrder: null
      },
      attributeOccurrences: [],
      rawAttributes: {}
    }
    let live = run(document, 'createDefinition', definition)
    live = run(live, 'createOccurrence', occurrence)

    const preview = derive(document, live)
    expectClean(preview)
    expect(preview.addedIds).toHaveLength(2)
    const [definitionId, occurrenceId] = preview.addedIds
    expect(parseArisId(definitionId!)).toMatchObject({ kind: 'ObjDef', scope: 'definition' })
    expect(parseArisId(occurrenceId!)).toMatchObject({ kind: 'ObjOcc', scope: 'occurrence' })

    const derived = reparse(preview.result.text)
    // The definition landed in the business group, the occurrence inside the model.
    const created = derived.byId.get(definitionId!)
    expect(created?.name).toBe('ObjDef')
    expect(derived.byPath.get(created!.parentPath!)?.sourceId).toBe(FIXTURE_IDS.group)
    const placed = derived.byId.get(occurrenceId!)
    expect(derived.byPath.get(placed!.parentPath!)?.sourceId).toBe(FIXTURE_IDS.model)
    // Geometry and style were emitted in canonical order: Brush, Position, Size.
    expect(placed!.childPaths.map((path) => derived.byPath.get(path)!.name)).toEqual([
      'Brush',
      'Position',
      'Size'
    ])
    expect(preview.result.text).toContain('TextValue="Issue licence"')
  })

  it('creates a connection definition and occurrence nested under their source records', async () => {
    const { document } = await fixture()
    const connectionDefinition: ArisConnectionDefinition = {
      id: 'CxnDef.9',
      type: 'CT_ACTIV_1',
      fromObjectDefinitionId: FIXTURE_IDS.activity,
      toObjectDefinitionId: FIXTURE_IDS.startEvent,
      names: { values: {}, fallback: null },
      attributes: []
    }
    const connectionOccurrence: ArisConnectionOccurrence = {
      id: 'CxnOcc.9',
      definitionId: 'CxnDef.9',
      modelId: FIXTURE_IDS.model,
      sourceOccurrenceId: FIXTURE_IDS.activityOccurrence,
      targetOccurrenceId: FIXTURE_IDS.startOccurrence,
      route: [
        { x: 1277, y: 2551 },
        { x: 1277, y: 2000 }
      ],
      style: {
        color: null,
        width: null,
        lineStyle: null,
        srcArrow: null,
        tgtArrow: null,
        fontStyleSheetId: null,
        zOrder: null
      },
      rawAttributes: {}
    }
    let live = run(document, 'createConnectionDefinition', connectionDefinition)
    live = run(live, 'createConnectionOccurrence', connectionOccurrence)

    const preview = derive(document, live)
    expectClean(preview)

    const derived = reparse(preview.result.text)
    const definitionId = preview.addedIds.find((id) => id.startsWith('CxnDef.'))!
    const occurrenceId = preview.addedIds.find((id) => id.startsWith('CxnOcc.'))!

    // §9.3's endpoint check enforces this nesting; assert it directly too.
    const cxnDef = derived.byId.get(definitionId)!
    expect(derived.byPath.get(cxnDef.parentPath!)?.sourceId).toBe(FIXTURE_IDS.activity)
    expect(cxnDef.attributeByName.get('ToObjDef.IdRef')?.value).toBe(FIXTURE_IDS.startEvent)
    const cxnOcc = derived.byId.get(occurrenceId)!
    expect(derived.byPath.get(cxnOcc.parentPath!)?.sourceId).toBe(FIXTURE_IDS.activityOccurrence)
    expect(cxnOcc.attributeByName.get('ToObjOcc.IdRef')?.value).toBe(FIXTURE_IDS.startOccurrence)

    // Both source records now advertise the new child in their id-ref lists.
    expect(
      derived.byId.get(FIXTURE_IDS.activity)?.attributeByName.get('ToCxnDefs.IdRefs')?.value
    ).toContain(definitionId)
    expect(
      derived.byId.get(FIXTURE_IDS.activityOccurrence)?.attributeByName.get('ToCxnOccs.IdRefs')
        ?.value
    ).toContain(occurrenceId)
  })

  it('creates a whole object with an outgoing connection in one export', async () => {
    const { document } = await fixture()
    let live = run(document, 'createDefinition', {
      id: 'ObjDef.11',
      type: 'OT_EVT',
      defaultSymbol: 'ST_EV',
      names: {
        values: { [FIXTURE_LOCALE_EN]: 'Animal registered' },
        fallback: 'Animal registered'
      },
      attributes: [],
      linkedModelIds: [],
      rawAttributes: {}
    } satisfies ArisObjectDefinition)
    live = run(live, 'createOccurrence', {
      id: 'ObjOcc.11',
      definitionId: 'ObjDef.11',
      modelId: FIXTURE_IDS.model,
      symbol: 'ST_EV',
      bounds: { x: 1000, y: 3200, width: 554, height: 151 },
      style: {
        symbol: 'ST_EV',
        fillColor: null,
        strokeColor: null,
        strokeWidth: null,
        lineStyle: null,
        fontStyleSheetId: null,
        zOrder: null
      },
      attributeOccurrences: [],
      rawAttributes: {}
    } satisfies ArisObjectOccurrence)
    live = run(live, 'createConnectionDefinition', {
      id: 'CxnDef.11',
      type: 'CT_ACTIV_1',
      fromObjectDefinitionId: 'ObjDef.11',
      toObjectDefinitionId: FIXTURE_IDS.activity,
      names: { values: {}, fallback: null },
      attributes: []
    } satisfies ArisConnectionDefinition)
    live = run(live, 'createConnectionOccurrence', {
      id: 'CxnOcc.11',
      definitionId: 'CxnDef.11',
      modelId: FIXTURE_IDS.model,
      sourceOccurrenceId: 'ObjOcc.11',
      targetOccurrenceId: FIXTURE_IDS.activityOccurrence,
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
      rawAttributes: {}
    } satisfies ArisConnectionOccurrence)

    const preview = derive(document, live)
    expectClean(preview)
    expect(preview.addedIds).toHaveLength(4)

    const derived = reparse(preview.result.text)
    const newDefinition = preview.addedIds.find(
      (id) => id.startsWith('ObjDef.') && !document.objectDefinitions.has(id)
    )!
    const nestedCxnDef = preview.addedIds.find((id) => id.startsWith('CxnDef.'))!
    // The connection definition is nested inside the definition that was created with it.
    expect(derived.byPath.get(derived.byId.get(nestedCxnDef)!.parentPath!)?.sourceId).toBe(
      newDefinition
    )
    const nestedCxnOcc = preview.addedIds.find((id) => id.startsWith('CxnOcc.'))!
    // A route was derived from the two endpoint centres rather than left empty.
    const points = derived.byId
      .get(nestedCxnOcc)!
      .childPaths.map((path) => derived.byPath.get(path)!)
      .filter((child) => child.name === 'Position')
    expect(points).toHaveLength(2)
  })

  it('deletes an occurrence and prunes the id-ref list that named its connection', async () => {
    const { document } = await fixture()
    let live = run(document, 'deleteConnection', {
      connectionOccurrenceId: FIXTURE_IDS.connectionOccurrence
    })
    live = run(live, 'deleteOccurrence', { occurrenceId: FIXTURE_IDS.activityOccurrence })

    const preview = derive(document, live)
    expectClean(preview)
    expect([...preview.removedIds].sort()).toEqual(
      [FIXTURE_IDS.activityOccurrence, FIXTURE_IDS.connectionOccurrence].sort()
    )

    const derived = reparse(preview.result.text)
    expect(derived.byId.has(FIXTURE_IDS.activityOccurrence)).toBe(false)
    expect(derived.byId.has(FIXTURE_IDS.connectionOccurrence)).toBe(false)
    // The id-ref list that named the removed connection was pruned in the same batch.
    expect(
      derived.byId.get(FIXTURE_IDS.startOccurrence)?.attributeByName.get('ToCxnOccs.IdRefs')?.value
    ).toBe('')
    // Nothing else moved: the definition and the other occurrence are still there.
    expect(derived.byId.has(FIXTURE_IDS.activity)).toBe(true)
    expect(derived.byId.has(FIXTURE_IDS.startOccurrence)).toBe(true)
  })

  it('cascades a deletion so no reference is left dangling in the bytes', async () => {
    const { document } = await fixture()
    // The command layer keeps the working document referentially closed, so this state is
    // reached by editing it directly. The byte layer must still refuse to leave a dangling
    // `<CxnOcc>` behind — the export validator would reject it, so the cascade has to.
    const model = document.models.get(FIXTURE_IDS.model)!
    const live: ArisWorkingDocument = {
      ...document,
      models: new Map([
        ...document.models,
        [
          model.id,
          {
            ...model,
            occurrences: model.occurrences.filter(
              (occurrence) => occurrence.id !== FIXTURE_IDS.activityOccurrence
            )
          }
        ]
      ])
    }

    const preview = derive(document, live)
    expectClean(preview)
    expect([...preview.removedIds].sort()).toEqual(
      [FIXTURE_IDS.activityOccurrence, FIXTURE_IDS.connectionOccurrence].sort()
    )
    const derived = reparse(preview.result.text)
    expect(derived.byId.has(FIXTURE_IDS.connectionOccurrence)).toBe(false)
    expect(derived.references.some((reference) => !derived.byId.has(reference.targetId))).toBe(
      false
    )
  })

  it('deletes a connection occurrence on its own', async () => {
    const { document } = await fixture()
    const live = run(document, 'deleteConnection', {
      connectionOccurrenceId: FIXTURE_IDS.connectionOccurrence
    })

    const preview = derive(document, live)
    expectClean(preview)
    expect(preview.removedIds).toEqual([FIXTURE_IDS.connectionOccurrence])
    const derived = reparse(preview.result.text)
    expect(derived.byId.has(FIXTURE_IDS.connectionOccurrence)).toBe(false)
    expect(derived.byId.has(FIXTURE_IDS.connectionDefinition)).toBe(true)
  })

  it('deletes a definition and everything that would dangle after it', async () => {
    const { document } = await fixture()
    let live = run(document, 'deleteConnection', {
      connectionOccurrenceId: FIXTURE_IDS.connectionOccurrence
    })
    live = run(live, 'deleteOccurrence', { occurrenceId: FIXTURE_IDS.activityOccurrence })
    live = run(live, 'deleteConnectionDefinition', {
      definitionId: FIXTURE_IDS.connectionDefinition
    })
    live = run(live, 'deleteDefinition', { definitionId: FIXTURE_IDS.activity })

    const preview = derive(document, live)
    expectClean(preview)
    const derived = reparse(preview.result.text)
    expect(derived.byId.has(FIXTURE_IDS.activity)).toBe(false)
    expect(derived.byId.has(FIXTURE_IDS.connectionDefinition)).toBe(false)
    expect(derived.byId.has(FIXTURE_IDS.activityOccurrence)).toBe(false)
    expect(derived.byId.has(FIXTURE_IDS.connectionOccurrence)).toBe(false)
    // The `ToCxnDefs.IdRefs` list on the start event no longer names a record that is gone.
    expect(
      derived.byId.get(FIXTURE_IDS.startEvent)?.attributeByName.get('ToCxnDefs.IdRefs')?.value
    ).toBe('')
    expect(preview.result.validation.ok).toBe(true)
  })

  it('moves and resizes occurrences and reroutes connections', async () => {
    const { document } = await fixture()
    let live = run(document, 'moveOccurrence', {
      occurrenceId: FIXTURE_IDS.startOccurrence,
      x: 1400,
      y: 2100
    })
    live = run(live, 'resizeOccurrence', {
      occurrenceId: FIXTURE_IDS.startOccurrence,
      width: 600,
      height: 200
    })
    live = run(live, 'setConnectionRoute', {
      connectionOccurrenceId: FIXTURE_IDS.connectionOccurrence,
      route: [
        { x: 1700, y: 2300 },
        { x: 1700, y: 2400 }
      ]
    })

    const preview = derive(document, live)
    expectClean(preview)
    expect(preview.result.text).toContain('<Position Pos.X="1400" Pos.Y="2100"/>')
    expect(preview.result.text).toContain('<Size Size.dX="600" Size.dY="200"/>')
    expect(preview.result.text).toContain('<Position Pos.X="1700" Pos.Y="2300"/>')
  })

  it('restyles an occurrence and repositions a rendered attribute', async () => {
    const { document } = await fixture()
    let live = run(document, 'setOccurrenceSymbol', {
      occurrenceId: FIXTURE_IDS.startOccurrence,
      symbol: 'ST_EV_START'
    })
    live = run(live, 'setAttributeOccurrencePlacement', {
      occurrenceId: FIXTURE_IDS.startOccurrence,
      attributeType: 'AT_NAME',
      placement: {
        attributeType: 'AT_NAME',
        port: 'TOP',
        orderNum: null,
        alignment: 'LEFT',
        offsetX: 12,
        offsetY: null,
        width: 80,
        height: 24,
        rotation: null
      }
    })
    // A type the occurrence renders nothing for yet: a whole <AttrOcc> has to be created.
    live = run(live, 'setAttributeOccurrencePlacement', {
      occurrenceId: FIXTURE_IDS.startOccurrence,
      attributeType: 'AT_DESC',
      placement: {
        attributeType: 'AT_DESC',
        port: 'BOTTOM',
        orderNum: 2,
        alignment: 'RIGHT',
        offsetX: 5,
        offsetY: 7,
        width: 120,
        height: 40,
        rotation: 90
      }
    })

    const preview = derive(document, live)
    expectClean(preview)
    const derived = reparse(preview.result.text)
    const occurrence = derived.byId.get(FIXTURE_IDS.startOccurrence)!
    expect(occurrence.attributeByName.get('SymbolNum')?.value).toBe('ST_EV_START')
    const attrOccs = occurrence.childPaths
      .map((path) => derived.byPath.get(path)!)
      .filter((child) => child.name === 'AttrOcc')
    const name = attrOccs.find(
      (child) => child.attributeByName.get('AttrTypeNum')?.value === 'AT_NAME'
    )!
    expect(name.attributeByName.get('Port')?.value).toBe('TOP')
    expect(name.attributeByName.get('Alignment')?.value).toBe('LEFT')
    expect(name.attributeByName.get('OffsetX')?.value).toBe('12')
    expect(preview.result.text).toContain('<Size Size.dX="80" Size.dY="24"/>')

    // The created placement kept every field the working model carried.
    const description = attrOccs.find(
      (child) => child.attributeByName.get('AttrTypeNum')?.value === 'AT_DESC'
    )!
    expect(description.attributeByName.get('Port')?.value).toBe('BOTTOM')
    expect(description.attributeByName.get('OrderNum')?.value).toBe('2')
    expect(description.attributeByName.get('Alignment')?.value).toBe('RIGHT')
    expect(description.attributeByName.get('OffsetX')?.value).toBe('5')
    expect(description.attributeByName.get('OffsetY')?.value).toBe('7')
    expect(description.attributeByName.get('Rotation')?.value).toBe('90')
    expect(description.childPaths.map((path) => derived.byPath.get(path)!.name)).toEqual(['Size'])
  })

  it('adds and edits a lane', async () => {
    const { document } = await fixture()
    const lane: ArisLane = {
      id: 'Lane.5',
      modelId: FIXTURE_IDS.model,
      names: { values: { [FIXTURE_LOCALE_EN]: 'Veterinary' }, fallback: 'Veterinary' },
      laneType: 'LT_DEFAULT',
      orientation: 'HORIZONTAL',
      startBorder: 0,
      endBorder: 900
    }
    let live = run(document, 'addLane', lane)
    live = run(live, 'editLane', {
      ...document.models.get(FIXTURE_IDS.model)!.lanes[0]!,
      names: { values: { [FIXTURE_LOCALE_EN]: 'Front desk' }, fallback: 'Front desk' },
      orientation: 'VERTICAL'
    } satisfies ArisLane)

    const preview = derive(document, live)
    expectClean(preview)
    const derived = reparse(preview.result.text)
    const created = preview.addedIds.find((id) => id.startsWith('Lane.'))!
    expect(parseArisId(created)).toMatchObject({ kind: 'Lane', scope: 'occurrence' })
    expect(derived.byPath.get(derived.byId.get(created)!.parentPath!)?.sourceId).toBe(
      FIXTURE_IDS.model
    )
    expect(preview.result.text).toContain('TextValue="Veterinary"')
    // The pre-existing lane was edited in place, not re-emitted.
    const existing = derived.byId.get(FIXTURE_IDS.lane)!
    expect(existing.attributeByName.get('Orientation')?.value).toBe('VERTICAL')
    expect(preview.result.text).toContain('TextValue="Front desk"')
  })

  it('adds free text and edits the text of an existing one', async () => {
    const { document } = await fixture()
    const text: ArisFreeText = {
      id: 'FFText.3',
      modelId: FIXTURE_IDS.model,
      definitionId: null,
      text: { values: { [FIXTURE_LOCALE_EN]: 'Draft — do not circulate' }, fallback: 'Draft' },
      bounds: { x: 400, y: 400, width: 300, height: 60 },
      style: {
        symbol: null,
        fillColor: null,
        strokeColor: null,
        strokeWidth: null,
        lineStyle: null,
        fontStyleSheetId: null,
        zOrder: null
      }
    }
    const live = run(document, 'addFreeText', text)

    const preview = derive(document, live)
    expectClean(preview)
    const created = preview.addedIds.find((id) => id.startsWith('FFTextDef.'))!
    expect(parseArisId(created)).toMatchObject({ kind: 'FFTextDef', scope: 'definition' })
    const derived = reparse(preview.result.text)
    // The definition sits at the document level, the occurrence inside the model.
    expect(derived.byPath.get(derived.byId.get(created)!.parentPath!)?.name).toBe('AML')
    expect(preview.result.text).toContain(`<FFTextOcc FFTextDef.IdRef="${created}">`)
    expect(preview.result.text).toContain('TextValue="Draft — do not circulate"')
  })

  it('leaves the original text and a no-op export byte-identical', async () => {
    const { document } = await fixture()
    const before = SAMPLE_AML
    const preview = derive(document, document)

    expect(preview.editCount).toBe(0)
    expect(preview.result.changed).toBe(false)
    expect(preview.result.text).toBe(SAMPLE_AML)
    expect(SAMPLE_AML).toBe(before)
    expectClean(preview)
  })

  it('refuses to download a derived document with a dangling reference', async () => {
    const { document } = await fixture()
    const dangling: ArisConnectionDefinition = {
      id: 'CxnDef.ZZZZZZZZZZZ-q-L',
      type: 'CT_ACTIV_1',
      fromObjectDefinitionId: FIXTURE_IDS.startEvent,
      // No record in the source declares this id and nothing creates it.
      toObjectDefinitionId: 'ObjDef.ZZZZZZZZZZZ-p-L',
      names: { values: {}, fallback: null },
      attributes: []
    }
    const live: ArisWorkingDocument = {
      ...document,
      connectionDefinitions: new Map([...document.connectionDefinitions, [dangling.id, dangling]])
    }

    const preview = derive(document, live)
    expect(preview.result.validation.ok).toBe(false)
    expect(preview.result.validation.issues.map((issue) => issue.check)).toContain(
      'definition-references-resolve'
    )
    expect(() =>
      exportArisDerivedAml({
        originalText: SAMPLE_AML,
        original: document,
        live,
        random: seededRandom(1)
      })
    ).toThrow(/failed validation/u)
  })

  it('reports a model the canvas created as unmapped rather than dropping it', async () => {
    const { document } = await fixture()
    const model = document.models.get(FIXTURE_IDS.model)!
    const live: ArisWorkingDocument = {
      ...document,
      models: new Map([
        ...document.models,
        [
          'Model.new',
          {
            ...model,
            id: 'Model.new',
            occurrences: [],
            connectionOccurrences: [],
            lanes: [],
            freeText: []
          }
        ]
      ])
    }

    const preview = derive(document, live)
    expect(preview.unmapped).toHaveLength(1)
    expect(preview.unmapped[0]).toMatchObject({ sourceId: 'Model.new' })
    expect(preview.unmapped[0]!.reason).toContain('Model.new')
    expect(preview.result.validation.ok).toBe(true)
  })

  it('derives an export file name from the source file name', () => {
    expect(derivedAmlFileName('animalwf.aml')).toBe('animalwf.derived.aml')
    expect(derivedAmlFileName('export')).toBe('export.derived.aml')
    expect(derivedAmlFileName('   ')).toBe('export.derived.aml')
  })
})
