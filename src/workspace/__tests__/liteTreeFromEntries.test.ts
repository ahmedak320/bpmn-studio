import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '../adapters/types'
import { buildProcessHierarchy } from '../processHierarchy'
import {
  buildLiteTreeFromEntries,
  collectFolderOptions,
  countTreeFiles,
  EMPTY_PROCESS_GRAPH,
  EMPTY_PROCESS_INDEX,
  uniquePathIn
} from '../liteTreeFromEntries'

function fileEntry(path: string): WorkspaceEntry {
  return {
    path,
    name: path.split('/').pop() ?? path,
    parentPath: '',
    kind: 'file',
    readable: true
  }
}

function directoryEntry(path: string): WorkspaceEntry {
  return {
    path,
    name: path.split('/').pop() ?? path,
    parentPath: '',
    kind: 'directory',
    readable: true
  }
}

describe('buildLiteTreeFromEntries', () => {
  it('builds nested directories and files, sorting folders before files case-insensitively', () => {
    const entries: WorkspaceEntry[] = [
      fileEntry('zulu.bpmn'),
      fileEntry('alpha.bpmn'),
      fileEntry('nested/charlie.aml'),
      directoryEntry('nested'),
      fileEntry('nested/bravo.apc'),
      fileEntry('Bravo/beta.xml')
    ]

    const tree = buildLiteTreeFromEntries(entries, 'workspace')

    expect(tree).toMatchObject({
      name: 'workspace',
      relPath: '',
      type: 'directory'
    })
    expect(tree.children?.map((child) => child.name)).toEqual([
      'Bravo',
      'nested',
      'alpha.bpmn',
      'zulu.bpmn'
    ])
    expect(tree.children?.[0]?.type).toBe('directory')
    expect(tree.children?.[1]?.type).toBe('directory')
    expect(tree.children?.[2]?.type).toBe('file')
    expect(tree.children?.[3]?.type).toBe('file')

    const nested = tree.children?.find((child) => child.name === 'nested')
    expect(nested?.children?.map((child) => child.name)).toEqual(['bravo.apc', 'charlie.aml'])
    expect(nested?.children?.every((child) => child.type === 'file')).toBe(true)

    const bravoDir = tree.children?.find((child) => child.name === 'Bravo')
    expect(bravoDir?.children?.map((child) => child.name)).toEqual(['beta.xml'])
  })

  it('drops entries under hidden root directories', () => {
    const entries: WorkspaceEntry[] = [
      fileEntry('.orbitpm/settings.json'),
      fileEntry('.orbitpm/backup.bpmn'),
      fileEntry('visible.bpmn'),
      directoryEntry('.orbitpm'),
      fileEntry('.gitignore')
    ]

    const tree = buildLiteTreeFromEntries(entries, 'workspace')
    expect(tree.children?.map((child) => child.name)).toEqual(['visible.bpmn'])
  })

  it('preserves empty directory entries as expandable folders', () => {
    const entries: WorkspaceEntry[] = [directoryEntry('empty')]
    const tree = buildLiteTreeFromEntries(entries, 'workspace')
    expect(tree.children?.map((child) => child.name)).toEqual(['empty'])
    expect(tree.children?.[0]).toMatchObject({
      type: 'directory',
      children: []
    })
  })

  it('synthesizes parent directories when only file entries exist', () => {
    const entries: WorkspaceEntry[] = [fileEntry('only-files/a/deep.bpmn')]
    const tree = buildLiteTreeFromEntries(entries, 'workspace')

    expect(tree.children?.map((child) => child.name)).toEqual(['only-files'])
    const onlyFiles = tree.children?.[0]
    expect(onlyFiles?.type).toBe('directory')
    expect(onlyFiles?.children?.map((child) => child.name)).toEqual(['a'])
    const a = onlyFiles?.children?.[0]
    expect(a?.children?.map((child) => child.name)).toEqual(['deep.bpmn'])
    expect(a?.children?.[0]?.type).toBe('file')
  })

  it('uses the supplied includeFile filter', () => {
    const entries: WorkspaceEntry[] = [
      fileEntry('keep.bpmn'),
      fileEntry('drop.txt'),
      fileEntry('keep.aml')
    ]
    const tree = buildLiteTreeFromEntries(entries, 'workspace', {
      includeFile: (entry) => entry.name.endsWith('.bpmn')
    })
    expect(tree.children?.map((child) => child.name)).toEqual(['keep.bpmn'])
  })

  it('keeps .bpmn files in the tree', () => {
    const entries: WorkspaceEntry[] = [fileEntry('process.bpmn')]
    const tree = buildLiteTreeFromEntries(entries, 'workspace')
    expect(tree.children?.map((child) => child.name)).toEqual(['process.bpmn'])
    expect(tree.children?.[0]?.type).toBe('file')
  })
})

