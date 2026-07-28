# OrbitPM ARIS Studio Lite — Active ARIS-Only Transformation Plan

## 1. Goal, product identity, and execution rules

This is the active implementation plan. It is deliberately self-contained: an implementing
agent must not need `fix_plan2.md` or any other plan to finish the work.

Create the ARIS-native product on:

```text
feat/aris-only-studio
```

Product identity:

```text
OrbitPM ARIS Studio Lite
```

Initial package version:

```text
0.1.0-alpha.1
```

Canonical rolling artifact:

```text
release/OrbitPM-ARIS-Studio-Lite.html
```

First intended stable tag:

```text
v0.1.0-aris.1
```

### 1.1 Product boundaries

The branch must have:

- No BPMN canvas or editor.
- No BPMN conversion.
- No hidden/live BPMN projection.
- No BPMN validation.
- No BPMN export.
- No BPMN-specific AI schema or prompt.
- No production dependency on BPMN packages.

The branch must retain:

- Create with AI from a typed description.
- Optional DOCX and PDF description attachments.
- Create from a native PDF.
- Create from a process picture.
- Create from a new ARIS-native Excel template.
- Folder/workspace-aware process questions.
- Deterministic no-key process questions.
- Chat-based process improvement.
- Chat-based completion of missing information.
- English/Arabic UI and content.
- Browser-direct BYOK AI.
- Workspace, backup, history, search, printing, PNG, and PDF capabilities.
- One portable HTML file that runs directly in a modern browser.

### 1.2 Original-source rule

- Imported AML/XML is permanently preserved byte-for-byte.
- Editing never overwrites the imported original.
- Imported models are edited through working revisions.
- Exporting creates a derived AML/XML document.
- Source accounting and revision history remain linked to the original digest.
- Unknown source content is preserved and reported, never silently discarded.

### 1.3 Agent execution discipline

An implementing agent must:

1. Execute phases in order.
2. Read the current implementation and tests before changing a subsystem.
3. Complete a phase exit gate before starting the next phase.
4. Keep commits phase-scoped and reviewable.
5. Run the phase’s tests before committing.
6. Regenerate and commit the canonical HTML for every product-code commit.
7. Never overwrite user data or the imported source.
8. Never commit private AnimalWF XML or user-supplied visual references without authorization.
9. Use sanitized committed fixtures and optional local full-data acceptance scripts.
10. Preserve raw content when a mapping is uncertain.
11. Record unsupported content in the fidelity/accounting report.
12. Avoid broad destructive Git actions.
13. Keep the working tree clean between phases.
14. Do not declare stable ARIS compatibility until a real ARIS import/re-export passes.

## 2. Common repository, GitHub, release, and browser requirements

These requirements are repeated here so this file can be implemented independently.

### 2.1 Synchronize main safely

1. Run `git status --short --branch`.
2. Stop and protect unrelated user changes that overlap the planned work.
3. Fetch all remote refs and tags.
4. Switch away from a branch scheduled for deletion.
5. Fast-forward local `main`; do not reset or force-checkout.
6. Record local/remote main SHAs.

### 2.2 Clean merged branches

Immediately before deletion, prove that the branch tip is an ancestor of `origin/main`.

Delete only when still fully merged:

- Local `feat/lite-ux-wave`.
- Local and remote `release/0.4.5-lite-only`.
- Local and remote `release/0.4.5-owner-waiver`.

Preserve:

- Local and remote `archive/full-product-v0.4.4`.
- All tags and GitHub releases.
- Any branch no longer fully merged at execution time.

Record deleted refs and their final SHAs.

### 2.3 Trial CI policy

1. Keep main protection against force-push and deletion.
2. Keep protected `v*` tags.
3. Remove required status checks from `main` during trials.
4. Allow direct pushes and PR merges without waiting for the comprehensive suite.
5. Preserve the full suite as manual/reusable workflows.
6. Use:
   - `quality.yml` for the reusable/manual comprehensive quality suite.
   - `release-candidate.yml` for an exact commit SHA and proposed version.
   - `release.yml` for evidence verification, tag creation, and immutable publication.
   - `pages.yml` for manual or release-invoked deployment.
   - `pages-rollback.yml` for manual rollback.
7. Fold separate release finalization into `release.yml`.
8. Remove version-specific automatic historical cleanup.
9. Consolidate environments into stable `release`, `github-pages`, and `rollback`.
10. Keep Actions read-only by default.
11. Elevate permissions only in publish/rollback jobs.

### 2.4 Canonical rolling HTML

Track:

```text
release/OrbitPM-ARIS-Studio-Lite.html
```

Implement a local deterministic build that:

- Uses a clean temporary output.
- Emits exactly one HTML file.
- Inlines JS, CSS, fonts, icons, templates, workers, schemas, and application assets.
- Contains no build timestamps, random build IDs, absolute paths, or machine-specific data.
- Copies the exact result to the canonical tracked path.
- Prints byte size and SHA-256.
- Runs artifact/build checks only, not the full quality suite.

Add a repository-managed pre-push comparison:

- Rebuild to a temporary path.
- Compare byte-for-byte.
- Reject stale tracked HTML.
- Do not edit or auto-commit.
- Do not invoke comprehensive CI.

Every product-code push must include the current canonical HTML.

### 2.5 Single-file browser contract

The final HTML must:

- Run through `file://`.
- Require no server, installer, Electron wrapper, browser extension, or local daemon.
- Support current Chromium/Chrome/Edge, Firefox, and WebKit/Safari-class browsers.
- Make zero startup network requests.
- Work offline for core modeling, AML import/export, Excel import, workspace operations, and
  deterministic assistant answers.
- Make network requests only after an explicit AI action and consent.
- Use directory APIs only as an enhancement.
- Offer a complete portable package/file fallback when directory APIs are unavailable.
- Never load a runtime DTD, schema, font, script, worker, icon, or stylesheet from the network.

AI creation and AI chat require internet and a user-supplied provider key; the editor itself does
not.

## 3. Phase 0 — Establish branch and immutable baselines

### 3.1 Steps

1. Finish the repository/GitHub audit in Section 2.
2. Commit both plan files to the clean main branch.
3. Create `feat/aris-only-studio` from that exact main commit.
4. Create a baseline report containing:
   - Source main SHA.
   - New branch SHA.
   - Current package version.
   - Existing release HTML path, size, and SHA-256.
   - Current dependencies.
   - Current unit/integration/e2e test counts.
   - Current single-file startup network log.
   - AnimalWF source path, size, and SHA-256 without copying its contents.
   - Current AnimalWF model/import counts.
   - Current screenshots of all imported AnimalWF models.
