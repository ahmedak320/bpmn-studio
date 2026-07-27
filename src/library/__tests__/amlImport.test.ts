import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import BpmnModdle from 'bpmn-moddle'
import { convertAmlToBpmnFiles, convertApcToBpmn, looksLikeAml } from '../apcImport'
import { parseAml } from '../amlParse'
import { AML_SAMPLE } from '../__fixtures__/aml-sample'

/** All name="…" values of <task>/<callActivity> elements in a BPMN string. */
function flowActivityNames(xml: string): string[] {
  const names: string[] = []
  const re = /<(?:task|callActivity)\b[^>]*?\bname="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) names.push(m[1])
  return names
}

/** Extract the full start tag of the element with the given id. */
function startTagOf(xml: string, id: string): string {
  const m = new RegExp(`<[a-zA-Z]+ id="${id}"[^>]*`).exec(xml)
  expect(m, `element ${id} present`).toBeTruthy()
  return (m as RegExpExecArray)[0]
}

describe('looksLikeAml', () => {
  it('accepts AML roots and AML doctypes', () => {
    expect(looksLikeAml(AML_SAMPLE)).toBe(true)
    expect(looksLikeAml('<AML>')).toBe(true)
    expect(looksLikeAml('<AML\r\n>')).toBe(true)
    expect(
      looksLikeAml('<?xml version="1.0"?>\n<!DOCTYPE AML SYSTEM "ARIS-Export.dtd" [\n]>\n<AML/>')
    ).toBe(true)
  })

  it('rejects BPMN and random XML', () => {
    expect(looksLikeAml('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>')).toBe(
      false
    )
    expect(looksLikeAml('<foo><bar/></foo>')).toBe(false)
    expect(looksLikeAml('<AMLX>')).toBe(false)
    expect(looksLikeAml('')).toBe(false)
  })
})

describe('parseAml — LinkedModels.IdRefs + database name (parse level)', () => {
  it('collects a whitespace-padded LinkedModels.IdRefs into linkedModelIds', () => {
    const db = parseAml(AML_SAMPLE)
    // The fixture's F10 chevron carries `LinkedModels.IdRefs="  Model.M2 "`.
    expect(db.objectById.get('ObjDef.F10')?.linkedModelIds).toEqual(['Model.M2'])
  })

  it('defaults linkedModelIds to [] when the attribute is absent', () => {
    const db = parseAml(AML_SAMPLE)
    expect(db.objectById.get('ObjDef.F1')?.linkedModelIds).toEqual([])
    expect(db.objectById.get('ObjDef.F9')?.linkedModelIds).toEqual([])
    expect(db.objectById.get('ObjDef.E1')?.linkedModelIds).toEqual([])
  })

  it('splits a multi-valued IdRefs on runs of whitespace (newlines included)', () => {
    const aml =
      '<AML><ObjDef ObjDef.ID="ObjDef.X" TypeNum="OT_FUNC"\r\n' +
      '\tLinkedModels.IdRefs="  Model.A \r\n\t Model.B "/></AML>'
    const db = parseAml(aml)
    expect(db.objectById.get('ObjDef.X')?.linkedModelIds).toEqual(['Model.A', 'Model.B'])
  })

  it('reads DatabaseName off the multi-line self-closing Header-Info', () => {
    expect(parseAml(AML_SAMPLE).databaseName).toBe('DMT')
  })

  it('leaves databaseName undefined when there is no Header-Info', () => {
    const db = parseAml('<AML><ObjDef ObjDef.ID="ObjDef.X" TypeNum="OT_FUNC"/></AML>')
    expect(db.databaseName).toBeUndefined()
  })
})

