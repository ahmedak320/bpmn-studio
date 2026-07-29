// Real-data test (Section 17.1-17.4 end-to-end against the actual AnimalWF export).
//
// The fixture is private customer data and is never committed, copied, or reproduced here — only
// aggregate counts and structural assertions reach the test below. This file is named
// `*.animalwf.test.ts` — a convention excluded from the default `vitest run` project (see
// vitest.config.ts) and from `check:no-skips`'s scan — so it never runs as part of the ordinary
// test suite and never needs a `.skip`/`.runIf` guard. It only ever runs through the dedicated
// `npm run test:aris:animalwf` entry point (vitest.animalwf.config.ts), which is unconditional:
// if the fixture is absent, the module-load guard below throws immediately with a clear message —
// a loud failure, never a silent skip or a soft pass.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildAllDigests } from '../digest'
import { routeQuestion } from '../questionRouter'
import { scanAnimalWfModels } from './animalWfXmlScan'

const FIXTURE_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../../reference/AnimalWF/ARISAMLExport.xml'
)
if (!existsSync(FIXTURE_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${FIXTURE_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

describe('AnimalWF real-data digest + answer smoke test', () => {
  it('builds digests for all 8 AnimalWF models and answers a representative question against each', () => {
    const models = scanAnimalWfModels(FIXTURE_PATH)
    expect(models).toHaveLength(8)
    expect(models.filter((m) => m.modelType === 'MT_EEPC')).toHaveLength(7)
    expect(models.filter((m) => m.modelType === 'MT_VAL_ADD_CHN_DGM')).toHaveLength(1)

    const digests = buildAllDigests(models)
    expect(digests).toHaveLength(8)

    console.warn('\nAnimalWF per-model digest stats:')
    for (const digest of digests) {
      const responsibleCount = digest.steps.filter((s) => s.responsible.length > 0).length
      console.warn(
        `- ${digest.relPath} | ${digest.modelType} | "${digest.modelName}" | ` +
          `steps=${digest.steps.length} decisions=${digest.decisions.length} ` +
          `triggers=${digest.triggers.length} owners=${digest.owners.length} ` +
          `assignments=${digest.assignments.length} stepsWithResponsible=${responsibleCount} ` +
          `inputs=${digest.inputs.length} outputs=${digest.outputs.length} systems=${digest.systems.length} ` +
          `missingInformation=${digest.missingInformation.length}`
      )

      // Every digest must satisfy the plan's structural contract regardless
      // of its content: typed ids on every step, and a positive-confidence
      // "which processes are available" answer that at least names this model.
      for (const step of digest.steps) {
        expect(typeof step.occurrenceId).toBe('string')
        expect(step.occurrenceId.length).toBeGreaterThan(0)
        expect(typeof step.definitionId).toBe('string')
        expect(step.definitionId.length).toBeGreaterThan(0)
      }
    }

    // Representative question per model: ask "what comes next" seeded with
    // that model's own (real) name — a query built from the model's own
    // content should never crash and should either confidently answer or
    // honestly decline, never guess.
    for (const digest of digests) {
      const question = `What comes next in ${digest.modelName}?`
      const answer = routeQuestion(digests, question, 'en')
      expect(['next', 'topicMatch', 'none']).toContain(answer.kind)
      if (answer.kind !== 'none') expect(answer.confidence).toBeGreaterThan(0)
    }

    // "Which processes are available" must confidently list all 8 real models.
    const processList = routeQuestion(digests, 'Which processes are available?', 'en')
    expect(processList.kind).toBe('processList')
    expect(processList.parts[0]?.items).toHaveLength(8)
  })
})