5. Ensure private fixtures remain outside the repository.
6. Confirm the branch contains no unexpected uncommitted files.

### 3.2 Exit gate

- Main is current and clean.
- Intended merged branches are cleaned.
- Archive branch and tags remain.
- Both plans are stored.
- ARIS branch is based on the recorded main SHA.
- Baseline evidence exists without publishing organization data.

## 4. Phase 1 — Freeze retained infrastructure before removing BPMN

The product already contains valuable infrastructure that must survive the transformation.
Protect it with characterization tests before replacing its BPMN-specific contracts.

### 4.1 Retain these modules/responsibilities initially

- Browser-direct AI transport.
- Provider/model selection.
- API key storage.
- Optional encrypted key persistence.
- Provider connection tests.
- Request privacy review.
- Consent fingerprinting.
- Retry, cancellation, timeout, and bounded response handling.
- DOCX browser parsing.
- PDF/image encoding and capability checks.
- Spreadsheet ZIP preflight and worker parsing.
- Assistant dialog, focus, tabs, history, and RTL.
- Workspace adapters and session management.
- Backup/restore.
- File history.
- Search/catalog.
- Single-file Vite configuration.
- PDF/PNG/print export infrastructure.

### 4.2 Browser-direct AI policy

Retain:

- OpenRouter.
- Anthropic.
- Gemini.

Do not add:

- A hosted OrbitPM relay.
- A bundled API key.
- A hidden provider fallback.
- Direct vendor APIs that cannot be safely called from a browser.

Key rules:

- Keys live in memory by default.
- Optional persistence remains AES-GCM encrypted using a passphrase-derived key.
- Passphrases are never stored.
- Keys are excluded from backups, release artifacts, logs, diagnostics, chat transcripts, and
  AML.
- Clearing a key invalidates pending persistence operations.

### 4.3 AI request rules

- No request before exact outbound review and consent.
- One explicitly selected provider/model applies to all AI surfaces.
- Workspace context is off by default.
- Name redaction is on by default when context is included.
- Imported source text is untrusted data, never an instruction.
- Each request is cancelable.
- Provider responses remain byte/chunk bounded.
- Large attachments are uploaded once; repair turns are text-only.
- Transport/auth/rate failures do not burn semantic repair attempts.

### 4.4 Characterization tests

Before changing schemas, pin:

- No-key assistant local answer.
- AI privacy preview and consent.
- Request cancellation.
- Provider/model selection.
- Encrypted key behavior.
- DOCX parse and cancellation.
- PDF/image size gates.
- Spreadsheet preflight.
- Folder/portable workspace behavior.
- Single-file `file://` startup.
- English/Arabic dialog behavior.

### 4.5 Exit gate

- Retained infrastructure has explicit passing characterization tests.
- Offline startup has zero unexpected requests.
- No ARIS changes have yet weakened security behavior.

## 5. Phase 2 — Replace the product shell and remove BPMN runtime

### 5.1 Create the ARIS application shell

Build a new ARIS-specific entry/application composition with:

- Workspace/model explorer.
- ARIS canvas area.
- Create panel.
- ARIS details/properties rail.
- Accounting/fidelity/validation rail.
- Process assistant launcher.
- Settings/provider dialog.
- Import/export menu.
- Language, theme, zoom, and layout controls.

Initially mount a tested ARIS placeholder canvas while the native modeler is built.

### 5.2 Input routing

Primary accepted formats:

- `.xml`
- `.aml`
- `.apc` as a deprecated alias only after AML content sniffing.
- OrbitPM ARIS portable workspace package.
- New ARIS workbook `.xlsx`.
- PDF/image/DOCX through the AI create surface.

If BPMN content is detected:

- Do not try to convert it.
- Show: “This ARIS-only build accepts ARIS AML/XML exports.”
- Leave workspace unchanged.

### 5.3 Remove BPMN UI

Remove:

- BPMN palette/context-pad actions.
- BPMN properties.
- BPMN validation center rules.
- BPMN XML/source editor assumptions.
- BPMN creation prompts.
- BPMN import/export actions.
- BPMN keyboard commands.
- BPMN attribution-only UI.

Retain generic accessible dialogs, notifications, folder navigation, search, history, print/PDF,
PNG, settings, and AI UI shells.

### 5.4 Remove BPMN production dependencies

When imports are gone, remove:

- `bpmn-js`
- `bpmn-moddle`
- `bpmn-auto-layout`
- `bpmn-js-bpmnlint`
- `bpmnlint`
- BPMN properties-panel packages
- BPMN-specific create/append modules
- BPMN icon fonts

Retain generic `diagram-js` for canvas/modeling infrastructure.

Add a dependency/import test that fails if a production entry imports a BPMN package or a module
whose only purpose is BPMN.

### 5.5 Exit gate

- ARIS shell loads through `file://`.
- Settings, AI tabs, assistant, workspace picker, language, and theme still work.
- BPMN input is rejected non-destructively.
- Production dependency graph contains no BPMN runtime.

## 6. Phase 3 — Build a secure lossless AML input layer

Official UI/documentation terminology must be “ARIS AML/XML.” ARIS documentation calls the
interchange ARIS XML Model Format/ARIS Modeling Language (AML); `.apc` is only a legacy alias
accepted by this product.

### 6.1 Four-layer architecture

Maintain separate layers:

1. Immutable raw bytes.
2. Lossless XML concrete-syntax tree.
3. Indexed ARIS semantic source.
4. Editable ARIS working model and revision commands.

Do not use a simplified DOM or regex parser as the sole source of truth.

### 6.2 Inline-worker tokenizer

Implement a cancelable inlined worker that records:

- XML declaration.
- Encoding.
- DOCTYPE.
- Internal entity declarations.
- Start/end/self-closing tags.
- Attribute name, value, quote style, and byte span.
- Text nodes.
- CDATA.
- Comments.
- Processing instructions.
- Element nesting.
- Line, column, and byte offsets.
- Raw span for every token.

### 6.3 Security

- Never retrieve external DTDs or entities.
- Reject attempted external entity resolution.
- Bound entity declaration count.
- Bound individual entity value length.
- Bound expansion depth.
- Bound total expanded content.
- Reject malformed nesting.
- Reject duplicate attributes.
- Reject invalid encoding.
- Reject unsafe path/name material when extracting attachments.
- Support cooperative cancellation.
- Keep parsing off the UI thread.

### 6.4 Semantic index

Index:

