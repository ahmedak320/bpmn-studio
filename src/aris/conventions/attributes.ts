/**
 * ARIS convention attribute schema (plan R3).
 *
 * Pure source of truth for which attributes apply to which object/model types,
 * whether they are mandatory, and their provenance.  Callers use this to drive
 * the details panel, validation, and Excel import/export.
 */

import type { ArisSymbolVerification } from './catalog'

export interface ArisAttributeSchemaEntry {
  readonly attributeType: string
  readonly labelKey: string
  readonly mandatory: boolean
  readonly appliesTo: 'objectType' | 'model'
  readonly objectTypes?: readonly string[]
  readonly modelTypes?: readonly string[]
  readonly verification: ArisSymbolVerification
}

/** Attributes that apply to individual elements (Functions / VACD elements). */
export const ARIS_ELEMENT_ATTRIBUTE_SCHEMA: readonly ArisAttributeSchemaEntry[] = Object.freeze([
  Object.freeze({
    attributeType: 'AT_ID',
    labelKey: 'aris.attribute.identifier',
    mandatory: true,
    appliesTo: 'objectType',
    objectTypes: Object.freeze(['OT_FUNC']),
    verification: 'fixture'
  }),
  Object.freeze({
    attributeType: 'AT_DESC',
    labelKey: 'aris.attribute.description',
    mandatory: false,
    appliesTo: 'objectType',
    objectTypes: Object.freeze(['OT_FUNC']),
    verification: 'aris-doc'
  }),
  Object.freeze({
    attributeType: 'AT_TIME_AVG_PRCS',
    labelKey: 'aris.attribute.averageProcessingTime',
    mandatory: false,
    appliesTo: 'objectType',
    objectTypes: Object.freeze(['OT_FUNC']),
    verification: 'aris-doc'
  }),
  Object.freeze({
    attributeType: 'AT_PROC_CODE',
    labelKey: 'aris.attribute.processCode',
    mandatory: false,
    appliesTo: 'objectType',
    objectTypes: Object.freeze(['OT_FUNC']),
    verification: 'fixture'
  })
])

/** Attributes that apply to EPC models. */
export const ARIS_EPC_MODEL_ATTRIBUTE_SCHEMA: readonly ArisAttributeSchemaEntry[] = Object.freeze([
  Object.freeze({
    attributeType: 'AT_PROC_OBJ',
    labelKey: 'aris.attribute.processObjective',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_PROC_SCOPE',
    labelKey: 'aris.attribute.processScope',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_ENTITY',
    labelKey: 'aris.attribute.entity',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_AUTH_BY',
    labelKey: 'aris.attribute.authorizedBy',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_REL_ORG_STRUC',
    labelKey: 'aris.attribute.relevantOrganizationStructure',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_PERS_RESP',
    labelKey: 'aris.attribute.personResponsible',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    attributeType: 'AT_VERSION',
    labelKey: 'aris.attribute.version',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_ID',
    labelKey: 'aris.attribute.identifier',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_PROC_AREA',
    labelKey: 'aris.attribute.processArea',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_ORG_NAME',
    labelKey: 'aris.attribute.organizationName',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),
  Object.freeze({
    attributeType: 'AT_SERVICE_FEES',
    labelKey: 'aris.attribute.serviceFees',
    mandatory: false,
    appliesTo: 'model',
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  })
])

const SCHEMA_BY_OBJECT_TYPE: ReadonlyMap<string, readonly ArisAttributeSchemaEntry[]> = (() => {
  const mutable = new Map<string, ArisAttributeSchemaEntry[]>()
  for (const entry of ARIS_ELEMENT_ATTRIBUTE_SCHEMA) {
    for (const objectType of entry.objectTypes ?? []) {
      const list = mutable.get(objectType) ?? []
      list.push(entry)
      mutable.set(objectType, list)
    }
  }
  const map = new Map<string, readonly ArisAttributeSchemaEntry[]>()
  for (const [key, list] of mutable) {
    map.set(key, Object.freeze(list))
  }
  return Object.freeze(map)
})()

const SCHEMA_BY_MODEL_TYPE: ReadonlyMap<string, readonly ArisAttributeSchemaEntry[]> = (() => {
  const mutable = new Map<string, ArisAttributeSchemaEntry[]>()
  for (const entry of ARIS_EPC_MODEL_ATTRIBUTE_SCHEMA) {
    for (const modelType of entry.modelTypes ?? []) {
      const list = mutable.get(modelType) ?? []
      list.push(entry)
      mutable.set(modelType, list)
    }
  }
  const map = new Map<string, readonly ArisAttributeSchemaEntry[]>()
  for (const [key, list] of mutable) {
    map.set(key, Object.freeze(list))
  }
  return Object.freeze(map)
})()

export function schemaForObjectType(objectType: string): readonly ArisAttributeSchemaEntry[] {
  return SCHEMA_BY_OBJECT_TYPE.get(objectType) ?? Object.freeze([])
}

export function schemaForModelType(modelType: string): readonly ArisAttributeSchemaEntry[] {
  return SCHEMA_BY_MODEL_TYPE.get(modelType) ?? Object.freeze([])
}
