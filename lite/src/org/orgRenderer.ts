// DMT-style custom renderer for the OrbitPM org pack. It sits at a higher
// priority (1500) than the stock BpmnRenderer (1000): it lets the base renderer
// draw the shape as normal, then paints the org decorations (owner chip, RACI
// role, channel band + chevrons + tag, CC styling, note styling, start-event
// trigger tag) INTO the same graphics group so bpmn-js's `saveSVG` serialises
// them verbatim into the exported diagram.
//
// The design is split in two so the geometry/colour logic is unit-testable in a
// plain node environment (no DOM, no bpmn-js):
//   * planDecorations()  — PURE: props + geometry -> Decoration[]  (tested)
//   * applyDecorations()  — DOM: Decoration[] -> tiny-svg nodes      (e2e only)

import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer'
import { append as svgAppend, create as svgCreate, attr as svgAttr } from 'tiny-svg'

import { PALETTE, CHANNEL_TAG_LABELS } from './palette'
import { getOrgProps, splitList, type OrgProps, type OrgElementLike } from './orgModel'
import { isOrgStylingOn, isCompletenessOn } from './orgSettings'
// `t` is a plain function over the module-level language state — safe to call
// from this non-React module; used only for the canvas list/tag titles and the
// missing-info badge tooltip.
import { t, type Key } from '../i18n'

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
      /** Full localized tooltip — becomes a native SVG <title> child. */
      titleText: string
      fill: string
      stroke: string
    }

// --- pure helpers -----------------------------------------------------------

const ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ScriptTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess'
])

function isActivityType(type: string): boolean {
  return ACTIVITY_TYPES.has(type)
}

/** Truncate to `max` characters, appending an ellipsis when it overflows. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 1) return value.slice(0, max)
  return value.slice(0, max - 1) + '…'
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

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

function channelLabel(channel: string): string {
  return CHANNEL_TAG_LABELS[channel] ?? channel.toUpperCase()
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'dmthub':
      return 'DMT HUB'
    case 'email':
      return 'EMAIL'
    default:
      return capitalize(trigger)
  }
}

function tagWidth(label: string, maxWidth: number): number {
  return Math.min(maxWidth, 12 + 7 * label.length)
}

// --- list boxes + below-shape stacking (all PURE, unit-tested) ---------------

/** Element types that may carry a rendered `decisionBasis` tag. */
const DECISION_BASIS_TYPES: ReadonlySet<string> = new Set([
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ComplexGateway',
  'bpmn:BusinessRuleTask'
])

export function isDecisionBasisType(type: string): boolean {
  return DECISION_BASIS_TYPES.has(type)
}

/** Row caps shared by every list box. */
export const LIST_MAX_ROWS = 5
export const LIST_ROW_CHARS = 20
/** Horizontal gap between the shape edge and a side list box. */
const LIST_GAP_X = 12
/** Vertical gap between stacked below-shape blocks. */
const STACK_GAP = 8
/** Owner chip height (unchanged from the original renderer). */
const OWNER_CHIP_H = 20
/** Decision-basis tag height (same as the channel/trigger tags). */
const BASIS_TAG_H = 18
/** Vertical room consumed by the legacy "CC: …" sub-label text line. */
const SUB_LABEL_ADVANCE = 16
/** List-box internals: title band height and per-row height. */
const LIST_TITLE_H = 22
const LIST_ROW_H = 13

/**
 * PURE: turn a '\n'-joined multi-value attribute into display rows — trimmed,
 * blank lines dropped, each row truncated to `maxChars`, capped at `maxRows`
 * content rows plus a final "+N" overflow row when entries remain.
 */
export function prepareListRows(
  raw: string | undefined,
  maxRows: number = LIST_MAX_ROWS,
  maxChars: number = LIST_ROW_CHARS
): string[] {
  const entries = splitList(raw)
  if (entries.length === 0) return []
  const rows = entries.slice(0, maxRows).map((entry) => truncate(entry, maxChars))
  if (entries.length > maxRows) rows.push('+' + (entries.length - maxRows))
  return rows
}

/** PURE: list-box height for `rowCount` rows (title band + rows). */
export function listBoxHeight(rowCount: number): number {
  return LIST_TITLE_H + LIST_ROW_H * rowCount
}

/** PURE: list-box width sized to the longest of title/rows, clamped 70..170. */
export function listBoxWidth(title: string, rows: string[], personGlyph: boolean): number {
  let maxLen = title.length
  for (const row of rows) maxLen = Math.max(maxLen, row.length)
  const indent = personGlyph ? 12 : 0
  return Math.max(70, Math.min(170, 16 + indent + 6 * maxLen))
}