- Database and groups.
- Languages.
- Models and model attributes.
- Object definitions.
- Object occurrences.
- Connection definitions.
- Connection occurrences.
- Attribute definitions and values.
- Attribute occurrences and placement.
- Linked-model assignments.
- Lanes.
- Free-form text definitions and occurrences.
- OLE definitions and occurrences.
- Blobs.
- Font style sheets.
- Fonts.
- Pens.
- Brushes.
- Templates and GUID references.
- Positions.
- Sizes.
- Connection route points.
- Model scale/background/grid/print settings.
- Unknown elements and attributes.

Every record must retain:

- Source ID, if present.
- Source element path.
- Parent relationship.
- Raw byte span.
- Parsed fields.
- Unknown fields.

### 6.5 Core interfaces

```ts
interface LosslessAmlDocument {
  source: {
    bytes: Uint8Array
    name: string
    mediaType: string
    sha256: string
    encoding: string
  }
  syntax: AmlSyntaxTree
  index: ArisSourceIndex
  diagnostics: readonly AmlDiagnostic[]
}

interface ArisSourceIndex {
  models: ReadonlyMap<string, ArisModelRecord>
  objectDefinitions: ReadonlyMap<string, ArisObjectDefinitionRecord>
  objectOccurrences: ReadonlyMap<string, ArisObjectOccurrenceRecord>
  connectionDefinitions: ReadonlyMap<string, ArisConnectionDefinitionRecord>
  connectionOccurrences: ReadonlyMap<string, ArisConnectionOccurrenceRecord>
  attributes: readonly ArisAttributeRecord[]
  lanes: ReadonlyMap<string, ArisLaneRecord>
  freeText: ReadonlyMap<string, ArisFreeTextRecord>
  attachments: ReadonlyMap<string, ArisAttachmentRecord>
  styles: ArisSourceStyleCatalog
  unknownRecords: readonly ArisUnknownRecord[]
}
```

### 6.6 Tests

- Minimal AML.
- Internal entities.
- Multi-line tags.
- Custom entity names.
- Unknown tags.
- Unknown attributes.
- Comments/processing instructions.
- Truncated XML.
- Duplicate IDs.
- XXE/external DTD attempt.
- Entity expansion attack.
- Cancellation.
- AnimalWF-size input.

### 6.7 Exit gate

- Sanitized AML parses losslessly.
- Malicious fixtures fail safely.
- AnimalWF parses without freezing the UI.
- Independent raw tag counts reconcile with indexed records.

## 7. Phase 4 — Implement immutable source packages and workspace revisions

### 7.1 Package layout

Store imported sources under:

```text
.orbitpm/aris/<source-sha256>/
  original/source.xml
  manifest.json
  accounting.v2.json
  working/current-revision.json
  working/revisions/<revision-id>.patch.json
  attachments/<source-id>/<safe-name>
  references/<optional-private-reference-assets>
```

### 7.2 Manifest

```ts
interface ArisSourcePackageManifestV1 {
  format: 'orbitpm-aris-source-package'
  version: 1
  source: {
    name: string
    mediaType: string
    byteLength: number
    sha256: string
    arisVersion?: string
  }
  origin: { kind: 'imported-aml' } | { kind: 'description' | 'spreadsheet' | 'pdf' | 'image' }
  currentRevisionId: string
  models: readonly ArisModelManifestEntry[]
  attachments: readonly ArisAttachmentManifestEntry[]
  accountingSha256: string
  fidelity: ArisFidelitySummary
}
```

### 7.3 Imported-source transaction

1. Read exact bytes.
2. Compute SHA-256.
3. Parse/validate in worker.
4. Build semantic index.
5. Generate source accounting.
6. Identify/extract attachment metadata safely.
7. Prepare all destination writes in memory.
8. Show import review.
9. Commit atomically.
10. Roll back every created member on failure.
11. Deduplicate identical source digest.

### 7.4 Immutability

- Never overwrite `original/source.xml`.
- Save writes working revision commands.
- Export materializes a derived AML.
- Deleting a model does not delete original source.
- Source-package deletion is separate and explicitly confirmed.
- Original AML remains downloadable.
- Backup/restore includes original, revisions, reports, attachments, and reference assets.
- API keys never enter the package.

### 7.5 Generated processes

AI/Excel-created models have no imported original:

1. Offer to retain the description/workbook/PDF/image as immutable generation source.
2. Generate canonical AML revision zero.
3. Record origin type and source digest.
4. Record provider/model and outbound request digest for AI generation, never the key.
5. Treat revision-zero AML as the generated baseline.
6. Apply later edits through revisions.

### 7.6 Exit gate

- Import is atomic.
- Original bytes survive save/edit/export/backup/restore unchanged.
- Identical source imports deduplicate.
- Generated models retain provenance.

## 8. Phase 5 — Define the native ARIS working model and command system

### 8.1 Model contracts

```ts
interface ArisWorkingDocument {
  database: ArisDatabase
  models: ReadonlyMap<string, ArisModel>
  objectDefinitions: ReadonlyMap<string, ArisObjectDefinition>
  connectionDefinitions: ReadonlyMap<string, ArisConnectionDefinition>
  styleCatalog: ArisStyleCatalog
  sourceIndex: ArisSourceIndex
  revision: number
}

interface ArisModel {
  id: string
  type: 'MT_EEPC' | 'MT_VAL_ADD_CHN_DGM'
  names: ArisLocalizedValue
  attributes: readonly ArisAttribute[]
  occurrences: readonly ArisObjectOccurrence[]
  connectionOccurrences: readonly ArisConnectionOccurrence[]
  lanes: readonly ArisLane[]
  freeText: readonly ArisFreeText[]
  layout: ArisLayoutState
}

interface ArisObjectDefinition {
  id: string
  type: string
  defaultSymbol?: string
  names: ArisLocalizedValue
  attributes: readonly ArisAttribute[]
  linkedModelIds: readonly string[]
}

interface ArisObjectOccurrence {
  id: string
  definitionId: string
  modelId: string
  symbol: string
  bounds: ArisBounds
  style: ArisOccurrenceStyle
  attributeOccurrences: readonly ArisAttributeOccurrence[]
}

interface ArisConnectionOccurrence {
  id: string
  definitionId: string
  modelId: string
  sourceOccurrenceId: string
  targetOccurrenceId: string
  route: readonly ArisPoint[]
  style: ArisConnectionStyle
}
```

### 8.2 Required distinctions

