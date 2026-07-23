// A REALISTIC trimmed ARIS AML export, hand-reduced from a real ARIS 10
// database export ("DMT", 10.0.11.0.1400208), keeping every structural quirk
// the converter must survive: internal DTD entities used INSIDE attribute
// values (`LocaleId="&LocaleId.AEar;"`); CRLF + multi-line start tags (see the
// transform at the bottom); bilingual AT_NAMEs with real Arabic, numeric char
// refs, `&amp;`/`&apos;`, one name split into two styled runs, and all three
// name-storage shapes; two MT_EEPC models (one with full ARIS-unit geometry,
// one with none → auto-layout) + one MT_VAL_ADD_CHN_DGM landscape (no file);
// one of each satellite connection type; AND/XOR rule occurrences; Lane and
// FFTextDef AT_NAMEs that must not pollute the model name; CxnOcc waypoint
// Positions / zero-size AttrOcc Sizes that must not pollute occ geometry; and
// a cross-model CT_REFS_TO_2 (→ callActivity).
//
// Model M1 (AWF-REG-01 "Register animal owner"):
//   E1 →(ACTIV) F1 →(LEADS_TO_1) R1[XOR] →(LEADS_TO_2) E2 / E3
//   E2 →(IS_EVAL_BY) R2[AND] →(ACTIV) F2, F3;  F2 →(CRT) E4;  F3 →(CRT) E5
//   satellites: P1 exec→F1, cc→F2 · PT1 exec2→F2 · S1 supp→F1 ·
//     ENT1 inp_for→F2 · F2 read→ENT2 · F1 has_out→ENT1, crt_out_to→DOC1 ·
//     R1 eval_by→BR1 · BR2 alloc→R2 · POL1 affects→F1 (ignored) ·
//     F3 refs_to→F9 (occurs in M2 → callActivity)
// Model M2 ("Archive requests"): E8 →(ACTIV) F9 →(CRT) E9, no geometry.

const LF_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML SYSTEM "ARIS-Export.dtd" [
	<!ENTITY LocaleId.AEar "14337">
	<!ENTITY Codepage.AEar "1256">
	<!ENTITY LocaleId.USen "1033">
	<!ENTITY Codepage.USen "1252">
]>
<!-- exported with version 10.0.11.0.1400208 -->
<AML>
	<Header-Info
		CreateTime="09:39:47.326"
		CreateDate="03-01-2024"
		DatabaseName="DMT"
		UserName="hazim"
		ArisExeVersion="100"
	/>
	<Language LocaleId="&LocaleId.AEar;" Codepage="&Codepage.AEar;">
		<LanguageName>Arabic</LanguageName>
	</Language>
	<Language LocaleId="&LocaleId.USen;" Codepage="&Codepage.USen;">
		<LanguageName>English</LanguageName>
	</Language>
	<Group Group.ID="Group.Root">
		<ObjDef ObjDef.ID="ObjDef.E1"
			TypeNum="OT_EVT"
			SymbolNum="ST_EV"
		Creator="hazim"
>
			<GUID>9c8698bd-0000-11ed-5bd9-005056be8dc3</GUID>
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;">
					<StyledElement>
						<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="تم استلام الطلب"/>
							</StyledElement>
					</StyledElement>
				</AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;">
					<StyledElement>
						<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="Application received"/>
							</StyledElement>
					</StyledElement>
				</AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C1"
				CxnDef.Type="CT_ACTIV_1"
				ToObjDef.IdRef="ObjDef.F1"
