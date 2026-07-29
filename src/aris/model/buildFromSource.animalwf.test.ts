import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { buildFromSource } from './buildFromSource'
import type { ArisFreeText } from './types'

/**
 * Regression test for the AnimalWF free-text silent-data-loss defect (plan §6.4, §10.3, §12.1):
 * the AnimalWF export carries 69 `FFTextDef` and 69 `FFTextOcc` records — the semantic index
 * counted all 69, but before the fix every one of them was silently dropped before reaching the
 * working model (`FFTextOcc` carries no id attribute in AML, `buildFreeText` fell through to
 * `id: ''`, and `buildFromSource`'s `if (!item.id || !item.modelId) continue` guard skipped
 * every one). Zero reached any model and zero rendered.
 *
 * This file is named `*.animalwf.test.ts` — a convention excluded from the default `vitest run`
 * project (see vitest.config.ts) and from `check:no-skips`'s scan — so it never runs as part of
 * the ordinary suite and never needs a `.skip`/`.skipIf` guard. It only ever runs through the
 * dedicated `npm run test:aris:animalwf` entry point (vitest.animalwf.config.ts), which is
 * unconditional: if the private reference export is absent, the module-load guard below throws
 * immediately with a clear message — a loud failure, never a silent skip.
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

function loadWorkingDocument() {
  const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')
  const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))
  expect(semantic.index.freeTextOccurrences).toHaveLength(69)
  return buildFromSource(semantic.index)
}

describe('AnimalWF free-text occurrences reach the working model', () => {
  it('carries all 69 source free-text occurrences into the working model, each addressable and stable', () => {
    const document = loadWorkingDocument()

    const allFreeText: ArisFreeText[] = []
    for (const model of document.models.values()) {
      allFreeText.push(...model.freeText)
    }

    // The headline assertion: zero silently dropped. Before the fix this was 0, not 69.
    expect(allFreeText).toHaveLength(69)

    // Every entity is genuinely addressable: a non-empty, unique id and a valid owning model.
    const ids = new Set<string>()
    for (const entry of allFreeText) {
      expect(entry.id).not.toBe('')
      expect(document.models.has(entry.modelId)).toBe(true)
      ids.add(entry.id)
    }
    expect(ids.size).toBe(69)
  })

  it('produces the exact same 69 free-text ids across two independent builds of the same source', () => {
    const first = loadWorkingDocument()
    const second = loadWorkingDocument()

    const idsOf = (doc: ReturnType<typeof loadWorkingDocument>): string[] => {
      const collected: string[] = []
      for (const model of doc.models.values()) {
        for (const entry of model.freeText) collected.push(entry.id)
      }
      return collected.sort()
    }

    expect(idsOf(first)).toEqual(idsOf(second))
  })
})
