/**
 * The print-frame page furniture for an ARIS model (plan Wave 6, V5+):
 * the header band with the Process Code / Process Name / Organizational
 * Owner rows, the organization title block, and the bottom DMT legend.
 *
 * ## Where the data comes from
 *
 * Everything is derived from the working model, never hardcoded per model:
 *
 * - **Header rows** read the model's own attribute definitions: `AT_ID`
 *   (Process Code), `AT_NAME` (Process Name, falling back to the model's
 *   display name) and `AT_PERS_RESP` (Organizational Owner).
 * - **Anchored header values**: a free-text note that carries an
 *   `AT_MODEL_AT` binding is a live placeholder for one of those attributes
 *   (see `resolveFreeTextModelAttributeBinding`). The generic free-text path
 *   draws such a note's static text, which is empty by construction, so the
 *   resolved value is painted here, at the note's exact source anchor — that
 *   is the header's "AWF.01.01"-style value column.
 * - **Organization title block / legend position** come from the model's OLE
 *   attachment occurrences: the top-most attachment above the content is the
 *   title block, the bottom-most below the content is the legend.
 *
 * ## Out of scope (named hooks)
 *
 * - **OLE image decode.** The title-block logo and the pixel-exact embedded
 *   legend are OLE blobs. Decoding them safely (size/decompression limits,
 *   bytes preserved verbatim for export) is intentionally NOT in this lane;
 *   the title block renders as a framed placeholder and the legend is drawn
 *   from the convention catalog at the attachment's exact bounds.
 *   TODO(V5+ OLE): decode `index.blobs` for these attachment ids and swap the
 *   placeholder/legend for the authored images.
 * - **Gfx frame geometry.** The header/reference rounded rectangles are AML
 *   `GfxObj` records, parsed into `model.graphicObjects` (Wave 6 GEOM): the
 *   header band draws at the authored frame's exact bounds when one encloses
 *   the title block, and every other frame — the Reference-Laws boxes — draws
 *   as its own outline at the authored bounds and pen. TODO(V5+ Gfx): the
 *   shape grammar beyond `RoundedRectangle` (the only shape AnimalWF uses) is
 *   parsed but any non-rectangle frame geometry is not drawn yet.
 * - **Multi-page print pagination.** The frame is page furniture drawn in
 *   canvas coordinates; splitting it across printed pages is out of scope.
 */

import { resolveFreeTextModelAttributeBinding } from '../model/buildFromSource'
import type { ArisFreeText, ArisGraphicObject, ArisModel } from '../model/types'
import { bidiTextAttrs } from './bidi'
import { modelContentBounds, type ArisRect } from './canvasSync'
import { DEFAULT_LOCALE_ID } from './emptyDocument'
import type { ArisLabelFont } from './elements'
import { buildArisLegend, drawArisLegend, type ArisLegendModel } from './legend'
import { readLocalized } from './localization'
import { arisPrintFrameText } from './printFrameI18n'
import { svgAppend, svgElement } from './svg'

export interface ArisPrintFrameHeaderRow {
  readonly label: string
  readonly value: string
}

/** A resolved model-attribute value painted at its free-text source anchor. */
export interface ArisPrintFrameAnchoredValue {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly fontSize: number
  /** The bound note's own `FontStyleSheet` font, when it resolved (V8). */
  readonly font: ArisLabelFont | null
}

export interface ArisPrintFrameHeader {
  readonly bounds: ArisRect
  /** Computed label/value rows, drawn when the model anchors nothing itself. */
  readonly rows: readonly ArisPrintFrameHeaderRow[]
  /** Resolved `AT_MODEL_AT` values at their source anchors (imported models). */
  readonly anchoredValues: readonly ArisPrintFrameAnchoredValue[]
  /** The organization title block rectangle (an OLE attachment's bounds). */
  readonly orgBlock: ArisRect | null
  /** The authored `GfxObj` frame the band draws at, when the source carries one. */
  readonly sourceFrameId: string | null
}

/**
 * A `<GfxObj>` frame drawn as page furniture in its own right — the
 * Reference-Laws grouping boxes. The header band's own frame is excluded (the
 * header draws it), so what remains here is every frame the generic furniture
 * paths would otherwise not draw at all.
 */
