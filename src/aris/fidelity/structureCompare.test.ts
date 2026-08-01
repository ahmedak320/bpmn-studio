/**
 * Unit tests for `structureCompare.ts`'s fuzzy structure-fidelity comparator.
 *
 * Synthetic `ArisWorkingDocument`s are built the SAME way `model/testFixture.ts`
 * builds its own fixture: an inline AML string through the REAL
 * `createArisXmlSourcePackage` + `buildFromSource` pipeline, never a hand-rolled
 * object literal — the real parser is what guarantees the fixture matches the
 * actual `ArisWorkingDocument` shape.
 *
 * Two generated documents exercise the three plan-mandated scenarios:
 *  - `COMPLETE_AML`: Start(event) -> Do the work(function) -> XOR rule -> {Approved,
 *    Rejected}(events), with a Reviewer(OT_PERS_TYPE) satellite on "Do the work".
 *    Structurally identical to `EXPECTED_DOC` -> every metric should be 1.0.
 *  - `MISSING_FUNCTION_AML`: the same process with "Do the work" (and its
 *    Reviewer satellite) removed entirely; Start connects directly to the rule.
 *    Every recall-shaped metric that depends on "Do the work" should drop below
 *    1, and `misses.objects` should name the missing function explicitly.
 */

import { describe, expect, it } from 'vitest'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import type { FidelityExpectationDoc } from './expectationTypes'
import { compareStructure, diceCoefficient, type StructureFactsManifest } from './structureCompare'

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="TestDB" CreateDate="2026-07-28" CreateTime="21:45:00" UserName="tester" ArisExeVersion="0.1.0"/>
  <Language LocaleId="en-US" Codepage="1252">
    <LanguageName>English</LanguageName>
  </Language>
  <Group Group.ID="g1">`
const FOOTER = `
  </Group>
