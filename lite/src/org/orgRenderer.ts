// DMT-style custom renderer for the OrbitPM org pack. It sits at a higher
// priority (1500) than the stock BpmnRenderer (1000): it lets the base renderer
// draw the shape as normal, then paints the org decorations (owner chip, RACI
// role, channel band + chevrons + tag, CC styling, note styling, start-event
// trigger tag, lists, missing-info badge, start/end restyle, sub-process chip)
// INTO the same graphics group so bpmn-js's `saveSVG` serialises them verbatim
// into the exported diagram.
//
// The design is split so the geometry/colour logic is unit-testable in a
// plain node environment (no DOM, no bpmn-js):
//   * decorExtents.computeDecorLayout — PURE geometry, single source of truth
//   * planDecorations()  — PURE: props + geometry -> Decoration[]  (tested)
//   * applyDecorations()  — DOM: Decoration[] -> tiny-svg nodes      (e2e only)

import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer'
import { append as svgAppend, create as svgCreate, attr as svgAttr } from 'tiny-svg'

import { PALETTE } from './palette'
import { getOrgProps, type OrgProps, type OrgElementLike } from './orgModel'
import { isOrgStylingOn, isCompletenessOn } from './orgSettings'
import { OrgDecorSync } from './orgDecorSync'
import {
  computeDecorLayout,
  planBadgeBox,
  planSubChipBox,
  planMissingInfo,
  isMissingBadgeEligibleType,
  prepareListRows,
  truncate,
  channelLabel,
  triggerLabel,
  isActivityType,
  type Box,
  type FlowOrientation,
  type MissingCategory
} from './decorExtents'
// `t` is a plain function over the module-level language state — safe to call
// from this non-React module; used only for the canvas list/tag titles and the
// missing-info badge / sub-process chip tooltips.
import { t, type Key } from '../i18n'

// --- moved geometry helpers, re-exported so existing imports keep compiling
// (StepDetailsDialog.tsx, assist/interview.ts, the org test suites) ----------

export {
  truncate,
  isActivityType,
  isDecisionBasisType,
  prepareListRows,
  listBoxHeight,
  listBoxWidth,
  stackBelow,
  planMissingInfo,
  isMissingBadgeEligibleType,
  computeDecorLayout,
  computeDecorMargins,
  detectOrientation,
  planBadgeBox,
  planSubChipBox,
  LIST_MAX_ROWS,
  LIST_ROW_CHARS,
  MISSING_BADGE_SIZE,
  type BelowStackInput,
  type BelowStackLayout,
  type MissingCategory,
  type Box,
  type FlowOrientation,
  type DecorLayout,
  type DecorLayoutInput
} from './decorExtents'

// --- decoration model -------------------------------------------------------

export interface RectStyle {
  fill: string
  stroke: string
}

export type Decoration =
  | { kind: 'band'; x: number; y: number; w: number; h: number; fill: string }
  | { kind: 'chevrons'; x: number; y: number; size: number; glyphFill: string; bg: string }
  | {
      kind: 'tag'
      x: number
      y: number
      w: number
      h: number
      label: string
      detail: string
      fill: string
      stroke: string
    }
  | {
      kind: 'ownerBox'
      x: number
      y: number
      w: number
      h: number
      text: string
      fill: string
      stroke: string
      textColor: string
      personGlyph: boolean
    }
  | { kind: 'raci'; x: number; y: number; size: number; letter: string; fill: string; stroke: string }
  | { kind: 'ccStyle'; fill: string; stroke: string }
  | { kind: 'noteStyle'; fill: string; stroke: string }
  | {
      /** Restyle of the stock start/end event circle (fill + ring). */
      kind: 'eventStyle'
      fill: string
      stroke: string
      strokeWidth: number
    }
  | { kind: 'subLabel'; x: number; y: number; text: string; fill: string }
  | {
      kind: 'listBox'
      x: number
      y: number
      w: number
      h: number
      title: string
      rows: string[]
      fill: string
      stroke: string
      textColor: string
      /** Draw a small person glyph in front of every row (responsible list). */
      personGlyph: boolean
    }
  | {
      /** Amber "missing key process information" chip at the shape's top-right,
       *  fully OUTSIDE the shape (right of the right edge, above the top edge). */
      kind: 'missingBadge'
      x: number
      y: number
      size: number
      /** Number of missing categories; rendered as "!" (1) or "!N" (>1). */
      count: number
      /** Full localized tooltip (custom canvas tooltip, no native <title>). */
      titleText: string
      /** Machine-readable missing categories, stamped as `data-org-missing`. */
      missing: MissingCategory[]
      fill: string
      stroke: string
    }
  | {
      /** "Contains a sub-process" pill replacing the stock '+' marker on
       *  collapsed SubProcess / CallActivity shapes. Non-interactive. */
      kind: 'subChip'
      x: number
      y: number
      w: number
      h: number
      label: string
      tooltip: string
      fill: string
      stroke: string
    }

