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
 * Latin runs are drawn with the core `helvetica` font (metric-compatible with
 * Arial, nothing to embed). Arabic runs have no glyphs in any core font, so
 * their characters could not be encoded into a selectable layer at all — they
 * were silently dropped. When a capture actually contains Arabic script the
 * export lazily imports a tiny embedded Noto subset ({@link
 * exportArisPdfArabicFont}) and switches Arabic runs to it, so the Arabic
 * header labels and the Reference-Laws rows become selectable/searchable too.
 * The subset carries only base codepoints and the overlay disables jsPDF's
 * automatic Arabic shaping + bidi reordering (both invisible-only concerns), so
 * the stored text is clean logical-order Unicode that extracts verbatim. A
 * document with zero Arabic runs never loads the font and stays byte-identical
 * to the Latin-only path.
 *
 * One bounded page always holds the whole sheet: the page geometry scales the
 * image down to {@link PDF_MAX_SIDE_PT} on its long side, so no ARIS sheet can
 * overflow and multi-page pagination never triggers (the print frame itself is
 * single-page page furniture by design — see `printFrame.ts`).
 */

import { jsPDF } from 'jspdf'

import { containsArabicScript } from '../renderer/bidi'
import type { ArisArabicOverlayFont } from './exportArisPdfArabicFont'

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
  /**
   * The embedded Arabic subset, supplied ONLY when the caller has confirmed the
   * runs contain Arabic (it lazy-imports `exportArisPdfArabicFont` in that case).
   * When present and at least one run is Arabic, Arabic runs are drawn with this
   * font so their text is selectable; when absent, the export never touches the
   * Arabic path and stays byte-identical to the Latin-only output.
   */
  readonly arabicFont?: ArisArabicOverlayFont
}

