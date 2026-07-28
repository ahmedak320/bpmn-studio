/**
 * Phase 10 input seam.
 *
 * `src/aris/model` and `src/aris/source` are being edited by other agents.
 * This module defines the *only* boundary the details layer uses:
 *
 *   `ArisDetailsDocument` — a read-only, detail-oriented projection of a
 *   working document that includes satellite objects, OLE/attachment records,
 *   and the control-flow backbone.
 *
 * Adapters live in `adaptWorkingDocument()`. Tests that need to exercise the
 * layer without coupling to the in-flight source index can build this
 * projection directly from fixtures.
 */

import type {
  ArisAttribute,
  ArisBounds,
  ArisConnectionOccurrence,
  ArisDatabase,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisPoint,
  ArisWorkingDocument,
} from '../model/types'

/** Every selectable thing the details layer can reason about. */
export type ArisDetailsElement =
  | { readonly kind: 'objectDefinition'; readonly id: string }
  | { readonly kind: 'objectOccurrence'; readonly id: string }
  | { readonly kind: 'connectionOccurrence'; readonly id: string }
  | { readonly kind: 'model'; readonly id: string }
  | { readonly kind: 'attachment'; readonly id: string }

/** Satellite metadata category. */
export type ArisMetadataCategory =
  | 'owner'
  | 'responsible'
  | 'consulted'
  | 'informed'
  | 'input'
  | 'output'
  | 'system'
  | 'businessRule'
  | 'policy'
  | 'requirement'
  | 'processCode'
  | 'arisId'
  | 'modelAssignment'
  | 'other'

/** A single relationship between a function occurrence and a satellite. */
export interface ArisMetadataRelation {
  readonly category: ArisMetadataCategory
  readonly connectionType: string
  readonly connectionDefinitionId: string
  readonly connectionOccurrenceId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly satelliteDefinitionId: string
  readonly satelliteOccurrenceId: string
}

/** A satellite object occurrence attached to a function occurrence. */
export interface ArisMetadataSatellite {
  readonly category: ArisMetadataCategory
  readonly relation: ArisMetadataRelation
  readonly definitionId: string
  readonly occurrenceId: string
  readonly modelId: string
  readonly type: string
  readonly symbol: string
  readonly names: Readonly<Record<string, string>>
  readonly bounds: ArisBounds
  readonly attributes: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Control-flow backbone node used for layout stability tests. */
export interface ArisControlFlowNode {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly type: string
  readonly symbol: string
  readonly bounds: ArisBounds
}

export interface ArisDetailsAttachmentBlob {
  readonly index: number
  readonly base64: string
}

export interface ArisDetailsAttachment {
  readonly id: string
  readonly oleDefinitionId: string
  readonly oleOccurrenceId: string | null
  readonly modelId: string | null
  readonly position: { readonly x: number; readonly y: number } | null
  readonly size: { readonly dx: number; readonly dy: number } | null
  readonly displayName: string
  readonly blobs: readonly ArisDetailsAttachmentBlob[]
}

export interface ArisDetailsModel {
  readonly model: ArisModel
  readonly controlFlowNodes: readonly ArisControlFlowNode[]
  readonly satellites: ReadonlyMap<string, ArisMetadataSatellite>
  readonly attachments: ReadonlyMap<string, ArisDetailsAttachment>
}

export interface ArisDetailsDocument {
  readonly database: ArisDatabase
  readonly models: ReadonlyMap<string, ArisDetailsModel>
  readonly objectDefinitions: ReadonlyMap<string, ArisObjectDefinition>
  readonly occurrences: ReadonlyMap<string, ArisObjectOccurrence>
  readonly connectionOccurrences: ReadonlyMap<string, ArisConnectionOccurrence>
  readonly revision: number
  /** Flat lookup of every attachment in the document. */
  readonly attachments: ReadonlyMap<string, ArisDetailsAttachment>
}

export interface ArisDetailsAdapterOptions {
  /**
   * Optional pre-extracted attachments. When omitted the adapter returns an
   * empty attachment map; callers that need OLE/attachment details should pass
   * records built from the source XML.
   */
  readonly attachments?: ReadonlyMap<string, ArisDetailsAttachment>
}

const CONTROL_FLOW_TYPES = new Set([
  'OT_FUNC',
  'OT_EVT',
  'OT_RULE',
])

function isControlFlowObjectType(type: string): boolean {
  return CONTROL_FLOW_TYPES.has(type)
}

function buildModelDetails(
  model: ArisModel,
  doc: ArisWorkingDocument,
  attachments: ReadonlyMap<string, ArisDetailsAttachment>
): ArisDetailsModel {
  const controlFlowNodes: ArisControlFlowNode[] = []
  const satellites = new Map<string, ArisMetadataSatellite>()
  const modelAttachments = new Map<string, ArisDetailsAttachment>()

  for (const occ of model.occurrences) {
    const def = doc.objectDefinitions.get(occ.definitionId)
    if (!def) continue
    if (isControlFlowObjectType(def.type)) {
      controlFlowNodes.push({
        occurrenceId: occ.id,
        definitionId: def.id,
        type: def.type,
        symbol: occ.symbol,
        bounds: occ.bounds,
      })
    }
  }

  for (const cxn of model.connectionOccurrences) {
    const source = model.occurrences.find((o) => o.id === cxn.sourceOccurrenceId)
    const target = model.occurrences.find((o) => o.id === cxn.targetOccurrenceId)
    if (!source || !target) continue
    const sourceDef = doc.objectDefinitions.get(source.definitionId)
    const targetDef = doc.objectDefinitions.get(target.definitionId)
    if (!sourceDef || !targetDef) continue

    const cxnDef = doc.connectionDefinitions.get(cxn.definitionId)
    const connectionType = cxnDef?.type ?? 'unknown'

    const category = classifyRelation(sourceDef.type, targetDef.type, connectionType)
    if (category === 'other') continue

    const satelliteOcc = isControlFlowObjectType(targetDef.type) ? source : target
    const functionOcc = isControlFlowObjectType(targetDef.type) ? target : source
    const satelliteDef = doc.objectDefinitions.get(satelliteOcc.definitionId)
    const functionDef = doc.objectDefinitions.get(functionOcc.definitionId)
    if (!satelliteDef || !functionDef) continue
    if (!isControlFlowObjectType(functionDef.type)) continue

    const relation: ArisMetadataRelation = {
      category,
      connectionType,
      connectionDefinitionId: cxn.definitionId,
      connectionOccurrenceId: cxn.id,
      sourceOccurrenceId: cxn.sourceOccurrenceId,
      targetOccurrenceId: cxn.targetOccurrenceId,
      satelliteDefinitionId: satelliteDef.id,
      satelliteOccurrenceId: satelliteOcc.id,
    }

    satellites.set(satelliteOcc.id, {
      category,
      relation,
      definitionId: satelliteDef.id,
      occurrenceId: satelliteOcc.id,
      modelId: model.id,
      type: satelliteDef.type,
      symbol: satelliteOcc.symbol,
      names: satelliteDef.names.values,
      bounds: satelliteOcc.bounds,
      attributes: attributeMap(satelliteDef.attributes),
    })
  }

  for (const [, att] of attachments) {
    if (att.modelId === model.id) {
      modelAttachments.set(att.id, att)
    }
  }

  return {
    model,
    controlFlowNodes,
    satellites,
    attachments: modelAttachments,
  }
}

function attributeMap(attrs: readonly ArisAttribute[]): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const out: Record<string, Record<string, string>> = {}
  for (const attr of attrs) {
    const localeMap: Record<string, string> = {}
    for (const value of attr.values) {
      localeMap[value.localeId ?? '_'] = value.text
    }
    out[attr.type] = localeMap
  }
  return out
}

