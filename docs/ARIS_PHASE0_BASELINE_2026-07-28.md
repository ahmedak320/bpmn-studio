# ARIS Phase 0 Baseline — 2026-07-28

This baseline was captured on Tuesday, July 28, 2026 on `feat/aris-only-studio` before any ARIS product-code changes.

## Recorded branch basis

- Source main SHA: `df896da298c7820718faff82c111d63f6164ada4`
- Branch at capture: `feat/aris-only-studio`
- Branch head at capture: `2c13eca1caec3314f41c74a26f98839d288f0227`

## Current package identity

- Package version: `0.4.5`
- Existing release HTML path: `release/OrbitPM-Process-Studio-Lite-0.4.5.html`
- Existing release HTML size: 6,271,923 bytes
- Existing release HTML SHA-256: `3299cff36a594cdac536668713e930bfb927285a7fe6e9f271ac0d9ae863ed51`

## Current dependencies

- Production dependencies: 19
- Development dependencies: 24
- Overrides: 2

#### Production

- `@bpmn-io/properties-panel` — `3.47.0`
- `bpmn-auto-layout` — `0.4.0`
- `bpmn-js` — `18.21.0`
- `bpmn-js-bpmnlint` — `0.24.0`
- `bpmn-js-create-append-anything` — `1.3.1`
- `bpmn-js-properties-panel` — `5.61.0`
- `bpmn-moddle` — `9.0.4`
- `bpmnlint` — `11.12.1`
- `diagram-js` — `15.22.0`
- `diagram-js-minimap` — `5.4.0`
- `fflate` — `0.8.3`
- `jspdf` — `4.2.1`
- `papaparse` — `5.5.4`
- `react` — `18.3.1`
- `react-dom` — `18.3.1`
- `read-excel-file` — `9.3.4`
- `tiny-svg` — `4.1.4`
- `xmllint-wasm` — `5.2.0`
- `zod` — `4.4.3`

#### Development

- `@axe-core/playwright` — `4.12.1`
- `@eslint/js` — `10.0.1`
- `@playwright/test` — `1.61.1`
- `@testing-library/dom` — `10.4.1`
- `@testing-library/react` — `16.3.2`
- `@testing-library/user-event` — `14.6.1`
- `@types/node` — `22.20.1`
- `@types/papaparse` — `5.5.2`
- `@types/react` — `18.3.31`
- `@types/react-dom` — `18.3.7`
- `@vitejs/plugin-react` — `4.7.0`
- `@vitest/coverage-v8` — `3.2.7`
- `eslint` — `10.0.1`
- `eslint-plugin-react-hooks` — `7.1.1`
- `github-actionlint` — `1.7.12`
- `globals` — `17.7.0`
- `jsdom` — `29.1.1`
- `prettier` — `3.9.6`
- `typescript` — `5.9.3`
- `typescript-eslint` — `8.65.0`
- `vite` — `6.4.3`
- `vite-node` — `3.2.4`
- `vite-plugin-singlefile` — `2.3.3`
- `vitest` — `3.2.7`

#### Overrides

- `adm-zip` — `0.6.0`
- `test-exclude` — `8.0.0`

## Current test counts

Classification rule: Vitest files whose path includes `integration.test` are counted as integration; all other `src/**/*.test.ts(x)` files are counted as unit; Playwright `tests/e2e/*.spec.ts` files are counted as browser e2e.

- Unit tests: 212 files / 2386 cases
- Integration tests: 8 files / 263 cases
- Browser e2e tests: 22 files / 126 cases

## Current single-file startup network log

- Artifact under test: `release/OrbitPM-Process-Studio-Lite-0.4.5.html`
- Unexpected startup requests observed: 0
- Local evidence path: `local-evidence/aris-phase0/2026-07-28/startup-network.en.json`

## AnimalWF source and current import baseline

- Source path: `../reference/AnimalWF/ARISAMLExport.xml`
- Source size: 4,376,152 bytes
- Source SHA-256: `38db10f0e2160eeb116e2b02564cd0a44662c24a18cb1c3ad82ade608b7926f5`
- Parsed source object definitions: 279
- Parsed source models: 8
- Parsed source EPC models: 7
- Current converted output files: 8
- Current UI-imported canonical model count: 0
- Current full AnimalWF import review blocked: yes
- Current blocked review status: This import plan is blocked and cannot be confirmed.
- Current conversion report summary: converted=453, downgraded=0, ignored=40, ambiguous=41, unmapped=0

## Private local-only evidence

The following evidence was captured locally and intentionally left untracked to avoid publishing organization data:

- Startup network log: `local-evidence/aris-phase0/2026-07-28/startup-network.en.json`
- AnimalWF private import manifest: `local-evidence/aris-phase0/2026-07-28/animalwf-import-private.json`
- AnimalWF screenshots directory: `local-evidence/aris-phase0/2026-07-28/animalwf-screenshots`
- AnimalWF screenshot count: 0
- Blocked review dialog text: `local-evidence/aris-phase0/2026-07-28/animalwf-review-blocked.txt`
- Blocked review screenshot: `local-evidence/aris-phase0/2026-07-28/animalwf-review-blocked.png`
- Private summary: `local-evidence/aris-phase0/2026-07-28/summary-private.json`

No private AML bytes or screenshot content are committed by this report.
