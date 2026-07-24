// Single source of truth for ALL org-decoration geometry: which boxes a shape
// grows around itself (channel/trigger tags, inputs/CC/responsible lists,
// owner chip, decision-basis tag, missing-info badge, sub-process chip) and
// exactly where each one sits, per flow orientation, clearing the shape's
// external label when one is present.
//
// This module is deliberately PURE: no DOM, no bpmn-js — only `orgModel` types
// plus `i18n.t` (needed for text-width math on localized list titles / tag
// labels). Two consumers share it:
//   * orgRenderer.planDecorations derives every painted position from
//     computeDecorLayout, so pixels and layout can never drift apart;
//   * the import/auto-layout lane consumes computeDecorLayout /
//     computeDecorMargins / detectOrientation read-only to reserve space.
// The exported API is a FROZEN CONTRACT for the layout lane — extend it, never
// change existing signatures.

import { splitList, type OrgProps } from './orgModel'
import { CHANNEL_TAG_LABELS } from './palette'
import { t } from '../i18n'

// --- shared primitives -------------------------------------------------------

export type FlowOrientation = 'horizontal' | 'vertical'

/** Axis-aligned box in shape-local coords (origin = shape's top-left). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// --- element-type predicates -------------------------------------------------

export const ACTIVITY_TYPES: ReadonlySet<string> = new Set([
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

export function isActivityType(type: string): boolean {
  return ACTIVITY_TYPES.has(type)
}

/** Element types that may carry a rendered `decisionBasis` tag. */
export const DECISION_BASIS_TYPES: ReadonlySet<string> = new Set([
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

/** Container types that can be a collapsed sub-process (the `subChip` slot). */
export const SUB_PROCESS_TYPES: ReadonlySet<string> = new Set([
  'bpmn:SubProcess',
  'bpmn:CallActivity',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess'
])

// --- text helpers ------------------------------------------------------------

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

/** Human-readable channel-tag text for an `orbitpm:channel` value. */
export function channelLabel(channel: string): string {
  return CHANNEL_TAG_LABELS[channel] ?? channel.toUpperCase()
}

/** Human-readable trigger-tag text for an `orbitpm:trigger` value. */
export function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'dmthub':
      return 'DMT HUB'
    case 'email':
      return 'EMAIL'
    default:
      return capitalize(trigger)
  }
}

/** Width of a channel/trigger/basis tag for its label, clamped to `maxWidth`. */
export function tagWidth(label: string, maxWidth: number): number {
  return Math.min(maxWidth, 12 + 7 * label.length)
}

// --- list boxes (all PURE, unit-tested) --------------------------------------

/** Row caps shared by every list box. */
export const LIST_MAX_ROWS = 5
export const LIST_ROW_CHARS = 20
/** Horizontal gap between the shape edge and a side list box. */
export const LIST_GAP_X = 12
/** Vertical gap between stacked below-shape blocks. */
const STACK_GAP = 12
/** Vertical gap between stacked side blocks (vertical orientation). */
const SIDE_STACK_GAP = 8
/** A horizontal-orientation inputs box ends this far ABOVE the shape top —
 *  clearing the channel tag (-22..-4), trigger tag (-26..-8) and the
 *  missing-info badge (-20..-4) by >= 4px. */
const TOP_STACK_BASE = 30
/** Clearance kept between an external label's far edge and any pushed block. */
const LABEL_CLEAR_GAP = 8
/** Owner chip height (unchanged from the original renderer). */
export const OWNER_CHIP_H = 20
/** Channel / trigger / decision-basis tag height. */
export const TAG_H = 18
const BASIS_TAG_H = TAG_H
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

// --- below-shape stacking ----------------------------------------------------

export interface BelowStackInput {
  /** The y the stack grows downward FROM — the shape height, or, when an
   *  external label sits below the shape, the label's cleared bottom edge. */
  height: number
  /** Legacy "CC: …" sub-label present (kind==='cc' AND no ccList). */
  ccSubLabel: boolean
  /** Owner chip (+ RACI letter) present. */
  owner: boolean
  /** Prepared responsible-list row count (0 = no list box). */
  respRows: number
  /** Prepared CC-list row count (0 = no box). Horizontal orientation stacks
   *  the CC list below the shape; omitted/0 keeps the legacy 4-block stack. */
  ccRows?: number
  /** Decision-basis tag present. */
  basis: boolean
}

