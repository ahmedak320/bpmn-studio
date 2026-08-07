/**
 * Create-with-AI, ARIS-native (plan §16), mounted.
 *
 * The AI never produces AML. It produces `ArisAiDraftV1` — logical ids, typed
 * objects, typed relations, explicit uncertainties — and `validateArisAiDraft`
 * refuses anything else: raw XML, real ARIS ids, coordinates and executable
 * content are all rejected by `scanForForbiddenContent` before the schema even
 * runs. This module therefore does two things and nothing else:
 *
 *  1. builds the request through `buildArisAiPrompt` (§16.5), and
 *  2. turns an ALREADY-VALIDATED draft into AML locally (§16.6 steps 11-14),
 *     allocating the ids and the geometry itself.
 *
 * Because the model is forbidden from emitting coordinates, geometry here is
 * always shell-generated: one deterministic column per model, ordered by the
 * draft's `suggestedOrder`. The created model opens on the real canvas where
 * "Clean Layout" runs the §14.4 engine.
 */

import type { ArisAiDraftV1, ArisAiLocalizedText } from '../ai'
import {
  attrDefSpec,
  connectionDefinitionSpec,
  objectDefinitionSpec,
  objectOccurrenceSpec,
  renderRecord,
  type AttributeDefinitionSpec,
  type ConnectionOccurrenceSpec,
  type ElementSpec
} from '../writer'

const EN_LOCALE_ID = '1033'
const AR_LOCALE_ID = '1025'
const AT_NAME = 'AT_NAME'

const WIDTH = 180
const HEIGHT = 70
const COLUMN_X = 240
const ROW_STEP = 160
const FIRST_Y = 120

// Defensive default table — extended 2026-08-07. Was previously only three
// entries (OT_FUNC/OT_EVT/OT_RULE); every satellite kind (systems, roles,
// info-objects, controls) hit the trailing `?? 'ST_FUNC'` fallback which meant
// the renderer's registry couldn't find a real symbol descriptor and stamped
// every satellite with `orbitpm:unknown-symbol`. Sourced from
// ARIS_OBJECT_TYPE_DEFAULT_SYMBOL in src/aris/symbols/shapes.ts.
const DEFAULT_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  OT_FUNC: 'ST_FUNC',
  OT_EVT: 'ST_EV',
  OT_RULE: 'ST_OPR_XOR_1',
  OT_APPL_SYS: 'ST_APPL_SYS',
  OT_PERS: 'ST_PERS_EXT',
  OT_PERS_TYPE: 'ST_EMPL_TYPE',
  OT_ENT_TYPE: 'ST_ENT_TYPE',
  OT_INFO_CARR: 'ST_INFO_CARR_EDOC',
  OT_REQUIREMENT: 'ST_REQUIREMENT',
  OT_POLICY: 'ST_BUSINESS_POLICY',
  OT_BUSINESS_RULE: 'ST_BUSINESS_RULE',
  OT_ORG_UNIT: 'ST_ORG_UNIT_1',
  OT_POS: 'ST_POS',
  OT_GRP: 'ST_GRP_1'
})

/** Logical id → deterministic, collision-free ARIS-shaped source id. */
export function arisIdForLogicalId(prefix: string, logicalId: string): string {
  return `${prefix}.${logicalId}`
}

function nameSpec(names: ArisAiLocalizedText | undefined): AttributeDefinitionSpec | null {
  const values: { localeId: string; text: string }[] = []
  if (names?.en) values.push({ localeId: EN_LOCALE_ID, text: names.en })
  if (names?.ar) values.push({ localeId: AR_LOCALE_ID, text: names.ar })
  if (values.length === 0) return null
  return { type: AT_NAME, values }
}

export interface ArisAiAmlResult {
  readonly xml: string
  readonly modelCount: number
  readonly objectCount: number
  readonly relationCount: number
  readonly uncertaintyCount: number
}