// --- pure colour helpers -----------------------------------------------------

/** Colour pair for a channel / trigger kind; unknown kinds fall back to the
 *  neutral RACI palette so manual/schedule/other triggers still read as tags. */
function tagColorsFor(kind: string): RectStyle {
  switch (kind) {
    case 'dmthub':
      return { fill: PALETTE.tagDmthubFill, stroke: PALETTE.tagDmthubBorder }
    case 'email':
      return { fill: PALETTE.tagEmailFill, stroke: PALETTE.tagEmailBorder }
    case 'data':
      return { fill: PALETTE.tagDataFill, stroke: PALETTE.tagDataBorder }
    default:
      return { fill: PALETTE.raciBg, stroke: PALETTE.raciBorder }
  }
}

// --- planDecorations ---------------------------------------------------------

/** Extra planning context; omitted -> horizontal orientation, no label. */
export interface PlanContext {
  orientation?: FlowOrientation
  labelBox?: Box | null
}

/**
 * PURE: turn a set of org props + the shape's type/geometry into an ordered
 * list of decorations. Every positioned decoration sits exactly on the Box
 * reported by decorExtents.computeDecorLayout for the same inputs (parity is
 * pinned by decorExtents.test.ts), so the auto-layout lane and the painted
 * pixels can never disagree. No DOM, no bpmn-js — safe to unit-test directly.
 */