export interface BelowStackInput {
  /** Shape height — the stack grows downward from this baseline. */
  height: number
  /** Legacy "CC: …" sub-label present (kind==='cc' AND no ccList box). */
  ccSubLabel: boolean
  /** Owner chip (+ RACI letter) present. */
  owner: boolean
  /** Prepared responsible-list row count (0 = no list box). */
  respRows: number
  /** Decision-basis tag present. */
  basis: boolean
}

export interface BelowStackLayout {
  /** Text BASELINE y of the legacy CC sub-label (matches the original +12). */
  ccSubLabelY?: number
  /** Top y of the owner chip (original: height+8, or height+24 after a CC sub-label). */
  ownerY?: number
  /** Top y of the responsible list box. */
  respY?: number
  /** Top y of the decision-basis tag. */
  basisY?: number
  /** First free y below the whole stack. */
  bottom: number
}

/**
 * PURE: below-shape stacking. Blocks stack strictly in this order — legacy CC
 * sub-label, owner chip, responsible list, decision-basis tag — each one
 * advancing a cursor past its own height plus a fixed gap, so no combination
 * can ever overlap. Reproduces the pre-list offsets exactly: owner-only sits
 * at height+8 and CC-sub-label+owner puts the chip at height+24.
 */
export function stackBelow(input: BelowStackInput): BelowStackLayout {
  let cursor = input.height
  const out: BelowStackLayout = { bottom: cursor }
  if (input.ccSubLabel) {
    out.ccSubLabelY = cursor + 12
    cursor += SUB_LABEL_ADVANCE
  }
  if (input.owner) {
    out.ownerY = cursor + STACK_GAP
    cursor = out.ownerY + OWNER_CHIP_H
  }
  if (input.respRows > 0) {
    out.respY = cursor + STACK_GAP
    cursor = out.respY + listBoxHeight(input.respRows)
  }
  if (input.basis) {
    out.basisY = cursor + STACK_GAP
    cursor = out.basisY + BASIS_TAG_H
  }
  out.bottom = cursor
  return out
}

/**
 * PURE: turn a set of org props + the shape's type/geometry into an ordered
 * list of decorations. No DOM, no bpmn-js — safe to unit-test directly.
 */
