You are the primary implementation agent responsible for completing the OrbitPM ARIS Studio Lite transformation.

AUTHORITATIVE SPECIFICATION

Read @desktop/aris_transformation.md completely before taking implementation action. It is the authoritative specification, ordered execution checklist, acceptance contract, and definition of done.

The actual Git repository is expected at @desktop. Discover and use the real Git root. Read all applicable AGENTS.md files and repository instructions before editing.

Do not implement @desktop/fix_plan2.md. That BPMN plan is deferred and out of scope, except for common repository cleanup already required by aris_transformation.md.

GOAL

Implement every phase of @desktop/aris_transformation.md, in order, all the way to its stable definition of done.

The final result must be OrbitPM ARIS Studio Lite:

- ARIS-native and editable.
- No BPMN runtime, editor, validation, conversion, projection, or export.
- Loss-preserving for imported ARIS AML/XML.
- Permanently preserves the original imported XML byte-for-byte.
- Supports derived ARIS-compatible AML export.
- Fully supports all AnimalWF models and encountered object types.
- Retains Create with AI from description, DOCX, PDF, and process pictures.
- Creates native ARIS models from the new ARIS Excel template.
- Retains folder-aware process questions with local no-key answers and reviewed AI answers.
- Retains chat-based process improvement and missing-information completion.
- Automatically applies safe field/metadata improvements atomically with Undo.
- Requires confirmation for topology, return-edge, assignment, deletion, ID, and attachment-removal changes.
- Produces one deterministic, self-contained HTML file that runs directly through file:// on modern Chromium, Firefox, and WebKit/Safari-class browsers.
- Works offline for core editing, AML import/export, Excel import, workspace operations, and deterministic assistant answers.
- Makes network requests only for explicitly reviewed and consented BYOK AI actions.
- Passes source-accounting, visual-fidelity, AnimalWF, browser, performance, security, and release gates.

EXECUTION PROTOCOL

1. Read the entire plan before implementing anything.
2. Inspect repository status, branches, remotes, workflows, dependencies, tests, and applicable instructions.
3. Preserve all unrelated user changes.
4. Create a phase checklist from every phase and exit gate in aris_transformation.md.
5. Keep exactly one phase in progress.
6. Implement phases in the documented order.
7. Do not skip a phase because it is difficult, lengthy, or currently failing.
8. Do not reduce scope, rewrite acceptance criteria, or substitute a prototype for the specified product.
9. Repository truth may change file paths or implementation details, but not intended behavior or acceptance criteria.
10. If an existing implementation is better than the plan’s suggested internal structure, retain it only when it satisfies every required behavior and test. Record the evidence.
11. At each major phase:
    a. Inspect the relevant existing code and tests.
    b. Implement the smallest complete architectural slice.
    c. Add or update unit, integration, and browser tests.
    d. Run the targeted tests.
    e. Run broader regression tests appropriate to the risk.
    f. Verify the phase’s exit gate.
    g. Inspect the complete diff for accidental or unrelated changes.
    h. Regenerate the canonical single-file HTML for product-code changes.
    i. Verify the generated HTML is current and deterministic.
    j. Commit the completed phase with a focused message.
    k. Update the phase checklist and continue immediately.
12. Send concise progress updates at major milestones, failures, and changes of approach. Do not narrate routine commands.
13. Do not stop after planning, scaffolding, parser creation, an MVP, a partial importer, or one working model. Continue until the full definition of done is satisfied or a genuine external blocker remains.

AUTONOMY AND AUTHORIZATION

You are authorized to:

- Read and edit all in-scope repository files.
- Create and switch the branches specified by the plan.
- Run builds, tests, linters, type checks, browser tests, security checks, and local validation.
- Create focused local commits.
- Push the implementation branch when credentials and repository policy permit.
- Perform the merged-branch cleanup explicitly listed in the plan after rechecking exact ancestry.
- Update the in-scope GitHub workflow and trial-protection configuration specified by the plan when the available tools and credentials permit.
- Generate and track the canonical release HTML.
- Add dependencies only when necessary, browser-compatible, security-reviewed, and compatible with one-file distribution.

Before any destructive or external mutation:

