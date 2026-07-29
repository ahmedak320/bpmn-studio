/**
 * Builds the headless, source-faithful render model — Plan Section 12 (Phase 9).
 *
 * This is the single entry point the canvas lane (`src/aris/canvas/`) and the layout lane
 * (`src/aris/layout/`) consume. It reads every Section 12.1 visual input from the narrow
 * `ArisRenderSourceInput` seam (`input.ts`), resolves symbols through the symbol registry seam
 * (`symbolAdapter.ts`), maps pens/brushes/fonts/text (`color.ts`/`font.ts`/`textWrap.ts`), and
 * reports every fallback as a structured, i18n-keyed fidelity finding (`fidelity.ts`). The
 * source geometry on every element, connection, lane, free-text, and attachment is copied
 * through unmodified — Source Layout mode (`layoutModes.ts`) depends on that being exact.
 */

import { resolveBrush, resolvePen } from './color'
import {
  buildMissingTemplateFinding,
  buildMissingReferenceExportFinding,
  buildUnsupportedOleRenderingFinding,
  countFidelityByKind,
  mergeFidelityFindings
} from './fidelity'
import { resolveFont } from './font'
import type {
  ArisRenderSourceInput,
  RenderSourceAttribute,
  RenderSourceAttributeValue,
  RenderSourceFont,
  RenderSourceRoutePoint
} from './input'
import { resolveElementSymbol } from './symbolAdapter'
import { buildTextWrapFinding, wrapText } from './textWrap'
import type {
  ArisRenderFidelityFinding,
  ArisRenderModelResult,
  RenderAttachment,
  RenderBounds,
  RenderConnection,
  RenderDrawOrderEntry,
  RenderElement,
  RenderFreeText,
  RenderLane,
  RenderModelBackground,
  RenderModelDocument,
  RenderSourceAnchor,
  RenderTextBlock
} from './types'

const TEXT_PADDING_PX = 8
const NO_COLOR_SENTINEL = '-1'

interface Identity {
  readonly modelId: string | null
  readonly elementId: string | null
  readonly sourceId: string | null
}

function anchorOf(
  sourceId: string | null,
  path: string,
  modelId: string | null
): RenderSourceAnchor {
  return { sourceId, path, modelId }
}

/** Prefers English, falls back to Arabic, then to whatever locale was recorded first. */
function pickPrimaryAttributeValue(
  values: readonly RenderSourceAttributeValue[]
): RenderSourceAttributeValue | null {
  if (values.length === 0) return null
  return values.find((v) => v.locale === 'en') ?? values.find((v) => v.locale === 'ar') ?? values[0]
}

function indexByOwner<T extends { readonly parsed: { readonly ownerSourceId: string | null } }>(
  records: readonly T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const record of records) {
    const owner = record.parsed.ownerSourceId
    if (!owner) continue
    const list = map.get(owner)
    if (list) list.push(record)
    else map.set(owner, [record])
  }
  return map
}

function indexAttributesByOwnerAndType(
  attributes: readonly RenderSourceAttribute[]
): Map<string, RenderSourceAttribute> {
  const map = new Map<string, RenderSourceAttribute>()
  for (const attr of attributes) {
    const owner = attr.parsed.ownerSourceId
    const type = attr.parsed.attributeType
    if (!owner || !type) continue
    const key = `${owner}::${type}`
    if (!map.has(key)) map.set(key, attr)
  }
  return map
}

function indexRoutePointsByConnection(
  routePoints: readonly RenderSourceRoutePoint[]
): Map<string, RenderSourceRoutePoint[]> {
  const map = new Map<string, RenderSourceRoutePoint[]>()
  for (const point of routePoints) {
    const owner = point.connectionOccurrenceId
    if (!owner) continue
    const list = map.get(owner)
    if (list) list.push(point)
    else map.set(owner, [point])
  }
  return map
}

/** Builds a text block for `value` using `fontStyleSheetId` to find locale-matched font metrics. */
function buildTextBlock(
  value: RenderSourceAttributeValue,
  fontsByStyleSheet: ReadonlyMap<string, RenderSourceFont[]>,
  fontStyleSheetId: string | null,
  maxWidthPx: number | null,
  identity: Identity,
  findings: ArisRenderFidelityFinding[]
): RenderTextBlock {
  const candidates = fontStyleSheetId ? (fontsByStyleSheet.get(fontStyleSheetId) ?? []) : []
  const fontRecord =
    candidates.find((f) => f.parsed.locale === value.locale) ?? candidates[0] ?? null
  const { font, findings: fontFindings } = resolveFont(
    fontRecord?.parsed ?? null,
    value.text,
    identity
  )
  findings.push(...fontFindings)

  const { lines, wrapped } = wrapText(value.text, maxWidthPx, font.sizePx)
  const wrapFinding = buildTextWrapFinding(wrapped, identity)
  if (wrapFinding) findings.push(wrapFinding)

  return { rawText: value.text, lines, direction: font.direction, wrapped, font }
}

