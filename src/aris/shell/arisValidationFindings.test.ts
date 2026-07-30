import { describe, expect, it } from 'vitest'
import {
  buildArisValidationFindings,
  findingsByCanvasElement,
  type ArisValidationFinding
} from './arisValidationFindings'
import { buildArisEpcFindings, type ArisEpcModelFinding } from './arisEpcFindings'
import { scanArisGaps } from './arisChatHost'
import { attribute, buildDocument, names } from '../chat/testFixtures'
import { type ArisChatGap } from '../chat/gapScanner'
import type { ArisChatModel, ArisChatObjectDefinition } from '../chat/types'
import type { ArisWorkingDocument } from '../model/types'

function asWorkingDocument(document: ReturnType<typeof buildDocument>): ArisWorkingDocument {
  return document as unknown as ArisWorkingDocument
}

function funcDefinition(
  id: string,
  extra: Partial<ArisChatObjectDefinition> = {}
): ArisChatObjectDefinition {
  return {
    id,
    type: 'OT_FUNC',
    names: names('Do work', 'قم بالعمل'),
    attributes: [attribute('AT_PROC_CODE', 'P-1'), attribute('AT_PERS_RESP', 'Owner')],
    linkedModelIds: [],
    ...extra
  }
}

function eepcModel(
  id: string,
  occurrences: ArisChatModel['occurrences'],
  connections: ArisChatModel['connectionOccurrences']
): ArisChatModel & { type: 'MT_EEPC' } {
  return {
    id,
    type: 'MT_EEPC',
    names: names('Model', 'نموذج'),
    occurrences,
    connectionOccurrences: connections
  }
}

