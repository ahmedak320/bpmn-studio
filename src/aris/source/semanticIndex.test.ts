import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildSemanticArisDocument, type ArisSourceIndex } from './semanticIndex'
import { tokenizeXmlDocument, type XmlNode } from './xmlTokenizer'

const COMPACT_AML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML [
  <!ENTITY LocaleId.USen "1033">
]>
<AML>
  <Header-Info DatabaseName="DMT" UserName="hazim" ArisExeVersion="100" />
  <Language LocaleId="1033" Codepage="1252"><LanguageName>English</LanguageName></Language>
  <Group Group.ID="Group.Root">
    <Group Group.ID="Group.1" TypeNum="OT_GROUP">
      <ObjDef ObjDef.ID="ObjDef.1" TypeNum="OT_FUNC" LinkedModels.IdRefs=" Model.1 ">
        <GUID>guid-objdef-1</GUID>
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="&LocaleId.USen;">
            <StyledElement><StyledElement><PlainText TextValue="Function A" /></StyledElement></StyledElement>
          </AttrValue>
        </AttrDef>
        <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_EXEC_1" ToObjDef.IdRef="ObjDef.2">
          <GUID>guid-cxndef-1</GUID>
        </CxnDef>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.2" TypeNum="OT_EVT" />
      <Model Model.ID="Model.1" Model.Type="MT_EEPC" GridSize="50" Scale="80" PrintScale="54" BackColor="-1">
        <GUID>guid-model-1</GUID>
        <Lane Lane.ID="Lane.1" Lane.Type="LT_DEFAULT" Orientation="VERTICAL" StartBorder="0" EndBorder="50000">
          <GUID>guid-lane-1</GUID>
          <Pen Color="0" Style="0" Width="0" />
          <Brush Color="ffffff" Color2="0" BrushType="SOLID" />
          <AttrDef AttrDef.Type="AT_NAME">
            <AttrValue LocaleId="1033">Operations</AttrValue>
          </AttrDef>
        </Lane>
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033">Workflow</AttrValue>
        </AttrDef>
        <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1" SymbolNum="ST_FUNC" ToCxnOccs.IdRefs="CxnOcc.1">
          <Brush Color="cccccc" Color2="0" BrushType="SOLID" />
          <Position Pos.X="100" Pos.Y="200" />
          <Size Size.dX="300" Size.dY="120" />
          <ExternalGUID>guid-external-1</ExternalGUID>
          <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.2">
            <Pen Color="0" Style="0" Width="1" />
            <Position Pos.X="100" Pos.Y="200" />
            <Position Pos.X="220" Pos.Y="200" />
            <AttrOcc AttrTypeNum="AT_NAME" Port="CENTER" OrderNum="0" Alignment="CENTER" SymbolFlag="TEXT" FontSS.IdRef="FontSS.1" OffsetX="0" OffsetY="0" Rotation="0">
              <Size Size.dX="10" Size.dY="20" />
            </AttrOcc>
          </CxnOcc>
          <AttrOcc AttrTypeNum="AT_NAME" Port="CENTER" OrderNum="0" Alignment="CENTER" SymbolFlag="TEXT" FontSS.IdRef="FontSS.1" OffsetX="0" OffsetY="0" Rotation="0">
            <Size Size.dX="10" Size.dY="20" />
          </AttrOcc>
        </ObjOcc>
        <ObjOcc ObjOcc.ID="ObjOcc.2" ObjDef.IdRef="ObjDef.2" SymbolNum="ST_EV">
          <Position Pos.X="320" Pos.Y="200" />
          <Size Size.dX="300" Size.dY="120" />
        </ObjOcc>
        <FFTextOcc FFTextDef.IdRef="FFTextDef.1" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="4">
          <Position Pos.X="50" Pos.Y="40" />
        </FFTextOcc>
        <OLEOcc OLEOcc.ID="OLEOcc.1" OLEDef.IdRef="OLEDef.1" Zorder="8">
          <Position Pos.X="20" Pos.Y="30" />
          <Size Size.dX="90" Size.dY="100" />
        </OLEOcc>
        <GfxObj><RoundedRectangle /></GfxObj>
      </Model>
    </Group>
  </Group>
  <FFTextDef FFTextDef.ID="FFTextDef.1" IsModelAttr="TEXT">
    <GUID>guid-fftext-1</GUID>
    <AttrDef AttrDef.Type="AT_MODEL_AT"><AttrValue LocaleId="1033">AT_NAME</AttrValue></AttrDef>
  </FFTextDef>
  <OLEDef OLEDef.ID="OLEDef.1">
    <GUID>guid-ole-1</GUID>
    <Blob>QUJDREVGRw==</Blob>
    <AttrDef AttrDef.Type="AT_IMAGE_FILE_BLOB"><AttrValue LocaleId="1033">image.png</AttrValue></AttrDef>
  </OLEDef>
  <FontStyleSheet FontSS.ID="FontSS.1">
    <GUID>guid-fontss-1</GUID>
    <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Standard</AttrValue></AttrDef>
    <FontNode LocaleId="1033" FaceName="Arial" Height="-13" Width="0" Weight="400" Italic="NO" Underline="NO" StrikeOut="NO" Color="0" />
  </FontStyleSheet>
