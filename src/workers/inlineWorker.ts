/**
 * Construct a Vite `?worker&inline` worker without allowing its bootstrap
 * object URL to be revoked before WebKit has loaded it.
 *
 * Vite's inline-worker constructor creates a blob URL and revokes it in the
 * same JavaScript turn. Chromium and Firefox retain the worker source at
 * construction time, but WebKit may fetch the blob asynchronously. This is
 * observable for a `file://` Lite build as a failed `blob:null/...` request.
 *
 * Interception is synchronous and scoped to the constructor call. Captured
 * URLs are released after the worker proves it loaded (its first message or
 * error), or when the caller terminates it.
 */
export function createRetainedInlineWorker(construct: () => Worker): Worker {
  const urlApi = globalThis.URL
  const originalRevoke = urlApi?.revokeObjectURL
  if (!urlApi || typeof originalRevoke !== 'function') return construct()

  const descriptor = Object.getOwnPropertyDescriptor(urlApi, 'revokeObjectURL')
  const retainedUrls = new Set<string>()
  let interceptionInstalled = false
  try {
    Object.defineProperty(urlApi, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: (objectUrl: string): void => {
        retainedUrls.add(objectUrl)
      }
    })
    interceptionInstalled = true
  } catch {
    // A locked-down host can make the static URL method non-configurable. In
    // that environment retain the platform/Vite behavior instead of mutating
    // another global or constructing the worker twice.
    return construct()
  }

  let worker: Worker | undefined
  let constructionError: unknown
  try {
    worker = construct()
  } catch (error) {
    constructionError = error
  } finally {
    if (interceptionInstalled) {
      if (descriptor) Object.defineProperty(urlApi, 'revokeObjectURL', descriptor)
      else Reflect.deleteProperty(urlApi, 'revokeObjectURL')
    }
  }

  let released = false
  const releaseRetainedUrls = (): void => {
    if (released) return
    released = true
    for (const objectUrl of retainedUrls) {
      try {
        originalRevoke.call(urlApi, objectUrl)
      } catch {
        // Object URL cleanup is best-effort and must not replace the worker's
        // actual result or error.
      }
    }
    retainedUrls.clear()
  }

  if (!worker) {
    releaseRetainedUrls()
    throw constructionError
  }

  worker.addEventListener('message', releaseRetainedUrls, { once: true })
  worker.addEventListener('error', releaseRetainedUrls, { once: true })
  const terminate = worker.terminate.bind(worker)
  worker.terminate = (): void => {
    releaseRetainedUrls()
    terminate()
  }
  return worker
}
