import { describe, it, expect } from 'vitest'
import {
  buildTree,
  listBpmnFiles,
  readFileAt,
  writeFileAt,
  createFolderAt,
  createBpmnFileAt,
  deleteAt,
  renameAt,
  bpmnSlugsIn,
  countBpmnFiles,
  resolveDir,
  segments,
  joinRel,
  dirOf,
  baseOf,
  type LiteTreeNode
} from '../fs/fsAccess'

// --- In-memory mock of the File System Access API ------------------------
// Just enough of FileSystemDirectoryHandle / FileSystemFileHandle for the
// adapter: directory/file handles with getFileHandle/getDirectoryHandle/
// removeEntry/entries and a getFile/createWritable round-trip.

class MockFileHandle {
  kind = 'file' as const
  constructor(
    public name: string,
    public content = ''
  ) {}
  async getFile(): Promise<{ text: () => Promise<string> }> {
    return { text: async () => this.content }
  }
  async createWritable(): Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> {
    let buf = ''
    return {
      write: async (data: string) => {
        buf += data
      },
      close: async () => {
        this.content = buf
      }
    }
  }
}

class MockDirectoryHandle {
  kind = 'directory' as const
  entriesMap = new Map<string, MockDirectoryHandle | MockFileHandle>()
  constructor(public name: string) {}

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {}
  ): Promise<MockDirectoryHandle> {
    const existing = this.entriesMap.get(name)
    if (existing) {
      if (existing.kind !== 'directory') throw new Error(`${name} is a file`)
      return existing
    }
    if (!options.create) {
      const e = new Error(`NotFound: ${name}`)
      e.name = 'NotFoundError'
      throw e
    }
    const dir = new MockDirectoryHandle(name)
    this.entriesMap.set(name, dir)
    return dir
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {}
  ): Promise<MockFileHandle> {
    const existing = this.entriesMap.get(name)
    if (existing) {
      if (existing.kind !== 'file') throw new Error(`${name} is a directory`)
      return existing
    }
    if (!options.create) {
      const e = new Error(`NotFound: ${name}`)
      e.name = 'NotFoundError'
      throw e
    }
    const file = new MockFileHandle(name)
    this.entriesMap.set(name, file)
    return file
  }

  async removeEntry(name: string, _options: { recursive?: boolean } = {}): Promise<void> {
    if (!this.entriesMap.has(name)) {
      const e = new Error(`NotFound: ${name}`)
      e.name = 'NotFoundError'
      throw e
    }
    this.entriesMap.delete(name)
  }

  async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
    for (const [name, handle] of this.entriesMap) yield [name, handle]
  }
}

// Cast the mock to the real handle type at the call boundary — the adapter only
// touches the subset the mock implements.
function newRoot(name = 'workspace'): FileSystemDirectoryHandle {
  return new MockDirectoryHandle(name) as unknown as FileSystemDirectoryHandle
}

function findChild(node: LiteTreeNode, relPath: string): LiteTreeNode | undefined {
  if (node.relPath === relPath) return node
  for (const child of node.children ?? []) {
    const hit = findChild(child, relPath)
    if (hit) return hit
  }
  return undefined
}

describe('path helpers', () => {
  it('segments strips empties and slashes', () => {
    expect(segments('')).toEqual([])
    expect(segments('a/b/c')).toEqual(['a', 'b', 'c'])
    expect(segments('/a//b/')).toEqual(['a', 'b'])
  })
  it('joinRel joins parent and name', () => {
    expect(joinRel('', 'a.bpmn')).toBe('a.bpmn')
    expect(joinRel('sub', 'a.bpmn')).toBe('sub/a.bpmn')
    expect(joinRel('sub/', 'a.bpmn')).toBe('sub/a.bpmn')
  })
  it('dirOf / baseOf split a relPath', () => {
    expect(dirOf('a.bpmn')).toBe('')
    expect(dirOf('sub/dir/a.bpmn')).toBe('sub/dir')
    expect(baseOf('a.bpmn')).toBe('a.bpmn')
    expect(baseOf('sub/dir/a.bpmn')).toBe('a.bpmn')
  })
})

