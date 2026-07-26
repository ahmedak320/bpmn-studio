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
  it('does not call a provider before consent for the exact current disclosure', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    const callLLM = vi.fn()
    await expect(
      translateReviewedDiagram(fake.modeler, callLLM, {
        review,
        disclosure,
        consent: {
          fingerprint: 'another-review',
          grantedAt: '2026-01-01T00:00:00.000Z'
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

  it('applies provider metadata, Arabic SVG projection, and active language in one atomic batch', async () => {
    const fake = makeModel()
    const { review, disclosure } = reviewed(fake.modeler)
    const callLLM = vi.fn(async () => ({ loc_1: 'مراجعة الطلب' }))
    const result = await translateReviewedDiagram(fake.modeler, callLLM, {
      review,
      disclosure,
      consent: grantExternalRequestConsent(disclosure)
    })
    expect(result).toMatchObject({
      translated: 1,
      skipped: 0,
      total: 1,
      complete: true,
      active: 'ar'
    })
    expect(result.review.issues).toEqual([])
    expect(fake.task.$attrs?.['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect(fake.task.name).toBe('مراجعة الطلب')
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('ar')
    expect(fake.batches).toBe(1)
    expect(callLLM).toHaveBeenCalledTimes(1)
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

  it('uses the reviewed free-text path to complete a diagram', async () => {
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
    expect(result.complete).toBe(true)
    expect(fake.task.name).toBe('مراجعة الطلب')
  })
})
