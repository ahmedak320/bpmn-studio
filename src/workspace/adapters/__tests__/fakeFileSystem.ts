import { copyBytes } from '../hash'

type FakeEntry = FakeDirectoryHandle | FakeFileHandle

function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

function chunkBytes(chunk: unknown): Uint8Array<ArrayBuffer> {
  if (typeof chunk === 'string') return copyBytes(new TextEncoder().encode(chunk))
  if (chunk instanceof ArrayBuffer) return copyBytes(new Uint8Array(chunk))
  if (ArrayBuffer.isView(chunk)) {
    return copyBytes(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  }
  throw new TypeError('Unsupported fake writable chunk.')
}

export class FakeFileHandle {
  readonly kind = 'file' as const
  bytes: Uint8Array<ArrayBuffer>
  lastModified: number
  type: string
  unreadable = false
  failNextClose?: Error

  constructor(
    readonly name: string,
    bytes: Uint8Array | string = '',
    options: { lastModified?: number; type?: string } = {}
  ) {
    this.bytes = copyBytes(
      typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
    )
    this.lastModified = options.lastModified ?? 1
    this.type = options.type ?? (/\.bpmn$/i.test(name) ? 'application/xml' : '')
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === (this as unknown as FileSystemHandle)
  }

  async getFile(): Promise<File> {
    if (this.unreadable) throw namedError('NotReadableError', `${this.name} is unreadable`)
    return new File([copyBytes(this.bytes)], this.name, {
      type: this.type,
      lastModified: this.lastModified
    })
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    let staged = new Uint8Array(new ArrayBuffer(0))
    let aborted = false
    const writable = {
      write: async (chunk: unknown) => {
        if (aborted) throw namedError('InvalidStateError', 'Writable was aborted')
        staged = chunkBytes(chunk)
      },
      close: async () => {
        if (aborted) throw namedError('InvalidStateError', 'Writable was aborted')
        if (this.failNextClose) {
          const error = this.failNextClose
          this.failNextClose = undefined
          throw error
        }
        this.bytes = copyBytes(staged)
        this.lastModified += 1
      },
      abort: async () => {
        aborted = true
      }
    }
    return writable as unknown as FileSystemWritableFileStream
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory' as const
  readonly children = new Map<string, FakeEntry>()
  permission: PermissionState = 'granted'
  failEnumeration?: Error

  constructor(
    readonly name: string,
    readonly caseInsensitive = false
  ) {}

  private matchingKey(name: string): string | undefined {
    if (this.children.has(name)) return name
    if (!this.caseInsensitive) return undefined
    const folded = name.toLocaleLowerCase('en-US')
    return [...this.children.keys()].find(
      (candidate) => candidate.toLocaleLowerCase('en-US') === folded
    )
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === (this as unknown as FileSystemHandle)
  }

  async queryPermission(): Promise<PermissionState> {
    return this.permission
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {}
  ): Promise<FileSystemFileHandle> {
    const key = this.matchingKey(name)
    if (key !== undefined) {
      const entry = this.children.get(key)!
      if (entry.kind !== 'file') throw namedError('TypeMismatchError', `${name} is a folder`)
      return entry as unknown as FileSystemFileHandle
    }
    if (!options.create) throw namedError('NotFoundError', `${name} was not found`)
    const file = new FakeFileHandle(name)
    this.children.set(name, file)
    return file as unknown as FileSystemFileHandle
  }

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {}
  ): Promise<FileSystemDirectoryHandle> {
    const key = this.matchingKey(name)
    if (key !== undefined) {
      const entry = this.children.get(key)!
      if (entry.kind !== 'directory') {
        throw namedError('TypeMismatchError', `${name} is a file`)
      }
      return entry as unknown as FileSystemDirectoryHandle
    }
    if (!options.create) throw namedError('NotFoundError', `${name} was not found`)
    const directory = new FakeDirectoryHandle(name, this.caseInsensitive)
    directory.permission = this.permission
    this.children.set(name, directory)
    return directory as unknown as FileSystemDirectoryHandle
  }

  async removeEntry(
    name: string,
    options: { recursive?: boolean } = {}
  ): Promise<void> {
    const key = this.matchingKey(name)
    if (key === undefined) throw namedError('NotFoundError', `${name} was not found`)
    const entry = this.children.get(key)!
    if (
      entry.kind === 'directory' &&
      entry.children.size > 0 &&
      options.recursive !== true
    ) {
      throw namedError('InvalidModificationError', `${name} is not empty`)
    }
    this.children.delete(key)
  }

  async *entries(): AsyncIterableIterator<
    [string, FileSystemFileHandle | FileSystemDirectoryHandle]
  > {
    if (this.failEnumeration) throw this.failEnumeration
    for (const [name, entry] of [...this.children]) {
      yield [
        name,
        entry as unknown as FileSystemFileHandle | FileSystemDirectoryHandle
      ]
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const [name] of this.children) yield name
  }

  async *values(): AsyncIterableIterator<
    FileSystemFileHandle | FileSystemDirectoryHandle
  > {
    for (const entry of this.children.values()) {
      yield entry as unknown as FileSystemFileHandle | FileSystemDirectoryHandle
    }
  }

  directory(path: string): FakeDirectoryHandle {
    let directory: FakeDirectoryHandle = this
    for (const segment of path.split('/').filter(Boolean)) {
      const key = directory.matchingKey(segment)
      const entry = key === undefined ? undefined : directory.children.get(key)
      if (!entry || entry.kind !== 'directory') throw new Error(`Missing fake folder ${path}`)
      directory = entry
    }
    return directory
  }

  file(path: string): FakeFileHandle {
    const segments = path.split('/').filter(Boolean)
    const name = segments.pop()
    if (!name) throw new Error('A fake file path is required.')
    const directory = this.directory(segments.join('/'))
    const key = directory.matchingKey(name)
    const entry = key === undefined ? undefined : directory.children.get(key)
    if (!entry || entry.kind !== 'file') throw new Error(`Missing fake file ${path}`)
    return entry
  }

  addDirectory(path: string): FakeDirectoryHandle {
    let directory: FakeDirectoryHandle = this
    for (const segment of path.split('/').filter(Boolean)) {
      const key = directory.matchingKey(segment)
      const existing = key === undefined ? undefined : directory.children.get(key)
      if (existing?.kind === 'file') throw new Error(`${segment} is already a file`)
      if (existing) {
        directory = existing
      } else {
        const child = new FakeDirectoryHandle(segment, this.caseInsensitive)
        child.permission = this.permission
        directory.children.set(segment, child)
        directory = child
      }
    }
    return directory
  }

  addFile(
    path: string,
    bytes: Uint8Array | string,
    options: { lastModified?: number; type?: string } = {}
  ): FakeFileHandle {
    const segments = path.split('/').filter(Boolean)
    const name = segments.pop()
    if (!name) throw new Error('A fake file path is required.')
    const directory = this.addDirectory(segments.join('/'))
    const file = new FakeFileHandle(name, bytes, options)
    directory.children.set(name, file)
    return file
  }
}

export function fakeRoot(
  options: { caseInsensitive?: boolean } = {}
): FakeDirectoryHandle {
  return new FakeDirectoryHandle('workspace', options.caseInsensitive ?? false)
}

export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
  return fake as unknown as FileSystemDirectoryHandle
}