function classifyRelation(sourceType: string, targetType: string, connectionType: string): ArisMetadataCategory {
  const [a, b] = [sourceType, targetType]

  if (a === 'OT_FUNC' && b === 'OT_APPL_SYS') return 'system'
  if (a === 'OT_APPL_SYS' && b === 'OT_FUNC') return 'system'

  if (a === 'OT_FUNC' && b === 'OT_BUSINESS_RULE') return 'businessRule'
  if (a === 'OT_BUSINESS_RULE' && b === 'OT_FUNC') return 'businessRule'

  if (a === 'OT_FUNC' && b === 'OT_POLICY') return 'policy'
  if (a === 'OT_POLICY' && b === 'OT_FUNC') return 'policy'

  if (a === 'OT_FUNC' && b === 'OT_REQUIREMENT') return 'requirement'
  if (a === 'OT_REQUIREMENT' && b === 'OT_FUNC') return 'requirement'

  if (a === 'OT_FUNC' && (b === 'OT_INFO_CARR' || b === 'OT_ENT_TYPE')) {
    return connectionType === 'CT_HAS_OUT' || connectionType === 'CT_CRT_OUT_TO' ? 'output' : 'input'
  }
  if ((a === 'OT_INFO_CARR' || a === 'OT_ENT_TYPE') && b === 'OT_FUNC') {
    return connectionType === 'CT_HAS_OUT' || connectionType === 'CT_CRT_OUT_TO' ? 'output' : 'input'
  }

  if ((a === 'OT_PERS' || a === 'OT_PERS_TYPE') && b === 'OT_FUNC') {
    return connectionType === 'CT_MUST_BE_INFO_ABT_1' ? 'consulted' : 'responsible'
  }

  if (a === 'OT_FUNC' && (b === 'OT_PERS' || b === 'OT_PERS_TYPE')) {
    return connectionType === 'CT_ACTIV_1' ? 'owner' : 'responsible'
  }

  return 'other'
}

export function adaptWorkingDocument(
  document: ArisWorkingDocument,
  options: ArisDetailsAdapterOptions = {}
): ArisDetailsDocument {
  const attachments = options.attachments ?? new Map<string, ArisDetailsAttachment>()
  const models = new Map<string, ArisDetailsModel>()
  const occurrences = new Map<string, ArisObjectOccurrence>()

  for (const [, model] of document.models) {
    models.set(model.id, buildModelDetails(model, document, attachments))
    for (const occ of model.occurrences) {
      occurrences.set(occ.id, occ)
    }
  }

  const allConnections: [string, ArisConnectionOccurrence][] = []
  for (const model of document.models.values()) {
    for (const cxn of model.connectionOccurrences) {
      allConnections.push([cxn.id, cxn])
    }
  }

  return {
    database: document.database,
    models,
    objectDefinitions: document.objectDefinitions,
    occurrences,
    connectionOccurrences: new Map(allConnections),
    revision: document.revision,
    attachments,
  }
}

/** Sorts a list of control-flow nodes by their source Y then X coordinate. */
export function controlFlowSpine(
  nodes: readonly ArisControlFlowNode[]
): readonly { readonly x: number; readonly y: number }[] {
  return nodes
    .slice()
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
    .map((n) => ({ x: n.bounds.x, y: n.bounds.y }))
}

/** Computes the route length of a connection occurrence. */
export function routeLength(route: readonly ArisPoint[]): number {
  let total = 0
  for (let i = 1; i < route.length; i++) {
    const dx = route[i].x - route[i - 1].x
    const dy = route[i].y - route[i - 1].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}
