# Contributing

OrbitPM Process Studio Lite is the only active product in this repository.
Changes must not add a native shell, installer, updater, server, bridge, or
alternate executable application. The one permitted executable addition is
the headless Node CLI for this same engine under packages/epc-engine/bin/ —
a batch projection/render tool with no server, bridge, desktop shell,
installer, or updater.

## Before opening a pull request

Use Node.js 22 and npm 11. Run the checks relevant to the change and, before
release integration, the complete local candidate sequence:

```bash
npm ci
npm run format:check
npm run check:actions
npm run check:lock
npm run check:lite-only
npm run check:no-skips
npm run check:csp
npm run typecheck
npm run lint
npm run test:coverage
npm run test:validation
npm run test:archives
npm run test:performance
npm run clean:dist
npm run build
npm run check:size
npm run test:e2e:built
npm run test:a11y
```

Tests must use a fresh production build when validating the release artifact.
Do not satisfy a release gate with a stale `dist`, skipped test, retry,
quarantine, or known flake.

## Data and compatibility rules

- Preserve unknown BPMN extension content and user data.
- Use the shared workspace transaction/history layers for operations that
  overwrite, delete, import, restore, or replace files.
- Keep English and Arabic behavior, copy, accessibility, and tests in parity.
- Treat imported text as untrusted data.
- Require an explicit reviewed disclosure and consent before any external AI or
  translation request containing process content.
- Do not persist plaintext API keys or add an external host without updating
  the exact CSP and its negative tests.
- Keep release assets minimal; the canonical artifact is the single portable
  `release/OrbitPM-ARIS-Studio-Lite.html`.

## Evidence and documentation

New behavior must update its user-facing support, privacy, migration, or release
documentation. Record commands and artifacts that actually ran; a workflow
definition is not proof that the workflow passed.

Automated axe results do not replace manual NVDA, VoiceOver, Arabic-language,
or mixed-pronunciation checks. Never claim those checks without an operator,
platform/browser versions, scenarios, and results.

Use focused, reviewable commits. Do not rewrite or move an existing version
tag.