describe('convertAmlToBpmnFiles — model splitting', () => {
  it('emits one file per MT_EEPC model plus the value-chain overview LAST', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    expect('files' in result).toBe(true)
    if (!('files' in result)) return
    expect(result.files).toHaveLength(3)
    expect(result.files[0].name).toBe('Register animal owner')
    expect(result.files[1].name).toBe('Archive requests')
    // The MT_VAL_ADD_CHN_DGM landscape now converts too — appended last.
    expect(result.files[2].name).toBe('Process landscape')
    expect(result.files.map((f) => f.kind)).toEqual(['epc', 'epc', 'overview'])
    expect(result.files.map((f) => f.processId)).toEqual(['AWF-REG-01', 'Model_M2', 'Model_V1'])
    // Suggested folder = the overview's name in the active language.
    expect(result.folderName).toBe('Process landscape')
  })

  it("skips overview conversion when the export has no convertible EPC — and falls back to the export's DatabaseName for the folder", async () => {
    // Header-Info gives DMT as DatabaseName; no VACD → folderName falls back.
    const noVacd = AML_SAMPLE.replace('MT_VAL_ADD_CHN_DGM', 'MT_ORG_CHRT')
    const result = await convertAmlToBpmnFiles(noVacd)
    if (!('files' in result)) throw new Error('conversion failed')
    expect(result.files).toHaveLength(2)
    expect(result.files.every((f) => f.kind === 'epc')).toBe(true)
    expect(result.folderName).toBe('DMT')
  })

  it('resolves internal-DTD locale entities: Arabic names arrive intact', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const [m1, m2] = result.files
    // Model names, per locale (the ar value of M2 uses a numeric char ref).
    expect(m1.nameEn).toBe('Register animal owner')
    expect(m1.nameAr).toBe('تسجيل مالك حيوان')
    expect(m2.nameAr).toBe('أرشفة الطلبات')
    // Element-level bilingual names as orbitpm attributes.
    expect(m1.xml).toContain('orbitpm:nameAr="مراجعة الطلب"')
    expect(m1.xml).toContain('orbitpm:nameEn="Review application"')
    // &amp; / &apos; decoded once and re-escaped correctly on the way out
    // (the auto-layout serializer prefers numeric refs: &#38;).
    expect(m2.xml).toMatch(/Process (?:&amp;|&#38;) archive owner/)
    // A Lane's AT_NAME (".") and the FFTextDef note never pollute the model name.
    expect(m1.name).not.toBe('.')
    expect(m1.name).not.toContain('stray canvas note')
  })

  it('honors the requested language and records it on the process', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE, { lang: 'ar' })
    if (!('files' in result)) throw new Error('conversion failed')
    const m1 = result.files[0]
    expect(m1.name).toBe('تسجيل مالك حيوان')
    expect(m1.xml).toContain('orbitpm:activeLang="ar"')
    expect(m1.xml).toContain('name="مراجعة الطلب"')
  })

  it('uses AT_PROC_CODE as the process id, else the sanitized Model.ID', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    expect(result.files[0].xml).toContain('<process id="AWF-REG-01"')
    expect(result.files[1].xml).toContain('<process id="Model_M2"')
  })
})

