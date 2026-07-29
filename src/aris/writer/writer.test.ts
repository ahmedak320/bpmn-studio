import { describe, expect, it } from 'vitest'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import {
  appendIdRefEdits,
  createConnectionDefinitionEdits,
  createConnectionOccurrenceEdits,
  createObjectDefinitionEdits,
  createObjectOccurrenceEdits,
  deleteElementEdits,
  deleteRecordEdits,
  deleteRecordsCascade,
  moveOccurrenceEdits,
  renameSourceIdEdits,
  rerouteConnectionEdits,
  resizeOccurrenceEdits,
  setAttributeEdits,
  setLocalizedAttributeEdits
} from './edits'
import { ArisWriterError } from './errors'
import { exportDerivedAml, prepareDerivedAml } from './exportDerivedAml'
import { createArisIdAllocator } from './ids'
import { applyAmlEdits, assertOnlySpanChanged, diffTexts, replaceEdit } from './patch'
import { makeSpan } from './spans'
import {
  childrenNamed,
  declaredIds,
  readWriterSourceView,
  requireElementById,
  type WriterSourceView
} from './sourceView'
import { FIXTURE_IDS, FIXTURE_LOCALE_AR, FIXTURE_LOCALE_EN, SAMPLE_AML } from './testFixture'

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function view(): WriterSourceView {
  return readWriterSourceView(SAMPLE_AML)
}

function allocatorFor(source: WriterSourceView, seed = 7) {
  return createArisIdAllocator({ existingIds: declaredIds(source), random: seededRandom(seed) })
}

/** Fragments of the fixture the writer must never rewrite. */
const UNRELATED_FRAGMENTS = [
  '<!-- exported with version 10.0.11.0.1400208 -->',
  '<!-- one business group, kept verbatim on export -->',
  '<!-- the activity occurrence follows -->',
  '<VendorExtension vendor:flavour="internal" retained="yes"/>',
  `<OLEDef OLEDef.ID="${FIXTURE_IDS.attachment}" Creator='fixture'>`,
  '<!ENTITY LocaleId.AEar "14337">',
  `ToCxnOccs.IdRefs="${FIXTURE_IDS.connectionOccurrence}  "`
]

function expectUnrelatedContentPreserved(derived: string): void {
  UNRELATED_FRAGMENTS.forEach((fragment) => expect(derived).toContain(fragment))
}

describe('the imported original is never modified', () => {
  it('leaves the original bytes untouched no matter what the writer is asked to do', () => {
    const before = SAMPLE_AML
    const source = view()
    const edits = [
      ...setLocalizedAttributeEdits(source, FIXTURE_IDS.activity, {
        type: 'AT_NAME',
        localeId: FIXTURE_LOCALE_EN,
        text: 'Renamed'
      }),
      ...moveOccurrenceEdits(source, FIXTURE_IDS.startOccurrence, { x: 4242, y: 9 })
    ]
    const result = applyAmlEdits(SAMPLE_AML, edits)
    expect(result.text).not.toBe(before)
    expect(SAMPLE_AML).toBe(before)
    expect(source.text).toBe(before)
  })

  it('produces byte-identical output for an empty edit set', () => {
    const exported = prepareDerivedAml({ originalText: SAMPLE_AML, edits: [] })
    expect(exported.text).toBe(SAMPLE_AML)
    expect(exported.changed).toBe(false)
    expect(exported.derivedByteLength).toBe(exported.originalByteLength)
    expect(diffTexts(SAMPLE_AML, exported.text)).toBeNull()
  })
})

