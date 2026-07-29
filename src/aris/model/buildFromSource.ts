import type {
  ArisAttribute,
  ArisAttributeOccurrence,
  ArisBounds,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisDatabase,
  ArisFreeText,
  ArisLane,
  ArisLocalizedValue,
  ArisModel,
  ArisModelType,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisPoint,
  ArisSourceAttributeOccurrenceRecordLike,
  ArisSourceAttributeRecordLike,
  ArisSourceConnectionDefinitionRecordLike,
  ArisSourceConnectionOccurrenceRecordLike,
  ArisSourceFreeTextOccurrenceRecordLike,
  ArisSourceFreeTextRecordLike,
  ArisSourceIndexLike,
  ArisSourceLaneRecordLike,
  ArisSourceModelRecordLike,
  ArisSourceObjectDefinitionRecordLike,
  ArisSourceObjectOccurrenceRecordLike,
  ArisStyle,
  ArisStyleCatalog,
  ArisWorkingDocument
} from './types'

const NAME_ATTRIBUTE_TYPES = new Set(['AT_NAME', 'Name'])
const SUPPORTED_MODEL_TYPES = new Set<ArisModelType>(['MT_EEPC', 'MT_VAL_ADD_CHN_DGM'])

function emptyLocalizedValue(): ArisLocalizedValue {
  return Object.freeze({ values: Object.freeze({}), fallback: null })
}

function buildLocalizedValue(
  ownerId: string | null,
  attributes: readonly ArisSourceAttributeRecordLike[]
): ArisLocalizedValue {
  if (!ownerId) return emptyLocalizedValue()
  const values: Record<string, string> = {}
  let fallback: string | null = null
  for (const attribute of attributes) {
    if (attribute.parsed.ownerSourceId !== ownerId) continue
    if (
      !attribute.parsed.attributeType ||
      !NAME_ATTRIBUTE_TYPES.has(attribute.parsed.attributeType)
    )
      continue
    for (const value of attribute.parsed.values) {
      const text = value.text.trim()
      if (!text) continue
      const locale = value.localeId ?? 'default'
      if (!(locale in values)) values[locale] = text
      if (fallback === null) fallback = text
    }
  }
  return Object.freeze({ values: Object.freeze(values), fallback })
}

function buildAttributes(
  ownerId: string | null,
  attributes: readonly ArisSourceAttributeRecordLike[]
): readonly ArisAttribute[] {
  if (!ownerId) return Object.freeze([])
  const result: ArisAttribute[] = []
  for (const attribute of attributes) {
    if (attribute.parsed.ownerSourceId !== ownerId) continue
    if (!attribute.parsed.attributeType || NAME_ATTRIBUTE_TYPES.has(attribute.parsed.attributeType))
      continue
    const values = attribute.parsed.values.map((value) =>
      Object.freeze({ localeId: value.localeId, text: value.text })
    )
    result.push(
      Object.freeze({
        type: attribute.parsed.attributeType,
        values: Object.freeze(values)
      })
    )
  }
  return Object.freeze(result)
}

function buildAttributeOccurrences(
  ownerId: string | null,
  attributeOccurrences: readonly ArisSourceAttributeOccurrenceRecordLike[]
): readonly ArisAttributeOccurrence[] {
  if (!ownerId) return Object.freeze([])
  const result: ArisAttributeOccurrence[] = []
  for (const attribute of attributeOccurrences) {
    if (attribute.parsed.ownerSourceId !== ownerId) continue
    result.push(
      Object.freeze({
        attributeType: attribute.parsed.attributeType ?? '',
        port: attribute.parsed.port ?? null,
        orderNum: attribute.parsed.orderNum ?? null,
        alignment: attribute.parsed.alignment ?? null,
        offsetX: attribute.parsed.offsetX ?? null,
        offsetY: attribute.parsed.offsetY ?? null,
        width: attribute.parsed.dx ?? null,
        height: attribute.parsed.dy ?? null,
        rotation: attribute.parsed.rotation ?? null
      })
    )
  }
  return Object.freeze(result)
}

function numberOrDefault(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback
}

function buildBounds(
  x: number | null,
  y: number | null,
  dx: number | null,
  dy: number | null
): ArisBounds {
  return Object.freeze({
    x: numberOrDefault(x, 0),
    y: numberOrDefault(y, 0),
    width: numberOrDefault(dx, 0),
    height: numberOrDefault(dy, 0)
  })
}

