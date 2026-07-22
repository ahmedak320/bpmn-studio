/**
 * The one sanctioned divergence from the vendored Python: Python's `add_flow`
 * silently DROPS a second flow that shares a (sourceRef, targetRef) pair, losing
 * that branch's condition label. The port keeps BOTH (suffixing the id) when the
 * conditions differ, while still collapsing true duplicates (same condition) so
 * the 7 goldens are unaffected.
 *
 * dedup_flow.json: an exclusive gateway with one real branch and two empty
 * branches ("Cancelled by user", "Rejected by system") that both converge on the
 * following `end` event. Python emits only one `gw-end` flow; the fix keeps both.
 */
import { describe, it, expect } from 'vitest'
import { generateBpmnXml } from '../../src/gen/xml'
import { transform } from '../../src/gen/transform'
import { loadIr, loadGolden, canonicalXml } from './helpers'

describe('dedup-flow fix (documented, sanctioned divergence from Python)', () => {
  it('keeps BOTH converging branch flows, each with its own condition label', () => {
    const ir = loadIr('dedup_flow')
    const { flows } = transform(ir.process)

    const gwEnd = flows.filter((f) => f.sourceRef === 'gw' && f.targetRef === 'end')
    expect(gwEnd.length).toBe(2)
    expect(gwEnd.map((f) => f.id).sort()).toEqual(['gw-end', 'gw-end-2'])
    expect(gwEnd.map((f) => f.condition).sort()).toEqual([
      'Cancelled by user',
      'Rejected by system'
    ])
  })

  it('diverges from the Python golden, which drops the second label', () => {
    const ir = loadIr('dedup_flow')
    const ts = generateBpmnXml(ir.process)
    const golden = loadGolden('dedup_flow')

    // Divergence is real (not cosmetic): canonical forms differ.
    expect(canonicalXml(ts)).not.toBe(canonicalXml(golden))

    // Python kept only the first label and silently lost the second.
    expect(golden).toContain('name="Cancelled by user"')
    expect(golden).not.toContain('Rejected by system')

    // The port preserves both.
    expect(ts).toContain('name="Cancelled by user"')
    expect(ts).toContain('name="Rejected by system"')
    expect(ts).toContain('id="gw-end-2"')
  })

  it('still collapses a true duplicate: the parallel-join re-add (ex2 unaffected)', () => {
    // Guards that the fix only keeps DISTINCT-condition duplicates. Inside a
    // parallel gateway the last branch element flows to the join both from the
    // inner transform AND the explicit re-add — same edge, same (null) condition,
    // so it must collapse to a single flow exactly like Python.
    const ir = loadIr('ex2_parallel')
    const { flows } = transform(ir.process)

    const toJoinFromTask2 = flows.filter(
      (f) => f.sourceRef === 'task2' && f.targetRef === 'parallel1-join'
    )
    const toJoinFromTask4 = flows.filter(
      (f) => f.sourceRef === 'task4' && f.targetRef === 'parallel1-join'
    )
    expect(toJoinFromTask2.length).toBe(1)
    expect(toJoinFromTask4.length).toBe(1)
    // No suffixed duplicates leaked into the parallel example.
    expect(flows.some((f) => f.id.endsWith('-2'))).toBe(false)
  })
})
