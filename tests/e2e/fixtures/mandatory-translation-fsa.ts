import type { Page } from '@playwright/test'

export interface MandatoryTranslationWorkspaceOptions {
  name?: string
  seed?: Record<string, string>
  secondary?: {
    name?: string
    seed?: Record<string, string>
  }
}

type MandatoryTranslationWorkspaceKey = 'primary' | 'secondary'

declare global {
  interface Window {
    __ORBITPM_MANDATORY_TRANSLATION_FS__: {
      paths(workspace?: MandatoryTranslationWorkspaceKey): Promise<string[]>
      read(path: string, workspace?: MandatoryTranslationWorkspaceKey): Promise<string | null>
      deleteExternal(path: string, workspace?: MandatoryTranslationWorkspaceKey): Promise<void>
      failNextWrites(
        path: string,
        count?: number,
        workspace?: MandatoryTranslationWorkspaceKey
      ): void
      holdNextWrite(path: string, workspace?: MandatoryTranslationWorkspaceKey): void
      waitForHeldWrite(path: string, workspace?: MandatoryTranslationWorkspaceKey): Promise<void>
      releaseHeldWrite(path: string, workspace?: MandatoryTranslationWorkspaceKey): void
      waitForHeldWriteSettled(
        path: string,
        workspace?: MandatoryTranslationWorkspaceKey
      ): Promise<void>
      writeAttempts(path: string, workspace?: MandatoryTranslationWorkspaceKey): number
    }
  }
}

/**
 * Byte-backed File System Access fixture for the mandatory translation suite.
 *
 * The production DirectoryWorkspaceAdapter, import transaction, backup
 * exporter/importer, save command and reopen path all remain in use. This
 * fixture supplies only the browser-native handles that Playwright cannot
 * select through Chromium's native folder dialog.
 */
