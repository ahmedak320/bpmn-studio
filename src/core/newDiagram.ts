// Deterministic BPMN 2.0 file template used by the retained workspace
// "create a process file" path (`src/core/newProcessDoc.ts` ->
// `src/workspace/importTransaction.ts`, `src/ai/placementOutcome.ts`).
//
// The interactive "New diagram" editor tab this once also served was removed
// with the BPMN UI (plan §5.3), so only the named/deterministic factory below
// survives. Includes BPMNDI so a written file is renderable by any consumer.

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface NamedDiagramOptions {
  /** The `bpmn:process` id — the stable target a call activity's
   *  `calledElement` points at, so it must be caller-controlled (not random). */
  processId: string
  /** Human-readable name stored as the `bpmn:process` `name` attribute. */
  name: string
}

/**
 * Build a BPMN 2.0 file with a caller-supplied, deterministic
 * `<process id>` and a `name` attribute. Used by the "new process file" flow so the
 * created file is a stable, linkable call-activity target (the id derives from
 * the file slug) and carries the display name the user entered. The start-event
 * id is still randomized so two freshly-created diagrams never collide on it.
 */
export function createNamedDiagramXml({ processId, name }: NamedDiagramOptions): string {
  const startEventId = `StartEvent_${randomSuffix()}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
  id="definitions_1"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="${escapeXmlAttr(processId)}" name="${escapeXmlAttr(name)}" isExecutable="false">
    <bpmn2:startEvent id="${startEventId}" name="Start" />
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${escapeXmlAttr(processId)}">
      <bpmndi:BPMNShape id="${startEventId}_di" bpmnElement="${startEventId}">
        <omgdc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn2:definitions>
`
}
