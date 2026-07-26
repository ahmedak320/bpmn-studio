import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  createExternalRequestDisclosure,
  grantExternalRequestConsent,
  hasExternalRequestConsent
} from '../externalRequestReview'
import {
  applyDiagramLocalizationReview,
  applyLocalizationPatchesAtomically,
  assertLocalizationReviewCurrent,
  findReviewedField,
  inspectDiagramLocalization,
  StaleLocalizationReviewError,
  type LocalizationModeler
} from '../modelerAdapter'
import { prepareLocalizationIngestion } from '../ingestion'
import { TranslationReviewDialog } from '../TranslationReviewDialog'
import { LOCALIZATION_SOURCES, LocalizationSource, type LocalizationPatch } from '../types'

interface Bo {
  $type: string
  id?: string
  name?: string
  text?: string
  $attrs?: Record<string, unknown>
  $parent?: Bo
  flowElements?: Bo[]
  artifacts?: Bo[]
  documentation?: Bo[]
  get?: (key: string) => unknown
  [key: string]: unknown
}

interface FakeModel {
  modeler: LocalizationModeler
  process: Bo
  task: Bo
  taskElement: { id: string; businessObject: Bo }
  updates: Array<{ element: unknown; properties: Record<string, unknown> }>
  batchExecutions: number
  undo: ReturnType<typeof vi.fn>
}

function setProperties(element: unknown, properties: Record<string, unknown>): void {
  const bo = (element as { businessObject?: Bo }).businessObject
  if (!bo) return
  for (const [key, value] of Object.entries(properties)) {
    if (key.includes(':')) {
      bo.$attrs = { ...(bo.$attrs ?? {}), [key]: value }
    } else {
      bo[key] = value
    }
  }
}

function makeModel(
  options: {
    ar?: string
    en?: string
    visible?: string
    active?: 'en' | 'ar'
    batch?: boolean
    documentation?: boolean
    getDefinitions?: boolean
    ignoreProjection?: boolean
  } = {}
): FakeModel {
  const process: Bo = {
    $type: 'bpmn:Process',
    id: 'Process_1',
    $attrs: { 'orbitpm:activeLang': options.active ?? 'en' }
  }
  const task: Bo = {
    $type: 'bpmn:Task',
    id: 'Task_1',
    name: options.visible ?? options.en ?? 'Review request',
    $attrs: {
      ...(options.en === undefined ? {} : { 'orbitpm:nameEn': options.en }),
      ...(options.ar === undefined ? {} : { 'orbitpm:nameAr': options.ar })
    },
    $parent: process
  }
  if (options.documentation) {
    task.documentation = [
      {
        $type: 'bpmn:Documentation',
        text: 'Internal note',
        $attrs: { 'orbitpm:nameEn': 'Internal note' },
        $parent: task
      }
    ]
  }
  process.flowElements = [task]
  const definitions: Bo = {
    $type: 'bpmn:Definitions',
    id: 'Definitions_1',
    rootElements: [process]
  }
  const root = { id: process.id as string, businessObject: process }
  const taskElement = { id: task.id as string, businessObject: task }
  const updates: Array<{
    element: unknown
    properties: Record<string, unknown>
  }> = []
  let batchExecutions = 0
  const apply = (element: unknown, properties: Record<string, unknown>): void => {
    updates.push({ element, properties })
    setProperties(element, properties)
  }
  const batch = {
    execute(
      value: Array<{ kind: string; element: unknown; properties?: Record<string, unknown> }>
    ) {
      batchExecutions += 1
      for (const update of value) {
        if (update.kind === 'properties' && update.properties) {
          const properties = options.ignoreProjection
            ? Object.fromEntries(
                Object.entries(update.properties).filter(
                  ([key]) => key !== 'name' && key !== 'text'
                )
              )
            : update.properties
          apply(update.element, properties)
        }
      }
    }
  }
  const undo = vi.fn()
  const modeler: LocalizationModeler = {
    ...(options.getDefinitions === false ? {} : { getDefinitions: () => definitions }),
    get(name: string): unknown {
      if (name === 'canvas') return { getRootElement: () => root }
      if (name === 'elementRegistry') {
        return { getAll: () => [taskElement] }
      }
      if (name === 'modeling') {
        return { updateProperties: apply }
      }
      if (name === 'orbitpmModelingBatch') {
        if (options.batch) return batch
        throw new Error('batch unavailable')
      }
      if (name === 'commandStack') return { undo }
      throw new Error(`unexpected service ${name}`)
    }
  }
  return {
    modeler,
    process,
    task,
    taskElement,
    updates,
    get batchExecutions() {
      return batchExecutions
    },
    undo
  }
}

