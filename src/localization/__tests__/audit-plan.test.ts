import { describe, expect, it } from 'vitest'
import {
  LocalizationSource,
  auditLocalizationFields,
  buildTranslationQueue,
  planLanguageProjection,
  planLocalResourceApplication,
  type LanguageCode,
  type LocalizationField,
  type TranslationMemoryEntry
} from '..'

function field(
  value: { en?: string; ar?: string; active?: LanguageCode },
  overrides: Partial<LocalizationField> = {}
): LocalizationField {
  return {
    source: LocalizationSource.Xml,
    processId: 'Process_1',
    elementId: 'Task_1',
    elementType: 'bpmn:Task',
    field: 'name',
    kind: 'name',
    value: { ...value, active: value.active ?? 'en' },
    sourceLanguage: value.en ? 'en' : value.ar ? 'ar' : undefined,
    projection: value.en ?? value.ar,
    origins: {
      ...(value.en === undefined ? {} : { en: 'paired' as const }),
      ...(value.ar === undefined ? {} : { ar: 'paired' as const })
    },
    storage: {
      enProperty: 'orbitpm:nameEn',
      arProperty: 'orbitpm:nameAr',
      projectionProperty: 'name'
    },
    planeIds: [],
    ...overrides
  }
}

function issueCodes(
  input: readonly LocalizationField[]
): Array<[string, LanguageCode]> {
  return auditLocalizationFields(input).issues.map((issue) => [
    issue.code,
    issue.target
  ])
}

describe('issue-driven bilingual audit', () => {
  it('detects identical English nameAr as both wrong-script and duplicate counterpart', () => {
    const report = auditLocalizationFields([
      field({ en: 'Approve request', ar: 'Approve request' })
    ])
    expect(report.issues).toEqual([
      {
        source: 'xml',
        processId: 'Process_1',
        elementId: 'Task_1',
        field: 'name',
        target: 'ar',
        code: 'wrong-script',
        originalValue: 'Approve request'
      },
      {
        source: 'xml',
        processId: 'Process_1',
        elementId: 'Task_1',
        field: 'name',
        target: 'ar',
        code: 'duplicate-counterpart',
        originalValue: 'Approve request'
      }
    ])
    expect(report.summary.byCode['wrong-script']).toBe(1)
    expect(report.summary.byCode['duplicate-counterpart']).toBe(1)
    expect(report.summary.completeFields).toBe(0)
  })

  it('reports Arabic-first and English-first missing counterparts without damaging the source', () => {
    const arFirst = field(
      { ar: 'اعتماد الطلب', active: 'ar' },
      { elementId: 'Task_ar', projection: 'اعتماد الطلب' }
    )
    const enFirst = field(
      { en: 'Archive request' },
      { elementId: 'Task_en', projection: 'Archive request' }
    )
    expect(issueCodes([arFirst, enFirst])).toEqual([
      ['missing', 'en'],
      ['missing', 'ar']
    ])
    expect(arFirst.value).toEqual({ ar: 'اعتماد الطلب', active: 'ar' })
  })

  it('reports wrong-script, mixed, and unknown values with the contract codes', () => {
    expect(
      issueCodes([
        field(
          { en: 'مراجعة الطلب', ar: 'Review request' },
          { elementId: 'wrong' }
        ),
        field(
          { en: 'Review مراجعة', ar: 'مراجعة Review' },
          { elementId: 'mixed' }
        ),
        field({ en: '✓', ar: '✓' }, { elementId: 'unknown' })
      ])
    ).toEqual([
      ['wrong-script', 'en'],
      ['wrong-script', 'ar'],
      ['mixed', 'en'],
      ['mixed', 'ar'],
      ['wrong-script', 'en'],
      ['wrong-script', 'ar'],
      ['duplicate-counterpart', 'ar']
    ])
  })

  it.each(['API', 'SLA', 'DMT HUB', '123', 'Task_42'])(
    'allows approved complete neutral %j unchanged in both targets',
    (neutral) => {
      expect(auditLocalizationFields([field({ en: neutral, ar: neutral })]).issues).toEqual([])
    }
  )

  it('does not mistake an arbitrary uppercase phrase for an approved neutral', () => {
    expect(issueCodes([field({ en: 'APPROVE REQUEST', ar: 'APPROVE REQUEST' })])).toEqual([
      ['wrong-script', 'ar'],
      ['duplicate-counterpart', 'ar']
    ])
  })

  it('supports a reviewed mixed proper-name exception on English only', () => {
    const value = 'DMT دائرة البلديات والنقل'
    const input = field({ en: value, ar: 'دائرة البلديات والنقل' })
    expect(auditLocalizationFields([input]).issues[0]?.code).toBe('mixed')
    expect(
      auditLocalizationFields([input], {
        approvedEnglishBilingualExceptions: [value]
      }).issues
    ).toEqual([])
  })

  it('retains provider failure beside the unresolved script issue and never implies completion', () => {
    const input = field({ en: 'Approve request' })
    const report = auditLocalizationFields([input], {
      providerFailures: [
        {
          processId: 'Process_1',
          elementId: 'Task_1',
          field: 'name',
          target: 'ar',
          originalValue: 'Approve request'
        }
      ]
    })
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'missing',
      'provider-failed'
    ])
    expect(report.summary.issueCount).toBe(2)
    expect(report.summary.byCode['provider-failed']).toBe(1)
  })
})

