/**
 * Structural assertions on the transformer port: the ID conventions, has_join
 * synthesis, parallel always-join, inclusive default->default_flow, loop-back
 * `next` jumps, and the fixed XML shell (definitions_1 / Process_1 / isExecutable).
 */
import { describe, it, expect } from 'vitest'
import { transform } from '../../src/gen/transform'
import { generateBpmnXml } from '../../src/gen/xml'
import { validateBpmn } from '../../src/gen/ir/validate'
import { loadIr } from './helpers'

describe('transformer: ID conventions and structure', () => {
  it('exclusive has_join synthesizes a `{gid}-join` converging gateway', () => {
    const { elements, flows } = transform(loadIr('ex1_professor').process)
    const join = elements.find((e) => e.id === 'exclusive1-join')
    expect(join).toBeDefined()
    expect(join?.type).toBe('exclusiveGateway')
    expect(join?.label).toBeNull()
    // join flows onward to the element after the gateway
    expect(flows.some((f) => f.id === 'exclusive1-join-end1')).toBe(true)
  })

  it('WITHOUT has_join, branches flow straight to the next element (no join gateway)', () => {
    const { elements } = transform(loadIr('ex3_exam_loop').process)
    expect(elements.some((e) => e.id.endsWith('-join'))).toBe(false)
  })

  it('flow ids follow `{sourceRef}-{targetRef}`', () => {
    const { flows } = transform(loadIr('ex1_professor').process)
    expect(flows.some((f) => f.id === 'start-task1' && f.sourceRef === 'start' && f.targetRef === 'task1')).toBe(true)
    expect(flows.some((f) => f.id === 'task2-exclusive1')).toBe(true)
  })

  it('parallel gateway ALWAYS synthesizes a join and wires both branch ends into it', () => {
    const { elements, flows } = transform(loadIr('ex2_parallel').process)
    const join = elements.find((e) => e.id === 'parallel1-join')
    expect(join?.type).toBe('parallelGateway')
    expect(flows.some((f) => f.sourceRef === 'task2' && f.targetRef === 'parallel1-join')).toBe(true)
    expect(flows.some((f) => f.sourceRef === 'task4' && f.targetRef === 'parallel1-join')).toBe(true)
    // element order: split gateway, THEN its join, THEN branch elements
    const ids = elements.map((e) => e.id)
    expect(ids.indexOf('parallel1')).toBeLessThan(ids.indexOf('parallel1-join'))
    expect(ids.indexOf('parallel1-join')).toBeLessThan(ids.indexOf('task1'))
  })

  it('inclusive default branch sets default_flow -> `default=` attr on the gateway', () => {
    const { elements } = transform(loadIr('inclusive_default').process)
    const ig = elements.find((e) => e.id === 'ig')
    expect(ig?.default_flow).toBe('ig-water')
    // the default flow itself carries no condition label
    const xml = generateBpmnXml(loadIr('inclusive_default').process)
    expect(xml).toContain('<inclusiveGateway id="ig" name="Which courses to prepare?" default="ig-water">')
    expect(xml).toContain('<sequenceFlow id="ig-water" sourceRef="ig" targetRef="water" />')
  })

  it('branch `next` on a NON-empty branch loops back to the named element', () => {
    const { flows } = transform(loadIr('loopback_next').process)
    // "Needs changes" branch ends at `revise` and jumps back to `review`
    expect(flows.some((f) => f.sourceRef === 'revise' && f.targetRef === 'review')).toBe(true)
  })

  it('branch `next` on an EMPTY branch flows the gateway straight to the target', () => {
    const { flows } = transform(loadIr('ex3_exam_loop').process)
    // "No" branch: empty path, next=task1 -> gateway eg flows back to task1
    expect(flows.some((f) => f.sourceRef === 'eg' && f.targetRef === 'task1' && f.condition === 'No')).toBe(true)
  })

  it('emits the fixed BPMN shell: definitions_1 / Process_1 / isExecutable="false"', () => {
    const xml = generateBpmnXml(loadIr('ex5_task_types').process)
    expect(xml).toContain('id="definitions_1"')
    expect(xml).toContain('<process id="Process_1" isExecutable="false">')
    expect(xml).not.toContain('BPMNDiagram') // semantic only, no DI
  })

  it('preserves eventDefinition and emits `<xxxEventDefinition id="xxx_<id>"/>`', () => {
    const xml = generateBpmnXml(loadIr('ex6_events').process)
    expect(xml).toContain('<timerEventDefinition id="timerEventDefinition_start" />')
    expect(xml).toContain('<messageEventDefinition id="messageEventDefinition_message1" />')
  })

  it('every parity fixture is accepted by validateBpmn', () => {
    const valid = [
      'ex1_professor',
      'ex2_parallel',
      'ex3_exam_loop',
      'ex4_nested_exclusive',
      'ex5_task_types',
      'ex6_events',
      'ex7_order_two_ends',
      'inclusive_default',
      'loopback_next',
      'nasty_labels',
      'dedup_flow'
    ]
    for (const name of valid) {
      expect(() => validateBpmn(loadIr(name).process)).not.toThrow()
    }
  })
})
