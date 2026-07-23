// Read/write helpers for the `orbitpm:*` org-pack attributes on a bpmn-js
// business object, plus the process-level owner/documentation and the
// text-annotation "note" linkage. Everything here is deliberately typed against
// minimal STRUCTURAL shapes (never the concrete bpmn-js classes) so the pure
// bits can be unit-tested in a plain node environment, and so both the
// "typed extension registered" world (business object exposes a real `.get()`
// property) and the "plain $attrs" world (unknown attributes land in
// `businessObject.$attrs`) are supported by the same code path.

// --- structural shapes -----------------------------------------------------

interface BusinessObjectLike {
  $type?: string
  $attrs?: Record<string, unknown>
  get?: (name: string) => unknown
  [key: string]: unknown
}

export interface OrgElementLike {
  id?: string
  type?: string
  businessObject?: BusinessObjectLike
  source?: OrgElementLike | null
  target?: OrgElementLike | null
  x?: number
  y?: number
  width?: number
  height?: number
  waypoints?: unknown
  labelTarget?: unknown
}

interface ModelingLike {
  updateProperties(element: unknown, properties: Record<string, unknown>): void
  createShape(
    attrs: { type: string },
    bounds: { x: number; y: number; width: number; height: number },
    target: unknown
  ): OrgElementLike
  connect(source: unknown, target: unknown, attrs: { type: string }): unknown
  removeElements(elements: unknown[]): void
}

interface BpmnFactoryLike {
  create(type: string, attrs?: Record<string, unknown>): unknown
}

interface CanvasLike {
  getRootElement(): OrgElementLike | undefined
}

interface ElementRegistryLike {
  getAll(): OrgElementLike[]
}

export interface OrgModeler {
  get(service: 'modeling'): ModelingLike
  get(service: 'bpmnFactory'): BpmnFactoryLike
  get(service: 'canvas'): CanvasLike
  get(service: 'elementRegistry'): ElementRegistryLike
}

// --- props ------------------------------------------------------------------

export interface OrgProps {
  owner?: string
  ownerType?: string
  ownerRole?: string
  channel?: string
  channelDetail?: string
  kind?: string
  ccTo?: string
  trigger?: string
  triggerService?: string
  triggerDetail?: string
}

/** Prop name -> fully-qualified moddle attribute name. */
const PROP_TO_ATTR: Record<keyof OrgProps, string> = {
  owner: 'orbitpm:owner',
  ownerType: 'orbitpm:ownerType',
  ownerRole: 'orbitpm:ownerRole',
  channel: 'orbitpm:channel',
  channelDetail: 'orbitpm:channelDetail',
  kind: 'orbitpm:kind',
  ccTo: 'orbitpm:ccTo',
  trigger: 'orbitpm:trigger',
  triggerService: 'orbitpm:triggerService',
  triggerDetail: 'orbitpm:triggerDetail'
}

const ORG_KEYS = Object.keys(PROP_TO_ATTR) as Array<keyof OrgProps>

// --- attribute reading ------------------------------------------------------

/**
 * Read one `orbitpm:*` attribute from a business object, transparently
 * handling both worlds: a registered moddle extension exposes the value via
 * `bo.get('orbitpm:owner')`; without the extension the parser stashes it in
 * `bo.$attrs['orbitpm:owner']`. Empty / absent -> undefined.
 */
function readAttr(bo: BusinessObjectLike | undefined, name: string): string | undefined {
  if (!bo) return undefined
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get(name)
      if (value != null && value !== '') return String(value)
    } catch {
      /* fall through to $attrs */
    }
  }
  const raw = bo.$attrs?.[name]
  if (raw != null && raw !== '') return String(raw)
  return undefined
}

/** Read a plain (non-prefixed) moddle property, e.g. `documentation`. */
function readModdleProp(bo: BusinessObjectLike | undefined, name: string): unknown {
  if (!bo) return undefined
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get(name)
      if (value !== undefined) return value
    } catch {
      /* fall through */
    }
  }
  return bo[name]
}

