import { applyChange, applyCommand, invertCommand, normalizeCommand, type ArisEditCommand, ArisCommandError } from './commands'
import type { ArisWorkingDocument } from './types'

export type ArisCommandIdGenerator = () => string

/**
 * Create a deterministic, testable command id generator.
 *
 * The counter is monotonic within the generator instance; supplying a seed
 * prefix makes ids human-readable while remaining deterministic.
 */
export function createCommandIdGenerator(prefix = 'cmd'): ArisCommandIdGenerator {
  let counter = 0
  return () => {
    const id = `${prefix}-${counter.toString(36).padStart(6, '0')}`
    counter += 1
    return id
  }
}

export interface ArisCommandStack {
  readonly document: ArisWorkingDocument
  readonly undoStack: readonly ArisEditCommand[]
  readonly redoStack: readonly ArisEditCommand[]
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly nextCommandId: ArisCommandIdGenerator
  readonly apply: (command: ArisEditCommand) => ArisCommandStack
  readonly undo: () => ArisCommandStack
  readonly redo: () => ArisCommandStack
}

function applyWithRollback(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  try {
    return applyCommand(document, command)
  } catch (error) {
    if (error instanceof ArisCommandError) {
      throw error
    }
    throw new ArisCommandError('apply-failed', String(error), command.commandId)
  }
}

function changeWithRollback(document: ArisWorkingDocument, command: ArisEditCommand): ArisWorkingDocument {
  try {
    return applyChange(document, command)
  } catch (error) {
    if (error instanceof ArisCommandError) {
      throw error
    }
    throw new ArisCommandError('apply-failed', String(error), command.commandId)
  }
}

function makeStack(
  document: ArisWorkingDocument,
  undoStack: readonly ArisEditCommand[],
  redoStack: readonly ArisEditCommand[],
  idGenerator: ArisCommandIdGenerator
): ArisCommandStack {
  return Object.freeze({
    document,
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    nextCommandId: idGenerator,
    apply: (command: ArisEditCommand) => {
      const nextDocument = applyWithRollback(document, command)
      return makeStack(nextDocument, [...undoStack, command], [], idGenerator)
    },
    undo: () => {
      if (undoStack.length === 0) return makeStack(document, undoStack, redoStack, idGenerator)
      const command = undoStack[undoStack.length - 1]
      const rest = undoStack.slice(0, -1)
      const inverse = normalizeCommand(invertCommand(command), document.revision)
      const nextDocument = changeWithRollback(document, inverse)
      const restored = Object.freeze({ ...nextDocument, revision: document.revision - 1 })
      return makeStack(restored, rest, [...redoStack, command], idGenerator)
    },
    redo: () => {
      if (redoStack.length === 0) return makeStack(document, undoStack, redoStack, idGenerator)
      const command = redoStack[redoStack.length - 1]
      const rest = redoStack.slice(0, -1)
      const normalized = normalizeCommand(command, document.revision)
      const nextDocument = applyWithRollback(document, normalized)
      return makeStack(nextDocument, [...undoStack, normalized], rest, idGenerator)
    }
  })
}

/**
 * Create a fresh command stack for a working document.
 */
export function createCommandStack(
  document: ArisWorkingDocument,
  options?: { readonly idGenerator?: ArisCommandIdGenerator }
): ArisCommandStack {
  return makeStack(document, [], [], options?.idGenerator ?? createCommandIdGenerator())
}
