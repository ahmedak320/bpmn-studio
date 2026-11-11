import { describe, expect, it } from 'vitest'

import { prioritizeGaps } from '../chat/interviewLoop'
import type { ArisChatGap } from '../chat/gapScanner'
import type { ArisWorkingDocument } from '../model/types'
import {
  countInterviewBands,
  interviewPriorityBand,
  describeQuestionContext,
  questionAsk,
  questionStepLabel,
  translationSource
} from './arisInterviewChatView'

const gap = (kind: ArisChatGap['kind'], targetIds: string[]): ArisChatGap => ({
  kind,
  severity: 'warning',
  targetIds,
  messageKey: `aris.chat.gap.${kind}`
})

describe('interview question order', () => {
  it('asks critical structural gaps first, content next, and simple name gaps last', () => {
    const ordered = prioritizeGaps([
      gap('missingArabicName', ['F1']),
      gap('missingOwner', ['F2']),
      gap('danglingObjectOrConnection', ['C1']),
      gap('missingEnglishName', ['F3'])
    ])
    expect(ordered.map((entry) => entry.kind)).toEqual([
      'danglingObjectOrConnection',
      'missingOwner',
      'missingArabicName',
      'missingEnglishName'
    ])
  })

  it('puts the gaps of a clicked step ahead of everything else', () => {
    const ordered = prioritizeGaps(
      [gap('danglingObjectOrConnection', ['C1']), gap('missingOwner', ['F9'])],
      ['F9']
    )
    expect(ordered[0]?.targetIds).toEqual(['F9'])
  })

  it('keeps the scanner order within one priority band', () => {
    const ordered = prioritizeGaps([gap('missingOwner', ['F2']), gap('missingOwner', ['F1'])])
    expect(ordered.map((entry) => entry.targetIds[0])).toEqual(['F2', 'F1'])
  })

  it('classifies every gap kind into a band', () => {
    expect(interviewPriorityBand('missingXorOutcomes')).toBe('critical')
    expect(interviewPriorityBand('missingInputsOutputsSystems')).toBe('content')
    expect(interviewPriorityBand('missingArabicName')).toBe('simple')
    expect(
      countInterviewBands([gap('missingStartOrEndEvent', ['E']), gap('missingEnglishName', ['F'])])
    ).toEqual({ critical: 1, content: 0, simple: 1 })
  })
})

function doc(names: Record<string, { values: Record<string, string>; fallback: string | null }>): ArisWorkingDocument {
  const definitions = new Map(
    Object.entries(names).map(([id, value]) => [id, { id, type: 'OT_FUNC', names: value }])
  )
  return {
    models: new Map(),
    objectDefinitions: definitions,
    connectionDefinitions: new Map()
  } as unknown as ArisWorkingDocument
}

describe('interview chat presentation', () => {
  const document = doc({
    F1: { values: { en: 'Verify ID', ar: 'التحقق من الهوية' }, fallback: null },
    F2: { values: { en: 'Submit form' }, fallback: null }
  })

  it('names the step a missing-Arabic question is about', () => {
    const label = questionStepLabel(document, {
      id: 'q1',
      messageKey: 'aris.chat.gap.missingArabicName',
      gapKind: 'missingArabicName',
      targetIds: ['F2']
    })
    expect(label).toBe('Submit form')
  })

  it('translates an English name to Arabic and an Arabic name to English', () => {
    expect(
      translationSource(document, {
        id: 'q',
        messageKey: 'k',
        gapKind: 'missingArabicName',
        targetIds: ['F2']
      })
    ).toEqual({ text: 'Submit form', from: 'en', to: 'ar' })
    expect(
      translationSource(document, {
        id: 'q',
        messageKey: 'k',
        gapKind: 'missingEnglishName',
        targetIds: ['F1']
      })
    ).toEqual({ text: 'التحقق من الهوية', from: 'ar', to: 'en' })
  })

  it('offers no translation source for a non-name question or a step with no name', () => {
    expect(
      translationSource(document, { id: 'q', messageKey: 'k', gapKind: 'missingOwner', targetIds: ['F1'] })
    ).toBeNull()
    expect(
      translationSource(document, { id: 'q', messageKey: 'k', gapKind: 'missingArabicName', targetIds: ['X'] })
    ).toBeNull()
  })
})

describe('interview question wording', () => {
  const en = (value: string) => ({ values: { en: value }, fallback: null })
  const flow = {
    models: new Map([
      [
        'M1',
        {
          id: 'M1',
          names: en('Survey process'),
          occurrences: [
            { id: 'O1', definitionId: 'F1', modelId: 'M1' },
            { id: 'O2', definitionId: 'F2', modelId: 'M1' }
          ],
          connectionOccurrences: [
            { id: 'C1', definitionId: 'X1', modelId: 'M1', sourceOccurrenceId: 'O1', targetOccurrenceId: 'O2' }
          ]
        }
      ]
    ]),
    objectDefinitions: new Map([
      ['F1', { id: 'F1', type: 'OT_FUNC', names: en('Receive survey') }],
      ['F2', { id: 'F2', type: 'OT_FUNC', names: en('Review answers') }]
    ]),
    connectionDefinitions: new Map()
  } as unknown as ArisWorkingDocument

  it('names the process, the exact step and the step before it', () => {
    const text = questionAsk(
      { id: 'q', messageKey: 'k', gapKind: 'missingOwner', targetIds: ['F2'] },
      flow
    )
    expect(text).toContain('Review answers')
    expect(text).toContain('Survey process')
    expect(text).toContain('Receive survey')
    expect(text).toContain('owner')
  })

  it('resolves an occurrence id to the same step as its definition', () => {
    const context = describeQuestionContext(flow, {
      id: 'q',
      messageKey: 'k',
      gapKind: 'missingInputsOutputsSystems',
      targetIds: ['O2']
    })
    expect(context).toEqual({
      process: 'Survey process',
      step: 'Review answers',
      previous: 'Receive survey'
    })
  })

  it('asks about the process itself when the gap is on a model', () => {
    const text = questionAsk(
      { id: 'q', messageKey: 'k', gapKind: 'missingArabicName', targetIds: ['M1'] },
      flow
    )
    expect(text).toContain('the process “Survey process”')
    expect(text).not.toContain('step')
  })
})