describe('editing an existing name (plan section 9.4)', () => {
  it('changes only the expected byte range and rewrites no unknown sibling XML', () => {
    const source = view()
    const activity = requireElementById(source, FIXTURE_IDS.activity)
    const attrDef = childrenNamed(source, activity, 'AttrDef')[0]!
    const english = childrenNamed(source, attrDef, 'AttrValue').find(
      (candidate) => candidate.attributeByName.get('LocaleId')?.value === FIXTURE_LOCALE_EN
    )!

    const edits = setLocalizedAttributeEdits(source, FIXTURE_IDS.activity, {
      type: 'AT_NAME',
      localeId: FIXTURE_LOCALE_EN,
      text: 'Register animal profile'
    })
    expect(edits).toHaveLength(1)

    const derived = applyAmlEdits(SAMPLE_AML, edits).text

    // The one and only differing region sits inside the English AttrValue.
    const difference = assertOnlySpanChanged(SAMPLE_AML, derived, english.span)
    expect(difference).not.toBeNull()
    // The diff has been trimmed to the minimum: nothing was removed and exactly the eight
    // characters the rename adds were inserted.
    expect(difference!.originalText).toBe('')
    expect(difference!.derivedText).toBe(' profile')
    expect(derived).toContain('<PlainText TextValue="Register animal profile"/>')

    // Every byte outside that region is identical — including the unknown sibling element,
    // the Arabic AttrValue next to it, and the comments elsewhere in the document.
    expect(derived.slice(0, difference!.originalSpan.start)).toBe(
      SAMPLE_AML.slice(0, difference!.originalSpan.start)
    )
    expect(derived.slice(difference!.derivedSpan.end)).toBe(
      SAMPLE_AML.slice(difference!.originalSpan.end)
    )
    expectUnrelatedContentPreserved(derived)
    expect(derived).toContain('TextValue="&#1578;&#1587;&#1580;&#1610;&#1604;"')
  })

  it('re-parses cleanly through the lossless tokenizer', () => {
    const source = view()
    const derived = applyAmlEdits(
      SAMPLE_AML,
      setLocalizedAttributeEdits(source, FIXTURE_IDS.activity, {
        type: 'AT_NAME',
        localeId: FIXTURE_LOCALE_EN,
        text: 'Register animal profile'
      })
    ).text
    const reparsed = tokenizeXmlDocument(derived)
    expect(reparsed.rootElementName).toBe('AML')
    expect(reparsed.nodeCount).toBe(tokenizeXmlDocument(SAMPLE_AML).nodeCount)
    expect(readWriterSourceView(derived).byId.size).toBe(source.byId.size)
  })

  it('escapes a hostile name instead of letting it break out of the attribute', () => {
    const source = view()
    const derived = applyAmlEdits(
      SAMPLE_AML,
      setLocalizedAttributeEdits(source, FIXTURE_IDS.activity, {
        type: 'AT_NAME',
        localeId: FIXTURE_LOCALE_EN,
        text: '<script>alert(1)</script> ]]> "quoted"'
      })
    ).text
    expect(derived).toContain(
      'TextValue="&lt;script&gt;alert(1)&lt;/script&gt; ]]&gt; &quot;quoted&quot;"'
    )
    const reparsed = readWriterSourceView(derived)
    expect(reparsed.elements.some((element) => element.name === 'script')).toBe(false)
    expect(reparsed.byId.size).toBe(source.byId.size)
  })

  it('preserves attribute order and quote style when patching a value in place', () => {
    const source = view()
    const oleDef = requireElementById(source, FIXTURE_IDS.attachment)
    const derived = applyAmlEdits(
      SAMPLE_AML,
      setAttributeEdits(source, oleDef, 'Creator', 'someone else')
    ).text
    expect(derived).toContain(
      `<OLEDef OLEDef.ID="${FIXTURE_IDS.attachment}" Creator='someone else'>`
    )
  })
})

describe('adding an Arabic attribute (plan section 9.4)', () => {
  it('uses a locale id read from the source rather than an invented one', () => {
    const source = view()
    expect(source.localeIds).toEqual([FIXTURE_LOCALE_AR, FIXTURE_LOCALE_EN])

    const derived = applyAmlEdits(
      SAMPLE_AML,
      setLocalizedAttributeEdits(source, FIXTURE_IDS.startEvent, {
        type: 'AT_NAME',
        localeId: source.localeIds[0]!,
        text: 'تم استلام الطلب'
      })
    ).text

    expect(derived).toContain(`<AttrValue LocaleId="${FIXTURE_LOCALE_AR}">`)
    expect(derived).toContain('<PlainText TextValue="تم استلام الطلب"/>')

    const reparsed = readWriterSourceView(derived)
    const startEvent = requireElementById(reparsed, FIXTURE_IDS.startEvent)
    const attrDef = childrenNamed(reparsed, startEvent, 'AttrDef')[0]!
    const locales = childrenNamed(reparsed, attrDef, 'AttrValue').map(
      (value) => value.attributeByName.get('LocaleId')?.value
    )
    expect(locales).toEqual([FIXTURE_LOCALE_EN, FIXTURE_LOCALE_AR])
    expectUnrelatedContentPreserved(derived)
  })

  it('adds a whole AttrDef when the record has no attribute of that type yet', () => {
    const source = view()
    const derived = applyAmlEdits(
      SAMPLE_AML,
      setLocalizedAttributeEdits(source, FIXTURE_IDS.activity, {
        type: 'AT_DESC',
        localeId: FIXTURE_LOCALE_AR,
        text: 'وصف'
      })
    ).text
    expect(derived).toContain('<AttrDef AttrDef.Type="AT_DESC">')
    const reparsed = readWriterSourceView(derived)
    const activity = requireElementById(reparsed, FIXTURE_IDS.activity)
    expect(
      childrenNamed(reparsed, activity, 'AttrDef').map(
        (child) => child.attributeByName.get('AttrDef.Type')?.value
      )
    ).toEqual(['AT_NAME', 'AT_DESC'])
  })
})

