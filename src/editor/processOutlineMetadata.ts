import { getDiagramLang, type DiagramLang, type LangToggleModeler } from './langToggle'
import {
  getLinkedNote,
  getOrgProps,
  parseTriggers,
  serializeTriggers,
  setOrgProps,
  setStepNote,
  type OrgElementLike,
  type OrgModeler,
  type TriggerEntry
} from '../org/orgModel'

/**
 * The organizational fields exposed by Step Details for a selected BPMN
 * element. Keeping the outline projection identical means keyboard-only
 * authors do not lose functionality when they cannot use the canvas.
 */
export interface ProcessOutlineNodeMetadata {
  owner: string
  ownerType: string
  ownerRole: string
  note: string
  channel: string
  channelDetail: string
  cc: boolean
  ccTo: string
  triggers: TriggerEntry[]
  nameEn: string
  nameAr: string
  inputs: string
  outputs: string
  system: string
  respList: string
  ccList: string
  decisionBasis: string
}

export interface ProcessOutlineMetadataVisibility {
  owner: true
  note: true
  stepData: true
  channel: boolean
  cc: boolean
  triggers: boolean
  decisionBasis: boolean
}

const TASK_TYPES = new Set<string>([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ScriptTask'
])

const CHANNEL_TYPES = new Set<string>([
  ...TASK_TYPES,
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent'
])

const DECISION_BASIS_TYPES = new Set<string>([
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ComplexGateway',
  'bpmn:BusinessRuleTask'
])

export function processOutlineMetadataVisibility(type: string): ProcessOutlineMetadataVisibility {
  return {
    owner: true,
    note: true,
    stepData: true,
    channel: CHANNEL_TYPES.has(type),
    cc: TASK_TYPES.has(type),
    triggers: type === 'bpmn:StartEvent',
    decisionBasis: DECISION_BASIS_TYPES.has(type)
  }
}

export function emptyProcessOutlineNodeMetadata(): ProcessOutlineNodeMetadata {
  return {
    owner: '',
    ownerType: '',
    ownerRole: '',
    note: '',
    channel: '',
    channelDetail: '',
    cc: false,
    ccTo: '',
    triggers: [],
    nameEn: '',
    nameAr: '',
    inputs: '',
    outputs: '',
    system: '',
    respList: '',
    ccList: '',
    decisionBasis: ''
  }
}

interface MetadataBusinessObject {
  name?: unknown
  text?: unknown
  get?: (name: string) => unknown
}

export interface ProcessOutlineMetadataElement extends OrgElementLike {
  id?: string
  type?: string
  businessObject?: MetadataBusinessObject & Record<string, unknown>
  source?: ProcessOutlineMetadataElement | null
  target?: ProcessOutlineMetadataElement | null
}

function readModdleProperty(
  businessObject: MetadataBusinessObject | undefined,
  property: string
): unknown {
  if (!businessObject) return undefined
  try {
    const value = businessObject.get?.(property)
    if (value !== undefined) return value
  } catch {
    // Fall through to the direct property used by structural test doubles.
  }
  return businessObject[property as keyof MetadataBusinessObject]
}

function sameElement(
  left: ProcessOutlineMetadataElement | null | undefined,
  right: ProcessOutlineMetadataElement
): boolean {
  return Boolean(
    left &&
    (left === right ||
      (typeof left.id === 'string' && typeof right.id === 'string' && left.id === right.id))
  )
}

function linkedNoteText(
  element: ProcessOutlineMetadataElement,
  elements: readonly ProcessOutlineMetadataElement[]
): string {
  for (const connection of elements) {
    if (connection.type !== 'bpmn:Association') continue
    const annotation = sameElement(connection.source, element)
      ? connection.target
      : sameElement(connection.target, element)
        ? connection.source
        : undefined
    if (annotation?.type !== 'bpmn:TextAnnotation') continue
    const value = readModdleProperty(annotation.businessObject, 'text')
    return typeof value === 'string' ? value : ''
  }
  return ''
}

function visibleName(element: ProcessOutlineMetadataElement): string {
  const value = readModdleProperty(element.businessObject, 'name')
  return typeof value === 'string' ? value : ''
}

function hasArabicScript(value: string): boolean {
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(value)
}

function canSeedActiveName(
  visible: string,
  oppositeStoredName: string,
  activeLanguage: DiagramLang
): boolean {
  const normalizedVisible = visible.trim()
  if (!normalizedVisible) return false
  if (oppositeStoredName.trim() && normalizedVisible === oppositeStoredName.trim()) {
    return false
  }
  return activeLanguage === 'ar'
    ? hasArabicScript(normalizedVisible)
    : !hasArabicScript(normalizedVisible)
}

