import { describe, expect, it } from 'vitest'
import { ArisAiDraftV1Schema } from './contract'
import { buildMinimalValidDraft } from './testFixtures'

describe('ArisAiDraftV1Schema', () => {
  it('accepts a minimal valid draft', () => {
    const draft = buildMinimalValidDraft()
    const result = ArisAiDraftV1Schema.safeParse(draft)
    expect(result.success).toBe(true)
  })

  it('rejects an unknown top-level key', () => {
    const draft = { ...buildMinimalValidDraft(), extraField: 'sneaky' }
    const result = ArisAiDraftV1Schema.safeParse(draft)
    expect(result.success).toBe(false)
  })

  it('rejects an unknown key nested inside an object', () => {
    const draft = buildMinimalValidDraft()
    const withExtra = {
      ...draft,
      objects: [{ ...draft.objects[0], extraField: 'sneaky' }, ...draft.objects.slice(1)]
    }
    const result = ArisAiDraftV1Schema.safeParse(withExtra)
    expect(result.success).toBe(false)
  })

  it('rejects an unknown key nested inside names', () => {
    const draft = buildMinimalValidDraft()
    const withExtra = {
      ...draft,
      objects: [
        { ...draft.objects[0], names: { en: 'Request received', fr: 'reçu' } },
        ...draft.objects.slice(1)
      ]
    }
    const result = ArisAiDraftV1Schema.safeParse(withExtra)
    expect(result.success).toBe(false)
  })

  it('rejects a missing required field', () => {
    const draft = buildMinimalValidDraft()
    const { confidence: _confidence, ...withoutConfidence } = draft.objects[0]
    const withMissing = { ...draft, objects: [withoutConfidence, ...draft.objects.slice(1)] }
    const result = ArisAiDraftV1Schema.safeParse(withMissing)
    expect(result.success).toBe(false)
  })

  it('rejects a confidence value outside the high/medium/low union', () => {
    const draft = buildMinimalValidDraft()
    const withBadConfidence = {
      ...draft,
      objects: [{ ...draft.objects[0], confidence: 'certain' }, ...draft.objects.slice(1)]
    }
    const result = ArisAiDraftV1Schema.safeParse(withBadConfidence)
    expect(result.success).toBe(false)
  })

  it('rejects a version other than the literal 1', () => {
    const draft = { ...buildMinimalValidDraft(), version: 2 }
    const result = ArisAiDraftV1Schema.safeParse(draft)
    expect(result.success).toBe(false)
  })

  it('rejects coercion: a numeric-looking string is not silently coerced for suggestedOrder', () => {
    const draft = buildMinimalValidDraft()
    const withStringOrder = {
      ...draft,
      objects: draft.objects.map((object) =>
        object.logicalId === 'func-approve' ? { ...object, suggestedOrder: '1' } : object
      )
    }
    const result = ArisAiDraftV1Schema.safeParse(withStringOrder)
    expect(result.success).toBe(false)
  })

  it('does not silently default a missing optional field to a truthy value', () => {
    const draft = buildMinimalValidDraft()
    const result = ArisAiDraftV1Schema.parse(draft)
    // symbolType/evidence/suggestedOrder were never supplied on evt-start — they
    // must be absent, not defaulted to null/empty-string/0.
    expect('symbolType' in result.objects[0]).toBe(false)
    expect('evidence' in result.objects[0]).toBe(false)
    expect('suggestedOrder' in result.objects[0]).toBe(false)
  })
})