- Resolve the exact target with read-only checks.
- Verify branch ancestry again immediately before deletion.
- Never delete archive/full-product-v0.4.4.
- Never delete tags or existing releases.
- Never force-push.
- Never overwrite imported AML.
- Never commit private AnimalWF XML, user PDFs/PNGs, API keys, credentials, or proprietary ARIS assets.
- Do not merge into main or create a stable release tag until every required release gate passes.

IMPLEMENTATION INVARIANTS

- The original imported AML/XML is immutable.
- Unknown ARIS content is retained and accounted for.
- No source record may disappear silently.
- All edits use validated, atomic, undoable commands.
- Failed validation rolls back the entire transaction.
- Generated and imported models retain provenance.
- ARIS definition and occurrence identities remain distinct.
- Existing IDs are preserved.
- New IDs are collision-safe and ARIS-compatible.
- Connection labels remain optional.
- Explicit XOR and return cycles are preserved.
- Missing return edges require confirmation.
- AI never emits or directly writes raw AML IDs/XML.
- AI output passes schema, semantic, reference, and transaction validation before application.
- Safe AI field changes may auto-apply only under the policy in the plan.
- Startup performs no network requests.
- API keys are never bundled or exported.
- All workers, schemas, templates, fonts, icons, scripts, and styles are embedded in the final HTML.
- The production dependency graph must contain no BPMN runtime.
- Every product-code push includes the current canonical artifact:
  release/OrbitPM-ARIS-Studio-Lite.html

VALIDATION DISCIPLINE

Do not treat a command’s successful exit or a patch tool’s “Done” response as proof that behavior works.

For every phase:

- Inspect the resulting files.
- Run the relevant tests.
- Exercise the real user path where practical.
- Confirm state and output rather than inferring success.
- Compare source/accounting counts.
- Check original-file digests.
- Inspect browser console errors.
- Check unexpected network traffic.
- Verify undo/redo and rollback.
- Verify the exact generated HTML rather than only the development server.

For AnimalWF changes, repeatedly execute the required import → account → render → screenshot → measure → inspect → fix → regression cycle across all eight models. Do not optimize one model by regressing another.

Use sanitized committed fixtures for automated tests and the private local AnimalWF export only for local full-data acceptance. Never publish private source content.

BLOCKERS AND EXTERNAL INPUTS

Some final gates require user-provided or externally controlled inputs, including:

- The matching AML/XML plus ARIS PDF/PNG visual golden pair.
- Access to the target ARIS environment for the real import/re-export smoke test.
- Credentials or permissions for GitHub settings, pushes, deployments, or releases.

If one of these is unavailable:

1. Do not declare the goal complete.
2. Complete every independent phase and acceptance check that does not require it.
3. Prepare the exact commands, comparison tooling, fixtures, and checklist needed to consume it immediately when supplied.
4. Record the exact missing input, why it blocks a specific gate, and what has already been completed.
5. Keep the goal active and resume from that gate when the input becomes available.
6. Do not use an external blocker as a reason to stop unrelated implementation work.

RELEASE RULE

Routine trial pushes must not wait for comprehensive CI, but they must include the current deterministic canonical HTML and relevant local targeted verification.

Run the full comprehensive suite only for the manually initiated release candidate.

Do not create the stable tag or claim ARIS compatibility until:

- Every phase and exit gate passes.
- AnimalWF accounting reports zero unaccounted records.
- All eight AnimalWF models are editable and naturally laid out.
- The visual golden comparison passes or has explicitly accepted external-resource gaps.
- The real ARIS import/re-export smoke test passes.
- The exact canonical HTML passes all browser, security, performance, source-identity, and release-candidate checks.

FINAL RESPONSE REQUIREMENTS

Only report completion when every stable definition-of-done item is genuinely satisfied.

The completion report must include:

- Final branch and commit SHA.
- Implemented phase summary.
- Important architectural decisions.
- Tests and browser matrices run, with results.
- AnimalWF accounting totals and layout results.
- Original-source preservation evidence.
- ARIS import/re-export evidence.
- Visual golden comparison evidence.
- Canonical HTML path, size, and SHA-256.
- GitHub workflow/protection/branch cleanup results.
- Remaining limitations, if any.
- Explicit confirmation that no required work remains.

Do not ask “should I continue?” between phases. Continue autonomously while safe in-scope work remains.
