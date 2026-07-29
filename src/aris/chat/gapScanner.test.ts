import { describe, expect, it } from 'vitest'
import { DEFAULT_GAP_SCAN_CONFIG, scanArisChatGaps, type ArisChatGapKind } from './gapScanner'
import { attribute, buildCleanEepcDocument, buildDocument, names } from './testFixtures'
import type {
  ArisChatConnectionDefinition,
  ArisChatConnectionOccurrence,
  ArisChatModel,
  ArisChatObjectDefinition
} from './types'

describe('scanArisChatGaps', () => {
  it('reports no gaps for a complete, well-formed EEPC', () => {
    expect(scanArisChatGaps(buildCleanEepcDocument())).toEqual([])
  })

  it('is deterministic: repeated scans of the same document produce the same gap list', () => {
    const document = buildCleanEepcDocumentWithGaps()
    const first = scanArisChatGaps(document)
    const second = scanArisChatGaps(document)
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(0)
  })

  it('produces gaps in the fixed 18.1 bullet order across kinds', () => {
    const document = buildCleanEepcDocumentWithGaps()
    const gaps = scanArisChatGaps(document)
    const order: ArisChatGapKind[] = [
      'missingEnglishName',
      'missingArabicName',
      'missingProcessCode',
      'missingOwner',
      'missingInputsOutputsSystems',
      'missingDecisionBasis',
      'missingXorOutcomes',
      'missingReturnTarget',
      'missingStartOrEndEvent',
      'invalidSequence',
      'danglingObjectOrConnection',
      'missingLinkedModel',
      'missingAttachment',
      'unusedDefinition',
      'unaccountedSourceContent'
    ]
    const seenKindIndices = gaps.map((gap) => order.indexOf(gap.kind))
    const sorted = [...seenKindIndices].sort((a, b) => a - b)
    expect(seenKindIndices).toEqual(sorted)
  })

  it('flags missing English name', () => {
    const document = buildDocument({
      objectDefinitions: [
        { id: 'D1', type: 'OT_FUNC', names: names(null, 'اسم'), attributes: [], linkedModelIds: [] }
      ]
    })
    const gaps = scanArisChatGaps(document)
    expect(gaps.some((g) => g.kind === 'missingEnglishName' && g.targetIds.includes('D1'))).toBe(
      true
    )
  })

  it('flags missing Arabic name', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'D1',
          type: 'OT_FUNC',
          names: names('Name', null),
          attributes: [],
          linkedModelIds: []
        }
      ]
    })
    const gaps = scanArisChatGaps(document)
    expect(gaps.some((g) => g.kind === 'missingArabicName' && g.targetIds.includes('D1'))).toBe(
      true
    )
  })

  it('flags missing process code on an OT_FUNC definition', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'FN',
          type: 'OT_FUNC',
          names: names('Do work', 'قم بالعمل'),
          attributes: [attribute('AT_PERS_RESP', 'Owner')],
          linkedModelIds: []
        }
      ]
    })
    const gaps = scanArisChatGaps(document)
    expect(gaps.filter((g) => g.kind === 'missingProcessCode')).toEqual([
      {
        kind: 'missingProcessCode',
        severity: 'error',
        targetIds: ['FN'],
        messageKey: 'aris.chat.gap.missingProcessCode'
      }
    ])
  })

  it('flags missing owner/responsibility on an OT_FUNC definition', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'FN',
          type: 'OT_FUNC',
          names: names('Do work', 'قم بالعمل'),
          attributes: [attribute('AT_PROC_CODE', 'P-1')],
          linkedModelIds: []
        }
      ]
    })
    const gaps = scanArisChatGaps(document)
    expect(gaps.filter((g) => g.kind === 'missingOwner')).toEqual([
      {
        kind: 'missingOwner',
        severity: 'error',
        targetIds: ['FN'],
        messageKey: 'aris.chat.gap.missingOwner'
      }
    ])
  })

  it('flags a function occurrence with no input/output/system connection', () => {
    const document = withRemovedConnection(buildCleanEepcDocument(), 'C5')
    const gaps = scanArisChatGaps(document)
    expect(
      gaps.some((g) => g.kind === 'missingInputsOutputsSystems' && g.targetIds.includes('OC_FUNC'))
    ).toBe(true)
  })

  it('flags a split XOR/OR rule with no decision-basis attribute or connection', () => {
    const document = withRemovedConnection(buildCleanEepcDocument(), 'C6')
    const gaps = scanArisChatGaps(document)
    expect(
      gaps.some((g) => g.kind === 'missingDecisionBasis' && g.targetIds.includes('OC_RULE'))
    ).toBe(true)
  })

  it('flags an XOR split whose outgoing branches are unlabeled', () => {
    const document = withConnectionNames(buildCleanEepcDocument(), 'C4', undefined)
    const gaps = scanArisChatGaps(document)
    expect(
      gaps.some((g) => g.kind === 'missingXorOutcomes' && g.targetIds.includes('OC_RULE'))
    ).toBe(true)
  })

  it('flags an XOR split whose outgoing branches share the same label', () => {
    const document = withConnectionNames(
      buildCleanEepcDocument(),
      'C4',
      names('Approved', 'موافق عليه')
    )
    const gaps = scanArisChatGaps(document)
    expect(
      gaps.some((g) => g.kind === 'missingXorOutcomes' && g.targetIds.includes('OC_RULE'))
    ).toBe(true)
  })

  it('flags a reject/return-worded outcome with no return path back into the flow', () => {
    const document = withEndEventName(
      buildCleanEepcDocument(),
      'OD_END_R',
      names('Application rejected', 'تم رفض الطلب')
    )
    const gaps = scanArisChatGaps(document)
    expect(
      gaps.some((g) => g.kind === 'missingReturnTarget' && g.targetIds.includes('OC_END_R'))
    ).toBe(true)
  })

  it('flags a model with no start event (epc.startEnd.missingStart, reused key)', () => {
    const document = withRemovedOccurrence(buildCleanEepcDocument(), 'OC_START')
    const gaps = scanArisChatGaps(document)
    const gap = gaps.find(
      (g) =>
        g.kind === 'missingStartOrEndEvent' && g.messageKey === 'aris.epc.finding.missingStartEvent'
    )
    expect(gap).toBeDefined()
  })

  it('flags two adjacent functions as an invalid sequence (epc.alternation, reused key)', () => {
    const modelId = 'M1'
    const objectDefinitions: ArisChatObjectDefinition[] = [
      {
        id: 'F1',
        type: 'OT_FUNC',
        names: names('A', 'أ'),
        attributes: [attribute('AT_PROC_CODE', 'P'), attribute('AT_PERS_RESP', 'O')],
        linkedModelIds: []
      },
      {
        id: 'F2',
        type: 'OT_FUNC',
        names: names('B', 'ب'),
        attributes: [attribute('AT_PROC_CODE', 'P'), attribute('AT_PERS_RESP', 'O')],
        linkedModelIds: []
      }
    ]
    const connectionDefinitions: ArisChatConnectionDefinition[] = [
      {
        id: 'CD1',
        type: 'CT_ACTIV_1',
        fromObjectDefinitionId: 'F1',
        toObjectDefinitionId: 'F2',
        names: names(null),
        attributes: []
      }
    ]
    const model: ArisChatModel = {
      id: modelId,
      names: names('M', 'م'),
      occurrences: [
        { id: 'O1', definitionId: 'F1', modelId, symbol: 'ST_FUNC' },
        { id: 'O2', definitionId: 'F2', modelId, symbol: 'ST_FUNC' }
      ],
      connectionOccurrences: [
        {
          id: 'C1',
          definitionId: 'CD1',
          modelId,
          sourceOccurrenceId: 'O1',
          targetOccurrenceId: 'O2'
        }
      ]
    }
    const document = buildDocument({ models: [model], objectDefinitions, connectionDefinitions })
    const gaps = scanArisChatGaps(document)
    expect(
      gaps.some(
        (g) =>
          g.kind === 'invalidSequence' && g.messageKey === 'aris.epc.finding.alternationViolation'
      )
    ).toBe(true)
  })

  it('flags a dangling occurrence (references a missing definition)', () => {
    const model: ArisChatModel = {
      id: 'M1',
      names: names('M', 'م'),
      occurrences: [{ id: 'O1', definitionId: 'MISSING', modelId: 'M1', symbol: null }],
      connectionOccurrences: []
    }
    const document = buildDocument({ models: [model] })
    const gaps = scanArisChatGaps(document)
    expect(
      gaps.some(
        (g) =>
          g.kind === 'danglingObjectOrConnection' &&
          g.messageKey === 'aris.chat.gap.dangling.occurrenceDefinition' &&
          g.targetIds.includes('O1')
      )
    ).toBe(true)
  })

  it('flags a missing linked model when configured to expect one', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'PI',
          type: 'OT_FUNC',
          names: names('Sub-process', 'عملية فرعية'),
          attributes: [attribute('AT_PROC_CODE', 'P'), attribute('AT_PERS_RESP', 'O')],
          linkedModelIds: []
        }
      ]
    })
    const config = { ...DEFAULT_GAP_SCAN_CONFIG, processInterfaceObjectTypes: new Set(['OT_FUNC']) }
    const gaps = scanArisChatGaps(document, config)
    expect(gaps.some((g) => g.kind === 'missingLinkedModel' && g.targetIds.includes('PI'))).toBe(
      true
    )
  })

  it('does not flag missing linked model when not configured (empty default set)', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'PI',
          type: 'OT_FUNC',
          names: names('Sub-process', 'عملية فرعية'),
          attributes: [attribute('AT_PROC_CODE', 'P'), attribute('AT_PERS_RESP', 'O')],
          linkedModelIds: []
        }
      ]
    })
    const gaps = scanArisChatGaps(document)
    expect(gaps.some((g) => g.kind === 'missingLinkedModel')).toBe(false)
  })

  it('flags a missing attachment when configured to require one', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'SYS',
          type: 'OT_APPL_SYS',
          names: names('System', 'نظام'),
          attributes: [],
          linkedModelIds: []
        }
      ]
    })
    const config = {
      ...DEFAULT_GAP_SCAN_CONFIG,
      requiredAttachmentObjectTypes: new Set(['OT_APPL_SYS'])
    }
    const gaps = scanArisChatGaps(document, config)
    expect(gaps.some((g) => g.kind === 'missingAttachment' && g.targetIds.includes('SYS'))).toBe(
      true
    )
  })

  it('flags an unused definition (zero occurrences anywhere)', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'UNUSED',
          type: 'OT_APPL_SYS',
          names: names('Unused', 'غير مستخدم'),
          attributes: [],
          linkedModelIds: []
        }
      ]
    })
    const gaps = scanArisChatGaps(document)
    expect(gaps.some((g) => g.kind === 'unusedDefinition' && g.targetIds.includes('UNUSED'))).toBe(
      true
    )
  })

  it('flags unaccounted source content, aggregated into one gap with sorted target ids', () => {
    const document = buildDocument({ unaccountedSourceIds: ['z', 'a', 'm'] })
    const gaps = scanArisChatGaps(document)
    expect(gaps.filter((g) => g.kind === 'unaccountedSourceContent')).toEqual([
      {
        kind: 'unaccountedSourceContent',
        severity: 'warning',
        targetIds: ['a', 'm', 'z'],
        messageKey: 'aris.chat.gap.unaccountedSourceContent'
      }
    ])
  })
})

