import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildArisSplitPlan } from './amlSplit'
import { buildSemanticArisDocument, type ArisSourceIndex } from './semanticIndex'
import type { ArisXmlSourcePackage } from './sourcePackage'
import { tokenizeXmlDocument } from './xmlTokenizer'
import { buildFromSource } from '../model/buildFromSource'
import { isSupportedModelType } from '../canvas/vocabulary'

/**
 * Split the real AnimalWF export into one AML document per model and check every produced file
 * against the R5 accounting oracle (plan lane T2). The fixture is private customer data and is
 * never committed or reproduced here — only aggregate counts reach the assertions. This suite
 * runs only through `npm run test:aris:animalwf`; the module-load guard below throws loudly if the
 * fixture is absent, so it never skips or soft-passes.
 */
const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      '`npm run test:aris:animalwf` with the private reference export present locally.'
  )
}

const TEXT = readFileSync(ANIMAL_WF_PATH, 'utf8')

function parse(text: string): { index: ArisSourceIndex; errorCount: number } {
  const semantic = buildSemanticArisDocument(tokenizeXmlDocument(text))
  return {
    index: semantic.index,
    errorCount: semantic.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  }
}

const MONOLITH = parse(TEXT).index
const PLAN = buildArisSplitPlan({ text: TEXT, index: MONOLITH } as unknown as ArisXmlSourcePackage)

function occCount(index: ArisSourceIndex, modelId: string): number {
  return [...index.objectOccurrences.values()].filter((o) => o.parsed.modelId === modelId).length
}
function modelDisplayName(index: ArisSourceIndex, modelId: string): string | null {
  const attr = index.attributes.find(
    (a) =>
      a.parsed.ownerElementName === 'Model' &&
      a.parsed.ownerSourceId === modelId &&
      a.parsed.attributeType === 'AT_NAME'
  )
  const value = attr?.parsed.values.find((v) => v.locale === 'en') ?? attr?.parsed.values[0]
  return value?.text.trim() ?? null
}

describe('buildArisSplitPlan (AnimalWF export)', () => {
  it('produces exactly one file per model with no skips', () => {
    expect(PLAN.files).toHaveLength(8)
    expect(PLAN.skippedModelIds).toEqual([])
    expect(new Set(PLAN.files.map((f) => f.modelId)).size).toBe(8)
  })

  it('each file re-parses cleanly, contains exactly its model, and matches the monolith occ count', () => {
    let occTotal = 0
    for (const file of PLAN.files) {
      const reparsed = parse(file.text)
      expect(reparsed.errorCount).toBe(0)
      expect(reparsed.index.models.size).toBe(1)
      expect(reparsed.index.models.has(file.modelId)).toBe(true)
      const expected = occCount(MONOLITH, file.modelId)
      expect(occCount(reparsed.index, file.modelId)).toBe(expected)
      occTotal += expected
    }
    // R5 oracle: 494 object occurrences across the 8 models.
    expect(occTotal).toBe(494)
  })

  it('matches the R5 per-model oracle for the "Renew an Animal\'s profile" EPC (46 occ)', () => {
    const renewId = [...MONOLITH.models.keys()].find(
      (id) => modelDisplayName(MONOLITH, id) === "Renew an Animal's profile"
    )
    expect(renewId).toBeDefined()
    const file = PLAN.files.find((f) => f.modelId === renewId)!
    expect(occCount(parse(file.text).index, renewId!)).toBe(46)
  })

  it('every split model is a supported type and renders through buildFromSource', () => {
    for (const file of PLAN.files) {
      const reparsed = parse(file.text).index
      const model = reparsed.models.get(file.modelId)!
      expect(isSupportedModelType(model.parsed.modelType ?? '')).toBe(true)
      const document = buildFromSource(reparsed)
      expect(document.models.has(file.modelId)).toBe(true)
    }
  })

  it('keeps all 7 LinkedModels.IdRefs of the value-added-chain diagram', () => {
    const vacdId = [...MONOLITH.models.values()].find(
      (m) => m.parsed.modelType === 'MT_VAL_ADD_CHN_DGM'
    )!.parsed.modelId!
    const file = PLAN.files.find((f) => f.modelId === vacdId)!
    const linkedIds = [...MONOLITH.objectDefinitions.values()].flatMap(
      (d) => d.parsed.linkedModelIds
    )
    expect(linkedIds).toHaveLength(7)
    for (const linkedId of linkedIds) {
      expect(file.text).toContain(linkedId)
    }
  })

  it('files every EPC model under the "Animal Welfare" folder', () => {
    for (const file of PLAN.files) {
      const model = MONOLITH.models.get(file.modelId)!
      if (model.parsed.modelType === 'MT_EEPC') {
        expect(file.folderSegments).toEqual(['Animal Welfare'])
      }
    }
  })
})
