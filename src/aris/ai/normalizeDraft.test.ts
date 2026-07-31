import { describe, expect, it } from 'vitest'

import {
  NORMALIZED_CONNECTION_FINDING_CODE,
  NORMALIZED_MODEL_TYPE_FINDING_CODE,
  NORMALIZED_VERSION_FINDING_CODE,
  normalizeArisAiDraft
} from './normalizeDraft'

/**
 * Build a minimal raw draft with a single relation whose endpoints have the
 * given object types and whose connection code is `connectionType`. Enough for
 * the normalizer, which only reads models/objects/relations.
 */
function rawWithRelation(options: {
  sourceType: string
  targetType: string
  connectionType: string
  modelType?: string
}): Record<string, unknown> {
  return {
    version: 1,
    models: [
      {
        logicalId: 'model-main',
        modelType: options.modelType ?? 'MT_EEPC',
        names: {},
        confidence: 'high'
      }
    ],
    objects: [
      {
        logicalId: 'src',
        modelLogicalId: 'model-main',
        objectType: options.sourceType,
        names: {},
        attributes: [],
        confidence: 'high'
      },
      {
        logicalId: 'tgt',
        modelLogicalId: 'model-main',
        objectType: options.targetType,
        names: {},
        attributes: [],
        confidence: 'high'
      }
    ],
    relations: [
      {
        logicalId: 'rel-1',
        modelLogicalId: 'model-main',
        sourceLogicalId: 'src',
        targetLogicalId: 'tgt',
        connectionType: options.connectionType,
        confidence: 'high'
      }
    ],
    attributes: [],
    assignments: [],
    uncertainties: []
  }
}

function connectionOf(value: unknown): string {
  const relations = (value as { relations: Array<{ connectionType: string }> }).relations
  return relations[0].connectionType
}

