import { describe, expect, it } from 'vitest'
import {
  buildArisSplitPlan,
  deriveSplitFileName,
  sanitizeArisPathSegment,
  type ArisSplitFile
} from './amlSplit'
import { buildSemanticArisDocument, type ArisSourceIndex } from './semanticIndex'
import type { ArisXmlSourcePackage } from './sourcePackage'
import { expandXmlEntities, tokenizeXmlDocument, type XmlStartTagToken } from './xmlTokenizer'

function parse(text: string): { index: ArisSourceIndex; errorCount: number; total: number } {
  const semantic = buildSemanticArisDocument(tokenizeXmlDocument(text))
  return {
    index: semantic.index,
    errorCount: semantic.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    total: semantic.diagnostics.length
  }
}

/** Minimal package stand-in: `buildArisSplitPlan` only ever reads `.text` and `.index`. */
function packageOf(text: string): ArisXmlSourcePackage {
  return { text, index: parse(text).index } as unknown as ArisXmlSourcePackage
}

function occCount(index: ArisSourceIndex, modelId: string): number {
  return [...index.objectOccurrences.values()].filter((o) => o.parsed.modelId === modelId).length
}
function cxnOccCount(index: ArisSourceIndex, modelId: string): number {
  return [...index.connectionOccurrences.values()].filter((o) => o.parsed.modelId === modelId)
    .length
}

/**
 * Synthetic 2-group/3-model AML (plan lane T2 test brief): bilingual + AR-only group names, a
 * shared object definition, cross-model `CxnDef`s under one shared def, a `Group.Root`-level def
 * referenced by a model, an `FFTextDef`, a `LinkedModels.IdRefs` assignment, a DTD entity used in
 * an attribute value, and two identically-named models.
 */
const SYNTHETIC_AML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML SYSTEM "ARIS-Export.dtd" [
	<!ENTITY LocaleId.USen "1033">
	<!ENTITY LocaleId.AEar "1025">
]>
<AML>
	<Header-Info DatabaseName="Synthetic" UserName="test" ArisExeVersion="100"/>
	<Language LocaleId="&LocaleId.USen;"><LanguageName LocaleId="&LocaleId.USen;">English</LanguageName></Language>
	<Language LocaleId="&LocaleId.AEar;"><LanguageName LocaleId="&LocaleId.AEar;">Arabic</LanguageName></Language>
	<FontStyleSheet FontSS.ID="FontSS.1"><GUID>guid-fss-1</GUID></FontStyleSheet>
	<FFTextDef FFTextDef.ID="FFTextDef.1">
		<GUID>guid-fft-1</GUID>
		<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Note one"/></StyledElement></StyledElement></AttrValue></AttrDef>
	</FFTextDef>
	<Group Group.ID="Group.Root">
		<ObjDef ObjDef.ID="ObjDef.Root1" TypeNum="OT_FUNC">
			<GUID>guid-root1</GUID>
			<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Root Shared Def"/></StyledElement></StyledElement></AttrValue></AttrDef>
		</ObjDef>
		<Group Group.ID="Group.A" TypeNum="GT_MODEL" Creator="test">
			<GUID>guid-groupA</GUID>
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Process Folder"/></StyledElement></StyledElement></AttrValue>
				<AttrValue LocaleId="&LocaleId.AEar;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="مجلد العمليات"/></StyledElement></StyledElement></AttrValue>
			</AttrDef>
			<ObjDef ObjDef.ID="ObjDef.Shared" TypeNum="OT_FUNC" ToCxnDefs.IdRefs="CxnDef.1 CxnDef.2">
				<GUID>guid-shared</GUID>
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Shared Function"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Target1"><GUID>guid-c1</GUID></CxnDef>
				<CxnDef CxnDef.ID="CxnDef.2" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Target2"><GUID>guid-c2</GUID></CxnDef>
			</ObjDef>
			<ObjDef ObjDef.ID="ObjDef.Target1" TypeNum="OT_EVT"><GUID>guid-t1</GUID><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Target One"/></StyledElement></StyledElement></AttrValue></AttrDef></ObjDef>
			<ObjDef ObjDef.ID="ObjDef.Target2" TypeNum="OT_EVT"><GUID>guid-t2</GUID><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Target Two"/></StyledElement></StyledElement></AttrValue></AttrDef></ObjDef>
			<Model Model.ID="Model.1" Model.Type="MT_EEPC">
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Duplicate Name"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.Shared" ToCxnOccs.IdRefs="CxnOcc.1"><Position Pos.X="10" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/>
					<CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.2"><Position Pos.X="10" Pos.Y="60"/></CxnOcc>
				</ObjOcc>
				<ObjOcc ObjOcc.ID="ObjOcc.2" ObjDef.IdRef="ObjDef.Target1"><Position Pos.X="10" Pos.Y="120"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
				<ObjOcc ObjOcc.ID="ObjOcc.RootRef" ObjDef.IdRef="ObjDef.Root1"><Position Pos.X="200" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
				<FFTextOcc FFTextDef.IdRef="FFTextDef.1"><Position Pos.X="300" Pos.Y="10"/><Size Size.dX="80" Size.dY="20"/></FFTextOcc>
			</Model>
		</Group>
		<Group Group.ID="Group.B">
			<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.AEar;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="قسم التسجيل"/></StyledElement></StyledElement></AttrValue></AttrDef>
			<Model Model.ID="Model.2" Model.Type="MT_EEPC">
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Duplicate Name"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<ObjOcc ObjOcc.ID="ObjOcc.3" ObjDef.IdRef="ObjDef.Shared" ToCxnOccs.IdRefs="CxnOcc.2"><Position Pos.X="10" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/>
					<CxnOcc CxnOcc.ID="CxnOcc.2" CxnDef.IdRef="CxnDef.2" ToObjOcc.IdRef="ObjOcc.4"><Position Pos.X="10" Pos.Y="60"/></CxnOcc>
				</ObjOcc>
				<ObjOcc ObjOcc.ID="ObjOcc.4" ObjDef.IdRef="ObjDef.Target2"><Position Pos.X="10" Pos.Y="120"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
			</Model>
		</Group>
		<Group Group.ID="Group.C">
			<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Value Chain Folder"/></StyledElement></StyledElement></AttrValue></AttrDef>
			<ObjDef ObjDef.ID="ObjDef.Vfunc" TypeNum="OT_FUNC" LinkedModels.IdRefs="Model.1 Model.2"><GUID>guid-vfunc</GUID><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Assign"/></StyledElement></StyledElement></AttrValue></AttrDef></ObjDef>
			<Model Model.ID="Model.3" Model.Type="MT_VAL_ADD_CHN_DGM">
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Value Chain"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<ObjOcc ObjOcc.ID="ObjOcc.5" ObjDef.IdRef="ObjDef.Vfunc"><Position Pos.X="10" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
			</Model>
		</Group>
	</Group>
