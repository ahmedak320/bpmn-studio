import { executeModelingBatch, type ModelingBatchUpdate } from '../editor/modelingBatch'
import { auditLocalizationFields } from './audit'
import { SEEDED_GLOSSARY } from './glossary'
import { prepareLocalizationIngestion } from './ingestion'
import { planLanguageProjection, type LocalResourcePlanOptions } from './plan'
import {
  LocalizationSource,
  type LanguageCode,
  type LocalizationField,
  type LocalizationIssue,
  type LocalizationPatch,
  type LocalizationResources,
  type LocalizationSource as LocalizationSourceType,
  type ProviderFailure,
  type TranslationQueueItem
} from './types'

interface ModdleLike {
  $type?: string
  $attrs?: Record<string, unknown>
  $parent?: unknown
  get?: (name: string) => unknown
  [key: string]: unknown
}

interface RegistryElementLike {
  id?: string
  businessObject?: ModdleLike
  labelTarget?: unknown
}

interface RegistryLike {
  getAll(): RegistryElementLike[]
}

interface CanvasLike {
  getRootElement(): RegistryElementLike | undefined
}

export interface LocalizationModeler {
  get(name: string): unknown
  getDefinitions?: () => unknown
}

export interface DiagramLocalizationReview {
  source: LocalizationSourceType
  target: LanguageCode
  fields: LocalizationField[]
  issues: LocalizationIssue[]
  queue: TranslationQueueItem[]
  localUpdates: LocalizationPatch[]
  projected: number
  unchanged: number
  blockers: LocalizationIssue[]
  complete: boolean
  /** Exact glossary/TM inputs retained for stale checks and post-audits. */
  localResources: LocalizationResources
}

export interface InspectDiagramLocalizationOptions extends LocalResourcePlanOptions {
  source?: LocalizationSourceType
  providerFailures?: readonly ProviderFailure[]
}

export interface ApplyDiagramLocalizationResult {
  target: LanguageCode
  active: LanguageCode
  switched: number
  missing: number
  fallbackCount: number
  complete: boolean
  issues: LocalizationIssue[]
  review: DiagramLocalizationReview
}

export class StaleLocalizationReviewError extends Error {
  constructor() {
    super(
      'The diagram changed after translation review. Review the current text before sending it.'
    )
    this.name = 'StaleLocalizationReviewError'
  }
}

function read(object: ModdleLike | undefined, name: string): unknown {
  if (!object) return undefined
  if (typeof object.get === 'function') {
    try {
      const value = object.get(name)
      if (value !== undefined) return value
    } catch {
      // Direct/$attrs storage remains a valid fallback.
    }
  }
  if (Object.prototype.hasOwnProperty.call(object, name)) return object[name]
  return object.$attrs?.[name]
}

function text(value: unknown): string | undefined {
  if (value == null) return undefined
  const result = String(value)
  return result.trim() === '' ? undefined : result
}

function definitionsOf(modeler: LocalizationModeler): unknown {
  if (typeof modeler.getDefinitions === 'function') {
    const definitions = modeler.getDefinitions()
    if (definitions) return definitions
  }
  const registry = modeler.get('elementRegistry') as RegistryLike
  const root = (modeler.get('canvas') as CanvasLike).getRootElement()
  const rootElements: ModdleLike[] = []
  const seen = new Set<ModdleLike>()
  const add = (bo: ModdleLike | undefined): void => {
    if (!bo || seen.has(bo)) return
    seen.add(bo)
    rootElements.push(bo)
  }
  const registryObjects = registry
    .getAll()
    .filter((element) => element.labelTarget == null)
    .map((element) => element.businessObject)
    .filter((object): object is ModdleLike => object !== undefined)
  const rootBo = root?.businessObject
  if (rootBo && typeOf(rootBo) === 'bpmn:Process') {
    // Structural unit fakes do not expose Modeler#getDefinitions and often
    // omit `$parent`. A shallow process view supplies ownership to extraction
    // without mutating any live business object.
    rootElements.push({
      ...rootBo,
      id: idOf(rootBo) ?? root?.id,
      flowElements: registryObjects.filter((object) => object !== rootBo)
    })
  } else {
    add(rootBo)
    for (const object of registryObjects) add(object)
  }
  return { rootElements }
}

function childObjects(object: ModdleLike): ModdleLike[] {
  const output: ModdleLike[] = []
  for (const [key, value] of Object.entries(object)) {
    if (
      key === '$attrs' ||
      key === '$parent' ||
      key === '$model' ||
      key === '$descriptor' ||
      key === 'incoming' ||
      key === 'outgoing' ||
      key.endsWith('Ref')
    ) {
      continue
    }
    const values = Array.isArray(value) ? value : [value]
    for (const candidate of values) {
      if (candidate && typeof candidate === 'object') {
        output.push(candidate as ModdleLike)
      }
    }
  }
  return output
}

