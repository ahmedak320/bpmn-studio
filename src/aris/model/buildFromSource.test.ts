import { describe, expect, it } from 'vitest'
import { buildTestDocument } from './testFixture'

function occurrenceName(
  document: {
    readonly objectDefinitions: ReadonlyMap<
      string,
      { readonly names: { readonly values: Readonly<Record<string, string>> } }
    >
  },
  occurrence: { readonly definitionId: string }
): string | undefined {
  return document.objectDefinitions.get(occurrence.definitionId)?.names.values['de-DE']
}

describe('buildFromSource', () => {
  it('builds a working document from sanitized AML', async () => {
    const { document } = await buildTestDocument()

    expect(document.revision).toBe(0)
    expect(document.database.databaseName).toBe('TestDB')
    expect(document.models.size).toBe(2)
    expect(document.objectDefinitions.size).toBe(4)

    const m1 = document.models.get('m1')
    expect(m1).toBeDefined()
    expect(m1?.type).toBe('MT_EEPC')
    expect(m1?.occurrences.length).toBe(2)
    expect(m1?.connectionOccurrences.length).toBe(1)
    expect(m1?.lanes.length).toBe(1)
    expect(m1?.freeText.length).toBe(1)

    const cd1 = document.connectionDefinitions.get('cd1')
    expect(cd1).toBeDefined()
    expect(cd1?.type).toBe('CT_FUNC_1')
    expect(cd1?.fromObjectDefinitionId).toBe('od1')
    expect(cd1?.toObjectDefinitionId).toBe('od2')
  })

  it('represents unsupported model types through the escape hatch', async () => {
    const { document } = await buildTestDocument()
    const m2 = document.models.get('m2')

    expect(m2).toBeDefined()
    expect(m2?.unsupported).toBe(true)
    expect(m2?.type).toBe('MT_UNKNOWN_TYPE')
    expect(m2?.rawSourceRecord).toBeDefined()
  })

  it('keeps unknown source object types as real objects with raw attributes', async () => {
    const { document } = await buildTestDocument()
    const od3 = document.objectDefinitions.get('od3')

    expect(od3).toBeDefined()
    expect(od3?.type).toBe('OT_CUSTOM_XYZ')
    expect(od3?.rawAttributes['TypeNum']).toBe('OT_CUSTOM_XYZ')
    expect(od3?.names.values['de-DE']).toBe('Unbekannt')
  })

  it('keeps ARIS satellite objects as first-class object definitions', async () => {
    const { document } = await buildTestDocument()
    const od4 = document.objectDefinitions.get('od4')

    expect(od4).toBeDefined()
    expect(od4?.type).toBe('OT_BUSINESS_RULE')
    expect(od4?.defaultSymbol).toBe('ST_RULE_XOR')
  })

  it('keeps linked-model assignments as native assignment lists', async () => {
    const { document } = await buildTestDocument()
    const od1 = document.objectDefinitions.get('od1')

    expect(od1?.linkedModelIds).toEqual(['m2'])
  })
})

describe('definition / occurrence distinction', () => {
  it('one definition may have many occurrences', async () => {
    const { document } = await buildTestDocument()
    const m1 = document.models.get('m1')

    const occurrences = m1?.occurrences.filter((occurrence) => occurrence.definitionId === 'od1')
    expect(occurrences?.length).toBe(2)
    expect(occurrences?.[0].id).not.toBe(occurrences?.[1].id)
  })

  it('changing a definition name updates every occurrence identity', async () => {
    const { document } = await buildTestDocument()
    const m1 = document.models.get('m1')

    const before = occurrenceName(document, m1!.occurrences[0])
    expect(before).toBe('Genehmigen')

    // Simulate a definition rename by mutating the working definition map.
    const definition = document.objectDefinitions.get('od1')!
    const renamed = {
      ...definition,
      names: { ...definition.names, values: { ...definition.names.values, 'de-DE': 'Freigeben' } }
    }
    const nextDefinitions = new Map(document.objectDefinitions)
    nextDefinitions.set('od1', renamed)
    const nextDocument = { ...document, objectDefinitions: Object.freeze(nextDefinitions) }

    for (const occurrence of nextDocument.models.get('m1')!.occurrences) {
      if (occurrence.definitionId === 'od1') {
        expect(occurrenceName(nextDocument, occurrence)).toBe('Freigeben')
      }
    }
  })

  it('changing an occurrence position affects only that occurrence', async () => {
    const { document } = await buildTestDocument()
    const m1 = document.models.get('m1')!
    const [first, second] = m1.occurrences

    const moved = { ...first, bounds: { ...first.bounds, x: 999 } }
    const nextOccurrences = m1.occurrences.map((occurrence) =>
      occurrence.id === first.id ? moved : occurrence
    )
    const nextDocument = {
      ...document,
      models: Object.freeze(
        new Map(document.models).set('m1', { ...m1, occurrences: Object.freeze(nextOccurrences) })
      )
    }

    const movedFirst = nextDocument.models.get('m1')!.occurrences.find((o) => o.id === first.id)!
    const untouchedSecond = nextDocument.models
      .get('m1')!
      .occurrences.find((o) => o.id === second.id)!

    expect(movedFirst.bounds.x).toBe(999)
    expect(untouchedSecond.bounds.x).toBe(second.bounds.x)
  })

  it('connections have both definition identity and occurrence-local route', async () => {
    const { document } = await buildTestDocument()
    const m1 = document.models.get('m1')!
    const connection = m1.connectionOccurrences[0]

    expect(connection.definitionId).toBe('cd1')
    expect(connection.sourceOccurrenceId).toBe('occ1')
    expect(connection.targetOccurrenceId).toBe('occ2')
    expect(connection.route).toHaveLength(2)
    expect(connection.route[0]).toEqual({ x: 110, y: 45 })
    expect(connection.style.tgtArrow).toBe('1')
  })
})