// --- local fixture helpers -----------------------------------------------------------------

function buildCleanEepcDocumentWithGaps() {
  return withRemovedOccurrence(buildCleanEepcDocument(), 'OC_START')
}

function withRemovedConnection(
  document: ReturnType<typeof buildCleanEepcDocument>,
  connectionId: string
) {
  const models = new Map(document.models)
  for (const [modelId, model] of models) {
    if (model.connectionOccurrences.some((c) => c.id === connectionId)) {
      models.set(modelId, {
        ...model,
        connectionOccurrences: model.connectionOccurrences.filter((c) => c.id !== connectionId)
      })
    }
  }
  return { ...document, models: Object.freeze(models) }
}

function withRemovedOccurrence(
  document: ReturnType<typeof buildCleanEepcDocument>,
  occurrenceId: string
) {
  const models = new Map(document.models)
  for (const [modelId, model] of models) {
    if (model.occurrences.some((o) => o.id === occurrenceId)) {
      models.set(modelId, {
        ...model,
        occurrences: model.occurrences.filter((o) => o.id !== occurrenceId),
        connectionOccurrences: model.connectionOccurrences.filter(
          (c) => c.sourceOccurrenceId !== occurrenceId && c.targetOccurrenceId !== occurrenceId
        )
      })
    }
  }
  return { ...document, models: Object.freeze(models) }
}

function withConnectionNames(
  document: ReturnType<typeof buildCleanEepcDocument>,
  connectionId: string,
  newNames: ReturnType<typeof names> | undefined
) {
  const models = new Map(document.models)
  for (const [modelId, model] of models) {
    if (model.connectionOccurrences.some((c) => c.id === connectionId)) {
      models.set(modelId, {
        ...model,
        connectionOccurrences: model.connectionOccurrences.map((c): ArisChatConnectionOccurrence =>
          c.id === connectionId ? { ...c, names: newNames } : c
        )
      })
    }
  }
  return { ...document, models: Object.freeze(models) }
}

function withEndEventName(
  document: ReturnType<typeof buildCleanEepcDocument>,
  definitionId: string,
  newNames: ReturnType<typeof names>
) {
  const objectDefinitions = new Map(document.objectDefinitions)
  const definition = objectDefinitions.get(definitionId)
  if (definition) objectDefinitions.set(definitionId, { ...definition, names: newNames })
  return { ...document, objectDefinitions: Object.freeze(objectDefinitions) }
}
