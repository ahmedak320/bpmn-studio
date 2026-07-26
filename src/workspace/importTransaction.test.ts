import { describe, expect, it, vi } from 'vitest'

import {
  createArisConversionReport,
  type AmlConversion,
  type ArisConversionReportEntry
} from '../library/apcImport'
import { readLibraryZip } from '../library/zipImport'
import { buildLibraryZip } from '../library/zipExport'
import { createValidationSummary, validationIssue } from '../validation'
import { MemoryWorkspaceAdapter } from './adapters'
import {
  confirmWorkspaceImportPlan,
  executeConfirmedWorkspaceImport,
  prepareWorkspaceImportPlan,
  type BpmnImportPreparer,
  type WorkspaceImportHistory,
  type WorkspaceImportSource
} from './importTransaction'

const decoder = new TextDecoder()

function documentXml(processId: string, options: { ref?: string; marker?: string } = {}): string {
  return `<definitions><process id="${processId}">${options.ref ? `<call ref="${options.ref}"/>` : ''}${
    options.marker ?? ''
  }</process></definitions>`
}

function processIds(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?process\s+id="([^"]+)"/g)].map((match) => match[1]).sort()
}

function sniffedBpmnXml(processId: string): string {
  return `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="${processId}"/></bpmn:definitions>`
}

const fakePreparer: BpmnImportPreparer = {
  async inspect(xml) {
    if (xml.includes('INSPECT_FAIL')) throw new Error('secure parse failed')
    return { processIds: processIds(xml) }
  },
  async prepare(xml, options) {
    if (xml.includes('PREPARE_FAIL')) throw new Error('authoritative validation failed')
    const references = [...xml.matchAll(/<call\s+ref="([^"]+)"/g)].map((match) => match[1])
    const missing = references.find((reference) => !options.knownProcessIds.has(reference))
    if (missing) throw new Error(`missing linked process ${missing}`)
    const warning = xml.includes('WARN')
      ? [
          validationIssue({
            code: 'test.warning',
            severity: 'warning',
            source: 'semantic',
            message: 'Review this test warning.'
          })
        ]
      : []
    return {
      xml: xml.replace('AUTO_LAYOUT', 'AUTO_LAYOUTED'),
      processIds: processIds(xml),
      autoLayouted: xml.includes('AUTO_LAYOUT'),
      validation: createValidationSummary(warning)
    }
  }
}

function doc(
  id: string,
  name: string,
  xml: string,
  relPath?: string
): Extract<WorkspaceImportSource, { kind: 'document' }> {
  return { kind: 'document', id, name, text: xml, ...(relPath ? { relPath } : {}) }
}

function reportEntry(
  reason: ArisConversionReportEntry['reason'],
  sourceObjectId: string
): ArisConversionReportEntry {
  return { reason, sourceObjectId }
}

function amlConversion(): AmlConversion {
  return {
    files: [
      {
        name: 'AML Process',
        nameEn: 'AML Process',
        nameAr: 'عملية AML',
        xml: documentXml('Process_Aml'),
        processId: 'Process_Aml',
        kind: 'epc'
      }
    ],
    folderName: 'AML Landscape',
    report: createArisConversionReport({
      databaseName: 'DMT',
      objectDefinitions: 5,
      models: 1,
      outputFiles: 1,
      entries: {
        converted: [reportEntry('mapped-flow-node', 'converted')],
        downgraded: [reportEntry('unknown-object-type-mapped-as-task', 'downgraded')],
        ignored: [reportEntry('satellite-not-mapped', 'ignored')],
        ambiguous: [reportEntry('duplicate-object-occurrence-first-used', 'ambiguous')],
        unmapped: [reportEntry('missing-object-definition', 'unmapped')]
      }
    })
  }
}

