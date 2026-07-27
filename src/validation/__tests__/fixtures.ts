const NS = [
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
  'xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  'xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"'
].join(' ')

function process(index: number): string {
  return `<bpmn:process id="Process_${index}" name="Process ${index}" isExecutable="false"
    orbitpm:activeLang="en" orbitpm:nameEn="Process ${index}" orbitpm:nameAr="العملية ${index}">
    <bpmn:startEvent id="Start_${index}" name="Start"
      orbitpm:nameEn="Start" orbitpm:nameAr="بداية">
      <bpmn:outgoing>Flow_${index}</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="End_${index}" name="End"
      orbitpm:nameEn="End" orbitpm:nameAr="نهاية">
      <bpmn:incoming>Flow_${index}</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_${index}" sourceRef="Start_${index}" targetRef="End_${index}" />
  </bpmn:process>`
}

function diagram(index: number): string {
  return `<bpmndi:BPMNDiagram id="Diagram_${index}">
    <bpmndi:BPMNPlane id="Plane_${index}" bpmnElement="Process_${index}">
      <bpmndi:BPMNShape id="Shape_Start_${index}" bpmnElement="Start_${index}">
        <dc:Bounds x="100" y="${index * 100}" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_End_${index}" bpmnElement="End_${index}">
        <dc:Bounds x="300" y="${index * 100}" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_${index}" bpmnElement="Flow_${index}">
        <di:waypoint x="136" y="${index * 100 + 18}" />
        <di:waypoint x="300" y="${index * 100 + 18}" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`
}

export function validMultiProcessXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_multi" targetNamespace="https://orbitpm.ae/bpmn/multi">
  ${process(1)}
  ${process(2)}
  ${diagram(1)}
  ${diagram(2)}
</bpmn:definitions>`
}

export function validGatewayXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_gateway" targetNamespace="https://orbitpm.ae/bpmn/gateway">
  <bpmn:process id="Process_gateway" isExecutable="false">
    <bpmn:startEvent id="Start"><bpmn:outgoing>Flow_start</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Decision" default="Flow_default">
      <bpmn:incoming>Flow_start</bpmn:incoming>
      <bpmn:outgoing>Flow_yes</bpmn:outgoing>
      <bpmn:outgoing>Flow_default</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Approve"><bpmn:incoming>Flow_yes</bpmn:incoming><bpmn:outgoing>Flow_approve_end</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Reject"><bpmn:incoming>Flow_default</bpmn:incoming><bpmn:outgoing>Flow_reject_end</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End"><bpmn:incoming>Flow_approve_end</bpmn:incoming><bpmn:incoming>Flow_reject_end</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start" targetRef="Decision" />
    <bpmn:sequenceFlow id="Flow_yes" sourceRef="Decision" targetRef="Approve" name="Approved">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">approved = true</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_default" sourceRef="Decision" targetRef="Reject" />
    <bpmn:sequenceFlow id="Flow_approve_end" sourceRef="Approve" targetRef="End" />
    <bpmn:sequenceFlow id="Flow_reject_end" sourceRef="Reject" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`
}

export const UNKNOWN_EXTENSION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:foo="urn:example:opaque" xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  id="Definitions_extensions" targetNamespace="urn:orbitpm:extensions">
  <bpmn:process id="Process_extensions" foo:checksum="abc123">
    <bpmn:extensionElements>
      <foo:payload foo:key="value"><foo:nested foo:version="2">opaque text</foo:nested></foo:payload>
    </bpmn:extensionElements>
    <bpmn:startEvent id="Start" />
  </bpmn:process>
</bpmn:definitions>`
