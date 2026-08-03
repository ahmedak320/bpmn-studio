import { describe, expect, it } from 'vitest'

import { canonicalJsonBytes, canonicalJsonText } from '../packages/canonicalJson'
import { ar, en } from '../../i18n/dictionaries'
import { VALID_CANONICAL_FULL, VALID_CANONICAL_MINIMAL } from './fixtures'
import {
  EPC_FINDING_MESSAGES_AR,
  EPC_FINDING_MESSAGES_EN,
  EPC_FINDING_MESSAGE_KEYS,
  epcFindingMessages,
  interpolateFindingMessage
} from './findingMessages'
import { validateProjectedDraft, type EpcProjectionFindings } from './findings'
import { projectCanonicalToDraft, type CanonicalProjectionResult } from './projectToEpc'

/**
 * Every `aris.epc.finding.*` messageKey `validateEpcGraph` can produce — the
 * rule table in `src/aris/epc/validate.ts` (9 classic rules + the 2 W18 rules).
 * If a rule is added there without a message here, the drift test fails.
 */
const EXPECTED_EPC_MESSAGE_KEYS = [
  'aris.epc.finding.alternationViolation',
  'aris.epc.finding.missingStartEvent',
  'aris.epc.finding.missingEndEvent',
  'aris.epc.finding.ruleSplitMergeConflict',
  'aris.epc.finding.eventPrecedesDecisionSplit',
  'aris.epc.finding.orphanNode',
  'aris.epc.finding.unrecognizedRuleSymbol',
  'aris.epc.finding.missingConnectionType',
  'aris.epc.finding.danglingLinkedModel',
  'aris.epc.finding.unlabeledDecisionBranch',
  'aris.epc.finding.unreachableEnd'
] as const

async function subtleSha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('findingMessages — drift vs. src/i18n/dictionaries.ts', () => {
  it('defines EN + AR for exactly the messageKeys validateEpcGraph can produce', () => {
    expect([...EPC_FINDING_MESSAGE_KEYS].sort()).toEqual([...EXPECTED_EPC_MESSAGE_KEYS].sort())
    for (const key of EXPECTED_EPC_MESSAGE_KEYS) {
      expect(EPC_FINDING_MESSAGES_EN[key], `EN ${key}`).toBeDefined()
      expect(EPC_FINDING_MESSAGES_AR[key], `AR ${key}`).toBeDefined()
    }
  })

  it('every messageKey exists in the live dictionaries with identical EN + AR text', () => {
    const enDict = en as Record<string, string>
    const arDict = ar as Record<string, string>
    for (const key of EPC_FINDING_MESSAGE_KEYS) {
      expect(enDict[key], `dictionaries.en ${key}`).toBeDefined()
      expect(arDict[key], `dictionaries.ar ${key}`).toBeDefined()
      expect(EPC_FINDING_MESSAGES_EN[key]).toBe(enDict[key])
      expect(EPC_FINDING_MESSAGES_AR[key]).toBe(arDict[key])
    }
  })

  it('interpolates {param} tokens exactly like the dictionaries convention', () => {
    const messages = epcFindingMessages('aris.epc.finding.alternationViolation', {
      objectType: 'OT_FUNC'
    })
    expect(messages.en).toContain('share the type OT_FUNC;')
    expect(messages.ar).toContain('في النوع OT_FUNC؛')
    // an unmatched token is left verbatim; a missing key degrades to the key
    expect(interpolateFindingMessage('a {missing} b', {})).toBe('a {missing} b')
    expect(epcFindingMessages('aris.epc.finding.unknownKey').en).toBe('aris.epc.finding.unknownKey')
  })
})

