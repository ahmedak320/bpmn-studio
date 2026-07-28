import { describe, expect, it } from 'vitest'
import {
  ARIS_ID_FORMATS,
  ARIS_ID_KEY_ALPHABET,
  ARIS_ID_KEY_LENGTH,
  createArisIdAllocator,
  formatDefinitionId,
  formatOccurrenceId,
  modelIdBody,
  parseArisId
} from './ids'
import { FIXTURE_IDS } from './testFixture'

/** A small deterministic PRNG so allocation is reproducible under test. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

describe('ARIS source id format', () => {
  it('parses the definition-scope shape <Kind>.<key>-<typeChar>-L', () => {
    expect(parseArisId(FIXTURE_IDS.activity)).toMatchObject({
      kind: 'ObjDef',
      scope: 'definition',
      key: 'DDDDDDDDDDD',
      modelBody: null
    })
    expect(parseArisId(FIXTURE_IDS.model)).toMatchObject({ kind: 'Model', scope: 'definition' })
    expect(parseArisId(FIXTURE_IDS.connectionDefinition)).toMatchObject({ kind: 'CxnDef' })
  })

  it('parses the occurrence-scope shape, which embeds the owning model id body', () => {
    expect(parseArisId(FIXTURE_IDS.startOccurrence)).toMatchObject({
      kind: 'ObjOcc',
      scope: 'occurrence',
      modelBody: 'AAAAAAAAAAA-u-L',
      key: 'FFFFFFFFFFF'
    })
    expect(parseArisId(FIXTURE_IDS.connectionOccurrence)).toMatchObject({ kind: 'CxnOcc' })
    expect(parseArisId(FIXTURE_IDS.lane)).toMatchObject({ kind: 'Lane' })
    expect(parseArisId(FIXTURE_IDS.attachmentOccurrence)).toMatchObject({ kind: 'OLEOcc' })
  })

  it('assigns each record kind the type discriminator observed in the ARIS export', () => {
    expect(ARIS_ID_FORMATS.ObjDef).toEqual({ scope: 'definition', typeChar: 'p' })
    expect(ARIS_ID_FORMATS.CxnDef).toEqual({ scope: 'definition', typeChar: 'q' })
    expect(ARIS_ID_FORMATS.Model).toEqual({ scope: 'definition', typeChar: 'u' })
    expect(ARIS_ID_FORMATS.Group).toEqual({ scope: 'definition', typeChar: 'k' })
    expect(ARIS_ID_FORMATS.ObjOcc).toEqual({ scope: 'occurrence', typeChar: 'x', typeCode: 33 })
    expect(ARIS_ID_FORMATS.CxnOcc).toEqual({ scope: 'occurrence', typeChar: 'y', typeCode: 34 })
    expect(ARIS_ID_FORMATS.OLEOcc).toEqual({ scope: 'occurrence', typeChar: 'z', typeCode: 35 })
    expect(ARIS_ID_FORMATS.Lane).toEqual({ scope: 'occurrence', typeChar: 'E', typeCode: 40 })
  })

  it('rejects ids whose type discriminator does not match their prefix', () => {
    expect(parseArisId('ObjDef.DDDDDDDDDDD-q-L')).toBeNull()
    expect(parseArisId('ObjOcc.AAAAAAAAAAA-u-L-FFFFFFFFFFF-x-L-99-c')).toBeNull()
    expect(parseArisId('Nonsense.1234')).toBeNull()
    expect(parseArisId('Group.Root')).toBeNull()
  })

  it('round-trips through the formatters', () => {
    expect(formatDefinitionId('ObjDef', 'DDDDDDDDDDD')).toBe(FIXTURE_IDS.activity)
    expect(formatOccurrenceId('ObjOcc', FIXTURE_IDS.model, 'FFFFFFFFFFF')).toBe(
      FIXTURE_IDS.startOccurrence
    )
    expect(modelIdBody(FIXTURE_IDS.model)).toBe('AAAAAAAAAAA-u-L')
  })

  it('refuses to derive an occurrence id from something that is not a model id', () => {
    expect(() => modelIdBody(FIXTURE_IDS.activity)).toThrowError(/not a source-style ARIS model id/)
  })
})

describe('createArisIdAllocator', () => {
  const existing = [FIXTURE_IDS.activity, FIXTURE_IDS.model, FIXTURE_IDS.startOccurrence]

  it('allocates ids in the source format', () => {
    const allocator = createArisIdAllocator({ existingIds: existing, random: seededRandom(1) })
    const objectId = allocator.allocateDefinitionId('ObjDef')
    const parsed = parseArisId(objectId)
    expect(parsed).toMatchObject({ kind: 'ObjDef', scope: 'definition' })
    expect(parsed!.key).toHaveLength(ARIS_ID_KEY_LENGTH)
    expect([...parsed!.key].every((character) => ARIS_ID_KEY_ALPHABET.includes(character))).toBe(true)
  })

  it('allocates occurrence ids scoped to their model', () => {
    const allocator = createArisIdAllocator({ existingIds: existing, random: seededRandom(2) })
    const id = allocator.allocateOccurrenceId('CxnOcc', FIXTURE_IDS.model)
    expect(parseArisId(id)).toMatchObject({ kind: 'CxnOcc', modelBody: 'AAAAAAAAAAA-u-L' })
  })

  it('never hands out an id twice, even within one batch', () => {
    const allocator = createArisIdAllocator({ existingIds: existing, random: seededRandom(3) })
    const issued = new Set<string>()
    for (let index = 0; index < 500; index += 1) {
      const id = allocator.allocateDefinitionId('ObjDef')
      expect(issued.has(id)).toBe(false)
      issued.add(id)
    }
    expect(allocator.reservedIds()).toHaveLength(500)
  })

  it('never collides with an id already in the document', () => {
    // A random source pinned to the first alphabet character would always propose the same key,
    // so the allocator must detect the collision rather than emit a duplicate.
    const colliding = formatDefinitionId('ObjDef', '-'.repeat(ARIS_ID_KEY_LENGTH))
    const allocator = createArisIdAllocator({ existingIds: [colliding], random: () => 0 })
    expect(() => allocator.allocateDefinitionId('ObjDef')).toThrowError(/Could not allocate a free/)
    expect(allocator.has(colliding)).toBe(true)
  })

  it('treats Group.Root as permanently reserved', () => {
    const allocator = createArisIdAllocator({ existingIds: [], random: seededRandom(4) })
    expect(allocator.has('Group.Root')).toBe(true)
    expect(() => allocator.reserve('Group.Root')).toThrowError(/already taken/)
  })

  it('reserves externally chosen ids and rejects a second claim', () => {
    const allocator = createArisIdAllocator({ existingIds: existing, random: seededRandom(5) })
    expect(allocator.reserve(FIXTURE_IDS.freeText)).toBe(FIXTURE_IDS.freeText)
    expect(() => allocator.reserve(FIXTURE_IDS.freeText)).toThrowError(/already taken/)
    expect(() => allocator.reserve(FIXTURE_IDS.activity)).toThrowError(/already taken/)
  })
})