export function planDecorations(
  props: OrgProps,
  elementType: string,
  width: number,
  height: number,
  ctx?: PlanContext
): Decoration[] {
  // Text annotations are only ever "note"-styled; nothing else applies.
  if (elementType === 'bpmn:TextAnnotation') {
    return [{ kind: 'noteStyle', fill: PALETTE.noteFill, stroke: PALETTE.noteBorder }]
  }

  const layout = computeDecorLayout({
    props,
    elementType,
    width,
    height,
    orientation: ctx?.orientation ?? 'horizontal',
    // The badge stays a separate composition step (planMissingBadge) so this
    // function keeps its flag-free signature.
    completenessOn: false,
    labelBox: ctx?.labelBox ?? null
  })

  const out: Decoration[] = []

  // Start/end events get their base circle restyled (green go / red stop).
  if (elementType === 'bpmn:StartEvent') {
    out.push({ kind: 'eventStyle', fill: PALETTE.startFill, stroke: PALETTE.startBorder, strokeWidth: 3 })
  } else if (elementType === 'bpmn:EndEvent') {
    out.push({ kind: 'eventStyle', fill: PALETTE.endFill, stroke: PALETTE.endBorder, strokeWidth: 4 })
  }

  // CC styling recolours the base shape.
  if (props.kind === 'cc') {
    out.push({ kind: 'ccStyle', fill: PALETTE.ccFill, stroke: PALETTE.ccBorder })
  }

  // Channel: green step band + chevrons glyph + channel tag (activities only —
  // layout.channelTag presence already encodes the type gate).
  if (layout.channelTag && props.channel) {
    const colors = tagColorsFor(props.channel)
    out.push({ kind: 'band', x: 0, y: 0, w: width, h: 6, fill: PALETTE.stepGreenBand })
    out.push({
      kind: 'chevrons',
      x: width - 14,
      y: 14,
      size: 16,
      glyphFill: '#ffffff',
      bg: PALETTE.stepGreenBand
    })
    out.push({
      kind: 'tag',
      x: layout.channelTag.x,
      y: layout.channelTag.y,
      w: layout.channelTag.w,
      h: layout.channelTag.h,
      label: channelLabel(props.channel),
      detail: props.channelDetail ? truncate(props.channelDetail, 18) : '',
      fill: colors.fill,
      stroke: colors.stroke
    })
  }

  // Start-event trigger tag (above the event).
  if (layout.triggerTag && props.trigger) {
    const colors = tagColorsFor(props.trigger)
    out.push({
      kind: 'tag',
      x: layout.triggerTag.x,
      y: layout.triggerTag.y,
      w: layout.triggerTag.w,
      h: layout.triggerTag.h,
      label: triggerLabel(props.trigger),
      detail:
        props.trigger === 'dmthub' && props.triggerService ? truncate(props.triggerService, 18) : '',
      fill: colors.fill,
      stroke: colors.stroke
    })
  }

  // Inputs / base-information list box (teal): above the shape in horizontal
  // flow, left of the shape in vertical flow — geometry from the layout.
  if (layout.inputsBox) {
    out.push({
      kind: 'listBox',
      x: layout.inputsBox.x,
      y: layout.inputsBox.y,
      w: layout.inputsBox.w,
      h: layout.inputsBox.h,
      title: t('canvas.inputs'),
      rows: prepareListRows(props.inputs),
      fill: PALETTE.inputFill,
      stroke: PALETTE.inputBorder,
      textColor: PALETTE.inputText,
      personGlyph: false
    })
  }

  // CC / informed-party list box (pink): below-stack member in horizontal
  // flow, right-side stack member in vertical flow. Independent of kind==='cc';
  // when present it REPLACES the legacy single-line "CC: …" sub-label.
  if (layout.ccBox) {
    out.push({
      kind: 'listBox',
      x: layout.ccBox.x,
      y: layout.ccBox.y,
      w: layout.ccBox.w,
      h: layout.ccBox.h,
      title: t('canvas.cc'),
      rows: prepareListRows(props.ccList),
      fill: PALETTE.ccFill,
      stroke: PALETTE.ccBorder,
      textColor: PALETTE.ccBorder,
      personGlyph: false
    })
  }

  // Legacy CC sub-label ("CC: <recipient>") — kept for kind==='cc' diagrams
  // that predate ccList; suppressed whenever the CC list box renders.
  if (layout.ccSubLabelY !== undefined) {
    out.push({
      kind: 'subLabel',
      x: 0,
      y: layout.ccSubLabelY,
      text: 'CC: ' + truncate(props.ccTo ?? '', 24),
      fill: PALETTE.ccBorder
    })
  }

  // Owner chip + RACI role letter (below stack / right stack per orientation).
  if (layout.ownerChip && props.owner) {
    const chip = layout.ownerChip
    out.push({
      kind: 'ownerBox',
      x: chip.x,
      y: chip.y,
      w: chip.w,
      h: chip.h,
      text: truncate(props.owner, 22),
      fill: PALETTE.ownerFill,
      stroke: PALETTE.ownerBorder,
      textColor: PALETTE.ownerText,
      personGlyph: true
    })
    out.push({
      kind: 'raci',
      x: chip.x,
      y: chip.y + 3,
      size: 14,
      letter: props.ownerRole || 'R',
      fill: PALETTE.raciBg,
      stroke: PALETTE.raciBorder
    })
  }

  // Responsible-people list box (owner beige, one person glyph per row).
  if (layout.respBox) {
    out.push({
      kind: 'listBox',
      x: layout.respBox.x,
      y: layout.respBox.y,
      w: layout.respBox.w,
      h: layout.respBox.h,
      title: t('canvas.responsible'),
      rows: prepareListRows(props.respList),
      fill: PALETTE.ownerFill,
      stroke: PALETTE.ownerBorder,
      textColor: PALETTE.ownerText,
      personGlyph: true
    })
  }

  // Decision-basis tag (amber) on gateways / business-rule tasks — always the
  // last block of its stack.
  if (layout.basisTag) {
    out.push({
      kind: 'tag',
      x: layout.basisTag.x,
      y: layout.basisTag.y,
      w: layout.basisTag.w,
      h: layout.basisTag.h,
      label: t('canvas.basis'),
      detail: truncate(props.decisionBasis ?? '', 28),
      fill: PALETTE.basisFill,
      stroke: PALETTE.basisBorder
    })
  }

  return out
}

// --- completeness badge ------------------------------------------------------

