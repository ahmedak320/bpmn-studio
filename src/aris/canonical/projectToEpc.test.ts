import { describe, expect, it } from 'vitest'

import { validateArisAiDraft } from '../ai/validateDraft'
import type { ArisAiObject, ArisAiRelation } from '../ai/contract'
import { canonicalJsonText } from '../packages/canonicalJson'
import { buildAmlFromArisAiDraft } from '../shell/arisAiCreate'
import type { CanonicalProcessV1 } from './contract'
import {
  VALID_CANONICAL_FULL,
  VALID_CANONICAL_MINIMAL,
  VALID_CANONICAL_MISSING_ROLE,
  VALID_CANONICAL_RETURN_PATH
} from './fixtures'
import { validateProjectedDraft } from './findings'
import { PROJECTION_VERSION, canonicalFlowOrder, projectCanonicalToDraft } from './projectToEpc'

const full = () => projectCanonicalToDraft(VALID_CANONICAL_FULL)

function obj(objects: readonly ArisAiObject[], logicalId: string): ArisAiObject {
  const found = objects.find((object) => object.logicalId === logicalId)
  if (!found) throw new Error(`missing object ${logicalId}`)
  return found
}

function rel(relations: readonly ArisAiRelation[], logicalId: string): ArisAiRelation {
  const found = relations.find((relation) => relation.logicalId === logicalId)
  if (!found) throw new Error(`missing relation ${logicalId}`)
  return found
}

function typeCount(objects: readonly ArisAiObject[], objectType: string): number {
  return objects.filter((object) => object.objectType === objectType).length
}

describe('PROJECTION_VERSION', () => {
  it('is 1', () => {
    expect(PROJECTION_VERSION).toBe(1)
  })
})

describe('canonicalFlowOrder', () => {
  it('is the depth-first spine from the start event (FULL)', () => {
    expect(canonicalFlowOrder(VALID_CANONICAL_FULL)).toEqual([
      'n-start',
      'n-log',
      'n-triage',
      'n-investigate',
      'n-notify',
      'n-handoff',
      'n-exception',
      'n-rejected-end',
      'n-resolved-high',
      'n-wait',
      'n-resolved-low'
    ])
  })

  it('covers every node exactly once, including the return-path loop', () => {
    const order = canonicalFlowOrder(VALID_CANONICAL_RETURN_PATH)
    expect(order).toEqual(['n-start', 'n-review', 'n-decide', 'n-end', 'n-rework'])
    expect(new Set(order).size).toBe(order.length)
  })

  it('is a pure function of the input (stable across calls)', () => {
    expect(canonicalFlowOrder(VALID_CANONICAL_FULL)).toEqual(
      canonicalFlowOrder(VALID_CANONICAL_FULL)
    )
  })
})

describe('projectCanonicalToDraft — top-level shape (VALID_CANONICAL_FULL)', () => {
  it('emits the expected object/relation/model/attribute/assignment/uncertainty counts', () => {
    const { draft } = full()
    expect(draft.version).toBe(1)
    expect(draft.models).toHaveLength(2)
    expect(draft.objects).toHaveLength(28)
    expect(draft.relations).toHaveLength(31)
    expect(draft.attributes).toHaveLength(1)
    expect(draft.assignments).toHaveLength(1)
    expect(draft.uncertainties).toHaveLength(2)
  })

  it('distributes objects across the expected ARIS object types', () => {
    const { draft } = full()
    expect(typeCount(draft.objects, 'OT_EVT')).toBe(9)
    expect(typeCount(draft.objects, 'OT_FUNC')).toBe(7)
    expect(typeCount(draft.objects, 'OT_RULE')).toBe(4)
    expect(typeCount(draft.objects, 'OT_PERS_TYPE')).toBe(2)
    expect(typeCount(draft.objects, 'OT_APPL_SYS')).toBe(2)
    expect(typeCount(draft.objects, 'OT_INFO_CARR')).toBe(2)
    expect(typeCount(draft.objects, 'OT_POLICY')).toBe(1)
    expect(typeCount(draft.objects, 'OT_BUSINESS_RULE')).toBe(1)
  })

  it('produces a fully-valid ArisAiDraftV1', () => {
    const { draft } = full()
    const result = validateArisAiDraft(draft)
    expect(result.ok).toBe(true)
  })

  it('produces exactly one MT_EEPC primary model owning every object', () => {
    const { draft } = full()
    const primary = draft.models.find((model) => model.logicalId === 'm:proc-full')
    expect(primary?.modelType).toBe('MT_EEPC')
    for (const object of draft.objects) {
      expect(object.modelLogicalId).toBe('m:proc-full')
    }
  })
})