function buildOccurrenceStyle(
  source: ArisSourceObjectOccurrenceRecordLike,
  symbolFallback: string | null
): { symbol: string; style: ArisObjectOccurrence['style'] } {
  const symbol = source.parsed.symbolNum ?? symbolFallback ?? ''
  return {
    symbol,
    style: Object.freeze({
      symbol,
      fillColor: source.rawAttributes['FillColor'] ?? null,
      strokeColor: source.rawAttributes['Color'] ?? null,
      strokeWidth: null,
      lineStyle: null,
      fontStyleSheetId: source.rawAttributes['FontSS.IdRef'] ?? null,
      zOrder: source.parsed.zorder ?? null
    })
  }
}

function buildConnectionStyle(
  source: ArisSourceConnectionOccurrenceRecordLike
): ArisConnectionOccurrence['style'] {
  return Object.freeze({
    color: source.rawAttributes['Color'] ?? null,
    width: null,
    lineStyle: null,
    srcArrow: source.parsed.srcArrow ?? null,
    tgtArrow: source.parsed.tgtArrow ?? null,
    fontStyleSheetId: source.rawAttributes['FontSS.IdRef'] ?? null,
    zOrder: source.parsed.zorder ?? null
  })
}

function buildRoute(
  connectionOccurrenceId: string | null,
  routePoints: ArisSourceIndexLike['routePoints']
): readonly ArisPoint[] {
  if (!connectionOccurrenceId) return Object.freeze([])
  const points = routePoints
    .filter((point) => point.connectionOccurrenceId === connectionOccurrenceId)
    .sort((a, b) => a.pointIndex - b.pointIndex)
    .map((point) =>
      Object.freeze({
        x: numberOrDefault(point.x, 0),
        y: numberOrDefault(point.y, 0)
      })
    )
  return Object.freeze(points)
}

function buildDatabase(source: ArisSourceIndexLike['database']): ArisDatabase {
  const parsed = source?.parsed
  return Object.freeze({
    databaseName: parsed?.databaseName ?? null,
    createDate: parsed?.createDate ?? null,
    createTime: parsed?.createTime ?? null,
    userName: parsed?.userName ?? null,
    arisExeVersion: parsed?.arisExeVersion ?? null
  })
}

function buildStyleCatalog(source: ArisSourceIndexLike['styles']): ArisStyleCatalog {
  const styles = new Map<string, ArisStyle>()
  for (const [, sheet] of source.fontStyleSheets) {
    const id = sheet.parsed.fontStyleSheetId
    if (!id) continue
    styles.set(
      id,
      Object.freeze({
        id,
        fillColor: null,
        strokeColor: null,
        strokeWidth: null,
        lineStyle: null,
        fontFamily: null,
        fontSize: null,
        fontWeight: null,
        textColor: null,
        zOrder: null
      })
    )
  }
  return Object.freeze({ styles: Object.freeze(styles) })
}

function asUnsupportedType(rawType: string): ArisModelType {
  return rawType as ArisModelType
}

function buildModel(
  source: ArisSourceModelRecordLike,
  attributes: ArisSourceIndexLike['attributes']
): ArisModel {
  const rawType = source.parsed.modelType ?? ''
  const supported = SUPPORTED_MODEL_TYPES.has(rawType as ArisModelType)
  const modelId = source.parsed.modelId ?? ''
  return Object.freeze({
    id: modelId,
    type: supported ? (rawType as ArisModelType) : asUnsupportedType(rawType),
    names: buildLocalizedValue(modelId, attributes),
    attributes: buildAttributes(modelId, attributes),
    occurrences: Object.freeze([]),
    connectionOccurrences: Object.freeze([]),
    lanes: Object.freeze([]),
    freeText: Object.freeze([]),
    layout: Object.freeze({
      scale: source.parsed.scale ?? null,
      gridSize: source.parsed.gridSize ?? null,
      backColor: source.parsed.backColor ?? null,
      printScale: source.parsed.printScale ?? null,
      curveRadius: source.parsed.curveRadius ?? null,
      arcRadius: source.parsed.arcRadius ?? null
    }),
    unsupported: !supported,
    rawSourceRecord: source as unknown
  })
}