export interface BelowStackLayout {
  /** Text BASELINE y of the legacy CC sub-label. */
  ccSubLabelY?: number
  /** Top y of the owner chip. */
  ownerY?: number
  /** Top y of the responsible list box. */
  respY?: number
  /** Top y of the CC list box (horizontal orientation only). */
  ccY?: number
  /** Top y of the decision-basis tag. */
  basisY?: number
  /** First free y below the whole stack. */
  bottom: number
}

/**
 * PURE: below-shape stacking. Blocks stack strictly in this order — legacy CC
 * sub-label, owner chip, responsible list, CC list, decision-basis tag — each
 * one advancing a cursor past its own height plus a fixed gap, so no
 * combination can ever overlap.
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
  if ((input.ccRows ?? 0) > 0) {
    out.ccY = cursor + STACK_GAP
    cursor = out.ccY + listBoxHeight(input.ccRows!)
  }
  if (input.basis) {
    out.basisY = cursor + STACK_GAP
    cursor = out.basisY + BASIS_TAG_H
  }
  out.bottom = cursor
  return out
}

// --- completeness (which key info is missing) --------------------------------

/** One category of key process information a shape can be missing. The names
 *  map 1:1 onto the `missing.*` i18n keys. */
export type MissingCategory = 'owner' | 'inputs' | 'outputs' | 'basis' | 'trigger'

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

/** Badge geometry, shared by planMissingBadge and computeDecorLayout: a 16x16
 *  chip floating diagonally OFF the shape's top-right corner —
 *  { x: width+2, y: -20, w: 16, h: 16 } — both orientations. */
export function planBadgeBox(width: number): Box {
  return {
    x: width + MISSING_BADGE_GAP_X,
    y: -(MISSING_BADGE_SIZE + MISSING_BADGE_GAP_Y),
    w: MISSING_BADGE_SIZE,
    h: MISSING_BADGE_SIZE
  }
}

/** Sub-process chip geometry: a 34x14 pill centred at the shape's bottom edge,
 *  INSIDE the shape (where the stock '+' marker used to sit) — contributes
 *  nothing to margins. { x: width/2-17, y: height-19, w: 34, h: 14 }. */
export function planSubChipBox(width: number, height: number): Box {
  return { x: width / 2 - 17, y: height - 19, w: 34, h: 14 }
}

// --- orientation detection ---------------------------------------------------

interface WaypointLike {
  x?: unknown
  y?: unknown
}

/** Majority axis of summed |Δx| / |Δy| over sequence-flow first→last waypoints.
 *  Ties and empty diagrams -> 'horizontal'. Non-SequenceFlow types ignored;
 *  connections with fewer than 2 (or malformed) waypoints ignored. */
export function detectOrientation(
  connections: ReadonlyArray<{ type?: string; waypoints?: unknown }>
): FlowOrientation {
  let dx = 0
  let dy = 0
  for (const conn of connections) {
    if (conn.type !== 'bpmn:SequenceFlow') continue
    const waypoints = conn.waypoints
    if (!Array.isArray(waypoints) || waypoints.length < 2) continue
    const first = waypoints[0] as WaypointLike | undefined
    const last = waypoints[waypoints.length - 1] as WaypointLike | undefined
    if (
      typeof first?.x !== 'number' ||
      typeof first?.y !== 'number' ||
      typeof last?.x !== 'number' ||
      typeof last?.y !== 'number'
    ) {
      continue
    }
    dx += Math.abs(last.x - first.x)
    dy += Math.abs(last.y - first.y)
  }
  return dy > dx ? 'vertical' : 'horizontal'
}

// --- the layout --------------------------------------------------------------

