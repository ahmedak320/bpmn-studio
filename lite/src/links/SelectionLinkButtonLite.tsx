// Ported from the desktop app's SelectionLinkButton. Same behavior; the only
// change is the modeler interface no longer `extends ModelerForLinkingLike`
// (which produced incompatible `get` overloads — a latent typing bug the
// desktop repo never surfaces because its renderer typecheck is a no-op). The
// LinkPicker, the `setCalledElement` modeling op and the call-activity
// inspection are all REUSED verbatim by direct import from the desktop tree.

import { useEffect, useState } from 'react'
import type { ProcessIndex } from '@app/shared/processIndex'
import {
  inspectCallActivityElement,
  type CallActivityLikeElement
} from '@app/renderer/src/editor/callActivity'
import { LinkPicker } from '@app/renderer/src/links/LinkPicker'
import {
  setCalledElement,
  type ModelingLike,
  type ElementRegistryLike
} from '@app/renderer/src/links/modelerOps'
import {
  isLinkableActivity,
  ensureCallActivityAndLink,
  type BpmnReplaceLike,
  type ElementRegistryForLinkingLike
} from '../links/linkOps'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

interface SelectedElementLike extends CallActivityLikeElement {
  id?: string
}

// bpmn-js's selection service exposes both `get()` (read the current selection,
// used by this button) and `select()` (re-select the morphed element, used by
// ensureCallActivityAndLink). Declaring both keeps this modeler assignable to
// linkOps' LinkMorphModeler for the morph-and-link path.
interface SelectionLike {
  get(): SelectedElementLike[]
  select(element: unknown): void
}

interface EventBusLike {
  on(event: string, callback: () => void): void
  off(event: string, callback: () => void): void
}

// All `get` overloads declared together (not via `extends`) so this stays a
// single, self-consistent structural type. `bpmnReplace` + the intersected
// elementRegistry type make it a superset of linkOps' LinkMorphModeler, so it
// can drive both the existing setCalledElement path and the task→CallActivity
// morph.
export interface SelectionLinkModeler {
  get(name: 'modeling'): ModelingLike
  get(name: 'elementRegistry'): ElementRegistryForLinkingLike & ElementRegistryLike
  get(name: 'eventBus'): EventBusLike
  get(name: 'selection'): SelectionLike
  get(name: 'bpmnReplace'): BpmnReplaceLike
}

export interface SelectionLinkButtonProps {
  modeler: SelectionLinkModeler | null
  index: ProcessIndex
}

/**
 * Toolbar control shown only when the current selection is a single
 * bpmn:CallActivity: opens the (reused) LinkPicker and writes the chosen
 * processId onto the element's `calledElement`.
 */
export function SelectionLinkButton({
  modeler,
  index
}: SelectionLinkButtonProps): JSX.Element | null {
  useLang()
  const [selected, setSelected] = useState<SelectedElementLike | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (!modeler) {
      setSelected(null)
      return
    }
    const selection = modeler.get('selection')
    const eventBus = modeler.get('eventBus')

    const update = (): void => {
      const current = selection.get()
      setSelected(current.length === 1 ? current[0] : null)
    }

    update()
    eventBus.on('selection.changed', update)
    eventBus.on('element.changed', update)
    return () => {
      eventBus.off('selection.changed', update)
      eventBus.off('element.changed', update)
    }
  }, [modeler])

  const inspection = inspectCallActivityElement(selected)
  // Shown for ANY linkable activity now — not only existing call activities. A
  // plain task is morphed into a bpmn:CallActivity on pick (ensureCallActivity-
  // AndLink); a real call activity keeps the direct setCalledElement path.
  if (!modeler || !selected?.id || !isLinkableActivity(selected)) return null

  const elementId = selected.id

  return (
    <>
      <button
        type="button"
        className="orbitpm-editor__button"
        onClick={() => setPickerOpen(true)}
        title={
          inspection.calledElementId
            ? t('link.button.title.linked', { calledElementId: inspection.calledElementId })
            : t('link.button.title.unlinked')
        }
      >
        {inspection.calledElementId ? t('link.changeProcess') : t('link.linkToProcess')}
      </button>
      <LinkPicker
        open={pickerOpen}
        index={index}
        currentProcessId={inspection.calledElementId}
        onPick={(processId: string) => {
          if (inspection.isCallActivity) {
            setCalledElement(modeler, elementId, processId)
          } else {
            // Morph the task into a CallActivity and link it in one undoable step;
            // the morphed element IS a CallActivity, so dblclick drill-down works.
            ensureCallActivityAndLink(modeler, elementId, processId)
          }
          setPickerOpen(false)
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  )
}

export default SelectionLinkButton
