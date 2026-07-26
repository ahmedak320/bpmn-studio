import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  applyDecorations,
  planDecorations,
  planMissingBadge,
  canRenderOrg,
  prepareListRows,
  listBoxHeight,
  listBoxWidth,
  stackBelow,
  isDecisionBasisType,
  relativeLabelBox,
  removeStockSubProcessMarker,
  gatewayPresentationForElement,
  diagramLanguageForElement,
  OrgRenderer,
  OrgRenderModule,
  type Decoration,
  type MarkerDomLike
} from '../orgRenderer'
import { OrgDecorSync } from '../orgDecorSync'
import { OrgConnectionRenderer } from '../orgConnectionRenderer'
import { orbitpmModdleDescriptor, ORG_ATTR_NAMES } from '../orbitpmModdle'
import { PALETTE } from '../palette'
import { t, setLang } from '../../i18n'
import { SEMANTIC_NAMING } from '../semanticNaming'
import type { OrgElementLike } from '../orgModel'

function byKind(decorations: Decoration[], kind: Decoration['kind']): Decoration[] {
  return decorations.filter((d) => d.kind === kind)
}

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  })
  return store
}

// --- moddle descriptor sanity ----------------------------------------------

describe('orbitpmModdleDescriptor', () => {
  it('declares the orbitpm namespace and prefix', () => {
    expect(orbitpmModdleDescriptor.uri).toBe('http://orbitpm.ae/schema/bpmn/1.0')
    expect(orbitpmModdleDescriptor.prefix).toBe('orbitpm')
    expect(orbitpmModdleDescriptor.xml).toEqual({ tagAlias: 'lowerCase' })
  })

  it('extends bpmn:BaseElement with every contract attribute (isAttr String)', () => {
    const type = orbitpmModdleDescriptor.types[0]
    expect(type.name).toBe('OrgExtension')
    expect(type.extends).toEqual(['bpmn:BaseElement'])
    const names = type.properties.map((p) => p.name)
    for (const attr of ORG_ATTR_NAMES) {
      expect(names).toContain(attr)
    }
    for (const prop of type.properties) {
      expect(prop.isAttr).toBe(true)
      expect(prop.type).toBe('String')
    }
    // Exactly the contract attributes, no extras.
    expect(type.properties).toHaveLength(ORG_ATTR_NAMES.length)
  })

  it('declares every wave-G and repeatable-trigger attribute', () => {
    for (const attr of [
      'triggers',
      'nameEn',
      'nameAr',
      'activeLang',
      'inputs',
      'outputs',
      'system',
      'respList',
      'ccList',
      'decisionBasis'
    ]) {
      expect(ORG_ATTR_NAMES).toContain(attr)
    }
  })
})

// --- planDecorations --------------------------------------------------------

describe('planDecorations', () => {
  it('returns [] when there are no org props', () => {
    expect(planDecorations({}, 'bpmn:Task', 100, 80)).toEqual([])
  })

  it('channel on an activity yields band + chevrons + dmthub tag', () => {
    const d = planDecorations({ channel: 'dmthub', channelDetail: 'inbox' }, 'bpmn:Task', 100, 80)
    expect(byKind(d, 'band')).toHaveLength(1)
    expect(byKind(d, 'chevrons')).toHaveLength(1)
    const tags = byKind(d, 'tag')
    expect(tags).toHaveLength(1)
    const tag = tags[0]
    if (tag.kind !== 'tag') throw new Error('expected tag')
    expect(tag.label).toBe('DMT HUB')
    expect(tag.detail).toBe('inbox')
    expect(tag.fill).toBe(PALETTE.tagDmthubFill)
    expect(tag.stroke).toBe(PALETTE.tagDmthubBorder)

    const band = byKind(d, 'band')[0]
    if (band.kind !== 'band') throw new Error('expected band')
    expect(band.fill).toBe(PALETTE.stepGreenBand)
    expect(band.w).toBe(100)
  })

  it('does NOT paint a channel band on a non-activity', () => {
    const d = planDecorations({ channel: 'dmthub' }, 'bpmn:ExclusiveGateway', 50, 50)
    expect(byKind(d, 'band')).toHaveLength(0)
    expect(byKind(d, 'tag')).toHaveLength(0)
  })

  it('cc kind yields ccStyle + a truncated CC sub-label', () => {
    const longRecipient = 'a-very-long-distribution-list@example.org'
    const d = planDecorations({ kind: 'cc', ccTo: longRecipient }, 'bpmn:Task', 100, 80)
    const ccStyle = byKind(d, 'ccStyle')
    expect(ccStyle).toHaveLength(1)
    if (ccStyle[0].kind !== 'ccStyle') throw new Error('expected ccStyle')
    expect(ccStyle[0].fill).toBe(PALETTE.ccFill)
    expect(ccStyle[0].stroke).toBe(PALETTE.ccBorder)

    const sub = byKind(d, 'subLabel')
    expect(sub).toHaveLength(1)
    if (sub[0].kind !== 'subLabel') throw new Error('expected subLabel')
    expect(sub[0].text.startsWith('CC: ')).toBe(true)
    expect(sub[0].text).toContain('…') // truncated at 24 chars
    expect(sub[0].text.length).toBeLessThan('CC: '.length + longRecipient.length)
  })

  it('owner + ownerRole yields an owner box and a RACI chip with the role letter', () => {
    const d = planDecorations({ owner: 'Ahmed Alkatheeri', ownerRole: 'A' }, 'bpmn:Task', 100, 80)
    const box = byKind(d, 'ownerBox')
    expect(box).toHaveLength(1)
    if (box[0].kind !== 'ownerBox') throw new Error('expected ownerBox')
    expect(box[0].text).toBe('Ahmed Alkatheeri')
    expect(box[0].fill).toBe(PALETTE.ownerFill)
    expect(box[0].personGlyph).toBe(true)

    const raci = byKind(d, 'raci')
    expect(raci).toHaveLength(1)
    if (raci[0].kind !== 'raci') throw new Error('expected raci')
    expect(raci[0].letter).toBe('A')
  })

  it('owner without a role defaults the RACI letter to R', () => {
    const d = planDecorations({ owner: 'Sara' }, 'bpmn:UserTask', 100, 80)
    const raci = byKind(d, 'raci')[0]
    if (raci.kind !== 'raci') throw new Error('expected raci')
    expect(raci.letter).toBe('R')
  })

  it('start-event trigger rows yield a compact suffixed tag and full tooltip', () => {
    const d = planDecorations(
      {
        triggers:
          'dmthub — GrievanceIntake — new cases\nemail — Mailroom — fallback'
      },
      'bpmn:StartEvent',
      36,
      36
    )
    const tags = byKind(d, 'tag')
    expect(tags).toHaveLength(1)
    const tag = tags[0]
    if (tag.kind !== 'tag') throw new Error('expected tag')
    expect(tag.label).toBe('DMT HUB +1')
    expect(tag.detail).toBeUndefined()
    expect(tag.tooltip).toBe(
      'DMT HUB — GrievanceIntake — new cases\nEMAIL — Mailroom — fallback'
    )
    expect(tag.y).toBe(-26)
  })

  it('TextAnnotation yields only note styling', () => {
    const d = planDecorations({}, 'bpmn:TextAnnotation', 140, 60)
    expect(d).toHaveLength(1)
    if (d[0].kind !== 'noteStyle') throw new Error('expected noteStyle')
    expect(d[0].fill).toBe(PALETTE.noteFill)
    expect(d[0].stroke).toBe(PALETTE.noteBorder)
  })
})

