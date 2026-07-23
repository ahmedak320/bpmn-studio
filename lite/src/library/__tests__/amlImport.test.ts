import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import BpmnModdle from 'bpmn-moddle'
import { convertAmlToBpmnFiles, convertApcToBpmn, looksLikeAml } from '../apcImport'
import { AML_SAMPLE } from '../__fixtures__/aml-sample'

// The real ARIS 10 "DMT" database export this converter was rebuilt against.
// The smoke suite below only runs when the file is present on this machine.
const REAL_EXPORT_PATH =
  '/home/ahmed/.claude/uploads/8f8887c3-73c3-48e7-bcb9-7da7af54a1aa/3bc47a21-ARISAMLExport.xml'

function tryReadRealExport(): string | undefined {
  try {
    return readFileSync(REAL_EXPORT_PATH, 'utf8')
  } catch {
    return undefined
  }
}

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
    expect(looksLikeAml('<?xml version="1.0"?>\n<!DOCTYPE AML SYSTEM "ARIS-Export.dtd" [\n]>\n<AML/>')).toBe(true)
  })

  it('rejects BPMN and random XML', () => {
    expect(looksLikeAml('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>')).toBe(false)
    expect(looksLikeAml('<foo><bar/></foo>')).toBe(false)
    expect(looksLikeAml('<AMLX>')).toBe(false)
    expect(looksLikeAml('')).toBe(false)
  })
})

