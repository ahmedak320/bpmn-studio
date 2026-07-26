import { validationIssue, type ValidationIssue } from './contracts'

export interface ExternalValidationContext {
  /** IDs of processes intentionally resolved by the current workspace. */
  knownProcessIds: ReadonlySet<string>
}

export interface BpmnValidationAdapter {
  readonly source: 'xsd' | 'bpmnlint'
  validate(xml: string, context: ExternalValidationContext): Promise<readonly ValidationIssue[]>
}

export interface XsdDiagnostic {
  message: string
  line?: number
  column?: number
  code?: string
}

export type XsdValidatorFunction = (
  xml: string
) => Promise<readonly XsdDiagnostic[]> | readonly XsdDiagnostic[]

/**
 * Adapter seam for a worker-hosted BPMN 2.0 XSD engine.
 *
 * No XML engine is bundled here: consumers inject the worker call, keeping the
 * validation contract independent of WASM/library choice and ensuring XSD work
 * cannot block the UI thread.
 */
export function createXsdValidationAdapter(validate: XsdValidatorFunction): BpmnValidationAdapter {
  return {
    source: 'xsd',
    async validate(xml) {
      const diagnostics = await validate(xml)
      return diagnostics.map((diagnostic) =>
        validationIssue({
          code: diagnostic.code ? `xsd.${diagnostic.code}` : 'xsd.invalid',
          severity: 'error',
          source: 'xsd',
          message: diagnostic.message,
          location:
            diagnostic.line !== undefined
              ? {
                  line: Math.max(1, diagnostic.line),
                  column: Math.max(1, diagnostic.column ?? 1)
                }
              : undefined,
          suggestedRepair: 'Repair the BPMN structure reported by the BPMN 2.0 schema validator.'
        })
      )
    }
  }
}

export interface BpmnlintDiagnostic {
  category?: 'error' | 'warn' | 'info'
  message: string
  rule?: string
  elementId?: string
}

export type BpmnlintFunction = (
  xml: string
) => Promise<readonly BpmnlintDiagnostic[]> | readonly BpmnlintDiagnostic[]

/** Adapter seam for a worker-hosted `bpmnlint`/`bpmn-js-bpmnlint` runner. */
export function createBpmnlintValidationAdapter(
  lint: BpmnlintFunction
): BpmnValidationAdapter {
  return {
    source: 'bpmnlint',
    async validate(xml) {
      const diagnostics = await lint(xml)
      return diagnostics.map((diagnostic) => {
        const severity =
          diagnostic.category === 'warn'
            ? ('warning' as const)
            : diagnostic.category === 'info'
              ? ('info' as const)
              : ('error' as const)
        return validationIssue({
          code: diagnostic.rule ? `bpmnlint.${diagnostic.rule}` : 'bpmnlint.issue',
          severity,
          source: 'bpmnlint',
          message: diagnostic.message,
          blocking: severity === 'error',
          elementId: diagnostic.elementId,
          ruleId: diagnostic.rule
        })
      })
    }
  }
}
