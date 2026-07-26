import { classifyScript } from './script'
import {
  LocalizationSource,
  type LanguageCode,
  type LocalizationField,
  type LocalizationFieldKind,
  type LocalizationSource as LocalizationSourceType,
  type LocalizationStorage
} from './types'

export interface ModdleElementLike {
  $type?: string
  $attrs?: Record<string, unknown>
  $parent?: unknown
  get?: (name: string) => unknown
  [key: string]: unknown
}

export interface ExtractBpmnLocalizationOptions {
  source?: LocalizationSourceType
  defaultActive?: LanguageCode
}

export interface MetadataFieldSpec {
  field: string
  base: string
  en: string
  ar: string
}

/**
 * Every currently supported translatable organizational/detail attribute.
 * Categorical/code fields (`channel`, `kind`, `ownerType`, `trigger`) are
 * intentionally absent. Their free-text detail/service/list counterparts are
 * included.
 */
export const TRANSLATABLE_METADATA_FIELDS: readonly MetadataFieldSpec[] = Object.freeze([
  { field: 'owner', base: 'owner', en: 'ownerEn', ar: 'ownerAr' },
  {
    field: 'department',
    base: 'department',
    en: 'departmentEn',
    ar: 'departmentAr'
  },
  {
    field: 'ownerRole',
    base: 'ownerRole',
    en: 'ownerRoleEn',
    ar: 'ownerRoleAr'
  },
  {
    field: 'channelDetail',
    base: 'channelDetail',
    en: 'channelDetailEn',
    ar: 'channelDetailAr'
  },
  { field: 'ccTo', base: 'ccTo', en: 'ccToEn', ar: 'ccToAr' },
  {
    field: 'triggerService',
    base: 'triggerService',
    en: 'triggerServiceEn',
    ar: 'triggerServiceAr'
  },
  {
    field: 'triggerDetail',
    base: 'triggerDetail',
    en: 'triggerDetailEn',
    ar: 'triggerDetailAr'
  },
  {
    field: 'triggers',
    base: 'triggers',
    en: 'triggersEn',
    ar: 'triggersAr'
  },
  { field: 'inputs', base: 'inputs', en: 'inputsEn', ar: 'inputsAr' },
  { field: 'outputs', base: 'outputs', en: 'outputsEn', ar: 'outputsAr' },
  { field: 'system', base: 'system', en: 'systemEn', ar: 'systemAr' },
  {
    field: 'respList',
    base: 'respList',
    en: 'respListEn',
    ar: 'respListAr'
  },
  { field: 'ccList', base: 'ccList', en: 'ccListEn', ar: 'ccListAr' },
  {
    field: 'decisionBasis',
    base: 'decisionBasis',
    en: 'decisionBasisEn',
    ar: 'decisionBasisAr'
  },
  {
    field: 'description',
    base: 'description',
    en: 'descriptionEn',
    ar: 'descriptionAr'
  },
  { field: 'notes', base: 'notes', en: 'notesEn', ar: 'notesAr' }
])

const ORBITPM_PREFIX = 'orbitpm:'

const STRUCTURAL_PROPERTIES = [
  'rootElement',
  'rootElements',
  'diagrams',
  'plane',
  'planeElement',
  'bpmnElement',
  'participants',
  'processRef',
  'messageFlows',
  'conversationNodes',
  'flowElements',
  'artifacts',
  'laneSets',
  'lanes',
  'childLaneSet',
  'flowNodeRef',
  'documentation',
  'extensionElements',
  'values',
  'eventDefinitions',
  'ioSpecification',
  'dataInputs',
  'dataOutputs',
  'properties',
  'resources',
  'resourceParameters',
  'dataInputAssociations',
  'dataOutputAssociations',
  'sourceRef',
  'targetRef',
  'attachedToRef',
  'incoming',
  'outgoing'
] as const

const NON_OWNED_REFERENCES = new Set([
  'bpmnElement',
  'processRef',
  'flowNodeRef',
  'sourceRef',
  'targetRef',
  'attachedToRef',
  'incoming',
  'outgoing',
  'default',
  'di'
])

function isObject(value: unknown): value is ModdleElementLike {
  return typeof value === 'object' && value !== null
}

