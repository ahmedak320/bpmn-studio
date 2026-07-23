import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  planDecorations,
  canRenderOrg,
  OrgRenderer,
  OrgRenderModule,
  type Decoration
} from '../orgRenderer'
import { orbitpmModdleDescriptor, ORG_ATTR_NAMES } from '../orbitpmModdle'
import { PALETTE } from '../palette'
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
    // Exactly the 10 contract attributes, no extras.
    expect(type.properties).toHaveLength(ORG_ATTR_NAMES.length)
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

  it('start-event dmthub trigger yields a tag carrying the trigger service', () => {
    const d = planDecorations(
      { trigger: 'dmthub', triggerService: 'GrievanceIntake' },
      'bpmn:StartEvent',
      36,
      36
    )
    const tags = byKind(d, 'tag')
    expect(tags).toHaveLength(1)
    const tag = tags[0]
    if (tag.kind !== 'tag') throw new Error('expected tag')
    expect(tag.label).toBe('DMT HUB')
    expect(tag.detail).toBe('GrievanceIntake')
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

  it('never renders labels, connections or non-bpmn elements', () => {
    expect(canRenderOrg({ type: 'bpmn:Task', labelTarget: {} }, true)).toBe(false)
    expect(canRenderOrg({ type: 'bpmn:SequenceFlow', waypoints: [] }, true)).toBe(false)
    expect(canRenderOrg({ type: 'label' }, true)).toBe(false)
    expect(canRenderOrg(null, true)).toBe(false)
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
  it('registers orgRenderer as a type-injected service', () => {
    expect(OrgRenderModule.__init__).toEqual(['orgRenderer'])
    expect(OrgRenderModule.orgRenderer[0]).toBe('type')
    expect(OrgRenderModule.orgRenderer[1]).toBe(OrgRenderer)
    expect(OrgRenderer.$inject).toEqual(['eventBus', 'bpmnRenderer'])
  })
})
