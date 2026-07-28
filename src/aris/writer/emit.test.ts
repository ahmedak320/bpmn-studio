import { describe, expect, it } from 'vitest'
import {
  CANONICAL_CHILD_ORDER,
  attrDefSpec,
  canonicalChildRank,
  connectionOccurrenceSpec,
  objectDefinitionSpec,
  objectOccurrenceSpec,
  renderRecord,
  type EmitContext
} from './emit'
import { readWriterSourceView } from './sourceView'
import { FIXTURE_IDS, FIXTURE_LOCALE_AR, FIXTURE_LOCALE_EN } from './testFixture'

const CONTEXT: EmitContext = { indent: '', indentUnit: '\t', newline: '\n' }

function childNames(xml: string): string[] {
  const view = readWriterSourceView(xml)
  const root = view.elements[0]!
  return root.childPaths.map((path) => view.byPath.get(path)!.name)
}

describe('canonical child order', () => {
  it('matches the sequence the ARIS export writes', () => {
    expect(CANONICAL_CHILD_ORDER.ObjOcc).toEqual([
      'SymbolGUID',
      'Brush',
      'Pen',
      'Position',
      'Size',
      'ExternalGUID',
      'CxnOcc',
      'AttrOcc'
    ])
    expect(CANONICAL_CHILD_ORDER.ObjDef).toEqual([
      'GUID',
      'MasterGUID',
      'SymbolGUID',
      'AttrDef',
      'CxnDef'
    ])
    expect(CANONICAL_CHILD_ORDER.CxnOcc).toEqual(['Pen', 'Position', 'AttrOcc'])
  })

  it('sorts unknown children last rather than interleaving them', () => {
    expect(canonicalChildRank('ObjOcc', 'Brush')).toBe(1)
    expect(canonicalChildRank('ObjOcc', 'VendorExtension')).toBe(Number.POSITIVE_INFINITY)
    expect(canonicalChildRank('NotARecord', 'Anything')).toBe(Number.POSITIVE_INFINITY)
  })

  it('reorders children the caller supplied out of order', () => {
    const xml = renderRecord(
      {
        name: 'ObjOcc',
        attributes: [{ name: 'ObjOcc.ID', value: FIXTURE_IDS.startOccurrence }],
        children: [
          { name: 'AttrOcc', attributes: [{ name: 'AttrTypeNum', value: 'AT_NAME' }] },
          { name: 'Size', attributes: [{ name: 'Size.dX', value: '1' }] },
          { name: 'Brush', attributes: [{ name: 'Color', value: 'ffffff' }] },
          { name: 'Position', attributes: [{ name: 'Pos.X', value: '0' }] }
        ]
      },
      CONTEXT
    )
    expect(childNames(xml)).toEqual(['Brush', 'Position', 'Size', 'AttrOcc'])
  })

  it('keeps equal-rank children in the order they were supplied', () => {
    const xml = renderRecord(
      connectionOccurrenceSpec({
        id: FIXTURE_IDS.connectionOccurrence,
        connectionDefinitionId: FIXTURE_IDS.connectionDefinition,
        targetObjectOccurrenceId: FIXTURE_IDS.activityOccurrence,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 }
        ]
      }),
      CONTEXT
    )
    expect(xml).toContain('<Position Pos.X="1" Pos.Y="2"/>')
    expect(xml.indexOf('Pos.X="1"')).toBeLessThan(xml.indexOf('Pos.X="3"'))
    expect(xml.indexOf('Pos.X="3"')).toBeLessThan(xml.indexOf('Pos.X="5"'))
    expect(childNames(xml)).toEqual(['Pen', 'Position', 'Position', 'Position'])
  })
})

