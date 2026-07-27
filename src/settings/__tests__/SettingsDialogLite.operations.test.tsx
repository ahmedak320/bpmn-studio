// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKey, resetSessionKeysForTests, setKey } from '../../ai/keys'
import { resetProviderSelectionForTests } from '../../ai/providerSelection'
import { setLang, t } from '../../i18n'
import { SettingsDialogLite } from '../SettingsDialogLite'

vi.mock('../LocalizationResourcesEditor', () => ({
  LocalizationResourcesEditor: () => null
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function installMemoryStorage(): Map<string, string> {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear()
  })
  return values
}

function installDeferredCrypto(): {
  derivations: Deferred<CryptoKey>[]
  encrypt: ReturnType<typeof vi.fn>
} {
  const derivations: Deferred<CryptoKey>[] = []
  const encrypt = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer)
  let randomCall = 0
  vi.stubGlobal('crypto', {
    getRandomValues: <T extends ArrayBufferView>(value: T): T => {
      randomCall += 1
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(randomCall)
      return value
    },
    subtle: {
      importKey: vi.fn(async () => ({ type: 'secret' }) as CryptoKey),
      deriveKey: vi.fn(() => {
        const operation = deferred<CryptoKey>()
        derivations.push(operation)
        return operation.promise
      }),
      encrypt
    }
  } as unknown as Crypto)
  return { derivations, encrypt }
}

function renderSettings(onKeysChanged = vi.fn()): {
  onKeysChanged: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  unmount: () => void
} {
  const onClose = vi.fn()
  const view = render(
    <SettingsDialogLite
      open
      onClose={onClose}
      onKeysChanged={onKeysChanged}
      onOrgStylingChanged={vi.fn()}
    />
  )
  return { onKeysChanged, onClose, unmount: view.unmount }
}

async function enterEncryptedDraft(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(
    screen.getByRole('checkbox', {
      name: t('settings.encryption.persist')
    })
  )
  await user.type(screen.getByLabelText(t('settings.encryption.passphrase')), 'passphrase')
  const keyInput = screen.getByLabelText(
    t('settings.apiKey.aria', {
      label: 'OpenRouter'
    })
  )
  await user.clear(keyInput)
  await user.type(keyInput, value)
}

function installAbortableProbeFetch(): {
  signals: AbortSignal[]
  fetchMock: ReturnType<typeof vi.fn>
} {
  const signals: AbortSignal[] = []
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal
        signals.push(signal)
        const rejectAbort = (): void =>
          reject(new DOMException('The connection test was aborted.', 'AbortError'))
        if (signal.aborted) rejectAbort()
        else signal.addEventListener('abort', rejectAbort, { once: true })
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  return { signals, fetchMock }
}