describe('moving and resizing an occurrence (plan section 9.4)', () => {
  it('rewrites only the Position and Size attribute values', () => {
    const source = view()
    const edits = [
      ...moveOccurrenceEdits(source, FIXTURE_IDS.activityOccurrence, { x: 1500, y: 2600 }),
      ...resizeOccurrenceEdits(source, FIXTURE_IDS.activityOccurrence, { dx: 700, dy: 200 })
    ]
    const derived = applyAmlEdits(SAMPLE_AML, edits).text
    expect(derived).toContain('<Position Pos.X="1500" Pos.Y="2600"/>')
    expect(derived).toContain('<Size Size.dX="700" Size.dY="200"/>')
    // The start occurrence's own geometry is untouched.
    expect(derived).toContain('<Position Pos.X="1000" Pos.Y="2000"/>')
    expect(derived).toContain('<Size Size.dX="554" Size.dY="151"/>')
    expectUnrelatedContentPreserved(derived)
  })

  it('rejects a move against a record that has no geometry', () => {
    const source = view()
    expect(() => moveOccurrenceEdits(source, FIXTURE_IDS.activity, { x: 1, y: 1 })).toThrowError(
      /has no <Position> child/
    )
  })
})

describe('rerouting a connection (plan section 9.4)', () => {
  it('replaces the whole route point run and leaves the Pen untouched', () => {
    const source = view()
    const derived = applyAmlEdits(
      SAMPLE_AML,
      rerouteConnectionEdits(source, FIXTURE_IDS.connectionOccurrence, [
        { x: 1277, y: 2151 },
        { x: 1800, y: 2151 },
        { x: 1800, y: 2400 },
        { x: 1277, y: 2400 }
      ])
    ).text
    const reparsed = readWriterSourceView(derived)
    const connection = requireElementById(reparsed, FIXTURE_IDS.connectionOccurrence)
    expect(
      childrenNamed(reparsed, connection, 'Position').map((position) => [
        position.attributeByName.get('Pos.X')?.value,
        position.attributeByName.get('Pos.Y')?.value
      ])
    ).toEqual([
      ['1277', '2151'],
      ['1800', '2151'],
      ['1800', '2400'],
      ['1277', '2400']
    ])
    expect(childrenNamed(reparsed, connection, 'Pen')).toHaveLength(1)
    expect(derived).toContain('<Pen Color="0" Style="0" Width="1"/>')
    expectUnrelatedContentPreserved(derived)
  })

  it('refuses to reroute to an empty point list', () => {
    expect(() => rerouteConnectionEdits(view(), FIXTURE_IDS.connectionOccurrence, [])).toThrowError(
      /at least one route point/
    )
  })
})

