import { describe, expect, it } from 'vitest'
import type { ProcessIndex } from '@/core/processIndex'
import type { LiteTreeNode } from '../../fs/fsAccess'
import {
  buildProcessHierarchy,
  type HierarchyDirectoryRow,
  type HierarchyFileRow,
  type ProcessHierarchyGraph,
  type ProcessHierarchyLink
} from '../processHierarchy'

function directory(
  name: string,
  relPath: string,
  children: LiteTreeNode[] = []
): LiteTreeNode {
  return { name, relPath, type: 'directory', children }
}

function file(relPath: string): LiteTreeNode {
  return {
    name: relPath.split('/').pop() ?? relPath,
    relPath,
    type: 'file'
  }
}

function rootWith(...nodes: LiteTreeNode[]): LiteTreeNode {
  return directory('workspace', '', nodes)
}

function indexOf(
  entries: Array<[processId: string, relPath: string, processName?: string]>
): ProcessIndex {
  return new Map(
    entries.map(([processId, relPath, processName]) => [
      processId,
      { processId, relPath, processName }
    ])
  )
}

function link(
  parentProcessId: string,
  childProcessId: string,
  options: { callActivityIds?: string[]; count?: number } = {}
): ProcessHierarchyLink {
  return {
    key: JSON.stringify([parentProcessId, childProcessId]),
    parentProcessId,
    childProcessId,
    parentRelPath: `${parentProcessId}.bpmn`,
    childRelPath: `${childProcessId}.bpmn`,
    callActivityIds:
      options.callActivityIds ?? [`call_${parentProcessId}_${childProcessId}`],
    count: options.count ?? 1
  }
}

function graph(
  links: ProcessHierarchyLink[],
  ambiguousProcessIds: string[] = []
): ProcessHierarchyGraph {
  return { links, ambiguousProcessIds: new Set(ambiguousProcessIds) }
}

function rootDirectory(
  result: ReturnType<typeof buildProcessHierarchy>
): HierarchyDirectoryRow {
  expect(result.root?.kind).toBe('directory')
  return result.root as HierarchyDirectoryRow
}

function canonical(
  result: ReturnType<typeof buildProcessHierarchy>,
  processId: string
): HierarchyFileRow {
  const row = result.canonicalByProcessId.get(processId)
  expect(row).toBeDefined()
  return row!
}

