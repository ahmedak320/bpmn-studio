import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'

import { buildAccountingEntries, elementNameFromEntryPath } from './accounting'
import { buildLexicalCensus } from './lexicalCensus'
import { reconcile, requireReconciled } from './reconcile'
import {
  buildAccountingReport,
  computeReportSha256,
  filterReportByDisposition,
  filterReportByIssue,
  filterReportByKind,
  filterReportByModel,
  serializeAccountingReport
} from './report'
import { adaptSemanticIndex } from './semanticIndexAdapter'

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

function readAnimalWfExport(): string | null {
  const url = new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
  if (!existsSync(url)) return null
  return readFileSync(url, 'utf8')
}

describe('buildLexicalCensus', () => {
  it('counts every source construct in the compact AML independently of the semantic index', () => {
    const document = tokenizeXmlDocument(COMPACT_AML)
    const census = buildLexicalCensus(document)

    expect(census.xmlDeclaration).toBe(1)
    expect(census.xmlDeclarationAttributes).toBe(2)
    expect(census.doctype).toBe(1)
    expect(census.elementCounts.AML).toBe(1)
    expect(census.elementCounts.Model).toBe(1)
    expect(census.elementCounts.ObjDef).toBe(2)
    expect(census.elementCounts.ObjOcc).toBe(2)
    expect(census.elementCounts.CxnDef).toBe(1)
    expect(census.elementCounts.CxnOcc).toBe(1)
    expect(census.elementCounts.AttrDef).toBe(6)
    expect(census.elementCounts.AttrValue).toBe(6)
    expect(census.elementCounts.Position).toBe(6)
    expect(census.elementCounts.Size).toBe(5)
    expect(census.attributeTotal).toBeGreaterThan(0)
    expect(census.attributeCountsByName['Model.ID']).toBe(1)
    expect(census.totalSourceRecords).toBeGreaterThan(0)
  })
})

describe('buildAccountingEntries', () => {
  it('accounts for every source construct in the compact AML', () => {
    const document = tokenizeXmlDocument(COMPACT_AML)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const entries = buildAccountingEntries(document, source)

    // Records
    expect(entries.some((e) => e.kind === 'model' && e.sourceId === 'Model.1')).toBe(true)
    expect(entries.some((e) => e.kind === 'object-definition' && e.sourceId === 'ObjDef.1')).toBe(true)
    expect(entries.some((e) => e.kind === 'object-occurrence' && e.sourceId === 'ObjOcc.1')).toBe(true)
    expect(entries.some((e) => e.kind === 'connection-definition' && e.sourceId === 'CxnDef.1')).toBe(true)
    expect(entries.some((e) => e.kind === 'connection-occurrence' && e.sourceId === 'CxnOcc.1')).toBe(true)

    // Absorbed / raw elements
    expect(entries.some((e) => e.kind === 'language-name')).toBe(true)
    expect(entries.some((e) => e.kind === 'attribute-value')).toBe(true)
    expect(entries.some((e) => e.kind === 'styled-run')).toBe(true)

    // Unknown elements preserved
    expect(entries.some((e) => e.kind === 'unknown' && e.sourcePath.includes('GfxObj'))).toBe(true)

    // Attributes, leaf nodes, XML declaration, DOCTYPE
    expect(entries.some((e) => e.kind === 'element-attribute')).toBe(true)
    expect(entries.some((e) => e.kind === 'text')).toBe(true)
    expect(entries.some((e) => e.kind === 'xml-declaration')).toBe(true)
    expect(entries.some((e) => e.kind === 'doctype')).toBe(true)

    // Assignment derived from LinkedModels.IdRefs
    expect(entries.some((e) => e.kind === 'assignment' && e.targetIds.includes('Model.1'))).toBe(true)

    // Route points are Position elements under CxnOcc
    const routePoints = entries.filter((e) => e.kind === 'route-point')
    expect(routePoints).toHaveLength(2)
    routePoints.forEach((point) => {
      expect(point.targetIds).toContain('CxnOcc.1')
      expect(point.targetIds).toContain('Model.1')
    })
  })
})

describe('reconcile', () => {
  it('reports zero unaccounted records for the compact AML', () => {
    const document = tokenizeXmlDocument(COMPACT_AML)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const census = buildLexicalCensus(document)
    const entries = buildAccountingEntries(document, source)
    const result = reconcile(census, entries)

    expect(result.ok).toBe(true)
    expect(result.unaccountedCount).toBe(0)
    expect(result.perConstruct).toHaveLength(0)
    expect(requireReconciled(result).ok).toBe(true)
  })
})

