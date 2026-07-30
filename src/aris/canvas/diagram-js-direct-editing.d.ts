/**
 * `diagram-js-direct-editing` ships no type declarations. It is a plain
 * diagram-js module declaration providing the `directEditing` service plus a
 * `DirectEditing` provider registry (`registerProvider`, `activate`, `update`).
 * Only the default-exported module declaration is consumed here; the injected
 * `directEditing` service is typed locally in `directEdit.ts`.
 */
declare module 'diagram-js-direct-editing' {
  const DirectEditingModule: Record<string, unknown>
  export default DirectEditingModule
}
