/**
 * Logical-id integrity checks (Phase 13 task item 3). The AI uses logical
 * ids only (Section 16.5) — this module is the sole authority for making
 * sure those logical ids actually hang together as a consistent graph
 * before anything downstream (id allocation, EPC semantics, layout) sees
 * the draft.
 *
 * Checked, one failure mode at a time (see logicalIntegrity.test.ts):
 *  - every `modelLogicalId` referenced by an object resolves to a declared
 *    model;
 *  - every relation's `sourceLogicalId`/`targetLogicalId` resolve to
 *    declared objects in the SAME model as the relation;
 *  - logical ids are unique within their kind (models / objects / relations
 *    / attributes / assignments — attributes are one kind whether they
 *    appear in the top-level `attributes` array or nested inside an
 *    object's own `attributes` array);
 *  - no self-referential relations (`sourceLogicalId === targetLogicalId`);
 *  - no dangling references anywhere (attribute owners, assignment
 *    object/model, uncertainty targets).
 */

import type { ArisAiAttribute, ArisAiDraftV1 } from './contract'
import { finding, type ArisAiValidationFinding } from './findings'

function collectDuplicates(ids: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return duplicates
}

interface AttributeWithPath {
  readonly attribute: ArisAiAttribute
  readonly path: string
}

function collectAllAttributes(draft: ArisAiDraftV1): readonly AttributeWithPath[] {
  const collected: AttributeWithPath[] = draft.attributes.map((attribute, index) => ({
    attribute,
    path: `$.attributes[${index}]`
  }))
  draft.objects.forEach((object, objectIndex) => {
    object.attributes.forEach((attribute, attributeIndex) => {
      collected.push({
        attribute,
        path: `$.objects[${objectIndex}].attributes[${attributeIndex}]`
      })
    })
  })
  return collected
}

