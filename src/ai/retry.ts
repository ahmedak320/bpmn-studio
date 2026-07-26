export interface RetryAttempt {
  attempt: number
  maxAttempts: number
  /** Present only when another attempt is scheduled. */
  retryInMs?: number
}

export interface RetryOptions {
  maxAttempts: number
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  shouldRetry: (error: unknown) => boolean
  retryAfterMs?: (error: unknown) => number | undefined
  onAttempt?: (attempt: RetryAttempt) => void
  /** Test seam; defaults to an abortable timer. */
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

export function abortError(): Error {
  let error: Error
  try {
    error = new DOMException('The request was cancelled.', 'AbortError')
  } catch {
    error = new Error('The request was cancelled.')
    error.name = 'AbortError'
  }
  return Object.assign(error, { transport: true as const })
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

export function waitWithSignal(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Execute a request with a small, deterministic exponential-backoff envelope.
 * Permanent failures are thrown immediately and AbortSignal always wins.
 */
export async function withBoundedRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts))
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500)
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 8_000)
  const wait = options.wait ?? waitWithSignal

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal)
    options.onAttempt?.({ attempt, maxAttempts })
    try {
      return await operation(attempt)
    } catch (error) {
      throwIfAborted(options.signal)
      const exhausted = attempt >= maxAttempts
      if (exhausted || !options.shouldRetry(error)) throw error

      const serverDelay = options.retryAfterMs?.(error)
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      const delayMs =
        typeof serverDelay === 'number' && Number.isFinite(serverDelay)
          ? Math.min(maxDelayMs, Math.max(0, serverDelay))
          : exponential
      options.onAttempt?.({ attempt, maxAttempts, retryInMs: delayMs })
      await wait(delayMs, options.signal)
    }
  }

  // The loop always returns or throws; retain a defensive impossible branch.
  throw new Error('Retry executor reached an invalid state.')
}

export function parseRetryAfter(
  value: string | null,
  nowMs = Date.now()
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return undefined
  return Math.max(0, dateMs - nowMs)
}

export const TRANSIENT_HTTP_STATUSES = new Set([
  408,
  429,
  500,
  502,
  503,
  504,
  522,
  524
])

export function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_STATUSES.has(status)
}
