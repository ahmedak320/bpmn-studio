/**
 * Layout smoke: bpmn-auto-layout (pinned 0.4.0) turns our semantic BPMN into a
 * laid-out diagram. Asserts DI is produced (BPMNDiagram/BPMNPlane with shapes
 * and edges) and that every id from the semantic XML survives into the output.
 * Also proves the layouter PRESERVES the foreign `orbitpm:*` attributes (via
 * bpmn-moddle's $attrs round-trip) — the pipeline relies on this instead of a
 * post-layout re-application step.
 */
import { describe, it, expect } from 'vitest'
import { generateBpmnXml } from '../../src/gen/xml'
import { layoutBpmn } from '../../src/gen/layout'
import { loadIr, canonicalXml, collectIds, bilingualOrgIr } from './helpers'

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

  it('preserves every orbitpm attribute (elements, flows, process, xmlns) through layout', async () => {
    const semantic = generateBpmnXml(bilingualOrgIr())
    const layouted = await layoutBpmn(semantic)

    // DI added and output still importable/well-formed.
    expect(layouted).toContain('BPMNDiagram')
    expect(() => canonicalXml(layouted)).not.toThrow()

    // Namespace declaration + process language survive.
    expect(layouted).toContain('xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"')
    expect(layouted).toContain('orbitpm:activeLang="ar"')

    // EVERY orbitpm attribute=value pair present in the semantic XML survives
    // layout verbatim (bpmn-moddle keeps foreign attrs in $attrs and
    // re-serializes them — no post-layout re-application step required).
    const attrRe = /orbitpm:[A-Za-z]+="[^"]*"/g
    const semanticAttrs = semantic.match(attrRe) ?? []
    expect(semanticAttrs.length).toBeGreaterThanOrEqual(20)
    for (const attr of semanticAttrs) {
      expect(layouted).toContain(attr)
    }

    // Spot-check the load-bearing ones (incl. '\n'-joined lists and a flow).
    expect(layouted).toContain('orbitpm:nameEn="Review request"')
    expect(layouted).toContain('orbitpm:ccList="Finance Department&#10;Audit Office"')
    expect(layouted).toContain('orbitpm:respList="Sara Al Marri — Reviewer&#10;Ahmed Ali — Approver"')
    expect(layouted).toContain('orbitpm:decisionBasis="Procurement policy section 4"')
    expect(layouted).toContain('orbitpm:trigger="Employee submits a purchase request"')
    expect(layouted).toMatch(/<sequenceFlow[^>]*name="نعم"[^>]*orbitpm:nameEn="Yes"/)

    // And a plain diagram gains no orbitpm noise from the layouter.
    const plainLayouted = await layoutBpmn(generateBpmnXml(loadIr('ex1_professor').process))
    expect(plainLayouted).not.toContain('orbitpm')
  })
})
