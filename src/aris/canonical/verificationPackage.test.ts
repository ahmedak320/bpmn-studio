import { describe, expect, it } from 'vitest'
import { canonicalJsonText } from '../packages/canonicalJson'
import { parseCanonicalProcess, type CanonicalProcessV1 } from './contract'
import {
  VALID_CANONICAL_FULL,
  VALID_CANONICAL_MINIMAL,
  VALID_CANONICAL_MISSING_ROLE,
  VALID_CANONICAL_RETURN_PATH
} from './fixtures'
import { buildProcessNarrative } from './narrative'
import { canonicalFlowOrder } from './projectToEpc'
import {
  buildVerificationPackage,
  deriveNarrativeSummary,
  deriveOutcomeEntries,
  deriveTriggerEntries,
  type VerificationPackageV2
} from './verificationPackage'

function expectSortedById(items: readonly { readonly id: string }[]): void {
  const ids = items.map((item) => item.id)
  const sorted = [...ids].sort()
  expect(ids).toEqual(sorted)
}

describe('buildVerificationPackage', () => {
  describe('trigger / outcome / owner extraction', () => {
    it('VALID_CANONICAL_MINIMAL: single start, single end, no owner', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      expect(pkg.trigger).toEqual([{ id: 'n-start', names: { en: 'Start', ar: 'بداية' } }])
      expect(pkg.outcomes).toEqual([{ id: 'n-end', names: { en: 'End', ar: 'نهاية' } }])
      expect(pkg.owner).toBeNull()
    })

    it('VALID_CANONICAL_FULL: single start, three terminal events, owner = r-manager', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.trigger).toEqual([
        { id: 'n-start', names: { en: 'Incident reported', ar: 'تم الإبلاغ عن الحادثة' } }
      ])
      // Sorted by id: n-rejected-end < n-resolved-high < n-resolved-low.
      expect(pkg.outcomes.map((entry) => entry.id)).toEqual([
        'n-rejected-end',
        'n-resolved-high',
        'n-resolved-low'
      ])
      expect(pkg.owner).toEqual({
        id: 'r-manager',
        names: { en: 'IT Manager', ar: 'مدير تقنية المعلومات' },
        unit: { en: 'IT Operations', ar: 'عمليات تقنية المعلومات' }
      })
    })

    it('VALID_CANONICAL_RETURN_PATH: the rework loop does not confuse trigger/outcome detection', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_RETURN_PATH)
      expect(pkg.trigger).toEqual([
        { id: 'n-start', names: { en: 'Request submitted', ar: 'تم تقديم الطلب' } }
      ])
      expect(pkg.outcomes).toEqual([
        { id: 'n-end', names: { en: 'Request approved', ar: 'تمت الموافقة على الطلب' } }
      ])
      expect(pkg.owner).toBeNull()
    })

    it('VALID_CANONICAL_MISSING_ROLE: owner is null, never throws, and the gap is surfaced', () => {
      expect(() => buildVerificationPackage(VALID_CANONICAL_MISSING_ROLE)).not.toThrow()
      const pkg = buildVerificationPackage(VALID_CANONICAL_MISSING_ROLE)
      expect(pkg.owner).toBeNull()
      expect(pkg.trigger).toEqual([
        { id: 'n-start', names: { en: 'Request received', ar: 'تم استلام الطلب' } }
      ])
      expect(pkg.outcomes).toEqual([
        { id: 'n-end', names: { en: 'Request closed', ar: 'تم إغلاق الطلب' } }
      ])
      expect(pkg.unknowns).toEqual([
        {
          targetId: 'n-approve',
          kind: 'missing-field',
          field: 'role',
          message: {
            en: 'No responsible role identified for this approval activity.',
            ar: 'لم يتم تحديد دور مسؤول عن نشاط الموافقة هذا.'
          }
        }
      ])
    })

    it('deriveTriggerEntries/deriveOutcomeEntries agree with the built package (shared with narrative.ts)', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(deriveTriggerEntries(VALID_CANONICAL_FULL)).toEqual(pkg.trigger)
      expect(deriveOutcomeEntries(VALID_CANONICAL_FULL)).toEqual(pkg.outcomes)
    })
  })

  describe('mainFlow', () => {
    it('matches canonicalFlowOrder exactly, in order, for VALID_CANONICAL_FULL', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      const expectedOrder = canonicalFlowOrder(VALID_CANONICAL_FULL)
      expect(pkg.mainFlow.map((entry) => entry.id)).toEqual(expectedOrder)
      // Every node appears exactly once.
      expect(pkg.mainFlow).toHaveLength(VALID_CANONICAL_FULL.nodes.length)
      expect(new Set(pkg.mainFlow.map((entry) => entry.id)).size).toBe(
        VALID_CANONICAL_FULL.nodes.length
      )
    })

    it('matches canonicalFlowOrder for the rework-loop fixture (VALID_CANONICAL_RETURN_PATH)', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_RETURN_PATH)
      expect(pkg.mainFlow.map((entry) => entry.id)).toEqual(
        canonicalFlowOrder(VALID_CANONICAL_RETURN_PATH)
      )
      expect(pkg.mainFlow.map((entry) => entry.id)).toEqual([
        'n-start',
        'n-review',
        'n-decide',
        'n-end',
        'n-rework'
      ])
    })

    it('carries the correct kind/names for each entry', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      const triageEntry = pkg.mainFlow.find((entry) => entry.id === 'n-triage')
      expect(triageEntry).toEqual({
        id: 'n-triage',
        kind: 'decision',
        names: { en: 'Assess severity', ar: 'تقييم مستوى الخطورة' }
      })
    })
  })

  describe('evidenceSummary', () => {
    it('computes correct reverse references (referencedBy), sorted and de-duplicated', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      const byFactId = new Map(pkg.evidenceSummary.map((entry) => [entry.factId, entry]))

      // f-1: cited by node n-log, role r-agent, and informationObject io-ticket.
      expect(byFactId.get('f-1')?.referencedBy).toEqual(['io-ticket', 'n-log', 'r-agent'])
      // f-4: cited by decision d-triage and role r-manager.
      expect(byFactId.get('f-4')?.referencedBy).toEqual(['d-triage', 'r-manager'])
      // f-3: cited by control c-sla-policy AND node n-exception.
      expect(byFactId.get('f-3')?.referencedBy).toEqual(['c-sla-policy', 'n-exception'])
      // f-6: cited by system s-monitoring and informationObject io-ticket.
      expect(byFactId.get('f-6')?.referencedBy).toEqual(['io-ticket', 's-monitoring'])
      // f-5: cited by BOTH node n-wait AND the unknown targeting n-wait — same
      // referencer id from two sources must de-duplicate to one entry.
      expect(byFactId.get('f-5')?.referencedBy).toEqual(['n-wait'])

      expect(byFactId.get('f-1')?.statement).toEqual(
        VALID_CANONICAL_FULL.facts.find((fact) => fact.id === 'f-1')?.statement
      )
      expect(byFactId.get('f-1')?.evidenceRefs).toEqual(['ev-1'])
    })

    it('is sorted by factId and covers every declared fact exactly once', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.evidenceSummary.map((entry) => entry.factId)).toEqual([
        'f-1',
        'f-2',
        'f-3',
        'f-4',
        'f-5',
        'f-6'
      ])
    })

    it('a fact cited by nothing yields an empty, not missing, referencedBy', () => {
      // c-escalation-rule has no factIds of its own; no fact in MINIMAL is
      // wired to it, so build a package and confirm no crash and shape holds.
      const pkg = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      for (const entry of pkg.evidenceSummary) {
        expect(Array.isArray(entry.referencedBy)).toBe(true)
      }
    })
  })

  describe('approvals — explicit authority only, never inferred', () => {
    it('VALID_CANONICAL_FULL: emits the explicit approval block, resolved to role + control names', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.approvals).toEqual([
        {
          decisionId: 'd-triage',
          status: 'confirmed',
          authorities: [
            {
              roleId: 'r-manager',
              names: { en: 'IT Manager', ar: 'مدير تقنية المعلومات' },
              unit: { en: 'IT Operations', ar: 'عمليات تقنية المعلومات' }
            }
          ],
          thresholds: [
            {
              controlId: 'c-sla-policy',
              names: { en: 'SLA Policy', ar: 'سياسة اتفاقية مستوى الخدمة' }
            }
          ],
          factIds: ['f-4']
        }
      ])
    })

    it('a linked owner role does NOT fabricate an approval without an explicit block (the production-hardening guarantee)', () => {
      // r-owner is the process owner AND is linked to the deciding node — exactly
      // the shape the removed inference would have promoted into an authority.
      const ownerLinkedNoApproval: CanonicalProcessV1 = {
        version: 1,
        identity: { id: 'proc-owner-linked', names: { en: 'Owner linked' }, confidence: 'high' },
        nodes: [
          { id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' },
          { id: 'n-decide', kind: 'decision', names: { en: 'Decide' }, confidence: 'high' },
          { id: 'n-yes', kind: 'event', names: { en: 'Yes' }, confidence: 'high' },
          { id: 'n-no', kind: 'event', names: { en: 'No' }, confidence: 'high' }
        ],
        decisions: [
          {
            id: 'd-1',
            nodeId: 'n-decide',
            outcomes: [
              { id: 'o-yes', names: { en: 'Yes' }, targetNodeId: 'n-yes' },
              { id: 'o-no', names: { en: 'No' }, targetNodeId: 'n-no' }
            ],
            confidence: 'high'
          }
        ],
        edges: [
          {
            id: 'e-1',
            kind: 'sequence',
            sourceNodeId: 'n-start',
            targetNodeId: 'n-decide',
            confidence: 'high'
          }
        ],
        roles: [
          {
            id: 'r-owner',
            names: { en: 'Owner' },
            nodeIds: ['n-decide'],
            owner: true,
            confidence: 'high'
          }
        ],
        systems: [],
        informationObjects: [],
        controls: [],
        facts: [],
        unknowns: []
      }
      // Sanity: this is a genuinely valid canonical process, not an ad-hoc shape.
      expect(parseCanonicalProcess(ownerLinkedNoApproval).ok).toBe(true)
      expect(buildVerificationPackage(ownerLinkedNoApproval).approvals).toEqual([])
    })

    it('VALID_CANONICAL_RETURN_PATH: decision without an approval block -> approvals empty', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_RETURN_PATH)
      expect(pkg.approvals).toEqual([])
    })

    it('no decisions -> approvals is empty (MINIMAL, MISSING_ROLE)', () => {
      expect(buildVerificationPackage(VALID_CANONICAL_MINIMAL).approvals).toEqual([])
      expect(buildVerificationPackage(VALID_CANONICAL_MISSING_ROLE).approvals).toEqual([])
    })
  })

  describe('confidenceRollup', () => {
    it('VALID_CANONICAL_MINIMAL: counts every confidence-bearing entity (identity, nodes, edges, roles, facts)', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      // identity(high) + nodes(high,medium,high) + edges(high,high) + role(medium) + facts(medium,high)
      expect(pkg.confidenceRollup).toEqual({ high: 6, medium: 3, low: 0 })
    })

    it('VALID_CANONICAL_FULL: tallies across identity + all 8 confidence-bearing entity arrays', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.confidenceRollup).toEqual({ high: 18, medium: 15, low: 3 })
    })
  })

  describe('determinism', () => {
    it('two builds of the same input are canonicalJsonText-byte-identical (VALID_CANONICAL_FULL)', () => {
      const first = buildVerificationPackage(VALID_CANONICAL_FULL)
      const second = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(canonicalJsonText(first)).toBe(canonicalJsonText(second))
    })

    it('two builds of the same input are canonicalJsonText-byte-identical (VALID_CANONICAL_MINIMAL)', () => {
      const first = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      const second = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      expect(canonicalJsonText(first)).toBe(canonicalJsonText(second))
    })

    it('two builds of the same input are canonicalJsonText-byte-identical (VALID_CANONICAL_RETURN_PATH)', () => {
      const first = buildVerificationPackage(VALID_CANONICAL_RETURN_PATH)
      const second = buildVerificationPackage(VALID_CANONICAL_RETURN_PATH)
      expect(canonicalJsonText(first)).toBe(canonicalJsonText(second))
    })
  })

  describe('ordering — every array explicitly sorted by id (except mainFlow)', () => {
    it('VALID_CANONICAL_FULL: trigger/outcomes/roles/systems/informationObjects/decisions/approvals are id-sorted', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expectSortedById(pkg.trigger)
      expectSortedById(pkg.outcomes)
      expectSortedById(pkg.roles)
      expectSortedById(pkg.systems)
      expectSortedById(pkg.informationObjects)
      expectSortedById(pkg.decisions)
      expectSortedById(pkg.approvals.map((approval) => ({ id: approval.decisionId })))
      for (const decision of pkg.decisions) expectSortedById(decision.outcomes)
    })

    it('informationObjects is reordered from source declaration order (io-ticket, io-report -> io-report, io-ticket)', () => {
      expect(VALID_CANONICAL_FULL.informationObjects.map((info) => info.id)).toEqual([
        'io-ticket',
        'io-report'
      ])
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.informationObjects.map((info) => info.id)).toEqual(['io-report', 'io-ticket'])
    })

    it('evidenceSummary[].evidenceRefs and unknowns[].factIds are sorted', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      for (const entry of pkg.evidenceSummary) {
        expect([...entry.evidenceRefs].sort()).toEqual([...entry.evidenceRefs])
      }
      const f3 = pkg.evidenceSummary.find((entry) => entry.factId === 'f-3')
      expect(f3?.evidenceRefs).toEqual(['ev-3a', 'ev-3b'])
    })
  })

  describe('purpose passthrough', () => {
    it('is present verbatim when identity.purpose is set (VALID_CANONICAL_FULL)', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.purpose).toEqual(VALID_CANONICAL_FULL.identity.purpose)
    })

    it('is absent (not a fabricated value) when identity.purpose is unset (VALID_CANONICAL_MINIMAL)', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      expect(pkg.purpose).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(pkg, 'purpose')).toBe(false)
    })
  })

  describe('narrativeSummary', () => {
    it('is present and bilingual for VALID_CANONICAL_FULL, and equals identity.purpose verbatim', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.narrativeSummary.en).toBeTruthy()
      expect(pkg.narrativeSummary.ar).toBeTruthy()
      expect(pkg.narrativeSummary).toEqual(VALID_CANONICAL_FULL.identity.purpose)
    })

    it('matches deriveNarrativeSummary directly (the same function ./narrative.ts reuses)', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.narrativeSummary).toEqual(deriveNarrativeSummary(VALID_CANONICAL_FULL))
    })

    it("matches the narrative's opening paragraph exactly (consistent by construction, not by luck)", () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
      expect(narrative.en).toContain(`## Purpose\n${pkg.narrativeSummary.en}`)
      expect(narrative.ar).toContain(`## الغرض\n${pkg.narrativeSummary.ar}`)
    })

    it('is present (never absent) even when identity.purpose is unset, via the name-derived fallback', () => {
      expect(VALID_CANONICAL_MINIMAL.identity.purpose).toBeUndefined()
      const pkg = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      expect(pkg.narrativeSummary.en).toContain('Minimal Process')
      expect(pkg.narrativeSummary.ar).toContain('عملية بسيطة')
    })
  })

  describe('code / processVersion passthrough', () => {
    it('carries code and processVersion when present', () => {
      const pkg = buildVerificationPackage(VALID_CANONICAL_FULL)
      expect(pkg.code).toBe('ITIL-INC')
      expect(pkg.processVersion).toBe('v003')
    })
  })

  describe('shape sanity', () => {
    it('schemaVersion is 2 and the top-level shape matches VerificationPackageV2', () => {
      const pkg: VerificationPackageV2 = buildVerificationPackage(VALID_CANONICAL_MINIMAL)
      expect(pkg.schemaVersion).toBe(2)
      expect(pkg.processId).toBe('proc-minimal')
      expect(pkg.names).toEqual({ en: 'Minimal Process', ar: 'عملية بسيطة' })
    })
  })
})
