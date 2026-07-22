import { describe, expect, it } from 'vitest'
import {
  createDirtyState,
  withImported,
  withCommandStackChanged,
  withSaved,
  isDirty
} from '../dirty'

describe('dirty-tracking reducer', () => {
  it('starts clean', () => {
    const state = createDirtyState(0)
    expect(isDirty(state)).toBe(false)
  })

  it('becomes dirty when the command stack advances', () => {
    const state = withCommandStackChanged(createDirtyState(0), 1)
    expect(isDirty(state)).toBe(true)
  })

  it('becomes clean again after a save', () => {
    const dirty = withCommandStackChanged(createDirtyState(0), 3)
    const saved = withSaved(dirty)
    expect(isDirty(saved)).toBe(false)
    expect(saved.savedStackIndex).toBe(3)
  })

  it('becomes clean again when undo returns to the saved index', () => {
    let state = createDirtyState(5)
    state = withCommandStackChanged(state, 6) // execute
    expect(isDirty(state)).toBe(true)
    state = withCommandStackChanged(state, 5) // undo back to saved
    expect(isDirty(state)).toBe(false)
  })

  it('re-importing resets the baseline to the new stack index', () => {
    const afterEdits = withCommandStackChanged(createDirtyState(0), 4)
    const reimported = withImported(4)
    expect(isDirty(reimported)).toBe(false)
    expect(reimported).not.toBe(afterEdits)
  })

  it('saving with no pending changes is a no-op (referentially stable)', () => {
    const clean = createDirtyState(2)
    expect(withSaved(clean)).toBe(clean)
  })

  it('an unrelated commandStack.changed event at the same index is a no-op', () => {
    const state = createDirtyState(2)
    expect(withCommandStackChanged(state, 2)).toBe(state)
  })
})
