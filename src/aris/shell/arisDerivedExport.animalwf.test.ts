import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildFromSource } from '../model/buildFromSource'
import { applyCommand, type ArisCommandKind, type ArisEditCommand } from '../model/commands'
import type {
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisWorkingDocument
} from '../model/types'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import {
  applyAmlEdits,
  buildWriterSourceView,
  byteLength,
  declaredIds,
  parseArisId,
  readWriterSourceView,
  verifyUnchangedRegions,
  type WriterSourceView
} from '../writer'
import { buildArisDerivedEdits, exportArisDerivedAml } from './arisDerivedExport'

/**
 * Whole-pipeline round trip against the real ARIS export (plan §9.4/§9.6).
 *
 * The file is private customer data and is never committed, copied, or reproduced here — only
 * aggregate counts and synthetic replacement values reach the assertions. This file is named
 * `*.animalwf.test.ts`, a convention excluded from the default `vitest run` project (see
 * vitest.config.ts) and from `check:no-skips`'s scan, so it never runs as part of the ordinary
 * suite and never needs a `.skip`/`.runIf` guard. It runs only through
 * `npm run test:aris:animalwf`, which is unconditional: if the fixture is absent the module-load
 * guard below throws immediately — a loud failure, never a silent skip or a soft pass.
 *
 * Unlike `src/aris/writer/animalWfRoundTrip.animalwf.test.ts`, which drives the writer directly,
 * this suite starts from the WORKING MODEL: it renames, creates and deletes through
 * `applyCommand`, then asks the shell's derived export to recover byte-addressed edits from the
 * difference between the two documents.
 *
 * Observed on the 4,376,152-byte reference export (4,376,152 characters, so the file is ASCII
 * apart from the escaped runs it already carries): a rename, plus an Arabic value added beside
 * it, plus a created object definition and occurrence, plus one deleted occurrence produce
 * 5 edits over 6 verbatim regions — 818 characters replaced, 688 inserted, and all 4,375,334
 * remaining characters verified byte-identical. The derived document is 4,376,028 bytes
 * (4,376,022 characters; the six-byte difference is the added Arabic value), a delta of
 * -124 bytes, and it passes all nine §9.3 checks.
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
  readonly document: ArisWorkingDocument
}

let cached: Loaded | null = null

async function load(): Promise<Loaded> {
  if (cached) return cached
  const bytes = readFileSync(ANIMAL_WF_PATH)
  const text = bytes.toString('utf8')
  const sourcePackage = await createArisXmlSourcePackage({
    name: 'ARISAMLExport.xml',
    relPath: null,
    bytes: new Uint8Array(bytes)
  })
  cached = {
    text,
    bytes,
    view: readWriterSourceView(text),
    document: buildFromSource(sourcePackage.index)
  }
  return cached
}

let sequence = 0

function run(
  document: ArisWorkingDocument,
  kind: ArisCommandKind,
  after: unknown
): ArisWorkingDocument {
  sequence += 1
  const command: ArisEditCommand = {
    commandId: `animalwf.${sequence}`,
    baseRevision: document.revision,
    kind,
    affectedSourceIds: [],
    before: null,
    after,
    origin: 'user'
  }
  return applyCommand(document, command)
}

/** Synthetic replacement values in the ARIS format; no real content is reproduced. */
const RENAMED = 'OrbitPM derived-export probe'
const ADDED_ARABIC = 'اختبار'
const CREATED_NAME = 'OrbitPM created function'

interface Targets {
  readonly definitionId: string
  readonly renameLocaleId: string
  readonly secondLocaleId: string
  readonly modelId: string
  readonly deletableOccurrenceId: string
}

/**
 * Pick edit targets from the export itself.
 *
 * Nothing is hard-coded: the suite asks the document which definition carries a localized name,
 * which locales it declares, and which occurrence can be removed without leaving the working
 * document referentially open — so it keeps working if the reference export is refreshed.
 */
function chooseTargets(document: ArisWorkingDocument, view: WriterSourceView): Targets {
  const locales = view.localeIds
  expect(locales.length).toBeGreaterThanOrEqual(2)

  let definitionId: string | null = null
  let renameLocaleId: string | null = null
  for (const [id, definition] of document.objectDefinitions) {
    const entries = Object.keys(definition.names.values)
    const usable = entries.find((locale) => locales.includes(locale))
    if (usable === undefined) continue
    if (!view.byId.has(id)) continue
    definitionId = id
    renameLocaleId = usable
    break
  }
  expect(definitionId).not.toBeNull()
  const secondLocaleId = locales.find((locale) => locale !== renameLocaleId)!

  let modelId: string | null = null
  let deletableOccurrenceId: string | null = null
  for (const [id, model] of document.models) {
    if (model.occurrences.length === 0) continue
    const attached = new Set(
      model.connectionOccurrences.flatMap((connection) => [
        connection.sourceOccurrenceId,
        connection.targetOccurrenceId
      ])
    )
    const free = model.occurrences.find((occurrence) => !attached.has(occurrence.id))
    if (!free) continue
    if (!view.byId.has(id)) continue
    modelId = id
    deletableOccurrenceId = free.id
    break
  }
  expect(modelId).not.toBeNull()

  return {
    definitionId: definitionId!,
    renameLocaleId: renameLocaleId!,
    secondLocaleId,
    modelId: modelId!,
    deletableOccurrenceId: deletableOccurrenceId!
  }
}