export interface DecorLayoutInput {
  props: OrgProps
  elementType: string
  width: number
  height: number
  orientation: FlowOrientation
  /** Include the missing-info badge box when info is missing. */
  completenessOn: boolean
  /** External label bounds RELATIVE to the shape's top-left, if any. */
  labelBox?: Box | null
}

export interface DecorLayout {
  channelTag?: Box
  triggerTag?: Box
  inputsBox?: Box
  ccBox?: Box
  ownerChip?: Box // RACI chip is contained within it
  respBox?: Box
  basisTag?: Box
  badge?: Box
  subChip?: Box // reserved slot; painted only for collapsed sub-processes
  ccSubLabelY?: number // legacy baseline (kind==='cc' with no ccList)
  /** Space consumed beyond the shape bbox, >= 0 per side — what auto-layout
   *  must reserve. EXCLUDES the external label itself (a real model element
   *  the import lane already owns), but block POSITIONS account for it. */
  margins: { left: number; right: number; top: number; bottom: number }
}

const LAYOUT_BOX_KEYS = [
  'channelTag',
  'triggerTag',
  'inputsBox',
  'ccBox',
  'ownerChip',
  'respBox',
  'basisTag',
  'badge',
  'subChip'
] as const

function foldMargins(layout: DecorLayout, width: number, height: number): DecorLayout['margins'] {
  const margins = { left: 0, right: 0, top: 0, bottom: 0 }
  for (const key of LAYOUT_BOX_KEYS) {
    const box = layout[key]
    if (!box) continue
    margins.left = Math.max(margins.left, -box.x)
    margins.right = Math.max(margins.right, box.x + box.w - width)
    margins.top = Math.max(margins.top, -box.y)
    margins.bottom = Math.max(margins.bottom, box.y + box.h - height)
  }
  return margins
}

/**
 * PURE: the full decoration layout for one element. Every Box is in
 * shape-local coords. Rules:
 *
 * HORIZONTAL (default):
 *   - channel tag above at y=-22 (activities), trigger tag at y=-26 (start
 *     events) — mutually exclusive by type;
 *   - inputs list ABOVE the shape, left-aligned, bottom edge at y=-30;
 *   - one overlap-free below stack (all x=0): legacy CC sub-label, owner chip,
 *     responsible list, CC list, decision-basis tag, STACK_GAP=12 apart. The
 *     stack base clears the external label when `labelBox` reaches lower than
 *     the shape itself.
 * VERTICAL:
 *   - inputs list to the LEFT (x = -(w+12));
 *   - a right-side stack at x = width+12 (pushed further right when the label
 *     protrudes past the right edge), growing down from y=0 with
 *     SIDE_STACK_GAP=8: owner chip, responsible list, CC list, basis tag;
 *   - the legacy CC sub-label stays below (label-cleared base).
 * BOTH:
 *   - badge at planBadgeBox(width) when `completenessOn` and info is missing;
 *   - subChip reserved at planSubChipBox for sub-process-capable types
 *     (inside the shape; zero margin contribution).
 */
