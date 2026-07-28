// The BPMN-editor browser suites (canvas UX, autosize triggers, viewer
// interactions, process outline, i18n/RTL canvas) were removed with the BPMN UI
// in plan §5.3 — they drove a `.djs-container` canvas the ARIS shell no longer
// mounts. ARIS replacements land with the native modeler.
export const REQUIRED_BROWSER_SUITES = Object.freeze([
  'tests/e2e/details-responsive.spec.ts',
  'tests/e2e/lite-aml-naming.spec.ts',
  'tests/e2e/lite-assistant.spec.ts',
  'tests/e2e/lite-company-docs.spec.ts',
  'tests/e2e/lite-csp-runtime.spec.ts',
  'tests/e2e/lite-live-cors.spec.ts',
  'tests/e2e/lite-mandatory-ai-security.spec.ts',
  'tests/e2e/lite-mandatory-reliability.spec.ts',
  'tests/e2e/lite-mandatory-spreadsheet.spec.ts',
  'tests/e2e/lite-mandatory-translation.spec.ts',
  'tests/e2e/lite-org.spec.ts',
  'tests/e2e/lite-panes-details.spec.ts',
  'tests/e2e/lite-providers.spec.ts',
  'tests/e2e/lite-smoke.spec.ts',
  'tests/e2e/lite-spreadsheet.spec.ts',
  'tests/e2e/lite-subprocess-tree.spec.ts',
  'tests/e2e/lite-validation.spec.ts'
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