describe('external request disclosure', () => {
  it('is serializable, stable, clamps estimates, and resets consent on any change', () => {
    const disclosure = createExternalRequestDisclosure({
      purpose: 'test',
      providerId: 'provider',
      modelId: 'model',
      outbound: [
        { id: '1', text: 'One', context: 'name', sensitive: true },
        { id: '2', text: 'Two' }
      ],
      estimatedRequests: { min: -2.8, max: -4 }
    })
    expect(disclosure.estimatedRequests).toEqual({ min: 0, max: 0 })
    expect(disclosure.sensitiveItemCount).toBe(1)
    expect(JSON.parse(JSON.stringify(disclosure))).toEqual(disclosure)
    const consent = grantExternalRequestConsent(disclosure, '2026-01-01T00:00:00.000Z')
    expect(hasExternalRequestConsent(disclosure, consent)).toBe(true)
    expect(hasExternalRequestConsent(disclosure, null)).toBe(false)

    const changed = createExternalRequestDisclosure({
      purpose: 'test',
      providerId: 'provider',
      outbound: [{ id: '1', text: 'Changed' }],
      estimatedRequests: { min: 1.9, max: 0 }
    })
    expect(changed.estimatedRequests).toEqual({ min: 1, max: 1 })
    expect(changed.fingerprint).not.toBe(disclosure.fingerprint)
    expect(hasExternalRequestConsent(changed, consent)).toBe(false)
  })

  it('produces the same fingerprint for the same ordered content', () => {
    const input = {
      purpose: 'same',
      providerId: 'p',
      outbound: [{ id: 'x', text: 'API' }],
      estimatedRequests: { min: 1, max: 2 }
    }
    expect(createExternalRequestDisclosure(input).fingerprint).toBe(
      createExternalRequestDisclosure(input).fingerprint
    )
  })
})

describe('reusable ingestion adapter', () => {
  it('accepts every declared boundary and applies local resources before queueing', () => {
    for (const source of LOCALIZATION_SOURCES) {
      const { modeler } = makeModel({
        en: 'API',
        visible: 'API'
      })
      const root = modeler.getDefinitions?.()
      const review = prepareLocalizationIngestion(root, {
        source,
        target: 'ar'
      })
      expect(review.source).toBe(source)
      expect(review.initialAudit.summary.byTarget.ar).toBeGreaterThan(0)
      expect(review.localPlan.glossaryMatches).toBe(1)
      expect(review.queue).toEqual([])
      expect(review.projection.complete).toBe(true)
    }
  })

  it('uses safe defaults and carries provider failures into the audit', () => {
    const { modeler } = makeModel({ en: 'Review request' })
    const first = prepareLocalizationIngestion(modeler.getDefinitions?.())
    expect(first.source).toBe(LocalizationSource.Xml)
    expect(first.target).toBe('ar')
    const field = first.localPlan.fields[0]
    const failed = prepareLocalizationIngestion(modeler.getDefinitions?.(), {
      target: 'en',
      defaultActive: 'ar',
      providerFailures: field
        ? [
            {
              processId: field.processId,
              elementId: field.elementId,
              field: field.field,
              target: 'en'
            }
          ]
        : []
    })
    expect(failed.audit.issues.some((issue) => issue.code === 'provider-failed')).toBe(true)
  })
})

