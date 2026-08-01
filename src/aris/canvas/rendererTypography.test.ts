// @vitest-environment jsdom

/**
 * V8 typography on the mounted canvas: `FontStyleSheet`-resolved
 * family/size/weight/colour on occurrence captions, attribute numbering,
 * connection labels and free text; multi-line wrapping inside the content
 * box; bidi attributes on Arabic text; and the end of the empty-bordered-box
 * artifact for bound free-text notes.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { buildFromSource } from '../model/buildFromSource'
import { ARIS_PRINT_FRAME_LAYER } from './renderer'
import { wrapLabelLines } from './typography'
import { bootCanvas, type Harness } from './testing/harness'

const TYPOGRAPHY_AML = `<AML>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.1" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">
          <StyledElement>
            <Bold/>
              <StyledElement>
                <Paragraph Alignment="UNDEFINED" Indent="0"/>
                  <StyledElement>
                    <PlainText TextValue="Login to TAMM portal and select the Pet Owner Registration Service"/>
                  </StyledElement>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
      <AttrDef AttrDef.Type="AT_ID">
        <AttrValue LocaleId="1033">
          <StyledElement>
            <Bold/>
              <StyledElement>
                <Paragraph Alignment="UNDEFINED" Indent="0"/>
                  <StyledElement>
                    <PlainText TextValue="01"/>
                  </StyledElement>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.2" TypeNum="OT_BUSINESS_RULE">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="14337">
          <StyledElement>
            <Bold/>
              <StyledElement>
                <Paragraph Alignment="UNDEFINED" Indent="0"/>
                  <StyledElement>
                    <PlainText TextValue="قرار رئيس دائرة التخطيط العمراني والبلدية"/>
                  </StyledElement>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.3" TypeNum="OT_PERS">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">
          <StyledElement>
            <Paragraph Alignment="UNDEFINED" Indent="0"/>
              <StyledElement>
                <PlainText TextValue="Pet Owner"/>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_OCCUPIES_1" ToObjDef.IdRef="ObjDef.1">
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033">
            <StyledElement>
              <Paragraph Alignment="UNDEFINED" Indent="0"/>
                <StyledElement>
                  <PlainText TextValue="occupies"/>
                </StyledElement>
            </StyledElement>
          </AttrValue>
        </AttrDef>
      </CxnDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.4" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">
          <StyledElement>
            <Bold/>
              <StyledElement>
                <Paragraph Alignment="UNDEFINED" Indent="0"/>
                  <StyledElement>
                    <PlainText TextValue="Approve the User Terms and Conditions"/>
                  </StyledElement>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
    </ObjDef>
    <Model Model.ID="Model.1" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_ID">
        <AttrValue LocaleId="1033">
          <StyledElement>
            <Paragraph Alignment="UNDEFINED" Indent="0"/>
              <StyledElement>
                <PlainText TextValue="AWF.01.01"/>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1" SymbolNum="ST_FUNC">
        <Position Pos.X="765" Pos.Y="1707" />
        <Size Size.dX="670" Size.dY="240" />
        <AttrOcc AttrTypeNum="AT_ID" OffsetX="215" OffsetY="150" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
        <AttrOcc AttrTypeNum="AT_NAME" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
        <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.3" Zorder="3">
          <Position Pos.X="1100" Pos.Y="1800" />
          <Position Pos.X="1200" Pos.Y="1800" />
          <AttrOcc AttrTypeNum="AT_TYPE_6" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.2" ObjDef.IdRef="ObjDef.2" SymbolNum="ST_BUSINESS_RULE">
        <Position Pos.X="5920" Pos.Y="800" />
        <Size Size.dX="661" Size.dY="193" />
        <AttrOcc AttrTypeNum="AT_NAME" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.3" ObjDef.IdRef="ObjDef.3" SymbolNum="ST_PERS">
        <Position Pos.X="1500" Pos.Y="1707" />
        <Size Size.dX="554" Size.dY="151" />
        <AttrOcc AttrTypeNum="AT_NAME" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.4" ObjDef.IdRef="ObjDef.4" SymbolNum="ST_FUNC">
        <Position Pos.X="765" Pos.Y="3000" />
        <Size Size.dX="300" Size.dY="240" />
        <AttrOcc AttrTypeNum="AT_NAME" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
      </ObjOcc>
      <FFTextOcc FFTextDef.IdRef="FFTextDef.1" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="16">
        <Position Pos.X="987" Pos.Y="114" />
      </FFTextOcc>
      <FFTextOcc FFTextDef.IdRef="FFTextDef.2" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="17">
        <Position Pos.X="1823" Pos.Y="122" />
      </FFTextOcc>
      <FFTextOcc FFTextDef.IdRef="FFTextDef.3" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="18">
        <Position Pos.X="5000" Pos.Y="3000" />
        <Size Size.dX="400" Size.dY="120" />
      </FFTextOcc>
    </Model>
  </Group>
  <FFTextDef FFTextDef.ID="FFTextDef.1" IsModelAttr="TEXT">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033">
        <StyledElement>
          <Bold/>
            <StyledElement>
              <SizeElement Value="10"/>
                <StyledElement>
                  <Font Name="Arial"/>
                    <StyledElement>
                      <Paragraph Alignment="UNDEFINED" Indent="0"/>
                        <StyledElement>
                          <PlainText TextValue="Process Code:"/>
                        </StyledElement>
                    </StyledElement>
                </StyledElement>
            </StyledElement>
        </StyledElement>
      </AttrValue>
    </AttrDef>
  </FFTextDef>
  <FFTextDef FFTextDef.ID="FFTextDef.3" IsModelAttr="TEXT">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033">
        <StyledElement>
          <Paragraph Alignment="UNDEFINED" Indent="0"/>
            <StyledElement>
              <PlainText TextValue="Reference"/>
            </StyledElement>
        </StyledElement>
      </AttrValue>
    </AttrDef>
  </FFTextDef>
  <FFTextDef FFTextDef.ID="FFTextDef.2" IsModelAttr="MODELATTR">
    <AttrDef AttrDef.Type="AT_MODEL_AT">
      <AttrValue LocaleId="1033">AT_ID</AttrValue>
    </AttrDef>
    <AttrDef AttrDef.Type="AT_MODEL_AT_GUID">
      <AttrValue LocaleId="1033">00000000-0000-0000-0000-000000000000;1</AttrValue>
    </AttrDef>
  </FFTextDef>
  <FontStyleSheet FontSS.ID="FontSS.1">
    <FontNode LocaleId="14337" FaceName="Arial" Height="-13" Weight="400" Italic="NO" Color="0" />
    <FontNode LocaleId="1033" FaceName="Arial" Height="-10" Weight="400" Italic="NO" Color="0" />
  </FontStyleSheet>
</AML>`

const baseDocument = buildFromSource(
  buildSemanticArisDocument(tokenizeXmlDocument(TYPOGRAPHY_AML)).index
)

// A connection definition's stored attribute values are definition-local in
// the working model (AML indexes `AttrDef` records under their owning
// `ObjDef`), so the fixture attaches the relation label value directly.
const connectionDefinitions = new Map(baseDocument.connectionDefinitions)
const cxnDefinition = connectionDefinitions.get('CxnDef.1')!
connectionDefinitions.set(
  'CxnDef.1',
  Object.freeze({
    ...cxnDefinition,
    attributes: Object.freeze([
      Object.freeze({
        type: 'AT_TYPE_6',
        values: Object.freeze([Object.freeze({ localeId: '1033', text: 'occupies' })])
      })
    ])
  })
)
const workingDocument = Object.freeze({
  ...baseDocument,
  connectionDefinitions: Object.freeze(connectionDefinitions)
})

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function groupOf(elementId: string): Element {
  const registry = harness!.canvas.elementRegistry
  const group = registry.getGraphics(elementId).querySelector('[data-aris-kind]')
  if (!group) throw new Error(`No rendered group for ${elementId}.`)
  return group
}

describe('V8 typography on the mounted canvas', () => {
  it('resolves the occurrence caption font from the FontStyleSheet and bold name runs', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const caption = groupOf('ObjOcc.1').querySelector('text[data-aris-caption]')!
    expect(caption.getAttribute('font-family')).toBe('Arial, Helvetica, sans-serif')
    expect(caption.getAttribute('font-size')).toBe('35.278')
    expect(caption.getAttribute('font-weight')).toBe('700')
    expect(caption.getAttribute('fill')).toBe('#000000')
  })

  it('wraps a long caption over multiple vertically-centred tspans inside the content box', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const caption = groupOf('ObjOcc.1').querySelector('text[data-aris-caption]')!
    const tspans = [...caption.querySelectorAll('tspan')]
    expect(tspans.length).toBeGreaterThanOrEqual(2)
    expect(tspans.map((node) => node.textContent).join(' ')).toBe(
      'Login to TAMM portal and select the Pet Owner Registration Service'
    )
    // Vertically centred on the descriptor content box (y 16…212 on the 240-tall card).
    const ys = tspans.map((node) => Number(node.getAttribute('y')))
    expect((ys[0]! + ys[ys.length - 1]!) / 2).toBeCloseTo(122, 0)
    // Every line is horizontally centred on the same content-box centre.
    const xs = new Set(tspans.map((node) => node.getAttribute('x')))
    expect(xs.size).toBe(1)
  })

  it('wraps a bold caption against the bold advance table, not the regular one', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const caption = groupOf('ObjOcc.4').querySelector('text[data-aris-caption]')!
    const tspans = [...caption.querySelectorAll('tspan')]
    const text = 'Approve the User Terms and Conditions'
    // ST_FUNC content box = 80/100 of the 300-unit card = 240 units wide; the
    // caption font resolves to bold Arial (the AT_NAME run is <Bold/>).
    const contentWidth = (80 / 100) * 300
    const size = 35.278
    const boldWrap = wrapLabelLines(text, contentWidth, size, 'bold')
    const regularWrap = wrapLabelLines(text, contentWidth, size, 'regular')
    // Red-first guard: the box width is chosen so the two tables disagree, so a
    // regular-table measurement would paint the wrong number of lines.
    expect(boldWrap.length).not.toBe(regularWrap.length)
    expect(tspans.map((node) => node.textContent)).toEqual([...boldWrap])
  })

  it('paints the numbering annotation in the placement font (bold), at its source rect', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const label = groupOf('ObjOcc.1').querySelector('text[data-aris-attribute-label="AT_ID"]')!
    expect(label.textContent).toBe('01')
    expect(label.getAttribute('font-size')).toBe('35.278')
    expect(label.getAttribute('font-weight')).toBe('700')
    expect(label.getAttribute('font-family')).toBe('Arial, Helvetica, sans-serif')
  })

  it('renders the Arabic law caption RTL at the Arabic font size, bold', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const caption = groupOf('ObjOcc.2').querySelector('text[data-aris-caption]')!
    expect(caption.getAttribute('font-size')).toBe('45.861')
    expect(caption.getAttribute('font-weight')).toBe('700')
    const arabicNode = caption.matches('[direction]')
      ? caption
      : caption.querySelector('[direction]')
    expect(arabicNode?.getAttribute('direction')).toBe('rtl')
    expect(arabicNode?.getAttribute('unicode-bidi')).toBe('plaintext')
  })

  it('resolves the connection label font from its placement sheet', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const group = groupOf('cxnlabel:CxnOcc.1:0:AT_TYPE_6')
    expect(group.getAttribute('data-aris-font-ss')).toBe('FontSS.1')
    const text = group.querySelector('text[data-aris-caption]')!
    expect(text.textContent).toBe('occupies')
    expect(text.getAttribute('font-size')).toBe('35.278')
    expect(text.getAttribute('font-family')).toBe('Arial, Helvetica, sans-serif')
  })

  it('anchors an unsized header label at its source position, with no invented border', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const note = workingDocument.models
      .get('Model.1')!
      .freeText.find((entry) => entry.definitionId === 'FFTextDef.1')!
    const group = groupOf(`text:${note.id}`)
    expect(group.querySelector('rect')).toBeNull()
    const text = group.querySelector('text[data-aris-caption]')!
    expect(text.textContent).toBe('Process Code:')
    // The drawn group's local origin is the note's Position; the text block
    // centres on it (CENTER alignment), so the anchor is (0, 0) locally.
    expect(text.getAttribute('x')).toBe('0')
    expect(text.getAttribute('y')).toBe('0')
    expect(text.getAttribute('font-size')).toBe('35.278')
    expect(text.getAttribute('font-weight')).toBe('700')
  })

  it('draws no empty bordered box for a bound note; the print frame paints its value', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const freeTextId = workingDocument.models
      .get('Model.1')!
      .freeText.find((note) => note.definitionId === 'FFTextDef.2')!.id
    const group = groupOf(`text:${freeTextId}`)
    expect(group.querySelector('rect')).toBeNull()
    expect(group.querySelector('text')).toBeNull()

    const layer = harness.canvas.canvas.getLayer(ARIS_PRINT_FRAME_LAYER) as SVGGElement
    const value = layer.querySelector('[data-aris-print-frame-text="anchored-value"]')!
    expect(value.textContent).toBe('AWF.01.01')
    expect(value.getAttribute('x')).toBe('1823')
    expect(value.getAttribute('y')).toBe('122')
    // The bound note's own sheet size (35.278) reaches the painted value.
    expect(value.getAttribute('font-size')).toBe('35')
  })

  it('insets a sized full-box free-text note so its caption wraps inside the frame', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const freeTextId = workingDocument.models
      .get('Model.1')!
      .freeText.find((note) => note.definitionId === 'FFTextDef.3')!.id
    const group = groupOf(`text:${freeTextId}`)
    const text = group.querySelector('text[data-aris-caption]')!
    // The full-box path now passes an inset content box, so the caption text
    // node is marked `content` (drawCaption only adds that when given a box).
    expect(text.getAttribute('data-aris-part')).toBe('content')
  })

  it('clips a caption to the full shape bounds via a group-local clipPath', () => {
    harness = bootCanvas({ document: workingDocument, modelId: 'Model.1' })
    const group = groupOf('ObjOcc.1')
    const clipPath = group.querySelector('clipPath')!
    expect(clipPath).not.toBeNull()
    const clipId = clipPath.getAttribute('id')!
    expect(clipId.startsWith('aris-caption-clip-')).toBe(true)
    // The clip rect is the FULL 670×240 card bounds, not the content box.
    const rect = clipPath.querySelector('rect')!
    expect(rect.getAttribute('width')).toBe('670')
    expect(rect.getAttribute('height')).toBe('240')
    // The clip group references it and still holds the editable caption node.
    const clipGroup = group.querySelector(`g[clip-path="url(#${clipId})"]`)!
    expect(clipGroup).not.toBeNull()
    const caption = clipGroup.querySelector('text[data-aris-caption]')
    expect(caption).not.toBeNull()
  })
})