export interface ArisPrintFrameGraphicFrame {
  readonly id: string
  readonly bounds: ArisRect
  readonly shape: string | null
  readonly penColor: string | null
  readonly penWidth: number | null
  readonly fillColor: string | null
}

export interface ArisPrintFrameModel {
  readonly header: ArisPrintFrameHeader | null
  readonly legend: ArisLegendModel | null
  readonly graphicFrames: readonly ArisPrintFrameGraphicFrame[]
}

export interface ArisPrintFrameOptions {
  /** Locale the row values resolve in. Defaults to the canvas default. */
  readonly localeId?: string
  /** Set false to skip the bottom legend (the header still renders). */
  readonly legend?: boolean
  /**
   * Resolve a bound note's own `FontStyleSheet` font (V8). When omitted the
   * anchored values keep the band-ratio size.
   */
  readonly resolveNoteFont?: (note: ArisFreeText) => ArisLabelFont | null
}

/**
 * Stroke of the header band, decoded from the AML `GfxObj` pen: COLORREF
 * `996600` is `0x00BBGGRR`, i.e. sRGB `#006699`. See plan §"Corrections to
 * the provisional Evaluation" for the BGR/COLORREF rule.
 */
const PRINT_FRAME_STROKE = '#006699'
const PRINT_FRAME_FILL = '#ffffff'
const PRINT_FRAME_TEXT_FILL = '#1a1a1a'
const PRINT_FRAME_ORG_FILL = '#fafafa'

/** The legend occupies the source's 3800×622 aspect when it computes its own slot. */
const LEGEND_ASPECT = 622 / 3800
/** Gap between the content's bottom edge and a computed legend slot. */
const LEGEND_TOP_MARGIN = 200
/** Row pitch of the authored header layout, from the source sheet's 3 rows in a 388 band. */
const AUTHORED_ROW_PITCH = 110
const AUTHORED_HEADER_INSET = 40
/** Anchored header value size as a fraction of the band height (3 rows + margins). */
const HEADER_VALUE_FONT_RATIO = 1 / 7

const HEADER_ROW_ATTRIBUTES: readonly {
  readonly attributeType: string
  readonly labelKey:
    | 'aris.printFrame.processCode'
    | 'aris.printFrame.processName'
    | 'aris.printFrame.organizationalOwner'
}[] = Object.freeze([
  Object.freeze({ attributeType: 'AT_ID', labelKey: 'aris.printFrame.processCode' }),
  Object.freeze({ attributeType: 'AT_NAME', labelKey: 'aris.printFrame.processName' }),
  Object.freeze({
    attributeType: 'AT_PERS_RESP',
    labelKey: 'aris.printFrame.organizationalOwner'
  })
])

/** The model's text for one attribute type, in the display locale; '' when unset. */
export function printFrameModelAttributeText(
  model: ArisModel,
  attributeType: string,
  localeId: string = DEFAULT_LOCALE_ID
): string {
  if (attributeType === 'AT_NAME') {
    const name = readLocalized(model.names, localeId).trim()
    if (name) return name
  }
  const attribute = model.attributes.find((entry) => entry.type === attributeType)
  if (!attribute) return ''
  const localized = readLocalized(
    Object.freeze({
      values: Object.freeze(
        Object.fromEntries(
          attribute.values.map((value) => [value.localeId ?? '', value.text.trim()] as const)
        )
      ),
      fallback: attribute.values.find((value) => value.text.trim())?.text.trim() ?? null
    }),
    localeId
  )
  return localized.trim()
}

function unionRects(a: ArisRect | null, b: ArisRect): ArisRect {
  if (a === null) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return Object.freeze({
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y
  })
}

/**
 * Split the model's OLE attachments into the title block (top-most, above the
 * content) and the legend anchor (bottom-most, below the content). Any other
 * attachment is left for the OLE lane.
 */
