# OrbitPM Process Studio Lite — Deferred BPMN Fix Plan

## 1. Purpose, branch, and non-negotiable behavior

This is the deferred implementation plan for repairing the existing BPMN Studio Lite product.
It is intentionally independent from `aris_transformation.md`: an implementing agent must be
able to execute this plan without reading any other plan.

Create the implementation branch `fix/bpmn-studio-plan2` from the then-current `main`.
Do not mix the ARIS-only product transformation into this branch.

The completed BPMN product must still:

- Be distributed as one self-contained HTML file.
- Run when opened directly through `file://`, without a server or installation.
- Work in current Chromium, Firefox, and WebKit/Safari-class browsers.
- Use a portable workspace fallback where directory APIs are unavailable.
- Retain English/Arabic UI, bilingual process content, and RTL behavior.
- Retain Create with AI from:
  - A typed process description.
  - An optional DOCX description attachment.
  - A PDF.
  - PNG, JPEG, WebP, or supported GIF process images.
  - Excel/CSV.
- Retain the process assistant for:
  - Questions about processes in the selected folder/workspace.
  - Deterministic local answers without an API key.
  - AI-grounded answers when the user explicitly includes workspace context.
  - Completing missing information through interview-style questions.
  - Improving a newly generated process.
- Retain browser-direct BYOK support for OpenRouter, Anthropic, and Gemini.
- Keep API keys in memory by default, with the existing optional encrypted persistence.
- Never include an API key in release files, workspaces, backups, logs, or process exports.

The canonical rolling artifact is:

```text
release/OrbitPM-Process-Studio-Lite.html
```

## 2. Repository and GitHub preparation

Perform this audit even if the ARIS plan has already executed similar cleanup. If a step is
already complete, verify it and record it as complete rather than repeating a destructive action.

### 2.1 Synchronize and protect user work

1. Run `git status --short --branch`.
2. Stop if there are unrelated uncommitted changes that overlap files needed by this plan.
3. Fetch all remote branches and tags.
4. Switch away from a branch that is scheduled for deletion.
5. Fast-forward local `main`; do not reset, force-checkout, or overwrite user changes.
6. Record the resulting local and remote main SHAs.

### 2.2 Clean merged branches

Immediately before each deletion, verify that the branch tip remains an ancestor of
`origin/main`.

Delete only when fully merged:

- Local `feat/lite-ux-wave`.
- Local and remote `release/0.4.5-lite-only`.
- Local and remote `release/0.4.5-owner-waiver`.

Preserve:

- `archive/full-product-v0.4.4`, locally and remotely.
- Every tag and GitHub release.
- Any branch that is no longer fully merged at execution time.

Record deleted branch names, final SHAs, and ancestry evidence in the implementation PR or
change log.

### 2.3 Simplify trial CI without removing release assurance

1. Preserve main protection against force-push and branch deletion.
2. Preserve the protected `v*` tag ruleset.
3. Remove required status checks from `main` during the trial period.
4. Permit direct pushes and PR merges without waiting for comprehensive GitHub Actions.
5. Keep full workflows available through `workflow_dispatch` and `workflow_call`.
6. Make the release candidate workflow accept an exact source SHA and proposed version.
7. Require the complete quality suite only for a manually requested release candidate.
8. Save candidate evidence tied to the source SHA and canonical HTML SHA-256.
9. Let the release publisher accept only that exact successful candidate.
10. Keep GitHub Actions read-only by default and elevate permissions only in publish/rollback
    jobs.
11. Consolidate version-specific environments into stable `release`, `github-pages`, and
    `rollback` environments.

Recommended workflow responsibilities:

- `quality.yml`: full reusable/manual quality suite.
- `release-candidate.yml`: manual exact-SHA candidate evaluation.
- `release.yml`: verify candidate evidence, create protected tag, and publish immutable assets.
- `pages.yml`: manual trial deployment or release-invoked deployment.
- `pages-rollback.yml`: manual rollback.

Fold separate finalize behavior into `release.yml`. Remove version-specific historical cleanup
automation; exceptional cleanup should be manual and separately authorized.

### 2.4 Track one rolling HTML

