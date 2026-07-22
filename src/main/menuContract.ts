// Shared IPC contract for native-menu -> renderer action round-trips: the
// menu itself only knows "the user picked New Process" — the renderer (tabs,
// editor, dirty state) owns what actually happens. No Electron imports here
// so preload can pull this in safely — same pattern as ipcContract.ts /
// openFileContract.ts.

export const MENU_CHANNELS = {
  newProcess: 'menu:new-process',
  openWorkspaceFolder: 'menu:open-workspace-folder',
  save: 'menu:save',
  exportSvg: 'menu:export-svg',
  exportPng: 'menu:export-png'
} as const

export type MenuActionChannel = (typeof MENU_CHANNELS)[keyof typeof MENU_CHANNELS]