/** True when any run carries Arabic script — the trigger for embedding the subset. */
export function arisTextRunsContainArabic(runs: readonly ArisPdfTextRun[] | undefined): boolean {
  if (!runs) return false
  for (const run of runs) {
    if (containsArabicScript(run.text)) return true
  }
  return false
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
  // The Arabic path only activates when the caller passed the subset AND a run
  // is actually Arabic. It changes the emitted bytes (an embedded font + font
  // switches), so the deterministic file id is extended with a fixed font marker
  // to stay distinct and reproducible — while a no-Arabic document (no
  // `arabicFont`) keeps the exact original digest and byte-for-byte output.
  const arabicActive = Boolean(options.arabicFont) && arisTextRunsContainArabic(options.textRuns)
  const fontMarker = arabicActive ? `\n@font:${options.arabicFont!.marker}` : ''
  document.setCreationDate(FIXED_PDF_DATE)
  document.setFileId(
    deterministicArisPdfFileId(
      `${normalizedTitle}\n${pngDataUrl}${textRunsDigest(options.textRuns)}${fontMarker}`
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
  overlayArisTextRuns(document, geometry, options, arabicActive)
  return document.output('arraybuffer')
}

/** The minimal shape of jsPDF's internal PubSub we rely on to prune a subscriber. */
interface JsPdfEventBus {
  getTopics?: () => Record<string, Record<string, [unknown, boolean]>> | undefined
  unsubscribe?: (token: string) => boolean
}

/**
 * jsPDF auto-runs `processArabic` on every `text()` (a `preProcessText`
 * subscriber) which rewrites base Arabic codepoints into Presentation-Forms and,
 * separately, a bidi engine reorders RTL runs to visual order. Both exist to make
 * *visible* Arabic look right — irrelevant here because the overlay is invisible
 * and its only job is to store clean, extractable, logical-order Unicode. The
 * shaped presentation forms have no glyph in the base-only subset (so they would
 * map to `.notdef` and break extraction), and the bidi reorder would store text
 * backwards. Bidi is neutralized per-run via the documented
 * `isInputVisual/isOutputVisual` options (see below); the shaper is removed here.
 *
 * `processArabic` is a named jsPDF **API property**, so its reference identity
 * survives production minification — we unsubscribe exactly that one callback and
 * leave the UTF-8 escaper untouched. If jsPDF's internals ever move, the guarded
 * lookup simply no-ops.
 */
function disableJsPdfArabicShaping(doc: jsPDF): void {
  const events = (doc as unknown as { internal?: { events?: JsPdfEventBus } }).internal?.events
  const processArabic = (doc as unknown as { processArabic?: unknown }).processArabic
  if (
    !events ||
    typeof events.getTopics !== 'function' ||
    typeof events.unsubscribe !== 'function'
  ) {
    return
  }
  const preProcess = events.getTopics()?.preProcessText
  if (!preProcess) return
  for (const token of Object.keys(preProcess)) {
    const entry = preProcess[token]
    if (Array.isArray(entry) && entry[0] === processArabic) {
      events.unsubscribe(token)
    }
  }
}

/** Register the embedded subset once and return the family name Arabic runs select. */
function registerArisArabicOverlayFont(doc: jsPDF, font: ArisArabicOverlayFont): string {
  doc.addFileToVFS(font.vfsFileName, font.base64)
  doc.addFont(font.vfsFileName, font.fontName, 'normal')
  disableJsPdfArabicShaping(doc)
  return font.fontName
}

/**
 * Paint each run as an invisible (`renderingMode: 'invisible'`) text run over
 * the raster, mapping viewBox units to page points through the image geometry.
 * The core `helvetica` font is metric-compatible with Arial and costs nothing
 * to embed; the runs are never drawn, so the exact glyph shapes are irrelevant
 * — only the copyable/searchable characters and their positions matter.
 *
 * When `arabicActive` is set the embedded Arabic subset is registered and every
 * Arabic-script run switches to it (with bidi neutralized so logical order is
 * preserved). When it is not, the loop is exactly the original Latin-only path,
 * so a no-Arabic document stays byte-identical.
 */
function overlayArisTextRuns(
  document: jsPDF,
  geometry: ArisPdfPageGeometry,
  options: ArisDiagramPdfOptions,
  arabicActive: boolean
): void {
  const runs = options.textRuns
  if (!runs || runs.length === 0) return
  const content = options.contentSize ?? {
    width: geometry.imageWidth,
    height: geometry.imageHeight
  }
  const perUnitX = content.width > 0 ? geometry.imageWidth / content.width : 0
  const perUnitY = content.height > 0 ? geometry.imageHeight / content.height : 0
  if (perUnitX <= 0 || perUnitY <= 0) return

  const arabicFontName =
    arabicActive && options.arabicFont
      ? registerArisArabicOverlayFont(document, options.arabicFont)
      : null
  if (arabicFontName === null) {
    // Latin-only path — unchanged from the original so the bytes match exactly.
    document.setFont('helvetica', 'normal')
  }
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
    const useArabic = arabicFontName !== null && containsArabicScript(text)
    if (arabicFontName !== null) {
      document.setFont(useArabic ? arabicFontName : 'helvetica', 'normal')
    }
    document.setFontSize(sizePt)
    const baseOptions = {
      renderingMode: 'invisible',
      align: run.anchor === 'middle' ? 'center' : run.anchor === 'end' ? 'right' : 'left',
      baseline: run.baseline
    } as const
    // Arabic runs are stored in logical order: `isInputVisual === isOutputVisual`
    // makes jsPDF's bidi engine a no-op, so extraction returns the source string
    // verbatim rather than a visually-reversed one (verified against the header
    // labels and the Reference-Laws rows). No effect on Latin runs.
    const arabicOptions = { ...baseOptions, isInputVisual: true, isOutputVisual: true }
    document.text(text, px, py, useArabic ? arabicOptions : baseOptions)
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
 * Options for {@link captureArisCanvasSvg}. Both members default to the legacy
 * browser behaviour, so the PDF export path — which passes nothing — stays
 * byte-identical; the headless render entry (`src/aris/headless`) supplies both.
 *
 * The type is intentionally LOCAL to this module (it reuses
 * {@link ArisCanvasSvgBounds}, imports nothing new) so the runtime-boundary
 * walker that reaches this file from `src/main.tsx` is unaffected.
 */
export interface CaptureArisCanvasSvgOptions {
  /**
   * Precomputed content bounds. When given, `getBBox`-based
   * {@link measureArisCanvasSvgBounds} is skipped entirely — the headless entry
   * derives model-space bounds from `arisContentBounds(elementRegistry.getAll())`
   * (`fitView.ts`), which needs no layout engine and includes label extents the
   * jsdom `getBBox` shim misses.
   */
  readonly bounds?: ArisCanvasSvgBounds
  /**
   * When `false`, the invisible selectable-text overlay is not collected and
   * `textRuns` is `[]` — the `getScreenCTM` chain (`collectArisExportTextRuns`)
   * is never entered. Defaults to `true` (the PDF path needs the overlay).
   */
  readonly includeTextRuns?: boolean
}

/**
 * Capture the current canvas view — diagram plus print frame, in the current
 * content language — as standalone SVG markup with its export pixel size and
 * the invisible selectable-text overlay runs.
 *
 * With no options this is the original browser PDF capture (measure bounds via
 * `getBBox`, collect the text-run overlay) and is byte-identical to before. The
 * headless render entry passes `{bounds, includeTextRuns:false}` so it can run
 * under jsdom where `getBBox` ignores `<text>` and the CTM overlay is unused.
 */
export function captureArisCanvasSvg(
  container: HTMLElement,
  options: CaptureArisCanvasSvgOptions = {}
): ArisCanvasSvgCapture {
  const svgRoot = findArisCanvasSvg(container)
  const bounds = options.bounds ?? measureArisCanvasSvgBounds(svgRoot)
  const textRuns =
    options.includeTextRuns === false ? [] : collectArisExportTextRuns(svgRoot, bounds)
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
  // Only reach for the embedded Arabic subset when the capture actually contains
  // Arabic script — the dynamic import keeps its bytes off the Latin-only path,
  // and a no-Arabic export never registers a font (stays byte-identical).
  const arabicFont = arisTextRunsContainArabic(capture.textRuns)
    ? (await import('./exportArisPdfArabicFont')).arisArabicOverlayFont
    : undefined
  // Geometry is derived from `rasterSize` (the PNG's pixel dimensions), so the
  // overlay runs — captured in viewBox units — map through `capture.size` (the
  // content the raster spans) rather than the possibly-downscaled pixel size.
  return {
    bytes: createArisDiagramPdf(pngDataUrl, rasterSize, title, {
      textRuns: capture.textRuns,
      contentSize: capture.size,
      arabicFont
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
