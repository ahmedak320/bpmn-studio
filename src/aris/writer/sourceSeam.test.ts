import { describe, expect, it } from 'vitest'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { createArisIdAllocator, parseArisId } from './ids'
import { adaptSourceDocument, adaptSourceIndex } from './sourceSeam'
import { FIXTURE_IDS, FIXTURE_LOCALE_AR, FIXTURE_LOCALE_EN, SAMPLE_AML } from './testFixture'

describe('the semantic-index seam', () => {
  it('adapts a real SemanticArisDocument structurally, without importing its types', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(SAMPLE_AML))
    const facts = adaptSourceDocument(semantic)

    expect(facts.declaredIds).toEqual(expect.arrayContaining([
      FIXTURE_IDS.group,
      FIXTURE_IDS.model,
      FIXTURE_IDS.startEvent,
      FIXTURE_IDS.activity,
      FIXTURE_IDS.connectionDefinition,
      FIXTURE_IDS.startOccurrence,
      FIXTURE_IDS.connectionOccurrence,
      FIXTURE_IDS.lane,
      FIXTURE_IDS.freeText,
      FIXTURE_IDS.attachment
    ]))
    expect(facts.localeIds).toEqual([FIXTURE_LOCALE_AR, FIXTURE_LOCALE_EN])
    expect(facts.spansById.get(FIXTURE_IDS.model)?.start).toBeGreaterThan(0)
  })

  it('feeds the id allocator so a new id can never collide with an indexed record', () => {
    const semantic = buildSemanticArisDocument(tokenizeXmlDocument(SAMPLE_AML))
    const facts = adaptSourceDocument(semantic)
    const allocator = createArisIdAllocator({ existingIds: facts.declaredIds })
    facts.declaredIds.forEach((id) => expect(allocator.has(id)).toBe(true))
    const fresh = allocator.allocateDefinitionId('ObjDef')
    expect(parseArisId(fresh)).toMatchObject({ kind: 'ObjDef' })
    expect(facts.declaredIds).not.toContain(fresh)
  })

  it('tolerates an index that is missing members, so an upstream reshape cannot break it', () => {
    expect(adaptSourceIndex({})).toEqual({
      declaredIds: [],
      localeIds: [],
      spansById: new Map()
    })
    const partial = adaptSourceIndex({
      objectDefinitions: [
        { sourceId: FIXTURE_IDS.activity, span: { start: { offset: 5 }, end: { offset: 9 } } }
      ]
    })
    expect(partial.declaredIds).toEqual([FIXTURE_IDS.activity])
    expect(partial.spansById.get(FIXTURE_IDS.activity)).toEqual({ start: 5, end: 9 })
  })

  it('accepts both map-shaped and array-shaped record collections', () => {
    const asMap = adaptSourceIndex({
      models: new Map([[FIXTURE_IDS.model, { sourceId: FIXTURE_IDS.model }]])
    })
    const asArray = adaptSourceIndex({ models: [{ sourceId: FIXTURE_IDS.model }] })
    expect(asMap.declaredIds).toEqual([FIXTURE_IDS.model])
    expect(asArray.declaredIds).toEqual([FIXTURE_IDS.model])
  })

  it('ignores records without a source id', () => {
    expect(adaptSourceIndex({ models: [{ sourceId: null }] }).declaredIds).toEqual([])
  })
})
