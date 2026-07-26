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
  incoming?: OrgElementLike[]
  outgoing?: OrgElementLike[]
  x?: number
  y?: number
  width?: number
  height?: number
  waypoints?: unknown
  labelTarget?: unknown
  /** External-label shape bounds (ABSOLUTE canvas coords, diagram-js `Shape.label`). */
  label?: { x: number; y: number; width: number; height: number }
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
  ownerEn?: string
  ownerAr?: string
  department?: string
  departmentEn?: string
  departmentAr?: string
  ownerType?: string
  ownerRole?: string
  ownerRoleEn?: string
  ownerRoleAr?: string
  channel?: string
  channelDetail?: string
  channelDetailEn?: string
  channelDetailAr?: string
  kind?: string
  ccTo?: string
  ccToEn?: string
  ccToAr?: string
  trigger?: string
  triggerService?: string
  triggerServiceEn?: string
  triggerServiceAr?: string
  triggerDetail?: string
  triggerDetailEn?: string
  triggerDetailAr?: string
  /** Repeatable triggers, one canonical "type — service — detail" row per line. */
  triggers?: string
  triggersEn?: string
  triggersAr?: string
  /** Bilingual element name (English) — used by the language-toggle lane. */
  nameEn?: string
  /** Bilingual element name (Arabic) — used by the language-toggle lane. */
  nameAr?: string
  /** 'en' | 'ar', process-level; declared here, managed by the toggle lane. */
  activeLang?: string
  /** Inputs / base-information list for a step ('\n'-joined). */
  inputs?: string
  inputsEn?: string
  inputsAr?: string
  /** Outputs list ('\n'-joined; rendered as the activity's output box). */
  outputs?: string
  outputsEn?: string
  outputsAr?: string
  /** Supporting system name(s) ('\n'-joined). */
  system?: string
  systemEn?: string
  systemAr?: string
  /** Responsible people, each "Name — Role" or "Name" ('\n'-joined). */
  respList?: string
  respListEn?: string
  respListAr?: string
  /** CC / informed-party names ('\n'-joined). */
  ccList?: string
  ccListEn?: string
  ccListAr?: string
  /** Decision basis free text (gateways + business-rule tasks). */
  decisionBasis?: string
  decisionBasisEn?: string
  decisionBasisAr?: string
  /** Other translatable organizational notes stored as attributes. */
  notes?: string
  notesEn?: string
  notesAr?: string
}

/** Prop name -> fully-qualified moddle attribute name. */
const PROP_TO_ATTR: Record<keyof OrgProps, string> = {
  owner: 'orbitpm:owner',
  ownerEn: 'orbitpm:ownerEn',
  ownerAr: 'orbitpm:ownerAr',
  department: 'orbitpm:department',
  departmentEn: 'orbitpm:departmentEn',
  departmentAr: 'orbitpm:departmentAr',
  ownerType: 'orbitpm:ownerType',
  ownerRole: 'orbitpm:ownerRole',
  ownerRoleEn: 'orbitpm:ownerRoleEn',
  ownerRoleAr: 'orbitpm:ownerRoleAr',
  channel: 'orbitpm:channel',
  channelDetail: 'orbitpm:channelDetail',
  channelDetailEn: 'orbitpm:channelDetailEn',
  channelDetailAr: 'orbitpm:channelDetailAr',
  kind: 'orbitpm:kind',
  ccTo: 'orbitpm:ccTo',
  ccToEn: 'orbitpm:ccToEn',
  ccToAr: 'orbitpm:ccToAr',
  trigger: 'orbitpm:trigger',
  triggerService: 'orbitpm:triggerService',
  triggerServiceEn: 'orbitpm:triggerServiceEn',
  triggerServiceAr: 'orbitpm:triggerServiceAr',
  triggerDetail: 'orbitpm:triggerDetail',
  triggerDetailEn: 'orbitpm:triggerDetailEn',
  triggerDetailAr: 'orbitpm:triggerDetailAr',
  triggers: 'orbitpm:triggers',
  triggersEn: 'orbitpm:triggersEn',
  triggersAr: 'orbitpm:triggersAr',
  nameEn: 'orbitpm:nameEn',
  nameAr: 'orbitpm:nameAr',
  activeLang: 'orbitpm:activeLang',
  inputs: 'orbitpm:inputs',
  inputsEn: 'orbitpm:inputsEn',
  inputsAr: 'orbitpm:inputsAr',
  outputs: 'orbitpm:outputs',
  outputsEn: 'orbitpm:outputsEn',
  outputsAr: 'orbitpm:outputsAr',
  system: 'orbitpm:system',
  systemEn: 'orbitpm:systemEn',
  systemAr: 'orbitpm:systemAr',
  respList: 'orbitpm:respList',
  respListEn: 'orbitpm:respListEn',
  respListAr: 'orbitpm:respListAr',
  ccList: 'orbitpm:ccList',
  ccListEn: 'orbitpm:ccListEn',
  ccListAr: 'orbitpm:ccListAr',
  decisionBasis: 'orbitpm:decisionBasis',
  decisionBasisEn: 'orbitpm:decisionBasisEn',
  decisionBasisAr: 'orbitpm:decisionBasisAr',
  notes: 'orbitpm:notes',
  notesEn: 'orbitpm:notesEn',
  notesAr: 'orbitpm:notesAr'
}