describe('expansion table — one assertion per row (VALID_CANONICAL_FULL)', () => {
  it('event -> OT_EVT / ST_EV', () => {
    const start = obj(full().draft.objects, 'n:n-start')
    expect(start.objectType).toBe('OT_EVT')
    expect(start.symbolType).toBe('ST_EV')
    expect(start.names).toEqual({ en: 'Incident reported', ar: 'تم الإبلاغ عن الحادثة' })
  })

  it('activity -> OT_FUNC / ST_FUNC', () => {
    const log = obj(full().draft.objects, 'n:n-log')
    expect(log.objectType).toBe('OT_FUNC')
    expect(log.symbolType).toBe('ST_FUNC')
  })

  it('wait -> OT_EVT / ST_EV with an AT_DESC "wait:" attribute', () => {
    const wait = obj(full().draft.objects, 'n:n-wait')
    expect(wait.objectType).toBe('OT_EVT')
    expect(wait.symbolType).toBe('ST_EV')
    const desc = wait.attributes.find((attribute) => attribute.attributeType === 'AT_DESC')
    expect(desc).toBeDefined()
    expect(desc?.values.en).toBe('wait: Blocked until the vendor ships a fix.')
    expect(desc?.values.ar).toBe('انتظار: متوقف حتى يصدر المورّد إصلاحاً.')
    expect(desc?.ownerKind).toBe('object')
    expect(desc?.ownerLogicalId).toBe('n:n-wait')
  })

  it('handoff -> OT_FUNC / ST_PRCS_IF + placeholder model + linked-model assignment', () => {
    const { draft } = full()
    const handoff = obj(draft.objects, 'n:n-handoff')
    expect(handoff.objectType).toBe('OT_FUNC')
    expect(handoff.symbolType).toBe('ST_PRCS_IF')
    const placeholder = draft.models.find(
      (model) => model.logicalId === 'm:proc-vendor-escalation-v1'
    )
    expect(placeholder).toBeDefined()
    expect(placeholder?.modelType).toBe('MT_EEPC')
    expect(draft.assignments).toEqual([
      {
        logicalId: 'lm:n-handoff',
        assignmentType: 'linked-model',
        objectLogicalId: 'n:n-handoff',
        assignedModelLogicalId: 'm:proc-vendor-escalation-v1',
        confidence: 'medium'
      }
    ])
  })

  it('decision -> deciding OT_FUNC (+criteria AT_DESC) then XOR + 2 named outcome events', () => {
    const { draft } = full()
    const deciding = obj(draft.objects, 'n:n-triage')
    expect(deciding.objectType).toBe('OT_FUNC')
    const criteria = deciding.attributes.find((attribute) => attribute.attributeType === 'AT_DESC')
    expect(criteria?.values.en).toBe('Severity classification rules')

    const xor = obj(draft.objects, 'x:d-triage')
    expect(xor.objectType).toBe('OT_RULE')
    expect(xor.symbolType).toBe('ST_OPR_XOR_1')

    const high = obj(draft.objects, 'xo:d-triage:o-high')
    const low = obj(draft.objects, 'xo:d-triage:o-low')
    expect(high.objectType).toBe('OT_EVT')
    expect(high.names).toEqual({ en: 'High severity', ar: 'خطورة عالية' })
    expect(low.names).toEqual({ en: 'Low severity', ar: 'خطورة منخفضة' })

    // relations: decidingFunc -> XOR (CT_LEADS_TO_1); XOR -> outcome (CT_ACTIV_1 + label)
    expect(rel(draft.relations, 're:n:n-triage:x:d-triage').connectionType).toBe('CT_LEADS_TO_1')
    const toHigh = rel(draft.relations, 're:x:d-triage:xo:d-triage:o-high')
    expect(toHigh.connectionType).toBe('CT_ACTIV_1')
    expect(toHigh.names).toEqual({ en: 'High severity', ar: 'خطورة عالية' })
    // outcome event -> its target's projection
    expect(rel(draft.relations, 're:xo:d-triage:o-high:n:n-investigate').connectionType).toBe(
      'CT_ACTIV_1'
    )
  })

  it('parallel -> an AND split + AND merge pair', () => {
    const { draft } = full()
    const split = obj(draft.objects, 'ps:n-investigate')
    const merge = obj(draft.objects, 'pm:n-handoff')
    expect(split.objectType).toBe('OT_RULE')
    expect(split.symbolType).toBe('ST_OPR_AND_1')
    expect(merge.objectType).toBe('OT_RULE')
    expect(merge.symbolType).toBe('ST_OPR_AND_1')
    // node -> split, split -> each target; each source -> merge, merge -> node
    expect(rel(draft.relations, 're:n:n-investigate:ps:n-investigate')).toBeDefined()
    expect(rel(draft.relations, 're:ps:n-investigate:n:n-notify')).toBeDefined()
    expect(rel(draft.relations, 're:ps:n-investigate:n:n-wait')).toBeDefined()
    expect(rel(draft.relations, 're:n:n-notify:pm:n-handoff')).toBeDefined()
    expect(rel(draft.relations, 're:n:n-wait:pm:n-handoff')).toBeDefined()
    expect(rel(draft.relations, 're:pm:n-handoff:n:n-handoff')).toBeDefined()
  })

  it('exception -> XOR spliced into the flow + a named exception event to the rejected end', () => {
    const { draft } = full()
    const xor = obj(draft.objects, 'xe:n-exception')
    const event = obj(draft.objects, 'xev:n-exception')
    expect(xor.objectType).toBe('OT_RULE')
    expect(xor.symbolType).toBe('ST_OPR_XOR_1')
    expect(event.objectType).toBe('OT_EVT')
    expect(event.names).toEqual({
      en: 'SLA breach exception',
      ar: 'استثناء خرق اتفاقية مستوى الخدمة'
    })
    // incoming flow feeds the XOR; the XOR routes the exception branch to the event
    expect(rel(draft.relations, 'e:e-7').targetLogicalId).toBe('xe:n-exception')
    expect(rel(draft.relations, 're:xe:n-exception:xev:n-exception')).toBeDefined()
    // the normal branch (e-9) leaves the XOR to the resolved-high end
    expect(rel(draft.relations, 'e:e-9').sourceLogicalId).toBe('xe:n-exception')
    expect(rel(draft.relations, 'e:e-9').targetLogicalId).toBe('n:n-resolved-high')
  })

  it('sequence/handoff edge -> endpoint-typed control-flow relation', () => {
    const { draft } = full()
    // event -> function
    expect(rel(draft.relations, 'e:e-1').connectionType).toBe('CT_ACTIV_1')
    // function -> rule (into the exception XOR)
    expect(rel(draft.relations, 'e:e-7').connectionType).toBe('CT_LEADS_TO_1')
    // rule -> event (out of the exception XOR)
    expect(rel(draft.relations, 'e:e-9').connectionType).toBe('CT_LEADS_TO_2')
  })

  it('data-flow via informationObjects -> OT_INFO_CARR with CT_IS_INP_FOR / CT_HAS_OUT', () => {
    const { draft } = full()
    expect(obj(draft.objects, 'io:io-ticket').objectType).toBe('OT_INFO_CARR')
    // io-ticket is output-of n-log: function -> info, CT_HAS_OUT
    const out = rel(draft.relations, 're:n:n-log:io:io-ticket')
    expect(out.connectionType).toBe('CT_HAS_OUT')
    // io-report is input-to n-notify: info -> function, CT_IS_INP_FOR
    const inp = rel(draft.relations, 're:io:io-report:n:n-notify')
    expect(inp.connectionType).toBe('CT_IS_INP_FOR')
  })

  it('roles -> OT_PERS_TYPE + CT_EXEC_1 per node, owner emits an AT_PERS_RESP model attribute', () => {
    const { draft } = full()
    expect(obj(draft.objects, 'r:r-agent').objectType).toBe('OT_PERS_TYPE')
    expect(rel(draft.relations, 're:r:r-agent:n:n-log').connectionType).toBe('CT_EXEC_1')
    expect(rel(draft.relations, 're:r:r-agent:n:n-investigate').connectionType).toBe('CT_EXEC_1')
    const ownerAttr = draft.attributes.find(
      (attribute) => attribute.attributeType === 'AT_PERS_RESP'
    )
    expect(ownerAttr?.ownerKind).toBe('model')
    expect(ownerAttr?.ownerLogicalId).toBe('m:proc-full')
    expect(ownerAttr?.values).toEqual({ en: 'IT Manager', ar: 'مدير تقنية المعلومات' })
  })

  it('systems -> OT_APPL_SYS + CT_SUPP_3 per node', () => {
    const { draft } = full()
    expect(obj(draft.objects, 's:s-itsm').objectType).toBe('OT_APPL_SYS')
    expect(rel(draft.relations, 're:s:s-itsm:n:n-log').connectionType).toBe('CT_SUPP_3')
    expect(rel(draft.relations, 're:s:s-itsm:n:n-triage').connectionType).toBe('CT_SUPP_3')
  })

  it('controls -> OT_POLICY/CT_AFFECTS and OT_BUSINESS_RULE/CT_IS_EVAL_BY_1', () => {
    const { draft } = full()
    expect(obj(draft.objects, 'c:c-sla-policy').objectType).toBe('OT_POLICY')
    expect(rel(draft.relations, 're:c:c-sla-policy:n:n-triage').connectionType).toBe('CT_AFFECTS')
    expect(obj(draft.objects, 'c:c-escalation-rule').objectType).toBe('OT_BUSINESS_RULE')
    expect(rel(draft.relations, 're:c:c-escalation-rule:xe:n-exception').connectionType).toBe(
      'CT_IS_EVAL_BY_1'
    )
  })

  it('a requirement control -> OT_REQUIREMENT + CT_REFS_TO_2 (row completed)', () => {
    // FULL exercises policy + business-rule; this covers the requirement branch.
    const withRequirement: CanonicalProcessV1 = {
      version: 1,
      identity: { id: 'p-req', names: { en: 'Requirement control process' }, confidence: 'high' },
      nodes: [
        { id: 'a', kind: 'event', names: { en: 'Start' }, confidence: 'high' },
        { id: 'b', kind: 'activity', names: { en: 'Do the thing' }, confidence: 'high' },
        { id: 'c', kind: 'event', names: { en: 'End' }, confidence: 'high' }
      ],
      decisions: [],
      edges: [
        { id: 'e1', kind: 'sequence', sourceNodeId: 'a', targetNodeId: 'b', confidence: 'high' },
        { id: 'e2', kind: 'sequence', sourceNodeId: 'b', targetNodeId: 'c', confidence: 'high' }
      ],
      roles: [],
      systems: [],
      informationObjects: [],
      controls: [
        {
          id: 'req-1',
          names: { en: 'Regulatory requirement' },
          kind: 'requirement',
          nodeIds: ['b'],
          confidence: 'high'
        }
      ],
      facts: [],
      unknowns: []
    }
    const { draft } = projectCanonicalToDraft(withRequirement)
    expect(validateArisAiDraft(draft).ok).toBe(true)
    expect(obj(draft.objects, 'c:req-1').objectType).toBe('OT_REQUIREMENT')
    expect(rel(draft.relations, 're:c:req-1:n:b').connectionType).toBe('CT_REFS_TO_2')
  })

  it('facts -> a comma-joined, sorted evidence string on the causing object', () => {
    const { draft } = full()
    expect(obj(draft.objects, 'n:n-log').evidence).toBe('f-1')
    // io-ticket references f-1 and f-6 -> sorted, comma-joined
    expect(obj(draft.objects, 'io:io-ticket').evidence).toBe('f-1,f-6')
  })

  it('unknowns -> ArisAiUncertainty targeting the projected draft id (kind mapped 1:1)', () => {
    const { draft } = full()
    const byTarget = new Map(draft.uncertainties.map((unc) => [unc.targetLogicalId, unc]))
    expect(byTarget.get('n:n-wait')?.kind).toBe('ambiguous-mapping')
    expect(byTarget.get('n:n-wait')?.field).toBe('waitDetail')
    expect(byTarget.get('io:io-report')?.kind).toBe('missing-field')
  })
})