describe('convertAmlToBpmnFiles — flow vs metadata partition', () => {
  async function convertFirst(): Promise<string> {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    return result.files[0].xml
  }

  it('maps the EPC backbone onto the right BPMN elements', async () => {
    const xml = await convertFirst()
    expect((xml.match(/<task\b/g) ?? []).length).toBe(2) // F1, F2
    expect((xml.match(/<callActivity\b/g) ?? []).length).toBe(1) // F3
    expect((xml.match(/<startEvent\b/g) ?? []).length).toBe(1) // E1
    expect((xml.match(/<intermediateThrowEvent\b/g) ?? []).length).toBe(1) // E2
    expect((xml.match(/<endEvent\b/g) ?? []).length).toBe(3) // E3, E4, E5
    expect((xml.match(/<sequenceFlow\b/g) ?? []).length).toBe(9)
  })

  it('keeps "event is evaluated by rule" as control flow into the gateway', async () => {
    const xml = await convertFirst()
    // E2 →(CT_IS_EVAL_BY_1) R2: E2 must NOT degrade to an end event, and the
    // AND gateway must have an inbound flow.
    expect(xml).toMatch(/<sequenceFlow[^>]*sourceRef="ObjDef_E2"[^>]*targetRef="ObjDef_R2"/)
    const e2 = startTagOf(xml, 'ObjDef_E2')
    expect(e2.startsWith('<intermediateThrowEvent')).toBe(true)
  })

  it('routes satellite connections into orbitpm attrs on the right nodes', async () => {
    const xml = await convertFirst()
    const f1 = startTagOf(xml, 'ObjDef_F1')
    expect(f1).toContain('orbitpm:respList="Ahmed"') // CT_EXEC_1, performer name
    expect(f1).toContain('orbitpm:system="TAMM"') // CT_SUPP_3
    // CT_HAS_OUT + CT_CRT_OUT_TO, '\n'-joined (serialized as &#10;).
    expect(f1).toContain('orbitpm:outputs="Owner record&#10;Registration certificate"')

    const f2 = startTagOf(xml, 'ObjDef_F2')
    expect(f2).toContain('orbitpm:ccList="Ahmed"') // CT_MUST_BE_INFO_ABT_1
    expect(f2).toContain('orbitpm:respList="Registration Officer"') // CT_EXEC_2
    // CT_IS_INP_FOR (entity → function) + CT_READ_1 (function → entity).
    expect(f2).toContain('orbitpm:inputs="Owner record&#10;Animal data"')
  })

  it('lands decision documentation on the gateways, "; "-joined', async () => {
    const xml = await convertFirst()
    const r1 = startTagOf(xml, 'ObjDef_R1')
    expect(r1.startsWith('<exclusiveGateway')).toBe(true) // ST_OPR_XOR_1
    expect(r1).toContain('orbitpm:decisionBasis="Eligibility policy"') // business-rule link
    const r2 = startTagOf(xml, 'ObjDef_R2')
    expect(r2.startsWith('<parallelGateway')).toBe(true) // ST_OPR_AND_1
    // Evaluated-event name + business-rule name, joined with '; '.
    expect(r2).toContain('orbitpm:decisionBasis="Application accepted; Age limit policy"')
  })

  it('never materializes satellite objects as flow nodes', async () => {
    const xml = await convertFirst()
    // Their AML ids never appear (no node, no shape)…
    for (const id of [
      'ObjDef_P1',
      'ObjDef_PT1',
      'ObjDef_S1',
      'ObjDef_ENT1',
      'ObjDef_DOC1',
      'ObjDef_BR1',
      'ObjDef_POL1'
    ]) {
      expect(xml).not.toContain(id)
    }
    // …and no task/callActivity carries a satellite name as its label.
    const names = flowActivityNames(xml)
    for (const forbidden of [
      'Ahmed',
      'TAMM',
      'Owner record',
      'Registration Officer',
      'Eligibility policy',
      'Animal welfare policy'
    ]) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('ignores CT_AFFECTS entirely', async () => {
    const xml = await convertFirst()
    expect(xml).not.toContain('Animal welfare policy')
  })

  it('joins split PlainText runs into one name', async () => {
    const xml = await convertFirst()
    // E4's English AT_NAME is stored as two styled runs "Applicant" + "notified".
    expect(xml).toContain('name="Applicant notified"')
  })
})

describe('convertAmlToBpmnFiles — layout', () => {
  /** Pull every DI bounds + waypoint list out of an emitted file. */
  function parseDi(xml: string): {
    shapes: Array<{ id: string; x: number; y: number; w: number; h: number }>
    edges: Array<Array<{ x: number; y: number }>>
  } {
    const shapes: Array<{ id: string; x: number; y: number; w: number; h: number }> = []
    const shapeRe =
      /<bpmndi:BPMNShape[^>]*bpmnElement="([^"]*)"[^>]*><dc:Bounds x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g
    let m: RegExpExecArray | null
    while ((m = shapeRe.exec(xml))) {
      shapes.push({ id: m[1], x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) })
    }
    const edges: Array<Array<{ x: number; y: number }>> = []
    const edgeRe = /<bpmndi:BPMNEdge[\s\S]*?<\/bpmndi:BPMNEdge>/g
    const wpRe = /<di:waypoint x="(-?\d+)" y="(-?\d+)"/g
    let e: RegExpExecArray | null
    while ((e = edgeRe.exec(xml))) {
      const wps: Array<{ x: number; y: number }> = []
      let w: RegExpExecArray | null
      wpRe.lastIndex = 0
      while ((w = wpRe.exec(e[0]))) wps.push({ x: Number(w[1]), y: Number(w[2]) })
      edges.push(wps)
    }
    return { shapes, edges }
  }

  it('every emitted file carries a generated BPMNDiagram with sane DI', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    expect(result.files).toHaveLength(3)
    for (const file of result.files) {
      expect(file.xml).toContain('<bpmndi:BPMNDiagram id="BPMNDiagram_1">')
      const { shapes, edges } = parseDi(file.xml)
      expect(shapes.length).toBeGreaterThan(0)
      expect(edges.length).toBeGreaterThan(0)
      for (const s of shapes) {
        expect(s.x, `${file.name} ${s.id} x`).toBeGreaterThanOrEqual(0)
        expect(s.y, `${file.name} ${s.id} y`).toBeGreaterThanOrEqual(0)
      }
      // Orthogonal-only routing, everywhere.
      for (const wps of edges) {
        expect(wps.length).toBeGreaterThanOrEqual(2)
        for (let i = 1; i < wps.length; i++) {
          expect(wps[i - 1].x === wps[i].x || wps[i - 1].y === wps[i].y).toBe(true)
        }
      }
    }
  })

  it('re-lays out even models WITH full ARIS geometry (hints only, no copy)', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const { shapes } = parseDi(result.files[0].xml)
    const byId = new Map(shapes.map((s) => [s.id, s]))
    // Standard bpmn-js element sizes, not scaled ARIS boxes (F1 was 670×240).
    expect(byId.get('ObjDef_F1')).toMatchObject({ w: 100, h: 80 })
    expect(byId.get('ObjDef_E1')).toMatchObject({ w: 36, h: 36 })
    expect(byId.get('ObjDef_R1')).toMatchObject({ w: 50, h: 50 })
    // The sequential spine E1 → F1 → R1 shares ONE vertical axis…
    const axis = (id: string): number => {
      const s = byId.get(id) as { x: number; w: number }
      return s.x + s.w / 2
    }
    expect(axis('ObjDef_E1')).toBe(axis('ObjDef_F1'))
    expect(axis('ObjDef_F1')).toBe(axis('ObjDef_R1'))
    // …and the ARIS reading order survives as branch order: E2 (drawn left)
    // stays left of E3 (drawn right) under the XOR split.
    expect(axis('ObjDef_E2')).toBeLessThan(axis('ObjDef_E3'))
    // External labels for named events/gateways get BPMNLabel bounds.
    expect(result.files[0].xml).toContain('<bpmndi:BPMNLabel>')
  })

  it('models without geometry lay out the same way (no hints at all)', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const xml = result.files[1].xml // Model.M2 has occurrences but no Position/Size
    expect(xml).toContain('<bpmndi:BPMNDiagram id="BPMNDiagram_1">')
    expect(xml).toContain('<startEvent')
    expect(xml).toContain('<endEvent')
    // orbitpm attrs survive.
    expect(xml).toContain('orbitpm:nameAr="معالجة الأرشيف"')
    // The legacy bare-AttrValue name shape still parses.
    expect(xml).toContain('Archive completed')
    // The E8 → F9 → E9 chain is one straight spine.
    const { shapes } = parseDi(xml)
    const centers = shapes
      .filter((s) => ['ObjDef_E8', 'ObjDef_F9', 'ObjDef_E9'].includes(s.id))
      .map((s) => s.x + s.w / 2)
    expect(centers).toHaveLength(3)
    expect(new Set(centers).size).toBe(1)
  })

  it('conversion is deterministic: same input, byte-identical output', async () => {
    const a = await convertAmlToBpmnFiles(AML_SAMPLE)
    const b = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in a) || !('files' in b)) throw new Error('conversion failed')
    expect(a.files.map((f) => f.xml)).toEqual(b.files.map((f) => f.xml))
  })
})

