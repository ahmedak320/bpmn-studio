// Tiny promise wrapper over a single IndexedDB object store. Used only to
// persist the opened workspace's FileSystemDirectoryHandle (handles are
// structured-cloneable) so the folder can be re-offered on the next visit
// without a fresh picker. Deliberately dependency-free (no idb-keyval) to keep
// the single-file bundle lean.

const DB_NAME = 'orbitpm-lite'
const STORE = 'kv'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>('readonly', (store) => store.get(key))
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return withStore<void>('readwrite', (store) => store.put(value, key))
}

export function idbDel(key: string): Promise<void> {
  return withStore<void>('readwrite', (store) => store.delete(key))
}
