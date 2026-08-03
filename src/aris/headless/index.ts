/**
 * Barrel for the headless canonical->SVG render entry (implementation plan Lane
 * L-HEADLESS, Wave 20; deliverable 3). This is the `index` entry the library
 * build (`vite.lib.config.ts`, W21) bundles for the enterprise consumer.
 *
 * ## PNG is consumer-side (no rasterizer dependency)
 *
 * The engine guarantees SVG + versioned metadata only. To rasterize a result to
 * PNG, feed `result.svg` (and `capture`-derived size) to
 * `arisSvgToPngDataUrl(markup, size, deps)` (`../canvas/exportArisPdf`) with
 * consumer-injected `createCanvas`/`loadImage` deps (e.g. `@napi-rs/canvas` in
 * the Azure worker, or a browser `<canvas>`/`<img>`). This campaign adds NO
 * rasterizer dependency — the jsdom-only runtime dep is preserved.
 */

export { ensureHeadlessDom } from './environment'
export {
  renderCanonicalProcess,
  type HeadlessRenderMetadata,
  type HeadlessRenderParseFailure,
  type HeadlessRenderResult,
  type HeadlessRenderSuccess,
  type HeadlessRenderValidationFailure,
  type RenderCanonicalProcessOptions
} from './render'
export { EPC_ENGINE_VERSION } from './version'
