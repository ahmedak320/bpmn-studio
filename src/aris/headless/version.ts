/**
 * Engine version stamped into every headless render (implementation plan Lane
 * L-HEADLESS, Wave 20; deliverable 3).
 *
 * `EPC_ENGINE_VERSION` is the single source of truth for the
 * `data-epc-engine-version` SVG-root attribute and `metadata.engineVersion`.
 * It is a plain constant (no clock or randomness) so the same input +
 * same engine version yields byte-identical output.
 *
 * The value tracks `packages/epc-engine/package.json`'s `version`. That
 * sub-package manifest lands in W21 (Lane L-PKG); until then it does not exist,
 * so `version.test.ts` asserts equality only when the manifest is present
 * (guarded by `existsSync` on a repo path — NOT a private `reference/...`
 * fixture, so the `check:no-skips` fixture-guard ban does not apply). Bumping
 * this constant is the explicit, reviewed "engine version changed" signal that
 * also invalidates the committed SVG snapshot hash in `render.test.ts`.
 */

export const EPC_ENGINE_VERSION = '0.3.0'