- A definition may have multiple occurrences.
- Definition name/attributes update every occurrence.
- Occurrence position/size/symbol/text placement/style affect only that occurrence.
- Connections have definition and occurrence identity.
- Linked-model assignments remain native assignments.
- ARIS-only satellite objects remain real objects.
- Unknown source types stay represented and preserve raw attributes.

### 8.3 Command system

```ts
interface ArisEditCommand {
  commandId: string
  baseRevision: number
  kind: ArisCommandKind
  affectedSourceIds: readonly string[]
  before: unknown
  after: unknown
  origin: 'user' | 'ai-auto' | 'ai-confirmed' | 'import-repair'
}
```

Every edit must:

- Validate preconditions.
- Apply atomically.
- Be undoable/redoable.
- Serialize into revision history.
- Record affected source IDs.
- Roll back if post-validation fails.

Group multi-object operations into one transaction.

### 8.4 Exit gate

- Working model builds from sanitized AML.
- Definition/occurrence behavior is correct.
- Commands persist and restore.
- Undo/redo never changes original bytes.

## 9. Phase 6 — Build AML writer and derived export

### 9.1 Existing source records

For edits to existing content:

- Patch known byte spans where possible.
- Preserve attribute order.
- Preserve quote style.
- Preserve unrelated whitespace/comments/unknown XML.
- Preserve existing IDs.
- Update all references atomically.

### 9.2 New records

For created content:

- Allocate collision-checked source-style IDs.
- Insert definitions in correct group/database position.
- Insert occurrences into their model.
- Insert connection definitions under correct source definitions.
- Insert connection occurrences under correct source occurrences.
- Add localized attributes using the source language IDs.
- Add geometry/style records in canonical order.
- Escape XML safely.

### 9.3 Export validation

Before derived AML download:

- XML is well formed.
- IDs are unique.
- All definition references resolve.
- Every occurrence belongs to an existing model.
- Every connection endpoint exists.
- Linked models resolve or are explicitly marked missing.
- Attachment references resolve.
- Source accounting is complete.
- No unsafe external entity or executable content was introduced.

### 9.4 Writer tests

- Edit an existing name without rewriting unknown sibling XML.
- Add Arabic attribute.
- Move/resize occurrence.
- Reroute connection.
- Create/delete definition/occurrence/connection.
- Preserve comments and unknown tags.
- Preserve original bytes untouched.
- Export and parse derived AML.
- Detect dangling references before download.

### 9.5 ARIS compatibility status

Until a live smoke test passes, label derived export:

```text
Experimental ARIS AML export
```

### 9.6 Exit gate

- Derived AML parses through the lossless parser.
- Unchanged spans are retained.
- Reference validation passes.
- Original source is unchanged.

## 10. Phase 7 — Implement complete source accounting

### 10.1 Entry contract

```ts
interface ArisAccountingEntry {
  sourcePath: string
  sourceId?: string
  kind: ArisEntityKind
  disposition:
    | 'editable-native'
    | 'visual-only'
    | 'side-panel'
    | 'attachment'
    | 'raw-source-only'
    | 'proposed-repair'
    | 'unsupported'
  targetIds: readonly string[]
  reason?: string
}
```

### 10.2 Account for everything

- Database/groups.
- Languages.
- Models.
- Model attributes.
- Object definitions.
- Object occurrences.
- Connection definitions.
- Connection occurrences.
- All attribute definitions/values/locales.
- Attribute occurrences and placement.
- Assignments.
- Lanes.
- Free-form text.
- OLE definitions/occurrences.
- Blobs.
- Fonts/font styles.
- Pens/brushes.
- Geometry and route points.
- Templates/GUIDs.
- Unknown records.

### 10.3 Report behavior

- Independent lexical census must match accounting totals.
- No record may silently disappear.
- Unsupported content remains raw-source-only.
- Filter by model/type/disposition/issue.
- Selecting a report item opens/selects the corresponding model element when possible.
- Export report as deterministic JSON.
- Include report in workspace backup.
- Record report SHA-256 in the manifest.

### 10.4 Exit gate

- Sanitized fixtures have zero unaccounted records.
- Full local AnimalWF scan has zero records lacking a disposition.

## 11. Phase 8 — Build the ARIS canvas and full supported authoring

Use generic `diagram-js`, not `bpmn-js`.

### 11.1 Canvas services

Implement:

- Root/model canvas.
- Element registry.
- Selection.
- Command stack.
- Modeling service.
- Drag/move.
- Resize.
- Connection creation.
- Bend-point editing.
- Zoom/pan/fit.
- Minimap.
- Search/select.
- Copy/paste.
- Align/distribute.
- Keyboard shortcuts.
- Context pad.
- Palette.
- Undo/redo.

### 11.2 Supported model types

First stable scope:

- `MT_EEPC`
- `MT_VAL_ADD_CHN_DGM`

### 11.3 Supported AnimalWF object types

Full create/edit/delete/connect support for:

- `OT_FUNC`
- `OT_EVT`
- `OT_RULE`
- `OT_ENT_TYPE`
- `OT_INFO_CARR`
- `OT_BUSINESS_RULE`
- `OT_PERF`
- `OT_APPL_SYS`
- `OT_PERS`
- `OT_REQUIREMENT`
- `OT_POLICY`
- `OT_PERS_TYPE`

Support native AND, OR, and XOR rule symbols.

### 11.4 Authoring operations

- Create definition and occurrence.
- Create another occurrence of an existing definition.
- Rename definition.
- Edit definition attributes.
- Move/resize/restyle occurrence.
- Create typed connection definition and occurrence.
- Reroute connection.
- Add/edit lane.
- Add/edit free text.
- Add/remove linked-model assignment.
- Add/download/remove attachment.
- Delete occurrence.
- Delete unused definition with separate confirmation.
- Copy/paste while preserving or cloning definition identity intentionally.

### 11.5 Selection highlighting

For one selected element:

- Highlight all incoming/outgoing typed relations.
- Highlight selected connection itself.
- Resolve selected external label to owner.
- Highlight satellite relationships.
- Deduplicate self-loops.
- Use colors/dashes for overlapping routes.
- Recompute after edit, reroute, model switch, undo, and redo.

Multiple selection and model roots do not show the single-element relation overlay.

### 11.6 Exit gate

- User can author a complete EPC manually.
- Every AnimalWF object type can be selected, moved, edited, and connected.
- Commands are undoable and exportable.

## 12. Phase 9 — Source-faithful visual renderer

### 12.1 Source visual inputs

Read/render:

- `ObjOcc` position and size.
- Symbol number.
- Z-order.
- Pen and brush.
- Connection route points.
- Attribute occurrence placement.
- Fonts/font styles.
- Model background/scale/grid.
- Lanes.
- Free text.
- OLE/blob placement.