describe('normalizeArisAiDraft', () => {
  it('maps CT_FLOW on an event→function edge to CT_ACTIV_1 with one warning', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_FLOW'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(connectionOf(value)).toBe('CT_ACTIV_1')
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].code).toBe(NORMALIZED_CONNECTION_FINDING_CODE)
    expect(rewrites[0].path).toBe('$.relations[0].connectionType')
    expect(rewrites[0].message).toContain('CT_FLOW')
    expect(rewrites[0].message).toContain('CT_ACTIV_1')
  })

  it('case-folds a lowercase alias to its canonical casing', () => {
    for (const code of ['ct_activ_1', 'CT_Activ_1', '  ct_supp_3  ']) {
      const raw = rawWithRelation({
        sourceType: 'OT_EVT',
        targetType: 'OT_FUNC',
        connectionType: code
      })
      const { value, rewrites } = normalizeArisAiDraft(raw)
      expect(connectionOf(value)).toBe(code.trim().toUpperCase())
      expect(rewrites).toHaveLength(1)
    }
  })

  it('maps CT_SEQ on a function→event edge to CT_CRT_1', () => {
    const { value } = normalizeArisAiDraft(
      rawWithRelation({ sourceType: 'OT_FUNC', targetType: 'OT_EVT', connectionType: 'CT_SEQ' })
    )
    expect(connectionOf(value)).toBe('CT_CRT_1')
  })

  it('disambiguates function→function by the owning model type', () => {
    const eepc = normalizeArisAiDraft(
      rawWithRelation({
        sourceType: 'OT_FUNC',
        targetType: 'OT_FUNC',
        connectionType: 'CT_FLOW',
        modelType: 'MT_EEPC'
      })
    )
    expect(connectionOf(eepc.value)).toBe('CT_IS_PREDEC_OF_1')

    const chain = normalizeArisAiDraft(
      rawWithRelation({
        sourceType: 'OT_FUNC',
        targetType: 'OT_FUNC',
        connectionType: 'CT_FLOW',
        modelType: 'MT_VAL_ADD_CHN_DGM'
      })
    )
    expect(connectionOf(chain.value)).toBe('CT_IS_PRCS_ORNT_SUPER')
  })

  it('maps an invented code on an application-system→function edge to CT_SUPP_3', () => {
    const { value } = normalizeArisAiDraft(
      rawWithRelation({
        sourceType: 'OT_APPL_SYS',
        targetType: 'OT_FUNC',
        connectionType: 'CT_USES'
      })
    )
    expect(connectionOf(value)).toBe('CT_SUPP_3')
  })

  it('maps function→entity type to CT_HAS_OUT and notes the ambiguity', () => {
    const { value, rewrites } = normalizeArisAiDraft(
      rawWithRelation({
        sourceType: 'OT_FUNC',
        targetType: 'OT_ENT_TYPE',
        connectionType: 'CT_WRITES'
      })
    )
    expect(connectionOf(value)).toBe('CT_HAS_OUT')
    expect(rewrites[0].message).toContain('CT_READ_1')
  })

  it('maps person→function to CT_EXEC_1 and notes the ambiguity', () => {
    const { value, rewrites } = normalizeArisAiDraft(
      rawWithRelation({ sourceType: 'OT_PERS', targetType: 'OT_FUNC', connectionType: 'CT_DOES' })
    )
    expect(connectionOf(value)).toBe('CT_EXEC_1')
    expect(rewrites[0].message).toContain('CT_MUST_BE_INFO_ABT_1')
  })

  it('leaves valid codes untouched and returns the SAME value reference', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(rewrites).toHaveLength(0)
    expect(value).toBe(raw)
  })

  it('leaves a relation with a dangling sourceLogicalId untouched', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_FLOW'
    })
    ;(raw.relations as Array<{ sourceLogicalId: string }>)[0].sourceLogicalId = 'nope'
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(rewrites).toHaveLength(0)
    expect(value).toBe(raw)
  })

  it('leaves a non-census pair (rule→rule) untouched', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_RULE',
      targetType: 'OT_RULE',
      connectionType: 'CT_FLOW'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(rewrites).toHaveLength(0)
    expect(value).toBe(raw)
  })

  it('passes non-object / garbage input through unchanged', () => {
    for (const garbage of [null, undefined, 42, 'string', [], { relations: 'not-an-array' }]) {
      const { value, rewrites } = normalizeArisAiDraft(garbage)
      expect(value).toBe(garbage)
      expect(rewrites).toHaveLength(0)
    }
  })

  it('never mutates the input object', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_FLOW'
    })
    const snapshot = structuredClone(raw)
    const { value } = normalizeArisAiDraft(raw)
    // The input is byte-for-byte unchanged…
    expect(raw).toEqual(snapshot)
    // …and the returned value is a fresh object, not the same reference.
    expect(value).not.toBe(raw)
    expect(connectionOf(raw)).toBe('CT_FLOW')
  })

  it('rewrites two invented codes in one draft, emitting two warnings', () => {
    const raw = {
      version: 1,
      models: [{ logicalId: 'm', modelType: 'MT_EEPC', names: {}, confidence: 'high' }],
      objects: [
        {
          logicalId: 'e',
          modelLogicalId: 'm',
          objectType: 'OT_EVT',
          names: {},
          attributes: [],
          confidence: 'high'
        },
        {
          logicalId: 'f',
          modelLogicalId: 'm',
          objectType: 'OT_FUNC',
          names: {},
          attributes: [],
          confidence: 'high'
        },
        {
          logicalId: 'e2',
          modelLogicalId: 'm',
          objectType: 'OT_EVT',
          names: {},
          attributes: [],
          confidence: 'high'
        }
      ],
      relations: [
        {
          logicalId: 'r1',
          modelLogicalId: 'm',
          sourceLogicalId: 'e',
          targetLogicalId: 'f',
          connectionType: 'CT_FLOW',
          confidence: 'high'
        },
        {
          logicalId: 'r2',
          modelLogicalId: 'm',
          sourceLogicalId: 'f',
          targetLogicalId: 'e2',
          connectionType: 'CT_SEQ',
          confidence: 'high'
        }
      ],
      attributes: [],
      assignments: [],
      uncertainties: []
    }
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(rewrites).toHaveLength(2)
    const relations = (value as { relations: Array<{ connectionType: string }> }).relations
    expect(relations[0].connectionType).toBe('CT_ACTIV_1')
    expect(relations[1].connectionType).toBe('CT_CRT_1')
  })
})

/**
 * Wave 9 live A/B hardening: gemini-3.5-flash-lite returned `version !== 1`
 * (schema:invalid_value, repair loop exhausted); qwen3-vl-235b returned a
 * draft where no model had a supported `modelType`. Both are deterministic
 * output-shape quirks the normalizer should absorb the same way the
 * connection-type aliases above are absorbed.
 */
describe('normalizeArisAiDraft — version coercion', () => {
  it('coerces a wrong-number version to 1 with one warning, without mutating the input', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1'
    })
    raw.version = 2
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect((value as { version: unknown }).version).toBe(1)
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].code).toBe(NORMALIZED_VERSION_FINDING_CODE)
    expect(rewrites[0].path).toBe('$.version')
    expect(rewrites[0].message).toContain('2')
    expect(rewrites[0].message).toContain('1')
    // The input is never mutated.
    expect(raw.version).toBe(2)
    expect(value).not.toBe(raw)
  })

  it('coerces a stringly-typed version ("1") to the numeric literal 1', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1'
    })
    raw.version = '1'
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect((value as { version: unknown }).version).toBe(1)
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].code).toBe(NORMALIZED_VERSION_FINDING_CODE)
  })

  it('coerces a missing version to 1 and describes it as "missing"', () => {
    const full = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1'
    })
    const { version: _version, ...raw } = full
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect((value as { version: unknown }).version).toBe(1)
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].message).toContain('missing')
  })

  it('leaves version 1 untouched: no warning, SAME value reference', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(rewrites).toHaveLength(0)
    expect(value).toBe(raw)
  })
})

