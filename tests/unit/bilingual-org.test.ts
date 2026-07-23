/**
 * Bilingual labels + DMT org-pack metadata (2026-07 extension).
 *
 * Covers: (1) the IR schema accepting bilingual+org IRs, old plain IRs, and
 * junk org values (leniently — the repair loop must never fail a diagram over
 * org metadata); (2) the lenient coercers; (3) attribute-exact `orbitpm:*`
 * XML emission incl. the conditional xmlns + process activeLang; (4) the
 * Arabic-codepoint activeLang heuristic; (5) generateFromDescription carrying
 * everything end-to-end (semantic + layouted XML).
 */
import { describe, it, expect } from 'vitest'
import {
  ProcessModelSchema,
  coerceOrgString,
  coerceOrgStringArray
} from '../../src/gen/ir/schema'
import { validateBpmn } from '../../src/gen/ir/validate'
import { transform } from '../../src/gen/transform'
import { generateBpmnXml, arabicRatio, detectActiveLang } from '../../src/gen/xml'
import { generateFromDescription, type CallLLM } from '../../src/gen/generate'
import { loadIr, canonicalXml, bilingualOrgIr } from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */
const start = { type: 'startEvent', id: 'start' }
const end = { type: 'endEvent', id: 'end' }

describe('IR schema: bilingual + org fields', () => {
  it('accepts a fully bilingual + org-attributed IR (validateBpmn and Zod)', () => {
    const process = bilingualOrgIr()
    expect(() => validateBpmn(process)).not.toThrow()
    const parsed = ProcessModelSchema.safeParse({ process })
    expect(parsed.success).toBe(true)
  })

  it('still accepts an old plain IR with none of the new fields', () => {
    const plain = loadIr('ex1_professor')
    expect(() => validateBpmn(plain.process)).not.toThrow()
    expect(ProcessModelSchema.safeParse(plain).success).toBe(true)
  })

  it('never fails validation over junk org metadata (repair-loop guarantee)', () => {
    const process = [
      { ...start, trigger: { nested: 'object' }, labelEn: 42, labelAr: null },
      {
        type: 'userTask',
        id: 't1',
        label: 'Review',
        owner: ['not', 'a', 'string'],
        ownerRole: 7,
        channel: false,
        cc: 'just one string',
        inputs: [1, null, 'Form', {}],
        respList: {},
        kind: [],
        labelEn: {},
        labelAr: ['x']
      },
      {
        type: 'exclusiveGateway',
        id: 'g',
        label: 'OK?',
        decisionBasis: { rule: 4 },
        has_join: false,
        branches: [
          { condition: 'Yes', conditionEn: 99, conditionAr: {}, path: [{ ...end, id: 'end1' }] },
          { condition: 'No', conditionEn: null, path: [] }
        ]
      }
    ]
    expect(() => validateBpmn(process)).not.toThrow()
    expect(ProcessModelSchema.safeParse({ process }).success).toBe(true)
    // ...and the emitter degrades junk to "absent"/coerced instead of throwing.
    expect(() => generateBpmnXml(process as never[])).not.toThrow()
  })

  it('Zod parse coerces org values (bare cc string -> array, numbers -> strings, junk dropped)', () => {
    const parsed = ProcessModelSchema.parse({
      process: [
        start,
        {
          type: 'userTask',
          id: 't1',
          label: 'Review',
          owner: '  Procurement  ',
          ownerRole: 7,
          cc: 'Finance',
          inputs: ['Form', 5, null, {}],
          respList: {},
          labelEn: { junk: true }
        },
        end
      ]
    })
    const task = parsed.process[1] as any
    expect(task.owner).toBe('Procurement')
    expect(task.ownerRole).toBe('7')
    expect(task.cc).toEqual(['Finance'])
    expect(task.inputs).toEqual(['Form', '5'])
    expect(task.respList).toBeUndefined()
    expect(task.labelEn).toBeUndefined()
  })
})