### 12.2 Symbol registry

Key symbols by:

```text
model type + object type + SymbolNum
```

Rules:

- Use source symbol/style data when present.
- Use OrbitPM-authored approximations for standard symbols when exact licensed assets are absent.
- Never copy proprietary artwork from online screenshots.
- Unknown/custom symbols use a visible fallback.
- Preserve source symbol reference, ID, geometry, and style.
- Report every visual fallback.

### 12.3 Fidelity report

Report:

- Missing font.
- Missing template.
- Unknown/custom symbol.
- Unsupported brush/pen effect.
- Unsupported OLE rendering.
- Text-wrap difference.
- Missing reference export.
- Substituted visual resource.

### 12.4 Layout modes

- Source Layout.
- Clean Layout.
- Reset to Source Layout.
- Undo/redo layout.

Source Layout must use imported coordinates/routes. Clean Layout modifies only the working layout
revision and never the original source snapshot.

### 12.5 Exit gate

- Source geometry is visible.
- Unknown visuals are explicit.
- Source/Clean modes are independently restorable.

## 13. Phase 10 — Rich metadata, details panel, and attachments

### 13.1 Default metadata layers

Enable by default:

- Owners.
- Responsible parties.
- Consulted/informed parties.
- Inputs.
- Outputs.
- Systems.
- Business rules.
- Policies.
- Requirements.
- Process codes.
- ARIS IDs.
- Model assignments.

Represent native ARIS satellites as real selectable objects, not flattened text.

### 13.2 Collision-aware clusters

- Group dense satellites by owning function.
- Preserve individual object identity.
- Avoid expanding the core flow grid solely because of metadata.
- Allow category visibility toggles.
- Allow per-cluster collapse.
- Persist view preferences separately from AML semantics.
- Provide “Show source layout exactly.”
- Provide “Focus control flow.”

### 13.3 Side panel tabs

- General.
- English/Arabic names.
- ARIS attributes.
- Definition and occurrence IDs.
- Relations.
- Assignments.
- Attachments.
- Accounting.
- Fidelity.
- Revision history.

### 13.4 Attachments

- Extract bytes safely.
- Detect MIME from content.
- Sanitize display name.
- Preview only safe images/text.
- Never execute OLE content.
- Provide exact-byte download.
- Preserve source IDs/metadata.
- Use placeholders for unsupported formats.
- Require confirmation before removal.

### 13.5 Exit gate

- All AnimalWF metadata remains available.
- Rich display does not distort the control-flow backbone.
- Attachments survive backup/export.

## 14. Phase 11 — EPC semantics, XOR, return paths, and clean layout

### 14.1 EPC validation

Implement native EPC rules for:

- Event/function/rule chronology.
- AND/OR/XOR rule use.
- Split/merge distinction.
- Start/end completeness.
- Typed connections.
- Connected-component integrity.
- Linked-model assignments.

Do not make an event perform a decision.

### 14.2 XOR

- Render each `OT_RULE`/`ST_OPR_XOR` as XOR.
- Preserve split and merge rules.
- Preserve every explicit source connection and cycle.
- Keep connection labels optional.
- Store branch meaning in native event/attribute/connection metadata.

### 14.3 Return path

1. Preserve explicit source return routes.
2. Detect English/Arabic return, returned, modify, and rework outcomes.
3. If missing:
   - Search upstream in same connected component.
   - Rank editable functions by graph distance.
   - Prefer existing merge/re-entry rule.
   - Display a dashed candidate.
   - Require confirmation.
   - Require manual target selection on ties.
4. Apply connection definition, occurrence, route, audit entry, and undo record atomically.

### 14.4 Clean layout algorithm

1. Separate control-flow graph from satellite graph.
2. Find connected components.
3. Find strongly connected components.
4. Classify forward and back-edges.
5. Preserve source orientation.
6. Place primary flow on stable spine.
7. Place AND/OR/XOR branches symmetrically.
8. Pair split/merge rules when topology supports it.
9. Route returns in nearest outside channel.
10. Place satellites after core flow.
11. Reserve labels minimally.
12. Resolve collisions iteratively.
13. Remain deterministic.

Reject output with:

- Shape overlap.
- Label/satellite overlap.
- Edge through unrelated shape.
- Detached endpoint.
- Missing/duplicate/zero-length edge.
- Unexplained extreme whitespace.

### 14.5 Exit gate

- Explicit cycles are preserved.
- Missing return routes are safely confirmable.
- Clean layouts pass collision/topology metrics.

## 15. Phase 12 — Create from a new ARIS-native Excel template

Do not accept the old BPMN-oriented 0.4.5 workbook as an ARIS model. Detect it and show migration
guidance.

### 15.1 Template identity

Embed:

```text
OrbitPMArisTemplateVersion=1
```

Generate deterministic blank and example templates from code. Make them downloadable from the
single HTML.

### 15.2 Required workbook sheets

#### `Models`

Columns:

- `model_id`
- `model_type`
- `name_en`
- `name_ar`
- `process_code`
- `description_en`
- `description_ar`
- `orientation`

Allowed model types:

- `MT_EEPC`
- `MT_VAL_ADD_CHN_DGM`

#### `Objects`

Required:

- `model_id`
- `object_id`
- `occurrence_id`
- `object_type`
- `symbol_type`
- `name_en`
- `name_ar`

Optional:

- `lane_id`
- `order`
- `x`
- `y`
- `width`
- `height`
- `assigned_model_id`
- `style_id`

#### `Connections`

Required:

- `model_id`
- `connection_id`
- `source_occurrence_id`
- `target_occurrence_id`
- `connection_type`

Optional:

- `name_en`
- `name_ar`
- `route_points`
- `style_id`

Route syntax:

```text
x:y|x:y|x:y
```

#### `Attributes`

- `owner_kind`
- `owner_id`
- `attribute_type`
- `language`
- `value`
- `value_type`
- `sequence`

#### `Assignments`

- `source_object_id`
- `target_model_id`
- `assignment_type`

#### `Lanes`

- `model_id`
- `lane_id`
- `name_en`
- `name_ar`
- `x`
- `y`
- `width`
- `height`
- `orientation`

#### `FreeText`

- `model_id`
- `text_id`
- `text_en`
- `text_ar`
- `x`
- `y`
- `width`
- `height`
- `style_id`

#### `Styles`

