import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { scanArisChatGaps } from '../chat/gapScanner'
import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildArisEpcFindings } from '../shell/arisEpcFindings'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { toEpcGraph } from './adapter'
import { buildFlowGraphIndex } from './flowGraph'

const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      '`npm run test:aris:animalwf` with the private reference export present locally; it is ' +
      'never run as part of the default test suite and never skips.'
  )
}

let workingDocument: ArisWorkingDocument

beforeAll(() => {
  const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')
  workingDocument = buildFromSource(buildSemanticArisDocument(tokenizeXmlDocument(xml)).index)
}, 60_000)

function englishModelName(modelId: string): string {
  const model = workingDocument.models.get(modelId)
  if (!model) return ''
  return model.names.values.en ?? model.names.values['en-US'] ?? model.names.fallback ?? ''
}

describe('AnimalWF tuple-scoped DMT control flow', () => {
  it('classifies all 28 EEPC Function→Function predecessor edges as flow', () => {
    let predecessorEdgeCount = 0

    for (const model of workingDocument.models.values()) {
      if (model.type !== 'MT_EEPC') continue
      const graph = toEpcGraph({
        modelId: model.id,
        objectOccurrences: model.occurrences,
        objectDefinitionById: workingDocument.objectDefinitions,
        connectionOccurrences: model.connectionOccurrences,
        connectionDefinitionById: workingDocument.connectionDefinitions
      })
      const index = buildFlowGraphIndex(graph)
      const predecessorEdges = graph.edges.filter(
        (edge) => edge.connectionType === 'CT_IS_PREDEC_OF_1'
      )
      predecessorEdgeCount += predecessorEdges.length
      const flowEdgeIds = new Set(index.flowEdges.map((edge) => edge.id))
      expect(predecessorEdges.every((edge) => flowEdgeIds.has(edge.id))).toBe(true)
    }

    expect(predecessorEdgeCount).toBe(28)
  })

  it('has no orphan/alternation findings for register-owner or renew-profile', () => {
    const registerOwner = [...workingDocument.models.values()].find((model) =>
      /register or renew animal owner profile/i.test(englishModelName(model.id))
    )
    const renewProfile = [...workingDocument.models.values()].find((model) =>
      /renew an animal's profile/i.test(englishModelName(model.id))
    )
    expect(registerOwner).toBeDefined()
    expect(renewProfile).toBeDefined()

    const modelIds = new Set([registerOwner!.id, renewProfile!.id])
    const targeted = buildArisEpcFindings(workingDocument, modelIds).filter(
      (finding) =>
        finding.ruleId === 'epc.connectivity.orphanNode' || finding.ruleId === 'epc.alternation'
    )
    expect(targeted).toEqual([])
  })

  it('removes false orphan/alternation findings across all seven EEPCs while retaining genuine source-quality gaps', () => {
    const findings = buildArisEpcFindings(workingDocument)
    const falseFlowFindings = findings.filter(
      (finding) =>
        finding.ruleId === 'epc.connectivity.orphanNode' || finding.ruleId === 'epc.alternation'
    )
    const genuineSourceGaps = scanArisChatGaps(workingDocument).filter(
      (gap) =>
        gap.messageKey !== 'aris.epc.finding.orphanNode' &&
        gap.messageKey !== 'aris.epc.finding.alternationViolation'
    )

    expect(falseFlowFindings).toEqual([])
    expect(genuineSourceGaps.length).toBeGreaterThan(0)
  })

  it('keeps EPC structural validation scoped away from the VACD model', () => {
    const vacd = [...workingDocument.models.values()].find(
      (model) => model.type === 'MT_VAL_ADD_CHN_DGM'
    )
    expect(vacd).toBeDefined()
    expect(
      buildArisEpcFindings(workingDocument).some((finding) => finding.modelId === vacd!.id)
    ).toBe(false)
  })
})
