# OrbitPM ARIS Studio Lite

OrbitPM ARIS Studio Lite is a bilingual (English/Arabic), browser-based studio
for ARIS process models. It imports ARIS AML exports (`.aml`, `.apc`, `.xml`),
keeps the imported bytes immutable, edits through working revisions on a native
ARIS canvas, and runs from a single self-contained HTML file — including from
`file://`, with no server, backend, or installer.

This branch (`feat/aris-only-studio`) is an in-flight transformation of the
earlier BPMN product into an ARIS-native one. It is **not** a finished release.
Read the status section before relying on it.

## What it does

- **Lossless AML input.** Imported source is preserved byte-for-byte and is
  never overwritten by editing. Edits are applied as working revisions, and
  export produces a separate derived document (`name.derived.aml`).
- **Source accounting.** Every record in an import is accounted for: mapped,
  preserved-but-unmapped, or reported. Unknown content is retained and
  surfaced in a fidelity report rather than silently dropped.
- **Native ARIS canvas.** Rendering and authoring are built directly on
  `diagram-js`. There is no BPMN canvas, BPMN conversion, or BPMN projection on
  this branch; `npm run check:aris-runtime-boundary` enforces that boundary in
  CI and locally.
- **EPC semantics.** Events, functions, connectors/rules, lanes, return paths,
  and a clean-layout mode that can be toggled against the source geometry.
- **Details, accounting, and EPC rails** for object metadata, attachments, and
  model findings.
- **Create from an ARIS-native Excel template**, offline and deterministic.
- **Optional browser-direct AI (bring your own key).** Creation from a typed
  description or a reviewed document, a folder-aware process assistant with a
  deterministic no-key path, and chat-based improvement/completion. Every
  request that contains process content requires an explicit reviewed consent.
- **English and Arabic** interface, including RTL layout.
- **Storage modes**: directory workspace (File System Access API), browser
  workspace (OPFS) where available, and an explicit single-file open/download
  mode.

### ARIS AML export is Experimental

The derived AML export is labelled **Experimental ARIS AML export** in the UI
and stays that way until a real ARIS installation has imported and re-exported
a produced file. No claim of stable ARIS compatibility is made until that gate
passes. Treat every export as unverified against ARIS.

## Status

The authoritative plan is [aris_transformation.md](aris_transformation.md); the
audited, per-phase state is
[docs/ARIS_PHASE_CHECKLIST.md](docs/ARIS_PHASE_CHECKLIST.md). Summarised, as of
that checklist:

- Most phases are either **Exit gate met** or **Module complete,
  unit-verified** (module tests pass and the code is wired into the shell, but
  at least one exit-gate bullet is not yet demonstrated end to end).
- **Phase 17** (live ARIS import/re-export, golden visual pair) is **blocked on
  user-supplied artifacts** — this is what keeps the export Experimental.
- **Phase 18** (release-quality browser matrix, performance gates,
  publication) has **not started**.
- The plan's "stable definition of done" is **not met**.
- Known drift: `package.json` still carries version `0.4.5` from the previous
  product, while the plan targets `0.1.0-alpha.1`.

Supporting evidence documents:
[Phase 0 baseline](docs/ARIS_PHASE0_BASELINE_2026-07-28.md),
[Phase 1 characterization](docs/ARIS_PHASE1_CHARACTERIZATION.md),
[Phase 2 runtime inventory](docs/ARIS_PHASE2_RUNTIME_INVENTORY.md),
[Phase 3 input layer](docs/ARIS_PHASE3_INPUT_LAYER.md),
[Phases 4–15 modules](docs/ARIS_PHASE4_TO_15_MODULES.md).

The previous product, OrbitPM Process Studio Lite (a BPMN 2.0 editor, v0.4.5),
is preserved on the `main` branch. The GitHub Pages workflow publishes only
approved, tagged Lite releases; this branch is not deployed anywhere.

## Run it

Build the canonical artifact and open it directly:

```bash
npm ci
npm run build:aris     # vite build + refresh release/OrbitPM-ARIS-Studio-Lite.html
```

Then open `release/OrbitPM-ARIS-Studio-Lite.html` in a modern browser — double
clicking it (`file://`) is a supported path. For a live dev server, use
`npm run dev`.

Import a `.aml`, `.apc`, or `.xml` ARIS export, review the import summary, then
edit. Save writes to the selected workspace; the imported original is left
untouched. An Arabic quick start is in
[docs/QUICKSTART.ar.md](docs/QUICKSTART.ar.md).

## Privacy in one minute

- Import, editing, accounting, export, and Excel creation are local.
- There is no telemetry, account system, or application backend.
- API keys stay in page memory by default; optional persistence encrypts them
  with a passphrase the application does not store.
- External AI and translation calls happen only after a review screen shows the
  provider, model, and payload, and the user consents.

Read [docs/PRIVACY.md](docs/PRIVACY.md) and
[docs/AI_AND_COSTS.md](docs/AI_AND_COSTS.md) before enabling any provider.

## Development

Use Node.js 22 and npm 11. `package.json` is the authoritative command list;
the commonly used ones are:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run check:aris-runtime-boundary   # no BPMN in the production graph
npm run check:ui-copy                 # no hardcoded UI strings
npm run check:no-skips                # no skipped/quarantined tests
npm run test                          # vitest, full unit/integration suite
npm run test:coverage
npm run build:aris
npm run check:aris-studio-artifact    # tracked artifact matches the build
```

ARIS-specific suites: `test:aris:phase1`, `test:aris:phase2`,
`test:aris:animalwf`, `test:aris:golden`, `test:aris:file-smoke`. Additional
repository gates (`check:actions`, `check:lock`, `check:csp`, `check:size`,
`license:check`, `sbom`) are unchanged from the previous product.

Regenerate `release/OrbitPM-ARIS-Studio-Lite.html` with `npm run build:aris`
for every product-code change; the tracked copy must match the build.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules and
[SECURITY.md](SECURITY.md) for the security policy and reporting process.

## EPC engine as a service

The interactive studio described above is unchanged. Separately,
`packages/epc-engine/` packages the same `src/aris` engine — canonical
schema → EPC projection → validation → headless SVG — as a standalone Node
package, so it can be consumed by a private enterprise repository via
`npm pack` or a git dependency instead of copying source. No studio UI,
browser AI, or workspace code ships with it; only the projection,
validation, and rendering pipeline is exposed. See
[docs/EPC_PROJECTION.md](docs/EPC_PROJECTION.md) for the projection pipeline
and [docs/ENTERPRISE_HANDOFF.md](docs/ENTERPRISE_HANDOFF.md) for how the
enterprise repository consumes and versions it.

## License

MIT — see [LICENSE](LICENSE). Component attribution is summarised in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
