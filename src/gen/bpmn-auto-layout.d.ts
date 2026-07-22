/**
 * Ambient type declaration for `bpmn-auto-layout` (pinned 0.4.0), which ships no
 * types. `layoutProcess` takes semantic BPMN 2.0 XML (no DI) and resolves to the
 * same XML augmented with a BPMNDiagram / DI so bpmn-js `importXML` can render it.
 */
declare module 'bpmn-auto-layout' {
  export function layoutProcess(xml: string): Promise<string>
}