/** Rename + add a locale + create a definition and occurrence + delete an occurrence. */
function edited(document: ArisWorkingDocument, targets: Targets): ArisWorkingDocument {
  let live = run(document, 'setLocalizedName', {
    ownerKind: 'objectDefinition',
    ownerId: targets.definitionId,
    localeId: targets.renameLocaleId,
    value: RENAMED
  })
  live = run(live, 'setLocalizedName', {
    ownerKind: 'objectDefinition',
    ownerId: targets.definitionId,
    localeId: targets.secondLocaleId,
    value: ADDED_ARABIC
  })
  const created: ArisObjectDefinition = {
    id: 'ObjDef.orbitpm-probe',
    type: 'OT_FUNC',
    defaultSymbol: 'ST_FUNC',
    names: { values: { [targets.renameLocaleId]: CREATED_NAME }, fallback: CREATED_NAME },
    attributes: [],
    linkedModelIds: [],
    rawAttributes: {}
  }
  live = run(live, 'createDefinition', created)
  const occurrence: ArisObjectOccurrence = {
    id: 'ObjOcc.orbitpm-probe',
    definitionId: created.id,
    modelId: targets.modelId,
    symbol: 'ST_FUNC',
    bounds: { x: 100, y: 100, width: 554, height: 151 },
    style: {
      symbol: 'ST_FUNC',
      fillColor: null,
      strokeColor: null,
      strokeWidth: null,
      lineStyle: null,
      fontStyleSheetId: null,
      zOrder: null
    },
    attributeOccurrences: [],
    rawAttributes: {}
  }
  live = run(live, 'createOccurrence', occurrence)
  return run(live, 'deleteOccurrence', { occurrenceId: targets.deletableOccurrenceId })
}

describe('AnimalWF derived export round trip', () => {
  it(
    'maps a rename, a create and a delete to byte-addressed edits',
    { timeout: 240_000 },
    async () => {
      const { text, view, document } = await load()
      const targets = chooseTargets(document, view)
      const live = edited(document, targets)

      const set = buildArisDerivedEdits(view, document, live)
      expect(set.unmapped).toEqual([])
      expect(set.edits.length).toBeGreaterThanOrEqual(4)
      expect(set.addedIds).toHaveLength(2)
      set.addedIds.forEach((id) => expect(parseArisId(id)).not.toBeNull())
      expect(set.removedIds).toContain(targets.deletableOccurrenceId)

      // Every byte outside the addressed spans is copied verbatim from the original.
      const patched = applyAmlEdits(text, set.edits)
      const unchanged = verifyUnchangedRegions(text, patched)
      expect(unchanged.unchangedCharacters).toBe(text.length - unchanged.replacedCharacters)
      expect(unchanged.regions).toBeGreaterThan(0)

      // The derived document re-parses through the lossless tokenizer.
      const derived = buildWriterSourceView(patched.text, tokenizeXmlDocument(patched.text))
      expect(derived.rootPath).toBe(view.rootPath)
      expect(derived.byId.has(targets.deletableOccurrenceId)).toBe(false)
      set.addedIds.forEach((id) => expect(derived.byId.has(id)).toBe(true))
      expect(declaredIds(derived)).toHaveLength(
        declaredIds(view).length - set.removedIds.length + set.addedIds.length
      )
    }
  )

  it(
    'passes all nine export validations and reports the byte delta',
    { timeout: 240_000 },
    async () => {
      const { text, bytes, view, document } = await load()
      const targets = chooseTargets(document, view)
      const live = edited(document, targets)

      // `exportArisDerivedAml` throws unless every §9.3 check passed, so reaching the assertions
      // below is itself the proof that all nine passed; they are re-stated for a readable failure.
      const exported = exportArisDerivedAml({ originalText: text, original: document, live })
      expect(exported.result.validation.checks.map((check) => check.passed)).toEqual(
        new Array(9).fill(true)
      )
      expect(exported.result.validation.issues).toEqual([])
      expect(exported.unmapped).toEqual([])

      // The original is untouched and the delta is exactly the bytes the edits moved.
      expect(exported.result.originalByteLength).toBe(bytes.length)
      expect(byteLength(text)).toBe(bytes.length)
      expect(exported.result.derivedByteLength).toBe(byteLength(exported.result.text))
      expect(exported.result.changed).toBe(true)
      expect(exported.result.text).toContain(`TextValue="${RENAMED}"`)
      expect(exported.result.text).toContain(`TextValue="${CREATED_NAME}"`)

      const delta = exported.result.derivedByteLength - exported.result.originalByteLength
      expect(delta).not.toBe(0)
      expect(exported.result.derivedByteLength).toBe(bytes.length + delta)
    }
  )
})
