# Spreadsheet import implementation

This directory contains the production, deterministic Excel/CSV import path for
OrbitPM 0.4.5.

The browser worker uses the exactly pinned packages:

- `read-excel-file@9.3.4`
- `papaparse@5.5.4`
- `@types/papaparse@5.5.2` for development

`fflate@0.8.3` performs bounded, selective OPC entry extraction only after
`preflightXlsx()` accepts the central directory.

## Production flow

1. `validateSpreadsheetInput()` accepts only macro-free `.xlsx` and UTF-8
   `.csv` within the 20 MiB compressed-input limit.
2. `preflightXlsx()` rejects encryption, macros/executable parts, unsafe paths,
   malformed archives, unsupported compression, ZIP64/multi-disk content, and
   declared expansion beyond the limits before decompression.
3. `BrowserXlsxParserAdapter` or `BrowserCsvParserAdapter` transfers bytes to a
   cancelable inline Web Worker. XLSX uses `read-excel-file/web-worker`; CSV
   uses Papa Parse worker-side and returns strings only.
4. The worker preserves displayed/cached cell values and formula metadata.
   Formulas are never evaluated. Missing cached results are blocking findings.
5. Official template detection selects the versioned preset. Other workbooks
   use header suggestions plus explicit mapping confirmation.
6. Mapping drafts and versioned presets are validated before browser-local
   persistence or import/export. Presets contain mappings, not workbook data or
   credentials.
7. `buildProcessWorkbookModel()` creates the graph and source-cell provenance.
   The read-only inference plan exposes proposed IDs, events, and flows before
   confirmation.
8. Shared bilingual and workbook validation block generation while required
   findings remain.
9. `generateBpmnArtifact()` converts the graph through `bpmn-moddle`, the
   shared OrbitPM metadata contract, layout, and release validation.
10. `prepareTransactionalImportPlan()` generates and checks every artifact
    before destination writes. `executeTransactionalImportPlan()` applies the
    reviewed collision policy and produces a committed or rolled-back report.

## Safety and scale limits

- 20 MiB compressed input
- 100 MiB total declared XLSX uncompressed content
- 10,000 XLSX ZIP entries
- 25 worksheets
- 50,000 input rows
- 256 columns
- 500,000 non-empty cells
- 32,767 characters per cell
- 1,000 BPMN nodes per process
- 5,000 BPMN nodes per import transaction
- Readability warning above 250 nodes

`.xls`, `.xlsm`, `.xlsb`, password-protected workbooks, macros, ActiveX,
embedded executable parts, and non-UTF-8 CSV are rejected. External links and
data connections are ignored with warnings.

## Templates and release assets

`createOfficialWorkbookTemplates()` supplies byte-stable blank and example XLSX
downloads for the single-file application. Release assembly materializes the
same bytes as:

- `OrbitPM-Excel-Template-0.4.5.xlsx`
- `OrbitPM-Excel-Example-0.4.5.xlsx`

The template writer fixes OPC entry order, timestamps, compression method, and
XML order. Tests pin SHA-256 digests and round-trip the example through
production parsing, official detection, graph construction, generation, and
validation.

For a local materialization:

```bash
npx vite-node src/spreadsheet/scripts/writeTemplates.ts dist/release-assets
```

Release assembly writes templates into its own new output directory; do not
mix `dist/release-assets` into the one-file runtime build.
