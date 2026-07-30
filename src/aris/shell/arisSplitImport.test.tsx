// @vitest-environment jsdom

/**
 * Split-import staging + review dialog tests (lane T7).
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryWorkspaceAdapter } from '../../workspace/adapters/memory'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import type { ArisXmlSourcePackage } from '../source/sourcePackage'
import { ArisSplitImportDialog } from './ArisSplitImportDialog'
import {
  executeArisSplitImport,
  prepareArisSplitImport,
  type ArisSplitImportPlan
} from './arisSplitImport'

function packageOf(text: string, name = 'TestSource'): ArisXmlSourcePackage {
  return {
    name,
    relPath: null,
    bytes: new TextEncoder().encode(text),
    text,
    sha256: '',
    document: tokenizeXmlDocument(text),
    index: buildSemanticArisDocument(tokenizeXmlDocument(text)).index,
    diagnostics: [],
    lossless: {} as ArisXmlSourcePackage['lossless']
  } as unknown as ArisXmlSourcePackage
}

/**
 * Two models with the same display name inside two groups that both sanitize to
 * "Process Folder", plus one root-level model. This exercises folder-segment
 * placement, name collision suffixing, and root-level files.
 */
const TWO_MODEL_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Test" UserName="tester" ArisExeVersion="10"/>
  <Group Group.ID="Group.Root">
    <Group Group.ID="Group.A">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Process Folder</AttrValue></AttrDef>
      <Model Model.ID="Model.1" Model.Type="MT_EEPC">
        <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Same Name</AttrValue></AttrDef>
      </Model>
    </Group>
    <Group Group.ID="Group.B">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Process Folder</AttrValue></AttrDef>
      <Model Model.ID="Model.2" Model.Type="MT_EEPC">
        <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Same Name</AttrValue></AttrDef>
      </Model>
    </Group>
    <Model Model.ID="Model.3" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Root Model</AttrValue></AttrDef>
    </Model>
  </Group>
