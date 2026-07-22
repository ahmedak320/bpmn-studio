/**
 * Barrel for the generation pipeline (IR -> semantic BPMN -> laid-out BPMN).
 * Main-process / AI-integration code (later waves) imports from here.
 */
export * from './ir/schema'
export { validateBpmn, validateElement, processHasEndEvent } from './ir/validate'
export {
  transform,
  BpmnProcessTransformer,
  type TransformResult,
  type TransformedElement,
  type TransformedFlow
} from './transform'
export { generateBpmnXml, BpmnXmlGenerator } from './xml'
export { layoutBpmn } from './layout'
export { parseJsonLoose } from './parse'
export {
  BPMN_REPRESENTATION,
  BPMN_EXAMPLES,
  composeCreateBpmn,
  messageHistoryToString,
  type LlmMessage
} from './prompts'
export {
  generateFromDescription,
  type CallLLM,
  type GenerateResult,
  type GenerateOptions
} from './generate'