describe('deterministic local glossary and translation-memory application', () => {
  it('fills a reviewed neutral from the seeded glossary and seeds the visible source pair', () => {
    const input = field(
      { en: 'API' },
      {
        projection: 'API',
        origins: { en: 'projection' }
      }
    )
    const before = structuredClone(input)
    const plan = planLocalResourceApplication([input])
    expect(plan.fields[0].value).toEqual({
      en: 'API',
      ar: 'API',
      active: 'en'
    })
    expect(plan.updates).toMatchObject([
      {
        property: 'orbitpm:nameEn',
        value: 'API',
        target: 'en',
        reason: 'source-seed'
      },
      {
        property: 'orbitpm:nameAr',
        value: 'API',
        target: 'ar',
        reason: 'glossary'
      }
    ])
    expect(plan.glossaryMatches).toBe(1)
    expect(plan.issues).toEqual([])
    expect(input).toEqual(before)
  })

  it('repairs identical English nameAr from accepted TM', () => {
    const plan = planLocalResourceApplication(
      [field({ en: 'Approve request', ar: 'Approve request' })],
      {
        translationMemory: [
          {
            en: 'Approve request',
            ar: 'اعتماد الطلب',
            accepted: true
          }
        ]
      }
    )
    expect(plan.translationMemoryMatches).toBe(1)
    expect(plan.fields[0].value.ar).toBe('اعتماد الطلب')
    expect(plan.updates).toEqual([
      {
        source: 'xml',
        processId: 'Process_1',
        elementId: 'Task_1',
        field: 'name',
        property: 'orbitpm:nameAr',
        value: 'اعتماد الطلب',
        expectedValue: 'Approve request',
        target: 'ar',
        reason: 'translation-memory'
      }
    ])
    expect(plan.issues).toEqual([])
  })

  it('fills English for an Arabic-first field without altering its valid Arabic source', () => {
    const input = field(
      { ar: 'أرشفة الطلب', active: 'ar' },
      {
        sourceLanguage: 'ar',
        projection: 'أرشفة الطلب',
        origins: { ar: 'projection' }
      }
    )
    const plan = planLocalResourceApplication([input], {
      translationMemory: [
        {
          en: 'Archive request',
          ar: 'أرشفة الطلب',
          accepted: true
        }
      ]
    })
    expect(plan.fields[0].value).toEqual({
      en: 'Archive request',
      ar: 'أرشفة الطلب',
      active: 'ar'
    })
    expect(plan.updates.map((update) => [update.property, update.value])).toEqual([
      ['orbitpm:nameAr', 'أرشفة الطلب'],
      ['orbitpm:nameEn', 'Archive request']
    ])
    expect(input.value.ar).toBe('أرشفة الطلب')
  })

  it('preserves an already-valid target even when local resources contain a different pair', () => {
    const input = field({ en: 'Approve request', ar: 'اعتماد الطلب' })
    const plan = planLocalResourceApplication([input], {
      glossary: [
        {
          en: 'Approve request',
          ar: 'الموافقة على الطلب'
        }
      ],
      translationMemory: [
        {
          en: 'Approve request',
          ar: 'إقرار الطلب',
          accepted: true
        }
      ]
    })
    expect(plan.updates).toEqual([])
    expect(plan.fields[0].value.ar).toBe('اعتماد الطلب')
  })

  it('uses glossary before TM and first file-order match deterministically', () => {
    const input = field({ en: 'Review request' })
    const options = {
      glossary: [
        { en: 'Review request', ar: 'مراجعة الطلب' },
        { en: 'Review request', ar: 'تدقيق الطلب' }
      ],
      translationMemory: [
        {
          en: 'Review request',
          ar: 'فحص الطلب',
          accepted: true as const
        }
      ]
    }
    const first = planLocalResourceApplication([input], options)
    const second = planLocalResourceApplication([input], options)
    expect(first).toEqual(second)
    expect(first.fields[0].value.ar).toBe('مراجعة الطلب')
    expect(first.glossaryMatches).toBe(1)
    expect(first.translationMemoryMatches).toBe(0)
  })

  it('never uses an unaccepted TM record supplied from malformed legacy data', () => {
    const malformed = [
      {
        en: 'Approve request',
        ar: 'اعتماد الطلب',
        accepted: false
      }
    ] as unknown as readonly TranslationMemoryEntry[]
    const plan = planLocalResourceApplication(
      [field({ en: 'Approve request' })],
      { translationMemory: malformed }
    )
    expect(plan.translationMemoryMatches).toBe(0)
    expect(plan.fields[0].value.ar).toBeUndefined()
  })

  it('lets an edited workspace glossary remove a seeded neutral approval', () => {
    const plan = planLocalResourceApplication(
      [field({ en: 'API' })],
      { glossary: [] }
    )
    expect(plan.glossaryMatches).toBe(0)
    expect(plan.issues.map((issue) => issue.code)).toEqual(['missing'])
  })

  it.each(['123', 'Task_42', 'owner@example.ae', 'https://example.ae'])(
    'copies structural neutral %j without inventing a translation',
    (neutral) => {
      const plan = planLocalResourceApplication([field({ en: neutral })])
      expect(plan.fields[0].value.ar).toBe(neutral)
      expect(plan.neutralMatches).toBe(1)
      expect(plan.updates[0]).toMatchObject({
        property: 'orbitpm:nameAr',
        value: neutral,
        reason: 'neutral'
      })
      expect(plan.issues).toEqual([])
    }
  )
})

