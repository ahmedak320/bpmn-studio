import { describe, it, expect } from 'vitest'
import {
  detectOrientation,
  planBadgeBox,
  planSubChipBox,
  computeDecorLayout,
  computeDecorMargins,
  listBoxWidth,
  listBoxHeight,
  prepareListRows,
  planMissingInfo,
  type Box,
  type DecorLayout,
  type DecorLayoutInput,
  type FlowOrientation
} from '../decorExtents'
import { planDecorations, planMissingBadge, type Decoration } from '../orgRenderer'
import { PALETTE } from '../palette'
import { t } from '../../i18n'
import type { OrgProps } from '../orgModel'

// --- detectOrientation -------------------------------------------------------

function flow(x1: number, y1: number, x2: number, y2: number, type = 'bpmn:SequenceFlow') {
  return { type, waypoints: [{ x: x1, y: y1 }, { x: x2, y: y2 }] }
}

describe('detectOrientation', () => {
  it('empty input -> horizontal', () => {
    expect(detectOrientation([])).toBe('horizontal')
  })

  it('all-vertical flows -> vertical', () => {
    expect(detectOrientation([flow(0, 0, 0, 100), flow(10, 100, 10, 260)])).toBe('vertical')
  })

  it('all-horizontal flows -> horizontal', () => {
    expect(detectOrientation([flow(0, 0, 100, 0), flow(100, 5, 260, 5)])).toBe('horizontal')
  })

  it('mixed flows follow the majority axis of summed |dx| vs |dy|', () => {
    // dx = 150, dy = 300 -> vertical
    expect(detectOrientation([flow(0, 0, 150, 0), flow(0, 0, 0, 300)])).toBe('vertical')
    // dx = 300, dy = 100 -> horizontal
    expect(detectOrientation([flow(0, 0, 300, 0), flow(0, 0, 0, 100)])).toBe('horizontal')
  })

  it('uses first->last waypoints only (intermediate bendpoints ignored)', () => {
    // Path detours vertically but starts and ends on the same y: horizontal.
    const bendy = {
      type: 'bpmn:SequenceFlow',
      waypoints: [
        { x: 0, y: 0 },
        { x: 0, y: 500 },
        { x: 200, y: 500 },
        { x: 200, y: 0 }
      ]
    }
    expect(detectOrientation([bendy])).toBe('horizontal')
  })

  it('an exact tie -> horizontal', () => {
    expect(detectOrientation([flow(0, 0, 100, 100)])).toBe('horizontal')
    expect(detectOrientation([flow(0, 0, 100, 0), flow(0, 0, 0, 100)])).toBe('horizontal')
  })

  it('ignores non-SequenceFlow connections entirely', () => {
    expect(
      detectOrientation([
        { type: 'bpmn:Association', waypoints: [{ x: 0, y: 0 }, { x: 0, y: 900 }] },
        { type: 'bpmn:MessageFlow', waypoints: [{ x: 0, y: 0 }, { x: 0, y: 900 }] },
        flow(0, 0, 50, 0)
      ])
    ).toBe('horizontal')
  })

  it('ignores flows with <2 waypoints, missing waypoints, shapes and malformed points', () => {
    expect(
      detectOrientation([
        { type: 'bpmn:SequenceFlow', waypoints: [{ x: 0, y: 0 }] },
        { type: 'bpmn:SequenceFlow' },
        { type: 'bpmn:SequenceFlow', waypoints: 'nope' },
        { type: 'bpmn:SequenceFlow', waypoints: [{ x: 0 }, { y: 100 }] },
        { type: 'bpmn:Task' },
        flow(0, 0, 0, 80)
      ])
    ).toBe('vertical')
  })
})

// --- fixed-geometry pins -----------------------------------------------------

