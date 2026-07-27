import { describe, expect, it, vi } from 'vitest'
import {
  ExternalRequestConsentRequiredError,
  buildTranslationExternalReview,
  translateReviewedDiagram,
  translateReviewedDiagramWithTexts
} from '../translate'
import { inspectDiagramLocalization } from '../../localization/modelerAdapter'
import { grantExternalRequestConsent } from '../../localization/externalRequestReview'

interface Bo {
  $type: string
  id: string
  name?: string
  $attrs?: Record<string, unknown>
  $parent?: Bo
  flowElements?: Bo[]
  [key: string]: unknown
}

function makeModel() {
  const process: Bo = {
    $type: 'bpmn:Process',
    id: 'Process_1',
    $attrs: { 'orbitpm:activeLang': 'en' }
  }
  const task: Bo = {
    $type: 'bpmn:Task',
    id: 'Task_1',
    name: 'Review request',
    $attrs: { 'orbitpm:nameEn': 'Review request' },
    $parent: process
  }
  process.flowElements = [task]
  const root = { id: process.id, businessObject: process }
  const element = { id: task.id, businessObject: task }
  let batches = 0
  const apply = (target: unknown, properties: Record<string, unknown>): void => {
    const bo = (target as { businessObject?: Bo }).businessObject
    if (!bo) return
    for (const [key, value] of Object.entries(properties)) {
      if (key.includes(':')) {
        bo.$attrs = { ...(bo.$attrs ?? {}), [key]: value }
      } else {
        bo[key] = value
      }
    }
  }
  const definitions = {
    $type: 'bpmn:Definitions',
    rootElements: [process]
  }
  const modeler = {
    getDefinitions: () => definitions,
    get(name: string): unknown {
      if (name === 'canvas') return { getRootElement: () => root }
      if (name === 'elementRegistry') return { getAll: () => [element] }
      if (name === 'modeling') return { updateProperties: apply }
      if (name === 'orbitpmModelingBatch') {
        return {
          execute(
            updates: Array<{
              kind: string
              element: unknown
              properties?: Record<string, unknown>
            }>
          ) {
            batches += 1
            for (const update of updates) {
              if (update.kind === 'properties' && update.properties) {
                apply(update.element, update.properties)
              }
            }
          }
        }
      }
      throw new Error(name)
    }
  }
  return {
    modeler,
    process,
    task,
    get batches() {
      return batches
    }
  }
}

function makeLargeModel(count: number) {
  const process: Bo = {
    $type: 'bpmn:Process',
    id: 'Process_large',
    $attrs: { 'orbitpm:activeLang': 'en' }
  }
  const tasks = Array.from({ length: count }, (_, index): Bo => {
    const name = `Review request ${index}`
    return {
      $type: 'bpmn:Task',
      id: `Task_${index}`,
      name,
      $attrs: { 'orbitpm:nameEn': name },
      $parent: process
    }
  })
  process.flowElements = tasks
  const root = { id: process.id, businessObject: process }
  const elements = tasks.map((task) => ({ id: task.id, businessObject: task }))
  const definitions = {
    $type: 'bpmn:Definitions',
    rootElements: [process]
  }
  const modeler = {
    getDefinitions: () => definitions,
    get(name: string): unknown {
      if (name === 'canvas') return { getRootElement: () => root }
      if (name === 'elementRegistry') return { getAll: () => elements }
      if (name === 'modeling' || name === 'orbitpmModelingBatch') {
        throw new Error('A reviewed provider result must not mutate the diagram.')
      }
      throw new Error(name)
    }
  }
  return { modeler, process, tasks }
}

function reviewed(modeler: ReturnType<typeof makeModel>['modeler']) {
  const review = inspectDiagramLocalization(modeler, 'ar')
  const disclosure = buildTranslationExternalReview(review, {
    providerId: 'provider',
    modelId: 'model',
    kind: 'ai'
  })
  return { review, disclosure }
}

