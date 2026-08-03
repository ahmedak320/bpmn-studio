# @orbitpm/epc-engine

The OrbitPM EPC engine as a service. This sub-package repackages the same
`src/aris` engine that powers OrbitPM ARIS Studio Lite — `CanonicalProcessV1`
schema → EPC projection → structural validation → headless SVG render — as a
versioned library for consumption by a private enterprise repository. The
studio UX is unchanged; this is a build artifact + manifest, not a second app.

## What it exports

- `.` (`./dist/index.js`) — the headless render entry: `renderCanonicalProcess`,
  `ensureHeadlessDom`, `EPC_ENGINE_VERSION`, and the render result types.
- `./canonical` (`./dist/canonical.js`) — the `CanonicalProcessV1` contract,
  JSON Schema emitter, canonical→EPC projection, findings, and the verification
  package / narrative builders.
- `epc-project` (bin) — a headless Node CLI (`validate` / `project` / `render`)
  over the same engine. Batch projection/render only.

The single runtime dependency is `jsdom` (pinned to the version vetted at the
repo root). diagram-js and the rest of the engine are bundled in, so a consumer
installs nothing else to render.

## Build

The library is built from the repo root, never from inside this directory:

```bash
npm run build:lib     # vite build --config vite.lib.config.ts
npm run clean:lib     # remove packages/epc-engine/dist
```

`build:lib` emits ES modules into `packages/epc-engine/dist/` (git-ignored). The
studio's own single-file `dist/index.html` build is untouched by this config.

## Consume

npm registry publishing is deferred. Consume the package one of two ways:

- **Tarball:** run `npm run build:lib`, then `npm pack` inside this directory and
  install the resulting `orbitpm-epc-engine-0.1.0.tgz` in the enterprise repo.
- **Git dependency:** reference this repository/sub-path as a git dependency and
  run `npm run build:lib` as part of the consumer's prepare step.

## Reference

- `docs/EPC_PROJECTION.md` — the canonical→EPC projection contract.
- `docs/ENTERPRISE_HANDOFF.md` — the interface contract for the enterprise
  adapter (payload mapping, `sourceVersionId` passthrough, PNG rasterization on
  the consumer side).