describe('alternation completion', () => {
  it('splices an fe: event between two functions (func -> func sequence)', () => {
    const { draft } = full()
    const filler = obj(draft.objects, 'fe:e-2')
    expect(filler.objectType).toBe('OT_EVT')
    expect(filler.names).toEqual({
      en: 'Log incident completed',
      ar: 'اكتمل تسجيل الحادثة'
    })
    // the direct n:n-log -> n:n-triage edge is replaced by two alternating hops
    expect(draft.relations.some((r) => r.logicalId === 'e:e-2')).toBe(false)
    expect(rel(draft.relations, 're:n:n-log:fe:e-2').connectionType).toBe('CT_CRT_1')
    expect(rel(draft.relations, 're:fe:e-2:n:n-triage').connectionType).toBe('CT_ACTIV_1')
  })

  it('splices an ff: function between two events (decision outcome -> end event)', () => {
    const { draft } = full()
    const fillerId = 'ff:re:xo:d-triage:o-low:n:n-resolved-low'
    const filler = obj(draft.objects, fillerId)
    expect(filler.objectType).toBe('OT_FUNC')
    expect(filler.names.en).toBe('Handle Incident resolved (low severity)')
    expect(rel(draft.relations, `re:xo:d-triage:o-low:${fillerId}`).connectionType).toBe(
      'CT_ACTIV_1'
    )
    expect(rel(draft.relations, `re:${fillerId}:n:n-resolved-low`).connectionType).toBe('CT_CRT_1')
  })

  it('produces exactly three fillers for FULL and NONE on an already-alternating chain', () => {
    const fillerCount = (objects: readonly ArisAiObject[]): number =>
      objects.filter((o) => o.logicalId.startsWith('fe:') || o.logicalId.startsWith('ff:')).length
    expect(fillerCount(full().draft.objects)).toBe(3)
    // MINIMAL is event -> function -> event: already alternating, no filler.
    expect(fillerCount(projectCanonicalToDraft(VALID_CANONICAL_MINIMAL).draft.objects)).toBe(0)
  })
})