</AML>
`

function fileById(files: readonly ArisSplitFile[], modelId: string): ArisSplitFile {
  const file = files.find((candidate) => candidate.modelId === modelId)
  if (!file) throw new Error(`no split file for ${modelId}`)
  return file
}

describe('span semantics (throwaway pin — plan lane T2 step 1)', () => {
  it('a record span slices pkg.text from its own start tag to its own end boundary', () => {
    const index = parse(SYNTHETIC_AML).index
    const objDef = index.objectDefinitions.get('ObjDef.Shared')!
    const slice = SYNTHETIC_AML.slice(objDef.span.start.offset, objDef.span.end.offset)
    expect(slice.startsWith('<ObjDef')).toBe(true)
    expect(slice.endsWith('</ObjDef>')).toBe(true)

    // An element with no end tag (self-closing) ends on its own `/>` boundary.
    const header = index.database!
    const headerSlice = SYNTHETIC_AML.slice(header.span.start.offset, header.span.end.offset)
    expect(headerSlice.startsWith('<Header-Info')).toBe(true)
    expect(headerSlice.endsWith('/>')).toBe(true)
  })
})

describe('sanitizeArisPathSegment', () => {
  it('strips filesystem-illegal characters and collapses whitespace', () => {
    expect(sanitizeArisPathSegment('a<b>c:"/\\|?*d')).toBe('abcd')
    expect(sanitizeArisPathSegment('  Order   Intake  ')).toBe('Order Intake')
  })
  it('strips leading dots and trailing dots/spaces', () => {
    expect(sanitizeArisPathSegment('...Reports... ')).toBe('Reports')
  })
  it('preserves Arabic', () => {
    expect(sanitizeArisPathSegment('قسم التسجيل')).toBe('قسم التسجيل')
  })
  it('falls back to "group" when nothing survives', () => {
    expect(sanitizeArisPathSegment('   ***   ')).toBe('group')
    expect(sanitizeArisPathSegment('')).toBe('group')
  })
  it('neutralizes Windows reserved device names, including names with extensions', () => {
    expect(sanitizeArisPathSegment('CON')).toBe('CON-file')
    expect(sanitizeArisPathSegment('aux.txt')).toBe('aux-file.txt')
    expect(sanitizeArisPathSegment('Com1.log')).toBe('Com1-file.log')
    expect(sanitizeArisPathSegment('COM10')).toBe('COM10')
  })
})

describe('deriveSplitFileName', () => {
  it('prefers the given name and falls back to the id', () => {
    expect(deriveSplitFileName('Duplicate Name', 'Model.1')).toBe('duplicate-name.aml')
    expect(deriveSplitFileName(null, 'Model.9')).toBe(deriveSplitFileName('Model.9', 'Model.9'))
  })
})

describe('buildArisSplitPlan (synthetic AML)', () => {
  const monolith = parse(SYNTHETIC_AML)
  const plan = buildArisSplitPlan(packageOf(SYNTHETIC_AML))

  it('emits one file per model and no skips', () => {
    expect(plan.files).toHaveLength(3)
    expect(plan.skippedModelIds).toEqual([])
    expect(plan.files.map((f) => f.modelId).sort()).toEqual(['Model.1', 'Model.2', 'Model.3'])
  })

  it('every produced document re-parses with zero diagnostics and contains exactly its model', () => {
    for (const file of plan.files) {
      const reparsed = parse(file.text)
      expect(reparsed.errorCount).toBe(0)
      expect(reparsed.total).toBe(0)
      expect(reparsed.index.models.size).toBe(1)
      expect(reparsed.index.models.has(file.modelId)).toBe(true)
    }
  })

  it('per-model occ / def / cxn counts match the monolith slice', () => {
    for (const file of plan.files) {
      const reparsed = parse(file.text)
      const expectedOcc = occCount(monolith.index, file.modelId)
      const expectedCxn = new Set(
        [...monolith.index.connectionOccurrences.values()]
          .filter((o) => o.parsed.modelId === file.modelId)
          .map((o) => o.parsed.connectionDefinitionId)
          .filter((id): id is string => id !== null)
      ).size
      const expectedDefs = new Set(
        [...monolith.index.objectOccurrences.values()]
          .filter((o) => o.parsed.modelId === file.modelId)
          .map((o) => o.parsed.objectDefinitionId)
          .filter((id): id is string => id !== null)
      ).size
      expect(occCount(reparsed.index, file.modelId)).toBe(expectedOcc)
      expect(cxnOccCount(reparsed.index, file.modelId)).toBe(
        cxnOccCount(monolith.index, file.modelId)
      )
      expect(reparsed.index.objectDefinitions.size).toBe(expectedDefs)
      expect(reparsed.index.connectionDefinitions.size).toBe(expectedCxn)
    }
  })

  it('excises the connection definitions a model never uses and keeps the ones it does', () => {
    const model1 = parse(fileById(plan.files, 'Model.1').text).index
    expect(model1.connectionDefinitions.has('CxnDef.1')).toBe(true)
    expect(model1.connectionDefinitions.has('CxnDef.2')).toBe(false)

    const model2 = parse(fileById(plan.files, 'Model.2').text).index
    expect(model2.connectionDefinitions.has('CxnDef.2')).toBe(true)
    expect(model2.connectionDefinitions.has('CxnDef.1')).toBe(false)
  })

  it('rewrites ToCxnDefs.IdRefs to contain only retained connection definitions', () => {
    const file = fileById(plan.files, 'Model.1')
    const reparsed = parse(file.text)

    expect(reparsed.index.objectDefinitions.get('ObjDef.Shared')!.parsed).toMatchObject({
      outboundConnectionDefinitionIds: ['CxnDef.1']
    })
    expect(file.text).toContain('ToCxnDefs.IdRefs="CxnDef.1"')
    expect(file.text).not.toContain('ToCxnDefs.IdRefs="CxnDef.1 CxnDef.2"')
    expect(reparsed.total).toBe(0)
  })

  it('preserves LinkedModels.IdRefs verbatim on the value-chain model', () => {
    const file = fileById(plan.files, 'Model.3')
    expect(file.text).toContain('LinkedModels.IdRefs="Model.1 Model.2"')
    const reparsed = parse(file.text).index
    expect(reparsed.objectDefinitions.get('ObjDef.Vfunc')!.parsed.linkedModelIds).toEqual([
      'Model.1',
      'Model.2'
    ])
  })

  it('keeps the DOCTYPE entity block and lets &LocaleId…; attribute values survive', () => {
    for (const file of plan.files) {
      expect(file.text).toContain('<!ENTITY LocaleId.USen "1033">')
      expect(file.text).toContain('<!ENTITY LocaleId.AEar "1025">')
    }
    expect(fileById(plan.files, 'Model.1').text).toContain('LocaleId="&LocaleId.USen;"')
    expect(fileById(plan.files, 'Model.2').text).toContain('LocaleId="&LocaleId.AEar;"')
  })

  it('names folders from the group chain, EN-preferred, with an AR-only group kept in Arabic', () => {
    expect(fileById(plan.files, 'Model.1').folderSegments).toEqual(['Process Folder'])
    expect(fileById(plan.files, 'Model.2').folderSegments).toEqual(['قسم التسجيل'])
    expect(fileById(plan.files, 'Model.3').folderSegments).toEqual(['Value Chain Folder'])
  })

  it('pulls a Group.Root-level definition referenced by a model into the model chain', () => {
    const file = fileById(plan.files, 'Model.1')
    const reparsed = parse(file.text).index
    expect(reparsed.objectDefinitions.has('ObjDef.Root1')).toBe(true)
    // It now lives inside the model's own (non-root) group chain.
    expect(reparsed.objectDefinitions.get('ObjDef.Root1')!.parsed.groupId).toBe('Group.A')
  })

  it('gives two identically-named models the same file name (dedup handled downstream)', () => {
    expect(fileById(plan.files, 'Model.1').fileName).toBe('duplicate-name.aml')
    expect(fileById(plan.files, 'Model.2').fileName).toBe('duplicate-name.aml')
  })
})

describe('buildArisSplitPlan (integrity edge cases)', () => {
  it('fails closed for a duplicated Model.ID and surfaces the ambiguous id', () => {
    const source = `<AML>
      <Group Group.ID="Group.Root">
        <Model Model.ID="Model.A" Model.Type="MT_EEPC"/>
        <Model Model.ID="Model.A" Model.Type="MT_EEPC"/>
      </Group>
    </AML>`

    const plan = buildArisSplitPlan(packageOf(source))

    expect(plan.files).toEqual([])
    expect(plan.skippedModelIds).toEqual(['Model.A'])
  })

  it('wraps a Group.Root-level model in its source Group while keeping folders rootless', () => {
    const source = `<AML>
      <Group Group.ID='Group.Root' Creator='R&amp;D'>
        <Model Model.ID="Model.Root" Model.Type="MT_EEPC"/>
      </Group>
    </AML>`

    const plan = buildArisSplitPlan(packageOf(source))
    const file = fileById(plan.files, 'Model.Root')
    const reparsed = parse(file.text)

    expect(file.folderSegments).toEqual([])
    expect(file.text).toContain("<Group Group.ID='Group.Root' Creator='R&amp;D'>")
    expect(reparsed.index.models.get('Model.Root')!.parsed.groupId).toBe('Group.Root')
    expect(reparsed.total).toBe(0)
  })

  it('preserves source entity references in reconstructed root and Group start tags', () => {
    const source = `<AML Vendor='R&amp;D'>
      <Group Group.ID="Group.Root" Creator="R&amp;D">
        <Model Model.ID="Model.Entities" Model.Type="MT_EEPC"/>
      </Group>
    </AML>`

    const file = fileById(buildArisSplitPlan(packageOf(source)).files, 'Model.Entities')
    const tokenized = tokenizeXmlDocument(file.text)
    const creator = tokenized.tokens
      .find(
        (token): token is XmlStartTagToken => token.kind === 'start-tag' && token.name === 'Group'
      )
      ?.attributes.find((attribute) => attribute.name === 'Creator')

    expect(file.text).toContain("<AML Vendor='R&amp;D'>")
    expect(file.text).toContain('Creator="R&amp;D"')
    expect(file.text).not.toContain('&amp;amp;')
    expect(creator?.value).toBe('R&amp;D')
    expect(expandXmlEntities(creator!.value)).toBe('R&D')
    expect(parse(file.text).total).toBe(0)
  })
})