describe('reviewed translation execution', () => {
  it('discloses worst-case transport and parse-repair request counts', () => {
    const fake = makeModel()
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    expect(
      buildTranslationExternalReview(review, {
        providerId: 'provider',
        modelId: 'model',
        kind: 'ai'
      }).estimatedRequests
    ).toEqual({ min: 1, max: 6 })
    expect(
      buildTranslationExternalReview(review, {
        providerId: 'free',
        kind: 'free'
      }).estimatedRequests
    ).toEqual({ min: 1, max: 6 })
  })

  it('does not call a provider before consent for the exact current disclosure', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    const callLLM = vi.fn()
    await expect(
      translateReviewedDiagram(fake.modeler, callLLM, {
        review,
        disclosure,
        consent: {
          ...grantExternalRequestConsent(disclosure, '2026-01-01T00:00:00.000Z'),
          fingerprint: 'another-review'
        }
      })
    ).rejects.toBeInstanceOf(ExternalRequestConsentRequiredError)
    expect(callLLM).not.toHaveBeenCalled()
    expect(fake.batches).toBe(0)
  })

  it('rejects stale reviewed text before a provider call', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    fake.task.name = 'Changed request'
    fake.task.$attrs = {
      ...fake.task.$attrs,
      'orbitpm:nameEn': 'Changed request'
    }
    const callLLM = vi.fn()
    await expect(
      translateReviewedDiagram(fake.modeler, callLLM, {
        review,
        disclosure,
        consent: grantExternalRequestConsent(disclosure)
      })
    ).rejects.toThrow('diagram changed')
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('returns an explicit acceptance proposal without mutating metadata, projection, or language', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    const callLLM = vi.fn(async () => ({ loc_1: 'مراجعة الطلب' }))
    const result = await translateReviewedDiagram(fake.modeler, callLLM, {
      review,
      disclosure,
      consent: grantExternalRequestConsent(disclosure)
    })
    expect(result).toMatchObject({
      translated: 0,
      proposed: 1,
      skipped: 1,
      total: 1,
      complete: false,
      active: 'en'
    })
    expect(result.proposals).toEqual([
      expect.objectContaining({
        elementId: 'Task_1',
        sourceValue: 'Review request',
        target: 'ar',
        value: 'مراجعة الطلب'
      })
    ])
    expect(result.review.queue).toHaveLength(1)
    expect(fake.task.$attrs?.['orbitpm:nameAr']).toBeUndefined()
    expect(fake.task.name).toBe('Review request')
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('en')
    expect(fake.batches).toBe(0)
    expect(callLLM).toHaveBeenCalledTimes(1)
  })

  it('reuses the reviewed workspace glossary for provider and post-apply audits', async () => {
    const fake = makeModel()
    fake.task.name = 'REVIEW REQUEST'
    fake.task.$attrs = { 'orbitpm:nameEn': 'REVIEW REQUEST' }
    const glossary = [{ en: 'API', ar: 'API', neutral: true }] as const
    const review = inspectDiagramLocalization(fake.modeler, 'ar', {
      glossary,
      translationMemory: []
    })
    const disclosure = buildTranslationExternalReview(review, {
      providerId: 'provider',
      modelId: 'model',
      kind: 'ai'
    })
    const result = await translateReviewedDiagram(fake.modeler, async () => ({ loc_1: 'API' }), {
      review,
      disclosure,
      consent: grantExternalRequestConsent(disclosure)
    })

    expect(result.complete).toBe(false)
    expect(result.proposals).toEqual([
      expect.objectContaining({ sourceValue: 'REVIEW REQUEST', value: 'API' })
    ])
    expect(result.providerFailures).toEqual([])
    expect(result.review.localResources.glossary).toEqual(glossary)
    expect(fake.task.$attrs?.['orbitpm:nameAr']).toBeUndefined()
    expect(fake.task.name).toBe('REVIEW REQUEST')
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('en')
  })

  it('keeps invalid or omitted provider results listed and never false-succeeds', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    const result = await translateReviewedDiagram(
      fake.modeler,
      async () => ({ loc_1: 'Still English' }),
      {
        review,
        disclosure,
        consent: grantExternalRequestConsent(disclosure)
      }
    )
    expect(result.complete).toBe(false)
    expect(result.active).toBe('en')
    expect(result.translated).toBe(0)
    expect(result.review.queue).toHaveLength(1)
    expect(result.review.issues.map((issue) => issue.code)).toContain('provider-failed')
    expect(fake.task.name).toBe('Review request')
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('en')
  })

  it('propagates provider failure without applying a half-finished batch', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    await expect(
      translateReviewedDiagram(
        fake.modeler,
        async () => {
          throw new Error('provider offline')
        },
        {
          review,
          disclosure,
          consent: grantExternalRequestConsent(disclosure)
        }
      )
    ).rejects.toThrow('provider offline')
    expect(fake.batches).toBe(0)
    expect(fake.task.$attrs?.['orbitpm:nameAr']).toBeUndefined()
  })

  it('preserves a valid target supplied while the provider request is in flight', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    await expect(
      translateReviewedDiagram(
        fake.modeler,
        async () => {
          fake.task.$attrs = {
            ...fake.task.$attrs,
            'orbitpm:nameAr': 'ترجمة المستخدم'
          }
          return { loc_1: 'ترجمة المزوّد' }
        },
        {
          review,
          disclosure,
          consent: grantExternalRequestConsent(disclosure)
        }
      )
    ).rejects.toThrow('diagram changed')
    expect(fake.task.$attrs?.['orbitpm:nameAr']).toBe('ترجمة المستخدم')
    expect(fake.batches).toBe(0)
  })

  it('passes AbortController cancellation through the free-text transport and writes nothing', async () => {
    const fake = makeModel()
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    const disclosure = buildTranslationExternalReview(review, {
      providerId: 'free',
      kind: 'free'
    })
    const controller = new AbortController()
    const translateTexts = vi.fn(
      async (
        _texts: string[],
        _from: 'en' | 'ar',
        _to: 'en' | 'ar',
        signal?: AbortSignal
      ): Promise<Array<string | undefined>> =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const pending = translateReviewedDiagramWithTexts(fake.modeler, translateTexts, {
      review,
      disclosure,
      consent: grantExternalRequestConsent(disclosure),
      signal: controller.signal
    })
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(translateTexts).toHaveBeenCalledTimes(1)
    expect(fake.batches).toBe(0)
    expect(fake.task.$attrs?.['orbitpm:nameAr']).toBeUndefined()
  })

  it('uses the reviewed free-text path to create a proposal without completing a diagram', async () => {
    const fake = makeModel()
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    const disclosure = buildTranslationExternalReview(review, {
      providerId: 'free',
      kind: 'free'
    })
    const result = await translateReviewedDiagramWithTexts(
      fake.modeler,
      async (texts, from, to, signal) => {
        expect(texts).toEqual(['Review request'])
        expect(from).toBe('en')
        expect(to).toBe('ar')
        expect(signal?.aborted).toBe(false)
        return ['مراجعة الطلب']
      },
      {
        review,
        disclosure,
        consent: grantExternalRequestConsent(disclosure),
        signal: new AbortController().signal
      }
    )
    expect(result.complete).toBe(false)
    expect(result.proposals).toEqual([
      expect.objectContaining({ sourceValue: 'Review request', value: 'مراجعة الطلب' })
    ])
    expect(fake.task.name).toBe('Review request')
    expect(fake.batches).toBe(0)
  })

  it('derives and finalizes eight thousand real BPMN proposal rows within the linear budget', async () => {
    const count = 8_000
    const fake = makeLargeModel(count)
    const deriveStartedAt = performance.now()
    const review = inspectDiagramLocalization(fake.modeler, 'ar', {
      glossary: [],
      translationMemory: []
    })
    const deriveElapsedMs = performance.now() - deriveStartedAt
    expect(review.fields).toHaveLength(count)
    expect(review.queue).toHaveLength(count)
    expect(deriveElapsedMs).toBeLessThan(5_000)

    const disclosure = buildTranslationExternalReview(review, {
      providerId: 'free',
      kind: 'free'
    })
    const translateTexts = vi.fn(async (texts: string[]) =>
      texts.map((_, index) => `ترجمة ${index}`)
    )
    const finalizeStartedAt = performance.now()
    const result = await translateReviewedDiagramWithTexts(fake.modeler, translateTexts, {
      review,
      disclosure,
      consent: grantExternalRequestConsent(disclosure)
    })
    const finalizeElapsedMs = performance.now() - finalizeStartedAt

    expect(finalizeElapsedMs).toBeLessThan(10_000)
    expect(translateTexts).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      translated: 0,
      proposed: count,
      skipped: count,
      total: count,
      complete: false,
      active: 'en'
    })
    expect(result.proposals).toHaveLength(count)
    expect(result.proposals[7_999]).toMatchObject({
      elementId: 'Task_999',
      value: 'ترجمة 7999'
    })
    expect(fake.tasks.every((task) => task.$attrs?.['orbitpm:nameAr'] === undefined)).toBe(true)
    expect(fake.tasks.every((task, index) => task.name === `Review request ${index}`)).toBe(true)
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('en')
  }, 20_000)

  it('cancels cooperative proposal finalization after transport without exposing partial results', async () => {
    const fake = makeLargeModel(2_048)
    const review = inspectDiagramLocalization(fake.modeler, 'ar', {
      glossary: [],
      translationMemory: []
    })
    const disclosure = buildTranslationExternalReview(review, {
      providerId: 'free',
      kind: 'free'
    })
    const controller = new AbortController()
    const pending = translateReviewedDiagramWithTexts(
      fake.modeler,
      async (texts) => {
        globalThis.setTimeout(
          () => controller.abort(new DOMException('cancelled', 'AbortError')),
          0
        )
        return texts.map((_, index) => `ترجمة ${index}`)
      },
      {
        review,
        disclosure,
        consent: grantExternalRequestConsent(disclosure),
        signal: controller.signal
      }
    )

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.tasks.every((task) => task.$attrs?.['orbitpm:nameAr'] === undefined)).toBe(true)
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('en')
  })
})
