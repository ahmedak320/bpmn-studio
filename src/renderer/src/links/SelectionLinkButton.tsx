import { useEffect, useState } from 'react'
import type { ProcessIndex } from '../../../shared/processIndex'
import { inspectCallActivityElement, type CallActivityLikeElement } from '../editor'
import { LinkPicker } from './LinkPicker'
import { setCalledElement, type ModelerForLinkingLike } from './modelerOps'

interface SelectedElementLike extends CallActivityLikeElement {
  id?: string
}

interface SelectionLike {
  get(): SelectedElementLike[]
}

interface EventBusLike {
  on(event: string, callback: () => void): void
  off(event: string, callback: () => void): void
}

export interface SelectionLinkModeler extends ModelerForLinkingLike {
  get(name: 'eventBus'): EventBusLike
  get(name: 'selection'): SelectionLike
}

export interface SelectionLinkButtonProps {
  /** The live bpmn-js modeler instance, or null before/after mount. */
  modeler: SelectionLinkModeler | null
  index: ProcessIndex
}

/**
 * Small toolbar control that appears only when the current selection is a
 * single bpmn:CallActivity: "Link to process…" opens the LinkPicker and
 * writes the chosen processId onto the element's `calledElement` via
 * bpmn-js's modeling API. C4 stitches this into the editor toolbar area —
 * see the report snippet for the exact wiring (it needs the live modeler
 * instance, which EditorTab doesn't currently expose to its parent).
 */
export function SelectionLinkButton({ modeler, index }: SelectionLinkButtonProps): JSX.Element | null {
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
  if (!modeler || !selected?.id || !inspection.isCallActivity) return null

  const elementId = selected.id

  return (
    <>
      <button
        type="button"
        className="orbitpm-editor__button"
        onClick={() => setPickerOpen(true)}
        title={
          inspection.calledElementId
            ? `Linked to ${inspection.calledElementId}`
            : 'Link this call activity to a process'
        }
      >
        {inspection.calledElementId ? 'Change process link…' : 'Link to process…'}
      </button>
      <LinkPicker
        open={pickerOpen}
        index={index}
        currentProcessId={inspection.calledElementId}
        onPick={(processId) => {
          setCalledElement(modeler, elementId, processId)
          setPickerOpen(false)
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  )
}

export default SelectionLinkButton