const MISSING_LABEL_KEYS: Record<MissingCategory, Key> = {
  owner: 'missing.owner',
  inputs: 'missing.inputs',
  outputs: 'missing.outputs',
  basis: 'missing.basis',
  trigger: 'missing.trigger'
}

/**
 * PURE: the missing-info badge for an element, or null when nothing is missing.
 * Geometry from decorExtents.planBadgeBox: a 16x16 chip floating diagonally OFF
 * the shape's top-right corner (x = width+2, y = -20..-4) — disjoint from every
 * other decoration this renderer can paint on the same element (pinned by the
 * completeness grid test).
 */
export function planMissingBadge(
  props: OrgProps,
  elementType: string,
  width: number
): Decoration | null {
  const missing = planMissingInfo(props, elementType)
  if (missing.length === 0) return null
  const list = missing.map((category) => t(MISSING_LABEL_KEYS[category])).join(', ')
  const box = planBadgeBox(width)
  return {
    kind: 'missingBadge',
    x: box.x,
    y: box.y,
    size: box.w,
    count: missing.length,
    titleText: t('missing.title', { list }),
    missing,
    fill: PALETTE.basisFill,
    stroke: PALETTE.basisBorder
  }
}

// --- ownership (canRender) ---------------------------------------------------

/** Types the org renderer restyles even when they carry NO org props (start /
 *  end events get the eventStyle recolour; sub-process-capable containers get
 *  the collapsed-marker chip swap) — claimed whenever org styling is on. */
const ORG_RESTYLED_TYPES: ReadonlySet<string> = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess'
])

export function hasAnyOrgProp(element: OrgElementLike): boolean {
  const props = getOrgProps(element)
  return Object.values(props).some((v) => v !== undefined && v !== '')
}

/**
 * PURE: does the org renderer own this element? Styling must be on, the element
 * must be a non-label, non-connection `bpmn:*` shape, and it must be one of:
 * a text annotation (always note-styled), an always-restyled type (start/end
 * events, sub-process-capable containers), a badge-eligible type while
 * completeness highlighting is on, or any element carrying at least one org
 * prop.
 */
export function canRenderOrg(
  element: OrgElementLike | null | undefined,
  stylingOn: boolean,
  completenessOn: boolean = false
): boolean {
  if (!stylingOn || !element) return false
  if (element.labelTarget || element.waypoints) return false
  const type = element.type
  if (typeof type !== 'string' || !type.startsWith('bpmn:')) return false
  if (type === 'bpmn:TextAnnotation') return true
  if (ORG_RESTYLED_TYPES.has(type)) return true
  if (completenessOn && isMissingBadgeEligibleType(type)) return true
  return hasAnyOrgProp(element)
}

// --- external-label helper ---------------------------------------------------

/**
 * PURE: the element's external-label bounds RELATIVE to the shape's top-left
 * (the coordinate space computeDecorLayout expects), or null when the element
 * has no external label / incomplete geometry.
 */
export function relativeLabelBox(element: OrgElementLike): Box | null {
  const label = element.label
  if (!label) return null
  if (
    typeof label.x !== 'number' ||
    typeof label.y !== 'number' ||
    typeof label.width !== 'number' ||
    typeof label.height !== 'number' ||
    typeof element.x !== 'number' ||
    typeof element.y !== 'number'
  ) {
    return null
  }
  return { x: label.x - element.x, y: label.y - element.y, w: label.width, h: label.height }
}

// --- collapsed sub-process marker swap ---------------------------------------

/** Minimal structural DOM surface so the marker swap is unit-testable with
 *  plain object fakes (no jsdom). */
export interface MarkerDomLike {
  querySelector(sel: string): {
    previousElementSibling?: {
      tagName?: string
      getAttribute?(n: string): string | null
      remove(): void
    } | null
    remove(): void
  } | null
}

/**
 * Removes the stock collapsed-sub-process '+' marker (the path bpmn-js stamps
 * with `data-marker="sub-process"`, plus its adjacent 14x14 background rect).
 * Returns true when a marker was found (== the element is a collapsed
 * SubProcess / CallActivity), whether or not removal fully succeeded.
 */
