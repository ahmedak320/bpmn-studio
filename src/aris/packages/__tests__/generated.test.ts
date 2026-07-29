import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../../workspace/adapters/hash'
import { ArisPackagePathError, arisPackagePaths } from '../layout'
import { ARIS_BASELINE_COMMAND_TYPE } from '../revisions'
import { ArisPackageStore } from '../store'
import { commitArisSourcePackage, planArisGeneratedPackage } from '../transaction'
import type { ArisGeneratedOriginKind } from '../manifest'
import { createArisAccountingDocument } from '../accounting'
import { createWorkspace, snapshotWorkspace } from './harness'
import type { MemoryWorkspaceAdapter } from '../../../workspace/adapters/memory'

const BASELINE_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML><Group Group.ID="Group.1"><Model Model.ID="Model.1" Model.Type="MT_EEPC"/></Group></AML>
`

const DESCRIPTION = 'Animals arrive, are triaged, then discharged.'

async function generatedPackage(options: {
  adapter: MemoryWorkspaceAdapter
  originKind: ArisGeneratedOriginKind
  retain: boolean
}) {
  const retainedBytes = new TextEncoder().encode(DESCRIPTION)
  const digest = options.retain
    ? await sha256Hex(retainedBytes)
    : await sha256Hex(new TextEncoder().encode(BASELINE_AML))
  return planArisGeneratedPackage({
    adapter: options.adapter,
    originKind: options.originKind,
    baselineAml: { text: BASELINE_AML, name: 'generated.xml' },
    ...(options.retain
      ? {
          generationSource: {
            bytes: retainedBytes,
            name: 'intake-brief.md',
            mediaType: 'text/markdown'
          }
        }
      : {}),
    generation: {
      provider: 'anthropic',
      model: 'claude-opus-5',
      requestSha256: 'b'.repeat(64)
    },
    accounting: createArisAccountingDocument({
      sourceSha256: digest,
      censusRecords: 2,
      entries: [
        {
          sourcePath: '/AML/Group[1]',
          kind: 'group',
          disposition: 'side-panel',
          targetIds: ['Group.1']
        },
        {
          sourcePath: '/AML/Group[1]/Model[1]',
          kind: 'model',
          disposition: 'editable-native',
          targetIds: ['Model.1']
        }
      ]
    }),
    models: [
      {
        modelId: 'Model.1',
        name: 'Intake',
        modelType: 'MT_EEPC',
        objectCount: 0,
        connectionCount: 0,
        sourcePath: '/AML/Group[1]/Model[1]'
      }
    ]
  })
}

describe('generated processes (plan §7.5)', () => {
  it('retains the generation source as an immutable artifact and records provenance', async () => {
    const adapter = createWorkspace()
    const plan = await generatedPackage({ adapter, originKind: 'description', retain: true })
    const outcome = await commitArisSourcePackage({
      adapter,
      plan,
      reviewedDigest: plan.reviewDigest
    })
    expect(outcome.status).toBe('committed')
    if (outcome.status !== 'committed') return

    const store = new ArisPackageStore(adapter)
    const manifest = await store.readManifest(plan.sourceSha256)
    expect(manifest.origin).toEqual({
      kind: 'description',
      generation: {
        provider: 'anthropic',
        model: 'claude-opus-5',
        requestSha256: 'b'.repeat(64),
        retainedSourcePath: 'original/intake-brief.md'
      }
    })
    expect(manifest.source).toMatchObject({
      name: 'intake-brief.md',
      mediaType: 'text/markdown',
      sha256: plan.sourceSha256
    })

    const paths = arisPackagePaths(plan.sourceSha256)
    const retained = await store.readMember(`${paths.originalDirectory}/intake-brief.md`)
    expect(new TextDecoder().decode(retained.bytes)).toBe(DESCRIPTION)
    expect(retained.hash).toBe(plan.sourceSha256)

    // The retained source is immutable, exactly like an imported original.
    await expect(
      store.writeWorkingMember(
        `${paths.originalDirectory}/intake-brief.md`,
        new TextEncoder().encode('rewritten')
      )
    ).rejects.toThrow(ArisPackagePathError)
    // No imported original exists for a generated package.
    expect(await store.hasMember(paths.originalSource)).toBe(false)
  })

  it('treats revision zero as the generated baseline', async () => {
    const adapter = createWorkspace()
    const plan = await generatedPackage({ adapter, originKind: 'spreadsheet', retain: true })
    await commitArisSourcePackage({ adapter, plan, reviewedDigest: plan.reviewDigest })

    const store = new ArisPackageStore(adapter)
    const state = await store.readRevisionState(plan.sourceSha256)
    expect(state.patches).toHaveLength(1)
    const baseline = state.patches[0]
    expect(baseline?.kind).toBe('baseline')
    expect(baseline?.ordinal).toBe(0)
    expect(baseline?.commands[0]?.type).toBe(ARIS_BASELINE_COMMAND_TYPE)
    expect(baseline?.commands[0]?.payload).toMatchObject({
      aml: BASELINE_AML,
      sha256: await sha256Hex(new TextEncoder().encode(BASELINE_AML)),
      originKind: 'spreadsheet'
    })

    // Later edits are applied through revisions, not by rewriting the baseline.
    const edit = await store.saveRevision(plan.sourceSha256, [
      { type: 'aris.object.add', payload: { id: 'ObjOcc.9' } }
    ])
    expect(edit.ordinal).toBe(1)
    const replay = await store.replayRevisions(plan.sourceSha256)
    expect(replay.commands.map((command) => command.type)).toEqual([
      ARIS_BASELINE_COMMAND_TYPE,
      'aris.object.add'
    ])
  })

  it('supports every generated origin kind, including without a retained source', async () => {
    for (const originKind of ['description', 'spreadsheet', 'pdf', 'image'] as const) {
      const adapter = createWorkspace(`workspace-${originKind}`)
      const plan = await generatedPackage({ adapter, originKind, retain: false })
      const outcome = await commitArisSourcePackage({
        adapter,
        plan,
        reviewedDigest: plan.reviewDigest
      })
      expect(outcome.status, originKind).toBe('committed')

      const store = new ArisPackageStore(adapter)
      const manifest = await store.readManifest(plan.sourceSha256)
      expect(manifest.origin.kind).toBe(originKind)
      expect(
        manifest.origin.kind === 'imported-aml'
          ? null
          : manifest.origin.generation?.retainedSourcePath
      ).toBeNull()
      expect(manifest.source.sha256).toBe(await sha256Hex(new TextEncoder().encode(BASELINE_AML)))
      expect((await store.verifyIntegrity(plan.sourceSha256)).problems).toEqual([])
    }
  })

  it('never stores the API key alongside the provenance', async () => {
    const adapter = createWorkspace()
    const plan = await generatedPackage({ adapter, originKind: 'pdf', retain: true })
    await commitArisSourcePackage({ adapter, plan, reviewedDigest: plan.reviewDigest })
    const store = new ArisPackageStore(adapter)
    expect(await store.scanForSecrets(plan.sourceSha256)).toEqual([])

    await expect(
      planArisGeneratedPackage({
        adapter: createWorkspace('rejecting'),
        originKind: 'pdf',
        baselineAml: { text: BASELINE_AML, name: 'generated.xml' },
        generation: {
          provider: 'anthropic',
          model: 'sk-ant-api03-QQQQQQQQQQQQQQQQQQQQ',
          requestSha256: 'b'.repeat(64)
        },
        accounting: createArisAccountingDocument({
          sourceSha256: await sha256Hex(new TextEncoder().encode(BASELINE_AML))
        })
      })
    ).rejects.toThrow()
  })

  it('requires canonical revision-zero AML', async () => {
    const adapter = createWorkspace()
    const before = await snapshotWorkspace(adapter)
    await expect(
      planArisGeneratedPackage({
        adapter,
        originKind: 'image',
        baselineAml: { text: '   ', name: 'generated.xml' },
        accounting: createArisAccountingDocument({ sourceSha256: 'c'.repeat(64) })
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'invalid-input' }))
    expect(await snapshotWorkspace(adapter)).toEqual(before)
  })
})
