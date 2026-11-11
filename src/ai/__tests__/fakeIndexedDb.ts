import { vi } from 'vitest'

/** Minimal in-memory IndexedDB: enough for one object store with get and add. */
export function installFakeIndexedDb(): void {
  const stores = new Map<string, Map<string, unknown>>()
  let database: unknown = null
  const later = (run: () => void): void => {
    setTimeout(run, 0)
  }
  const makeDatabase = () => ({
    createObjectStore(name: string) {
      stores.set(name, new Map())
    },
    close() {},
    transaction(name: string) {
      const store = stores.get(name)
      if (!store) throw new Error(`missing store ${name}`)
      const transaction: {
        oncomplete: (() => void) | null
        onerror: (() => void) | null
        onabort: (() => void) | null
        error: unknown
        objectStore: () => unknown
      } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: () => ({
          get(key: string) {
            return request(() => store.get(key))
          },
          add(value: unknown, key: string) {
            return request(() => {
              if (store.has(key)) {
                const error = new Error('ConstraintError')
                error.name = 'ConstraintError'
                throw error
              }
              store.set(key, value)
              return key
            })
          }
        })
      }
      const request = (run: () => unknown) => {
        const handle: {
          result?: unknown
          error?: unknown
          onsuccess?: (() => void) | null
          onerror?: ((event: { preventDefault: () => void }) => void) | null
        } = {}
        later(() => {
          try {
            handle.result = run()
            handle.onsuccess?.()
          } catch (error) {
            handle.error = error
            handle.onerror?.({ preventDefault: () => undefined })
          }
          later(() => transaction.oncomplete?.())
        })
        return handle
      }
      return transaction
    }
  })
  vi.stubGlobal('indexedDB', {
    open(_name: string, _version: number) {
      const handle: {
        result?: unknown
        onupgradeneeded?: (() => void) | null
        onsuccess?: (() => void) | null
        onerror?: (() => void) | null
      } = {}
      later(() => {
        if (database === null) {
          database = makeDatabase()
          handle.result = database
          handle.onupgradeneeded?.()
        }
        handle.result = database
        handle.onsuccess?.()
      })
      return handle
    }
  })
}