describe('lenient coercers', () => {
  it('coerceOrgString trims, stringifies scalars, drops junk/empties', () => {
    expect(coerceOrgString(' x ')).toBe('x')
    expect(coerceOrgString('')).toBeUndefined()
    expect(coerceOrgString('   ')).toBeUndefined()
    expect(coerceOrgString(5)).toBe('5')
    expect(coerceOrgString(true)).toBe('true')
    expect(coerceOrgString(null)).toBeUndefined()
    expect(coerceOrgString(undefined)).toBeUndefined()
    expect(coerceOrgString({})).toBeUndefined()
    expect(coerceOrgString(['a'])).toBeUndefined()
  })

  it('coerceOrgStringArray keeps coercible entries, wraps scalars, drops the rest', () => {
    expect(coerceOrgStringArray(['a', 5, null, ' b ', {}])).toEqual(['a', '5', 'b'])
    expect(coerceOrgStringArray('solo')).toEqual(['solo'])
    expect(coerceOrgStringArray([])).toBeUndefined()
    expect(coerceOrgStringArray([null, {}])).toBeUndefined()
    expect(coerceOrgStringArray({})).toBeUndefined()
  })
})

describe('XML emission: orbitpm attributes (attribute-exact)', () => {
  const xml = generateBpmnXml(bilingualOrgIr())

  it('declares xmlns:orbitpm on definitions and activeLang="ar" on the process', () => {
    expect(xml).toContain(
      '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
        'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
        'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ' +
        'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" ' +
        'xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0" id="definitions_1">'
    )
    expect(xml).toContain('<process id="Process_1" isExecutable="false" orbitpm:activeLang="ar">')
  })

  it('emits the start event with bilingual names + trigger fields', () => {
    expect(xml).toContain(
      '<startEvent id="start" name="استلام الطلب" ' +
        'orbitpm:nameEn="Request received" orbitpm:nameAr="استلام الطلب" ' +
        'orbitpm:trigger="Employee submits a purchase request" ' +
        'orbitpm:triggerService="DMT HUB" orbitpm:triggerDetail="PR-101 form">'
    )
  })

  it('emits the task with every activity org attribute (lists \\n-joined as &#10;)', () => {
    expect(xml).toContain(
      '<userTask id="task1" name="مراجعة الطلب" ' +
        'orbitpm:nameEn="Review request" orbitpm:nameAr="مراجعة الطلب" ' +
        'orbitpm:owner="Procurement Section" orbitpm:ownerRole="R" ' +
        'orbitpm:channel="dmthub" orbitpm:channelDetail="PR-101 form" orbitpm:kind="cc" ' +
        'orbitpm:ccList="Finance Department&#10;Audit Office" ' +
        'orbitpm:inputs="Purchase request form&#10;Budget sheet" ' +
        'orbitpm:outputs="Approved request" ' +
        'orbitpm:respList="Sara Al Marri — Reviewer&#10;Ahmed Ali — Approver">'
    )
  })

  it('emits the gateway with bilingual names + decisionBasis', () => {
    expect(xml).toContain(
      '<exclusiveGateway id="gw" name="هل الطلب مكتمل؟" ' +
        'orbitpm:nameEn="Request complete?" orbitpm:nameAr="هل الطلب مكتمل؟" ' +
        'orbitpm:decisionBasis="Procurement policy section 4">'
    )
  })

  it('emits the callActivity with calledElement AND org attrs', () => {
    expect(xml).toContain(
      '<callActivity id="ca1" name="تنفيذ الشراء" calledElement="Process_Purchasing" ' +
        'orbitpm:nameEn="Run purchasing" orbitpm:nameAr="تنفيذ الشراء" ' +
        'orbitpm:owner="Procurement Section">'
    )
  })

  it('branch flows carry name from condition + orbitpm names from conditionEn/Ar', () => {
    expect(xml).toContain(
      '<sequenceFlow id="gw-ca1" sourceRef="gw" targetRef="ca1" name="نعم" ' +
        'orbitpm:nameEn="Yes" orbitpm:nameAr="نعم" />'
    )
    expect(xml).toContain(
      '<sequenceFlow id="gw-end2" sourceRef="gw" targetRef="end2" name="لا" ' +
        'orbitpm:nameEn="No" orbitpm:nameAr="لا" />'
    )
  })

  it('stays well-formed XML (canonicalizable) with all attrs intact', () => {
    expect(() => canonicalXml(xml)).not.toThrow()
    expect(canonicalXml(xml)).toContain('orbitpm:decisionBasis')
  })

  it('escapes quotes/newlines inside org attribute values', () => {
    const process = [
      start,
      {
        type: 'userTask',
        id: 't1',
        label: 'X',
        labelEn: 'Say "hi" & go',
        respList: ['A — "Lead"', 'B<C']
      },
      end
    ]
    const out = generateBpmnXml(process as never[])
    expect(out).toContain('orbitpm:nameEn="Say &quot;hi&quot; &amp; go"')
    expect(out).toContain('orbitpm:respList="A — &quot;Lead&quot;&#10;B&lt;C"')
    expect(() => canonicalXml(out)).not.toThrow()
  })

  it('activeLang is "en" when primary labels are English', () => {
    const process = [
      { ...start, label: 'Start', labelAr: 'بداية' },
      { type: 'userTask', id: 't1', label: 'Review request', labelEn: 'Review request', labelAr: 'مراجعة' },
      end
    ]
    const out = generateBpmnXml(process as never[])
    expect(out).toContain('orbitpm:activeLang="en"')
  })
})

