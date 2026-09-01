import { describe, expect, it } from 'vitest'

import { buildMinimalValidDraft } from '../ai/testFixtures'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import {
  tokenizeXmlDocument,
  type TokenizedXmlDocument,
  type XmlElementNode,
  type XmlNode
} from '../source/xmlTokenizer'
import type { ElementSpec } from '../writer'
import { buildAmlFromArisAiDraft } from './arisAiCreate'

function elementChildren(nodes: readonly XmlNode[]): XmlElementNode[] {
  return nodes.filter((node): node is XmlElementNode => node.kind === 'element')
}

function requiredChild(nodes: readonly XmlNode[], name: string): XmlElementNode {
  const child = elementChildren(nodes).find((node) => node.name === name)
  if (!child) throw new Error(`Expected direct <${name}> child.`)
  return child
}

function attribute(node: XmlElementNode, name: string): string | undefined {
  return node.startTag.attributes.find((candidate) => candidate.name === name)?.value
}

function amlRoot(document: TokenizedXmlDocument): XmlElementNode {
  return requiredChild(document.children, 'AML')
}

describe('buildAmlFromArisAiDraft convention options', () => {
  it('keeps omitted and empty options byte-identical to the captured baseline', () => {
    const draft = buildMinimalValidDraft()
    const withoutOptions = buildAmlFromArisAiDraft(draft).xml
    const withEmptyOptions = buildAmlFromArisAiDraft(draft, {}).xml

    expect(withoutOptions).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <AML>
      	<Header-Info DatabaseName="OrbitPM" UserName="local-user" ArisExeVersion="10"/>
      	<Group Group.ID="Group.Root">
      		<ObjDef ObjDef.ID="ObjDef.evt-start" TypeNum="OT_EVT" SymbolNum="ST_EV" ToCxnDefs.IdRefs="CxnDef.rel-start-to-approve">
      			<AttrDef AttrDef.Type="AT_NAME">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Request received"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      		</ObjDef>
      		<ObjDef ObjDef.ID="ObjDef.func-approve" TypeNum="OT_FUNC" SymbolNum="ST_FUNC" ToCxnDefs.IdRefs="CxnDef.rel-approve-to-end" LinkedModels.IdRefs="Model.model-sub">
      			<AttrDef AttrDef.Type="AT_NAME">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Approve request"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      				<AttrValue LocaleId="1025">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="الموافقة على الطلب"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      			<AttrDef AttrDef.Type="AT_DESC">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Manager reviews and approves the request."/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      		</ObjDef>
      		<ObjDef ObjDef.ID="ObjDef.evt-end" TypeNum="OT_EVT" SymbolNum="ST_EV">
      			<AttrDef AttrDef.Type="AT_NAME">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Request approved"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      		</ObjDef>
      		<ObjDef ObjDef.ID="ObjDef.pers-manager" TypeNum="OT_PERS" SymbolNum="ST_PERS_EXT" ToCxnDefs.IdRefs="CxnDef.rel-manager-executes">
      			<AttrDef AttrDef.Type="AT_NAME">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Manager"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      		</ObjDef>
      		<Model Model.ID="Model.model-main" Model.Type="MT_EEPC">
      			<AttrDef AttrDef.Type="AT_NAME">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Approve request"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      				<AttrValue LocaleId="1025">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="الموافقة على الطلب"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      			<AttrDef AttrDef.Type="AT_DESC">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Top-level approval process."/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      			<ObjOcc ObjOcc.ID="ObjOcc.evt-start" ObjDef.IdRef="ObjDef.evt-start" ToCxnOccs.IdRefs="CxnOcc.rel-start-to-approve" SymbolNum="ST_EV">
      				<Position Pos.X="240" Pos.Y="120"/>
      				<Size Size.dX="180" Size.dY="70"/>
      				<CxnOcc CxnOcc.ID="CxnOcc.rel-start-to-approve" CxnDef.IdRef="CxnDef.rel-start-to-approve" ToObjOcc.IdRef="ObjOcc.func-approve">
      					<Pen Color="0" Style="0" Width="1"/>
      					<Position Pos.X="330" Pos.Y="190"/>
      					<Position Pos.X="330" Pos.Y="280"/>
      				</CxnOcc>
      			</ObjOcc>
      			<ObjOcc ObjOcc.ID="ObjOcc.func-approve" ObjDef.IdRef="ObjDef.func-approve" ToCxnOccs.IdRefs="CxnOcc.rel-approve-to-end" SymbolNum="ST_FUNC">
      				<Position Pos.X="240" Pos.Y="280"/>
      				<Size Size.dX="180" Size.dY="70"/>
      				<CxnOcc CxnOcc.ID="CxnOcc.rel-approve-to-end" CxnDef.IdRef="CxnDef.rel-approve-to-end" ToObjOcc.IdRef="ObjOcc.evt-end">
      					<Pen Color="0" Style="0" Width="1"/>
      					<Position Pos.X="330" Pos.Y="350"/>
      					<Position Pos.X="330" Pos.Y="440"/>
      				</CxnOcc>
      			</ObjOcc>
      			<ObjOcc ObjOcc.ID="ObjOcc.evt-end" ObjDef.IdRef="ObjDef.evt-end" SymbolNum="ST_EV">
      				<Position Pos.X="240" Pos.Y="440"/>
      				<Size Size.dX="180" Size.dY="70"/>
      			</ObjOcc>
      			<ObjOcc ObjOcc.ID="ObjOcc.pers-manager" ObjDef.IdRef="ObjDef.pers-manager" ToCxnOccs.IdRefs="CxnOcc.rel-manager-executes" SymbolNum="ST_PERS_EXT">
      				<Position Pos.X="240" Pos.Y="600"/>
      				<Size Size.dX="180" Size.dY="70"/>
      				<CxnOcc CxnOcc.ID="CxnOcc.rel-manager-executes" CxnDef.IdRef="CxnDef.rel-manager-executes" ToObjOcc.IdRef="ObjOcc.func-approve">
      					<Pen Color="0" Style="0" Width="1"/>
      					<Position Pos.X="330" Pos.Y="670"/>
      					<Position Pos.X="330" Pos.Y="280"/>
      				</CxnOcc>
      			</ObjOcc>
      		</Model>
      		<Model Model.ID="Model.model-sub" Model.Type="MT_EEPC">
      			<AttrDef AttrDef.Type="AT_NAME">
      				<AttrValue LocaleId="1033">
      					<StyledElement>
      						<Paragraph Alignment="UNDEFINED" Indent="0"/>
      						<StyledElement>
      							<PlainText TextValue="Sub-process"/>
      						</StyledElement>
      					</StyledElement>
      				</AttrValue>
      			</AttrDef>
      		</Model>
      		<CxnDef CxnDef.ID="CxnDef.rel-start-to-approve" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.func-approve"/>
      		<CxnDef CxnDef.ID="CxnDef.rel-approve-to-end" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.evt-end"/>
      		<CxnDef CxnDef.ID="CxnDef.rel-manager-executes" CxnDef.Type="CT_EXEC_1" ToObjDef.IdRef="ObjDef.func-approve"/>
      	</Group>
      </AML>
      "
    `)
    expect(withEmptyOptions).toBe(withoutOptions)
  })

  it('omits requested objects and every incident connection occurrence only', () => {
    const result = buildAmlFromArisAiDraft(buildMinimalValidDraft(), {
      omitOccurrences: new Set(['evt-end', 'pers-manager'])
    })
    const index = buildSemanticArisDocument(tokenizeXmlDocument(result.xml)).index

    expect(result.objectCount).toBe(2)
    expect(result.omittedOccurrenceCount).toBe(2)
    expect(result.relationCount).toBe(1)
    expect(index.objectDefinitions.size).toBe(4)
    expect(index.connectionDefinitions.size).toBe(3)
    expect(index.objectOccurrences.has('ObjOcc.evt-end')).toBe(false)
    expect(index.objectOccurrences.has('ObjOcc.pers-manager')).toBe(false)
    expect(index.connectionOccurrences.has('CxnOcc.rel-approve-to-end')).toBe(false)
    expect(index.connectionOccurrences.has('CxnOcc.rel-manager-executes')).toBe(false)
    expect(
      index.objectOccurrences.get('ObjOcc.func-approve')?.parsed.toConnectionOccurrenceIds
    ).toEqual([])
    expect(
      index.objectOccurrences.get('ObjOcc.evt-start')?.parsed.toConnectionOccurrenceIds
    ).toEqual(['CxnOcc.rel-start-to-approve'])
    expect([...index.connectionOccurrences.keys()]).toEqual(['CxnOcc.rel-start-to-approve'])
  })

  it('uses geometry and route overrides while fallback routes use actual rectangles', () => {
    const result = buildAmlFromArisAiDraft(buildMinimalValidDraft(), {
      geometry: new Map([
        ['evt-start', { x: 11, y: 22, width: 101, height: 55 }],
        ['func-approve', { x: 333, y: 444, width: 202, height: 88 }]
      ]),
      routes: new Map([
        [
          'rel-start-to-approve',
          [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
            { x: 5, y: 6 }
          ]
        ]
      ])
    })
    const index = buildSemanticArisDocument(tokenizeXmlDocument(result.xml)).index

    expect(index.objectOccurrences.get('ObjOcc.evt-start')?.parsed).toMatchObject({
      x: 11,
      y: 22,
      dx: 101,
      dy: 55
    })
    expect(index.objectOccurrences.get('ObjOcc.func-approve')?.parsed).toMatchObject({
      x: 333,
      y: 444,
      dx: 202,
      dy: 88
    })
    expect(
      index.routePoints
        .filter((point) => point.connectionOccurrenceId === 'CxnOcc.rel-start-to-approve')
        .map((point) => [point.x, point.y])
    ).toEqual([
      [1, 2],
      [3, 4],
      [5, 6]
    ])
    expect(
      index.routePoints
        .filter((point) => point.connectionOccurrenceId === 'CxnOcc.rel-approve-to-end')
        .map((point) => [point.x, point.y])
    ).toEqual([
      [434, 532],
      [330, 440]
    ])
  })

  it('rejects non-integer geometry at writer emission', () => {
    expect(() =>
      buildAmlFromArisAiDraft(buildMinimalValidDraft(), {
        geometry: new Map([
          ['evt-start', { x: 10.5, y: 20, width: 180, height: 70 }]
        ])
      })
    ).toThrow(/Attribute "Pos\.X" must be an integer/u)
  })

  it('appends extra root and model children to their intended parents', () => {
    const extraRootChild: ElementSpec = {
      name: 'FFTextDef',
      attributes: [{ name: 'FFTextDef.ID', value: 'FFTextDef.defaults' }]
    }
    const extraModelChild: ElementSpec = {
      name: 'FFTextOcc',
      attributes: [{ name: 'FFTextDef.IdRef', value: 'FFTextDef.defaults' }],
      children: [
        {
          name: 'Position',
          attributes: [
            { name: 'Pos.X', value: '900' },
            { name: 'Pos.Y', value: '100' }
          ]
        }
      ]
    }

    const result = buildAmlFromArisAiDraft(buildMinimalValidDraft(), {
      extraRootChildren: [extraRootChild],
      extraModelChildren: [extraModelChild]
    })
    const document = tokenizeXmlDocument(result.xml)
    const semantic = buildSemanticArisDocument(document).index
    const root = amlRoot(document)
    const rootChildren = elementChildren(root.children)
    const group = requiredChild(root.children, 'Group')
    const models = elementChildren(group.children).filter((node) => node.name === 'Model')

    expect(rootChildren.map((node) => node.name)).toEqual(['Header-Info', 'FFTextDef', 'Group'])
    expect(attribute(requiredChild(root.children, 'FFTextDef'), 'FFTextDef.ID')).toBe(
      'FFTextDef.defaults'
    )
    expect(
      elementChildren(models[0]?.children ?? []).map((node) => node.name)
    ).toContain('FFTextOcc')
    expect(elementChildren(models[1]?.children ?? []).map((node) => node.name)).not.toContain(
      'FFTextOcc'
    )
    expect(semantic.freeText.has('FFTextDef.defaults')).toBe(true)
    expect(semantic.freeTextOccurrences).toHaveLength(1)
    expect(semantic.freeTextOccurrences[0]?.parsed).toMatchObject({
      modelId: 'Model.model-main',
      freeTextDefinitionId: 'FFTextDef.defaults',
      x: 900,
      y: 100
    })
  })
})