function collectObjects(root: unknown): ModdleLike[] {
  if (!root || typeof root !== 'object') return []
  const output: ModdleLike[] = []
  const seen = new WeakSet<object>()
  const visit = (object: ModdleLike): void => {
    if (seen.has(object)) return
    seen.add(object)
    output.push(object)
    for (const child of childObjects(object)) visit(child)
  }
  visit(root as ModdleLike)
  return output
}

function typeOf(object: ModdleLike): string {
  return typeof read(object, '$type') === 'string' ? String(read(object, '$type')) : ''
}

function idOf(object: ModdleLike | undefined): string | undefined {
  return text(read(object, 'id'))?.trim()
}

function reviewSignature(review: Pick<DiagramLocalizationReview, 'target' | 'queue'>): string {
  return JSON.stringify({
    target: review.target,
    queue: review.queue.map((item) => [
      item.processId,
      item.elementId,
      item.field,
      item.sourceLanguage,
      item.sourceValue,
      item.target
    ])
  })
}

/** Ensure the exact text approved in the review still matches the live model. */
export function assertLocalizationReviewCurrent(
  modeler: LocalizationModeler,
  review: DiagramLocalizationReview
): void {
  const current = inspectDiagramLocalization(modeler, review.target, {
    source: review.source,
    ...review.localResources
  })
  if (reviewSignature(current) !== reviewSignature(review)) {
    throw new StaleLocalizationReviewError()
  }
}

export function inspectDiagramLocalization(
  modeler: LocalizationModeler,
  target: LanguageCode,
  options: InspectDiagramLocalizationOptions = {}
): DiagramLocalizationReview {
  const localResources: LocalizationResources = Object.freeze({
    glossary: Object.freeze(
      (options.glossary ?? SEEDED_GLOSSARY).map((entry) => Object.freeze({ ...entry }))
    ),
    translationMemory: Object.freeze(
      (options.translationMemory ?? []).map((entry) => Object.freeze({ ...entry }))
    )
  })
  const ingestion = prepareLocalizationIngestion(definitionsOf(modeler), {
    ...options,
    ...localResources,
    source: options.source ?? LocalizationSource.Editor,
    target
  })
  return {
    source: ingestion.source,
    target,
    fields: ingestion.localPlan.fields,
    issues: ingestion.audit.issues,
    queue: ingestion.queue,
    localUpdates: ingestion.localPlan.updates,
    projected: ingestion.projection.projected,
    unchanged: ingestion.projection.unchanged,
    blockers: ingestion.projection.blockers,
    complete: ingestion.projection.complete,
    localResources
  }
}

function fieldKey(
  value: Pick<LocalizationField | LocalizationPatch, 'processId' | 'elementId' | 'field'>
): string {
  return `${value.processId}\u0000${value.elementId}\u0000${value.field}`
}

function resolveObject(
  patch: LocalizationPatch,
  objects: readonly ModdleLike[],
  directById: ReadonlyMap<string, ModdleLike>
): ModdleLike | undefined {
  const direct = directById.get(patch.elementId)
  if (direct) return direct
  const match = /^(.*)::([^:]+):(\d+)$/.exec(patch.elementId)
  if (!match) return undefined
  const [, parentOrProcess, localType, ordinalText] = match
  const ordinal = Number(ordinalText)
  const candidates = objects.filter((object) => {
    const type = typeOf(object)
    const local = type.includes(':') ? type.slice(type.indexOf(':') + 1) : type
    if (local !== localType) return false
    const parent =
      object.$parent && typeof object.$parent === 'object'
        ? idOf(object.$parent as ModdleLike)
        : undefined
    return (parent ?? patch.processId) === parentOrProcess
  })
  return candidates[ordinal - 1]
}

function activeLanguagePatches(
  fields: readonly LocalizationField[],
  target: LanguageCode
): LocalizationPatch[] {
  const processIds = [...new Set(fields.map((field) => field.processId))]
  return processIds.map((processId) => ({
    source: fields[0]?.source ?? LocalizationSource.Editor,
    processId,
    elementId: processId,
    field: '__activeLang',
    property: 'orbitpm:activeLang',
    value: target,
    target,
    reason: 'projection'
  }))
}

function activeLanguageOf(modeler: LocalizationModeler): LanguageCode {
  const root = (modeler.get('canvas') as CanvasLike).getRootElement()
  let object = root?.businessObject
  if (typeOf(object ?? {}) === 'bpmn:Collaboration') {
    const participants = read(object, 'participants')
    const processRef = Array.isArray(participants)
      ? (participants[0] as { processRef?: ModdleLike } | undefined)?.processRef
      : undefined
    if (processRef) object = processRef
  }
  return text(read(object, 'orbitpm:activeLang')) === 'ar' ? 'ar' : 'en'
}

/** Postcondition for a claimed language switch, including legacy/SVG values. */
export function isDiagramLocalizationProjected(
  modeler: LocalizationModeler,
  review: DiagramLocalizationReview
): boolean {
  return (
    activeLanguageOf(modeler) === review.target &&
    review.fields.every(
      (field) =>
        field.value[review.target] !== undefined && field.projection === field.value[review.target]
    )
  )
}