</AML>`

function readAnimalWfExport(): string {
  return readFileSync(
    new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url),
    'utf8'
  )
}

/**
 * Re-derives every element path in the concrete-syntax tree using the same convention the
 * semantic index uses (`Name[nthAmongSiblingsWithThatName]`), independently of the index.
 */
function collectElementPaths(nodes: readonly XmlNode[], prefix: string | null): string[] {
  const counts = new Map<string, number>()
  const collected: string[] = []
  nodes.forEach((node) => {
    if (node.kind !== 'element') return
    const index = (counts.get(node.name) ?? 0) + 1
    counts.set(node.name, index)
    const path = prefix === null ? `${node.name}[${index}]` : `${prefix}/${node.name}[${index}]`
    collected.push(path)
    collected.push(...collectElementPaths(node.children, path))
  })
  return collected
}

/** Every path that some concrete record in the index claims as its own. */
function collectRecordPaths(index: ArisSourceIndex): Set<string> {
  const paths = new Set<string>()
  const add = (records: Iterable<{ readonly path: string }>): void => {
    for (const record of records) paths.add(record.path)
  }
  if (index.root) add([index.root])
  if (index.database) add([index.database])
  add(index.groups.values())
  add(index.languages)
  add(index.models.values())
  add(index.objectDefinitions.values())
  add(index.objectOccurrences.values())
  add(index.connectionDefinitions.values())
  add(index.connectionOccurrences.values())
  add(index.attributes)
  add(index.attributeOccurrences)
  add(index.lanes.values())
  add(index.freeText.values())
  add(index.freeTextOccurrences)
  add(index.attachments.values())
  add(index.attachmentOccurrences)
  add(index.blobs)
  add(index.styles.fontStyleSheets.values())
  add(index.styles.fonts)
  add(index.styles.pens)
  add(index.styles.brushes)
  add(index.positions)
  add(index.sizes)
  add(index.guidReferences)
  add(index.unknownRecords)
  add(index.supersededRecords)
  return paths
}

/**
 * Proves the "nothing silently vanishes" property: every element of the concrete-syntax tree
 * is attributable to exactly one indexed record or one unknown record, and every accounting
 * entry points at a record that really exists in the index.
 */
function expectEveryElementAccountedFor(xml: string): void {
  const document = tokenizeXmlDocument(xml)
  const semantic = buildSemanticArisDocument(document)
  const elementPaths = collectElementPaths(document.children, null)
  const recordPaths = collectRecordPaths(semantic.index)

  expect(new Set(elementPaths).size).toBe(elementPaths.length)
  expect(semantic.index.elementAccounting.size).toBe(elementPaths.length)

  const unaccounted: string[] = []
  const danglingRecordPath: string[] = []
  elementPaths.forEach((path) => {
    const entry = semantic.index.elementAccounting.get(path)
    if (!entry) {
      unaccounted.push(path)
      return
    }
    if (entry.disposition === 'absorbed') {
      if (!recordPaths.has(entry.recordPath)) danglingRecordPath.push(path)
      return
    }
    if (entry.recordPath !== path) danglingRecordPath.push(path)
    if (!recordPaths.has(path)) danglingRecordPath.push(path)
  })

  expect(unaccounted).toEqual([])
  expect(danglingRecordPath).toEqual([])

  // Bijection check: the records claim exactly the elements that were not absorbed, so no
  // element is counted twice and none is missing.
  const absorbedCount = [...semantic.index.elementAccounting.values()].filter(
    (entry) => entry.disposition === 'absorbed'
  ).length
  expect(recordPaths.size + absorbedCount).toBe(elementPaths.length)
}

describe('buildSemanticArisDocument', () => {
  it('indexes core ARIS semantics from a compact AML sample', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(COMPACT_AML))

    expect(semantic.index.database?.parsed.databaseName).toBe('DMT')
    expect(semantic.index.languages).toHaveLength(1)
    expect(semantic.index.groups.size).toBe(2)
    expect(semantic.index.models.size).toBe(1)
    expect(semantic.index.objectDefinitions.size).toBe(2)
    expect(semantic.index.objectOccurrences.size).toBe(2)
    expect(semantic.index.connectionDefinitions.size).toBe(1)
    expect(semantic.index.connectionOccurrences.size).toBe(1)
    expect(semantic.index.attributes).toHaveLength(6)
    expect(semantic.index.attributeOccurrences).toHaveLength(2)
    expect(semantic.index.lanes.size).toBe(1)
    expect(semantic.index.freeText.size).toBe(1)
    expect(semantic.index.freeTextOccurrences).toHaveLength(1)
    expect(semantic.index.attachments.size).toBe(1)
    expect(semantic.index.attachmentOccurrences).toHaveLength(1)
    expect(semantic.index.blobs).toHaveLength(1)
    expect(semantic.index.styles.fontStyleSheets.size).toBe(1)
    expect(semantic.index.styles.fonts).toHaveLength(1)
    expect(semantic.index.styles.pens).toHaveLength(2)
    expect(semantic.index.styles.brushes).toHaveLength(2)
    // The sample carries exactly eight GUID-bearing elements: <GUID> under ObjDef.1, CxnDef.1,
    // Model.1, Lane.1, FFTextDef.1, OLEDef.1 and FontSS.1 (seven), plus <ExternalGUID> under
    // ObjOcc.1 (one). ExternalGUID is a GUID reference in its own right, so the index is right
    // to report eight.
    expect(semantic.index.guidReferences).toHaveLength(8)
    expect(semantic.index.guidReferences.filter((ref) => ref.guidType === 'GUID')).toHaveLength(7)
    expect(
      semantic.index.guidReferences.filter((ref) => ref.guidType === 'ExternalGUID')
    ).toHaveLength(1)
    // Six <Position> elements (ObjOcc.1, two CxnOcc route points, ObjOcc.2, FFTextOcc, OLEOcc)
    // and five <Size> elements (ObjOcc.1, both AttrOcc, ObjOcc.2, OLEOcc).
    expect(semantic.index.positions).toHaveLength(6)
    expect(semantic.index.sizes).toHaveLength(5)
    expect(semantic.index.routePoints).toHaveLength(2)
    expect(semantic.index.unknownRecords.some((record) => record.elementName === 'GfxObj')).toBe(
      true
    )
    expect(semantic.diagnostics).toHaveLength(0)

    const objectDefinition = semantic.index.objectDefinitions.get('ObjDef.1')
    expect(objectDefinition?.parsed.linkedModelIds).toEqual(['Model.1'])

    const attribute = semantic.index.attributes.find(
      (record) =>
        record.parsed.ownerElementName === 'ObjDef' && record.parsed.attributeType === 'AT_NAME'
    )
    expect(attribute?.parsed.values[0]?.text).toBe('Function A')

    const connectionOccurrence = semantic.index.connectionOccurrences.get('CxnOcc.1')
    expect(connectionOccurrence?.parsed.routePointCount).toBe(2)
  })

  it('exposes the plan section 6.5 index members with the required shapes', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(COMPACT_AML))
    const index = semantic.index

    expect(index.models).toBeInstanceOf(Map)
    expect(index.objectDefinitions).toBeInstanceOf(Map)
    expect(index.objectOccurrences).toBeInstanceOf(Map)
    expect(index.connectionDefinitions).toBeInstanceOf(Map)
    expect(index.connectionOccurrences).toBeInstanceOf(Map)
    expect(index.lanes).toBeInstanceOf(Map)
    expect(index.freeText).toBeInstanceOf(Map)
    expect(index.attachments).toBeInstanceOf(Map)
    expect(Array.isArray(index.attributes)).toBe(true)
    expect(Array.isArray(index.unknownRecords)).toBe(true)
    expect(index.styles.fontStyleSheets).toBeInstanceOf(Map)
    expect(Array.isArray(index.styles.fonts)).toBe(true)
    expect(Array.isArray(index.styles.pens)).toBe(true)
    expect(Array.isArray(index.styles.brushes)).toBe(true)
  })

  it('retains id, path, parent, span, parsed fields and unknown fields on every record kind', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(COMPACT_AML))
    const index = semantic.index
    const everyRecord = [
      ...(index.root ? [index.root] : []),
      ...(index.database ? [index.database] : []),
      ...index.groups.values(),
      ...index.languages,
      ...index.models.values(),
      ...index.objectDefinitions.values(),
      ...index.objectOccurrences.values(),
      ...index.connectionDefinitions.values(),
      ...index.connectionOccurrences.values(),
      ...index.attributes,
      ...index.attributeOccurrences,
      ...index.lanes.values(),
      ...index.freeText.values(),
      ...index.freeTextOccurrences,
      ...index.attachments.values(),
      ...index.attachmentOccurrences,
      ...index.blobs,
      ...index.styles.fontStyleSheets.values(),
      ...index.styles.fonts,
      ...index.styles.pens,
      ...index.styles.brushes,
      ...index.positions,
      ...index.sizes,
      ...index.unknownRecords
    ]

    expect(everyRecord.length).toBeGreaterThan(30)
    everyRecord.forEach((record) => {
      expect(typeof record.recordKind).toBe('string')
      expect(record.recordKind.length).toBeGreaterThan(0)
      expect(typeof record.elementName).toBe('string')
      expect(record.path.length).toBeGreaterThan(0)
      expect(record.span.end.offset).toBeGreaterThan(record.span.start.offset)
      expect(typeof record.rawAttributes).toBe('object')
      expect(typeof record.parsed).toBe('object')
      expect(typeof record.unknownAttributes).toBe('object')
      expect(Array.isArray(record.unknownChildren)).toBe(true)
      // Only the document element has no parent; every other record is linked to its owner.
      if (record.recordKind === 'document-root') {
        expect(record.parent).toBeNull()
      } else {
        expect(record.parent?.elementName.length).toBeGreaterThan(0)
        expect(record.parent?.path.length).toBeGreaterThan(0)
      }
    })

    // Source IDs are carried whenever the element declares one.
    expect(index.models.get('Model.1')?.sourceId).toBe('Model.1')
    expect(index.lanes.get('Lane.1')?.sourceId).toBe('Lane.1')
    expect(index.attachments.get('OLEDef.1')?.sourceId).toBe('OLEDef.1')
  })

  it('accounts for every element of the compact sample exactly once', () => {
    expectEveryElementAccountedFor(COMPACT_AML)
  })

  it('records how each element was accounted for', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(COMPACT_AML))
    const accounting = semantic.index.elementAccounting

    expect(accounting.get('AML[1]')).toMatchObject({
      elementName: 'AML',
      disposition: 'record',
      recordKind: 'document-root'
    })
    expect(accounting.get('AML[1]/Group[1]/Group[1]/Model[1]')).toMatchObject({
      disposition: 'record',
      recordKind: 'model'
    })
    expect(accounting.get('AML[1]/Group[1]/Group[1]/Model[1]/GfxObj[1]')).toMatchObject({
      disposition: 'unknown',
      recordKind: 'unknown'
    })
    // Styled-text elements are folded into the attribute record that owns them.
    expect(
      accounting.get(
        'AML[1]/Group[1]/Group[1]/ObjDef[1]/AttrDef[1]/AttrValue[1]/StyledElement[1]/StyledElement[1]/PlainText[1]'
      )
    ).toMatchObject({
      disposition: 'absorbed',
      recordKind: 'attribute',
      recordPath: 'AML[1]/Group[1]/Group[1]/ObjDef[1]/AttrDef[1]'
    })
    expect(accounting.get('AML[1]/Language[1]/LanguageName[1]')).toMatchObject({
      disposition: 'absorbed',
      recordKind: 'language'
    })
  })

  it('retains unknown elements with their raw attributes, children and byte span', () => {
    const xml = `<AML>
      <Group Group.ID="Group.Root">
        <Model Model.ID="Model.1" Model.Type="MT_EEPC">
          <GfxObj HasSymbolEffect="YES" Zorder="3">
            <RoundedRectangle Shaded="NO" />
          </GfxObj>
          <Union Flags="0" ObjOccs.IdRefs="ObjOcc.1 ObjOcc.2" Zorder="9" />
        </Model>
      </Group>
    </AML>`

    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))
    const unknownNames = semantic.index.unknownRecords.map((record) => record.elementName)
    expect(unknownNames).toEqual(['GfxObj', 'RoundedRectangle', 'Union'])

    const gfxObj = semantic.index.unknownRecords[0]
    expect(gfxObj?.recordKind).toBe('unknown')
    expect(gfxObj?.rawAttributes).toEqual({ HasSymbolEffect: 'YES', Zorder: '3' })
    expect(gfxObj?.unknownAttributes).toEqual({ HasSymbolEffect: 'YES', Zorder: '3' })
    expect(gfxObj?.unknownChildren).toEqual(['RoundedRectangle'])
    expect(gfxObj?.parent).toMatchObject({ elementName: 'Model', sourceId: 'Model.1' })
    expect(gfxObj?.span.end.offset).toBeGreaterThan(gfxObj?.span.start.offset ?? 0)

    const union = semantic.index.unknownRecords[2]
    expect(union?.rawAttributes['ObjOccs.IdRefs']).toBe('ObjOcc.1 ObjOcc.2')
    expect(semantic.diagnostics).toHaveLength(0)
  })

  it('retains unknown attributes on known elements', () => {
    const xml = `<AML>
      <Group Group.ID="Group.Root">
        <Model Model.ID="Model.1" Model.Type="MT_EEPC" FutureModelSetting="42">
          <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1" UnmappedOccAttr="on" />
        </Model>
      </Group>
    </AML>`

    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))

    expect(semantic.index.models.get('Model.1')?.unknownAttributes).toEqual({
      FutureModelSetting: '42'
    })
    expect(semantic.index.objectOccurrences.get('ObjOcc.1')?.unknownAttributes).toEqual({
      UnmappedOccAttr: 'on'
    })
    expect(
      semantic.index.unknownAttributes.map((entry) => `${entry.elementName}@${entry.attributeName}`)
    ).toEqual(['Model@FutureModelSetting', 'ObjOcc@UnmappedOccAttr'])
    expect(semantic.index.unknownAttributes[0]?.value).toBe('42')
    expect(semantic.index.unknownAttributes[0]?.path).toBe('AML[1]/Group[1]/Model[1]')
    expect(semantic.index.unknownAttributes[0]?.sourceId).toBe('Model.1')
    // The raw attribute map still carries the mapped attributes alongside the unmapped one.
    expect(semantic.index.models.get('Model.1')?.rawAttributes['Model.Type']).toBe('MT_EEPC')
  })

  it('emits duplicate-id diagnostics without dropping the first record', () => {
    const xml = `<AML>
      <Group Group.ID="Group.Root">
        <Model Model.ID="Model.1" Model.Type="MT_EEPC" />
        <Model Model.ID="Model.1" Model.Type="MT_EEPC" />
      </Group>
    </AML>`

    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))

    expect(semantic.index.models.size).toBe(1)
    expect(semantic.diagnostics).toHaveLength(1)
    expect(semantic.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'duplicate-id',
      sourceId: 'Model.1'
    })
    // The superseded duplicate is retained verbatim rather than silently discarded.
    expect(semantic.index.supersededRecords).toHaveLength(1)
    expect(semantic.index.supersededRecords[0]?.path).toBe('AML[1]/Group[1]/Model[2]')
    expectEveryElementAccountedFor(xml)
  })

  it('indexes linked-model assignments alongside the owning object definition', () => {
    const xml = `<AML>
      <Group Group.ID="Group.Root">
        <ObjDef ObjDef.ID="ObjDef.1" TypeNum="OT_FUNC" LinkedModels.IdRefs="Model.1 Model.2" />
        <ObjDef ObjDef.ID="ObjDef.2" TypeNum="OT_FUNC" />
        <Model Model.ID="Model.1" Model.Type="MT_EEPC" />
        <Model Model.ID="Model.2" Model.Type="MT_VAL_ADD_CHN_DGM" />
      </Group>
    </AML>`

    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))

    expect(semantic.index.objectDefinitions.get('ObjDef.1')?.parsed.linkedModelIds).toEqual([
      'Model.1',
      'Model.2'
    ])
    expect(semantic.index.objectDefinitions.get('ObjDef.2')?.parsed.linkedModelIds).toEqual([])
    expect(semantic.index.linkedModelAssignments).toHaveLength(2)
    expect(semantic.index.linkedModelAssignments[0]).toMatchObject({
      objectDefinitionId: 'ObjDef.1',
      objectDefinitionPath: 'AML[1]/Group[1]/ObjDef[1]',
      modelId: 'Model.1',
      assignmentIndex: 0
    })
    expect(semantic.index.linkedModelAssignments[1]).toMatchObject({
      modelId: 'Model.2',
      assignmentIndex: 1
    })
    // Every assignment resolves to a model that the same document defines.
    semantic.index.linkedModelAssignments.forEach((assignment) => {
      expect(semantic.index.models.has(assignment.modelId)).toBe(true)
    })
  })

  it('indexes attribute occurrence placement for object and connection occurrences', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(COMPACT_AML))
    const occurrences = semantic.index.attributeOccurrences

    expect(occurrences.map((record) => record.parsed.ownerElementName)).toEqual([
      'CxnOcc',
      'ObjOcc'
    ])

    const onConnection = occurrences.find((record) => record.parsed.ownerSourceId === 'CxnOcc.1')
    expect(onConnection?.parsed).toMatchObject({
      attributeType: 'AT_NAME',
      port: 'CENTER',
      orderNum: 0,
      alignment: 'CENTER',
      symbolFlag: 'TEXT',
      fontStyleSheetId: 'FontSS.1',
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      dx: 10,
      dy: 20
    })
    expect(onConnection?.recordKind).toBe('attribute-occurrence')

    const onObject = occurrences.find((record) => record.parsed.ownerSourceId === 'ObjOcc.1')
    expect(onObject?.parsed.ownerPath).toBe('AML[1]/Group[1]/Group[1]/Model[1]/ObjOcc[1]')
    expect(onObject?.parsed.dx).toBe(10)
  })

  it('indexes connection route points in document order', () => {
    const xml = `<AML>
      <Group Group.ID="Group.Root">
        <Model Model.ID="Model.1" Model.Type="MT_EEPC">
          <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1">
            <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.2">
              <Position Pos.X="10" Pos.Y="20" />
              <Position Pos.X="30" Pos.Y="40" />
              <Position Pos.X="50" Pos.Y="60" />
            </CxnOcc>
          </ObjOcc>
        </Model>
      </Group>
    </AML>`

    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))

    expect(semantic.index.connectionOccurrences.get('CxnOcc.1')?.parsed.routePointCount).toBe(3)
    expect(semantic.index.routePoints.map((point) => [point.pointIndex, point.x, point.y])).toEqual(
      [
        [0, 10, 20],
        [1, 30, 40],
        [2, 50, 60]
      ]
    )
    semantic.index.routePoints.forEach((point) => {
      expect(point.connectionOccurrenceId).toBe('CxnOcc.1')
      expect(point.modelId).toBe('Model.1')
      expect(point.span.end.offset).toBeGreaterThan(point.span.start.offset)
    })
    // Route points do not replace the position records; both layers stay available.
    expect(semantic.index.positions).toHaveLength(3)
  })

  it('indexes lane records with their model, geometry, styling and name', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(COMPACT_AML))
    const lane = semantic.index.lanes.get('Lane.1')

    expect(lane?.recordKind).toBe('lane')
    expect(lane?.parsed).toMatchObject({
      laneId: 'Lane.1',
      modelId: 'Model.1',
      laneType: 'LT_DEFAULT',
      orientation: 'VERTICAL',
      startBorder: 0,
      endBorder: 50_000,
      guid: 'guid-lane-1'
    })
    expect(lane?.parent).toMatchObject({ elementName: 'Model', sourceId: 'Model.1' })

    const laneName = semantic.index.attributes.find(
      (record) => record.parsed.ownerSourceId === 'Lane.1'
    )
    expect(laneName?.parsed.values[0]?.text).toBe('Operations')
    expect(semantic.index.styles.pens.some((pen) => pen.parsed.ownerSourceId === 'Lane.1')).toBe(
      true
    )
    expect(
      semantic.index.styles.brushes.some((brush) => brush.parsed.ownerSourceId === 'Lane.1')
    ).toBe(true)
  })

  it('indexes free-text definitions and their occurrences', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(COMPACT_AML))
    const definition = semantic.index.freeText.get('FFTextDef.1')

    expect(definition?.recordKind).toBe('free-text')
    expect(definition?.parsed).toMatchObject({
      freeTextDefinitionId: 'FFTextDef.1',
      isModelAttr: 'TEXT',
      guid: 'guid-fftext-1'
    })

    const occurrence = semantic.index.freeTextOccurrences[0]
    expect(occurrence?.recordKind).toBe('free-text-occurrence')
    expect(occurrence?.parsed).toMatchObject({
      modelId: 'Model.1',
      freeTextDefinitionId: 'FFTextDef.1',
      fontStyleSheetId: 'FontSS.1',
      symbolFlag: 'TEXT',
      alignment: 'CENTER',
      zorder: 4,
      x: 50,
      y: 40
    })
    expect(semantic.index.freeText.has(occurrence?.parsed.freeTextDefinitionId ?? '')).toBe(true)
  })

  it('keeps every language of a multi-language attribute value with its styled runs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML [
  <!ENTITY LocaleId.USen "1033">
  <!ENTITY LocaleId.AEar "14337">
]>
<AML>
  <Language LocaleId="&LocaleId.USen;" Codepage="1252"><LanguageName>English</LanguageName></Language>
  <Language LocaleId="&LocaleId.AEar;" Codepage="1256"><LanguageName>Arabic</LanguageName></Language>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.1" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="&LocaleId.USen;">
          <StyledElement><Paragraph Alignment="LEFT" Indent="0"><PlainText TextValue="Register animal" /></Paragraph></StyledElement>
        </AttrValue>
        <AttrValue LocaleId="&LocaleId.AEar;">
          <StyledElement><Paragraph Alignment="RIGHT" Indent="0"><PlainText TextValue="تسجيل الحيوان" /></Paragraph></StyledElement>
        </AttrValue>
      </AttrDef>
    </ObjDef>
  </Group>
</AML>`

    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))

    expect(semantic.index.languages.map((record) => record.parsed.locale)).toEqual(['en', 'ar'])
    const name = semantic.index.attributes.find(
      (record) => record.parsed.attributeType === 'AT_NAME'
    )
    expect(name?.parsed.values).toHaveLength(2)
    expect(name?.parsed.values.map((value) => value.locale)).toEqual(['en', 'ar'])
    expect(name?.parsed.values.map((value) => value.text)).toEqual([
      'Register animal',
      'تسجيل الحيوان'
    ])
    // The raw locale reference is preserved verbatim next to the resolved language.
    expect(name?.parsed.values.map((value) => value.localeId)).toEqual([
      '&LocaleId.USen;',
      '&LocaleId.AEar;'
    ])
    // Styled-run attributes such as paragraph alignment survive the absorption.
    const arabicRuns = name?.parsed.values[1]?.runs ?? []
    expect(arabicRuns.map((run) => run.elementName)).toEqual([
      'StyledElement',
      'Paragraph',
      'PlainText'
    ])
    expect(arabicRuns[1]?.rawAttributes).toEqual({ Alignment: 'RIGHT', Indent: '0' })
    expect(arabicRuns[2]?.rawAttributes.TextValue).toBe('تسجيل الحيوان')
    expect(semantic.diagnostics).toHaveLength(0)
  })

  it('reports absorbable elements that appear outside an owner that can retain them', () => {
    const xml = `<AML>
      <Group Group.ID="Group.Root">
        <Model Model.ID="Model.1" Model.Type="MT_EEPC">
          <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1">
            <PlainText TextValue="stray" />
          </ObjOcc>
        </Model>
      </Group>
    </AML>`

    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))

    expect(semantic.index.unknownRecords.map((record) => record.elementName)).toEqual(['PlainText'])
    expect(semantic.index.unknownRecords[0]?.rawAttributes).toEqual({ TextValue: 'stray' })
    expect(semantic.diagnostics).toHaveLength(1)
    expect(semantic.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'unaccounted-element',
      path: 'AML[1]/Group[1]/Model[1]/ObjOcc[1]/PlainText[1]'
    })
    expectEveryElementAccountedFor(xml)
  })

  it('reconciles the AnimalWF export counts against indexed records', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(readAnimalWfExport()))

    expect(semantic.index.database?.parsed.databaseName).toBe('DMT')
    expect(semantic.index.languages).toHaveLength(2)
    expect(semantic.index.groups.size).toBe(2)
    expect(semantic.index.models.size).toBe(8)
    expect(semantic.index.objectDefinitions.size).toBe(279)
    expect(semantic.index.objectOccurrences.size).toBe(494)
    expect(semantic.index.connectionDefinitions.size).toBe(465)
    expect(semantic.index.connectionOccurrences.size).toBe(465)
    expect(semantic.index.attributes).toHaveLength(516)
    expect(semantic.index.attributeOccurrences).toHaveLength(774)
    expect(semantic.index.lanes.size).toBe(16)
    expect(semantic.index.freeText.size).toBe(69)
    expect(semantic.index.freeTextOccurrences).toHaveLength(69)
    expect(semantic.index.attachments.size).toBe(14)
    expect(semantic.index.attachmentOccurrences).toHaveLength(14)
    expect(semantic.index.blobs).toHaveLength(28)
    expect(semantic.index.styles.fontStyleSheets.size).toBe(6)
    expect(semantic.index.routePoints).toHaveLength(1339)
    expect(semantic.diagnostics).toHaveLength(0)
  })

  it('reconciles the remaining AnimalWF index dimensions', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(readAnimalWfExport()))
    const index = semantic.index

    expect(index.root?.parsed.rootElementName).toBe('AML')
    // 858 GUID + 494 ExternalGUID + 90 MasterGUID + 89 SymbolGUID + 8 TemplateGUID.
    expect(index.guidReferences).toHaveLength(1539)
    expect(index.templateReferences).toHaveLength(8)
    expect(index.positions).toHaveLength(1942)
    expect(index.sizes).toHaveLength(1301)
    // 127 <Font> + 12 <FontNode> + 2 <LogFont>.
    expect(index.styles.fonts).toHaveLength(141)
    // 465 CxnOcc + 16 Lane + 13 GfxObj pens; 416 ObjOcc + 16 Lane + 13 GfxObj brushes.
    expect(index.styles.pens).toHaveLength(465 + 16 + 13)
    expect(index.styles.brushes).toHaveLength(416 + 16 + 13)
    expect(index.linkedModelAssignments).toHaveLength(7)
    expect(index.supersededRecords).toHaveLength(0)
    // 13 GfxObj + 13 RoundedRectangle + 126 SizeElement + 19 Container + 3 Union.
    expect(index.unknownRecords).toHaveLength(174)
    expect([...new Set(index.unknownRecords.map((record) => record.elementName))].sort()).toEqual([
      'Container',
      'GfxObj',
      'RoundedRectangle',
      'SizeElement',
      'Union'
    ])
    expect(index.unknownAttributes).toHaveLength(0)
  })

  it('accounts for every element of the AnimalWF export exactly once', () => {
    expectEveryElementAccountedFor(readAnimalWfExport())
  })

  it('keeps both AnimalWF languages on bilingual attribute values', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(readAnimalWfExport()))
    const bilingual = semantic.index.attributes.filter(
      (record) => new Set(record.parsed.values.map((value) => value.locale)).size > 1
    )

    expect(bilingual.length).toBeGreaterThan(0)
    bilingual.forEach((record) => {
      const locales = record.parsed.values.map((value) => value.locale)
      expect(locales).toContain('en')
      expect(locales).toContain('ar')
    })
    expect(
      new Set(
        semantic.index.attributes.flatMap((record) =>
          record.parsed.values.map((value) => value.localeId)
        )
      )
    ).toEqual(new Set(['&LocaleId.USen;', '&LocaleId.AEar;']))
  })
})
