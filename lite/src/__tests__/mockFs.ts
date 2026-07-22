// Shared in-memory mock of the File System Access API for the W2B fs tests
// (move / count / scan) and the import-drop handle walk. Richer than the inline
// mock in fsAccess.test.ts: file handles also report `lastModified` and `size`,
// which scanWorkspaceFiles (catalog / search metadata) reads. NOT a *.test file
// so vitest doesn't collect it.

export class MockFileHandle {
  kind = 'file' as const
  lastModified: number
  constructor(
    public name: string,
    public content = '',
    lastModified?: number
  ) {
    this.lastModified = lastModified ?? Date.now()
  }
  get size(): number {
    return this.content.length
  }
  async getFile(): Promise<{ text: () => Promise<string>; lastModified: number; size: number }> {
    return {
      text: async () => this.content,
      lastModified: this.lastModified,
      size: this.content.length
    }
  }
  async createWritable(): Promise<{
    write: (d: string) => Promise<void>
    close: () => Promise<void>
  }> {
    let buf = ''
    return {
      write: async (data: string) => {
        buf += data
      },
      close: async () => {
        this.content = buf
        this.lastModified = Date.now()
      }
    }
  }
}

export class MockDirectoryHandle {
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

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MockFileHandle> {
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

/** Cast the mock to the real handle type at the call boundary — the adapter
 *  only touches the subset the mock implements. */
export function newRoot(name = 'workspace'): FileSystemDirectoryHandle {
  return new MockDirectoryHandle(name) as unknown as FileSystemDirectoryHandle
}
