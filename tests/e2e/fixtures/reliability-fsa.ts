import type { Page } from '@playwright/test'

export interface ReliabilityWorkspaceOptions {
  name?: string
  seed?: Record<string, string>
  unreadable?: string[]
  pickerBehavior?: 'resolve' | 'abort'
  alternateRoot?: {
    name: string
    seed: Record<string, string>
  }
}

export interface ReliabilityWorkspaceSnapshot {
  directories: string[]
  files: Record<string, { base64: string; modified: number; type: string }>
  permission: PermissionState
  unreadable: string[]
  pickerBehavior: 'resolve' | 'abort'
  pickerRoot: 'primary' | 'alternate'
  pickerCalls: number
  writes: Array<{ path: string; size: number; modified: number }>
  failNextWrites: Record<string, string>
  clock: number
}

declare global {
  interface Window {
    __ORBITPM_RELIABILITY_FS__: {
      snapshot(): ReliabilityWorkspaceSnapshot
      paths(): string[]
      read(path: string): string | null
      writeExternal(path: string, contents: string): void
      deleteExternal(path: string): void
      setPermission(permission: PermissionState): void
      setUnreadable(paths: string[]): void
      setPickerBehavior(behavior: 'resolve' | 'abort'): void
      setPickerRoot(root: 'primary' | 'alternate'): void
      pathsInRoot(root: 'primary' | 'alternate'): string[]
      readFromRoot(root: 'primary' | 'alternate', path: string): string | null
      failNextWrite(path: string, errorName: string): void
      clearWrites(): void
    }
  }
}

/**
 * A stateful, reload-safe File System Access test fixture.
 *
 * The application still runs its production DirectoryWorkspaceAdapter and
 * document-session code. Only the native picker/handles are supplied by this
 * fixture because Playwright cannot operate Chromium's native folder chooser.
 * Files are byte-backed and persisted in localStorage so reload and multi-page
 * tests observe the same backing store.
 */
