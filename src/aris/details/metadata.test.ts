import { describe, expect, it } from 'vitest'
import { buildTestDocument } from '../model/testFixture'
import { adaptWorkingDocument } from './seam'
import {
  DEFAULT_METADATA_LAYERS,
  defaultMetadataVisibility,
  extractModelAssignments,
  extractProcessCodes,
  summarizeMetadata,
  toggleLayerVisibility,
} from './metadata'
import { buildSatelliteDocument } from './testHelpers'

describe('metadata layers', () => {
  it('enables all required default layers', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const summary = summarizeMetadata(model.satellites, defaultMetadataVisibility())
    const categories = summary.layers.map((l) => l.category)
    for (const layer of DEFAULT_METADATA_LAYERS) {
      expect(categories).toContain(layer)
    }
  })

  it('keeps satellites as real selectable objects with full identity', () => {
    const document = buildSatelliteDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const satellite = [...model.satellites.values()].find((s) => s.type === 'OT_PERS')
    expect(satellite).toBeDefined()
    expect(satellite!.definitionId).toBe('od-owner-1')
    expect(satellite!.occurrenceId).toBe('occ-owner-1')
    expect(satellite!.type).toBe('OT_PERS')
    expect(satellite!.bounds).toBeDefined()
    expect(satellite!.relation.connectionDefinitionId).toBe('cd-owner-1')
    expect(satellite!.relation.connectionOccurrenceId).toBe('cxn-owner-1')
  })

  it('extracts process code and ARIS ID from a function definition', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const funcDef = [...details.objectDefinitions.values()].find((d) => d.type === 'OT_FUNC')
    expect(funcDef).toBeDefined()
    const { processCode, arisId } = extractProcessCodes(funcDef!)
    expect(arisId).toBe(funcDef!.id)
    expect(processCode === null || typeof processCode === 'string').toBe(true)
  })

  it('extracts model assignments from linked model IDs', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const funcDef = [...details.objectDefinitions.values()].find((d) => d.type === 'OT_FUNC')
    expect(funcDef).toBeDefined()
    const assignments = extractModelAssignments(funcDef!)
    expect(assignments).toEqual(funcDef!.linkedModelIds)
  })

  it('toggles layer visibility without mutating the original object', () => {
    const original = defaultMetadataVisibility()
    const next = toggleLayerVisibility(original, 'owner', false)
    expect(original.owner).toBe(true)
    expect(next.owner).toBe(false)
  })
})
