/**
 * Loads a hand-authored fidelity expectation JSON for a given model key.
 *
 * Expectations live outside the repository under `../reference/AnimalWF/expected/`
 * so the orchestrator can version them independently from source code.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FidelityExpectationDoc } from './expectationTypes'

export function loadExpectation(modelKey: string): FidelityExpectationDoc {
  const path = resolve(process.cwd(), '../reference/AnimalWF/expected', `${modelKey}.expected.json`)
  const contents = readFileSync(path, 'utf-8')
  return JSON.parse(contents) as FidelityExpectationDoc
}
