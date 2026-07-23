import { describe, it, expect } from 'vitest'
import { buildDigest, buildAllDigests } from '../digest'

// One "Employee Exit" process with the full OrbitPM metadata surface:
//   Start --(dmthub trigger)--> Conduct exit interview (HR Ops, R, dmthub)
//     --> Approved? (exclusiveGateway)
//        --Yes--> Notify finance (cc -> Finance) --> Done (end)
//        --No---> Return assets (callActivity -> proc_return_assets) --> Done
// Plus a text annotation associated with task A.
const EXIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:orbitpm="http://orbitpm.ae/schema/1.0"
                  id="Defs_exit" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Proc_exit" name="Employee Exit" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Request received"
        orbitpm:trigger="dmthub" orbitpm:triggerService="Exit Service">
      <bpmn:outgoing>Flow_s_a</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_A" name="Conduct exit interview"
        orbitpm:owner="HR Ops" orbitpm:ownerRole="R" orbitpm:channel="dmthub">
      <bpmn:incoming>Flow_s_a</bpmn:incoming>
      <bpmn:outgoing>Flow_a_g</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gw_1" name="Approved?">
      <bpmn:incoming>Flow_a_g</bpmn:incoming>
      <bpmn:outgoing>Flow_yes</bpmn:outgoing>
      <bpmn:outgoing>Flow_no</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_B" name="Notify finance" orbitpm:kind="cc" orbitpm:ccTo="Finance">
      <bpmn:incoming>Flow_yes</bpmn:incoming>
      <bpmn:outgoing>Flow_b_end</bpmn:outgoing>
    </bpmn:task>
    <bpmn:callActivity id="Call_1" name="Return assets" calledElement="proc_return_assets">
      <bpmn:incoming>Flow_no</bpmn:incoming>
      <bpmn:outgoing>Flow_call_end</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:endEvent id="End_1" name="Done">
      <bpmn:incoming>Flow_b_end</bpmn:incoming>
      <bpmn:incoming>Flow_call_end</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_s_a" sourceRef="Start_1" targetRef="Task_A" />
    <bpmn:sequenceFlow id="Flow_a_g" sourceRef="Task_A" targetRef="Gw_1" />
    <bpmn:sequenceFlow id="Flow_yes" name="Yes" sourceRef="Gw_1" targetRef="Task_B" />
    <bpmn:sequenceFlow id="Flow_no" name="No" sourceRef="Gw_1" targetRef="Call_1" />
    <bpmn:sequenceFlow id="Flow_b_end" sourceRef="Task_B" targetRef="End_1" />
    <bpmn:sequenceFlow id="Flow_call_end" sourceRef="Call_1" targetRef="End_1" />
    <bpmn:textAnnotation id="Note_1"><bpmn:text>Exit must complete within 30 days</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Assoc_1" sourceRef="Task_A" targetRef="Note_1" />
  </bpmn:process>
