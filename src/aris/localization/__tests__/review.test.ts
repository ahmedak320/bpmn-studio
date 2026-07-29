import { describe, expect, it, vi } from 'vitest'

import type { LocalizationResources } from '../../../localization/types'
import { buildArisLocalizationReview, countArisMissingTranslations } from '../review'
import { runArisReviewedTranslation } from '../run'
import { makeDocument, objectDefinition } from './support'

describe('buildArisLocalizationReview', () => {
  it('marks the review source as aris and carries the document revision', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve' })]
    })
    const result = buildArisLocalizationReview({ document, target: 'ar', active: 'en' })
    expect(result.review.source).toBe('aris')
    expect(result.revision).toBe(document.revision)
    expect(typeof result.sourceSignature).toBe('string')
  })

  it('queues a genuinely missing counterpart (no glossary/TM match)', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve' })]
    })
    const { review } = buildArisLocalizationReview({ document, target: 'ar', active: 'en' })
    expect(review.queue).toHaveLength(1)
    expect(review.queue[0]).toMatchObject({
      elementId: 'ObjDef.1',
      target: 'ar',
      sourceLanguage: 'en',
      sourceValue: 'Approve'
    })
  })

  it('does not queue a neutral seeded term ("API"): it resolves locally', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'API' })]
    })
    const { review } = buildArisLocalizationReview({ document, target: 'ar', active: 'en' })
    expect(review.queue).toHaveLength(0)
    // Resolved locally ⇒ a metadata write to the ar locale, never an empty value.
    expect(review.localUpdates.length).toBeGreaterThan(0)
    expect(review.localUpdates.every((patch) => patch.value !== '')).toBe(true)
  })

  it('raises a wrong-script audit issue for Arabic text stored under an English key', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'يعتمد' })]
    })
    const { review } = buildArisLocalizationReview({ document, target: 'en', active: 'ar' })
    expect(
      review.issues.some((issue) => issue.target === 'en' && issue.code === 'wrong-script')
    ).toBe(true)
  })

  it('raises a mixed audit issue for a mixed-script value', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve يعتمد' })]
    })
    const { review } = buildArisLocalizationReview({ document, target: 'en', active: 'en' })
    expect(review.issues.some((issue) => issue.code === 'mixed')).toBe(true)
  })

  it('resolves glossary AND translation-memory pairs with zero provider calls', async () => {
    const resources: LocalizationResources = {
      glossary: [{ en: 'API', ar: 'API', neutral: true }],
      translationMemory: [{ en: 'Approve', ar: 'يعتمد', accepted: true }]
    }
    const document = makeDocument({
      objectDefinitions: [
        objectDefinition('ObjDef.api', 'OT_FUNC', { 'en-US': 'API' }),
        objectDefinition('ObjDef.approve', 'OT_FUNC', { 'en-US': 'Approve' })
      ]
    })
    const { review } = buildArisLocalizationReview({
      document,
      target: 'ar',
      active: 'en',
      resources
    })
    expect(review.queue).toHaveLength(0)
    expect(review.localUpdates.length).toBeGreaterThan(0)

    const translateTexts = vi.fn()
    const run = await runArisReviewedTranslation(review, translateTexts)
    expect(translateTexts).not.toHaveBeenCalled()
    expect(run.proposals).toHaveLength(0)
    expect(run.failures).toHaveLength(0)
  })

  it('never emits a localization patch that writes an empty string', () => {
    const document = makeDocument({
      objectDefinitions: [
        objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'API', '1025': '' }),
        objectDefinition('ObjDef.2', 'OT_FUNC', { 'en-US': 'SLA' })
      ]
    })
    const { review } = buildArisLocalizationReview({ document, target: 'ar', active: 'en' })
    expect(review.localUpdates.every((patch) => patch.value.trim() !== '')).toBe(true)
  })
})

describe('countArisMissingTranslations', () => {
  it('counts named-but-missing-counterpart elements per language', () => {
    const document = makeDocument({
      // A NAMED, bilingual model is complete on both sides ⇒ contributes 0.
      modelName: { 'en-US': 'Process', '1025': 'عملية' },
      objectDefinitions: [
        objectDefinition('ObjDef.en', 'OT_FUNC', { 'en-US': 'Approve' }), // missing ar
        objectDefinition('ObjDef.ar', 'OT_FUNC', { '1025': 'يعتمد' }), // missing en
        objectDefinition('ObjDef.both', 'OT_FUNC', { 'en-US': 'Reject', '1025': 'يرفض' })
      ]
    })
    const counts = countArisMissingTranslations(document)
    expect(counts.en).toBe(1) // ObjDef.ar
    expect(counts.ar).toBe(1) // ObjDef.en
  })

  it('does not count a fully unnamed definition', () => {
    const document = makeDocument({
      modelName: { 'en-US': 'Titled', '1025': 'معنون' },
      objectDefinitions: [objectDefinition('ObjDef.blank', 'OT_FUNC', { 'en-US': '  ' })]
    })
    expect(countArisMissingTranslations(document)).toEqual({ en: 0, ar: 0 })
  })
})
