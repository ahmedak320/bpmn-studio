# Spreadsheet core integration

This directory is the deterministic, offline Excel/CSV import core for OrbitPM
0.4.5. Production code here has **no third-party runtime dependency**. It uses
only `TextEncoder`, `TextDecoder`, typed arrays, and `AbortSignal`.

## Packages to pin in the application integration

Versions checked from the npm registry on 2026-07-26:

- `read-excel-file@9.3.4`
- `papaparse@5.5.4`
- `@types/papaparse@5.5.2` (development only)

`read-excel-file` includes its own TypeScript declarations. The existing
`fflate@0.8.3` may be reused by the worker for selective OPC/XML inspection
*after* `preflightXlsx()` succeeds; the security boundary does not inflate ZIP
entries.

## Required wiring order

1. Validate the extension/20 MB boundary with `validateSpreadsheetInput()`.
2. CSV: implement `CsvParserAdapter` with Papa Parse in a Web Worker and call
   `parseCsvWorkbookBoundary()`. Set Papa's worker mode, return strings only,
   forward progress, and terminate on the supplied abort signal.
3. XLSX: implement `XlsxParserAdapter` with the
   `read-excel-file/web-worker` export (`read-excel-file/browser` only when
   parsing off the UI thread is otherwise guaranteed) and call
   `parseXlsxBoundary()`. The adapter
   must return displayed/cached values only. It must also populate `formula`,
   `cachedValuePresent`, and custom properties from selectively inspected OPC
   XML; never evaluate formulas, connections, or external links.
4. Call `detectOfficialTemplate()`. For an official workbook use
   `officialTemplatePreset()`; otherwise drive the mapping wizard with
   `suggestHeaderMappings()`, `mappingConfirmationIssues()`, and
   `headerSignature()`.
5. Export/import presets only through `serializeMappingPreset()` and
   `parseMappingPresetJson()`. Persist an in-progress `MappingDraft` through an
   application-owned browser-private `MappingDraftStore`.
6. Build the graph with `buildProcessWorkbookModel()`, then show
   `createGraphInferencePlan()` as a read-only preview. Do not call
   `applyGraphInferencePlan()` until synthetic Start/End events are confirmed.
7. Run `validateProcessWorkbookModel()` with destination process IDs and every
   parser/mapping issue. Reviews are blocking, not warnings.
8. Implement `SpreadsheetBilingualAuditAdapter` with the shared offline
   localization audit. An incomplete audit blocks generation and is the handoff
   to the explicit translation-consent workflow.
9. Implement `BpmnModelGenerationAdapter` with `bpmn-moddle`, the shared
   OrbitPM metadata writer, shared layout, and structural/XSD/lint/link/DI
   validators. The graph is not converted through the recursive AI IR.
10. Implement `ImportDestinationInspector` and
    `ImportTransactionFactory` with the workspace/session/history layer.
    `prepareTransactionalImportPlan()` generates every artifact before writes;
    `executeTransactionalImportPlan()` stages all files and commits once.
11. Download the stable JSON from `serializeSpreadsheetImportReport()` after
    every blocked, committed, or rolled-back result.

## Templates and release assets

`createOfficialWorkbookTemplates()` supplies byte-stable blank/example XLSX
downloads for the single-file app. Materialize the identical release assets
from the Lite repository root with:

```sh
npx vite-node src/spreadsheet/scripts/writeTemplates.ts dist/release-assets
```

Expected filenames:

- `OrbitPM-Excel-Template-0.4.5.xlsx`
- `OrbitPM-Excel-Example-0.4.5.xlsx`

The generator fixes OPC entry ordering, timestamps, compression method, and XML
ordering. Tests pin SHA-256 values and round-trip the example through official
detection, graph construction, and validation.