export function planDecorations(
  props: OrgProps,
  elementType: string,
  width: number,
  height: number
): Decoration[] {
  // Text annotations are only ever "note"-styled; nothing else applies.
  if (elementType === 'bpmn:TextAnnotation') {
    return [{ kind: 'noteStyle', fill: PALETTE.noteFill, stroke: PALETTE.noteBorder }]
  }

  const out: Decoration[] = []
  const isCc = props.kind === 'cc'
  const isActivity = isActivityType(elementType)
  const isStartEvent = elementType === 'bpmn:StartEvent'

  // CC styling recolours the base shape.
  if (isCc) {
    out.push({ kind: 'ccStyle', fill: PALETTE.ccFill, stroke: PALETTE.ccBorder })
  }

  // Channel: green step band + chevrons glyph + channel tag (activities only).
  if (props.channel && isActivity) {
    const label = channelLabel(props.channel)
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
      x: 0,
      y: -22,
      w: tagWidth(label, width),
      h: 18,
      label,
      detail: props.channelDetail ? truncate(props.channelDetail, 18) : '',
      fill: colors.fill,
      stroke: colors.stroke
    })
  }

  // Start-event trigger tag (above the event).
  if (props.trigger && isStartEvent) {
    const label = triggerLabel(props.trigger)
    const colors = tagColorsFor(props.trigger)
    const detail =
      props.trigger === 'dmthub' && props.triggerService ? truncate(props.triggerService, 18) : ''
    out.push({
      kind: 'tag',
      x: 0,
      y: -26,
      w: tagWidth(label, Math.max(width, 60)),
      h: 18,
      label,
      detail,
      fill: colors.fill,
      stroke: colors.stroke
    })
  }

  // Inputs / base-information list box to the LEFT of an activity (x < 0),
  // in the dedicated teal scheme so the input feed reads distinctly.
  const inputRows = isActivity ? prepareListRows(props.inputs) : []
  if (inputRows.length > 0) {
    const title = t('canvas.inputs')
    const w = listBoxWidth(title, inputRows, false)
    out.push({
      kind: 'listBox',
      x: -(w + LIST_GAP_X),
      y: 0,
      w,
      h: listBoxHeight(inputRows.length),
      title,
      rows: inputRows,
      fill: PALETTE.inputFill,
      stroke: PALETTE.inputBorder,
      textColor: PALETTE.inputText,
      personGlyph: false
    })
  }

  // CC / informed-party list box to the RIGHT of the shape (pink CC scheme).
  // Independent of kind==='cc'; when present it REPLACES the legacy single-line
  // "CC: …" sub-label so the same names are never painted twice.
  const ccRows = prepareListRows(props.ccList)
  if (ccRows.length > 0) {
    const title = t('canvas.cc')
    const w = listBoxWidth(title, ccRows, false)
    out.push({
      kind: 'listBox',
      x: width + LIST_GAP_X,
      y: 0,
      w,
      h: listBoxHeight(ccRows.length),
      title,
      rows: ccRows,
      fill: PALETTE.ccFill,
      stroke: PALETTE.ccBorder,
      textColor: PALETTE.ccBorder,
      personGlyph: false
    })
  }

  // Below the shape everything shares one overlap-free stack: legacy CC
  // sub-label, owner chip (+RACI), responsible list, decision-basis tag.
  const respRows = prepareListRows(props.respList)
  const hasBasis = Boolean(props.decisionBasis) && isDecisionBasisType(elementType)
  const stack = stackBelow({
    height,
    ccSubLabel: isCc && ccRows.length === 0,
    owner: Boolean(props.owner),
    respRows: respRows.length,
    basis: hasBasis
  })

  // Legacy CC sub-label ("CC: <recipient>") — kept for kind==='cc' diagrams
  // that predate ccList; suppressed above whenever the CC list box renders.
  if (stack.ccSubLabelY !== undefined) {
    out.push({
      kind: 'subLabel',
      x: 0,
      y: stack.ccSubLabelY,
      text: 'CC: ' + truncate(props.ccTo ?? '', 24),
      fill: PALETTE.ccBorder
    })
  }

  // Owner chip + RACI role letter below the shape.
  if (props.owner && stack.ownerY !== undefined) {
    const text = truncate(props.owner, 22)
    const ownerY = stack.ownerY
    out.push({
      kind: 'ownerBox',
      x: 0,
      y: ownerY,
      w: Math.min(160, 24 + 7 * text.length),
      h: 20,
      text,
      fill: PALETTE.ownerFill,
      stroke: PALETTE.ownerBorder,
      textColor: PALETTE.ownerText,
      personGlyph: true
    })
    out.push({
      kind: 'raci',
      x: 0,
      y: ownerY + 3,
      size: 14,
      letter: props.ownerRole || 'R',
      fill: PALETTE.raciBg,
      stroke: PALETTE.raciBorder
    })
  }

  // Responsible-people list box (owner beige, one person glyph per row),
  // stacked under the owner chip when both are present.
  if (respRows.length > 0 && stack.respY !== undefined) {
    const title = t('canvas.responsible')
    out.push({
      kind: 'listBox',
      x: 0,
      y: stack.respY,
      w: listBoxWidth(title, respRows, true),
      h: listBoxHeight(respRows.length),
      title,
      rows: respRows,
      fill: PALETTE.ownerFill,
      stroke: PALETTE.ownerBorder,
      textColor: PALETTE.ownerText,
      personGlyph: true
    })
  }

  // Decision-basis tag (amber) on gateways / business-rule tasks, always the
  // last block of the below-shape stack.
  if (hasBasis && stack.basisY !== undefined) {
    const label = t('canvas.basis')
    const detail = truncate(props.decisionBasis ?? '', 28)
    out.push({
      kind: 'tag',
      x: 0,
      y: stack.basisY,
      w: tagWidth(label + ': ' + detail, 220),
      h: BASIS_TAG_H,
      label,
      detail,
      fill: PALETTE.basisFill,
      stroke: PALETTE.basisBorder
    })
  }

  return out
}

// --- completeness highlighting (all PURE, unit-tested) -----------------------

/** One category of key process information a shape can be missing. The names
 *  map 1:1 onto the `missing.*` i18n keys. */
export type MissingCategory = 'owner' | 'inputs' | 'outputs' | 'basis' | 'trigger'

const MISSING_LABEL_KEYS: Record<MissingCategory, Key> = {
  owner: 'missing.owner',
  inputs: 'missing.inputs',
  outputs: 'missing.outputs',
  basis: 'missing.basis',
  trigger: 'missing.trigger'
}

/**
 * PURE: is this a type the completeness badge can ever apply to? Activities
 * (except CallActivity — a linked call gets its data from the called process),
 * the decision-basis set (gateways + business-rule tasks) and start events.
 */
export function isMissingBadgeEligibleType(type: string): boolean {
  if (isActivityType(type) && type !== 'bpmn:CallActivity') return true
  if (isDecisionBasisType(type)) return true
  return type === 'bpmn:StartEvent'
}

/**
 * PURE: which key process information is this element missing? Empty means
 * complete (or a type the completeness check does not apply to).
 *   - activities (minus CallActivity): responsible party (owner AND respList
 *     both empty), inputs, outputs
 *   - decision-basis set (all gateways + business-rule tasks): decisionBasis
 *   - start events: trigger
 * List-valued props count as missing when they contain no non-blank entry
 * (matching what prepareListRows would actually render).
 */
