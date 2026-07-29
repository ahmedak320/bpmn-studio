# ARIS Phase 1 Characterization Suite

This document pins the retained infrastructure named in Phase 1 of [aris_transformation.md](/home/ahmed/Desktop/bpmn_tool/desktop/aris_transformation.md) before BPMN-specific runtime removal starts.

Run it with:

- `npm run test:aris:phase1`

Coverage map:

| Phase 1 requirement                | Current characterization coverage                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No-key assistant local answer      | `src/assist/__tests__/answerLocal.test.ts`                                                                        |
| AI privacy preview and consent     | `src/ai/__tests__/requestPrivacy.test.ts`, `src/assist/__tests__/requestReview.test.ts`                           |
| Request cancellation               | `src/assist/__tests__/AssistantDrawer.interviewCancellation.test.tsx`, `tests/e2e/lite-i18n-rtl.spec.ts`          |
| Provider/model selection           | `src/ai/__tests__/providerSelection.test.ts`, selected provider UI checks from `tests/e2e/lite-providers.spec.ts` |
| Encrypted key behavior             | `src/ai/__tests__/keys.test.ts`, `src/ai/__tests__/keys.crossTab.test.ts`                                         |
| DOCX parse and cancellation        | `src/ai/__tests__/docx.test.ts`                                                                                   |
| PDF/image size gates               | `src/ai/__tests__/pdf.test.ts`, selected PDF no-key gate check from `tests/e2e/lite-providers.spec.ts`            |
| Spreadsheet preflight              | `src/spreadsheet/xlsxPreflight.test.ts`                                                                           |
| Folder/portable workspace behavior | `src/workspace/adapters/__tests__/directory.test.ts`, `src/workspace/adapters/__tests__/portableModes.test.ts`    |
| Single-file `file://` startup      | `scripts/file-smoke.mjs dist/index.html`                                                                          |
| English/Arabic dialog behavior     | `tests/e2e/lite-i18n-rtl.spec.ts`                                                                                 |

The Phase 0 baseline already established that the current full AnimalWF import review is blocked by downstream BPMN validation rules rather than AML parsing failure. This suite therefore focuses on the retained non-BPMN infrastructure that must survive the ARIS rewrite.
