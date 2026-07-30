import { describe, expect, it } from 'vitest'

import {
  ARIS_ELEMENT_ATTRIBUTE_SCHEMA,
  ARIS_EPC_MODEL_ATTRIBUTE_SCHEMA,
  schemaForModelType,
  schemaForObjectType
} from './attributes'

describe('ARIS element attribute schema', () => {
  it('mandatory AT_ID is present for OT_FUNC', () => {
    const schema = schemaForObjectType('OT_FUNC')
    const atId = schema.find((entry) => entry.attributeType === 'AT_ID')
    expect(atId).toBeDefined()
    expect(atId?.mandatory).toBe(true)
  })

  it('AT_DESC, AT_TIME_AVG_PRCS and AT_PROC_CODE are present for OT_FUNC', () => {
    const types = schemaForObjectType('OT_FUNC').map((entry) => entry.attributeType)
    expect(types).toContain('AT_DESC')
    expect(types).toContain('AT_TIME_AVG_PRCS')
    expect(types).toContain('AT_PROC_CODE')
  })

  it('returns an empty array for an unknown object type', () => {
    expect(schemaForObjectType('OT_DOES_NOT_EXIST')).toHaveLength(0)
  })

  it('every element schema entry appliesTo objectType and names objectTypes', () => {
    for (const entry of ARIS_ELEMENT_ATTRIBUTE_SCHEMA) {
      expect(entry.appliesTo).toBe('objectType')
      expect(entry.objectTypes).toBeDefined()
      expect(entry.objectTypes?.length).toBeGreaterThan(0)
    }
  })
})

describe('ARIS EPC model attribute schema', () => {
  it('AT_PERS_RESP is present for MT_EEPC', () => {
    const schema = schemaForModelType('MT_EEPC')
    const entry = schema.find((e) => e.attributeType === 'AT_PERS_RESP')
    expect(entry).toBeDefined()
    expect(entry?.verification).toBe('fixture')
  })

  it('returns the expected model attribute types', () => {
    const types = schemaForModelType('MT_EEPC').map((entry) => entry.attributeType)
    expect(types).toContain('AT_ID')
    expect(types).toContain('AT_VERSION')
    expect(types).toContain('AT_PROC_OBJ')
    expect(types).toContain('AT_PROC_SCOPE')
    expect(types).toContain('AT_SERVICE_FEES')
  })

  it('returns an empty array for an unknown model type', () => {
    expect(schemaForModelType('MT_DOES_NOT_EXIST')).toHaveLength(0)
  })

  it('every model schema entry appliesTo model and names modelTypes', () => {
    for (const entry of ARIS_EPC_MODEL_ATTRIBUTE_SCHEMA) {
      expect(entry.appliesTo).toBe('model')
      expect(entry.modelTypes).toBeDefined()
      expect(entry.modelTypes?.length).toBeGreaterThan(0)
    }
  })
})
