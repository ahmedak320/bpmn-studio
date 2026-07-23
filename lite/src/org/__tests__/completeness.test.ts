import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  planMissingInfo,
  planMissingBadge,
  planDecorations,
  canRenderOrg,
  OrgRenderer,
  MISSING_BADGE_SIZE,
  isMissingBadgeEligibleType,
  type Decoration,
  type MissingCategory
} from '../orgRenderer'
import { isCompletenessOn, setCompletenessOn, isOrgStylingOn, setOrgStyling } from '../orgSettings'
import { PALETTE } from '../palette'
import { t } from '../../i18n'
import type { OrgProps, OrgElementLike } from '../orgModel'

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

const GATEWAYS = [
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ComplexGateway'
] as const

const PLAIN_ACTIVITIES = [
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:ScriptTask',
  'bpmn:SubProcess',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess'
] as const

/** owner+respList+inputs+outputs — a fully complete plain activity. */
const COMPLETE_ACTIVITY: OrgProps = {
  owner: 'Ahmed',
  inputs: 'Form A',
  outputs: 'Approval memo'
}

// --- planMissingInfo matrix --------------------------------------------------

describe('planMissingInfo', () => {
  it('bare plain activity is missing owner + inputs + outputs (in that order)', () => {
    for (const type of PLAIN_ACTIVITIES) {
      expect(planMissingInfo({}, type)).toEqual(['owner', 'inputs', 'outputs'])
    }
  })

  it('owner OR respList satisfies the responsible-party category', () => {
    expect(planMissingInfo({ owner: 'Ahmed' }, 'bpmn:Task')).toEqual(['inputs', 'outputs'])
    expect(planMissingInfo({ respList: 'Sara — Approver\nOmar' }, 'bpmn:Task')).toEqual([
      'inputs',
      'outputs'
    ])
    // both empty -> missing
    expect(planMissingInfo({ owner: '', respList: '' }, 'bpmn:Task')).toContain('owner')
  })

  it('each list category clears independently', () => {
    expect(planMissingInfo({ inputs: 'Form A' }, 'bpmn:Task')).toEqual(['owner', 'outputs'])
    expect(planMissingInfo({ outputs: 'Memo' }, 'bpmn:Task')).toEqual(['owner', 'inputs'])
  })

  it('whitespace-only list values still count as missing (matches render emptiness)', () => {
    expect(planMissingInfo({ respList: '  \n  ', inputs: ' \n', outputs: '\n' }, 'bpmn:Task')).toEqual([
      'owner',
      'inputs',
      'outputs'
    ])
  })

  it('a fully complete activity yields []', () => {
    expect(planMissingInfo(COMPLETE_ACTIVITY, 'bpmn:Task')).toEqual([])
    expect(
      planMissingInfo({ respList: 'Sara', inputs: 'A', outputs: 'B' }, 'bpmn:UserTask')
    ).toEqual([])
  })

  it('CallActivity is exempt from every category', () => {
    expect(planMissingInfo({}, 'bpmn:CallActivity')).toEqual([])
    expect(isMissingBadgeEligibleType('bpmn:CallActivity')).toBe(false)
  })

  it('every gateway type is missing only the decision basis when bare', () => {
    for (const type of GATEWAYS) {
      expect(planMissingInfo({}, type)).toEqual(['basis'])
      expect(planMissingInfo({ decisionBasis: 'Delegation matrix §3' }, type)).toEqual([])
    }
  })

  it('BusinessRuleTask combines activity categories with the decision basis', () => {
    expect(planMissingInfo({}, 'bpmn:BusinessRuleTask')).toEqual([
      'owner',
      'inputs',
      'outputs',
      'basis'
    ])
    expect(
      planMissingInfo({ ...COMPLETE_ACTIVITY, decisionBasis: 'Policy' }, 'bpmn:BusinessRuleTask')
    ).toEqual([])
  })

  it('StartEvent is missing only the trigger when bare', () => {
    expect(planMissingInfo({}, 'bpmn:StartEvent')).toEqual(['trigger'])
    expect(planMissingInfo({ trigger: 'manual' }, 'bpmn:StartEvent')).toEqual([])
    expect(planMissingInfo({ trigger: 'dmthub', triggerService: 'Svc' }, 'bpmn:StartEvent')).toEqual([])
  })

  it('ineligible types never report anything', () => {
    for (const type of [
      'bpmn:EndEvent',
      'bpmn:IntermediateThrowEvent',
      'bpmn:IntermediateCatchEvent',
      'bpmn:BoundaryEvent',
      'bpmn:TextAnnotation',
      'bpmn:Participant',
      'bpmn:Lane',
      'bpmn:DataObjectReference'
    ]) {
      expect(planMissingInfo({}, type)).toEqual([])
      expect(isMissingBadgeEligibleType(type)).toBe(false)
    }
  })
})