interface FakeSvgNode {
  nodeType: number
  tagName: string
  ownerDocument: unknown
  style: Record<string, unknown>
  attrs: Record<string, string>
  children: FakeSvgNode[]
  textContent: string
  appendChild(child: FakeSvgNode): FakeSvgNode
  setAttributeNS(namespace: string | null, name: string, value: unknown): void
  getAttributeNS(namespace: string | null, name: string): string | null
}

function installFakeSvgDocument(): {
  createElementNS(namespace: string, name: string): FakeSvgNode
  importNode(node: FakeSvgNode): FakeSvgNode
} {
  const fakeDocument: {
    createElementNS(namespace: string, name: string): FakeSvgNode
    importNode(node: FakeSvgNode): FakeSvgNode
  } = {
    createElementNS(_namespace, name) {
      const node: FakeSvgNode = {
        nodeType: 1,
        tagName: name,
        ownerDocument: fakeDocument,
        style: {},
        attrs: {},
        children: [],
        textContent: '',
        appendChild(child) {
          node.children.push(child)
          return child
        },
        setAttributeNS(_namespace, attrName, value) {
          node.attrs[attrName] = String(value)
        },
        getAttributeNS(_namespace, attrName) {
          return node.attrs[attrName] ?? null
        }
      }
      return node
    },
    importNode(node) {
      return node
    }
  }
  vi.stubGlobal('document', fakeDocument)
  return fakeDocument
}

function flattenFakeSvg(node: FakeSvgNode): FakeSvgNode[] {
  return [node, ...node.children.flatMap(flattenFakeSvg)]
}