describe('buildProcessHierarchy — owned and reused subprocesses', () => {
  it('nests a singly-owned subprocess and removes its duplicate physical occurrence', () => {
    const result = buildProcessHierarchy(
      rootWith(
        directory('z', 'z', [file('z/child.bpmn')]),
        file('parent.bpmn'),
        file('parent.bpmn')
      ),
      indexOf([
        ['P', 'parent.bpmn', 'Parent'],
        ['C', 'z/child.bpmn', 'Child']
      ]),
      graph([link('P', 'C')])
    )

    const parent = canonical(result, 'P')
    const child = canonical(result, 'C')
    expect(result.canonicalByRelPath.size).toBe(2)
    expect(parent.ownedChildren).toEqual([child])
    expect(parent.references).toEqual([])
    expect(child).toMatchObject({
      owned: true,
      ownerParentProcessId: 'P',
      ownerCallCount: 1,
      ancestorRowKeys: [parent.key]
    })
    const z = rootDirectory(result).children[0] as HierarchyDirectoryRow
    expect(z.kind).toBe('directory')
    expect(z.children).toEqual([])
    expect(
      rootDirectory(result).children.filter((row) => row.kind === 'file')
    ).toEqual([parent])
  })

  it('keeps unlinked files in their physical folders', () => {
    const result = buildProcessHierarchy(
      rootWith(
        directory('misc', 'misc', [file('misc/orphan.bpmn')]),
        file('root.bpmn')
      ),
      indexOf([
        ['O', 'misc/orphan.bpmn'],
        ['R', 'root.bpmn']
      ]),
      graph([])
    )

    expect(canonical(result, 'O')).toMatchObject({
      owned: false,
      ancestorDirectoryPaths: ['', 'misc'],
      ancestorRowKeys: []
    })
    expect(rootDirectory(result).children.map((row) => row.name)).toEqual([
      'misc',
      'root.bpmn'
    ])
  })

  it('uses one deterministic owner and a clear read-only reference for reuse', () => {
    const result = buildProcessHierarchy(
      rootWith(file('a.bpmn'), file('b.bpmn'), file('child.bpmn')),
      indexOf([
        ['A', 'a.bpmn'],
        ['B', 'b.bpmn'],
        ['C', 'child.bpmn', 'Shared child']
      ]),
      graph([
        link('B', 'C'),
        link('A', 'C', {
          callActivityIds: ['call_2', 'call_1'],
          count: 2
        })
      ])
    )

    const child = canonical(result, 'C')
    expect(result.sharedProcessIds).toEqual(new Set(['C']))
    expect(canonical(result, 'A').ownedChildren).toEqual([child])
    expect(child).toMatchObject({
      owned: true,
      shared: true,
      ownerParentProcessId: 'A',
      ownerCallActivityIds: ['call_1', 'call_2'],
      ownerCallCount: 2,
      distinctParentCount: 2
    })
    expect(canonical(result, 'B').references).toHaveLength(1)
    expect(canonical(result, 'B').references[0]).toMatchObject({
      kind: 'reference',
      processId: 'C',
      sourceParentProcessId: 'B',
      readOnly: true,
      actionable: false,
      shared: true,
      expandable: false
    })
  })

  it('keeps owner-tree descendants canonical and exposes a reused DAG link only at the other parent', () => {
    const result = buildProcessHierarchy(
      rootWith(
        file('a.bpmn'),
        file('b.bpmn'),
        file('c.bpmn'),
        file('d.bpmn')
      ),
      indexOf([
        ['A', 'a.bpmn'],
        ['B', 'b.bpmn'],
        ['C', 'c.bpmn'],
        ['D', 'd.bpmn', 'Shared D']
      ]),
      graph([
        link('A', 'B'),
        link('A', 'C'),
        link('B', 'D'),
        link('C', 'D')
      ])
    )

    const a = canonical(result, 'A')
    const b = canonical(result, 'B')
    const c = canonical(result, 'C')
    const d = canonical(result, 'D')
    expect(a.ownedChildren).toEqual([b, c])
    expect(b.ownedChildren).toEqual([d])
    expect(c.references[0]).toMatchObject({
      processId: 'D',
      canonicalPath: 'd.bpmn',
      navigation: {
        processId: 'D',
        canonicalRowKey: d.key,
        ancestorDirectoryPaths: [''],
        ancestorRowKeys: [a.key, b.key]
      }
    })
  })
})
describe('buildProcessHierarchy — cycles, identity, and safety', () => {
  it('cuts ownership cycles deterministically and shows self/back references', () => {
    const result = buildProcessHierarchy(
      rootWith(file('a.bpmn'), file('b.bpmn')),
      indexOf([
        ['A', 'a.bpmn'],
        ['B', 'b.bpmn']
      ]),
      graph([link('A', 'A'), link('A', 'B'), link('B', 'A')])
    )

    const a = canonical(result, 'A')
    const b = canonical(result, 'B')
    expect(a.owned).toBe(false)
    expect(a.ownedChildren).toEqual([b])
    expect(a.references[0]).toMatchObject({
      processId: 'A',
      cycle: 'self'
    })
    expect(b.references[0]).toMatchObject({
      processId: 'A',
      cycle: 'back'
    })
  })

  it('keeps semantic row keys stable across file renames and updates reveal locators', () => {
    const before = buildProcessHierarchy(
      rootWith(
        directory('old', 'old', [
          file('old/a.bpmn'),
          file('old/b.bpmn')
        ])
      ),
      indexOf([
        ['A', 'old/a.bpmn'],
        ['B', 'old/b.bpmn']
      ]),
      graph([link('A', 'B')])
    )
    const after = buildProcessHierarchy(
      rootWith(
        directory('new', 'new', [
          file('new/renamed-a.bpmn'),
          file('new/renamed-b.bpmn')
        ])
      ),
      indexOf([
        ['A', 'new/renamed-a.bpmn'],
        ['B', 'new/renamed-b.bpmn']
      ]),
      graph([link('A', 'B')])
    )

    expect(canonical(before, 'A').key).toBe(canonical(after, 'A').key)
    expect(canonical(before, 'B').key).toBe(canonical(after, 'B').key)
    expect(canonical(after, 'B')).toMatchObject({
      canonicalPath: 'new/renamed-b.bpmn',
      ancestorDirectoryPaths: ['', 'new'],
      ancestorRowKeys: [canonical(after, 'A').key]
    })
  })

  it('does not canonicalize ambiguous duplicate process ids', () => {
    const result = buildProcessHierarchy(
      rootWith(file('one.bpmn'), file('two.bpmn')),
      indexOf([['DUP', 'two.bpmn']]),
      graph([], ['DUP'])
    )

    expect(result.ambiguousProcessIds).toEqual(new Set(['DUP']))
    expect(result.canonicalByProcessId.has('DUP')).toBe(false)
    expect(result.canonicalPathByProcessId.has('DUP')).toBe(false)
    expect(result.canonicalByRelPath.get('two.bpmn')?.key).toBe(
      'file-path:"two.bpmn"'
    )
  })

  it('leaves a multi-process file physical when its processes disagree on ownership', () => {
    const result = buildProcessHierarchy(
      rootWith(
        file('a.bpmn'),
        file('b.bpmn'),
        file('multi.bpmn')
      ),
      indexOf([
        ['A', 'a.bpmn'],
        ['B', 'b.bpmn'],
        ['X', 'multi.bpmn'],
        ['Y', 'multi.bpmn']
      ]),
      graph([link('A', 'X'), link('B', 'Y')])
    )

    expect(result.canonicalByRelPath.get('multi.bpmn')).toMatchObject({
      owned: false,
      ownerParentProcessId: null
    })
    expect(rootDirectory(result).children.map((row) => row.name)).toContain(
      'multi.bpmn'
    )
  })
})