describe('XML emission: plain IRs stay byte-identical (no orbitpm leakage)', () => {
  it('a plain IR emits NO xmlns:orbitpm, NO activeLang, NO orbitpm attrs', () => {
    const xml = generateBpmnXml(loadIr('ex1_professor').process)
    expect(xml).not.toContain('orbitpm')
    expect(xml).toContain('<process id="Process_1" isExecutable="false">')
  })

  it('an IR whose org values are ALL junk degrades to the plain byte-identical form', () => {
    const plain = [start, { type: 'userTask', id: 't1', label: 'Review' }, end]
    const junky = [
      { ...start, trigger: {} },
      { type: 'userTask', id: 't1', label: 'Review', owner: {}, cc: [null], labelEn: '   ' },
      { ...end }
    ]
    expect(generateBpmnXml(junky as never[])).toBe(generateBpmnXml(plain as never[]))
  })
})

describe('activeLang heuristic (arabicRatio / detectActiveLang)', () => {
  it('arabicRatio: 0 for empty/no letters, 1 for pure Arabic, mixed in between', () => {
    expect(arabicRatio('')).toBe(0)
    expect(arabicRatio('123 !?')).toBe(0)
    expect(arabicRatio('Review request')).toBe(0)
    expect(arabicRatio('مراجعة الطلب')).toBe(1)
    const mixed = arabicRatio('مراجعة Review')
    expect(mixed).toBeGreaterThan(0)
    expect(mixed).toBeLessThan(1)
  })

  it('detectActiveLang: ar when Arabic dominates, en otherwise (incl. empty)', () => {
    expect(detectActiveLang(['مراجعة الطلب', 'اعتماد الطلب', null, undefined])).toBe('ar')
    expect(detectActiveLang(['Review request', 'Approve request'])).toBe('en')
    expect(detectActiveLang([])).toBe('en')
    expect(detectActiveLang([null, undefined, ''])).toBe('en')
    // majority rules on mixed input
    expect(detectActiveLang(['مراجعة الطلب المقدم من الموظف', 'OK'])).toBe('ar')
    expect(detectActiveLang(['Review the submitted purchase request', 'نعم'])).toBe('en')
  })
})

describe('generateFromDescription: bilingual + org end-to-end', () => {
  it('carries orbitpm attrs into BOTH semanticXml and layoutedXml', async () => {
    const callLLM: CallLLM = async () => ({ process: bilingualOrgIr() })
    const result = await generateFromDescription(callLLM, 'وصف عملية الشراء')
    for (const probe of [
      'xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"',
      'orbitpm:activeLang="ar"',
      'orbitpm:nameEn="Review request"',
      'orbitpm:ccList="Finance Department&#10;Audit Office"',
      'orbitpm:decisionBasis="Procurement policy section 4"',
      'orbitpm:trigger="Employee submits a purchase request"',
      'orbitpm:nameEn="Yes"'
    ]) {
      expect(result.semanticXml).toContain(probe)
      expect(result.layoutedXml).toContain(probe)
    }
    expect(result.layoutedXml).toContain('BPMNDiagram')
  })
})