>
				<GUID>9cf909b2-0001-11ed-5bd9-005056be8dc3</GUID>
			</CxnDef>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.F1" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;">
					<StyledElement>
						<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="مراجعة الطلب"/>
							</StyledElement>
					</StyledElement>
				</AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;">
					<StyledElement>
						<Font Name="Arial"/>
							<StyledElement>
								<PlainText TextValue="Review application"/>
							</StyledElement>
					</StyledElement>
				</AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C2" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.R1"/>
			<CxnDef CxnDef.ID="CxnDef.C3" CxnDef.Type="CT_HAS_OUT" ToObjDef.IdRef="ObjDef.ENT1"/>
			<CxnDef CxnDef.ID="CxnDef.C4" CxnDef.Type="CT_CRT_OUT_TO" ToObjDef.IdRef="ObjDef.DOC1"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.R1" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
			<CxnDef CxnDef.ID="CxnDef.C5" CxnDef.Type="CT_LEADS_TO_2" ToObjDef.IdRef="ObjDef.E2"/>
			<CxnDef CxnDef.ID="CxnDef.C6" CxnDef.Type="CT_LEADS_TO_2" ToObjDef.IdRef="ObjDef.E3"/>
			<CxnDef CxnDef.ID="CxnDef.C7" CxnDef.Type="CT_IS_EVAL_BY_1" ToObjDef.IdRef="ObjDef.BR1"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.E2" TypeNum="OT_EVT" SymbolNum="ST_EV">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="الطلب مقبول"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Application accepted"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C8" CxnDef.Type="CT_IS_EVAL_BY_1" ToObjDef.IdRef="ObjDef.R2"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.E3" TypeNum="OT_EVT" SymbolNum="ST_EV">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="الطلب مرفوض"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Application rejected"/></AttrValue>
			</AttrDef>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.R2" TypeNum="OT_RULE" SymbolNum="ST_OPR_AND_1">
			<CxnDef CxnDef.ID="CxnDef.C9" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.F2"/>
			<CxnDef CxnDef.ID="CxnDef.C10" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.F3"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.F2" TypeNum="OT_FUNC" SymbolNum="ST_SYS_FUNC_ACT">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="إخطار مقدم الطلب"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Notify applicant"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C11" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.E4"/>
			<CxnDef CxnDef.ID="CxnDef.C12" CxnDef.Type="CT_READ_1" ToObjDef.IdRef="ObjDef.ENT2"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.F3" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="أرشفة الطلب"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Archive request"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C13" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.E5"/>
			<CxnDef CxnDef.ID="CxnDef.C14" CxnDef.Type="CT_REFS_TO_2" ToObjDef.IdRef="ObjDef.F9"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.E4" TypeNum="OT_EVT" SymbolNum="ST_EV">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="تم إخطار مقدم الطلب"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;">
					<StyledElement>
						<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="Applicant"/>
							</StyledElement>
							<StyledElement>
								<Bold/>
									<StyledElement>
										<PlainText TextValue="notified"/>
									</StyledElement>
							</StyledElement>
					</StyledElement>
				</AttrValue>
			</AttrDef>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.E5" TypeNum="OT_EVT" SymbolNum="ST_EV">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Request archived"/></AttrValue>
			</AttrDef>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.P1" TypeNum="OT_PERS" SymbolNum="ST_PERS_EXT">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="أحمد"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Ahmed"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C15" CxnDef.Type="CT_EXEC_1" ToObjDef.IdRef="ObjDef.F1"/>
			<CxnDef CxnDef.ID="CxnDef.C16" CxnDef.Type="CT_MUST_BE_INFO_ABT_1" ToObjDef.IdRef="ObjDef.F2"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.PT1" TypeNum="OT_PERS_TYPE" SymbolNum="ST_EMPL_TYPE">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Registration Officer"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C17" CxnDef.Type="CT_EXEC_2" ToObjDef.IdRef="ObjDef.F2"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.S1" TypeNum="OT_APPL_SYS" SymbolNum="ST_APPL_SYS">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="تم"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="TAMM"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C18" CxnDef.Type="CT_SUPP_3" ToObjDef.IdRef="ObjDef.F1"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.ENT1" TypeNum="OT_ENT_TYPE" SymbolNum="ST_ENT_TYPE">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="سجل المالك"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Owner record"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C19" CxnDef.Type="CT_IS_INP_FOR" ToObjDef.IdRef="ObjDef.F2"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.ENT2" TypeNum="OT_ENT_TYPE" SymbolNum="ST_ENT_TYPE">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Animal data"/></AttrValue>
			</AttrDef>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.DOC1" TypeNum="OT_INFO_CARR" SymbolNum="ST_INFO_CARR_EDOC">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="شهادة التسجيل"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Registration certificate"/></AttrValue>
			</AttrDef>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.BR1" TypeNum="OT_BUSINESS_RULE" SymbolNum="ST_BUSINESS_RULE">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="سياسة الأهلية"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Eligibility policy"/></AttrValue>
			</AttrDef>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.BR2" TypeNum="OT_BUSINESS_RULE" SymbolNum="ST_BUSINESS_RULE">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Age limit policy"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C20" CxnDef.Type="CT_IS_ALLOC_TO_1" ToObjDef.IdRef="ObjDef.R2"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.POL1" TypeNum="OT_POLICY" SymbolNum="ST_BUSINESS_POLICY">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Animal welfare policy"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C21" CxnDef.Type="CT_AFFECTS" ToObjDef.IdRef="ObjDef.F1"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.E8" TypeNum="OT_EVT" SymbolNum="ST_EV">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="طلب الأرشفة"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Archive requested"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C22" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.F9"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.F9" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="معالجة الأرشيف"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Process &amp; archive owner&apos;s file"/></AttrValue>
			</AttrDef>
			<CxnDef CxnDef.ID="CxnDef.C23" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.E9"/>
		</ObjDef>
		<ObjDef ObjDef.ID="ObjDef.E9" TypeNum="OT_EVT" SymbolNum="ST_EV">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;">Archive completed</AttrValue>
			</AttrDef>
		</ObjDef>
		<Model Model.ID="Model.M1"
			Model.Type="MT_EEPC"
			GridUse="YES"
			GridSize="50"
		Creator="hazim"