function readProperty(object: ModdleElementLike, name: string): unknown {
  if (typeof object.get === 'function') {
    try {
      const value = object.get(name)
      if (value !== undefined) return value
    } catch {
      // Unknown extension properties may make moddle.get throw. Direct and
      // `$attrs` storage remain valid fallbacks.
    }
  }
  return object[name]
}

function hasProperty(object: ModdleElementLike, name: string): boolean {
  if (Object.prototype.hasOwnProperty.call(object, name)) return true
  if (typeof object.get === 'function') {
    try {
      return object.get(name) !== undefined
    } catch {
      return false
    }
  }
  return false
}

function readOrbitpm(object: ModdleElementLike, localName: string): unknown {
  const qualified = ORBITPM_PREFIX + localName
  if (typeof object.get === 'function') {
    try {
      const value = object.get(qualified)
      if (value !== undefined) return value
    } catch {
      // fall through
    }
  }
  if (Object.prototype.hasOwnProperty.call(object, qualified)) {
    return object[qualified]
  }
  if (Object.prototype.hasOwnProperty.call(object.$attrs ?? {}, qualified)) {
    return object.$attrs?.[qualified]
  }
  // Registered extension properties can also be exposed by their local name.
  return readProperty(object, localName)
}

function hasOrbitpm(object: ModdleElementLike, localName: string): boolean {
  const qualified = ORBITPM_PREFIX + localName
  if (
    Object.prototype.hasOwnProperty.call(object, qualified) ||
    Object.prototype.hasOwnProperty.call(object.$attrs ?? {}, qualified) ||
    Object.prototype.hasOwnProperty.call(object, localName)
  ) {
    return true
  }
  if (typeof object.get === 'function') {
    try {
      return object.get(qualified) !== undefined
    } catch {
      return false
    }
  }
  return false
}

function textValue(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  return text.trim() === '' ? undefined : text
}

function readId(object: ModdleElementLike | undefined): string | undefined {
  if (!object) return undefined
  return textValue(readProperty(object, 'id'))?.trim()
}

function readType(object: ModdleElementLike): string {
  const value = readProperty(object, '$type')
  return typeof value === 'string' ? value : ''
}

