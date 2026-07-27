import { describe, expect, it } from 'vitest'
import {
  MemoryWorkspaceAdapter,
  type FileSnapshot,
  type ReadFileOptions,
  type WorkspaceAdapter,
  type WorkspaceProcessIdentityInspector
} from './adapters'
import { scanWorkspaceProcessIdentities } from './processIdentity'

function adapterWith(
  memory: MemoryWorkspaceAdapter,
  overrides: Pick<Partial<WorkspaceAdapter>, 'list' | 'read'>
): WorkspaceAdapter {
  return {
    id: memory.id,
    mode: memory.mode,
    storage: memory.storage,
    list: overrides.list ?? ((...args) => memory.list(...args)),
    read: overrides.read ?? ((...args) => memory.read(...args)),
    writeAtomic: (...args) => memory.writeAtomic(...args),
    rename: (...args) => memory.rename(...args),
    move: (...args) => memory.move(...args),
    remove: (...args) => memory.remove(...args),
    removeIfHash: (...args) => memory.removeIfHash(...args),
    removeEmptyFolder: (...args) => memory.removeEmptyFolder(...args),
    createFolder: (...args) => memory.createFolder(...args),
    exportBackup: (...args) => memory.exportBackup(...args)
  }
}

const textIdentityInspector: WorkspaceProcessIdentityInspector = async (xml) => ({
  processIds: [xml]
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for the identity scan test condition.')
}

describe('scanWorkspaceProcessIdentities', () => {
  it('rejects oversized metadata before read, hashing, decoding, or inspection', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: { 'oversized.bpmn': '123456789' }
    })
    let reads = 0
    let inspections = 0
    const adapter = adapterWith(memory, {
      read: async (...args) => {
        reads += 1
        return memory.read(...args)
      }
    })

    await expect(
      scanWorkspaceProcessIdentities(adapter, {
        limits: { maxFiles: 10, maxFileBytes: 8, maxTotalBytes: 100 },
        inspector: async () => {
          inspections += 1
          return { processIds: [] }
        }
      })
    ).rejects.toThrow('per-file scan limit is 8 bytes')
    expect(reads).toBe(0)
    expect(inspections).toBe(0)
  })

  it('preflights file-count and aggregate ceilings before starting any read', async () => {
    const countMemory = new MemoryWorkspaceAdapter({
      files: {
        'a.bpmn': 'aaaaaa',
        'b.bpmn': 'bbbbbb',
        'c.bpmn': 'cccccc'
      }
    })
    let countReads = 0
    const countAdapter = adapterWith(countMemory, {
      read: async (...args) => {
        countReads += 1
        return countMemory.read(...args)
      }
    })
    await expect(
      scanWorkspaceProcessIdentities(countAdapter, {
        limits: { maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 100 },
        inspector: textIdentityInspector
      })
    ).rejects.toThrow('3 BPMN files; the scan limit is 2')
    expect(countReads).toBe(0)

    const aggregateMemory = new MemoryWorkspaceAdapter({
      files: { 'a.bpmn': 'aaaaaa', 'b.bpmn': 'bbbbbb' }
    })
    let aggregateReads = 0
    const aggregateAdapter = adapterWith(aggregateMemory, {
      read: async (...args) => {
        aggregateReads += 1
        return aggregateMemory.read(...args)
      }
    })
    await expect(
      scanWorkspaceProcessIdentities(aggregateAdapter, {
        limits: { maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 10 },
        inspector: textIdentityInspector
      })
    ).rejects.toThrow('aggregate scan limit is 10 bytes')
    expect(aggregateReads).toBe(0)
  })

  it('fails closed on missing size metadata before invoking read', async () => {
    const memory = new MemoryWorkspaceAdapter({ files: { 'unknown.bpmn': 'Process_A' } })
    let reads = 0
    const adapter = adapterWith(memory, {
      list: async (...args) =>
        (await memory.list(...args)).map((entry) =>
          entry.path === 'unknown.bpmn' ? { ...entry, size: undefined } : entry
        ),
      read: async (...args) => {
        reads += 1
        return memory.read(...args)
      }
    })

    await expect(
      scanWorkspaceProcessIdentities(adapter, { inspector: textIdentityInspector })
    ).rejects.toThrow('does not expose trustworthy byte-size metadata')
    expect(reads).toBe(0)
  })

  it('passes the exact listed byte ceiling and AbortSignal to adapter.read', async () => {
    const memory = new MemoryWorkspaceAdapter({ files: { 'one.bpmn': 'Process_A' } })
    const controller = new AbortController()
    const observed: Array<{ path: string; options?: ReadFileOptions }> = []
    const adapter = adapterWith(memory, {
      read: async (path, options) => {
        observed.push({ path, options })
        return memory.read(path, options)
      }
    })

    const result = await scanWorkspaceProcessIdentities(adapter, {
      inspector: textIdentityInspector,
      signal: controller.signal
    })

    expect(result).toEqual([{ processId: 'Process_A', path: 'one.bpmn' }])
    expect(observed).toEqual([
      {
        path: 'one.bpmn',
        options: {
          maxBytes: new TextEncoder().encode('Process_A').byteLength,
          signal: controller.signal
        }
      }
    ])
  })

  it('caps concurrent identity inspection and preserves deterministic path order', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`process-${index}.bpmn`, `Process_${index}`])
      )
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let peak = 0
    let started = 0
    const inspector: WorkspaceProcessIdentityInspector = async (xml) => {
      active += 1
      started += 1
      peak = Math.max(peak, active)
      try {
        await gate
        return { processIds: [xml] }
      } finally {
        active -= 1
      }
    }

    const pending = scanWorkspaceProcessIdentities(memory, {
      inspector,
      readConcurrency: 3
    })
    await waitFor(() => started === 3)
    expect(peak).toBe(3)
    release()

    const result = await pending
    expect(result).toHaveLength(9)
    expect(peak).toBe(3)
  })

  it('cancels in-flight reads without starting another worker batch', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `process-${String(index).padStart(2, '0')}.bpmn`,
          `Process_${index}`
        ])
      )
    })
    const started: string[] = []
    const adapter = adapterWith(memory, {
      read: (path, options) =>
        new Promise<FileSnapshot>((_resolve, reject) => {
          started.push(path)
          const rejectAbort = (): void =>
            reject(options?.signal?.reason ?? new DOMException('cancelled', 'AbortError'))
          if (options?.signal?.aborted) rejectAbort()
          else options?.signal?.addEventListener('abort', rejectAbort, { once: true })
        })
    })
    const controller = new AbortController()
    const pending = scanWorkspaceProcessIdentities(adapter, {
      inspector: textIdentityInspector,
      readConcurrency: 3,
      signal: controller.signal
    })

    await waitFor(() => started.length === 3)
    controller.abort('superseded')

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toHaveLength(3)
  })

  it('rejects checksum mismatch and reports duplicate identities deterministically', async () => {
    const checksumMemory = new MemoryWorkspaceAdapter({
      files: { 'checksum.bpmn': 'Process_A' }
    })
    const checksumAdapter = adapterWith(checksumMemory, {
      read: async (...args) => ({
        ...(await checksumMemory.read(...args)),
        hash: '0'.repeat(64)
      })
    })
    await expect(
      scanWorkspaceProcessIdentities(checksumAdapter, {
        inspector: textIdentityInspector
      })
    ).rejects.toThrow('failed checksum verification')

    const duplicateMemory = new MemoryWorkspaceAdapter({
      files: { 'a.bpmn': 'slower', 'b.bpmn': 'faster' }
    })
    await expect(
      scanWorkspaceProcessIdentities(duplicateMemory, {
        readConcurrency: 2,
        inspector: async (xml) => {
          if (xml === 'slower') await new Promise<void>((resolve) => setTimeout(resolve, 5))
          return { processIds: ['Duplicate'] }
        }
      })
    ).rejects.toThrow('Process id "Duplicate" is duplicated by "a.bpmn" and "b.bpmn".')
  })

  it('scans 1,000 real adapter-backed files once within the activation budget', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: Object.fromEntries(
        Array.from({ length: 1_000 }, (_, index) => [
          `process-${String(index).padStart(4, '0')}.bpmn`,
          `Process_${String(index).padStart(4, '0')}`
        ])
      )
    })
    let reads = 0
    const adapter = adapterWith(memory, {
      read: async (...args) => {
        reads += 1
        return memory.read(...args)
      }
    })

    const startedAt = performance.now()
    const result = await scanWorkspaceProcessIdentities(adapter, {
      inspector: textIdentityInspector,
      readConcurrency: 8
    })
    const elapsedMilliseconds = performance.now() - startedAt

    expect(result).toHaveLength(1_000)
    expect(result[0]).toEqual({
      processId: 'Process_0000',
      path: 'process-0000.bpmn'
    })
    expect(result.at(-1)).toEqual({
      processId: 'Process_0999',
      path: 'process-0999.bpmn'
    })
    expect(reads).toBe(1_000)
    expect(elapsedMilliseconds).toBeLessThan(10_000)
  }, 15_000)
})
