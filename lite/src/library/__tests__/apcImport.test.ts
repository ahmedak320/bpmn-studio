import { describe, it, expect } from 'vitest'
import { convertApcToBpmn } from '../apcImport'

// A minimal, synthetic ARIS AML export: two events bracketing one function,
// wired start-event → function → end-event via CT_ predecessor connections.
// It deliberately exercises all three name-storage shapes AML uses in the wild.
const MINIMAL_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Group Group.ID="Group.1">
    <ObjDef ObjDef.ID="ObjDef.E1" TypeNum="OT_EVT">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request received</AttrValue></AttrDef>
      <CxnDef CxnDef.ID="Cxn.1" TypeNum="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.F1"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.F1" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue><PlainText TextValue="Review request"/></AttrValue></AttrDef>
      <CxnDef CxnDef.ID="Cxn.2" TypeNum="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.E2"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.E2" TypeNum="OT_EVT">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue>Request reviewed</AttrValue></AttrDef>
    </ObjDef>
  </Group>
</AML>`

describe('convertApcToBpmn', () => {
  it('converts a minimal AML export to laid-out BPMN', async () => {
    const result = await convertApcToBpmn(MINIMAL_AML)
    expect('xml' in result).toBe(true)
    if (!('xml' in result)) return
    const { xml } = result
    // Event with no incoming → start; the function → task; event with no
    // outgoing → end; the two connections → sequence flows.
    expect(xml).toContain('<startEvent')
    expect(xml).toContain('<task')
    expect(xml).toContain('<endEvent')
    expect(xml).toContain('<sequenceFlow')
    // Layout added a BPMNDiagram so the canvas can render it immediately.
    expect(xml).toContain('BPMNDiagram')
    // Names survived from all three AML name-storage shapes.
    expect(xml).toContain('Request received')
    expect(xml).toContain('Review request')
    expect(xml).toContain('Request reviewed')
  })

  it('rejects non-AML input', async () => {
    const result = await convertApcToBpmn('<definitions>not aris</definitions>')
    expect(result).toEqual({ error: 'not-aml' })
  })

  it('rejects AML with no object definitions', async () => {
    const result = await convertApcToBpmn('<AML><Group Group.ID="Group.1"/></AML>')
    expect(result).toEqual({ error: 'no-objects' })
  })

  it('tolerates cycles and missing names', async () => {
    // A → B → A (cycle); B has no AT_NAME, so it falls back to its ObjDef id.
    const cyclic = `<AML>
      <ObjDef ObjDef.ID="ObjDef.A" TypeNum="OT_FUNC">
        <AttrDef AttrDef.Type="AT_NAME"><AttrValue>Alpha</AttrValue></AttrDef>
        <CxnDef TypeNum="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.B"/>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.B" TypeNum="OT_FUNC">
        <CxnDef TypeNum="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.A"/>
      </ObjDef>
    </AML>`
    const result = await convertApcToBpmn(cyclic)
    expect('xml' in result).toBe(true)
    if (!('xml' in result)) return
    // Both functions became tasks; the unnamed one carries its id as the label.
    expect(result.xml).toContain('Alpha')
    expect(result.xml).toContain('ObjDef_B')
  })

  it('drops connections whose endpoints are unknown and non-flow CxnDef types', async () => {
    // The org-unit connection (CT_EXEC) and the dangling ToObjDef are both
    // ignored; only the one real flow edge survives.
    const aml = `<AML>
      <ObjDef ObjDef.ID="ObjDef.F1" TypeNum="OT_FUNC">
        <AttrDef AttrDef.Type="AT_NAME"><AttrValue>Do work</AttrValue></AttrDef>
        <CxnDef TypeNum="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.F2"/>
        <CxnDef TypeNum="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.MISSING"/>
      </ObjDef>
      <ObjDef ObjDef.ID="ObjDef.F2" TypeNum="OT_FUNC">
        <AttrDef AttrDef.Type="AT_NAME"><AttrValue>Do more</AttrValue></AttrDef>
      </ObjDef>
    </AML>`
    const result = await convertApcToBpmn(aml)
    expect('xml' in result).toBe(true)
    if (!('xml' in result)) return
    // Exactly one sequence flow (F1 → F2); the dangling edge was dropped.
    const flowCount = (result.xml.match(/<sequenceFlow\b/g) ?? []).length
    expect(flowCount).toBe(1)
  })
})
