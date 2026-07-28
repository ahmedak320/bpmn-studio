import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectReturnPathOutcomes } from './returnPath'
import { validateEpcGraph } from './validate'
import { buildGraphForModel, scanEntities, scanModels, scanObjectDefinitions, type ScannedObjectDefinition } from './realDataScan'

/**
 * Plan section 19.3 / 14.3 real-data verification.
 *
 * Guarded by a runtime `fs.existsSync` check (never `.skip`): when the private AnimalWF
 * fixture isn't present on disk (it is gitignored and must never be committed — see
 * `../reference/AnimalWF/ARISAMLExport.xml` under the repo root), this file still defines a
 * real, passing test that says so explicitly, rather than silently skipping.
 *
 * Topology is extracted with `realDataScan.ts`, a scanner private to this test file — it
 * does not depend on `src/aris/source`'s semantic index (mid-rewrite elsewhere).
 */

const FIXTURE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../reference/AnimalWF/ARISAMLExport.xml')
const FIXTURE_PRESENT = fs.existsSync(FIXTURE_PATH)

describe('AnimalWF real-data return-path verification (plan 19.3)', () => {
  if (!FIXTURE_PRESENT) {
    it('is skipped in this environment: the private AnimalWF fixture is not present on disk', () => {
      expect(FIXTURE_PRESENT).toBe(false)
    })
    return
  }

  const xml = fs.readFileSync(FIXTURE_PATH, 'utf-8')
  const entities = scanEntities(xml)
  const USEN = entities.get('LocaleId.USen') ?? '1033'
  const objectDefinitions = scanObjectDefinitions(xml, entities)
  const models = scanModels(xml).filter((model) => model.type === 'MT_EEPC')

  it('finds 8 models total (7 MT_EEPC + 1 MT_VAL_ADD_CHN_DGM), matching the plan 19.1 baseline', () => {
    expect(scanModels(xml)).toHaveLength(8)
    expect(models).toHaveLength(7)
  })

  /** English name of a model, discovered via its linking process-interface function/object. */
  function linkedModelName(modelId: string): string | null {
    for (const definition of objectDefinitions.values()) {
      if (definition.linkedModelIds.includes(modelId)) return definition.names[USEN] ?? null
    }
    return null
  }

  function findModelIdByLinkedNamePredicate(predicate: (englishName: string) => boolean): readonly string[] {
    const modelIds = new Set<string>()
    for (const definition of objectDefinitions.values()) {
      for (const modelId of definition.linkedModelIds) {
        const name = linkedModelName(modelId)
        if (name && predicate(name)) modelIds.add(modelId)
      }
    }
    return [...modelIds]
  }

  it('locates the four named processes from plan 19.3 by their linking process-interface name', () => {
    const operatorRegistration = findModelIdByLinkedNamePredicate((n) => /operator registration/i.test(n))
    const animalProfileClosure = findModelIdByLinkedNamePredicate((n) => /animal profile closure/i.test(n))
    const animalRegistration = findModelIdByLinkedNamePredicate((n) => /animal/i.test(n) && /regist/i.test(n) && !/operator/i.test(n) && !/owner/i.test(n))
    expect(operatorRegistration).toHaveLength(1)
    expect(animalProfileClosure).toHaveLength(1)
    expect(animalRegistration).toHaveLength(1)
  })

  interface ProcessCase {
    readonly label: string
    readonly modelIdPredicate: (englishName: string) => boolean
    readonly expectedStatus: 'explicit' | 'missing'
  }

  // Ground truth below was established by an independent Python/lxml analysis of the fixture
  // during research for this module (see the module report). Only "Owner Registration
  // Renewal & Closure" has an explicit back-edge (a real cycle through an XOR merge rule);
  // the other four/five have a named return/rework/reject outcome node with no outgoing (or
  // no cycle-forming) flow edge — a genuine gap in the source model, not a scanner bug.
  const cases: readonly ProcessCase[] = [
    { label: 'Operator Registration', modelIdPredicate: (n) => /operator registration/i.test(n), expectedStatus: 'missing' },
    { label: 'Animal Profile Closure', modelIdPredicate: (n) => /animal profile closure/i.test(n), expectedStatus: 'missing' },
    {
      label: 'Animal registration',
      modelIdPredicate: (n) => /animal/i.test(n) && /regist/i.test(n) && !/operator/i.test(n) && !/owner/i.test(n),
      expectedStatus: 'missing'
    },
    { label: 'Renewal — Animal profile', modelIdPredicate: (n) => /^renew an animal/i.test(n), expectedStatus: 'missing' },
    { label: 'Renewal — Owner profile (Register Animal Owner Profile)', modelIdPredicate: (n) => /register animal owner profile/i.test(n), expectedStatus: 'explicit' }
  ]

  for (const testCase of cases) {
    it(`"${testCase.label}": return-path detector reports status "${testCase.expectedStatus}"`, () => {
      const modelIds = findModelIdByLinkedNamePredicate(testCase.modelIdPredicate)
      expect(modelIds).toHaveLength(1)
      const model = models.find((m) => m.id === modelIds[0])
      expect(model).toBeDefined()
      if (!model) return

      const graph = buildGraphForModel(model, objectDefinitions as ReadonlyMap<string, ScannedObjectDefinition>)
      expect(graph.nodes.length).toBeGreaterThan(0)

      // The scanner/adapter never mutates the graph — validate + detect are safe to run
      // together and validateEpcGraph must not throw on real, messy source data.
      expect(() => validateEpcGraph(graph)).not.toThrow()

      const results = detectReturnPathOutcomes(graph)
      expect(results.length).toBeGreaterThan(0)

      const statuses = new Set(results.map((r) => r.status))
      expect(statuses.has(testCase.expectedStatus)).toBe(true)
    })
  }
})
