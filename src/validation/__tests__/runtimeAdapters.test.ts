import { describe, expect, it } from 'vitest'
import { validMultiProcessXml } from './fixtures'
import { validateBpmnXml } from '../model'
import {
  getRuntimeValidationAdapters,
  validateBpmnXsd,
  validateWithBpmnlint
} from '../runtimeAdapters'

const DEFINITIONS = `xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_runtime" targetNamespace="urn:orbitpm:runtime-test"`

describe('runtime BPMN validators', () => {
  it('uses the OMG XSD graph to reject schema-invalid, well-formed BPMN', async () => {
    const xml = `<bpmn:definitions ${DEFINITIONS}>
      <bpmn:process id="Process_1" illegalAttribute="not-in-the-schema">
        <bpmn:startEvent id="Start_1" />
      </bpmn:process>
    </bpmn:definitions>`

    const diagnostics = await validateBpmnXsd(xml)

    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics.some((issue) => issue.message.includes('illegalAttribute'))).toBe(true)
    expect(diagnostics[0]?.line).toBeGreaterThan(0)
  })

  it('accepts extension attributes from a foreign namespace', async () => {
    const xml = `<bpmn:definitions ${DEFINITIONS}
      xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0">
      <bpmn:process id="Process_1" orbitpm:nameEn="Process" orbitpm:nameAr="عملية">
        <bpmn:startEvent id="Start_1" />
      </bpmn:process>
    </bpmn:definitions>`

    await expect(validateBpmnXsd(xml)).resolves.toEqual([])
  })

  it('runs real recommended bpmnlint rules and retains element IDs', async () => {
    const xml = `<bpmn:definitions ${DEFINITIONS}>
      <bpmn:process id="Process_1">
        <bpmn:startEvent id="Start_1" />
        <bpmn:task id="Unlabelled_task" />
      </bpmn:process>
    </bpmn:definitions>`

    const diagnostics = await validateWithBpmnlint(xml)

    expect(diagnostics.some((issue) => issue.rule === 'end-event-required')).toBe(true)
    expect(
      diagnostics.some(
        (issue) => issue.rule === 'label-required' && issue.elementId === 'Unlabelled_task'
      )
    ).toBe(true)
    expect(diagnostics.some((issue) => issue.rule === 'no-bpmndi')).toBe(true)

    const preLayoutDiagnostics = await validateWithBpmnlint(xml, { requireDi: false })
    expect(preLayoutDiagnostics.some((issue) => issue.rule === 'no-bpmndi')).toBe(false)
    expect(preLayoutDiagnostics.some((issue) => issue.rule === 'end-event-required')).toBe(true)
  })

  it('provides both durable adapters in release order', () => {
    expect(getRuntimeValidationAdapters().map((adapter) => adapter.source)).toEqual([
      'xsd',
      'bpmnlint'
    ])
  })

  it('runs both release adapters through the durable validation pipeline', async () => {
    const result = await validateBpmnXml(validMultiProcessXml(), {
      adapters: getRuntimeValidationAdapters(),
      requireDi: true,
      requireBilingual: true
    })

    expect(result.summary.stages.xsd).toBe('passed')
    expect(result.summary.stages.bpmnlint).toBe('passed')
    expect(result.summary.blockingErrors).toBe(0)
  })
})
