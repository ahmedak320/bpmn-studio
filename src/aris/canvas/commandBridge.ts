/**
 * The command-stack bridge — Plan Section 11.1 / 11.6.
 *
 * # The problem
 *
 * diagram-js ships its own `CommandStack` with its own undo history, and
 * `src/aris/model/` ships the ARIS command system with `baseRevision`
 * validation, atomic apply, rollback and serialization. Left alone they become
 * two sources of truth: a canvas undo would revert view state that the ARIS
 * document still believes in, and an ARIS undo would leave the canvas showing
 * a document that no longer exists.
 *
 * # The design decision
 *
 * **The ARIS document is the only state. diagram-js's command stack is used
 * purely as a history *index* over ARIS gestures — it stores no model state of
 * its own.**
 *
 * Concretely:
 *
 * 1. Canvas gestures never call `commandStack.execute('shape.move', …)`. The
 *    `modeling` service is replaced by `ArisModeling`, which turns every
 *    gesture into ARIS commands (`arisModeling.ts`).
 * 2. Those commands are *planned* first: `ArisDocumentStore.plan` replays them
 *    against an immutable scratch document. If any precondition fails, the
 *    gesture is rejected before either stack is touched. This is what makes
 *    divergence structurally impossible rather than merely unlikely.
 * 3. The planned gesture is then handed to diagram-js as a single
 *    `aris.gesture` command. Its handler applies the ARIS commands through the
 *    ARIS command stack on execute, and undoes exactly as many on revert.
 * 4. After every execute/revert the canvas is rebuilt from the resulting
 *    document by `ArisCanvasSync`.
 *
 * The two stacks are therefore always in lockstep by construction: one
 * diagram-js history entry ⇔ one ordered run of ARIS commands. Undo triggered
 * from a keyboard shortcut, from `editorActions`, from `commandStack.undo()`
 * or from `ArisCanvas.undo()` all follow the *same* code path, because all four
 * end up in `ArisGestureHandler.revert`.
 *
 * # Why a gesture can be more than one ARIS command
 *
 * `validatePreconditions` in `src/aris/model/commands.ts` validates every
 * subcommand of a `transaction` against the *pre-transaction* document. That is
 * fine for `createDefinition` + `createOccurrence` (the occurrence precondition
 * only checks the model), but it rejects `createConnectionDefinition` +
 * `createConnectionOccurrence`, because the occurrence precondition demands a
 * connection definition that the same transaction is about to create. Rather
 * than work around the model lane, the bridge accepts an ordered *list* of
 * commands per gesture and reverts the whole list as a unit. Both commands stay
 * individually valid and individually exportable.
 */

import type CommandStack from 'diagram-js/lib/command/CommandStack'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Element } from 'diagram-js/lib/model/Types'

import type { ArisEditCommand } from '../model/commands'
import { ArisCommandError } from '../model/commands'
import { ArisCanvasSync } from './canvasSync'
import { ArisDocumentStore, type ArisCommandThunk, type ArisPlannedGesture } from './documentStore'

/** The diagram-js command name every ARIS gesture is recorded under. */
export const ARIS_GESTURE_COMMAND = 'aris.gesture'

/** Fired after the working document changed for any reason. */
export const ARIS_DOCUMENT_CHANGED = 'aris.document.changed'

export interface ArisGestureContext {
  readonly label: string
  readonly commands: readonly ArisEditCommand[]
  /** Set once the gesture has run; a second execute is therefore a redo. */
  executed?: boolean
}

export class ArisCanvasCommandError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'ArisCanvasCommandError'
    this.code = code
    this.cause = cause
  }
}

export class ArisCommandBridge {
  static $inject = ['arisDocumentStore', 'arisCanvasSync', 'commandStack', 'eventBus']

  constructor(
    private readonly store: ArisDocumentStore,
    private readonly sync: ArisCanvasSync,
    private readonly commandStack: CommandStack,
    private readonly eventBus: EventBus
  ) {
    this.commandStack.register(ARIS_GESTURE_COMMAND, {
      execute: (context: ArisGestureContext): Element[] => {
        if (context.executed) {
          // A second execute is diagram-js replaying the entry, i.e. a redo.
          this.store.redo(context.commands.length)
        } else {
          this.store.applyPlanned(context.commands)
          context.executed = true
        }
        return this.refresh(context.label)
      },
      revert: (context: ArisGestureContext): Element[] => {
        this.store.undo(context.commands.length)
        return this.refresh(context.label)
      }
    })
  }

  /**
   * Plan and execute a gesture.
   *
   * @param label human-readable gesture name, for history/debugging.
   * @param thunks one builder per ARIS command, evaluated in order against the
   *   document state each command will actually see.
   * @returns the concrete commands that were recorded.
   */
  execute(label: string, thunks: ArisCommandThunk | readonly ArisCommandThunk[]): readonly ArisEditCommand[] {
    const list = Array.isArray(thunks) ? (thunks as readonly ArisCommandThunk[]) : [thunks as ArisCommandThunk]
    const planned = this.plan(label, list)
    if (planned.commands.length === 0) return planned.commands
    const context: ArisGestureContext = { label: planned.label, commands: planned.commands }
    this.commandStack.execute(ARIS_GESTURE_COMMAND, context)
    return planned.commands
  }

  /** Plan without executing. Throws `ArisCanvasCommandError` on rejection. */
  plan(label: string, thunks: readonly ArisCommandThunk[]): ArisPlannedGesture {
    try {
      return this.store.plan(label, thunks)
    } catch (error) {
      if (error instanceof ArisCommandError) {
        throw new ArisCanvasCommandError(error.code, `Gesture "${label}" rejected: ${error.message}`, error)
      }
      throw new ArisCanvasCommandError(
        'gesture-rejected',
        `Gesture "${label}" rejected: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    }
  }

  /** True when the gesture would be accepted by the ARIS command system. */
  canExecute(label: string, thunks: readonly ArisCommandThunk[]): boolean {
    try {
      this.plan(label, thunks)
      return true
    } catch {
      return false
    }
  }

  /** Undo the previous gesture. Same path as a keyboard/editorActions undo. */
  undo(): void {
    this.commandStack.undo()
  }

  /** Redo the next gesture. */
  redo(): void {
    this.commandStack.redo()
  }

  get canUndo(): boolean {
    return this.commandStack.canUndo()
  }

  get canRedo(): boolean {
    return this.commandStack.canRedo()
  }

  /** Re-project the document and announce the change. */
  refresh(reason: string): Element[] {
    const dirty = this.sync.sync()
    this.sync.notify(dirty)
    this.eventBus.fire(ARIS_DOCUMENT_CHANGED, {
      reason,
      document: this.store.document,
      modelId: this.store.activeModelId
    })
    return dirty
  }
}
