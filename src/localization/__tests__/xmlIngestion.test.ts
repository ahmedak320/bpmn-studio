import { describe, expect, it, vi } from 'vitest'

import { UNKNOWN_EXTENSION_XML, validMultiProcessXml } from '../../validation/__tests__/fixtures'
import {
  LocalizationSource,
  SEEDED_GLOSSARY,
  reviewBpmnXmlLocalization,
  type ReviewedXmlIngestionReviewRequest
} from '..'

const resources = Object.freeze({
  glossary: SEEDED_GLOSSARY,
  translationMemory: Object.freeze([])
})

function options(
  overrides: Partial<Parameters<typeof reviewBpmnXmlLocalization>[1]> = {}
): Parameters<typeof reviewBpmnXmlLocalization>[1] {
  return {
    source: LocalizationSource.Xml,
    target: 'ar',
    resources,
    validation: { requireDi: true },
    ...overrides
  }
}

function missingArabicStart(): string {
  return validMultiProcessXml().replace(' orbitpm:nameAr="بداية"', '')
}

function wrongArabicStart(): string {
  return validMultiProcessXml().replace('orbitpm:nameAr="بداية"', 'orbitpm:nameAr="Start"')
}

function editFor(request: ReviewedXmlIngestionReviewRequest, elementId: string, value: string) {
  const field = request.ingestion.localPlan.fields.find(
    (candidate) => candidate.elementId === elementId && candidate.field === 'name'
  )
  if (!field) throw new Error(`missing field ${elementId}`)
  return {
    processId: field.processId,
    elementId: field.elementId,
    field: field.field,
    target: 'ar' as const,
    expectedValue: field.value.ar ?? null,
    value
  }
}

