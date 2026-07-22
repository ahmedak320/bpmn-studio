import { contextBridge } from 'electron'

// Minimal typed surface exposed to the renderer. Grows in later waves
// (workspace fs IPC, AI generate IPC, secrets, updater) — kept intentionally
// small here since nothing sensitive should ever be reachable directly.
const api = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
}

export type OrbitPmApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('orbitpm', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.orbitpm = api
}