describe('planBadgeBox / planSubChipBox', () => {
  it('badge floats off the top-right corner: { width+2, -20, 16, 16 }', () => {
    expect(planBadgeBox(100)).toEqual({ x: 102, y: -20, w: 16, h: 16 })
    expect(planBadgeBox(36)).toEqual({ x: 38, y: -20, w: 16, h: 16 })
  })

  it('sub chip is a 34x14 pill centred at the bottom edge, inside the shape', () => {
    expect(planSubChipBox(100, 80)).toEqual({ x: 33, y: 61, w: 34, h: 14 })
    const box = planSubChipBox(350, 200)
    expect(box).toEqual({ x: 158, y: 181, w: 34, h: 14 })
    // fully inside the 350x200 shape
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(350)
    expect(box.y + box.h).toBeLessThanOrEqual(200)
  })
})

// --- layout + margins --------------------------------------------------------

const BOX_KEYS = [
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

function presentBoxes(layout: DecorLayout): Box[] {
  const out: Box[] = []
  for (const key of BOX_KEYS) {
    const box = layout[key]
    if (box) out.push(box)
  }
  return out
}

function foldExpected(layout: DecorLayout, width: number, height: number) {
  const margins = { left: 0, right: 0, top: 0, bottom: 0 }
  for (const box of presentBoxes(layout)) {
    margins.left = Math.max(margins.left, -box.x)
    margins.right = Math.max(margins.right, box.x + box.w - width)
    margins.top = Math.max(margins.top, -box.y)
    margins.bottom = Math.max(margins.bottom, box.y + box.h - height)
  }
  return margins
}

function layoutInput(overrides: Partial<DecorLayoutInput> & { props: OrgProps }): DecorLayoutInput {
  return {
    elementType: 'bpmn:Task',
    width: 100,
    height: 80,
    orientation: 'horizontal',
    completenessOn: false,
    labelBox: null,
    ...overrides
  }
}

describe('computeDecorLayout margins', () => {
  it('empty props on a plain task -> no boxes, all-zero margins', () => {
    const layout = computeDecorLayout(layoutInput({ props: {} }))
    expect(presentBoxes(layout)).toHaveLength(0)
    expect(layout.margins).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
  })

  it('margins are exactly the fold of every present box (>= 0 per side)', () => {
    const cases: DecorLayoutInput[] = [
      layoutInput({
        props: {
          channel: 'dmthub',
          channelDetail: 'inbox',
          inputs: 'Form A\nCustomer file',
          owner: 'Ahmed Alkatheeri',
          ownerRole: 'A',
          respList: 'Sara\nOmar\nZayed',
          ccList: 'Legal\nFinance',
          decisionBasis: 'Delegation matrix'
        },
        elementType: 'bpmn:BusinessRuleTask',
        completenessOn: true
      }),
      layoutInput({
        props: { inputs: 'A\nB\nC', owner: 'Sara', ccList: 'Legal' },
        orientation: 'vertical',
        completenessOn: true
      }),
      layoutInput({
        props: { trigger: 'dmthub', triggerService: 'GrievanceIntake' },
        elementType: 'bpmn:StartEvent',
        width: 36,
        height: 36
      }),
      layoutInput({
        props: { owner: 'Sara' },
        labelBox: { x: 5, y: 87, w: 90, h: 20 }
      }),
      layoutInput({
        props: { owner: 'Sara', ccList: 'Legal\nFinance' },
        orientation: 'vertical',
        labelBox: { x: -27, y: 43, w: 90, h: 20 },
        elementType: 'bpmn:SubProcess',
        completenessOn: true
      })
    ]
    for (const input of cases) {
      const layout = computeDecorLayout(input)
      expect(layout.margins).toEqual(foldExpected(layout, input.width, input.height))
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        expect(layout.margins[side]).toBeGreaterThanOrEqual(0)
      }
      expect(computeDecorMargins(input)).toEqual(layout.margins)
    }
  })

  it('horizontal: inputs sit ABOVE (bottom edge at -30) and drive the top margin', () => {
    const rows = prepareListRows('Form A\nCustomer file')
    const layout = computeDecorLayout(layoutInput({ props: { inputs: 'Form A\nCustomer file' } }))
    const w = listBoxWidth(t('canvas.inputs'), rows, false)
    const h = listBoxHeight(rows.length)
    expect(layout.inputsBox).toEqual({ x: 0, y: -(30 + h), w, h })
    expect(layout.margins.top).toBe(30 + h)
    expect(layout.margins.left).toBe(0)
  })

  it('vertical: inputs sit LEFT and drive the left margin', () => {
    const rows = prepareListRows('Form A')
    const layout = computeDecorLayout(
      layoutInput({ props: { inputs: 'Form A' }, orientation: 'vertical' })
    )
    const w = listBoxWidth(t('canvas.inputs'), rows, false)
    expect(layout.inputsBox).toEqual({ x: -(w + 12), y: 0, w, h: listBoxHeight(1) })
    expect(layout.margins.left).toBe(w + 12)
    expect(layout.margins.top).toBe(0)
  })

  it('badge box appears only when completeness is on AND info is missing', () => {
    const bare = layoutInput({ props: {} })
    expect(computeDecorLayout(bare).badge).toBeUndefined()
    expect(computeDecorLayout({ ...bare, completenessOn: true }).badge).toEqual(planBadgeBox(100))
    const complete = layoutInput({
      props: { owner: 'A', inputs: 'x', outputs: 'y' },
      completenessOn: true
    })
    expect(computeDecorLayout(complete).badge).toBeUndefined()
    expect(computeDecorLayout({ ...bare, completenessOn: true }).margins.right).toBe(18)
  })

  it('margins EXCLUDE the label itself but positions clear it (below stack)', () => {
    const noLabel = computeDecorLayout(layoutInput({ props: { owner: 'Sara' } }))
    expect(noLabel.ownerChip?.y).toBe(92) // height + 12
    const labelled = computeDecorLayout(
      layoutInput({ props: { owner: 'Sara' }, labelBox: { x: 5, y: 87, w: 90, h: 20 } })
    )
    // base = labelBox bottom (107) -> chip at 119
    expect(labelled.ownerChip?.y).toBe(119)
    // bottom margin measures the chip, not the label: 119 + 20 - 80
    expect(labelled.margins.bottom).toBe(59)
  })

  it('vertical: a label protruding past the right edge pushes the side stack', () => {
    const plain = computeDecorLayout(
      layoutInput({
        props: { owner: 'Sara' },
        orientation: 'vertical',
        width: 36,
        height: 36,
        elementType: 'bpmn:StartEvent'
      })
    )
    expect(plain.ownerChip?.x).toBe(48) // width + 12
    const labelled = computeDecorLayout(
      layoutInput({
        props: { owner: 'Sara' },
        orientation: 'vertical',
        width: 36,
        height: 36,
        elementType: 'bpmn:StartEvent',
        labelBox: { x: -27, y: 43, w: 90, h: 20 }
      })
    )
    // label right edge 63 > width -> sideX = 63 + 8
    expect(labelled.ownerChip?.x).toBe(71)
    expect(labelled.ownerChip?.y).toBe(0)
  })

  it('vertical side stack keeps order owner, resp, cc, basis with 8px gaps from y=0', () => {
    const layout = computeDecorLayout(
      layoutInput({
        props: {
          owner: 'Sara',
          respList: 'Omar\nZayed',
          ccList: 'Legal',
          decisionBasis: 'Matrix'
        },
        elementType: 'bpmn:BusinessRuleTask',
        orientation: 'vertical'
      })
    )
    const owner = layout.ownerChip!
    const resp = layout.respBox!
    const cc = layout.ccBox!
    const basis = layout.basisTag!
    expect(owner.y).toBe(0)
    expect(resp.y).toBe(owner.y + owner.h + 8)
    expect(cc.y).toBe(resp.y + resp.h + 8)
    expect(basis.y).toBe(cc.y + cc.h + 8)
    for (const box of [owner, resp, cc, basis]) expect(box.x).toBe(112)
  })

  it('reserves the subChip slot exactly for sub-process-capable types', () => {
    for (const type of ['bpmn:SubProcess', 'bpmn:CallActivity', 'bpmn:Transaction', 'bpmn:AdHocSubProcess']) {
      const layout = computeDecorLayout(layoutInput({ props: {}, elementType: type }))
      expect(layout.subChip, type).toEqual(planSubChipBox(100, 80))
      // inside the shape -> zero margin contribution
      expect(layout.margins).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
    }
    for (const type of ['bpmn:Task', 'bpmn:StartEvent', 'bpmn:ExclusiveGateway']) {
      expect(computeDecorLayout(layoutInput({ props: {}, elementType: type })).subChip).toBeUndefined()
    }
  })

  it('TextAnnotation gets an empty layout (note styling only, no boxes)', () => {
    const layout = computeDecorLayout(
      layoutInput({
        props: { owner: 'Sara', ccList: 'Legal' },
        elementType: 'bpmn:TextAnnotation',
        width: 140,
        height: 60,
        completenessOn: true
      })
    )
    expect(presentBoxes(layout)).toHaveLength(0)
    expect(layout.margins).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
  })
})

