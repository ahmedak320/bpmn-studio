/**
 * PDF export for the live ARIS canvas.
 *
 * Ported from the main branch's BPMN export (`src/editor/exportPdf.ts` +
 * `src/editor/exportImage.ts`) and adapted to the ARIS diagram-js canvas:
 * bpmn-js's `modeler.saveSVG()` has no diagram-js equivalent, so the export
 * SVG is captured here from the live `[data-orbitpm-aris-canvas]` DOM — the
 * full content bounds of every layer (print-frame furniture included), with
 * the view/zoom transform neutralized and interaction-only nodes (selection
 * outlines, bendpoint draggers) stripped.
 *
 * Rasterizing first is deliberate (same rationale as main): it preserves
 * Arabic/bidi labels, the symbol-registry fills and the FontStyleSheet
 * typography exactly as rendered, without requiring a second PDF font stack.
 * The raster is then wrapped in a direct, deterministic PDF (fixed creation
 * date and file id) so identical views export byte-identical files.
 *
 * One bounded page always holds the whole sheet: the page geometry scales the
 * image down to {@link PDF_MAX_SIDE_PT} on its long side, so no ARIS sheet can
 * overflow and multi-page pagination never triggers (the print frame itself is
 * single-page page furniture by design — see `printFrame.ts`).
 */

import { jsPDF } from 'jspdf'

export interface ArisPdfImageSize {
  readonly width: number
  readonly height: number
}

export interface ArisPdfPageGeometry {
  readonly pageWidth: number
  readonly pageHeight: number
  readonly imageX: number
  readonly imageY: number
  readonly imageWidth: number
  readonly imageHeight: number
}