- `style_id`
- `fill_color`
- `stroke_color`
- `stroke_width`
- `line_style`
- `font_family`
- `font_size`
- `font_weight`
- `text_color`
- `z_order`

#### `Glossary`

- `english`
- `arabic`
- `do_not_translate`
- `case_sensitive`

### 15.3 Spreadsheet pipeline

1. Validate file extension and MIME.
2. Run secure XLSX ZIP preflight.
3. Reject macros, encryption, ActiveX, executables, unsafe paths, ZIP bombs, missing cached
   formula values, and wrong template versions.
4. Parse in an inline worker.
5. Preserve cell-address provenance.
6. Validate sheets/columns/types/references.
7. Build `ArisWorkbookModel`.
8. Display model/object/connection counts and issues.
9. Allocate deterministic/collision-safe IDs where omitted.
10. Generate clean layout for missing coordinates.
11. Generate canonical AML.
12. Show visual preview and accounting.
13. Commit all generated models transactionally.

### 15.4 Limits

- 20 MiB compressed.
- 100 MiB declared uncompressed.
- 10,000 ZIP entries.
- 25 sheets.
- 50,000 rows.
- 256 columns.
- 500,000 non-empty cells.
- 32,767 characters per cell.
- 1,000 control-flow objects per model.
- 5,000 objects per transaction.
- Warn above 250 control-flow objects.

### 15.5 Tests

- Deterministic template bytes.
- Official-template detection.
- Wrong/legacy template rejection.
- Formula non-execution.
- Duplicate IDs.
- Missing references.
- Unknown object type.
- Route parsing.
- Bilingual content.
- Multi-model assignments.
- Transaction rollback.
- Generated AML parse/export.

### 15.6 Exit gate

- Blank/example templates round-trip.
- Excel creates native editable AML without AI.
- Source cell provenance reaches accounting/issues.

## 16. Phase 13 — Create with AI from description, DOCX, PDF, and picture

Retain the existing Create UI structure, transport, privacy, and provider controls. Replace only
the BPMN generation schema/prompt/output path with ARIS-native equivalents.

### 16.1 Create tabs

- Description.
- PDF/Picture.
- Excel.

### 16.2 Description input

- Typed English or Arabic.
- Optional DOCX attachment extracted locally.
- Optional PDF attachment sent natively when supported.
- Model name.
- Target folder.
- Model type:
  - EPC, default.
  - Value-added chain.
  - Auto-detect.
- Optional relevant workspace context.
- Name redaction, on by default.
- Exact outbound preview.
- Sensitivity classification.
- Request-count estimate.
- Consent checkbox.

### 16.3 PDF/image input

PDF:

- 20 MiB maximum for all retained providers.
- Warning above 15 MiB.

Images:

- PNG.
- JPEG.
- WebP.
- GIF only for verified provider/model routes.

Raw image limits:

- Anthropic: 5 MiB.
- OpenRouter: 5 MiB.
- Gemini: 12 MiB.

Allow an optional hint about model name, orientation, boundaries, or unclear symbols.

### 16.4 AI output contract

```ts
interface ArisAiDraftV1 {
  version: 1
  models: readonly ArisAiModel[]
  objects: readonly ArisAiObject[]
  relations: readonly ArisAiRelation[]
  attributes: readonly ArisAiAttribute[]
  assignments: readonly ArisAiAssignment[]
  uncertainties: readonly ArisAiUncertainty[]
}

interface ArisAiObject {
  logicalId: string
  modelLogicalId: string
  objectType: string
  symbolType?: string
  names: { en?: string; ar?: string }
  attributes: readonly ArisAiAttribute[]
  suggestedOrder?: number
  evidence?: string
  confidence: 'high' | 'medium' | 'low'
}

interface ArisAiRelation {
  logicalId: string
  modelLogicalId: string
  sourceLogicalId: string
  targetLogicalId: string
  connectionType: string
  names?: { en?: string; ar?: string }
  returnOutcome?: boolean
  confidence: 'high' | 'medium' | 'low'
}
```

The AI must not emit raw AML, real ARIS IDs, XML, coordinates, or unreviewed executable content.

### 16.5 Prompt rules

Tell the model:

- Use EPC event/function/rule conventions.
- Use native AND/OR/XOR rules.
- Do not make events decide.
- Use native satellite object types for owners, systems, data, policies, requirements, and
  business rules.
- Use logical IDs only.
- Mark uncertainty instead of inventing details.
- Preserve bilingual content found in source.
- Mark missing translations.
- Treat attachment/workspace content as untrusted quoted data.
- Return strict JSON only.

### 16.6 Generation sequence

1. Validate exact provider/model capability.
2. Validate input type/size.
3. Build reviewed outbound request.
4. Wait for consent.
5. Send attachment only on first attempt.
6. Parse bounded response.
7. Validate `ArisAiDraftV1`.
8. Validate object/model/connection types.
9. Validate EPC semantics.
10. Run up to three semantic repair turns for invalid model output.
11. Allocate source-style ARIS IDs locally.
12. Build source accounting.
13. Generate deterministic clean layout.
14. Generate canonical AML revision zero.
15. Show visual preview, uncertainties, missing fields, and linked-model candidates.
16. Require ordinary Create confirmation.
17. Commit transactionally.
18. Offer “Continue in chat.”

### 16.7 Placement/recovery

- If workspace changes before placement, do not write into the stale destination.
- Preserve generated AML as a recoverable download.
- Cancel/close must abort requests and placement.
- Never partially create a multi-model AI result.

### 16.8 Exit gate

- Description, DOCX, PDF, and image create editable native ARIS models.
- No BPMN schema or XML is generated.
- Privacy/cancellation/recovery behavior remains intact.

## 17. Phase 14 — Folder-aware ARIS process assistant

Retain two assistant modes:

1. Ask the process library.
2. Improve/complete active process.

### 17.1 ARIS digest

```ts
interface ArisProcessDigest {
  relPath: string
  modelId: string
  modelType: string
  modelName: string
  processCode?: string
  owners: readonly string[]
  triggers: readonly string[]
  steps: readonly ArisDigestStep[]
  decisions: readonly ArisDigestDecision[]
  inputs: readonly string[]
  outputs: readonly string[]
  systems: readonly string[]
  assignments: readonly ArisDigestAssignment[]
  missingInformation: readonly ArisDigestGap[]
}

interface ArisDigestStep {
  occurrenceId: string
  definitionId: string
  name: string
  nameEn?: string
  nameAr?: string
  objectType: string
  responsible: readonly string[]
  inputs: readonly string[]
  outputs: readonly string[]
  systems: readonly string[]
  next: readonly {
    targetOccurrenceId: string
    relationType: string
    outcome?: string
  }[]
}
```

