import { describe, expect, it } from 'vitest'
import { createBpmnlintValidationAdapter, createXsdValidationAdapter, validateBpmnXml } from '..'
import { validGatewayXml, validMultiProcessXml } from './fixtures'

describe('layered BPMN validation', () => {
  it('validates every process, diagram and plane in a multi-root document', async () => {
    const result = await validateBpmnXml(validMultiProcessXml(), {
      requireBilingual: true,
      requireDi: true
    })
    expect(result.summary.valid).toBe(true)
    expect(result.summary.stats).toMatchObject({
      processes: 2,
      diagrams: 2,
      planes: 2
    })
    expect(result.summary.stages).toMatchObject({
      preflight: 'passed',
      moddle: 'passed',
      structure: 'passed',
      semantic: 'passed',
      di: 'passed',
      orbitpm: 'passed'
    })
  })

  it('does not stop validation after the first valid process or plane', async () => {
    const broken = validMultiProcessXml()
      .replace('sourceRef="Start_2"', 'sourceRef="Missing_2"')
      .replace(
        'width="36" height="36" />\n      </bpmndi:BPMNShape>\n      <bpmndi:BPMNEdge id="Edge_2"',
        'width="0" height="36" />\n      </bpmndi:BPMNShape>\n      <bpmndi:BPMNEdge id="Edge_2"'
      )
    const result = await validateBpmnXml(broken, { requireDi: true })
    expect(result.summary.valid).toBe(false)
    expect(result.summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'moddle.unresolved-reference' }),
        expect.objectContaining({
          code: 'di.shape-bounds',
          diagramId: 'Diagram_2',
          planeId: 'Plane_2'
        })
      ])
    )
  })

  it('validates lane references and collaboration-plane coverage across participants', async () => {
    const base = validMultiProcessXml()
    const collaborationXml = base
      .replace(
        '<bpmn:startEvent id="Start_1"',
        '<bpmn:laneSet id="LaneSet_1"><bpmn:lane id="Lane_1"><bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>\n    <bpmn:startEvent id="Start_1"'
      )
      .replace(
        '<bpmndi:BPMNDiagram id="Diagram_1">',
        '<bpmn:collaboration id="Collaboration_1"><bpmn:participant id="Participant_1" processRef="Process_1"/><bpmn:participant id="Participant_2" processRef="Process_2"/></bpmn:collaboration>\n  <bpmndi:BPMNDiagram id="Diagram_1">'
      )
      .replace('bpmnElement="Process_1"', 'bpmnElement="Collaboration_1"')
      .replace(
        '<bpmndi:BPMNShape id="Shape_Start_1"',
        '<bpmndi:BPMNShape id="Shape_Participant_1" bpmnElement="Participant_1"><dc:Bounds x="50" y="50" width="600" height="200"/></bpmndi:BPMNShape>\n      <bpmndi:BPMNShape id="Shape_Start_1"'
      )
      .replace(
        '<bpmndi:BPMNShape id="Shape_Start_2"',
        '<bpmndi:BPMNShape id="Shape_Participant_2" bpmnElement="Participant_2"><dc:Bounds x="50" y="250" width="600" height="200"/></bpmndi:BPMNShape>\n      <bpmndi:BPMNShape id="Shape_Start_2"'
      )
      // One collaboration plane covers both participant processes; remove the
      // redundant second process plane and move its shapes into the first.
      .replace(
        /<\/bpmndi:BPMNPlane>\s*<\/bpmndi:BPMNDiagram>\s*<bpmndi:BPMNDiagram id="Diagram_2">\s*<bpmndi:BPMNPlane id="Plane_2" bpmnElement="Process_2">/,
        ''
      )

    const valid = await validateBpmnXml(collaborationXml, { requireDi: true })
    expect(valid.summary.valid).toBe(true)
    expect(valid.summary.stats).toMatchObject({
      processes: 2,
      collaborations: 1,
      diagrams: 1,
      planes: 1
    })

    const crossProcessLane = collaborationXml.replace(
      '<bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>',
      '<bpmn:flowNodeRef>Start_2</bpmn:flowNodeRef>'
    )
    expect((await validateBpmnXml(crossProcessLane)).summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'structure.lane-node-ref',
          processId: 'Process_1',
          elementId: 'Lane_1'
        })
      ])
    )
  })

  it('normalizes moddle warnings and parser errors', async () => {
    const unresolved = validGatewayXml().replace('targetRef="Approve"', 'targetRef="Missing"')
    const warning = await validateBpmnXml(unresolved)
    expect(warning.summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'moddle.unresolved-reference',
          source: 'moddle',
          blocking: true
        })
      ])
    )

    const malformed = await validateBpmnXml(
      '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process></definitions>'
    )
    expect(malformed.summary.xmlWellFormed).toBe(false)
    expect(malformed.summary.issues[0]).toMatchObject({
      code: 'moddle.parse-error',
      severity: 'error'
    })
  })

  it('enforces default and formal conditional-flow semantics', async () => {
    expect((await validateBpmnXml(validGatewayXml())).summary.valid).toBe(true)

    const defaultWithCondition = validGatewayXml().replace(
      '<bpmn:sequenceFlow id="Flow_default" sourceRef="Decision" targetRef="Reject" />',
      '<bpmn:sequenceFlow id="Flow_default" sourceRef="Decision" targetRef="Reject"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">otherwise</bpmn:conditionExpression></bpmn:sequenceFlow>'
    )
    expect((await validateBpmnXml(defaultWithCondition)).summary.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'semantic.default-has-condition' })])
    )

    const missingCondition = validGatewayXml().replace(
      '<bpmn:sequenceFlow id="Flow_yes" sourceRef="Decision" targetRef="Approve" name="Approved">\n      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">approved = true</bpmn:conditionExpression>\n    </bpmn:sequenceFlow>',
      '<bpmn:sequenceFlow id="Flow_yes" sourceRef="Decision" targetRef="Approve" />'
    )
    expect((await validateBpmnXml(missingCondition)).summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'semantic.branch-condition-missing' })
      ])
    )
  })

  it('promotes missing DI only when a normalized/generated result requires it', async () => {
    const preview = await validateBpmnXml(validGatewayXml())
    expect(preview.summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'di.process-missing',
          severity: 'warning',
          blocking: false
        })
      ])
    )
    const normalized = await validateBpmnXml(validGatewayXml(), { requireDi: true })
    expect(normalized.summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'di.process-missing',
          severity: 'error',
          blocking: true
        })
      ])
    )
  })

  it('checks OrbitPM script, duplicate-counterpart and visible projection rules', async () => {
    const wrong = validMultiProcessXml()
      .replace('orbitpm:nameAr="بداية"', 'orbitpm:nameAr="Start"')
      .replace(
        'name="End"\n      orbitpm:nameEn="End"',
        'name="Wrong projection"\n      orbitpm:nameEn="End"'
      )
    const result = await validateBpmnXml(wrong, { requireBilingual: true })
    expect(result.summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'orbitpm.bilingual-wrong-script-ar' }),
        expect.objectContaining({ code: 'orbitpm.bilingual-duplicate-counterpart' }),
        expect.objectContaining({ code: 'orbitpm.active-projection-mismatch' })
      ])
    )
  })

  it('resolves call activities against every local and explicitly known workspace process', async () => {
    const call = validGatewayXml()
      .replace(
        '<bpmn:task id="Approve">',
        '<bpmn:callActivity id="Approve" calledElement="Process_external">'
      )
      .replace(
        '</bpmn:task>\n    <bpmn:task id="Reject">',
        '</bpmn:callActivity>\n    <bpmn:task id="Reject">'
      )
    expect((await validateBpmnXml(call)).summary.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'orbitpm.call-unresolved' })])
    )
    expect(
      (await validateBpmnXml(call, { knownProcessIds: ['Process_external'] })).summary.issues
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'orbitpm.call-unresolved' })])
    )
  })

  it('isolates worker XSD and bpmnlint adapters behind normalized contracts', async () => {
    const xsd = createXsdValidationAdapter(() => [
      { message: 'Schema mismatch', line: 2, column: 4, code: 'cvc-complex' }
    ])
    const lint = createBpmnlintValidationAdapter(() => [
      {
        category: 'warn',
        message: 'Prefer an end event',
        rule: 'end-event-required',
        elementId: 'Process_gateway'
      }
    ])
    const result = await validateBpmnXml(validGatewayXml(), { adapters: [xsd, lint] })
    expect(result.summary.stages).toMatchObject({ xsd: 'failed', bpmnlint: 'passed' })
    expect(result.summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'xsd.cvc-complex',
          location: { line: 2, column: 4 }
        }),
        expect.objectContaining({
          code: 'bpmnlint.end-event-required',
          severity: 'warning',
          ruleId: 'end-event-required'
        })
      ])
    )
  })
})
