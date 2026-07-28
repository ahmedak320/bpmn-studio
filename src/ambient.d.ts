/// <reference types="vite/client" />

declare const __APP_VERSION__: string

// Ambient declarations for the Lite build. tsconfig.json includes this file
// directly with the rest of src/.
//
// Two jobs:
//  1. Fill the File System Access API gaps that the installed lib.dom lacks
//     (directory async-iterators, the WICG permission methods, the window
//     pickers). lib.dom already ships the handle types + getFileHandle /
//     getDirectoryHandle / removeEntry / createWritable, so only these merge in.
//  2. Provide `declare module` shims for the remaining bpmn.io/diagram.io
//     packages that ship no TypeScript types and are still imported by retained
//     infrastructure (generation layout, workspace indexing, validation).

// --- File System Access API (gaps) ---------------------------------------

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
  keys(): AsyncIterableIterator<string>
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
}

interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | string
}

interface OpenFilePickerOptions {
  multiple?: boolean
  excludeAcceptAllOption?: boolean
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
}

// --- Untyped bpmn.io packages --------------------------------------------

declare module 'bpmn-auto-layout' {
  export function layoutProcess(xml: string): Promise<string>
}
// The shims for `bpmn-js-properties-panel`, `bpmn-js-create-append-anything`
// and `bpmn-js-bpmnlint` were removed with the BPMN editor (plan §5.3) — the
// deleted `src/editor/EditorTabLite.tsx` was their only importer. The packages
// themselves are still listed as devDependencies; see the §5.4 note there.
/* eslint-disable @typescript-eslint/no-explicit-any -- third-party module descriptors are intentionally opaque */
declare module 'diagram-js-minimap' {
  const minimapModule: any
  export default minimapModule
}
/* eslint-enable @typescript-eslint/no-explicit-any */

declare module 'bpmnlint' {
  export class Linter {
    constructor(options: {
      config?: unknown
      resolver: {
        resolveRule(pkg: string, ruleName: string): unknown
        resolveConfig?(pkg: string, configName: string): unknown
      }
    })
    lint(root: unknown, config?: unknown): Promise<Record<string, unknown[]>>
  }
}

declare module 'bpmnlint/rules/*' {
  const ruleFactory: (options?: unknown) => unknown
  export default ruleFactory
}
