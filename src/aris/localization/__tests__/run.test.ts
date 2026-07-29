import { describe, expect, it, vi } from 'vitest'

import type { TranslateTextsFn } from '../../../ai/translate'
import { buildArisLocalizationReview } from '../review'
import { runArisReviewedTranslation } from '../run'
import { makeDocument, objectDefinition } from './support'

/** A review with exactly one missing Arabic counterpart in its queue. */
function reviewWithOneArGap() {
  const document = makeDocument({
    objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve' })]
  })
  const { review } = buildArisLocalizationReview({ document, target: 'ar', active: 'en' })
  expect(review.queue).toHaveLength(1)
  return review
}

class FreeTranslateError extends Error {}

describe('runArisReviewedTranslation', () => {
  it('turns a valid provider result into a proposal', async () => {
    const review = reviewWithOneArGap()
    const translateTexts: TranslateTextsFn = vi.fn(async () => ['يعتمد'])
    const result = await runArisReviewedTranslation(review, translateTexts)
    expect(translateTexts).toHaveBeenCalledWith(['Approve'], 'en', 'ar', undefined)
    expect(result.failures).toHaveLength(0)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]).toMatchObject({
      elementId: 'ObjDef.1',
      target: 'ar',
      sourceLanguage: 'en',
      sourceValue: 'Approve',
      value: 'يعتمد'
    })
  })

  it('records a per-text miss (undefined) as a ProviderFailure', async () => {
    const review = reviewWithOneArGap()
    const result = await runArisReviewedTranslation(review, async () => [undefined])
    expect(result.proposals).toHaveLength(0)
    expect(result.failures).toEqual([
      {
        processId: expect.any(String),
        elementId: 'ObjDef.1',
        field: 'name',
        target: 'ar',
        originalValue: 'Approve'
      }
    ])
  })

  it('rejects a wrong-script result (English returned for an Arabic target)', async () => {
    const review = reviewWithOneArGap()
    const result = await runArisReviewedTranslation(review, async () => ['Approved'])
    expect(result.proposals).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
  })

  it('rejects a result identical to the source value', async () => {
    const review = reviewWithOneArGap()
    const result = await runArisReviewedTranslation(review, async () => ['Approve'])
    expect(result.proposals).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
  })

  it('propagates a whole-chain provider failure', async () => {
    const review = reviewWithOneArGap()
    await expect(
      runArisReviewedTranslation(review, async () => {
        throw new FreeTranslateError('service down')
      })
    ).rejects.toBeInstanceOf(FreeTranslateError)
  })

  it('makes no provider call for an empty queue', async () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'API' })]
    })
    const { review } = buildArisLocalizationReview({ document, target: 'ar', active: 'en' })
    const translateTexts = vi.fn()
    const result = await runArisReviewedTranslation(review, translateTexts)
    expect(translateTexts).not.toHaveBeenCalled()
    expect(result.proposals).toHaveLength(0)
    expect(result.failures).toHaveLength(0)
  })
})