describe('write/read round-trip', () => {
  it('writes a file at the root and reads it back', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', '<xml>hello</xml>')
    expect(await readFileAt(root, 'order.bpmn')).toBe('<xml>hello</xml>')
  })

  it('creates intermediate folders when writing a nested file', async () => {
    const root = newRoot()
    await writeFileAt(root, 'a/b/c/deep.bpmn', 'NESTED')
    expect(await readFileAt(root, 'a/b/c/deep.bpmn')).toBe('NESTED')
    // The intermediate dirs must be real, navigable directory handles.
    const dir = await resolveDir(root, 'a/b/c')
    expect(dir.kind).toBe('directory')
  })

  it('overwrites an existing file', async () => {
    const root = newRoot()
    await writeFileAt(root, 'x.bpmn', 'v1')
    await writeFileAt(root, 'x.bpmn', 'v2-longer')
    expect(await readFileAt(root, 'x.bpmn')).toBe('v2-longer')
  })
})

describe('createFolderAt / createBpmnFileAt', () => {
  it('creates a folder and returns its relPath', async () => {
    const root = newRoot()
    const rel = await createFolderAt(root, '', 'Invoices')
    expect(rel).toBe('Invoices')
    const dir = await resolveDir(root, 'Invoices')
    expect(dir.kind).toBe('directory')
  })

  it('creates a nested folder under a parent relPath', async () => {
    const root = newRoot()
    await createFolderAt(root, '', 'Invoices')
    const rel = await createFolderAt(root, 'Invoices', 'Q1')
    expect(rel).toBe('Invoices/Q1')
  })

  it('creates a <slug>.bpmn file with the given xml', async () => {
    const root = newRoot()
    const rel = await createBpmnFileAt(root, 'Invoices', 'new-order', '<def/>')
    expect(rel).toBe('Invoices/new-order.bpmn')
    expect(await readFileAt(root, rel)).toBe('<def/>')
  })
})

describe('bpmnSlugsIn', () => {
  it('reports bare, lowercased slugs of .bpmn files in a folder only', async () => {
    const root = newRoot()
    await writeFileAt(root, 'Order.bpmn', 'a')
    await writeFileAt(root, 'Refund.BPMN', 'b')
    await writeFileAt(root, 'notes.txt', 'c')
    await createFolderAt(root, '', 'sub')
    const slugs = await bpmnSlugsIn(root, '')
    expect(slugs.has('order')).toBe(true)
    expect(slugs.has('refund')).toBe(true)
    expect(slugs.has('notes')).toBe(false)
    expect(slugs.has('sub')).toBe(false)
  })

  it('returns an empty set for a missing folder', async () => {
    const root = newRoot()
    expect((await bpmnSlugsIn(root, 'does/not/exist')).size).toBe(0)
  })
})

describe('deleteAt', () => {
  it('deletes a file', async () => {
    const root = newRoot()
    await writeFileAt(root, 'gone.bpmn', 'x')
    await deleteAt(root, 'gone.bpmn', 'file')
    await expect(readFileAt(root, 'gone.bpmn')).rejects.toBeTruthy()
  })

  it('deletes a nested folder recursively', async () => {
    const root = newRoot()
    await writeFileAt(root, 'dir/inner.bpmn', 'x')
    await deleteAt(root, 'dir', 'directory')
    await expect(resolveDir(root, 'dir')).rejects.toBeTruthy()
  })
})

