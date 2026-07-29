import { describe, expect, it } from 'vitest'
import type { ArisAiDraftV1 } from './contract'
import { validateLogicalIdIntegrity } from './logicalIntegrity'
import { buildMinimalValidDraft } from './testFixtures'

describe('validateLogicalIdIntegrity', () => {
  it('finds nothing for a fully valid draft', () => {
    expect(validateLogicalIdIntegrity(buildMinimalValidDraft())).toEqual([])
  })

  it('flags a dangling modelLogicalId on an object', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      objects: draft.objects.map((object) =>
        object.logicalId === 'evt-start'
          ? { ...object, modelLogicalId: 'model-does-not-exist' }
          : object
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'dangling-model-reference')).toBe(true)
  })

  it('flags a dangling modelLogicalId on a relation', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve'
          ? { ...relation, modelLogicalId: 'model-does-not-exist' }
          : relation
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'dangling-model-reference')).toBe(true)
  })

  it('flags a dangling relation sourceLogicalId', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve'
          ? { ...relation, sourceLogicalId: 'obj-does-not-exist' }
          : relation
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(
      findings.some(
        (f) => f.code === 'dangling-object-reference' && f.path.includes('sourceLogicalId')
      )
    ).toBe(true)
  })

  it('flags a dangling relation targetLogicalId', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve'
          ? { ...relation, targetLogicalId: 'obj-does-not-exist' }
          : relation
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(
      findings.some(
        (f) => f.code === 'dangling-object-reference' && f.path.includes('targetLogicalId')
      )
    ).toBe(true)
  })

  it('flags a relation whose source object belongs to a different model than the relation', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      objects: [
        ...draft.objects,
        {
          logicalId: 'evt-other-model',
          modelLogicalId: 'model-sub',
          objectType: 'OT_EVT',
          names: { en: 'Other model event' },
          attributes: [],
          confidence: 'high'
        }
      ],
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve'
          ? { ...relation, sourceLogicalId: 'evt-other-model' }
          : relation
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'cross-model-relation')).toBe(true)
  })

  it('flags a self-referential relation', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve'
          ? { ...relation, targetLogicalId: relation.sourceLogicalId }
          : relation
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'self-referential-relation')).toBe(true)
  })

  it('flags a duplicate logical id among objects', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      objects: draft.objects.map((object) =>
        object.logicalId === 'evt-end' ? { ...object, logicalId: 'evt-start' } : object
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'duplicate-logical-id')).toBe(true)
  })

  it('flags a duplicate logical id among attributes, whether nested or top-level', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      attributes: draft.attributes.map((attribute) =>
        attribute.logicalId === 'attr-model-main-desc'
          ? { ...attribute, logicalId: 'attr-func-approve-desc' }
          : attribute
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'duplicate-logical-id')).toBe(true)
  })

  it('flags a nested object attribute whose owner does not match its containing object', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      objects: draft.objects.map((object) =>
        object.logicalId === 'func-approve'
          ? {
              ...object,
              attributes: object.attributes.map((a) => ({ ...a, ownerLogicalId: 'evt-start' }))
            }
          : object
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'inline-attribute-owner-mismatch')).toBe(true)
  })

  it('flags a top-level attribute with a dangling owner', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      attributes: draft.attributes.map((attribute) =>
        attribute.logicalId === 'attr-model-main-desc'
          ? { ...attribute, ownerLogicalId: 'model-does-not-exist' }
          : attribute
      )
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'dangling-attribute-owner')).toBe(true)
  })

  it('flags an assignment with a dangling objectLogicalId', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      assignments: draft.assignments.map((assignment) => ({
        ...assignment,
        objectLogicalId: 'obj-does-not-exist'
      }))
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(
      findings.some((f) => f.code === 'dangling-object-reference' && f.path.includes('assignments'))
    ).toBe(true)
  })

  it('flags an assignment with a dangling assignedModelLogicalId', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      assignments: draft.assignments.map((assignment) => ({
        ...assignment,
        assignedModelLogicalId: 'model-does-not-exist'
      }))
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(
      findings.some((f) => f.code === 'dangling-model-reference' && f.path.includes('assignments'))
    ).toBe(true)
  })

  it('flags an uncertainty whose targetLogicalId resolves to nothing declared', () => {
    const draft = buildMinimalValidDraft()
    const broken: ArisAiDraftV1 = {
      ...draft,
      uncertainties: draft.uncertainties.map((uncertainty) => ({
        ...uncertainty,
        targetLogicalId: 'nothing-declared-with-this-id'
      }))
    }
    const findings = validateLogicalIdIntegrity(broken)
    expect(findings.some((f) => f.code === 'dangling-uncertainty-target')).toBe(true)
  })
})