describe('applyDecorations DOM contracts', () => {
  it('stamps data-org-tooltip on the trigger tag group', () => {
    const fakeDocument = installFakeSvgDocument()
    try {
      const parent = fakeDocument.createElementNS('', 'g')
      const tag = planDecorations(
        { triggers: 'dmthub — ClaimsHub\nemail — Mailroom — fallback' },
        'bpmn:StartEvent',
        36,
        36
      ).find(
        (decoration): decoration is Extract<Decoration, { kind: 'tag' }> =>
          decoration.kind === 'tag'
      )
      if (!tag) throw new Error('expected trigger tag')

      applyDecorations(parent as unknown as SVGElement, [tag])

      expect(parent.children).toHaveLength(1)
      expect(parent.children[0].tagName).toBe('g')
      expect(parent.children[0].attrs['data-org-tooltip']).toBe(
        'DMT HUB — ClaimsHub\nEMAIL — Mailroom — fallback'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('wraps every list in its semantic data-org-decoration group', () => {
    const fakeDocument = installFakeSvgDocument()
    try {
      const parent = fakeDocument.createElementNS('', 'g')
      const lists = planDecorations(
        {
          inputs: 'Application form',
          outputs: 'Approval memo',
          respList: 'Case owner',
          ccList: 'Legal'
        },
        'bpmn:Task',
        100,
        80
      ).filter(
        (decoration): decoration is Extract<Decoration, { kind: 'listBox' }> =>
          decoration.kind === 'listBox'
      )

      applyDecorations(parent as unknown as SVGElement, lists)

      expect(parent.children.map((child) => child.attrs['data-org-decoration'])).toEqual([
        'inputs',
        'outputs',
        'cc',
        'responsible'
      ])
      for (const group of parent.children) {
        expect(group.tagName).toBe('g')
        expect(group.children[0].tagName).toBe('rect')
      }
      const outputs = parent.children.find(
        (child) => child.attrs['data-org-decoration'] === 'outputs'
      )
      if (!outputs) throw new Error('expected semantic outputs group')
      expect(outputs.children[0].style.fill).toBe(PALETTE.outputFill)
      expect(outputs.children[0].style.stroke).toBe(PALETTE.outputBorder)
      expect(outputs.children[1].textContent).toBe(t('org.outputs.label'))
      expect(outputs.children[3].textContent).toBe('Approval memo')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('adds localized semantic tooltip groups without disturbing child paint order', () => {
    const fakeDocument = installFakeSvgDocument()
    setLang('en')
    try {
      const parent = fakeDocument.createElementNS('', 'g')
      const decorations = planDecorations(
        {
          inputs: 'Application form',
          outputs: 'Approval memo',
          owner: 'Ahmed',
          ownerRole: 'A',
          respList: 'Case owner',
          ccList: 'Legal',
          decisionBasis: 'Delegation matrix'
        },
        'bpmn:BusinessRuleTask',
        100,
        80
      )

      applyDecorations(parent as unknown as SVGElement, decorations)

      const semanticGroups = parent.children.filter(
        (child) => child.attrs['data-org-semantic']
      )
      expect(
        semanticGroups.map((child) => [
          child.attrs['data-org-decoration'],
          child.attrs['data-org-semantic']
        ])
      ).toEqual([
        ['inputs', 'input'],
        ['outputs', 'output'],
        ['cc', 'cc'],
        ['owner', 'owner'],
        ['responsible', 'owner'],
        ['basis', 'basis']
      ])

      const tooltipByDecoration = Object.fromEntries(
        semanticGroups.map((group) => [
          group.attrs['data-org-decoration'],
          group.attrs['data-org-tooltip']
        ])
      )
      expect(tooltipByDecoration).toMatchObject({
        inputs: t('semantic.input.tooltip'),
        outputs: t('semantic.output.tooltip'),
        cc: t('semantic.cc.tooltip'),
        owner: t('semantic.owner.tooltip'),
        responsible: t('semantic.owner.tooltip'),
        basis: t('semantic.basis.tooltip')
      })
      for (const group of semanticGroups) {
        expect(group.style['pointer-events']).toBe('all')
      }
      const ownerRole = parent.children.find(
        (candidate) => candidate.attrs['data-org-decoration'] === 'owner-role'
      )
      expect(ownerRole?.attrs['data-org-semantic']).toBeUndefined()
      expect(ownerRole?.attrs['data-org-tooltip']).toBe(t('semantic.owner.tooltip'))
      expect(ownerRole?.style['pointer-events']).toBe('all')

      const childTags = (decoration: string): string[] => {
        const group = parent.children.find(
          (candidate) => candidate.attrs['data-org-decoration'] === decoration
        )
        if (!group) throw new Error(`missing ${decoration} group`)
        return group.children.map((child) => child.tagName)
      }
      expect(childTags('inputs')).toEqual(['rect', 'text', 'line', 'text'])
      expect(childTags('owner')).toEqual(['rect', 'text', 'text'])
      expect(childTags('owner-role')).toEqual(['rect', 'text'])
      expect(childTags('basis')).toEqual(['rect', 'text'])
      expect(flattenFakeSvg(parent).some((node) => node.tagName === 'title')).toBe(false)
    } finally {
      setLang('en')
      vi.unstubAllGlobals()
    }
  })

  it('wraps the legacy CC label in the same semantic tooltip contract', () => {
    setLang('ar')
    const fakeDocument = installFakeSvgDocument()
    try {
      const parent = fakeDocument.createElementNS('', 'g')
      const cc = planDecorations(
        { kind: 'cc', ccTo: 'Legal' },
        'bpmn:Task',
        100,
        80
      ).filter(
        (decoration): decoration is Extract<Decoration, { kind: 'subLabel' }> =>
          decoration.kind === 'subLabel'
      )

      applyDecorations(parent as unknown as SVGElement, cc)

      expect(parent.children).toHaveLength(1)
      expect(parent.children[0].attrs).toMatchObject({
        'data-org-decoration': 'cc',
        'data-org-semantic': 'cc',
        'data-org-tooltip': t('semantic.cc.tooltip')
      })
      expect(parent.children[0].style['pointer-events']).toBe('all')
      expect(parent.children[0].children.map((child) => child.tagName)).toEqual([
        'text'
      ])
    } finally {
      vi.unstubAllGlobals()
      setLang('en')
    }
  })

  it('keeps the subprocess chip wrapper and adds its canonical semantic tooltip', () => {
    const fakeDocument = installFakeSvgDocument()
    try {
      const parent = fakeDocument.createElementNS('', 'g')
      const chip: Extract<Decoration, { kind: 'subChip' }> = {
        kind: 'subChip',
        x: 12,
        y: 52,
        w: 70,
        h: 14,
        label: 'Sub-process',
        tooltip: 'legacy contextual tooltip',
        fill: PALETTE.subChipFill,
        stroke: PALETTE.subChipBorder
      }

      applyDecorations(parent as unknown as SVGElement, [chip])

      expect(parent.children).toHaveLength(1)
      const group = parent.children[0]
      expect(group.attrs).toMatchObject({
        class: 'orbitpm-sub-chip',
        'data-org-decoration': 'subprocess-chip',
        'data-org-semantic': 'subprocess-chip',
        'data-org-tooltip': t('semantic.subprocessChip.tooltip')
      })
      expect(group.style['pointer-events']).toBe('all')
      expect(group.children.map((child) => child.tagName)).toEqual([
        'rect',
        'text',
        'text'
      ])
      expect(flattenFakeSvg(parent).some((node) => node.tagName === 'title')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// --- eventStyle: start/end events restyled even when bare -------------------

describe('planDecorations — eventStyle', () => {
  it('a bare StartEvent gets exactly the green restyle (stroke width 3)', () => {
    const d = planDecorations({}, 'bpmn:StartEvent', 36, 36)
    expect(d).toHaveLength(1)
    expect(d[0]).toEqual({
      kind: 'eventStyle',
      fill: PALETTE.startFill,
      stroke: PALETTE.startBorder,
      strokeWidth: 3
    })
  })

  it('a bare EndEvent gets exactly the red restyle (stroke width 4)', () => {
    const d = planDecorations({}, 'bpmn:EndEvent', 36, 36)
    expect(d).toHaveLength(1)
    expect(d[0]).toEqual({
      kind: 'eventStyle',
      fill: PALETTE.endFill,
      stroke: PALETTE.endBorder,
      strokeWidth: 4
    })
  })

  it('is emitted FIRST, alongside other decorations, and never on other types', () => {
    const d = planDecorations({ triggers: 'manual' }, 'bpmn:StartEvent', 36, 36)
    expect(d[0].kind).toBe('eventStyle')
    expect(byKind(d, 'tag')).toHaveLength(1)
    for (const type of ['bpmn:Task', 'bpmn:ExclusiveGateway', 'bpmn:IntermediateThrowEvent', 'bpmn:TextAnnotation']) {
      expect(byKind(planDecorations({}, type, 100, 80), 'eventStyle'), type).toHaveLength(0)
    }
  })
})

// --- list-row preparation ----------------------------------------------------

describe('prepareListRows', () => {
  it('maps empty-ish input to []', () => {
    expect(prepareListRows(undefined)).toEqual([])
    expect(prepareListRows('')).toEqual([])
    expect(prepareListRows(' \n \n')).toEqual([])
  })

  it('trims entries and drops blank lines', () => {
    expect(prepareListRows(' Form A \n\n Customer file ')).toEqual(['Form A', 'Customer file'])
  })

  it('truncates each row to ~20 chars with an ellipsis', () => {
    const rows = prepareListRows('a-very-long-input-entry-name')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(20)
    expect(rows[0].endsWith('…')).toBe(true)
  })

  it('caps at 5 rows and appends a "+N" overflow row', () => {
    const rows = prepareListRows('a\nb\nc\nd\ne\nf\ng\nh')
    expect(rows).toHaveLength(6)
    expect(rows.slice(0, 5)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(rows[5]).toBe('+3')
  })

  it('exactly 5 entries produce no overflow row', () => {
    expect(prepareListRows('a\nb\nc\nd\ne')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('listBox geometry helpers', () => {
  it('listBoxHeight = title band + 13 per row', () => {
    expect(listBoxHeight(1)).toBe(35)
    expect(listBoxHeight(6)).toBe(100)
  })

  it('listBoxWidth clamps to 70..170 and widens for the person glyph', () => {
    expect(listBoxWidth('Inputs', ['ab'], false)).toBe(70)
    expect(listBoxWidth('Inputs', ['a'.repeat(40)], false)).toBe(170)
    const noGlyph = listBoxWidth('CC', ['same-length-row'], false)
    const withGlyph = listBoxWidth('CC', ['same-length-row'], true)
    expect(withGlyph).toBe(noGlyph + 12)
  })
})

// --- below-shape stacking (pure) --------------------------------------------

/** Vertical interval consumed by each stacked block, for overlap assertions. */
function stackIntervals(
  layout: ReturnType<typeof stackBelow>,
  respRows: number,
  ccRows = 0
): Array<[number, number]> {
  const intervals: Array<[number, number]> = []
  if (layout.ccSubLabelY !== undefined) intervals.push([layout.ccSubLabelY - 9, layout.ccSubLabelY + 4])
  if (layout.ownerY !== undefined) intervals.push([layout.ownerY, layout.ownerY + 20])
  if (layout.respY !== undefined) intervals.push([layout.respY, layout.respY + listBoxHeight(respRows)])
  if (layout.ccY !== undefined) intervals.push([layout.ccY, layout.ccY + listBoxHeight(ccRows)])
  if (layout.basisY !== undefined) intervals.push([layout.basisY, layout.basisY + 18])
  return intervals
}

describe('stackBelow', () => {
  it('pins the stack offsets (12px gaps)', () => {
    // owner only -> chip at height+12
    expect(stackBelow({ height: 80, ccSubLabel: false, owner: true, respRows: 0, basis: false }).ownerY).toBe(92)
    // cc sub-label + owner -> label baseline at height+12, chip at height+28
    const both = stackBelow({ height: 80, ccSubLabel: true, owner: true, respRows: 0, basis: false })
    expect(both.ccSubLabelY).toBe(92)
    expect(both.ownerY).toBe(108)
  })

  it('stacks resp list under the owner chip, then the cc list, and the basis tag last', () => {
    const layout = stackBelow({ height: 80, ccSubLabel: false, owner: true, respRows: 3, ccRows: 2, basis: true })
    expect(layout.ownerY).toBe(92)
    expect(layout.respY).toBe(92 + 20 + 12) // chip bottom + gap
    expect(layout.ccY).toBe(124 + listBoxHeight(3) + 12)
    expect(layout.basisY).toBe(layout.ccY! + listBoxHeight(2) + 12)
    expect(layout.bottom).toBe(layout.basisY! + 18)
  })

  it('never overlaps for ANY combination of the five blocks', () => {
    const bools = [false, true] as const
    for (const ccSubLabel of bools) {
      for (const owner of bools) {
        for (const respRows of [0, 3] as const) {
          for (const ccRows of [0, 2] as const) {
            for (const basis of bools) {
              const layout = stackBelow({ height: 80, ccSubLabel, owner, respRows, ccRows, basis })
              // presence exactly mirrors the flags
              expect(layout.ccSubLabelY !== undefined).toBe(ccSubLabel)
              expect(layout.ownerY !== undefined).toBe(owner)
              expect(layout.respY !== undefined).toBe(respRows > 0)
              expect(layout.ccY !== undefined).toBe(ccRows > 0)
              expect(layout.basisY !== undefined).toBe(basis)
              // every block sits fully below the shape and below its predecessor
              const intervals = stackIntervals(layout, respRows, ccRows)
              let previousEnd = 80
              for (const [start, end] of intervals) {
                expect(start).toBeGreaterThan(80)
                expect(start).toBeGreaterThanOrEqual(previousEnd)
                previousEnd = end
              }
              expect(layout.bottom).toBe(intervals.length ? previousEnd : 80)
            }
          }
        }
      }
    }
  })

  it('legacy 4-block calls (no ccRows) still type-check and stack identically', () => {
    const layout = stackBelow({ height: 80, ccSubLabel: false, owner: true, respRows: 2, basis: true })
    expect(layout.ccY).toBeUndefined()
    expect(layout.respY).toBe(124)
    expect(layout.basisY).toBe(124 + listBoxHeight(2) + 12)
  })
})

// --- planDecorations: wave-G decorations ------------------------------------

function listBoxes(d: Decoration[]): Extract<Decoration, { kind: 'listBox' }>[] {
  return d.filter((x): x is Extract<Decoration, { kind: 'listBox' }> => x.kind === 'listBox')
}

describe('planDecorations — inputs list (teal)', () => {
  it('horizontal (default): renders a titled teal list box ABOVE the activity, bottom at -30', () => {
    const d = planDecorations({ inputs: 'Form A\nCustomer file' }, 'bpmn:Task', 100, 80)
    const boxes = listBoxes(d)
    expect(boxes).toHaveLength(1)
    const box = boxes[0]
    expect(box.title).toBe(t('canvas.inputs'))
    expect(box.rows).toEqual(['Form A', 'Customer file'])
    expect(box.fill).toBe(PALETTE.inputFill)
    expect(box.stroke).toBe(PALETTE.inputBorder)
    expect(box.textColor).toBe(PALETTE.inputText)
    expect(box.personGlyph).toBe(false)
    // left-aligned above the shape, bottom edge pinned at y = -30 — clear of
    // the channel tag (-22..-4), trigger tag (-26..-8) and badge (-20..-4)
    expect(box.x).toBe(0)
    expect(box.y + box.h).toBe(-30)
    expect(box.h).toBe(listBoxHeight(2))
  })

  it('vertical orientation: renders strictly LEFT of the activity with a 12px gap', () => {
    const d = planDecorations({ inputs: 'Form A\nCustomer file' }, 'bpmn:Task', 100, 80, {
      orientation: 'vertical'
    })
    const box = listBoxes(d)[0]
    expect(box.x).toBeLessThan(0)
    expect(box.x + box.w).toBe(-12)
    expect(box.y).toBe(0)
    expect(box.h).toBe(listBoxHeight(2))
  })

  it('caps at 5 rows plus a "+N" overflow row', () => {
    const d = planDecorations({ inputs: 'a\nb\nc\nd\ne\nf\ng' }, 'bpmn:UserTask', 100, 80)
    const box = listBoxes(d)[0]
    expect(box.rows).toHaveLength(6)
    expect(box.rows[5]).toBe('+2')
  })

  it('is ignored on non-activities', () => {
    expect(listBoxes(planDecorations({ inputs: 'Form A' }, 'bpmn:ExclusiveGateway', 50, 50))).toHaveLength(0)
    expect(listBoxes(planDecorations({ inputs: 'Form A' }, 'bpmn:StartEvent', 36, 36))).toHaveLength(0)
  })
})

describe('planDecorations — outputs list', () => {
  const props = {
    inputs: 'Application form',
    outputs: 'Approval memo\nArchive record',
    owner: 'Ahmed'
  }

  it('mirrors input row sizing while using the distinct output palette and semantic', () => {
    const boxes = listBoxes(planDecorations(props, 'bpmn:Task', 100, 80))
    const output = boxes.find((box) => box.semantic === 'outputs')
    if (!output) throw new Error('expected outputs list')
    expect(output.title).toBe(t('org.outputs.label'))
    expect(output.rows).toEqual(['Approval memo', 'Archive record'])
    expect(output.h).toBe(listBoxHeight(2))
    expect(output.fill).toBe(PALETTE.outputFill)
    expect(output.stroke).toBe(PALETTE.outputBorder)
    expect(output.textColor).toBe(PALETTE.outputText)
    expect(output.personGlyph).toBe(false)
  })

  it('maps before/after decoration sides for all four local flow directions', () => {
    const cases = [
      { direction: 'right' as const, inputSide: 'top', outputSide: 'bottom' },
      { direction: 'down' as const, inputSide: 'left', outputSide: 'right' },
      { direction: 'left' as const, inputSide: 'bottom', outputSide: 'top' },
      { direction: 'up' as const, inputSide: 'right', outputSide: 'left' }
    ]
    const sideOf = (box: Extract<Decoration, { kind: 'listBox' }>): string => {
      if (box.y + box.h < 0) return 'top'
      if (box.y > 80) return 'bottom'
      if (box.x + box.w < 0) return 'left'
      if (box.x > 100) return 'right'
      return 'overlap'
    }

    for (const { direction, inputSide, outputSide } of cases) {
      const boxes = listBoxes(
        planDecorations(props, 'bpmn:Task', 100, 80, { direction })
      )
      const input = boxes.find((box) => box.semantic === 'inputs')
      const output = boxes.find((box) => box.semantic === 'outputs')
      if (!input || !output) throw new Error(`expected input/output for ${direction}`)
      expect(sideOf(input), `${direction} input`).toBe(inputSide)
      expect(sideOf(output), `${direction} output`).toBe(outputSide)
    }
  })

  it('places outputs first in the after-side stack before owner/responsible/CC', () => {
    for (const direction of ['right', 'down', 'left', 'up'] as const) {
      const decorations = planDecorations(
        {
          outputs: 'Approval memo',
          owner: 'Ahmed',
          respList: 'Sara',
          ccList: 'Legal'
        },
        'bpmn:Task',
        100,
        80,
        { direction }
      )
      const output = listBoxes(decorations).find((box) => box.semantic === 'outputs')
      const responsible = listBoxes(decorations).find((box) => box.semantic === 'responsible')
      const cc = listBoxes(decorations).find((box) => box.semantic === 'cc')
      const owner = byKind(decorations, 'ownerBox')[0]
      if (!output || !responsible || !cc || owner.kind !== 'ownerBox') {
        throw new Error(`expected complete after stack for ${direction}`)
      }
      if (direction === 'left') {
        expect(output.y).toBeGreaterThan(owner.y)
        expect(owner.y).toBeGreaterThan(responsible.y)
        expect(responsible.y).toBeGreaterThan(cc.y)
      } else {
        expect(output.y).toBeLessThan(owner.y)
        expect(owner.y).toBeLessThan(responsible.y)
        expect(responsible.y).toBeLessThan(cc.y)
      }
    }
  })

  it('uses the shared row cap and ignores outputs on non-activities', () => {
    const output = listBoxes(
      planDecorations({ outputs: 'a\nb\nc\nd\ne\nf\ng' }, 'bpmn:Task', 100, 80)
    )[0]
    expect(output.rows).toEqual(['a', 'b', 'c', 'd', 'e', '+2'])
    expect(output.h).toBe(listBoxHeight(6))
    expect(
      listBoxes(
        planDecorations({ outputs: 'Approval memo' }, 'bpmn:ExclusiveGateway', 50, 50)
      )
    ).toHaveLength(0)
  })
})

describe('planDecorations — CC list (pink)', () => {
  it('horizontal (default): joins the below-shape stack, independent of kind', () => {
    const d = planDecorations({ ccList: 'Legal\nFinance' }, 'bpmn:Task', 100, 80)
    const boxes = listBoxes(d)
    expect(boxes).toHaveLength(1)
    const box = boxes[0]
    expect(box.title).toBe(t('canvas.cc'))
    expect(box.rows).toEqual(['Legal', 'Finance'])
    expect(box.fill).toBe(PALETTE.ccFill)
    expect(box.stroke).toBe(PALETTE.ccBorder)
    // alone in the stack: first block at height + 12
    expect(box.x).toBe(0)
    expect(box.y).toBe(92)
    // no cc recolour and no legacy sub-label without kind==='cc'
    expect(byKind(d, 'ccStyle')).toHaveLength(0)
    expect(byKind(d, 'subLabel')).toHaveLength(0)
  })

  it('horizontal: stacks AFTER the responsible list and BEFORE the basis tag', () => {
    const d = planDecorations(
      { owner: 'Ahmed', respList: 'Sara\nOmar', ccList: 'Legal', decisionBasis: 'Matrix' },
      'bpmn:BusinessRuleTask',
      100,
      80
    )
    const boxes = listBoxes(d)
    const respBox = boxes.find((b) => b.personGlyph)!
    const ccBox = boxes.find((b) => b.fill === PALETTE.ccFill)!
    const basisTag = byKind(d, 'tag').find((x) => x.kind === 'tag' && x.fill === PALETTE.basisFill)
    if (!basisTag || basisTag.kind !== 'tag') throw new Error('expected basis tag')
    expect(ccBox.y).toBeGreaterThanOrEqual(respBox.y + respBox.h + 12)
    expect(basisTag.y).toBeGreaterThanOrEqual(ccBox.y + ccBox.h + 12)
  })

  it('vertical orientation: renders strictly RIGHT of the shape with a 12px gap', () => {
    const d = planDecorations({ ccList: 'Legal\nFinance' }, 'bpmn:Task', 100, 80, {
      orientation: 'vertical'
    })
    const box = listBoxes(d)[0]
    expect(box.x).toBe(100 + 12)
    expect(box.y).toBe(0)
  })

  it('with kind==="cc" keeps the recolour but SUPPRESSES the legacy sub-label', () => {
    const d = planDecorations({ kind: 'cc', ccTo: 'Legal', ccList: 'Legal\nFinance' }, 'bpmn:Task', 100, 80)
    expect(byKind(d, 'ccStyle')).toHaveLength(1)
    expect(byKind(d, 'subLabel')).toHaveLength(0)
    expect(listBoxes(d)).toHaveLength(1)
  })

  it('kind==="cc" WITHOUT ccList keeps the legacy sub-label (backward compat)', () => {
    const d = planDecorations({ kind: 'cc', ccTo: 'Legal' }, 'bpmn:Task', 100, 80)
    expect(byKind(d, 'subLabel')).toHaveLength(1)
    expect(listBoxes(d)).toHaveLength(0)
  })
})

describe('planDecorations — responsible list (beige, person glyphs)', () => {
  it('renders alone at the owner-chip slot (height+12)', () => {
    const d = planDecorations({ respList: 'Sara — Approver\nOmar' }, 'bpmn:Task', 100, 80)
    const box = listBoxes(d)[0]
    expect(box.title).toBe(t('canvas.responsible'))
    expect(box.rows).toEqual(['Sara — Approver', 'Omar'])
    expect(box.fill).toBe(PALETTE.ownerFill)
    expect(box.stroke).toBe(PALETTE.ownerBorder)
    expect(box.textColor).toBe(PALETTE.ownerText)
    expect(box.personGlyph).toBe(true)
    expect(box.x).toBe(0)
    expect(box.y).toBe(92)
  })

  it('stacks below the owner chip when both exist; owner chip stays at height+12', () => {
    const d = planDecorations({ owner: 'Ahmed', respList: 'Sara\nOmar' }, 'bpmn:Task', 100, 80)
    const owner = byKind(d, 'ownerBox')[0]
    if (owner.kind !== 'ownerBox') throw new Error('expected ownerBox')
    expect(owner.y).toBe(92)
    const box = listBoxes(d)[0]
    expect(box.y).toBe(92 + 20 + 12)
  })

  it('an external label below the shape pushes the whole stack under the label', () => {
    const labelBox = { x: 5, y: 87, w: 90, h: 20 } // default 90x20 label at h+7
    const d = planDecorations({ owner: 'Ahmed', respList: 'Sara\nOmar' }, 'bpmn:Task', 100, 80, {
      labelBox
    })
    const owner = byKind(d, 'ownerBox')[0]
    if (owner.kind !== 'ownerBox') throw new Error('expected ownerBox')
    // base = label bottom (107) -> chip at 119, resp under it
    expect(owner.y).toBe(119)
    expect(listBoxes(d)[0].y).toBe(119 + 20 + 12)
  })

  it('vertical orientation: joins the right-side stack next to the shape', () => {
    const d = planDecorations({ owner: 'Ahmed', respList: 'Sara\nOmar' }, 'bpmn:Task', 100, 80, {
      orientation: 'vertical'
    })
    const owner = byKind(d, 'ownerBox')[0]
    if (owner.kind !== 'ownerBox') throw new Error('expected ownerBox')
    expect(owner.x).toBe(112)
    expect(owner.y).toBe(0)
    const box = listBoxes(d)[0]
    expect(box.x).toBe(112)
    expect(box.y).toBe(20 + 8) // chip bottom + side gap
    // RACI chip keeps riding the chip's top-left corner
    const raci = byKind(d, 'raci')[0]
    if (raci.kind !== 'raci') throw new Error('expected raci')
    expect(raci.x).toBe(112)
    expect(raci.y).toBe(3)
  })
})

describe('planDecorations — decision basis (amber tag)', () => {
  const GATEWAYS = [
    'bpmn:ExclusiveGateway',
    'bpmn:InclusiveGateway',
    'bpmn:ParallelGateway',
    'bpmn:EventBasedGateway',
    'bpmn:ComplexGateway'
  ]

  it('renders below every gateway type and business-rule tasks', () => {
    for (const type of [...GATEWAYS, 'bpmn:BusinessRuleTask']) {
      const d = planDecorations({ decisionBasis: 'Delegation matrix §3' }, type, 50, 50)
      const tags = byKind(d, 'tag')
      expect(tags).toHaveLength(1)
      const tag = tags[0]
      if (tag.kind !== 'tag') throw new Error('expected tag')
      expect(tag.label).toBe(t('canvas.basis'))
      expect(tag.detail).toBe('Delegation matrix §3')
      expect(tag.fill).toBe(PALETTE.basisFill)
      expect(tag.stroke).toBe(PALETTE.basisBorder)
      expect(tag.y).toBe(50 + 12) // below the shape
    }
  })

  it('truncates the basis text to ~28 chars', () => {
    const long = 'A very long delegation-of-authority policy reference'
    const d = planDecorations({ decisionBasis: long }, 'bpmn:ExclusiveGateway', 50, 50)
    const tag = byKind(d, 'tag')[0]
    if (tag.kind !== 'tag') throw new Error('expected tag')
    expect(tag.detail).toHaveLength(28)
    expect(tag.detail?.endsWith('…')).toBe(true)
  })

  it('is ignored on non-decision types', () => {
    for (const type of ['bpmn:Task', 'bpmn:UserTask', 'bpmn:StartEvent', 'bpmn:ServiceTask']) {
      const d = planDecorations({ decisionBasis: 'Policy' }, type, 100, 80)
      expect(byKind(d, 'tag')).toHaveLength(0)
    }
    expect(isDecisionBasisType('bpmn:BusinessRuleTask')).toBe(true)
    expect(isDecisionBasisType('bpmn:Task')).toBe(false)
  })
})

describe('planDecorations — everything at once stays overlap-free', () => {
  const EVERYTHING = {
    kind: 'cc',
    ccTo: 'Legal',
    ccList: 'Legal\nFinance',
    owner: 'Ahmed Alkatheeri',
    ownerRole: 'A',
    respList: 'Sara — Approver\nOmar\nZayed',
    decisionBasis: 'Delegation matrix',
    inputs: 'Form A\nCustomer file',
    channel: 'dmthub',
    channelDetail: 'inbox'
  }

  it('horizontal: inputs above; owner, resp, cc, basis stack below in order', () => {
    const d = planDecorations(EVERYTHING, 'bpmn:BusinessRuleTask', 100, 80)

    const boxes = listBoxes(d)
    const inputBox = boxes.find((b) => b.fill === PALETTE.inputFill)!
    const ccBox = boxes.find((b) => b.fill === PALETTE.ccFill)!
    const respBox = boxes.find((b) => b.personGlyph)!
    // inputs above the shape, bottom pinned at -30
    expect(inputBox.x).toBe(0)
    expect(inputBox.y + inputBox.h).toBe(-30)

    // legacy sub-label suppressed by the CC list
    expect(byKind(d, 'subLabel')).toHaveLength(0)
    expect(byKind(d, 'ccStyle')).toHaveLength(1)

    // below-shape blocks are disjoint and ordered:
    // owner chip, resp list, cc list, basis tag
    const owner = byKind(d, 'ownerBox')[0]
    if (owner.kind !== 'ownerBox') throw new Error('expected ownerBox')
    const basisTag = byKind(d, 'tag').find((tag) => tag.kind === 'tag' && tag.fill === PALETTE.basisFill)
    if (!basisTag || basisTag.kind !== 'tag') throw new Error('expected basis tag')
    const blocks: Array<[number, number]> = [
      [owner.y, owner.y + owner.h],
      [respBox.y, respBox.y + respBox.h],
      [ccBox.y, ccBox.y + ccBox.h],
      [basisTag.y, basisTag.y + basisTag.h]
    ]
    let previousEnd = 80
    for (const [start, end] of blocks) {
      expect(start).toBeGreaterThan(80)
      expect(start).toBeGreaterThanOrEqual(previousEnd)
      previousEnd = end
    }
    for (const block of [owner, respBox, ccBox]) expect(block.x).toBe(0)

    // the RACI chip stays contained inside the owner chip's vertical extent
    const raci = byKind(d, 'raci')[0]
    if (raci.kind !== 'raci') throw new Error('expected raci')
    expect(raci.y).toBeGreaterThanOrEqual(owner.y)
    expect(raci.y + raci.size).toBeLessThanOrEqual(owner.y + owner.h)

    // the channel tag stays ABOVE the shape, clear of the below stack
    const channelTag = byKind(d, 'tag').find((tag) => tag.kind === 'tag' && tag.fill === PALETTE.tagDmthubFill)
    if (!channelTag || channelTag.kind !== 'tag') throw new Error('expected channel tag')
    expect(channelTag.y).toBeLessThan(0)
  })

  it('vertical: inputs left; owner, resp, cc, basis stack to the right in order', () => {
    const d = planDecorations(EVERYTHING, 'bpmn:BusinessRuleTask', 100, 80, {
      orientation: 'vertical'
    })

    const boxes = listBoxes(d)
    const inputBox = boxes.find((b) => b.fill === PALETTE.inputFill)!
    const ccBox = boxes.find((b) => b.fill === PALETTE.ccFill)!
    const respBox = boxes.find((b) => b.personGlyph)!
    expect(inputBox.x + inputBox.w).toBe(-12)

    const owner = byKind(d, 'ownerBox')[0]
    if (owner.kind !== 'ownerBox') throw new Error('expected ownerBox')
    const basisTag = byKind(d, 'tag').find((tag) => tag.kind === 'tag' && tag.fill === PALETTE.basisFill)
    if (!basisTag || basisTag.kind !== 'tag') throw new Error('expected basis tag')
    // all side blocks share x = width + 12 and stack downward from y = 0
    for (const block of [owner, respBox, ccBox, basisTag]) expect(block.x).toBe(112)
    expect(owner.y).toBe(0)
    expect(respBox.y).toBe(owner.y + owner.h + 8)
    expect(ccBox.y).toBe(respBox.y + respBox.h + 8)
    expect(basisTag.y).toBe(ccBox.y + ccBox.h + 8)
  })
})

// --- canRenderOrg (pure flag logic) ----------------------------------------

describe('canRenderOrg', () => {
  const taskWithOwner: OrgElementLike = {
    type: 'bpmn:Task',
    businessObject: { $type: 'bpmn:Task', $attrs: { 'orbitpm:owner': 'X' } }
  }
  const plainTask: OrgElementLike = {
    type: 'bpmn:Task',
    businessObject: { $type: 'bpmn:Task', $attrs: {} }
  }

  it('is false when styling is off', () => {
    expect(canRenderOrg(taskWithOwner, false)).toBe(false)
  })

  it('renders a text annotation even with no org props', () => {
    expect(canRenderOrg({ type: 'bpmn:TextAnnotation' }, true)).toBe(true)
  })

  it('renders a flow node only when it carries an org prop', () => {
    expect(canRenderOrg(taskWithOwner, true)).toBe(true)
    expect(canRenderOrg(plainTask, true)).toBe(false)
  })

  it('leaves bare gateways to the renderer-level semantic presentation path', () => {
    for (const type of Object.keys(SEMANTIC_NAMING)) {
      expect(
        canRenderOrg(
          {
            type,
            businessObject: { $type: type, $attrs: {} }
          },
          true
        ),
        type
      ).toBe(false)
    }
    expect(
      canRenderOrg({ type: 'bpmn:EventBasedGateway', businessObject: { $attrs: {} } }, true)
    ).toBe(false)
  })

  it('considers every wave-G prop (inputs/ccList/respList/decisionBasis/…)', () => {
    for (const attr of [
      'orbitpm:inputs',
      'orbitpm:outputs',
      'orbitpm:system',
      'orbitpm:respList',
      'orbitpm:ccList',
      'orbitpm:decisionBasis',
      'orbitpm:nameEn',
      'orbitpm:nameAr'
    ]) {
      const element: OrgElementLike = {
        type: 'bpmn:Task',
        businessObject: { $type: 'bpmn:Task', $attrs: { [attr]: 'x' } }
      }
      expect(canRenderOrg(element, true)).toBe(true)
    }
  })

  it('never renders labels, connections or non-bpmn elements', () => {
    expect(canRenderOrg({ type: 'bpmn:Task', labelTarget: {} }, true)).toBe(false)
    expect(canRenderOrg({ type: 'bpmn:SequenceFlow', waypoints: [] }, true)).toBe(false)
    expect(canRenderOrg({ type: 'label' }, true)).toBe(false)
    expect(canRenderOrg(null, true)).toBe(false)
  })
})

// --- missingBadge carries machine-readable categories ------------------------

describe('planMissingBadge missing[] payload', () => {
  it('pins the ordered category array (stamped as data-org-missing)', () => {
    const badge = planMissingBadge({}, 'bpmn:Task', 100)
    if (!badge || badge.kind !== 'missingBadge') throw new Error('expected missingBadge')
    expect(badge.missing).toEqual(['owner', 'inputs', 'outputs'])
    const single = planMissingBadge({}, 'bpmn:StartEvent', 36)
    if (!single || single.kind !== 'missingBadge') throw new Error('expected missingBadge')
    expect(single.missing).toEqual(['trigger'])
  })
})

// --- relativeLabelBox --------------------------------------------------------

describe('relativeLabelBox', () => {
  it('translates absolute label bounds into shape-local coords', () => {
    const element: OrgElementLike = {
      x: 200,
      y: 300,
      width: 100,
      height: 80,
      label: { x: 205, y: 387, width: 90, height: 20 }
    }
    expect(relativeLabelBox(element)).toEqual({ x: 5, y: 87, w: 90, h: 20 })
  })

  it('returns null without a label or with incomplete geometry', () => {
    expect(relativeLabelBox({ x: 0, y: 0 })).toBeNull()
    expect(relativeLabelBox({ label: { x: 1, y: 2, width: 90, height: 20 } })).toBeNull()
    expect(
      relativeLabelBox({
        x: 0,
        y: 0,
        label: { y: 2, width: 90, height: 20 } as unknown as NonNullable<OrgElementLike['label']>
      })
    ).toBeNull()
  })
})

// --- removeStockSubProcessMarker (structural DOM fakes) ----------------------

interface FakeMarkerNode {
  tagName?: string
  removed: boolean
  getAttribute?(n: string): string | null
  remove(): void
  previousElementSibling?: FakeMarkerNode | null
}

function fakeNode(tagName: string, attrs: Record<string, string> = {}): FakeMarkerNode {
  const node: FakeMarkerNode = {
    tagName,
    removed: false,
    getAttribute: (n: string) => attrs[n] ?? null,
    remove() {
      node.removed = true
    }
  }
  return node
}

describe('removeStockSubProcessMarker', () => {
  it('removes the marker path AND its adjacent 14x14 rect, returns true', () => {
    const rect = fakeNode('rect', { width: '14' })
    const path = fakeNode('path', { 'data-marker': 'sub-process' })
    path.previousElementSibling = rect
    const visual: MarkerDomLike = {
      querySelector: (sel: string) => (sel === 'path[data-marker="sub-process"]' ? path : null)
    }
    expect(removeStockSubProcessMarker(visual)).toBe(true)
    expect(path.removed).toBe(true)
    expect(rect.removed).toBe(true)
  })

  it('guards the sibling removal: wrong tag or wrong width is left alone', () => {
    for (const sibling of [fakeNode('circle'), fakeNode('rect', { width: '99' }), null]) {
      const path = fakeNode('path', { 'data-marker': 'sub-process' })
      path.previousElementSibling = sibling
      const visual: MarkerDomLike = { querySelector: () => path }
      expect(removeStockSubProcessMarker(visual)).toBe(true)
      expect(path.removed).toBe(true)
      if (sibling) expect(sibling.removed).toBe(false)
    }
  })

  it('returns false when no marker exists (expanded sub-process, plain task)', () => {
    expect(removeStockSubProcessMarker({ querySelector: () => null })).toBe(false)
  })

  it('tolerates non-DOM inputs (node test environment) without throwing', () => {
    expect(removeStockSubProcessMarker({} as MarkerDomLike)).toBe(false)
    expect(removeStockSubProcessMarker(null as unknown as MarkerDomLike)).toBe(false)
    expect(
      removeStockSubProcessMarker({
        querySelector: () => {
          throw new Error('boom')
        }
      })
    ).toBe(false)
  })
})

// --- presentation-only semantic gateway labels ------------------------------

describe('semantic gateway presentation', () => {
  const IDS = {
    'bpmn:ExclusiveGateway': 'gateway-exclusive',
    'bpmn:InclusiveGateway': 'gateway-inclusive',
    'bpmn:ParallelGateway': 'gateway-parallel'
  } as const

  it('resolves exact SEMANTIC_NAMING display/tooltip text in EN and AR', () => {
    for (const [type, naming] of Object.entries(SEMANTIC_NAMING)) {
      for (const lang of ['en', 'ar'] as const) {
        expect(
          gatewayPresentationForElement(
            {
              type,
              businessObject: { $type: type, $attrs: {} }
            },
            lang
          )
        ).toEqual({
          semantic: IDS[type as keyof typeof IDS],
          display: naming[lang].display,
          tooltip: naming[lang].tooltip,
          lang
        })
      }
    }
  })

  it('keeps every real gateway name and rejects unsupported element kinds', () => {
    for (const type of Object.keys(SEMANTIC_NAMING)) {
      expect(
        gatewayPresentationForElement(
          {
            type,
            businessObject: { $type: type, name: 'Approved?', $attrs: {} }
          },
          'en'
        )
      ).toBeNull()
      expect(
        gatewayPresentationForElement(
          {
            type,
            businessObject: {
              $type: type,
              get: (key) => (key === 'name' ? 'Named through get()' : undefined),
              $attrs: {}
            }
          },
          'ar'
        )
      ).toBeNull()
    }
    expect(
      gatewayPresentationForElement(
        { type: 'bpmn:EventBasedGateway', businessObject: { $attrs: {} } },
        'en'
      )
    ).toBeNull()
  })

  it('reads activeLang from process and collaboration roots, defaulting to EN', () => {
    const gateway: OrgElementLike = {
      type: 'bpmn:ExclusiveGateway',
      businessObject: { $attrs: {} }
    }
    expect(
      diagramLanguageForElement(gateway, {
        getRootElement: () => ({
          businessObject: {
            $type: 'bpmn:Process',
            $attrs: { 'orbitpm:activeLang': 'ar' }
          }
        })
      })
    ).toBe('ar')
    expect(
      diagramLanguageForElement(gateway, {
        getRootElement: () => ({
          businessObject: {
            $type: 'bpmn:Collaboration',
            participants: [
              {
                processRef: {
                  $type: 'bpmn:Process',
                  $attrs: { 'orbitpm:activeLang': 'ar' }
                }
              }
            ],
            $attrs: {}
          }
        })
      })
    ).toBe('ar')
    expect(
      diagramLanguageForElement(gateway, {
        getRootElement: () => ({
          businessObject: { $type: 'bpmn:Process', $attrs: {} }
        })
      })
    ).toBe('en')
  })

  it('draws only the unnamed fallback, with semantic tooltip and no model write', () => {
    setLang('en')
    const fakeDocument = installFakeSvgDocument()
    const store = installMemoryStorage()
    store.set('orbitpm.lite.orgStyling', 'false')
    store.set('orbitpm.lite.completenessOn', 'true')
    try {
      const sentinel = fakeDocument.createElementNS('', 'path')
      const bpmnRenderer = {
        drawShape: vi.fn(() => sentinel as unknown as SVGElement),
        drawConnection: vi.fn()
      }
      const root: OrgElementLike = {
        type: 'bpmn:Process',
        businessObject: {
          $type: 'bpmn:Process',
          $attrs: { 'orbitpm:activeLang': 'ar' }
        }
      }
      const renderer = new OrgRenderer(
        { on: vi.fn() },
        bpmnRenderer,
        undefined,
        { getRootElement: () => root }
      )
      const unnamed: OrgElementLike = {
        id: 'Gateway_1',
        type: 'bpmn:ExclusiveGateway',
        width: 50,
        height: 50,
        businessObject: {
          $type: 'bpmn:ExclusiveGateway',
          // Styling-off must suppress both this basis tag and the default-on
          // completeness badge, while semantic presentation stays mandatory.
          $attrs: { 'orbitpm:decisionBasis': 'Delegation matrix' }
        }
      }
      const before = JSON.stringify(unnamed.businessObject)
      const parent = fakeDocument.createElementNS('', 'g')

      expect(renderer.canRender(unnamed)).toBe(true)
      expect(
        renderer.drawShape(parent as unknown as SVGElement, unnamed)
      ).toBe(sentinel)
      expect(parent.children).toHaveLength(1)
      const group = parent.children[0]
      expect(group.attrs).toMatchObject({
        class: 'orbitpm-semantic-gateway-label',
        'data-org-semantic': 'gateway-exclusive',
        // Help copy follows the English UI; the presentation label below
        // independently follows the Arabic diagram language.
        'data-org-tooltip': SEMANTIC_NAMING['bpmn:ExclusiveGateway'].en.tooltip
      })
      expect(group.style['pointer-events']).toBe('all')
      expect(group.children.map((child) => child.tagName)).toEqual(['text'])
      expect(group.children[0].textContent).toBe(
        'قرار: Delegation matrix'
      )
      expect(group.children[0].attrs.lang).toBe('ar')
      expect(group.children[0].style).toMatchObject({
        direction: 'rtl',
        'unicode-bidi': 'plaintext'
      })
      expect(JSON.stringify(unnamed.businessObject)).toBe(before)
      expect(flattenFakeSvg(parent).some((node) => node.tagName === 'title')).toBe(false)

      const namedParent = fakeDocument.createElementNS('', 'g')
      const named: OrgElementLike = {
        ...unnamed,
        id: 'Gateway_named',
        businessObject: {
          $type: 'bpmn:ExclusiveGateway',
          name: 'Approved?',
          $attrs: {}
        }
      }
      expect(renderer.canRender(named)).toBe(false)
      renderer.drawShape(namedParent as unknown as SVGElement, named)
      expect(namedParent.children).toHaveLength(0)
      expect(named.businessObject?.name).toBe('Approved?')
      expect(bpmnRenderer.drawShape).toHaveBeenLastCalledWith(namedParent, named)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('repaints only unnamed semantic gateways after import and command batches', () => {
    const callbacks = new Map<string, () => void>()
    const eventBus = {
      on: vi.fn((event: unknown, ...args: unknown[]) => {
        if (typeof event !== 'string') return
        const callback = args.at(-1)
        if (typeof callback === 'function') {
          callbacks.set(event, callback as () => void)
        }
      })
    }
    const unnamed: OrgElementLike = {
      id: 'Gateway_default',
      type: 'bpmn:ParallelGateway',
      businessObject: { $attrs: {} }
    }
    const named: OrgElementLike = {
      id: 'Gateway_named',
      type: 'bpmn:ExclusiveGateway',
      businessObject: { name: 'Approved?', $attrs: {} }
    }
    const task: OrgElementLike = {
      id: 'Task_1',
      type: 'bpmn:Task',
      businessObject: { $attrs: {} }
    }
    const gfx = {} as SVGElement
    const registry = {
      getAll: vi.fn(() => [unnamed, named, task]),
      getGraphics: vi.fn(() => gfx)
    }
    const graphicsFactory = { update: vi.fn() }
    new OrgRenderer(
      eventBus,
      { drawShape: vi.fn(), drawConnection: vi.fn() },
      undefined,
      { getRootElement: () => undefined },
      registry,
      graphicsFactory
    )

    callbacks.get('import.done')?.()
    callbacks.get('commandStack.changed')?.()

    expect(registry.getGraphics).toHaveBeenCalledTimes(2)
    expect(registry.getGraphics).toHaveBeenNthCalledWith(1, unnamed)
    expect(registry.getGraphics).toHaveBeenNthCalledWith(2, unnamed)
    expect(graphicsFactory.update).toHaveBeenCalledTimes(2)
    expect(graphicsFactory.update).toHaveBeenNthCalledWith(
      1,
      'shape',
      unnamed,
      gfx
    )
    expect(graphicsFactory.update).toHaveBeenNthCalledWith(
      2,
      'shape',
      unnamed,
      gfx
    )
  })
})

// --- OrgRenderer instance (fake eventBus — never a real one) ----------------

describe('OrgRenderer.canRender wires the settings flag', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reflects isOrgStylingOn() (default on, and after toggling off)', () => {
    const store = installMemoryStorage()
    const eventBus = { on: vi.fn() }
    const bpmnRenderer = { drawShape: vi.fn(), drawConnection: vi.fn() }
    const renderer = new OrgRenderer(eventBus, bpmnRenderer)

    const task: OrgElementLike = {
      type: 'bpmn:Task',
      businessObject: { $type: 'bpmn:Task', $attrs: { 'orbitpm:owner': 'X' } }
    }

    // Constructor must have subscribed to the render events on the (fake) bus.
    expect(eventBus.on).toHaveBeenCalled()

    // Default (unset) -> styling on -> renders the org-annotated task.
    expect(renderer.canRender(task)).toBe(true)

    // Toggle off via storage -> canRender goes false.
    store.set('orbitpm.lite.orgStyling', 'false')
    expect(renderer.canRender(task)).toBe(false)
  })

  it('drawShape delegates to the injected bpmnRenderer and returns its shape', () => {
    installMemoryStorage()
    const sentinel = { tagName: 'g' } as unknown as SVGElement
    const bpmnRenderer = {
      drawShape: vi.fn(() => sentinel),
      drawConnection: vi.fn()
    }
    const renderer = new OrgRenderer({ on: vi.fn() }, bpmnRenderer)
    // A prop-free task -> planDecorations returns [] -> applyDecorations is a
    // no-op, so no SVG DOM is touched in this node environment.
    const parentGfx = {} as unknown as SVGElement
    const element: OrgElementLike = { type: 'bpmn:Task', businessObject: { $type: 'bpmn:Task', $attrs: {} } }
    const result = renderer.drawShape(parentGfx, element)
    expect(bpmnRenderer.drawShape).toHaveBeenCalledWith(parentGfx, element)
    expect(result).toBe(sentinel)
  })
})

// --- DI module shape --------------------------------------------------------

describe('OrgRenderModule', () => {
  it('registers shape sync, shape renderer and connection overlays as services', () => {
    expect(OrgRenderModule.__init__).toEqual([
      'orgDecorSync',
      'orgRenderer',
      'orgConnectionRenderer'
    ])
    expect(OrgRenderModule.orgRenderer[0]).toBe('type')
    expect(OrgRenderModule.orgRenderer[1]).toBe(OrgRenderer)
    expect(OrgRenderModule.orgDecorSync[0]).toBe('type')
    expect(OrgRenderModule.orgDecorSync[1]).toBe(OrgDecorSync)
    expect(OrgRenderModule.orgConnectionRenderer[0]).toBe('type')
    expect(OrgRenderModule.orgConnectionRenderer[1]).toBe(OrgConnectionRenderer)
    expect(OrgRenderer.$inject).toEqual([
      'eventBus',
      'bpmnRenderer',
      'orgDecorSync',
      'canvas',
      'elementRegistry',
      'graphicsFactory'
    ])
    expect(OrgDecorSync.$inject).toEqual(['eventBus', 'elementRegistry', 'graphicsFactory'])
    expect(OrgConnectionRenderer.$inject).toEqual(['eventBus', 'canvas', 'elementRegistry'])
  })

  it('OrgRenderer asks orgDecorSync for the element-specific direction on every drawShape', () => {
    const sentinel = { tagName: 'g' } as unknown as SVGElement
    const bpmnRenderer = { drawShape: vi.fn(() => sentinel), drawConnection: vi.fn() }
    const getDirectionFor = vi.fn(() => 'up' as const)
    const renderer = new OrgRenderer(
      { on: vi.fn() },
      bpmnRenderer,
      { getDirectionFor, getOrientation: () => 'horizontal' }
    )
    const element: OrgElementLike = {
      type: 'bpmn:Task',
      width: 100,
      height: 80,
      businessObject: { $type: 'bpmn:Task', $attrs: {} }
    }
    renderer.drawShape({} as unknown as SVGElement, element)
    expect(getDirectionFor).toHaveBeenCalledWith(element)
  })
})
