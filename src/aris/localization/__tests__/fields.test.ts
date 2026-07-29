import { describe, expect, it } from 'vitest'

import { detectArisLocaleIds, extractArisLocalizationFields } from '../fields'
import {
  connectionDefinition,
  freeText,
  makeDocument,
  objectDefinition,
  occurrence
} from './support'

function fieldFor(extract: ReturnType<typeof extractArisLocalizationFields>, elementId: string) {
  const field = extract.fields.find((candidate) => candidate.elementId === elementId)
  if (!field) throw new Error(`No field for ${elementId}`)
  return field
}

describe('extractArisLocalizationFields', () => {
  it('captures an en-only definition with the ar write target defaulting to the detected locale', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve' })]
    })
    const extract = extractArisLocalizationFields(document, { active: 'en' })
    const field = fieldFor(extract, 'ObjDef.1')
    expect(field.value.en).toBe('Approve')
    expect(field.value.ar).toBeUndefined()
    expect(field.origins.en).toBe('paired')
    expect(field.origins.ar).toBeUndefined()
    expect(field.storage.enProperty).toBe('en-US')
    // No ar anywhere ⇒ fallback write locale.
    expect(field.storage.arProperty).toBe('1025')
    expect(field.source).toBe('aris')
    expect(field.field).toBe('name')
    expect(field.kind).toBe('name')
  })

  it('captures an ar-only definition', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { '1025': 'يعتمد' })]
    })
    const field = fieldFor(extractArisLocalizationFields(document, { active: 'ar' }), 'ObjDef.1')
    expect(field.value.ar).toBe('يعتمد')
    expect(field.value.en).toBeUndefined()
    expect(field.storage.arProperty).toBe('1025')
    expect(field.storage.enProperty).toBe('1033')
    expect(field.value.active).toBe('ar')
  })

  it('captures a bilingual definition and keeps both write locales', () => {
    const document = makeDocument({
      objectDefinitions: [
        objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve', '1025': 'يعتمد' })
      ]
    })
    const field = fieldFor(extractArisLocalizationFields(document, { active: 'en' }), 'ObjDef.1')
    expect(field.value.en).toBe('Approve')
    expect(field.value.ar).toBe('يعتمد')
    expect(field.storage.enProperty).toBe('en-US')
    expect(field.storage.arProperty).toBe('1025')
  })

  it('classifies raw internal-DTD entity-reference locale keys and preserves them as write targets', () => {
    const document = makeDocument({
      objectDefinitions: [
        objectDefinition('ObjDef.1', 'OT_FUNC', {
          '&LocaleId.USen;': 'Approve',
          '&LocaleId.AEar;': 'يعتمد'
        })
      ]
    })
    const field = fieldFor(extractArisLocalizationFields(document, { active: 'en' }), 'ObjDef.1')
    expect(field.value.en).toBe('Approve')
    expect(field.value.ar).toBe('يعتمد')
    expect(field.storage.enProperty).toBe('&LocaleId.USen;')
    expect(field.storage.arProperty).toBe('&LocaleId.AEar;')
  })

  it('includes a named rule definition', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.rule', 'OT_RULE', { 'en-US': 'Approved?' })]
    })
    const extract = extractArisLocalizationFields(document, { active: 'en' })
    expect(extract.fields.some((field) => field.elementId === 'ObjDef.rule')).toBe(true)
    expect(fieldFor(extract, 'ObjDef.rule').value.en).toBe('Approved?')
  })

  it('excludes a fully unnamed definition but includes it in no owner map', () => {
    const document = makeDocument({
      objectDefinitions: [
        objectDefinition('ObjDef.named', 'OT_FUNC', { 'en-US': 'Named' }),
        objectDefinition('ObjDef.blank', 'OT_FUNC', { 'en-US': '   ' })
      ]
    })
    const extract = extractArisLocalizationFields(document, { active: 'en' })
    expect(extract.fields.some((field) => field.elementId === 'ObjDef.blank')).toBe(false)
    expect(extract.owners.has('ObjDef.blank')).toBe(false)
    expect(extract.owners.has('ObjDef.named')).toBe(true)
  })

  it('always includes every model, even an unnamed one', () => {
    const document = makeDocument({ modelId: 'Model.X' })
    const extract = extractArisLocalizationFields(document, { active: 'en' })
    const field = fieldFor(extract, 'Model.X')
    expect(field.kind).toBe('name')
    expect(field.processId).toBe('Model.X')
    expect(extract.owners.get('Model.X')).toEqual({
      kind: 'model',
      id: 'Model.X',
      modelId: 'Model.X'
    })
  })

  it('extracts a named connection definition and a non-blank free-text note', () => {
    const document = makeDocument({
      modelId: 'Model.1',
      connectionDefinitions: [
        connectionDefinition('CxnDef.1', 'CT_ACTIV_1', { 'en-US': 'triggers' })
      ],
      freeText: [freeText('FFTextOcc.1', 'Model.1', { 'en-US': 'A note' })]
    })
    const extract = extractArisLocalizationFields(document, { active: 'en' })
    const cxn = fieldFor(extract, 'CxnDef.1')
    expect(cxn.value.en).toBe('triggers')
    expect(extract.owners.get('CxnDef.1')?.kind).toBe('connectionDefinition')

    const note = fieldFor(extract, 'FFTextOcc.1')
    expect(note.field).toBe('text')
    expect(note.kind).toBe('annotation')
    expect(note.value.en).toBe('A note')
    expect(extract.owners.get('FFTextOcc.1')).toEqual({
      kind: 'freeText',
      id: 'FFTextOcc.1',
      modelId: 'Model.1'
    })
  })

  it('scopes a definition to the model of its first occurrence, else "document"', () => {
    const withOcc = makeDocument({
      modelId: 'Model.Home',
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve' })],
      occurrences: [occurrence('ObjOcc.1', 'ObjDef.1', 'Model.Home')]
    })
    const placed = extractArisLocalizationFields(withOcc, { active: 'en' })
    expect(fieldFor(placed, 'ObjDef.1').processId).toBe('Model.Home')
    expect(placed.owners.get('ObjDef.1')?.modelId).toBe('Model.Home')

    const withoutOcc = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'en-US': 'Approve' })]
    })
    const orphan = extractArisLocalizationFields(withoutOcc, { active: 'en' })
    expect(fieldFor(orphan, 'ObjDef.1').processId).toBe('document')
    // Owner modelId is '' (not 'document') for a document-scoped definition.
    expect(orphan.owners.get('ObjDef.1')?.modelId).toBe('')
  })

  it('does not treat a neutral-value key like de-DE as English or Arabic', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'de-DE': 'Genehmigen' })]
    })
    const field = fieldFor(extractArisLocalizationFields(document, { active: 'en' }), 'ObjDef.1')
    expect(field.value.en).toBeUndefined()
    expect(field.value.ar).toBeUndefined()
  })
})

