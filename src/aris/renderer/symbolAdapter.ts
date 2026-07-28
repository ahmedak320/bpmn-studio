/**
 * Thin seam onto the symbol registry lane (`src/aris/symbols/`) — Plan Section 12.2.
 *
 * This module does not author symbol geometry and does not duplicate the registry's
 * unknown-symbol fallback logic. It only resolves a `{modelType, objectType, symbolNum}` triple
 * via `resolveArisSymbol` and re-shapes the registry's own fidelity findings into the renderer's
 * finding type, so the render model's fidelity report can merge both without the caller having
 * to know two different finding shapes exist.
 */

import { resolveArisSymbol } from '../symbols'
import type {
  ArisSymbolDescriptor,
  ArisSymbolFidelityFinding,
  ArisSymbolResolutionRequest
} from '../symbols'
import type { ArisRenderFidelityFinding } from './types'

export interface SymbolAdapterIdentity {
  readonly modelId: string | null
  readonly elementId: string | null
  readonly sourceId: string | null
}

export interface ResolvedElementSymbol {
  readonly descriptor: ArisSymbolDescriptor
  readonly source: ArisSymbolResolutionRequest['source']
  readonly findings: readonly ArisRenderFidelityFinding[]
}

function toRenderFinding(
  finding: ArisSymbolFidelityFinding,
  identity: SymbolAdapterIdentity
): ArisRenderFidelityFinding {
  return {
    kind: finding.kind,
    messageKey: finding.messageKey,
    modelId: identity.modelId,
    elementId: identity.elementId,
    sourceId: identity.sourceId,
    params: {
      modelType: finding.modelType,
      objectType: finding.objectType,
      symbolNum: finding.symbolNum,
      requestedKey: finding.requestedKey,
      resolvedKey: finding.resolvedKey
    }
  }
}

/** Resolves the symbol for one `ObjOcc`, preserving source geometry/style/refs unchanged. */
export function resolveElementSymbol(
  request: ArisSymbolResolutionRequest,
  identity: SymbolAdapterIdentity
): ResolvedElementSymbol {
  const result = resolveArisSymbol(request)
  return {
    descriptor: result.descriptor,
    source: result.source,
    findings: result.fidelity.map((finding) => toRenderFinding(finding, identity))
  }
}