function classifyAttachments(
  model: ArisModel,
  content: ArisRect | null
): { readonly orgBlock: ArisRect | null; readonly legend: ArisRect | null } {
  const sorted = [...model.attachments].sort((a, b) => a.bounds.y - b.bounds.y)
  let orgBlock: ArisRect | null = null
  let legend: ArisRect | null = null
  const contentBottom = content === null ? Number.NEGATIVE_INFINITY : content.y + content.height
  const contentTop = content === null ? Number.POSITIVE_INFINITY : content.y
  for (const attachment of sorted) {
    if (attachment.bounds.y >= contentBottom) {
      legend = legend ?? attachment.bounds
      continue
    }
    if (attachment.bounds.y + attachment.bounds.height <= contentTop || orgBlock === null) {
      orgBlock = attachment.bounds
    }
  }
  return Object.freeze({ orgBlock, legend })
}

function buildHeader(
  model: ArisModel,
  localeId: string,
  content: ArisRect | null,
  frames: readonly ArisGraphicObject[],
  resolveNoteFont?: (note: ArisFreeText) => ArisLabelFont | null
): ArisPrintFrameHeader | null {
  const { orgBlock } = classifyAttachments(model, content)

  // Resolved live placeholders at their source anchors (the imported header's
  // value column). Drawn for every bound note, wherever it sits.
  const anchored: { readonly text: string; readonly x: number; readonly y: number }[] = []
  const anchoredFonts: (ArisLabelFont | null)[] = []
  for (const note of model.freeText) {
    const binding = resolveFreeTextModelAttributeBinding(note)
    if (binding === null) continue
    const text = printFrameModelAttributeText(model, binding.attributeType, localeId)
    if (!text) continue
    anchored.push(Object.freeze({ text, x: note.bounds.x, y: note.bounds.y }))
    anchoredFonts.push(resolveNoteFont?.(note) ?? null)
  }

  const rows: ArisPrintFrameHeaderRow[] = []
  for (const row of HEADER_ROW_ATTRIBUTES) {
    const value = printFrameModelAttributeText(model, row.attributeType, localeId)
    if (!value) continue
    rows.push(Object.freeze({ label: arisPrintFrameText(row.labelKey), value }))
  }

  if (orgBlock === null && anchored.length === 0 && rows.length === 0) return null

  // The authored `GfxObj` header frame, when the source carries one: the
  // smallest frame that encloses the organization title block. It wins over
  // the derived envelope below — the band then draws at the exact authored
  // bounds (the AnimalWF sheets author 6700×388 where the envelope measured
  // 6637×400).
  const sourceFrame = orgBlock === null ? null : frameEnclosing(frames, orgBlock)

  // The band encloses its furniture with the source's own inset. An imported
  // model anchors the band at the origin; an authored model parks it directly
  // above its content.
  let bounds: ArisRect
  if (sourceFrame !== null) {
    bounds = sourceFrame.bounds
  } else if (orgBlock !== null) {
    const inset = orgBlock.y > 0 ? orgBlock.y : AUTHORED_HEADER_INSET
    let extent: ArisRect | null = null
    for (const note of model.freeText) {
      if (note.bounds.y > orgBlock.y + orgBlock.height) continue
      extent = unionRects(extent, note.bounds)
    }
    extent = unionRects(extent, orgBlock)
    bounds = Object.freeze({
      x: 0,
      y: 0,
      width: extent.x + extent.width + inset,
      height: extent.y + extent.height + inset
    })
  } else if (content !== null) {
    const height =
      rows.length > 0 ? rows.length * AUTHORED_ROW_PITCH + AUTHORED_HEADER_INSET * 2 : 240
    bounds = Object.freeze({
      x: content.x,
      y: content.y - height - AUTHORED_HEADER_INSET,
      width: content.width,
      height
    })
  } else {
    return null
  }

  const fontSize = Math.max(1, Math.round(bounds.height * HEADER_VALUE_FONT_RATIO))
  return Object.freeze({
    bounds,
    rows: orgBlock === null && anchored.length === 0 ? Object.freeze(rows) : Object.freeze([]),
    anchoredValues: Object.freeze(
      anchored.map((value, index) => {
        const font = anchoredFonts[index] ?? null
        return Object.freeze({
          ...value,
          // The note's own FontStyleSheet size wins; the band ratio stays the
          // fallback for a note whose sheet did not resolve.
          fontSize: font?.fontSize ?? fontSize,
          font
        })
      })
    ),
    orgBlock,
    sourceFrameId: sourceFrame?.id ?? null
  })
}

