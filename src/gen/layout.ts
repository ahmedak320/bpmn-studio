/**
 * Thin wrapper over bpmn-auto-layout's `layoutProcess` (pinned 0.4.0, the
 * vendored-proven version). Takes semantic BPMN XML (no DI) and returns the same
 * XML with a laid-out BPMNDiagram / DI added, ready for bpmn-js `importXML`.
 */
import { layoutProcess } from 'bpmn-auto-layout'

/** Add auto-layout DI to semantic BPMN XML. */
export async function layoutBpmn(semanticXml: string): Promise<string> {
  return await layoutProcess(semanticXml)
}
