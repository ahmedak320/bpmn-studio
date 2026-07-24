import { describe, it, expect } from 'vitest'
import { buildProcessIndex } from '@app/shared/processIndex'
import { buildLinkGraph } from '../../links/linkGraph'
import {
  LIBRARY_MANIFEST_NAME,
  buildLibraryManifest,
  parseLibraryManifest,
  serializeLibraryManifest,
  type LibraryManifest
} from '../libraryManifest'

function file(relPath: string, processId: string, calls: string[] = []): { relPath: string; xml: string } {
  const activities = calls
    .map((c, i) => `<bpmn:callActivity id="ca_${i}" calledElement="${c}" />`)
    .join('')
  return {
    relPath,
    xml:
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
      `<bpmn:process id="${processId}">${activities}</bpmn:process>` +
      '</bpmn:definitions>'
  }
}

function manifestOf(files: Array<{ relPath: string; xml: string }>): LibraryManifest {
  const index = buildProcessIndex(files)
  return buildLibraryManifest(files, index, buildLinkGraph(files, index))
}

const SAMPLE_FILES = [
  file('z-top.bpmn', 'Top', ['Mid', 'Leaf']),
  file('nested/mid.bpmn', 'Mid', ['Leaf']),
  file('a-leaf.bpmn', 'Leaf')
]

describe('buildLibraryManifest', () => {
  it('lists sorted files and (parentFile, childFile)-sorted hierarchy edges', () => {
    const manifest = manifestOf(SAMPLE_FILES)

    expect(manifest.version).toBe(1)
    expect(manifest.generator).toBe('orbitpm-lite')
    expect(manifest.files).toEqual(['a-leaf.bpmn', 'nested/mid.bpmn', 'z-top.bpmn'])
    expect(manifest.hierarchy).toEqual([
      {
        parentFile: 'nested/mid.bpmn',
        parentProcessId: 'Mid',
        childFile: 'a-leaf.bpmn',
        childProcessId: 'Leaf',
        via: 'callActivity'
      },
      {
        parentFile: 'z-top.bpmn',
        parentProcessId: 'Top',
        childFile: 'a-leaf.bpmn',
        childProcessId: 'Leaf',
        via: 'callActivity'
      },
      {
        parentFile: 'z-top.bpmn',
        parentProcessId: 'Top',
        childFile: 'nested/mid.bpmn',
        childProcessId: 'Mid',
        via: 'callActivity'
      }
    ])
  })

  it('is deterministic: shuffled input file order yields byte-identical text', () => {
    const shuffled = [SAMPLE_FILES[2], SAMPLE_FILES[0], SAMPLE_FILES[1]]
    expect(serializeLibraryManifest(manifestOf(shuffled))).toBe(
      serializeLibraryManifest(manifestOf(SAMPLE_FILES))
    )
  })

  it('carries no timestamp: serializing twice is byte-identical', () => {
    const a = serializeLibraryManifest(manifestOf(SAMPLE_FILES))
    const b = serializeLibraryManifest(manifestOf(SAMPLE_FILES))
    expect(a).toBe(b)
  })
})

describe('serializeLibraryManifest', () => {
  it('is exactly 2-space-indented JSON.stringify output', () => {
    const manifest = manifestOf([file('only.bpmn', 'Only')])
    expect(serializeLibraryManifest(manifest)).toBe(JSON.stringify(manifest, null, 2))
  })
})

describe('parseLibraryManifest — round-trip + defensiveness', () => {
  it('round-trips build → serialize → parse', () => {
    const manifest = manifestOf(SAMPLE_FILES)
    expect(parseLibraryManifest(serializeLibraryManifest(manifest))).toEqual(manifest)
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseLibraryManifest('')).toBeUndefined()
    expect(parseLibraryManifest('{not json')).toBeUndefined()
    expect(parseLibraryManifest('null')).toBeUndefined()
    expect(parseLibraryManifest('[]')).toBeUndefined()
    expect(parseLibraryManifest('"a string"')).toBeUndefined()
  })

  it('returns undefined for a wrong version or missing/foreign shape', () => {
    expect(parseLibraryManifest('{}')).toBeUndefined()
    expect(
      parseLibraryManifest('{"version":2,"generator":"orbitpm-lite","files":[],"hierarchy":[]}')
    ).toBeUndefined()
    expect(parseLibraryManifest('{"name":"somebody-elses-manifest.json"}')).toBeUndefined()
  })

  it('returns undefined for wrong field types', () => {
    const base = { version: 1, generator: 'orbitpm-lite', files: [], hierarchy: [] }
    expect(parseLibraryManifest(JSON.stringify({ ...base, generator: 7 }))).toBeUndefined()
    expect(parseLibraryManifest(JSON.stringify({ ...base, files: 'a.bpmn' }))).toBeUndefined()
    expect(parseLibraryManifest(JSON.stringify({ ...base, files: ['a.bpmn', 3] }))).toBeUndefined()
    expect(parseLibraryManifest(JSON.stringify({ ...base, hierarchy: {} }))).toBeUndefined()
  })

  it('returns undefined for a hierarchy entry that is not a full callActivity edge', () => {
    const edge = {
      parentFile: 'a.bpmn',
      parentProcessId: 'A',
      childFile: 'b.bpmn',
      childProcessId: 'B',
      via: 'callActivity'
    }
    const withEdge = (e: unknown): string =>
      JSON.stringify({ version: 1, generator: 'x', files: [], hierarchy: [e] })

    expect(parseLibraryManifest(withEdge(edge))).toBeDefined()
    expect(parseLibraryManifest(withEdge({ ...edge, via: 'link' }))).toBeUndefined()
    expect(parseLibraryManifest(withEdge({ ...edge, childFile: undefined }))).toBeUndefined()
    expect(parseLibraryManifest(withEdge({ ...edge, parentProcessId: 5 }))).toBeUndefined()
    expect(parseLibraryManifest(withEdge(null))).toBeUndefined()
    expect(parseLibraryManifest(withEdge('edge'))).toBeUndefined()
  })

  it('rebuilds a clean object: unknown extra fields are dropped', () => {
    const text = JSON.stringify({
      version: 1,
      generator: 'orbitpm-lite',
      files: ['a.bpmn'],
      hierarchy: [],
      exportedAt: '2026-07-23T00:00:00Z',
      extra: { nested: true }
    })
    const parsed = parseLibraryManifest(text)
    expect(parsed).toEqual({
      version: 1,
      generator: 'orbitpm-lite',
      files: ['a.bpmn'],
      hierarchy: []
    })
    expect(Object.keys(parsed as object).sort()).toEqual([
      'files',
      'generator',
      'hierarchy',
      'version'
    ])
  })
})

describe('LIBRARY_MANIFEST_NAME', () => {
  it('is the fixed root-level file name', () => {
    expect(LIBRARY_MANIFEST_NAME).toBe('library-manifest.json')
  })
})
