import { describe, expect, it } from 'vitest'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { buildFromSource } from './buildFromSource'
import { buildTestDocument } from './testFixture'

// A record kind that legitimately has no source id attribute at all: a real ARIS
// `<FFTextOcc>` never carries `FFTextOcc.ID` (unlike `ObjOcc.ID`, `CxnOcc.ID`, `Lane.ID`, all of
// which are always present) — it is addressed only by its `FFTextDef.IdRef` plus its position
// in the document. Without a synthesized id, `buildFreeText` produces `id: ''` and
// `buildFromSource`'s `if (!item.id || !item.modelId) continue` guard silently drops every one
// of them (the AnimalWF defect this regression test guards against: 69 of 69 free-text
// occurrences reached zero working-model entities).
const NO_ID_FREE_TEXT_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Group Group.ID="Group.Root">
    <Model Model.ID="Model.1" Model.Type="MT_EEPC">
      <FFTextOcc FFTextDef.IdRef="FFTextDef.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="4">
        <Position Pos.X="50" Pos.Y="40" />
      </FFTextOcc>
    </Model>
  </Group>
  <FFTextDef FFTextDef.ID="FFTextDef.1" IsModelAttr="TEXT">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033">Free-standing note</AttrValue>
    </AttrDef>
  </FFTextDef>
</AML>`

const SOURCE_COLOR_AML = `<AML>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.1" TypeNum="OT_FUNC">
      <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.2" />
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.2" TypeNum="OT_EVT" />
    <Model Model.ID="Model.1" Model.Type="MT_EEPC" BackColor="d5d5f7">
      <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1" SymbolNum="ST_FUNC">
        <Brush Color="339900" Color2="0" BrushType="SOLID" />
        <Position Pos.X="0" Pos.Y="0" />
        <Size Size.dX="100" Size.dY="60" />
        <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.2"
          SrcArrow="ST_ARROW_OPEN_PNT" TgtArrow="ST_ARROW_FILLED_PNT" Visible="NO" Zorder="7">
          <Pen Color="996600" Style="3" Width="4" />
          <Position Pos.X="100" Pos.Y="30" />
          <Position Pos.X="200" Pos.Y="30" />
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.2" ObjDef.IdRef="ObjDef.2" SymbolNum="ST_EV" FillColor="dcbbed">
        <Position Pos.X="200" Pos.Y="0" />
        <Size Size.dX="100" Size.dY="60" />
      </ObjOcc>
      <FFTextOcc FFTextDef.IdRef="FFTextDef.1" FontSS.IdRef="FontSS.1" FillColor="d7c49d">
        <Position Pos.X="0" Pos.Y="100" />
      </FFTextOcc>
    </Model>
  </Group>
  <FFTextDef FFTextDef.ID="FFTextDef.1">
    <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Note</AttrValue></AttrDef>
  </FFTextDef>
  <FontStyleSheet FontSS.ID="FontSS.1">
    <FontNode LocaleId="1033" Color="dcbbed" />
  </FontStyleSheet>
</AML>`

function buildDocumentFromXml(xml: string) {
  const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))
  return buildFromSource(semantic.index)
}

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
  it('carries decoded source colors into occurrence, connection, free-text and font paint', () => {
    const document = buildDocumentFromXml(SOURCE_COLOR_AML)
    const model = document.models.get('Model.1')

    expect(model?.layout.backColor).toBe('#f7d5d5')
    expect(model?.occurrences.map((occurrence) => occurrence.style.fillColor)).toEqual([
      '#009933',
      '#edbbdc'
    ])
    expect(model?.connectionOccurrences[0]?.style.color).toBe('#006699')
    expect(model?.connectionOccurrences[0]?.style).toMatchObject({
      width: 4,
      lineStyle: 'dashdot',
      srcArrow: 'ST_ARROW_OPEN_PNT',
      tgtArrow: 'ST_ARROW_FILLED_PNT',
      zOrder: 7
    })
    expect(model?.connectionOccurrences[0]?.rawAttributes['Visible']).toBe('NO')
    expect(model?.freeText[0]?.style.fillColor).toBe('#9dc4d7')
    expect(document.styleCatalog.styles.get('FontSS.1')?.textColor).toBe('#edbbdc')
  })

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

describe('records with no source id attribute', () => {
  it('a free-text occurrence with no source id still becomes an addressable working-model entity with a stable id across two independent builds', () => {
    // Two entirely independent parses of the same bytes — no shared state, no counters carried
    // over — to prove the synthesized id is derived from the source itself (deterministic),
    // not from build-order (which a counter-based scheme could not guarantee across imports,
    // undo/redo, or revisions).
    const first = buildDocumentFromXml(NO_ID_FREE_TEXT_AML)
    const second = buildDocumentFromXml(NO_ID_FREE_TEXT_AML)

    const firstText = first.models.get('Model.1')?.freeText ?? []
    const secondText = second.models.get('Model.1')?.freeText ?? []

    // Addressable: the record reached the working model at all (the AnimalWF defect dropped it
    // via the `!item.id` guard because id was '').
    expect(firstText).toHaveLength(1)
    expect(secondText).toHaveLength(1)
    expect(firstText[0].id).not.toBe('')
    expect(firstText[0].modelId).toBe('Model.1')
    expect(firstText[0].definitionId).toBe('FFTextDef.1')

    // Stable: the exact same id across two independent builds of identical source bytes.
    expect(firstText[0].id).toBe(secondText[0].id)

    // Collision-free by construction: distinct document positions produce distinct ids. Two
    // sibling FFTextOcc records (differing only by position in the document) must not collapse
    // onto the same synthesized id.
    const twoOccurrencesXml = NO_ID_FREE_TEXT_AML.replace(
      '</FFTextOcc>\n    </Model>',
      `</FFTextOcc>
      <FFTextOcc FFTextDef.IdRef="FFTextDef.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="5">
        <Position Pos.X="90" Pos.Y="70" />
      </FFTextOcc>
    </Model>`
    )
    const withTwo = buildDocumentFromXml(twoOccurrencesXml)
    const twoEntries = withTwo.models.get('Model.1')?.freeText ?? []
    expect(twoEntries).toHaveLength(2)
    expect(twoEntries[0].id).not.toBe(twoEntries[1].id)
  })
})
