import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRetainedInlineWorker } from './inlineWorker'

class FakeWorker extends EventTarget {
  terminated = false

  postMessage(): void {}

  terminate(): void {
    this.terminated = true
  }
}

const originalDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(URL, 'revokeObjectURL', originalDescriptor)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

function installRevokeSpy(): ReturnType<typeof vi.fn<(url: string) => void>> {
  const revoke = vi.fn<(url: string) => void>()
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revoke
  })
  return revoke
}

describe('createRetainedInlineWorker', () => {
  it('retains a synchronously revoked Vite blob URL until the worker loads', () => {
    const revoke = installRevokeSpy()
    const worker = createRetainedInlineWorker(() => {
      URL.revokeObjectURL('blob:null/webkit-worker')
      return new FakeWorker() as unknown as Worker
    })

    expect(revoke).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toBe(revoke)

    worker.dispatchEvent(new MessageEvent('message', { data: { ready: true } }))

    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:null/webkit-worker')
  })

  it('releases retained URLs when a caller terminates before the first message', () => {
    const revoke = installRevokeSpy()
    const fake = new FakeWorker()
    const worker = createRetainedInlineWorker(() => {
      URL.revokeObjectURL('blob:null/cancelled-worker')
      return fake as unknown as Worker
    })

    worker.terminate()

    expect(fake.terminated).toBe(true)
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:null/cancelled-worker')
  })

  it('restores URL cleanup and releases retained URLs when construction throws', () => {
    const revoke = installRevokeSpy()

    expect(() =>
      createRetainedInlineWorker(() => {
        URL.revokeObjectURL('blob:null/failed-worker')
        throw new Error('worker construction failed')
      })
    ).toThrow('worker construction failed')

    expect(URL.revokeObjectURL).toBe(revoke)
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:null/failed-worker')
  })
})
