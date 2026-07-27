import { describe, expect, it, vi } from 'vitest'
import { isTransientHttpStatus, parseRetryAfter, withBoundedRetry } from '../retry'

describe('bounded retry policy', () => {
  it('retries transient failures with bounded exponential delays', async () => {
    const waits: number[] = []
    const attempts: number[] = []
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue('ok')

    await expect(
      withBoundedRetry(() => operation(), {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 150,
        shouldRetry: () => true,
        wait: async (delay) => void waits.push(delay),
        onAttempt: ({ attempt, retryInMs }) => {
          if (retryInMs === undefined) attempts.push(attempt)
        }
      })
    ).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([100, 150])
    expect(attempts).toEqual([1, 2, 3])
  })

  it('never retries a permanent failure', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('400'))
    await expect(
      withBoundedRetry(operation, {
        maxAttempts: 3,
        shouldRetry: () => false,
        wait: async () => undefined
      })
    ).rejects.toThrow('400')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('honors Retry-After while clamping to the maximum delay', async () => {
    const waits: number[] = []
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValue('ok')
    await withBoundedRetry(operation, {
      maxAttempts: 2,
      maxDelayMs: 5_000,
      shouldRetry: () => true,
      retryAfterMs: () => 60_000,
      wait: async (delay) => void waits.push(delay)
    })
    expect(waits).toEqual([5_000])
  })

  it('cancels during backoff without another attempt', async () => {
    const controller = new AbortController()
    const operation = vi.fn().mockRejectedValue(new Error('network'))
    await expect(
      withBoundedRetry(operation, {
        maxAttempts: 3,
        signal: controller.signal,
        shouldRetry: () => true,
        wait: async () => {
          controller.abort()
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operation).toHaveBeenCalledTimes(1)
  })
})

describe('retry classification helpers', () => {
  it('allows only the specified transient HTTP statuses', () => {
    for (const status of [408, 429, 500, 502, 503, 504, 522, 524]) {
      expect(isTransientHttpStatus(status)).toBe(true)
    }
    for (const status of [400, 401, 402, 403, 404, 409, 422, 501, 505]) {
      expect(isTransientHttpStatus(status)).toBe(false)
    }
  })

  it('parses seconds and HTTP-date Retry-After values', () => {
    expect(parseRetryAfter('2')).toBe(2_000)
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 4_000)).toBe(6_000)
    expect(parseRetryAfter('nonsense')).toBeUndefined()
  })
})
