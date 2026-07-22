import { describe, expect, it, vi } from 'vitest'
import { atomicWrite, type AtomicWriteFs } from '../../src/main/workspace/atomicWrite'

function makeFs(overrides: Partial<AtomicWriteFs> = {}): {
  fs: AtomicWriteFs
  calls: { writeFile: unknown[][]; rename: unknown[][] }
} {
  const calls = { writeFile: [] as unknown[][], rename: [] as unknown[][] }
  const fs: AtomicWriteFs = {
    writeFile: vi.fn(async (...args: unknown[]) => {
      calls.writeFile.push(args)
    }),
    rename: vi.fn(async (...args: unknown[]) => {
      calls.rename.push(args)
    }),
    rm: vi.fn(async () => {}),
    ...overrides
  }
  return { fs, calls }
}

describe('atomicWrite', () => {
  it('writes to a temp file then renames it onto the destination', async () => {
    const { fs, calls } = makeFs()

    await atomicWrite(fs, '/root/file.bpmn', '<xml/>')

    expect(calls.writeFile).toHaveLength(1)
    const [tmpPath, data] = calls.writeFile[0]
    expect(tmpPath).toMatch(/^\/root\/file\.bpmn\.tmp-/)
    expect(data).toBe('<xml/>')

    expect(calls.rename).toHaveLength(1)
    expect(calls.rename[0]).toEqual([tmpPath, '/root/file.bpmn'])
  })

  it('retries the rename once after EBUSY, then succeeds', async () => {
    let attempt = 0
    const rename = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) {
        const err = new Error('busy') as NodeJS.ErrnoException
        err.code = 'EBUSY'
        throw err
      }
    })
    const { fs } = makeFs({ rename })
    const delay = vi.fn(async () => {})

    await atomicWrite(fs, '/root/file.bpmn', 'data', { delay, retryDelayMs: 200 })

    expect(rename).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledWith(200)
  })

  it('gives up and throws after a second failed rename attempt', async () => {
    const err = new Error('still busy') as NodeJS.ErrnoException
    err.code = 'EBUSY'
    const rename = vi.fn(async () => {
      throw err
    })
    const { fs } = makeFs({ rename })
    const delay = vi.fn(async () => {})

    await expect(atomicWrite(fs, '/root/file.bpmn', 'data', { delay })).rejects.toThrow(
      'still busy'
    )
    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('does not retry on a non-retryable error', async () => {
    const err = new Error('no such file') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    const rename = vi.fn(async () => {
      throw err
    })
    const { fs } = makeFs({ rename })
    const delay = vi.fn(async () => {})

    await expect(atomicWrite(fs, '/root/file.bpmn', 'data', { delay })).rejects.toThrow(
      'no such file'
    )
    expect(rename).toHaveBeenCalledTimes(1)
    expect(delay).not.toHaveBeenCalled()
  })

  it('cleans up the temp file when the write fails permanently', async () => {
    const err = new Error('still busy') as NodeJS.ErrnoException
    err.code = 'EBUSY'
    const rename = vi.fn(async () => {
      throw err
    })
    const rm = vi.fn(async () => {})
    const { fs } = makeFs({ rename, rm })
    const delay = vi.fn(async () => {})

    await expect(atomicWrite(fs, '/root/file.bpmn', 'data', { delay })).rejects.toThrow()
    expect(rm).toHaveBeenCalledTimes(1)
  })
})
