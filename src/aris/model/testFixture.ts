import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { buildFromSource } from './buildFromSource'
import type { ArisWorkingDocument } from './types'

export const SYNTHETIC_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="TestDB" CreateDate="2026-07-28" CreateTime="21:45:00" UserName="tester" ArisExeVersion="0.1.0"/>
  <Language LocaleId="de-DE" Codepage="1252">
    <LanguageName>Deutsch</LanguageName>
  </Language>
  <Language LocaleId="en-US" Codepage="1252">
    <LanguageName>English</LanguageName>
  </Language>
  <Group Group.ID="g1">
    <Model Model.ID="m1" Model.Type="MT_EEPC" GridSize="10" Scale="100" PrintScale="100" BackColor="16777215">
      <Lane Lane.ID="l1" Lane.Type="LT_DEFAULT" Orientation="horizontal" StartBorder="0" EndBorder="0"/>
      <ObjOcc ObjOcc.ID="occ1" ObjDef.IdRef="od1" SymbolNum="ST_FUNC" Zorder="1" SequenceNumber="1">
        <Position Pos.X="10" Pos.Y="20"/>
        <Size Size.dX="100" Size.dY="50"/>
        <AttrOcc AttrTypeNum="AT_NAME" Port="1" OrderNum="1" Alignment="1" OffsetX="5" OffsetY="5" Rotation="0">
          <Size Size.dX="50" Size.dY="20"/>
        </AttrOcc>
        <CxnOcc CxnOcc.ID="co1" CxnDef.IdRef="cd1" ToObjOcc.IdRef="occ2" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="110" Pos.Y="45"/>
          <Position Pos.X="210" Pos.Y="45"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ2" ObjDef.IdRef="od1" SymbolNum="ST_FUNC" Zorder="2" SequenceNumber="2">
        <Position Pos.X="220" Pos.Y="20"/>
        <Size Size.dX="100" Size.dY="50"/>
      </ObjOcc>
      <FFTextOcc FFTextOcc.ID="fto1" FFTextDef.IdRef="ftd1" Zorder="3">
        <Position Pos.X="10" Pos.Y="120"/>
        <Size Size.dX="200" Size.dY="20"/>
      </FFTextOcc>
    </Model>
    <Model Model.ID="m2" Model.Type="MT_UNKNOWN_TYPE">
      <ObjOcc ObjOcc.ID="occ3" ObjDef.IdRef="od3" SymbolNum="ST_UNKNOWN">
        <Position Pos.X="0" Pos.Y="0"/>
        <Size Size.dX="10" Size.dY="10"/>
      </ObjOcc>
    </Model>
    <ObjDef ObjDef.ID="od1" TypeNum="OT_FUNC" SymbolNum="ST_FUNC" LinkedModels.IdRefs="m2">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="de-DE">Genehmigen</AttrValue>
        <AttrValue LocaleId="en-US">Approve</AttrValue>
      </AttrDef>
      <AttrDef AttrDef.Type="AT_DESC">
        <AttrValue LocaleId="en-US">Approval step</AttrValue>
      </AttrDef>
      <AttrDef AttrDef.Type="AT_CUSTOM">
        <AttrValue LocaleId="de-DE">C1</AttrValue>
        <AttrValue LocaleId="en-US">C1-en</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="cd1" CxnDef.Type="CT_FUNC_1" ToObjDef.IdRef="od2"/>
    </ObjDef>
    <ObjDef ObjDef.ID="od2" TypeNum="OT_EVT" SymbolNum="ST_EVT">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="de-DE">Genehmigt</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="od3" TypeNum="OT_CUSTOM_XYZ" SymbolNum="ST_UNKNOWN">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="de-DE">Unbekannt</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="od4" TypeNum="OT_BUSINESS_RULE" SymbolNum="ST_RULE_XOR">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="de-DE">XOR</AttrValue>
      </AttrDef>
    </ObjDef>
    <FFTextDef FFTextDef.ID="ftd1">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="de-DE">Hinweis</AttrValue>
      </AttrDef>
    </FFTextDef>
  </Group>
</AML>
`

export async function buildTestDocument(): Promise<{
  readonly document: ArisWorkingDocument
  readonly bytes: Uint8Array
  readonly sha256: string
}> {
  const bytes = new TextEncoder().encode(SYNTHETIC_AML)
  const sourcePackage = await createArisXmlSourcePackage({
    name: 'synthetic.aml',
    relPath: null,
    bytes
  })
  const document = buildFromSource(sourcePackage.index)
  return { document, bytes, sha256: sourcePackage.sha256 }
}