export function computeDecorLayout(input: DecorLayoutInput): DecorLayout {
  const { props, elementType, width, height, orientation, completenessOn } = input
  const labelBox = input.labelBox ?? null
  const out: DecorLayout = { margins: { left: 0, right: 0, top: 0, bottom: 0 } }

  // Text annotations are only ever "note"-styled; no boxes, no margins.
  if (elementType === 'bpmn:TextAnnotation') return out

  const isActivity = isActivityType(elementType)

  // Channel tag (activities only).
  if (props.channel && isActivity) {
    const label = channelLabel(props.channel)
    out.channelTag = { x: 0, y: -22, w: tagWidth(label, width), h: TAG_H }
  }

  // Start-event trigger tag.
  if (props.trigger && elementType === 'bpmn:StartEvent') {
    const label = triggerLabel(props.trigger)
    out.triggerTag = { x: 0, y: -26, w: tagWidth(label, Math.max(width, 60)), h: TAG_H }
  }

  // Inputs list (activities only): above in horizontal, left in vertical.
  const inputRows = isActivity ? prepareListRows(props.inputs) : []
  if (inputRows.length > 0) {
    const w = listBoxWidth(t('canvas.inputs'), inputRows, false)
    const h = listBoxHeight(inputRows.length)
    out.inputsBox =
      orientation === 'vertical'
        ? { x: -(w + LIST_GAP_X), y: 0, w, h }
        : { x: 0, y: -(TOP_STACK_BASE + h), w, h }
  }

  const ccRows = prepareListRows(props.ccList)
  const respRows = prepareListRows(props.respList)
  const hasOwner = Boolean(props.owner)
  const hasBasis = Boolean(props.decisionBasis) && isDecisionBasisType(elementType)
  const ccSubLabel = props.kind === 'cc' && ccRows.length === 0

  // Block sizes (shared by both orientations).
  const ownerW = Math.min(160, 24 + 7 * truncate(props.owner ?? '', 22).length)
  const ccW = listBoxWidth(t('canvas.cc'), ccRows, false)
  const ccH = listBoxHeight(ccRows.length)
  const respW = listBoxWidth(t('canvas.responsible'), respRows, true)
  const respH = listBoxHeight(respRows.length)
  const basisW = tagWidth(t('canvas.basis') + ': ' + truncate(props.decisionBasis ?? '', 28), 220)

  // Below-shape base: clear the external label when it reaches lower than the
  // shape itself (default bpmn-js labels sit at shape bottom + 7).
  const base = labelBox ? Math.max(height, labelBox.y + labelBox.h) : height

  if (orientation === 'vertical') {
    // Legacy CC sub-label keeps its below-shape spot (rare legacy path).
    if (ccSubLabel) out.ccSubLabelY = base + 12

    // Right-side stack. Push past a label protruding beyond the right edge
    // (90px-minimum external labels under 36/50px events and gateways).
    let sideX = width + LIST_GAP_X
    if (labelBox && labelBox.x + labelBox.w > width) {
      sideX = Math.max(sideX, labelBox.x + labelBox.w + LABEL_CLEAR_GAP)
    }
    let cursor = 0
    let first = true
    const place = (w: number, h: number): Box => {
      const y = first ? cursor : cursor + SIDE_STACK_GAP
      first = false
      cursor = y + h
      return { x: sideX, y, w, h }
    }
    if (hasOwner) out.ownerChip = place(ownerW, OWNER_CHIP_H)
    if (respRows.length > 0) out.respBox = place(respW, respH)
    if (ccRows.length > 0) out.ccBox = place(ccW, ccH)
    if (hasBasis) out.basisTag = place(basisW, BASIS_TAG_H)
  } else {
    const stack = stackBelow({
      height: base,
      ccSubLabel,
      owner: hasOwner,
      respRows: respRows.length,
      ccRows: ccRows.length,
      basis: hasBasis
    })
    if (stack.ccSubLabelY !== undefined) out.ccSubLabelY = stack.ccSubLabelY
    if (stack.ownerY !== undefined) out.ownerChip = { x: 0, y: stack.ownerY, w: ownerW, h: OWNER_CHIP_H }
    if (stack.respY !== undefined) out.respBox = { x: 0, y: stack.respY, w: respW, h: respH }
    if (stack.ccY !== undefined) out.ccBox = { x: 0, y: stack.ccY, w: ccW, h: ccH }
    if (stack.basisY !== undefined) out.basisTag = { x: 0, y: stack.basisY, w: basisW, h: BASIS_TAG_H }
  }

  // Missing-info badge slot (top-right, both orientations).
  if (completenessOn && planMissingInfo(props, elementType).length > 0) {
    out.badge = planBadgeBox(width)
  }

  // Sub-process chip slot, reserved for every sub-process-capable type; the
  // renderer paints it only when the element is actually collapsed.
  if (SUB_PROCESS_TYPES.has(elementType)) {
    out.subChip = planSubChipBox(width, height)
  }

  out.margins = foldMargins(out, width, height)
  return out
}

/** Convenience for the auto-layout lane: just the reserved margins. */
export function computeDecorMargins(input: DecorLayoutInput): DecorLayout['margins'] {
  return computeDecorLayout(input).margins
}