async function planFor(
  adapter: MemoryWorkspaceAdapter,
  sources: readonly WorkspaceImportSource[],
  options: {
    amlConverter?: () => Promise<AmlConversion>
    targetFolder?: string
  } = {}
) {
  return prepareWorkspaceImportPlan({
    adapter,
    sources,
    targetFolder: options.targetFolder,
    bpmnPreparer: fakePreparer,
    validationAdapters: [],
    amlConverter: options.amlConverter,
    now: () => new Date('2026-07-26T12:00:00.000Z')
  })
}

describe('general workspace import planning', () => {
  it('parses every document/library boundary and retains full ARIS review evidence before writes', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:mixed' })
    const libraryResult = readLibraryZip(
      buildLibraryZip(
        [
          {
            relPath: 'nested/library.bpmn',
            xml: documentXml('Process_Library')
          }
        ],
        [{ relPath: 'notes.txt', content: 'not BPMN' }]
      )
    )
    const plan = await planFor(
      adapter,
      [
        doc('raw', 'raw.xml', sniffedBpmnXml('Process_Raw')),
        doc('unsupported', 'notes.xml', '<notes/>'),
        doc('aml', 'landscape.aml', '<AML/>'),
        {
          kind: 'library',
          id: 'library',
          name: 'library.zip',
          result: libraryResult
        }
      ],
      {
        targetFolder: 'reviewed',
        amlConverter: async () => amlConversion()
      }
    )

    expect(plan.status).toBe('ready')
    expect(plan.artifacts.map(({ sourceKind }) => sourceKind).sort()).toEqual([
      'aml',
      'bpmn',
      'library'
    ])
    expect(plan.artifacts.map(({ destinationPath }) => destinationPath).sort()).toEqual([
      'reviewed/aml-process.bpmn',
      'reviewed/nested/library.bpmn',
      'reviewed/raw.bpmn'
    ])
    expect(plan.skipped.map(({ reason }) => reason).sort()).toEqual([
      'library-not-bpmn',
      'unsupported-content'
    ])
    expect(plan.repairs.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['aml-converted', 'destination-normalized'])
    )
    expect(plan.warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['aml-downgraded', 'aml-ignored', 'aml-ambiguous', 'aml-unmapped'])
    )
    expect(plan.arisReports).toHaveLength(1)
    expect(plan.arisReports[0].report.summary).toEqual({
      converted: 1,
      downgraded: 1,
      ignored: 1,
      ambiguous: 1,
      unmapped: 1
    })
    expect(plan.arisReports[0].download.fileName).toBe('landscape-conversion-report.json')
    expect(JSON.parse(plan.arisReports[0].download.text).summary).toEqual(
      plan.arisReports[0].report.summary
    )
    expect(plan.summary.arisReports).toBe(1)
    expect(await adapter.list()).toEqual([])
  })

  it('uses all parsed process ids for forward links, then removes callers of rejected artifacts', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    const ready = await planFor(adapter, [
      doc('caller', 'caller.bpmn', documentXml('Process_Caller', { ref: 'Process_Callee' })),
      doc('callee', 'callee.bpmn', documentXml('Process_Callee'))
    ])
    expect(ready.artifacts).toHaveLength(2)

    const blocked = await planFor(adapter, [
      doc('caller', 'caller.bpmn', documentXml('Process_Caller', { ref: 'Process_Callee' })),
      doc('callee', 'callee.bpmn', documentXml('Process_Callee', { marker: 'PREPARE_FAIL' }))
    ])
    expect(blocked.status).toBe('blocked')
    expect(blocked.artifacts).toEqual([])
    expect(blocked.skipped.map(({ sourceId }) => sourceId).sort()).toEqual(['callee', 'caller'])

    const duplicated = await planFor(adapter, [
      doc('first', 'first.bpmn', documentXml('Process_Duplicate')),
      doc('second', 'second.bpmn', documentXml('Process_Duplicate'))
    ])
    expect(duplicated.status).toBe('blocked')
    expect(duplicated.skipped).toEqual([
      expect.objectContaining({ sourceId: 'first', reason: 'process-id-collision' }),
      expect.objectContaining({ sourceId: 'second', reason: 'process-id-collision' })
    ])
  })

  it('reviews existing collisions, identical files, path repairs, and warnings without mutating', async () => {
    const sameXml = documentXml('Process_Same')
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:review',
      folders: ['folder.bpmn'],
      files: {
        'same.bpmn': sameXml,
        'replace.bpmn': 'old content'
      }
    })
    const plan = await planFor(adapter, [
      doc('same', 'same.bpmn', sameXml),
      doc('replace', 'replace.bpmn', documentXml('Process_Replace', { marker: 'WARN' })),
      doc('duplicate', 'copy.bpmn', documentXml('Process_Copy'), 'same.bpmn'),
      doc('directory', 'folder.bpmn', documentXml('Process_Directory'))
    ])

    expect(plan.collisions).toHaveLength(2)
    expect(plan.collisions.find(({ artifactId }) => artifactId === 'same:1')?.identical).toBe(true)
    expect(plan.collisions.find(({ artifactId }) => artifactId === 'replace:1')?.identical).toBe(
      false
    )
    expect(plan.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'destination-deduplicated',
          before: 'same.bpmn',
          after: 'same-imported.bpmn'
        }),
        expect.objectContaining({
          code: 'destination-deduplicated',
          before: 'folder.bpmn',
          after: 'folder-imported.bpmn'
        })
      ])
    )
    expect(plan.warnings).toEqual([
      expect.objectContaining({ code: 'test.warning', artifactId: 'replace:1' })
    ])
    expect(decoder.decode((await adapter.read('replace.bpmn')).bytes)).toBe('old content')
  })

  it('rejects oversized pre-parse candidates and duplicate source ids', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    await expect(
      prepareWorkspaceImportPlan({
        adapter,
        sources: [doc('large', 'large.bpmn', documentXml('Large'))],
        bpmnPreparer: fakePreparer,
        validationAdapters: [],
        limits: { maxArtifactBytes: 8 }
      })
    ).rejects.toMatchObject({ code: 'limit-exceeded' })

    await expect(
      planFor(adapter, [
        doc('same-id', 'a.bpmn', documentXml('A')),
        doc('same-id', 'b.bpmn', documentXml('B'))
      ])
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('skips a destination whose parent is an existing or incoming file', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { blocked: 'ordinary file' }
    })
    const plan = await planFor(adapter, [
      doc('safe', 'safe.bpmn', documentXml('Safe')),
      doc('blocked', 'child.bpmn', documentXml('Blocked'), 'blocked/child.bpmn'),
      doc('parent', 'parent.bpmn', documentXml('Parent')),
      doc('nested', 'nested.bpmn', documentXml('Nested'), 'parent.bpmn/nested.bpmn')
    ])

    expect(plan.artifacts.map(({ id }) => id)).toEqual(['safe:1', 'parent:1'])
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        sourceId: 'blocked',
        reason: 'destination-parent-file'
      }),
      expect.objectContaining({
        sourceId: 'nested',
        reason: 'destination-parent-file'
      })
    ])
  })
})

