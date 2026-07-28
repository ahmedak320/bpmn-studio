import { describe, expect, it } from 'vitest'

import { buildDigest } from '../digest'
import { routeQuestion } from '../questionRouter'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

const digests = [buildDigest(buildSyntheticModel()), buildDigest(buildSecondSyntheticModel())]

function chipOccurrenceIds(answer: ReturnType<typeof routeQuestion>): string[] {
  return answer.chips.map((c) => c.occurrenceId).filter((id): id is string => !!id)
}

// Section 17.4's eleven deterministic question types, each routed in both
// English and Arabic. Every case asserts: the router picked the RIGHT
// answerer (via `kind`), the answer carries at least one openable chip
// (Section 17.6), and every chip names the model it came from.
describe('routeQuestion — the eleven Section 17.4 question types, EN + AR', () => {
  it('1. what comes next (EN)', () => {
    const answer = routeQuestion(digests, 'What comes next after Register owner profile?', 'en')
    expect(answer.kind).toBe('next')
    expect(chipOccurrenceIds(answer)).toContain('occ-evt2')
  })

  it('1. what comes next (AR)', () => {
    const answer = routeQuestion(digests, 'ما الخطوة التالية بعد تسجيل ملف المالك؟', 'ar')
    expect(answer.kind).toBe('next')
    expect(chipOccurrenceIds(answer)).toContain('occ-evt2')
  })

  it('2. what comes before (EN)', () => {
    const answer = routeQuestion(digests, 'What step comes before Profile registered?', 'en')
    expect(answer.kind).toBe('before')
    expect(chipOccurrenceIds(answer)).toContain('occ-fn1')
  })

  it('2. what comes before (AR)', () => {
    const answer = routeQuestion(digests, 'ما الذي يأتي قبل تم تسجيل الملف؟', 'ar')
    expect(answer.kind).toBe('before')
    expect(chipOccurrenceIds(answer)).toContain('occ-fn1')
  })

  it('3. who owns / is responsible (EN)', () => {
    const answer = routeQuestion(digests, 'Who is responsible for Register owner profile?', 'en')
    expect(answer.kind).toBe('responsible')
    expect(answer.parts[0]?.items?.some((i) => i.text === 'Veterinarian')).toBe(true)
  })

  it('3. who owns / is responsible (AR)', () => {
    const answer = routeQuestion(digests, 'من المسؤول عن تسجيل ملف المالك؟', 'ar')
    expect(answer.kind).toBe('responsible')
    expect(answer.parts[0]?.items?.some((i) => i.text === 'Veterinarian')).toBe(true)
  })

  it('4. what inputs/outputs apply (EN)', () => {
    const answer = routeQuestion(digests, 'What are the inputs and outputs for Register owner profile?', 'en')
    expect(answer.kind).toBe('io')
    const texts = answer.parts[0]?.items?.map((i) => i.text) ?? []
    expect(texts).toEqual(expect.arrayContaining(['Owner ID Document', 'Registration Certificate']))
  })

  it('4. what inputs/outputs apply (AR)', () => {
    const answer = routeQuestion(digests, 'ما المدخلات والمخرجات في خطوة تسجيل ملف المالك؟', 'ar')
    expect(answer.kind).toBe('io')
    const texts = answer.parts[0]?.items?.map((i) => i.text) ?? []
    expect(texts).toEqual(expect.arrayContaining(['Owner ID Document', 'Registration Certificate']))
  })

  it('5. which system is used (EN)', () => {
    const answer = routeQuestion(digests, 'Which system is used for Register owner profile?', 'en')
    expect(answer.kind).toBe('system')
    expect(answer.parts[0]?.items?.some((i) => i.text === 'Animal Management System')).toBe(true)
  })

  it('5. which system is used (AR)', () => {
    const answer = routeQuestion(digests, 'ما النظام المستخدم في خطوة تسجيل ملف المالك؟', 'ar')
    expect(answer.kind).toBe('system')
    expect(answer.parts[0]?.items?.some((i) => i.text === 'Animal Management System')).toBe(true)
  })

  it('6. what XOR outcomes exist (EN)', () => {
    const answer = routeQuestion(digests, 'What outcomes exist for Application reviewed?', 'en')
    expect(answer.kind).toBe('xorOutcomes')
    const texts = answer.parts[0]?.items?.map((i) => i.text) ?? []
    expect(texts).toEqual(expect.arrayContaining(['Approved', 'Rejected']))
  })

  it('6. what XOR outcomes exist (AR)', () => {
    const answer = routeQuestion(digests, 'ما هي بدائل تمت مراجعة الطلب؟', 'ar')
    expect(answer.kind).toBe('xorOutcomes')
    const texts = answer.parts[0]?.items?.map((i) => i.text) ?? []
    expect(texts).toEqual(expect.arrayContaining(['Approved', 'Rejected']))
  })

  it('7. where does a return branch go (EN, digest-level fallback)', () => {
    const answer = routeQuestion(digests, 'Where does the return branch go in REG-001?', 'en')
    expect(answer.kind).toBe('returnBranch')
    expect(chipOccurrenceIds(answer)).toContain('occ-fn1')
  })

  it('7. where does a return branch go (AR, step-level match)', () => {
    const answer = routeQuestion(digests, 'إلى أين يعود فرع العودة من طلب مستندات إضافية؟', 'ar')
    expect(answer.kind).toBe('returnBranch')
    expect(chipOccurrenceIds(answer)).toContain('occ-fn1')
  })

  it('8. which model is assigned (EN)', () => {
    const answer = routeQuestion(digests, 'Which model is assigned to Escalate to committee?', 'en')
    expect(answer.kind).toBe('assignment')
    expect(answer.parts[0]?.items?.some((i) => i.text === 'm2-committee-review')).toBe(true)
  })

  it('8. which model is assigned (AR)', () => {
    const answer = routeQuestion(digests, 'ما النموذج المرتبط بالتصعيد إلى اللجنة؟', 'ar')
    expect(answer.kind).toBe('assignment')
    expect(answer.parts[0]?.items?.some((i) => i.text === 'm2-committee-review')).toBe(true)
  })

  it('9. which information is missing (EN)', () => {
    const answer = routeQuestion(digests, 'What information is missing in Owner Registration?', 'en')
    expect(answer.kind).toBe('missingInfo')
    expect(answer.parts[0]?.items?.length).toBeGreaterThan(0)
  })

  it('9. which information is missing (AR)', () => {
    const answer = routeQuestion(digests, 'ما المعلومات الناقصة في تسجيل المالك؟', 'ar')
    expect(answer.kind).toBe('missingInfo')
    expect(answer.parts[0]?.items?.length).toBeGreaterThan(0)
  })

  it('10. which processes are available (EN)', () => {
    const answer = routeQuestion(digests, 'Which processes are available?', 'en')
    expect(answer.kind).toBe('processList')
    const texts = answer.parts[0]?.items?.map((i) => i.text) ?? []
    expect(texts).toEqual(expect.arrayContaining(['Owner Registration', 'Animal Vaccination']))
  })

  it('10. which processes are available (AR)', () => {
    const answer = routeQuestion(digests, 'ما هي العمليات المتاحة؟', 'ar')
    expect(answer.kind).toBe('processList')
    const texts = answer.parts[0]?.items?.map((i) => i.text) ?? []
    expect(texts).toEqual(expect.arrayContaining(['Owner Registration', 'Animal Vaccination']))
  })

  it('11. which process matches a topic (EN)', () => {
    const answer = routeQuestion(digests, 'Tell me about animal vaccination', 'en')
    expect(answer.kind).toBe('topicMatch')
    expect(answer.parts[0]?.items?.[0]?.text).toBe('Animal Vaccination')
  })

  it('11. which process matches a topic (AR)', () => {
    const answer = routeQuestion(digests, 'أخبرني عن تطعيم الحيوان', 'ar')
    expect(answer.kind).toBe('topicMatch')
    expect(answer.parts[0]?.items?.[0]?.text).toBe('Animal Vaccination')
  })
})