const PDF_MARGIN_PT = 18
const PDF_MAX_SIDE_PT = 2_000
const FIXED_PDF_DATE = "D:20000101000000+00'00'"

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** Page geometry for one diagram image: margins around it, long side bounded. */
export function arisPdfPageGeometry(size: ArisPdfImageSize): ArisPdfPageGeometry {
  const width = finitePositive(size.width, 800)
  const height = finitePositive(size.height, 600)
  const available = PDF_MAX_SIDE_PT - PDF_MARGIN_PT * 2
  const scale = Math.min(1, available / Math.max(width, height))
  const imageWidth = Math.max(1, width * scale)
  const imageHeight = Math.max(1, height * scale)
  return {
    pageWidth: imageWidth + PDF_MARGIN_PT * 2,
    pageHeight: imageHeight + PDF_MARGIN_PT * 2,
    imageX: PDF_MARGIN_PT,
    imageY: PDF_MARGIN_PT,
    imageWidth,
    imageHeight
  }
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** jsPDF requires an exact 32-hex-character document file ID. */
export function deterministicArisPdfFileId(value: string): string {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => fnv1a(value, seed).toString(16).padStart(8, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Wrap a faithful PNG rasterization of the ARIS canvas in a direct,
 * deterministic PDF.
 */
export function createArisDiagramPdf(
  pngDataUrl: string,
  size: ArisPdfImageSize,
  title: string
): ArrayBuffer {
  const geometry = arisPdfPageGeometry(size)
  const normalizedTitle = title.trim() || 'diagram'
  const document = new jsPDF({
    orientation: geometry.pageWidth >= geometry.pageHeight ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [geometry.pageWidth, geometry.pageHeight],
    compress: true,
    precision: 6,
    floatPrecision: 16,
    putOnlyUsedFonts: true
  })
  document.setCreationDate(FIXED_PDF_DATE)
  document.setFileId(deterministicArisPdfFileId(`${normalizedTitle}\n${pngDataUrl}`))
  document.setProperties({
    title: normalizedTitle,
    subject: 'ARIS process model',
    author: 'OrbitPM',
    creator: 'OrbitPM ARIS Studio Lite',
    keywords: 'ARIS, OrbitPM'
  })
  document.addImage(
    pngDataUrl,
    'PNG',
    geometry.imageX,
    geometry.imageY,
    geometry.imageWidth,
    geometry.imageHeight,
    'orbitpm-aris-diagram',
    'FAST'
  )
  return document.output('arraybuffer')
}

// --- SVG -> PNG rasterization (ported; deps injected for Node-testability) ---

export interface ArisCanvasRenderingContext2DLike {
  fillStyle: string
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void
}

export interface ArisCanvasLike {
  width: number
  height: number
  getContext(contextId: '2d'): ArisCanvasRenderingContext2DLike | null
  toDataURL(type?: string): string
}

export interface ArisSvgToPngDeps {
  readonly createCanvas: (width: number, height: number) => ArisCanvasLike
  /** Resolves to anything `CanvasRenderingContext2D#drawImage` accepts. */
  readonly loadImage: (svgDataUrl: string) => Promise<unknown>
  /** PNG has no transparency-by-default like SVG on a dark host page might imply; default white. */
  readonly backgroundColor?: string
}

/** Turns raw SVG markup into a data: URL PNG via an offscreen canvas draw. */
export async function arisSvgToPngDataUrl(
  svgMarkup: string,
  size: ArisPdfImageSize,
  deps: ArisSvgToPngDeps
): Promise<string> {
  const { width, height } = size
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid export size ${width}x${height}`)
  }

  const canvas = deps.createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable')
  }

  ctx.fillStyle = deps.backgroundColor ?? '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`
  const image = await deps.loadImage(svgDataUrl)
  ctx.drawImage(image, 0, 0, width, height)

  return canvas.toDataURL('image/png')
}

// --- live-canvas SVG capture (ARIS-specific; no saveSVG in plain diagram-js) ---

export interface ArisCanvasSvgBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ArisCanvasSvgCapture {
  readonly markup: string
  readonly size: ArisPdfImageSize
}

/**
 * Breathing room around the tight content bbox, in diagram units. Covers
 * stroke widths (getBBox excludes stroking) and keeps captions off the edge.
 */
export const ARIS_EXPORT_SVG_PADDING = 24

/**
 * The largest raster side, in pixels. AnimalWF sheets (~7,000 units wide)
 * rasterize 1:1; the cap only guards browser canvas limits on extreme sheets.
 */
export const ARIS_EXPORT_MAX_RASTER_SIDE = 8_192

/**
 * Interaction-only furniture that lives in the same SVG as the diagram but
 * must never print: lazily-created selection/hover outlines (class-only
 * styling — serialized bare they would paint as black boxes) and the
 * bendpoint/segment draggers shown while hovering a connection.
 */
const EXPORT_STRIP_SELECTOR = '.djs-outline, .djs-segment-dragger, .djs-bendpoint'

function findViewport(svgRoot: SVGSVGElement): SVGGElement | null {
  for (const child of Array.from(svgRoot.children)) {
    if (child instanceof SVGElement && child.classList.contains('viewport')) {
      return child as SVGGElement
    }
  }
  return null
}

/**
 * Serialize `svgRoot` (the diagram-js root `<svg>`) as a standalone,
 * self-contained SVG document covering `bounds` at scale 1:1: the view
 * transform on the `.viewport` group is neutralized, interaction furniture is
 * removed, and `width`/`height`/`viewBox` are set to the padded bounds.
 *
 * Pure DOM operations on a clone — the live canvas is never touched, and the
 * caller measures `bounds` on the live DOM beforehand (`getBBox` is not
 * available outside a real layout engine, so measurement stays separate).
 */
export function buildArisExportSvgMarkup(
  svgRoot: SVGSVGElement,
  bounds: ArisCanvasSvgBounds,
  padding: number = ARIS_EXPORT_SVG_PADDING
): string {
  const clone = svgRoot.cloneNode(true) as SVGSVGElement
  for (const node of Array.from(clone.querySelectorAll(EXPORT_STRIP_SELECTOR))) {
    node.remove()
  }
  const viewport = findViewport(clone)
  viewport?.removeAttribute('transform')

  const width = Math.max(1, Math.ceil(bounds.width + padding * 2))
  const height = Math.max(1, Math.ceil(bounds.height + padding * 2))
  // No manual xmlns: the root is already in the SVG namespace, so the XML
  // serializer emits the declaration itself — setting it by hand produces a
  // duplicate xmlns attribute that makes the output unparseable.
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute(
    'viewBox',
    `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`
  )
  clone.removeAttribute('tabindex')
  return new XMLSerializer().serializeToString(clone)
}

/**
 * Measure the full rendered content — every layer, so the print-frame
 * furniture and the diagram are both inside the box — of the live canvas SVG.
 * Browser-only: `getBBox` needs a real layout engine.
 */
export function measureArisCanvasSvgBounds(svgRoot: SVGSVGElement): ArisCanvasSvgBounds {
  const viewport = findViewport(svgRoot)
  if (!viewport) throw new Error('The ARIS canvas SVG has no viewport group to measure.')
  const box = viewport.getBBox()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/** The diagram-js root `<svg>` — the container's direct child, never the minimap's. */
export function findArisCanvasSvg(container: HTMLElement): SVGSVGElement {
  for (const child of Array.from(container.children)) {
    if (child instanceof SVGSVGElement) return child
  }
  throw new Error('No rendered ARIS canvas SVG found in the canvas container.')
}

/**
 * Capture the current canvas view — diagram plus print frame, in the current
 * content language — as standalone SVG markup with its export pixel size.
 */
export function captureArisCanvasSvg(container: HTMLElement): ArisCanvasSvgCapture {
  const svgRoot = findArisCanvasSvg(container)
  const bounds = measureArisCanvasSvgBounds(svgRoot)
  const markup = buildArisExportSvgMarkup(svgRoot, bounds)
  return {
    markup,
    size: {
      width: Math.max(1, Math.ceil(bounds.width + ARIS_EXPORT_SVG_PADDING * 2)),
      height: Math.max(1, Math.ceil(bounds.height + ARIS_EXPORT_SVG_PADDING * 2))
    }
  }
}

/** Uniformly bound the raster pixel size; the SVG scales losslessly. */
export function arisExportRasterSize(
  size: ArisPdfImageSize,
  maxSide: number = ARIS_EXPORT_MAX_RASTER_SIDE
): ArisPdfImageSize {
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height))
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}

/** The browser-side raster deps (real `<canvas>` + `<img>`). */
export function browserArisSvgToPngDeps(): ArisSvgToPngDeps {
  return {
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      // The CanvasLike interface narrows fillStyle to `string`; a real
      // HTMLCanvasElement's context widens it. The runtime shape is
      // compatible — cast at this single boundary.
      return canvas as unknown as ArisCanvasLike
    },
    loadImage: (svgDataUrl) =>
      new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Failed to rasterize the ARIS canvas SVG'))
        image.src = svgDataUrl
      })
  }
}