export async function installReliabilityWorkspace(
  page: Page,
  options: ReliabilityWorkspaceOptions = {}
): Promise<void> {
  await page.addInitScript(
    (configuration: {
      name: string
      seed: Record<string, string>
      unreadable: string[]
      pickerBehavior: 'resolve' | 'abort'
      alternateRoot: { name: string; seed: Record<string, string> } | null
    }) => {
      type StoredFile = { base64: string; modified: number; type: string }
      type StoredState = {
        directories: string[]
        files: Record<string, StoredFile>
        permission: PermissionState
        unreadable: string[]
        pickerBehavior: 'resolve' | 'abort'
        pickerRoot: 'primary' | 'alternate'
        pickerCalls: number
        writes: Array<{ path: string; size: number; modified: number }>
        failNextWrites: Record<string, string>
        clock: number
      }

      type WritableValue =
        | string
        | Blob
        | ArrayBuffer
        | ArrayBufferView
        | {
            type: 'write'
            position?: number
            data: string | Blob | ArrayBuffer | ArrayBufferView
          }
        | { type: 'seek'; position: number }
        | { type: 'truncate'; size: number }

      interface TestFileHandle {
        readonly kind: 'file'
        readonly name: string
        getFile(): Promise<File>
        createWritable(options?: { keepExistingData?: boolean }): Promise<{
          write(value: WritableValue): Promise<void>
          seek(position: number): Promise<void>
          truncate(size: number): Promise<void>
          close(): Promise<void>
          abort(): Promise<void>
        }>
        isSameEntry(other: TestFileHandle | TestDirectoryHandle): Promise<boolean>
        queryPermission(): Promise<PermissionState>
        requestPermission(): Promise<PermissionState>
      }

      interface TestDirectoryHandle {
        readonly kind: 'directory'
        readonly name: string
        entries(): AsyncIterableIterator<[string, TestFileHandle | TestDirectoryHandle]>
        getDirectoryHandle(
          name: string,
          options?: { create?: boolean }
        ): Promise<TestDirectoryHandle>
        getFileHandle(name: string, options?: { create?: boolean }): Promise<TestFileHandle>
        removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
        isSameEntry(other: TestFileHandle | TestDirectoryHandle): Promise<boolean>
        queryPermission(): Promise<PermissionState>
        requestPermission(): Promise<PermissionState>
      }

      const storageKey = `orbitpm:e2e:reliability-fsa:${configuration.name}`
      const alternateRootPrefix = configuration.alternateRoot
        ? '.orbitpm/__orbitpm_e2e_alternate_root__'
        : null
      const normalize = (value: string): string =>
        value.replace(/\\/gu, '/').split('/').filter(Boolean).join('/')
      const parentOf = (path: string): string => {
        const index = path.lastIndexOf('/')
        return index < 0 ? '' : path.slice(0, index)
      }
      const baseOf = (path: string): string => {
        const index = path.lastIndexOf('/')
        return index < 0 ? path : path.slice(index + 1)
      }
      const join = (parent: string, name: string): string =>
        normalize(parent ? `${parent}/${name}` : name)

      const bytesToBase64 = (bytes: Uint8Array): string => {
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        }
        return btoa(binary)
      }
      const base64ToBytes = (value: string): Uint8Array => {
        const binary = atob(value)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        return bytes
      }
      const encode = (value: string): string => bytesToBase64(new TextEncoder().encode(value))
      const decode = (value: string): string =>
        new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(value))

      const initialDirectories = new Set<string>([''])
      const addSeedDirectories = (prefix: string, seed: Record<string, string>): void => {
        for (const rawPath of Object.keys(seed)) {
          const path = join(prefix, normalize(rawPath))
          const parts = path.split('/')
          parts.pop()
          let current = ''
          for (const part of parts) {
            current = join(current, part)
            initialDirectories.add(current)
          }
        }
      }
      addSeedDirectories('', configuration.seed)
      if (configuration.alternateRoot && alternateRootPrefix) {
        initialDirectories.add(alternateRootPrefix)
        addSeedDirectories(alternateRootPrefix, configuration.alternateRoot.seed)
      }
      const initialClock = Date.now()
      const seededFiles = [
        ...Object.entries(configuration.seed).map(
          ([rawPath, contents]) => [normalize(rawPath), contents] as const
        ),
        ...Object.entries(configuration.alternateRoot?.seed ?? {}).map(
          ([rawPath, contents]) => [join(alternateRootPrefix ?? '', rawPath), contents] as const
        )
      ]
      const initial: StoredState = {
        directories: [...initialDirectories].sort(),
        files: Object.fromEntries(
          seededFiles.map(([path, contents], index) => {
            return [
              path,
              {
                base64: encode(contents),
                modified: initialClock + index,
                type: /\.bpmn$/iu.test(path)
                  ? 'application/xml'
                  : /\.json$/iu.test(path)
                    ? 'application/json'
                    : 'application/octet-stream'
              }
            ]
          })
        ),
        permission: 'granted',
        unreadable: configuration.unreadable.map(normalize),
        pickerBehavior: configuration.pickerBehavior,
        pickerRoot: 'primary',
        pickerCalls: 0,
        writes: [],
        failNextWrites: {},
        clock: initialClock + seededFiles.length
      }

      if (localStorage.getItem(storageKey) === null) {
        localStorage.setItem(storageKey, JSON.stringify(initial))
      }

      const load = (): StoredState => {
        const raw = localStorage.getItem(storageKey)
        return raw ? (JSON.parse(raw) as StoredState) : structuredClone(initial)
      }
      const save = (state: StoredState): void => {
        localStorage.setItem(storageKey, JSON.stringify(state))
      }
      const tick = (state: StoredState): number => {
        state.clock = Math.max(state.clock + 1, Date.now())
        return state.clock
      }
      const namedError = (name: string, message: string): DOMException => {
        try {
          return new DOMException(message, name)
        } catch {
          const error = new DOMException(message)
          Object.defineProperty(error, 'name', { value: name })
          return error
        }
      }
      const missing = (path: string): DOMException =>
        namedError('NotFoundError', `Workspace entry "${path}" does not exist.`)
      const wrongKind = (path: string): DOMException =>
        namedError('TypeMismatchError', `Workspace entry "${path}" has the wrong kind.`)
      const permissionError = (): DOMException =>
        namedError('NotAllowedError', 'Workspace permission is no longer granted.')
      const unreadableError = (path: string): DOMException =>
        namedError('NotReadableError', `Workspace entry "${path}" is unreadable.`)
      const checkPermission = (state: StoredState): void => {
        if (state.permission !== 'granted') throw permissionError()
      }
      const isUnreadable = (state: StoredState, path: string): boolean =>
        state.unreadable.some((candidate) => path === candidate || path.startsWith(`${candidate}/`))

      const ensureDirectoryParents = (state: StoredState, path: string): void => {
        let current = ''
        for (const part of parentOf(path).split('/').filter(Boolean)) {
          current = join(current, part)
          if (!state.directories.includes(current)) state.directories.push(current)
        }
        state.directories.sort()
      }

      const owned = (source: Uint8Array): Uint8Array<ArrayBuffer> => {
        const copy = new Uint8Array(new ArrayBuffer(source.byteLength))
        copy.set(source)
        return copy
      }
      const asBytes = async (
        value: string | Blob | ArrayBuffer | ArrayBufferView
      ): Promise<Uint8Array> => {
        if (typeof value === 'string') return new TextEncoder().encode(value)
        if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer())
        if (ArrayBuffer.isView(value)) {
          return owned(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        }
        return owned(new Uint8Array(value))
      }
      const resize = (source: Uint8Array, size: number): Uint8Array => {
        const output = new Uint8Array(size)
        output.set(source.subarray(0, size))
        return output
      }

      const fileHandle = (pathInput: string): TestFileHandle => {
        const path = normalize(pathInput)
        return {
          kind: 'file',
          name: baseOf(path),
          async queryPermission() {
            return load().permission
          },
          async requestPermission() {
            return load().permission
          },
          async isSameEntry(other) {
            return (
              other.kind === 'file' &&
              (other as TestFileHandle & { __path?: string }).__path === path
            )
          },
          async getFile() {
            const state = load()
            checkPermission(state)
            if (isUnreadable(state, path)) throw unreadableError(path)
            const stored = state.files[path]
            if (!stored) throw missing(path)
            const bytes = owned(base64ToBytes(stored.base64))
            return new File([bytes.buffer], baseOf(path), {
              type: stored.type,
              lastModified: stored.modified
            })
          },
          async createWritable(options = {}) {
            const opened = load()
            checkPermission(opened)
            const existing = opened.files[path]
            let buffer =
              options.keepExistingData && existing
                ? base64ToBytes(existing.base64)
                : new Uint8Array(0)
            let position = 0
            let closed = false
            const assertOpen = (): void => {
              if (closed) throw namedError('InvalidStateError', 'Writable is already closed.')
            }
            const writeAt = async (
              value: string | Blob | ArrayBuffer | ArrayBufferView,
              requestedPosition?: number
            ): Promise<void> => {
              assertOpen()
              const bytes = await asBytes(value)
              const start = requestedPosition ?? position
              const required = start + bytes.byteLength
              if (required > buffer.byteLength) buffer = resize(buffer, required)
              buffer.set(bytes, start)
              position = required
            }
            return {
              async write(value) {
                if (
                  typeof value === 'object' &&
                  value !== null &&
                  !(value instanceof Blob) &&
                  !(value instanceof ArrayBuffer) &&
                  !ArrayBuffer.isView(value) &&
                  'type' in value
                ) {
                  const command = value as
                    | {
                        type: 'write'
                        position?: number
                        data: string | Blob | ArrayBuffer | ArrayBufferView
                      }
                    | { type: 'seek'; position: number }
                    | { type: 'truncate'; size: number }
                  if (command.type === 'seek') {
                    position = command.position
                    return
                  }
                  if (command.type === 'truncate') {
                    buffer = resize(buffer, command.size)
                    position = Math.min(position, command.size)
                    return
                  }
                  await writeAt(command.data, command.position)
                  return
                }
                await writeAt(value)
              },
              async seek(nextPosition) {
                assertOpen()
                position = nextPosition
              },
              async truncate(size) {
                assertOpen()
                buffer = resize(buffer, size)
                position = Math.min(position, size)
              },
              async close() {
                assertOpen()
                const state = load()
                checkPermission(state)
                const failureName = state.failNextWrites[path]
                if (failureName) {
                  delete state.failNextWrites[path]
                  save(state)
                  closed = true
                  throw namedError(failureName, `Injected ${failureName} for "${path}".`)
                }
                ensureDirectoryParents(state, path)
                const modified = tick(state)
                state.files[path] = {
                  base64: bytesToBase64(buffer),
                  modified,
                  type:
                    state.files[path]?.type ??
                    (/\.bpmn$/iu.test(path)
                      ? 'application/xml'
                      : /\.json$/iu.test(path)
                        ? 'application/json'
                        : 'application/octet-stream')
                }
                state.writes.push({ path, size: buffer.byteLength, modified })
                save(state)
                closed = true
              },
              async abort() {
                closed = true
              }
            }
          },
          __path: path
        } as TestFileHandle
      }

      const directoryHandle = (pathInput: string): TestDirectoryHandle => {
        const path = normalize(pathInput)
        return {
          kind: 'directory',
          name:
            path === ''
              ? configuration.name
              : path === alternateRootPrefix
                ? configuration.alternateRoot!.name
                : baseOf(path),
          async queryPermission() {
            return load().permission
          },
          async requestPermission() {
            return load().permission
          },
          async isSameEntry(other) {
            return (
              other.kind === 'directory' &&
              (other as TestDirectoryHandle & { __path?: string }).__path === path
            )
          },
          async *entries() {
            const state = load()
            checkPermission(state)
            if (isUnreadable(state, path)) throw unreadableError(path)
            const names = new Map<string, 'file' | 'directory'>()
            for (const directory of state.directories) {
              if (directory && parentOf(directory) === path) {
                names.set(baseOf(directory), 'directory')
              }
            }
            for (const filePath of Object.keys(state.files)) {
              if (parentOf(filePath) === path) names.set(baseOf(filePath), 'file')
            }
            for (const [name, kind] of [...names].sort(([left], [right]) =>
              left.localeCompare(right)
            )) {
              const childPath = join(path, name)
              yield [name, kind === 'file' ? fileHandle(childPath) : directoryHandle(childPath)]
            }
          },
          async getDirectoryHandle(childName, childOptions = {}) {
            const childPath = join(path, childName)
            const state = load()
            checkPermission(state)
            if (state.files[childPath]) throw wrongKind(childPath)
            if (state.directories.includes(childPath)) return directoryHandle(childPath)
            if (!childOptions.create) throw missing(childPath)
            state.directories.push(childPath)
            state.directories.sort()
            save(state)
            return directoryHandle(childPath)
          },
          async getFileHandle(childName, childOptions = {}) {
            const childPath = join(path, childName)
            const state = load()
            checkPermission(state)
            if (state.directories.includes(childPath)) throw wrongKind(childPath)
            if (state.files[childPath]) return fileHandle(childPath)
            if (!childOptions.create) throw missing(childPath)
            ensureDirectoryParents(state, childPath)
            state.files[childPath] = {
              base64: '',
              modified: tick(state),
              type: /\.bpmn$/iu.test(childPath)
                ? 'application/xml'
                : /\.json$/iu.test(childPath)
                  ? 'application/json'
                  : 'application/octet-stream'
            }
            save(state)
            return fileHandle(childPath)
          },
          async removeEntry(childName, removeOptions = {}) {
            const childPath = join(path, childName)
            const state = load()
            checkPermission(state)
            if (state.files[childPath]) {
              delete state.files[childPath]
              save(state)
              return
            }
            if (!state.directories.includes(childPath)) throw missing(childPath)
            const nestedFiles = Object.keys(state.files).filter((candidate) =>
              candidate.startsWith(`${childPath}/`)
            )
            const nestedDirectories = state.directories.filter((candidate) =>
              candidate.startsWith(`${childPath}/`)
            )
            if (!removeOptions.recursive && (nestedFiles.length || nestedDirectories.length)) {
              throw namedError('InvalidModificationError', 'Directory is not empty.')
            }
            for (const filePath of nestedFiles) delete state.files[filePath]
            state.directories = state.directories.filter(
              (candidate) => candidate !== childPath && !candidate.startsWith(`${childPath}/`)
            )
            save(state)
          },
          __path: path
        } as TestDirectoryHandle
      }

      const primaryRoot = directoryHandle('')
      const alternateRoot = alternateRootPrefix ? directoryHandle(alternateRootPrefix) : null
      const rootPrefix = (root: 'primary' | 'alternate'): string => {
        if (root === 'primary') return ''
        if (!alternateRootPrefix) {
          throw new Error('This reliability fixture has no alternate workspace root.')
        }
        return alternateRootPrefix
      }
      const pathsInRoot = (state: StoredState, root: 'primary' | 'alternate'): string[] => {
        const prefix = rootPrefix(root)
        return Object.keys(state.files)
          .filter((path) =>
            prefix
              ? path.startsWith(`${prefix}/`)
              : !alternateRootPrefix || !path.startsWith(`${alternateRootPrefix}/`)
          )
          .map((path) => (prefix ? path.slice(prefix.length + 1) : path))
          .sort()
      }
      window.showDirectoryPicker = async () => {
        const state = load()
        state.pickerCalls += 1
        save(state)
        if (state.pickerBehavior === 'abort') {
          throw namedError('AbortError', 'The folder picker was cancelled.')
        }
        return (
          state.pickerRoot === 'alternate' ? alternateRoot : primaryRoot
        ) as FileSystemDirectoryHandle
      }

      window.__ORBITPM_RELIABILITY_FS__ = {
        snapshot: () => structuredClone(load()),
        paths: () => Object.keys(load().files).sort(),
        read: (rawPath) => {
          const stored = load().files[normalize(rawPath)]
          return stored ? decode(stored.base64) : null
        },
        writeExternal: (rawPath, contents) => {
          const path = normalize(rawPath)
          const state = load()
          ensureDirectoryParents(state, path)
          state.files[path] = {
            base64: encode(contents),
            modified: tick(state),
            type: /\.bpmn$/iu.test(path) ? 'application/xml' : 'application/octet-stream'
          }
          save(state)
        },
        deleteExternal: (rawPath) => {
          const path = normalize(rawPath)
          const state = load()
          delete state.files[path]
          save(state)
        },
        setPermission: (permission) => {
          const state = load()
          state.permission = permission
          save(state)
        },
        setUnreadable: (paths) => {
          const state = load()
          state.unreadable = paths.map(normalize)
          save(state)
        },
        setPickerBehavior: (pickerBehavior) => {
          const state = load()
          state.pickerBehavior = pickerBehavior
          save(state)
        },
        setPickerRoot: (pickerRoot) => {
          rootPrefix(pickerRoot)
          const state = load()
          state.pickerRoot = pickerRoot
          save(state)
        },
        pathsInRoot: (root) => pathsInRoot(load(), root),
        readFromRoot: (root, rawPath) => {
          const path = join(rootPrefix(root), normalize(rawPath))
          const stored = load().files[path]
          return stored ? decode(stored.base64) : null
        },
        failNextWrite: (rawPath, errorName) => {
          const state = load()
          state.failNextWrites[normalize(rawPath)] = errorName
          save(state)
        },
        clearWrites: () => {
          const state = load()
          state.writes = []
          save(state)
        }
      }
    },
    {
      name: options.name ?? 'ReliabilityWorkspace',
      seed: options.seed ?? {},
      unreadable: options.unreadable ?? [],
      pickerBehavior: options.pickerBehavior ?? 'resolve',
      alternateRoot: options.alternateRoot ?? null
    }
  )
}

export async function reliabilityPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.paths())
}

export async function reliabilityRead(page: Page, path: string): Promise<string | null> {
  return page.evaluate((target) => window.__ORBITPM_RELIABILITY_FS__.read(target), path)
}

export async function reliabilityPathsInRoot(
  page: Page,
  root: 'primary' | 'alternate'
): Promise<string[]> {
  return page.evaluate(
    (targetRoot) => window.__ORBITPM_RELIABILITY_FS__.pathsInRoot(targetRoot),
    root
  )
}

export async function reliabilityReadFromRoot(
  page: Page,
  root: 'primary' | 'alternate',
  path: string
): Promise<string | null> {
  return page.evaluate(
    ({ targetRoot, targetPath }) =>
      window.__ORBITPM_RELIABILITY_FS__.readFromRoot(targetRoot, targetPath),
    { targetRoot: root, targetPath: path }
  )
}

export async function reliabilitySnapshot(page: Page): Promise<ReliabilityWorkspaceSnapshot> {
  return page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.snapshot())
}
