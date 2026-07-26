// Shared in-memory mock of the File System Access API for the W2B fs tests
// (move / count / scan) and the import-drop handle walk. Richer than the inline
// mock in fsAccess.test.ts: file handles also report `lastModified` and `size`,
// which scanWorkspaceFiles (catalog / search metadata) reads. NOT a *.test file
// so vitest doesn't collect it.

type WriteChunk = string | ArrayBuffer | ArrayBufferView

function toBytes(data: WriteChunk): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

export class MockFileHandle {
  kind = 'file' as const
  name: string
  /** Canonical byte store so binary content round-trips intact. */
  bytes: Uint8Array
  lastModified: number
  constructor(name: string, content: string | Uint8Array = '', lastModified?: number) {
    this.name = name
    this.bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    this.lastModified = lastModified ?? Date.now()
  }
  /** Handle identity — the FS Access API's cross-name same-inode signal. On a
   *  case-insensitive mock, `Order.bpmn` and `order.bpmn` resolve to the SAME
   *  object, so reference equality models `isSameEntry` truthfully. */
  async isSameEntry(other: unknown): Promise<boolean> {
    return other === (this as unknown)
  }
  /** Back-compat text view of the byte store (older tests read `.content`). */
  get content(): string {
    return new TextDecoder().decode(this.bytes)
  }
  get size(): number {
    return this.bytes.length
  }
  async getFile(): Promise<{
    text: () => Promise<string>
    arrayBuffer: () => Promise<ArrayBuffer>
    lastModified: number
    size: number
  }> {
    const bytes = this.bytes
    return {
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer,
      lastModified: this.lastModified,
      size: bytes.length
    }
  }
  async createWritable(): Promise<{
    write: (d: WriteChunk) => Promise<void>
    close: () => Promise<void>
  }> {
    const chunks: Uint8Array[] = []
    return {
      write: async (data: WriteChunk) => {
        chunks.push(toBytes(data))
      },
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.length, 0)
        const merged = new Uint8Array(total)
        let off = 0
        for (const c of chunks) {
          merged.set(c, off)
          off += c.length
        }
        this.bytes = merged
        this.lastModified = Date.now()
      }
    }
  }
}

export class MockDirectoryHandle {
  kind = 'directory' as const
  entriesMap = new Map<string, MockDirectoryHandle | MockFileHandle>()
  /** When true, name lookup is case-insensitive and creates that collide
   *  (case-only) return the existing entry — modelling macOS/Windows so the
   *  case-only rename data-loss path (Codex NEW-C1) is exercisable. */
  caseInsensitive: boolean
  /** Optional hook invoked at the START of each `entries()` enumeration, letting
   *  a test mutate the directory BETWEEN two independent walks — the incoherence
   *  the single-traversal snapshot fixes (Codex NEW-minor). */
  onEnumerate?: (dir: MockDirectoryHandle, count: number) => void
  private enumCount = 0
  constructor(
    public name: string,
    opts: { caseInsensitive?: boolean } = {}
  ) {
    this.caseInsensitive = opts.caseInsensitive ?? false
  }

  /** Resolve the stored key that matches `name` (exact, or case-insensitively
   *  when the mock models a case-insensitive filesystem). */
  private matchKey(name: string): string | undefined {
    if (this.entriesMap.has(name)) return name
    if (!this.caseInsensitive) return undefined
    const lower = name.toLowerCase()
    for (const key of this.entriesMap.keys()) {
      if (key.toLowerCase() === lower) return key
    }
    return undefined
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === (this as unknown)
  }

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {}
  ): Promise<MockDirectoryHandle> {
    const key = this.matchKey(name)
    if (key !== undefined) {
      const existing = this.entriesMap.get(key)!
      if (existing.kind !== 'directory') throw new Error(`${name} is a file`)
      return existing
    }
    if (!options.create) {
      const e = new Error(`NotFound: ${name}`)
      e.name = 'NotFoundError'
      throw e
    }
    const dir = new MockDirectoryHandle(name, { caseInsensitive: this.caseInsensitive })
    this.entriesMap.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MockFileHandle> {
    const key = this.matchKey(name)
    if (key !== undefined) {
      const existing = this.entriesMap.get(key)!
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
    const key = this.matchKey(name)
    if (key === undefined) {
      const e = new Error(`NotFound: ${name}`)
      e.name = 'NotFoundError'
      throw e
    }
    this.entriesMap.delete(key)
  }

  async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
    this.onEnumerate?.(this, ++this.enumCount)
    // Snapshot the entries at enumeration start so a mutation applied by the hook
    // (or mid-iteration) yields a consistent single-listing view.
    const snapshot = [...this.entriesMap]
    for (const [name, handle] of snapshot) yield [name, handle]
  }
}

/** Cast the mock to the real handle type at the call boundary — the adapter
 *  only touches the subset the mock implements. */
export function newRoot(name = 'workspace'): FileSystemDirectoryHandle {
  return new MockDirectoryHandle(name) as unknown as FileSystemDirectoryHandle
}

/** A root that models a CASE-INSENSITIVE filesystem (macOS/Windows): `A.bpmn`
 *  and `a.bpmn` resolve to the same entry. Used to prove the case-only
 *  rename/move no longer deletes the file (Codex NEW-C1). */
export function newRootCI(name = 'workspace'): FileSystemDirectoryHandle {
  return new MockDirectoryHandle(name, { caseInsensitive: true }) as unknown as FileSystemDirectoryHandle
}