function orgPropsFromBusinessObject(bo: BusinessObjectLike | undefined): OrgProps {
  const out: OrgProps = {}
  for (const key of ORG_KEYS) {
    const value = readAttr(bo, PROP_TO_ATTR[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Extract every `orbitpm:*` attribute set on `element.businessObject` into a
 * plain `OrgProps` bag. Absent attributes are simply omitted.
 */
export function getOrgProps(element: { businessObject?: unknown } | null | undefined): OrgProps {
  const bo = element?.businessObject as BusinessObjectLike | undefined
  return orgPropsFromBusinessObject(bo)
}

// --- attribute writing ------------------------------------------------------

/** `''` / `undefined` -> undefined (which makes updateProperties REMOVE the attr). */
function emptyToUndef(value: string | undefined): string | undefined {
  return value ? value : undefined
}

/**
 * Write the FULL org-prop set onto an element in a single command. Every
 * contract attribute is emitted; an empty-string or undefined value maps to
 * `undefined`, which bpmn-js's updateProperties treats as an attribute removal.
 * This is "replace the org state", so callers pass the complete desired props.
 */
export function setOrgProps(modeler: OrgModeler, element: unknown, patch: OrgProps): void {
  const modeling = modeler.get('modeling')
  const properties: Record<string, string | undefined> = {}
  for (const key of ORG_KEYS) {
    properties[PROP_TO_ATTR[key]] = emptyToUndef(patch[key])
  }
  modeling.updateProperties(element, properties)
}

// --- process-level owner + documentation -----------------------------------

/**
 * The element (or business object) that carries process-level org props.
 * Returns the canvas root when it is a `bpmn:Process`, otherwise (a
 * collaboration) the first participant's `processRef`.
 */
export function getProcessElement(modeler: OrgModeler): OrgElementLike | BusinessObjectLike | undefined {
  const root = modeler.get('canvas').getRootElement()
  if (!root) return undefined
  const bo = root.businessObject
  if (bo?.$type === 'bpmn:Process') return root
  // Collaboration: dig out the first participant's referenced process.
  const participants = readModdleProp(bo, 'participants')
  if (Array.isArray(participants) && participants.length > 0) {
    const processRef = (participants[0] as BusinessObjectLike | undefined)?.processRef
    if (processRef) return processRef as BusinessObjectLike
  }
  return root
}

/** Normalise whatever getProcessElement returns down to a business object. */
function toBusinessObject(el: OrgElementLike | BusinessObjectLike | undefined): BusinessObjectLike | undefined {
  if (!el) return undefined
  const maybeElement = el as OrgElementLike
  if (maybeElement.businessObject) return maybeElement.businessObject
  const maybeBo = el as BusinessObjectLike
  if (maybeBo.$type) return maybeBo
  return undefined
}

export function getProcessOrgProps(modeler: OrgModeler): OrgProps {
  return orgPropsFromBusinessObject(toBusinessObject(getProcessElement(modeler)))
}

export function setProcessOrgProps(modeler: OrgModeler, patch: OrgProps): void {
  const el = getProcessElement(modeler)
  if (!el) return
  setOrgProps(modeler, el, patch)
}

/** First `bpmn:Documentation` text on the process (or ''). */
export function getProcessDocumentation(modeler: OrgModeler): string {
  const bo = toBusinessObject(getProcessElement(modeler))
  const docs = readModdleProp(bo, 'documentation')
  if (Array.isArray(docs) && docs.length > 0) {
    const first = docs[0] as { text?: unknown } | undefined
    const text = first?.text
    return typeof text === 'string' ? text : ''
  }
  return ''
}

export function setProcessDocumentation(modeler: OrgModeler, text: string): void {
  const el = getProcessElement(modeler)
  if (!el) return
  const modeling = modeler.get('modeling')
  if (!text) {
    modeling.updateProperties(el, { documentation: [] })
    return
  }
  const doc = modeler.get('bpmnFactory').create('bpmn:Documentation', { text })
  modeling.updateProperties(el, { documentation: [doc] })
}

// --- linked text-annotation "note" -----------------------------------------

function sameElement(a: OrgElementLike | null | undefined, b: OrgElementLike): boolean {
  if (!a) return false
  if (a === b) return true
  return a.id != null && a.id === b.id
}

/**
 * The `bpmn:TextAnnotation` element linked to `element` by a `bpmn:Association`
 * (in either direction), or null.
 */
function findLinkedAnnotation(modeler: OrgModeler, element: OrgElementLike): OrgElementLike | null {
  const all = modeler.get('elementRegistry').getAll()
  for (const conn of all) {
    if (conn.type !== 'bpmn:Association') continue
    let other: OrgElementLike | null | undefined
    if (sameElement(conn.source, element)) other = conn.target
    else if (sameElement(conn.target, element)) other = conn.source
    else continue
    if (other && other.type === 'bpmn:TextAnnotation') return other
  }
  return null
}

export function getLinkedNote(
  modeler: OrgModeler,
  element: OrgElementLike
): { annotationId: string; text: string } | null {
  const annotation = findLinkedAnnotation(modeler, element)
  if (!annotation) return null
  const text = readModdleProp(annotation.businessObject, 'text')
  return {
    annotationId: annotation.id ?? '',
    text: typeof text === 'string' ? text : ''
  }
}

/**
 * Create / update / delete the note linked to a flow node. Non-empty text
 * updates an existing annotation or creates a new one (positioned up-and-right
 * of the shape and joined with an Association). Empty text removes an existing
 * annotation and is a no-op when there is none.
 */
export function setStepNote(modeler: OrgModeler, element: OrgElementLike, text: string): void {
  const modeling = modeler.get('modeling')
  const existing = findLinkedAnnotation(modeler, element)
  if (existing) {
    if (text) modeling.updateProperties(existing, { text })
    else modeling.removeElements([existing])
    return
  }
  if (!text) return
  const root = modeler.get('canvas').getRootElement()
  const x = (element.x ?? 0) + (element.width ?? 0) + 90
  const y = (element.y ?? 0) - 60
  const annotation = modeling.createShape(
    { type: 'bpmn:TextAnnotation' },
    { x, y, width: 140, height: 60 },
    root
  )
  modeling.updateProperties(annotation, { text })
  modeling.connect(element, annotation, { type: 'bpmn:Association' })
}

// --- pure XML-tag reader (for indexers / tests) ----------------------------

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const ORG_ATTR_RES: Array<[keyof OrgProps, RegExp]> = ORG_KEYS.map((key) => [
  key,
  new RegExp('\\b' + PROP_TO_ATTR[key] + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')')
])

/**
 * Pure regex extraction of `orbitpm:*` attributes from a single opening-tag
 * body (e.g. the string matched by a generic `<[a-zA-Z_][^>]*>` scan). Handles
 * both quote styles and decodes XML entities. Absent attributes are omitted;
 * an attribute present with an empty value is kept as ''.
 */
export function readOrgAttrsFromTag(tagBody: string): OrgProps {
  const out: OrgProps = {}
  for (const [key, re] of ORG_ATTR_RES) {
    const match = re.exec(tagBody)
    if (match) out[key] = decodeXmlEntities(match[1] ?? match[2] ?? '')
  }
  return out
}
