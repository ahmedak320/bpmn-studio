import { describe, expect, it, vi } from 'vitest'

import {
  createArisConversionReport,
  type AmlConversion,
  type ArisConversionReportEntry
} from '../library/apcImport'
import { readLibraryZip } from '../library/zipImport'
import { buildLibraryZip } from '../library/zipExport'
import { createValidationSummary, validationIssue } from '../validation'
import { MemoryWorkspaceAdapter, sha256Hex } from './adapters'
import {
  confirmWorkspaceImportPlan,
  executeConfirmedWorkspaceImport,
  prepareWorkspaceImportPlan,
  secureBpmnImportPreparer,
  type BpmnImportPreparer,
  type WorkspaceImportHistory,
  type WorkspaceImportSource
} from './importTransaction'
import { ReviewedBpmnBoundaryError, type ReviewedBpmnIngestionPort } from './reviewedBpmn'

const decoder = new TextDecoder()

function documentXml(processId: string, options: { ref?: string; marker?: string } = {}): string {
  return `<definitions><process id="${processId}">${options.ref ? `<call ref="${options.ref}"/>` : ''}${
    options.marker ?? ''
  }</process></definitions>`
}

function multiProcessXml(...ids: string[]): string {
  return `<definitions>${ids.map((id) => `<process id="${id}"/>`).join('')}</definitions>`
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

const fakeReviewedBpmnIngestion: ReviewedBpmnIngestionPort = async (xml) => {
  return reviewedResult(xml)
}

async function reviewedResult(
  xml: string
): Promise<Awaited<ReturnType<ReviewedBpmnIngestionPort>>> {
  const digest = await sha256Hex(new TextEncoder().encode(xml))
  const reviewDigest = `review-${digest}`
  return {
    xml,
    digest,
    reviewDigest,
    validation: createValidationSummary([]),
    evidence: {
      originalDigest: digest,
      outputDigest: digest,
      reviewDigest
    } as never
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
    existingProcessIds?: ReadonlySet<string>
    existingProcessIndex?: ReadonlyMap<string, { readonly relPath: string }>
  } = {}
) {
  return prepareWorkspaceImportPlan({
    adapter,
    sources,
    targetFolder: options.targetFolder,
    existingProcessIds: options.existingProcessIds,
    existingProcessIndex: options.existingProcessIndex,
    bpmnPreparer: fakePreparer,
    reviewedBpmnIngestion: fakeReviewedBpmnIngestion,
    validationAdapters: [],
    amlConverter: options.amlConverter,
    now: () => new Date('2026-07-26T12:00:00.000Z')
  })
}

async function edgePlan(
  adapter: MemoryWorkspaceAdapter,
  sources: readonly WorkspaceImportSource[],
  overrides: Partial<Parameters<typeof prepareWorkspaceImportPlan>[0]> = {}
) {
  return prepareWorkspaceImportPlan({
    adapter,
    sources,
    bpmnPreparer: fakePreparer,
    reviewedBpmnIngestion: fakeReviewedBpmnIngestion,
    validationAdapters: [],
    now: () => new Date('2026-07-26T12:00:00.000Z'),
    ...overrides
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
    expect(plan.artifacts.every((artifact) => artifact.localizationReviewDigest.length > 0)).toBe(
      true
    )
    expect(
      plan.artifacts.every(
        (artifact) => artifact.sha256 === artifact.localizationEvidence.outputDigest
      )
    ).toBe(true)
    expect(plan.processIdentityDigest).toMatch(/^[a-f0-9]{64}$/)
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

  it('allows an explicitly reviewed same-path process replacement without writing during planning', async () => {
    const beforeWrite = vi.fn()
    const previousXml = documentXml('Process_Replace', { marker: '<old/>' })
    const incomingXml = documentXml('Process_Replace', { marker: '<new/>' })
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'reviewed/process.bpmn': previousXml },
      beforeWrite
    })
    const plan = await planFor(
      adapter,
      [doc('replace', 'process.bpmn', incomingXml, 'reviewed/process.bpmn')],
      {
        existingProcessIndex: new Map([['Process_Replace', { relPath: 'reviewed/process.bpmn' }]])
      }
    )

    expect(plan.status).toBe('ready')
    expect(plan.artifacts).toEqual([
      expect.objectContaining({
        id: 'replace:1',
        destinationPath: 'reviewed/process.bpmn',
        replacesProcessIds: ['Process_Replace']
      })
    ])
    expect(plan.collisions).toEqual([
      expect.objectContaining({ artifactId: 'replace:1', path: 'reviewed/process.bpmn' })
    ])
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({
        code: 'same-path-process-replacement',
        artifactId: 'replace:1',
        count: 1
      })
    )
    expect(() =>
      confirmWorkspaceImportPlan(plan, {
        accepted: true,
        reviewedDigest: plan.reviewDigest,
        collisionDecisions: { 'replace:1': { action: 'keep-both' } }
      })
    ).toThrowError(expect.objectContaining({ code: 'unresolved-collision' }))
    expect(
      confirmWorkspaceImportPlan(plan, {
        accepted: true,
        reviewedDigest: plan.reviewDigest,
        collisionDecisions: { 'replace:1': { action: 'replace' } }
      }).collisionDecisions
    ).toEqual({ 'replace:1': { action: 'replace' } })
    expect(beforeWrite).not.toHaveBeenCalled()
    expect(decoder.decode((await adapter.read('reviewed/process.bpmn')).bytes)).toBe(previousXml)
  })

  it('blocks different-path identities and fails safe for Set-only callers with zero writes', async () => {
    const beforeWrite = vi.fn()
    const ownedXml = documentXml('Process_Owned')
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'owned/process.bpmn': ownedXml },
      beforeWrite
    })

    const differentPath = await planFor(
      adapter,
      [doc('incoming', 'incoming.bpmn', documentXml('Process_Owned'))],
      {
        existingProcessIndex: new Map([['Process_Owned', { relPath: 'owned/process.bpmn' }]])
      }
    )
    expect(differentPath.status).toBe('blocked')
    expect(differentPath.artifacts).toEqual([])
    expect(differentPath.skipped).toEqual([
      expect.objectContaining({
        sourceId: 'incoming',
        reason: 'process-id-collision',
        message: expect.stringContaining('owned/process.bpmn')
      })
    ])

    const setOnly = await planFor(
      adapter,
      [doc('legacy', 'process.bpmn', documentXml('Process_Owned'), 'owned/process.bpmn')],
      { existingProcessIds: new Set(['Process_Owned']) }
    )
    expect(setOnly.status).toBe('blocked')
    expect(setOnly.artifacts).toEqual([])
    expect(setOnly.skipped).toEqual([
      expect.objectContaining({
        sourceId: 'legacy',
        reason: 'process-id-collision',
        message: expect.stringContaining('path was not supplied')
      })
    ])
    expect(beforeWrite).not.toHaveBeenCalled()
    expect(decoder.decode((await adapter.read('owned/process.bpmn')).bytes)).toBe(ownedXml)
  })

  it('matches existing process ownership using portable case-normalized paths', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'Folder/Existing.BPMN': documentXml('Process_Case', { marker: '<old/>' }) }
    })
    const plan = await planFor(
      adapter,
      [
        doc(
          'case',
          'existing.bpmn',
          documentXml('Process_Case', { marker: '<new/>' }),
          'folder/existing.bpmn'
        )
      ],
      {
        existingProcessIndex: new Map([['Process_Case', { relPath: 'FOLDER/EXISTING.bpmn' }]])
      }
    )

    expect(plan.status).toBe('ready')
    expect(plan.artifacts[0]).toMatchObject({
      destinationPath: 'Folder/Existing.BPMN',
      replacesProcessIds: ['Process_Case']
    })
    expect(plan.collisions[0]).toMatchObject({
      artifactId: 'case:1',
      path: 'Folder/Existing.BPMN'
    })
    expect(plan.repairs).toContainEqual(
      expect.objectContaining({
        code: 'destination-case-normalized',
        before: 'folder/existing.bpmn',
        after: 'Folder/Existing.BPMN'
      })
    )
  })

  it('checks every process identity in a multi-process file as one artifact', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'bundle.bpmn': multiProcessXml('Process_A', 'Process_B'),
        'elsewhere.bpmn': documentXml('Process_B')
      }
    })
    const samePath = await planFor(
      adapter,
      [doc('bundle', 'bundle.bpmn', multiProcessXml('Process_A', 'Process_B'))],
      {
        existingProcessIndex: new Map([
          ['Process_A', { relPath: 'bundle.bpmn' }],
          ['Process_B', { relPath: 'bundle.bpmn' }]
        ])
      }
    )
    expect(samePath.status).toBe('ready')
    expect(samePath.artifacts[0].replacesProcessIds).toEqual(['Process_A', 'Process_B'])

    const mixedOwnership = await planFor(
      adapter,
      [doc('mixed', 'bundle.bpmn', multiProcessXml('Process_A', 'Process_B'))],
      {
        existingProcessIndex: new Map([
          ['Process_A', { relPath: 'bundle.bpmn' }],
          ['Process_B', { relPath: 'elsewhere.bpmn' }]
        ])
      }
    )
    expect(mixedOwnership.status).toBe('blocked')
    expect(mixedOwnership.artifacts).toEqual([])
    expect(mixedOwnership.skipped).toEqual([
      expect.objectContaining({
        sourceId: 'mixed',
        reason: 'process-id-collision',
        message: expect.stringContaining('elsewhere.bpmn')
      })
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
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'test.warning', artifactId: 'replace:1' })
      ])
    )
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

  it('rejects reserved destinations, including custom keep-both paths, with zero writes', async () => {
    const beforeWrite = vi.fn()
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'collision.bpmn': 'old' },
      beforeWrite
    })

    await expect(
      planFor(adapter, [doc('target', 'target.bpmn', documentXml('Target'))], {
        targetFolder: '.ORBITPM/imports'
      })
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      planFor(adapter, [
        doc('source', 'source.bpmn', documentXml('Source'), '.orbitpm/incoming/source.bpmn')
      ])
    ).rejects.toMatchObject({ code: 'invalid-input' })

    const plan = await planFor(adapter, [
      doc('collision', 'collision.bpmn', documentXml('Collision'))
    ])
    expect(() =>
      confirmWorkspaceImportPlan(plan, {
        accepted: true,
        reviewedDigest: plan.reviewDigest,
        collisionDecisions: {
          'collision:1': {
            action: 'keep-both',
            destinationPath: '.orbitpm/restored.bpmn'
          }
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-input' }))
    expect(beforeWrite).not.toHaveBeenCalled()
  })

  it('enforces multipleFiles at planning and execution with zero writes', async () => {
    const beforeWrite = vi.fn()
    const single = new MemoryWorkspaceAdapter({ beforeWrite })
    single.storage.capabilities.multipleFiles = false
    await expect(
      planFor(single, [
        doc('one', 'one.bpmn', documentXml('One')),
        doc('two', 'two.bpmn', documentXml('Two'))
      ])
    ).rejects.toMatchObject({ code: 'invalid-input' })
    expect(beforeWrite).not.toHaveBeenCalled()

    const changing = new MemoryWorkspaceAdapter({ beforeWrite })
    const plan = await planFor(changing, [doc('one', 'one.bpmn', documentXml('One'))])
    const confirmed = confirmWorkspaceImportPlan(plan, {
      accepted: true,
      reviewedDigest: plan.reviewDigest
    })
    changing.storage.capabilities.multipleFiles = false
    await expect(
      executeConfirmedWorkspaceImport(confirmed, {
        adapter: changing,
        processIdentityInspector: fakePreparer.inspect
      })
    ).rejects.toMatchObject({ code: 'workspace-changed' })
    expect(beforeWrite).not.toHaveBeenCalled()
  })

  it('fails closed when localization review is unresolved', async () => {
    const beforeWrite = vi.fn()
    const adapter = new MemoryWorkspaceAdapter({ beforeWrite })
    const plan = await prepareWorkspaceImportPlan({
      adapter,
      sources: [doc('unresolved', 'unresolved.bpmn', documentXml('Unresolved'))],
      bpmnPreparer: fakePreparer,
      processIdentityInspector: fakePreparer.inspect,
      validationAdapters: [],
      reviewedBpmnIngestion: async () => {
        throw new ReviewedBpmnBoundaryError(
          'review-required',
          'Explicit bilingual review is required.'
        )
      }
    })

    expect(plan.status).toBe('blocked')
    expect(plan.artifacts).toEqual([])
    expect(plan.skipped).toContainEqual(
      expect.objectContaining({ reason: 'localization-review-required' })
    )
    expect(beforeWrite).not.toHaveBeenCalled()
  })

  it('rejects every bounded-input shape before parsing or writing', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    const first = doc('first', 'first.bpmn', documentXml('First'))
    const second = doc('second', 'second.bpmn', documentXml('Second'))
    const firstBytes = new TextEncoder().encode(first.text).byteLength
    const secondBytes = new TextEncoder().encode(second.text).byteLength

    await expect(edgePlan(adapter, [first], { limits: { maxSources: 0 } })).rejects.toMatchObject({
      code: 'invalid-input'
    })
    await expect(
      edgePlan(adapter, [first, second], { limits: { maxSources: 1 } })
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
    await expect(edgePlan(adapter, [{ ...first, id: ' ' }])).rejects.toMatchObject({
      code: 'invalid-input'
    })
    await expect(edgePlan(adapter, [{ ...first, name: ' ' }])).rejects.toMatchObject({
      code: 'invalid-input'
    })
    await expect(
      edgePlan(adapter, [first], { limits: { maxSourceCharacters: firstBytes - 1 } })
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
    await expect(
      edgePlan(adapter, [first, second], {
        limits: {
          maxSourceCharacters: Math.max(firstBytes, secondBytes),
          maxTotalSourceCharacters: firstBytes + secondBytes - 1
        }
      })
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
    await expect(
      edgePlan(adapter, [first, second], {
        limits: {
          maxArtifactBytes: Math.max(firstBytes, secondBytes),
          maxTotalArtifactBytes: firstBytes + secondBytes - 1
        }
      })
    ).rejects.toMatchObject({ code: 'limit-exceeded' })

    const unicode = await edgePlan(adapter, [
      doc('unicode', 'unicode.bpmn', documentXml('Unicode', { marker: 'é € 😀' }))
    ])
    expect(unicode.status).toBe('ready')
    expect(await adapter.list()).toEqual([])
  })

  it('fails closed for cancellation, unsafe paths, and unverifiable existing paths', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    const cancelled = new AbortController()
    cancelled.abort('superseded')
    await expect(
      edgePlan(adapter, [doc('cancelled', 'cancelled.bpmn', documentXml('Cancelled'))], {
        signal: cancelled.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })

    const unsafe = await edgePlan(adapter, [
      doc('unsafe', 'unsafe.bpmn', documentXml('Unsafe'), '../unsafe.bpmn')
    ])
    expect(unsafe).toMatchObject({
      status: 'blocked',
      skipped: [expect.objectContaining({ reason: 'unsafe-path' })]
    })

    const unverifiable = await edgePlan(
      adapter,
      [doc('existing', 'existing.bpmn', documentXml('Existing'))],
      {
        existingProcessIndex: new Map([['Existing', { relPath: '../outside.bpmn' }]])
      }
    )
    expect(unverifiable).toMatchObject({
      status: 'blocked',
      skipped: [expect.objectContaining({ reason: 'process-id-collision' })]
    })
  })

  it('covers failed and multilingual multi-model ARIS conversion evidence', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    const failed = await edgePlan(adapter, [doc('failed-aml', 'failed.aml', '<AML/>')], {
      amlConverter: async () => ({ error: 'unsupported ARIS database' })
    })
    expect(failed).toMatchObject({
      status: 'blocked',
      skipped: [expect.objectContaining({ reason: 'aml-conversion-failed' })]
    })

    const base = amlConversion()
    if ('error' in base) throw new Error(base.error)
    const pluralReport = createArisConversionReport({
      databaseName: 'Arabic models',
      objectDefinitions: 2,
      models: 3,
      outputFiles: 3,
      entries: {
        converted: [],
        downgraded: [
          reportEntry('unknown-object-type-mapped-as-task', 'one'),
          reportEntry('unknown-object-type-mapped-as-task', 'two')
        ],
        ignored: [],
        ambiguous: [],
        unmapped: []
      }
    })
    const converted = await edgePlan(adapter, [doc('arabic-aml', 'landscape.aml', '<AML/>')], {
      language: 'ar',
      amlConverter: async () => ({
        files: [
          {
            ...base.files[0],
            nameAr: 'العملية الأولى',
            processId: 'Arabic_One',
            xml: documentXml('Arabic_One')
          },
          {
            ...base.files[0],
            name: 'Fallback Name',
            nameAr: '',
            nameEn: '',
            processId: 'Arabic_Two',
            xml: documentXml('Arabic_Two')
          },
          {
            ...base.files[0],
            name: '',
            nameAr: '',
            nameEn: '',
            processId: 'Arabic_Three',
            xml: documentXml('Arabic_Three')
          }
        ],
        report: pluralReport
      })
    })
    expect(converted.artifacts).toHaveLength(3)
    expect(converted.warnings).toContainEqual(
      expect.objectContaining({
        code: 'aml-downgraded',
        count: 2,
        message: expect.stringContaining('decisions')
      })
    )
  })

  it('reports structural, identity, localization, and reviewed-identity failures distinctly', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    const source = doc('candidate', 'candidate.bpmn', documentXml('Candidate'))

    const inspectString = await edgePlan(adapter, [source], {
      bpmnPreparer: {
        ...fakePreparer,
        inspect: async () => {
          throw 'non-error parse failure'
        }
      }
    })
    expect(inspectString.skipped).toContainEqual(
      expect.objectContaining({ reason: 'invalid-bpmn', message: 'non-error parse failure' })
    )

    const preparationChanged = await edgePlan(adapter, [source], {
      bpmnPreparer: {
        ...fakePreparer,
        prepare: async (xml, options) => ({
          ...(await fakePreparer.prepare(xml, options)),
          processIds: ['Changed_During_Preparation']
        })
      }
    })
    expect(preparationChanged.skipped).toContainEqual(
      expect.objectContaining({ reason: 'process-identity-changed' })
    )

    const reviewedChanged = await edgePlan(adapter, [source], {
      reviewedBpmnIngestion: async () => reviewedResult(documentXml('Changed_During_Review'))
    })
    expect(reviewedChanged.skipped).toContainEqual(
      expect.objectContaining({
        reason: 'process-identity-changed',
        message: expect.stringContaining('Reviewed localization')
      })
    )

    const reviewCancelled = await edgePlan(adapter, [source], {
      reviewedBpmnIngestion: async () => {
        throw new ReviewedBpmnBoundaryError('review-cancelled', 'reviewer closed the dialog')
      }
    })
    expect(reviewCancelled.skipped).toContainEqual(
      expect.objectContaining({ reason: 'localization-review-cancelled' })
    )

    const localizationInvalid = await edgePlan(adapter, [source], {
      reviewedBpmnIngestion: async () => {
        throw 'localized output failed validation'
      }
    })
    expect(localizationInvalid.skipped).toContainEqual(
      expect.objectContaining({
        reason: 'localization-invalid',
        message: 'localized output failed validation'
      })
    )
  })

  it('surfaces production parse diagnostics for malformed BPMN', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    const plan = await prepareWorkspaceImportPlan({
      adapter,
      sources: [doc('malformed', 'malformed.bpmn', '<broken')],
      validationAdapters: [],
      reviewedBpmnIngestion: fakeReviewedBpmnIngestion
    })

    expect(plan.status).toBe('blocked')
    expect(plan.skipped).toContainEqual(
      expect.objectContaining({ reason: 'invalid-bpmn', message: expect.stringContaining('parse') })
    )
    expect(plan.warnings.length).toBeGreaterThan(0)
    await expect(secureBpmnImportPreparer.inspect('<broken')).rejects.toThrow()
  })

  it('enforces reviewed-output byte limits and localization evidence integrity', async () => {
    const adapter = new MemoryWorkspaceAdapter()
    const source = doc('expanded', 'expanded.bpmn', documentXml('Expanded'))
    const sourceBytes = new TextEncoder().encode(source.text).byteLength
    const expandingReview: ReviewedBpmnIngestionPort = async (xml) =>
      reviewedResult(`${xml}${' '.repeat(128)}`)

    await expect(
      edgePlan(adapter, [source], {
        reviewedBpmnIngestion: expandingReview,
        limits: {
          maxArtifactBytes: sourceBytes + 32,
          maxTotalArtifactBytes: sourceBytes + 512
        }
      })
    ).rejects.toMatchObject({ code: 'limit-exceeded' })

    const second = doc('expanded-two', 'expanded-two.bpmn', documentXml('Expanded_Two'))
    const totalSourceBytes =
      new TextEncoder().encode(source.text).byteLength +
      new TextEncoder().encode(second.text).byteLength
    await expect(
      edgePlan(adapter, [source, second], {
        reviewedBpmnIngestion: expandingReview,
        limits: {
          maxArtifactBytes: sourceBytes + 512,
          maxTotalArtifactBytes: totalSourceBytes + 32
        }
      })
    ).rejects.toMatchObject({ code: 'limit-exceeded' })

    await expect(
      edgePlan(adapter, [source], {
        reviewedBpmnIngestion: async (xml) => {
          const reviewed = await reviewedResult(xml)
          return {
            ...reviewed,
            evidence: {
              ...reviewed.evidence,
              outputDigest: '0'.repeat(64)
            }
          }
        }
      })
    ).rejects.toMatchObject({ code: 'plan-tampered' })
  })

  it('never relocates an existing process identity during destination de-duplication', async () => {
    const adapter = new MemoryWorkspaceAdapter({ folders: ['owned.bpmn'] })
    const plan = await edgePlan(adapter, [doc('owned', 'owned.bpmn', documentXml('Owned'))], {
      existingProcessIndex: new Map([['Owned', { relPath: 'owned.bpmn' }]])
    })

    expect(plan.status).toBe('blocked')
    expect(plan.skipped).toContainEqual(
      expect.objectContaining({
        reason: 'process-id-collision',
        message: expect.stringContaining('cannot move')
      })
    )
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
    const signal = new AbortController().signal
    const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
      events.push('mutex:start')
      const result = await operation()
      events.push('mutex:end')
      return result
    }

    const outcome = await executeConfirmedWorkspaceImport(confirmed, {
      adapter,
      history,
      runExclusive,
      signal,
      processIdentityInspector: fakePreparer.inspect
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
    expect(history.createRevision).toHaveBeenCalledWith(
      'replace.bpmn',
      expect.objectContaining({ signal })
    )
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
    await expect(
      executeConfirmedWorkspaceImport(confirmed, {
        adapter,
        processIdentityInspector: fakePreparer.inspect
      })
    ).rejects.toMatchObject({
      code: 'history-required'
    })
    expect(decoder.decode((await adapter.read('replace.bpmn')).bytes)).toBe('old')

    plan.artifacts[0].bytes[0] ^= 0xff
    await expect(
      executeConfirmedWorkspaceImport(confirmed, {
        adapter,
        history: { createRevision: async () => undefined },
        processIdentityInspector: fakePreparer.inspect
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
      history,
      processIdentityInspector: fakePreparer.inspect
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
      history: { createRevision: async () => undefined },
      processIdentityInspector: fakePreparer.inspect
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

  it('rechecks the full process identity snapshot so unrelated races cause zero writes', async () => {
    const beforeWrite = vi.fn()
    const adapter = new MemoryWorkspaceAdapter({ beforeWrite })
    const plan = await planFor(adapter, [
      doc('incoming', 'incoming.bpmn', documentXml('Process_Incoming'))
    ])
    const confirmed = confirmWorkspaceImportPlan(plan, {
      accepted: true,
      reviewedDigest: plan.reviewDigest
    })

    adapter.replaceExternally('unrelated.bpmn', documentXml('Process_Unrelated'))
    await expect(
      executeConfirmedWorkspaceImport(confirmed, {
        adapter,
        processIdentityInspector: fakePreparer.inspect
      })
    ).rejects.toMatchObject({ code: 'workspace-changed' })
    await expect(adapter.read('incoming.bpmn')).rejects.toMatchObject({ code: 'not-found' })
    expect(beforeWrite).not.toHaveBeenCalled()
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