</bpmn:definitions>`

describe('buildDigest', () => {
  it('parses the Employee Exit process into a digest', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    expect(d).not.toBeNull()
    if (!d) return
    expect(d.processId).toBe('Proc_exit')
    expect(d.processName).toBe('Employee Exit')
    expect(d.folder).toBe('HR')
  })

  it('orders steps by BFS from the start event', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    expect(d?.steps.map((s) => s.id)).toEqual([
      'Start_1',
      'Task_A',
      'Gw_1',
      'Task_B',
      'Call_1',
      'End_1'
    ])
  })

  it('parses the trigger from the first start event', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    expect(d?.trigger).toEqual({ type: 'dmthub', service: 'Exit Service' })
  })

  it('reads owner/role/channel and cc metadata onto steps', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    const a = d?.steps.find((s) => s.id === 'Task_A')
    expect(a?.owner).toBe('HR Ops')
    expect(a?.ownerRole).toBe('R')
    expect(a?.channel).toBe('dmthub')
    const b = d?.steps.find((s) => s.id === 'Task_B')
    expect(b?.kind).toBe('cc')
    expect(b?.ccTo).toBe('Finance')
  })

  it('captures the callActivity called process and rolls it up into callsTo', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    const call = d?.steps.find((s) => s.id === 'Call_1')
    expect(call?.calledProcess).toBe('proc_return_assets')
    expect(d?.callsTo).toEqual(['proc_return_assets'])
  })

  it('carries branch conditions on gateway nexts', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    const gw = d?.steps.find((s) => s.id === 'Gw_1')
    expect(gw?.nexts).toEqual([
      { targetId: 'Task_B', condition: 'Yes' },
      { targetId: 'Call_1', condition: 'No' }
    ])
    // An end event has no outgoing -> empty nexts (process complete).
    const end = d?.steps.find((s) => s.id === 'End_1')
    expect(end?.nexts).toEqual([])
  })

  it('collects text annotations as notes', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    expect(d?.notes).toContain('Exit must complete within 30 days')
  })

  it('falls back to a humanized file name when the process is unnamed', async () => {
    const xml = `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="p"><bpmn:startEvent id="s"/></bpmn:process></bpmn:definitions>`
    const d = await buildDigest('Ops/new-hire_request.bpmn', xml)
    expect(d?.processName).toBe('new hire request')
  })

  it('reads OrbitPM attributes under any declared prefix (endsWith fallback)', async () => {
    // The OrbitPM namespace is bound to prefix "op" here, not "orbitpm".
    const xml = `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:op="http://orbitpm.ae/schema/1.0"><bpmn:process id="p" name="P"><bpmn:task id="t" name="Do it" op:owner="Legal" op:ccTo="Audit"/></bpmn:process></bpmn:definitions>`
    const d = await buildDigest('P.bpmn', xml)
    const t = d?.steps.find((s) => s.id === 't')
    expect(t?.owner).toBe('Legal')
    expect(t?.ccTo).toBe('Audit')
  })

  it('returns null on unparseable XML', async () => {
    expect(await buildDigest('bad.bpmn', 'not xml at all <<<')).toBeNull()
    expect(await buildDigest('empty.bpmn', '')).toBeNull()
  })
})

// Org-pack-enriched XML: '\n'-joined list attributes ride as &#10; entities,
// exactly how the generator/StepDetailsDialog write them.
const ENRICHED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
                  id="Defs_e" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Proc_leave" name="Leave Request" isExecutable="false" orbitpm:owner="HR Department">
    <bpmn:startEvent id="S1" name="Request submitted" orbitpm:trigger="dmthub">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="T1" name="مراجعة الطلب" orbitpm:nameEn="Review request" orbitpm:nameAr="مراجعة الطلب"
        orbitpm:owner="HR Ops" orbitpm:respList="Sara Al Marri — Reviewer&#10;Omar"
        orbitpm:inputs="Leave form&#10;Balance report" orbitpm:outputs="Decision memo"
        orbitpm:system="DMT HUB" orbitpm:ccList="Finance — payroll hold&#10;Legal">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="G1" name="Approved?" orbitpm:decisionBasis="HR policy section 7">
      <bpmn:incoming>F2</bpmn:incoming>
    </bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T1" />
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="G1" />
  </bpmn:process>
</bpmn:definitions>`

describe('buildDigest — org-pack enrichment', () => {
  it('reads list attributes (respList/inputs/outputs/system/ccList) into entry arrays', async () => {
    const d = await buildDigest('HR/Leave.bpmn', ENRICHED_XML)
    const task = d?.steps.find((s) => s.id === 'T1')
    expect(task?.respList).toEqual(['Sara Al Marri — Reviewer', 'Omar'])
    expect(task?.inputs).toEqual(['Leave form', 'Balance report'])
    expect(task?.outputs).toEqual(['Decision memo'])
    expect(task?.system).toEqual(['DMT HUB'])
    expect(task?.ccList).toEqual(['Finance — payroll hold', 'Legal'])
  })

  it('reads bilingual names and the gateway decision basis', async () => {
    const d = await buildDigest('HR/Leave.bpmn', ENRICHED_XML)
    const task = d?.steps.find((s) => s.id === 'T1')
    expect(task?.nameEn).toBe('Review request')
    expect(task?.nameAr).toBe('مراجعة الطلب')
    const gw = d?.steps.find((s) => s.id === 'G1')
    expect(gw?.decisionBasis).toBe('HR policy section 7')
  })

  it('reads the process-level owner', async () => {
    const d = await buildDigest('HR/Leave.bpmn', ENRICHED_XML)
    expect(d?.owner).toBe('HR Department')
  })

  it('omits enrichment fields when absent (legacy digests unchanged)', async () => {
    const d = await buildDigest('HR/Employee_Exit.bpmn', EXIT_XML)
    const a = d?.steps.find((s) => s.id === 'Task_A')
    expect(a?.respList).toBeUndefined()
    expect(a?.inputs).toBeUndefined()
    expect(a?.decisionBasis).toBeUndefined()
    expect(d?.owner).toBeUndefined()
  })
})

describe('buildAllDigests', () => {
  it('digests valid files and skips the ones that fail to parse', async () => {
    const digests = await buildAllDigests([
      { relPath: 'HR/Employee_Exit.bpmn', xml: EXIT_XML },
      { relPath: 'broken.bpmn', xml: '<<< nope' }
    ])
    expect(digests).toHaveLength(1)
    expect(digests[0].processName).toBe('Employee Exit')
  })
})