export function removeStockSubProcessMarker(visual: MarkerDomLike): boolean {
  if (!visual || typeof visual.querySelector !== 'function') return false
  let path: ReturnType<MarkerDomLike['querySelector']>
  try {
    path = visual.querySelector('path[data-marker="sub-process"]')
  } catch {
    return false
  }
  if (!path) return false
  try {
    // bpmn-js's SubProcessMarker appends a plain 14x14 rect immediately before
    // the path; only remove it when it is exactly that rect (guards against
    // marker-DOM changes in future bpmn-js versions).
    const prev = path.previousElementSibling
    if (prev && prev.tagName?.toLowerCase() === 'rect' && prev.getAttribute?.('width') === '14') {
      prev.remove()
    }
  } catch {
    /* rect removal is best-effort */
  }
  try {
    path.remove()
  } catch {
    /* path removal is best-effort */
  }
  return true
}

/** Does the element's business object carry a `calledElement` (a CallActivity
 *  linked to a concrete process)? Read across both moddle worlds. */
function hasCalledElement(element: OrgElementLike): boolean {
  const bo = element.businessObject
  if (!bo) return false
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get('calledElement')
      if (value != null && value !== '') return true
    } catch {
      /* fall through */
    }
  }
  const direct = bo['calledElement']
  if (direct != null && direct !== '') return true
  const attr = bo.$attrs?.['calledElement']
  return attr != null && attr !== ''
}

// --- DOM applier (tiny-svg) --------------------------------------------------

const FONT_FAMILY = 'inherit'

/** Class + data-attribute contract shared with editor/canvasDecor.ts (kept as
 *  literals on both sides so org/ never imports from editor/). */
const BADGE_CLASS = 'orbitpm-missing-badge'
const TOOLTIP_ATTR = 'data-org-tooltip'
const MISSING_ATTR = 'data-org-missing'

/** The base `.djs-visual` group bpmn-js drew into, falling back to parentGfx. */
function baseVisual(parentGfx: SVGElement): SVGElement {
  const inner = parentGfx.querySelector?.('.djs-visual')
  return (inner as SVGElement | null) ?? parentGfx
}

/** First fillable primitive of the base shape, for ccStyle / noteStyle /
 *  eventStyle recolour. */
function firstShapeChild(parentGfx: SVGElement): SVGElement | null {
  const visual = baseVisual(parentGfx)
  return visual.querySelector?.('rect, polygon, path, circle') ?? null
}

function makeText(x: number, y: number, content: string, extra: Record<string, string | number>): SVGElement {
  const text = svgCreate('text', { x, y, 'font-family': FONT_FAMILY, ...extra })
  text.textContent = content
  return text
}

/**
 * DOM: realise the planned decorations as tiny-svg nodes appended into
 * `parentGfx`. Not unit-tested (needs a real SVG DOM); covered by Playwright
 * e2e via saveSVG. Wrapped defensively so a bad node can never break the base
 * shape that was already drawn.
 */
