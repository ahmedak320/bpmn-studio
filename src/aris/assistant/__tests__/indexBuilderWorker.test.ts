import { afterEach, describe, expect, it } from 'vitest'

import { buildDigestsInBrowser, type WorkerLike } from '../browserAssistantIndexer'
import { buildDigest as buildDigestOf } from '../digest'
import { handleIndexBuilderWorkerRequest } from '../indexBuilder.worker'
import type { IndexBuilderWorkerRequest, IndexBuilderWorkerResponse } from '../indexWorkerProtocol'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

describe('handleIndexBuilderWorkerRequest', () => {
  it('digests every requested model and posts a result response', () => {
    const request: IndexBuilderWorkerRequest = {
      type: 'build',
      requestId: 'req-1',
      models: [buildSyntheticModel(), buildSecondSyntheticModel()]
    }
    let response: IndexBuilderWorkerResponse | undefined
    handleIndexBuilderWorkerRequest(request, (r) => (response = r))
    expect(response?.type).toBe('result')
    if (response?.type === 'result') {
      expect(response.digests.map((d) => d.modelId).sort()).toEqual(['m1', 'm2'])
    }
  })

  it('never throws — a malformed request still resolves an error response', () => {
    // Deliberately malformed (models: null instead of an array) to exercise the error path.
    const request = { type: 'build', requestId: 'req-2', models: null } as unknown as IndexBuilderWorkerRequest
    let response: IndexBuilderWorkerResponse | undefined
    expect(() => handleIndexBuilderWorkerRequest(request, (r) => (response = r))).not.toThrow()
    expect(response?.type).toBe('error')
  })
})

describe('buildDigestsInBrowser — fallback path (no Worker global, e.g. Node tests)', () => {
  it('resolves digests synchronously in-thread when Worker is unavailable', async () => {
    const digests = await buildDigestsInBrowser([buildSyntheticModel(), buildSecondSyntheticModel()])
    expect(digests.map((d) => d.modelId).sort()).toEqual(['m1', 'm2'])
  })

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(buildDigestsInBrowser([buildSyntheticModel()], { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})

/** Mirrors the `MockWorker` pattern used by `src/aris/source/xmlTokenizer.test.ts`. */
class MockWorker implements WorkerLike {
  posted: unknown[] = []
  private readonly messageListeners: Array<(event: MessageEvent<IndexBuilderWorkerResponse>) => void> = []
  private readonly errorListeners: Array<(event: ErrorEvent) => void> = []
  private readonly onPost: (message: IndexBuilderWorkerRequest) => void

  constructor(onPost: (message: IndexBuilderWorkerRequest) => void) {
    this.onPost = onPost
  }

  postMessage(message: unknown): void {
    this.posted.push(message)
    this.onPost(message as IndexBuilderWorkerRequest)
  }

  terminate(): void {}

  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    if (type === 'message') this.messageListeners.push(listener as (event: MessageEvent<IndexBuilderWorkerResponse>) => void)
    else this.errorListeners.push(listener as (event: ErrorEvent) => void)
  }

  removeEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    const list = type === 'message' ? this.messageListeners : this.errorListeners
    const index = list.indexOf(listener as never)
    if (index !== -1) list.splice(index, 1)
  }

  emitMessage(data: IndexBuilderWorkerResponse): void {
    for (const listener of [...this.messageListeners]) listener({ data } as MessageEvent<IndexBuilderWorkerResponse>)
  }
}

describe('buildDigestsInBrowser — worker protocol via an injected mock worker', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'Worker')
  })

  it('posts a build request and resolves with the worker-reported digests', async () => {
    ;(globalThis as { Worker?: unknown }).Worker = class {} as unknown
    const mock: MockWorker = new MockWorker((request) => {
      mock.emitMessage({ type: 'result', requestId: request.requestId, digests: [buildDigestOf(buildSyntheticModel())] })
    })
    const digests = await buildDigestsInBrowser([buildSyntheticModel()], { workerFactory: () => mock })
    expect(digests).toHaveLength(1)
    expect(digests[0]?.modelId).toBe('m1')
    expect(mock.posted).toHaveLength(1)
  })

  it('rejects when the worker reports an error', async () => {
    ;(globalThis as { Worker?: unknown }).Worker = class {} as unknown
    const mock: MockWorker = new MockWorker((request) => {
      mock.emitMessage({ type: 'error', requestId: request.requestId, message: 'boom' })
    })
    await expect(buildDigestsInBrowser([buildSyntheticModel()], { workerFactory: () => mock })).rejects.toThrow('boom')
  })
})