export function validateLogicalIdIntegrity(draft: ArisAiDraftV1): ArisAiValidationFinding[] {
  const findings: ArisAiValidationFinding[] = []

  const modelIds = new Set(draft.models.map((model) => model.logicalId))
  const objectIds = new Set(draft.objects.map((object) => object.logicalId))
  const relationIds = new Set(draft.relations.map((relation) => relation.logicalId))
  const allAttributes = collectAllAttributes(draft)
  const attributeIds = new Set(allAttributes.map((entry) => entry.attribute.logicalId))
  const assignmentIds = new Set(draft.assignments.map((assignment) => assignment.logicalId))

  const knownIdsByKind: ReadonlyArray<{ readonly ids: ReadonlySet<string> }> = [
    { ids: modelIds },
    { ids: objectIds },
    { ids: relationIds },
    { ids: attributeIds },
    { ids: assignmentIds }
  ]
  const anyKnownLogicalId = (id: string): boolean => knownIdsByKind.some((kind) => kind.ids.has(id))

  // --- uniqueness within kind ------------------------------------------------

  const duplicateModelIds = collectDuplicates(draft.models.map((m) => m.logicalId))
  draft.models.forEach((model, index) => {
    if (duplicateModelIds.has(model.logicalId)) {
      findings.push(
        finding(
          'duplicate-logical-id',
          `$.models[${index}].logicalId`,
          `Model logicalId "${model.logicalId}" is used by more than one model.`
        )
      )
    }
  })

  const duplicateObjectIds = collectDuplicates(draft.objects.map((o) => o.logicalId))
  draft.objects.forEach((object, index) => {
    if (duplicateObjectIds.has(object.logicalId)) {
      findings.push(
        finding(
          'duplicate-logical-id',
          `$.objects[${index}].logicalId`,
          `Object logicalId "${object.logicalId}" is used by more than one object.`
        )
      )
    }
  })

  const duplicateRelationIds = collectDuplicates(draft.relations.map((r) => r.logicalId))
  draft.relations.forEach((relation, index) => {
    if (duplicateRelationIds.has(relation.logicalId)) {
      findings.push(
        finding(
          'duplicate-logical-id',
          `$.relations[${index}].logicalId`,
          `Relation logicalId "${relation.logicalId}" is used by more than one relation.`
        )
      )
    }
  })

  const duplicateAttributeIds = collectDuplicates(allAttributes.map((entry) => entry.attribute.logicalId))
  allAttributes.forEach(({ attribute, path }) => {
    if (duplicateAttributeIds.has(attribute.logicalId)) {
      findings.push(
        finding(
          'duplicate-logical-id',
          `${path}.logicalId`,
          `Attribute logicalId "${attribute.logicalId}" is used by more than one attribute.`
        )
      )
    }
  })

  const duplicateAssignmentIds = collectDuplicates(draft.assignments.map((a) => a.logicalId))
  draft.assignments.forEach((assignment, index) => {
    if (duplicateAssignmentIds.has(assignment.logicalId)) {
      findings.push(
        finding(
          'duplicate-logical-id',
          `$.assignments[${index}].logicalId`,
          `Assignment logicalId "${assignment.logicalId}" is used by more than one assignment.`
        )
      )
    }
  })

  // --- object -> model ---------------------------------------------------

  const objectModelById = new Map(draft.objects.map((object) => [object.logicalId, object.modelLogicalId]))

  draft.objects.forEach((object, index) => {
    if (!modelIds.has(object.modelLogicalId)) {
      findings.push(
        finding(
          'dangling-model-reference',
          `$.objects[${index}].modelLogicalId`,
          `Object "${object.logicalId}" references modelLogicalId "${object.modelLogicalId}", which is not a declared model.`
        )
      )
    }
  })

  // --- relation -> model, relation -> source/target objects --------------

  draft.relations.forEach((relation, index) => {
    if (!modelIds.has(relation.modelLogicalId)) {
      findings.push(
        finding(
          'dangling-model-reference',
          `$.relations[${index}].modelLogicalId`,
          `Relation "${relation.logicalId}" references modelLogicalId "${relation.modelLogicalId}", which is not a declared model.`
        )
      )
    }

    if (relation.sourceLogicalId === relation.targetLogicalId) {
      findings.push(
        finding(
          'self-referential-relation',
          `$.relations[${index}]`,
          `Relation "${relation.logicalId}" has the same sourceLogicalId and targetLogicalId ("${relation.sourceLogicalId}").`
        )
      )
    }

    const sourceModelId = objectModelById.get(relation.sourceLogicalId)
    if (sourceModelId === undefined) {
      findings.push(
        finding(
          'dangling-object-reference',
          `$.relations[${index}].sourceLogicalId`,
          `Relation "${relation.logicalId}" references sourceLogicalId "${relation.sourceLogicalId}", which is not a declared object.`
        )
      )
    } else if (sourceModelId !== relation.modelLogicalId) {
      findings.push(
        finding(
          'cross-model-relation',
          `$.relations[${index}].sourceLogicalId`,
          `Relation "${relation.logicalId}" belongs to model "${relation.modelLogicalId}" but its source object belongs to model "${sourceModelId}".`
        )
      )
    }

    const targetModelId = objectModelById.get(relation.targetLogicalId)
    if (targetModelId === undefined) {
      findings.push(
        finding(
          'dangling-object-reference',
          `$.relations[${index}].targetLogicalId`,
          `Relation "${relation.logicalId}" references targetLogicalId "${relation.targetLogicalId}", which is not a declared object.`
        )
      )
    } else if (targetModelId !== relation.modelLogicalId) {
      findings.push(
        finding(
          'cross-model-relation',
          `$.relations[${index}].targetLogicalId`,
          `Relation "${relation.logicalId}" belongs to model "${relation.modelLogicalId}" but its target object belongs to model "${targetModelId}".`
        )
      )
    }
  })

  // --- attribute owners ----------------------------------------------------

  const ownerSetByKind: Record<ArisAiAttribute['ownerKind'], ReadonlySet<string>> = {
    model: modelIds,
    object: objectIds,
    relation: relationIds
  }

  draft.objects.forEach((object, objectIndex) => {
    object.attributes.forEach((attribute, attributeIndex) => {
      const path = `$.objects[${objectIndex}].attributes[${attributeIndex}]`
      if (attribute.ownerKind !== 'object' || attribute.ownerLogicalId !== object.logicalId) {
        findings.push(
          finding(
            'inline-attribute-owner-mismatch',
            path,
            `Attribute "${attribute.logicalId}" is nested inside object "${object.logicalId}" but declares owner ` +
              `${attribute.ownerKind}:"${attribute.ownerLogicalId}".`
          )
        )
      }
    })
  })

  draft.attributes.forEach((attribute, index) => {
    const ownerSet = ownerSetByKind[attribute.ownerKind]
    if (!ownerSet.has(attribute.ownerLogicalId)) {
      findings.push(
        finding(
          'dangling-attribute-owner',
          `$.attributes[${index}].ownerLogicalId`,
          `Attribute "${attribute.logicalId}" references ${attribute.ownerKind} owner "${attribute.ownerLogicalId}", which is not declared.`
        )
      )
    }
  })

  // --- assignments -----------------------------------------------------------

  draft.assignments.forEach((assignment, index) => {
    if (!objectIds.has(assignment.objectLogicalId)) {
      findings.push(
        finding(
          'dangling-object-reference',
          `$.assignments[${index}].objectLogicalId`,
          `Assignment "${assignment.logicalId}" references objectLogicalId "${assignment.objectLogicalId}", which is not a declared object.`
        )
      )
    }
    if (!modelIds.has(assignment.assignedModelLogicalId)) {
      findings.push(
        finding(
          'dangling-model-reference',
          `$.assignments[${index}].assignedModelLogicalId`,
          `Assignment "${assignment.logicalId}" references assignedModelLogicalId "${assignment.assignedModelLogicalId}", which is not a declared model.`
        )
      )
    }
  })

  // --- uncertainties -----------------------------------------------------------

  draft.uncertainties.forEach((uncertainty, index) => {
    if (!anyKnownLogicalId(uncertainty.targetLogicalId)) {
      findings.push(
        finding(
          'dangling-uncertainty-target',
          `$.uncertainties[${index}].targetLogicalId`,
          `Uncertainty targetLogicalId "${uncertainty.targetLogicalId}" does not resolve to any declared model, object, relation, attribute, or assignment.`
        )
      )
    }
  })

  return findings
}
