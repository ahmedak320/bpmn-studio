import { describe, expect, it, vi } from 'vitest'

import { BrowserCsvParserAdapter, parseBrowserSpreadsheet } from './browserParserAdapters'
import { SpreadsheetError } from './errors'
import { SPREADSHEET_LIMITS } from './limits'
import type { SpreadsheetWorkerResponse } from './workerProtocol'

class FakeWorker {
  readonly posted: unknown[] = []
  terminated = false
  private readonly messages = new Set<(event: MessageEvent<SpreadsheetWorkerResponse>) => void>()
  private readonly errors = new Set<(event: ErrorEvent) => void>()

  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messages.add(listener)
    else this.errors.add(listener)
  }
  removeEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messages.delete(listener)
    else this.errors.delete(listener)
  }
  respond(response: SpreadsheetWorkerResponse): void {
    for (const listener of this.messages) {
      listener({ data: response } as MessageEvent<SpreadsheetWorkerResponse>)
    }
  }
}

describe('browser spreadsheet parser adapters', () => {
  it('forwards worker progress and returns rows', async () => {
    const worker = new FakeWorker()
    const progress = vi.fn()
    const parse = new BrowserCsvParserAdapter(() => worker as never).parseUtf8(
      new TextEncoder().encode('a,b'),
      { delimiter: ',', onProgress: progress }
    )
    const request = worker.posted[0] as { requestId: string }
    worker.respond({
      type: 'progress',
      requestId: request.requestId,
      progress: { phase: 'parse', completed: 2, total: 3 }
    })
    worker.respond({
      type: 'result',
      requestId: request.requestId,
      format: 'csv',
      rows: [['a', 'b']]
    })

    await expect(parse).resolves.toEqual([['a', 'b']])
    expect(progress).toHaveBeenCalledWith({
      phase: 'parse',
      completed: 2,
      total: 3
    })
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker and reports cancellation', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const parse = new BrowserCsvParserAdapter(() => worker as never).parseUtf8(
      new TextEncoder().encode('a,b'),
      { delimiter: ',', signal: controller.signal }
    )
    controller.abort()
    await expect(parse).rejects.toMatchObject({
      code: 'parse-cancelled'
    } satisfies Partial<SpreadsheetError>)
    expect(worker.terminated).toBe(true)
  })

  it.each(['xlsx', 'csv'] as const)(
    'rejects an oversized %s file before allocating its bytes',
    async (extension) => {
      const arrayBuffer = vi.fn(async () => {
        throw new Error('oversized spreadsheet must not be read')
      })
      await expect(
        parseBrowserSpreadsheet({
          name: `oversized.${extension}`,
          size: SPREADSHEET_LIMITS.compressedInputBytes + 1,
          arrayBuffer
        })
      ).rejects.toMatchObject({
        code: 'compressed-size-limit'
      } satisfies Partial<SpreadsheetError>)
      expect(arrayBuffer).not.toHaveBeenCalled()
    }
  )
})
