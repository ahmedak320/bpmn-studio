import { describe, it, expect } from 'vitest'
import {
  decorationBoxes,
  detectElementFlowDirection,
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

// --- detectElementFlowDirection ---------------------------------------------

function sequence(waypoints: Array<{ x: number; y: number }>, type = 'bpmn:SequenceFlow') {
  return { type, waypoints }
}

describe('detectElementFlowDirection', () => {
  it.each([
    ['right', [{ x: 0, y: 0 }, { x: 60, y: 0 }]],
    ['down', [{ x: 0, y: 0 }, { x: 0, y: 60 }]],
    ['left', [{ x: 60, y: 0 }, { x: 0, y: 0 }]],
    ['up', [{ x: 0, y: 60 }, { x: 0, y: 0 }]]
  ] as const)('detects %s from an outgoing source stub', (expected, waypoints) => {
    expect(
      detectElementFlowDirection({ outgoing: [sequence([...waypoints])] }, 'horizontal')
    ).toBe(expected)
  })

  it('uses the first non-zero outgoing segment and ignores later bends', () => {
    expect(
      detectElementFlowDirection(
        {
          outgoing: [
            sequence([
              { x: 10, y: 10 },
              { x: 10, y: 10 },
              { x: 50, y: 10 },
              { x: 50, y: 400 }
            ])
          ]
        },
        'vertical'
      )
    ).toBe('right')
  })

  it('uses the last non-zero incoming segment and ignores earlier bends', () => {
    expect(
      detectElementFlowDirection(
        {
          incoming: [
            sequence([
              { x: 10, y: 400 },
              { x: 10, y: 40 },
              { x: 50, y: 40 },
              { x: 50, y: 40 }
            ])
          ]
        },
        'vertical'
      )
    ).toBe('right')
  })

  it('combines incoming and outgoing stubs, including their signs', () => {
    const incoming = sequence([{ x: 100, y: 0 }, { x: 50, y: 0 }])
    const outgoing = sequence([{ x: 50, y: 0 }, { x: 0, y: 0 }])
    expect(
      detectElementFlowDirection({ incoming: [incoming], outgoing: [outgoing] }, 'vertical')
    ).toBe('left')
  })

  it('falls back for isolated elements, cancelling vectors and exact axis ties', () => {
    expect(detectElementFlowDirection({}, 'horizontal')).toBe('right')
    expect(detectElementFlowDirection({}, 'vertical')).toBe('down')
    expect(
      detectElementFlowDirection(
        {
          outgoing: [
            sequence([{ x: 0, y: 0 }, { x: 40, y: 0 }]),
            sequence([{ x: 0, y: 0 }, { x: -40, y: 0 }])
          ]
        },
        'vertical'
      )
    ).toBe('down')
    expect(
      detectElementFlowDirection(
        { outgoing: [sequence([{ x: 0, y: 0 }, { x: 40, y: -40 }])] },
        'horizontal'
      )
    ).toBe('right')
  })

  it('ignores non-sequence, duplicate-only and malformed adjacent connections', () => {
    expect(
      detectElementFlowDirection(
        {
          outgoing: [
            sequence([{ x: 0, y: 0 }, { x: 0, y: 100 }], 'bpmn:Association'),
            sequence([{ x: 5, y: 5 }, { x: 5, y: 5 }]),
            { type: 'bpmn:SequenceFlow', waypoints: [{ x: 0 }, { y: 20 }] }
          ]
        },
        'horizontal'
      )
    ).toBe('right')
  })
})

// --- fixed-geometry pins -----------------------------------------------------

describe('planBadgeBox / planSubChipBox', () => {
  it('badge floats off the top-right corner: { width+2, -20, 16, 16 }', () => {
    expect(planBadgeBox(100)).toEqual({ x: 102, y: -20, w: 16, h: 16 })
    expect(planBadgeBox(36)).toEqual({ x: 38, y: -20, w: 16, h: 16 })
    expect(planBadgeBox(100, { x: 90, y: -25, w: 40, h: 20 })).toEqual({
      x: 102,
      y: -49,
      w: 16,
      h: 16
    })
  })

  it('sub chip is a 34x14 pill centred at the bottom edge, inside the shape', () => {
    expect(planSubChipBox(100, 80)).toEqual({ x: 33, y: 65, w: 34, h: 14 })
    const box = planSubChipBox(350, 200)
    expect(box).toEqual({ x: 158, y: 185, w: 34, h: 14 })
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
  'outputsBox',
  'ccBox',
  'ownerChip',
  'respBox',
  'basisTag',
  'badge',
  'subChip',
  'ccSubLabelBox'
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

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
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
        props: { triggers: 'dmthub — GrievanceIntake' },
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

  it.each([
    ['right', 'top', 'bottom'],
    ['down', 'left', 'right'],
    ['left', 'bottom', 'top'],
    ['up', 'right', 'left']
  ] as const)(
    '%s-flow maps inputs to %s and the output-first after stack to %s',
    (direction, _before, _after) => {
      const layout = computeDecorLayout(
        layoutInput({
          props: {
            inputs: 'Source dossier',
            outputs: 'Approval memo\nAudit trail',
            owner: 'Sara',
            respList: 'Omar',
            ccList: 'Legal',
            decisionBasis: 'Matrix'
          },
          elementType: 'bpmn:BusinessRuleTask',
          direction
        })
      )
      const input = layout.inputsBox!
      const output = layout.outputsBox!
      const owner = layout.ownerChip!
      const resp = layout.respBox!
      const cc = layout.ccBox!
      const basis = layout.basisTag!

      if (direction === 'right') {
        expect(input.y + input.h).toBe(-30)
        expect(output).toMatchObject({ x: 0, y: 92 })
        expect(owner.y).toBe(output.y + output.h + 12)
        expect(resp.y).toBe(owner.y + owner.h + 12)
        expect(cc.y).toBe(resp.y + resp.h + 12)
        expect(basis.y).toBe(cc.y + cc.h + 12)
      } else if (direction === 'left') {
        expect(input).toMatchObject({ x: 0, y: 92 })
        expect(output.y + output.h).toBe(-30)
        expect(owner.y + owner.h).toBe(output.y - 12)
        expect(resp.y + resp.h).toBe(owner.y - 12)
        expect(cc.y + cc.h).toBe(resp.y - 12)
        expect(basis.y + basis.h).toBe(cc.y - 12)
      } else if (direction === 'down') {
        expect(input.x + input.w).toBe(-12)
        expect(output).toMatchObject({ x: 112, y: 0 })
        expect(owner.y).toBe(output.y + output.h + 8)
        expect(resp.y).toBe(owner.y + owner.h + 8)
        expect(cc.y).toBe(resp.y + resp.h + 8)
        expect(basis.y).toBe(cc.y + cc.h + 8)
      } else {
        expect(input).toMatchObject({ x: 112, y: 0 })
        expect(output.x + output.w).toBe(-12)
        expect(owner.x + owner.w).toBe(-12)
        expect(resp.x + resp.w).toBe(-12)
        expect(cc.x + cc.w).toBe(-12)
        expect(basis.x + basis.w).toBe(-12)
        expect(owner.y).toBe(output.y + output.h + 8)
        expect(resp.y).toBe(owner.y + owner.h + 8)
        expect(cc.y).toBe(resp.y + resp.h + 8)
        expect(basis.y).toBe(cc.y + cc.h + 8)
      }

      expect(layout.margins).toEqual(foldExpected(layout, 100, 80))
    }
  )

  it('omitted direction preserves the orientation fallback right/down', () => {
    const props = { inputs: 'Source', outputs: 'Result' }
    const horizontal = computeDecorLayout(layoutInput({ props, orientation: 'horizontal' }))
    const right = computeDecorLayout(
      layoutInput({ props, orientation: 'horizontal', direction: 'right' })
    )
    expect(horizontal).toEqual(right)

    const vertical = computeDecorLayout(layoutInput({ props, orientation: 'vertical' }))
    const down = computeDecorLayout(
      layoutInput({ props, orientation: 'vertical', direction: 'down' })
    )
    expect(vertical).toEqual(down)
  })

  it('input/output boxes have matching row caps and sizing rules', () => {
    const raw = 'One\nTwo\nThree\nFour\nFive\nSix\nSeven'
    const rows = prepareListRows(raw)
    expect(rows).toEqual(['One', 'Two', 'Three', 'Four', 'Five', '+2'])
    const layout = computeDecorLayout(layoutInput({ props: { inputs: raw, outputs: raw } }))
    expect(layout.inputsBox?.h).toBe(listBoxHeight(rows.length))
    expect(layout.outputsBox?.h).toBe(listBoxHeight(rows.length))
    expect(layout.inputsBox?.w).toBe(listBoxWidth(t('canvas.inputs'), rows, false))
    expect(layout.outputsBox?.w).toBe(listBoxWidth(t('org.outputs.label'), rows, false))
  })

  it('outputs render only for activities and contribute exact folded margins', () => {
    const task = computeDecorLayout(layoutInput({ props: { outputs: 'Memo' } }))
    expect(task.outputsBox).toBeDefined()
    expect(task.margins).toEqual(foldExpected(task, 100, 80))
    for (const elementType of ['bpmn:ExclusiveGateway', 'bpmn:StartEvent', 'bpmn:EndEvent']) {
      expect(
        computeDecorLayout(layoutInput({ props: { outputs: 'Memo' }, elementType })).outputsBox
      ).toBeUndefined()
    }
  })

  it('keeps every semantic box, including outputs, disjoint in all four directions', () => {
    const shape: Box = { x: 0, y: 0, w: 100, h: 80 }
    const label: Box = { x: 5, y: 87, w: 90, h: 24 }
    for (const direction of ['right', 'down', 'left', 'up'] as const) {
      const layout = computeDecorLayout(
        layoutInput({
          direction,
          completenessOn: true,
          labelBox: label,
          elementType: 'bpmn:BusinessRuleTask',
          props: {
            channel: 'dmthub',
            inputs: 'Application form\nIdentity record',
            outputs: 'Approval memo\nAudit record',
            owner: 'Process owner',
            respList: 'Case officer\nApprover',
            ccList: 'Legal\nFinance',
            decisionBasis: 'Delegation matrix'
          }
        })
      )
      const boxes = decorationBoxes(layout)
      expect(boxes.some(({ kind }) => kind === 'outputs'), direction).toBe(true)
      for (let i = 0; i < boxes.length; i++) {
        expect(boxesOverlap(boxes[i].box, shape), `${direction} ${boxes[i].kind} vs shape`).toBe(
          false
        )
        expect(boxesOverlap(boxes[i].box, label), `${direction} ${boxes[i].kind} vs label`).toBe(
          false
        )
        for (let j = i + 1; j < boxes.length; j++) {
          expect(
            boxesOverlap(boxes[i].box, boxes[j].box),
            `${direction} ${boxes[i].kind} vs ${boxes[j].kind}`
          ).toBe(false)
        }
      }
      expect(layout.margins).toEqual(foldExpected(layout, 100, 80))
    }
  })

  it('clears a manually moved above-shape label from fixed top decorations', () => {
    const label: Box = { x: -20, y: -28, w: 150, h: 22 }
    const layout = computeDecorLayout(
      layoutInput({
        labelBox: label,
        completenessOn: true,
        props: {
          channel: 'dmthub',
          channelDetail: 'inbox',
          inputs: 'Application form'
        }
      })
    )
    expect(layout.channelTag).toEqual({ x: -10, y: -54, w: 110, h: 18 })
    expect(layout.badge).toEqual({ x: 102, y: -52, w: 16, h: 16 })
    expect(layout.inputsBox!.y + layout.inputsBox!.h).toBe(-62)
    for (const { kind, box } of decorationBoxes(layout)) {
      expect(boxesOverlap(box, label), `${kind} vs moved label`).toBe(false)
    }
  })

  it('sizes tag and owner rectangles to contain every painted text run', () => {
    const trigger = computeDecorLayout(
      layoutInput({
        elementType: 'bpmn:StartEvent',
        width: 36,
        height: 36,
        props: { triggers: 'dmthub — GrievanceIntake' }
      })
    )
    expect(trigger.triggerTag?.w).toBe(12 + 7 * 'DMT HUB: GrievanceIntake'.length)

    const owner = 'abcdefghijklmnopqrstuv'
    const activity = computeDecorLayout(
      layoutInput({
        elementType: 'bpmn:BusinessRuleTask',
        props: { owner, decisionBasis: 'x'.repeat(28) }
      })
    )
    expect(activity.ownerChip?.w).toBe(36 + 7 * owner.length)
    expect(activity.basisTag?.w).toBe(12 + 7 * ('Basis: '.length + 28))
  })

  it('places a legacy CC sub-label below a vertical side stack', () => {
    const layout = computeDecorLayout(
      layoutInput({
        direction: 'down',
        elementType: 'bpmn:BusinessRuleTask',
        props: {
          kind: 'cc',
          ccTo: 'A very long legacy distribution recipient',
          outputs: 'Approval memo',
          owner: 'Process owner',
          respList: 'Case officer',
          decisionBasis: 'Delegation matrix'
        }
      })
    )
    const stackBottom = Math.max(
      ...[layout.outputsBox, layout.ownerChip, layout.respBox, layout.basisTag].map(
        (box) => (box as Box).y + (box as Box).h
      )
    )
    expect(layout.ccSubLabelY).toBe(stackBottom + 12)
    expect(layout.ccSubLabelBox).toEqual({
      x: 0,
      y: stackBottom,
      w: 6 * 'CC: A very long legacy dist…'.length,
      h: 16
    })
    expect(layout.margins.bottom).toBe(stackBottom + 16 - 80)
    expect(decorationBoxes(layout)).toContainEqual({ kind: 'cc', box: layout.ccSubLabelBox })
  })

  it('keeps an up-flow legacy CC label clear of a tall before-side input list', () => {
    const layout = computeDecorLayout(
      layoutInput({
        direction: 'up',
        props: {
          inputs: 'one\ntwo\nthree\nfour\nfive',
          kind: 'cc',
          ccTo: 'abcdefghijklmnopqrstuvwx'
        }
      })
    )
    const inputBottom = layout.inputsBox!.y + layout.inputsBox!.h
    expect(layout.ccSubLabelBox!.y).toBe(inputBottom)
    expect(boxesOverlap(layout.inputsBox as Box, layout.ccSubLabelBox as Box)).toBe(false)
    expect(layout.margins).toEqual(foldExpected(layout, 100, 80))
  })

  it('exports individual external boxes by stable semantic kind', () => {
    const layout = computeDecorLayout(
      layoutInput({
        props: {
          channel: 'dmthub',
          inputs: 'Source',
          outputs: 'Result',
          owner: 'Sara',
          respList: 'Omar',
          ccList: 'Legal',
          decisionBasis: 'Matrix'
        },
        elementType: 'bpmn:BusinessRuleTask'
      })
    )
    const boxes = decorationBoxes(layout)
    expect(boxes.map(({ kind }) => kind)).toEqual([
      'channel',
      'inputs',
      'outputs',
      'cc',
      'owner',
      'responsible',
      'basis'
    ])
    const expected = new Map([
      ['channel', layout.channelTag],
      ['inputs', layout.inputsBox],
      ['outputs', layout.outputsBox],
      ['cc', layout.ccBox],
      ['owner', layout.ownerChip],
      ['responsible', layout.respBox],
      ['basis', layout.basisTag]
    ])
    for (const { kind, box } of boxes) expect(box).toBe(expected.get(kind))
    expect(boxes.some(({ box }) => box === layout.subChip)).toBe(false)
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
        triggers: 'dmthub — GrievanceIntake\nemail —  — backup'
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

            // inputs / outputs / cc / responsible list boxes
            const inputsBox = lists.find((d) => d.fill === PALETTE.inputFill)
            expect(Boolean(inputsBox), label + ' inputsBox presence').toBe(Boolean(layout.inputsBox))
            if (inputsBox && layout.inputsBox) {
              expect(boxOfList(inputsBox), label).toEqual(layout.inputsBox)
              checkedBoxes++
            }
            const outputsBox = lists.find((d) => d.fill === PALETTE.outputFill)
            expect(Boolean(outputsBox), label + ' outputsBox presence').toBe(
              Boolean(layout.outputsBox)
            )
            if (outputsBox && layout.outputsBox) {
              expect(boxOfList(outputsBox), label).toEqual(layout.outputsBox)
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
            const badge = planMissingBadge(props, type, w, labelBox)
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

describe('repeatable trigger layout', () => {
  it('sizes the start-event tag from the first trigger plus the +N suffix', () => {
    const props = { triggers: 'dmthub — ClaimsHub\nemail\nmanual' }
    const layout = computeDecorLayout({
      props,
      elementType: 'bpmn:StartEvent',
      width: 100,
      height: 36,
      orientation: 'horizontal',
      completenessOn: false
    })
    const tag = planDecorations(props, 'bpmn:StartEvent', 100, 36).find(
      (decoration): decoration is Extract<Decoration, { kind: 'tag' }> =>
        decoration.kind === 'tag'
    )
    expect(tag?.label).toBe('DMT HUB +2')
    expect(layout.triggerTag).toEqual({
      x: 0,
      y: -26,
      w: 12 + 7 * 'DMT HUB +2'.length,
      h: 18
    })
    expect(tag && boxOfTag(tag)).toEqual(layout.triggerTag)
  })

  it('treats an empty canonical list as missing', () => {
    expect(planMissingInfo({ triggers: '  \n  ' }, 'bpmn:StartEvent')).toEqual(['trigger'])
  })
})
