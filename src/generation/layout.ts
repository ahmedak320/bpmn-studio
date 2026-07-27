import { layoutProcess } from 'bpmn-auto-layout'
import {
  canCreateGenerated,
  validateBpmnXml,
  type BpmnValidationOptions,
  type ValidationSummary
} from '../validation'

export type LayoutFunction = (semanticXml: string) => Promise<string>

export interface LayoutBpmnOptions {
  validation?: Omit<BpmnValidationOptions, 'requireDi'>
  /** Test/alternate-layout injection; production uses pinned bpmn-auto-layout. */
  layout?: LayoutFunction
}

export interface ValidatedLayoutResult {
  xml: string
  preLayoutValidation: ValidationSummary
  postLayoutValidation: ValidationSummary
}

export class BpmnLayoutValidationError extends Error {
  readonly stage: 'pre-layout' | 'post-layout'
  readonly summary: ValidationSummary

  constructor(stage: 'pre-layout' | 'post-layout', summary: ValidationSummary) {
    const codes = summary.issues
      .filter((issue) => issue.blocking)
      .slice(0, 5)
      .map((issue) => issue.code)
      .join(', ')
    super(`BPMN ${stage} validation failed${codes ? `: ${codes}` : ''}`)
    this.name = 'BpmnLayoutValidationError'
    this.stage = stage
    this.summary = summary
  }
}

/**
 * Validate semantic BPMN, add DI, then validate the exact layout output.
 *
 * Missing DI is a non-blocking preview warning before layout and a blocking
 * error afterwards, so layout can never hide or replace a semantic failure.
 */
export async function layoutBpmnValidated(
  semanticXml: string,
  options: LayoutBpmnOptions = {}
): Promise<ValidatedLayoutResult> {
  const pre = await validateBpmnXml(semanticXml, {
    ...options.validation,
    requireDi: false
  })
  if (!canCreateGenerated(pre.summary)) {
    throw new BpmnLayoutValidationError('pre-layout', pre.summary)
  }

  const runLayout = options.layout ?? (async (xml: string) => await layoutProcess(xml))
  const xml = await runLayout(semanticXml)
  const post = await validateBpmnXml(xml, {
    ...options.validation,
    requireDi: true
  })
  if (!canCreateGenerated(post.summary)) {
    throw new BpmnLayoutValidationError('post-layout', post.summary)
  }
  return {
    xml,
    preLayoutValidation: pre.summary,
    postLayoutValidation: post.summary
  }
}

/** Backward-compatible XML-only wrapper around the validated layout pipeline. */
export async function layoutBpmn(
  semanticXml: string,
  options?: LayoutBpmnOptions
): Promise<string> {
  return (await layoutBpmnValidated(semanticXml, options)).xml
}
