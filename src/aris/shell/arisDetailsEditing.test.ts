/**
 * The headless editing model behind the writable details rail.
 *
 * The fixture (`arisDetailsEditingFixture.ts`) is deliberately shaped like the
 * real AnimalWF export: raw unexpanded locale entity references, one Arabic
 * string filed under the English locale tag, and one definition with three
 * occurrences across two models.
 */

import { describe, expect, it } from 'vitest'

import { adaptWorkingDocument } from '../details/seam'
import type { ArisWorkingDocument } from '../model/types'
import {
  ARIS_FALLBACK_LOCALE_IDS,
  arisEditTarget,
  arisLocaleConvention,
  assignableModels,
  attributeSlots,
  bilingualSlots,
  detectScriptLang,
  modelLabel,
  styleFieldPatch,
  styleFieldValue,
  targetDefinition,
  upsertAttributeValue
} from './arisDetailsEditing'
import { AR_LOCALE, EN_LOCALE, buildEditingFixture, buildModel } from './arisDetailsEditingFixture'

const details = adaptWorkingDocument(buildEditingFixture())

describe('detectScriptLang', () => {
  it('reads the script, not the tag', () => {
    expect(detectScriptLang('Approve request')).toBe('en')
    expect(detectScriptLang('اعتماد الطلب')).toBe('ar')
    expect(detectScriptLang('12345')).toBeNull()
  })
})

describe('arisLocaleConvention', () => {
  it('reports the document’s own raw locale ids rather than a synthetic tag', () => {
    expect(arisLocaleConvention(details)).toEqual({ en: EN_LOCALE, ar: AR_LOCALE })
  })

  it('falls back to the canvas default only when the document uses no such locale', () => {
    const emptyDoc = buildEditingFixture()
    const stripped: ArisWorkingDocument = {
      ...emptyDoc,
      models: new Map([['m1', buildModel('m1', '', [])]]),
      objectDefinitions: new Map()
    }
    // `buildModel()` still files its name under the English locale, so only Arabic
    // has no precedent here.
    const convention = arisLocaleConvention(adaptWorkingDocument(stripped))
    expect(convention.ar).toBeNull()
    const slots = bilingualSlots({ values: {}, fallback: null }, convention)
    expect(slots.ar.localeId).toBe(ARIS_FALLBACK_LOCALE_IDS.ar)
    expect(slots.ar.present).toBe(false)
  })
})

describe('bilingualSlots', () => {
  const convention = arisLocaleConvention(details)

  it('keeps the exact locale id a value is filed under, so a write lands in place', () => {
    const definition = details.objectDefinitions.get('od-shared')
    const slots = bilingualSlots(definition?.names, convention)
    expect(slots.en).toMatchObject({ localeId: EN_LOCALE, text: 'Approve request', present: true })
    expect(slots.ar).toMatchObject({ localeId: AR_LOCALE, text: 'اعتماد الطلب', present: true })
  })

  it('offers the document convention for a language that has no value yet', () => {
    const definition = details.objectDefinitions.get('od-solo')
    const slots = bilingualSlots(definition?.names, convention)
    expect(slots.en).toMatchObject({ localeId: EN_LOCALE, text: '', present: false })
    expect(slots.ar).toMatchObject({ localeId: AR_LOCALE, text: '', present: false })
  })
})

describe('attributeSlots', () => {
  const convention = arisLocaleConvention(details)
  const definition = details.objectDefinitions.get('od-shared')

  it('splits an attribute into English, Arabic and other-locale values', () => {
    const slots = attributeSlots(definition!.attributes[0], convention)
    expect(slots.attributeType).toBe('AT_DESC')
    expect(slots.bilingual.en.text).toBe('Approval step')
    expect(slots.bilingual.ar.text).toBe('خطوة الاعتماد')
    expect(slots.other.map((entry) => [entry.localeId, entry.text])).toEqual([
      ['de-DE', 'Genehmigungsschritt']
    ])
  })

  it('flags Arabic prose filed under the English locale tag instead of silently re-filing it', () => {
    const slots = attributeSlots(definition!.attributes[1], convention)
    expect(slots.bilingual.en).toMatchObject({
      localeId: EN_LOCALE,
      text: 'ملاحظة تشغيلية',
      scriptLang: 'ar',
      scriptMismatch: true
    })
    // The Arabic slot stays empty: nothing is filed under the Arabic tag.
    expect(slots.bilingual.ar.present).toBe(false)
  })
})