</AML>
`

/** Start -> Do the work -> XOR rule -> {Approved, Rejected}; Reviewer on "Do the work". */
const COMPLETE_AML = `${HEADER}
    <Model Model.ID="m1" Model.Type="MT_EEPC" GridSize="10" Scale="100" PrintScale="100" BackColor="16777215">
      <ObjOcc ObjOcc.ID="occ-start" ObjDef.IdRef="od-start" SymbolNum="ST_EV" Zorder="1" SequenceNumber="1">
        <Position Pos.X="0" Pos.Y="0"/>
        <Size Size.dX="100" Size.dY="50"/>
        <CxnOcc CxnOcc.ID="co-start-dowork" CxnDef.IdRef="cd-start-dowork" ToObjOcc.IdRef="occ-dowork" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="50" Pos.Y="50"/>
          <Position Pos.X="50" Pos.Y="150"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-dowork" ObjDef.IdRef="od-dowork" SymbolNum="ST_FUNC" Zorder="2" SequenceNumber="2">
        <Position Pos.X="0" Pos.Y="150"/>
        <Size Size.dX="100" Size.dY="50"/>
        <CxnOcc CxnOcc.ID="co-dowork-rule" CxnDef.IdRef="cd-dowork-rule" ToObjOcc.IdRef="occ-rule" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="50" Pos.Y="200"/>
          <Position Pos.X="50" Pos.Y="300"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-rule" ObjDef.IdRef="od-rule" SymbolNum="ST_OPR_XOR_1" Zorder="3" SequenceNumber="3">
        <Position Pos.X="0" Pos.Y="300"/>
        <Size Size.dX="100" Size.dY="50"/>
        <CxnOcc CxnOcc.ID="co-rule-approved" CxnDef.IdRef="cd-rule-approved" ToObjOcc.IdRef="occ-approved" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="50" Pos.Y="350"/>
          <Position Pos.X="0" Pos.Y="450"/>
        </CxnOcc>
        <CxnOcc CxnOcc.ID="co-rule-rejected" CxnDef.IdRef="cd-rule-rejected" ToObjOcc.IdRef="occ-rejected" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="50" Pos.Y="350"/>
          <Position Pos.X="200" Pos.Y="450"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-approved" ObjDef.IdRef="od-approved" SymbolNum="ST_EV" Zorder="4" SequenceNumber="4">
        <Position Pos.X="0" Pos.Y="450"/>
        <Size Size.dX="100" Size.dY="50"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-rejected" ObjDef.IdRef="od-rejected" SymbolNum="ST_EV" Zorder="5" SequenceNumber="5">
        <Position Pos.X="200" Pos.Y="450"/>
        <Size Size.dX="100" Size.dY="50"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-reviewer" ObjDef.IdRef="od-reviewer" SymbolNum="ST_PERS_TYPE" Zorder="6" SequenceNumber="6">
        <Position Pos.X="200" Pos.Y="150"/>
        <Size Size.dX="100" Size.dY="50"/>
        <CxnOcc CxnOcc.ID="co-reviewer-dowork" CxnDef.IdRef="cd-reviewer-dowork" ToObjOcc.IdRef="occ-dowork" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="200" Pos.Y="175"/>
          <Position Pos.X="100" Pos.Y="175"/>
        </CxnOcc>
      </ObjOcc>
    </Model>
    <ObjDef ObjDef.ID="od-start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Start requested</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="cd-start-dowork" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="od-dowork"/>
    </ObjDef>
    <ObjDef ObjDef.ID="od-dowork" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Do the work</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="cd-dowork-rule" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="od-rule"/>
    </ObjDef>
    <ObjDef ObjDef.ID="od-rule" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">XOR rule</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="cd-rule-approved" CxnDef.Type="CT_LEADS_TO_2" ToObjDef.IdRef="od-approved"/>
      <CxnDef CxnDef.ID="cd-rule-rejected" CxnDef.Type="CT_LEADS_TO_2" ToObjDef.IdRef="od-rejected"/>
    </ObjDef>
    <ObjDef ObjDef.ID="od-approved" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Approved</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="od-rejected" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Rejected</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="od-reviewer" TypeNum="OT_PERS_TYPE" SymbolNum="ST_PERS_TYPE">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Reviewer</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="cd-reviewer-dowork" CxnDef.Type="CT_EXEC_2" ToObjDef.IdRef="od-dowork"/>
    </ObjDef>${FOOTER}`

/** Same process with "Do the work" (and its Reviewer satellite) removed; Start -> XOR rule directly. */
const MISSING_FUNCTION_AML = `${HEADER}
    <Model Model.ID="m1" Model.Type="MT_EEPC" GridSize="10" Scale="100" PrintScale="100" BackColor="16777215">
      <ObjOcc ObjOcc.ID="occ-start" ObjDef.IdRef="od-start" SymbolNum="ST_EV" Zorder="1" SequenceNumber="1">
        <Position Pos.X="0" Pos.Y="0"/>
        <Size Size.dX="100" Size.dY="50"/>
        <CxnOcc CxnOcc.ID="co-start-rule" CxnDef.IdRef="cd-start-rule" ToObjOcc.IdRef="occ-rule" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="50" Pos.Y="50"/>
          <Position Pos.X="50" Pos.Y="300"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-rule" ObjDef.IdRef="od-rule" SymbolNum="ST_OPR_XOR_1" Zorder="2" SequenceNumber="2">
        <Position Pos.X="0" Pos.Y="300"/>
        <Size Size.dX="100" Size.dY="50"/>
        <CxnOcc CxnOcc.ID="co-rule-approved" CxnDef.IdRef="cd-rule-approved" ToObjOcc.IdRef="occ-approved" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="50" Pos.Y="350"/>
          <Position Pos.X="0" Pos.Y="450"/>
        </CxnOcc>
        <CxnOcc CxnOcc.ID="co-rule-rejected" CxnDef.IdRef="cd-rule-rejected" ToObjOcc.IdRef="occ-rejected" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="50" Pos.Y="350"/>
          <Position Pos.X="200" Pos.Y="450"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-approved" ObjDef.IdRef="od-approved" SymbolNum="ST_EV" Zorder="3" SequenceNumber="3">
        <Position Pos.X="0" Pos.Y="450"/>
        <Size Size.dX="100" Size.dY="50"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="occ-rejected" ObjDef.IdRef="od-rejected" SymbolNum="ST_EV" Zorder="4" SequenceNumber="4">
        <Position Pos.X="200" Pos.Y="450"/>
        <Size Size.dX="100" Size.dY="50"/>
      </ObjOcc>
    </Model>
    <ObjDef ObjDef.ID="od-start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Start requested</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="cd-start-rule" CxnDef.Type="CT_IS_EVAL_BY_1" ToObjDef.IdRef="od-rule"/>
    </ObjDef>
    <ObjDef ObjDef.ID="od-rule" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">XOR rule</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="cd-rule-approved" CxnDef.Type="CT_LEADS_TO_2" ToObjDef.IdRef="od-approved"/>
      <CxnDef CxnDef.ID="cd-rule-rejected" CxnDef.Type="CT_LEADS_TO_2" ToObjDef.IdRef="od-rejected"/>
    </ObjDef>
    <ObjDef ObjDef.ID="od-approved" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Approved</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="od-rejected" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="en-US">Rejected</AttrValue>
      </AttrDef>
    </ObjDef>${FOOTER}`

const EXPECTED_DOC: FidelityExpectationDoc = {
  modelKey: 'synthetic-demo',
  modelIdHint: null,
  nameEn: 'Synthetic Demo Process',
  spine: [
    { kind: 'event', nameEn: 'Start requested', numbering: null, symbolNum: 'ST_EV', fill: null },
    { kind: 'function', nameEn: 'Do the work', numbering: null, symbolNum: 'ST_FUNC', fill: null },
    { kind: 'rule', nameEn: 'XOR rule', numbering: null, symbolNum: 'ST_OPR_XOR_1', fill: null },
    {
      kind: 'event',
      nameEn: 'Approved',
      nameAr: 'تمت الموافقة',
      numbering: null,
      symbolNum: 'ST_EV',
      fill: null
    },
    { kind: 'event', nameEn: 'Rejected', numbering: null, symbolNum: 'ST_EV', fill: null }
  ],
  satellites: {
    'Do the work': [
      {
        nameEn: 'Reviewer',
        objectType: 'OT_PERS_TYPE',
        side: 'right',
        connectionType: 'CT_EXEC_2',
        raci: 'R',
        symbolNum: 'ST_PERS_TYPE',
        fill: null
      }
    ]
  },
  gates: [
    { operator: 'XOR', afterNameEn: 'Do the work', branchFirstNamesEn: ['Approved', 'Rejected'] }
  ],
  notes: [],
  counts: { functions: 1, events: 3, rules: 1, connections: 5 }
}

async function buildDocument(xml: string): Promise<ArisWorkingDocument> {
  const bytes = new TextEncoder().encode(xml)
  const sourcePackage = await createArisXmlSourcePackage({
    name: 'synthetic.aml',
    relPath: null,
    bytes
  })
  return buildFromSource(sourcePackage.index)
}

describe('compareStructure', () => {
  it('scores every metric at 1.0 for a structurally-identical generated document', async () => {
    const document = await buildDocument(COMPLETE_AML)
    const score = compareStructure(document, 'm1', EXPECTED_DOC)

    expect(score.controlFlowRecall).toBe(1)
    expect(score.controlFlowPrecision).toBe(1)
    expect(score.connectionRecall).toBe(1)
    expect(score.connectionPrecision).toBe(1)
    expect(score.satelliteRecall).toBe(1)
    expect(score.gatewayAccuracy).toBe(1)
    expect(score.labelSimilarityMean).toBe(1)
    expect(score.misses.objects).toEqual([])
    expect(score.misses.connections).toEqual([])
    expect(score.relativeRecall).toBeUndefined()

    const scoreWithManifest = compareStructure(document, 'm1', EXPECTED_DOC, {
      manifest: {
        objects: ['Start requested', 'Do the work', 'XOR rule', 'Approved', 'Rejected', 'Reviewer'],
        connections: [
          ['Start requested', 'Do the work'],
          ['Do the work', 'Approved'],
          ['Do the work', 'Rejected']
        ]
      }
    })
    expect(scoreWithManifest.relativeRecall).toBe(1)
  })

  it('matches a rule by operator and topology without using its label', async () => {
    const renamedRule = COMPLETE_AML.replace(
      '<AttrValue LocaleId="en-US">XOR rule</AttrValue>',
      '<AttrValue LocaleId="en-US">Opaque generated connector</AttrValue>'
    )
    const document = await buildDocument(renamedRule)
    const score = compareStructure(document, 'm1', EXPECTED_DOC)

    expect(score.controlFlowRecall).toBe(1)
    expect(score.controlFlowPrecision).toBe(1)
    expect(score.gatewayAccuracy).toBe(1)
    expect(score.misses.objects).not.toContain('rule:XOR rule')
  })

  it('does not match a same-label rule with the wrong operator', async () => {
    const wrongOperator = COMPLETE_AML.replaceAll('ST_OPR_XOR_1', 'ST_OPR_AND_1')
    const document = await buildDocument(wrongOperator)
    const score = compareStructure(document, 'm1', EXPECTED_DOC)

    expect(score.controlFlowRecall).toBeCloseTo(4 / 5, 10)
    expect(score.gatewayAccuracy).toBe(0)
    expect(score.misses.objects).toContain('rule:XOR rule')
  })

  it('does not match a same-operator rule that is not between its expected neighbours', async () => {
    const misplacedRule = COMPLETE_AML.replace(
      'ToObjOcc.IdRef="occ-rule" SrcArrow="0" TgtArrow="1"',
      'ToObjOcc.IdRef="occ-approved" SrcArrow="0" TgtArrow="1"'
    ).replace('ToObjDef.IdRef="od-rule"/>', 'ToObjDef.IdRef="od-approved"/>')
    const document = await buildDocument(misplacedRule)
    const score = compareStructure(document, 'm1', EXPECTED_DOC)

    expect(score.controlFlowRecall).toBeCloseTo(4 / 5, 10)
    expect(score.gatewayAccuracy).toBe(0)
    expect(score.misses.objects).toContain('rule:XOR rule')
  })

  it('derives connection assertions over the rule-skipped spine', async () => {
    const document = await buildDocument(COMPLETE_AML)
    const absent = compareStructure(document, 'does-not-exist', EXPECTED_DOC)

    expect(absent.misses.connections).toEqual([
      ['Start requested', 'Do the work'],
      ['Do the work', 'Approved'],
      ['Do the work', 'Rejected']
    ])
    expect(absent.misses.connections.flat()).not.toContain('XOR rule')
  })

  it('matches an Arabic generated label against the restored Arabic oracle label', async () => {
    const arabicLabel = COMPLETE_AML.replace(
      '<AttrValue LocaleId="en-US">Approved</AttrValue>',
      '<AttrValue LocaleId="14337">تمت الموافقة</AttrValue>'
    )
    const document = await buildDocument(arabicLabel)
    const score = compareStructure(document, 'm1', EXPECTED_DOC)

    expect(score.controlFlowRecall).toBe(1)
    expect(score.misses.objects).not.toContain('event:Approved')
  })

  it('uses token containment as a similarity floor for short labels', async () => {
    const containedLabel = COMPLETE_AML.replace(
      '<AttrValue LocaleId="en-US">Do the work</AttrValue>',
      '<AttrValue LocaleId="en-US">work</AttrValue>'
    )
    const document = await buildDocument(containedLabel)
    const score = compareStructure(document, 'm1', EXPECTED_DOC)

    expect(diceCoefficient('work', 'Do the work')).toBeLessThan(0.55)
    expect(score.controlFlowRecall).toBe(1)
    expect(score.satelliteRecall).toBe(1)
  })

  it('weights shared meaningful tokens across length-asymmetric labels', async () => {
    const generatedLabel = COMPLETE_AML.replace(
      '<AttrValue LocaleId="en-US">Approved</AttrValue>',
      '<AttrValue LocaleId="en-US">Applicant is an individual</AttrValue>'
    )
    const expected: FidelityExpectationDoc = {
      ...EXPECTED_DOC,
      spine: EXPECTED_DOC.spine.map((step) =>
        step.nameEn === 'Approved'
          ? { ...step, nameEn: 'Pet Owner is individual', nameAr: undefined }
          : step
      ),
      gates: [
        {
          ...EXPECTED_DOC.gates[0],
          branchFirstNamesEn: ['Pet Owner is individual', 'Rejected']
        }
      ]
    }
    const document = await buildDocument(generatedLabel)
    const score = compareStructure(document, 'm1', expected)

    expect(diceCoefficient('Applicant is an individual', 'Pet Owner is individual')).toBeLessThan(
      0.55
    )
    expect(score.controlFlowRecall).toBe(1)
  })

  it('drops recall metrics and lists the gap when a function is missing', async () => {
    const document = await buildDocument(MISSING_FUNCTION_AML)
    const score = compareStructure(document, 'm1', EXPECTED_DOC)

    // Three of five spine objects survive (Start, Approved, Rejected). "Do the
    // work" is gone, so the rule can no longer prove that it lies between both
    // expected neighbours and correctly remains unmatched too.
    expect(score.controlFlowRecall).toBeCloseTo(3 / 5, 10)
    expect(score.controlFlowRecall).toBeLessThan(1)
    // The Reviewer satellite was anchored on "Do the work" alone; with no
    // matched anchor it cannot be recovered.
    expect(score.satelliteRecall).toBe(0)
    // Every reconstructed connection touching "Do the work" fails to translate.
    expect(score.connectionRecall).toBeLessThan(1)
    // The gate's "afterNameEn" ("Do the work") never matches, so the gate
    // cannot be verified correct either.
    expect(score.gatewayAccuracy).toBe(0)

    expect(score.misses.objects).toContain('function:Do the work')
    expect(score.misses.objects).toContain('satellite:Do the work:Reviewer')
  })

  it('computes relativeRecall against only the facts a description manifest mentions', async () => {
    const document = await buildDocument(MISSING_FUNCTION_AML)

    // The manifest claims the description only talked about the start event
    // and the approved outcome — neither depends on the
    // missing "Do the work" function, so relativeRecall should be a full 1.0
    // even though the plain controlFlowRecall for the same document is 0.8.
    const manifest: StructureFactsManifest = {
      objects: ['Start requested', 'Approved'],
      connections: []
    }
    const score = compareStructure(document, 'm1', EXPECTED_DOC, { manifest })

    expect(score.controlFlowRecall).toBeLessThan(1)
    expect(score.relativeRecall).toBe(1)

    // A manifest that also claims the missing function pulls relativeRecall
    // below 1, and strictly below the all-mentioned case above.
    const manifestWithMissingFact: StructureFactsManifest = {
      objects: ['Start requested', 'Approved', 'Do the work'],
      connections: []
    }
    const secondScore = compareStructure(document, 'm1', EXPECTED_DOC, {
      manifest: manifestWithMissingFact
    })
    expect(secondScore.relativeRecall).toBeLessThan(1)
  })

  it('reports relativeRecall as N/A for an empty manifest', async () => {
    const document = await buildDocument(COMPLETE_AML)
    const score = compareStructure(document, 'm1', EXPECTED_DOC, {
      manifest: { objects: [], connections: [] }
    })
    const absent = compareStructure(document, 'does-not-exist', EXPECTED_DOC, {
      manifest: { objects: [], connections: [] }
    })

    expect(score.relativeRecall).toBeUndefined()
    expect(absent.relativeRecall).toBeUndefined()
  })

  it('only includes a mentioned satellite when its owner function is also mentioned', async () => {
    const document = await buildDocument(COMPLETE_AML)
    const satelliteOnly = compareStructure(document, 'm1', EXPECTED_DOC, {
      manifest: { objects: ['Reviewer'], connections: [] }
    })
    const ownerAndSatellite = compareStructure(document, 'm1', EXPECTED_DOC, {
      manifest: { objects: ['Do the work', 'Reviewer'], connections: [] }
    })

    expect(satelliteOnly.relativeRecall).toBeUndefined()
    expect(ownerAndSatellite.relativeRecall).toBe(1)
  })

  it('returns an all-zero (vacuous-1 precision) score when the model id is absent', async () => {
    const document = await buildDocument(COMPLETE_AML)
    const score = compareStructure(document, 'does-not-exist', EXPECTED_DOC)

    expect(score.controlFlowRecall).toBe(0)
    expect(score.satelliteRecall).toBe(0)
    expect(score.connectionRecall).toBe(0)
    expect(score.gatewayAccuracy).toBe(0)
    expect(score.misses.objects.length).toBeGreaterThan(0)
  })
})

describe('diceCoefficient', () => {
  it('scores an exact match at 1 and an unrelated pair well below the 0.55 threshold', () => {
    expect(diceCoefficient('TAMM', 'TAMM')).toBe(1)
    expect(diceCoefficient('Login to TAMM portal', 'Upload copy of lease contract')).toBeLessThan(
      0.55
    )
  })

  it('is case- and whitespace-insensitive', () => {
    expect(diceCoefficient('  Pet Owner  ', 'pet   owner')).toBe(1)
  })
})
