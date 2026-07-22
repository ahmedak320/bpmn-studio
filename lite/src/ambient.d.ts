/// <reference types="vite/client" />

// Ambient declarations for the Lite build. Pulled into the program via a
// triple-slash reference from main.tsx so it is always part of the compilation.
//
// Two jobs:
//  1. Fill the File System Access API gaps that the installed lib.dom lacks
//     (directory async-iterators, the WICG permission methods, the window
//     pickers). lib.dom already ships the handle types + getFileHandle /
//     getDirectoryHandle / removeEntry / createWritable, so only these merge in.
//  2. Provide `declare module` shims for the bpmn.io packages that ship no
//     TypeScript types (the reused desktop editor imports them). The desktop
//     app never hit this because its renderer typecheck is effectively a no-op
//     (root tsconfig has files:[] + project references, run without --build).

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
// bpmn-js additionalModules take opaque DI "module descriptors"; typed as `any`
// (matching how the desktop app consumes them without type stubs) so they slot
// into bpmn-js's ModuleDeclaration[] without a per-call cast.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'bpmn-js-properties-panel' {
  export const BpmnPropertiesPanelModule: any
  export const BpmnPropertiesProviderModule: any
}
declare module 'bpmn-js-create-append-anything' {
  export const CreateAppendAnythingModule: any
  export const CreateAppendElementTemplatesModule: any
}
declare module 'diagram-js-minimap' {
  const minimapModule: any
  export default minimapModule
}