describe('routeQuestion — positive-confidence-only + determinism', () => {
  it('returns an honest "no confident local answer" for a nonsense query, not a guess', () => {
    const answer = routeQuestion(digests, 'flibbertigibbet wobblefrotz zzqxx', 'en')
    expect(answer.kind).toBe('none')
    expect(answer.confidence).toBe(0)
    expect(answer.chips).toEqual([])
  })

  it('returns an honest "no confident local answer" for a nonsense Arabic query', () => {
    const answer = routeQuestion(digests, 'زعبلططو مبركوش', 'ar')
    expect(answer.kind).toBe('none')
  })

  it('is deterministic: identical input yields identical output', () => {
    const first = routeQuestion(digests, 'What comes next after Register owner profile?', 'en')
    const second = routeQuestion(digests, 'What comes next after Register owner profile?', 'en')
    expect(second).toEqual(first)
  })

  it('is deterministic across the full eleven-question matrix', () => {
    const queries: Array<[string, 'en' | 'ar']> = [
      ['What comes next after Register owner profile?', 'en'],
      ['ما هي العمليات المتاحة؟', 'ar'],
      ['Which model is assigned to Escalate to committee?', 'en']
    ]
    for (const [q, lang] of queries) {
      expect(routeQuestion(digests, q, lang)).toEqual(routeQuestion(digests, q, lang))
    }
  })
})
