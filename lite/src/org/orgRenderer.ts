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
import { getOrgProps, type OrgProps, type OrgElementLike } from './orgModel'
import { isOrgStylingOn } from './orgSettings'

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

  // CC sub-label ("CC: <recipient>") below the shape.
  if (isCc) {
    out.push({
      kind: 'subLabel',
      x: 0,
      y: height + 12,
      text: 'CC: ' + truncate(props.ccTo ?? '', 24),
      fill: PALETTE.ccBorder
    })
  }

  // Owner chip + RACI role letter below the shape.
  if (props.owner) {
    const text = truncate(props.owner, 22)
    const ownerY = height + (isCc ? 24 : 8)
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

  return out
}

/**
 * PURE: does the org renderer own this element? Styling must be on, the element
 * must be a non-label, non-connection `bpmn:*` shape, and it must either be a
 * text annotation (always note-styled) or carry at least one org prop.
 */
export function hasAnyOrgProp(element: OrgElementLike): boolean {
  const props = getOrgProps(element)
  return Object.values(props).some((v) => v !== undefined && v !== '')
}

export function canRenderOrg(element: OrgElementLike | null | undefined, stylingOn: boolean): boolean {
  if (!stylingOn || !element) return false
  if (element.labelTarget || element.waypoints) return false
  const type = element.type
  if (typeof type !== 'string' || !type.startsWith('bpmn:')) return false
  if (type === 'bpmn:TextAnnotation') return true
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
    return canRenderOrg(element, isOrgStylingOn())
  }

  drawShape(parentGfx: SVGElement, element: OrgElementLike): SVGElement {
    const shape = this.bpmnRenderer.drawShape(parentGfx, element)
    try {
      const type = typeof element.type === 'string' ? element.type : ''
      const decorations = planDecorations(
        getOrgProps(element),
        type,
        element.width ?? 0,
        element.height ?? 0
      )
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