function buildObjectDefinition(
  source: ArisSourceObjectDefinitionRecordLike,
  attributes: ArisSourceIndexLike['attributes']
): ArisObjectDefinition {
  const id = source.parsed.objectDefinitionId ?? ''
  return Object.freeze({
    id,
    type: source.parsed.typeNum ?? '',
    defaultSymbol: source.parsed.symbolNum ?? null,
    names: buildLocalizedValue(id, attributes),
    attributes: buildAttributes(id, attributes),
    linkedModelIds: Object.freeze([...(source.parsed.linkedModelIds ?? [])]),
    rawAttributes: Object.freeze({ ...source.rawAttributes })
  })
}

function buildObjectOccurrence(
  source: ArisSourceObjectOccurrenceRecordLike,
  definitions: ReadonlyMap<string, ArisObjectDefinition>,
  attributeOccurrences: ArisSourceIndexLike['attributeOccurrences']
): ArisObjectOccurrence {
  const definition = definitions.get(source.parsed.objectDefinitionId ?? '')
  const { symbol, style } = buildOccurrenceStyle(source, definition?.defaultSymbol ?? null)
  const id = source.parsed.objectOccurrenceId ?? ''
  return Object.freeze({
    id,
    definitionId: source.parsed.objectDefinitionId ?? '',
    modelId: source.parsed.modelId ?? '',
    symbol,
    bounds: buildBounds(source.parsed.x, source.parsed.y, source.parsed.dx, source.parsed.dy),
    style,
    attributeOccurrences: buildAttributeOccurrences(id, attributeOccurrences),
    rawAttributes: Object.freeze({ ...source.rawAttributes })
  })
}

function buildConnectionDefinition(
  source: ArisSourceConnectionDefinitionRecordLike,
  attributes: ArisSourceIndexLike['attributes']
): ArisConnectionDefinition {
  const id = source.parsed.connectionDefinitionId ?? ''
  return Object.freeze({
    id,
    type: source.parsed.connectionType ?? '',
    fromObjectDefinitionId: source.parsed.fromObjectDefinitionId ?? '',
    toObjectDefinitionId: source.parsed.toObjectDefinitionId ?? '',
    names: buildLocalizedValue(id, attributes),
    attributes: buildAttributes(id, attributes)
  })
}

function buildConnectionOccurrence(
  source: ArisSourceConnectionOccurrenceRecordLike,
  routePoints: ArisSourceIndexLike['routePoints']
): ArisConnectionOccurrence {
  const id = source.parsed.connectionOccurrenceId ?? ''
  return Object.freeze({
    id,
    definitionId: source.parsed.connectionDefinitionId ?? '',
    modelId: source.parsed.modelId ?? '',
    sourceOccurrenceId: source.parsed.fromObjectOccurrenceId ?? '',
    targetOccurrenceId: source.parsed.toObjectOccurrenceId ?? '',
    route: buildRoute(id, routePoints),
    style: buildConnectionStyle(source),
    rawAttributes: Object.freeze({ ...source.rawAttributes })
  })
}

function buildLane(
  source: ArisSourceLaneRecordLike,
  attributes: ArisSourceIndexLike['attributes']
): ArisLane {
  const id = source.sourceId ?? ''
  return Object.freeze({
    id,
    modelId: source.parsed.modelId ?? '',
    names: buildLocalizedValue(id, attributes),
    laneType: source.parsed.laneType ?? null,
    orientation: source.parsed.orientation ?? null,
    startBorder: source.parsed.startBorder ?? null,
    endBorder: source.parsed.endBorder ?? null
  })
}

function buildFreeText(
  occurrence: ArisSourceFreeTextOccurrenceRecordLike,
  _definitions: ReadonlyMap<string, ArisSourceFreeTextRecordLike>,
  attributes: ArisSourceIndexLike['attributes']
): ArisFreeText {
  const definitionId = occurrence.parsed.freeTextDefinitionId ?? null
  // A real `<FFTextOcc>` never carries an `FFTextOcc.ID` attribute (ARIS free-text occurrences
  // are referenced only by position, not by id), so `rawAttributes['FFTextOcc.ID']` is always
  // absent in practice and `occurrence.sourceId` — the deterministic id synthesized by
  // `semanticIndex.ts` from the record's document path when no source id attribute exists — is
  // what actually supplies `id` here. Both are kept so a future export dialect that *does* emit
  // the attribute is honored over the synthesized fallback.
  const id = occurrence.rawAttributes['FFTextOcc.ID'] ?? occurrence.sourceId ?? ''
  const text = definitionId ? buildLocalizedValue(definitionId, attributes) : emptyLocalizedValue()
  return Object.freeze({
    id,
    modelId: occurrence.parsed.modelId ?? '',
    definitionId,
    text,
    bounds: buildBounds(
      occurrence.parsed.x,
      occurrence.parsed.y,
      occurrence.parsed.dx,
      occurrence.parsed.dy
    ),
    style: Object.freeze({
      symbol: null,
      fillColor: null,
      strokeColor: null,
      strokeWidth: null,
      lineStyle: null,
      fontStyleSheetId: occurrence.rawAttributes['FontSS.IdRef'] ?? null,
      zOrder: occurrence.parsed.zorder ?? null
    })
  })
}