describe('reviewed source-aware XML localization ingestion', () => {
  it('auto-completes already-valid multi-process input without invoking review', async () => {
    const originalXml = validMultiProcessXml()
    const review = vi.fn()
    const outcome = await reviewBpmnXmlLocalization(
      originalXml,
      options({
        source: LocalizationSource.Pdf,
        target: 'en',
        review
      })
    )

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(review).not.toHaveBeenCalled()
    expect(outcome.reviewMode).toBe('automatic-complete')
    expect(outcome.xml).toBe(originalXml)
    expect(outcome.digest).toBe(outcome.evidence.outputDigest)
    expect(outcome.evidence.source).toBe(LocalizationSource.Pdf)
    expect(outcome.evidence.processIds).toEqual(['Process_1', 'Process_2'])
    expect(outcome.evidence.planeIds).toEqual(['Plane_1', 'Plane_2'])
    expect(outcome.evidence.visibleTargetVerified).toBe(true)
    expect(Object.isFrozen(outcome)).toBe(true)
    expect(Object.isFrozen(outcome.request.ingestion.localPlan.fields)).toBe(true)
  })

  it('projects a complete Arabic target locally and strict-revalidates serialized visibility', async () => {
    const outcome = await reviewBpmnXmlLocalization(
      validMultiProcessXml(),
      options({ source: LocalizationSource.Ai })
    )

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.reviewMode).toBe('automatic-complete')
    expect(outcome.xml).toContain('orbitpm:activeLang="ar"')
    expect(outcome.xml).toContain('name="بداية"')
    expect(outcome.evidence.outputValidation.valid).toBe(true)
    expect(outcome.evidence.finalAudit.issues).toEqual([])
    expect(outcome.evidence.appliedPatches.projection).toBeGreaterThan(0)
  })

  it('returns an immutable source-provenance report when explicit review is required', async () => {
    const originalXml = missingArabicStart()
    const outcome = await reviewBpmnXmlLocalization(
      originalXml,
      options({ source: LocalizationSource.Backup, review: undefined })
    )

    expect(outcome.status).toBe('review-required')
    if (outcome.status !== 'review-required') return
    expect(outcome.request.originalXml).toBe(originalXml)
    expect(outcome.request.source).toBe(LocalizationSource.Backup)
    expect(outcome.request.ingestion.audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: LocalizationSource.Backup,
          elementId: 'Start_1',
          target: 'ar',
          code: 'missing'
        })
      ])
    )
    expect(outcome.request.queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: LocalizationSource.Backup,
          elementId: 'Start_1',
          target: 'ar'
        })
      ])
    )
    expect(Object.isFrozen(outcome.request)).toBe(true)
  })

  it('applies only exact reviewed field edits and completes wrong-script repair', async () => {
    const review = vi.fn(async (request: ReviewedXmlIngestionReviewRequest) => ({
      status: 'completed' as const,
      reviewDigest: request.reviewDigest,
      edits: [editFor(request, 'Start_1', 'انطلاق')]
    }))
    const outcome = await reviewBpmnXmlLocalization(
      wrongArabicStart(),
      options({ source: LocalizationSource.Aris, review })
    )

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(review).toHaveBeenCalledOnce()
    expect(outcome.reviewMode).toBe('explicit')
    expect(outcome.xml).toContain('orbitpm:nameAr="انطلاق"')
    expect(outcome.xml).toContain('name="انطلاق"')
    expect(outcome.evidence.reviewedEdits).toEqual([
      expect.objectContaining({ elementId: 'Start_1', value: 'انطلاق' })
    ])
    expect(outcome.evidence.finalAudit.issues).toEqual([])
  })

  it('returns cancellation without exposing candidate output XML', async () => {
    const outcome = await reviewBpmnXmlLocalization(
      missingArabicStart(),
      options({
        review: async () => ({ status: 'cancelled' })
      })
    )

    expect(outcome.status).toBe('cancelled')
    expect('xml' in outcome).toBe(false)
  })

  it('rejects stale review digests and stale caller generations before mutation', async () => {
    await expect(
      reviewBpmnXmlLocalization(
        missingArabicStart(),
        options({
          review: async (request) => ({
            status: 'completed',
            reviewDigest: `${request.reviewDigest}-tampered`,
            edits: [editFor(request, 'Start_1', 'انطلاق')]
          })
        })
      )
    ).rejects.toMatchObject({
      code: 'review-tampered'
    })

    let checks = 0
    await expect(
      reviewBpmnXmlLocalization(
        validMultiProcessXml(),
        options({
          isCurrent: () => {
            checks += 1
            return checks < 3
          }
        })
      )
    ).rejects.toMatchObject({
      code: 'stale'
    })
  })

  it('digest-binds field-scoped neutral and English proper-name approvals', async () => {
    const neutralXml = validMultiProcessXml()
      .replace('orbitpm:nameAr="بداية"', 'orbitpm:nameAr="CUSTOM"')
      .replace('orbitpm:nameEn="Start"', 'orbitpm:nameEn="CUSTOM"')
      .replace('name="Start"', 'name="CUSTOM"')
    const neutral = await reviewBpmnXmlLocalization(
      neutralXml,
      options({
        review: async (request) => ({
          status: 'completed',
          reviewDigest: request.reviewDigest,
          edits: [],
          approvals: [
            {
              processId: 'Process_1',
              elementId: 'Start_1',
              field: 'name',
              target: 'ar',
              value: 'CUSTOM',
              kind: 'neutral'
            }
          ]
        })
      })
    )
    expect(neutral.status).toBe('completed')
    if (neutral.status === 'completed') {
      expect(neutral.evidence.reviewedApprovals).toEqual([
        expect.objectContaining({ kind: 'neutral', value: 'CUSTOM' })
      ])
      expect(neutral.evidence.finalAudit.issues).toEqual([])
      expect(neutral.reviewDigest).not.toBe(neutral.request.reviewDigest)
    }

    const properName = 'DMT دائرة'
    const properXml = validMultiProcessXml()
      .replace('orbitpm:nameEn="Start"', `orbitpm:nameEn="${properName}"`)
      .replace('name="Start"', `name="${properName}"`)
    const proper = await reviewBpmnXmlLocalization(
      properXml,
      options({
        review: async (request) => ({
          status: 'completed',
          reviewDigest: request.reviewDigest,
          edits: [],
          approvals: [
            {
              processId: 'Process_1',
              elementId: 'Start_1',
              field: 'name',
              target: 'en',
              value: properName,
              kind: 'english-bilingual'
            }
          ]
        })
      })
    )
    expect(proper.status).toBe('completed')
    if (proper.status === 'completed') {
      expect(proper.evidence.finalAudit.issues).toEqual([])
    }

    await expect(
      reviewBpmnXmlLocalization(
        neutralXml,
        options({
          review: async (request) => ({
            status: 'completed',
            reviewDigest: request.reviewDigest,
            edits: [],
            approvals: [
              {
                processId: 'Process_1',
                elementId: 'Start_1',
                field: 'name',
                target: 'ar',
                value: 'TAMPERED',
                kind: 'neutral'
              }
            ]
          })
        })
      )
    ).rejects.toMatchObject({ code: 'review-tampered' })
  })

  it('preserves exact unknown extensions when no mutation is needed and fails closed otherwise', async () => {
    const unchanged = await reviewBpmnXmlLocalization(
      UNKNOWN_EXTENSION_XML,
      options({
        source: LocalizationSource.Editor,
        target: 'en',
        validation: { requireDi: false }
      })
    )
    expect(unchanged.status).toBe('completed')
    if (unchanged.status === 'completed') {
      expect(unchanged.xml).toBe(UNKNOWN_EXTENSION_XML)
      expect(unchanged.evidence.unknownExtensionsPreserved).toBe(true)
    }

    const projected = UNKNOWN_EXTENSION_XML.replace(
      '<bpmn:process id="Process_extensions" foo:checksum="abc123">',
      '<bpmn:process id="Process_extensions" name="Extensions" foo:checksum="abc123" ' +
        'orbitpm:activeLang="en" orbitpm:nameEn="Extensions" orbitpm:nameAr="الملحقات">'
    )
    await expect(
      reviewBpmnXmlLocalization(
        projected,
        options({
          source: LocalizationSource.Editor,
          validation: { requireDi: false }
        })
      )
    ).rejects.toMatchObject({
      code: 'preservation-failed'
    })
  })
})