export function applyDecorations(parentGfx: SVGElement, decorations: Decoration[]): void {
  for (const d of decorations) {
    try {
      switch (d.kind) {
        case 'ccStyle':
        case 'noteStyle': {
          const target = firstShapeChild(parentGfx)
          if (target) svgAttr(target, { fill: d.fill, stroke: d.stroke })
          break
        }
        case 'eventStyle': {
          const target = firstShapeChild(parentGfx)
          if (target) {
            svgAttr(target, { fill: d.fill, stroke: d.stroke, 'stroke-width': d.strokeWidth })
          }
          break
        }
        case 'band': {
          const rect = svgCreate('rect', {
            x: d.x,
            y: d.y,
            width: d.w,
            height: d.h,
            fill: d.fill
          })
          svgAppend(parentGfx, rect)
          break
        }
        case 'chevrons': {
          const bg = svgCreate('rect', {
            x: d.x - 2,
            y: d.y - 13,
            width: d.size,
            height: d.size,
            rx: 3,
            fill: d.bg
          })
          svgAppend(parentGfx, bg)
          svgAppend(
            parentGfx,
            makeText(d.x + 1, d.y, '»', {
              fill: d.glyphFill,
              'font-size': 12,
              'font-weight': 'bold'
            })
          )
          break
        }
        case 'tag': {
          const rect = svgCreate('rect', {
            x: d.x,
            y: d.y,
            width: d.w,
            height: d.h,
            rx: 3,
            fill: d.fill,
            stroke: d.stroke
          })
          svgAppend(parentGfx, rect)
          const label = d.detail ? d.label + ': ' + d.detail : d.label
          svgAppend(
            parentGfx,
            makeText(d.x + 5, d.y + 13, label, { fill: d.stroke, 'font-size': 9 })
          )
          break
        }
        case 'ownerBox': {
          const rect = svgCreate('rect', {
            x: d.x,
            y: d.y,
            width: d.w,
            height: d.h,
            rx: 3,
            fill: d.fill,
            stroke: d.stroke
          })
          svgAppend(parentGfx, rect)
          if (d.personGlyph) {
            svgAppend(parentGfx, makeText(d.x + 18, d.y + 14, '👤', { 'font-size': 10 }))
          }
          svgAppend(
            parentGfx,
            makeText(d.x + 30, d.y + 14, d.text, { fill: d.textColor, 'font-size': 10 })
          )
          break
        }
        case 'raci': {
          const rect = svgCreate('rect', {
            x: d.x,
            y: d.y,
            width: d.size,
            height: d.size,
            rx: 2,
            fill: d.fill,
            stroke: d.stroke
          })
          svgAppend(parentGfx, rect)
          svgAppend(
            parentGfx,
            makeText(d.x + d.size / 2, d.y + d.size - 3, d.letter, {
              fill: d.stroke,
              'font-size': 10,
              'font-weight': 'bold',
              'text-anchor': 'middle'
            })
          )
          break
        }
        case 'subLabel': {
          svgAppend(parentGfx, makeText(d.x, d.y, d.text, { fill: d.fill, 'font-size': 9 }))
          break
        }
        case 'listBox': {
          const rect = svgCreate('rect', {
            x: d.x,
            y: d.y,
            width: d.w,
            height: d.h,
            rx: 4,
            fill: d.fill,
            stroke: d.stroke
          })
          svgAppend(parentGfx, rect)
          // Title band: bold title + a divider line under it.
          svgAppend(
            parentGfx,
            makeText(d.x + 6, d.y + 14, d.title, {
              fill: d.stroke,
              'font-size': 9,
              'font-weight': 'bold'
            })
          )
          const divider = svgCreate('line', {
            x1: d.x,
            y1: d.y + 18,
            x2: d.x + d.w,
            y2: d.y + 18,
            stroke: d.stroke,
            'stroke-width': 0.75
          })
          svgAppend(parentGfx, divider)
          // Rows (already truncated/capped by prepareListRows).
          d.rows.forEach((row, i) => {
            const baseline = d.y + 32 + 13 * i
            if (d.personGlyph) {
              svgAppend(parentGfx, makeText(d.x + 5, d.y + 31 + 13 * i, '👤', { 'font-size': 8 }))
            }
            svgAppend(
              parentGfx,
              makeText(d.x + (d.personGlyph ? 17 : 6), baseline, row, {
                fill: d.textColor,
                'font-size': 9
              })
            )
          })
          break
        }
        case 'missingBadge': {
          // One <g> per badge so the custom canvas tooltip + click handling
          // (editor/canvasDecor.ts) cover the whole chip. No native <title> —
          // the delegated tooltip replaces it (never both).
          const group = svgCreate('g', {
            class: BADGE_CLASS,
            [TOOLTIP_ATTR]: d.titleText + '\n' + t('missing.tooltip.action'),
            [MISSING_ATTR]: d.missing.join(','),
            cursor: 'pointer',
            'pointer-events': 'all'
          })
          const rect = svgCreate('rect', {
            x: d.x,
            y: d.y,
            width: d.size,
            height: d.size,
            rx: 4,
            fill: d.fill,
            stroke: d.stroke,
            'stroke-width': 1.2
          })
          svgAppend(group, rect)
          svgAppend(
            group,
            makeText(d.x + d.size / 2, d.y + d.size - 4, d.count > 1 ? '!' + d.count : '!', {
              fill: d.stroke,
              'font-size': 10,
              'font-weight': 'bold',
              'text-anchor': 'middle'
            })
          )
          svgAppend(parentGfx, group)
          break
        }
        case 'subChip': {
          // Non-interactive pill (tooltip only) where the stock '+' sat.
          const group = svgCreate('g', {
            class: 'orbitpm-sub-chip',
            [TOOLTIP_ATTR]: d.tooltip,
            'pointer-events': 'all'
          })
          const rect = svgCreate('rect', {
            x: d.x,
            y: d.y,
            width: d.w,
            height: d.h,
            rx: 3,
            fill: d.fill,
            stroke: d.stroke
          })
          svgAppend(group, rect)
          svgAppend(group, makeText(d.x + 4, d.y + 10, '⧉', { fill: d.stroke, 'font-size': 9 }))
          svgAppend(
            group,
            makeText(d.x + 14, d.y + 10, d.label, { fill: d.stroke, 'font-size': 8 })
          )
          svgAppend(parentGfx, group)
          break
        }
      }
    } catch {
      /* one bad decoration must never break the base shape */
    }
  }
}