describe('buildArisValidationFindings', () => {
  it('maps every rail-target kind to the right tab and field', () => {
    const document = buildDocument({})
    const gaps: ArisChatGap[] = [
      {
        kind: 'missingEnglishName',
        severity: 'error',
        targetIds: ['D1'],
        messageKey: 'aris.chat.gap.missingEnglishName'
      },
      {
        kind: 'missingArabicName',
        severity: 'error',
        targetIds: ['D2'],
        messageKey: 'aris.chat.gap.missingArabicName'
      },
      {
        kind: 'missingProcessCode',
        severity: 'error',
        targetIds: ['D3'],
        messageKey: 'aris.chat.gap.missingProcessCode'
      },
      {
        kind: 'missingOwner',
        severity: 'error',
        targetIds: ['D4'],
        messageKey: 'aris.chat.gap.missingOwner'
      },
      {
        kind: 'missingDecisionBasis',
        severity: 'error',
        targetIds: ['D5'],
        messageKey: 'aris.chat.gap.missingDecisionBasis'
      },
      {
        kind: 'missingLinkedModel',
        severity: 'warning',
        targetIds: ['D6'],
        messageKey: 'aris.chat.gap.missingLinkedModel'
      },
      {
        kind: 'missingAttachment',
        severity: 'warning',
        targetIds: ['D7'],
        messageKey: 'aris.chat.gap.missingAttachment'
      },
      {
        kind: 'missingInputsOutputsSystems',
        severity: 'warning',
        targetIds: ['O1'],
        messageKey: 'aris.chat.gap.missingInputsOutputsSystems'
      },
      {
        kind: 'missingXorOutcomes',
        severity: 'warning',
        targetIds: ['R1'],
        messageKey: 'aris.chat.gap.missingXorOutcomes'
      },
      {
        kind: 'missingReturnTarget',
        severity: 'warning',
        targetIds: ['O2'],
        messageKey: 'aris.chat.gap.missingReturnTarget'
      },
      {
        kind: 'unusedDefinition',
        severity: 'warning',
        targetIds: ['D8'],
        messageKey: 'aris.chat.gap.unusedDefinition'
      },
      {
        kind: 'unaccountedSourceContent',
        severity: 'warning',
        targetIds: ['S1'],
        messageKey: 'aris.chat.gap.unaccountedSourceContent'
      }
    ]

    const findings = [...buildArisValidationFindings(asWorkingDocument(document), [], gaps)]

    expect(findings.map((f) => [f.kind, f.railTarget])).toEqual([
      ['missingEnglishName', { tab: 'names', field: { kind: 'name', lang: 'en' } }],
      ['missingArabicName', { tab: 'names', field: { kind: 'name', lang: 'ar' } }],
      [
        'missingProcessCode',
        { tab: 'attributes', field: { kind: 'attribute', attributeType: 'AT_PROC_CODE' } }
      ],
      [
        'missingOwner',
        { tab: 'attributes', field: { kind: 'attribute', attributeType: 'AT_PERS_RESP' } }
      ],
      [
        'missingDecisionBasis',
        { tab: 'attributes', field: { kind: 'attribute', attributeType: 'AT_DESC' } }
      ],
      ['missingLinkedModel', { tab: 'assignments', field: { kind: 'section' } }],
      ['missingAttachment', { tab: 'attachments', field: { kind: 'section' } }],
      ['missingInputsOutputsSystems', null],
      ['missingXorOutcomes', null],
      ['missingReturnTarget', null],
      ['unusedDefinition', null],
      ['unaccountedSourceContent', null]
    ])
  })

  it('expands a definition target to all its occurrences and honors preferredModelId', () => {
    const definitionId = 'OD_FUNC'
    const modelA = eepcModel(
      'M_A',
      [{ id: 'O_A', definitionId, modelId: 'M_A', symbol: 'ST_FUNC' }],
      []
    )
    const modelB = eepcModel(
      'M_B',
      [{ id: 'O_B', definitionId, modelId: 'M_B', symbol: 'ST_FUNC' }],
      []
    )
    const document = buildDocument({
      models: [modelA, modelB],
      objectDefinitions: [funcDefinition(definitionId)]
    })
    const gap: ArisChatGap = {
      kind: 'missingEnglishName',
      severity: 'error',
      targetIds: [definitionId],
      messageKey: 'aris.chat.gap.missingEnglishName'
    }

    const withoutPreferred = buildArisValidationFindings(asWorkingDocument(document), [], [gap])
    expect(withoutPreferred[0].anchorElementId).toBe('O_A')
    expect(withoutPreferred[0].canvasElementIds).toEqual(['O_A', 'O_B'])

    const withPreferred = buildArisValidationFindings(asWorkingDocument(document), [], [gap], {
      preferredModelId: 'M_B'
    })
    expect(withPreferred[0].anchorElementId).toBe('O_B')
    expect(withPreferred[0].canvasElementIds).toEqual(['O_B', 'O_A'])
  })

  it('sets fallbackModelId for a model-level name gap', () => {
    const document = buildDocument({
      models: [
        {
          id: 'M1',
          names: names('Only English', null),
          occurrences: [],
          connectionOccurrences: []
        }
      ]
    })
    const findings = buildArisValidationFindings(
      asWorkingDocument(document),
      [],
      scanArisGaps(asWorkingDocument(document))
    )
    const modelGap = findings.find((f) => f.kind === 'missingArabicName')
    expect(modelGap).toBeDefined()
    expect(modelGap!.anchorElementId).toBeNull()
    expect(modelGap!.fallbackModelId).toBe('M1')
    expect(modelGap!.canvasElementIds).toEqual([])
  })

  it('passes EPC findings through with ruleId, fallback model, and mapped kind', () => {
    const funcA = funcDefinition('OD_A')
    const funcB = funcDefinition('OD_B')
    const connDef = {
      id: 'CD1',
      type: 'CT_ACTIV_1',
      fromObjectDefinitionId: 'OD_A',
      toObjectDefinitionId: 'OD_B',
      names: names(null),
      attributes: []
    }
    const model = eepcModel(
      'M1',
      [
        { id: 'O_A', definitionId: 'OD_A', modelId: 'M1', symbol: 'ST_FUNC' },
        { id: 'O_B', definitionId: 'OD_B', modelId: 'M1', symbol: 'ST_FUNC' }
      ],
      [
        {
          id: 'C1',
          definitionId: 'CD1',
          modelId: 'M1',
          sourceOccurrenceId: 'O_A',
          targetOccurrenceId: 'O_B'
        }
      ]
    )
    const document = buildDocument({
      models: [model],
      objectDefinitions: [funcA, funcB],
      connectionDefinitions: [connDef]
    })
    const workingDocument = asWorkingDocument(document)
    const epcFindings = buildArisEpcFindings(workingDocument)

    const findings = buildArisValidationFindings(workingDocument, epcFindings, [])
    const missingStart = findings.find((f) => f.ruleId === 'epc.startEnd.missingStart')
    expect(missingStart).toBeDefined()
    expect(missingStart!.kind).toBe('missingStartOrEndEvent')
    expect(missingStart!.fallbackModelId).toBe('M1')
    expect(missingStart!.canvasElementIds).toEqual([])

    const alternation = findings.find((f) => f.ruleId === 'epc.alternation')
    expect(alternation).toBeDefined()
    expect(alternation!.kind).toBe('invalidSequence')
    expect(alternation!.canvasElementIds).toEqual(['O_A', 'O_B', 'C1'])
  })

  it('passes a convention (conv.*) finding through with ruleId, fallback kind, and connection markers', () => {
    const funcA = funcDefinition('OD_A')
    const funcB = funcDefinition('OD_B')
    const connDef = {
      id: 'CD1',
      type: 'CT_REFS_TO_2',
      fromObjectDefinitionId: 'OD_A',
      toObjectDefinitionId: 'OD_B',
      names: names(null),
      attributes: []
    }
    const model = eepcModel(
      'M1',
      [
        { id: 'O_A', definitionId: 'OD_A', modelId: 'M1', symbol: 'ST_FUNC' },
        { id: 'O_B', definitionId: 'OD_B', modelId: 'M1', symbol: 'ST_FUNC' }
      ],
      [
        {
          id: 'C1',
          definitionId: 'CD1',
          modelId: 'M1',
          sourceOccurrenceId: 'O_A',
          targetOccurrenceId: 'O_B'
        }
      ]
    )
    const document = buildDocument({
      models: [model],
      objectDefinitions: [funcA, funcB],
      connectionDefinitions: [connDef]
    })
    const workingDocument = asWorkingDocument(document)

    // Not built via `buildConventionFindings` (that module owns its own test coverage) —
    // this is a plain conv.*-shaped row, verifying only the downstream pass-through
    // contract `buildArisValidationFindings` already guarantees for any unrecognized
    // `ruleId` (kind falls back to 'invalidSequence' via `EPC_RULE_GAP_KINDS`).
    const convFinding: ArisEpcModelFinding = {
      ruleId: 'conv.connection.illegal',
      severity: 'warning',
      messageKey: 'aris.conv.finding.illegalConnection.body',
      messageParams: { from: 'OT_FUNC', to: 'OT_FUNC', type: 'CT_REFS_TO_2' },
      nodeIds: ['C1'],
      edgeIds: [],
      modelId: 'M1'
    }

    const findings = buildArisValidationFindings(workingDocument, [convFinding], [])
    const convRow = findings.find((f) => f.ruleId === 'conv.connection.illegal')
    expect(convRow).toBeDefined()
    expect(convRow!.kind).toBe('invalidSequence')
    expect(convRow!.severity).toBe('warning')
    expect(convRow!.canvasElementIds).toEqual(['C1'])
    expect(convRow!.anchorElementId).toBe('C1')
    expect(convRow!.fallbackModelId).toBe('M1')
  })

  it('deduplicates EPC findings that the gap scanner re-exposes', () => {
    const funcA = funcDefinition('OD_A')
    const funcB = funcDefinition('OD_B')
    const connDef = {
      id: 'CD1',
      type: 'CT_ACTIV_1',
      fromObjectDefinitionId: 'OD_A',
      toObjectDefinitionId: 'OD_B',
      names: names(null),
      attributes: []
    }
    const model = eepcModel(
      'M1',
      [
        { id: 'O_A', definitionId: 'OD_A', modelId: 'M1', symbol: 'ST_FUNC' },
        { id: 'O_B', definitionId: 'OD_B', modelId: 'M1', symbol: 'ST_FUNC' }
      ],
      [
        {
          id: 'C1',
          definitionId: 'CD1',
          modelId: 'M1',
          sourceOccurrenceId: 'O_A',
          targetOccurrenceId: 'O_B'
        }
      ]
    )
    const document = buildDocument({
      models: [model],
      objectDefinitions: [funcA, funcB],
      connectionDefinitions: [connDef]
    })
    const workingDocument = asWorkingDocument(document)
    const epcFindings = buildArisEpcFindings(workingDocument)
    const gaps = scanArisGaps(workingDocument)

    const findings = buildArisValidationFindings(workingDocument, epcFindings, gaps)
    const missingStartRows = findings.filter((f) => f.ruleId === 'epc.startEnd.missingStart')
    expect(missingStartRows).toHaveLength(1)
    expect(missingStartRows[0].source).toBe('epc')

    const reExposedGapRows = findings.filter(
      (f) => f.source === 'gap' && f.messageKey.startsWith('aris.epc.finding.')
    )
    expect(reExposedGapRows).toHaveLength(0)
  })

  it('keeps unusedDefinition rail-only with no anchor or canvas markers', () => {
    const document = buildDocument({
      objectDefinitions: [funcDefinition('OD_UNUSED')]
    })
    const gap: ArisChatGap = {
      kind: 'unusedDefinition',
      severity: 'warning',
      targetIds: ['OD_UNUSED'],
      messageKey: 'aris.chat.gap.unusedDefinition'
    }

    const findings = buildArisValidationFindings(asWorkingDocument(document), [], [gap])
    expect(findings[0].anchorElementId).toBeNull()
    expect(findings[0].fallbackModelId).toBeNull()
    expect(findings[0].canvasElementIds).toEqual([])
  })
})

