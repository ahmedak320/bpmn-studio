import { describe, expect, it } from 'vitest'

import { parseArisWorkbookInBrowser } from './browserWorkbookParser'
import { ArisExcelIssueError, createArisExcelIssue } from './issues'
import { buildValidFixtureWorkbook } from './testFixtures'
import { handleArisWorkbookWorkerRequest } from './workbookParser.worker'
import type { ArisWorkbookWorkerResponse } from './workbookParserWorkerProtocol'

class FakeWorker {
  readonly posted: unknown[] = []
  readonly transfers: (Transferable[] | undefined)[] = []
  terminated = false
  private readonly messages = new Set<(event: MessageEvent<ArisWorkbookWorkerResponse>) => void>()
  private readonly errors = new Set<(event: ErrorEvent) => void>()

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push(message)
    this.transfers.push(transfer)
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
  respond(response: ArisWorkbookWorkerResponse): void {
    for (const listener of this.messages) {
      listener({ data: response } as MessageEvent<ArisWorkbookWorkerResponse>)
    }
  }
  fail(): void {
    for (const listener of this.errors) listener({} as ErrorEvent)
  }
  get requestId(): string {
    return (this.posted[0] as { requestId: string }).requestId
  }
}

describe('inline-worker boundary (§15.3 step 4)', () => {
  it('parses inside the worker handler and returns a transferable-free result', () => {
    const bytes = buildValidFixtureWorkbook()
    const buffer = new Uint8Array(bytes).buffer
    const responses: ArisWorkbookWorkerResponse[] = []
    handleArisWorkbookWorkerRequest(
      { type: 'parse', requestId: 'r1', fileName: 'model.xlsx', bytes: buffer },
      (response) => responses.push(response)
    )
    expect(responses).toHaveLength(1)
    const response = responses[0]!
    expect(response.type).toBe('result')
    if (response.type !== 'result') return
    expect(response.result.status).toBe('accepted')
    expect(response.result.model?.counts.models).toBe(1)
  })

  it('resolves the browser promise from the worker result and terminates the worker', async () => {
    const worker = new FakeWorker()
    const bytes = buildValidFixtureWorkbook()
    const pending = parseArisWorkbookInBrowser('model.xlsx', bytes, {
      workerFactory: () => worker as never
    })
    expect(worker.transfers[0]).toHaveLength(1)

    const request = worker.posted[0] as { bytes: ArrayBuffer; fileName: string }
    const responses: ArisWorkbookWorkerResponse[] = []
    handleArisWorkbookWorkerRequest(
      {
        type: 'parse',
        requestId: worker.requestId,
        fileName: request.fileName,
        bytes: request.bytes
      },
      (response) => responses.push(response)
    )
    worker.respond(responses[0]!)

    await expect(pending).resolves.toMatchObject({ status: 'accepted' })
    expect(worker.terminated).toBe(true)
  })

  it('rejects with the localizable issue when the worker reports one', async () => {
    const worker = new FakeWorker()
    const pending = parseArisWorkbookInBrowser('model.xlsx', buildValidFixtureWorkbook(), {
      workerFactory: () => worker as never
    })
    worker.respond({
      type: 'error',
      requestId: worker.requestId,
      issue: createArisExcelIssue('internal-error', 'error', { details: { reason: 'test' } })
    })
    await expect(pending).rejects.toBeInstanceOf(ArisExcelIssueError)
    expect(worker.terminated).toBe(true)
  })

  it('surfaces a worker crash as an internal-error issue', async () => {
    const worker = new FakeWorker()
    const pending = parseArisWorkbookInBrowser('model.xlsx', buildValidFixtureWorkbook(), {
      workerFactory: () => worker as never
    })
    worker.fail()
    await expect(pending).rejects.toMatchObject({
      issue: { code: 'internal-error', messageKey: 'aris.excel.issue.internal-error' }
    })
  })

  it('cancels through an abort signal', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const pending = parseArisWorkbookInBrowser('model.xlsx', buildValidFixtureWorkbook(), {
      workerFactory: () => worker as never,
      signal: controller.signal
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('falls back to the identical in-process parse when no worker can be created', async () => {
    const result = await parseArisWorkbookInBrowser('model.xlsx', buildValidFixtureWorkbook(), {
      workerFactory: () => {
        throw new Error('workers unavailable')
      }
    })
    expect(result.status).toBe('accepted')
    expect(result.model?.counts.objectOccurrences).toBe(2)
  })
})
