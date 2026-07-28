/**
 * A synthetic AML fixture shaped like a real ARIS 10 export.
 *
 * Every id, element name, attribute name, nesting rule, indentation style, and locale-id
 * convention here reproduces the SHAPE observed in the private AnimalWF export; no content from
 * that export is reproduced. The id keys are obviously synthetic (`AAAAAAAAAAA`) precisely so
 * this file can never be mistaken for real customer data.
 *
 * The fixture deliberately contains material the writer must NOT touch:
 *
 * - an XML comment between records,
 * - an unknown element (`<VendorExtension>`) with unknown attributes,
 * - a single-quoted attribute among double-quoted ones,
 * - an attribute order that is not alphabetical,
 * - a `ToCxnOccs.IdRefs` list with trailing whitespace,
 * - locale ids written as internal entity references rather than literals.
 */

export const FIXTURE_LOCALE_AR = '&LocaleId.AEar;'
export const FIXTURE_LOCALE_EN = '&LocaleId.USen;'

export const FIXTURE_IDS = Object.freeze({
  rootGroup: 'Group.Root',
  group: 'Group.BBBBBBBBBBB-k-L',
  model: 'Model.AAAAAAAAAAA-u-L',
  startEvent: 'ObjDef.CCCCCCCCCCC-p-L',
  activity: 'ObjDef.DDDDDDDDDDD-p-L',
  connectionDefinition: 'CxnDef.EEEEEEEEEEE-q-L',
  startOccurrence: 'ObjOcc.AAAAAAAAAAA-u-L-FFFFFFFFFFF-x-L-33-c',
  activityOccurrence: 'ObjOcc.AAAAAAAAAAA-u-L-GGGGGGGGGGG-x-L-33-c',
  connectionOccurrence: 'CxnOcc.AAAAAAAAAAA-u-L-HHHHHHHHHHH-y-L-34-c',
  lane: 'Lane.AAAAAAAAAAA-u-L-IIIIIIIIIII-E-L-40-c',
  freeText: 'FFTextDef.JJJJJJJJJJJ-s-L',
  attachment: 'OLEDef.KKKKKKKKKKK-r-L',
  attachmentOccurrence: 'OLEOcc.AAAAAAAAAAA-u-L-LLLLLLLLLLL-z-L-35-c',
  fontStyleSheet: 'FontSS.MMMMMMMMMMM-c-L',
  linkedModel: 'Model.NNNNNNNNNNN-u-L'
})

