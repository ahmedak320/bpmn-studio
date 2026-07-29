/**
 * Create ARIS models from the ARIS-native workbook (plan §15), mounted.
 *
 * `src/aris/excel` deliberately stops at `ArisWorkbookModel` — a frozen, fully
 * validated, provenance-carrying in-memory workbook (§15.3 steps 1-8). Steps 9-11
 * (id allocation, layout for missing coordinates, canonical AML) are the caller's,
 * and this module performs them by composing `src/aris/writer`'s emit specs. No
 * AML syntax is invented here: every element is produced by the writer's own
 * record spec builders, which own escaping, canonical child order and indentation.
 *
 * What is deliberately simple is the geometry fallback. §15.3 step 10 asks for a
 * clean layout when coordinates are missing; this module lays missing objects out
 * in one deterministic column per model and gives a routeless connection a
 * straight two-point route. The generated model then opens on the real canvas,
 * where "Clean Layout" — the §14.4 algorithm itself — is one click away. A
 * deterministic placeholder that the real engine can improve is honest; a second
 * layout implementation living here would not be.
 */

import {
  isAcceptedArisWorkbook,
  type ArisWorkbookConnectionRecord,
  type ArisWorkbookModel,
  type ArisWorkbookObjectRecord,
  type ArisWorkbookParseResult
} from '../excel'
import {
  attrDefSpec,
  connectionDefinitionSpec,
  objectDefinitionSpec,
  objectOccurrenceSpec,
  renderRecord,
  type AttributeDefinitionSpec,
  type ConnectionOccurrenceSpec,
  type ElementSpec,
  type PointSpec
} from '../writer'

const EN_LOCALE_ID = '1033'
const AR_LOCALE_ID = '1025'
const DEFAULT_WIDTH = 180
const DEFAULT_HEIGHT = 70
const COLUMN_X = 240
const ROW_STEP = 160
const FIRST_Y = 120

const AT_NAME = 'AT_NAME'
const AT_PROC_CODE = 'AT_PROC_CODE'
const AT_DESC = 'AT_DESC'

function nameAttribute(
  type: string,
  en: string | undefined,
  ar: string | undefined
): AttributeDefinitionSpec | null {
  const values = []
  if (en !== undefined && en !== '') values.push({ localeId: EN_LOCALE_ID, text: en })
  if (ar !== undefined && ar !== '') values.push({ localeId: AR_LOCALE_ID, text: ar })
  if (values.length === 0) return null
  return { type, values }
}

function boundsFor(
  object: ArisWorkbookObjectRecord,
  fallbackIndex: number
): { readonly position: PointSpec; readonly size: { readonly dx: number; readonly dy: number } } {
  return {
    position: {
      x: Math.round(object.x?.value ?? COLUMN_X),
      y: Math.round(object.y?.value ?? FIRST_Y + fallbackIndex * ROW_STEP)
    },
    size: {
      dx: Math.round(object.width?.value ?? DEFAULT_WIDTH),
      dy: Math.round(object.height?.value ?? DEFAULT_HEIGHT)
    }
  }
}

function routeFor(
  connection: ArisWorkbookConnectionRecord,
  from: {
    readonly position: PointSpec
    readonly size: { readonly dx: number; readonly dy: number }
  },
  to: { readonly position: PointSpec; readonly size: { readonly dx: number; readonly dy: number } }
): readonly PointSpec[] {
  const declared = connection.routePoints?.value
  if (declared && declared.length > 0) {
    return declared.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
  }
  return [
    {
      x: Math.round(from.position.x + from.size.dx / 2),
      y: Math.round(from.position.y + from.size.dy)
    },
    { x: Math.round(to.position.x + to.size.dx / 2), y: Math.round(to.position.y) }
  ]
}

/** Deterministic ARIS-shaped ids derived from the workbook's own ids. */
export function arisIdForWorkbookId(prefix: string, id: string): string {
  return `${prefix}.${id}`
}

export interface ArisWorkbookAmlResult {
  readonly xml: string
  readonly modelCount: number
  readonly objectCount: number
  readonly connectionCount: number
}