describe('normalizeArisAiDraft — modelType default', () => {
  it('defaults an unsupported modelType to MT_EEPC with one warning, without mutating the input', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1',
      modelType: 'MT_BOGUS'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    const models = (value as { models: Array<{ modelType: string }> }).models
    expect(models[0].modelType).toBe('MT_EEPC')
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].code).toBe(NORMALIZED_MODEL_TYPE_FINDING_CODE)
    expect(rewrites[0].path).toBe('$.models[0].modelType')
    expect(rewrites[0].message).toContain('MT_BOGUS')
    expect(rewrites[0].message).toContain('MT_EEPC')
    // The input is never mutated.
    expect((raw.models as Array<{ modelType: string }>)[0].modelType).toBe('MT_BOGUS')
    expect(value).not.toBe(raw)
  })

  it('defaults a missing modelType to MT_EEPC and describes it as "missing"', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1'
    })
    const { modelType: _modelType, ...modelRest } = (
      raw.models as Array<Record<string, unknown>>
    )[0]
    ;(raw.models as unknown[])[0] = modelRest
    const { value, rewrites } = normalizeArisAiDraft(raw)
    const models = (value as { models: Array<{ modelType: string }> }).models
    expect(models[0].modelType).toBe('MT_EEPC')
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].code).toBe(NORMALIZED_MODEL_TYPE_FINDING_CODE)
    expect(rewrites[0].message).toContain('missing')
  })

  it('leaves a valid non-default modelType (MT_VAL_ADD_CHN_DGM) untouched: no warning, SAME reference', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1',
      modelType: 'MT_VAL_ADD_CHN_DGM'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(rewrites).toHaveLength(0)
    expect(value).toBe(raw)
    const models = (value as { models: Array<{ modelType: string }> }).models
    expect(models[0].modelType).toBe('MT_VAL_ADD_CHN_DGM')
  })

  it('leaves an already-supported MT_EEPC untouched: no spurious warning', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_ACTIV_1',
      modelType: 'MT_EEPC'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(rewrites).toHaveLength(0)
    expect(value).toBe(raw)
  })

  it('feeds the defaulted modelType into function-to-function connection disambiguation', () => {
    // Mirrors the qwen3-vl-235b quirk: no model has a supported modelType,
    // but the FUNC->FUNC edge still needs EEPC-vs-value-chain disambiguation,
    // which must see the DEFAULTED (not the original invalid) modelType.
    const raw = rawWithRelation({
      sourceType: 'OT_FUNC',
      targetType: 'OT_FUNC',
      connectionType: 'CT_FLOW',
      modelType: 'MT_UNKNOWN'
    })
    const { value, rewrites } = normalizeArisAiDraft(raw)
    expect(connectionOf(value)).toBe('CT_IS_PREDEC_OF_1')
    const codes = rewrites.map((entry) => entry.code).sort()
    expect(codes).toEqual(
      [NORMALIZED_CONNECTION_FINDING_CODE, NORMALIZED_MODEL_TYPE_FINDING_CODE].sort()
    )
  })
})

describe('normalizeArisAiDraft — combined hardening', () => {
  it('fixes version, modelType, and connection type together in a single pass', () => {
    const raw = rawWithRelation({
      sourceType: 'OT_EVT',
      targetType: 'OT_FUNC',
      connectionType: 'CT_FLOW',
      modelType: 'MT_BOGUS'
    })
    raw.version = 3
    const { value, rewrites } = normalizeArisAiDraft(raw)
    const draft = value as {
      version: unknown
      models: Array<{ modelType: string }>
      relations: Array<{ connectionType: string }>
    }
    expect(draft.version).toBe(1)
    expect(draft.models[0].modelType).toBe('MT_EEPC')
    expect(draft.relations[0].connectionType).toBe('CT_ACTIV_1')
    const codes = rewrites.map((entry) => entry.code).sort()
    expect(codes).toEqual(
      [
        NORMALIZED_CONNECTION_FINDING_CODE,
        NORMALIZED_MODEL_TYPE_FINDING_CODE,
        NORMALIZED_VERSION_FINDING_CODE
      ].sort()
    )
  })
})