describe('convertAmlToBpmnFiles — model splitting', () => {
  it('emits one file per MT_EEPC model and skips the value-chain map', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    expect('files' in result).toBe(true)
    if (!('files' in result)) return
    expect(result.files).toHaveLength(2)
    expect(result.files[0].name).toBe('Register animal owner')
    expect(result.files[1].name).toBe('Archive requests')
    // The MT_VAL_ADD_CHN_DGM landscape produced no file.
    expect(result.files.some((f) => f.name === 'Process landscape')).toBe(false)
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
    for (const id of ['ObjDef_P1', 'ObjDef_PT1', 'ObjDef_S1', 'ObjDef_ENT1', 'ObjDef_DOC1', 'ObjDef_BR1', 'ObjDef_POL1']) {
      expect(xml).not.toContain(id)
    }
    // …and no task/callActivity carries a satellite name as its label.
    const names = flowActivityNames(xml)
    for (const forbidden of ['Ahmed', 'TAMM', 'Owner record', 'Registration Officer', 'Eligibility policy', 'Animal welfare policy']) {
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

describe('convertAmlToBpmnFiles — geometry', () => {
  it('passes the ARIS layout through as BPMN DI (scale 0.25)', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const xml = result.files[0].xml
    expect(xml).toContain('<bpmndi:BPMNDiagram')
    // Function F1: ARIS box (1200,700 670×240) × 0.25 → (300,175 168×60).
    expect(xml).toContain(
      '<bpmndi:BPMNShape id="BPMNShape_ObjDef_F1" bpmnElement="ObjDef_F1"><dc:Bounds x="300" y="175" width="168" height="60" />'
    )
    // Event E1: a standard 36×36 circle centered in the scaled ARIS box.
    expect(xml).toContain(
      '<bpmndi:BPMNShape id="BPMNShape_ObjDef_E1" bpmnElement="ObjDef_E1"><dc:Bounds x="351" y="101" width="36" height="36" />'
    )
    // Gateway R1: a standard 50×50 diamond centered in the scaled operator box.
    expect(xml).toContain('<dc:Bounds x="348" y="268" width="50" height="50" />')
    // Edges run straight center→center (E1 → F1 is the first drawn flow).
    expect(xml).toContain(
      '<bpmndi:BPMNEdge id="BPMNEdge_flow_1" bpmnElement="flow_1"><di:waypoint x="369" y="119" /><di:waypoint x="384" y="205" /></bpmndi:BPMNEdge>'
    )
  })

  it('falls back to auto-layout when a model has no geometry', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const xml = result.files[1].xml // Model.M2 has occurrences but no Position/Size
    expect(xml).toContain('BPMNDiagram') // added by layoutBpmn
    expect(xml).toContain('<startEvent')
    expect(xml).toContain('<endEvent')
    // orbitpm attrs survive the auto-layout round-trip.
    expect(xml).toContain('orbitpm:nameAr="معالجة الأرشيف"')
    // The legacy bare-AttrValue name shape still parses.
    expect(xml).toContain('Archive completed')
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
  it('bpmn-moddle parses both fixture files without warnings', async () => {
    const result = await convertAmlToBpmnFiles(AML_SAMPLE)
    if (!('files' in result)) throw new Error('conversion failed')
    const moddle = new BpmnModdle()
    for (const file of result.files) {
      const { rootElement, warnings } = await moddle.fromXML(file.xml)
      expect(rootElement.$type).toBe('bpmn:Definitions')
      expect(warnings).toEqual([])
    }
    // The geometry file's DI plane really carries the shapes + edges.
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

// ---------------------------------------------------------------------------
// Smoke conversion of the REAL ARIS export (skipped when the file is absent).
// ---------------------------------------------------------------------------

const realText = tryReadRealExport()

describe.skipIf(!realText)('real ARIS "DMT" export (smoke)', () => {
  // Names of OT_PERS / OT_PERS_TYPE / OT_APPL_SYS objects in the real export;
  // none of them may surface as a task/callActivity label.
  const SATELLITE_NAMES = [
    'Veterinary',
    'Pet Owner',
    'New Pet Owner',
    'Operator',
    'Respective Municipality Registration Officer',
    'TAMM',
    'UAE Pass',
    'Smart Hub',
    'DED System',
    'الهوية الرقمية'
  ]

  it('converts every EPC with bilingual names and clean flow/metadata split', async () => {
    const result = await convertAmlToBpmnFiles(realText as string)
    expect('files' in result).toBe(true)
    if (!('files' in result)) return
    expect(result.files.length).toBeGreaterThanOrEqual(5)

    const moddle = new BpmnModdle()
    let nodes = 0
    let flows = 0
    let orbitpmAttrs = 0
    for (const file of result.files) {
      // Arabic names made it through the DTD-entity + locale plumbing.
      expect(file.xml).toContain('orbitpm:nameAr')
      // No satellite object became an activity.
      const names = flowActivityNames(file.xml)
      for (const forbidden of SATELLITE_NAMES) expect(names).not.toContain(forbidden)
      // Every file is importable BPMN (bpmn-js's own parser core).
      const { rootElement, warnings } = await moddle.fromXML(file.xml)
      expect(rootElement.$type).toBe('bpmn:Definitions')
      expect(warnings).toEqual([])
      nodes += (file.xml.match(/<(?:task|callActivity|startEvent|endEvent|intermediateThrowEvent|exclusiveGateway|parallelGateway|inclusiveGateway)\b/g) ?? []).length
      flows += (file.xml.match(/<sequenceFlow\b/g) ?? []).length
      orbitpmAttrs += (file.xml.match(/orbitpm:(?:respList|ccList|inputs|outputs|system|decisionBasis)="/g) ?? []).length
    }
    // Conversion statistics for the record (visible in the vitest output).
    console.log(
      `[aml-smoke] files=${result.files.length} flowNodes=${nodes} sequenceFlows=${flows} metadataAttrs=${orbitpmAttrs}`
    )
    console.log('[aml-smoke] models:', result.files.map((f) => `${f.name} (${f.nameAr ?? '—'})`).join(' | '))
    // The real EPCs all carry full occurrence geometry → their own DI.
    for (const file of result.files) expect(file.xml).toContain('<bpmndi:BPMNDiagram id="BPMNDiagram_1">')
  })
})