describe('record emission', () => {
  it('emits an object definition with its GUID, attributes, and nested connection definitions', () => {
    const xml = renderRecord(
      objectDefinitionSpec({
        id: FIXTURE_IDS.activity,
        typeNum: 'OT_FUNC',
        symbolNum: 'ST_FUNC',
        guid: '00000000-0000-0000-0000-0000000000b2',
        connectionDefinitionIds: [FIXTURE_IDS.connectionDefinition],
        attributes: [
          {
            type: 'AT_NAME',
            values: [
              { localeId: FIXTURE_LOCALE_EN, text: 'Register animal' },
              { localeId: FIXTURE_LOCALE_AR, text: 'تسجيل' }
            ]
          }
        ],
        connectionDefinitions: [
          {
            id: FIXTURE_IDS.connectionDefinition,
            type: 'CT_ACTIV_1',
            targetObjectDefinitionId: FIXTURE_IDS.startEvent,
            guid: '00000000-0000-0000-0000-0000000000c1'
          }
        ]
      }),
      CONTEXT
    )
    expect(childNames(xml)).toEqual(['GUID', 'AttrDef', 'CxnDef'])
    expect(xml).toContain(`ToCxnDefs.IdRefs="${FIXTURE_IDS.connectionDefinition}"`)
    expect(xml).toContain('<PlainText TextValue="تسجيل"/>')
  })

  it('emits an object occurrence with geometry in canonical order', () => {
    const xml = renderRecord(
      objectOccurrenceSpec({
        id: FIXTURE_IDS.startOccurrence,
        objectDefinitionId: FIXTURE_IDS.startEvent,
        symbolNum: 'ST_EV',
        position: { x: 100, y: 200 },
        size: { dx: 554, dy: 151 },
        brushColor: 'cccccc',
        connectionOccurrenceIds: [FIXTURE_IDS.connectionOccurrence],
        attributeOccurrences: [{ typeNum: 'AT_NAME', size: { dx: 0, dy: 0 } }]
      }),
      CONTEXT
    )
    expect(childNames(xml)).toEqual(['Brush', 'Position', 'Size', 'AttrOcc'])
    expect(xml).toContain('<Position Pos.X="100" Pos.Y="200"/>')
    expect(xml).toContain(`ToCxnOccs.IdRefs="${FIXTURE_IDS.connectionOccurrence}"`)
  })

  it('writes a locale id verbatim so an entity-reference locale id survives', () => {
    const xml = renderRecord(
      attrDefSpec({ type: 'AT_NAME', values: [{ localeId: '&LocaleId.AEar;', text: 'اسم' }] }),
      CONTEXT
    )
    expect(xml).toContain('<AttrValue LocaleId="&LocaleId.AEar;">')
  })

  it('refuses an invented locale id', () => {
    expect(() =>
      renderRecord(attrDefSpec({ type: 'AT_NAME', values: [{ localeId: 'ar-AE', text: 'x' }] }), CONTEXT)
    ).toThrowError(/copied verbatim from the source/)
  })

  it('escapes hostile record content instead of emitting markup', () => {
    const xml = renderRecord(
      attrDefSpec({
        type: 'AT_NAME',
        values: [{ localeId: '1033', text: '"/><script>alert(1)</script><!--' }]
      }),
      CONTEXT
    )
    expect(childNames(xml)).toEqual(['AttrValue'])
    expect(readWriterSourceView(xml).elements.some((e) => e.name === 'script')).toBe(false)
  })

  it('rejects a non-integer coordinate', () => {
    expect(() =>
      objectOccurrenceSpec({
        id: FIXTURE_IDS.startOccurrence,
        objectDefinitionId: FIXTURE_IDS.startEvent,
        position: { x: 1.5, y: 0 },
        size: { dx: 1, dy: 1 }
      })
    ).toThrowError(/must be an integer/)
  })

  it('rejects a connection occurrence with no route points', () => {
    expect(() =>
      connectionOccurrenceSpec({
        id: FIXTURE_IDS.connectionOccurrence,
        connectionDefinitionId: FIXTURE_IDS.connectionDefinition,
        targetObjectOccurrenceId: FIXTURE_IDS.activityOccurrence,
        points: []
      })
    ).toThrowError(/at least one route point/)
  })

  it('indents nested records with the context indent unit', () => {
    const xml = renderRecord(attrDefSpec({ type: 'AT_NAME', values: [{ localeId: '1033', text: 'x' }] }), {
      indent: '\t\t',
      indentUnit: '\t',
      newline: '\n'
    })
    expect(xml.startsWith('\t\t<AttrDef')).toBe(true)
    expect(xml).toContain('\n\t\t\t<AttrValue LocaleId="1033">')
    expect(xml.endsWith('\n\t\t</AttrDef>')).toBe(true)
  })
})
