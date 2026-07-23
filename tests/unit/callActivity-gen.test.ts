/**
 * callActivity element type — validation, transform + XML emission, and layout.
 *
 * A callActivity behaves like a task for sequencing but carries an optional
 * `calledProcess` id, which the emitter renders as a `calledElement` attribute
 * (order: id, name, calledElement, default). Covered here in the node vitest
 * environment (bpmn-auto-layout imported exactly like tests/unit/layout.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { validateBpmn } from '../../src/gen/ir/validate'
import { transform } from '../../src/gen/transform'
import { generateBpmnXml } from '../../src/gen/xml'
import { layoutBpmn } from '../../src/gen/layout'

/* eslint-disable @typescript-eslint/no-explicit-any */
const start = { type: 'startEvent', id: 'start' }
const end = { type: 'endEvent', id: 'end' }

function chainWith(callActivity: Record<string, unknown>): any[] {
  return [start, callActivity, end]
}

describe('callActivity: validation', () => {
  it('accepts a callActivity with a label', () => {
    const process = chainWith({
      type: 'callActivity',
      id: 'ca',
      label: 'Run onboarding',
      calledProcess: 'Process_Onboarding',
      confidence: 'high'
    })
    expect(() => validateBpmn(process)).not.toThrow()
  })

  it('accepts a callActivity with no calledProcess (unlinked, like a task)', () => {
    const process = chainWith({ type: 'callActivity', id: 'ca', label: 'Do work' })
    expect(() => validateBpmn(process)).not.toThrow()
  })

  it('rejects a callActivity without a label (exact error string)', () => {
    const process = chainWith({ type: 'callActivity', id: 'ca' })
    expect(() => validateBpmn(process)).toThrow('CallActivity element is missing a label')
  })

  it('rejects a callActivity whose confidence is not high|low', () => {
    const process = chainWith({
      type: 'callActivity',
      id: 'ca',
      label: 'Do work',
      confidence: 'maybe'
    })
    expect(() => validateBpmn(process)).toThrow('Invalid callActivity element')
  })
})

describe('callActivity: transform + XML emission', () => {
  it('sequences like a task and carries called_element from calledProcess', () => {
    const process = chainWith({
      type: 'callActivity',
      id: 'ca',
      label: 'Run onboarding',
      calledProcess: 'Process_Onboarding'
    })
    const { elements, flows } = transform(process)

    const ca = elements.find((e) => e.id === 'ca')
    expect(ca?.type).toBe('callActivity')
    expect(ca?.called_element).toBe('Process_Onboarding')
    // wired start -> ca -> end, exactly like a task
    expect(flows.some((f) => f.sourceRef === 'start' && f.targetRef === 'ca')).toBe(true)
    expect(flows.some((f) => f.sourceRef === 'ca' && f.targetRef === 'end')).toBe(true)
  })

  it('emits <callActivity id=".." name=".." calledElement=".."> (attr order id, name, calledElement)', () => {
    const process = chainWith({
      type: 'callActivity',
      id: 'ca',
      label: 'Run onboarding',
      calledProcess: 'Process_Onboarding'
    })
    const xml = generateBpmnXml(process)
    expect(xml).toContain('<callActivity id="ca" name="Run onboarding" calledElement="Process_Onboarding">')
  })

  it('omits calledElement when calledProcess is absent', () => {
    const xml = generateBpmnXml(chainWith({ type: 'callActivity', id: 'ca', label: 'Do work' }))
    expect(xml).toContain('<callActivity id="ca" name="Do work">')
    expect(xml).not.toContain('calledElement')
  })

  it('omits calledElement when calledProcess is null', () => {
    const xml = generateBpmnXml(
      chainWith({ type: 'callActivity', id: 'ca', label: 'Do work', calledProcess: null })
    )
    expect(xml).not.toContain('calledElement')
  })

  it('omits calledElement when calledProcess is the empty string', () => {
    const xml = generateBpmnXml(
      chainWith({ type: 'callActivity', id: 'ca', label: 'Do work', calledProcess: '' })
    )
    expect(xml).not.toContain('calledElement')
  })

  it('escapes the calledElement attribute value', () => {
    const xml = generateBpmnXml(
      chainWith({ type: 'callActivity', id: 'ca', label: 'X', calledProcess: 'a"&<b' })
    )
    expect(xml).toContain('calledElement="a&quot;&amp;&lt;b"')
  })
})

describe('callActivity: layout', () => {
  it('produces a BPMNShape referencing the callActivity id', async () => {
    const semantic = generateBpmnXml(
      chainWith({
        type: 'callActivity',
        id: 'ca',
        label: 'Run onboarding',
        calledProcess: 'Process_Onboarding'
      })
    )
    const layouted = await layoutBpmn(semantic)
    expect(layouted).toContain('BPMNShape')
    expect(layouted).toMatch(/BPMNShape[^>]*bpmnElement="ca"/)
  })
})