describe('creating records (plan section 9.2 / 9.4)', () => {
  it('creates a definition, an occurrence, a connection definition, and a connection occurrence', () => {
    const source = view()
    const allocator = allocatorFor(source)
    const definitionId = allocator.allocateDefinitionId('ObjDef')
    const occurrenceId = allocator.allocateOccurrenceId('ObjOcc', FIXTURE_IDS.model)
    const connectionDefinitionId = allocator.allocateDefinitionId('CxnDef')
    const connectionOccurrenceId = allocator.allocateOccurrenceId('CxnOcc', FIXTURE_IDS.model)

    const edits = [
      ...createObjectDefinitionEdits(source, FIXTURE_IDS.group, {
        id: definitionId,
        typeNum: 'OT_EVT',
        symbolNum: 'ST_EV',
        guid: '00000000-0000-0000-0000-0000000000ff',
        attributes: [
          {
            type: 'AT_NAME',
            values: [
              { localeId: FIXTURE_LOCALE_EN, text: 'Animal registered' },
              { localeId: FIXTURE_LOCALE_AR, text: 'تم التسجيل' }
            ]
          }
        ]
      }),
      ...createObjectOccurrenceEdits(source, FIXTURE_IDS.model, {
        id: occurrenceId,
        objectDefinitionId: definitionId,
        symbolNum: 'ST_EV',
        position: { x: 1000, y: 2800 },
        size: { dx: 554, dy: 151 },
        brushColor: 'cccccc'
      }),
      ...createConnectionDefinitionEdits(source, FIXTURE_IDS.activity, {
        id: connectionDefinitionId,
        type: 'CT_ACTIV_1',
        targetObjectDefinitionId: definitionId,
        guid: '00000000-0000-0000-0000-0000000000fe'
      }),
      ...createConnectionOccurrenceEdits(source, FIXTURE_IDS.activityOccurrence, {
        id: connectionOccurrenceId,
        connectionDefinitionId,
        targetObjectOccurrenceId: occurrenceId,
        points: [
          { x: 1277, y: 2551 },
          { x: 1277, y: 2800 }
        ]
      })
    ]

    const exported = exportDerivedAml({
      originalText: SAMPLE_AML,
      edits,
      addedIds: [definitionId, occurrenceId, connectionDefinitionId, connectionOccurrenceId]
    })
    expect(exported.validation.ok).toBe(true)

    const reparsed = readWriterSourceView(exported.text)
    // Definitions land in the group; occurrences land in their model.
    expect(
      reparsed.byPath.get(requireElementById(reparsed, definitionId).parentPath!)?.sourceId
    ).toBe(FIXTURE_IDS.group)
    expect(
      reparsed.byPath.get(requireElementById(reparsed, occurrenceId).parentPath!)?.sourceId
    ).toBe(FIXTURE_IDS.model)
    // Connection definitions nest under their SOURCE definition, occurrences under their SOURCE
    // occurrence — that nesting is how AML expresses the source endpoint.
    expect(
      reparsed.byPath.get(requireElementById(reparsed, connectionDefinitionId).parentPath!)
        ?.sourceId
    ).toBe(FIXTURE_IDS.activity)
    expect(
      reparsed.byPath.get(requireElementById(reparsed, connectionOccurrenceId).parentPath!)
        ?.sourceId
    ).toBe(FIXTURE_IDS.activityOccurrence)
    // ...and are registered in the source record's reference list.
    expect(
      requireElementById(reparsed, FIXTURE_IDS.activity).attributeByName.get('ToCxnDefs.IdRefs')
        ?.value
    ).toContain(connectionDefinitionId)
    expect(
      requireElementById(reparsed, FIXTURE_IDS.activityOccurrence).attributeByName.get(
        'ToCxnOccs.IdRefs'
      )?.value
    ).toContain(connectionOccurrenceId)
    expectUnrelatedContentPreserved(exported.text)
  })

  it('emits new records in canonical child order', () => {
    const source = view()
    const allocator = allocatorFor(source, 11)
    const occurrenceId = allocator.allocateOccurrenceId('ObjOcc', FIXTURE_IDS.model)
    const derived = applyAmlEdits(
      SAMPLE_AML,
      createObjectOccurrenceEdits(source, FIXTURE_IDS.model, {
        id: occurrenceId,
        objectDefinitionId: FIXTURE_IDS.activity,
        position: { x: 10, y: 20 },
        size: { dx: 30, dy: 40 },
        brushColor: 'ffffff',
        attributeOccurrences: [{ typeNum: 'AT_NAME', size: { dx: 0, dy: 0 } }]
      })
    ).text
    const reparsed = readWriterSourceView(derived)
    const occurrence = requireElementById(reparsed, occurrenceId)
    expect(occurrence.childPaths.map((path) => reparsed.byPath.get(path)!.name)).toEqual([
      'Brush',
      'Position',
      'Size',
      'AttrOcc'
    ])
  })

  it('refuses to put a definition in a model or an occurrence in a group', () => {
    const source = view()
    const allocator = allocatorFor(source, 13)
    expect(() =>
      createObjectDefinitionEdits(source, FIXTURE_IDS.model, {
        id: allocator.allocateDefinitionId('ObjDef'),
        typeNum: 'OT_EVT'
      })
    ).toThrowError(/not a <Group>/)
    expect(() =>
      createObjectOccurrenceEdits(source, FIXTURE_IDS.group, {
        id: allocator.allocateOccurrenceId('ObjOcc', FIXTURE_IDS.model),
        objectDefinitionId: FIXTURE_IDS.activity,
        position: { x: 0, y: 0 },
        size: { dx: 1, dy: 1 }
      })
    ).toThrowError(/not a <Model>/)
  })
})