1. Change `.gitignore` so the canonical HTML is tracked while temporary release evidence remains
   ignored.
2. Add a deterministic local build command that:
   - Builds in a clean temporary output directory.
   - Emits one inlined HTML file.
   - Contains no timestamps, random IDs, machine paths, or machine-specific metadata.
   - Copies the exact result to `release/OrbitPM-Process-Studio-Lite.html`.
   - Prints byte size and SHA-256.
   - Runs build/artifact checks only, not the comprehensive test suite.
3. Add a repository-managed pre-push check that builds to a temporary path and compares the
   result byte-for-byte with the tracked canonical HTML.
4. The check may reject a stale artifact but must not edit or commit automatically.
5. Every product-code commit must include the corresponding canonical HTML update.
6. Documentation-only commits may reuse the prior artifact only when a source-input manifest
   proves no product input changed.
7. Official releases copy the verified canonical file to a versioned immutable asset; they do
   not rebuild different bytes.

### 2.5 Exit gate

Do not begin product fixes until:

- The working tree is understood and safe.
- Local main matches remote main.
- Only intended merged branches were removed.
- Archive branch and tags remain.
- Main has no required trial checks.
- Manual release-candidate functionality remains.
- The rolling HTML policy is documented and testable.

## 3. Evaluate and integrate the adjusted 0.4.5 HTML

Use `../reference/OrbitPM-Process-Studio-Lite-0.4.5.html` as behavioral evidence, not as source
code to copy over the repository.

### 3.1 Baseline evidence

1. Record SHA-256 and byte size for:
   - The repository’s released 0.4.5 HTML.
   - The adjusted reference HTML.
2. Normalize/beautify both bundles in temporary space.
3. Produce a functional change inventory.
4. Map every observed behavior to an owning TypeScript module.
5. Mark each change as:
   - Accept and reimplement.
   - Already present.
   - Unsafe and reject.
   - Superseded by this plan.

### 3.2 Source-level integration rule

- Reimplement accepted behavior in source TypeScript.
- Add a focused test for every accepted behavior.
- Never replace repository source with decompiled bundle code.
- Never treat minified/beautified symbol names as stable APIs.
- Regenerate the release HTML only from repository source.

### 3.3 Explicitly rejected adjusted-bundle behavior

Do not port:

- Forced `valid: true`.
- Blanket conversion of blockers to warnings.
- Trust based on a marker substring in XML.
- Fabricated validation or localization evidence.
- Silent structural or topology mutation.
- ARIS-specific bypasses in the BPMN validation path.

### 3.4 Exit gate

- Every accepted change has a source owner and test.
- No forced-valid path remains.
- Validation evidence is genuine.
- Generated HTML is reproducible.

## 4. Legacy BPMN preparation and draft lifecycle

Introduce a staged preparation model:

```ts
interface PreparedBpmnDraft {
  source: {
    name: string
    bytes: Uint8Array
    sha256: string
  }
  originalXml: string
  candidateXml: string
  validation: ValidationSummary
  repairs: readonly BpmnRepairProposal[]
  status: 'clean' | 'draft-with-issues' | 'unsafe'
}

interface BpmnRepairProposal {
  id: string
  kind: 'target-namespace' | 'namespace-declaration' | 'missing-di' | 'return-edge'
  risk: 'structural-safe' | 'semantic-proposed'
  affectedIds: readonly string[]
  beforeDigest: string
  afterDigest: string
  confirmed: boolean
}
```

### 4.1 Preparation order

1. Capture exact original bytes, filename, media type, and SHA-256.
2. Decode XML without discarding the byte source.
3. Check XML well-formedness.
4. Reject unsafe preservation loss, malformed XML, duplicate IDs, or unresolvable references.
5. Create an in-memory candidate without changing the input file.
6. If `targetNamespace` is absent, propose:
   - `https://orbitpm.ae/bpmn/<encoded-first-process-id>`.
   - Otherwise use the definitions ID.
   - Otherwise use `https://orbitpm.ae/bpmn/import-<first-12-source-digest-characters>`.
