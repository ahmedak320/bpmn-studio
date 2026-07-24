// Label -> bilingual-attr sync: whenever the user finishes a direct label edit
// on the canvas (bpmn-js `element.updateLabel` command), mirror the new
// visible name into the ACTIVE language's stored attribute
// (`orbitpm:nameEn` / `orbitpm:nameAr`) so the language toggle's write-back
// rule holds continuously instead of only at toggle time.
//
// Why `commandStack.element.updateLabel.postExecuted` is safe to write from:
// postExecuted fires OUTSIDE the command stack's atomic guard and only on the
// original execution (never on redo), so the nested
// `modeling.updateProperties` (a) is legal, (b) joins the SAME undo action as
// the label edit, and (c) replays from the stack on redo instead of re-firing.
// Writing `name` via updateProperties (langToggle, dialog Apply) does NOT fire
// `element.updateLabel`, so this can never loop.
//
// TextAnnotations are naturally excluded: their label attribute is `text`, so
// the business object's `name` reads '' and resolveLabelMirror returns {}.
// Connections (sequence-flow labels) ARE mirrored — matching
// toggleDiagramLang's scope. Kept bpmn-js-free and structurally typed so the
// vitest node suite drives it with plain object fakes.

import {
  getDiagramLang,
  resolveLabelMirror,
  type LangToggleModeler,
  type LangBusinessObjectLike
} from './langToggle'

const UPDATE_LABEL_EVENT = 'commandStack.element.updateLabel.postExecuted'

interface LabelSyncEventBusLike {
  on(event: string, callback: (event: unknown) => void): void
  off(event: string, callback: (event: unknown) => void): void
}

interface LabelSyncModelingLike {
  updateProperties(element: unknown, properties: Record<string, unknown>): void
}

interface LabelSyncElementLike {
  businessObject?: LangBusinessObjectLike
  /** Present on external-label shapes; points at the labelled element. */
  labelTarget?: LabelSyncElementLike | null
}

interface UpdateLabelEventLike {
  context?: { element?: LabelSyncElementLike }
}

/**
 * Install the mirror on a modeler. Returns an uninstall function (same
 * convention as installDragWatchdog / installCanvasDecor).
 */
export function installLabelBilingualSync(modeler: LangToggleModeler): () => void {
  const eventBus = modeler.get('eventBus') as LabelSyncEventBusLike

  const handler = (event: unknown): void => {
    try {
      const raw = (event as UpdateLabelEventLike | undefined)?.context?.element
      if (!raw) return
      // UpdateLabelHandler may hand either the label shape or its target —
      // always write onto the real element (labels share its business object).
      const element = raw.labelTarget ?? raw
      const bo = element.businessObject
      if (!bo) return
      const properties = resolveLabelMirror(bo, getDiagramLang(modeler))
      if (Object.keys(properties).length === 0) return
      const modeling = modeler.get('modeling') as LabelSyncModelingLike
      modeling.updateProperties(element, properties)
    } catch {
      /* a mirror failure must never break the label edit itself */
    }
  }

  eventBus.on(UPDATE_LABEL_EVENT, handler)
  return () => {
    try {
      eventBus.off(UPDATE_LABEL_EVENT, handler)
    } catch {
      /* modeler already destroyed */
    }
  }
}
