// The BPMN-editor browser suites (canvas UX, autosize triggers, viewer
// interactions, process outline, i18n/RTL canvas) were removed with the BPMN UI
// in plan §5.3 — they drove a `.djs-container` canvas the ARIS shell no longer
// mounts. `aris-i18n-rtl.spec.ts` and `aris-accessibility.spec.ts` are the ARIS
// shell's own English/Arabic and keyboard/focus-management characterizations;
// the process-outline suite still awaits an ARIS replacement as the native
// modeler's editing surface lands (see UI-03 in
// mandatory-ui-accessibility-evidence.json, deliberately left unbound).
//
// `aris-authoring.spec.ts` and `aris-release-artifact.spec.ts` are the Phase 18
// (plan §21.3/§21.5) additions: the first covers the browser-matrix bullets that
// had no real-browser coverage at all (palette/context-pad authoring, the chat
// improvement loop, the local assistant, the derived export, the Excel template
// round trip); the second runs the EXACT release artifact over file:// under all
// three Playwright engines, which `scripts/aris-file-smoke.mjs` cannot do
// because it launches Chromium directly.
//
// Phase 18 (BPMN e2e retirement, plan §5.3/§21.3) found the remaining
// `lite-*.spec.ts` suites still booted the removed BPMN UI ("OrbitPM Process
// Studio Lite" heading, "New blank diagram"/"New process" dialogs, the
// `.djs-container` canvas, the multi-.bpmn-file folder-workspace catalog).
// `lite-providers.spec.ts` was already retargeted to the ARIS shell as the
// precedent; `lite-live-cors.spec.ts` was retargeted the same way (same
// Settings — AI keys dialog, boots via importing the real reference AML
// export instead of opening a blank BPMN diagram). `lite-csp-runtime.spec.ts`
// never depended on the BPMN UI and needed no changes.
//
// Retired outright (deleted, not retargeted) because their entire subject was
// BPMN-canvas- or BPMN-folder-workspace-specific and has no ARIS-native
// equivalent: `lite-assistant.spec.ts` (superseded by `aris-authoring.spec.ts`'s
// local-assistant coverage and `aris-accessibility.spec.ts`'s assistant
// focus-trap/Escape test), `lite-org.spec.ts` (DMT Hub owner/CC styling painted
// onto the deleted BPMN canvas), `lite-panes-details.spec.ts` (the old Lite
// "Step details" badge/amber-ring pane bound to `window.__ORBITPM_LITE__`'s
// bpmn-js modeler — the ARIS details rail has no open/close/resize/persist
// mechanic today to retarget against), `lite-company-docs.spec.ts` and
// `lite-subprocess-tree.spec.ts` (the multi-`.bpmn`-file folder-workspace
// catalog/call-activity concept ARIS's single-AML-source model doesn't have),
// `lite-spreadsheet.spec.ts` (the old spreadsheet-to-BPMN pipeline, superseded
// by ARIS's native Excel workbook layer), `lite-validation.spec.ts` (the BPMN
// XML "generated layout review" dialog — ARIS rejects BPMN input rather than
// validating/laying it out), `lite-aml-naming.spec.ts` (the old AML→BPMN
// gateway-name normalizer; ARIS renders AML natively via a different code
// path, not a BPMN conversion), and `lite-smoke.spec.ts` (bpmn-js rendering,
// bpmn.io attribution, the BPMN "New process" modal/palette, and the old
// `AiPanelLite` provider note — all superseded or gone).
//
// `aris-sequence-1.spec.ts` is the Wave-7 addition (plan §21.x): it drives the
// new "Export PDF" toolbar action end to end over a loopback HTTP origin —
// import the AnimalWF AML, export each iterate model to PDF, rasterize both the
// export and ARIS's own reference PDF through the same `pdftoppm` engine and
// assert their ink STRUCTURE agrees, then re-export the derived AML and prove
// the round trip keeps the two matched models structurally identical (the same
// 0-diff budget the `*.animalwf.test.ts` baselines enforce). Like every other
// browser suite here it reads the private `reference/AnimalWF` export and so
// runs only where that fixture is present.
//
// `details-responsive.spec.ts` (no `lite-` prefix, so it escaped the Phase 18
// inventory that scanned `tests/e2e/lite-*.spec.ts`) was found during this
// same retirement pass to be equally dead: both its tests boot through
// `getByRole('button', { name: /New process/i })` into a `.djs-container`
// bpmn-js canvas and read the `orbitpm.lite.preferences.v1.details.open`
// localStorage key — the same removed BPMN Lite "Step details" pane
// `lite-panes-details.spec.ts` drove, with no ARIS open/close/resize/persist
// mechanic to retarget against. It was last touched at pre-ARIS commit
// 83d1116 and never updated for the ARIS rewrite. Retired for the same
// reason as `lite-panes-details.spec.ts`; see UI-01/UI-05/UI-06 in
// mandatory-ui-accessibility-evidence.json for the resulting evidence impact.
export const REQUIRED_BROWSER_SUITES = Object.freeze([
  'tests/e2e/aris-accessibility.spec.ts',
  'tests/e2e/aris-authoring.spec.ts',
  'tests/e2e/aris-canvas-interaction.spec.ts',
  'tests/e2e/aris-details-editing.spec.ts',
  'tests/e2e/aris-details-rail.spec.ts',
  'tests/e2e/aris-explorer-tree.spec.ts',
  'tests/e2e/aris-fidelity-screenshots.spec.ts',
  'tests/e2e/aris-headless-parity.spec.ts',
  'tests/e2e/aris-i18n-rtl.spec.ts',
  'tests/e2e/aris-import-split.spec.ts',
  'tests/e2e/aris-nested-processes.spec.ts',
  'tests/e2e/aris-new-model.spec.ts',
  'tests/e2e/aris-rail-tools.spec.ts',
  'tests/e2e/aris-release-artifact.spec.ts',
  'tests/e2e/aris-sequence-1.spec.ts',
  'tests/e2e/aris-validation.spec.ts',
  'tests/e2e/lite-csp-runtime.spec.ts',
  'tests/e2e/lite-live-cors.spec.ts',
  'tests/e2e/lite-mandatory-ai-security.spec.ts',
  'tests/e2e/lite-mandatory-reliability.spec.ts',
  'tests/e2e/lite-mandatory-spreadsheet.spec.ts',
  'tests/e2e/lite-mandatory-translation.spec.ts',
  'tests/e2e/lite-providers.spec.ts'
])

function requirementIds(prefix, count) {
  return Object.freeze(
    Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`)
  )
}

export const MANDATORY_BROWSER_EVIDENCE = Object.freeze([
  Object.freeze({
    bundle: 'reliability',
    evidencePath: 'tests/e2e/mandatory-reliability-evidence.json',
    requiredRequirementIds: requirementIds('REL', 11)
  }),
  Object.freeze({
    bundle: 'translation',
    evidencePath: 'tests/e2e/mandatory-translation-evidence.json',
    requiredRequirementIds: requirementIds('TR', 10)
  }),
  Object.freeze({
    bundle: 'spreadsheet',
    evidencePath: 'tests/e2e/mandatory-spreadsheet-evidence.json',
    requiredRequirementIds: requirementIds('XLS', 10)
  }),
  Object.freeze({
    bundle: 'ui-accessibility',
    evidencePath: 'tests/e2e/mandatory-ui-accessibility-evidence.json',
    requiredRequirementIds: requirementIds('UI', 9)
  }),
  Object.freeze({
    bundle: 'ai-security',
    evidencePath: 'tests/e2e/mandatory-ai-security-evidence.json',
    requiredRequirementIds: requirementIds('AI', 10)
  })
])