/**
 * Build a fresh `ArisWorkingDocument` from a structural source index.
 *
 * Every source record becomes either a typed working-model entity or is kept
 * reachable through the attached `sourceIndex`. Unknown object/connection types
 * are represented as real entities and keep their raw XML attributes.
 */
export function buildFromSource(index: ArisSourceIndexLike): ArisWorkingDocument {
  const objectDefinitions = new Map<string, ArisObjectDefinition>()
  for (const [, source] of index.objectDefinitions) {
    const definition = buildObjectDefinition(source, index.attributes)
    if (definition.id) objectDefinitions.set(definition.id, definition)
  }

  const connectionDefinitions = new Map<string, ArisConnectionDefinition>()
  for (const [, source] of index.connectionDefinitions) {
    const definition = buildConnectionDefinition(source, index.attributes)
    if (definition.id) connectionDefinitions.set(definition.id, definition)
  }

  const occurrencesByModel = new Map<string, ArisObjectOccurrence[]>()
  for (const [, source] of index.objectOccurrences) {
    const occurrence = buildObjectOccurrence(source, objectDefinitions, index.attributeOccurrences)
    if (!occurrence.id || !occurrence.modelId) continue
    const list = occurrencesByModel.get(occurrence.modelId) ?? []
    list.push(occurrence)
    occurrencesByModel.set(occurrence.modelId, list)
  }

  const connectionsByModel = new Map<string, ArisConnectionOccurrence[]>()
  for (const [, source] of index.connectionOccurrences) {
    const occurrence = buildConnectionOccurrence(source, index.routePoints)
    if (!occurrence.id || !occurrence.modelId) continue
    const list = connectionsByModel.get(occurrence.modelId) ?? []
    list.push(occurrence)
    connectionsByModel.set(occurrence.modelId, list)
  }

  const lanesByModel = new Map<string, ArisLane[]>()
  for (const [, source] of index.lanes) {
    const lane = buildLane(source, index.attributes)
    if (!lane.id || !lane.modelId) continue
    const list = lanesByModel.get(lane.modelId) ?? []
    list.push(lane)
    lanesByModel.set(lane.modelId, list)
  }

  const freeTextDefinitions = new Map<string, ArisSourceFreeTextRecordLike>()
  for (const [, source] of index.freeText) {
    freeTextDefinitions.set(source.parsed.freeTextDefinitionId ?? '', source)
  }

  const freeTextByModel = new Map<string, ArisFreeText[]>()
  for (const occurrence of index.freeTextOccurrences) {
    const item = buildFreeText(occurrence, freeTextDefinitions, index.attributes)
    if (!item.id || !item.modelId) continue
    const list = freeTextByModel.get(item.modelId) ?? []
    list.push(item)
    freeTextByModel.set(item.modelId, list)
  }

  const models = new Map<string, ArisModel>()
  for (const [, source] of index.models) {
    const model = buildModel(source, index.attributes)
    if (!model.id) continue
    const modelId = model.id
    const occurrences = Object.freeze(occurrencesByModel.get(modelId) ?? [])
    const connectionOccurrences = Object.freeze(connectionsByModel.get(modelId) ?? [])
    const lanes = Object.freeze(lanesByModel.get(modelId) ?? [])
    const freeText = Object.freeze(freeTextByModel.get(modelId) ?? [])
    models.set(
      modelId,
      Object.freeze({ ...model, occurrences, connectionOccurrences, lanes, freeText })
    )
  }

  return Object.freeze({
    database: buildDatabase(index.database),
    models: Object.freeze(models),
    objectDefinitions: Object.freeze(objectDefinitions),
    connectionDefinitions: Object.freeze(connectionDefinitions),
    styleCatalog: buildStyleCatalog(index.styles),
    sourceIndex: index,
    revision: 0
  })
}
