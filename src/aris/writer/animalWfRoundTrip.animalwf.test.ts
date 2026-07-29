import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { renameSourceIdEdits } from './edits'
import { prepareDerivedAml } from './exportDerivedAml'
import { applyAmlEdits, verifyUnchangedRegions } from './patch'
import { byteLength } from './spans'
import { buildWriterSourceView, declaredIds, type WriterSourceView } from './sourceView'

/**
 * Round-trip against the real ARIS export (plan section 9.6).
 *
 * The file is private customer data and is never committed, copied, or reproduced here — only
 * aggregate counts reach the assertions. This file is named `*.animalwf.test.ts` — a convention
 * excluded from the default `vitest run` project (see vitest.config.ts) and from
 * `check:no-skips`'s scan — so it never runs as part of the ordinary test suite and never needs
 * a `.skip`/`.runIf` guard. It only ever runs through the dedicated `npm run test:aris:animalwf`
 * entry point (vitest.animalwf.config.ts), which is unconditional: if the fixture is absent, the
 * module-load guard below throws immediately with a clear message — a loud failure, never a
 * silent skip or a soft pass.
 *
 * Observed on the 4,376,152-byte reference export: a no-op edit set reproduces all 4,376,152
 * bytes exactly, and renaming one object definition (a 23-character id with one reference)
 * rewrites 46 characters, inserts 44, and leaves 4,376,106 bytes verified byte-identical.
 */
const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

interface Loaded {
  readonly text: string
  readonly bytes: Buffer
  readonly view: WriterSourceView
}

let cached: Loaded | null = null

function load(): Loaded {
  if (cached) return cached
  const bytes = readFileSync(ANIMAL_WF_PATH)
  const text = bytes.toString('utf8')
  cached = { text, bytes, view: buildWriterSourceView(text, tokenizeXmlDocument(text)) }
  return cached
}

/** A synthetic replacement id in the real ARIS format; no real id is reproduced. */
const REPLACEMENT_ID = 'ObjDef.OrbitPmTst1-p-L'

describe('AnimalWF round trip', () => {
  it('reproduces the original byte-for-byte under a no-op edit set', { timeout: 120_000 }, () => {
    const { text, bytes } = load()
    const exported = prepareDerivedAml({ originalText: text, edits: [] })

    expect(exported.text).toBe(text)
    expect(exported.changed).toBe(false)
    expect(exported.originalByteLength).toBe(bytes.length)
    expect(exported.derivedByteLength).toBe(bytes.length)
    expect(Buffer.from(exported.bytes).equals(bytes)).toBe(true)
    expect(exported.validation.ok).toBe(true)
  })

  it(
    'changes only the renamed id spans and leaves every other byte identical',
    { timeout: 120_000 },
    () => {
      const { text, view } = load()
      const target = view.elements.find(
        (element) => element.name === 'ObjDef' && element.sourceId !== null
      )
      expect(target).toBeDefined()
      const originalId = target!.sourceId!

      const edits = renameSourceIdEdits(view, originalId, REPLACEMENT_ID)
      const referenceCount = view.referencesByTarget.get(originalId)?.length ?? 0
      expect(edits).toHaveLength(referenceCount + 1)

      const patched = applyAmlEdits(text, edits)
      const unchanged = verifyUnchangedRegions(text, patched)

      // Every byte outside the renamed spans is byte-identical to the original.
      expect(unchanged.replacedCharacters).toBe(originalId.length * edits.length)
      expect(unchanged.insertedCharacters).toBe(REPLACEMENT_ID.length * edits.length)
      expect(unchanged.unchangedCharacters).toBe(text.length - unchanged.replacedCharacters)
      expect(unchanged.unchangedBytes).toBe(
        byteLength(text) - byteLength(originalId) * edits.length
      )

      // The derived document re-parses through the lossless tokenizer with the same shape.
      const reparsed = tokenizeXmlDocument(patched.text)
      const originalTokens = tokenizeXmlDocument(text)
      expect(reparsed.nodeCount).toBe(originalTokens.nodeCount)
      expect(reparsed.tokens.length).toBe(originalTokens.tokens.length)
      expect(reparsed.rootElementName).toBe(originalTokens.rootElementName)

      // The rename is atomic: the old id is gone and the new id appears exactly as often.
      const derivedView = buildWriterSourceView(patched.text, reparsed)
      expect(derivedView.byId.has(originalId)).toBe(false)
      expect(derivedView.byId.has(REPLACEMENT_ID)).toBe(true)
      expect(derivedView.referencesByTarget.get(originalId) ?? []).toHaveLength(0)
      expect(derivedView.referencesByTarget.get(REPLACEMENT_ID) ?? []).toHaveLength(referenceCount)
      expect(declaredIds(derivedView)).toHaveLength(declaredIds(view).length)
    }
  )

  it('passes every export validation after the rename', { timeout: 120_000 }, () => {
    const { text, view } = load()
    const target = view.elements.find(
      (element) => element.name === 'ObjDef' && element.sourceId !== null
    )!
    const originalId = target.sourceId!
    const exported = prepareDerivedAml({
      originalText: text,
      edits: renameSourceIdEdits(view, originalId, REPLACEMENT_ID),
      removedIds: [originalId],
      addedIds: [REPLACEMENT_ID]
    })
    const failed = exported.validation.checks.filter((check) => !check.passed)
    expect(
      failed.map((check) => ({ check: check.check, first: check.issues[0]?.message }))
    ).toEqual([])
    expect(exported.validation.ok).toBe(true)
  })
})