export async function installMandatoryTranslationWorkspace(
  page: Page,
  options: MandatoryTranslationWorkspaceOptions = {}
): Promise<void> {
  await page.addInitScript(
    (configuration: {
      name: string
      seed: Record<string, string>
      secondary: { name: string; seed: Record<string, string> } | null
    }) => {
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
        readonly __path: string
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
        readonly __path: string
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

      interface StoredFile {
        bytes: Uint8Array
        modified: number
        type: string
      }

      const normalize = (value: string): string =>
        value.replace(/\\/gu, '/').split('/').filter(Boolean).join('/')
      const join = (parent: string, name: string): string =>
        normalize(parent ? `${parent}/${name}` : name)
      const parentOf = (path: string): string => {
        const index = path.lastIndexOf('/')
        return index < 0 ? '' : path.slice(0, index)
      }
      const baseOf = (path: string): string => {
        const index = path.lastIndexOf('/')
        return index < 0 ? path : path.slice(index + 1)
      }
      const owned = (source: Uint8Array): Uint8Array<ArrayBuffer> => {
        const copy = new Uint8Array(new ArrayBuffer(source.byteLength))
        copy.set(source)
        return copy
      }
      const asBytes = async (
        value: string | Blob | ArrayBuffer | ArrayBufferView
      ): Promise<Uint8Array<ArrayBuffer>> => {
        if (typeof value === 'string') return owned(new TextEncoder().encode(value))
        if (value instanceof Blob) return owned(new Uint8Array(await value.arrayBuffer()))
        if (ArrayBuffer.isView(value)) {
          return owned(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        }
        return owned(new Uint8Array(value))
      }
      const resize = (source: Uint8Array, size: number): Uint8Array<ArrayBuffer> => {
        const output = new Uint8Array(new ArrayBuffer(size))
        output.set(source.subarray(0, size))
        return output
      }
      const namedError = (name: string, message: string): DOMException =>
        new DOMException(message, name)
      const missing = (path: string): DOMException =>
        namedError('NotFoundError', `Workspace entry "${path}" does not exist.`)
      const wrongKind = (path: string): DOMException =>
        namedError('TypeMismatchError', `Workspace entry "${path}" has the wrong kind.`)
      const assertChildName = (name: string): void => {
        if (name === '' || name === '.' || name === '..' || /[\\/]/u.test(name)) {
          throw new TypeError(`"${name}" is not a valid File System Access child name.`)
        }
      }

      interface HeldWrite {
        started: boolean
        settled: boolean
        startedPromise: Promise<void>
        settledPromise: Promise<void>
        markStarted(): void
        release(): void
        waitForRelease(): Promise<void>
        markSettled(): void
      }

      const hasSecondary = configuration.secondary !== null
      const rootPaths: Record<MandatoryTranslationWorkspaceKey, string> = {
        primary: hasSecondary ? '__orbitpm_fixture_primary__' : '',
        secondary: '__orbitpm_fixture_secondary__'
      }
      const rootNames = new Map<string, string>([
        [rootPaths.primary, configuration.name],
        [
          rootPaths.secondary,
          configuration.secondary?.name ?? 'MandatoryTranslationSecondaryWorkspace'
        ]
      ])
      const physicalPath = (
        rawPath: string,
        workspace: MandatoryTranslationWorkspaceKey = 'primary'
      ): string => join(rootPaths[workspace], normalize(rawPath))
      const directories = new Set<string>([
        '',
        ...(hasSecondary ? [rootPaths.primary, rootPaths.secondary] : [])
      ])
      const files = new Map<string, StoredFile>()
      const writeFailureCounts = new Map<string, number>()
      const heldWrites = new Map<string, HeldWrite>()
      const writeAttemptCounts = new Map<string, number>()
      let clock = Date.now()

      const ensureParents = (path: string): void => {
        let current = ''
        for (const part of parentOf(path).split('/').filter(Boolean)) {
          current = join(current, part)
          directories.add(current)
        }
      }

      const seedWorkspace = (
        workspace: MandatoryTranslationWorkspaceKey,
        seed: Record<string, string>
      ): void => {
        for (const [rawPath, contents] of Object.entries(seed)) {
          const path = physicalPath(rawPath, workspace)
          ensureParents(path)
          files.set(path, {
            bytes: owned(new TextEncoder().encode(contents)),
            modified: ++clock,
            type: /\.bpmn$/iu.test(path)
              ? 'application/xml'
              : /\.json$/iu.test(path)
                ? 'application/json'
                : 'application/octet-stream'
          })
        }
      }
      seedWorkspace('primary', configuration.seed)
      if (configuration.secondary) seedWorkspace('secondary', configuration.secondary.seed)

      const createHeldWrite = (): HeldWrite => {
        let resolveStarted!: () => void
        let resolveRelease!: () => void
        let resolveSettled!: () => void
        const startedPromise = new Promise<void>((resolve) => {
          resolveStarted = resolve
        })
        const releasePromise = new Promise<void>((resolve) => {
          resolveRelease = resolve
        })
        const settledPromise = new Promise<void>((resolve) => {
          resolveSettled = resolve
        })
        return {
          started: false,
          settled: false,
          startedPromise,
          settledPromise,
          markStarted() {
            if (this.started) return
            this.started = true
            resolveStarted()
          },
          release() {
            resolveRelease()
          },
          async waitForRelease() {
            await releasePromise
          },
          markSettled() {
            if (this.settled) return
            this.settled = true
            resolveSettled()
          }
        }
      }

      const fileHandle = (rawPath: string): TestFileHandle => {
        const path = normalize(rawPath)
        return {
          kind: 'file',
          name: baseOf(path),
          __path: path,
          async queryPermission() {
            return 'granted'
          },
          async requestPermission() {
            return 'granted'
          },
          async isSameEntry(other) {
            return other.kind === 'file' && other.__path === path
          },
          async getFile() {
            const stored = files.get(path)
            if (!stored) throw missing(path)
            return new File([owned(stored.bytes).buffer], baseOf(path), {
              type: stored.type,
              lastModified: stored.modified
            })
          },
          async createWritable(options = {}) {
            writeAttemptCounts.set(path, (writeAttemptCounts.get(path) ?? 0) + 1)
            const failures = writeFailureCounts.get(path) ?? 0
            if (failures > 0) {
              writeFailureCounts.set(path, failures - 1)
              throw namedError('NotAllowedError', `Injected workspace write failure for "${path}".`)
            }
            const pendingHold = heldWrites.get(path)
            const activeHold = pendingHold && !pendingHold.started ? pendingHold : undefined
            if (activeHold) {
              activeHold.markStarted()
              await activeHold.waitForRelease()
            }
            const existing = files.get(path)
            let buffer =
              options.keepExistingData && existing
                ? owned(existing.bytes)
                : new Uint8Array(new ArrayBuffer(0))
            let position = 0
            let closed = false
            const assertOpen = (): void => {
              if (closed) {
                throw namedError('InvalidStateError', 'Writable stream is already closed.')
              }
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
                  if (value.type === 'seek') {
                    position = value.position
                    return
                  }
                  if (value.type === 'truncate') {
                    buffer = resize(buffer, value.size)
                    position = Math.min(position, value.size)
                    return
                  }
                  await writeAt(value.data, value.position)
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
                closed = true
                ensureParents(path)
                files.set(path, {
                  bytes: owned(buffer),
                  modified: ++clock,
                  type: /\.bpmn$/iu.test(path)
                    ? 'application/xml'
                    : /\.json$/iu.test(path)
                      ? 'application/json'
                      : 'application/octet-stream'
                })
                activeHold?.markSettled()
              },
              async abort() {
                closed = true
                activeHold?.markSettled()
              }
            }
          }
        }
      }

      const directoryHandle = (rawPath: string): TestDirectoryHandle => {
        const path = normalize(rawPath)
        return {
          kind: 'directory',
          name: rootNames.get(path) ?? (path ? baseOf(path) : configuration.name),
          __path: path,
          async queryPermission() {
            return 'granted'
          },
          async requestPermission() {
            return 'granted'
          },
          async isSameEntry(other) {
            return other.kind === 'directory' && other.__path === path
          },
          async *entries() {
            const prefix = path ? `${path}/` : ''
            const childNames = new Set<string>()
            for (const directory of directories) {
              if (!directory.startsWith(prefix) || directory === path) continue
              const remainder = directory.slice(prefix.length)
              if (!remainder.includes('/')) childNames.add(remainder)
            }
            for (const filePath of files.keys()) {
              if (!filePath.startsWith(prefix)) continue
              const remainder = filePath.slice(prefix.length)
              if (!remainder.includes('/')) childNames.add(remainder)
            }
            for (const childName of [...childNames].sort((left, right) =>
              left.localeCompare(right, 'en')
            )) {
              const childPath = join(path, childName)
              if (directories.has(childPath)) {
                yield [childName, directoryHandle(childPath)]
              } else {
                yield [childName, fileHandle(childPath)]
              }
            }
          },
          async getDirectoryHandle(childName, childOptions = {}) {
            assertChildName(childName)
            const childPath = join(path, childName)
            if (files.has(childPath)) throw wrongKind(childPath)
            if (!directories.has(childPath)) {
              if (!childOptions.create) throw missing(childPath)
              directories.add(childPath)
            }
            return directoryHandle(childPath)
          },
          async getFileHandle(childName, childOptions = {}) {
            assertChildName(childName)
            const childPath = join(path, childName)
            if (directories.has(childPath)) throw wrongKind(childPath)
            if (!files.has(childPath)) {
              if (!childOptions.create) throw missing(childPath)
              ensureParents(childPath)
              files.set(childPath, {
                bytes: new Uint8Array(new ArrayBuffer(0)),
                modified: ++clock,
                type: 'application/octet-stream'
              })
            }
            return fileHandle(childPath)
          },
          async removeEntry(childName, childOptions = {}) {
            assertChildName(childName)
            const childPath = join(path, childName)
            if (files.delete(childPath)) return
            if (!directories.has(childPath)) throw missing(childPath)
            const prefix = `${childPath}/`
            const hasChildren =
              [...files.keys()].some((candidate) => candidate.startsWith(prefix)) ||
              [...directories].some((candidate) => candidate.startsWith(prefix))
            if (hasChildren && !childOptions.recursive) {
              throw namedError('InvalidModificationError', `"${childPath}" is not empty.`)
            }
            for (const candidate of [...files.keys()]) {
              if (candidate.startsWith(prefix)) files.delete(candidate)
            }
            for (const candidate of [...directories]) {
              if (candidate === childPath || candidate.startsWith(prefix)) {
                directories.delete(candidate)
              }
            }
          }
        }
      }

      const pickerRoots = [
        directoryHandle(rootPaths.primary),
        ...(configuration.secondary ? [directoryHandle(rootPaths.secondary)] : [])
      ]
      let pickerIndex = 0
      ;(
        window as unknown as { showDirectoryPicker: () => Promise<TestDirectoryHandle> }
      ).showDirectoryPicker = async () =>
        pickerRoots[Math.min(pickerIndex++, pickerRoots.length - 1)]!
      window.__ORBITPM_MANDATORY_TRANSLATION_FS__ = {
        async paths(workspace = 'primary') {
          const rootPath = rootPaths[workspace]
          const prefix = rootPath ? `${rootPath}/` : ''
          return [...files.keys()]
            .filter((path) => path.startsWith(prefix))
            .map((path) => path.slice(prefix.length))
            .sort((left, right) => left.localeCompare(right, 'en'))
        },
        async read(rawPath, workspace = 'primary') {
          const stored = files.get(physicalPath(rawPath, workspace))
          return stored ? new TextDecoder('utf-8', { fatal: true }).decode(stored.bytes) : null
        },
        async deleteExternal(rawPath, workspace = 'primary') {
          files.delete(physicalPath(rawPath, workspace))
        },
        failNextWrites(rawPath, count = 1, workspace = 'primary') {
          const path = physicalPath(rawPath, workspace)
          writeFailureCounts.set(path, Math.max(0, Math.floor(count)))
        },
        holdNextWrite(rawPath, workspace = 'primary') {
          heldWrites.set(physicalPath(rawPath, workspace), createHeldWrite())
        },
        async waitForHeldWrite(rawPath, workspace = 'primary') {
          const held = heldWrites.get(physicalPath(rawPath, workspace))
          if (!held) throw new Error(`No held write is configured for "${rawPath}".`)
          await held.startedPromise
        },
        releaseHeldWrite(rawPath, workspace = 'primary') {
          const held = heldWrites.get(physicalPath(rawPath, workspace))
          if (!held) throw new Error(`No held write is configured for "${rawPath}".`)
          held.release()
        },
        async waitForHeldWriteSettled(rawPath, workspace = 'primary') {
          const held = heldWrites.get(physicalPath(rawPath, workspace))
          if (!held) throw new Error(`No held write is configured for "${rawPath}".`)
          await held.settledPromise
        },
        writeAttempts(rawPath, workspace = 'primary') {
          return writeAttemptCounts.get(physicalPath(rawPath, workspace)) ?? 0
        }
      }
    },
    {
      name: options.name ?? 'MandatoryTranslationWorkspace',
      seed: options.seed ?? {},
      secondary: options.secondary
        ? {
            name: options.secondary.name ?? 'MandatoryTranslationSecondaryWorkspace',
            seed: options.secondary.seed ?? {}
          }
        : null
    }
  )
}
