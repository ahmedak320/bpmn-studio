import type { EpcEdge, EpcGraph, EpcNode } from './types'

/**
 * A deliberately minimal, hand-rolled AML XML scanner used ONLY by `realData.test.ts` for
 * plan section 19.3 verification. This intentionally does NOT depend on
 * `src/aris/source`'s semantic index (which is being rewritten by another agent while this
 * module is implemented) — it is a narrow, purpose-built regex scan of exactly the elements
 * this test needs: object definitions (with their bilingual names and outgoing typed
 * connections) and, per `MT_EEPC` model, the occurrence graph (which definition each
 * occurrence instantiates, and which occurrence each connection occurrence points at).
 *
 * This is test-only infrastructure. It is not part of the module's public API (not
 * re-exported from `index.ts`) and it never writes to the source file it reads.
 */

export interface ScannedObjectDefinition {
  readonly id: string
  readonly type: string
  readonly symbol: string | null
  readonly linkedModelIds: readonly string[]
  /** locale id (numeric, e.g. "1033" for US English, "14337" for Arabic (UAE)) -> name text */
  readonly names: Readonly<Record<string, string>>
  readonly outgoing: readonly ScannedConnectionDefinition[]
}

export interface ScannedConnectionDefinition {
  readonly id: string
  readonly connectionType: string
  readonly fromObjectDefinitionId: string
  readonly toObjectDefinitionId: string
}

export interface ScannedModel {
  readonly id: string
  readonly type: string
  readonly objectOccurrences: readonly {
    readonly id: string
    readonly objectDefinitionId: string
  }[]
  readonly connectionOccurrences: readonly {
    readonly id: string
    readonly connectionDefinitionId: string
    readonly fromOccurrenceId: string
    readonly toOccurrenceId: string
  }[]
}

function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Parses `<!ENTITY Name "Value">` declarations from the internal DTD subset. */
export function scanEntities(xml: string): ReadonlyMap<string, string> {
  const entities = new Map<string, string>()
  const re = /<!ENTITY\s+([\w.]+)\s+"([^"]*)"\s*>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) entities.set(match[1], match[2])
  return entities
}

/** Resolves `&Entity.Name;` references in a string using a previously scanned entity map. */
function resolveEntities(text: string, entities: ReadonlyMap<string, string>): string {
  return text.replace(/&([\w.]+);/g, (whole, name: string) => entities.get(name) ?? whole)
}

function attr(attrsText: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}="([^"]*)"`).exec(attrsText)
  return match ? match[1] : null
}

export function scanObjectDefinitions(
  xml: string,
  entities: ReadonlyMap<string, string>
): ReadonlyMap<string, ScannedObjectDefinition> {
  const result = new Map<string, ScannedObjectDefinition>()
  const objDefRe = /<ObjDef\b([^>]*)>([\s\S]*?)<\/ObjDef>/g
  let match: RegExpExecArray | null
  while ((match = objDefRe.exec(xml))) {
    const [, attrsText, body] = match
    const id = attr(attrsText, 'ObjDef.ID')
    if (!id) continue
    const type = attr(attrsText, 'TypeNum') ?? ''
    const symbol = attr(attrsText, 'SymbolNum')
    const linkedRaw = attr(attrsText, 'LinkedModels.IdRefs')
    const linkedModelIds = linkedRaw ? linkedRaw.split(/\s+/).filter(Boolean) : []

    const names: Record<string, string> = {}
    const attrDefRe = /<AttrDef AttrDef\.Type="AT_NAME">([\s\S]*?)<\/AttrDef>/g
    const attrDefMatch = attrDefRe.exec(body)
    if (attrDefMatch) {
      const attrValueRe = /<AttrValue LocaleId="([^"]*)">([\s\S]*?)<\/AttrValue>/g
      let avMatch: RegExpExecArray | null
      while ((avMatch = attrValueRe.exec(attrDefMatch[1]))) {
        const localeId = resolveEntities(avMatch[1], entities)
        const plainTexts = [...avMatch[2].matchAll(/<PlainText TextValue="([^"]*)"/g)].map((m) =>
          unescapeXml(m[1])
        )
        names[localeId] = plainTexts.join('')
      }
    }

    const outgoing: ScannedConnectionDefinition[] = []
    const cxnDefRe = /<CxnDef\b([^>]*)>/g
    let cxnMatch: RegExpExecArray | null
    while ((cxnMatch = cxnDefRe.exec(body))) {
      const cxnId = attr(cxnMatch[1], 'CxnDef.ID')
      const connectionType = attr(cxnMatch[1], 'CxnDef.Type')
      const toId = attr(cxnMatch[1], 'ToObjDef.IdRef')
      if (cxnId && connectionType && toId) {
        outgoing.push({
          id: cxnId,
          connectionType,
          fromObjectDefinitionId: id,
          toObjectDefinitionId: toId
        })
      }
    }

    result.set(id, { id, type, symbol, linkedModelIds, names, outgoing: Object.freeze(outgoing) })
  }
  return result
}