describe('deleting records (plan section 9.4)', () => {
  it('deletes a connection occurrence and prunes the list that referenced it', () => {
    const source = view()
    const deletion = deleteRecordEdits(source, [FIXTURE_IDS.connectionOccurrence])
    expect(deletion.danglingSingleReferences).toHaveLength(0)
    const exported = exportDerivedAml({
      originalText: SAMPLE_AML,
      edits: deletion.edits,
      removedIds: deletion.deletedIds
    })
    const reparsed = readWriterSourceView(exported.text)
    expect(reparsed.byId.has(FIXTURE_IDS.connectionOccurrence)).toBe(false)
    expect(
      requireElementById(reparsed, FIXTURE_IDS.startOccurrence).attributeByName.get(
        'ToCxnOccs.IdRefs'
      )?.value
    ).toBe('')
    expectUnrelatedContentPreserved(
      exported.text.replace(
        /ToCxnOccs\.IdRefs=""/,
        `ToCxnOccs.IdRefs="${FIXTURE_IDS.connectionOccurrence}  "`
      )
    )
  })

  it('cascades from a connection definition to the occurrence that referenced it', () => {
    const source = view()
    const deletion = deleteRecordsCascade(source, [FIXTURE_IDS.connectionDefinition])
    expect(deletion.danglingSingleReferences).toHaveLength(0)
    expect(deletion.deletedIds).toEqual(
      expect.arrayContaining([FIXTURE_IDS.connectionDefinition, FIXTURE_IDS.connectionOccurrence])
    )
    const exported = exportDerivedAml({
      originalText: SAMPLE_AML,
      edits: deletion.edits,
      removedIds: deletion.deletedIds
    })
    const reparsed = readWriterSourceView(exported.text)
    expect(reparsed.byId.has(FIXTURE_IDS.connectionDefinition)).toBe(false)
    expect(reparsed.byId.has(FIXTURE_IDS.connectionOccurrence)).toBe(false)
    expect(exported.validation.ok).toBe(true)
  })

  it('deletes an object occurrence together with the connections it owns', () => {
    const source = view()
    const deletion = deleteRecordsCascade(source, [FIXTURE_IDS.startOccurrence])
    expect(deletion.deletedIds).toEqual(
      expect.arrayContaining([FIXTURE_IDS.startOccurrence, FIXTURE_IDS.connectionOccurrence])
    )
    const exported = exportDerivedAml({
      originalText: SAMPLE_AML,
      edits: deletion.edits,
      removedIds: deletion.deletedIds
    })
    expect(exported.validation.ok).toBe(true)
    const reparsed = readWriterSourceView(exported.text)
    expect(reparsed.byId.has(FIXTURE_IDS.startOccurrence)).toBe(false)
    // The definition the occurrence pointed at is a different record and stays.
    expect(reparsed.byId.has(FIXTURE_IDS.startEvent)).toBe(true)
    expect(reparsed.byId.has(FIXTURE_IDS.activityOccurrence)).toBe(true)
  })

  it('cascades from an object definition to its occurrences and their connections', () => {
    const source = view()
    const deletion = deleteRecordsCascade(source, [FIXTURE_IDS.activity])
    expect(deletion.deletedIds).toEqual(
      expect.arrayContaining([
        FIXTURE_IDS.activity,
        FIXTURE_IDS.connectionDefinition,
        FIXTURE_IDS.activityOccurrence,
        FIXTURE_IDS.connectionOccurrence
      ])
    )
    const exported = exportDerivedAml({
      originalText: SAMPLE_AML,
      edits: deletion.edits,
      removedIds: deletion.deletedIds
    })
    expect(exported.validation.ok).toBe(true)
    const reparsed = readWriterSourceView(exported.text)
    expect(reparsed.byId.has(FIXTURE_IDS.startEvent)).toBe(true)
    expect(reparsed.byId.has(FIXTURE_IDS.activity)).toBe(false)
  })

  it('removes the deleted element together with its own line, not its neighbours', () => {
    const source = view()
    const deletion = deleteRecordEdits(source, [FIXTURE_IDS.lane])
    const derived = applyAmlEdits(SAMPLE_AML, deletion.edits).text
    expect(derived).not.toContain('<Lane ')
    expect(derived).toContain('<Flag/>')
    expect(derived).toContain('<AttrDef AttrDef.Type="AT_NAME">')
    expect(derived).not.toMatch(
      /\n\t*\n\t*<AttrDef AttrDef\.Type="AT_NAME">\n\t*<AttrValue LocaleId="&LocaleId\.USen;">\n\t*<StyledElement>\n\t*<Paragraph Alignment="UNDEFINED" Indent="0"\/>\n\t*<StyledElement>\n\t*<PlainText TextValue="Animal registration"/
    )
  })

  it('deletes an element that declares no id, addressed directly', () => {
    const source = view()
    const activity = requireElementById(source, FIXTURE_IDS.activity)
    const attrDef = childrenNamed(source, activity, 'AttrDef')[0]!
    const arabic = childrenNamed(source, attrDef, 'AttrValue')[0]!
    const derived = applyAmlEdits(
      SAMPLE_AML,
      deleteElementEdits(source, [arabic], 'drop the Arabic value')
    ).text

    expect(derived).not.toContain('TextValue="&#1578;&#1587;&#1580;&#1610;&#1604;"')
    // The English sibling and the AttrDef around it are untouched.
    expect(derived).toContain('TextValue="Register animal"')
    expect(derived).toContain('<AttrDef AttrDef.Type="AT_NAME">')
    expect(readWriterSourceView(derived).byId.has(FIXTURE_IDS.activity)).toBe(true)
  })

  it('collapses nested targets so two deletions can never overlap', () => {
    const source = view()
    const activity = requireElementById(source, FIXTURE_IDS.activity)
    const attrDef = childrenNamed(source, activity, 'AttrDef')[0]!
    const child = childrenNamed(source, attrDef, 'AttrValue')[0]!
    const edits = deleteElementEdits(source, [child, attrDef], 'drop both')

    expect(edits).toHaveLength(1)
    const derived = applyAmlEdits(SAMPLE_AML, edits).text
    expect(derived).not.toContain('TextValue="Register animal"')
    expect(derived).toContain('TextValue="Request received"')
  })
})

