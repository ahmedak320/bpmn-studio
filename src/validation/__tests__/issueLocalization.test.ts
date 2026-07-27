import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../../i18n'
import { validationIssue, type ValidationSource } from '../contracts'
import {
  KNOWN_BPMNLINT_RULE_IDS,
  KNOWN_VALIDATION_ISSUE_CODES,
  localizeValidationIssue
} from '../issueLocalization'

const ARABIC = /[\u0600-\u06ff]/u

function sourceFor(code: string): ValidationSource {
  const source = code.split('.')[0]
  return (
    [
      'xml',
      'moddle',
      'xsd',
      'bpmnlint',
      'structure',
      'semantic',
      'di',
      'orbitpm',
      'preservation'
    ] as const
  ).includes(source as ValidationSource)
    ? (source as ValidationSource)
    : 'semantic'
}

function issue(code: string, source = sourceFor(code), ruleId?: string) {
  return validationIssue({
    code,
    severity: 'error',
    source,
    message: `RAW EXTERNAL DIAGNOSTIC FOR ${code}`,
    ...(ruleId ? { ruleId } : {})
  })
}

afterEach(() => {
  setLang('en')
})

describe('validation issue localization', () => {
  it('exhaustively localizes all 68 fixed internal codes in English and Arabic', () => {
    expect(KNOWN_VALIDATION_ISSUE_CODES).toHaveLength(68)
    expect(new Set(KNOWN_VALIDATION_ISSUE_CODES).size).toBe(68)

    setLang('en')
    const english = KNOWN_VALIDATION_ISSUE_CODES.map((code) => localizeValidationIssue(issue(code)))
    expect(english.every((copy) => copy.classification === 'known')).toBe(true)
    expect(
      english.every(
        (copy) =>
          copy.message.length > 0 &&
          copy.suggestedRepair.length > 0 &&
          !copy.message.includes('RAW EXTERNAL')
      )
    ).toBe(true)

    setLang('ar')
    const arabic = KNOWN_VALIDATION_ISSUE_CODES.map((code) => localizeValidationIssue(issue(code)))
    expect(arabic.every((copy) => ARABIC.test(copy.message))).toBe(true)
    expect(arabic.every((copy) => ARABIC.test(copy.suggestedRepair))).toBe(true)
    expect(arabic.map(({ message }) => message)).not.toEqual(english.map(({ message }) => message))
  })

  it('recognizes every statically bundled bpmnlint rule without using raw diagnostics', () => {
    expect(KNOWN_BPMNLINT_RULE_IDS).toHaveLength(25)
    expect(new Set(KNOWN_BPMNLINT_RULE_IDS).size).toBe(25)
    setLang('ar')

    for (const ruleId of KNOWN_BPMNLINT_RULE_IDS) {
      const copy = localizeValidationIssue(issue(`bpmnlint.${ruleId}`, 'bpmnlint', ruleId))
      expect(copy.classification).toBe('known')
      expect(copy.message).toMatch(ARABIC)
      expect(copy.suggestedRepair).toMatch(ARABIC)
      expect(copy.message).not.toContain(ruleId)
      expect(copy.message).not.toContain('RAW EXTERNAL')
    }
  })

  it('uses localized family copy for dynamic external rules and a safe unknown fallback', () => {
    setLang('ar')

    expect(localizeValidationIssue(issue('xsd.vendor-cvc-42', 'xsd'))).toMatchObject({
      classification: 'external',
      message: expect.stringMatching(ARABIC),
      suggestedRepair: expect.stringMatching(ARABIC)
    })
    expect(
      localizeValidationIssue(issue('bpmnlint.vendor-rule', 'bpmnlint', 'vendor-rule'))
    ).toMatchObject({
      classification: 'external',
      message: expect.stringMatching(ARABIC),
      suggestedRepair: expect.stringMatching(ARABIC)
    })

    const unknown = localizeValidationIssue(issue('semantic.future-rule', 'semantic'))
    expect(unknown).toMatchObject({
      classification: 'fallback',
      message: expect.stringMatching(ARABIC),
      suggestedRepair: expect.stringMatching(ARABIC)
    })
    expect(unknown.message).not.toContain('future-rule')
    expect(unknown.message).not.toContain('RAW EXTERNAL')
  })
})