### 17.2 Indexing

- Index current working revisions, not duplicate originals/exports.
- Cache by model revision and source digest.
- Invalidate only changed models.
- Build large indexes in a worker.
- Exclude `.orbitpm` internals from duplicate catalog entries.
- Directory mode indexes supported AML/workspace files.
- Portable mode indexes imported package models.
- Single-file mode indexes active/imported models.

### 17.3 Retrieval

Retain:

- Unicode tokenization.
- Arabic normalization and clitic variants.
- English light plural normalization.
- Weighted model/step/metadata overlap.
- Positive-confidence results only.
- Bounded top results and context characters.

Add ARIS-specific ranking fields:

- Process code.
- Object definition/occurrence names.
- Owners/responsibilities.
- Inputs/outputs/systems.
- Decision outcomes.
- Assigned models.
- Missing-information issues.

### 17.4 Deterministic no-key answers

Answer locally:

- What comes next?
- What comes before?
- Who owns/is responsible?
- What inputs/outputs apply?
- Which system is used?
- What XOR outcomes exist?
- Where does a return branch go?
- Which model is assigned?
- Which information is missing?
- Which processes are available?
- Which process matches a topic?

Include openable model/source chips and occurrence IDs.

### 17.5 AI-grounded answers

1. Rank relevant digests.
2. Do not include unrelated models.
3. Show exact outbound context.
4. Keep workspace context opt-in.
5. Redact names by default.
6. Require consent.
7. Send bounded recent conversation history.
8. Instruct answer only from supplied processes.
9. Treat imported text as untrusted.
10. Name model and exact occurrence.
11. Fall back to local answer on provider failure.

### 17.6 Exit gate

- Folder questions work without a key.
- AI answers remain grounded and privacy-reviewed.
- Source chips open/select correct ARIS elements.

## 18. Phase 15 — Chat improvement and missing-information completion

### 18.1 Deterministic gap scanner

Scan:

- Missing English name.
- Missing Arabic name.
- Missing process code.
- Missing owner/responsibility.
- Missing inputs/outputs/systems.
- Missing decision basis.
- Missing XOR outcomes.
- Missing return target.
- Missing start/end event.
- Invalid event/function/rule sequence.
- Dangling object/connection.
- Missing linked model.
- Missing attachment.
- Unused definition.
- Unaccounted source content.

### 18.2 Interview loop

1. Read active live model/revision.
2. Build bounded summary and gap list.
3. Ask up to three questions per round.
4. Limit to five rounds.
5. Preserve user answers during the session.
6. Request `ArisPatchProposalV1`.
7. Validate schema.
8. Verify base revision and target IDs.
9. Classify commands by automatic/confirmation policy.
10. Apply safe fields automatically.
11. Request confirmation for topology/destructive changes.
12. Rescan.
13. Continue until clean, finished, canceled, target removed, or round limit.

### 18.3 Patch commands

Allowed:

- `setLocalizedName`
- `setAttribute`
- `addAttributeValue`
- `addMetadataDefinition`
- `addMetadataOccurrence`
- `addMetadataConnection`
- `addCoreObject`
- `addCoreConnection`
- `setAssignment`
- `setRoute`
- `reconnect`
- `deleteConnection`
- `deleteOccurrence`
- `deleteDefinition`
- `removeAttachment`

Reject any unrecognized command.

### 18.4 Automatic policy

Automatically apply after schema/precondition validation:

- English/Arabic names.
- Translations.
- Owners/responsibilities.
- Inputs/outputs/systems.
- Process codes.
- Decision basis.
- Notes.
- Additive metadata attributes.
- Additive metadata satellite definitions/occurrences/relations.

Require explicit confirmation:

- New core control-flow object.
- New core control-flow connection.
- Return back-edge.
- Reconnection/retargeting.
- Model assignment.
- Deletion.
- Attachment removal.
- ID change.
- Ambiguous target.

### 18.5 Atomic safe application

1. Verify base revision is current.
2. Apply all safe commands in one transaction.
3. Run semantic/reference/accounting validation.
4. Roll back on any failure.
5. Save draft revision.
6. Show receipt with each change.
7. Provide one-click Undo.
8. Rescan gaps.
9. Do not export AML automatically.

### 18.6 Confirmation-gated application

1. Show affected objects/relations.
2. Show before/after graph preview.
3. Allow selecting individual commands.
4. Apply selected commands atomically.
5. Keep rejected commands in chat as suggestions.

### 18.7 Transcript/privacy

- Chat transcript remains session-local by default.
- Applied change receipts and command provenance enter revision history.
- Full prompts/provider responses are not stored unless user explicitly exports them.
- API keys are never stored in chat/history.

### 18.8 Exit gate

- Safe field completion auto-applies atomically.
- Topology/destructive changes remain confirmation-gated.
- Undo restores prior revision.
- Invalid AI patches make no changes.

## 19. Phase 16 — AnimalWF full-data and natural-layout loop

Use locally:

```text
../reference/AnimalWF/ARISAMLExport.xml
```

Do not commit this private fixture.

### 19.1 Baseline to verify independently

- 8 models.
- 7 `MT_EEPC`.
- 1 `MT_VAL_ADD_CHN_DGM`.
- 279 object definitions.
- 494 object occurrences.
- Approximately 465 connection records, to be reconciled precisely.
- 516 attribute definitions.
- 774 attribute occurrences.
- 69 free-text records.
- 16 lanes.
- 14 OLE definition/occurrence records.
- 28 blobs.
- 6 font style sheets.
- 249 object definitions missing Arabic.

Do not hard-code uncertain counts as truth; the new raw lexical census and semantic index must
independently agree and then establish the exact golden census.

### 19.2 Required iteration cycle

For every importer/renderer/layout change:

1. Import AnimalWF.
2. Compare lexical census, semantic index, and accounting.
3. Fail on divergence.
4. Render all eight source layouts.
5. Render all eight clean layouts.
6. Capture fixed-viewport screenshots.
7. Measure:
   - Shape overlaps.
   - Label/satellite overlaps.
   - Edge/shape crossings.
   - Edge/edge crossings.
   - Bend counts.
   - Route lengths.
   - Canvas area.
   - Detached endpoints.
8. Inspect every XOR and return loop.
9. Classify each defect:
   - Parser.
   - Mapping.
   - Symbol.
   - Style.
   - Text.
   - Topology.
   - Layout.