/**
 * The smallest graphic frame that fully contains `rect` — how the header band
 * finds its authored frame among the model's `<GfxObj>` records (the
 * Reference-Laws boxes sit elsewhere on the sheet and never contain the title
 * block).
 */
function frameEnclosing(
  frames: readonly ArisGraphicObject[],
  rect: ArisRect
): ArisGraphicObject | null {
  let best: ArisGraphicObject | null = null
  for (const frame of frames) {
    const b = frame.bounds
    if (rect.x < b.x || rect.y < b.y) continue
    if (rect.x + rect.width > b.x + b.width) continue
    if (rect.y + rect.height > b.y + b.height) continue
    if (best !== null && b.width * b.height >= best.bounds.width * best.bounds.height) continue
    best = frame
  }
  return best
}

function buildLegendSlot(model: ArisModel, content: ArisRect | null): ArisRect | null {
  const { legend } = classifyAttachments(model, content)
  if (legend !== null) return legend
  if (content === null || content.width <= 0) return null
  return Object.freeze({
    x: content.x,
    y: content.y + content.height + LEGEND_TOP_MARGIN,
    width: content.width,
    height: Math.round(content.width * LEGEND_ASPECT)
  })
}

/**
 * Compute the print frame for one model. Pure: the same model always yields
 * the same frame, so the renderer can rebuild it on every document change.
 */
export function buildPrintFrame(
  model: ArisModel,
  options: ArisPrintFrameOptions = {}
): ArisPrintFrameModel {
  const localeId = options.localeId ?? DEFAULT_LOCALE_ID
  const content = modelContentBounds(model)
  const frames = model.graphicObjects ?? []
  const header = buildHeader(model, localeId, content, frames, options.resolveNoteFont)
  const legendSlot = options.legend === false ? null : buildLegendSlot(model, content)
  // Every authored frame that is not the header band's own draws as page
  // furniture in its own right (the Reference-Laws grouping boxes).
  const graphicFrames = frames
    .filter((frame) => frame.id !== header?.sourceFrameId)
    .map((frame) =>
      Object.freeze({
        id: frame.id,
        bounds: frame.bounds,
        shape: frame.shape,
        penColor: frame.penColor,
        penWidth: frame.penWidth,
        fillColor: frame.fillColor
      })
    )
  return Object.freeze({
    header,
    legend: legendSlot === null ? null : buildArisLegend(legendSlot),
    graphicFrames: Object.freeze(graphicFrames)
  })
}

// --- drawing -----------------------------------------------------------------

function drawFrameText(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  options: {
    readonly anchor?: string
    readonly bold?: boolean
    readonly baseline?: string
    readonly marker?: string
    readonly font?: ArisLabelFont | null
  } = {}
): SVGElement {
  const node = svgElement('text', {
    x: Math.round(x),
    y: Math.round(y),
    'text-anchor': options.anchor ?? 'middle',
    'dominant-baseline': options.baseline ?? 'middle',
    'font-size': Math.round(options.font?.fontSize ?? fontSize),
    'font-family': options.font?.fontFamily ?? 'Arial, sans-serif',
    ...(options.bold || options.font?.fontWeight
      ? { 'font-weight': options.font?.fontWeight ?? 'bold' }
      : {}),
    fill: options.font?.textColor ?? PRINT_FRAME_TEXT_FILL,
    ...(options.marker === undefined ? {} : { 'data-aris-print-frame-text': options.marker }),
    ...bidiTextAttrs(text)
  })
  node.textContent = text
  return node
}