export function scanModels(xml: string): readonly ScannedModel[] {
  const models: ScannedModel[] = []
  const modelRe = /<Model\b([^>]*)>([\s\S]*?)<\/Model>/g
  let modelMatch: RegExpExecArray | null
  while ((modelMatch = modelRe.exec(xml))) {
    const [, modelAttrs, modelBody] = modelMatch
    const id = attr(modelAttrs, 'Model.ID')
    const type = attr(modelAttrs, 'Model.Type')
    if (!id || !type) continue

    const objectOccurrences: { id: string; objectDefinitionId: string }[] = []
    const connectionOccurrences: {
      id: string
      connectionDefinitionId: string
      fromOccurrenceId: string
      toOccurrenceId: string
    }[] = []

    const objOccRe = /<ObjOcc\b([^>]*)>([\s\S]*?)<\/ObjOcc>/g
    let objOccMatch: RegExpExecArray | null
    while ((objOccMatch = objOccRe.exec(modelBody))) {
      const [, occAttrs, occBody] = objOccMatch
      const occId = attr(occAttrs, 'ObjOcc.ID')
      const defId = attr(occAttrs, 'ObjDef.IdRef')
      if (!occId || !defId) continue
      objectOccurrences.push({ id: occId, objectDefinitionId: defId })

      const cxnOccRe = /<CxnOcc\b([^>]*)>/g
      let cxnOccMatch: RegExpExecArray | null
      while ((cxnOccMatch = cxnOccRe.exec(occBody))) {
        const cxnAttrs = cxnOccMatch[1]
        const cxnOccId = attr(cxnAttrs, 'CxnOcc.ID')
        const cxnDefId = attr(cxnAttrs, 'CxnDef.IdRef')
        const toOccId = attr(cxnAttrs, 'ToObjOcc.IdRef')
        if (cxnOccId && cxnDefId && toOccId) {
          connectionOccurrences.push({
            id: cxnOccId,
            connectionDefinitionId: cxnDefId,
            fromOccurrenceId: occId,
            toOccurrenceId: toOccId
          })
        }
      }
    }

    models.push({
      id,
      type,
      objectOccurrences: Object.freeze(objectOccurrences),
      connectionOccurrences: Object.freeze(connectionOccurrences)
    })
  }
  return models
}

/**
 * Builds an `EpcGraph` for one scanned model, resolving each occurrence's node/edge shape
 * from the object/connection definitions. Mirrors `adapter.ts`'s `toEpcGraph` in spirit
 * but works directly off `ScannedModel`/`ScannedObjectDefinition` rather than the
 * `src/aris/model` shapes, keeping this test helper fully decoupled.
 */
export function buildGraphForModel(
  model: ScannedModel,
  objectDefinitions: ReadonlyMap<string, ScannedObjectDefinition>
): EpcGraph {
  const nodes: EpcNode[] = []
  for (const occurrence of model.objectOccurrences) {
    const definition = objectDefinitions.get(occurrence.objectDefinitionId)
    if (!definition) continue
    nodes.push(
      Object.freeze({
        id: occurrence.id,
        objectType: definition.type,
        symbolType: definition.symbol,
        names: definition.names,
        linkedModelIds: definition.linkedModelIds
      })
    )
  }

  // Occurrences reference their definition-level connection by CxnDef.IdRef, so flatten
  // every definition's outgoing CxnDef list into one id -> connection-type index once.
  const connectionDefIndex = new Map<string, string>()
  for (const definition of objectDefinitions.values()) {
    for (const out of definition.outgoing) connectionDefIndex.set(out.id, out.connectionType)
  }

  const edges: EpcEdge[] = []
  for (const cxnOcc of model.connectionOccurrences) {
    const connectionType = connectionDefIndex.get(cxnOcc.connectionDefinitionId) ?? ''
    edges.push(
      Object.freeze({
        id: cxnOcc.id,
        source: cxnOcc.fromOccurrenceId,
        target: cxnOcc.toOccurrenceId,
        connectionType
      })
    )
  }

  return Object.freeze({
    modelId: model.id,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges)
  })
}