describe('modeler localization integration', () => {
  it('projects valid Arabic SVG labels and metadata in one batch, then post-audits', () => {
    const fake = makeModel({
      en: 'Review request',
      ar: 'مراجعة الطلب',
      batch: true
    })
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    expect(review.complete).toBe(true)
    const result = applyDiagramLocalizationReview(fake.modeler, review)
    expect(result.complete).toBe(true)
    expect(result.active).toBe('ar')
    expect(fake.task.name).toBe('مراجعة الطلب')
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('ar')
    expect(fake.batchExecutions).toBe(1)
  })

  it('does nothing for an ordinary incomplete switch and applies only explicit partial preview', () => {
    const fake = makeModel({ en: 'Review request' })
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    expect(review.complete).toBe(false)
    const blocked = applyDiagramLocalizationReview(fake.modeler, review)
    expect(blocked.complete).toBe(false)
    expect(blocked.switched).toBe(0)
    expect(fake.updates).toEqual([])

    const partial = applyDiagramLocalizationReview(fake.modeler, review, {
      allowPartial: true
    })
    expect(partial.complete).toBe(false)
    expect(partial.active).toBe('ar')
    expect(fake.process.$attrs?.['orbitpm:activeLang']).toBe('ar')
    expect(fake.task.$attrs?.['orbitpm:nameEn']).toBe('Review request')
  })

  it('post-audits visible projection and rolls back the atomic batch on persistence failure', () => {
    const fake = makeModel({
      en: 'Review request',
      ar: 'مراجعة الطلب',
      batch: true,
      ignoreProjection: true
    })
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    const result = applyDiagramLocalizationReview(fake.modeler, review)
    expect(result.complete).toBe(false)
    expect(fake.task.name).toBe('Review request')
    expect(fake.undo).toHaveBeenCalledTimes(1)
  })

  it('detects stale outbound text and optimistic patch conflicts', () => {
    const fake = makeModel({ en: 'Review request' })
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    fake.task.name = 'Changed by user'
    fake.task.$attrs = {
      ...fake.task.$attrs,
      'orbitpm:nameEn': 'Changed by user'
    }
    expect(() => assertLocalizationReviewCurrent(fake.modeler, review)).toThrow(
      StaleLocalizationReviewError
    )

    const patch: LocalizationPatch = {
      source: LocalizationSource.Editor,
      processId: 'Process_1',
      elementId: 'Task_1',
      field: 'name',
      property: 'name',
      value: 'New',
      expectedValue: 'Old',
      reason: 'projection'
    }
    expect(() => applyLocalizationPatchesAtomically(fake.modeler, [patch])).toThrow(
      StaleLocalizationReviewError
    )
  })

  it('coalesces patches, skips missing/already-current targets, and supports fallback modelers', () => {
    const fake = makeModel({
      en: 'Review request',
      ar: 'مراجعة الطلب',
      getDefinitions: false
    })
    const patches: LocalizationPatch[] = [
      {
        source: LocalizationSource.Editor,
        processId: 'Process_1',
        elementId: 'Task_1',
        field: 'name',
        property: 'name',
        value: 'Review request',
        reason: 'projection'
      },
      {
        source: LocalizationSource.Editor,
        processId: 'Process_1',
        elementId: 'Missing',
        field: 'name',
        property: 'name',
        value: 'Ignored',
        reason: 'projection'
      },
      {
        source: LocalizationSource.Editor,
        processId: 'Process_1',
        elementId: 'Task_1',
        field: 'name',
        property: 'orbitpm:nameAr',
        value: 'طلب جديد',
        reason: 'provider'
      },
      {
        source: LocalizationSource.Editor,
        processId: 'Process_1',
        elementId: 'Task_1',
        field: 'owner',
        property: 'orbitpm:ownerAr',
        value: 'المالك',
        reason: 'provider'
      }
    ]
    applyLocalizationPatchesAtomically(fake.modeler, patches)
    expect(fake.task.$attrs?.['orbitpm:nameAr']).toBe('طلب جديد')
    expect(fake.task.$attrs?.['orbitpm:ownerAr']).toBe('المالك')
    expect(fake.updates).toHaveLength(1)
    applyLocalizationPatchesAtomically(fake.modeler, [])
  })

  it('resolves id-less documentation targets and exposes queue-field lookup', () => {
    const fake = makeModel({ en: 'Review request', documentation: true })
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    const note = review.queue.find((item) => item.field === 'notes')
    expect(note).toBeDefined()
    expect(findReviewedField(review, note!)).toMatchObject({ field: 'notes' })
    expect(
      findReviewedField(review, {
        ...note!,
        elementId: 'not-present'
      })
    ).toBeUndefined()
    applyLocalizationPatchesAtomically(fake.modeler, [
      {
        source: LocalizationSource.Editor,
        processId: note!.processId,
        elementId: note!.elementId,
        field: note!.field,
        property: 'orbitpm:nameAr',
        value: 'ملاحظة داخلية',
        reason: 'provider'
      }
    ])
    expect(fake.task.documentation?.[0].$attrs?.['orbitpm:nameAr']).toBe('ملاحظة داخلية')
  })

  it('handles Arabic-first blocking, getters, undefined definitions, and non-process roots', () => {
    const arabic = makeModel({
      ar: 'مراجعة الطلب',
      visible: 'مراجعة الطلب',
      active: 'ar'
    })
    const englishReview = inspectDiagramLocalization(arabic.modeler, 'en')
    const blocked = applyDiagramLocalizationReview(arabic.modeler, englishReview)
    expect(blocked.active).toBe('ar')

    const task: Bo = {
      $type: 'bpmn:Task',
      id: 'Task_getter',
      name: 'Getter task',
      $attrs: { 'orbitpm:nameEn': 'Getter task' },
      get(key: string): unknown {
        if (key === '$type') return this.$type
        if (key === 'id') return this.id
        if (key === 'orbitpm:nameEn') throw new Error('unknown extension')
        return undefined
      }
    }
    const collaboration: Bo = {
      $type: 'bpmn:Collaboration',
      id: 'Collaboration_1',
      children: [task]
    }
    const taskElement = { id: 'Task_getter', businessObject: task }
    const root = { id: 'Collaboration_1', businessObject: collaboration }
    const records: unknown[] = []
    const fallback: LocalizationModeler = {
      getDefinitions: () => undefined,
      get(name: string): unknown {
        if (name === 'canvas') return { getRootElement: () => root }
        if (name === 'elementRegistry') {
          return {
            getAll: () => [
              taskElement,
              { id: 'label', labelTarget: taskElement, businessObject: task },
              { id: 'empty' }
            ]
          }
        }
        if (name === 'orbitpmModelingBatch') throw new Error('none')
        if (name === 'modeling') {
          return {
            updateProperties(element: unknown, properties: Record<string, unknown>) {
              records.push(element)
              setProperties(element, properties)
            }
          }
        }
        throw new Error(name)
      }
    }
    const review = inspectDiagramLocalization(fallback, 'ar')
    expect(review.queue.map((item) => item.sourceValue)).toContain('Getter task')
    applyLocalizationPatchesAtomically(fallback, [
      {
        source: LocalizationSource.Editor,
        processId: review.fields[0].processId,
        elementId: 'Task_getter',
        field: 'name',
        property: 'orbitpm:nameAr',
        value: 'مهمة',
        reason: 'provider'
      }
    ])
    expect(records).toHaveLength(1)
  })

  it('uses wrappers for unregistered synthetic targets without parents', () => {
    const fake = makeModel({ en: 'Review request' })
    const orphan: Bo = {
      $type: 'Documentation',
      text: 'Loose note'
    }
    const definitions = fake.modeler.getDefinitions?.() as Bo
    definitions.extra = orphan
    applyLocalizationPatchesAtomically(fake.modeler, [
      {
        source: LocalizationSource.Editor,
        processId: 'Process_1',
        elementId: 'Process_1::Documentation:1',
        field: 'notes',
        property: 'text',
        value: 'ملاحظة',
        reason: 'projection'
      }
    ])
    expect(orphan.text).toBe('ملاحظة')
  })
})

