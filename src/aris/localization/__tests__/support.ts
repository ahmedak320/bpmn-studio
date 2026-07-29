/**
 * Test support (not a test file). Builds `ArisWorkingDocument`s with precise
 * control over locale-id keys, so the extraction/write-locale-fidelity cases can
 * assert byte-exact behaviour without round-tripping AML.
 */

import { createEmptyArisDocument, createEmptyArisModel } from '../../canvas/emptyDocument'
import type {
  ArisConnectionDefinition,
  ArisFreeText,
  ArisLocalizedValue,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisSupportedModelType,
  ArisWorkingDocument
} from '../../model/types'

const STYLE = Object.freeze({
  symbol: null,
  fillColor: null,
  strokeColor: null,
  strokeWidth: null,
  lineStyle: null,
  fontStyleSheetId: null,
  zOrder: null
})

/** A localized value keyed by the exact locale ids given. */
export function loc(values: Record<string, string>): ArisLocalizedValue {
  const keys = Object.keys(values)
  return Object.freeze({
    values: Object.freeze({ ...values }),
    fallback: keys.length > 0 ? values[keys[0]] : null
  })
}

export function objectDefinition(
  id: string,
  type: string,
  values: Record<string, string>
): ArisObjectDefinition {
  return Object.freeze({
    id,
    type,
    defaultSymbol: null,
    names: loc(values),
    attributes: Object.freeze([]),
    linkedModelIds: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
}

export function connectionDefinition(
  id: string,
  type: string,
  values: Record<string, string>
): ArisConnectionDefinition {
  return Object.freeze({
    id,
    type,
    fromObjectDefinitionId: 'ObjDef.from',
    toObjectDefinitionId: 'ObjDef.to',
    names: loc(values),
    attributes: Object.freeze([])
  })
}

export function occurrence(
  id: string,
  definitionId: string,
  modelId: string
): ArisObjectOccurrence {
  return Object.freeze({
    id,
    definitionId,
    modelId,
    symbol: 'ST_FUNC',
    bounds: Object.freeze({ x: 0, y: 0, width: 100, height: 50 }),
    style: STYLE,
    attributeOccurrences: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
}

export function freeText(
  id: string,
  modelId: string,
  values: Record<string, string>
): ArisFreeText {
  return Object.freeze({
    id,
    modelId,
    definitionId: null,
    text: loc(values),
    attributes: Object.freeze([]),
    bounds: Object.freeze({ x: 0, y: 0, width: 100, height: 50 }),
    style: STYLE
  })
}

export interface MakeDocumentInput {
  readonly modelId?: string
  readonly modelType?: ArisSupportedModelType
  readonly modelName?: Record<string, string>
  readonly objectDefinitions?: readonly ArisObjectDefinition[]
  readonly occurrences?: readonly ArisObjectOccurrence[]
  readonly connectionDefinitions?: readonly ArisConnectionDefinition[]
  readonly freeText?: readonly ArisFreeText[]
}

export function makeDocument(input: MakeDocumentInput = {}): ArisWorkingDocument {
  const modelId = input.modelId ?? 'Model.1'
  const base = createEmptyArisModel({ id: modelId, type: input.modelType ?? 'MT_EEPC' })
  const model: ArisModel = Object.freeze({
    ...base,
    names: input.modelName ? loc(input.modelName) : base.names,
    occurrences: Object.freeze([...(input.occurrences ?? [])]),
    freeText: Object.freeze([...(input.freeText ?? [])])
  })
  const empty = createEmptyArisDocument({ models: [model] })
  return Object.freeze({
    ...empty,
    objectDefinitions: Object.freeze(
      new Map((input.objectDefinitions ?? []).map((definition) => [definition.id, definition]))
    ),
    connectionDefinitions: Object.freeze(
      new Map((input.connectionDefinitions ?? []).map((definition) => [definition.id, definition]))
    )
  })
}