/**
 * Build canonical AML from a validated draft.
 *
 * Only pass a draft `validateArisAiDraft` accepted. This function performs no
 * content security checks of its own on purpose — duplicating them here would
 * create a second, drifting definition of what the AI is allowed to say.
 */
export function buildAmlFromArisAiDraft(
  draft: ArisAiDraftV1,
  options: { readonly modelNameFallback?: string } = {}
): ArisAiAmlResult {
  const attributesByOwner = new Map<string, AttributeDefinitionSpec[]>()
  const pushAttribute = (ownerLogicalId: string, type: string, text: ArisAiLocalizedText): void => {
    const spec = nameSpec(text)
    if (!spec) return
    const list = attributesByOwner.get(ownerLogicalId) ?? []
    list.push({ type, values: spec.values })
    attributesByOwner.set(ownerLogicalId, list)
  }
  for (const attribute of draft.attributes) {
    pushAttribute(attribute.ownerLogicalId, attribute.attributeType, attribute.values)
  }

  // §16.6 step 11 note: `ObjectDefinitionSpec` has no linked-model member, so a
  // draft assignment becomes a `LinkedModels.IdRefs` attribute on the definition
  // — the same attribute the source reader indexes as `linkedModelIds`.
  const linkedModelsByObject = new Map<string, string[]>()
  for (const assignment of draft.assignments) {
    const list = linkedModelsByObject.get(assignment.objectLogicalId) ?? []
    list.push(arisIdForLogicalId('Model', assignment.assignedModelLogicalId))
    linkedModelsByObject.set(assignment.objectLogicalId, list)
  }

  // Connection definitions hang off the source object definition.
  const connectionDefinitionsByObject = new Map<string, string[]>()
  const connectionDefinitionSpecs: ElementSpec[] = []
  for (const relation of draft.relations) {
    const definitionId = arisIdForLogicalId('CxnDef', relation.logicalId)
    const list = connectionDefinitionsByObject.get(relation.sourceLogicalId) ?? []
    list.push(definitionId)
    connectionDefinitionsByObject.set(relation.sourceLogicalId, list)
    connectionDefinitionSpecs.push(
      connectionDefinitionSpec({
        id: definitionId,
        type: relation.connectionType,
        targetObjectDefinitionId: arisIdForLogicalId('ObjDef', relation.targetLogicalId)
      })
    )
  }

  const definitionSpecs: ElementSpec[] = draft.objects.map((object) => {
    const attributes: AttributeDefinitionSpec[] = []
    const name = nameSpec(object.names)
    if (name) attributes.push(name)
    for (const attribute of object.attributes) {
      const spec = nameSpec(attribute.values)
      if (spec) attributes.push({ type: attribute.attributeType, values: spec.values })
    }
    attributes.push(...(attributesByOwner.get(object.logicalId) ?? []))
    const definitionIds = connectionDefinitionsByObject.get(object.logicalId) ?? []
    const linked = linkedModelsByObject.get(object.logicalId) ?? []
    const spec = objectDefinitionSpec({
      id: arisIdForLogicalId('ObjDef', object.logicalId),
      typeNum: object.objectType,
      symbolNum: object.symbolType ?? DEFAULT_SYMBOLS[object.objectType] ?? 'ST_FUNC',
      ...(definitionIds.length > 0 ? { connectionDefinitionIds: definitionIds } : {}),
      attributes
    })
    if (linked.length === 0) return spec
    return {
      ...spec,
      attributes: [
        ...(spec.attributes ?? []),
        { name: 'LinkedModels.IdRefs', value: linked.join(' ') }
      ]
    }
  })

  const groupChildren: ElementSpec[] = [...definitionSpecs, ...connectionDefinitionSpecs]

  let objectCount = 0
  let relationCount = 0
  for (const model of draft.models) {
    const objects = draft.objects
      .filter((object) => object.modelLogicalId === model.logicalId)
      .map((object, index) => ({ object, index }))
      .sort((left, right) => {
        const leftOrder = left.object.suggestedOrder ?? left.index
        const rightOrder = right.object.suggestedOrder ?? right.index
        return leftOrder === rightOrder ? left.index - right.index : leftOrder - rightOrder
      })
      .map((entry) => entry.object)

    const geometry = new Map<string, { readonly x: number; readonly y: number }>()
    objects.forEach((object, index) => {
      geometry.set(object.logicalId, { x: COLUMN_X, y: FIRST_Y + index * ROW_STEP })
    })

    const relationsBySource = new Map<string, (typeof draft.relations)[number][]>()
    for (const relation of draft.relations) {
      if (relation.modelLogicalId !== model.logicalId) continue
      if (!geometry.has(relation.sourceLogicalId) || !geometry.has(relation.targetLogicalId))
        continue
      const list = relationsBySource.get(relation.sourceLogicalId) ?? []
      list.push(relation)
      relationsBySource.set(relation.sourceLogicalId, list)
    }

    const occurrences: ElementSpec[] = objects.map((object) => {
      const from = geometry.get(object.logicalId) ?? { x: COLUMN_X, y: FIRST_Y }
      const outgoing = relationsBySource.get(object.logicalId) ?? []
      const nested: ConnectionOccurrenceSpec[] = outgoing.map((relation) => {
        const to = geometry.get(relation.targetLogicalId) ?? from
        return {
          id: arisIdForLogicalId('CxnOcc', relation.logicalId),
          connectionDefinitionId: arisIdForLogicalId('CxnDef', relation.logicalId),
          targetObjectOccurrenceId: arisIdForLogicalId('ObjOcc', relation.targetLogicalId),
          points: [
            { x: from.x + WIDTH / 2, y: from.y + HEIGHT },
            { x: to.x + WIDTH / 2, y: to.y }
          ]
        }
      })
      objectCount += 1
      relationCount += nested.length
      return objectOccurrenceSpec({
        id: arisIdForLogicalId('ObjOcc', object.logicalId),
        objectDefinitionId: arisIdForLogicalId('ObjDef', object.logicalId),
        symbolNum: object.symbolType ?? DEFAULT_SYMBOLS[object.objectType] ?? 'ST_FUNC',
        position: from,
        size: { dx: WIDTH, dy: HEIGHT },
        ...(outgoing.length > 0
          ? {
              connectionOccurrenceIds: outgoing.map((relation) =>
                arisIdForLogicalId('CxnOcc', relation.logicalId)
              )
            }
          : {}),
        connectionOccurrences: nested
      })
    })

    const modelAttributes: AttributeDefinitionSpec[] = []
    const modelName =
      nameSpec(model.names) ??
      (options.modelNameFallback
        ? { type: AT_NAME, values: [{ localeId: EN_LOCALE_ID, text: options.modelNameFallback }] }
        : null)
    if (modelName) modelAttributes.push(modelName)
    modelAttributes.push(...(attributesByOwner.get(model.logicalId) ?? []))

    groupChildren.push({
      name: 'Model',
      attributes: [
        { name: 'Model.ID', value: arisIdForLogicalId('Model', model.logicalId) },
        { name: 'Model.Type', value: model.modelType }
      ],
      children: [...modelAttributes.map(attrDefSpec), ...occurrences]
    })
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    renderRecord({
      name: 'AML',
      children: [
        {
          name: 'Header-Info',
          attributes: [
            { name: 'DatabaseName', value: 'OrbitPM' },
            { name: 'UserName', value: 'local-user' },
            { name: 'ArisExeVersion', value: '10' }
          ]
        },
        {
          name: 'Group',
          attributes: [{ name: 'Group.ID', value: 'Group.Root' }],
          children: groupChildren
        }
      ]
    }),
    ''
  ].join('\n')

  return Object.freeze({
    xml,
    modelCount: draft.models.length,
    objectCount,
    relationCount,
    uncertaintyCount: draft.uncertainties.length
  })
}