describe('preserving comments and unknown tags (plan section 9.4)', () => {
  it('copies every comment and every unknown element through a broad edit batch verbatim', () => {
    const source = view()
    const allocator = allocatorFor(source, 29)
    const newDefinitionId = allocator.allocateDefinitionId('ObjDef')

    const edits = [
      ...setLocalizedAttributeEdits(source, FIXTURE_IDS.activity, {
        type: 'AT_NAME',
        localeId: FIXTURE_LOCALE_EN,
        text: 'Edited'
      }),
      ...setLocalizedAttributeEdits(source, FIXTURE_IDS.startEvent, {
        type: 'AT_NAME',
        localeId: FIXTURE_LOCALE_AR,
        text: 'مضاف'
      }),
      ...moveOccurrenceEdits(source, FIXTURE_IDS.startOccurrence, { x: 5, y: 6 }),
      ...resizeOccurrenceEdits(source, FIXTURE_IDS.startOccurrence, { dx: 7, dy: 8 }),
      ...rerouteConnectionEdits(source, FIXTURE_IDS.connectionOccurrence, [{ x: 9, y: 10 }]),
      ...createObjectDefinitionEdits(source, FIXTURE_IDS.group, {
        id: newDefinitionId,
        typeNum: 'OT_EVT'
      })
    ]
    const derived = applyAmlEdits(SAMPLE_AML, edits).text

    // Every comment in the source, byte for byte, in the same order.
    const comments = (text: string): string[] => text.match(/<!--[\s\S]*?-->/g) ?? []
    expect(comments(derived)).toEqual(comments(SAMPLE_AML))
    expect(comments(SAMPLE_AML)).toHaveLength(3)

    // The unknown element and its unknown attributes survive untouched, including the
    // namespace-prefixed attribute name and the attribute order.
    expect(derived).toContain('<VendorExtension vendor:flavour="internal" retained="yes"/>')

    // The DOCTYPE and its internal entity declarations survive untouched.
    expect(derived.slice(0, derived.indexOf(']>') + 2)).toBe(
      SAMPLE_AML.slice(0, SAMPLE_AML.indexOf(']>') + 2)
    )
    // The single-quoted attribute keeps its quote style.
    expect(derived).toContain("Creator='fixture'")
  })
})

