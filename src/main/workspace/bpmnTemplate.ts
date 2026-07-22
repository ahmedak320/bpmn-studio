// Minimal empty BPMN 2.0 XML template used when creating a new process file
// from the folder tree's "New process" action. Semantic-only (no BPMNDI) —
// bpmn-js's Modeler will lay out a bare canvas with a single start event on
// import, matching the shape the AI generation pipeline (src/gen) emits.

export function emptyBpmnXml(processId: string, processName: string): string {
  const startId = `StartEvent_1`
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="definitions_1"
  targetNamespace="http://orbitpm.local/bpmn">
  <bpmn2:process id="${processId}" name="${escapeXml(processName)}" isExecutable="false">
    <bpmn2:startEvent id="${startId}" name="Start" />
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="${startId}_di" bpmnElement="${startId}">
        <dc:Bounds x="150" y="150" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn2:definitions>
`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