function asArray(value: unknown): unknown[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function childObjects(object: ModdleElementLike, skipReferences: boolean): ModdleElementLike[] {
  const values: unknown[] = []
  const visitedProperties = new Set<string>()

  for (const key of Object.keys(object)) {
    if (
      key === '$attrs' ||
      key === '$parent' ||
      key === '$model' ||
      key === '$descriptor' ||
      (skipReferences && NON_OWNED_REFERENCES.has(key))
    ) {
      continue
    }
    visitedProperties.add(key)
    values.push(object[key])
  }

  for (const key of STRUCTURAL_PROPERTIES) {
    if (visitedProperties.has(key) || (skipReferences && NON_OWNED_REFERENCES.has(key))) {
      continue
    }
    const value = readProperty(object, key)
    if (value !== undefined) values.push(value)
  }

  const children: ModdleElementLike[] = []
  for (const value of values) {
    for (const candidate of asArray(value)) {
      if (isObject(candidate)) children.push(candidate)
    }
  }
  return children
}

function collectStructuralObjects(root: unknown): ModdleElementLike[] {
  if (!isObject(root)) return []
  const objects: ModdleElementLike[] = []
  const seen = new WeakSet<object>()
  const visit = (object: ModdleElementLike): void => {
    if (seen.has(object)) return
    seen.add(object)
    objects.push(object)
    for (const child of childObjects(object, false)) visit(child)
  }
  visit(root)
  return objects
}

function assignOwnedProcess(
  process: ModdleElementLike,
  processId: string,
  processByObject: WeakMap<object, string>
): void {
  const seen = new WeakSet<object>()
  const visit = (object: ModdleElementLike): void => {
    if (seen.has(object)) return
    seen.add(object)
    processByObject.set(object, processId)
    for (const child of childObjects(object, true)) visit(child)
  }
  visit(process)
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>()
  values.add(value)
  map.set(key, values)
}

function addToWeakSetMap(map: WeakMap<object, Set<string>>, key: object, value: string): void {
  const values = map.get(key) ?? new Set<string>()
  values.add(value)
  map.set(key, values)
}

interface ResolvedActiveLanguage {
  language: LanguageCode
  explicit: boolean
}

function activeLanguage(
  object: ModdleElementLike,
  processId: string,
  activeByProcess: Map<string, LanguageCode>,
  fallback: LanguageCode
): ResolvedActiveLanguage {
  const local = textValue(readOrbitpm(object, 'activeLang'))
  if (local === 'en' || local === 'ar') {
    return { language: local, explicit: true }
  }
  const processLanguage = activeByProcess.get(processId)
  if (processLanguage) return { language: processLanguage, explicit: true }
  return { language: fallback, explicit: false }
}

interface FieldSpec {
  field: string
  kind: LocalizationFieldKind
  projectionProperty: string
  projectionAttribute?: string
  enAttribute: string
  arAttribute: string
}

function primaryFieldSpec(type: string): FieldSpec {
  if (type === 'bpmn:TextAnnotation') {
    return {
      field: 'annotation',
      kind: 'annotation',
      projectionProperty: 'text',
      enAttribute: 'nameEn',
      arAttribute: 'nameAr'
    }
  }
  if (type === 'bpmn:Documentation') {
    return {
      field: 'notes',
      kind: 'notes',
      projectionProperty: 'text',
      enAttribute: 'nameEn',
      arAttribute: 'nameAr'
    }
  }
  if (type === 'bpmn:SequenceFlow') {
    return {
      field: 'condition',
      kind: 'condition',
      projectionProperty: 'name',
      enAttribute: 'nameEn',
      arAttribute: 'nameAr'
    }
  }
  return {
    field: 'name',
    kind: 'name',
    projectionProperty: 'name',
    enAttribute: 'nameEn',
    arAttribute: 'nameAr'
  }
}

function storageFor(spec: FieldSpec): LocalizationStorage {
  return {
    enProperty: ORBITPM_PREFIX + spec.enAttribute,
    arProperty: ORBITPM_PREFIX + spec.arAttribute,
    projectionProperty:
      spec.projectionAttribute === undefined
        ? spec.projectionProperty
        : ORBITPM_PREFIX + spec.projectionAttribute
  }
}

interface ExtractFieldContext {
  source: LocalizationSourceType
  processId: string
  elementId: string
  elementType: string
  active: LanguageCode
  activeExplicit: boolean
  planeIds: readonly string[]
}

function extractField(
  object: ModdleElementLike,
  spec: FieldSpec,
  context: ExtractFieldContext
): LocalizationField | undefined {
  const projectionRaw =
    spec.projectionAttribute === undefined
      ? readProperty(object, spec.projectionProperty)
      : readOrbitpm(object, spec.projectionAttribute)
  const projectionPresent =
    spec.projectionAttribute === undefined
      ? hasProperty(object, spec.projectionProperty)
      : hasOrbitpm(object, spec.projectionAttribute)
  const enRaw = readOrbitpm(object, spec.enAttribute)
  const arRaw = readOrbitpm(object, spec.arAttribute)
  const candidate =
    projectionPresent ||
    hasOrbitpm(object, spec.enAttribute) ||
    hasOrbitpm(object, spec.arAttribute)
  if (!candidate) return undefined

  const projection = textValue(projectionRaw)
  let en = textValue(enRaw)
  let ar = textValue(arRaw)
  let effectiveActive = context.active
  const origins: LocalizationField['origins'] = {}
  if (en !== undefined) origins.en = 'paired'
  if (ar !== undefined) origins.ar = 'paired'

  let sourceLanguage: LanguageCode | undefined
  if (projection !== undefined) {
    const projectionScript = classifyScript(projection)
    if (!context.activeExplicit) {
      if (projectionScript === 'english') effectiveActive = 'en'
      if (projectionScript === 'arabic') effectiveActive = 'ar'
    }
    const inferred =
      projectionScript === 'english' ? 'en' : projectionScript === 'arabic' ? 'ar' : effectiveActive
    sourceLanguage = inferred
    if (inferred === 'en' && en === undefined) {
      en = projection
      origins.en = 'projection'
    }
    if (inferred === 'ar' && ar === undefined) {
      ar = projection
      origins.ar = 'projection'
    }
  }
  if (projection === undefined) {
    if (en !== undefined && ar === undefined) {
      const script = classifyScript(en)
      if (script === 'arabic') {
        ar = en
        origins.ar = 'script-inferred'
        if (!context.activeExplicit) effectiveActive = 'ar'
        sourceLanguage = 'ar'
      } else if (!context.activeExplicit) {
        effectiveActive = 'en'
      }
    } else if (ar !== undefined && en === undefined) {
      const script = classifyScript(ar)
      if (script === 'english') {
        en = ar
        origins.en = 'script-inferred'
        if (!context.activeExplicit) effectiveActive = 'en'
        sourceLanguage = 'en'
      } else if (!context.activeExplicit) {
        effectiveActive = 'ar'
      }
    }
  }
  if (sourceLanguage === undefined) {
    if (en !== undefined && ar === undefined) sourceLanguage = 'en'
    else if (ar !== undefined && en === undefined) sourceLanguage = 'ar'
    else if (en !== undefined || ar !== undefined) sourceLanguage = effectiveActive
  }

  // A present-but-entirely-blank field is intentionally retained so the audit
  // can report both missing targets instead of silently dropping bad import
  // data.
  return {
    source: context.source,
    processId: context.processId,
    elementId: context.elementId,
    elementType: context.elementType,
    field: spec.field,
    kind: spec.kind,
    value: { en, ar, active: effectiveActive },
    sourceLanguage,
    projection,
    origins,
    storage: storageFor(spec),
    planeIds: context.planeIds
  }
}

function metadataSpec(spec: MetadataFieldSpec): FieldSpec {
  return {
    field: spec.field,
    kind: 'metadata',
    projectionProperty: spec.base,
    projectionAttribute: spec.base,
    enAttribute: spec.en,
    arAttribute: spec.ar
  }
}

function elementIdFor(
  object: ModdleElementLike,
  processId: string,
  type: string,
  ordinalByScope: Map<string, number>
): string {
  const direct = readId(object)
  if (direct) return direct
  const parent = isObject(object.$parent) ? readId(object.$parent as ModdleElementLike) : undefined
  const localType = type.includes(':') ? type.slice(type.indexOf(':') + 1) : type || 'element'
  const key = `${processId}\u0000${parent ?? ''}\u0000${localType}`
  const ordinal = (ordinalByScope.get(key) ?? 0) + 1
  ordinalByScope.set(key, ordinal)
  return `${parent ?? processId}::${localType}:${ordinal}`
}

function processIdsForPlaneElement(
  referenced: ModdleElementLike | undefined,
  processByObject: WeakMap<object, string>
): string[] {
  if (!referenced) return []
  const direct = processByObject.get(referenced)
  if (direct) return [direct]
  if (readType(referenced) === 'bpmn:Process') {
    const id = readId(referenced)
    return id ? [id] : []
  }
  if (readType(referenced) === 'bpmn:Collaboration') {
    const ids = new Set<string>()
    for (const raw of asArray(readProperty(referenced, 'participants'))) {
      if (!isObject(raw)) continue
      const processRef = readProperty(raw, 'processRef')
      if (!isObject(processRef)) continue
      const id = processByObject.get(processRef) ?? readId(processRef)
      if (id) ids.add(id)
    }
    return [...ids]
  }
  return []
}

/**
 * Extract every translatable field reachable from every process and BPMN
 * diagram/plane in a parsed moddle definitions graph. References and cycles
 * are identity-deduplicated; repeated DI planes are retained as provenance.
 */
export function extractBpmnLocalization(
  root: unknown,
  options: ExtractBpmnLocalizationOptions = {}
): LocalizationField[] {
  const source = options.source ?? LocalizationSource.Xml
  const fallbackActive = options.defaultActive ?? 'en'
  const objects = collectStructuralObjects(root)
  const processByObject = new WeakMap<object, string>()
  const activeByProcess = new Map<string, LanguageCode>()

  const processes = objects.filter((object) => readType(object) === 'bpmn:Process')
  for (let index = 0; index < processes.length; index += 1) {
    const process = processes[index]
    const processId = readId(process) ?? `__process_${index + 1}`
    assignOwnedProcess(process, processId, processByObject)
    const active = textValue(readOrbitpm(process, 'activeLang'))
    if (active === 'ar' || active === 'en') {
      activeByProcess.set(processId, active)
    }
  }

  // Participants carry labels but belong to their referenced process, while
  // collaboration-owned message flows/artifacts retain the collaboration id.
  for (const collaboration of objects.filter(
    (object) => readType(object) === 'bpmn:Collaboration'
  )) {
    const collaborationId =
      readId(collaboration) ?? `__collaboration_${objects.indexOf(collaboration) + 1}`
    assignOwnedProcess(collaboration, collaborationId, processByObject)
    for (const rawParticipant of asArray(readProperty(collaboration, 'participants'))) {
      if (!isObject(rawParticipant)) continue
      const processRef = readProperty(rawParticipant, 'processRef')
      if (!isObject(processRef)) continue
      const processId = processByObject.get(processRef) ?? readId(processRef)
      if (processId) processByObject.set(rawParticipant, processId)
    }
  }

  const planeIdsByObject = new WeakMap<object, Set<string>>()
  const planeIdsByProcess = new Map<string, Set<string>>()
  for (const diagram of objects.filter((object) => readType(object) === 'bpmndi:BPMNDiagram')) {
    const planeRaw = readProperty(diagram, 'plane')
    if (!isObject(planeRaw)) continue
    const plane = planeRaw as ModdleElementLike
    const planeId = readId(plane) ?? readId(diagram) ?? `__plane_${objects.indexOf(diagram) + 1}`
    const planeRefRaw = readProperty(plane, 'bpmnElement')
    const planeRef = isObject(planeRefRaw) ? (planeRefRaw as ModdleElementLike) : undefined
    if (planeRef) addToWeakSetMap(planeIdsByObject, planeRef, planeId)
    const planeProcesses = processIdsForPlaneElement(planeRef, processByObject)
    for (const processId of planeProcesses) {
      addToSetMap(planeIdsByProcess, processId, planeId)
    }

    for (const rawPlaneElement of asArray(readProperty(plane, 'planeElement'))) {
      if (!isObject(rawPlaneElement)) continue
      const referencedRaw = readProperty(rawPlaneElement, 'bpmnElement')
      if (!isObject(referencedRaw)) continue
      const referenced = referencedRaw as ModdleElementLike
      addToWeakSetMap(planeIdsByObject, referenced, planeId)
      const referencedProcesses = processIdsForPlaneElement(referenced, processByObject)
      const resolvedProcesses =
        referencedProcesses.length > 0 ? referencedProcesses : planeProcesses
      if (processByObject.get(referenced) === undefined && resolvedProcesses.length === 1) {
        processByObject.set(referenced, resolvedProcesses[0])
      }
      for (const processId of resolvedProcesses) {
        addToSetMap(planeIdsByProcess, processId, planeId)
      }
    }
  }

  const fields: LocalizationField[] = []
  const ordinalByScope = new Map<string, number>()
  for (const object of objects) {
    const type = readType(object)
    if (!type.startsWith('bpmn:')) continue
    if (type === 'bpmn:Definitions') continue

    let processId = processByObject.get(object)
    if (!processId) {
      const parent = isObject(object.$parent) ? (object.$parent as ModdleElementLike) : undefined
      processId = parent ? processByObject.get(parent) : undefined
    }
    processId ??= readId(object) ?? '__unscoped__'
    const elementId = elementIdFor(object, processId, type, ordinalByScope)
    const active = activeLanguage(object, processId, activeByProcess, fallbackActive)
    const planeIds = [
      ...(planeIdsByProcess.get(processId) ?? []),
      ...(planeIdsByObject.get(object) ?? [])
    ]
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort()
    const context: ExtractFieldContext = {
      source,
      processId,
      elementId,
      elementType: type,
      active: active.language,
      activeExplicit: active.explicit,
      planeIds
    }

    const primary = extractField(object, primaryFieldSpec(type), context)
    if (primary) fields.push(primary)
    for (const spec of TRANSLATABLE_METADATA_FIELDS) {
      const field = extractField(object, metadataSpec(spec), context)
      if (field) fields.push(field)
    }
  }

  return fields.sort(
    (left, right) =>
      left.processId.localeCompare(right.processId) ||
      left.elementId.localeCompare(right.elementId) ||
      left.field.localeCompare(right.field)
  )
}
