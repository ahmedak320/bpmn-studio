import { describe, expect, it } from 'vitest'

import { checkInterviewAnswer, isClarificationRequest } from './arisChatAnswerCheck'

describe('isClarificationRequest', () => {
  it('treats questions and confusion as requests for explanation', () => {
    expect(isClarificationRequest('What do you mean?')).toBe(true)
    expect(isClarificationRequest('Who is this for')).toBe(true)
    expect(isClarificationRequest("I don't know what this means")).toBe(true)
    expect(isClarificationRequest('Is it the sector?')).toBe(true)
  })

  it('does not mistake a real answer for a question', () => {
    expect(isClarificationRequest('Operations section')).toBe(false)
    expect(isClarificationRequest('Help desk')).toBe(false)
    expect(isClarificationRequest('Review answers')).toBe(false)
    expect(isClarificationRequest('')).toBe(false)
  })
})

describe('checkInterviewAnswer', () => {
  it('lets a skip through for any question', () => {
    expect(checkInterviewAnswer('missingOwner', '')).toEqual({ ok: true })
  })

  it('refuses a non-answer', () => {
    expect(checkInterviewAnswer('missingOwner', 'idk')).toEqual({ ok: false, problem: 'notAnAnswer' })
  })

  it('checks the script of a name', () => {
    expect(checkInterviewAnswer('missingEnglishName', 'مراجعة')).toEqual({ ok: false, problem: 'notLatinName' })
    expect(checkInterviewAnswer('missingEnglishName', 'Review answers')).toEqual({ ok: true })
    expect(checkInterviewAnswer('missingArabicName', 'Review answers')).toEqual({ ok: false, problem: 'notArabicName' })
    expect(checkInterviewAnswer('missingArabicName', 'مراجعة الإجابات')).toEqual({ ok: true })
  })

  it('checks a process code is one code-like token', () => {
    expect(checkInterviewAnswer('missingProcessCode', 'SRV-01')).toEqual({ ok: true })
    expect(checkInterviewAnswer('missingProcessCode', 'two words')).toEqual({ ok: false, problem: 'notCode' })
  })

  it('needs a phrase for a decision basis', () => {
    expect(checkInterviewAnswer('missingDecisionBasis', 'Yes')).toEqual({ ok: false, problem: 'notPhrase' })
    expect(checkInterviewAnswer('missingDecisionBasis', 'Are answers complete')).toEqual({ ok: true })
  })

  it('says plainly when the chat cannot fill a gap', () => {
    expect(checkInterviewAnswer('missingReturnTarget', 'Review')).toEqual({ ok: false, problem: 'notFillable' })
  })
})