describe('renaming an id (plan section 9.1)', () => {
  it('rewrites the declaration and every reference in one atomic batch', () => {
    const source = view()
    const renamed = 'ObjDef.ZZZZZZZZZZZ-p-L'
    const edits = renameSourceIdEdits(source, FIXTURE_IDS.activity, renamed)
    // declaration + ObjOcc/@ObjDef.IdRef + CxnDef/@ToObjDef.IdRef
    expect(edits).toHaveLength(3)

    const exported = exportDerivedAml({
      originalText: SAMPLE_AML,
      edits,
      removedIds: [FIXTURE_IDS.activity],
      addedIds: [renamed]
    })
    expect(exported.validation.ok).toBe(true)
    expect(exported.text).not.toContain(FIXTURE_IDS.activity)
    expect(exported.text.match(new RegExp(renamed, 'g'))).toHaveLength(3)
    expectUnrelatedContentPreserved(exported.text)
  })

  it('refuses to rename onto an id that already exists', () => {
    expect(() =>
      renameSourceIdEdits(view(), FIXTURE_IDS.activity, FIXTURE_IDS.startEvent)
    ).toThrowError(/already taken/)
  })

  it('refuses to rename a record that does not exist', () => {
    expect(() => renameSourceIdEdits(view(), 'ObjDef.nope-p-L', 'ObjDef.x-p-L')).toThrowError(
      ArisWriterError
    )
  })
})

describe('dangling references are detected before download (plan section 9.3/9.4)', () => {
  it('blocks an export where a declaration was renamed but a reference was not', () => {
    const source = view()
    const activity = requireElementById(source, FIXTURE_IDS.activity)
    // Deliberately partial: only the declaration is rewritten.
    const partial = [
      replaceEdit(
        activity.attributeByName.get('ObjDef.ID')!.valueSpan,
        'ObjDef.ZZZZZZZZZZZ-p-L',
        'partial rename'
      )
    ]
    const prepared = prepareDerivedAml({
      originalText: SAMPLE_AML,
      edits: partial,
      removedIds: [FIXTURE_IDS.activity],
      addedIds: ['ObjDef.ZZZZZZZZZZZ-p-L']
    })
    expect(prepared.validation.ok).toBe(false)
    expect(
      prepared.validation.checks.find((check) => check.check === 'definition-references-resolve')
        ?.passed
    ).toBe(false)
    expect(() =>
      exportDerivedAml({
        originalText: SAMPLE_AML,
        edits: partial,
        removedIds: [FIXTURE_IDS.activity],
        addedIds: ['ObjDef.ZZZZZZZZZZZ-p-L']
      })
    ).toThrowError(/failed validation/)
  })

  it('blocks an export whose new connection points at a record that was never created', () => {
    const source = view()
    const allocator = allocatorFor(source, 17)
    const connectionOccurrenceId = allocator.allocateOccurrenceId('CxnOcc', FIXTURE_IDS.model)
    const edits = createConnectionOccurrenceEdits(source, FIXTURE_IDS.activityOccurrence, {
      id: connectionOccurrenceId,
      connectionDefinitionId: FIXTURE_IDS.connectionDefinition,
      targetObjectOccurrenceId: 'ObjOcc.AAAAAAAAAAA-u-L-QQQQQQQQQQQ-x-L-33-c',
      points: [{ x: 1, y: 2 }]
    })
    expect(() =>
      exportDerivedAml({ originalText: SAMPLE_AML, edits, addedIds: [connectionOccurrenceId] })
    ).toThrowError(/failed validation/)
  })
})