function installDeferredFetch(): {
  requests: Array<{ signal: AbortSignal; response: Deferred<Response> }>
  fetchMock: ReturnType<typeof vi.fn>
} {
  const requests: Array<{ signal: AbortSignal; response: Deferred<Response> }> = []
  const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const response = deferred<Response>()
    requests.push({ signal: init?.signal as AbortSignal, response })
    return response.promise
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

function creditsResponse(totalCredits: number, totalUsage: number): Response {
  return new Response(
    JSON.stringify({
      data: {
        total_credits: totalCredits,
        total_usage: totalUsage
      }
    }),
    { status: 200 }
  )
}

async function startConnectionTest(
  user: ReturnType<typeof userEvent.setup>,
  providerLabel: string
): Promise<void> {
  const provider = screen.getByRole('region', { name: providerLabel })
  await user.click(
    within(provider).getByRole('checkbox', {
      name: t('settings.testConnection.billableDisclosure')
    })
  )
  await user.click(
    within(provider).getByRole('button', {
      name: t('settings.testConnection')
    })
  )
}

describe('SettingsDialogLite async operation ordering', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    resetSessionKeysForTests()
    resetProviderSelectionForTests()
    setLang('en')
    storage = installMemoryStorage()
  })

  afterEach(() => {
    cleanup()
    resetSessionKeysForTests()
    resetProviderSelectionForTests()
    setLang('en')
    vi.unstubAllGlobals()
  })

  it('lets Clear supersede an older encrypted Save and exposes the pending state accessibly', async () => {
    setKey('openrouter', 'existing-key')
    storage.set('orbitpm.lite.key.encrypted.openrouter', '{"existing":true}')
    const crypto = installDeferredCrypto()
    const user = userEvent.setup()
    const { onKeysChanged } = renderSettings()

    await enterEncryptedDraft(user, 'late-key')
    await user.click(screen.getByRole('button', { name: t('settings.saveKeys') }))
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))

    const pendingStatus = screen.getByRole('status')
    expect(pendingStatus.textContent).toBe(t('settings.credentials.saving'))
    const pendingSave = screen.getByRole('button', {
      name: t('settings.credentials.saving')
    })
    expect(pendingSave.getAttribute('aria-busy')).toBe('true')
    expect(pendingSave.getAttribute('aria-describedby')).toBe(pendingStatus.id)
    expect(
      screen
        .getByRole('region', {
          name: t('settings.encryption.title')
        })
        .getAttribute('aria-busy')
    ).toBe('true')
    expect(
      screen.getByRole('button', {
        name: t('settings.encryption.unlock')
      })
    ).toHaveProperty('disabled', true)

    await user.click(screen.getByRole('button', { name: t('settings.clearKey') }))
    expect(screen.getByText(t('settings.keyCleared'))).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()

    await act(async () => {
      crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)
      await Promise.resolve()
    })

    expect(crypto.encrypt).not.toHaveBeenCalled()
    expect(getKey('openrouter')).toBe('')
    expect(storage.has('orbitpm.lite.key.encrypted.openrouter')).toBe(false)
    expect(screen.queryByText(t('settings.saved'))).toBeNull()
    expect(screen.getByText(t('settings.keyCleared'))).toBeTruthy()
    expect(onKeysChanged).toHaveBeenCalledTimes(1)
  })

  it('allows a newer Save to replace an older Save and only the newer completion reports success', async () => {
    setKey('openrouter', 'existing-key')
    const crypto = installDeferredCrypto()
    const user = userEvent.setup()
    const { onKeysChanged } = renderSettings()

    await enterEncryptedDraft(user, 'older-key')
    await user.click(screen.getByRole('button', { name: t('settings.saveKeys') }))
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))

    const keyInput = screen.getByLabelText(
      t('settings.apiKey.aria', {
        label: 'OpenRouter'
      })
    )
    await user.clear(keyInput)
    await user.type(keyInput, 'newer-key')
    await user.click(
      screen.getByRole('button', {
        name: t('settings.credentials.saving')
      })
    )
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(2))

    await act(async () => {
      crypto.derivations[1]!.resolve({ type: 'secret' } as CryptoKey)
    })
    expect(await screen.findByText(t('settings.saved'))).toBeTruthy()
    expect(getKey('openrouter')).toBe('newer-key')

    await act(async () => {
      crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)
      await Promise.resolve()
    })
    expect(crypto.encrypt).toHaveBeenCalledTimes(1)
    expect(getKey('openrouter')).toBe('newer-key')
    expect(screen.getByText(t('settings.saved'))).toBeTruthy()
    expect(onKeysChanged).toHaveBeenCalledTimes(1)
  })

  it('aborts an encrypted Save on unmount without storing a key or claiming success', async () => {
    const crypto = installDeferredCrypto()
    const user = userEvent.setup()
    const { onKeysChanged, unmount } = renderSettings()

    await enterEncryptedDraft(user, 'unmounted-key')
    await user.click(screen.getByRole('button', { name: t('settings.saveKeys') }))
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))
    unmount()

    await act(async () => {
      crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)
      await Promise.resolve()
    })

    expect(crypto.encrypt).not.toHaveBeenCalled()
    expect(getKey('openrouter')).toBe('')
    expect(storage.has('orbitpm.lite.key.encrypted.openrouter')).toBe(false)
    expect(onKeysChanged).not.toHaveBeenCalled()
  })

  it('aborts the older connection test when a new test starts and aborts the new one on close', async () => {
    const { signals, fetchMock } = installAbortableProbeFetch()
    const user = userEvent.setup()
    const { onClose } = renderSettings()

    await startConnectionTest(user, 'OpenRouter')
    await vi.waitFor(() => expect(signals).toHaveLength(1))

    await startConnectionTest(user, 'Anthropic')
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[0]?.aborted).toBe(true)

    await user.click(
      within(screen.getByRole('banner')).getByRole('button', {
        name: t('settings.close.aria')
      })
    )

    expect(signals[1]?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('aborts an in-flight connection test on unmount', async () => {
    const { signals, fetchMock } = installAbortableProbeFetch()
    const user = userEvent.setup()
    const { unmount } = renderSettings()

    await startConnectionTest(user, 'Google Gemini')
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    unmount()

    expect(signals[0]?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      await Promise.resolve()
    })
  })

  it('makes credit refresh latest-wins, suppresses stale results, and aborts on close', async () => {
    setKey('openrouter', 'configured-key')
    const { requests, fetchMock } = installDeferredFetch()
    const user = userEvent.setup()
    const { onClose } = renderSettings()
    const refreshButton = (): HTMLElement =>
      within(screen.getByRole('region', { name: 'OpenRouter' })).getByRole('button', {
        name: t('ai.credits.refresh')
      })

    await user.click(refreshButton())
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(screen.getByText(t('ai.credits.loading'))).toBeTruthy()

    await user.click(refreshButton())
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[0]?.signal.aborted).toBe(true)

    await act(async () => {
      requests[1]!.response.resolve(creditsResponse(10, 3))
    })
    expect(await screen.findByText(t('ai.credits.remaining', { amount: '7.00' }))).toBeTruthy()

    await act(async () => {
      requests[0]!.response.resolve(creditsResponse(100, 0))
      await Promise.resolve()
    })
    expect(screen.getByText(t('ai.credits.remaining', { amount: '7.00' }))).toBeTruthy()
    expect(screen.queryByText(t('ai.credits.remaining', { amount: '100.00' }))).toBeNull()

    await user.click(refreshButton())
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    await user.click(
      within(screen.getByRole('banner')).getByRole('button', {
        name: t('settings.close.aria')
      })
    )

    expect(requests[2]?.signal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(t('ai.credits.loading'))).toBeNull()
    expect(screen.queryByText(t('ai.credits.error.network'))).toBeNull()
    expect(screen.queryByText(t('ai.credits.error.unexpected'))).toBeNull()
    await act(async () => {
      requests[2]!.response.resolve(creditsResponse(100, 0))
      await Promise.resolve()
    })
    expect(screen.getByText(t('ai.credits.remaining', { amount: '7.00' }))).toBeTruthy()
    expect(screen.queryByText(t('ai.credits.remaining', { amount: '100.00' }))).toBeNull()
  })

  it('aborts an in-flight credit refresh on unmount', async () => {
    setKey('openrouter', 'configured-key')
    const { signals, fetchMock } = installAbortableProbeFetch()
    const user = userEvent.setup()
    const { unmount } = renderSettings()

    await user.click(
      within(screen.getByRole('region', { name: 'OpenRouter' })).getByRole('button', {
        name: t('ai.credits.refresh')
      })
    )
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    unmount()

    expect(signals[0]?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      await Promise.resolve()
    })
  })

  it('invalidates old-key credit refresh state when an OpenRouter key is replaced', async () => {
    setKey('openrouter', 'old-key')
    const { requests } = installDeferredFetch()
    const user = userEvent.setup()
    const { onKeysChanged } = renderSettings()
    const openRouter = (): HTMLElement => screen.getByRole('region', { name: 'OpenRouter' })
    const refresh = (): HTMLElement =>
      within(openRouter()).getByRole('button', { name: t('ai.credits.refresh') })

    await user.click(refresh())
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await act(async () => {
      requests[0]!.response.resolve(creditsResponse(10, 3))
    })
    expect(await screen.findByText(t('ai.credits.remaining', { amount: '7.00' }))).toBeTruthy()

    await user.click(refresh())
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await user.type(
      within(openRouter()).getByLabelText(
        t('settings.apiKey.aria', {
          label: 'OpenRouter'
        })
      ),
      'replacement-key'
    )
    await user.click(screen.getByRole('button', { name: t('settings.saveKeys') }))

    await vi.waitFor(() => expect(getKey('openrouter')).toBe('replacement-key'))
    expect(requests[1]?.signal.aborted).toBe(true)
    expect(screen.getByText(t('ai.credits.refreshHint'))).toBeTruthy()
    expect(screen.queryByText(t('ai.credits.remaining', { amount: '7.00' }))).toBeNull()
    expect(onKeysChanged).toHaveBeenCalledTimes(1)

    await act(async () => {
      requests[1]!.response.resolve(creditsResponse(100, 0))
      await Promise.resolve()
    })
    expect(screen.getByText(t('ai.credits.refreshHint'))).toBeTruthy()
    expect(screen.queryByText(t('ai.credits.remaining', { amount: '100.00' }))).toBeNull()
  })

  it('clears cached credit state and aborts refresh when the OpenRouter key is cleared', async () => {
    setKey('openrouter', 'old-key')
    const { requests } = installDeferredFetch()
    const user = userEvent.setup()
    renderSettings()
    const openRouter = (): HTMLElement => screen.getByRole('region', { name: 'OpenRouter' })
    const refresh = (): HTMLElement =>
      within(openRouter()).getByRole('button', { name: t('ai.credits.refresh') })

    await user.click(refresh())
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await act(async () => {
      requests[0]!.response.resolve(creditsResponse(10, 3))
    })
    expect(await screen.findByText(t('ai.credits.remaining', { amount: '7.00' }))).toBeTruthy()

    await user.click(refresh())
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await user.click(
      within(openRouter()).getByRole('button', {
        name: t('settings.clearKey')
      })
    )

    expect(getKey('openrouter')).toBe('')
    expect(requests[1]?.signal.aborted).toBe(true)
    expect(screen.queryByText(t('ai.credits.remaining', { amount: '7.00' }))).toBeNull()

    await act(async () => {
      requests[1]!.response.resolve(creditsResponse(100, 0))
      await Promise.resolve()
    })
    expect(screen.queryByText(t('ai.credits.remaining', { amount: '100.00' }))).toBeNull()
  })
})
