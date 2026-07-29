/**
 * One-gesture apply: turn resolved localization patches into ARIS name/free-text
 * edits and commit them through the canvas command bridge as a SINGLE undoable
 * gesture.
 *
 * The bridge plans before it executes, so a rejected thunk (an unknown owner, a
 * stale revision) rolls the whole gesture back — nothing is applied. That is what
 * lets the shell offer one Undo that restores every renamed record at once.
 */

import { editFreeTextCommand, setLocalizedNameCommand } from '../canvas/commandFactory'
import type { ArisCommandThunk } from '../canvas/documentStore'
import type { ArisEditCommand } from '../model/commands'
import type { ArisWorkingDocument } from '../model/types'
import type { LocalizationPatch } from '../../localization/types'
import type { ArisTranslationOwner } from './fields'

export interface ArisTranslationUpdate {
  readonly owner: ArisTranslationOwner
  readonly localeId: string
  readonly value: string
}

/**
 * Convert core localization patches into ARIS-owner updates.
 *
 * `'fallback'`-property patches are the language-projection writes, which the
 * canvas owns — they are dropped here. A patch whose element has no known owner,
 * or an empty value, is also dropped so the apply stage never writes `''`.
 */
export function toArisTranslationUpdates(
  patches: readonly LocalizationPatch[],
  owners: ReadonlyMap<string, ArisTranslationOwner>
): ArisTranslationUpdate[] {
  const updates: ArisTranslationUpdate[] = []
  for (const patch of patches) {
    if (patch.property === 'fallback') continue
    if (patch.value === '') continue
    const owner = owners.get(patch.elementId)
    if (!owner) continue
    updates.push({ owner, localeId: patch.property, value: patch.value })
  }
  return updates
}

export function applyArisTranslations(
  canvas: {
    document: ArisWorkingDocument
    bridge: {
      execute(label: string, thunks: readonly ArisCommandThunk[]): readonly ArisEditCommand[]
    }
  },
  updates: readonly ArisTranslationUpdate[],
  label: string
): number {
  if (updates.length === 0) return 0
  const thunks: ArisCommandThunk[] = updates.map(
    (update): ArisCommandThunk =>
      (document, context) => {
        const { owner, localeId, value } = update
        if (owner.kind === 'freeText') {
          return editFreeTextCommand(context, document, owner.id, { text: value, localeId })
        }
        return setLocalizedNameCommand(context, document, owner.kind, owner.id, localeId, value)
      }
  )
  // ONE bridge.execute ⇒ ONE undo entry. Rejection throws from `plan`, before
  // anything reaches the command stack, so a bad update leaves the document
  // untouched.
  const commands = canvas.bridge.execute(label, thunks)
  return commands.length
}
