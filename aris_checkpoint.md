# ARIS transformation checkpoint

As of Tuesday, July 28, 2026.

Branch: `feat/aris-only-studio`

Plan source: `desktop/aris_transformation.md`

## Phase status against the plan

### Phase 2 — ARIS-only runtime boundary

Completed and already pushed.

Relevant pushed commits:

- `1ef4249` — Phase 2: cover ARIS shell BPMN rejection paths
- `afa657f` — Phase 2: cut BPMN AI runtime from ARIS artifact
- `9ad590c` — Phase 2: enforce ARIS runtime boundary

Implemented and verified:

- `src/main.tsx` mounts the ARIS-only shell.
- `src/ArisApp.tsx` is the production ARIS shell.
- BPMN input is rejected at the shipped boundary for:
  - direct `.bpmn`
  - disguised BPMN `.xml`
  - remembered workspace entries
- `scripts/check-aris-runtime-boundary.mjs` exists and is wired as `npm run check:aris-runtime-boundary`.
- Rolling artifact path is `release/OrbitPM-ARIS-Studio-Lite.html`.

### Phase 3 — AML/XML input layer

In progress.

Already pushed before this checkpoint:

- `29877ac` — Phase 3: start worker-backed AML input layer
- `7744af3` — Phase 3: add AML concrete syntax tree

Already completed and pushed before this checkpoint:

- Browser-worker tokenization path for AML/XML.
- Safe XML tokenization with:
  - XML declaration
  - DOCTYPE capture
  - internal entity declarations
  - comments, CDATA, PI, text
  - duplicate-attribute rejection
  - malformed nesting rejection
  - external entity rejection
  - bounded entity expansion
- Concrete syntax tree with:
  - document children
  - root element name
  - node count
  - max depth
- `createArisXmlSourcePackage(...)` uses the tokenizer path.
- `ArisApp` already surfaces:
  - root element
  - token count
  - node count
  - DOCTYPE external id

## Current local progress not yet committed/pushed

This session added the next Phase 3 slice: semantic indexing over the tokenizer CST, using the real reference export at `reference/AnimalWF/ARISAMLExport.xml`.

New local files:

- `src/aris/source/semanticIndex.ts`
- `src/aris/source/semanticIndex.test.ts`

Updated local files:

- `src/aris/source/sourcePackage.ts`
- `src/ArisApp.tsx`
- `src/ArisApp.test.tsx`
- `src/i18n/dictionaries.ts`
- `release/OrbitPM-ARIS-Studio-Lite.html`

What the new semantic-index slice currently does:

- Builds a semantic source index from the tokenizer CST.
- Captures records for:
  - database/header
  - languages
  - groups
  - models
  - object definitions
  - object occurrences
  - connection definitions
  - connection occurrences
  - attribute definitions
  - attribute occurrences
  - lanes
  - free-text definitions and occurrences
  - OLE definitions and occurrences
  - blobs
  - font style sheets
  - fonts
  - pens
  - brushes
  - GUID / master GUID / symbol GUID / template GUID / external GUID references
  - positions
  - sizes
  - connection route points
  - unknown records
- Retains on each indexed record:
  - source ID when present
  - source element path
  - parent relationship
  - raw span
  - parsed fields
  - unknown attributes / unknown child tags
- Emits duplicate-ID diagnostics.
- Wires the semantic index into `createArisXmlSourcePackage(...)` as:
  - `index`
  - `diagnostics`
  - `lossless`
- Extends the ARIS placeholder details panel to show:
  - model count
  - object definition count
  - object occurrence count
  - connection definition count
  - connection occurrence count
  - attribute definition count
  - semantic diagnostic count
  - unknown record count

## Verification state

Completed and passing locally:

- `npm run check:aris-runtime-boundary`
- `npm run build:aris`
- `npm run test:aris:file-smoke`
- `src/ArisApp.test.tsx`
- `src/__tests__/i18n.test.ts`
- `src/aris/source/semanticIndex.test.ts` AnimalWF reconciliation test

Latest local artifact from this checkpoint:

- Path: `release/OrbitPM-ARIS-Studio-Lite.html`
- Bytes: `683315`
- SHA-256: `29b9c7a08b294055e2940b1b9eb5ea8a333994d0878c956a046ceb4ed8e2f854`

Smoke result:

- `ARIS exact file:// smoke passed` using `reference/AnimalWF/ARISAMLExport.xml`

Current failing item:

- `src/aris/source/semanticIndex.test.ts` still has one failing compact-sample expectation.
- The failing assertion is in the sample test’s GUID-reference count:
  - expected `6`
  - actual `8`
- This is a test expectation issue in the synthetic sample, not an AnimalWF indexing failure.

AnimalWF reconciliation currently passes with these exact indexed counts:

- languages: `2`
- groups: `2`
- models: `8`
- object definitions: `279`
- object occurrences: `494`
- connection definitions: `465`
- connection occurrences: `465`
- attribute definitions: `516`
- attribute occurrences: `774`
- lanes: `16`
- free-text definitions: `69`
- free-text occurrences: `69`
- attachments/OLE definitions: `14`
- attachment/OLE occurrences: `14`
- blobs: `28`
- font style sheets: `6`
- route points: `1339`
- diagnostics: `0`

## Remaining work to finish this slice cleanly

1. Fix the compact semantic-index sample test expectations.
2. Rerun the targeted vitest set until green.
3. Update the ARIS phase docs with the semantic-index progress and latest artifact evidence.
4. Commit this semantic-index slice.
5. Push directly to `feat/aris-only-studio`.

## Current worktree status

Local tracked modifications:

- `release/OrbitPM-ARIS-Studio-Lite.html`
- `src/ArisApp.test.tsx`
- `src/ArisApp.tsx`
- `src/aris/source/sourcePackage.ts`
- `src/i18n/dictionaries.ts`

Local untracked files relevant to this slice:

- `src/aris/source/semanticIndex.test.ts`
- `src/aris/source/semanticIndex.ts`

Unrelated outer-repo paths still present and untouched:

- `goal.md`
- `finalize-artifacts-30329668557/`