describe('review confirmation and atomic execution', () => {
  it('requires the exact reviewed digest and every non-identical collision decision', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'replace.bpmn': 'old', 'same.bpmn': documentXml('Same') }
    })
    const plan = await planFor(adapter, [
      doc('replace', 'replace.bpmn', documentXml('Replace')),
      doc('same', 'same.bpmn', documentXml('Same'))
    ])

    expect(() =>
      confirmWorkspaceImportPlan(plan, {
        accepted: true,
        reviewedDigest: 'stale'
      })
    ).toThrowError(expect.objectContaining({ code: 'review-mismatch' }))
    expect(() =>
      confirmWorkspaceImportPlan(plan, {
        accepted: true,
        reviewedDigest: plan.reviewDigest
      })
    ).toThrowError(expect.objectContaining({ code: 'unresolved-collision' }))

    const confirmed = confirmWorkspaceImportPlan(plan, {
      accepted: true,
      reviewedDigest: plan.reviewDigest,
      collisionDecisions: {
        'replace:1': { action: 'keep-both' }
      }
    })
    expect(confirmed.collisionDecisions).toEqual({
      'replace:1': {
        action: 'keep-both',
        destinationPath: 'replace-imported.bpmn'
      },
      'same:1': { action: 'skip' }
    })
    expect(decoder.decode((await adapter.read('replace.bpmn')).bytes)).toBe('old')
  })

  it('creates recovery history before replacements and commits all reviewed writes in one mutex', async () => {
    const events: string[] = []
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:commit',
      files: { 'replace.bpmn': 'old', 'same.bpmn': documentXml('Same') },
      beforeWrite: (path) => {
        events.push(`write:${path}`)
      }
    })
    const plan = await planFor(adapter, [
      doc('create', 'create.bpmn', documentXml('Create')),
      doc('replace', 'replace.bpmn', documentXml('Replace')),
      doc('same', 'same.bpmn', documentXml('Same'))
    ])
    const confirmed = confirmWorkspaceImportPlan(plan, {
      accepted: true,
      reviewedDigest: plan.reviewDigest,
      collisionDecisions: { 'replace:1': { action: 'replace' } }
    })
    const history: WorkspaceImportHistory = {
      createRevision: vi.fn(async (path, { snapshot, prune }) => {
        events.push(`history:${path}:${decoder.decode(snapshot.bytes)}:${String(prune)}`)
      }),
      enforceRetention: vi.fn(async () => undefined)
    }
    const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
      events.push('mutex:start')
      const result = await operation()
      events.push('mutex:end')
      return result
    }

    const outcome = await executeConfirmedWorkspaceImport(confirmed, {
      adapter,
      history,
      runExclusive
    })

    expect(outcome).toMatchObject({
      status: 'committed',
      historyRevisions: 1,
      skippedPaths: ['same.bpmn']
    })
    expect(events.indexOf('history:replace.bpmn:old:false')).toBeLessThan(
      events.indexOf('write:replace.bpmn')
    )
    expect(events[0]).toBe('mutex:start')
    expect(events.at(-1)).toBe('mutex:end')
    expect(decoder.decode((await adapter.read('create.bpmn')).bytes)).toBe(documentXml('Create'))
    expect(decoder.decode((await adapter.read('replace.bpmn')).bytes)).toBe(documentXml('Replace'))
    expect(history.enforceRetention).toHaveBeenCalledOnce()
  })

  it('refuses replacement without portable history and rejects post-review byte tampering', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'replace.bpmn': 'old' }
    })
    const plan = await planFor(adapter, [doc('replace', 'replace.bpmn', documentXml('Replace'))])
    const confirmed = confirmWorkspaceImportPlan(plan, {
      accepted: true,
      reviewedDigest: plan.reviewDigest,
      collisionDecisions: { 'replace:1': { action: 'replace' } }
    })
    await expect(executeConfirmedWorkspaceImport(confirmed, { adapter })).rejects.toMatchObject({
      code: 'history-required'
    })
    expect(decoder.decode((await adapter.read('replace.bpmn')).bytes)).toBe('old')

    plan.artifacts[0].bytes[0] ^= 0xff
    await expect(
      executeConfirmedWorkspaceImport(confirmed, {
        adapter,
        history: { createRevision: async () => undefined }
      })
    ).rejects.toMatchObject({ code: 'plan-tampered' })
    expect(decoder.decode((await adapter.read('replace.bpmn')).bytes)).toBe('old')
  })

  it('rolls back creations and replacements after a later failure', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:rollback',
      files: { 'b-replace.bpmn': 'original' },
      beforeWrite: (path, bytes) => {
        if (path === 'z-fail.bpmn' && decoder.decode(bytes) !== 'original') {
          throw new Error('simulated quota failure')
        }
      }
    })
    const plan = await planFor(
      adapter,
      [
        doc('a', 'landscape.aml', '<AML/>'),
        doc('b', 'b-replace.bpmn', documentXml('B')),
        doc('z', 'z-fail.bpmn', documentXml('Z'))
      ],
      { amlConverter: async () => amlConversion() }
    )
    const confirmed = confirmWorkspaceImportPlan(plan, {
      accepted: true,
      reviewedDigest: plan.reviewDigest,
      collisionDecisions: { 'b:1': { action: 'replace' } }
    })
    const history = {
      createRevision: vi.fn(async () => undefined)
    }
    const outcome = await executeConfirmedWorkspaceImport(confirmed, {
      adapter,
      history
    })

    expect(outcome).toMatchObject({
      status: 'rolled-back',
      historyRevisions: 1,
      rollbackErrors: [],
      arisReports: [expect.objectContaining({ sourceId: 'a' })],
      evidence: expect.objectContaining({
        arisReports: [expect.objectContaining({ sourceId: 'a' })]
      })
    })
    await expect(adapter.read('aml-process.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    expect(decoder.decode((await adapter.read('b-replace.bpmn')).bytes)).toBe('original')
    await expect(adapter.read('z-fail.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
  })

  it('reports rollback failure and never overwrites a newer external edit', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:rollback-conflict',
      files: { 'b-replace.bpmn': 'original' },
      beforeWrite: (path) => {
        if (path === 'z-fail.bpmn') {
          adapter.replaceExternally('b-replace.bpmn', 'newer external edit')
          throw new Error('later import write failed')
        }
      }
    })
    const plan = await planFor(adapter, [
      doc('a', 'a-create.bpmn', documentXml('A')),
      doc('b', 'b-replace.bpmn', documentXml('B')),
      doc('z', 'z-fail.bpmn', documentXml('Z'))
    ])
    const confirmed = confirmWorkspaceImportPlan(plan, {
      accepted: true,
      reviewedDigest: plan.reviewDigest,
      collisionDecisions: { 'b:1': { action: 'replace' } }
    })
    const outcome = await executeConfirmedWorkspaceImport(confirmed, {
      adapter,
      history: { createRevision: async () => undefined }
    })

    expect(outcome).toMatchObject({
      status: 'rollback-failed',
      rollbackErrors: [expect.objectContaining({ code: 'integrity-failure' })]
    })
    expect(decoder.decode((await adapter.read('b-replace.bpmn')).bytes)).toBe('newer external edit')
    await expect(adapter.read('a-create.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
  })
})

describe('production BPMN preparation', () => {
  it('auto-layouts missing DI and validates the exact repaired XML before review', async () => {
    const semanticXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_Auto" targetNamespace="urn:orbitpm:test">
  <bpmn:process id="Process_Auto" isExecutable="false">
    <bpmn:startEvent id="Start"><bpmn:outgoing>Flow</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="End"><bpmn:incoming>Flow</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow" sourceRef="Start" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`
    const adapter = new MemoryWorkspaceAdapter()
    const plan = await prepareWorkspaceImportPlan({
      adapter,
      sources: [doc('auto', 'auto.bpmn', semanticXml)],
      validationAdapters: [],
      now: () => new Date('2026-07-26T12:00:00.000Z')
    })

    expect(plan.status).toBe('ready')
    expect(plan.repairs).toContainEqual(
      expect.objectContaining({ code: 'auto-layout', artifactId: 'auto:1' })
    )
    expect(plan.artifacts[0].xml).toContain('<bpmndi:BPMNDiagram')
    expect(plan.artifacts[0].validation.valid).toBe(true)
    expect(await adapter.list()).toEqual([])
  })
})