/**
 * Generate one canonical AML document carrying every model in `workbook`.
 *
 * Object DEFINITIONS are shared across occurrences (`occurrencesByObjectId`), which
 * is what makes the result a real ARIS document rather than a flattened drawing.
 */
export function buildAmlFromArisWorkbook(workbook: ArisWorkbookModel): ArisWorkbookAmlResult {
  const attributesByOwner = new Map<string, AttributeDefinitionSpec[]>()
  for (const attribute of workbook.attributes) {
    const text = attribute.value?.value ?? ''
    if (text === '') continue
    const localeId = attribute.language?.value === 'ar' ? AR_LOCALE_ID : EN_LOCALE_ID
    const key = `${attribute.ownerKind.value}:${attribute.ownerId.value}`
    const list = attributesByOwner.get(key) ?? []
    const existing = list.find((entry) => entry.type === attribute.attributeType.value)
    if (existing) {
      list[list.indexOf(existing)] = {
        type: existing.type,
        values: [...existing.values, { localeId, text }]
      }
    } else {
      list.push({ type: attribute.attributeType.value, values: [{ localeId, text }] })
    }
    attributesByOwner.set(key, list)
  }

  // --- object definitions, shared across every model ---------------------------
  const definitionSpecs: ElementSpec[] = []
  const connectionDefinitionsByObject = new Map<string, string[]>()
  const connectionDefinitionSpecs = new Map<string, ElementSpec>()

  const connectionDefinitionId = (connection: ArisWorkbookConnectionRecord): string =>
    arisIdForWorkbookId('CxnDef', connection.connectionId.value)

  for (const connection of workbook.connections) {
    const source = workbook.index.occurrencesById.get(connection.sourceOccurrenceId.value)
    const target = workbook.index.occurrencesById.get(connection.targetOccurrenceId.value)
    if (!source || !target) continue
    const definitionId = connectionDefinitionId(connection)
    const owner = source.objectId.value
    const list = connectionDefinitionsByObject.get(owner) ?? []
    list.push(definitionId)
    connectionDefinitionsByObject.set(owner, list)
    connectionDefinitionSpecs.set(
      definitionId,
      connectionDefinitionSpec({
        id: definitionId,
        type: connection.connectionType.value,
        targetObjectDefinitionId: arisIdForWorkbookId('ObjDef', target.objectId.value)
      })
    )
  }

  const seenObjectIds = new Set<string>()
  for (const object of workbook.objects) {
    const objectId = object.objectId.value
    if (seenObjectIds.has(objectId)) continue
    seenObjectIds.add(objectId)
    const attributes: AttributeDefinitionSpec[] = []
    const name = nameAttribute(AT_NAME, object.nameEn.value, object.nameAr?.value)
    if (name) attributes.push(name)
    attributes.push(...(attributesByOwner.get(`object:${objectId}`) ?? []))
    const definitionIds = connectionDefinitionsByObject.get(objectId) ?? []
    definitionSpecs.push(
      objectDefinitionSpec({
        id: arisIdForWorkbookId('ObjDef', objectId),
        typeNum: object.objectType.value,
        symbolNum: object.symbolType.value,
        ...(definitionIds.length > 0 ? { connectionDefinitionIds: definitionIds } : {}),
        attributes,
        connectionDefinitions: []
      })
    )
  }

  // Connection definitions live beside the object definitions in the group.
  const groupChildren: ElementSpec[] = [...definitionSpecs, ...connectionDefinitionSpecs.values()]

  // --- models ------------------------------------------------------------------
  let objectCount = 0
  let connectionCount = 0
  for (const model of workbook.models) {
    const modelId = model.modelId.value
    const objects = workbook.index.objectsByModelId.get(modelId) ?? []
    const connections = workbook.index.connectionsByModelId.get(modelId) ?? []

    const geometry = new Map<
      string,
      { readonly position: PointSpec; readonly size: { readonly dx: number; readonly dy: number } }
    >()
    objects.forEach((object, index) => {
      geometry.set(object.occurrenceId.value, boundsFor(object, index))
    })

    const connectionsBySource = new Map<string, ArisWorkbookConnectionRecord[]>()
    for (const connection of connections) {
      const list = connectionsBySource.get(connection.sourceOccurrenceId.value) ?? []
      list.push(connection)
      connectionsBySource.set(connection.sourceOccurrenceId.value, list)
    }

    const occurrenceSpecs: ElementSpec[] = objects.map((object, index) => {
      const occurrenceId = object.occurrenceId.value
      const bounds = geometry.get(occurrenceId) ?? boundsFor(object, index)
      const outgoing = (connectionsBySource.get(occurrenceId) ?? []).filter((connection) =>
        geometry.has(connection.targetOccurrenceId.value)
      )
      const nested: ConnectionOccurrenceSpec[] = outgoing.map((connection) => ({
        id: arisIdForWorkbookId('CxnOcc', connection.connectionId.value),
        connectionDefinitionId: connectionDefinitionId(connection),
        targetObjectOccurrenceId: arisIdForWorkbookId(
          'ObjOcc',
          connection.targetOccurrenceId.value
        ),
        // Non-null by the filter above; `bounds` is only a type-level fallback.
        points: routeFor(
          connection,
          bounds,
          geometry.get(connection.targetOccurrenceId.value) ?? bounds
        )
      }))
      objectCount += 1
      connectionCount += nested.length
      return objectOccurrenceSpec({
        id: arisIdForWorkbookId('ObjOcc', occurrenceId),
        objectDefinitionId: arisIdForWorkbookId('ObjDef', object.objectId.value),
        symbolNum: object.symbolType.value,
        position: bounds.position,
        size: bounds.size,
        ...(outgoing.length > 0
          ? {
              connectionOccurrenceIds: outgoing.map((connection) =>
                arisIdForWorkbookId('CxnOcc', connection.connectionId.value)
              )
            }
          : {}),
        connectionOccurrences: nested
      })
    })

    const modelAttributes: AttributeDefinitionSpec[] = []
    const modelName = nameAttribute(AT_NAME, model.nameEn.value, model.nameAr?.value)
    if (modelName) modelAttributes.push(modelName)
    const processCode = nameAttribute(AT_PROC_CODE, model.processCode?.value, undefined)
    if (processCode) modelAttributes.push(processCode)
    const description = nameAttribute(
      AT_DESC,
      model.descriptionEn?.value,
      model.descriptionAr?.value
    )
    if (description) modelAttributes.push(description)
    modelAttributes.push(...(attributesByOwner.get(`model:${modelId}`) ?? []))

    groupChildren.push({
      name: 'Model',
      attributes: [
        { name: 'Model.ID', value: arisIdForWorkbookId('Model', modelId) },
        { name: 'Model.Type', value: model.modelType.value }
      ],
      children: [...modelAttributes.map(attrDefSpec), ...occurrenceSpecs]
    })
  }

  const group: ElementSpec = {
    name: 'Group',
    attributes: [{ name: 'Group.ID', value: 'Group.Root' }],
    children: groupChildren
  }

  const header: ElementSpec = {
    name: 'Header-Info',
    attributes: [
      { name: 'DatabaseName', value: 'OrbitPM' },
      { name: 'UserName', value: 'local-user' },
      { name: 'ArisExeVersion', value: '10' }
    ]
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    renderRecord({ name: 'AML', children: [header, group] }),
    ''
  ].join('\n')

  return Object.freeze({
    xml,
    modelCount: workbook.models.length,
    objectCount,
    connectionCount
  })
}

/** `Sheet!A1` for one issue, or `null` when the issue is not cell-scoped. */
export function arisExcelIssueAddress(issue: {
  readonly sheet?: string
  readonly cell?: string
}): string | null {
  if (issue.sheet === undefined) return null
  return issue.cell === undefined ? issue.sheet : `${issue.sheet}!${issue.cell}`
}

/** True when the workbook was recognized as the retired BPMN 0.4.5 template. */
export function isLegacyBpmnWorkbook(result: ArisWorkbookParseResult): boolean {
  return (
    result.detection.legacyBpmnWorkbook ||
    result.issues.some((issue) => issue.code === 'legacy-bpmn-workbook')
  )
}

export { isAcceptedArisWorkbook }
