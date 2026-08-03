/**
 * `jsdom` ships no bundled type declarations and `@types/jsdom` is deliberately
 * not a dependency (ZERO new dependencies is a hard target). The headless render
 * entry uses only `JSDOM` + its `window`, so this ambient declaration provides
 * exactly that minimal surface — mirroring the repo's other colocated untyped
 * module shims (e.g. `../canvas/diagram-js-minimap.d.ts`). A pure ambient `.d.ts`
 * (no imports/exports) declares the module rather than augmenting it, so it does
 * not hit the "cannot augment an untyped module" error a same-file declaration
 * would.
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    readonly window: Window & typeof globalThis
  }
}