describe('translation review rendering', () => {
  it('renders no-provider disclosure, mixed warning, and postpone actions', () => {
    const fake = makeModel({ en: 'Review request' })
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    review.queue[0] = {
      ...review.queue[0],
      requiresSegmentationReview: true
    }
    const html = renderToStaticMarkup(
      <TranslationReviewDialog
        review={review}
        disclosure={null}
        providers={[]}
        providerId=""
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
      />
    )
    expect(html).toContain('Review translation')
    expect(html).toContain('Nothing has been sent')
    expect(html).toContain('Mixed-script')
    expect(html).toContain('disabled')
  })

  it('renders exact sensitive outbound text, provider details, status, and busy cancellation', () => {
    const fake = makeModel({ en: 'Review request' })
    const review = inspectDiagramLocalization(fake.modeler, 'ar')
    const disclosure = createExternalRequestDisclosure({
      purpose: 'diagram-localization',
      providerId: 'provider',
      modelId: 'model',
      outbound: [
        {
          id: 'loc_1',
          text: '<Exact & outbound>',
          context: 'Task_1 / owner',
          sensitive: true
        }
      ],
      estimatedRequests: { min: 1, max: 2 }
    })
    const html = renderToStaticMarkup(
      <TranslationReviewDialog
        review={review}
        disclosure={disclosure}
        providers={[
          {
            id: 'provider',
            label: 'Provider',
            description: 'Disclosure',
            disabled: false
          }
        ]}
        providerId="provider"
        busy
        status="Cancelled"
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
      />
    )
    expect(html).toContain('&lt;Exact &amp; outbound&gt;')
    expect(html).toContain('Task_1 / owner')
    expect(html).toContain('may contain people')
    expect(html).toContain('Cancel translation')
    expect(html).toContain('Cancelled')
  })

  it('renders English-target, disabled provider, provider-id fallback, and non-busy alert status', () => {
    const fake = makeModel({
      ar: 'مراجعة الطلب',
      visible: 'مراجعة الطلب',
      active: 'ar'
    })
    const review = inspectDiagramLocalization(fake.modeler, 'en')
    const disclosure = createExternalRequestDisclosure({
      purpose: 'diagram-localization',
      providerId: 'external-id',
      outbound: [{ id: 'loc_1', text: 'مراجعة الطلب' }],
      estimatedRequests: { min: 1, max: 1 }
    })
    const html = renderToStaticMarkup(
      <TranslationReviewDialog
        review={review}
        disclosure={disclosure}
        providers={[
          {
            id: 'different-id',
            label: 'Unavailable',
            description: 'No key',
            disabled: true
          }
        ]}
        providerId="different-id"
        status="Provider failed"
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
      />
    )
    expect(html).toContain('Arabic → English')
    expect(html).toContain('Unavailable will receive')
    expect(html).toContain('role=\"alert\"')
    expect(html).toContain('Provider failed')

    const providerFallbackHtml = renderToStaticMarkup(
      <TranslationReviewDialog
        review={review}
        disclosure={disclosure}
        providers={[]}
        providerId="external-id"
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
      />
    )
    expect(providerFallbackHtml).toContain('external-id will receive')
  })
})
