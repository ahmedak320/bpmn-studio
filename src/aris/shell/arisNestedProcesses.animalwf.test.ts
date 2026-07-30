import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MemoryWorkspaceAdapter } from '../../workspace/adapters/memory'
import { buildLiteTreeFromEntries } from '../../workspace/liteTreeFromEntries'
import { buildProcessHierarchy } from '../../workspace/processHierarchy'
import { createArisLinkScanCache, scanArisWorkspaceLinks } from '../links/arisWorkspaceLinks'
import { buildArisSplitPlan } from '../source/amlSplit'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { executeArisSplitImport, prepareArisSplitImport } from './arisSplitImport'

/**
 * AnimalWF integration for the nested-process ownership tree.
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
      '`npm run test:aris:animalwf` with the private reference export present locally; it is ' +
      'never run as part of the default test suite and never skips.'
  )
}

const VACD_ID = 'Model.-64xG-AFMIgg-u-L'

async function loadMonolith(): Promise<Awaited<ReturnType<typeof createArisXmlSourcePackage>>> {
  const bytes = new Uint8Array(readFileSync(ANIMAL_WF_PATH))
  return createArisXmlSourcePackage({
    name: 'ARISAMLExport.xml',
    relPath: null,
    bytes
  })
}

async function importAnimalWf(
  adapter: MemoryWorkspaceAdapter
): Promise<ReturnType<typeof prepareArisSplitImport>> {
  const pkg = await loadMonolith()
  const splitPlan = buildArisSplitPlan(pkg)
  const importPlan = prepareArisSplitImport({
    pkg,
    baseFolderRel: '',
    takenPaths: new Set(),
    existingModelIds: new Set()
  })
  const outcome = await executeArisSplitImport(adapter, importPlan)
  expect(outcome.failed).toEqual([])
  expect(outcome.written).toHaveLength(splitPlan.files.length)
  expect(outcome.skipped).toEqual([])
  return importPlan
}

async function scanAndBuildHierarchy(adapter: MemoryWorkspaceAdapter) {
  const entries = await adapter.list()
  const tree = buildLiteTreeFromEntries(entries, 'workspace')
  const linkState = await scanArisWorkspaceLinks(adapter, entries, createArisLinkScanCache())
  const hierarchy = buildProcessHierarchy(tree, linkState.index, linkState.graph)
  return { entries, tree, linkState, hierarchy }
}

function expectVacdOwnsSevenEpcs(hierarchy: ReturnType<typeof buildProcessHierarchy>): void {
  const vacdRow = hierarchy.canonicalByProcessId.get(VACD_ID)
  expect(vacdRow).toBeDefined()
  expect(vacdRow!.ownedChildren).toHaveLength(7)

  for (const child of vacdRow!.ownedChildren) {
    expect(child.owned).toBe(true)
    expect(child.ownerParentProcessId).toBe(VACD_ID)
    expect(child.ownerCallCount).toBe(1)
    expect(child.ancestorRowKeys).toContain(vacdRow!.key)
  }
}

describe('AnimalWF nested process ownership', () => {
  it('imports the split monolith into one folder and the VACD owns all 7 EPCs', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    await importAnimalWf(adapter)

    const { hierarchy } = await scanAndBuildHierarchy(adapter)

    expect(hierarchy.root).not.toBeNull()
    const root = hierarchy.root!
    expect(root.kind).toBe('directory')
    if (root.kind !== 'directory') throw new Error('root must be a directory')
    expect(root.children).toHaveLength(1)

    const folder = root.children[0]!
    expect(folder.kind).toBe('directory')
    if (folder.kind !== 'directory') throw new Error('folder must be a directory')
    expect(folder.name).toBe('Animal Welfare')

    expectVacdOwnsSevenEpcs(hierarchy)
  })

  it('keeps VACD ownership and the same row key after moving an EPC into a new folder', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    await importAnimalWf(adapter)

    const before = await scanAndBuildHierarchy(adapter)
    const vacdRowBefore = before.hierarchy.canonicalByProcessId.get(VACD_ID)!
    const childBefore = vacdRowBefore.ownedChildren[0]!
    const keyBefore = childBefore.key
    const processId = childBefore.processIds[0]!
    const originalRelPath = childBefore.relPath

    await adapter.createFolder('moved')
    const movedRelPath = `moved/${originalRelPath.split('/').pop()!}`
    await adapter.move(originalRelPath, movedRelPath)

    const after = await scanAndBuildHierarchy(adapter)
    const vacdRowAfter = after.hierarchy.canonicalByProcessId.get(VACD_ID)!
    const childAfter = after.hierarchy.canonicalByProcessId.get(processId)!

    expect(childAfter.owned).toBe(true)
    expect(childAfter.ownerParentProcessId).toBe(VACD_ID)
    expect(childAfter.ownerCallCount).toBe(1)
    expect(childAfter.key).toBe(keyBefore)
    expect(childAfter.ancestorRowKeys).toContain(vacdRowAfter.key)
    expect(vacdRowAfter.ownedChildren).toHaveLength(7)
  })

  it('nests a synthetic VACD→EPC→EPC chain three levels deep', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    await importAnimalWf(adapter)

    const { hierarchy: baseHierarchy } = await scanAndBuildHierarchy(adapter)
    const vacdRow = baseHierarchy.canonicalByProcessId.get(VACD_ID)!
    const parentRow = vacdRow.ownedChildren[0]!
    const parentRelPath = parentRow.relPath
    const parentId = parentRow.processIds[0]!

    const parentSnapshot = await adapter.read(parentRelPath)
    const parentText = new TextDecoder().decode(parentSnapshot.bytes)

    const CHILD_ID = 'Model.SyntheticChild'
    const DEF_ID = 'ObjDef.SyntheticLink'
    const OCC_ID = 'ObjOcc.SyntheticLink'

    // Inject a synthetic linked-model def at Group level and an occurrence inside the parent model.
    const groupClose = parentText.lastIndexOf('</Group>')
    expect(groupClose).toBeGreaterThan(0)

    const modelOpenMatch = parentText.match(/<Model\b[^>]*Model\.ID="[^"]+"[^>]*>/u)
    expect(modelOpenMatch).not.toBeNull()
    const modelOpenIndex = modelOpenMatch!.index!
    const afterModelOpen = modelOpenIndex + modelOpenMatch![0].length
    const modelClose = parentText.indexOf('</Model>', afterModelOpen)
    expect(modelClose).toBeGreaterThan(afterModelOpen)

    const injectedDef = `<ObjDef ObjDef.ID="${DEF_ID}" LinkedModels.IdRefs="${CHILD_ID}"/>`
    const injectedOcc = `<ObjOcc ObjOcc.ID="${OCC_ID}" ObjDef.IdRef="${DEF_ID}"/>`

    const withDef = parentText.slice(0, groupClose) + injectedDef + parentText.slice(groupClose)
    // Recompute the model close after the group-level insertion, which is after the model.
    const modelCloseAfterDef = withDef.indexOf('</Model>', afterModelOpen)
    const modifiedParentText =
      withDef.slice(0, modelCloseAfterDef) + injectedOcc + withDef.slice(modelCloseAfterDef)

    // Build a minimal child EPC that can be scanned and linked.
    const childText = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML [<!ENTITY LocaleId.USen "1033"><!ENTITY LocaleId.AEar "14337">]>
<AML>
<Header-Info DatabaseName="Synthetic" UserName="tester" ArisExeVersion="10"/>
<Language LocaleId="&LocaleId.USen;" Code="en-US"/>
<Language LocaleId="&LocaleId.AEar;" Code="ar-AE"/>
<Group Group.ID="Group.Root">
  <Model Model.ID="${CHILD_ID}" Model.Type="MT_EEPC">
    <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;">Synthetic Child</AttrValue></AttrDef>
  </Model>
</Group>
</AML>`

    await adapter.writeAtomic(
      parentRelPath,
      new TextEncoder().encode(modifiedParentText),
      undefined
    )
    await adapter.writeAtomic(
      `${parentRelPath}-synthetic-child.aml`,
      new TextEncoder().encode(childText),
      undefined,
      { expectedMissing: true }
    )

    const { hierarchy } = await scanAndBuildHierarchy(adapter)

    const vacdAfter = hierarchy.canonicalByProcessId.get(VACD_ID)!
    expect(vacdAfter.ownedChildren).toHaveLength(7)

    const parentAfter = hierarchy.canonicalByProcessId.get(parentId)!
    expect(parentAfter.ownedChildren).toHaveLength(1)

    const syntheticChild = parentAfter.ownedChildren[0]!
    expect(syntheticChild.owned).toBe(true)
    expect(syntheticChild.ownerParentProcessId).toBe(parentId)
    expect(syntheticChild.ownerCallCount).toBe(1)
    expect(syntheticChild.ancestorRowKeys).toContain(parentAfter.key)
    expect(syntheticChild.ancestorRowKeys).toContain(vacdAfter.key)
  })
})