/**
 * Apply metadata, visible projection, and active-language changes as one
 * command-stack transaction. Patches for one business object are coalesced.
 */
export function applyLocalizationPatchesAtomically(
  modeler: LocalizationModeler,
  patches: readonly LocalizationPatch[]
): void {
  if (patches.length === 0) return
  const definitions = definitionsOf(modeler)
  const objects = collectObjects(definitions)
  const directById = new Map<string, ModdleLike>()
  for (const object of objects) {
    const id = idOf(object)
    if (id && !directById.has(id)) directById.set(id, object)
  }
  const registry = modeler.get('elementRegistry') as RegistryLike
  const registryTargets = new Map<ModdleLike, RegistryElementLike>()
  // Prefer actual registry/root business objects over synthesized extraction
  // views when their ids match.
  for (const element of registry.getAll()) {
    if (element.labelTarget != null || !element.businessObject) continue
    registryTargets.set(element.businessObject, element)
    const id = element.id ?? idOf(element.businessObject)
    if (id) directById.set(id, element.businessObject)
  }
  const root = (modeler.get('canvas') as CanvasLike).getRootElement()
  if (root?.businessObject) {
    registryTargets.set(root.businessObject, root)
    const id = root.id ?? idOf(root.businessObject)
    if (id) directById.set(id, root.businessObject)
  }

  const propertiesByObject = new Map<ModdleLike, Record<string, unknown>>()
  for (const patch of patches) {
    const object = resolveObject(patch, objects, directById)
    if (!object) continue
    const current = text(read(object, patch.property))
    if (
      patch.expectedValue !== undefined &&
      current !== patch.expectedValue &&
      current !== patch.value
    ) {
      throw new StaleLocalizationReviewError()
    }
    if (current === patch.value) continue
    const properties = propertiesByObject.get(object) ?? {}
    properties[patch.property] = patch.value
    propertiesByObject.set(object, properties)
  }

  const updates: ModelingBatchUpdate[] = []
  for (const [object, properties] of propertiesByObject) {
    updates.push({
      kind: 'properties',
      element: registryTargets.get(object) ?? { businessObject: object },
      properties
    })
  }
  executeModelingBatch(modeler, updates)
}

/**
 * Project a reviewed target. Incomplete projection is permitted only for the
 * explicit partial-preview action; ordinary switching leaves the display and
 * active-language marker unchanged.
 */
export function applyDiagramLocalizationReview(
  modeler: LocalizationModeler,
  review: DiagramLocalizationReview,
  options: { allowPartial?: boolean } = {}
): ApplyDiagramLocalizationResult {
  assertLocalizationReviewCurrent(modeler, review)
  const projection = planLanguageProjection(review.fields, review.target, {
    allowPartial: options.allowPartial,
    glossary: review.localResources.glossary
  })
  if (!projection.complete && !options.allowPartial) {
    return {
      target: review.target,
      active: review.target === 'en' ? 'ar' : 'en',
      switched: 0,
      missing: projection.blockers.length,
      fallbackCount: 0,
      complete: false,
      issues: projection.blockers,
      review
    }
  }
  const patches = [
    ...review.localUpdates,
    ...projection.updates,
    ...activeLanguagePatches(review.fields, review.target)
  ]
  applyLocalizationPatchesAtomically(modeler, patches)
  let post = inspectDiagramLocalization(modeler, review.target, {
    source: review.source,
    ...review.localResources
  })
  let postAudit = auditLocalizationFields(post.fields, {
    glossary: review.localResources.glossary
  })
  let targetIssues = postAudit.issues.filter((issue) => issue.target === review.target)
  const projectionPersisted = isDiagramLocalizationProjected(modeler, post)
  if (projection.complete && (targetIssues.length > 0 || !projectionPersisted)) {
    // A real command-stack batch is one undo entry. If a moddle/renderer
    // anomaly defeats the post-audit, roll the whole attempted projection
    // back so an active-language marker can never claim false completion.
    try {
      ;(modeler.get('commandStack') as { undo(): void }).undo()
      post = inspectDiagramLocalization(modeler, review.target, {
        source: review.source,
        ...review.localResources
      })
      postAudit = auditLocalizationFields(post.fields, {
        glossary: review.localResources.glossary
      })
      targetIssues = postAudit.issues.filter((issue) => issue.target === review.target)
    } catch {
      /* structural test doubles have no undo service */
    }
  }
  return {
    target: review.target,
    active: activeLanguageOf(modeler),
    switched: projection.projected,
    missing: projection.blockers.length,
    fallbackCount: projection.fallbackCount,
    complete: targetIssues.length === 0 && isDiagramLocalizationProjected(modeler, post),
    issues: targetIssues,
    review: post
  }
}

/** Test/integration helper: returns the exact virtual field matching a queue item. */
export function findReviewedField(
  review: DiagramLocalizationReview,
  item: TranslationQueueItem
): LocalizationField | undefined {
  return review.fields.find((field) => fieldKey(field) === fieldKey(item))
}
