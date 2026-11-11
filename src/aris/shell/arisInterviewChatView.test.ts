import { describe, expect, it } from 'vitest'

import { prioritizeGaps } from '../chat/interviewLoop'
import type { ArisChatGap } from '../chat/gapScanner'
import type { ArisWorkingDocument } from '../model/types'
import {
  countInterviewBands,
  interviewPriorityBand,
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
