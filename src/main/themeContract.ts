// Shared IPC contract for nativeTheme forwarding (main -> renderer): the
// initial value via invoke, plus change notifications via an event. No
// Electron imports here so preload can pull this in safely — same pattern
// as ipcContract.ts / openFileContract.ts / menuContract.ts.

export const THEME_CHANNELS = {
  /** renderer -> main invoke: current nativeTheme.shouldUseDarkColors. */
  get: 'theme:get',
  /** main -> renderer event: fired whenever the OS theme changes. */
  changed: 'theme:changed'
} as const

export type ThemeMode = 'dark' | 'light'