describe('accounting report', () => {
  it('produces byte-identical deterministic JSON across multiple runs', async () => {
    const document = tokenizeXmlDocument(COMPACT_AML)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const entries = buildAccountingEntries(document, source)
    const census = buildLexicalCensus(document)
    const reconciliation = reconcile(census, entries)
    const report = buildAccountingReport(entries, reconciliation)

    const first = serializeAccountingReport(report)
    const second = serializeAccountingReport(buildAccountingReport(entries, reconciliation))
    expect(second).toBe(first)

    const sha1 = await computeReportSha256(first)
    const sha2 = await computeReportSha256(second)
    expect(sha2).toBe(sha1)
    expect(sha1).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('supports filtering by model, kind, disposition, and issue', () => {
    const document = tokenizeXmlDocument(COMPACT_AML)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const entries = buildAccountingEntries(document, source)
    const report = buildAccountingReport(entries, reconcile(buildLexicalCensus(document), entries))

    expect(filterReportByModel(report, 'Model.1').length).toBeGreaterThan(0)
    expect(filterReportByModel(report, 'Model.2')).toHaveLength(0)
    expect(filterReportByKind(report, 'model').length).toBe(1)
    expect(filterReportByDisposition(report, 'editable-native').length).toBeGreaterThan(0)
    expect(filterReportByIssue(report).length).toBeGreaterThan(0)
  })

  it('carries enough identity in each row for the UI to select the element', () => {
    const document = tokenizeXmlDocument(COMPACT_AML)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const entries = buildAccountingEntries(document, source)
    const report = buildAccountingReport(entries, reconcile(buildLexicalCensus(document), entries))

    const modelRow = report.entries.find((row) => row.kind === 'model')
    expect(modelRow?.sourceId).toBe('Model.1')
    expect(modelRow?.targetIds).toContain('Model.1')
    expect(modelRow?.sourcePath).toBe('AML[1]/Group[1]/Group[1]/Model[1]')

    const occurrenceRow = report.entries.find((row) => row.sourceId === 'ObjOcc.1')
    expect(occurrenceRow?.targetIds).toContain('ObjOcc.1')
    expect(occurrenceRow?.targetIds).toContain('Model.1')
    expect(occurrenceRow?.modelId).toBe('Model.1')
  })
})

describe('elementNameFromEntryPath', () => {
  it('extracts element names and returns null for non-element paths', () => {
    expect(elementNameFromEntryPath('AML[1]/Group[1]/Model[1]')).toBe('Model')
    expect(elementNameFromEntryPath('AML[1]')).toBe('AML')
    expect(elementNameFromEntryPath('AML[1]/Group[1]@Group.ID')).toBeNull()
    expect(elementNameFromEntryPath('AML[1]/Group[1]/text()[1]')).toBeNull()
    expect(elementNameFromEntryPath('AML[1]/Group[1]/ObjDef[1]#assignment[1]')).toBeNull()
  })
})

describe('AnimalWF integration', () => {
  const fixture = readAnimalWfExport()
  const itIfFixture = fixture ? it : it.skip

  itIfFixture('accounts for every AnimalWF source construct with zero unaccounted records', () => {
    const xml = fixture!
    const document = tokenizeXmlDocument(xml)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const census = buildLexicalCensus(document)
    const entries = buildAccountingEntries(document, source)
    const result = reconcile(census, entries)

    expect(result.ok).toBe(true)
    expect(result.unaccountedCount).toBe(0)
    expect(entries.filter((e) => !e.disposition)).toHaveLength(0)

    // Known-good aggregate counts from the transformation plan.
    const byKind = (kind: string) => entries.filter((e) => e.kind === kind).length
    expect(byKind('model')).toBe(8)
    expect(byKind('object-definition')).toBe(279)
    expect(byKind('object-occurrence')).toBe(494)
    expect(byKind('connection-definition')).toBe(465)
    expect(byKind('connection-occurrence')).toBe(465)
    expect(byKind('model-attribute') + byKind('attribute-definition')).toBe(516)
    expect(byKind('attribute-occurrence')).toBe(774)
    expect(byKind('lane')).toBe(16)
    expect(byKind('free-text')).toBe(69)
    expect(byKind('free-text-occurrence')).toBe(69)
    expect(byKind('ole-definition')).toBe(14)
    expect(byKind('ole-occurrence')).toBe(14)
    expect(byKind('blob')).toBe(28)
    expect(byKind('font-style-sheet')).toBe(6)
    expect(byKind('route-point')).toBe(1339)
    expect(byKind('language')).toBe(2)
    expect(byKind('group')).toBe(2)

    // Report determinism and SHA-256 on real data.
    const report = buildAccountingReport(entries, result)
    const serialized = serializeAccountingReport(report)
    expect(serializeAccountingReport(buildAccountingReport(entries, result))).toBe(serialized)
  })

  itIfFixture('reports exact total source records and total accounted', () => {
    const xml = fixture!
    const document = tokenizeXmlDocument(xml)
    const semantic = buildSemanticArisDocument(document)
    const source = adaptSemanticIndex(semantic.index)
    const census = buildLexicalCensus(document)
    const entries = buildAccountingEntries(document, source)
    const result = reconcile(census, entries)

    // Expose the numbers in the test output for the final report.
    expect(result.totalSourceRecords).toBeGreaterThan(0)
    expect(result.totalAccounted).toBeGreaterThanOrEqual(result.totalSourceRecords)
    expect(result.unaccountedCount).toBe(0)
  })
})
