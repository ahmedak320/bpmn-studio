import { describe, expect, it, vi } from 'vitest'

import { MemoryWorkspaceAdapter } from '@/workspace/adapters/memory'
import type { WorkspaceEntry } from '@/workspace/adapters/types'

import {
  createArisLinkScanCache,
  EMPTY_ARIS_LINK_STATE,
  isArisLinkScanCandidate,
  mergeArisLinkState,
  scanArisWorkspaceLinks
} from './arisWorkspaceLinks'

const DOCTYPE = `<!DOCTYPE AML [<!ENTITY LocaleId.USen "1033"><!ENTITY LocaleId.AEar "14337">]>`

function aml(xmlBody: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${DOCTYPE}\n<AML>\n${xmlBody}\n</AML>`
}

function model(id: string, type: string, body = ''): string {
  return `<Model Model.ID="${id}" Model.Type="${type}">${body}</Model>`
}

function modelName(name: string, locale = '&LocaleId.USen;'): string {
  return `<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="${locale}">${name}</AttrValue></AttrDef>`
}

function objOcc(id: string, defId: string): string {
  return `<ObjOcc ObjOcc.ID="${id}" ObjDef.IdRef="${defId}"/>`
}

function objDef(id: string, linkedIds: string): string {
  return `<ObjDef ObjDef.ID="${id}" LinkedModels.IdRefs="${linkedIds}"/>`
}

function entry(path: string, size: number, modifiedAt: number): WorkspaceEntry {
  return {
    path,
    name: path.split('/').pop() ?? path,
    parentPath: '',
    kind: 'file',
    size,
    modifiedAt,
    readable: true
  }
}

describe('isArisLinkScanCandidate', () => {
  it('accepts .aml and .xml files', () => {
    expect(isArisLinkScanCandidate(entry('a.aml', 1, 1))).toBe(true)
    expect(isArisLinkScanCandidate(entry('a.xml', 1, 1))).toBe(true)
    expect(isArisLinkScanCandidate(entry('a.XML', 1, 1))).toBe(true)
  })

  it('rejects directories and non-aml/xml files', () => {
    expect(isArisLinkScanCandidate({ ...entry('a.aml', 1, 1), kind: 'directory' })).toBe(false)
    expect(isArisLinkScanCandidate(entry('a.bpmn', 1, 1))).toBe(false)
  })

  it('rejects .orbitpm paths', () => {
    expect(isArisLinkScanCandidate(entry('.orbitpm/config.aml', 1, 1))).toBe(false)
  })
})

describe('scanArisWorkspaceLinks', () => {
  it('builds an index and graph from workspace AML files', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'models/A.aml': aml(`
          ${model('Model.A', 'MT_EEPC', modelName('Model A') + objOcc('Occ.A1', 'Def.L1'))}
          ${model('Model.B', 'MT_EEPC', modelName('Model B'))}
          ${objDef('Def.L1', 'Model.B')}
        `),
        'models/B.aml': aml(model('Model.C', 'MT_EEPC', modelName('Model C')))
      }
    })

    const entries = await adapter.list()
    const state = await scanArisWorkspaceLinks(adapter, entries, createArisLinkScanCache())

    expect(state.scannedFileCount).toBe(2)
    expect(state.index.get('Model.A')).toEqual({
      processId: 'Model.A',
      processName: 'Model A',
      relPath: 'models/A.aml'
    })
    expect(state.index.get('Model.B')).toBeDefined()
    expect(state.index.get('Model.C')).toBeDefined()

    expect(state.graph.links).toHaveLength(1)
    expect(state.graph.links[0]).toMatchObject({
      parentProcessId: 'Model.A',
      childProcessId: 'Model.B',
      parentRelPath: 'models/A.aml',
      childRelPath: 'models/A.aml',
      count: 1
    })
  })

  it('flags a model id declared in two files as ambiguous and drops it from the index', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'a.aml': aml(model('Model.X', 'MT_EEPC', modelName('X in A'))),
        'b.aml': aml(model('Model.X', 'MT_EEPC', modelName('X in B')))
      }
    })

    const entries = await adapter.list()
    const state = await scanArisWorkspaceLinks(adapter, entries, createArisLinkScanCache())

    expect(state.index.has('Model.X')).toBe(false)
    expect(state.graph.ambiguousProcessIds.has('Model.X')).toBe(true)
    expect(state.graph.links).toHaveLength(0)
  })

  it('drops links that touch a missing child process', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'a.aml': aml(`
          ${model('Model.A', 'MT_EEPC', modelName('A') + objOcc('Occ.1', 'Def.L1'))}
          ${objDef('Def.L1', 'Model.Missing')}
        `)
      }
    })

    const entries = await adapter.list()
    const state = await scanArisWorkspaceLinks(adapter, entries, createArisLinkScanCache())

    expect(state.index.has('Model.A')).toBe(true)
    expect(state.graph.links).toHaveLength(0)
  })

  it('skips per-file read errors without rejecting', async () => {
    const adapter = {
      read: vi.fn().mockRejectedValue(new Error('read failed'))
    }
    const entries: WorkspaceEntry[] = [entry('broken.aml', 1, 1)]

    const state = await scanArisWorkspaceLinks(adapter, entries, createArisLinkScanCache())

    expect(state.scannedFileCount).toBe(1)
    expect(state.index.size).toBe(0)
    expect(state.graph.links).toHaveLength(0)
  })

  it('does not call adapter.read when size+mtime match the cache', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'a.aml': aml(model('Model.A', 'MT_EEPC', modelName('A'))) }
    })
    const entries = await adapter.list()
    const cache = createArisLinkScanCache()

    // Warm the cache.
    await scanArisWorkspaceLinks(adapter, entries, cache)

    const readSpy = vi.spyOn(adapter, 'read')
    const state = await scanArisWorkspaceLinks(adapter, entries, cache)

    expect(readSpy).not.toHaveBeenCalled()
    expect(state.index.has('Model.A')).toBe(true)
  })

  it('rescans when the content hash changes', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'a.aml': aml(model('Model.A', 'MT_EEPC', modelName('A'))) }
    })
    const entries = await adapter.list()
    const cache = createArisLinkScanCache()
    await scanArisWorkspaceLinks(adapter, entries, cache)

    await adapter.writeAtomic(
      'a.aml',
      new TextEncoder().encode(aml(model('Model.B', 'MT_EEPC', modelName('B')))),
      undefined
    )
    const updatedEntries = await adapter.list()
    const state = await scanArisWorkspaceLinks(adapter, updatedEntries, cache)

    expect(state.index.has('Model.A')).toBe(false)
    expect(state.index.has('Model.B')).toBe(true)
  })

  it('reuses cached result by hash when a file moves to a new path', async () => {
    const content = aml(`
      ${model('Model.A', 'MT_EEPC', modelName('A') + objOcc('Occ.1', 'Def.L1'))}
      ${model('Model.B', 'MT_EEPC', modelName('B'))}
      ${objDef('Def.L1', 'Model.B')}
    `)
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'old/A.aml': content }
    })
    const cache = createArisLinkScanCache()
    const firstEntries = await adapter.list()
    const firstState = await scanArisWorkspaceLinks(adapter, firstEntries, cache)

    expect(firstState.graph.links).toHaveLength(1)
    expect(firstState.graph.links[0]!.parentRelPath).toBe('old/A.aml')

    await adapter.createFolder('new')
    await adapter.move('old/A.aml', 'new/A.aml')
    const secondEntries = await adapter.list()
    const readSpy = vi.spyOn(adapter, 'read')
    const secondState = await scanArisWorkspaceLinks(adapter, secondEntries, cache)

    expect(readSpy).toHaveBeenCalled() // new path has no metadata match
    expect(secondState.graph.links).toHaveLength(1)
    expect(secondState.graph.links[0]!.parentRelPath).toBe('new/A.aml')
    expect(secondState.graph.links[0]!.childRelPath).toBe('new/A.aml')
  })
})

describe('mergeArisLinkState', () => {
  it('replaces one file contribution and rebuilds index/graph', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'a.aml': aml(`
          ${model('Model.A', 'MT_EEPC', modelName('A') + objOcc('Occ.1', 'Def.L1'))}
          ${model('Model.B', 'MT_EEPC', modelName('B'))}
          ${objDef('Def.L1', 'Model.B')}
        `),
        'b.aml': aml(model('Model.C', 'MT_EEPC', modelName('C')))
      }
    })
    const entries = await adapter.list()
    const state = await scanArisWorkspaceLinks(adapter, entries, createArisLinkScanCache())

    expect(state.index.has('Model.A')).toBe(true)
    expect(state.graph.links).toHaveLength(1)

    const overlay = new Map([
      [
        'a.aml',
        {
          models: [
            { modelId: 'Model.A', name: 'A updated', modelType: 'MT_EEPC' },
            { modelId: 'Model.D', name: 'D', modelType: 'MT_EEPC' }
          ],
          assignments: [
            {
              parentModelId: 'Model.A',
              childModelId: 'Model.D',
              occurrenceIds: ['Occ.2'],
              count: 1
            }
          ]
        }
      ]
    ])

    const merged = mergeArisLinkState(state, overlay)

    expect(merged.index.get('Model.A')!.processName).toBe('A updated')
    expect(merged.index.has('Model.B')).toBe(false)
    expect(merged.index.has('Model.D')).toBe(true)
    expect(merged.graph.links).toHaveLength(1)
    expect(merged.graph.links[0]!).toMatchObject({
      parentProcessId: 'Model.A',
      childProcessId: 'Model.D',
      count: 1
    })
  })

  it('returns an empty state from the constant', () => {
    expect(EMPTY_ARIS_LINK_STATE.index.size).toBe(0)
    expect(EMPTY_ARIS_LINK_STATE.graph.links).toHaveLength(0)
    expect(EMPTY_ARIS_LINK_STATE.scannedFileCount).toBe(0)
  })
})