describe('collectFolderOptions', () => {
  it('lists every directory depth-first, root first, using relPath as label', () => {
    const tree = buildLiteTreeFromEntries(
      [
        directoryEntry('a'),
        directoryEntry('a/b'),
        fileEntry('a/b/file.bpmn'),
        fileEntry('root.bpmn')
      ],
      'workspace'
    )

    const options = collectFolderOptions(tree, 'workspace')
    expect(options).toEqual([
      { relPath: '', label: 'workspace' },
      { relPath: 'a', label: 'a' },
      { relPath: 'a/b', label: 'a/b' }
    ])
  })
})

describe('countTreeFiles', () => {
  it('counts files recursively and is null-safe', () => {
    const tree = buildLiteTreeFromEntries(
      [
        fileEntry('one.bpmn'),
        fileEntry('dir/two.aml'),
        directoryEntry('dir'),
        directoryEntry('empty')
      ],
      'workspace'
    )
    expect(countTreeFiles(tree)).toBe(2)
    expect(countTreeFiles(null)).toBe(0)
  })
})

describe('uniquePathIn', () => {
  it('returns the joined path when there is no collision', () => {
    expect(uniquePathIn(new Set(['other']), 'dir', 'file.bpmn')).toBe('dir/file.bpmn')
  })

  it('appends a numeric suffix before the extension on collision', () => {
    const taken = new Set(['dir/file.bpmn'])
    expect(uniquePathIn(taken, 'dir', 'file.bpmn')).toBe('dir/file-2.bpmn')
  })

  it('increments the suffix until the path is unique', () => {
    const taken = new Set(['dir/file.bpmn', 'dir/file-2.bpmn', 'dir/file-3.bpmn'])
    expect(uniquePathIn(taken, 'dir', 'file.bpmn')).toBe('dir/file-4.bpmn')
  })

  it('is case-insensitive', () => {
    const taken = new Set(['dir/file.bpmn'])
    expect(uniquePathIn(taken, 'dir', 'FILE.BPMN')).toBe('dir/FILE-2.BPMN')
  })

  it('handles file names without extensions', () => {
    const taken = new Set(['dir/README'])
    expect(uniquePathIn(taken, 'dir', 'README')).toBe('dir/README-2')
  })
})

describe('integration pin with buildProcessHierarchy', () => {
  it('produces two canonical file rows and zero reference rows for an unlinked tree', () => {
    const tree = buildLiteTreeFromEntries(
      [fileEntry('first.bpmn'), fileEntry('second.bpmn')],
      'workspace'
    )
    const hierarchy = buildProcessHierarchy(tree, EMPTY_PROCESS_INDEX, EMPTY_PROCESS_GRAPH)

    const fileRows: unknown[] = []
    const referenceRows: unknown[] = []
    function walk(node: ReturnType<typeof buildProcessHierarchy>['root']): void {
      if (!node) return
      if (node.kind === 'file') {
        fileRows.push(node)
        referenceRows.push(...node.references)
        for (const child of node.ownedChildren) walk(child)
      } else {
        for (const child of node.children) walk(child)
      }
    }
    walk(hierarchy.root)

    expect(fileRows).toHaveLength(2)
    expect(referenceRows).toHaveLength(0)
    expect(hierarchy.ambiguousProcessIds.size).toBe(0)
  })
})
