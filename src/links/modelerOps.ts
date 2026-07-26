// Minimal structural bpmn-js typings for the one operation this module
// needs — kept narrow (like editor/EditorTab.tsx's own BpmnModelerLike)
// rather than importing bpmn-js's loose `any`-heavy types, and easy to
// mock in tests without constructing a real diagram-js instance.

export interface ElementLike {
  id: string
  type?: string
  businessObject?: { calledElement?: string | null } | null
}

export interface ModelingLike {
  updateProperties(element: ElementLike, properties: Record<string, unknown>): void
}

export interface ElementRegistryLike {
  get(id: string): ElementLike | undefined
}

export interface ModelerForLinkingLike {
  get(name: 'modeling'): ModelingLike
  get(name: 'elementRegistry'): ElementRegistryLike
}

/**
 * Set (or clear, when `processId` is empty) the `calledElement` of a
 * bpmn:CallActivity via bpmn-js's modeling API, so the change is recorded
 * on the command stack (undo/redo, dirty-tracking all work for free).
 * Returns false if the element can't be found in the registry.
 */
export function setCalledElement(
  modeler: ModelerForLinkingLike,
  elementId: string,
  processId: string
): boolean {
  const elementRegistry = modeler.get('elementRegistry')
  const element = elementRegistry.get(elementId)
  if (!element) return false

  const modeling = modeler.get('modeling')
  modeling.updateProperties(element, { calledElement: processId })
  return true
}