const ORG_KEYS = Object.keys(PROP_TO_ATTR) as Array<keyof OrgProps>

export type OrgProjectionLanguage = 'en' | 'ar'

/**
 * Unsuffixed organizational fields whose values are the active-language
 * projection. `ownerType`, `channel`, `kind`, `trigger`, and `activeLang` are
 * categorical/code fields and deliberately remain unsuffixed.
 */
export const PAIRED_ORG_PROJECTION_FIELDS = [
  { projection: 'owner', en: 'ownerEn', ar: 'ownerAr' },
  { projection: 'department', en: 'departmentEn', ar: 'departmentAr' },
  { projection: 'ownerRole', en: 'ownerRoleEn', ar: 'ownerRoleAr' },
  { projection: 'channelDetail', en: 'channelDetailEn', ar: 'channelDetailAr' },
  { projection: 'ccTo', en: 'ccToEn', ar: 'ccToAr' },
  { projection: 'triggerService', en: 'triggerServiceEn', ar: 'triggerServiceAr' },
  { projection: 'triggerDetail', en: 'triggerDetailEn', ar: 'triggerDetailAr' },
  { projection: 'triggers', en: 'triggersEn', ar: 'triggersAr' },
  { projection: 'inputs', en: 'inputsEn', ar: 'inputsAr' },
  { projection: 'outputs', en: 'outputsEn', ar: 'outputsAr' },
  { projection: 'system', en: 'systemEn', ar: 'systemAr' },
  { projection: 'respList', en: 'respListEn', ar: 'respListAr' },
  { projection: 'ccList', en: 'ccListEn', ar: 'ccListAr' },
  { projection: 'decisionBasis', en: 'decisionBasisEn', ar: 'decisionBasisAr' },
  { projection: 'notes', en: 'notesEn', ar: 'notesAr' }
] as const satisfies ReadonlyArray<{
  projection: keyof OrgProps
  en: keyof OrgProps
  ar: keyof OrgProps
}>

/**
 * Merge edited legacy projections into a complete org-property bag.
 *
 * Every edited unsuffixed translatable field is copied to the active
 * language's paired attribute. The opposite-language value and all recognized
 * fields not present in `editedProjection` are retained from `current`.
 * Explicit code/categorical edits are merged only under their unsuffixed key.
 *
 * Callers pass the returned COMPLETE bag to `setOrgProps`; unknown/future
 * attributes remain untouched because `setOrgProps` only addresses the known
 * contract names.
 */
export function mergeActiveLanguageOrgProps(
  current: Readonly<OrgProps>,
  editedProjection: Readonly<Partial<OrgProps>>,
  activeLanguage: OrgProjectionLanguage
): OrgProps {
  const merged: OrgProps = { ...current, ...editedProjection }
  for (const field of PAIRED_ORG_PROJECTION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(editedProjection, field.projection)) continue
    const activeKey = activeLanguage === 'ar' ? field.ar : field.en
    merged[activeKey] = editedProjection[field.projection]
  }
  return merged
}

// --- multi-value ('\n'-joined) attribute helpers ----------------------------

/**
 * Split a '\n'-joined multi-value attribute (inputs/outputs/respList/ccList/
 * system) into trimmed, non-empty entries. `undefined`/'' -> [].
 */
export function splitList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/**
 * Join entries back into the canonical '\n'-joined attribute value, dropping
 * blank entries and trimming each. [] -> '' (which setOrgProps removes).
 */
export function joinList(entries: readonly string[]): string {
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .join('\n')
}

// --- repeatable trigger helpers --------------------------------------------

export interface TriggerEntry {
  type: string
  service: string
  detail: string
}

/** Canonical trigger kinds shared by the model, dialog and tests. */
export const TRIGGER_TYPES = ['email', 'dmthub', 'manual', 'schedule', 'other'] as const

