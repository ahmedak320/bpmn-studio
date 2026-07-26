// Pure logic for the "double-click a call activity to drill down" behavior.
// Kept free of any bpmn-js/DOM types beyond a minimal structural shape so it
// can be unit-tested without constructing real diagram-js elements.

export interface CallActivityLikeElement {
  type?: string
  businessObject?: {
    calledElement?: string | null
  } | null
}

export interface CallActivityInspection {
  /** True for any `bpmn:CallActivity`, regardless of whether it is linked. */
  isCallActivity: boolean
  /** The resolved `calledElement` process id, when present and non-empty. */
  calledElementId?: string
}

const CALL_ACTIVITY_TYPE = 'bpmn:CallActivity'

export function inspectCallActivityElement(
  element: CallActivityLikeElement | null | undefined
): CallActivityInspection {
  if (!element || element.type !== CALL_ACTIVITY_TYPE) {
    return { isCallActivity: false }
  }

  const calledElement = element.businessObject?.calledElement
  if (!calledElement || calledElement.trim() === '') {
    return { isCallActivity: true }
  }

  return { isCallActivity: true, calledElementId: calledElement }
}

/**
 * Should the editor's own dblclick handler swallow the event (return
 * `false` to a diagram-js eventBus listener), preventing bpmn-js's default
 * dblclick behavior (e.g. direct-editing the label)? Only true when we are
 * actually going to navigate away via `onOpenCalledProcess`.
 */
export function shouldSuppressDefaultDblClick(inspection: CallActivityInspection): boolean {
  return inspection.isCallActivity && Boolean(inspection.calledElementId)
}
