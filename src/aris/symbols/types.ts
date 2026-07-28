/**
 * ARIS symbol registry types — Plan Section 12.2.
 *
 * Symbols are keyed by model type + object type + SymbolNum.  The registry supplies
 * OrbitPM-authored original geometry for standard EPC notation glyphs.  It never embeds
 * raster images or external references, and it preserves every source-provided visual
 * property instead of overwriting it.
 */

export interface ArisBounds {
  readonly width: number
  readonly height: number
}

export interface ArisPoint {
  readonly x: number
  readonly y: number
}

export interface ArisViewBox {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

export type ArisPortName =
  | 'N'
  | 'NE'
  | 'E'
  | 'SE'
  | 'S'
  | 'SW'
  | 'W'
  | 'NW'
  | 'CENTER'

export interface ArisPort {
  readonly name: ArisPortName
  /** Normalized X inside the view box (0..1). */
  readonly nx: number
  /** Normalized Y inside the view box (0..1). */
  readonly ny: number
}

export type ArisDrawingElement =
  | {
      readonly kind: 'path'
      readonly d: string
      readonly fill?: string
      readonly stroke?: string
      readonly strokeWidth?: number
    }
  | {
      readonly kind: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly rx?: number
      readonly ry?: number
      readonly fill?: string
      readonly stroke?: string
      readonly strokeWidth?: number
    }
  | {
      readonly kind: 'circle'
      readonly cx: number
      readonly cy: number
      readonly r: number
      readonly fill?: string
      readonly stroke?: string
      readonly strokeWidth?: number
    }
  | {
      readonly kind: 'polygon'
      readonly points: readonly ArisPoint[]
      readonly fill?: string
      readonly stroke?: string
      readonly strokeWidth?: number
    }
  | {
      readonly kind: 'line'
      readonly x1: number
      readonly y1: number
      readonly x2: number
      readonly y2: number
      readonly stroke?: string
      readonly strokeWidth?: number
    }

export interface ArisSymbolDrawing {
  /** Logical coordinate system for the authored geometry. */
  readonly viewBox: ArisViewBox
  /** Ordered drawing primitives.  No raster images, no external references. */
  readonly elements: readonly ArisDrawingElement[]
}

/** Style carried by the source occurrence.  The registry passes it through unchanged. */
export interface ArisSourceSymbolStyle {
  readonly pen?: {
    readonly color?: string
    readonly style?: string
    readonly width?: number
  }
  readonly brush?: {
    readonly color?: string
    readonly color2?: string
    readonly brushType?: string
  }
}

export interface ArisSourceGeometry {
  readonly x?: number
  readonly y?: number
  readonly dx?: number
  readonly dy?: number
}

export interface ArisSymbolDescriptor {
  /** Stable registry key, e.g. `MT_EEPC:OT_FUNC:ST_FUNC`. */
  readonly key: string
  /** Source object type (OT_*). */
  readonly objectType: string
  /** Source SymbolNum. */
  readonly symbolNum: string
  /** i18n dictionary key for the human-readable label. */
  readonly labelKey: string
  /** Default size in logical units when the source provides none. */
  readonly defaultBounds: ArisBounds
  /** Named anchor points for connection attachment. */
  readonly ports: readonly ArisPort[]
  /** Original authored geometry. */
  readonly drawing: ArisSymbolDrawing
}

export interface ArisSymbolResolutionRequest {
  readonly modelType: string
  readonly objectType: string
  readonly symbolNum: string
  /** Optional source material that must be preserved verbatim. */
  readonly source?: {
    readonly symbolRef?: string
    readonly symbolGuid?: string
    readonly geometry?: ArisSourceGeometry
    readonly style?: ArisSourceSymbolStyle
    readonly zOrder?: number
  }
}

export type ArisSymbolFidelityKind =
  | 'unknown-custom-symbol'
  | 'substituted-visual-resource'
  | 'missing-template'

export interface ArisSymbolFidelityFinding {
  readonly kind: ArisSymbolFidelityKind
  /** i18n key for the fidelity report UI. */
  readonly messageKey: string
  readonly modelType: string
  readonly objectType: string
  readonly symbolNum: string
  readonly requestedKey: string
  readonly resolvedKey: string
}

export interface ArisSymbolResolutionResult {
  readonly descriptor: ArisSymbolDescriptor
  readonly fidelity: readonly ArisSymbolFidelityFinding[]
  /** Source material passed through unchanged. */
  readonly source: ArisSymbolResolutionRequest['source']
}