>
			<GUID>7f079d72-1111-11ed-5bd9-005056be8dc3</GUID>
			<Lane Lane.ID="Lane.M1-1" Lane.Type="LT_DEFAULT" Orientation="HORIZONTAL">
				<AttrDef AttrDef.Type="AT_NAME">
					<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="."/></AttrValue>
				</AttrDef>
			</Lane>
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;">
					<StyledElement>
						<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="تسجيل مالك حيوان"/>
							</StyledElement>
					</StyledElement>
				</AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;">
					<StyledElement>
						<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="Register animal owner"/>
							</StyledElement>
					</StyledElement>
				</AttrValue>
			</AttrDef>
			<AttrDef AttrDef.Type="AT_PROC_CODE">
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="AWF-REG-01"/></AttrValue>
			</AttrDef>
			<FFTextDef FFTextDef.ID="FFTextDef.M1-1">
				<AttrDef AttrDef.Type="AT_NAME">
					<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="A stray canvas note"/></AttrValue>
				</AttrDef>
			</FFTextDef>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-E1"
				ObjDef.IdRef="ObjDef.E1"
				SymbolNum="ST_EV"
>
				<Position Pos.X="1200" Pos.Y="400"/>
				<Size Size.dX="554" Size.dY="151"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C1" CxnDef.IdRef="CxnDef.C1" ToObjOcc.IdRef="ObjOcc.M1-F1">
					<Position Pos.X="1477" Pos.Y="551"/>
					<Position Pos.X="1477" Pos.Y="700"/>
				</CxnOcc>
				<AttrOcc AttrTypeNum="AT_NAME" Port="CENTER">
					<Size Size.dX="0" Size.dY="0"/>
				</AttrOcc>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-F1" ObjDef.IdRef="ObjDef.F1" SymbolNum="ST_FUNC">
				<Position Pos.X="1200" Pos.Y="700"/>
				<Size Size.dX="670" Size.dY="240"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C2" CxnDef.IdRef="CxnDef.C2" ToObjOcc.IdRef="ObjOcc.M1-R1"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-R1" ObjDef.IdRef="ObjDef.R1" SymbolNum="ST_OPR_XOR_1">
				<Position Pos.X="1420" Pos.Y="1100"/>
				<Size Size.dX="140" Size.dY="140"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C5" CxnDef.IdRef="CxnDef.C5" ToObjOcc.IdRef="ObjOcc.M1-E2"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C6" CxnDef.IdRef="CxnDef.C6" ToObjOcc.IdRef="ObjOcc.M1-E3"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-E2" ObjDef.IdRef="ObjDef.E2" SymbolNum="ST_EV">
				<Position Pos.X="900" Pos.Y="1400"/>
				<Size Size.dX="554" Size.dY="151"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C8" CxnDef.IdRef="CxnDef.C8" ToObjOcc.IdRef="ObjOcc.M1-R2"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-E3" ObjDef.IdRef="ObjDef.E3" SymbolNum="ST_EV">
				<Position Pos.X="1900" Pos.Y="1400"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-R2" ObjDef.IdRef="ObjDef.R2" SymbolNum="ST_OPR_AND_1">
				<Position Pos.X="1100" Pos.Y="1750"/>
				<Size Size.dX="140" Size.dY="140"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C9" CxnDef.IdRef="CxnDef.C9" ToObjOcc.IdRef="ObjOcc.M1-F2"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C10" CxnDef.IdRef="CxnDef.C10" ToObjOcc.IdRef="ObjOcc.M1-F3"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-F2" ObjDef.IdRef="ObjDef.F2" SymbolNum="ST_SYS_FUNC_ACT">
				<Position Pos.X="700" Pos.Y="2050"/>
				<Size Size.dX="670" Size.dY="240"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C11" CxnDef.IdRef="CxnDef.C11" ToObjOcc.IdRef="ObjOcc.M1-E4"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-F3" ObjDef.IdRef="ObjDef.F3" SymbolNum="ST_FUNC">
				<Position Pos.X="1600" Pos.Y="2050"/>
				<Size Size.dX="670" Size.dY="240"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C13" CxnDef.IdRef="CxnDef.C13" ToObjOcc.IdRef="ObjOcc.M1-E5"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-E4" ObjDef.IdRef="ObjDef.E4" SymbolNum="ST_EV">
				<Position Pos.X="760" Pos.Y="2450"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-E5" ObjDef.IdRef="ObjDef.E5" SymbolNum="ST_EV">
				<Position Pos.X="1660" Pos.Y="2450"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-P1" ObjDef.IdRef="ObjDef.P1" SymbolNum="ST_PERS_EXT">
				<Position Pos.X="300" Pos.Y="700"/>
				<Size Size.dX="554" Size.dY="151"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C15" CxnDef.IdRef="CxnDef.C15" ToObjOcc.IdRef="ObjOcc.M1-F1"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C16" CxnDef.IdRef="CxnDef.C16" ToObjOcc.IdRef="ObjOcc.M1-F2"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-PT1" ObjDef.IdRef="ObjDef.PT1" SymbolNum="ST_EMPL_TYPE">
				<Position Pos.X="150" Pos.Y="2350"/>
				<Size Size.dX="554" Size.dY="151"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C17" CxnDef.IdRef="CxnDef.C17" ToObjOcc.IdRef="ObjOcc.M1-F2"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-S1" ObjDef.IdRef="ObjDef.S1" SymbolNum="ST_APPL_SYS">
				<Position Pos.X="2100" Pos.Y="700"/>
				<Size Size.dX="554" Size.dY="151"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C18" CxnDef.IdRef="CxnDef.C18" ToObjOcc.IdRef="ObjOcc.M1-F1"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-ENT1" ObjDef.IdRef="ObjDef.ENT1" SymbolNum="ST_ENT_TYPE">
				<Position Pos.X="100" Pos.Y="1900"/>
				<Size Size.dX="554" Size.dY="151"/>
				<CxnOcc CxnOcc.ID="CxnOcc.M1-C19" CxnDef.IdRef="CxnDef.C19" ToObjOcc.IdRef="ObjOcc.M1-F2"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-ENT2" ObjDef.IdRef="ObjDef.ENT2" SymbolNum="ST_ENT_TYPE">
				<Position Pos.X="100" Pos.Y="2100"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-DOC1" ObjDef.IdRef="ObjDef.DOC1" SymbolNum="ST_INFO_CARR_EDOC">
				<Position Pos.X="2400" Pos.Y="2050"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-BR1" ObjDef.IdRef="ObjDef.BR1" SymbolNum="ST_BUSINESS_RULE">
				<Position Pos.X="2000" Pos.Y="1100"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-BR2" ObjDef.IdRef="ObjDef.BR2" SymbolNum="ST_BUSINESS_RULE">
				<Position Pos.X="600" Pos.Y="1750"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.M1-POL1" ObjDef.IdRef="ObjDef.POL1" SymbolNum="ST_BUSINESS_POLICY">
				<Position Pos.X="2400" Pos.Y="400"/>
				<Size Size.dX="554" Size.dY="151"/>
			</ObjOcc>
		</Model>
		<Model Model.ID="Model.M2" Model.Type="MT_EEPC">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.AEar;"><PlainText TextValue="&#1571;رشفة الطلبات"/></AttrValue>
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Archive requests"/></AttrValue>
			</AttrDef>
			<ObjOcc ObjOcc.ID="ObjOcc.M2-E8" ObjDef.IdRef="ObjDef.E8" SymbolNum="ST_EV"/>
			<ObjOcc ObjOcc.ID="ObjOcc.M2-F9" ObjDef.IdRef="ObjDef.F9" SymbolNum="ST_FUNC"/>
			<ObjOcc ObjOcc.ID="ObjOcc.M2-E9" ObjDef.IdRef="ObjDef.E9" SymbolNum="ST_EV"/>
		</Model>
		<Model Model.ID="Model.V1" Model.Type="MT_VAL_ADD_CHN_DGM">
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><PlainText TextValue="Process landscape"/></AttrValue>
			</AttrDef>
			<ObjOcc ObjOcc.ID="ObjOcc.V1-F1" ObjDef.IdRef="ObjDef.F1" SymbolNum="ST_VAL_ADD_CHN_SML_1">
				<Position Pos.X="75" Pos.Y="158"/>
				<Size Size.dX="646" Size.dY="150"/>
			</ObjOcc>
			<ObjOcc ObjOcc.ID="ObjOcc.V1-F9" ObjDef.IdRef="ObjDef.F9" SymbolNum="ST_VAL_ADD_CHN_SML_1">
				<Position Pos.X="775" Pos.Y="158"/>
				<Size Size.dX="646" Size.dY="150"/>
			</ObjOcc>
		</Model>
	</Group>
</AML>
`

// The real export is CRLF-terminated with start-tag attributes broken across
// lines — reproduce that byte-for-byte so the parser's multiline handling is
// exercised by every test that uses this fixture.
export const AML_SAMPLE = LF_SAMPLE.replace(/\r?\n/g, '\r\n')