function boundsFrom(
  x: number | null,
  y: number | null,
  dx: number | null,
  dy: number | null,
  fallbackWidth: number,
  fallbackHeight: number
): RenderBounds {
  return {
    x: x ?? 0,
    y: y ?? 0,
    width: dx ?? fallbackWidth,
    height: dy ?? fallbackHeight
  }
}

/** Builds the complete headless render model for every model in `input`. */
export function buildArisRenderModel(input: ArisRenderSourceInput): ArisRenderModelResult {
  const findings: ArisRenderFidelityFinding[] = []

  const pensByOwner = indexByOwner(input.styles.pens)
  const brushesByOwner = indexByOwner(input.styles.brushes)
  const fontsByStyleSheet = new Map<string, RenderSourceFont[]>()
  for (const font of input.styles.fonts) {
    const owner = font.parsed.ownerSourceId
    if (!owner) continue
    const list = fontsByStyleSheet.get(owner)
    if (list) list.push(font)
    else fontsByStyleSheet.set(owner, [font])
  }
  const attributesByOwnerType = indexAttributesByOwnerAndType(input.attributes)
  const attrOccByOwner = indexByOwner(input.attributeOccurrences)
  const routePointsByConnection = indexRoutePointsByConnection(input.routePoints)

  const models: RenderModelDocument[] = []

  for (const modelRecord of input.models.values()) {
    const modelId = modelRecord.parsed.modelId ?? modelRecord.sourceId ?? ''
    const modelType = modelRecord.parsed.modelType

    if (modelRecord.parsed.templateGuid) {
      findings.push(buildMissingTemplateFinding(modelId, modelRecord.parsed.templateGuid))
    }

    const background: RenderModelBackground =
      modelRecord.parsed.backColor === null ||
      modelRecord.parsed.backColor.trim() === NO_COLOR_SENTINEL
        ? { color: undefined, isDefault: true }
        : { color: cssColorOrUndefined(modelRecord.parsed.backColor), isDefault: false }

    // --- Elements (ObjOcc) ---
    const elements: RenderElement[] = []
    for (const occ of input.objectOccurrences.values()) {
      if (occ.parsed.modelId !== modelId) continue
      const elementId =
        occ.sourceId ?? occ.parsed.objectOccurrenceId ?? `element:${elements.length}`
      const objDef = occ.parsed.objectDefinitionId
        ? input.objectDefinitions.get(occ.parsed.objectDefinitionId)
        : undefined
      const objectType = objDef?.parsed.typeNum ?? 'OT_UNKNOWN'
      const symbolNum = occ.parsed.symbolNum ?? objDef?.parsed.symbolNum ?? ''
      const identity: Identity = { modelId, elementId, sourceId: occ.sourceId }

      const resolvedSymbol = resolveElementSymbol(
        {
          modelType: modelType ?? 'MT_EEPC',
          objectType,
          symbolNum,
          source: {
            symbolGuid: occ.parsed.symbolGuid ?? undefined,
            geometry: {
              x: occ.parsed.x ?? undefined,
              y: occ.parsed.y ?? undefined,
              dx: occ.parsed.dx ?? undefined,
              dy: occ.parsed.dy ?? undefined
            },
            zOrder: occ.parsed.zorder ?? undefined
          }
        },
        identity
      )
      findings.push(...resolvedSymbol.findings)

      const sourceBounds = boundsFrom(
        occ.parsed.x,
        occ.parsed.y,
        occ.parsed.dx,
        occ.parsed.dy,
        resolvedSymbol.descriptor.defaultBounds.width,
        resolvedSymbol.descriptor.defaultBounds.height
      )

      const penSource = pensByOwner.get(occ.sourceId ?? '')?.[0]?.parsed ?? null
      const { pen, findings: penFindings } = resolvePen(penSource, identity)
      findings.push(...penFindings)

      const brushSource = brushesByOwner.get(occ.sourceId ?? '')?.[0]?.parsed ?? null
      const { brush, findings: brushFindings } = resolveBrush(brushSource, identity)
      findings.push(...brushFindings)

      let name: RenderTextBlock | null = null
      if (objDef?.sourceId) {
        const nameAttr = attributesByOwnerType.get(`${objDef.sourceId}::AT_NAME`)
        const primary = nameAttr ? pickPrimaryAttributeValue(nameAttr.parsed.values) : null
        if (primary && primary.text.trim() !== '') {
          const nameOcc = (attrOccByOwner.get(elementId) ?? []).find(
            (a) => a.parsed.attributeType === 'AT_NAME'
          )
          const maxWidthPx =
            sourceBounds.width > 0 ? Math.max(1, sourceBounds.width - TEXT_PADDING_PX) : null
          name = buildTextBlock(
            primary,
            fontsByStyleSheet,
            nameOcc?.parsed.fontStyleSheetId ?? null,
            maxWidthPx,
            identity,
            findings
          )
        }
      }

      const attributeOccurrences = (attrOccByOwner.get(elementId) ?? []).map((a) => ({
        attributeType: a.parsed.attributeType,
        port: a.parsed.port,
        orderNum: a.parsed.orderNum,
        alignment: a.parsed.alignment,
        offsetX: a.parsed.offsetX,
        offsetY: a.parsed.offsetY,
        rotation: a.parsed.rotation,
        bounds:
          a.parsed.dx !== null || a.parsed.dy !== null
            ? { width: a.parsed.dx ?? 0, height: a.parsed.dy ?? 0 }
            : null,
        fontStyleSheetId: a.parsed.fontStyleSheetId,
        text: null
      }))

      elements.push({
        id: elementId,
        anchor: anchorOf(occ.sourceId, occ.path, modelId),
        objectDefinitionId: occ.parsed.objectDefinitionId,
        objectType,
        symbolNum,
        sourceBounds,
        zOrder: occ.parsed.zorder ?? 0,
        symbol: resolvedSymbol.descriptor,
        symbolSource: resolvedSymbol.source,
        pen,
        brush,
        name,
        attributeOccurrences
      })
    }

    // --- Connections (CxnOcc) ---
    const connections: RenderConnection[] = []
    for (const occ of input.connectionOccurrences.values()) {
      if (occ.parsed.modelId !== modelId) continue
      const connectionId =
        occ.sourceId ?? occ.parsed.connectionOccurrenceId ?? `connection:${connections.length}`
      const identity: Identity = { modelId, elementId: connectionId, sourceId: occ.sourceId }
      const cxnDef = occ.parsed.connectionDefinitionId
        ? input.connectionDefinitions.get(occ.parsed.connectionDefinitionId)
        : undefined

      const routePoints = (routePointsByConnection.get(occ.sourceId ?? '') ?? [])
        .slice()
        .sort((a, b) => a.pointIndex - b.pointIndex)
        .map((p) => ({ x: p.x ?? 0, y: p.y ?? 0 }))

      const penSource = pensByOwner.get(occ.sourceId ?? '')?.[0]?.parsed ?? null
      const { pen, findings: penFindings } = resolvePen(penSource, identity)
      findings.push(...penFindings)

      connections.push({
        id: connectionId,
        anchor: anchorOf(occ.sourceId, occ.path, modelId),
        connectionDefinitionId: occ.parsed.connectionDefinitionId,
        connectionType: cxnDef?.parsed.connectionType ?? null,
        fromElementId: occ.parsed.fromObjectOccurrenceId,
        toElementId: occ.parsed.toObjectOccurrenceId,
        zOrder: occ.parsed.zorder ?? 0,
        sourceRoutePoints: routePoints,
        pen,
        srcArrow: occ.parsed.srcArrow,
        tgtArrow: occ.parsed.tgtArrow,
        visible: occ.parsed.visible !== 'NO'
      })
    }

    // --- Lanes ---
    const lanes: RenderLane[] = []
    for (const lane of input.lanes.values()) {
      if (lane.parsed.modelId !== modelId) continue
      const laneId = lane.sourceId ?? lane.parsed.laneId ?? `lane:${lanes.length}`
      const identity: Identity = { modelId, elementId: laneId, sourceId: lane.sourceId }

      const penSource = pensByOwner.get(lane.sourceId ?? '')?.[0]?.parsed ?? null
      const { pen, findings: penFindings } = resolvePen(penSource, identity)
      findings.push(...penFindings)
      const brushSource = brushesByOwner.get(lane.sourceId ?? '')?.[0]?.parsed ?? null
      const { brush, findings: brushFindings } = resolveBrush(brushSource, identity)
      findings.push(...brushFindings)

      let name: RenderTextBlock | null = null
      const nameAttr = lane.sourceId
        ? attributesByOwnerType.get(`${lane.sourceId}::AT_NAME`)
        : undefined
      const primary = nameAttr ? pickPrimaryAttributeValue(nameAttr.parsed.values) : null
      if (primary && primary.text.trim() !== '') {
        name = buildTextBlock(primary, fontsByStyleSheet, null, null, identity, findings)
      }

      lanes.push({
        id: laneId,
        anchor: anchorOf(lane.sourceId, lane.path, modelId),
        laneType: lane.parsed.laneType,
        orientation: lane.parsed.orientation,
        startBorder: lane.parsed.startBorder,
        endBorder: lane.parsed.endBorder,
        pen,
        brush,
        name
      })
    }

    // --- Free text ---
    const freeText: RenderFreeText[] = []
    for (const occ of input.freeTextOccurrences) {
      if (occ.parsed.modelId !== modelId) continue
      const freeTextId = occ.sourceId ?? `freetext:${freeText.length}`
      const identity: Identity = { modelId, elementId: freeTextId, sourceId: occ.sourceId }
      const sourceBounds = boundsFrom(
        occ.parsed.x,
        occ.parsed.y,
        occ.parsed.dx,
        occ.parsed.dy,
        100,
        30
      )

      let text: RenderTextBlock | null = null
      const nameAttr = occ.parsed.freeTextDefinitionId
        ? attributesByOwnerType.get(`${occ.parsed.freeTextDefinitionId}::AT_NAME`)
        : undefined
      const primary = nameAttr ? pickPrimaryAttributeValue(nameAttr.parsed.values) : null
      if (primary && primary.text.trim() !== '') {
        const maxWidthPx =
          sourceBounds.width > 0 ? Math.max(1, sourceBounds.width - TEXT_PADDING_PX) : null
        text = buildTextBlock(
          primary,
          fontsByStyleSheet,
          occ.parsed.fontStyleSheetId,
          maxWidthPx,
          identity,
          findings
        )
      }

      freeText.push({
        id: freeTextId,
        anchor: anchorOf(occ.sourceId, occ.path, modelId),
        sourceBounds,
        zOrder: occ.parsed.zorder ?? 0,
        text
      })
    }

    // --- Attachments (OLE) ---
    const attachments: RenderAttachment[] = []
    for (const occ of input.attachmentOccurrences) {
      if (occ.parsed.modelId !== modelId) continue
      const attachmentOccId = occ.sourceId ?? `attachment:${attachments.length}`
      const sourceBounds = boundsFrom(
        occ.parsed.x,
        occ.parsed.y,
        occ.parsed.dx,
        occ.parsed.dy,
        100,
        100
      )
      const attachmentDef = occ.parsed.attachmentId
        ? input.attachments.get(occ.parsed.attachmentId)
        : undefined
      const blobCount = attachmentDef?.parsed.blobCount ?? 0

      findings.push(
        buildUnsupportedOleRenderingFinding(modelId, occ.sourceId, occ.parsed.attachmentId)
      )
      if (blobCount === 0) {
        findings.push(
          buildMissingReferenceExportFinding(modelId, occ.sourceId, occ.parsed.attachmentId)
        )
      }

      attachments.push({
        id: attachmentOccId,
        anchor: anchorOf(occ.sourceId, occ.path, modelId),
        kind: 'ole',
        sourceBounds,
        zOrder: occ.parsed.zorder ?? 0,
        attachmentDefinitionId: occ.parsed.attachmentId,
        blobCount
      })
    }

    const drawOrder: RenderDrawOrderEntry[] = [
      ...elements.map((e) => ({ kind: 'element' as const, id: e.id, zOrder: e.zOrder })),
      ...connections.map((c) => ({ kind: 'connection' as const, id: c.id, zOrder: c.zOrder })),
      ...freeText.map((f) => ({ kind: 'freeText' as const, id: f.id, zOrder: f.zOrder })),
      ...attachments.map((a) => ({ kind: 'attachment' as const, id: a.id, zOrder: a.zOrder }))
    ].sort((a, b) => a.zOrder - b.zOrder)

    models.push({
      modelId,
      modelType,
      background,
      scale: modelRecord.parsed.scale,
      printScale: modelRecord.parsed.printScale,
      gridSize: modelRecord.parsed.gridSize,
      gridUse: modelRecord.parsed.gridUse === 'YES',
      templateGuid: modelRecord.parsed.templateGuid,
      elements,
      connections,
      lanes,
      freeText,
      attachments,
      drawOrder
    })
  }

  const merged = mergeFidelityFindings([findings])
  return {
    models,
    fidelity: merged,
    fidelityByKind: countFidelityByKind(merged)
  }
}

function cssColorOrUndefined(raw: string): string | undefined {
  const value = Number.parseInt(raw.trim(), 16)
  if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) return undefined
  return `#${Math.min(value, 0xffffff).toString(16).padStart(6, '0')}`
}