describe('appendIdRefEdits', () => {
  it('appends to an existing list without touching the rest of the attribute', () => {
    const source = view()
    const occurrence = requireElementById(source, FIXTURE_IDS.startOccurrence)
    const derived = applyAmlEdits(
      SAMPLE_AML,
      appendIdRefEdits(source, occurrence, 'ToCxnOccs.IdRefs', 'CxnOcc.new')
    ).text
    expect(derived).toContain(`ToCxnOccs.IdRefs="${FIXTURE_IDS.connectionOccurrence}  CxnOcc.new"`)
  })

  it('creates the attribute when it is absent, after the last existing attribute', () => {
    const source = view()
    const occurrence = requireElementById(source, FIXTURE_IDS.activityOccurrence)
    const derived = applyAmlEdits(
      SAMPLE_AML,
      appendIdRefEdits(source, occurrence, 'ToCxnOccs.IdRefs', 'CxnOcc.new')
    ).text
    expect(derived).toContain('Zorder="3" ToCxnOccs.IdRefs="CxnOcc.new"')
  })

  it('rejects a non-list reference attribute', () => {
    const source = view()
    expect(() =>
      appendIdRefEdits(
        source,
        requireElementById(source, FIXTURE_IDS.startOccurrence),
        'ObjDef.IdRef',
        'x'
      )
    ).toThrowError(/not a list-reference attribute/)
  })
})

describe('exit gate (plan section 9.6)', () => {
  it('derived AML parses losslessly, retains unchanged spans, validates, and leaves the source alone', () => {
    const original = SAMPLE_AML
    const source = readWriterSourceView(original)
    const allocator = allocatorFor(source, 23)
    const newDefinitionId = allocator.allocateDefinitionId('ObjDef')

    const edits = [
      ...setLocalizedAttributeEdits(source, FIXTURE_IDS.activity, {
        type: 'AT_NAME',
        localeId: FIXTURE_LOCALE_AR,
        text: 'تسجيل الحيوان الأليف'
      }),
      ...moveOccurrenceEdits(source, FIXTURE_IDS.activityOccurrence, { x: 1100, y: 2500 }),
      ...createObjectDefinitionEdits(source, FIXTURE_IDS.group, {
        id: newDefinitionId,
        typeNum: 'OT_EVT',
        attributes: [{ type: 'AT_NAME', values: [{ localeId: FIXTURE_LOCALE_EN, text: 'Done' }] }]
      })
    ]

    const exported = exportDerivedAml({
      originalText: original,
      edits,
      addedIds: [newDefinitionId]
    })

    // 1. Derived AML parses through the lossless parser.
    expect(tokenizeXmlDocument(exported.text).rootElementName).toBe('AML')
    // 2. Unchanged spans are retained.
    expectUnrelatedContentPreserved(exported.text)
    // 3. Reference validation passes.
    expect(exported.validation.ok).toBe(true)
    expect(exported.validation.checks.every((check) => check.passed)).toBe(true)
    // 4. Original source is unchanged.
    expect(SAMPLE_AML).toBe(original)
    // 5. The export is labelled experimental until a live ARIS test passes.
    expect(exported.compatibility.experimental).toBe(true)
    expect(exported.compatibility.labelKey).toBe('aris.export.experimentalLabel')
  })

  it('rejects an edit batch whose spans collide instead of silently applying one of them', () => {
    const source = view()
    const activity = requireElementById(source, FIXTURE_IDS.activity)
    const idAttribute = activity.attributeByName.get('ObjDef.ID')!
    expect(() =>
      applyAmlEdits(SAMPLE_AML, [
        replaceEdit(idAttribute.valueSpan, 'ObjDef.AAAAAAAAAAA-p-L', 'first'),
        replaceEdit(
          makeSpan(idAttribute.valueSpan.start + 2, idAttribute.valueSpan.end + 2),
          'ObjDef.BBBBBBBBBBB-p-L',
          'second'
        )
      ])
    ).toThrowError(/overlap/)
  })
})