describe('anchors', () => {
  it('cover 100% of draft object and relation ids', () => {
    const { draft, anchors } = full()
    for (const object of draft.objects) {
      expect(anchors.nodeByDraftId[object.logicalId]).toBeDefined()
    }
    for (const relation of draft.relations) {
      expect(anchors.edgeByDraftId[relation.logicalId]).toBeDefined()
    }
  })

  it('map synthesized entities back to their causing canonical id', () => {
    const { anchors } = full()
    // the XOR + outcome events map to the causing decision
    expect(anchors.nodeByDraftId['x:d-triage']).toBe('d-triage')
    expect(anchors.nodeByDraftId['xo:d-triage:o-high']).toBe('d-triage')
    // the exception XOR/event map to the exception node
    expect(anchors.nodeByDraftId['xe:n-exception']).toBe('n-exception')
    expect(anchors.nodeByDraftId['xev:n-exception']).toBe('n-exception')
    // the fe: filler maps to the canonical edge it split
    expect(anchors.nodeByDraftId['fe:e-2']).toBe('e-2')
    // a primary edge relation maps to its canonical edge
    expect(anchors.edgeByDraftId['e:e-1']).toBe('e-1')
  })
})

describe('suggestedOrder', () => {
  it('is set on every flow object and absent on satellites', () => {
    const { draft } = full()
    const flowTypes = new Set(['OT_EVT', 'OT_FUNC', 'OT_RULE'])
    for (const object of draft.objects) {
      if (flowTypes.has(object.objectType)) {
        expect(typeof object.suggestedOrder).toBe('number')
      } else {
        expect(object.suggestedOrder).toBeUndefined()
      }
    }
    // the start event anchors the spine at 0
    expect(obj(draft.objects, 'n:n-start').suggestedOrder).toBe(0)
  })
})

