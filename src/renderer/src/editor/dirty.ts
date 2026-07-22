// Pure dirty-tracking logic for the BPMN editor.
//
// bpmn-js's diagram-js CommandStack keeps an internal "stack index" that
// advances on every executed command and moves on undo/redo. Comparing the
// index at last-save time against the current index gives an exact dirty
// flag (including the "undo back to the saved state -> clean again" case),
// which a naive "any command ever fired -> dirty" flag gets wrong.
//
// This module only deals in plain numbers so it is trivially unit-testable
// without a real bpmn-js/diagram-js instance. The editor component is
// responsible for reading the live stack index off bpmn-js and feeding it
// through these transitions.

export interface DirtyState {
  readonly savedStackIndex: number
  readonly currentStackIndex: number
}

/** Fresh baseline: nothing dirty, both indices equal to `stackIndex`. */
export function createDirtyState(stackIndex: number): DirtyState {
  return { savedStackIndex: stackIndex, currentStackIndex: stackIndex }
}

/**
 * A diagram (re)import happened (initial mount or `xml` prop swap). The
 * newly imported document is, by definition, the current saved baseline.
 */
export function withImported(stackIndex: number): DirtyState {
  return createDirtyState(stackIndex)
}

/** The command stack moved (execute/undo/redo) to `stackIndex`. */
export function withCommandStackChanged(state: DirtyState, stackIndex: number): DirtyState {
  if (stackIndex === state.currentStackIndex) return state
  return { ...state, currentStackIndex: stackIndex }
}

/** A save completed successfully: the current index becomes the baseline. */
export function withSaved(state: DirtyState): DirtyState {
  if (state.savedStackIndex === state.currentStackIndex) return state
  return { ...state, savedStackIndex: state.currentStackIndex }
}

export function isDirty(state: DirtyState): boolean {
  return state.currentStackIndex !== state.savedStackIndex
}