// --- planMissingBadge --------------------------------------------------------

describe('planMissingBadge', () => {
  it('is null when nothing is missing (or the type is ineligible)', () => {
    expect(planMissingBadge(COMPLETE_ACTIVITY, 'bpmn:Task', 100)).toBeNull()
    expect(planMissingBadge({}, 'bpmn:CallActivity', 100)).toBeNull()
    expect(planMissingBadge({}, 'bpmn:EndEvent', 36)).toBeNull()
    expect(planMissingBadge({ trigger: 'manual' }, 'bpmn:StartEvent', 36)).toBeNull()
  })

  it('floats OFF the top-right corner: right of the right edge, above the top edge', () => {
    const badge = planMissingBadge({}, 'bpmn:Task', 100)
    if (!badge || badge.kind !== 'missingBadge') throw new Error('expected missingBadge')
    expect(badge.size).toBe(MISSING_BADGE_SIZE)
    expect(badge.x).toBe(102) // width + 2 — fully outside the right edge
    expect(badge.y).toBe(-20) // top edge at -20, bottom edge at -4 — fully above y=0
    expect(badge.y + badge.size).toBeLessThan(0)
    expect(badge.x).toBeGreaterThan(100)
  })

  it('reuses the amber decision-basis palette pair', () => {
    const badge = planMissingBadge({}, 'bpmn:ExclusiveGateway', 50)
    if (!badge || badge.kind !== 'missingBadge') throw new Error('expected missingBadge')
    expect(badge.fill).toBe(PALETTE.basisFill)
    expect(badge.stroke).toBe(PALETTE.basisBorder)
  })

  it('carries the missing-category count and the localized comma-joined tooltip', () => {
    const badge = planMissingBadge({}, 'bpmn:Task', 100)
    if (!badge || badge.kind !== 'missingBadge') throw new Error('expected missingBadge')
    expect(badge.count).toBe(3)
    const list = [t('missing.owner'), t('missing.inputs'), t('missing.outputs')].join(', ')
    expect(badge.titleText).toBe(t('missing.title', { list }))

    const single = planMissingBadge({}, 'bpmn:StartEvent', 36)
    if (!single || single.kind !== 'missingBadge') throw new Error('expected missingBadge')
    expect(single.count).toBe(1)
    expect(single.titleText).toBe(t('missing.title', { list: t('missing.trigger') }))
  })
})

// --- badge geometry never collides with any other decoration -----------------

/** Bounding box [x1, y1, x2, y2] of a decoration, or null for pure recolours.
 *  Chevrons use their background rect; subLabel uses a generous text estimate. */
function extentOf(d: Decoration): [number, number, number, number] | null {
  switch (d.kind) {
    case 'band':
    case 'tag':
    case 'ownerBox':
    case 'listBox':
      return [d.x, d.y, d.x + d.w, d.y + d.h]
    case 'chevrons':
      return [d.x - 2, d.y - 13, d.x - 2 + d.size, d.y - 13 + d.size]
    case 'raci':
      return [d.x, d.y, d.x + d.size, d.y + d.size]
    case 'subLabel':
      return [d.x, d.y - 9, d.x + 250, d.y + 4]
    case 'missingBadge':
      return [d.x, d.y, d.x + d.size, d.y + d.size]
    case 'ccStyle':
    case 'noteStyle':
      return null
  }
}

function overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

describe('missing badge geometry vs every existing decoration', () => {
  it('never overlaps any decoration across the full prop-combination grid', () => {
    const bools = [false, true] as const
    // A deliberately over-long unknown channel clamps its tag to the FULL shape
    // width — the worst case for anything near the top edge.
    const channels = ['', 'dmthub', 'a-very-long-unknown-channel-kind-name-x'] as const
    const cases: Array<{ type: string; w: number; h: number }> = [
      { type: 'bpmn:Task', w: 100, h: 80 },
      { type: 'bpmn:BusinessRuleTask', w: 100, h: 80 },
      { type: 'bpmn:ExclusiveGateway', w: 50, h: 50 },
      { type: 'bpmn:SubProcess', w: 350, h: 200 }
    ]
    let checked = 0
    for (const { type, w, h } of cases) {
      for (const channel of channels) {
        for (const cc of bools) {
          for (const ccList of bools) {
            for (const owner of bools) {
              for (const respList of bools) {
                for (const inputs of bools) {
                  for (const outputs of bools) {
                    for (const basis of bools) {
                      const props: OrgProps = {
                        channel: channel || undefined,
                        channelDetail: channel ? 'inbox' : undefined,
                        kind: cc ? 'cc' : undefined,
                        ccTo: cc ? 'Legal' : undefined,
                        ccList: ccList ? 'Legal\nFinance' : undefined,
                        owner: owner ? 'Ahmed Alkatheeri' : undefined,
                        ownerRole: owner ? 'A' : undefined,
                        respList: respList ? 'Sara — Approver\nOmar\nZayed' : undefined,
                        inputs: inputs ? 'Form A\nB\nC\nD\nE\nF\nG' : undefined,
                        outputs: outputs ? 'Approval memo' : undefined,
                        decisionBasis: basis ? 'Delegation matrix §3' : undefined
                      }
                      const decorations = planDecorations(props, type, w, h)
                      const badge = planMissingBadge(props, type, w)
                      if (!badge) continue
                      const badgeBox = extentOf(badge)!
                      for (const d of decorations) {
                        const box = extentOf(d)
                        if (!box) continue
                        expect(overlaps(badgeBox, box), `${type} badge overlaps ${d.kind}`).toBe(false)
                      }
                      checked++
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    // The grid must actually have exercised badge-bearing combinations.
    expect(checked).toBeGreaterThan(500)
  })

  it('clears the mega-decorated business-rule task from the existing stacking suite', () => {
    // Same props as the e2e-pinned "everything at once" case — which has NO
    // outputs, so the badge co-exists with every other decoration kind at once.
    const props: OrgProps = {
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
    const decorations = planDecorations(props, 'bpmn:BusinessRuleTask', 100, 80)
    // sanity: the heavyweight kinds are all present
    for (const kind of ['band', 'chevrons', 'tag', 'ownerBox', 'raci', 'listBox'] as const) {
      expect(decorations.some((d) => d.kind === kind)).toBe(true)
    }
    const badge = planMissingBadge(props, 'bpmn:BusinessRuleTask', 100)
    if (!badge || badge.kind !== 'missingBadge') throw new Error('expected missingBadge')
    expect(badge.count).toBe(1) // only outputs missing
    const badgeBox = extentOf(badge)!
    for (const d of decorations) {
      const box = extentOf(d)
      if (!box) continue
      expect(overlaps(badgeBox, box), `badge overlaps ${d.kind}`).toBe(false)
    }
    // deep below-shape stacks can never reach it: the badge sits entirely above y=0
    expect(badgeBox[3]).toBeLessThan(0)
  })

  it('start events: trigger tag and badge are mutually exclusive by construction', () => {
    // The trigger tag (which may overhang a narrow event's width) renders only
    // when `trigger` is SET; the start-event badge only when it is MISSING.
    for (const trigger of [undefined, 'dmthub', 'email', 'manual']) {
      const props: OrgProps = trigger ? { trigger, triggerService: 'GrievanceIntake' } : {}
      const decorations = planDecorations(props, 'bpmn:StartEvent', 36, 36)
      const badge = planMissingBadge(props, 'bpmn:StartEvent', 36)
      const hasTriggerTag = decorations.some((d) => d.kind === 'tag')
      expect(hasTriggerTag && badge !== null).toBe(false)
      if (trigger) {
        expect(hasTriggerTag).toBe(true)
        expect(badge).toBeNull()
      } else {
        expect(hasTriggerTag).toBe(false)
        expect(badge).not.toBeNull()
      }
    }
  })
})

// --- canRenderOrg: completeness flag semantics -------------------------------

describe('canRenderOrg with the completeness flag', () => {
  const bare = (type: string): OrgElementLike => ({
    type,
    businessObject: { $type: type, $attrs: {} }
  })
  const withOwner: OrgElementLike = {
    type: 'bpmn:Task',
    businessObject: { $type: 'bpmn:Task', $attrs: { 'orbitpm:owner': 'X' } }
  }

  it('flag OFF (and the legacy 2-arg call) keeps the current behavior for bare elements', () => {
    expect(canRenderOrg(bare('bpmn:Task'), true)).toBe(false)
    expect(canRenderOrg(bare('bpmn:Task'), true, false)).toBe(false)
    expect(canRenderOrg(bare('bpmn:ExclusiveGateway'), true, false)).toBe(false)
    expect(canRenderOrg(bare('bpmn:StartEvent'), true, false)).toBe(false)
    // props still render, flag or not
    expect(canRenderOrg(withOwner, true, false)).toBe(true)
    expect(canRenderOrg(withOwner, true, true)).toBe(true)
  })

  it('flag ON claims bare badge-eligible types: activities, gateways, start events', () => {
    for (const type of [...PLAIN_ACTIVITIES, ...GATEWAYS, 'bpmn:BusinessRuleTask', 'bpmn:StartEvent']) {
      expect(canRenderOrg(bare(type), true, true), type).toBe(true)
    }
  })

  it('flag ON still ignores ineligible bare types (incl. the CallActivity exemption)', () => {
    for (const type of ['bpmn:CallActivity', 'bpmn:EndEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:Participant']) {
      expect(canRenderOrg(bare(type), true, true), type).toBe(false)
    }
  })

  it('org styling stays the master switch: styling OFF beats completeness ON', () => {
    expect(canRenderOrg(bare('bpmn:Task'), false, true)).toBe(false)
    expect(canRenderOrg(withOwner, false, true)).toBe(false)
  })

  it('never claims labels, connections, non-bpmn elements or null', () => {
    expect(canRenderOrg({ type: 'bpmn:Task', labelTarget: {} }, true, true)).toBe(false)
    expect(canRenderOrg({ type: 'bpmn:SequenceFlow', waypoints: [] }, true, true)).toBe(false)
    expect(canRenderOrg({ type: 'label' }, true, true)).toBe(false)
    expect(canRenderOrg(null, true, true)).toBe(false)
  })

  it('text annotations remain claimed regardless of the flag', () => {
    expect(canRenderOrg({ type: 'bpmn:TextAnnotation' }, true, false)).toBe(true)
    expect(canRenderOrg({ type: 'bpmn:TextAnnotation' }, true, true)).toBe(true)
  })
})

// --- OrgRenderer wires BOTH live flags ---------------------------------------

describe('OrgRenderer.canRender consults the completeness flag live', () => {
  afterEach(() => vi.unstubAllGlobals())

  const bareTask: OrgElementLike = {
    type: 'bpmn:Task',
    businessObject: { $type: 'bpmn:Task', $attrs: {} }
  }
  const ownedTask: OrgElementLike = {
    type: 'bpmn:Task',
    businessObject: { $type: 'bpmn:Task', $attrs: { 'orbitpm:owner': 'X' } }
  }

  it('default-ON: a bare task is claimed; toggling the stored flag releases it', () => {
    const store = installMemoryStorage()
    const renderer = new OrgRenderer({ on: vi.fn() }, { drawShape: vi.fn(), drawConnection: vi.fn() })

    // unset storage -> completeness defaults ON -> bare task claimed
    expect(renderer.canRender(bareTask)).toBe(true)

    // live read: flipping storage flips the verdict without a new instance
    store.set('orbitpm.lite.completenessOn', 'false')
    expect(renderer.canRender(bareTask)).toBe(false)
    expect(renderer.canRender(ownedTask)).toBe(true) // props still render

    store.set('orbitpm.lite.completenessOn', 'true')
    expect(renderer.canRender(bareTask)).toBe(true)

    // master styling switch off -> nothing renders, completeness or not
    store.set('orbitpm.lite.orgStyling', 'false')
    expect(renderer.canRender(bareTask)).toBe(false)
    expect(renderer.canRender(ownedTask)).toBe(false)
  })

  it('drawShape still delegates to the base renderer for a bare task under either flag state', () => {
    const store = installMemoryStorage()
    const sentinel = { tagName: 'g' } as unknown as SVGElement
    const bpmnRenderer = { drawShape: vi.fn(() => sentinel), drawConnection: vi.fn() }
    const renderer = new OrgRenderer({ on: vi.fn() }, bpmnRenderer)
    const parentGfx = {} as unknown as SVGElement

    // completeness ON (default): badge decoration planned; applyDecorations'
    // per-decoration guard swallows the DOM-less environment. Base draw intact.
    expect(renderer.drawShape(parentGfx, bareTask)).toBe(sentinel)

    store.set('orbitpm.lite.completenessOn', 'false')
    expect(renderer.drawShape(parentGfx, bareTask)).toBe(sentinel)
    expect(bpmnRenderer.drawShape).toHaveBeenCalledTimes(2)
  })
})

// --- orgSettings: persistence round-trip -------------------------------------

describe('completeness settings flag', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('defaults ON when unset, and when storage is entirely unavailable', () => {
    installMemoryStorage()
    expect(isCompletenessOn()).toBe(true)
    vi.unstubAllGlobals()
    // node env: no localStorage global at all -> guarded read -> ON
    expect(isCompletenessOn()).toBe(true)
  })

  it('round-trips through the orbitpm.lite.completenessOn key', () => {
    const store = installMemoryStorage()
    setCompletenessOn(false)
    expect(store.get('orbitpm.lite.completenessOn')).toBe('false')
    expect(isCompletenessOn()).toBe(false)
    setCompletenessOn(true)
    expect(store.get('orbitpm.lite.completenessOn')).toBe('true')
    expect(isCompletenessOn()).toBe(true)
    // legacy-style falsy raw values read as OFF
    store.set('orbitpm.lite.completenessOn', '0')
    expect(isCompletenessOn()).toBe(false)
  })

  it('is independent of the org-styling flag', () => {
    installMemoryStorage()
    setOrgStyling(false)
    expect(isCompletenessOn()).toBe(true)
    setCompletenessOn(false)
    expect(isOrgStylingOn()).toBe(false)
    setOrgStyling(true)
    expect(isCompletenessOn()).toBe(false)
  })

  it('a throwing storage reads ON and writes without throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      }
    })
    expect(isCompletenessOn()).toBe(true)
    expect(() => setCompletenessOn(false)).not.toThrow()
  })
})

// --- type-level guard: the category names match the i18n key suffixes --------

describe('MissingCategory names', () => {
  it('resolve to real localized labels (no raw-key fallbacks)', () => {
    const categories: MissingCategory[] = ['owner', 'inputs', 'outputs', 'basis', 'trigger']
    for (const c of categories) {
      const label = t(`missing.${c}` as Parameters<typeof t>[0])
      expect(label).not.toBe(`missing.${c}`)
      expect(label.length).toBeGreaterThan(0)
    }
  })
})
