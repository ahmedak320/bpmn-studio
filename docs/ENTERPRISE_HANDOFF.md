# Enterprise handoff

This document is an **interface contract**. It describes how an external,
private enterprise repository consumes the `@orbitpm/epc-engine` package —
build/packaging, the CLI subprocess contract, the artifact/metadata shape,
the review-anchor contract, `buildVerificationPackage`'s fields, and the
payload mapping a thin adapter implements. It contains no enterprise-side
implementation: the engine is, and stays, a **stateless library** — a
canonical process goes in, artifact files come out. Workflow state, storage,
version history, and review-action persistence all live in the enterprise
repository, never here.

For the schema, projection, and validation this contract assumes, see
[`EPC_PROJECTION.md`](./EPC_PROJECTION.md).

## Contents

1. [Consumption](#1-consumption)
2. [CLI subprocess / Azure worker](#2-cli-subprocess--azure-worker)
3. [Artifact/metadata contract](#3-artifactmetadata-contract)
4. [Review anchor contract](#4-review-anchor-contract)
5. [`buildVerificationPackage` field reference](#5-buildverificationpackage-field-reference)
6. [Adapter payload mapping](#6-adapter-payload-mapping)

---

## 1. Consumption

**Build.** From the repository root (never from inside the sub-package):

```bash
npm run build:lib   # vite build --config vite.lib.config.ts
npm run clean:lib   # remove packages/epc-engine/dist
```

`build:lib` emits ES modules into `packages/epc-engine/dist/` (git-ignored):
`index.js` (the headless render barrel: `renderCanonicalProcess`,
`ensureHeadlessDom`, `EPC_ENGINE_VERSION`) and `canonical.js` (the
`CanonicalProcessV1` contract, JSON Schema emitter, projection, findings, and
the verification-package/narrative builders). diagram-js and the rest of the
engine's dependency graph are bundled in — a consumer installs nothing beyond
the package's own single runtime dependency, `jsdom` (exact-pinned to
`29.1.1`, the version already vetted at the studio's own repository root).
The studio's own single-file `dist/index.html` build is untouched by this
config.

**Package manifest** (`packages/epc-engine/package.json`):

```json
{
  "name": "@orbitpm/epc-engine",
  "version": "0.2.0",
  "description": "OrbitPM EPC engine as a service — CanonicalProcessV1 → EPC projection, validation, headless SVG render",
  "license": "MIT",
  "type": "module",
  "exports": { ".": "./dist/index.js", "./canonical": "./dist/canonical.js" },
  "bin": { "epc-project": "./bin/epc-project.mjs" },
  "files": ["dist", "bin", "README.md"],
  "engines": { "node": ">=22 <23" },
  "dependencies": { "jsdom": "29.1.1" }
}
```

**Two supported consumption paths** — npm registry publishing is explicitly
**deferred** (it would need its own authorized workflow change, `id-token:
write`, and both workflow-inventory scripts updated; not implemented by this
campaign):

1. **Tarball.** Run `npm run build:lib`, then `npm pack` inside
   `packages/epc-engine/`, and install the resulting
   `orbitpm-epc-engine-0.2.0.tgz` in the enterprise repository as an ordinary
   file/tarball dependency.
2. **Git dependency.** Reference this repository (or a sub-path) pinned to a
   tag or commit SHA in the consumer's `package.json`, and run
   `npm run build:lib` as part of the consumer's own install/prepare step
   (`packages/epc-engine/dist/` is git-ignored here, so a git dependency must
   build it — it does not fetch a prebuilt copy).

---

## 2. CLI subprocess / Azure worker

**This is the concrete answer to "can the engine run in Azure": yes.** The
CLI is a plain Node process with exactly one runtime dependency (`jsdom`) and
no browser anywhere in its path — it runs on any Node 22-capable Azure
compute: Azure Functions on the Node worker runtime, Azure Container Apps, or
any container/VM running Node 22. Nothing in this path is browser-, Electron-,
or GUI-shaped.

**Command surface** (`packages/epc-engine/bin/epc-project.mjs`, plain ESM;
imports the _built_ library under `packages/epc-engine/dist/`, never the
TypeScript source — a plain Node process cannot resolve the source's
Vite/TypeScript module graph):

```
epc-project <validate|project|render> <input.json|-> [--out <dir>] [--model <index>] [--version <id>]
```

| Argument          | Meaning                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate`        | Parse + project + run the structural gate only. Prints `EpcProjectionFindings` JSON to stdout. Never boots jsdom.                                                                                             |
| `project`         | As `validate`, then writes `draft.json`, `model.aml.xml`, `findings.json`, `verification.json`, and `narrative.md`. Still never boots jsdom — it stops one step before the canvas.                            |
| `render`          | As `project` (structurally), then writes `process.svg`, `metadata.json`, `findings.json`, `verification.json`, and `narrative.md`. The only command that boots the headless jsdom canvas, after a clean gate. |
| `<input.json\|->` | A file path, or `-` to read the `CanonicalProcessV1` JSON from stdin — so a worker can pipe an in-memory payload without a temp file.                                                                         |
| `--out <dir>`     | Output directory for `project`/`render`.                                                                                                                                                                      |
| `--model <index>` | Which model of the projected draft to render (default `0`, the primary EEPC).                                                                                                                                 |
| `--version <id>`  | Passed through verbatim as `sourceVersionId` — flows into `data-epc-source-version` on both the SVG root and `metadata.json`. Meaningful for `render` only.                                                   |

**Exit-code contract (binding — the one thing an orchestrating worker
branches on):**

| Exit code | Meaning                                                           | On stdout / stderr / disk                                                                                   |
| --------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `0`       | Success — no error-severity findings                              | stdout/artifacts are data; `findings.json` is still written (it may carry warnings)                         |
| `1`       | EPC validation failed — at least one error-severity finding       | `findings.json` **is written** — a **failure artifact**, not a crash; the worker should read and persist it |
| `2`       | Usage, I/O, or input-JSON-parse error, before the engine ever ran | a message on stderr; no `findings.json` (there was no valid input to validate)                              |

stdout is reserved for **data** (the findings JSON for `validate`; file
writes for `project`/`render`); stderr is reserved for **logs**. This split
lets a worker capture stdout as a machine-readable payload without scraping
log lines out of it.

**The trigger → render → store boundary.** The engine is stateless: a
canonical process JSON goes in, artifact files come out, nothing is retained
between invocations, and there is no clock or network call anywhere in the
path. Everything the enterprise "EPC generation and human verification"
milestone treats as workflow state — the review-state machine, the four
review actions' persistence, the immutable evidence store, version history,
regeneration jobs, and durable storage — is the Azure worker's
responsibility, orchestrated _around_ this CLI, never _inside_ it:

1. **Trigger.** The worker decides _when_ to regenerate (a new or edited
   process, or a correction that creates a new version) and assembles the
   `CanonicalProcessV1` payload (see the adapter mapping, [§6](#6-adapter-payload-mapping)).
2. **Render.** The worker invokes
   `epc-project render <payload> --out <artifacts-dir> --version <the process's own version id>`
   (or `project`/`validate` for a lighter-weight pass) as a child process and
   inspects the exit code.
3. **Store.** The worker persists `process.svg`, `metadata.json`,
   `findings.json`, and `narrative.md` (or, on a code-`1` exit, the
   `findings.json` failure artifact) into its own storage/versioning layer
   and records the state transition — none of that logic lives in this
   repository.

**Failure handling.** On exit code `1`, `findings.json` already carries
bilingual messages and canonical-id anchors (see
[`EPC_PROJECTION.md`](./EPC_PROJECTION.md#5-findings-artifact)), so the
worker does not need to re-derive human-readable text — it reads and
persists the file as the review-blocking artifact. On exit code `2`, there is
no `findings.json`; the worker should treat this as a malformed payload or
environment problem (log stderr, do not enqueue a review).

---

## 3. Artifact/metadata contract

**Primary artifact:** `process.svg` — standalone SVG markup, the same
jsdom-booted diagram-js render the studio itself produces, captured
headlessly. Alongside it (both `project` and `render` write `narrative.md`,
`findings.json`, and `verification.json`; only `render` writes `metadata.json`
and `process.svg`; only `project` writes `draft.json`/`model.aml.xml`):

| File                | Written by          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process.svg`       | `render`            | The primary artifact — standalone anchored SVG.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `narrative.md`      | `project`, `render` | `ProcessNarrativeV1`'s `en`/`ar` bilingual markdown bodies, concatenated — no LLM, deterministic by template.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `metadata.json`     | `render`            | The `HeadlessRenderMetadata` sidecar: `engineVersion`, `schemaVersion` (`1`), `projectionVersion` (`1`), `inputSha256`, `modelId`, and `sourceVersionId` when supplied — the same values stamped as `data-epc-*` attributes on the SVG root, so a worker can cross-check the two without re-parsing the SVG.                                                                                                                                                                                                                                                  |
| `findings.json`     | `project`, `render` | `EpcProjectionFindings` — always written, success or failure. See [`EPC_PROJECTION.md`](./EPC_PROJECTION.md#5-findings-artifact).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `verification.json` | `project`, `render` | `VerificationPackageV2` — `buildVerificationPackage`'s deterministic per-element review artifact (`schemaVersion` `2`). Written on success **and** on a code-`1` gate failure (it is a parse-level artifact, independent of the render). See [§5](#5-buildverificationpackage-field-reference).                                                                                                                                                                                                                                                               |
| `draft.json`        | `project`           | The intermediate `ArisAiDraftV1`, serialized by the CLI's `writeJson` helper as pretty-printed `JSON.stringify(draft, null, 2)` (`packages/epc-engine/bin/epc-project.mjs`) — 2-space indented, in the draft's own (insertion) key order. **Not** `canonicalJsonText`'s sorted-key compact form; still deterministic run-to-run for the same canonical input, because the draft is itself assembled in a fixed order (see [`EPC_PROJECTION.md`](./EPC_PROJECTION.md#4-determinism--versioning)) — debugging/round-trip only, not part of the render contract. |
| `model.aml.xml`     | `project`           | The generated AML serialization of that draft — debugging/round-trip only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**PNG is explicitly consumer-side.** The engine ships **no rasterizer** — its
only runtime dependency is `jsdom`, by design (a hard campaign target: zero
new dependencies beyond it). To rasterize, the consumer feeds the returned
`svg` string (and a size derived from its `viewBox`) to
`arisSvgToPngDataUrl(markup, size, deps)` (`src/aris/canvas/exportArisPdf.ts`,
reachable through the engine's own module graph) with its **own** injected
`createCanvas`/`loadImage` implementation — for example a Node-side
rasterizer such as `@napi-rs/canvas` running alongside the Azure worker, or a
browser `<canvas>`/`<img>` pair if rasterization instead happens client-side.
This keeps the library's dependency footprint at exactly one package.

**Font caveat.** The SVG names its typefaces by family only (`Arial`,
`Noto Sans Arabic`) — it embeds no font data. A consumer that renders the SVG
in a browser relies on system/web-font availability there. A consumer that
**rasterizes** the SVG (the PNG path above) must install matching fonts in
that environment, or accept whatever substitution its rasterizer's
font-matching falls back to — this is a consumer-side operational concern,
not something the engine solves.

---

## 4. Review anchor contract

Every rendered node/edge in `process.svg` carries a `data-epc-node` or
`data-epc-edge` attribute whose value is the canonical id that caused the
underlying draft object/relation (`stampAnchors` in `src/aris/headless/render.ts`,
resolved through the projection's own anchor tables — see
[`EPC_PROJECTION.md`](./EPC_PROJECTION.md#2-expansion-rules-canonical--epc)).

This id space is **broader** than just `nodes[].id`/`edges[].id`: a
`data-epc-node` value may equally be a `decisions[].id` (the decision rule
and its outcome events all anchor back to the owning decision), or a
`roles[]`/`systems[]`/`controls[]`/`informationObjects[].id` (every satellite
object is a node-shaped anchor too); a `data-epc-edge` value on a synthesized
relation (parallel split/merge, exception routing, decision or satellite
relations) may likewise carry a plain **node id** rather than an
`edges[].id`. All of it is still one flat namespace of canonical ids —
the **same id space** as `EpcProjectionFinding.canonicalNodeIds`/
`canonicalEdgeIds` in the findings artifact, and every `id` field in
`buildVerificationPackage`'s output ([§5](#5-buildverificationpackage-field-reference)).
One id space, three artifacts — a portal never has to cross-reference through
the intermediate draft/AML layer.

**No React component is exported.** The engine does not ship a UI; a
consumer wires the anchors up itself. The SVG is inlined via `innerHTML` so its
`data-epc-*` anchors become real, clickable DOM nodes — so it MUST be sanitized
first (see [Sanitize before embedding](#sanitize-before-embedding) below). A
worked vanilla-JS embed:

```html
<div id="epc-viewer"></div>
<script type="module">
  import { sanitizeEpcSvg } from '@orbitpm/epc-engine'

  async function mountEpcViewer(svgUrl, verificationPackage) {
    const container = document.getElementById('epc-viewer')
    const svgText = await (await fetch(svgUrl)).text()
    // Treat the SVG as UNTRUSTED even though the engine generated it — labels
    // originate from employees, documents, and AI output. Sanitize with the
    // engine's SVG-aware allowlist BEFORE inlining: <script>, on* handlers,
    // <foreignObject>, external URLs, and unsafe links are stripped; the
    // data-epc-* anchors are preserved. (A browser supplies DOMParser/
    // XMLSerializer natively; in Node call ensureHeadlessDom() first.)
    container.innerHTML = sanitizeEpcSvg(svgText)

    container.addEventListener('click', (event) => {
      const target = event.target.closest('[data-epc-node], [data-epc-edge]')
      if (!target) return

      const isNode = target.hasAttribute('data-epc-node')
      const logicalId = target.getAttribute(isNode ? 'data-epc-node' : 'data-epc-edge')

      // logicalId is a CanonicalProcessV1 id (nodes[].id/edges[].id, but also
      // decisions[].id, roles[].id, etc. — see the id-space note above), and
      // matches an `id` field somewhere in `verificationPackage` (mainFlow[].id,
      // decisions[].id, ...).
      const entry =
        verificationPackage.mainFlow.find((e) => e.id === logicalId) ??
        verificationPackage.decisions.find((d) => d.id === logicalId)

      openConfirmCorrectPanel(logicalId, entry) // consumer-defined Confirm/Correct UI
    })
  }
</script>
```

The consumer owns `openConfirmCorrectPanel` and everything it does — the
Confirm/Correct actions and the resulting evidence-plus-new-version write are
enterprise-side workflow, not engine behavior.

### Sanitize before embedding

`sanitizeEpcSvg(markup, options?)` (exported from `@orbitpm/epc-engine`) parses
the SVG as XML and rebuilds it against an allowlist, returning the safe string.
It drops every element outside a fixed safe-SVG set — `<script>`,
`<foreignObject>`, `<style>`, `<image>`, `<a>`, and any HTML element go, with
their subtrees — strips `on*` event handlers, drops `href`/`xlink:href` that are
not same-document `#fragment` references, and drops any attribute whose value
carries an external `url(...)`, a `javascript:` URL, or a CSS `expression(...)`.
The engine's own output round-trips unchanged in meaning — every `data-epc-*`
anchor is preserved — because it emits only allowlisted elements and no external
references. This is **defense in depth**: the engine escapes its own labels, but
the portal must not depend on that, because labels originate from untrusted
sources (employees, uploaded documents, AI output). A browser supplies
`DOMParser`/`XMLSerializer` natively; a Node consumer calls `ensureHeadlessDom()`
first (which publishes them) or injects its own via `options.dom`.

Pair it with a restrictive **Content-Security-Policy** on the verification
application (a response header or a `<meta http-equiv>`). The engine exports a
ready default, `RECOMMENDED_VERIFICATION_CSP` — notably `script-src 'self'` with
**no** `'unsafe-inline'`, so an injected inline handler could not execute even if
the sanitizer were ever bypassed, and `default-src 'self'` blocks the external
fetches an injected `url(...)`/`href` would attempt.

---

## 5. `buildVerificationPackage` field reference

Source: `src/aris/canonical/verificationPackage.ts`.
`buildVerificationPackage(process: CanonicalProcessV1): VerificationPackageV2`
is pure and deterministic; every array is explicitly sorted by id **except**
`mainFlow`, which deliberately preserves the projection's own depth-first
flow order (`canonicalFlowOrder`, imported from `./projectToEpc` — never
re-implemented, so the package and the projection can never disagree about
flow order).

| Field                | Type                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`      | `2`                                                                                                        | Bumped from `1`: the `approvals` shape changed to explicit, evidence-backed authority (see below).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `processId`          | `string`                                                                                                   | `identity.id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `names`              | `CanonicalText`                                                                                            | `identity.names`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `code`               | `string?`                                                                                                  | `identity.code`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `processVersion`     | `string?`                                                                                                  | `identity.processVersion`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `purpose`            | `CanonicalText?`                                                                                           | `identity.purpose`, when present.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `trigger`            | `{id, names}[]`                                                                                            | `event` nodes with in-degree 0 over control-flow edges — mirrors `canonicalFlowOrder`'s own start-node rule.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `outcomes`           | `{id, names}[]`                                                                                            | `event` nodes with out-degree 0 over `edges[]` (also covers a decision outcome that terminates directly).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `owner`              | `{id, names, unit?} \| null`                                                                               | The role with `owner: true` (lowest id first, if more than one); `null` when no role declares it.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mainFlow`           | `{id, kind, names}[]`                                                                                      | `canonicalFlowOrder`'s depth-first spine, **not** sorted by id — the one deliberate exception.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `roles`              | `{id, names, unit?, owner: boolean}[]`                                                                     | `owner` coerced to a definite boolean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `systems`            | `{id, names}[]`                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `informationObjects` | `{id, names}[]`                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `decisions`          | `{id, names, criteria?, outcomes: {id, names, targetNodeId}[]}[]`                                          | `names` is sourced from the underlying decision **node's** names (`CanonicalDecision` itself has no `names` field).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `unknowns`           | `{targetId, kind, field?, message, factIds?}[]`                                                            | Sorted by `(targetId, kind, field ?? '')` — `CanonicalUnknown` has no `id` field of its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `evidenceSummary`    | `{factId, statement, evidenceRefs, referencedBy}[]`                                                        | `referencedBy` is the reverse-referenced, de-duplicated, sorted set of every entity id (across all 8 `factIds`-carrying sources, plus `unknowns[].targetId`) that cites that fact.                                                                                                                                                                                                                                                                                                                                                            |
| `confidenceRollup`   | `{high, medium, low}`                                                                                      | Tallies `identity.confidence` plus every entity's `confidence` across the 8 top-level arrays (`unknowns` excluded — it has none).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `approvals`          | `{decisionId, status, authorities: {roleId, names, unit?}[], thresholds: {controlId, names}[], factIds}[]` | One entry per decision that carries an **explicit** `approval` block (`CanonicalApproval`) — and **no** entry otherwise. Authority is asserted by the contract, never inferred: there is no fallback to the process owner or to a role that merely touches the deciding node (a modelling relationship is not a business assertion about who signs off). Each entry resolves `authorityRoleIds`/`thresholdControlIds` to `{roleId,names,unit?}`/`{controlId,names}`, and carries the block's `status` (`confirmed`/`proposed`) and `factIds`. |
| `narrativeSummary`   | `CanonicalText`                                                                                            | The narrative's opening paragraph — `identity.purpose` verbatim when present, else a name-derived fallback sentence. The **same** function `buildProcessNarrative` uses for its own opening paragraph, so the two artifacts never drift apart.                                                                                                                                                                                                                                                                                                |

**The narrative.** `buildProcessNarrative(process: CanonicalProcessV1):
ProcessNarrativeV1` (`src/aris/canonical/narrative.ts`) returns
`{schemaVersion: 1, en: string, ar: string}` — each a full bilingual markdown
body, in binding order: a `# <title>` heading, then Purpose, Trigger, Main
Flow (numbered steps via `canonicalFlowOrder`), Outcomes, Roles & Systems,
and Open Questions. No LLM: every sentence is assembled from fixed EN/AR
phrase templates plus the canonical data, so the same input always produces
byte-identical output. A locale missing for a given node degrades gracefully
— that item's sentence is omitted from that locale's body, never rendered as
the literal text `"undefined"`.

---

## 6. Adapter payload mapping

The private `epc-adapter` maps the enterprise's own flat payload onto
`CanonicalProcessV1` (binding — the contract stays fixed; the adapter does
the translating):

| Enterprise payload field | `CanonicalProcessV1` target                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `processId`              | `identity.id`                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `versionId`              | the CLI's `--version <id>` flag / `renderCanonicalProcess(process, {sourceVersionId})` | **Not** a canonical-body field — it is a render-time passthrough, stamped as `data-epc-source-version` (see [`EPC_PROJECTION.md`](./EPC_PROJECTION.md#4-determinism--versioning)). If the adapter also wants a human-readable version string carried _inside_ the canonical body (for example for display in the verification package), that is the separate, optional `identity.processVersion` field — distinct from `versionId`. |
| `name`                   | `identity.names`                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `evidenceReferences`     | `facts[].evidenceRefs`                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**The contract is a superset.** `CanonicalProcessV1` adds
`informationObjects`, `controls`, `unknowns`, `confidence` on every entity,
and bilingual (`en`/`ar`) text throughout — fields the enterprise's flat
payload may simply have nothing to say about. The adapter supplies whatever
it has data for and omits everything else; beyond the small always-required
core (`version`, `identity.id`/`names`/`confidence`, and the 9 top-level
arrays — `nodes`, `decisions`, `edges`, `roles`, `systems`,
`informationObjects`, `controls`, `facts`, `unknowns` — each of which may be
empty), the shape is optional-by-default.

**What the thin `epc-adapter` should contain:**

1. TypeScript types mirroring the enterprise's own flat payload shape.
2. The payload → `CanonicalProcessV1` mapping function itself — pure and
   small, per the table above.
3. Invocation glue: either spawning `epc-project` as a subprocess
   ([§2](#2-cli-subprocess--azure-worker)), or
   importing `@orbitpm/epc-engine` programmatically in a Node worker and
   calling `parseCanonicalProcess`/`renderCanonicalProcess` directly without
   a subprocess at all — both are legitimate uses of the same library
   exports.

**What it must NOT re-implement:** projection (the canonical→EPC expansion
rules), validation (the EPC rule set), layout, rendering (the SVG capture),
or narrative generation. All of that is the engine's job, described in
[`EPC_PROJECTION.md`](./EPC_PROJECTION.md); the adapter's entire
responsibility is shape translation plus invocation.

---

See also: [`EPC_PROJECTION.md`](./EPC_PROJECTION.md) for the
`CanonicalProcessV1` field reference, the expansion rules, the 11-rule
validation table, and the findings artifact shape. The repository README's
"EPC engine as a service" section is the top-level pointer to both documents.