describe('validateProjectedDraft — happy path', () => {
  it('reports ok:true with no findings for a valid canonical process (FULL)', async () => {
    const result = projectCanonicalToDraft(VALID_CANONICAL_FULL)
    const findings = await validateProjectedDraft(result, VALID_CANONICAL_FULL)
    expect(findings.schemaVersion).toBe(1)
    expect(findings.projectionVersion).toBe(1)
    expect(findings.ok).toBe(true)
    expect(findings.findings).toHaveLength(0)
  })

  it('inputSha256 matches an independently computed crypto.subtle digest', async () => {
    const result = projectCanonicalToDraft(VALID_CANONICAL_FULL)
    const findings = await validateProjectedDraft(result, VALID_CANONICAL_FULL)
    const expected = await subtleSha256Hex(canonicalJsonBytes(VALID_CANONICAL_FULL))
    expect(findings.inputSha256).toBe(expected)
    expect(findings.inputSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is canonicalJsonText-stable across two runs', async () => {
    const result = projectCanonicalToDraft(VALID_CANONICAL_MINIMAL)
    const a = await validateProjectedDraft(result, VALID_CANONICAL_MINIMAL)
    const b = await validateProjectedDraft(result, VALID_CANONICAL_MINIMAL)
    expect(canonicalJsonText(a)).toBe(canonicalJsonText(b))
  })
})

describe('validateProjectedDraft — anchor mapping on a hand-mutilated draft', () => {
  it('maps an EPC finding through the anchor tables to canonical + draft ids', async () => {
    const result = projectCanonicalToDraft(VALID_CANONICAL_FULL)
    const mutated: CanonicalProjectionResult = structuredClone(result)

    // Strip the label from one XOR branch (outcome event + its incoming
    // relation) so `checkLabeledDecisionBranches` fires on that branch.
    const outcome = mutated.draft.objects.find((object) => object.logicalId === 'xo:d-triage:o-low')
    ;(outcome as unknown as { names: Record<string, string> }).names = {}
    const branch = mutated.draft.relations.find(
      (relation) => relation.logicalId === 're:x:d-triage:xo:d-triage:o-low'
    )
    delete (branch as { names?: unknown }).names

    const findings: EpcProjectionFindings = await validateProjectedDraft(
      mutated,
      VALID_CANONICAL_FULL
    )
    expect(findings.ok).toBe(false)
    const unlabeled = findings.findings.find(
      (finding) => finding.ruleId === 'epc.rule.unlabeledDecisionBranch'
    )
    expect(unlabeled).toBeDefined()
    expect(unlabeled?.severity).toBe('error')
    expect(unlabeled?.messageKey).toBe('aris.epc.finding.unlabeledDecisionBranch')
    expect(unlabeled?.messageEn.length).toBeGreaterThan(0)
    expect(unlabeled?.messageAr.length).toBeGreaterThan(0)

    // draft ids come straight from the EpcFinding; canonical ids come via anchors
    expect(unlabeled?.draftNodeIds).toContain('x:d-triage')
    expect(unlabeled?.draftNodeIds).toContain('xo:d-triage:o-low')
    expect(unlabeled?.draftEdgeIds).toContain('re:x:d-triage:xo:d-triage:o-low')
    expect(unlabeled?.canonicalNodeIds).toEqual(['d-triage'])
    expect(unlabeled?.canonicalEdgeIds).toEqual(['d-triage'])
  })

  it('flags a structurally-broken draft as ok:false via a draftInvalid finding', async () => {
    const result = projectCanonicalToDraft(VALID_CANONICAL_MINIMAL)
    const mutated: CanonicalProjectionResult = structuredClone(result)
    // an unsupported connection type fails validateArisAiDraft (type vocabulary)
    ;(mutated.draft.relations[0] as { connectionType: string }).connectionType =
      'CT_NOT_A_REAL_TYPE'
    const findings = await validateProjectedDraft(mutated, VALID_CANONICAL_MINIMAL)
    expect(findings.ok).toBe(false)
    expect(
      findings.findings.some((finding) => finding.messageKey === 'aris.projection.draftInvalid')
    ).toBe(true)
  })
})
