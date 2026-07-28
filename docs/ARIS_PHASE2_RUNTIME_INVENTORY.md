# ARIS Phase 2 runtime inventory

Captured on Tuesday, July 28, 2026 from `feat/aris-only-studio`.

This inventory records the current BPMN runtime surface that Phase 2 must replace or delete before the branch can satisfy the ARIS-only shell exit gate.

## Primary production entry points

- [src/main.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/main.tsx)
  - now mounts `ArisApp`
- [src/App.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/App.tsx)
  - legacy BPMN composition root
  - still imports the BPMN-backed editor shell and BPMN-centric workspace/import flows, but is no longer the production mount path
- [src/ArisApp.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/ArisApp.tsx)
  - new ARIS-only production shell
  - preserves workspace picker, settings, AI surfaces, assistant drawer, and language controls without mounting `EditorTabLite`

## BPMN runtime and editor shell currently active

- [src/editor/EditorTabLite.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/editor/EditorTabLite.tsx)
  - imports `bpmn-js`, `bpmn-js-properties-panel`, BPMN properties panel CSS, palette behavior, and BPMN editing services
- [src/editor/embeddedDiagramControls.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/editor/embeddedDiagramControls.ts)
  - patches palette, minimap, and properties panel behavior around the BPMN canvas
- [src/editor/paletteDrag.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/editor/paletteDrag.ts)
  - BPMN palette-specific DOM handling
- [src/editor/langToggle.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/editor/langToggle.ts)
  - still mutates BPMN names/properties directly
- [src/org/*](/home/ahmed/Desktop/bpmn_tool/desktop/src/org)
  - details, semantics, highlighting, and rendering helpers remain coupled to BPMN element types and moddle-backed properties

## BPMN import, validation, and conversion surface still active

- [src/workspace/importDrop.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/workspace/importDrop.ts)
  - now accepts `.aml`, `.apc`, and `.xml`, while still seeing `.bpmn` so the app can reject it explicitly
- [src/workspace/importTransaction.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/workspace/importTransaction.ts)
  - still converts AML into reviewed BPMN artifacts
  - still uses BPMN validation and reviewed-BPMN ingestion as the import apply path
- [src/validation/*](/home/ahmed/Desktop/bpmn_tool/desktop/src/validation)
  - centered on BPMN XSD, BPMN lint, BPMN validation summaries, and BPMN source diff/review
- [src/workspace/reviewedBpmn.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/workspace/reviewedBpmn.ts)
  - reviewed BPMN boundary remains a core import contract

## User-visible BPMN identity still active

- [src/i18n/dictionaries.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/i18n/dictionaries.ts)
  - still contains `OrbitPM Process Studio Lite` product identity and many BPMN-specific labels
- [src/workspace/WorkspacePickerLite.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/workspace/WorkspacePickerLite.tsx)
  - fallback actions still create/open BPMN artifacts
- [src/workspace/EmptyWorkspaceCard.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/workspace/EmptyWorkspaceCard.tsx)
  - still points the empty-state flow at “create first process” in the BPMN workspace model
- [src/App.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/App.tsx)
  - hidden file inputs still include `.bpmn` because the app must reject detected BPMN explicitly during the transition

## Production dependencies to remove later in Phase 2

Current `package.json` production dependencies still include:

- `@bpmn-io/properties-panel`
- `bpmn-auto-layout`
- `bpmn-js`
- `bpmn-js-bpmnlint`
- `bpmn-js-create-append-anything`
- `bpmn-js-properties-panel`
- `bpmn-moddle`
- `bpmnlint`

These cannot be removed until the ARIS shell path replaces the BPMN editor/runtime imports.

## Immediate Phase 2 work already completed

- Added an explicit Phase 2 checklist in [ARIS_PHASE_CHECKLIST.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE_CHECKLIST.md)
- Updated the import boundary to:
  - accept `.aml` alongside `.apc` and `.xml`
  - reject detected BPMN input non-destructively with the ARIS-only message
- Switched the production renderer from `App` to `ArisApp`
- Added a placeholder ARIS source shell that:
  - opens `.aml`, `.apc`, and generic `.xml` sources without converting them into BPMN runtime state
  - keeps settings, assistant, workspace picker, folder switching, and embedded AI reachable from the new shell
  - surfaces exact source bytes, hash, and content while the native ARIS modeler is still pending

## Next implementation slice

Finish Phase 2 cleanup around the new shell:

- remove or rename the remaining BPMN-first user-visible labels still reused by shared retained UI
- verify the ARIS shell behavior through the remaining import/open paths, including `file://`
- delete BPMN production dependencies only after `App`/editor-only imports are fully outside the production graph