function drawHeader(group: SVGElement, header: ArisPrintFrameHeader, modelName: string): void {
  const { bounds } = header
  const headerGroup = svgElement('g', {
    'data-aris-print-frame-header': 'true',
    role: 'img',
    'aria-label': arisPrintFrameText('aris.printFrame.headerAria', { model: modelName })
  })
  svgAppend(
    headerGroup,
    svgElement('rect', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      rx: Math.round(bounds.height / 8),
      ry: Math.round(bounds.height / 8),
      fill: PRINT_FRAME_FILL,
      stroke: PRINT_FRAME_STROKE,
      'stroke-width': 2
    })
  )

  // The organization title block: a framed placeholder for the OLE logo.
  // TODO(V5+ OLE): replace with the decoded attachment image.
  if (header.orgBlock !== null) {
    const block = header.orgBlock
    const orgGroup = svgElement('g', {
      'data-aris-print-frame-org-block': 'true',
      'data-aris-ole-pending': 'true'
    })
    svgAppend(
      orgGroup,
      svgElement('rect', {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        rx: Math.round(block.height / 10),
        ry: Math.round(block.height / 10),
        fill: PRINT_FRAME_ORG_FILL,
        stroke: PRINT_FRAME_STROKE,
        'stroke-width': 1,
        'stroke-dasharray': '12 6'
      })
    )
    svgAppend(
      orgGroup,
      drawFrameText(
        arisPrintFrameText('aris.printFrame.orgBlock'),
        block.x + block.width / 2,
        block.y + block.height / 2,
        Math.max(1, Math.round(block.height / 6)),
        { marker: 'org-block' }
      )
    )
    svgAppend(headerGroup, orgGroup)
  }

  // Computed label/value rows (models that anchor no header notes of their own).
  const rowPitch =
    header.rows.length === 0 ? 0 : (bounds.height - AUTHORED_HEADER_INSET * 2) / header.rows.length
  header.rows.forEach((row, index) => {
    const cy = bounds.y + AUTHORED_HEADER_INSET + rowPitch * (index + 0.5)
    const fontSize = Math.max(1, Math.round(rowPitch * 0.42))
    svgAppend(
      headerGroup,
      drawFrameText(row.label, bounds.x + AUTHORED_HEADER_INSET, cy, fontSize, {
        anchor: 'start',
        bold: true,
        marker: 'row-label'
      })
    )
    svgAppend(
      headerGroup,
      drawFrameText(row.value, bounds.x + bounds.width / 2, cy, fontSize, {
        marker: 'row-value'
      })
    )
  })

  // Resolved live placeholders at their exact source anchors. The source
  // anchor is the note's horizontal centre / top edge (CENTER alignment).
  for (const value of header.anchoredValues) {
    svgAppend(
      headerGroup,
      drawFrameText(value.text, value.x, value.y, value.fontSize, {
        baseline: 'hanging',
        marker: 'anchored-value',
        font: value.font
      })
    )
  }

  svgAppend(group, headerGroup)
}

/**
 * One authored `<GfxObj>` frame — a Reference-Laws grouping box in practice.
 * Drawn exactly as authored: the source bounds, the decoded pen colour and
 * logical width, and the source fill (`none` for the transparent brush every
 * one of AnimalWF's frames carries). The reference sheets print these frames
 * square-cornered, so no corner radius is invented for them.
 */
function drawGraphicFrames(group: SVGElement, frames: readonly ArisPrintFrameGraphicFrame[]): void {
  for (const frame of frames) {
    const { bounds } = frame
    const frameGroup = svgElement('g', {
      'data-aris-graphic-frame': 'true',
      'data-aris-graphic-frame-id': frame.id,
      ...(frame.shape === null ? {} : { 'data-aris-graphic-frame-shape': frame.shape })
    })
    svgAppend(
      frameGroup,
      svgElement('rect', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        fill: frame.fillColor ?? 'none',
        stroke: frame.penColor ?? '#000000',
        'stroke-width': Math.max(1, frame.penWidth ?? 1)
      })
    )
    svgAppend(group, frameGroup)
  }
}

/**
 * Append the model's print frame to `parent`, in canvas coordinates: the
 * header band first (it sits at the top of the page), then the authored
 * graphic frames, then the bottom legend.
 */
export function drawPrintFrame(
  parent: SVGElement,
  frame: ArisPrintFrameModel,
  options: { readonly modelName: string }
): void {
  const group = svgElement('g', { 'data-aris-print-frame': 'true' })
  if (frame.header !== null) drawHeader(group, frame.header, options.modelName)
  drawGraphicFrames(group, frame.graphicFrames)
  if (frame.legend !== null) drawArisLegend(group, frame.legend)
  svgAppend(parent, group)
}
