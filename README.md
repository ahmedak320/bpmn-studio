# OrbitPM Process Studio Lite

OrbitPM Process Studio Lite is a bilingual, browser-based BPMN 2.0 editor. It
runs as one self-contained HTML file, works offline for ordinary authoring, and
stores processes as portable `.bpmn` XML.

Version 0.4.5 supports English and Arabic interfaces and diagrams, directory
workspaces in browsers with the File System Access API, persistent browser
workspaces where OPFS is available, and an explicit single-file workflow.
External AI and translation features are optional and require review and
consent before data leaves the device.

The hosted application is published at
[ahmedak320.github.io/bpmn-studio](https://ahmedak320.github.io/bpmn-studio/).
The release page provides the exact downloadable single-file application.

## Use the application

1. Open the hosted application or download
   `OrbitPM-Process-Studio-Lite-0.4.5.html`.
2. Choose a storage mode:
   - Directory workspace in Chrome or Edge.
   - Persistent browser workspace in Firefox or Safari.
   - Single-file open/download mode for a minimal portable workflow.
3. Create or open a `.bpmn` process.
4. Save from the header or with Ctrl/Cmd+S. Only the active document is saved.
5. Use the language controls to switch between stored English and Arabic
   projections. Missing or invalid counterparts are reviewed before translation.

The app never requires AI for file editing, validation, workspace management,
or Excel/CSV process generation.

For an Arabic quick start, see
[docs/QUICKSTART.ar.md](docs/QUICKSTART.ar.md).

## Privacy and storage

- Process files remain in the selected workspace.
- Browser-private recovery drafts are not silently included in exports.
- API keys are session-only by default. Optional persistence is encrypted with
  a user passphrase that is never stored.
- No telemetry is included.
- No external request is made on import. A request preview and explicit
  consent are required before optional AI or translation calls.

## Development

Requirements:

- Node.js 22
- npm 11
- Chromium, Firefox, and WebKit Playwright browsers for the release test matrix

```bash
npm ci
npm run check:lite-only
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The build produces exactly one runtime file at `dist/index.html`. Release
automation renames that byte-identical file to
`OrbitPM-Process-Studio-Lite-0.4.5.html`.

Source layout:

- `src/workspace/` — workspace adapters, transactions, sessions, and recovery
- `src/editor/` — BPMN editor, outline, validation, and export surfaces
- `src/generation/` — shared deterministic BPMN generation
- `src/localization/` — offline bilingual audit and reviewed translation plans
- `src/spreadsheet/` — offline Excel/CSV parsing, mapping, preview, and generation
- `src/ai/` — optional provider clients, privacy review, cancellation, and usage
- `tests/e2e/` — browser, accessibility, reliability, and release scenarios

See [CONTRIBUTING.md](CONTRIBUTING.md) for repository and test expectations.

## Lite-only product policy

The active branch, CI, Pages site, documentation, and releases contain only the
browser application. Executable installers, native shells, servers, bridges,
and alternate programs are not supported products.

The immutable 0.4.4 full-product source is retained for historical recovery on
the [`archive/full-product-v0.4.4`](https://github.com/ahmedak320/bpmn-studio/tree/archive/full-product-v0.4.4)
branch and the annotated `archive-full-product-v0.4.4` tag. Recovery evidence
is recorded in [docs/archive/0.4.4.md](docs/archive/0.4.4.md).

## License

OrbitPM Process Studio Lite is released under the [MIT License](LICENSE).
Retained third-party components and notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
