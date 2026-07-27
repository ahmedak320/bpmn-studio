import { describe, expect, it } from 'vitest'
import type { DiagramLocalizationReview } from '../modelerAdapter'
import {
  buildTranslationRecoveryDisclosure,
  deriveTranslationReviewProgress,
  listTranslationRecoveryFields,
  translationRecoveryFieldId,
  validateTranslationRecoveryValue
} from '../translationRecovery'
import {
  LocalizationSource,
  type LocalizationField,
  type LocalizationIssue,
  type TranslationQueueItem
} from '../types'

function issue(elementId: string, target: 'en' | 'ar', originalValue?: string): LocalizationIssue {
  return {
    source: LocalizationSource.Editor,
    processId: 'Process_1',
    elementId,
    field: 'name',
    target,
    code: 'missing',
    ...(originalValue === undefined ? {} : { originalValue })
  }
}

describe('translation recovery issue-only rows', () => {
  it('retains orphan target issues for manual repair and ignores the opposite target', () => {
    const withEvidence = issue('Task_with_evidence', 'ar', 'Review request')
    const withoutEvidence = issue('Task_without_evidence', 'ar')
    const oppositeTarget = issue('Task_other_target', 'en', 'طلب المراجعة')
    const review: DiagramLocalizationReview = {
      source: LocalizationSource.Editor,
      target: 'ar',
      fields: [],
      issues: [withEvidence, withoutEvidence, oppositeTarget],
      queue: [],
      localUpdates: [],
      projected: 0,
      unchanged: 0,
      blockers: [withEvidence, withoutEvidence],
      complete: false,
      localResources: { glossary: [], translationMemory: [] }
    }

    const rows = listTranslationRecoveryFields(review)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      elementId: 'Task_with_evidence',
      sourceLanguage: 'ar',
      sourceValue: 'Review request',
      retryable: false,
      editable: false,
      requiresManualReview: true,
      issueCodes: ['missing']
    })
    expect(rows[0]).not.toHaveProperty('queueItem')
    expect(rows[1]).toMatchObject({
      elementId: 'Task_without_evidence',
      sourceLanguage: 'ar',
      sourceValue: '',
      retryable: false,
      requiresManualReview: true
    })
    expect(
      translationRecoveryFieldId({
        processId: rows[0]!.processId,
        elementId: rows[0]!.elementId,
        field: rows[0]!.field,
        target: rows[0]!.target
      })
    ).toBe(rows[0]!.id)

    expect(deriveTranslationReviewProgress(review)).toEqual({
      total: 0,
      resolved: 0,
      unresolved: 2,
      failed: 0,
      complete: false
    })
    expect(validateTranslationRecoveryValue(review, rows[0]!, '  مراجعة الطلب  ')).toEqual({
      valid: false,
      value: 'مراجعة الطلب',
      issues: [withEvidence]
    })
    expect(() =>
      buildTranslationRecoveryDisclosure(rows[0]!, {
        providerId: 'provider-that-must-not-run'
      })
    ).toThrow('requires manual review')
  })

  it('derives thousands of unresolved rows once within the linear-operation budget', () => {
    const count = 8_000
    const fields: LocalizationField[] = []
    const issues: LocalizationIssue[] = []
    const queue: TranslationQueueItem[] = []
    for (let index = 0; index < count; index += 1) {
      const elementId = `Task_${index}`
      const field: LocalizationField = {
        source: LocalizationSource.Editor,
        processId: 'Process_1',
        elementId,
        elementType: 'bpmn:Task',
        field: 'name',
        kind: 'name',
        value: { en: `Review request ${index}`, active: 'en' },
        sourceLanguage: 'en',
        projection: `Review request ${index}`,
        origins: { en: 'paired' },
        storage: {
          enProperty: 'orbitpm:nameEn',
          arProperty: 'orbitpm:nameAr',
          projectionProperty: 'name'
        },
        planeIds: []
      }
      const missing = issue(elementId, 'ar', field.value.en)
      fields.push(field)
      issues.push(missing)
      queue.push({
        source: LocalizationSource.Editor,
        processId: 'Process_1',
        elementId,
        field: 'name',
        sourceLanguage: 'en',
        sourceValue: field.value.en!,
        target: 'ar',
        issues: [missing]
      })
    }
    const review: DiagramLocalizationReview = {
      source: LocalizationSource.Editor,
      target: 'ar',
      fields,
      issues,
      queue,
      localUpdates: [],
      projected: 0,
      unchanged: count,
      blockers: issues,
      complete: false,
      localResources: { glossary: [], translationMemory: [] }
    }

    const startedAt = performance.now()
    const rows = listTranslationRecoveryFields(review)
    const progress = deriveTranslationReviewProgress(review, rows)
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(750)
    expect(rows).toHaveLength(count)
    expect(rows[7_999]).toMatchObject({
      elementId: 'Task_7999',
      sourceValue: 'Review request 7999',
      target: 'ar'
    })
    expect(progress).toEqual({
      total: count,
      resolved: 0,
      unresolved: count,
      failed: 0,
      complete: false
    })
  })
})