7. Record the exact before/after value and XML path.
8. Run structural, semantic, lint, localization, and preservation validation on the candidate.
9. Open the candidate immediately when it is well formed and preservation-safe, even if semantic
   or translation issues remain.
10. Mark the tab visibly as a draft.
11. Display every unresolved issue.
12. Allow canvas editing and source viewing immediately.

### 4.2 Save and download behavior

- Normal Save remains strict.
- “Save draft with errors” requires explicit confirmation.
- Draft save records the issue snapshot and repair state.
- Download offers:
  - Original unchanged file.
  - Current edited draft.
  - Confirmed repaired draft.
- Repaired download requires a dialog listing every repair.
- Canceling produces no download or mutation.
- Opening or previewing never changes the original filesystem input.

### 4.3 Safe repair whitelist

Automatically prepare, but do not silently persist:

- Missing target namespace.
- Missing namespace declaration whose URI is unambiguous from a supported used prefix.
- Missing BPMNDI for an otherwise valid semantic model, using deterministic layout.

Never automatically repair:

- Duplicate IDs.
- Broken semantic references.
- Unknown extensions.
- Names or translations.
- Gateway topology.
- Connection direction.
- Return paths.
- Preservation loss.

### 4.4 Policy integration

Reuse the central validation policy:

- `apply-editor`: may open a well-formed, preservation-safe semantic draft.
- `save-draft-with-errors`: requires explicit confirmation.
- Normal `save`, `commit-import`, and generated release-ready writes remain strict.
- Malformed XML and preservation loss are never waived.

## 5. Survey fixture behavior

Use `../reference/survey-process.bpmn` as a permanent regression fixture.

### 5.1 Required result

After preparation:

- Display exactly 17 BPMN shapes.
- Display exactly 17 sequence-flow connections.
- Keep original source bytes unchanged.
- Add a stable target namespace only to the candidate.
- Flag the unnamed end event by ID.
- Flag each required missing Arabic value separately.
- Permit immediate viewing, selection, editing, and source inspection.
- Permit draft save after confirmation.
- Block normal release-ready save while required issues remain.
- Require confirmation before downloading a structurally repaired copy.

### 5.2 Test assertions

- Original SHA-256 is unchanged after open, edit, cancel, and repaired-preview actions.
- Element registry contains 17 expected shape elements.
- Element registry contains 17 expected sequence-flow connections.
- BPMNDI contains the corresponding 17 shapes and 17 edges after preparation.
- The unnamed end event remains a naming issue.
- Missing Arabic issues are not hidden by the namespace repair.
- Canceling Save Draft leaves workspace state unchanged.
- Confirmed Save Draft writes only the chosen draft destination.

## 6. Remove the connection-label requirement

Replace the stock blanket `label-required` behavior with an OrbitPM-owned rule or adapter.

### 6.1 Rules

- Sequence-flow names are optional for every connection type.
- Existing source connection labels remain preserved and editable.
- No visible connection label is synthesized merely because a condition exists.
- Condition expressions and visible connection labels are independent properties.
- Flow-node labels remain required where applicable.
- The unnamed survey end event remains flagged.
- XOR and inclusive non-default branches still require a machine-readable condition.
- A default branch does not require a condition.

### 6.2 Condition precedence

For a non-default decision branch:

1. Preserve an existing condition expression.
2. Otherwise use an explicitly entered structured outcome.
3. Otherwise use reviewed imported outcome metadata.
4. Otherwise flag an unresolved branch condition.

Do not convert the target node’s visible label into an edge name.

### 6.3 Tests

- Unnamed conditioned flow has no connection-label issue.
- Unnamed required flow node still has a naming issue.
- Existing edge label round-trips.
- Removing edge label keeps the condition.
- Removing the condition from a non-default XOR branch produces a condition issue.
- Default branch remains valid without a condition.

## 7. Restore XOR and implement return paths

### 7.1 Restore XOR everywhere

Restore or verify XOR support in:

- Palette.
- Context pad.
- Element factory.
- Renderer.
- Properties/details panel.
- XML import/export.
- Validation.
- Copy/paste.
- Keyboard controls.
- Undo/redo.
- Auto-layout and routing.
- Assistant digest.
- AI generation IR and prompts.
- Spreadsheet type mappings.

