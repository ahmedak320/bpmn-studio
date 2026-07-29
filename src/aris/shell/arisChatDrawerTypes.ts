import type { ArisChatCommand } from '../chat/patchSchema'
import type { ArisWorkingDocument } from '../model/types'

/**
 * Host surface the chat drawer interview tab needs from the canvas / document store.
 *
 * This is deliberately narrower than the full canvas API: the session module only
 * reads the live document, applies validated commands as one undoable gesture,
 * and asks whether undo is available.
 */
export interface ArisTabChatHost {
  readonly getDocument: () => ArisWorkingDocument | null
  readonly applyCommands: (
    commands: readonly ArisChatCommand[],
    label: string
  ) => ArisWorkingDocument | null
  readonly undo: () => void
  readonly getCanUndo: () => boolean
}

/**
 * A destination tab that can host a chat-drawer interview.
 *
 * `tabKey` is the stable tab identifier used to route answers and selection
 * events back to the right session.
 */
export interface ArisChatDrawerTarget {
  readonly tabKey: string
  readonly title: string
  readonly host: ArisTabChatHost
}

/**
 * Lightweight identity for an in-flight interview request from the drawer chrome.
 */
export interface ArisChatInterviewRequest {
  readonly token: number
  readonly tabKey: string
}