// --- the renderer + DI module -----------------------------------------------

type EventBusLike = { on: (...args: unknown[]) => unknown }

interface BpmnRendererLike {
  drawShape(parentGfx: SVGElement, element: OrgElementLike): SVGElement
  drawConnection(parentGfx: SVGElement, connection: unknown): SVGElement
}

/** The one method OrgRenderer needs from OrgDecorSync (kept structural so the
 *  2-arg test constructions and any fake stay valid). */
interface OrientationSourceLike {
  getOrientation(): FlowOrientation
}

export class OrgRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'bpmnRenderer', 'orgDecorSync']

  private readonly bpmnRenderer: BpmnRendererLike
  private readonly orgDecorSync?: OrientationSourceLike

  constructor(
    eventBus: EventBusLike,
    bpmnRenderer: BpmnRendererLike,
    orgDecorSync?: OrientationSourceLike
  ) {
    super(eventBus as unknown as ConstructorParameters<typeof BaseRenderer>[0], 1500)
    this.bpmnRenderer = bpmnRenderer
    this.orgDecorSync = orgDecorSync
  }

  canRender(element: OrgElementLike): boolean {
    // Both flags are read live per call so a settings toggle + refresh sweep
    // re-evaluates ownership without a reload. Org styling stays the master
    // switch: with it off the base renderer draws everything, badges included.
    return canRenderOrg(element, isOrgStylingOn(), isCompletenessOn())
  }

  drawShape(parentGfx: SVGElement, element: OrgElementLike): SVGElement {
    const shape = this.bpmnRenderer.drawShape(parentGfx, element)
    try {
      const type = typeof element.type === 'string' ? element.type : ''
      const props = getOrgProps(element)
      const width = element.width ?? 0
      const height = element.height ?? 0
      const ctx: PlanContext = {
        orientation: this.orgDecorSync?.getOrientation() ?? 'horizontal',
        labelBox: relativeLabelBox(element)
      }
      const decorations = planDecorations(props, type, width, height, ctx)
      // Completeness badge composed as a separate step so planDecorations keeps
      // its flag-free signature.
      if (isCompletenessOn()) {
        const badge = planMissingBadge(props, type, width)
        if (badge) decorations.push(badge)
      }
      // Collapsed SubProcess / CallActivity: bpmn-js stamped its '+' marker
      // into the visual — swap it for the DMT-style sub-process chip.
      if (removeStockSubProcessMarker(parentGfx as unknown as MarkerDomLike)) {
        const box = planSubChipBox(width, height)
        decorations.push({
          kind: 'subChip',
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          label: t('canvas.subchip'),
          tooltip: hasCalledElement(element)
            ? t('canvas.subprocess.tooltip')
            : t('canvas.subprocess.tooltip.generic'),
          fill: PALETTE.subChipFill,
          stroke: PALETTE.subChipBorder
        })
      }
      applyDecorations(parentGfx, decorations)
    } catch {
      /* decoration failures must never break base rendering */
    }
    return shape
  }

  drawConnection(parentGfx: SVGElement, connection: unknown): SVGElement {
    return this.bpmnRenderer.drawConnection(parentGfx, connection)
  }
}

export const OrgRenderModule: {
  __init__: string[]
  orgDecorSync: [string, typeof OrgDecorSync]
  orgRenderer: [string, typeof OrgRenderer]
} = {
  __init__: ['orgDecorSync', 'orgRenderer'],
  orgDecorSync: ['type', OrgDecorSync],
  orgRenderer: ['type', OrgRenderer]
}
