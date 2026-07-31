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
 * On top of that faithful raster the export also lays down a real, *invisible*
 * PDF text layer (jsPDF `renderingMode: 'invisible'`) — one text run per
 * on-canvas `<text>`/`<tspan>` glyph line, positioned at the same spot as the
 * pixels beneath it. The raster still paints every glyph exactly as rendered
 * (so Arabic shaping, bidi and the FontStyleSheet typography are untouched),
 * but the document now carries a selectable, searchable, copy-pasteable text
 * layer — fixing the "flattened to one PNG, empty text layer" gap without a
 * second visible font stack, a new dependency, or any change to the drawing.
 * The overlay is additive and invisible, so it can never alter the visual
 * output; a true vector (svg2pdf) path remains a future refinement.
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
 * One selectable text run to lay over the raster, in the export SVG's own
 * coordinate units, measured *relative to the viewBox origin* (i.e. the same
 * 0..contentSize space the raster image fills). `anchor` mirrors the source
 * `text-anchor`; `baseline` mirrors whether the source used
 * `dominant-baseline: middle` (captions) or the default alphabetic baseline.
 */
export interface ArisPdfTextRun {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly fontSize: number
  readonly anchor: 'start' | 'middle' | 'end'
  readonly baseline: 'middle' | 'alphabetic'
}

export interface ArisDiagramPdfOptions {
  /** Invisible, selectable text runs, in viewBox units relative to the viewBox origin. */
  readonly textRuns?: readonly ArisPdfTextRun[]
  /**
   * The content size, in viewBox units, that the raster image spans. Runs map
   * `x/y` through this to page points. Defaults to `size` (the raster is the
   * content 1:1 when it was not downscaled by the raster cap).
   */
  readonly contentSize?: ArisPdfImageSize
}

/** A short, stable digest of the overlay so identical text layers keep the file id stable. */
function textRunsDigest(runs: readonly ArisPdfTextRun[] | undefined): string {
  if (!runs || runs.length === 0) return ''
  let out = `\n#${runs.length}`
  for (const run of runs) {
    out += `\n${run.text}@${Math.round(run.x)},${Math.round(run.y)},${Math.round(run.fontSize)}`
  }
  return out
}

/**
 * Wrap a faithful PNG rasterization of the ARIS canvas in a direct,
 * deterministic PDF, optionally overlaying an invisible selectable text layer.
 */
export function createArisDiagramPdf(
  pngDataUrl: string,
  size: ArisPdfImageSize,
  title: string,
  options: ArisDiagramPdfOptions = {}
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
  document.setFileId(
    deterministicArisPdfFileId(
      `${normalizedTitle}\n${pngDataUrl}${textRunsDigest(options.textRuns)}`
    )
  )
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
  overlayArisTextRuns(document, geometry, options)
  return document.output('arraybuffer')
}

/**
 * Paint each run as an invisible (`renderingMode: 'invisible'`) text run over
 * the raster, mapping viewBox units to page points through the image geometry.
 * The core `helvetica` font is metric-compatible with Arial and costs nothing
 * to embed; the runs are never drawn, so the exact glyph shapes are irrelevant
 * — only the copyable/searchable characters and their positions matter.
 */