export const SAMPLE_AML = `<?xml version="1.0" encoding="UTF-8"?>
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
		DatabaseName="SAMPLE"
		UserName="fixture"
		ArisExeVersion="100"
	/>
	<Language LocaleId="&LocaleId.AEar;" Codepage="&Codepage.AEar;">
		<LanguageName>Arabic</LanguageName>
	</Language>
	<Language LocaleId="&LocaleId.USen;" Codepage="&Codepage.USen;">
		<LanguageName>English</LanguageName>
	</Language>
	<FontStyleSheet FontSS.ID="${FIXTURE_IDS.fontStyleSheet}">
		<GUID>00000000-0000-0000-0000-00000000f0f0</GUID>
		<AttrDef AttrDef.Type="AT_NAME">
			<AttrValue LocaleId="&LocaleId.USen;">
				<StyledElement>
					<Paragraph Alignment="UNDEFINED" Indent="0"/>
					<StyledElement>
						<PlainText TextValue="Standard"/>
					</StyledElement>
				</StyledElement>
			</AttrValue>
		</AttrDef>
	</FontStyleSheet>
	<FFTextDef FFTextDef.ID="${FIXTURE_IDS.freeText}">
		<GUID>00000000-0000-0000-0000-00000000fdfd</GUID>
		<AttrDef AttrDef.Type="AT_NAME">
			<AttrValue LocaleId="&LocaleId.USen;">
				<StyledElement>
					<Paragraph Alignment="UNDEFINED" Indent="0"/>
					<StyledElement>
						<PlainText TextValue="Legend"/>
					</StyledElement>
				</StyledElement>
			</AttrValue>
		</AttrDef>
	</FFTextDef>
	<OLEDef OLEDef.ID="${FIXTURE_IDS.attachment}" Creator='fixture'>
		<GUID>00000000-0000-0000-0000-0000000001e0</GUID>
		<Blob>QUJDREVGRw==</Blob>
	</OLEDef>
	<Group Group.ID="Group.Root">
		<!-- one business group, kept verbatim on export -->
		<Group Group.ID="${FIXTURE_IDS.group}"
			TypeNum="OT_GROUP"
			LastUpdated="11:21:36.000;05/09/2023"
			CompositePosition="0"
		Creator="fixture"
>
			<GUID>00000000-0000-0000-0000-0000000000a1</GUID>
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;">
					<StyledElement>
						<Paragraph Alignment="UNDEFINED" Indent="0"/>
						<StyledElement>
							<PlainText TextValue="Animal Welfare"/>
						</StyledElement>
					</StyledElement>
				</AttrValue>
			</AttrDef>
			<ObjDef ObjDef.ID="${FIXTURE_IDS.startEvent}"
				TypeNum="OT_EVT"
				SymbolNum="ST_EV"
				ToCxnDefs.IdRefs="${FIXTURE_IDS.connectionDefinition}"
				LastUpdated="07:34:43.000;05/29/2023"
			Creator="fixture"
>
				<GUID>00000000-0000-0000-0000-0000000000b1</GUID>
				<AttrDef AttrDef.Type="AT_NAME">
					<AttrValue LocaleId="&LocaleId.USen;">
						<StyledElement>
							<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="Request received"/>
							</StyledElement>
						</StyledElement>
					</AttrValue>
				</AttrDef>
				<CxnDef CxnDef.ID="${FIXTURE_IDS.connectionDefinition}"
					CxnDef.Type="CT_ACTIV_1"
					ToObjDef.IdRef="${FIXTURE_IDS.activity}"
					SourceOrderNum="0"
>
					<GUID>00000000-0000-0000-0000-0000000000c1</GUID>
				</CxnDef>
			</ObjDef>
			<ObjDef ObjDef.ID="${FIXTURE_IDS.activity}"
				TypeNum="OT_FUNC"
				SymbolNum="ST_FUNC"
				LinkedModels.IdRefs="${FIXTURE_IDS.model}"
			Creator="fixture"
>
				<GUID>00000000-0000-0000-0000-0000000000b2</GUID>
				<VendorExtension vendor:flavour="internal" retained="yes"/>
				<AttrDef AttrDef.Type="AT_NAME">
					<AttrValue LocaleId="&LocaleId.AEar;">
						<StyledElement>
							<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="&#1578;&#1587;&#1580;&#1610;&#1604;"/>
							</StyledElement>
						</StyledElement>
					</AttrValue>
					<AttrValue LocaleId="&LocaleId.USen;">
						<StyledElement>
							<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="Register animal"/>
							</StyledElement>
						</StyledElement>
					</AttrValue>
				</AttrDef>
			</ObjDef>
			<Model Model.ID="${FIXTURE_IDS.model}"
				Model.Type="MT_EEPC"
			Creator="fixture"
>
				<Flag/>
				<GUID>00000000-0000-0000-0000-0000000000d1</GUID>
				<Lane Lane.ID="${FIXTURE_IDS.lane}" Orientation="HORIZONTAL">
					<GUID>00000000-0000-0000-0000-0000000000e1</GUID>
				</Lane>
				<AttrDef AttrDef.Type="AT_NAME">
					<AttrValue LocaleId="&LocaleId.USen;">
						<StyledElement>
							<Paragraph Alignment="UNDEFINED" Indent="0"/>
							<StyledElement>
								<PlainText TextValue="Animal registration"/>
							</StyledElement>
						</StyledElement>
					</AttrValue>
				</AttrDef>
				<ObjOcc ObjOcc.ID="${FIXTURE_IDS.startOccurrence}"
					ObjDef.IdRef="${FIXTURE_IDS.startEvent}"
					ToCxnOccs.IdRefs="${FIXTURE_IDS.connectionOccurrence}  "
					SymbolNum="ST_EV"
					Zorder="1"
>
					<Brush Color="cccccc" Color2="0" BrushType="SOLID"/>
					<Position Pos.X="1000" Pos.Y="2000"/>
					<Size Size.dX="554" Size.dY="151"/>
					<ExternalGUID>00000000-0000-0000-0000-0000000000f1</ExternalGUID>
					<CxnOcc CxnOcc.ID="${FIXTURE_IDS.connectionOccurrence}"
						CxnDef.IdRef="${FIXTURE_IDS.connectionDefinition}"
						ToObjOcc.IdRef="${FIXTURE_IDS.activityOccurrence}"
						Zorder="2">
						<Pen Color="0" Style="0" Width="1"/>
						<Position Pos.X="1277" Pos.Y="2151"/>
						<Position Pos.X="1277" Pos.Y="2400"/>
					</CxnOcc>
					<AttrOcc AttrTypeNum="AT_NAME"
						Port="CENTER"
						FontSS.IdRef="${FIXTURE_IDS.fontStyleSheet}"
>
						<Size Size.dX="0" Size.dY="0"/>
					</AttrOcc>
				</ObjOcc>
				<!-- the activity occurrence follows -->
				<ObjOcc ObjOcc.ID="${FIXTURE_IDS.activityOccurrence}"
					ObjDef.IdRef="${FIXTURE_IDS.activity}"
					SymbolNum="ST_FUNC"
					Zorder="3"
>
					<Brush Color="ffffff" Color2="0" BrushType="SOLID"/>
					<Position Pos.X="1000" Pos.Y="2400"/>
					<Size Size.dX="554" Size.dY="151"/>
					<ExternalGUID>00000000-0000-0000-0000-0000000000f2</ExternalGUID>
				</ObjOcc>
				<FFTextOcc FFTextDef.IdRef="${FIXTURE_IDS.freeText}" FontSS.IdRef="${FIXTURE_IDS.fontStyleSheet}">
					<Position Pos.X="200" Pos.Y="200"/>
				</FFTextOcc>
				<OLEOcc OLEOcc.ID="${FIXTURE_IDS.attachmentOccurrence}" OLEDef.IdRef="${FIXTURE_IDS.attachment}">
					<Position Pos.X="3000" Pos.Y="200"/>
					<Size Size.dX="100" Size.dY="100"/>
				</OLEOcc>
			</Model>
		</Group>
	</Group>
</AML>
`
