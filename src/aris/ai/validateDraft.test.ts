import { describe, expect, it } from 'vitest'
import { buildMinimalValidDraft } from './testFixtures'
import { validateArisAiDraft } from './validateDraft'

describe('validateArisAiDraft', () => {
  it('accepts a fully valid draft and returns it typed', () => {
    const draft = buildMinimalValidDraft()
    const result = validateArisAiDraft(draft)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.models).toHaveLength(2)
      expect(result.draft.objects).toHaveLength(4)
    }
  })

  it('rejects a non-object payload with a schema finding', () => {
    const result = validateArisAiDraft('not even an object')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.length).toBeGreaterThan(0)
      expect(result.findings.every((f) => f.code.startsWith('schema:'))).toBe(true)
    }
  })

  it('reports an unrecognized top-level key as a structured schema finding', () => {
    const draft = { ...buildMinimalValidDraft(), unexpectedField: true }
    const result = validateArisAiDraft(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'schema:unrecognized_keys')).toBe(true)
    }
  })

  it('short-circuits on forbidden content before reporting schema findings', () => {
    const draft = buildMinimalValidDraft()
    const attacked = {
      ...draft,
      unexpectedField: true, // would also be a schema error
      objects: draft.objects.map((object) =>
        object.logicalId === 'func-approve'
          ? { ...object, evidence: '<script>alert(1)</script>' }
          : object
      )
    }
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.every((f) => f.code.startsWith('forbidden-'))).toBe(true)
    }
  })

  it('combines type-validation and logical-id-integrity findings for a structurally valid but semantically broken draft', () => {
    const draft = buildMinimalValidDraft()
    const broken = {
      ...draft,
      objects: draft.objects.map((object) =>
        object.logicalId === 'func-approve' ? { ...object, objectType: 'OT_NOT_REAL' } : object
      ),
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve'
          ? { ...relation, targetLogicalId: 'missing-object' }
          : relation
      )
    }
    const result = validateArisAiDraft(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'unsupported-object-type')).toBe(true)
      expect(result.findings.some((f) => f.code === 'dangling-object-reference')).toBe(true)
    }
  })

  it('never throws on malformed input', () => {
    expect(() => validateArisAiDraft(undefined)).not.toThrow()
    expect(() => validateArisAiDraft(null)).not.toThrow()
    expect(() => validateArisAiDraft(42)).not.toThrow()
    expect(() => validateArisAiDraft([])).not.toThrow()
  })
})