describe('convertAmlToBpmnFiles — value-chain overview', () => {
  async function overviewXml(): Promise<string> {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    return result.files[2].xml
  }

  it('turns the leaf chevrons into callActivities onto the converted EPCs', async () => {
    const xml = await overviewXml()
    // F1 occurs inside converted EPC M1 → overview-occurrence rule.
    const f1 = startTagOf(xml, 'ObjDef_F1')
    expect(f1.startsWith('<callActivity')).toBe(true)
    expect(f1).toContain('calledElement="AWF-REG-01"')
    // F9 occurs inside converted EPC M2.
    const f9 = startTagOf(xml, 'ObjDef_F9')
    expect(f9).toContain('calledElement="Model_M2"')
    // F10 has NO EPC occurrence — its LinkedModels.IdRefs assignment resolves.
    const f10 = startTagOf(xml, 'ObjDef_F10')
    expect(f10.startsWith('<callActivity')).toBe(true)
    expect(f10).toContain('calledElement="Model_M2"')
    // Chevron names ride along bilingually.
    expect(f10).toContain('orbitpm:nameEn="Long-term archival"')
    expect(f10).toContain('orbitpm:nameAr="الأرشفة طويلة الأمد"')
  })

  it('chains the chevrons in drawn reading order (no CT_IS_PREDEC_OF drawn)', async () => {
    const xml = await overviewXml()
    // Drawn x order: F1 (75) → F9 (775) → F10 (1475).
    expect(xml).toMatch(/<sequenceFlow[^>]*sourceRef="ObjDef_F1"[^>]*targetRef="ObjDef_F9"/)
    expect(xml).toMatch(/<sequenceFlow[^>]*sourceRef="ObjDef_F9"[^>]*targetRef="ObjDef_F10"/)
    expect((xml.match(/<sequenceFlow\b/g) ?? []).length).toBe(2)
    // No events are inferred on an overview.
    expect(xml).not.toContain('<startEvent')
    expect(xml).not.toContain('<endEvent')
  })

  it('keeps the overview process bilingual and marked with its model name', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const overview = result.files[2]
    expect(overview.kind).toBe('overview')
    expect(overview.xml).toContain('<process id="Model_V1" name="Process landscape"')
  })
})