### 7.2 Preserve split and merge gateways

- Never collapse a source split and merge into one gateway.
- Preserve every explicit source cycle and back-edge.
- Preserve default-flow identity and branch conditions.
- Round-trip gateway IDs.

### 7.3 Missing return-edge proposal

When an outcome means return, returned, modify, rework, or a supported Arabic equivalent:

1. Prefer an existing explicit back-edge.
2. If absent, search upstream in the same connected component.
3. Rank editable activities by graph distance.
4. Prefer an existing merge/re-entry XOR connected to the candidate activity.
5. Display a dashed proposed route and selected target.
6. Require confirmation.
7. Require manual target selection when ranking is tied.
8. Never silently insert the connection.

Expected structure:

```text
XOR split
  → return outcome
  → merge/re-entry XOR when present
  → prior editable activity
```

### 7.4 Routing

- Use a dedicated outside lane for back-edges.
- Select the nearest side with collision-free space.
- Do not cross shape interiors, labels, or metadata decorations.
- Preserve visible arrow direction.
- Recompute after shape movement.
- Apply or undo the complete repair as one command.

### 7.5 Audit

Record:

- Source gateway.
- Outcome element.
- Proposed/selected target.
- Generated gateway/flow IDs, if any.
- Confirmation result.
- Before/after digests.

## 8. Highlight connected lines for every semantic element

Generalize the current activity-only highlighter.

### 8.1 Supported selection

- Tasks and subprocesses.
- Start, intermediate, boundary, and end events.
- Gateways.
- Participants and lanes with actual relations.
- Data objects and data stores.
- Groups and text annotations with associations.
- Connections themselves.
- External labels by delegating to `labelTarget`.

Process/collaboration roots and multi-selection produce no connected-edge overlay.

### 8.2 Rendering rules

- Highlight stable incoming-then-outgoing order.
- Deduplicate by connection ID.
- Deduplicate self-loops.
- Preserve distinct colors/dash patterns for overlapping routes.
- Draw above ordinary connection graphics.
- Keep pointer events disabled on the overlay.
- Keep accessibility semantics on the original diagram, not duplicate overlays.
- Recompute after selection, import, connection creation, routing, undo, redo, and element
  removal.

### 8.3 Tests

Test every supported selection type, self-loop, overlapping route, external label, selected
connection, root, and multi-selection.

## 9. Retain Create with AI

Do not remove or weaken existing AI functionality while making BPMN fixes.

### 9.1 Browser-direct provider policy

Keep:

- OpenRouter.
- Anthropic.
- Gemini.
- One explicitly selected provider/model for all AI surfaces.
- API keys in memory by default.
- Optional AES-GCM encryption with PBKDF2-derived keys for persistence.
- No bundled key.
- No automatic provider fallback that could send data to an unreviewed provider.

### 9.2 Create from description

Retain:

- English/Arabic typed description.
- Optional DOCX text extraction.
- Optional native PDF attachment.
- Process name and destination folder.
- Optional relevant workspace context.
- Redaction enabled by default.
- Exact outbound request preview.
- Sensitivity classification.
- Request-count estimate.
- Explicit consent.
- Cancellation and bounded retry.
- Generated-link verification.
- Transactional placement.
- Recoverable download if placement becomes stale/cancelled.
- “Continue in chat.”

### 9.3 Create from PDF/image

Keep these limits:

- PDF: 20 MiB for OpenRouter, Anthropic, and Gemini.
- PDF warning: above 15 MiB.
- Image:
  - Anthropic: 5 MiB.
  - OpenRouter: 5 MiB.
  - Gemini: 12 MiB.

Supported image types:

- PNG.
- JPEG.
- WebP.
- GIF only where the exact selected provider/model route is verified.

Requirements:

- Fail closed on unsupported model/media combinations.
- Never send a file before consent.
- Encode the attachment once.
- Send the large attachment only on the first generation attempt.
- Make repair attempts text-only.
- Bound provider response bytes and chunks.
- Abort on close/cancel/superseding request.

### 9.4 Create from Excel/CSV

