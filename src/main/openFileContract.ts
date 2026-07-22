// Shared IPC contract for the .bpmn file-open surface: channel name(s) +
// payload types, importable from BOTH main (openFile.ts) and preload (no
// Electron main-process imports here) so the two can never drift — same
// pattern as src/main/workspace/ipcContract.ts.

export const OPEN_FILE_CHANNELS = {
  /** main -> renderer: a .bpmn file (double-click / second-instance argv /
   *  import-from-outside-workspace) should be opened as a tab. */
  openFile: 'openFile:open'
} as const

export interface OpenFilePayload {
  /** posix-style path relative to the workspace root, e.g. "sub/file.bpmn" */
  relPath: string
}
