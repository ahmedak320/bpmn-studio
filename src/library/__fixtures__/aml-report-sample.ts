/**
 * Focused ARIS export covering every report disposition with real AML
 * structures: EPCs, model assignments, duplicate occurrences, satellites,
 * a value-chain container, an unsupported model, and dangling references.
 */
export const AML_REPORT_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Report fixture database"/>
  <Group Group.ID="Group.Report">
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Request received"/></AttrValue></AttrDef>
      <CxnDef CxnDef.ID="Cxn.Start.Main" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Main"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Main" TypeNum="OT_FUNC"
      LinkedModels.IdRefs=" Model.Child.A Model.Child.B Model.Missing ">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033"><PlainText TextValue="Review request"/></AttrValue>
        <AttrValue LocaleId="14337"><PlainText TextValue="مراجعة الطلب"/></AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="Cxn.Main.Rule" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Rule"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Rule" TypeNum="OT_RULE" SymbolNum="ST_OPR_UNSUPPORTED">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Unclassified decision"/></AttrValue></AttrDef>
      <CxnDef CxnDef.ID="Cxn.Rule.Custom" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Custom"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Custom" TypeNum="OT_EXTERNAL_ACTION">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="External action"/></AttrValue></AttrDef>
      <CxnDef CxnDef.ID="Cxn.Custom.End" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.End"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.End" TypeNum="OT_EVT">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Request completed"/></AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Performer" TypeNum="OT_PERS">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Case officer"/></AttrValue></AttrDef>
      <CxnDef CxnDef.ID="Cxn.Performer.Main" CxnDef.Type="CT_EXEC_1" ToObjDef.IdRef="ObjDef.Main"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.UnusedSatellite" TypeNum="OT_APPL_SYS">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Unused system"/></AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Orphan" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Catalogue orphan"/></AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Child.A" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Child A"/></AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Child.B" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Child B"/></AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Container" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Overview group"/></AttrValue></AttrDef>
      <CxnDef CxnDef.ID="Cxn.Container.Leaf" CxnDef.Type="CT_IS_PRCS_ORNT_SUPER_1" ToObjDef.IdRef="ObjDef.Leaf"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Leaf" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Overview leaf"/></AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.UnsupportedModelOnly" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Organization chart activity"/></AttrValue></AttrDef>
    </ObjDef>

    <Model Model.ID="Model.Main" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Main process"/></AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="Occ.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV"/>
      <ObjOcc ObjOcc.ID="Occ.Main.1" ObjDef.IdRef="ObjDef.Main" SymbolNum="ST_FUNC"/>
      <ObjOcc ObjOcc.ID="Occ.Main.2" ObjDef.IdRef="ObjDef.Main" SymbolNum="ST_FUNC"/>
      <ObjOcc ObjOcc.ID="Occ.Rule" ObjDef.IdRef="ObjDef.Rule" SymbolNum="ST_OPR_UNSUPPORTED"/>
      <ObjOcc ObjOcc.ID="Occ.Custom" ObjDef.IdRef="ObjDef.Custom" SymbolNum="ST_FUNC"/>
      <ObjOcc ObjOcc.ID="Occ.End" ObjDef.IdRef="ObjDef.End" SymbolNum="ST_EV"/>
      <ObjOcc ObjOcc.ID="Occ.Performer" ObjDef.IdRef="ObjDef.Performer" SymbolNum="ST_PERS_EXT"/>
      <ObjOcc ObjOcc.ID="Occ.UnusedSatellite" ObjDef.IdRef="ObjDef.UnusedSatellite" SymbolNum="ST_APPL_SYS"/>
      <ObjOcc ObjOcc.ID="Occ.Missing" ObjDef.IdRef="ObjDef.Missing" SymbolNum="ST_FUNC"/>
    </Model>
    <Model Model.ID="Model.Child.A" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Child process A"/></AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="Occ.Child.A" ObjDef.IdRef="ObjDef.Child.A" SymbolNum="ST_FUNC"/>
    </Model>
    <Model Model.ID="Model.Child.B" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Child process B"/></AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="Occ.Child.B" ObjDef.IdRef="ObjDef.Child.B" SymbolNum="ST_FUNC"/>
    </Model>
    <Model Model.ID="Model.Overview" Model.Type="MT_VAL_ADD_CHN_DGM">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Process overview"/></AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="Occ.Container" ObjDef.IdRef="ObjDef.Container" SymbolNum="ST_FUNC"/>
      <ObjOcc ObjOcc.ID="Occ.Leaf" ObjDef.IdRef="ObjDef.Leaf" SymbolNum="ST_FUNC"/>
    </Model>
    <Model Model.ID="Model.Unsupported" Model.Type="MT_ORG_CHRT">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Organization chart"/></AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="Occ.Unsupported" ObjDef.IdRef="ObjDef.UnsupportedModelOnly" SymbolNum="ST_FUNC"/>
    </Model>
  </Group>
</AML>`