describe('detectArisLocaleIds', () => {
  it('picks the first en/ar key seen across models then definitions', () => {
    const document = makeDocument({
      modelName: { '2057': 'Process' },
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { '14337': 'يعتمد' })]
    })
    expect(detectArisLocaleIds(document)).toEqual({ en: '2057', ar: '14337' })
  })

  it('falls back to 1033/1025 when a language is absent', () => {
    const document = makeDocument({
      objectDefinitions: [objectDefinition('ObjDef.1', 'OT_FUNC', { 'de-DE': 'x' })]
    })
    expect(detectArisLocaleIds(document)).toEqual({ en: '1033', ar: '1025' })
  })
})

describe('write-locale fidelity', () => {
  it('routes an absent counterpart to the document-detected existing key, not the numeric fallback', () => {
    const document = makeDocument({
      objectDefinitions: [
        // Establishes '14337' as the document's Arabic write locale.
        objectDefinition('ObjDef.dmt', 'OT_FUNC', { 'en-US': 'DMT HUB', '14337': 'DMT HUB' }),
        // Missing Arabic ⇒ its ar write target must be '14337', NOT '1025'.
        objectDefinition('ObjDef.api', 'OT_FUNC', { 'en-US': 'API' })
      ]
    })
    const extract = extractArisLocalizationFields(document, { active: 'en' })
    expect(fieldFor(extract, 'ObjDef.api').storage.arProperty).toBe('14337')
  })
})
