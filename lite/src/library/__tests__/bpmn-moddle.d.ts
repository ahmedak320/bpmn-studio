// bpmn-moddle ships no TypeScript types; this minimal shim covers the slice
// the AML-import tests use to prove the emitted BPMN (incl. hand-built DI)
// parses cleanly with bpmn-js's own importer core.
declare module 'bpmn-moddle' {
  export interface ModdleImportResult {
    // The moddle element tree is untyped here on purpose — tests only poke a
    // few well-known properties ($type, diagrams, plane, …).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rootElement: any
    warnings: { message: string }[]
  }
  export default class BpmnModdle {
    constructor(packages?: Record<string, unknown>)
    fromXML(xml: string): Promise<ModdleImportResult>
  }
}