describe('findingsByCanvasElement', () => {
  it('orders errors before warnings and omits finding-free elements', () => {
    const findings: ArisValidationFinding[] = [
      {
        key: 'gap:missingEnglishName:O1',
        source: 'gap',
        kind: 'missingEnglishName',
        ruleId: null,
        severity: 'warning',
        messageKey: 'aris.chat.gap.missingEnglishName',
        anchorElementId: 'O1',
        fallbackModelId: null,
        canvasElementIds: ['O1'],
        railTarget: null
      },
      {
        key: 'epc:epc.alternation:O1,O2,C1',
        source: 'epc',
        kind: 'invalidSequence',
        ruleId: 'epc.alternation',
        severity: 'error',
        messageKey: 'aris.epc.finding.alternationViolation',
        anchorElementId: 'O1',
        fallbackModelId: 'M1',
        canvasElementIds: ['O1', 'O2', 'C1'],
        railTarget: null
      }
    ]

    const byElement = findingsByCanvasElement(findings)
    expect(byElement.has('O1')).toBe(true)
    expect(byElement.has('O2')).toBe(true)
    expect(byElement.has('C1')).toBe(true)
    expect(byElement.has('FREE')).toBe(false)

    expect(byElement.get('O1')!.map((f) => f.severity)).toEqual(['error', 'warning'])
    expect(byElement.get('O2')!.map((f) => f.severity)).toEqual(['error'])
    expect(byElement.get('C1')!.map((f) => f.severity)).toEqual(['error'])
  })
})