describe('renameAt', () => {
  it('renames a file (copy bytes + delete old), returning the new relPath', async () => {
    const root = newRoot()
    await writeFileAt(root, 'sub/old.bpmn', 'CONTENT')
    const newRel = await renameAt(root, 'sub/old.bpmn', 'new.bpmn', 'file')
    expect(newRel).toBe('sub/new.bpmn')
    expect(await readFileAt(root, 'sub/new.bpmn')).toBe('CONTENT')
    await expect(readFileAt(root, 'sub/old.bpmn')).rejects.toBeTruthy()
  })

  it('renames a folder recursively', async () => {
    const root = newRoot()
    await writeFileAt(root, 'Old/a.bpmn', 'A')
    await writeFileAt(root, 'Old/deep/b.bpmn', 'B')
    const newRel = await renameAt(root, 'Old', 'New', 'directory')
    expect(newRel).toBe('New')
    expect(await readFileAt(root, 'New/a.bpmn')).toBe('A')
    expect(await readFileAt(root, 'New/deep/b.bpmn')).toBe('B')
    await expect(resolveDir(root, 'Old')).rejects.toBeTruthy()
  })

  it('refuses to overwrite an existing sibling name', async () => {
    const root = newRoot()
    await writeFileAt(root, 'a.bpmn', 'A')
    await writeFileAt(root, 'b.bpmn', 'B')
    await expect(renameAt(root, 'a.bpmn', 'b.bpmn', 'file')).rejects.toThrow(/already exists/i)
    // originals intact
    expect(await readFileAt(root, 'a.bpmn')).toBe('A')
    expect(await readFileAt(root, 'b.bpmn')).toBe('B')
  })
})

describe('buildTree', () => {
  it('builds a sorted tree of folders-first, .bpmn-only', async () => {
    const root = newRoot('MyWorkspace')
    await writeFileAt(root, 'zeta.bpmn', '<a/>')
    await writeFileAt(root, 'alpha.bpmn', '<a/>')
    await writeFileAt(root, 'ignore.txt', 'nope')
    await writeFileAt(root, 'Sub/child.bpmn', '<a/>')
    await createFolderAt(root, '', 'Archive')

    const tree = await buildTree(root, 'MyWorkspace')
    expect(tree.relPath).toBe('')
    expect(tree.name).toBe('MyWorkspace')
    expect(tree.type).toBe('directory')

    const names = (tree.children ?? []).map((c) => `${c.type}:${c.name}`)
    // Folders (Archive, Sub) sort before files (alpha, zeta); .txt excluded.
    expect(names).toEqual(['directory:Archive', 'directory:Sub', 'file:alpha.bpmn', 'file:zeta.bpmn'])

    const sub = findChild(tree, 'Sub')
    expect(sub?.children?.map((c) => c.relPath)).toEqual(['Sub/child.bpmn'])
    expect(findChild(tree, 'ignore.txt')).toBeUndefined()
  })
})

describe('countBpmnFiles (drives the empty-state card)', () => {
  it('returns 0 for a freshly-opened empty folder', async () => {
    const root = newRoot('Empty')
    const tree = await buildTree(root, 'Empty')
    expect(countBpmnFiles(tree)).toBe(0)
  })

  it('returns 0 when the folder only has non-.bpmn files and empty subfolders', async () => {
    const root = newRoot()
    await writeFileAt(root, 'readme.txt', 'x')
    await createFolderAt(root, '', 'drafts')
    const tree = await buildTree(root, 'ws')
    expect(countBpmnFiles(tree)).toBe(0)
  })

  it('counts every .bpmn file across nested folders', async () => {
    const root = newRoot()
    await writeFileAt(root, 'a.bpmn', 'x')
    await writeFileAt(root, 'sub/b.bpmn', 'x')
    await writeFileAt(root, 'sub/deep/c.bpmn', 'x')
    await writeFileAt(root, 'sub/note.md', 'x')
    const tree = await buildTree(root, 'ws')
    expect(countBpmnFiles(tree)).toBe(3)
  })

  it('handles a null tree (workspace not built yet)', () => {
    expect(countBpmnFiles(null)).toBe(0)
  })
})

describe('listBpmnFiles', () => {
  it('flattens every .bpmn file with its content, recursively', async () => {
    const root = newRoot()
    await writeFileAt(root, 'a.bpmn', 'AAA')
    await writeFileAt(root, 'sub/b.bpmn', 'BBB')
    await writeFileAt(root, 'sub/deep/c.bpmn', 'CCC')
    await writeFileAt(root, 'sub/skip.md', 'MD')

    const files = await listBpmnFiles(root)
    const byPath = Object.fromEntries(files.map((f) => [f.relPath, f.xml]))
    expect(byPath).toEqual({
      'a.bpmn': 'AAA',
      'sub/b.bpmn': 'BBB',
      'sub/deep/c.bpmn': 'CCC'
    })
  })
})