/**
 * Project one node's complete Step Details field set without mutating the
 * diagram. The active language alone may be seeded from a legacy visible
 * label; the opposite language is never guessed.
 */
export function readProcessOutlineNodeMetadata(
  element: ProcessOutlineMetadataElement,
  elements: readonly ProcessOutlineMetadataElement[],
  activeLanguage: DiagramLang
): ProcessOutlineNodeMetadata {
  const org = getOrgProps(element)
  const metadata: ProcessOutlineNodeMetadata = {
    ...emptyProcessOutlineNodeMetadata(),
    owner: org.owner ?? '',
    ownerType: org.ownerType ?? '',
    ownerRole: org.ownerRole ?? '',
    note: linkedNoteText(element, elements),
    channel: org.channel ?? '',
    channelDetail: org.channelDetail ?? '',
    cc: org.kind === 'cc',
    ccTo: org.ccTo ?? '',
    triggers: parseTriggers(org),
    nameEn: org.nameEn ?? '',
    nameAr: org.nameAr ?? '',
    inputs: org.inputs ?? '',
    outputs: org.outputs ?? '',
    system: org.system ?? '',
    respList: org.respList ?? '',
    ccList: org.ccList ?? '',
    decisionBasis: org.decisionBasis ?? ''
  }
  const currentName = visibleName(element)
  if (activeLanguage === 'en' && !metadata.nameEn.trim()) {
    if (canSeedActiveName(currentName, metadata.nameAr, activeLanguage)) {
      metadata.nameEn = currentName
    }
  }
  if (activeLanguage === 'ar' && !metadata.nameAr.trim()) {
    if (canSeedActiveName(currentName, metadata.nameEn, activeLanguage)) {
      metadata.nameAr = currentName
    }
  }
  return metadata
}

export interface ProcessOutlineMetadataModeler {
  get(name: string): unknown
}

export function getProcessOutlineActiveLanguage(
  modeler: ProcessOutlineMetadataModeler
): DiagramLang {
  return getDiagramLang(modeler as LangToggleModeler)
}

/**
 * Persist the complete metadata bag with the same merge semantics as Step
 * Details. setOrgProps updates only recognized attributes, so unknown
 * attributes and extensionElements remain physically attached to the
 * business object.
 */
export function applyProcessOutlineNodeMetadata(
  modeler: ProcessOutlineMetadataModeler,
  element: ProcessOutlineMetadataElement,
  metadata: ProcessOutlineNodeMetadata
): void {
  const orgModeler = modeler as unknown as OrgModeler
  const current = getOrgProps(element)
  setOrgProps(orgModeler, element, {
    ...current,
    owner: metadata.owner,
    ownerType: metadata.ownerType,
    ownerRole: metadata.ownerRole,
    channel: metadata.channel,
    channelDetail: metadata.channelDetail,
    kind: metadata.cc ? 'cc' : current.kind === 'cc' ? undefined : current.kind,
    ccTo: metadata.ccTo,
    ...serializeTriggers(metadata.triggers),
    nameEn: metadata.nameEn,
    nameAr: metadata.nameAr,
    inputs: metadata.inputs,
    outputs: metadata.outputs,
    system: metadata.system,
    respList: metadata.respList,
    ccList: metadata.ccList,
    decisionBasis: metadata.decisionBasis
  })

  if ((getLinkedNote(orgModeler, element)?.text ?? '') !== metadata.note) {
    setStepNote(orgModeler, element, metadata.note)
  }
}

export function activeProcessOutlineNodeName(
  metadata: Pick<ProcessOutlineNodeMetadata, 'nameEn' | 'nameAr'>,
  activeLanguage: DiagramLang
): string {
  return activeLanguage === 'ar' ? metadata.nameAr.trim() : metadata.nameEn.trim()
}

/**
 * Visible-label projection for outline edits. A missing active translation
 * may display the stored opposite translation, but the active field remains
 * empty so the fallback cannot masquerade as a completed translation.
 */
export function projectedProcessOutlineNodeName(
  metadata: Pick<ProcessOutlineNodeMetadata, 'nameEn' | 'nameAr'>,
  activeLanguage: DiagramLang
): string {
  const activeName = activeProcessOutlineNodeName(metadata, activeLanguage)
  if (activeName) return activeName
  return activeLanguage === 'ar' ? metadata.nameEn.trim() : metadata.nameAr.trim()
}