// --- parity: planDecorations paints exactly on computeDecorLayout's boxes ----

type TagDecoration = Extract<Decoration, { kind: 'tag' }>
type ListDecoration = Extract<Decoration, { kind: 'listBox' }>

function boxOfTag(d: TagDecoration): Box {
  return { x: d.x, y: d.y, w: d.w, h: d.h }
}
function boxOfList(d: ListDecoration): Box {
  return { x: d.x, y: d.y, w: d.w, h: d.h }
}

describe('planDecorations <-> computeDecorLayout parity', () => {
  const PROP_SETS: Array<{ name: string; props: OrgProps }> = [
    { name: 'empty', props: {} },
    { name: 'owner only', props: { owner: 'Sara' } },
    { name: 'legacy cc', props: { kind: 'cc', ccTo: 'Legal' } },
    {
      name: 'everything',
      props: {
        channel: 'dmthub',
        channelDetail: 'inbox',
        kind: 'cc',
        ccTo: 'Legal',
        ccList: 'Legal\nFinance',
        owner: 'Ahmed Alkatheeri',
        ownerRole: 'A',
        respList: 'Sara — Approver\nOmar\nZayed',
        inputs: 'Form A\nCustomer file',
        outputs: 'Approval memo',
        decisionBasis: 'Delegation matrix §3',
        trigger: 'dmthub',
        triggerService: 'GrievanceIntake'
      }
    }
  ]
  const CASES: Array<{ type: string; w: number; h: number }> = [
    { type: 'bpmn:Task', w: 100, h: 80 },
    { type: 'bpmn:BusinessRuleTask', w: 100, h: 80 },
    { type: 'bpmn:ExclusiveGateway', w: 50, h: 50 },
    { type: 'bpmn:StartEvent', w: 36, h: 36 },
    { type: 'bpmn:SubProcess', w: 350, h: 200 }
  ]
  const ORIENTATIONS: FlowOrientation[] = ['horizontal', 'vertical']

  it('every emitted decoration sits exactly on its layout box (full grid)', () => {
    let checkedBoxes = 0
    for (const { type, w, h } of CASES) {
      const labelBoxes: Array<Box | null> = [
        null,
        { x: (w - 90) / 2, y: h + 7, w: 90, h: 20 },
        { x: (w - 90) / 2, y: h + 7, w: 90, h: 34 }
      ]
      for (const orientation of ORIENTATIONS) {
        for (const labelBox of labelBoxes) {
          for (const { name, props } of PROP_SETS) {
            const label = `${type} ${orientation} ${name} label=${labelBox ? labelBox.h : 'none'}`
            const layout = computeDecorLayout({
              props,
              elementType: type,
              width: w,
              height: h,
              orientation,
              completenessOn: false,
              labelBox
            })
            const decorations = planDecorations(props, type, w, h, { orientation, labelBox })

            const tags = decorations.filter((d): d is TagDecoration => d.kind === 'tag')
            const lists = decorations.filter((d): d is ListDecoration => d.kind === 'listBox')

            // channel tag (activities; identified by the dmthub palette pair)
            const channelTag = tags.find((d) => d.fill === PALETTE.tagDmthubFill && type !== 'bpmn:StartEvent')
            expect(Boolean(channelTag), label + ' channelTag presence').toBe(Boolean(layout.channelTag))
            if (channelTag && layout.channelTag) {
              expect(boxOfTag(channelTag), label).toEqual(layout.channelTag)
              checkedBoxes++
            }

            // trigger tag (start events only)
            const triggerTag = type === 'bpmn:StartEvent' ? tags.find((d) => d.fill === PALETTE.tagDmthubFill) : undefined
            expect(Boolean(triggerTag), label + ' triggerTag presence').toBe(Boolean(layout.triggerTag))
            if (triggerTag && layout.triggerTag) {
              expect(boxOfTag(triggerTag), label).toEqual(layout.triggerTag)
              checkedBoxes++
            }

            // basis tag
            const basisTag = tags.find((d) => d.fill === PALETTE.basisFill)
            expect(Boolean(basisTag), label + ' basisTag presence').toBe(Boolean(layout.basisTag))
            if (basisTag && layout.basisTag) {
              expect(boxOfTag(basisTag), label).toEqual(layout.basisTag)
              checkedBoxes++
            }

            // inputs / cc / responsible list boxes
            const inputsBox = lists.find((d) => d.fill === PALETTE.inputFill)
            expect(Boolean(inputsBox), label + ' inputsBox presence').toBe(Boolean(layout.inputsBox))
            if (inputsBox && layout.inputsBox) {
              expect(boxOfList(inputsBox), label).toEqual(layout.inputsBox)
              checkedBoxes++
            }
            const ccBox = lists.find((d) => d.fill === PALETTE.ccFill)
            expect(Boolean(ccBox), label + ' ccBox presence').toBe(Boolean(layout.ccBox))
            if (ccBox && layout.ccBox) {
              expect(boxOfList(ccBox), label).toEqual(layout.ccBox)
              checkedBoxes++
            }
            const respBox = lists.find((d) => d.personGlyph)
            expect(Boolean(respBox), label + ' respBox presence').toBe(Boolean(layout.respBox))
            if (respBox && layout.respBox) {
              expect(boxOfList(respBox), label).toEqual(layout.respBox)
              checkedBoxes++
            }

            // owner chip + contained RACI
            const ownerBox = decorations.find((d) => d.kind === 'ownerBox')
            expect(Boolean(ownerBox), label + ' ownerChip presence').toBe(Boolean(layout.ownerChip))
            if (ownerBox && ownerBox.kind === 'ownerBox' && layout.ownerChip) {
              expect({ x: ownerBox.x, y: ownerBox.y, w: ownerBox.w, h: ownerBox.h }, label).toEqual(
                layout.ownerChip
              )
              const raci = decorations.find((d) => d.kind === 'raci')
              expect(raci && raci.kind === 'raci' && raci.x, label).toBe(layout.ownerChip.x)
              expect(raci && raci.kind === 'raci' && raci.y, label).toBe(layout.ownerChip.y + 3)
              checkedBoxes++
            }

            // legacy CC sub-label baseline
            const subLabel = decorations.find((d) => d.kind === 'subLabel')
            expect(Boolean(subLabel), label + ' ccSubLabel presence').toBe(
              layout.ccSubLabelY !== undefined && type !== 'bpmn:TextAnnotation'
            )
            if (subLabel && subLabel.kind === 'subLabel' && layout.ccSubLabelY !== undefined) {
              expect(subLabel.y, label).toBe(layout.ccSubLabelY)
            }

            // badge parity (separate composition step, same geometry source)
            const badge = planMissingBadge(props, type, w)
            const badgeBox = computeDecorLayout({
              props,
              elementType: type,
              width: w,
              height: h,
              orientation,
              completenessOn: true,
              labelBox
            }).badge
            expect(Boolean(badge), label + ' badge presence').toBe(Boolean(badgeBox))
            if (badge && badge.kind === 'missingBadge' && badgeBox) {
              expect({ x: badge.x, y: badge.y, w: badge.size, h: badge.size }, label).toEqual(badgeBox)
              expect(badge.missing).toEqual(planMissingInfo(props, type))
              checkedBoxes++
            }
          }
        }
      }
    }
    // the grid must have exercised a healthy number of positioned boxes
    expect(checkedBoxes).toBeGreaterThan(200)
  })
})
