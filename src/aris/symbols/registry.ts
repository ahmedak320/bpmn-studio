import { UNKNOWN_SYMBOL_DESCRIPTOR } from './fallback'
import {
  ARIS_OBJECT_TYPE_DEFAULT_SYMBOL,
  ARIS_SYMBOL_DESCRIPTORS,
  type DmtSymbolDescriptor
} from './shapes'
import type {
  ArisSourceGeometry,
  ArisSourceSymbolStyle,
  ArisSymbolDescriptor,
  ArisSymbolFidelityFinding,
  ArisSymbolResolutionRequest,
  ArisSymbolResolutionResult
} from './types'

export type {
  ArisSymbolDescriptor,
  ArisSymbolFidelityFinding,
  ArisSymbolResolutionRequest,
  ArisSymbolResolutionResult
}
export type {
  DmtBox,
  DmtIconId,
  DmtOperator,
  DmtPaintRole,
  DmtPartId,
  DmtScalePolicy,
  DmtSemanticPart,
  DmtSilhouette,
  DmtSymbolDescriptor
} from './shapes'
export { isDmtSymbolDescriptor } from './shapes'

interface SymbolIndexes {
  readonly exact: ReadonlyMap<string, ArisSymbolDescriptor>
  readonly byObjectSymbol: ReadonlyMap<string, ArisSymbolDescriptor>
  readonly byCatalogId: ReadonlyMap<string, DmtSymbolDescriptor>
}

function buildIndexes(descriptors: readonly DmtSymbolDescriptor[]): SymbolIndexes {
  const exact = new Map<string, ArisSymbolDescriptor>()
  const byObjectSymbol = new Map<string, ArisSymbolDescriptor>()
  const byCatalogId = new Map<string, DmtSymbolDescriptor>()
  for (const descriptor of descriptors) {
    if (!exact.has(descriptor.key)) {
      exact.set(descriptor.key, descriptor)
    }
    const objectSymbolKey = `${descriptor.objectType}:${descriptor.symbolNum}`
    if (!byObjectSymbol.has(objectSymbolKey)) {
      byObjectSymbol.set(objectSymbolKey, descriptor)
    }
    byCatalogId.set(descriptor.catalogId, descriptor)
  }
  return {
    exact,
    byObjectSymbol,
    byCatalogId
  }
}

const INDEXES = buildIndexes(ARIS_SYMBOL_DESCRIPTORS)

function makeFidelityFinding(
  kind: ArisSymbolFidelityFinding['kind'],
  messageKey: string,
  request: ArisSymbolResolutionRequest,
  requestedKey: string,
  resolvedKey: string
): ArisSymbolFidelityFinding {
  return Object.freeze({
    kind,
    messageKey,
    modelType: request.modelType,
    objectType: request.objectType,
    symbolNum: request.symbolNum,
    requestedKey,
    resolvedKey
  })
}

function resolveDescriptor(request: ArisSymbolResolutionRequest): {
  readonly descriptor: ArisSymbolDescriptor
  readonly findings: readonly ArisSymbolFidelityFinding[]
} {
  const requestedKey = `${request.modelType}:${request.objectType}:${request.symbolNum}`

  // 1. Exact triple match.
  const exact = INDEXES.exact.get(requestedKey)
  if (exact) {
    return { descriptor: exact, findings: [] }
  }

  // 2. Object type + SymbolNum, any model type.
  const crossModel = INDEXES.byObjectSymbol.get(`${request.objectType}:${request.symbolNum}`)
  if (crossModel) {
    return {
      descriptor: crossModel,
      findings: [
        makeFidelityFinding(
          'substituted-visual-resource',
          'aris.fidelity.substitutedVisualResource',
          request,
          requestedKey,
          crossModel.key
        )
      ]
    }
  }

  // 3. A missing symbol on a newly authored request uses the object default.
  // An explicit but unknown imported SymbolNum must remain visibly unknown;
  // silently replacing it would hide a fidelity loss behind a plausible card.
  const defaultSymbolNum = ARIS_OBJECT_TYPE_DEFAULT_SYMBOL[request.objectType]
  if (defaultSymbolNum && request.symbolNum.trim() === '') {
    const defaultExact = INDEXES.exact.get(
      `${request.modelType}:${request.objectType}:${defaultSymbolNum}`
    )
    const defaultDescriptor =
      defaultExact ?? INDEXES.byObjectSymbol.get(`${request.objectType}:${defaultSymbolNum}`)
    if (defaultDescriptor) {
      return {
        descriptor: defaultDescriptor,
        findings: [
          makeFidelityFinding(
            'substituted-visual-resource',
            'aris.fidelity.substitutedVisualResource',
            request,
            requestedKey,
            defaultDescriptor.key
          )
        ]
      }
    }
  }

  // 4. Explicit visible unknown-symbol fallback.
  return {
    descriptor: UNKNOWN_SYMBOL_DESCRIPTOR,
    findings: [
      makeFidelityFinding(
        'unknown-custom-symbol',
        'aris.fidelity.unknownCustomSymbol',
        request,
        requestedKey,
        UNKNOWN_SYMBOL_DESCRIPTOR.key
      )
    ]
  }
}

