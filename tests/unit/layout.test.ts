/**
 * Layout smoke: bpmn-auto-layout (pinned 0.4.0) turns our semantic BPMN into a
 * laid-out diagram. Asserts DI is produced (BPMNDiagram/BPMNPlane with shapes
 * and edges) and that every id from the semantic XML survives into the output.
 */
import { describe, it, expect } from 'vitest'
import { generateBpmnXml } from '../../src/gen/xml'
import { layoutBpmn } from '../../src/gen/layout'
import { loadIr, canonicalXml, collectIds } from './helpers'

describe('layoutBpmn (bpmn-auto-layout smoke)', () => {
  it('adds a BPMNDiagram with shapes and edges, preserving all ids', async () => {
    const semantic = generateBpmnXml(loadIr('ex1_professor').process)
    const layouted = await layoutBpmn(semantic)

    expect(layouted).toContain('BPMNDiagram')
    expect(layouted).toContain('BPMNPlane')
    expect(layouted).toContain('BPMNShape')
    expect(layouted).toContain('BPMNEdge')

    // Output is well-formed XML.
    expect(() => canonicalXml(layouted)).not.toThrow()

    // Every id present in the semantic XML (elements, join gateway, flows,
    // definitions_1, Process_1) still appears in the laid-out XML.
    for (const id of collectIds(semantic)) {
      expect(layouted).toContain(id)
    }
    // Spot-check the synthesized join gateway made it through layout.
    expect(layouted).toContain('exclusive1-join')
  })

  it('lays out a parallel gateway diagram', async () => {
    const semantic = generateBpmnXml(loadIr('ex2_parallel').process)
    const layouted = await layoutBpmn(semantic)
    expect(layouted).toContain('BPMNDiagram')
    expect(layouted).toContain('parallel1-join')
    for (const id of collectIds(semantic)) {
      expect(layouted).toContain(id)
    }
  })
})