const TRIGGER_SEPARATOR = ' — '
const TRIGGER_TYPE_SET: ReadonlySet<string> = new Set(TRIGGER_TYPES)

function parseTriggerLine(line: string): TriggerEntry | null {
  const firstSeparator = line.indexOf(TRIGGER_SEPARATOR)
  const type = firstSeparator === -1 ? line.trim() : line.slice(0, firstSeparator).trim()
  if (!TRIGGER_TYPE_SET.has(type)) return null

  if (firstSeparator === -1) return { type, service: '', detail: '' }

  const remainder = line.slice(firstSeparator + TRIGGER_SEPARATOR.length)
  const secondSeparator = remainder.indexOf(TRIGGER_SEPARATOR)
  if (secondSeparator === -1) {
    return { type, service: remainder.trim(), detail: '' }
  }
  return {
    type,
    service: remainder.slice(0, secondSeparator).trim(),
    // Deliberately keep any further separators as part of the detail.
    detail: remainder.slice(secondSeparator + TRIGGER_SEPARATOR.length).trim()
  }
}

/**
 * Read repeatable triggers, preferring the canonical list attribute and
 * falling back to the legacy flat trio for older files.
 */
export function parseTriggers(
  props: Pick<OrgProps, 'triggers' | 'trigger' | 'triggerService' | 'triggerDetail'>
): TriggerEntry[] {
  if (props.triggers?.trim()) {
    return splitList(props.triggers)
      .map(parseTriggerLine)
      .filter((entry): entry is TriggerEntry => entry !== null)
  }
  const legacyType = props.trigger?.trim() ?? ''
  if (!legacyType) return []
  return [
    {
      type: legacyType,
      service: props.triggerService?.trim() ?? '',
      detail: props.triggerDetail?.trim() ?? ''
    }
  ]
}

/**
 * Write the canonical trigger list plus a row-zero legacy mirror so old
 * readers continue to understand newly saved files.
 */
export function serializeTriggers(
  entries: readonly TriggerEntry[]
): Pick<OrgProps, 'triggers' | 'trigger' | 'triggerService' | 'triggerDetail'> {
  const normalized = entries
    .map((entry) => ({
      type: entry.type.trim(),
      service: entry.service.trim(),
      detail: entry.detail.trim()
    }))
    .filter((entry) => entry.type !== '')

  const lines = normalized.map((entry) => {
    let line = entry.type
    if (entry.service || entry.detail) line += TRIGGER_SEPARATOR + entry.service
    if (entry.detail) line += TRIGGER_SEPARATOR + entry.detail
    return line
  })
  const first = normalized[0]
  return {
    triggers: joinList(lines),
    trigger: first?.type ?? '',
    triggerService: first?.service ?? '',
    triggerDetail: first?.detail ?? ''
  }
}

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
export function getProcessElement(
  modeler: OrgModeler
): OrgElementLike | BusinessObjectLike | undefined {
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
function toBusinessObject(
  el: OrgElementLike | BusinessObjectLike | undefined
): BusinessObjectLike | undefined {
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
 * of the shape and joined with an Association). In paired mode, empty text
 * clears only the active language and projects a retained opposite-language
 * value; the annotation is removed only when both sides are empty. Legacy
 * unpaired calls retain the original remove-on-empty behavior.
 */
export function setStepNote(
  modeler: OrgModeler,
  element: OrgElementLike,
  text: string,
  activeLanguage?: OrgProjectionLanguage
): void {
  const modeling = modeler.get('modeling')
  const existing = findLinkedAnnotation(modeler, element)
  if (existing) {
    if (text) {
      const properties: Record<string, string | undefined> = { text }
      if (activeLanguage) {
        properties[activeLanguage === 'ar' ? 'orbitpm:nameAr' : 'orbitpm:nameEn'] = text
      }
      modeling.updateProperties(existing, properties)
    } else if (activeLanguage) {
      const current = getOrgProps(existing)
      const activeKey = activeLanguage === 'ar' ? 'nameAr' : 'nameEn'
      const opposite = activeLanguage === 'ar' ? current.nameEn : current.nameAr
      if (opposite?.trim()) {
        modeling.updateProperties(existing, {
          text: opposite,
          [PROP_TO_ATTR[activeKey]]: undefined
        })
      } else {
        modeling.removeElements([existing])
      }
    } else {
      modeling.removeElements([existing])
    }
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
  const properties: Record<string, string> = { text }
  if (activeLanguage) {
    properties[activeLanguage === 'ar' ? 'orbitpm:nameAr' : 'orbitpm:nameEn'] = text
  }
  modeling.updateProperties(annotation, properties)
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