function overlayArisTextRuns(
  document: jsPDF,
  geometry: ArisPdfPageGeometry,
  options: ArisDiagramPdfOptions
): void {
  const runs = options.textRuns
  if (!runs || runs.length === 0) return
  const content = options.contentSize ?? { width: geometry.imageWidth, height: geometry.imageHeight }
  const perUnitX = content.width > 0 ? geometry.imageWidth / content.width : 0
  const perUnitY = content.height > 0 ? geometry.imageHeight / content.height : 0
  if (perUnitX <= 0 || perUnitY <= 0) return
  document.setFont('helvetica', 'normal')
  document.setTextColor(0, 0, 0)
  for (const run of runs) {
    const text = run.text
    if (!text || text.trim().length === 0) continue
    if (!Number.isFinite(run.x) || !Number.isFinite(run.y) || !Number.isFinite(run.fontSize)) {
      continue
    }
    const sizePt = run.fontSize * perUnitY
    if (!(sizePt > 0)) continue
    const px = geometry.imageX + run.x * perUnitX
    const py = geometry.imageY + run.y * perUnitY
    document.setFontSize(sizePt)
    document.text(text, px, py, {
      renderingMode: 'invisible',
      align: run.anchor === 'middle' ? 'center' : run.anchor === 'end' ? 'right' : 'left',
      baseline: run.baseline
    })
  }
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
  /** Invisible selectable-text overlay runs, in viewBox units from the viewBox origin. */
  readonly textRuns: readonly ArisPdfTextRun[]
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
 *
 * Lane bands (`[data-aris-kind="lane"]`) are stripped too: AnimalWF's `<Lane>`
 * records are the full-canvas `StartBorder=0 EndBorder=50000` / `Pen Width=0`
 * sentinels that ARIS itself draws nothing for, yet our on-screen canvas paints
 * a dashed helper band for them. That helper is screen-only affordance; the
 * source has no such ink, so it is removed from the printed sheet.
 */
const EXPORT_STRIP_SELECTOR =
  '.djs-outline, .djs-segment-dragger, .djs-bendpoint, [data-aris-kind="lane"]'

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
 * Collect the invisible selectable-text overlay from the live canvas SVG: one
 * run per rendered `<text>` (or `<tspan>` line), in the export viewBox's own
 * units relative to the padded viewBox origin — the same 0..contentSize space
 * the raster fills.
 *
 * Browser-only: it reads each glyph node's screen CTM relative to the viewport
 * group (the transform the export neutralizes), which correctly folds in the
 * per-shape `translate`/symbol-scale group transforms that raw x/y attributes
 * alone would miss. Nodes stripped from the export (interaction furniture,
 * lane bands) are skipped so their labels never leak into the text layer.
 */
export function collectArisExportTextRuns(
  svgRoot: SVGSVGElement,
  bounds: ArisCanvasSvgBounds,
  padding: number = ARIS_EXPORT_SVG_PADDING
): readonly ArisPdfTextRun[] {
  const viewport = findViewport(svgRoot)
  if (!viewport) return []
  const viewportCtm = viewport.getScreenCTM()
  if (!viewportCtm) return []
  const toContent = viewportCtm.inverse()
  const originX = bounds.x - padding
  const originY = bounds.y - padding
  const runs: ArisPdfTextRun[] = []

  const anchorOf = (node: Element): 'start' | 'middle' | 'end' => {
    const raw = (node.getAttribute('text-anchor') ?? '').trim()
    return raw === 'middle' ? 'middle' : raw === 'end' ? 'end' : 'start'
  }
  const fontSizeOf = (node: Element, ctmScale: number): number => {
    const raw = Number.parseFloat(node.getAttribute('font-size') ?? '')
    return Number.isFinite(raw) && raw > 0 ? raw * ctmScale : 0
  }

  for (const textNode of Array.from(svgRoot.querySelectorAll('text'))) {
    if (textNode.closest(EXPORT_STRIP_SELECTOR)) continue
    const svgText = textNode as SVGGraphicsElement
    const screenCtm = svgText.getScreenCTM()
    if (!screenCtm) continue
    const local = toContent.multiply(screenCtm)
    const ctmScale = Math.hypot(local.a, local.b) || 1
    const tspans = Array.from(textNode.querySelectorAll('tspan')).filter(
      (tspan) => (tspan.textContent ?? '').length > 0
    )
    const anchor = anchorOf(textNode)
    const parts: readonly { node: Element; baseline: 'middle' | 'alphabetic' }[] =
      tspans.length > 0
        ? tspans.map((tspan) => ({ node: tspan, baseline: 'middle' as const }))
        : [
            {
              node: textNode,
              baseline:
                (textNode.getAttribute('dominant-baseline') ?? '').trim() === 'middle'
                  ? ('middle' as const)
                  : ('alphabetic' as const)
            }
          ]
    for (const part of parts) {
      const text = (part.node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text.length === 0) continue
      const lx = Number.parseFloat(part.node.getAttribute('x') ?? textNode.getAttribute('x') ?? '')
      const ly = Number.parseFloat(part.node.getAttribute('y') ?? textNode.getAttribute('y') ?? '')
      if (!Number.isFinite(lx) || !Number.isFinite(ly)) continue
      const cx = local.a * lx + local.c * ly + local.e
      const cy = local.b * lx + local.d * ly + local.f
      const fontSize = fontSizeOf(textNode, ctmScale)
      if (!(fontSize > 0)) continue
      runs.push(
        Object.freeze({
          text,
          x: cx - originX,
          y: cy - originY,
          fontSize,
          anchor,
          baseline: part.baseline
        })
      )
    }
  }
  return Object.freeze(runs)
}

/**
 * Capture the current canvas view — diagram plus print frame, in the current
 * content language — as standalone SVG markup with its export pixel size and
 * the invisible selectable-text overlay runs.
 */
export function captureArisCanvasSvg(container: HTMLElement): ArisCanvasSvgCapture {
  const svgRoot = findArisCanvasSvg(container)
  const bounds = measureArisCanvasSvgBounds(svgRoot)
  const textRuns = collectArisExportTextRuns(svgRoot, bounds)
  const markup = buildArisExportSvgMarkup(svgRoot, bounds)
  return {
    markup,
    size: {
      width: Math.max(1, Math.ceil(bounds.width + ARIS_EXPORT_SVG_PADDING * 2)),
      height: Math.max(1, Math.ceil(bounds.height + ARIS_EXPORT_SVG_PADDING * 2))
    },
    textRuns
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
  // Geometry is derived from `rasterSize` (the PNG's pixel dimensions), so the
  // overlay runs — captured in viewBox units — map through `capture.size` (the
  // content the raster spans) rather than the possibly-downscaled pixel size.
  return {
    bytes: createArisDiagramPdf(pngDataUrl, rasterSize, title, {
      textRuns: capture.textRuns,
      contentSize: capture.size
    }),
    size: rasterSize
  }
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