describe('upsertAttributeValue', () => {
  const values = [
    { localeId: EN_LOCALE, text: 'Approval step' },
    { localeId: AR_LOCALE, text: 'خطوة الاعتماد' }
  ]

  it('replaces a value in place, preserving order', () => {
    expect(upsertAttributeValue(values, EN_LOCALE, 'Approve')).toEqual([
      { localeId: EN_LOCALE, text: 'Approve' },
      { localeId: AR_LOCALE, text: 'خطوة الاعتماد' }
    ])
  })

  it('appends a value in a locale that has none yet', () => {
    expect(upsertAttributeValue(values, 'de-DE', 'Schritt')).toEqual([
      ...values,
      { localeId: 'de-DE', text: 'Schritt' }
    ])
  })

  it('removes the entry when the text is emptied rather than storing a blank', () => {
    expect(upsertAttributeValue(values, AR_LOCALE, '')).toEqual([
      { localeId: EN_LOCALE, text: 'Approval step' }
    ])
  })

  it('treats the empty locale id as AML’s no-locale value', () => {
    expect(upsertAttributeValue([{ localeId: null, text: 'x' }], '', 'y')).toEqual([
      { localeId: null, text: 'y' }
    ])
  })
})

describe('arisEditTarget (plan §8.2)', () => {
  it('reports the definition and the full blast radius for an occurrence', () => {
    const target = arisEditTarget({ kind: 'objectOccurrence', id: 'occ-1' }, details)
    expect(target).toMatchObject({
      definitionId: 'od-shared',
      occurrenceId: 'occ-1',
      modelId: 'm1',
      occurrenceCount: 3,
      modelCount: 2
    })
    expect(targetDefinition(target, details)?.id).toBe('od-shared')
  })

  it('resolves a definition selection without an occurrence id', () => {
    const target = arisEditTarget({ kind: 'objectDefinition', id: 'od-shared' }, details)
    expect(target.occurrenceId).toBeNull()
    expect(target.occurrenceCount).toBe(3)
  })

  it('resolves a model selection to the model alone', () => {
    const target = arisEditTarget({ kind: 'model', id: 'm2' }, details)
    expect(target).toMatchObject({ definitionId: null, occurrenceId: null, modelId: 'm2' })
  })

  it('offers nothing editable for a connection, an attachment or an unknown id', () => {
    expect(arisEditTarget({ kind: 'connectionOccurrence', id: 'cx-1' }, details).definitionId).toBe(
      null
    )
    expect(arisEditTarget({ kind: 'attachment', id: 'a-1' }, details).definitionId).toBeNull()
    expect(
      arisEditTarget({ kind: 'objectOccurrence', id: 'nope' }, details).occurrenceId
    ).toBeNull()
    expect(arisEditTarget(null, details).definitionId).toBeNull()
  })
})

describe('assignableModels', () => {
  it('excludes models the definition is already linked to', () => {
    const definition = details.objectDefinitions.get('od-shared') ?? null
    expect(assignableModels(definition, details, 'en')).toEqual([
      { id: 'm1', label: 'Main process' }
    ])
  })

  it('labels a linked model by name and falls back to the id', () => {
    expect(modelLabel('m2', details, 'en')).toBe('Sub process')
    expect(modelLabel('missing', details, 'en')).toBe('missing')
  })
})

describe('occurrence style fields', () => {
  it('reads a stored override and an inherited (null) one', () => {
    const styled = details.occurrences.get('occ-2')
    const plain = details.occurrences.get('occ-1')
    expect(styleFieldValue(styled?.style, 'fillColor')).toBe('#ff0000')
    expect(styleFieldValue(plain?.style, 'fillColor')).toBe('')
  })

  it('clears an override when the field is emptied', () => {
    expect(styleFieldPatch('fillColor', '  ')).toEqual({ fillColor: null })
  })

  it('parses a numeric width and refuses a non-numeric one rather than storing NaN', () => {
    expect(styleFieldPatch('strokeWidth', '2.5')).toEqual({ strokeWidth: 2.5 })
    expect(styleFieldPatch('strokeWidth', 'thick')).toEqual({})
  })
})