export interface ArisPdfExportResult {
  readonly bytes: ArrayBuffer
  readonly size: ArisPdfImageSize
}

/**
 * Export the live ARIS canvas in `container` to deterministic PDF bytes:
 * capture the current view (print frame + diagram, current content language),
 * rasterize it faithfully, and wrap the raster in a bounded single-page PDF.
 */
export async function exportArisCanvasPdf(
  container: HTMLElement,
  title: string,
  deps: ArisSvgToPngDeps = browserArisSvgToPngDeps()
): Promise<ArisPdfExportResult> {
  const capture = captureArisCanvasSvg(container)
  const rasterSize = arisExportRasterSize(capture.size)
  const pngDataUrl = await arisSvgToPngDataUrl(capture.markup, rasterSize, deps)
  return { bytes: createArisDiagramPdf(pngDataUrl, rasterSize, title), size: rasterSize }
}

const FILE_NAME_HOSTILE = /[\\/:*?"<>|\s]+/g

/**
 * A human-readable PDF file name: the source's base name plus the model name
 * when one is known (`MyFlow.aml` + `Billing` -> `MyFlow-Billing.pdf`).
 */
export function arisPdfFileName(sourceName: string, modelName: string): string {
  const trimmed = sourceName.trim() === '' ? 'export' : sourceName.trim()
  const dot = trimmed.lastIndexOf('.')
  const base = dot <= 0 ? trimmed : trimmed.slice(0, dot)
  const model = modelName.replace(FILE_NAME_HOSTILE, '-').replace(/^-+|-+$/g, '')
  return model === '' ? `${base}.pdf` : `${base}-${model}.pdf`
}