describe('convertAmlToBpmnFiles — hierarchy', () => {
  it('emits callActivity for functions referencing another converted model', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const [m1, m2] = result.files
    // F3 carries CT_REFS_TO_2 → F9, and F9 occurs in Model.M2.
    const f3 = startTagOf(m1.xml, 'ObjDef_F3')
    expect(f3.startsWith('<callActivity')).toBe(true)
    expect(f3).toContain('calledElement="Model_M2"')
    expect(m2.xml).toContain('<process id="Model_M2"')
    // F9 itself stays a plain task inside its own model.
    expect(m2.xml).not.toContain('<callActivity')
  })
})

describe('convertAmlToBpmnFiles — gateway symbols', () => {
  it('maps ST_OPR_OR_* occurrences to inclusive gateways', async () => {
    // Minimal EPC with an OR operator; no geometry → auto-layout path.
    const aml = `<AML>
      <ObjDef ObjDef.ID="ObjDef.A" TypeNum="OT_EVT">
        <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Evaluated?"/></AttrValue></AttrDef>
        <CxnDef CxnDef.ID="Cxn.1" CxnDef.Type="CT_IS_EVAL_BY_1" ToObjDef.IdRef="ObjDef.R"/>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.R" TypeNum="OT_RULE">
        <CxnDef CxnDef.ID="Cxn.2" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.B"/>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.B" TypeNum="OT_FUNC">
        <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033"><PlainText TextValue="Do work"/></AttrValue></AttrDef>
      </ObjDef>
      <Model Model.ID="Model.X" Model.Type="MT_EEPC">
        <ObjOcc ObjOcc.ID="Occ.1" ObjDef.IdRef="ObjDef.A" SymbolNum="ST_EV"/>
        <ObjOcc ObjOcc.ID="Occ.2" ObjDef.IdRef="ObjDef.R" SymbolNum="ST_OPR_OR_1"/>
        <ObjOcc ObjOcc.ID="Occ.3" ObjDef.IdRef="ObjDef.B" SymbolNum="ST_FUNC"/>
      </Model>
    </AML>`
    const result = await convertAmlToBpmnFiles(aml)
    if (!('files' in result)) throw new Error('conversion failed')
    const xml = result.files[0].xml
    expect(xml).toContain('<inclusiveGateway')
    // The evaluated event's name documents the decision.
    expect(xml).toContain('orbitpm:decisionBasis="Evaluated?"')
  })
})

describe('convertAmlToBpmnFiles — error codes', () => {
  it("reports 'not-aml' for non-AML input", async () => {
    const result = await convertAmlToBpmnFiles('<definitions>not aris</definitions>')
    expect(result).toEqual({ error: 'not-aml' })
  })

  it("reports 'no-objects' when the catalogue is empty", async () => {
    const result = await convertAmlToBpmnFiles('<AML><Group Group.ID="Group.1"/></AML>')
    expect(result).toEqual({ error: 'no-objects' })
  })

  it("reports 'no-models' when models exist but none is an EPC", async () => {
    const aml = `<AML>
      <ObjDef ObjDef.ID="ObjDef.X" TypeNum="OT_FUNC"/>
      <Model Model.ID="Model.V" Model.Type="MT_VAL_ADD_CHN_DGM"></Model>
    </AML>`
    const result = await convertAmlToBpmnFiles(aml)
    expect(result).toEqual({ error: 'no-models' })
  })
})

