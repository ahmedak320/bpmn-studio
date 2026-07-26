import BpmnModdle from 'bpmn-moddle'
import { Linter } from 'bpmnlint'
import { orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import {
  createBpmnlintValidationAdapter,
  createXsdValidationAdapter,
  type BpmnlintDiagnostic,
  type BpmnValidationAdapter,
  type ExternalValidationContext
} from './adapters'
import { recommendedBpmnlintBundle } from './bpmnlintBundle'
import { validateBpmnXsd } from './xsdRuntime'

interface ModdleImportResult {
  rootElement?: unknown
}

interface BpmnModdleLike {
  fromXML(xml: string): Promise<ModdleImportResult>
}

interface LintReport {
  id?: string
  message?: string
  category?: 'error' | 'warn' | 'info' | 'rule-error'
}

type LintResults = Record<string, readonly LintReport[]>

interface BpmnlinterLike {
  lint(root: unknown): Promise<LintResults>
}

/**
 * Run the official recommended bpmnlint rules against a moddle document.
 *
 * This is intentionally independent of the bpmn-js UI plug-in. The same
 * packed rule bundle powers visual canvas markers and this durable report.
 */
export async function validateWithBpmnlint(
  xml: string,
  context: Pick<ExternalValidationContext, 'requireDi'> = { requireDi: true }
): Promise<readonly BpmnlintDiagnostic[]> {
  const moddle = new BpmnModdle({
    orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
  }) as unknown as BpmnModdleLike
  const { rootElement } = await moddle.fromXML(xml)
  if (!rootElement) throw new Error('bpmn-moddle returned no definitions for bpmnlint.')

  const linter = new Linter({
    config: recommendedBpmnlintBundle.config,
    resolver: recommendedBpmnlintBundle.resolver
  }) as unknown as BpmnlinterLike
  const results = await linter.lint(rootElement)

  return Object.entries(results).flatMap(([rule, reports]) =>
    !context.requireDi && rule === 'no-bpmndi'
      ? []
      : reports.map((report) => ({
          category:
            report.category === 'warn'
              ? ('warn' as const)
              : report.category === 'info'
                ? ('info' as const)
                : ('error' as const),
          message: report.message?.trim() || `BPMN lint rule "${rule}" failed.`,
          rule,
          elementId: report.id
        }))
  )
}

let adapters: readonly BpmnValidationAdapter[] | undefined

/**
 * Shared release adapters. xmllint-wasm's browser entry performs the expensive
 * libxml2 work in its own module Worker; bpmnlint uses the statically bundled
 * official rules and never resolves code at runtime.
 */
export function getRuntimeValidationAdapters(): readonly BpmnValidationAdapter[] {
  adapters ??= Object.freeze([
    createXsdValidationAdapter(validateBpmnXsd),
    createBpmnlintValidationAdapter(validateWithBpmnlint)
  ])
  return adapters
}

export { validateBpmnXsd } from './xsdRuntime'
