// Pure link-morphing logic for OrbitPM Lite: turning any linkable activity
// into a bpmn:CallActivity + wiring its calledElement, and a pure XML-string
// stripper for the inverse (unlink) operation. Kept free of live bpmn-js
// instantiation so it can be unit-tested in the node vitest environment —
// only structural interfaces are used for the modeler.

import {
  setCalledElement,
  type ModelingLike,
  type ElementRegistryLike
} from '@app/renderer/src/links/modelerOps'

/** bpmn:Activity subtypes (+ CallActivity itself) that can be morphed into a CallActivity and linked. */
export const LINKABLE_TYPES: readonly string[] = [
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ManualTask',
  'bpmn:ScriptTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess'
]

export interface LinkableElementLike {
  type?: string
  /** Present (truthy) on label shapes — the label is not itself linkable. */
  labelTarget?: unknown
  /** Present on connections (sequence flows, etc.) — never linkable. */
  waypoints?: unknown
}

/**
 * True iff the element is a "real" shape (not a label, not a connection)
 * whose type is one of the linkable activity types.
 */
export function isLinkableActivity(
  element: LinkableElementLike | null | undefined
): boolean {
  if (!element) return false
  if (element.labelTarget) return false
  if (element.waypoints) return false
  if (!element.type) return false
  return LINKABLE_TYPES.includes(element.type)
}

export interface ReplacedElementLike {
  id: string
  type?: string
  businessObject?: { calledElement?: string | null } | null
}

export interface BpmnReplaceLike {
  replaceElement(
    element: unknown,
    target: { type: string }
  ): ReplacedElementLike
}

export interface SelectionForLinkingLike {
  select(element: unknown): void
}

export interface ElementForLinkingLike {
  id: string
  type?: string
}

export interface ElementRegistryForLinkingLike {
  get(id: string): ElementForLinkingLike | undefined
}

// All `get` overloads declared together (not via `extends`) so this stays a
// single, self-consistent structural type — same pattern as
// SelectionLinkButtonLite's SelectionLinkModeler.
export interface LinkMorphModeler {
  get(name: 'elementRegistry'): ElementRegistryForLinkingLike & ElementRegistryLike
  get(name: 'modeling'): ModelingLike
  get(name: 'bpmnReplace'): BpmnReplaceLike
  get(name: 'selection'): SelectionForLinkingLike
}

/**
 * Ensure `elementId` is a bpmn:CallActivity (morphing it via bpmnReplace if
 * it is some other linkable activity type), then set its calledElement to
 * `processId`. Returns the id of the element that ends up holding the link
 * (unchanged if already a CallActivity, otherwise the id of the replacement
 * shape bpmnReplace produces).
 */
export function ensureCallActivityAndLink(
  modeler: LinkMorphModeler,
  elementId: string,
  processId: string
): string {
  const elementRegistry = modeler.get('elementRegistry')
  const element = elementRegistry.get(elementId)
  if (!element) {
    throw new Error(`ensureCallActivityAndLink: element not found: ${elementId}`)
  }

  if (element.type === 'bpmn:CallActivity') {
    setCalledElement(modeler, elementId, processId)
    return elementId
  }

  const bpmnReplace = modeler.get('bpmnReplace')
  const newEl = bpmnReplace.replaceElement(element, { type: 'bpmn:CallActivity' })
  setCalledElement(modeler, newEl.id, processId)

  try {
    const selection = modeler.get('selection')
    selection.select(newEl)
  } catch {
    // selection service may be absent (e.g. in tests) — non-fatal.
  }

  return newEl.id
}

// --- Pure XML string transform -------------------------------------------

const CALL_ACTIVITY_TAG_RE = /<(?:[\w.-]+:)?callActivity\b[^>]*>/g
const ID_ATTR_RE = /\bid=(?:"([^"]*)"|'([^']*)')/
const CALLED_ELEMENT_ATTR_RE = /\s+calledElement=(?:"[^"]*"|'[^']*')/

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Pure string transform: remove the `calledElement="..."` (or `'...'`)
 * attribute from the `<bpmn:callActivity>` (or any ns-prefixed equivalent)
 * opening tag whose `id` equals `elementId`. Every other byte of the
 * document — including all other attributes and whitespace on that same
 * tag — is left untouched. Returns the input unchanged if no matching tag
 * (or no `calledElement` attribute on it) is found.
 */
export function stripCalledElement(xml: string, elementId: string): string {
  let result = ''
  let lastIndex = 0
  let changed = false

  CALL_ACTIVITY_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CALL_ACTIVITY_TAG_RE.exec(xml)) !== null) {
    const tag = match[0]
    const idMatch = ID_ATTR_RE.exec(tag)
    const rawId = idMatch ? idMatch[1] ?? idMatch[2] ?? '' : ''
    const tagId = decodeXmlEntities(rawId)

    if (tagId === elementId) {
      const newTag = tag.replace(CALLED_ELEMENT_ATTR_RE, '')
      if (newTag !== tag) {
        result += xml.slice(lastIndex, match.index) + newTag
        lastIndex = match.index + tag.length
        changed = true
      }
      // Only one element can have this id; stop scanning further tags.
      break
    }
  }

  if (!changed) return xml

  result += xml.slice(lastIndex)
  return result
}