10. Fix the owning subsystem.
11. Rerun all tests/screenshots.
12. Reject cross-model regressions.
13. Repeat until every metric/visual acceptance criterion passes.

### 19.3 Known return scenarios

Explicitly verify:

- Operator Registration.
- Animal Profile Closure.
- Animal registration.
- Renewal-related processes.

### 19.4 Natural-layout acceptance

- No shape overlap.
- No label/satellite overlap.
- No edge through unrelated shape.
- Every endpoint attached correctly.
- No missing/duplicate/zero-length connection.
- Explicit cycles visible.
- Return route traceable without selection.
- No unexplained extreme width/height/whitespace.
- Selecting any object reveals its connected lines clearly.
- Source and clean layouts independently restorable.

### 19.5 Exit gate

- Exact accounting has zero unaccounted records.
- All eight models are readable in source and clean layout.
- No known return-flow regression remains.

## 20. Phase 17 — Visual golden pair and ARIS import/re-export

When the user supplies one AML/XML and matching ARIS PDF/PNG:

### 20.1 Reference capture

1. Keep assets private unless publication is authorized.
2. Record:
   - Target ARIS version.
   - Database template.
   - Palette.
   - Fonts.
   - Language.
   - Zoom.
   - Page size.
   - Export settings.
3. Compute digests.
4. Store optional references in the private source package.

### 20.2 Visual comparison

Compare:

- Model/object/connection counts.
- Object identity and text.
- Bounds and centers.
- Route bends/endpoints.
- Colors.
- Fonts.
- Text wrapping.
- Z-order.
- Satellites.
- Lanes.
- Free text.

Target:

- 100% semantic/content match.
- Centers/bounds within 2 pixels after normalization.
- Bend points within 3 pixels.
- Exact source colors where specified.
- Perceptual pixel difference under 1%, excluding a documented antialiasing mask.

Missing proprietary fonts/templates/custom symbols remain explicit blockers; do not hide them
with unreported approximations.

### 20.3 Live ARIS compatibility gate

1. Import the golden AML.
2. Make representative edits:
   - Names/translations.
   - Attributes.
   - Geometry.
   - Route.
   - Core connection.
   - XOR return.
   - Satellite.
   - Assignment.
   - Attachment.
3. Export derived AML.
4. Import derived AML into target ARIS.
5. Confirm no fatal import rejection.
6. Re-export from ARIS.
7. Compare definitions, occurrences, connections, IDs, attributes, linked models, geometry, and
   attachments.
8. Confirm intended changes and zero unintended semantic loss.

### 20.4 Exit gate

- Visual golden target passes or has explicitly accepted external-resource gaps.
- Live ARIS import/re-export passes.
- Experimental label can be removed only after this gate.

## 21. Phase 18 — Release-quality tests, performance, and publication

### 21.1 Unit tests

- AML tokenization/security.
- Entity limits.
- Source preservation.
- Semantic indexing.
- Unknown-record retention.
- AML writer.
- ID/reference validation.
- Accounting reconciliation.
- Definition/occurrence behavior.
- Commands/undo/redo.
- XOR/return.
- Clean layout.
- Excel schema/provenance.
- AI ARIS schema and prompt.
- Chat digest/retrieval/local answers.
- Patch classification.
- Automatic apply/rollback.
- Privacy/key storage.

### 21.2 Integration tests

- Import transaction and rollback.
- Workspace package backup/restore.
- Multi-model editing.
- Linked-model navigation.
- Attachment lifecycle.
- AI placement/recovery.
- Excel multi-model transaction.
- Assistant indexing after edits.
- Chat safe auto-apply.
- Topology confirmation.

### 21.3 Browser tests

- Import/open every AnimalWF model.
- Edit every supported object type.
- Create/delete/connect.
- Edit bilingual attributes.
- Edit styles/routes/lanes/text/attachments.
- Create from description.
- Create from DOCX.
- Create from PDF.
- Create from image.
- Create from official ARIS Excel template.
- Ask folder questions without key.
- Ask grounded AI questions with consent.
- Auto-complete safe fields.
- Confirm topology changes.
- Undo AI changes.
- Save/restore/export.
- Run exact release through `file://`.
- Verify zero startup traffic.

Run Chromium, Firefox, and WebKit.

### 21.4 Performance gates

On the standard Playwright runner:

- Parse/account/show first AnimalWF model within 5 seconds.
- Switch between parsed models within 500 ms.
- Selection/drag/edit response within 100 ms at p95.
- Export 4.4 MiB source package within 5 seconds.
- Remain stable through 50 model switches.
- Remain stable through 20 import/close cycles.
- Keep full-folder assistant retrieval responsive.
- Avoid unbounded memory growth after repeated AI attachment cancellation.

### 21.5 Artifact verification

The canonical HTML must:

- Be one file.
- Be deterministic.
- Inline all code/assets/workers/templates.
- Run via `file://`.
- Work offline except explicit AI calls.
- Pass English/Arabic and LTR/RTL smoke.
- Pass Chromium/Firefox/WebKit.
- Contain no BPMN dependency.
- Contain no private fixture.
- Contain no API key.
- Make no unexpected request.
- Be committed with every product-code push.

### 21.6 Manual release candidate

Run the comprehensive suite only when preparing a release candidate:

- Exact source SHA.
- Exact canonical HTML SHA-256.
- Typecheck/lint.
- Unit/integration.
- All browser engines.
- Accessibility.
- Security/supply chain.
- Artifact identity.
- AnimalWF local evidence.
- Visual golden evidence.
- ARIS import/re-export evidence.

The publisher must reject mismatched SHA/evidence.

## 22. Stable definition of done

Do not mark this plan complete or create the stable tag until:

- Repository cleanup and trial CI policy are complete.
- ARIS branch is based on recorded clean main.
- Production contains no BPMN behavior/dependency.
- Original AML is immutable.
- Derived AML validates and passes live ARIS import/re-export.
- Complete source accounting has zero unaccounted records.
- All eight AnimalWF models are editable.
- All supported object types are authorable.
- Rich metadata is preserved without distorting control flow.
- Source/Clean layouts are both available.
- XOR and return paths are correct.
- All-element connection highlighting works.
- Description/DOCX/PDF/image creation works.
- New ARIS Excel creation works.
- Folder assistant works locally and with reviewed AI.
- Safe chat field changes auto-apply atomically and are undoable.
- Topology/destructive chat changes require confirmation.
- Attachments and linked models are preserved.
- User visual golden target passes.
- Single HTML is deterministic, portable, and tracked.
- Manually dispatched full release-candidate suite passes against the exact published artifact.
