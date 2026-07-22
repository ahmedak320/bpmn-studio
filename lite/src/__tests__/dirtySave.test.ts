import { describe, it, expect } from 'vitest'
import { partitionDirtyTabs } from '../workspace/dirtySave'

// Codex NEW-C2: "Save all & switch" used to SKIP dirty fallback tabs
// (relPath === null) entirely — they were saved nowhere and silently discarded
// on the folder switch. The save plan must account for EVERY dirty tab: writable
// tabs (relPath !== null) go to disk; fallback tabs get the download-on-save path.

describe('partitionDirtyTabs (NEW-C2 no silent discard of fallback tabs)', () => {
  const tabs = [
    { key: 'a.bpmn', relPath: 'a.bpmn' },
    { key: 'virtual:1', relPath: null }, // fallback / in-memory tab
    { key: 'b.bpmn', relPath: 'b.bpmn' } // clean (not dirty)
  ]

  it('routes dirty directory tabs to writable and dirty fallback tabs to downloadable', () => {
    const dirty = new Set(['a.bpmn', 'virtual:1'])
    const plan = partitionDirtyTabs(tabs, (t) => dirty.has(t.key))
    expect(plan.writable.map((t) => t.key)).toEqual(['a.bpmn'])
    // The dirty fallback tab is accounted for — NOT silently dropped.
    expect(plan.downloadable.map((t) => t.key)).toEqual(['virtual:1'])
  })

  it('accounts for EVERY dirty tab (the sum equals the dirty count)', () => {
    const dirty = new Set(['a.bpmn', 'virtual:1'])
    const plan = partitionDirtyTabs(tabs, (t) => dirty.has(t.key))
    expect(plan.writable.length + plan.downloadable.length).toBe(dirty.size)
  })

  it('a lone dirty fallback tab is never lost from the plan', () => {
    const plan = partitionDirtyTabs([{ key: 'virtual:1', relPath: null }], () => true)
    expect(plan.downloadable).toHaveLength(1)
    expect(plan.writable).toHaveLength(0)
  })

  it('ignores clean tabs entirely', () => {
    const plan = partitionDirtyTabs(tabs, () => false)
    expect(plan.writable).toHaveLength(0)
    expect(plan.downloadable).toHaveLength(0)
  })
})
