import { describe, expect, it } from 'vitest'
import {
  childrenNamed,
  childrenOf,
  declaredIds,
  isIdDeclarationAttribute,
  isListReferenceAttribute,
  isSingleReferenceAttribute,
  parentOf,
  readWriterSourceView,
  requireAttribute,
  requireElementById
} from './sourceView'
import { sliceSpan } from './spans'
import { FIXTURE_IDS, FIXTURE_LOCALE_AR, FIXTURE_LOCALE_EN, SAMPLE_AML } from './testFixture'

const view = readWriterSourceView(SAMPLE_AML)

describe('buildWriterSourceView', () => {
  it('addresses every element by a span that slices back to its exact source text', () => {
    view.elements.forEach((element) => {
      const raw = sliceSpan(SAMPLE_AML, element.span)
      expect(raw.startsWith(`<${element.name}`)).toBe(true)
      expect(raw.endsWith(element.selfClosing ? '/>' : `</${element.name}>`)).toBe(true)
    })
  })

  it('addresses every attribute value span exactly, quotes excluded', () => {
    view.elements.forEach((element) => {
      element.attributes.forEach((attribute) => {
        expect(sliceSpan(SAMPLE_AML, attribute.valueSpan)).toBe(attribute.value)
        expect(sliceSpan(SAMPLE_AML, attribute.span)).toBe(
          `${attribute.name}=${attribute.quote}${attribute.value}${attribute.quote}`
        )
      })
    })
  })

  it('uses the same element-path convention as the semantic index', () => {
    expect(view.rootPath).toBe('AML[1]')
    expect(requireElementById(view, FIXTURE_IDS.model).path).toBe('AML[1]/Group[1]/Group[1]/Model[1]')
    expect(requireElementById(view, FIXTURE_IDS.activityOccurrence).path).toBe(
      'AML[1]/Group[1]/Group[1]/Model[1]/ObjOcc[2]'
    )
  })

  it('reads the locale ids the source declared, verbatim', () => {
    expect(view.localeIds).toEqual([FIXTURE_LOCALE_AR, FIXTURE_LOCALE_EN])
    expect(view.entities.get('LocaleId.AEar')).toBe('14337')
    expect(view.entities.get('LocaleId.USen')).toBe('1033')
  })

  it('records the DOCTYPE external identifier the source declared', () => {
    expect(view.doctypeExternalId).toBe('ARIS-Export.dtd')
  })

  it('preserves the source quote style per attribute', () => {
    const attachment = requireElementById(view, FIXTURE_IDS.attachment)
    expect(requireAttribute(attachment, 'Creator').quote).toBe("'")
    expect(requireAttribute(attachment, 'OLEDef.ID').quote).toBe('"')
  })

  it('indexes unknown elements and unknown attributes rather than dropping them', () => {
    const extension = view.elements.find((element) => element.name === 'VendorExtension')
    expect(extension).toBeDefined()
    expect(extension!.attributeByName.get('vendor:flavour')?.value).toBe('internal')
    expect(extension!.attributeByName.get('retained')?.value).toBe('yes')
  })

  it('links parents and children', () => {
    const model = requireElementById(view, FIXTURE_IDS.model)
    expect(parentOf(view, model)?.sourceId).toBe(FIXTURE_IDS.group)
    expect(childrenOf(view, model).map((child) => child.name)).toEqual([
      'Flag',
      'GUID',
      'Lane',
      'AttrDef',
      'ObjOcc',
      'ObjOcc',
      'FFTextOcc',
      'OLEOcc'
    ])
    expect(childrenNamed(view, model, 'ObjOcc').map((child) => child.sourceId)).toEqual([
      FIXTURE_IDS.startOccurrence,
      FIXTURE_IDS.activityOccurrence
    ])
  })

  it('collects every id declaration and every reference token', () => {
    expect(declaredIds(view)).toEqual([
      FIXTURE_IDS.fontStyleSheet,
      FIXTURE_IDS.freeText,
      FIXTURE_IDS.attachment,
      FIXTURE_IDS.rootGroup,
      FIXTURE_IDS.group,
      FIXTURE_IDS.startEvent,
      FIXTURE_IDS.connectionDefinition,
      FIXTURE_IDS.activity,
      FIXTURE_IDS.model,
      FIXTURE_IDS.lane,
      FIXTURE_IDS.startOccurrence,
      FIXTURE_IDS.connectionOccurrence,
      FIXTURE_IDS.activityOccurrence,
      FIXTURE_IDS.attachmentOccurrence
    ])
    expect(view.referencesByTarget.get(FIXTURE_IDS.activity)?.map((r) => r.attributeName)).toEqual([
      'ToObjDef.IdRef',
      'ObjDef.IdRef'
    ])
    expect(view.referencesByTarget.get(FIXTURE_IDS.fontStyleSheet)).toHaveLength(2)
  })

  it('tolerates trailing whitespace inside an IdRefs list', () => {
    const occurrence = requireElementById(view, FIXTURE_IDS.startOccurrence)
    expect(requireAttribute(occurrence, 'ToCxnOccs.IdRefs').value).toBe(
      `${FIXTURE_IDS.connectionOccurrence}  `
    )
    const reference = view.references.find(
      (candidate) =>
        candidate.elementPath === occurrence.path &&
        candidate.attributeName === 'ToCxnOccs.IdRefs'
    )
    expect(reference?.targetId).toBe(FIXTURE_IDS.connectionOccurrence)
    expect(sliceSpan(SAMPLE_AML, reference!.span)).toBe(FIXTURE_IDS.connectionOccurrence)
  })

  it('classifies id, single-reference, and list-reference attribute names', () => {
    expect(isIdDeclarationAttribute('ObjDef.ID')).toBe(true)
    expect(isIdDeclarationAttribute('ID')).toBe(false)
    expect(isSingleReferenceAttribute('ToObjOcc.IdRef')).toBe(true)
    expect(isListReferenceAttribute('ToCxnOccs.IdRefs')).toBe(true)
    expect(isListReferenceAttribute('ToObjOcc.IdRef')).toBe(false)
  })

  it('fails loudly for an unknown id or attribute', () => {
    expect(() => requireElementById(view, 'ObjDef.nope-p-L')).toThrowError(/No source record/)
    expect(() => requireAttribute(requireElementById(view, FIXTURE_IDS.model), 'nope')).toThrowError(
      /has no attribute/
    )
  })
})
