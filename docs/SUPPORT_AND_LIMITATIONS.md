# Support and limitations for 0.4.5

This document describes the 0.4.5 release candidate. Final support status
depends on the exact release artifact passing
[RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md).

## Browser and delivery support

The release plan targets Chrome, Edge, Firefox, and Safari/WebKit, but this
candidate does not yet make a blanket browser-version support claim. Support
will be limited to the exact browser and operating-system versions recorded in
the final file/Pages evidence. Previous-major compatibility has not yet been
tested and is not claimed by this document.

- Folder workspaces require the File System Access API and are intended
  principally for Chrome and Edge.
- Browser workspaces require OPFS. Availability and persistence policy vary by
  browser, profile, private mode, storage pressure, and device administration.
- Single-file mode works without a directory handle and downloads the result on
  save.
- The downloaded HTML is the offline distribution. Optional provider and free
  translation calls still require network access.
- GitHub Pages is a convenience host, not a storage or collaboration backend.

The final real-browser Pages smoke, exact release-HTML smoke, and complete
release-commit engine matrix are pending.

## Storage modes

| Mode              | Persistence                         | Multi-file features                      | Important caveat                                                         |
| ----------------- | ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Folder workspace  | User-selected directory             | Folders, catalog, links, backup, history | Browser permission can be revoked; directory support is browser-specific |
| Browser workspace | OPFS in the current browser profile | Folders, catalog, links, backup, history | Export backups; clearing site data or storage eviction can remove it     |
| Single file       | Explicit browser download           | One open document                        | No retained workspace; backup/history UI is multi-file-oriented          |

Directory and OPFS backups contain a manifest, SHA-256 checksums, empty folders,
all public workspace files, and `.orbitpm/history`. Import is preflighted and
offers collision choices. Browser-private provider keys, UI preferences, and
usage records are not exported.

### Session safety and residual boundaries

The production App uses one document-session controller. Ctrl/Cmd+S routes only
to the active session, dirty sessions install a `beforeunload` guard, and a
two-second debounced recovery journal also flushes on blur and `pagehide`.
Opening a document with a retained draft shows a comparison and offers restore,
discard, and recovery download choices.

Rename, move, and delete are session-aware transactions. Dirty affected
sessions receive Save and continue, Continue without saving, or Cancel choices;
portable history and staging/rollback protect durable files. External changes
receive compare, reviewed reload, explicitly confirmed overwrite, and save-as
choices.

Cross-tab coordination uses advisory BroadcastChannel leases and change
notifications. Expected-hash atomic writes remain the final authority if a
message is lost, a tab crashes, or a lease expires. IndexedDB provides durable
drafts when available; a visible warning accompanies the in-memory fallback,
which does not survive reload. Drafts are browser-private and do not replace
ordinary saves or exported backups.

## Supported inputs and exports

| Input or output | Support                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| BPMN            | `.bpmn` and BPMN-shaped `.xml`; UTF-8 or US-ASCII declarations                                    |
| ARIS            | Experimental `.apc` or AML-shaped `.xml`; best-effort EPC conversion with deterministic relayout  |
| Library archive | Bounded ZIP containing `.bpmn` and BPMN-shaped `.xml` entries                                     |
| Spreadsheet     | Macro-free `.xlsx` and UTF-8 `.csv`, including BOM and quoted multiline CSV                       |
| AI attachment   | Reviewed provider/model combinations for PDF or image; DOCX text extraction for description input |
| Export          | BPMN XML, SVG, PNG, deterministic raster-backed PDF, library ZIP, and workspace backup ZIP        |

ISO-8859-1 and other declared XML encodings must be converted to UTF-8 before
import. `.xls`, `.xlsm`, `.xlsb`, password-protected workbooks, ZIP64,
multi-disk archives, macros, ActiveX, and embedded executable parts are
rejected. Spreadsheet formulas are not executed: a cached displayed value is
imported with a warning, while a formula without a cached value blocks import.
External links and data connections are ignored with warnings.

Spreadsheet limits are 20 MiB compressed input, 100 MiB declared XLSX
expansion, 25 sheets, 50,000 rows, 256 columns, 500,000 non-empty cells, 32,767
characters per cell, 1,000 BPMN nodes per process, and 5,000 nodes per import
transaction. Diagrams above 250 nodes receive a readability warning.

Explicit BPMN/XML/ARIS picker reads are capped at 20 MiB per source before
allocation. A workspace import accepts at most 2,500 sources and 50 MiB total
source bytes. Library ZIP, DOCX, spreadsheet, and backup pickers likewise check
`File.size` before reading and then verify the returned byte length.

## BPMN and localization behavior

- XML is checked by layered validation. Invalid XML cannot be applied.
- Semantic blockers require explicit draft-save confirmation; generated and
  imported output cannot be committed with blocking findings.
- Missing DI can be laid out only after an explicit repair decision and exact
  output revalidation. The required rendered before/after visual preview is
  still a release blocker.
- Unknown extension content is compared before normalized XML replaces the
  source. A preservation failure blocks the replacement.
- English/Arabic validity is script-aware. A nonblank target is not considered
  translated merely because it exists.
- Switching diagram language does not invoke the network. Missing or invalid
  targets open a review.
- Translation review can project only complete valid results automatically;
  partial preview is explicit and provider failures remain visible.
- Directory and OPFS workspaces load an editable
  `.orbitpm/i18n/glossary.json` and accepted
  `.orbitpm/i18n/translation-memory.json`. Settings writes use expected-hash
  conflict checks. Single-file mode uses the reviewed built-in resources and
  does not create public workspace localization files.

## AI and translation support

The browser-callable AI providers are OpenRouter, Anthropic, and Google Gemini.
Unknown custom OpenRouter or Gemini model IDs remain text-only until their
attachment capability is reviewed. Direct custom endpoints and direct OpenAI,
Azure, DeepSeek, Moonshot, or GLM vendor connections are not supported by Lite;
compatible models may be selected through OpenRouter.

Provider availability, model IDs, pricing, rate limits, CORS behavior, and
terms can change independently of OrbitPM. See [AI_AND_COSTS.md](AI_AND_COSTS.md)
and [PRIVACY.md](PRIVACY.md).

## Accessibility boundary

The candidate includes localized landmarks, dialogs, responsive panes, a
persistent Details control, and a keyboard-oriented outline as an alternative
to pointer-only canvas authoring. Automated axe checks do not prove complete
WCAG conformance or screen-reader usability.

Manual NVDA/Windows, VoiceOver/macOS, Arabic language switching, and
mixed-language pronunciation checks have not been performed for the final
candidate. No WCAG 2.2 AA conformance claim should be made until those checks
and the final automated matrix pass.

## Out of scope

0.4.5 does not provide cloud collaboration, users/roles, server-side storage,
workflow execution, simulation, DMN/forms, native installers, automatic desktop
migration, or a self-hosted provider proxy.