describe('emitted BPMN imports cleanly', () => {
  it('bpmn-moddle parses all three fixture files without warnings', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    expect(result.files).toHaveLength(3)
    const moddle = new BpmnModdle()
    for (const file of result.files) {
      const { rootElement, warnings } = await moddle.fromXML(file.xml)
      expect(rootElement.$type).toBe('bpmn:Definitions')
      expect(warnings).toEqual([])
    }
    // The first EPC's DI plane really carries the shapes + edges.
    const { rootElement } = await moddle.fromXML(result.files[0].xml)
    const plane = rootElement.diagrams[0].plane
    // 10 flow nodes + 9 sequence flows.
    expect(plane.planeElement).toHaveLength(19)
  })
})

describe('convertApcToBpmn (legacy wrapper)', () => {
  it('returns the first converted model', async () => {
    const result = await convertApcToBpmn(AML_SAMPLE)
    expect('xml' in result).toBe(true)
    if (!('xml' in result)) return
    expect(result.xml).toContain('<process id="AWF-REG-01"')
  })

  it('propagates error codes', async () => {
    expect(await convertApcToBpmn('<nope/>')).toEqual({ error: 'not-aml' })
  })
})

describe('request-to-register owner routing regression', () => {
  it('uses the minimum-bend collision-free route into the shared XOR merge', async () => {
    const fixture = readFileSync(
      new URL('./fixtures/request-to-register-owner-routing.aml.xml', import.meta.url),
      'utf8'
    )
    const result = await convertAmlToBpmnFiles(fixture)
    if (!('files' in result)) throw new Error(`conversion failed: ${result.error}`)
    const ownerProfile = result.files.find(
      (file) => file.nameEn === 'Request to Register Animal Owner Profile'
    )
    expect(ownerProfile, 'owner-profile fixture EPC').toBeTruthy()

    const { rootElement, warnings } = await new BpmnModdle().fromXML(ownerProfile?.xml as string)
    expect(warnings).toEqual([])
    const process = rootElement.rootElements.find(
      (element: { $type: string }) => element.$type === 'bpmn:Process'
    )
    const leaseEvent = process.flowElements.find(
      (element: { name?: string }) => element.name === 'Lease contract uploaded'
    )
    expect(leaseEvent, 'Lease contract uploaded event').toBeTruthy()
    const mergeFlow = leaseEvent.outgoing.find(
      (flow: {
        targetRef: {
          $type: string
          incoming: Array<{ sourceRef: { name?: string } }>
        }
      }) =>
        flow.targetRef.$type === 'bpmn:ExclusiveGateway' &&
        flow.targetRef.incoming.some(
          (incoming) => incoming.sourceRef.name === 'Application data inserted'
        )
    )
    expect(mergeFlow, 'semantic event → shared XOR merge flow').toBeTruthy()

    const plane = rootElement.diagrams[0].plane
    const diEdge = plane.planeElement.find(
      (element: { $type: string; bpmnElement?: { id: string } }) =>
        element.$type === 'bpmndi:BPMNEdge' && element.bpmnElement?.id === mergeFlow.id
    )
    expect(diEdge, 'DI for semantic merge flow').toBeTruthy()

    type Point = { x: number; y: number }
    const route: Point[] = []
    for (const waypoint of diEdge.waypoint as Point[]) {
      const point = { x: waypoint.x, y: waypoint.y }
      const previous = route[route.length - 1]
      if (previous && previous.x === point.x && previous.y === point.y) continue
      route.push(point)
      while (route.length >= 3) {
        const a = route[route.length - 3]
        const b = route[route.length - 2]
        const c = route[route.length - 1]
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
          route.splice(route.length - 2, 1)
        } else {
          break
        }
      }
    }
    expect(route.length - 2, `normalized route ${JSON.stringify(route)}`).toBe(2)

    const shapes = plane.planeElement.filter(
      (element: { $type: string }) => element.$type === 'bpmndi:BPMNShape'
    )
    const sourceShape = shapes.find(
      (shape: { bpmnElement: { id: string } }) => shape.bpmnElement.id === leaseEvent.id
    )
    const targetShape = shapes.find(
      (shape: { bpmnElement: { id: string } }) => shape.bpmnElement.id === mergeFlow.targetRef.id
    )
    expect(sourceShape).toBeTruthy()
    expect(targetShape).toBeTruthy()
    const sourceCenterX = sourceShape.bounds.x + sourceShape.bounds.width / 2
    const targetCenterX = targetShape.bounds.x + targetShape.bounds.width / 2
    expect(
      Math.max(...route.map((point) => point.x)),
      'route never enters a far-right lane'
    ).toBeLessThanOrEqual(Math.max(sourceCenterX, targetCenterX))

    const crossesInterior = (
      a: Point,
      b: Point,
      box: { x: number; y: number; width: number; height: number }
    ): boolean => {
      if (a.x === b.x) {
        const y0 = Math.min(a.y, b.y)
        const y1 = Math.max(a.y, b.y)
        return a.x > box.x && a.x < box.x + box.width && y0 < box.y + box.height && y1 > box.y
      }
      if (a.y === b.y) {
        const x0 = Math.min(a.x, b.x)
        const x1 = Math.max(a.x, b.x)
        return a.y > box.y && a.y < box.y + box.height && x0 < box.x + box.width && x1 > box.x
      }
      return true
    }
    for (const shape of shapes) {
      const isEndpoint =
        shape.bpmnElement.id === leaseEvent.id || shape.bpmnElement.id === mergeFlow.targetRef.id
      if (!isEndpoint) {
        for (let i = 1; i < route.length; i++) {
          expect(
            crossesInterior(route[i - 1], route[i], shape.bounds),
            `${mergeFlow.id} segment ${i} crosses shape ${shape.bpmnElement.id}`
          ).toBe(false)
        }
      }
      if (shape.label?.bounds) {
        for (let i = 1; i < route.length; i++) {
          expect(
            crossesInterior(route[i - 1], route[i], shape.label.bounds),
            `${mergeFlow.id} segment ${i} crosses label ${shape.bpmnElement.id}`
          ).toBe(false)
        }
      }
    }
  })
})

