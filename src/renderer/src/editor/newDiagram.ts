// Minimal valid BPMN 2.0 template for a brand-new, empty diagram tab.
//
// Includes BPMNDI (unlike the AI-generation pipeline's raw output in
// src/gen, which is laid out separately via bpmn-auto-layout) so the canvas
// never opens empty/unrenderable for a hand-drawn "New Diagram".

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Builds a fresh template XML with a newly randomized process/element ids. */
export function createNewDiagramXml(): string {
  const processId = `proc_${randomSuffix()}`
  const startEventId = `StartEvent_${randomSuffix()}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
  id="definitions_1"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="${processId}" isExecutable="false">
    <bpmn2:startEvent id="${startEventId}" name="Start" />
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="${startEventId}_di" bpmnElement="${startEventId}">
        <omgdc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn2:definitions>
`
}

/**
 * Named export requested by the editor spec. A plain string constant would
 * not be "unique" (every new tab needs its own process id, or duplicate
 * process ids collide during workspace indexing) so this is a factory
 * function under the requested name rather than a static template literal —
 * call it once per new diagram tab.
 */
export const NEW_DIAGRAM_XML = createNewDiagramXml