function passthroughSource(
  source: ArisSymbolResolutionRequest['source']
): ArisSymbolResolutionRequest['source'] {
  if (!source) return undefined
  const geometry: ArisSourceGeometry | undefined =
    source.geometry === undefined
      ? undefined
      : Object.freeze({
          x: source.geometry.x,
          y: source.geometry.y,
          dx: source.geometry.dx,
          dy: source.geometry.dy
        })
  const style: ArisSourceSymbolStyle | undefined =
    source.style === undefined
      ? undefined
      : Object.freeze({
          pen:
            source.style.pen === undefined
              ? undefined
              : Object.freeze({
                  color: source.style.pen.color,
                  style: source.style.pen.style,
                  width: source.style.pen.width
                }),
          brush:
            source.style.brush === undefined
              ? undefined
              : Object.freeze({
                  color: source.style.brush.color,
                  color2: source.style.brush.color2,
                  brushType: source.style.brush.brushType
                })
        })
  return Object.freeze({
    symbolRef: source.symbolRef,
    symbolGuid: source.symbolGuid,
    geometry,
    style,
    zOrder: source.zOrder
  })
}

/**
 * Resolves a model type / object type / SymbolNum triple to a symbol descriptor.
 *
 * Fallback order:
 * 1. exact triple match;
 * 2. object type + SymbolNum, any model type;
 * 3. object type default symbol when SymbolNum is absent;
 * 4. explicit visible unknown-symbol fallback.
 *
 * Source geometry, style, and reference material are passed through unchanged.
 */
export function resolveArisSymbol(
  request: ArisSymbolResolutionRequest
): ArisSymbolResolutionResult {
  const { descriptor, findings } = resolveDescriptor(request)
  return Object.freeze({
    descriptor,
    fidelity: Object.freeze(findings),
    source: passthroughSource(request.source)
  })
}

/** Returns the canonical descriptor for an object type's default symbol, or the unknown fallback. */
export function resolveDefaultSymbol(objectType: string): ArisSymbolDescriptor {
  const defaultSymbolNum = ARIS_OBJECT_TYPE_DEFAULT_SYMBOL[objectType]
  if (!defaultSymbolNum) return UNKNOWN_SYMBOL_DESCRIPTOR
  return (
    INDEXES.exact.get(`MT_EEPC:${objectType}:${defaultSymbolNum}`) ??
    INDEXES.byObjectSymbol.get(`${objectType}:${defaultSymbolNum}`) ??
    UNKNOWN_SYMBOL_DESCRIPTOR
  )
}

/**
 * Resolve an exact DMT presentation identity for descriptor-driven previews.
 *
 * This is intentionally separate from `resolveArisSymbol`: imports only carry a
 * persisted triple and must not guess between catalog variants whose known
 * objectType:symbolNum identity is shared.
 */
export function resolveArisCatalogSymbol(catalogId: string): DmtSymbolDescriptor | null {
  return INDEXES.byCatalogId.get(catalogId) ?? null
}

/** All descriptors in the registry. */
export function getArisSymbolDescriptors(): readonly DmtSymbolDescriptor[] {
  return ARIS_SYMBOL_DESCRIPTORS
}