</AML>
`

describe('prepareArisSplitImport', () => {
  it('places files at baseFolderRel + folderSegments', () => {
    const pkg = packageOf(TWO_MODEL_AML)
    const plan = prepareArisSplitImport({
      pkg,
      baseFolderRel: 'imports',
      takenPaths: new Set(),
      existingModelIds: new Set()
    })

    const target1 = plan.targets.find((t) => t.modelId === 'Model.1')!
    const target3 = plan.targets.find((t) => t.modelId === 'Model.3')!

    expect(target1.relPath).toBe('imports/Process Folder/same-name.aml')
    expect(target3.relPath).toBe('imports/root-model.aml')
  })

  it('suffixes the second colliding file with -2', () => {
    const pkg = packageOf(TWO_MODEL_AML)
    const plan = prepareArisSplitImport({
      pkg,
      baseFolderRel: 'imports',
      takenPaths: new Set(),
      existingModelIds: new Set()
    })

    const target1 = plan.targets.find((t) => t.modelId === 'Model.1')!
    const target2 = plan.targets.find((t) => t.modelId === 'Model.2')!

    expect(target1.relPath).toBe('imports/Process Folder/same-name.aml')
    expect(target2.relPath).toBe('imports/Process Folder/same-name-2.aml')
  })

  it('marks existing model ids as skip-existing-model and excludes them from writeCount', () => {
    const pkg = packageOf(TWO_MODEL_AML)
    const plan = prepareArisSplitImport({
      pkg,
      baseFolderRel: 'imports',
      takenPaths: new Set(),
      existingModelIds: new Set(['Model.1'])
    })

    const target1 = plan.targets.find((t) => t.modelId === 'Model.1')!
    const target2 = plan.targets.find((t) => t.modelId === 'Model.2')!

    expect(target1.status).toBe('skip-existing-model')
    expect(target2.status).toBe('write')
    expect(plan.writeCount).toBe(2)
    expect(plan.skipCount).toBe(1)
  })
})

describe('executeArisSplitImport', () => {
  afterEach(() => {
    cleanup()
  })

  it('writes exactly writeCount files against the memory adapter', async () => {
    const pkg = packageOf(TWO_MODEL_AML)
    const plan = prepareArisSplitImport({
      pkg,
      baseFolderRel: 'imports',
      takenPaths: new Set(),
      existingModelIds: new Set(['Model.1'])
    })
    const adapter = new MemoryWorkspaceAdapter()

    const outcome = await executeArisSplitImport(adapter, plan)

    expect(outcome.written).toHaveLength(plan.writeCount)
    expect(outcome.skipped).toHaveLength(plan.skipCount)
    expect(outcome.failed).toHaveLength(0)

    const entries = await adapter.list('imports', { maxDepth: 10 })
    expect(entries.filter((e) => e.kind === 'file')).toHaveLength(plan.writeCount)
  })

  it('retries with a new suffix when expectedMissing conflicts with an existing file', async () => {
    const pkg = packageOf(TWO_MODEL_AML)
    const plan = prepareArisSplitImport({
      pkg,
      baseFolderRel: 'imports',
      takenPaths: new Set(),
      existingModelIds: new Set()
    })
    const target = plan.targets.find((t) => t.modelId === 'Model.1')!
    const adapter = new MemoryWorkspaceAdapter({
      files: { [target.relPath]: '<AML></AML>' }
    })

    const outcome = await executeArisSplitImport(adapter, plan)

    expect(outcome.failed).toHaveLength(0)
    expect(outcome.written).toContain('imports/Process Folder/same-name-2.aml')
  })

  it('collects failures without throwing', async () => {
    const pkg = packageOf(TWO_MODEL_AML)
    const plan = prepareArisSplitImport({
      pkg,
      baseFolderRel: 'imports',
      takenPaths: new Set(),
      existingModelIds: new Set()
    })
    const adapter = new MemoryWorkspaceAdapter()
    adapter.setPermission('denied')

    const outcome = await executeArisSplitImport(adapter, plan)

    expect(outcome.written).toHaveLength(0)
    expect(outcome.failed).toHaveLength(plan.writeCount)
    expect(outcome.failed[0]!.message).toContain('permission')
  })
})

describe('ArisSplitImportDialog', () => {
  afterEach(() => {
    cleanup()
  })

  function makePlan(): ArisSplitImportPlan {
    return {
      sourceName: 'TestSource',
      targets: [
        {
          modelId: 'Model.1',
          modelName: 'Write Model',
          relPath: 'imports/write-model.aml',
          bytes: new Uint8Array(0),
          status: 'write'
        },
        {
          modelId: 'Model.2',
          modelName: 'Skip Model',
          relPath: 'imports/skip-model.aml',
          bytes: new Uint8Array(0),
          status: 'skip-existing-model'
        }
      ],
      writeCount: 1,
      skipCount: 1
    }
  }

  it('renders rows and fires confirm/cancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ArisSplitImportDialog
        open
        plan={makePlan()}
        busy={false}
        dir="ltr"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Import into the workspace' })).not.toBeNull()
    expect(screen.getByText('imports/write-model.aml')).not.toBeNull()
    expect(screen.getByText('imports/skip-model.aml')).not.toBeNull()
    expect(
      screen.getByText('Skipped — model Model.2 already exists in this workspace')
    ).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Import 1 file(s)' }))
    expect(onConfirm).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables the confirm button while busy', () => {
    render(
      <ArisSplitImportDialog
        open
        plan={makePlan()}
        busy
        dir="ltr"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Import 1 file(s)' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('returns null when closed or plan is missing', () => {
    const { rerender } = render(
      <ArisSplitImportDialog
        open={false}
        plan={makePlan()}
        busy={false}
        dir="ltr"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(
      <ArisSplitImportDialog
        open
        plan={null}
        busy={false}
        dir="ltr"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