describe('convertAmlToBpmnFiles — semantic gateway naming', () => {
  it('replaces XOR/OR/AND aliases with bilingual standards wording while preserving a genuine question', async () => {
    const aml = `<AML>
      <ObjDef ObjDef.ID="ObjDef.XorAlias" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033"><PlainText TextValue="  xor RULE  "/></AttrValue>
          <AttrValue LocaleId="14337"><PlainText TextValue="XOR rule"/></AttrValue>
        </AttrDef>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.OrAlias" TypeNum="OT_RULE" SymbolNum="ST_OPR_OR_1">
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033"><PlainText TextValue="OR rule"/></AttrValue>
          <AttrValue LocaleId="14337"><PlainText TextValue=" or RULE "/></AttrValue>
        </AttrDef>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.AndAlias" TypeNum="OT_RULE" SymbolNum="ST_OPR_AND_1">
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033"><PlainText TextValue="and rule"/></AttrValue>
          <AttrValue LocaleId="14337"><PlainText TextValue=" AND RULE "/></AttrValue>
        </AttrDef>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.Question" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033"><PlainText TextValue="Approved?"/></AttrValue>
          <AttrValue LocaleId="14337"><PlainText TextValue="هل تمت الموافقة؟"/></AttrValue>
        </AttrDef>
      </ObjDef>
      <Model Model.ID="Model.Semantic.Gateways" Model.Type="MT_EEPC">
        <ObjOcc ObjOcc.ID="Occ.XorAlias" ObjDef.IdRef="ObjDef.XorAlias"/>
        <ObjOcc ObjOcc.ID="Occ.OrAlias" ObjDef.IdRef="ObjDef.OrAlias"/>
        <ObjOcc ObjOcc.ID="Occ.AndAlias" ObjDef.IdRef="ObjDef.AndAlias"/>
        <ObjOcc ObjOcc.ID="Occ.Question" ObjDef.IdRef="ObjDef.Question"/>
      </Model>
    </AML>`
    const english = await convertAmlToBpmnFiles(aml, { lang: 'en' })
    const arabic = await convertAmlToBpmnFiles(aml, { lang: 'ar' })
    if (!('files' in english) || !('files' in arabic)) {
      throw new Error('semantic gateway conversion failed')
    }

    for (const [xml, lang] of [
      [english.files[0].xml, 'en'],
      [arabic.files[0].xml, 'ar']
    ] as const) {
      const xorAlias = startTagOf(xml, 'ObjDef_XorAlias')
      const orAlias = startTagOf(xml, 'ObjDef_OrAlias')
      const andAlias = startTagOf(xml, 'ObjDef_AndAlias')
      expect(xorAlias.startsWith('<exclusiveGateway')).toBe(true)
      expect(orAlias.startsWith('<inclusiveGateway')).toBe(true)
      expect(andAlias.startsWith('<parallelGateway')).toBe(true)
      expect(xorAlias).toContain(`name="${lang === 'en' ? 'Exclusive gateway' : 'بوابة حصرية'}"`)
      expect(orAlias).toContain(`name="${lang === 'en' ? 'Inclusive gateway' : 'بوابة شاملة'}"`)
      expect(andAlias).toContain(`name="${lang === 'en' ? 'Parallel gateway' : 'بوابة متوازية'}"`)
      for (const aliasTag of [xorAlias, orAlias, andAlias]) {
        expect(aliasTag).toContain('orbitpm:nameEn')
        expect(aliasTag).toContain('orbitpm:nameAr')
        expect(aliasTag.toLowerCase()).not.toContain('xor rule')
        expect(aliasTag.toLowerCase()).not.toContain('or rule')
        expect(aliasTag.toLowerCase()).not.toContain('and rule')
      }
      expect(xml).not.toContain('orbitpm:semanticType')
    }

    expect(startTagOf(english.files[0].xml, 'ObjDef_Question')).toContain('name="Approved?"')
    expect(startTagOf(arabic.files[0].xml, 'ObjDef_Question')).toContain('name="هل تمت الموافقة؟"')
    for (const xml of [english.files[0].xml, arabic.files[0].xml]) {
      const question = startTagOf(xml, 'ObjDef_Question')
      expect(question).toContain('orbitpm:nameEn="Approved?"')
      expect(question).toContain('orbitpm:nameAr="هل تمت الموافقة؟"')
    }
  })

  it('uses ObjDef symbols as fallback, keeps occurrence symbols authoritative, and preserves stable ids', async () => {
    const aml = `<AML>
      <ObjDef ObjDef.ID="ObjDef.Fallback" TypeNum="OT_RULE" SymbolNum="ST_OPR_OR_1">
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033"><PlainText TextValue="OR rule"/></AttrValue>
          <AttrValue LocaleId="14337"><PlainText TextValue="OR rule"/></AttrValue>
        </AttrDef>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.Override" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="1033"><PlainText TextValue="Run together?"/></AttrValue>
          <AttrValue LocaleId="14337"><PlainText TextValue="هل تعمل بالتوازي؟"/></AttrValue>
        </AttrDef>
      </ObjDef>
      <Model Model.ID="Model.Stable.Semantics" Model.Type="MT_EEPC">
        <ObjOcc ObjOcc.ID="Occ.Fallback" ObjDef.IdRef="ObjDef.Fallback"/>
        <ObjOcc ObjOcc.ID="Occ.Override" ObjDef.IdRef="ObjDef.Override" SymbolNum="ST_OPR_AND_1"/>
      </Model>
    </AML>`
    expect(parseAml(aml).objectById.get('ObjDef.Fallback')?.symbolNum).toBe('ST_OPR_OR_1')

    const english = await convertAmlToBpmnFiles(aml, { lang: 'en' })
    const arabic = await convertAmlToBpmnFiles(aml, { lang: 'ar' })
    if (!('files' in english) || !('files' in arabic)) {
      throw new Error('symbol fallback conversion failed')
    }
    for (const xml of [english.files[0].xml, arabic.files[0].xml]) {
      expect(xml).toContain('<process id="Model_Stable_Semantics"')
      expect(startTagOf(xml, 'ObjDef_Fallback').startsWith('<inclusiveGateway')).toBe(true)
      expect(startTagOf(xml, 'ObjDef_Override').startsWith('<parallelGateway')).toBe(true)
      expect(xml).not.toContain('orbitpm:semanticType')
    }
    expect(english.files[0].processId).toBe(arabic.files[0].processId)
    expect(english.files[0].processId).toBe('Model_Stable_Semantics')
  })
})
