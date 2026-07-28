/**
 * The single source of truth for canvas-edited ARIS state.
 *
 * The store owns one `ArisCommandStack` from `src/aris/model/`. Nothing else in
 * the canvas is allowed to hold a document reference across an edit: every
 * reader goes through `store.document`, which always returns the stack's
 * current immutable snapshot.
 *
 * The store deliberately knows nothing about diagram-js. The lockstep with
 * diagram-js's own command stack is arranged one layer up, in
 * `commandBridge.ts`.
 */

import { applyCommand, type ArisEditCommand } from '../model/commands'
import { createCommandStack, type ArisCommandStack } from '../model/commandStack'
import { serializeCommandStack, type SerializedCommandStack } from '../model/serialize'
import type { ArisWorkingDocument } from '../model/types'
import { createArisIdFactory, seedIdFactory, type ArisIdFactory, type ArisIdKind } from './ids'
import type { ArisCommandContext } from './commandFactory'

/** A gesture step: build the command for the document state it will apply to. */
export type ArisCommandThunk = (
  document: ArisWorkingDocument,
  context: ArisCommandContext
) => ArisEditCommand

export interface ArisPlannedGesture {
  readonly label: string
  readonly commands: readonly ArisEditCommand[]
}

export interface ArisDocumentStoreOptions {
  readonly document: ArisWorkingDocument
  readonly activeModelId: string
  readonly idNamespace?: string
  readonly origin?: ArisEditCommand['origin']
}

export class ArisDocumentStore {
  /** Injected from `Diagram`'s `aris` config block. */
  static $inject = ['config.aris']

  private stack: ArisCommandStack
  private modelId: string
  private readonly idFactory: ArisIdFactory
  private readonly origin: ArisEditCommand['origin']

  constructor(options: ArisDocumentStoreOptions) {
    if (!options.document.models.has(options.activeModelId)) {
      throw new Error(`Active model ${options.activeModelId} is not part of the working document.`)
    }
    this.stack = createCommandStack(options.document)
    this.modelId = options.activeModelId
    this.origin = options.origin ?? 'user'
    this.idFactory = seedIdFactory(createArisIdFactory(options.idNamespace ?? ''), options.document)
  }

  get document(): ArisWorkingDocument {
    return this.stack.document
  }

  get revision(): number {
    return this.stack.document.revision
  }

  get activeModelId(): string {
    return this.modelId
  }

  get undoStack(): readonly ArisEditCommand[] {
    return this.stack.undoStack
  }

  get redoStack(): readonly ArisEditCommand[] {
    return this.stack.redoStack
  }

  get canUndo(): boolean {
    return this.stack.canUndo
  }

  get canRedo(): boolean {
    return this.stack.canRedo
  }

  /** Switch the model the canvas renders. Not an edit — no command is recorded. */
  setActiveModelId(modelId: string): void {
    if (!this.document.models.has(modelId)) {
      throw new Error(`Unknown model ${modelId}.`)
    }
    this.modelId = modelId
  }

  nextId(kind: ArisIdKind): string {
    return this.idFactory.next(kind)
  }

  /**
   * Turn a gesture into concrete commands without mutating anything.
   *
   * Each thunk builds against the document state its command will actually see,
   * and the result is verified with the same `applyCommand` the stack uses. A
   * failure therefore surfaces *before* either command stack is touched, which
   * is what keeps the two stacks in lockstep.
   */
  plan(label: string, thunks: readonly ArisCommandThunk[]): ArisPlannedGesture {
    let scratch = this.document
    const commands: ArisEditCommand[] = []
    for (const thunk of thunks) {
      const context: ArisCommandContext = {
        commandId: this.idFactory.next('command'),
        baseRevision: scratch.revision,
        origin: this.origin
      }
      const command = thunk(scratch, context)
      // Verified against an immutable copy; `applyCommand` never mutates.
      scratch = applyCommand(scratch, command)
      commands.push(command)
    }
    return Object.freeze({ label, commands: Object.freeze(commands) })
  }

  /** Apply pre-planned commands in order. */
  applyPlanned(commands: readonly ArisEditCommand[]): void {
    for (const command of commands) {
      this.stack = this.stack.apply(command)
    }
  }

  /** Undo the last `count` commands. */
  undo(count = 1): void {
    for (let index = 0; index < count; index += 1) {
      this.stack = this.stack.undo()
    }
  }

  /** Redo the next `count` commands. */
  redo(count = 1): void {
    for (let index = 0; index < count; index += 1) {
      this.stack = this.stack.redo()
    }
  }

  /** Plain-JSON snapshot of document plus history (Section 11.6 "exportable"). */
  serialize(): SerializedCommandStack {
    return serializeCommandStack(this.stack)
  }
}