describe('projection and explicit translation-review plans', () => {
  it('blocks an incomplete Arabic switch instead of projecting English as success', () => {
    const input = field({ en: 'Approve request' })
    const plan = planLanguageProjection([input], 'ar')
    expect(plan.complete).toBe(false)
    expect(plan.updates).toEqual([])
    expect(plan.blockers.map((issue) => issue.code)).toEqual(['missing'])
    expect(plan.fallbackCount).toBe(0)
  })

  it('keeps a provider failure as a projection blocker, never a false completion', () => {
    const input = field({ en: 'Approve request', ar: 'اعتماد الطلب' })
    const plan = planLanguageProjection([input], 'ar', {
      providerFailures: [
        {
          processId: 'Process_1',
          elementId: 'Task_1',
          field: 'name',
          target: 'ar'
        }
      ]
    })
    expect(plan.complete).toBe(false)
    expect(plan.blockers.map((issue) => issue.code)).toEqual([
      'provider-failed'
    ])
    expect(plan.updates).toEqual([])
  })

  it('uses an opposite-language label only after explicit partial-preview choice', () => {
    const input = field(
      { en: 'Approve request' },
      { projection: 'Old visible label' }
    )
    const plan = planLanguageProjection([input], 'ar', {
      allowPartial: true
    })
    expect(plan.complete).toBe(false)
    expect(plan.fallbackCount).toBe(1)
    expect(plan.updates).toEqual([
      {
        source: 'xml',
        processId: 'Process_1',
        elementId: 'Task_1',
        field: 'name',
        property: 'name',
        value: 'Approve request',
        expectedValue: 'Old visible label',
        target: 'ar',
        reason: 'partial-fallback'
      }
    ])
  })

  it('projects actual Arabic into names, annotations, conditions, and unsuffixed details', () => {
    const inputs = [
      field(
        { en: 'Approve', ar: 'اعتماد' },
        { elementId: 'Task', projection: 'Approve' }
      ),
      field(
        { en: 'Yes', ar: 'نعم' },
        {
          elementId: 'Flow',
          elementType: 'bpmn:SequenceFlow',
          field: 'condition',
          kind: 'condition',
          projection: 'Yes'
        }
      ),
      field(
        { en: 'Review note', ar: 'ملاحظة المراجعة' },
        {
          elementId: 'Note',
          elementType: 'bpmn:TextAnnotation',
          field: 'annotation',
          kind: 'annotation',
          projection: 'Review note',
          storage: {
            enProperty: 'orbitpm:nameEn',
            arProperty: 'orbitpm:nameAr',
            projectionProperty: 'text'
          }
        }
      ),
      field(
        { en: 'Policy section 7', ar: 'القسم 7 من السياسة' },
        {
          elementId: 'Gateway',
          elementType: 'bpmn:ExclusiveGateway',
          field: 'decisionBasis',
          kind: 'metadata',
          projection: 'Policy section 7',
          storage: {
            enProperty: 'orbitpm:decisionBasisEn',
            arProperty: 'orbitpm:decisionBasisAr',
            projectionProperty: 'orbitpm:decisionBasis'
          }
        }
      )
    ]
    const plan = planLanguageProjection(inputs, 'ar')
    expect(plan.complete).toBe(true)
    expect(plan.updates.map((update) => [update.property, update.value])).toEqual([
      ['name', 'اعتماد'],
      ['name', 'نعم'],
      ['text', 'ملاحظة المراجعة'],
      ['orbitpm:decisionBasis', 'القسم 7 من السياسة']
    ])
    expect(
      plan.updates.every((update) => /[\p{Script=Arabic}]/u.test(update.value))
    ).toBe(true)
  })

  it('queues unresolved and provider-failed fields with exact outbound source text, but executes nothing', () => {
    const inputs = [
      field({ en: 'Approve request' }, { elementId: 'Task_approve' }),
      field(
        { ar: 'أرشفة الطلب', active: 'ar' },
        {
          elementId: 'Task_archive',
          projection: 'أرشفة الطلب',
          sourceLanguage: 'ar'
        }
      )
    ]
    const queue = buildTranslationQueue(inputs, {
      providerFailures: [
        {
          processId: 'Process_1',
          elementId: 'Task_approve',
          field: 'name',
          target: 'ar'
        }
      ]
    })
    expect(queue.map((item) => ({
      elementId: item.elementId,
      sourceLanguage: item.sourceLanguage,
      sourceValue: item.sourceValue,
      target: item.target,
      codes: item.issues.map((issue) => issue.code)
    }))).toEqual([
      {
        elementId: 'Task_approve',
        sourceLanguage: 'en',
        sourceValue: 'Approve request',
        target: 'ar',
        codes: ['missing', 'provider-failed']
      },
      {
        elementId: 'Task_archive',
        sourceLanguage: 'ar',
        sourceValue: 'أرشفة الطلب',
        target: 'en',
        codes: ['missing']
      }
    ])
  })

  it('queues a mixed source for segmentation review instead of silently treating it as translated', () => {
    const mixed = field(
      { en: 'Review مراجعة' },
      { sourceLanguage: 'en', projection: 'Review مراجعة' }
    )
    const queue = buildTranslationQueue([mixed], {}, 'ar')
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      sourceLanguage: 'en',
      sourceValue: 'Review مراجعة',
      target: 'ar',
      requiresSegmentationReview: true
    })
    expect(queue[0].issues.map((issue) => [issue.code, issue.target])).toEqual([
      ['missing', 'ar'],
      ['mixed', 'en']
    ])
  })
})