describe('determinism', () => {
  it('two projections are canonicalJsonText-identical (draft)', () => {
    const a = canonicalJsonText(projectCanonicalToDraft(VALID_CANONICAL_FULL).draft)
    const b = canonicalJsonText(projectCanonicalToDraft(VALID_CANONICAL_FULL).draft)
    expect(a).toBe(b)
  })

  it('the AML built from the draft is byte-identical across two full runs', () => {
    const a = buildAmlFromArisAiDraft(projectCanonicalToDraft(VALID_CANONICAL_FULL).draft).xml
    const b = buildAmlFromArisAiDraft(projectCanonicalToDraft(VALID_CANONICAL_FULL).draft).xml
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThan(0)
  })
})

describe('return-path / reachability (milestone amendment, plan line 27)', () => {
  it('keeps the rework loop after projection and reaches the end without a false unreachable-end', async () => {
    const result = projectCanonicalToDraft(VALID_CANONICAL_RETURN_PATH)
    // the return edge n-rework -> n-review survives (via its filler event), closing the loop
    expect(rel(result.draft.relations, 're:n:n-rework:fe:e-3').sourceLogicalId).toBe('n:n-rework')
    expect(rel(result.draft.relations, 're:fe:e-3:n:n-review').targetLogicalId).toBe('n:n-review')

    const findings = await validateProjectedDraft(result, VALID_CANONICAL_RETURN_PATH)
    expect(findings.ok).toBe(true)
    expect(
      findings.findings.some((finding) => finding.ruleId === 'epc.startEnd.unreachableEnd')
    ).toBe(false)
  })

  it('surfaces a missing role as an uncertainty, not a hard failure', () => {
    const { draft } = projectCanonicalToDraft(VALID_CANONICAL_MISSING_ROLE)
    expect(validateArisAiDraft(draft).ok).toBe(true)
    expect(draft.uncertainties).toHaveLength(1)
    expect(draft.uncertainties[0].targetLogicalId).toBe('n:n-approve')
    expect(draft.uncertainties[0].field).toBe('role')
  })
})
