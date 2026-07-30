import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildProcessHierarchy } from '@/workspace/processHierarchy'
import type { LiteTreeNode } from '@/fs/fsAccess'

import { scanArisModelSource } from './arisModelScan'

/**
 * AnimalWF integration for the ARIS model/assignment scanner.
 *
 * The fixture is private customer data and is never committed, copied, or
 * reproduced here — only aggregate counts and the R4 model identifiers reach
 * the assertions. This file is named `*.animalwf.test.ts` so it is excluded
 * from the default `vitest run` project and from `check:no-skips`, and it only
 * runs through the dedicated `npm run test:aris:animalwf` entry point. If the
 * fixture is absent, the module-load guard below throws immediately — a loud
 * failure, never a silent skip or a soft pass.
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

function readAnimalWfExport(): string {
  return readFileSync(ANIMAL_WF_PATH, 'utf8')
}

const VACD_ID = 'Model.-64xG-AFMIgg-u-L'
const R4_EPC_IDS = [
  'Model.-1rUudxIp-wP-u-L',
  'Model.3xqe8yXO9Z7-u-L',
  'Model.3i-a2j4HRS3-u-L',
  'Model.-778f33baj6c-u-L'
]

describe('AnimalWF ARIS model scan', () => {
  it('finds 8 models including the R4 identifiers', () => {
    const xml = readAnimalWfExport()
    const result = scanArisModelSource(xml)

    expect(result.models).toHaveLength(8)
    const ids = new Set(result.models.map((m) => m.modelId))
    expect(ids.has(VACD_ID)).toBe(true)
    for (const id of R4_EPC_IDS) {
      expect(ids.has(id)).toBe(true)
    }

    const vacd = result.models.find((m) => m.modelId === VACD_ID)!
    expect(vacd.modelType).toBe('MT_VAL_ADD_CHN_DGM')
  })

  it('finds exactly 7 VACD-to-EPC assignments with count 1 each', () => {
    const xml = readAnimalWfExport()
    const result = scanArisModelSource(xml)

    const assignments = result.assignments.filter((a) => a.parentModelId === VACD_ID)
    expect(assignments).toHaveLength(7)

    for (const assignment of assignments) {
      expect(assignment.count).toBe(1)
      expect(assignment.occurrenceIds).toHaveLength(1)
    }

    const childIds = new Set(assignments.map((a) => a.childModelId))
    expect(childIds.size).toBe(7)
    // All four named R4 EPCs are among the owned children.
    for (const id of R4_EPC_IDS) {
      expect(childIds.has(id)).toBe(true)
    }
  })

  it('feeds buildProcessHierarchy so the VACD row owns 7 children', () => {
    const xml = readAnimalWfExport()
    const scan = scanArisModelSource(xml)

    // Build a deterministic ProcessIndex with one synthetic file per model.
    const processIndex = new Map()
    const rootChildren: LiteTreeNode[] = []
    for (const model of scan.models) {
      const relPath = `${model.modelId}.aml`
      processIndex.set(model.modelId, {
        processId: model.modelId,
        processName: model.name ?? undefined,
        relPath
      })
      rootChildren.push({
        name: relPath,
        relPath,
        type: 'file'
      })
    }

    const root: LiteTreeNode = {
      name: 'root',
      relPath: '',
      type: 'directory',
      children: rootChildren
    }

    const graph = {
      links: scan.assignments.map((a) => ({
        key: JSON.stringify([a.parentModelId, a.childModelId]),
        parentProcessId: a.parentModelId,
        childProcessId: a.childModelId,
        parentRelPath: `${a.parentModelId}.aml`,
        childRelPath: `${a.childModelId}.aml`,
        callActivityIds: [...a.occurrenceIds],
        count: a.count
      })),
      ambiguousProcessIds: new Set<string>()
    }

    const hierarchy = buildProcessHierarchy(root, processIndex, graph)

    const vacdRow = hierarchy.canonicalByProcessId.get(VACD_ID)
    expect(vacdRow).toBeDefined()
    expect(vacdRow!.ownedChildren).toHaveLength(7)
  })
})