Retain:

- Secure ZIP preflight.
- Macro/encryption/ActiveX/executable rejection.
- Formula non-execution.
- Missing cached-value warnings/blockers.
- Worker parsing.
- Official templates.
- Mapping review.
- Source cell provenance.
- Bilingual review.
- Transactional destination writes and rollback.

## 10. Retain folder-aware chat and process completion

### 10.1 Ask the process library

Retain:

- Workspace digest generation.
- Unicode/Arabic retrieval and normalization.
- Positive-confidence ranking only.
- Deterministic no-key answers.
- Openable source chips in directory mode.
- Bounded conversation history.
- AI answers grounded only in reviewed selected process context.
- Prompt-injection guard around imported process text.
- Exact outbound review and consent.
- Local fallback on provider failure.

The local assistant must continue answering:

- What comes next?
- What comes before?
- Who owns or is responsible?
- Which inputs/outputs/systems apply?
- Which process is relevant?
- Which linked process is called?
- Which information is missing?

### 10.2 Complete/improve the active process

Retain the interview mode:

1. Scan the active live model.
2. Identify deterministic information and flow gaps.
3. Ask at most three questions per round.
4. Bound interview rounds.
5. Use accumulated answers in regeneration.
6. Apply through the normal reviewed/validated editor path.
7. Rescan after application.
8. Stop on clean result, user finish, missing target, cancellation, or round limit.

Assistant changes must not bypass draft validation, preservation checks, undo, or dirty-state
tracking.

## 11. Single-file build and runtime requirements

### 11.1 Build

The HTML must contain:

- JavaScript.
- CSS.
- Fonts/icons.
- Workers.
- Validation schemas.
- Excel templates.
- Application metadata.

Prohibit:

- CDN assets.
- Dynamic external chunks.
- External fonts.
- Runtime schema downloads.
- Runtime source maps.
- Server-only APIs.

### 11.2 Runtime

- Core editing works offline.
- Excel/CSV import works offline.
- Local process assistant works offline.
- AI actions clearly require internet and a configured key.
- Startup makes no external requests.
- AI endpoints are requested only after reviewed consent.
- Directory mode is optional; portable fallback is complete.

### 11.3 Smoke tests

Run exact `file://` artifact tests in:

- Chromium.
- Firefox.
- WebKit.

Test:

- English and Arabic.
- LTR/RTL.
- Create/open/edit/save.
- Assistant open/close and local answer.
- AI privacy review without sending.
- Excel tab.
- No unexpected requests.

## 12. Required test matrix

### Unit

- Preparation and namespace repair.
- Validation policy.
- Optional flow labels.
- Gateway conditions.
- XOR and return target ranking.
- Connected-edge selection.
- Source-byte preservation.
- AI regressions.
- Assistant digest/retrieval/interview regressions.

### Integration

- Survey preparation and editing.
- Draft save confirmation.
- Repaired download confirmation/cancellation.
- XOR creation/import/export.
- Return-edge undo/redo.
- All-element highlighting.
- AI generation placement.
- Spreadsheet import transaction.
- Assistant process completion.

### Browser

- Survey exact 17/17.
- File-mode startup.
- PDF/image selection.
- Excel/CSV import.
- No-key folder answer.
- Reviewed AI answer.
- Generated draft continued in chat.
- Canonical HTML reproducibility.

## 13. Definition of done

This deferred plan is complete only when:

- Survey renders 17 shapes and 17 connections.
- Missing namespace is prepared safely.
- Unnamed end event is flagged.
- Missing Arabic is flagged.
- Drafts open and edit without localization bypass.
- Structural repairs require confirmation.
- Connection labels are optional.
- Flow-node naming and gateway conditions remain enforced.
- XOR creation, import, export, and return cycles work.
- Connected-line highlighting covers all semantic selections.
- Description/DOCX/PDF/image/Excel/CSV creation still works.
- Folder-aware chat still works locally and with AI.
- Missing-information interview still works.
- Original input preservation is proven.
- Canonical HTML is deterministic, tracked, and `file://` runnable.
- Full manually dispatched release-candidate suite passes against the exact artifact SHA.
