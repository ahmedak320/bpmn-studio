// Atomic file write: write to a sibling temp file, then rename over the
// destination. Renames are atomic on the same filesystem, so readers never
// observe a partially-written file. OneDrive/AV software on Windows
// sometimes holds a brief lock on the destination during/after a rename
// (EBUSY/EPERM) — retry once after a short delay.
//
// The fs surface used is injected so this module is unit-testable with a
// fake fs (no real disk I/O, no Electron) and so a caller can swap in
// `node:fs/promises` in production.

export interface AtomicWriteFs {
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  rm?(path: string, opts?: { force?: boolean }): Promise<void>
}

export interface AtomicWriteOptions {
  /** ms to wait before the single retry on a busy/locked rename. Default 200. */
  retryDelayMs?: number
  /** injectable for tests; defaults to a real setTimeout-based delay. */
  delay?: (ms: number) => Promise<void>
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

function isRetryable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    RETRYABLE_CODES.has(String((err as { code?: unknown }).code))
  )
}

/**
 * Writes `data` to `destPath` atomically via temp-file + rename.
 * On a retryable rename error (EBUSY/EPERM/EACCES — typical of AV/OneDrive
 * file locks on Windows) it waits `retryDelayMs` (default 200ms) and retries
 * the rename exactly once before giving up.
 */
export async function atomicWrite(
  fs: AtomicWriteFs,
  destPath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const { retryDelayMs = 200, delay = defaultDelay } = options
  const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`

  await fs.writeFile(tmpPath, data)

  try {
    await fs.rename(tmpPath, destPath)
  } catch (err) {
    if (!isRetryable(err)) {
      await cleanupTmp(fs, tmpPath)
      throw err
    }
    await delay(retryDelayMs)
    try {
      await fs.rename(tmpPath, destPath)
    } catch (retryErr) {
      await cleanupTmp(fs, tmpPath)
      throw retryErr
    }
  }
}

async function cleanupTmp(fs: AtomicWriteFs, tmpPath: string): Promise<void> {
  if (!fs.rm) return
  try {
    await fs.rm(tmpPath, { force: true })
  } catch {
    // best-effort cleanup only
  }
}