export function planMissingInfo(props: OrgProps, elementType: string): MissingCategory[] {
  const out: MissingCategory[] = []
  if (isActivityType(elementType) && elementType !== 'bpmn:CallActivity') {
    if (!props.owner && splitList(props.respList).length === 0) out.push('owner')
    if (splitList(props.inputs).length === 0) out.push('inputs')
    if (splitList(props.outputs).length === 0) out.push('outputs')
  }
  if (isDecisionBasisType(elementType) && !props.decisionBasis) out.push('basis')
  if (elementType === 'bpmn:StartEvent' && !props.trigger) out.push('trigger')
  return out
}

/** Side length of the square missing-info chip. */
export const MISSING_BADGE_SIZE = 16
/** Horizontal clearance between the shape's right edge and the chip. */
const MISSING_BADGE_GAP_X = 2
/** Vertical clearance between the chip's bottom edge and the shape's top edge. */
const MISSING_BADGE_GAP_Y = 4

/**
 * PURE: the missing-info badge for an element, or null when nothing is missing.
 * Geometry: a 16x16 chip floating diagonally OFF the shape's top-right corner —
 * x starts 2px right of the right edge (x = width + 2) and the chip bottom ends
 * 4px above the top edge (y = -20 .. -4). That region is disjoint from every
 * other decoration this renderer can paint on the same element:
 *   - band (0..width x 0..6) and chevrons (width-16..width x 1..17): both stop
 *     at x = width, the chip starts at width + 2;
 *   - channel tag (y -22..-4, x 0..tagWidth<=width): same — never past width;
 *   - CC list box (x >= width+12, y >= 0): the chip ends at y = -4 < 0;
 *   - inputs box (x < 0) and the whole below-shape stack (y >= height): far away;
 *   - start-event trigger tag (can overhang width on narrow events): mutually
 *     exclusive with the badge — the trigger tag renders only when `trigger` is
 *     SET, the badge on a start event only when it is MISSING.
 */
export function planMissingBadge(
  props: OrgProps,
  elementType: string,
  width: number
): Decoration | null {
  const missing = planMissingInfo(props, elementType)
  if (missing.length === 0) return null
  const list = missing.map((category) => t(MISSING_LABEL_KEYS[category])).join(', ')
  return {
    kind: 'missingBadge',
    x: width + MISSING_BADGE_GAP_X,
    y: -(MISSING_BADGE_SIZE + MISSING_BADGE_GAP_Y),
    size: MISSING_BADGE_SIZE,
    count: missing.length,
    titleText: t('missing.title', { list }),
    fill: PALETTE.basisFill,
    stroke: PALETTE.basisBorder
  }
}

/**
 * PURE: does the org renderer own this element? Styling must be on, the element
 * must be a non-label, non-connection `bpmn:*` shape, and it must either be a
 * text annotation (always note-styled), carry at least one org prop, or — when
 * completeness highlighting is on — be a badge-eligible type (activities /
 * gateways / start events), since bare elements are exactly the ones that need
 * a missing-info badge.
 */
export function hasAnyOrgProp(element: OrgElementLike): boolean {
  const props = getOrgProps(element)
  return Object.values(props).some((v) => v !== undefined && v !== '')
}

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
  if (completenessOn && isMissingBadgeEligibleType(type)) return true
  return hasAnyOrgProp(element)
}

// --- DOM applier (tiny-svg) --------------------------------------------------

const FONT_FAMILY = 'inherit'

/** The base `.djs-visual` group bpmn-js drew into, falling back to parentGfx. */
function baseVisual(parentGfx: SVGElement): SVGElement {
  const inner = parentGfx.querySelector?.('.djs-visual')
  return (inner as SVGElement | null) ?? parentGfx
}

/** First fillable primitive of the base shape, for ccStyle / noteStyle recolour. */
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
          // One <g> per badge so the native <title> tooltip covers the whole
          // chip (rect + glyph) on hover.
          const group = svgCreate('g')
          const title = svgCreate('title')
          title.textContent = d.titleText
          svgAppend(group, title)
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

export class OrgRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'bpmnRenderer']

  private readonly bpmnRenderer: BpmnRendererLike

  constructor(eventBus: EventBusLike, bpmnRenderer: BpmnRendererLike) {
    super(eventBus as unknown as ConstructorParameters<typeof BaseRenderer>[0], 1500)
    this.bpmnRenderer = bpmnRenderer
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
      const decorations = planDecorations(props, type, width, element.height ?? 0)
      // Completeness badge composed as a separate step so planDecorations keeps
      // its flag-free signature (and its existing e2e-pinned output) untouched.
      if (isCompletenessOn()) {
        const badge = planMissingBadge(props, type, width)
        if (badge) decorations.push(badge)
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
  orgRenderer: [string, typeof OrgRenderer]
} = {
  __init__: ['orgRenderer'],
  orgRenderer: ['type', OrgRenderer]
}
