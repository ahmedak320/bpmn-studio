# ARIS transformation phase checklist

Authoritative source: [aris_transformation.md](/home/ahmed/Desktop/bpmn_tool/desktop/aris_transformation.md)

Status as of 2026-07-28 on `feat/aris-only-studio`:

- Phase 0 — complete
- Phase 1 — complete
- Phase 2 — in progress
- Phases 3–18 — pending
- Stable definition of done — pending

## Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| 0. Establish branch and immutable baselines | Complete | [ARIS_PHASE0_BASELINE_2026-07-28.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE0_BASELINE_2026-07-28.md) |
| 1. Freeze retained infrastructure before removing BPMN | Complete | [ARIS_PHASE1_CHARACTERIZATION.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE1_CHARACTERIZATION.md), `npm run test:aris:phase1` |
| 2. Replace product shell and remove BPMN runtime | In progress | [ARIS_PHASE2_RUNTIME_INVENTORY.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE2_RUNTIME_INVENTORY.md) |
| 3. Secure lossless AML input layer | Pending | Not started |
| 4. Immutable source packages and workspace revisions | Pending | Not started |
| 5. Native ARIS working model and command system | Pending | Not started |
| 6. Author ARIS canvas and object rendering | Pending | Not started |
| 7. Definitions/occurrences/connections mapping | Pending | Not started |
| 8. Validation, accounting, and unsupported-content surfacing | Pending | Not started |
| 9. Product identity, packaging, and shell completion | Pending | Not started |
| 10. Rich metadata, details panel, and attachments | Pending | Not started |
| 11. EPC semantics, XOR, return paths, and clean layout | Pending | Not started |
| 12. Create from the ARIS Excel template | Pending | Not started |
| 13. Create with AI from description, DOCX, PDF, and picture | Pending | Not started |
| 14. Folder-aware ARIS process assistant | Pending | Not started |
| 15. Chat improvement and missing-information completion | Pending | Not started |
| 16. AnimalWF full-data and natural-layout loop | Pending | Not started |
| 17. Visual golden pair and ARIS import/re-export | Pending | Not started |
| 18. Release-quality tests, performance, and publication | Pending | Not started |

## Current Phase 2 exit-gate progress

- [x] ARIS-only input boundary started: `.aml` is accepted; detected BPMN input is rejected non-destructively.
- [x] Production entry now mounts an ARIS-specific shell instead of the BPMN `App` composition root.
- [x] ARIS shell loads through `file://` from the rolling artifact at `release/OrbitPM-ARIS-Studio-Lite.html`.
- [x] Settings, AI tabs, assistant, workspace picker, language, and theme still work under the new ARIS shell.
- [ ] BPMN input is rejected non-destructively across all remaining import paths.
- [x] Production dependency graph contains no BPMN runtime.

## Current blocker profile

No external blocker yet for the active implementation phase. The remaining work is internal:

- remove the BPMN editor shell without regressing retained infrastructure;
- finish the remaining BPMN rejection coverage in review-driven import paths still owned by the legacy `App` shell;
- continue deleting legacy BPMN shell code now that the shipped ARIS artifact no longer depends on it.
