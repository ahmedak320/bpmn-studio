# ARIS Studio Lite — Folder Tree & Nested Processes, Direct Editing & Symbols, Convention Alignment, Import Fidelity — Implementation Plan

> **For the orchestrator:** dispatch rules, model policy, worker routing, and the commit protocol live in `desktop/goal.md`. This file is the work ledger — its checkboxes are the single source of progress truth. Tick them in the same commit as the lane's code.
>
> **For workers:** you own ONLY the files your lane lists under "Files owned". If completing your lane seems to require touching any other file, STOP and report back — do not touch it. Every step uses checkbox (`- [ ]`) syntax. Never run mutating git commands (commit, push, stash, checkout, reset, branch, rebase). Run every verification command listed for your lane and report each exit code verbatim. Your final message is machine-consumed: return raw findings, file lists, and command results — no pleasantries. Everything you need is in THIS file — you do not need the source PDFs or any prior conversation.

**Goal:** Fix four product issues on `feat/aris-only-studio`: (1) a main-branch-exact folder tree with real files-in-folders on import/create and full nested-subprocess handling (marker, double-click drill-down, multi-level nesting, create-missing, rename/move link preservation); (2) immediate inline label editing on placement plus predetermined convention symbols with quick-pick variants; (3) alignment with the DMT ARIS Convention Manual (symbols, colors, connections, RACI, attributes, validation); (4) high-fidelity AML import validated against 4 reference process PDFs.

**Architecture:** Reuse the surviving main-branch machinery unchanged — `buildProcessHierarchy` + `FolderTreeLite` for the tree, `LinkPicker` for linking — feeding them new ARIS-native inputs (a model/assignment scanner + a span-slice AML splitter). Add an ARIS assignment marker + drill-down on the diagram-js canvas, an inline label editor via `diagram-js-direct-editing`, and a pure `src/aris/conventions/` catalog as the single source of truth for symbols/colors/connections/attributes. Nothing bpmn-flavored enters the runtime graph.

**Tech stack:** React 18.3, Vite 6, TypeScript 5.9, diagram-js 15.22 (generic), `diagram-js-direct-editing` 3.5.1 (added in Wave 1), vitest 3.2, Playwright 1.61. Browser SPA, single-file build. NOT Electron.

---

## Global Constraints

Every task's requirements implicitly include this section.

- Repo: `/home/ahmed/Desktop/bpmn_tool/desktop` (this directory IS the git root). Branch: `feat/aris-only-studio`. Remote: `https://github.com/ahmedak320/bpmn-studio.git`. Canonical artifact: `release/OrbitPM-ARIS-Studio-Lite.html`, rebuilt via `npm run build:aris` in every product commit (orchestrator's job).
- **Private reference assets live OUTSIDE the repo** under `/home/ahmed/Desktop/bpmn_tool/reference/` (reachable as `../reference/`), and are NEVER committed: `../reference/AnimalWF/ARISAMLExport.xml` (the AML fixture), `../reference/AnimalWF/pdf/*.pdf` (the 4 process printouts), `../reference/conventions/ARIS_Convention_Manual_DMT_v02.pdf` (the manual), `../reference/AnimalWF/expected/*.expected.json` (fidelity expectations authored in Wave 1). `.gitignore` already excludes `AnimalWF/`; nothing under `../reference/` is inside the worktree.
- **Gate commands** every lane runs before reporting done (plus lane-specific extras listed per lane):

  ```bash
  npm run typecheck && npm run lint && npm run check:aris-runtime-boundary && npm run check:ui-copy && npm run check:no-skips
  npx vitest run <lane's test paths>
  npx prettier --write <every file the lane touched>   # format:check is a CI gate
  ```

- **Runtime-boundary rules** (`scripts/check-aris-runtime-boundary.mjs` walks runtime imports from `src/main.tsx`; **type-only imports are exempt**; the ban list is `bpmn-*` packages **by name** plus specific graph paths): never runtime-import `src/App.tsx`, `src/editor/**` (deleted AND banned — port old concepts, never the code; read old code via `git show main:<path>`), `src/org/orbitpmModdle.ts`, `src/validation/ReadOnlyDiagramPreview.tsx`, or any `bpmn-*` package. `diagram-js-direct-editing` is NOT banned and is adopted as a real dependency in Lane C3.
- **i18n rules:** every user-visible string goes through `t()` with keys added to BOTH the `en` and `ar` maps in `src/i18n/dictionaries.ts` (identical key sets enforced by `src/__tests__/i18n.test.ts`; `ar` is typed `Record<keyof typeof en, string>` so parity is compile-enforced), or through `tk(key, 'English fallback')` from `src/aris/shell/shellI18n.ts` (shell only). All keys needed by Waves 1–3 are pre-registered by Lanes T4 (issue-1 + direct-edit) and C4 (issues 2/3), so downstream lanes never touch `dictionaries.ts`. Never hardcode English in JSX text/attributes (`title`, `aria-label`, `placeholder`) or in `pushToast`/`setStatus` calls — `check:ui-copy` blocks it.
- **Lint:** `--max-warnings 0`; `react-hooks/exhaustive-deps` is an ERROR — list every dependency.
- **No test games:** no `.skip`, `.only`, retries, quarantines, or inflated timeouts — `npm run check:no-skips` must stay green. Private-fixture suites use the `*.animalwf.test.ts` (or `*.holdout.animalwf.test.ts`) filename pattern with a throw-at-module-load guard (never a skip), run only via their dedicated npm scripts; `check-no-skips.mjs` exempts that filename pattern. Never name a helper matching a focused-test alias (e.g. anything reading as `fit(`).
- **Dblclick priority contract (binding across lanes):** the assignment-navigation handler (Lane T6) registers `element.dblclick` at **priority 2000** and returns `false` ONLY when it navigates; the direct-editing handler (Lane C3) registers at **priority 1500**. They must never collide.

### Authorized product changes

The user explicitly requested these; updating tests that assert the OLD behavior is **required work, not assertion-weakening**. Workers must NOT "fix" the product to satisfy old tests:

1. In multi-file (directory/OPFS) workspaces, importing an AML/XML **writes one `.aml` per model into folders** mirroring the AML `Group` hierarchy (behind a review dialog), instead of opening a single in-memory tab. (Single-file mode and the §7.3 package-store import path are UNCHANGED.)
2. `ArisModelExplorer` (the flat model list) renders **only when the active tab has more than one model**, instead of always stacking above the tree.
3. `buildBlankArisAml` mints a **unique `Model.ID` + `<GUID>`** per blank model instead of the fixed `Model.New`.
4. The palette is rebuilt from the conventions catalog: default-symbol entries keep their `create.ot_*` ids; new variant entries use `create.<objectType>.<symbolNum>`. Entry-count/action-id assertions are updated accordingly.
5. Canvas gains inline label editing, an assignment marker + double-click drill-down, and a "Link model…" toolbar action.

Tests that must stay green UNMODIFIED (single-file/package-store/reject paths): `ArisApp.test.tsx` cases 'rejects BPMN files at the top-level ARIS shell boundary', 'keeps accepting AML files during mixed import batches…', 'shows the §7.3 review before committing an import…', 'opens a blank model as an in-memory tab in the picker phase', and 'switches between the models of one export through the model explorer' (still valid for a >1-model tab).

---

## Embedded reference (workers use this instead of the PDFs)

### R1 — Convention symbol / color catalog (DMT ARIS Convention Manual + fixture)

Colors marked **[fixture]** are the exact `<Brush Color=…>` values observed in `ARISAMLExport.xml` (unpadded lowercase hex → prefix `#`, left-pad to 6). Others are **[manual]** (inferred from the manual's print palette) or **[unverified]** (must sit in the `VERIFY-AGAINST-REAL-ARIS-EXPORT` region). "Fixture symbol" = the exact `ST_*` seen on occurrences in the fixture.

| Object (EN label)             | objectType         | Default symbolNum                 | Fill      | Provenance          | Placeable     |
| ----------------------------- | ------------------ | --------------------------------- | --------- | ------------------- | ------------- |
| Function                      | `OT_FUNC`          | `ST_FUNC`                         | `#339900` | [fixture]           | yes (default) |
| System function               | `OT_FUNC`          | `ST_SYS_FUNC_ACT`                 | `#339900` | [fixture]           | variant       |
| Process interface             | `OT_FUNC`          | `ST_PRCS_IF`                      | `#c0c0c0` | [fixture symbol]    | variant       |
| Value-added chain             | `OT_FUNC`          | `ST_VAL_ADD_CHN_SML_1`            | `#339900` | [fixture]           | VACD only     |
| Event                         | `OT_EVT`           | `ST_EV`                           | `#dcbbed` | [fixture]           | yes           |
| AND rule                      | `OT_RULE`          | `ST_OPR_AND_1`                    | `#d5d5f7` | [fixture]           | yes           |
| OR rule                       | `OT_RULE`          | `ST_OPR_OR_1`                     | `#d5d5f7` | [manual]            | yes           |
| XOR rule                      | `OT_RULE`          | `ST_OPR_XOR_1`                    | `#d5d5f7` | [fixture]           | yes           |
| Entity type                   | `OT_ENT_TYPE`      | `ST_ENT_TYPE`                     | `#b6dce9` | [fixture]           | yes           |
| Information carrier (general) | `OT_INFO_CARR`     | `ST_INFO_CARR_1`                  | `#cccccc` | [manual]            | yes           |
| Info carrier: Document        | `OT_INFO_CARR`     | `ST_DOC`                          | `#cccccc` | [fixture]           | variant       |
| Info carrier: E-mail          | `OT_INFO_CARR`     | `ST_EMAIL_1`                      | `#cccccc` | [fixture]           | variant       |
| Info carrier: SMS             | `OT_INFO_CARR`     | `ST_INFO_CARR_HANDY`              | `#cccccc` | [fixture]           | variant       |
| Info carrier: Letter          | `OT_INFO_CARR`     | `ST_LETTER`                       | `#cccccc` | [unverified]        | variant       |
| Info carrier: Log             | `OT_INFO_CARR`     | `ST_LOG`                          | `#cccccc` | [unverified]        | variant       |
| Info carrier: e-file          | `OT_INFO_CARR`     | `ST_INFO_CARR_EDOC`               | `#cccccc` | [fixture]           | variant       |
| Business rule                 | `OT_BUSINESS_RULE` | `ST_BUSINESS_RULE`                | `#fde047` | [fixture symbol]    | yes           |
| Business policy               | `OT_POLICY`        | `ST_BUSINESS_POLICY`              | `#fb923c` | [fixture symbol]    | yes           |
| KPI / Measure                 | `OT_PERF`          | `ST_PERFORM`                      | `#2563eb` | [fixture symbol]    | yes           |
| Application system            | `OT_APPL_SYS`      | `ST_APPL_SYS`                     | `#000099` | [fixture]           | yes           |
| Data entity                   | `OT_ENT_TYPE`      | `ST_ENT_TYPE`                     | `#7f2020` | see note            | yes           |
| Requirement                   | `OT_REQUIREMENT`   | `ST_REQUIREMENT`                  | `#f7fee7` | [fixture symbol]    | yes           |
| External person/entity        | `OT_PERS`          | `ST_PERS_EXT`                     | `#d7c49d` | [fixture]           | yes           |
| Internal person               | `OT_PERS`          | `ST_PERS`                         | `#e6cf7a` | [manual]            | yes           |
| Role                          | `OT_PERS_TYPE`     | `ST_EMPL_TYPE`                    | `#d7c49d` | [fixture]           | yes           |
| Organizational unit           | `OT_ORG_UNIT`      | `ST_ORG_UNIT_1`                   | `#f59e0b` | [manual/unverified] | yes           |
| Position                      | `OT_POS`           | `ST_POS`                          | `#facc15` | [manual/unverified] | yes           |
| Group (org)                   | `OT_GRP`           | `ST_GRP_1`                        | `#a16207` | [manual/unverified] | yes           |
| Related entity                | `OT_PERS`          | `ST_PERS_EXT` (RE label)          | `#9ca3af` | [unverified]        | yes           |
| SLA                           | `OT_POLICY`        | `ST_BUSINESS_POLICY` (SLA label)  | `#dc2626` | [unverified]        | yes           |
| Law / Regulation              | `OT_POLICY`        | `ST_BUSINESS_POLICY` (Law label)  | `#dc2626` | [unverified]        | yes           |
| Risk                          | `OT_RISK`          | `ST_RISK_1`                       | `#dc2626` | [manual/unverified] | yes           |
| Product / Service             | `OT_SERVICE`       | `ST_SERVICE`                      | `#8b7355` | [unverified]        | yes           |
| Committee / Team              | `OT_ORG_UNIT`      | `ST_ORG_UNIT_1` (committee label) | `#f59e0b` | [unverified]        | yes           |
| Value-added chain (Start)     | `OT_FUNC`          | `ST_VAL_ADD_CHN_SML_1` (start)    | `#2f7d31` | [manual]            | VACD only     |

Data-entity note: the fixture encodes data entities as `OT_ENT_TYPE` occurrences colored dark red by authored brush; the catalog exposes a distinct "Data entity" palette entry mapped to `OT_ENT_TYPE`/`ST_ENT_TYPE` with default fill `#7f2020` and a distinct label key. C5 keeps the plain "Entity type" entry separately (`#b6dce9`).

`DEFAULT_STROKE = '#1a1a1a'` unless the manual specifies otherwise. Rules render as circles with the operator glyph (∧/∨/✕). All non-[fixture] rows are grouped under ONE `// VERIFY-AGAINST-REAL-ARIS-EXPORT` banner in `catalog.ts`.

### R2 — Connection types, canonical labels, RACI (manual)

| From → To                          | connectionType                    | Canonical label              | RACI               |
| ---------------------------------- | --------------------------------- | ---------------------------- | ------------------ |
| Function/Process-interface → Event | `CT_CRT_1`                        | creates/triggers             | —                  |
| Event → Function/Process-interface | `CT_ACTIV_1`                      | activates/triggers           | —                  |
| Event → Rule                       | `CT_IS_EVAL_BY_1`                 | is evaluated by              | —                  |
| Rule → Event                       | `CT_LEADS_TO_1` / `CT_LEADS_TO_2` | leads to/triggers            | —                  |
| Executor → Function                | `CT_EXEC_1`                       | (executes)                   | **R** [fixture]    |
| Executor → Function (2nd form)     | `CT_EXEC_2`                       | (executes)                   | **R** [fixture]    |
| Executor → Function                | `CT_DECID_ON`                     | decides on                   | **A** [unverified] |
| Executor → Function                | `CT_MUST_BE_CONSLT_ABT_1`         | must be consulted about      | **C** [unverified] |
| Executor → Function                | `CT_MUST_BE_INFO_ABT_1`           | must be informed about       | **I** [fixture]    |
| Application system → Function      | `CT_SUPP_3`                       | supports                     | —                  |
| Law/SLA → Function                 | `CT_MUST_BE_INFO_ABT_1`-family    | Regulate                     | —                  |
| Business policy → Function         | `CT_AFFECTS`                      | affects                      | —                  |
| Function → Product/Service         | `CT_HAS_OUT`                      | produces                     | —                  |
| Function → Data entity             | `CT_CRT_OUT_TO`                   | creates output to            | —                  |
| Data entity → Function             | `CT_IS_INP_FOR`                   | provides input for / INPUT   | —                  |
| VACD chain → chain                 | `CT_IS_PREDEC_OF_1`               | is predecessor of            | —                  |
| VACD chain → sub-chain             | `CT_IS_PRCS_ORNT_SUPER`           | is process-oriented superior | —                  |
| Org unit → sub-org unit            | (org)                             | is composed of               | —                  |
| Position → Org unit                | (org)                             | is organization manager for  | —                  |
| Position → Position                | (org)                             | is technical superior to     | —                  |
| Position → Internal person         | (org)                             | occupies                     | —                  |
| Position → Role                    | (org)                             | performs                     | —                  |
| Service → sub-service              | (svc)                             | encompasses                  | —                  |

Executor object types (a Function's R comes from one of these via `CT_EXEC_*`): `OT_ORG_UNIT`, `OT_POS`, `OT_GRP`, `OT_PERS_TYPE` (Role), `OT_PERS` (External/Internal). The existing `CONNECTION_RULES` triples in `src/aris/canvas/vocabulary.ts` are a subset and must be reproduced verbatim (existing tests depend on them).

### R3 — Attribute schema (manual)

- **Element (Function/VACD element):** `AT_ID` Identifier (Mandatory) e.g. `AWF.01.01`; `AT_DESC` Description/Definition (Optional); `AT_TIME_AVG_PRCS` Average Processing Time (Optional, "2.0 Day(s)"). Fixture also carries `AT_PROC_CODE` on occurrences (rendered under the box).
- **EPC model:** Process Objective, Process Scope, Entity, Authorized by, Relevant Organization Structure, Person Responsible (`AT_PERS_RESP` [fixture]), Version (`AT_VERSION`), Identifier (`AT_ID`), Process Area, Organization Name. Non-fixture rows are `unverified`.
- **Service tree L3:** + Service Fees ("AED 150" / "Free Service").
- Function naming is short/keyword-based; detail goes in Description.

### R4 — Per-model fidelity expectation summaries (from the 4 PDFs)

Fixture Model.IDs: Renew an Animal's profile = `Model.-1rUudxIp-wP-u-L` (AWF.01.01, 46 occ); Request to Register Animal Owner Profile = `Model.3xqe8yXO9Z7-u-L` (AWF.01.01, 94 occ); Animal Ownership Transfer between Citizens = `Model.3i-a2j4HRS3-u-L` (AWF.01.04, 78 occ); Animal Ownership Transfer between Citizens and Companies = `Model.-778f33baj6c-u-L` (AWF.01.04, 63 occ); VACD parent = `Model.-64xG-AFMIgg-u-L` (`MT_VAL_ADD_CHN_DGM`, 23 occ, 7 assignment chevrons).

Common layout law (all EPCs): vertical spine top→bottom; each Function carries its number in a small box on its bottom edge (`AT_PROC_CODE`/`AT_ID` occurrence label); Application-system (blue) / Data-entity (dark-red) / Info-carrier (gray) satellites stacked LEFT of the function with short horizontal connectors; executors (person/role) RIGHT with the connection captioned by its RACI letter (R/I seen); events between functions on the spine; XOR/AND circles at branch/join; parallel branches in side-by-side columns; loop-backs routed orthogonally around the right; yellow free-text notes; pink "Requirements" notes. The header band, Reference box, bottom legend, and RACI legend are PRINT-FRAME elements — the canvas reproduces diagram CONTENT only, not the print frame.

1. **Renew an Animal's profile** — 8 functions (01 Login to TAMM…, 02 Enter Owner Registration number, 03 Update Animal details profile…, 04 Review and submit the application, 05 Receive and approve the application [Pet Owner R], 06 Fill in required modifications, 07 Notify the Veterinary about the modification [System function, I], 08 Update the Animal registration application details); events: start "Animal profile renewal Service triggered", "Application submitted", "Application returned for amendments", "Registration details updated", end "Animal profile has been renewed"; 2 XOR gates; amendment loop back to 05; TAMM+Smart Hub app systems on most functions; data entities Owner Registration Number, Animal Profile Details, Animal Medical Record Details, Animal profile renewal application (×2), Comments on the application; info carrier "Email: Modification Request"; Requirements note "Pet Owner has been already registered"; Veterinary (R) on 01–04, 06, 08.
2. **Request to Register Animal Owner Profile** — 14 functions incl. 6+ System functions ("System check the eligibility…", "System verify residence details with Tawtheeq system", "System checks if the business is a registered entity" [DED System satellite], "System checks … activated the … service", "System terminate the service request…" ×2, "Auto approve the request…"); top XOR "Pet Owner is Business Entity" vs "Pet Owner is individual"; nested XOR trees on both branches; rejoin before 10 "Enter registration application details…"; tail XOR → approved/rejected/returned-for-modification with loop back to 10; UAE Pass/TAMM/Smart Hub/DED System app systems; SMS + E-mail info carriers on approval/rejection; yellow note "The owner registration number is valid for one month…"; Requirements note (age >18, Emirates ID…); Pet Owner (R/I) + Respective Municipality Registration Officer (org unit, R on 12).
3. **Animal Ownership Transfer between Citizens** (HOLDOUT — strict) — 11 numbered functions on a long spine (01 Login, 02 Fill the registration number…, 03 System notifies the owner… [SysFunc], 04 Authorise the Veterinary…, 05 Select the animal…, 06 Upload animal's medical report, 07 Enter the new owner registration number, 08 Retrieve the new owner details [SysFunc], Review and submit, Review and approve [New Pet Owner R]) → XOR → accepted (Accept the terms & conditions) / rejected (Notify Animal owner about the rejection [SysFunc] → "Request has been terminated") → **AND join** → 3 parallel ends (Generate ownership transfer number [SysFunc], Update Animal registration certificate, Notify Animal owner about the transfer completion [SysFunc]); yellow note top-left "Animal moved outside Abu Dhabi / Animal Deceased"; executors Veterinary/Pet Owner/New Pet Owner.
4. **Animal Ownership Transfer between Citizens and Companies** (HOLDOUT — own AML geometry; PDF 4 "Transfer of Pet Ownership" 2025 is a later redesign NOT in the export, directional reference only) — 63 occurrences; gate on the `<Model>` block topology + verbatim geometry, not on PDF 4.

### R5 — AML mechanics cheat-sheet (for the scanner & splitter)

- Document skeleton: `<AML>` → `Header-Info` → 2×`Language` → 6×`FontStyleSheet` → 69×`FFTextDef` → 14×`OLEDef` → `Group Group.ID="Group.Root"` → nested `Group` (`Animal Welfare`) containing 276 `ObjDef` + 8 `Model`; 3 `ObjDef` (e.g. "TAMM") sit at `Group.Root` outside the named group. Prolog carries an internal DTD with `LocaleId` entity declarations; attribute values reference them UNEXPANDED (`&LocaleId.AEar;`, `&LocaleId.USen;`).
- `Group` nesting is by XML containment (no parent attribute); the parent is the nearest `<Group>` ancestor. Group `AT_NAME` uses numeric charrefs for Arabic (`&#1573;…`).
- `Model` start tag: `Model.ID`, `Model.Type` (`MT_EEPC` / `MT_VAL_ADD_CHN_DGM`), geometry attrs; children `<Flag>`, `<GUID>`, `<MasterGUID>`, `<TemplateGUID>`, `<Lane>`, then `ObjOcc`/`CxnOcc`(nested)/`FFTextOcc`/`OLEOcc`. Model display name = first `AttrDef AT_NAME` after the open tag and before the first `<ObjOcc`.
- Assignment (nested process) = attribute `LinkedModels.IdRefs` on an `<ObjDef>` start tag (whitespace-padded, space-separated ids). Fixture: exactly 7, all on `OT_FUNC`/`ST_VAL_ADD_CHN_SML_1` defs of the VACD, → the 7 EPC Model.IDs. An assignment counts as a tree EDGE only when that def has ObjOcc(s) inside the parent model.
- `<CxnDef>` lives INSIDE the source `<ObjDef>`, names its target via `ToObjDef.IdRef`, type on the def. `<CxnOcc>` is a child of the source `<ObjOcc>`; target = `ToObjOcc.IdRef`; waypoints = ordered `<Position>` children.
- Colors: `<Brush Color=… BrushType="SOLID|TRANSPARENT">` / `<Pen Color=… Style=… Width=…>` are children of occurrences; unpadded lowercase hex, no `#`; `-1`/`BackColor="-1"` = no override. Function brush `339900`, event `dcbbed`, person/role `d7c49d`, app-system `99`(=0x000099), lanes `7f7f7f`.
- `FFTextOcc` has NO id of its own (referenced by `FFTextDef.IdRef` + position). `OLEDef` holds a base64 `<Blob>`.
- Accounting oracle (pinned in tests): 8 models · 279 ObjDef · 494 ObjOcc · 465 CxnDef/CxnOcc · 1339 route points · 16 lanes · 69 FFText · 14 OLE · 2 groups · 0 unaccounted. Split per-model occ counts match the model inventory above.

---

## Wave / lane schedule

23 lanes across 6 waves (0–5). Lanes within a wave run in parallel and are file-disjoint. Waves are strictly sequential.

| Wave | Lane | Worker        | Goal                                                                                                |
| ---- | ---- | ------------- | --------------------------------------------------------------------------------------------------- |
| 0    | —    | orchestrator  | Commit docs; confirm 5 PDFs under `../reference/`; full gate baseline; record SHA + failures        |
| 1    | T1   | **kimi-k2.7** | ARIS model/assignment scanner → `ProcessIndex` + `ProcessHierarchyGraph` (+ cache, live-doc derive) |
| 1    | T2   | opus-4.8-1M   | AML span-slice splitter `buildArisSplitPlan`                                                        |
| 1    | T3   | **kimi-k2.7** | Blank-model unique `Model.ID` + `<GUID>` + injectable id                                            |
| 1    | T4   | sonnet-med    | Issue-1 + direct-edit i18n keys (en+ar)                                                             |
| 1    | C1   | **kimi-k2.7** | Conventions catalog core (catalog/connectionRules/attributes/index)                                 |
| 1    | C2   | **kimi-k2.7** | Fidelity comparator core (types/compare/loadExpectation)                                            |
| 1    | C3   | opus-4.8-1M   | Direct editing: dep + provider + module registration + CSS                                          |
| 1    | F1   | sonnet-med    | Expectation JSONs (outside repo) + 4 fidelity suites + holdout vitest config                        |
| 1    | F2   | **kimi-k2.7** | `scripts/aris-fidelity-report.ts`                                                                   |
| 2    | T5   | opus-4.8-1M   | App hierarchy integration + live overlay + reveal + model-explorer `>1` gating                      |
| 2    | T6   | opus-4.8-1M   | Canvas assignment UX (marker + dblclick@2000 + Link-model + rail Open)                              |
| 2    | T7   | **kimi-k2.7** | Split-import staging + review dialog                                                                |
| 2    | C4   | opus-4.8-1M   | Palette catalog sections + quick-pick + `replaceNewObject` + wave-2/3 dict keys                     |
| 2    | C5   | sonnet-med    | Symbol descriptors + DMT fills + vocabulary extension/delegation                                    |
| 3    | T8   | opus-4.8-1M   | App capstone: import→split flow, `handleOpenAssignedModel`, create-missing, lifecycle               |
| 3    | T9   | **kimi-k2.7** | animalwf node integration (VACD owns 7 EPCs; move-safe; 3-level)                                    |
| 3    | C6   | sonnet-med    | Details-rail schema editors                                                                         |
| 3    | C7   | sonnet-med    | Convention validation rules                                                                         |
| 3    | C8   | opus-4.8-1M   | Measured fidelity fix loop on 2 iterate models                                                      |
| 4    | E1   | sonnet-med    | e2e: nested processes                                                                               |
| 4    | E2   | **kimi-k2.7** | e2e: import split                                                                                   |
| 4    | E3   | sonnet-med    | e2e: fidelity screenshots + interaction + npm scripts                                               |
| 4    | X1   | sonnet-med    | i18n final sweep                                                                                    |
| 5    | —    | orchestrator  | Holdout run + full gates + build + artifact + evidence + push                                       |

### Contended-file ownership chains (binding — one owner per wave)

- `src/ArisApp.tsx` + `src/ArisApp.test.tsx`: T5(w2) → T8(w3)
- `src/aris/shell/ArisExplorerPane.tsx`: T5(w2) → T8(w3, single `onStageImport` prop)
- `src/aris/shell/ArisStudioTab.tsx`: T6(w2) → C7(w3, one-line append)
- `src/aris/shell/ArisDetailsEditors.tsx` + `ArisDetailsRail.tsx`: T6(w2) → C6(w3)
- `src/i18n/dictionaries.ts`: T4(w1) → C4(w2) → X1(w4)
- `src/aris/canvas/modules.ts`: C3(w1) → C4(w2)
- `src/aris/shell/shell.css`: C3(w1) → T6(w2)
- `package.json` (+lock): C3(w1) → E3(w4)
- `src/aris/canvas/authoring.ts` (+ `authoring.test.ts`): C4(w2) only
- `src/aris/symbols/shapes.ts` + `src/aris/canvas/vocabulary.ts`: C5(w2) only
- `src/aris/canvas/canvasSync.ts` + canvas `renderer.ts` + `elements.ts` + `src/aris/model/buildFromSource.ts` + `svg.ts`: C8(w3) only
- `src/aris/shell/arisExplorerActions.tsx` (+ test): T8(w3) only
- `vitest.animalwf.config.ts`: F1(w1) only
- Never touched (consumed only): `src/workspace/FolderTreeLite.tsx`, `src/workspace/processHierarchy.ts`, `src/core/processIndex.ts`, `src/links/**`, `src/aris/writer/**`, §7.3 package-import files (`ArisImportReviewDialog.tsx`, `arisPackageImport.ts`).

---

## Wave 0 — Baseline (orchestrator)

- [x] Commit `implementation_plan.md` + `goal.md` to the branch.
- [x] Confirm the 5 PDFs are present under `../reference/conventions/` and `../reference/AnimalWF/pdf/` (re-copy from `/home/ahmed/.claude/uploads/e861b876-83f9-425f-b812-da5ebbacb110/` if missing). — Confirmed: 4 process PDFs under `../reference/AnimalWF/pdf/` + `../reference/conventions/ARIS_Convention_Manual_DMT_v02.pdf`; AML fixture (4.18 MB) present at `../reference/AnimalWF/ARISAMLExport.xml`.
- [x] Run the full gate suite at HEAD: `npm run format:check && npm run lint && npm run typecheck && npm run check:aris-runtime-boundary && npm run check:ui-copy && npm run check:no-skips && npm run check:lite-only && npm test`. Record the SHA and every pre-existing failure verbatim under "Baseline record".
- [x] If gates are red at HEAD, dispatch a fix lane (default workers) BEFORE Wave 1 and re-record. — N/A: no source gate is red at HEAD. The only `format:check` failure was the uncommitted `implementation_plan.md` itself, formatted in this Wave-0 commit; no fix lane required.

---

## Lane T1 — ARIS model/assignment scanner

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned (create):** `src/aris/links/arisModelScan.ts`, `src/aris/links/arisWorkspaceLinks.ts`, `src/aris/links/arisModelScan.test.ts`, `src/aris/links/arisWorkspaceLinks.test.ts`, `src/aris/links/arisModelScan.animalwf.test.ts`

**Goal:** pure, node-safe scanners that turn AML text and the workspace listing into the exact `ProcessIndex` + `ProcessHierarchyGraph` inputs `buildProcessHierarchy` already consumes — modeled byte-for-byte on `src/links/linkGraph.ts`.

**Read first:** `src/links/linkGraph.ts` (mask-comments, span stack-scan, ambiguity fail-closed patterns — copy them), `src/core/processIndex.ts` (`ProcessEntry`, `ProcessIndex`), `src/workspace/processHierarchy.ts:1-40` (`ProcessHierarchyLink`, `ProcessHierarchyGraph`, `processLinkKey`), `src/library/amlParse.ts` (`localeLang`, `decodeAmlEntities` — import these), `src/workspace/adapters/types.ts` (`WorkspaceEntry`, `FileSnapshot`), `src/aris/model/types.ts` (`ArisWorkingDocument`, `ArisObjectDefinition.linkedModelIds`), R5 above.

**Interface (implement exactly; all cross-module imports type-only):**

```ts
// arisModelScan.ts
export interface ArisScannedModel {
  readonly modelId: string
  readonly name: string | null
  readonly modelType: string | null
}
export interface ArisScannedAssignment {
  readonly parentModelId: string
  readonly childModelId: string
  readonly occurrenceIds: readonly string[]
  readonly count: number
}
export interface ArisModelScanResult {
  readonly models: readonly ArisScannedModel[]
  readonly assignments: readonly ArisScannedAssignment[]
}
export function scanArisModelSource(xml: string): ArisModelScanResult

// arisWorkspaceLinks.ts
export interface ArisWorkspaceLinkState {
  readonly index: ProcessIndex
  readonly graph: ProcessHierarchyGraph
  readonly scannedFileCount: number
}
export const EMPTY_ARIS_LINK_STATE: ArisWorkspaceLinkState
export interface ArisLinkScanCacheEntry {
  readonly size: number | undefined
  readonly modifiedAt: number | undefined
  readonly hash: string
  readonly result: ArisModelScanResult
}
export interface ArisLinkScanCache {
  readonly byPath: Map<string, ArisLinkScanCacheEntry>
}
export function createArisLinkScanCache(): ArisLinkScanCache
export function isArisLinkScanCandidate(entry: WorkspaceEntry): boolean
export async function scanArisWorkspaceLinks(
  adapter: Pick<WorkspaceAdapter, 'read'>,
  entries: readonly WorkspaceEntry[],
  cache: ArisLinkScanCache
): Promise<ArisWorkspaceLinkState>
export function deriveArisLinksFromDocument(document: ArisWorkingDocument): ArisModelScanResult
export function mergeArisLinkState(
  base: ArisWorkspaceLinkState,
  overlays: ReadonlyMap<string, ArisModelScanResult>
): ArisWorkspaceLinkState
```

**Steps:**

- [x] `scanArisModelSource`: mask comments/CDATA (copy `linkGraph.ts`), stack-scan `<Model>…</Model>` spans (capture `Model.ID`, `Model.Type`), stack-scan `<ObjDef>` spans (capture `ObjDef.ID`, `LinkedModels.IdRefs` split on `/\s+/u` and entity-decoded), single-pass `<ObjOcc` tags (capture `ObjOcc.ID`, `ObjDef.IdRef`, attribute the offset to its containing model span). Model name = first `AttrDef AT_NAME` `AttrValue` after the model open tag and before its first `<ObjOcc`, locale via `localeLang`, decoded via `decodeAmlEntities`, EN-preferred then AR then `null`. An assignment edge exists only when the linking def has ≥1 ObjOcc in the parent model; `occurrenceIds` = those ObjOcc.IDs (sorted); `count` = total linking occurrences. Merge defs that link the same (parent, child): concat+sort ids, sum counts. Deterministic sort: models by `modelId`, assignments by `(parent, child)`.
- [x] `isArisLinkScanCandidate`: `kind === 'file'` && `/\.(?:aml|xml)$/iu.test(name)` && `!path.startsWith('.orbitpm/')`.
- [x] `scanArisWorkspaceLinks`: for each candidate, reuse cache when `size`+`modifiedAt` both present and match; else `adapter.read` and reuse when the content hash matches; else decode (`new TextDecoder('utf-8')`) + `scanArisModelSource`. Swallow per-file read/decode failures (contribute nothing — the jsdom mock adapters throw on unknown paths). Assemble: any modelId declared >1× across files (or twice in one file) → `graph.ambiguousProcessIds`, dropped from `index`; links emitted only when parent AND child resolve unambiguously; `ProcessHierarchyLink.key = processLinkKey(parent, child)` (`JSON.stringify([parent, child])`); `ProcessEntry.relPath` = the file's path; `processName` = scanned name.
- [x] `deriveArisLinksFromDocument`: produce the same `ArisModelScanResult` from an in-memory `ArisWorkingDocument` (models + object definitions with `linkedModelIds` + occurrences), so open tabs can overlay live edits.
- [x] `mergeArisLinkState(base, overlays)`: rebuild index+graph replacing each overlaid relPath's contribution with the overlay's scan result.
- [x] Prettier both new modules and tests.

**Tests assert:** two-model AML with `LinkedModels.IdRefs=" Model.B "` (padded) on a def occurring twice in Model.A ⇒ one edge A→B, `count===2`, both ObjOcc.IDs sorted; def with linkedModelIds but zero occurrences in a model ⇒ no edge; same Model.ID in two files ⇒ absent from index, present in `ambiguousProcessIds`, no edges touching it; missing child ⇒ no edge; commented-out `<Model` ignored; AR-only name ⇒ AR; no AT_NAME ⇒ `null`; cache: unchanged size+mtime ⇒ `adapter.read` NOT called (spy); changed hash ⇒ rescan; moved path/same content ⇒ hash-reuse, links unchanged except relPaths; per-file read error skipped without rejecting; `deriveArisLinksFromDocument` matches the text scan of the equivalent AML; `merge` replaces one file's contribution. **animalwf suite** (throw-if-missing header copied from an existing `*.animalwf.test.ts`): monolith scan finds 8 models with the R4 names, exactly 7 assignments VACD→each EPC (`count===1` each); feeding `buildProcessHierarchy` with a synthetic 8-file tree (one path per model) yields the VACD row owning 7 children.

**Verify (report exit codes):**

```bash
npx vitest run src/aris/links && npm run test:aris:animalwf
npm run typecheck && npm run lint && npm run check:aris-runtime-boundary && npm run check:no-skips
```

---

## Lane T2 — AML span-slice splitter

**Wave:** 1 · **Worker:** opus-4.8-1M · **Depends on:** nothing
**Files owned (create):** `src/aris/source/amlSplit.ts`, `src/aris/source/amlSplit.test.ts`, `src/aris/source/amlSplit.animalwf.test.ts`

**Goal:** pure function turning a parsed `ArisXmlSourcePackage` into one standalone AML document per model, via verbatim byte slices, preserving all cross-file identity and rendering fidelity.

**Read first:** `src/aris/source/semanticIndex.ts:1-435` (record shapes, `span.start/end.offset`, `parent`/`ownerSourceId`, `groups`, `models`, `objectDefinitions`, `objectOccurrences`, `connectionDefinitions`/`connectionOccurrences`, `freeTextOccurrences`, `attachmentOccurrences`), `src/aris/source/sourcePackage.ts` (`ArisXmlSourcePackage.text`/`.index`), `src/aris/source/xmlTokenizer.ts` (`XmlSpan`, use `.offset`; DTD entity decls), `src/aris/writer/emit.ts` (`renderAttributes`, `CANONICAL_CHILD_ORDER` for Group order), `src/aris/writer/escapeXml.ts`, `src/core/slug.ts`, R5 above.

**Interface:**

```ts
export interface ArisSplitFile {
  readonly modelId: string
  readonly modelName: string | null
  readonly fileName: string
  readonly folderSegments: readonly string[]
  readonly text: string
}
export interface ArisSplitPlan {
  readonly files: readonly ArisSplitFile[]
  readonly skippedModelIds: readonly string[]
}
export function buildArisSplitPlan(pkg: ArisXmlSourcePackage): ArisSplitPlan
export function sanitizeArisPathSegment(name: string): string
export function deriveSplitFileName(modelName: string | null, modelId: string): string
```

**Steps:**

- [x] First write a throwaway assertion in the unit test: a record's span slices `pkg.text` to a string starting `<ObjDef` and ending `</ObjDef>` or `/>` — to pin span semantics before building on them. If spans exclude the closing tag, switch to the element's own end-boundary consistently.
- [x] `sanitizeArisPathSegment`: NFC + trim → strip `<>:"/\|?*` + control chars → collapse whitespace to single space → strip leading dots and trailing dots/spaces → empty ⇒ sanitized id ⇒ `'group'`. `deriveSplitFileName`: EN-preferred name → AR → id, then `deriveArisSourceFileName` dash rules, `.aml` extension.
- [x] Per model, assemble a complete AML document from verbatim slices: prolog (`text.slice(0, root.span.start.offset)` — XML decl + DOCTYPE with the LocaleId entity decls, MANDATORY); reconstructed root open tag from `index.root` rawAttributes via `renderAttributes`; `Header-Info`; all `Language`s; all `FontStyleSheet`s (source order); the model's Group chain (walk `groups` by `parentGroupId`, exclude `Group.Root`) as reconstructed open tags + verbatim slices of each group's own `AT_NAME` AttrDef; referenced ObjDefs (defs of the model's occurrences, `parsed.modelId === model`), each sliced with non-kept child `CxnDef` spans EXCISED (kept = connectionDefinitionIds referenced by the model's connectionOccurrences; children via `record.parent.sourceId`); referenced `FFTextDef`s (via freeTextOccurrences) and `OLEDef`s (via attachmentOccurrences); the whole `Model` span verbatim; close the group chain; `</AML>`. Keep `LinkedModels.IdRefs` verbatim (that IS the cross-file link). Folder segments = sanitized group-chain names (EN-preferred), outermost first, `Group.Root` excluded.
- [x] In tests, re-parse EVERY produced text with the node tokenizer + `buildSemanticArisDocument` — that is the correctness oracle.
- [x] Prettier all three files.

**Tests assert (synthetic 2-group/3-model AML with bilingual names, shared defs, cross-model CxnDefs, FFText, a DTD entity in an attribute):** each split re-parses with 0 error diagnostics; contains exactly its model; per-model occ/def/cxn counts match the monolith slice; excised CxnDefs absent, kept ones present; `LinkedModels.IdRefs` preserved verbatim; DOCTYPE entity block present and `&LocaleId…;` attr values survive; AR-only group ⇒ `folderSegments: ['<arabic>']`; a `Group.Root`-level def referenced by the model is pulled into the model's chain; two same-named models ⇒ same `fileName` (collision handled later by `uniquePathIn`). **animalwf suite:** 8 files; per-file accounting vs the R5 oracle (renew = 46 occ, etc.); each file's model renderable via `buildFromSource` + `isSupportedModelType`; the VACD file keeps all 7 `LinkedModels.IdRefs` substrings; every EPC file under the `Animal Welfare` folder.

**Verify:**

```bash
npx vitest run src/aris/source/amlSplit.test.ts && npm run test:aris:animalwf
npm run typecheck && npm run lint && npm run check:aris-runtime-boundary && npm run check:no-skips
```

---

## Lane T3 — Blank-model unique IDs + GUID

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned:** `src/aris/shell/arisBlankModel.ts` (modify), `src/aris/shell/arisBlankModel.test.ts` (modify)

**Goal:** stop emitting the fixed `Model.ID="Model.New"`; mint a unique id + `<GUID>`, injectable so the create-missing flow can force a specific id.

**Read first:** `src/aris/shell/arisBlankModel.ts` (whole), `src/aris/writer/ids.ts` (`createArisIdAllocator`, `ArisDefinitionIdKind` includes `'Model'` → `Model.<11-char-key>-u-L`), `src/aris/writer/emit.ts` (`ElementSpec.text`).

**Steps:**

- [x] Extend `ArisBlankModelSpec` with `modelId?: string`, `guid?: string`, `random?: RandomSource`. Default `modelId` via `createArisIdAllocator({ existingIds: [] }).allocateDefinitionId('Model')`; default `guid` via `crypto.randomUUID()`. Add a `<GUID>` child to the Model element. Return the actual `modelId`. Keep `deriveArisSourceFileName` and the existing name/locale behavior untouched; output stays frozen.
- [x] Update tests: two default builds mint different ids matching `/^Model\.[-0-9A-Za-z_]{11}-u-L$/`; injected `random` is deterministic; explicit `modelId: 'Model.3xqe8yXO9Z7-u-L'` is used verbatim and returned; xml contains `<GUID>` with the supplied guid; output still parses via the node tokenizer with the model present. (Authorized change: any `Model.New` literal expectation is replaced.)
- [x] Prettier both files.

**Verify:**

```bash
npx vitest run src/aris/shell/arisBlankModel.test.ts && npm run typecheck && npm run lint && npm run check:no-skips
```

---

## Lane T4 — Issue-1 + direct-edit i18n keys

**Wave:** 1 · **Worker:** sonnet-med · **Depends on:** nothing
**Files owned:** `src/i18n/dictionaries.ts` (modify)

**Read first:** `src/i18n/dictionaries.ts` (`en` head + `ar` section start), `src/__tests__/i18n.test.ts` (parity + placeholder rules).

**Steps:**

- [x] Add to BOTH `en` and `ar` (real Arabic translations, identical `{placeholders}`): `aris.import.split.title` "Import into the workspace"; `aris.import.split.body` "Each ARIS model becomes its own .aml file, in folders mirroring the ARIS group tree. Existing files are never overwritten."; `aris.import.split.listAria` "Files to be created"; `aris.import.split.skipExisting` "Skipped — model {id} already exists in this workspace"; `aris.import.split.confirm` "Import {count} file(s)"; `aris.import.split.cancel` "Cancel"; `aris.import.split.done` "Imported {written} model file(s); {skipped} skipped."; `aris.import.split.failed` "The import could not be written: {error}"; `aris.import.split.nothing` "No ARIS models were found in {name}."; `aris.assign.marker.aria` "Open the model assigned to {name}"; `aris.assign.open` "Open"; `aris.assign.open.aria` "Open the assigned model {model}"; `aris.assign.ambiguous` "Model id {id} exists in more than one workspace file; resolve the duplicate before navigating."; `aris.assign.missing` "No model with id {id} exists in this workspace."; `aris.assign.link` "Link model…"; `aris.assign.link.title` "Assign a workspace model to the selected function"; `aris.assign.linked` "Linked {model} to {name}."; `aris.assign.created` "Created {path}; the assignment on {name} now resolves."; `aris.newModel.linkedHint` "The model will be created with id {id} so the assignment on {name} resolves immediately."; `aris.directEdit.placeholder` "Type a label"; `aris.directEdit.aria` "Edit label".
- [x] Prettier.

**Verify:**

```bash
npx vitest run src/__tests__/i18n.test.ts && npm run typecheck && npm run check:ui-copy && npm run lint
```

---

## Lane C1 — Conventions catalog core

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned (create):** `src/aris/conventions/catalog.ts`, `src/aris/conventions/connectionRules.ts`, `src/aris/conventions/attributes.ts`, `src/aris/conventions/index.ts`, `src/aris/conventions/catalog.test.ts`, `src/aris/conventions/connectionRules.test.ts`, `src/aris/conventions/attributes.test.ts`

**Goal:** THE pure source of truth for symbols, colors, connection legality + labels + RACI, and attribute schema — seeded from R1/R2/R3.

**Read first:** R1/R2/R3 above; `src/aris/canvas/vocabulary.ts` (existing `CONNECTION_RULES` triples — reproduce verbatim); `src/aris/epc/constants.ts` (fixture CT census if present).

**Interface:**

```ts
// catalog.ts
export type ArisSymbolVerification = 'fixture' | 'aris-doc' | 'unverified'
export type ArisSymbolFamilyId =
  'function' | 'infoCarrier' | 'orgPeople' | 'governance' | 'rule' | 'valueChain'
export interface ArisConventionSymbol {
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly family: ArisSymbolFamilyId | null
  readonly defaultFill: string
  readonly defaultStroke: string
  readonly paletteGroup: 'flow' | 'rule' | 'org' | 'data' | 'system' | 'governance'
  readonly paletteOrder: number
  readonly modelTypes: readonly string[]
  readonly verification: ArisSymbolVerification
}
export const ARIS_CONVENTION_SYMBOLS: readonly ArisConventionSymbol[]
export function getPaletteSymbols(modelType: string): readonly ArisConventionSymbol[]
export function conventionSymbol(objectType: string, symbolNum: string): ArisConventionSymbol | null
export function conventionDefaultFill(objectType: string, symbolNum: string): string | null
export function getVariantFamily(
  objectType: string,
  symbolNum: string
): readonly ArisConventionSymbol[]

// connectionRules.ts
export type RaciLetter = 'R' | 'A' | 'C' | 'I'
export interface ArisConnectionRule {
  readonly modelType: string | null
  readonly from: string
  readonly to: string
  readonly connectionType: string
  readonly labelKey: string
  readonly raci: RaciLetter | null
  readonly verification: ArisSymbolVerification
}
export const ARIS_CONNECTION_RULES: readonly ArisConnectionRule[]
export const RACI_BY_CONNECTION_TYPE: Readonly<Record<string, RaciLetter>>
export interface ResolvedConventionConnection {
  readonly connectionType: string
  readonly fallback: boolean
  readonly rule: ArisConnectionRule | null
}
export function resolveConventionConnection(
  modelType: string,
  fromObjectType: string,
  toObjectType: string
): ResolvedConventionConnection
export function isLegalConnection(
  modelType: string,
  fromObjectType: string,
  toObjectType: string,
  connectionType: string
): boolean

// attributes.ts
export interface ArisAttributeSchemaEntry {
  readonly attributeType: string
  readonly labelKey: string
  readonly mandatory: boolean
  readonly appliesTo: 'objectType' | 'model'
  readonly objectTypes?: readonly string[]
  readonly modelTypes?: readonly string[]
  readonly verification: ArisSymbolVerification
}
export const ARIS_ELEMENT_ATTRIBUTE_SCHEMA: readonly ArisAttributeSchemaEntry[]
export const ARIS_EPC_MODEL_ATTRIBUTE_SCHEMA: readonly ArisAttributeSchemaEntry[]
export function schemaForObjectType(objectType: string): readonly ArisAttributeSchemaEntry[]
export function schemaForModelType(modelType: string): readonly ArisAttributeSchemaEntry[]
```

**Steps:**

- [x] Types, then the symbol table from R1 (each row provenance-commented; ALL non-`fixture` rows in ONE contiguous region under `// VERIFY-AGAINST-REAL-ARIS-EXPORT`). `labelKey`s use the `aris.symbol.*` namespace (registered by C4). `getVariantFamily` groups by `family` for the quick-pick.
- [x] Connection rules = every existing `vocabulary.ts` triple verbatim + R2 additions; `RACI_BY_CONNECTION_TYPE` per R2 (CT_EXEC_1/2→R, CT_MUST_BE_INFO_ABT_1→I, CT_DECID_ON→A, CT_MUST_BE_CONSLT_ABT_1→C). `resolveConventionConnection` returns `{connectionType, fallback:false, rule}` on a match, else `{connectionType: 'CT_REFS_TO_2', fallback:true, rule:null}`.
- [x] Attribute schemas from R3. Map-index everything, freeze outputs.
- [x] Prettier + tests.

**Tests assert:** every existing `vocabulary.ts` triple resolves identically via `resolveConventionConnection`; RACI letters correct; every catalog symbol has a 6-digit `#` fill; `getPaletteSymbols('MT_EEPC')` excludes VACD-only symbols and includes Function/Event/rules; `getVariantFamily('OT_FUNC','ST_FUNC')` includes System function + Process interface; mandatory `AT_ID` present for `OT_FUNC`.

**Verify:**

```bash
npx vitest run src/aris/conventions && npm run typecheck && npm run lint && npm run check:no-skips
```

---

## Lane C2 — Fidelity comparator core

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned (create):** `src/aris/fidelity/expectationTypes.ts`, `src/aris/fidelity/compare.ts`, `src/aris/fidelity/loadExpectation.ts`, `src/aris/fidelity/compare.test.ts`

**Goal:** pure comparator producing a structured diff between an `ArisWorkingDocument` model and a hand-authored expectation.

**Read first:** `src/aris/model/types.ts` (`ArisWorkingDocument`, `ArisModel`, occurrences, connections), `src/aris/canvas/renderer.ts` (`occurrenceColorToCss` — import for color normalization), `src/aris/epc/flowGraph.ts` (control-flow classification to reuse for the spine walk), R4.

**Interface:**

```ts
export interface FidelityExpectationDoc {
  readonly modelKey: string
  readonly modelIdHint: string | null
  readonly nameEn: string
  readonly spine: readonly SpineStep[]
  readonly satellites: Readonly<Record<string, readonly SatelliteExpectation[]>>
  readonly gates: readonly GateExpectation[]
  readonly notes: readonly NoteExpectation[]
  readonly counts: {
    readonly functions: number
    readonly events: number
    readonly rules: number
    readonly connections: number
  }
}
export interface SpineStep {
  readonly kind: 'function' | 'event' | 'rule'
  readonly nameEn: string
  readonly numbering: string | null
  readonly symbolNum: string | null
  readonly fill: string | null
}
export interface SatelliteExpectation {
  readonly nameEn: string
  readonly objectType: string
  readonly side: 'left' | 'right'
  readonly connectionType: string
  readonly raci: 'R' | 'A' | 'C' | 'I' | null
  readonly symbolNum: string | null
  readonly fill: string | null
}
export interface GateExpectation {
  readonly operator: 'AND' | 'OR' | 'XOR'
  readonly afterNameEn: string
  readonly branchFirstNamesEn: readonly string[]
}
export interface NoteExpectation {
  readonly contains: string
}
export interface FidelityDiffRow {
  readonly category:
    'spine' | 'numbering' | 'satellite' | 'symbol' | 'color' | 'gate' | 'note' | 'count'
  readonly status: 'missing' | 'extra' | 'mismatched'
  readonly expected: string | null
  readonly actual: string | null
  readonly where: string
}
export interface FidelityDiffReport {
  readonly rows: readonly FidelityDiffRow[]
  readonly byCategory: Readonly<Record<string, number>>
  readonly pass: boolean
}
export function compareModelToExpectation(
  document: ArisWorkingDocument,
  modelId: string,
  expected: FidelityExpectationDoc
): FidelityDiffReport
export function loadExpectation(modelKey: string): FidelityExpectationDoc
```

**Steps:**

- [x] Spine walk: start events → control-flow successors; branch order by occurrence center-x. Satellite side: center-x < function center-x ⇒ `left`. Color normalization via `occurrenceColorToCss`. Category set-diff → rows; `pass = rows.length === 0`.
- [x] `loadExpectation(modelKey)` reads `resolve(process.cwd(), '../reference/AnimalWF/expected/<modelKey>.expected.json')`; throw if absent.
- [x] Prettier + tests on synthetic docs.

**Tests assert:** a doc matching a small expectation passes; each mutation class (renamed function, missing satellite, wrong RACI/connection type, wrong fill, swapped gate operator, reordered spine, wrong count) produces exactly one diff row of the right category/status.

**Verify:**

```bash
npx vitest run src/aris/fidelity/compare.test.ts && npm run typecheck && npm run lint && npm run check:no-skips
```

---

## Lane C3 — Direct editing

**Wave:** 1 · **Worker:** opus-4.8-1M · **Depends on:** nothing (uses T4's keys only if a string is rendered; the placeholder/aria keys are registered by T4 but C3 may land after T4 in the same wave — if a key is missing at C3's test time, use `tk()`-free literal-free code by reading the key through `t()` and let X1/T4 own registration; do NOT add keys to dictionaries here)
**Files owned:** `src/aris/canvas/directEdit.ts` (create), `src/aris/canvas/directEdit.test.ts` (create), `src/aris/canvas/modules.ts` (modify), `package.json` + `package-lock.json` (modify), `src/aris/shell/shell.css` (modify)

**Goal:** immediate inline label editor on placement, double-click, and F2; commit via the existing undoable rename under the ACTIVE content locale; RTL- and zoom-safe.

**Read first:** `node_modules/diagram-js-direct-editing/lib/DirectEditing.js` (`activate(element) → {bounds, text, style?, options?}`, `update`, Enter/Escape/focusout built in) + `lib/TextBox.js` (`create` accepts `style` but not `direction`); `node_modules/diagram-js/lib/features/create/Create.js` (`create.end` carries the committed shape); `node_modules/diagram-js/lib/core/Canvas.js` (`getAbsoluteBBox`); `src/aris/canvas/authoring.ts` (`renameDefinition(definitionId, name, localeId)`), `ArisCanvas.ts` (`contentLanguage`, `ARIS_CONTENT_LOCALE_IDS`), `canvasSync.ts`, `elements.ts`, `modules.ts`, `testing/harness.ts` (`bootCanvas`, `shape`). If TS can't resolve the library types, write a minimal `.d.ts` shim beside `directEdit.ts` (pattern: the existing diagram-js-minimap shim).

**Interface:**

```ts
export class ArisDirectEditingProvider {
  static $inject: readonly string[] // ['directEditing','eventBus','canvas','selection','arisAuthoring','arisCanvasSync','elementRegistry','arisCommandBridge']
  activate(element: unknown):
    | {
        bounds: unknown
        text: string
        style?: Record<string, string>
        options?: Record<string, unknown>
      }
    | undefined
  update(element: unknown, newText: string): void
}
export const ArisDirectEditModule: unknown // bundles DirectEditingModule + registers 'arisDirectEditingProvider'
```

**Steps:**

- [x] `npm install diagram-js-direct-editing@3.5.1 --save-exact`; immediately run `npm run check:aris-runtime-boundary` and `npm run check:lock` and report exit codes.
- [x] Provider: `activate` for occurrences → `{ bounds: canvas.getAbsoluteBBox(element), text: bo.name, style: { fontSize: \`${12 * canvas.zoom()}px\`, textAlign: 'center' }, options: { autoResize: true } }`; free text → `text: bo.text`; external caption label → retarget to the owner occurrence; connection/lane/model → `undefined`. Capture the `definitionId`/`freeTextId`STRING at activate time (frozen bos are replaced on re-render).`update`for occurrences →`authoring.renameDefinition(capturedDefinitionId, newText, sync.displayLocaleId)`(the active content locale, NOT the default); free text →`authoring.editFreeText(capturedFreeTextId, { text: newText })`.
- [x] Wire in the module constructor (all eventBus): `element.dblclick` @ **1500** → `directEditing.activate(target)`, `return false`; `create.end` @ **250** → if `context.canExecute !== false` and the shape's bo is editable, `setTimeout(() => directEditing.activate(shape), 0)` and set a `justCreated` flag; `keyboard keydown` F2 with a single editable selection → activate, return true; `directEditing.activate` → set `.djs-direct-editing-content` `dir="auto"` + `unicodeBidi:'plaintext'`. On `directEditing.cancel` with `justCreated` && free text && empty → `bridge.undo()` (remove the junk note); occurrence cancel leaves the unnamed shape.
- [x] `modules.ts`: import + append the library `DirectEditingModule` to `ARIS_DIAGRAM_JS_MODULES`; register `arisDirectEditingProvider` in `ArisCanvasModule.__init__`.
- [x] CSS for `.djs-direct-editing-parent`/`.djs-direct-editing-content` theming. Prettier.

**Tests (jsdom, `bootCanvas`) assert:** activate on an occurrence shows a contenteditable with the current name; typed text + Enter → `store.document.objectDefinitions.get(defId).names` updated under the display locale, single undo reverts; Escape → unchanged; focusout → committed; `element.dblclick` → active; F2 with selection → active; `create.end` with a created shape → active on it; Arabic string commits under `ar-AE` when `setContentLanguage('ar')`; content element has `dir="auto"`; free-text create→activate→Escape leaves no free text (undo fired); an edit survives an unrelated `element.changed` (captured-id commit).

**Verify:**

```bash
npx vitest run src/aris/canvas/directEdit.test.ts src/aris/canvas/boot.test.ts
npm run typecheck && npm run lint && npm run check:aris-runtime-boundary && npm run check:lock && npm run check:no-skips
```

**Do NOT touch:** `paletteProvider.ts`, `arisModeling.ts`, `contextPadProvider.ts`, `ArisApp.tsx`, `ArisStudioTab.tsx`, `dictionaries.ts`.

---

## Lane F1 — Expectation JSONs + fidelity suites + holdout config

**Wave:** 1 · **Worker:** sonnet-med · **Depends on:** C2 interfaces (frozen above — not merged code)
**Files owned (create):** `/home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/expected/{renew-profile,register-owner,transfer-citizens,transfer-citizens-companies}.expected.json` (OUTSIDE repo), `src/aris/fidelity/renewProfile.animalwf.test.ts`, `src/aris/fidelity/registerOwner.animalwf.test.ts`, `src/aris/fidelity/transferCitizens.holdout.animalwf.test.ts`, `src/aris/fidelity/transferCitizensCompanies.holdout.animalwf.test.ts`, `vitest.animalwf.holdout.config.ts` (create); `vitest.animalwf.config.ts` (modify — exclude holdouts)

**Read first:** R4 (per-model tables + Model.IDs), `src/aris/canvas/connectionLabels.animalwf.test.ts` (throw-if-missing + `process.cwd()` path pattern), C2's frozen interfaces.

**Steps:**

- [x] Author the 4 expectation JSONs from R4 (iterate = renew-profile + register-owner in full detail; holdouts = transfer-citizens strict + transfer-citizens-companies topology from the model block, refined against AML only in Wave 5 — never tuned). Set `modelIdHint` to the R4 Model.IDs.
- [x] Iterate suites: module-load fixture guard → build the doc via the primary pipeline (`createArisXmlSourcePackage` → `buildArisStudioDocument` → working doc) → locate model by `modelIdHint` → `compareModelToExpectation` → `expect(report.pass, formatRows(report)).toBe(true)`. Since Wave-1 rendering has known gaps, encode a `BASELINE` const of allowed per-category diff counts so the suite is GREEN at merge and C8 ratchets it to 0 (thresholds, NOT skips).
- [x] Holdout suites: identical structure with the `.holdout.animalwf.test.ts` suffix. `vitest.animalwf.holdout.config.ts` includes only `src/**/*.holdout.animalwf.test.ts` (same env/alias/timeout as the animalwf config). Add `exclude: ['src/**/*.holdout.animalwf.test.ts']` to `vitest.animalwf.config.ts`.
- [x] Prettier the TS files (NOT the JSONs outside the repo).

**Tests/Verify:**

```bash
npm run test:aris:animalwf                                   # iterate suites green at BASELINE
npx vitest run --config vitest.animalwf.holdout.config.ts    # RUN ONCE to confirm load, then do not run again until Wave 5
npm test                                                     # default project untouched (holdouts + iterate excluded)
npm run check:no-skips && npm run typecheck && npm run lint
```

---

## Lane F2 — Fidelity measurement script

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** C2 interfaces
**Files owned (create):** `scripts/aris-fidelity-report.ts`

**Read first:** `scripts/aris-golden-compare.ts` (vite-node load + fixture path pattern), C2 interfaces.

**Steps:**

- [x] For each iterate model: tokenizer → semanticIndex → buildFromSource → `compareModelToExpectation` → print a per-category table and write a JSON artifact to `/home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/fidelity-report/<key>.json` (outside repo; `mkdir -p` first; do NOT use a timestamp — `Date.now()` is fine in a plain script but keep the filename stable per model). Prettier.

**Verify:**

```bash
npx vite-node scripts/aris-fidelity-report.ts   # prints per-category counts for both iterate models
npm run typecheck && npm run lint
```

---

## Lane T5 — App hierarchy integration + explorer

**Wave:** 2 · **Worker:** opus-4.8-1M · **Depends on:** T1, T4
**Files owned:** `src/ArisApp.tsx` (modify), `src/aris/shell/ArisExplorerPane.tsx` (modify), `src/ArisApp.test.tsx` (additive tests only this wave)

**Goal:** the tree becomes semantic (owned nesting, reference rows, pills) with a live-tab overlay; reveal + reference-row navigation; model-explorer gated to `>1`.

**Read first:** `src/ArisApp.tsx:373-600` (the `explorerTree`/`explorerHierarchy`/`EMPTY_*` site), `src/workspace/FolderTreeLite.tsx:15-40,132-187` (`TreeRevealRequest`, reveal effect), `src/workspace/processHierarchy.ts:25-32,108-116` (`HierarchyNavigation`, `canonicalPathByProcessId`), `src/aris/links/arisWorkspaceLinks.ts` (T1), `src/ArisApp.test.tsx:181-320` (the mock adapter — `read` throws for unlisted paths, so scan tolerance is load-bearing).

**Steps:**

- [x] Add: a scan cache ref (`createArisLinkScanCache`), a scan-state state, a scan effect keyed `[multiFile, workspaceAdapter, workspaceEntries]` (cancel via a flag), a live-overlay state `Map<relPath, ArisModelScanResult>` with setter `handleLiveScanChange(relPath, result|null)` that early-bails on an unchanged JSON signature (no churn on move/resize), a `mergedLinks` memo (`mergeArisLinkState(scanState, overlays)`). Feed `explorerHierarchy` `mergedLinks.index`/`mergedLinks.graph` instead of `EMPTY_*`. (The overlay PRODUCER is wired in Wave 3 — this wave only state + merge.)
- [x] Add `treeReveal` state + `requestTreeReveal(processId?, relPath?)` (`setTreeReveal({ token: ++ref, processId, relPath })`), `openCanonicalProcess(processId)` (look up `canonicalPathByProcessId`; `setExplorerOpen(true)`; bump reveal; `void handleOpenWorkspaceFile(path)`; `handleSelectModel('source:'+path, processId)`), and `handleOpenProcess(navigation)` = `openCanonicalProcess(navigation.processId)`.
- [x] `ArisExplorerPane`: gate `ArisModelExplorer` on `activeTab.models.length > 1`; add + forward `revealRequest` and `onOpenProcess` to `FolderTreeLite` (replacing `onOpenProcess={() => undefined}`).
- [x] Prettier.

**Tests (new `describe` in `ArisApp.test.tsx`):** a directory workspace with `parent.aml` (Model.P, def linked to Model.C with one occurrence) + `child.aml` (Model.C) as snapshots ⇒ tree nests `child.aml` UNDER `parent.aml` (owned row, not at root); a third file duplicating Model.C ⇒ child returns to its physical location (ambiguous fail-closed); clicking the owned/reference child row opens `child.aml`; `.orbitpm` and `.bpmn` never scanned (adapter.read spy); files whose read throws still render as plain rows (existing tree-render test keeps passing).

**Verify:**

```bash
npx vitest run src/ArisApp.test.tsx src/aris/shell
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary && npm run check:no-skips
```

**Do NOT touch:** `ArisStudioTab.tsx`, `ArisDetailsRail*`, `arisExplorerActions.tsx`, split modules.

---

## Lane T6 — Canvas assignment UX

**Wave:** 2 · **Worker:** opus-4.8-1M · **Depends on:** T4
**Files owned:** `src/aris/shell/arisAssignmentUx.ts` (create), `src/aris/shell/arisAssignmentUx.test.tsx` (create), `src/aris/shell/ArisStudioTab.tsx` (modify), `src/aris/shell/arisEpcFindings.ts` (modify), `src/aris/shell/ArisDetailsRail.tsx` (modify), `src/aris/shell/ArisDetailsEditors.tsx` (modify), `src/aris/shell/ArisDetailsRail.editing.test.tsx` (modify), `src/aris/shell/shell.css` (modify)

**Goal:** ⊞ assignment marker + double-click drill-down (@2000), in-document-first resolution, "Link model…" toolbar via `LinkPicker`, `onLiveDocumentChange` emission, dangling-assignment suppression, rail Open buttons.

**Read first:** `src/aris/shell/arisValidationOverlays.ts` (copy its structure: `OverlaysLike` view, `applied` map, try/catch, `uninstall`), `ArisStudioTab.tsx:144-260,398-530,680-870` (canvas boot, findings assembly, toolbar), `src/aris/canvas/elements.ts` (`ArisOccurrenceBusinessObject`), `src/aris/canvas/ArisCanvas.ts` (public getters, `eventBus`, `setActiveModel`, `authoring`, `document`), `src/links/LinkPicker.tsx`, `ArisDetailsEditors.tsx:543-600` (`ArisAssignmentsEditor`), `arisEpcFindings.ts`.

**Interface:**

```ts
export const ARIS_ASSIGNMENT_OVERLAY_TYPE = 'aris-assignment'
export interface ArisAssignmentActivation {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly definitionName: string
  readonly linkedModelIds: readonly string[]
}
export interface ArisAssignmentUxController {
  resync(): void
  uninstall(): void
}
export function installArisAssignmentUx(
  canvas: ArisCanvas,
  onActivate: (activation: ArisAssignmentActivation) => void
): ArisAssignmentUxController
// arisEpcFindings.ts
export function buildArisEpcFindings(
  document: ArisWorkingDocument,
  modelIds?: ReadonlySet<string>,
  externallyKnownModelIds?: ReadonlySet<string>
): readonly ArisEpcModelFinding[]
```

**Steps:**

- [x] `arisAssignmentUx.ts`: marker = a `<button>` `⊞`, class `orbitpm-aris-assignment-marker`, `data-orbitpm-aris-assignment=<occId>`, `aria-label = t('aris.assign.marker.aria', {name})`, overlay position `{ bottom: -8, left: -8 }`, click → `onActivate`. Eligible = bo `kind==='occurrence'` && `canvas.document.objectDefinitions.get(bo.definitionId)?.linkedModelIds.length > 0`. Dblclick: `canvas.eventBus.on('element.dblclick', 2000, handler)`; eligible ⇒ `onActivate` + `return false`; NOT eligible ⇒ return undefined (lets direct-edit @1500 run). Resync on `ARIS_DOCUMENT_CHANGED` + explicit `resync()`.
- [x] `ArisStudioTab.tsx`: install effect mirroring the validation-overlay install (deps: canvas readiness); resync on `[renderableModelId, history.revision]`. `openAssignedModelId(modelId)`: in-doc ⇒ `canvas.setActiveModel(modelId)` + `onModelChange(modelId)`; else `onOpenAssignedModel?.({ linkedModelIds:[modelId], definitionId, definitionName })`. Activation handler iterates `linkedModelIds`, first in-doc wins, else delegates the whole list. Toolbar `Link model…` button (`t('aris.assign.link')`, `data-orbitpm-aris-link-model`) enabled when the single selection is an `OT_FUNC` occurrence; opens `LinkPicker` with `index = workspaceModelIndex ?? indexFromDocumentModels(liveDocument)` (local helper building `ProcessEntry`s with `relPath: sourceFileName ?? title`); pick ⇒ `canvas.authoring.addModelAssignment(definitionId, modelId)` + toast `aris.assign.linked`. Fire `onLiveDocumentChange(history.document)` from the history-publish path. Findings: pass `new Set(workspaceModelIndex?.keys() ?? [])` as `externallyKnownModelIds`.
- [x] `arisEpcFindings.ts`: third param unions into `knownModelIds` so cross-file assignments aren't flagged `epc.linkedModel.danglingReference`.
- [x] Rail: thread optional `onOpenAssignedModel?: (modelId: string) => void` to `ArisAssignmentsEditor`; each row gains an Open button (`t('aris.assign.open')`, aria `aris.assign.open.aria`).
- [x] Add new props to `ArisStudioTab` as OPTIONAL (`workspaceModelIndex?`, `onOpenAssignedModel?`, `onLiveDocumentChange?`) — only T8 supplies them. CSS clone of the warning-marker block, neutral color. Prettier.

**Tests assert:** opening a two-model fixture with a `LinkedModels.IdRefs` def shows `[data-orbitpm-aris-assignment]` on its occurrence and none elsewhere; marker click for an in-document target switches the canvas (target occ appears) + calls `onModelChange`; `fireEvent.dblClick` on the shape gfx does the same; removing the assignment via the rail removes the marker; a foreign id calls `onOpenAssignedModel` with the exact id list; Link button disabled for an event, enabled for a function; picking in `LinkPicker` adds the assignment (def `linkedModelIds` contains it; undo removes; marker toggles); a dangling in-doc assignment no longer produces `epc.linkedModel.danglingReference` when the id is in `externallyKnownModelIds`; rail Open calls the callback.

**Verify:**

```bash
npx vitest run src/aris/shell
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary && npm run check:no-skips
```

**Do NOT touch:** `ArisApp.tsx`/`ArisExplorerPane.tsx` (T5), split modules (T7).

---

## Lane T7 — Split-import staging + review dialog

**Wave:** 2 · **Worker:** kimi-k2.7 · **Depends on:** T2, T4
**Files owned (create):** `src/aris/shell/arisSplitImport.ts`, `src/aris/shell/ArisSplitImportDialog.tsx`, `src/aris/shell/arisSplitImport.test.tsx`

**Read first:** `src/aris/source/amlSplit.ts` (T2), `src/workspace/liteTreeFromEntries.ts:145-171` (`uniquePathIn`), `src/aris/shell/arisExplorerActions.tsx:292-346` (the already-exists retry loop), `src/aris/shell/ArisImportReviewDialog.tsx` (dialog skeleton — DO NOT edit it, mirror it), `src/common/AccessibleDialog.tsx`, `src/workspace/adapters/memory.ts` (test adapter).

**Interface:**

```ts
export interface ArisSplitImportTarget {
  readonly modelId: string
  readonly modelName: string | null
  readonly relPath: string
  readonly bytes: Uint8Array
  readonly status: 'write' | 'skip-existing-model'
}
export interface ArisSplitImportPlan {
  readonly sourceName: string
  readonly targets: readonly ArisSplitImportTarget[]
  readonly writeCount: number
  readonly skipCount: number
}
export function prepareArisSplitImport(options: {
  readonly pkg: ArisXmlSourcePackage
  readonly baseFolderRel: string
  readonly takenPaths: ReadonlySet<string>
  readonly existingModelIds: ReadonlySet<string>
}): ArisSplitImportPlan
export interface ArisSplitImportOutcome {
  readonly written: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly { readonly relPath: string; readonly message: string }[]
}
export async function executeArisSplitImport(
  adapter: WorkspaceAdapter,
  plan: ArisSplitImportPlan
): Promise<ArisSplitImportOutcome>
export interface ArisSplitImportDialogProps {
  readonly open: boolean
  readonly plan: ArisSplitImportPlan | null
  readonly busy: boolean
  readonly dir: 'ltr' | 'rtl'
  readonly onConfirm: () => void
  readonly onCancel: () => void
}
export function ArisSplitImportDialog(props: ArisSplitImportDialogProps): JSX.Element | null
```

**Steps:**

- [x] `prepare`: `buildArisSplitPlan(pkg)` → per file: existing model id ⇒ `skip-existing-model`; else `relPath = uniquePathIn(taken, join(baseFolderRel, folderSegments), fileName)`, add to `taken`, encode `bytes` (UTF-8). `execute`: sequential `writeAtomic(path, bytes, undefined, { expectedMissing: true })` with the retry loop (≤50) re-suffixing on `already-exists`; collect failures, don't throw. Dialog: `AccessibleDialog`, list rows (skip rows labeled `aris.import.split.skipExisting`), confirm/cancel, `busy` disables confirm; all copy via `t()`.
- [x] Prettier + tests.

**Tests assert:** plan places files at `baseFolderRel + folderSegments`; collision ⇒ `-2` suffix; existing model id ⇒ `skip-existing-model` and excluded from `writeCount`; execute against the memory adapter writes exactly `writeCount` files; `expectedMissing` conflict retries with a new suffix; failures collected not thrown; dialog renders rows and fires confirm/cancel; busy disables confirm.

**Verify:**

```bash
npx vitest run src/aris/shell/arisSplitImport.test.tsx
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:no-skips
```

---

## Lane C4 — Palette sections + quick-pick + replace + dictionary keys

**Wave:** 2 · **Worker:** opus-4.8-1M · **Depends on:** C1; C3 (modules.ts)
**Files owned:** `src/aris/canvas/paletteProvider.ts` (modify), `src/aris/canvas/contextPadProvider.ts` (modify), `src/aris/canvas/quickPick.ts` (create), `src/aris/canvas/quickPick.test.ts` (create), `src/aris/canvas/paletteCatalog.test.ts` (create), `src/aris/canvas/authoring.ts` (modify), `src/aris/canvas/authoring.test.ts` (modify), `src/aris/canvas/modules.ts` (modify), `src/aris/canvas/arisQuickPick.css` (create), `src/i18n/dictionaries.ts` (modify — ALL wave-2/3 keys)

**Goal:** palette rebuilt from the catalog; post-placement quick-pick popover (same-type swap + guarded cross-type replace); context-pad "swap symbol"; `replaceNewObject` + `setModelAttribute`; register every wave-2/3 dictionary key (own + C6/C7's).

**Read first:** `paletteProvider.ts` (whole), `contextPadProvider.ts`, `authoring.ts:159-212,266-270`, `commandFactory.ts:308-330` (`setOccurrenceSymbolCommand`; the delete/create factories for `replaceNewObject`), `src/aris/conventions/*` (C1), `arisValidationOverlays.ts` (overlays usage), `modules.ts`, R1.

**Interface:**

```ts
// quickPick.ts
export interface ArisQuickPickMember { readonly objectType: string; readonly symbolNum: string; readonly labelKey: string; readonly enabled: boolean; readonly active: boolean }
export class ArisQuickPick { static $inject: readonly string[]; open(elementId: string): void; close(): void; membersFor(elementId: string): readonly ArisQuickPickMember[] }
export const ArisQuickPickModule: unknown
// authoring.ts additions
replaceNewObject(occurrenceId: string, target: { objectType: string; symbolNum: string }): CreateObjectResult
setModelAttribute(modelId: string, attributeType: string, values: Record<string, string>): void
```

**Steps:**

- [x] `authoring.replaceNewObject`: guard (definition has exactly 1 occurrence and 0 touching connection definitions, else throw `ArisCanvasCommandError('replace-not-safe')`); one `bridge.execute('replace-object', …)` `transactionCommand` of existing factories (delete occurrence + delete definition + create definition with the preserved name + create occurrence at the same bounds). `setModelAttribute` mirrors `setDefinitionAttribute` with kind `'model'`. Unit-test both (undo/redo both directions).
- [x] `paletteProvider.targets()` rebuilt from `getPaletteSymbols(modelType)`; groups flow/rule/org/data/system/governance + tools/annotation; default-symbol entries keep `create.ot_*` ids, variants `create.<ot>.<st>`; glyph table extended for new symbols; free-text entry creates `''` (direct-edit supplies text). Keep `arisObjectType`/`arisSymbolNum` on `ArisPaletteEntry`.
- [x] `quickPick.ts`: overlay popover (`{ position: { right: -8, top: 0 }, show: { minZoom: 0.4 } }`, `.aris-quick-pick[role=menu]`, buttons `[role=menuitemradio][aria-checked]` with the palette glyph + `t(labelKey)`; buttons handle `pointerdown` + `preventDefault()` so the direct-editing textbox keeps focus). `create.end` @ **260** → `open(shape.id)` when the placed symbol has a family. Same-objectType member → `authoring.setOccurrenceSymbol`; cross-objectType → `authoring.replaceNewObject` (member `enabled:false` + tooltip when the guard fails). Dismiss on outside click / selection change / Escape / re-open. Context-pad `swap-symbol` entry re-opens it for existing shapes.
- [x] `modules.ts`: register `arisQuickPick`. `arisQuickPick.css` + palette group separators (own CSS file — do NOT touch `shell.css`, owned by T6 this wave).
- [x] `dictionaries.ts`: register en+ar for ALL wave-2/3 keys: `aris.palette.*` (new symbols), `aris.symbol.*` (every catalog label), `aris.quickPick.*`, `aris.contextPad.swapSymbol`, `aris.conv.finding.*` (5 rules: illegalConnection, missingIdentifier, noExecutor, missingAttribute, namingHint — title + body each), `aris.connection.label.*` (canonical labels), and the details-schema labels `aris.attr.*` used by C6. Keep this list authoritative; C6/C7 consume via `t()` only.
- [x] Prettier + tests.

**Tests assert:** palette has one entry per `getPaletteSymbols('MT_EEPC')` with correct `arisSymbolNum`; placing `ST_FUNC` then picking "System function" → occurrence symbol `ST_SYS_FUNC_ACT`, single undo, definition intact; info-carrier variant swap; cross-type swap Role→Org-unit on a fresh shape → new definition `OT_ORG_UNIT`, old gone, bounds+name preserved, single undo restores both; cross-type entry disabled once the shape is connected; popover buttons don't steal focus (activeElement stays `.djs-direct-editing-content` while editing); i18n parity green.

**Verify:**

```bash
npx vitest run src/aris/canvas src/__tests__/i18n.test.ts
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary && npm run check:no-skips
```

**Do NOT touch:** `shapes.ts`, `vocabulary.ts`, `directEdit.ts`, `shell.css`, `ArisStudioTab.tsx`.

---

## Lane C5 — Symbol descriptors + vocabulary alignment

**Wave:** 2 · **Worker:** sonnet-med · **Depends on:** C1
**Files owned:** `src/aris/symbols/shapes.ts` (modify), `src/aris/canvas/vocabulary.ts` (modify), `src/aris/symbols/symbols.test.ts` (modify), `src/aris/canvas/objectTypes.test.ts` (modify), `src/aris/canvas/occurrenceStyle.test.ts` (modify)

**Goal:** a descriptor for every catalog symbol; DMT default fills from conventions; vocabulary extended and its connection resolver delegated.

**Read first:** `shapes.ts` (whole), `registry.ts` (fallback order — leave unchanged), `src/aris/conventions/catalog.ts` (C1), `vocabulary.ts` (whole), grep for hardcoded pastel hexes in the three tests, R1.

**Steps:**

- [x] Add `describe`-style descriptor builders (original line-art geometry) for every catalog symbol missing today: org unit (ellipse-in-bar), position (star), group (people), internal person, info-carrier variants (envelope/phone/letter/log/folder/general), risk (warning triangle), SLA/law (shield variants), service/product (box), VACD start chevron, process interface, data entity (dark-red box). Swap all fills to `conventionDefaultFill(...)` from C1. Extend `ARIS_OBJECT_TYPE_DEFAULT_SYMBOL` for new OT_*.
- [x] `vocabulary.ts`: extend `ARIS_CANVAS_OBJECT_TYPES` (+`OT_ORG_UNIT`,`OT_POS`,`OT_GRP`, plus catalog additions) and `ARIS_SATELLITE_OBJECT_TYPES`; replace `CONNECTION_RULES`/`resolveConnectionType` INTERNALS with delegation to `conventions/connectionRules.resolveConventionConnection` returning the identical `{connectionType, fallback}` shape (public signature unchanged so existing callers/tests hold).
- [x] Update the three tests for the new fills (Function descriptor body fill === `#339900`) and new resolvable types; keep all existing resolution assertions.
- [x] Prettier.

**Tests assert:** every `ARIS_CONVENTION_SYMBOLS` row resolves via `resolveArisSymbol` with ZERO fidelity findings; Function descriptor fill `#339900`; `resolveConnectionType('MT_EEPC','OT_EVT','OT_FUNC')` still `CT_ACTIV_1`; new executor triples resolve to `CT_EXEC_*`.

**Verify:**

```bash
npx vitest run src/aris/symbols src/aris/canvas/objectTypes.test.ts src/aris/canvas/occurrenceStyle.test.ts && npm run test:aris:animalwf
npm run typecheck && npm run lint && npm run check:no-skips
```

`npm run test:aris:animalwf` MUST stay green — imported occurrences carry authored brushes; if any imported color changed, the descriptor default leaked past the authored-brush precedence — fix that, do not weaken the test.

**Do NOT touch:** `paletteProvider.ts`, `renderer.ts`, `registry.ts` resolution order.

---

## Lane T8 — App capstone: import flow, cross-file navigation, create-missing

**Wave:** 3 · **Worker:** opus-4.8-1M · **Depends on:** T5, T6, T7, T3
**Files owned:** `src/ArisApp.tsx` (modify), `src/aris/shell/arisExplorerActions.tsx` (modify), `src/aris/shell/__tests__/arisExplorerActions.test.tsx` (modify), `src/aris/shell/ArisNewModelDialog.tsx` (modify), `src/ArisApp.test.tsx` (modify — includes authorized updates), `src/aris/shell/ArisExplorerPane.tsx` (single `onStageImport` prop)

**Read first:** T5's ArisApp state, T6's StudioTab optional props, T7's contracts, `src/ArisApp.tsx:684-800` (`handleImportInput`, `handleCreateBlankModel`), the main-flow blueprint (Design A in the plan file: `openCanonicalProcess`/`handleCreateMissingProcess` semantics).

**Steps:**

- [x] `handleImportInput` multi-file branch: per file → BPMN-reject toast as today; `createArisXmlSourcePackage`; `index.models.size === 0` ⇒ toast `aris.import.split.nothing` (no tab); else accumulate ONE combined `ArisSplitImportPlan` (thread `takenPaths` across the batch; `existingModelIds` = `mergedLinks.index` keys ∪ `graph.ambiguousProcessIds`); open `ArisSplitImportDialog`; confirm ⇒ `executeArisSplitImport` ⇒ `refreshWorkspaceSources` ⇒ toast `aris.import.split.done` ⇒ `requestTreeReveal(undefined, firstWritten)`. Single-file branch UNCHANGED.
- [x] Tree-drop: add `onStageImport` to `UseArisExplorerActionsOptions` and pass it from `ArisExplorerPane` (the single prop addition this wave); AML-with-models drops route to the same staged dialog with `baseFolderRel = toFolderRel`; other files keep the legacy verbatim write.
- [x] `handleOpenAssignedModel(request)`: first id with `mergedLinks.index.has(id)` ⇒ `openCanonicalProcess(id)`; else first id in `graph.ambiguousProcessIds` ⇒ toast `aris.assign.ambiguous`; else multi-file ⇒ `setNewModelRequest({ folderRel: parentFolderOf(activeTabRelPath ?? ''), forcedModelId: ids[0], presetName: humanize(ids[0]), linkContext: request.definitionName })`; single-file ⇒ toast `aris.assign.missing`. `humanize` strips the `Model.` prefix.
- [x] `handleCreateBlankModel` passes `modelId: forcedModelId` (from T3's spec); on success with a `forcedModelId`: toast `aris.assign.created` + reveal + open (the assignment resolves because the child's Model.ID matches the dangling id — no parent edit).
- [x] `ArisNewModelDialog`: optional `preset?: { name; modelId; linkContext } | null` — prefill name, lock type to the EPC default, show `aris.newModel.linkedHint`.
- [x] Wire `workspaceModelIndex={mergedLinks.index}`, `onOpenAssignedModel`, and `onLiveDocumentChange={(doc) => tab.relPath && handleLiveScanChange(tab.relPath, doc ? deriveArisLinksFromDocument(doc) : null)}` into `ArisStudioTab`; clear overlay entries on tab close and remap keys on rename/move.
- [x] Prettier.

**Tests (ArisApp.test.tsx — new + AUTHORIZED updates):** multi-file import splits to FILES not tabs (dialog rows; confirm ⇒ written paths under the group folder; no new tab; tree gains rows); second identical import ⇒ all rows skipped, zero writes; cancel writes nothing; create-missing (dangling assignment → marker/dblclick → prefilled dialog → create ⇒ file in the parent's folder with Model.ID = the dangling id ⇒ tree nests it); cross-file open (marker click with resolvable child ⇒ child tab opens + model active); live overlay (Link in tab A to model of file B ⇒ tree nests B under A with NO disk write; undo ⇒ un-nests). Single-file/§7.3/BPMN-reject tests stay green unmodified.

**Verify:**

```bash
npx vitest run src/ArisApp.test.tsx src/aris/shell
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary && npm run check:no-skips
```

---

## Lane T9 — animalwf node integration

**Wave:** 3 · **Worker:** kimi-k2.7 · **Depends on:** T1, T2, T7
**Files owned (create):** `src/aris/shell/arisNestedProcesses.animalwf.test.ts`

**Read first:** `src/workspace/adapters/memory.ts`, T1/T2/T7 exports, `vitest.animalwf.config.ts`, an existing `*.animalwf.test.ts` header.

**Steps/assertions:** load the monolith → `buildArisSplitPlan` → `executeArisSplitImport` into a memory adapter → `scanArisWorkspaceLinks` over the listing → `buildLiteTreeFromEntries` + `buildProcessHierarchy` ⇒ root has ONE folder (`Animal Welfare`), the VACD file row owns exactly 7 EPC rows, `ownerCallCount === 1` each, an owned child's `ancestorRowKeys` contains the VACD row key; simulate `adapter.move` of one EPC into a new folder → rescan → still owned by the VACD with identical row `key` (rename-safe links); a synthetic 3-level chain (add a `LinkedModels.IdRefs` VACD→EPC→EPC) nests 3 deep. Prettier.

**Verify:**

```bash
npm run test:aris:animalwf && npm run typecheck && npm run lint && npm run check:no-skips
```

---

## Lane C6 — Details-rail schema editors

**Wave:** 3 · **Worker:** sonnet-med · **Depends on:** C1, C4 (`setModelAttribute` + `aris.attr.*` keys)
**Files owned:** `src/aris/details/tabs.ts` (modify), `src/aris/shell/ArisDetailsEditors.tsx` (modify), `src/aris/shell/arisDetailsEditing.ts` (modify), `src/aris/details/tabs.test.ts` (modify), `src/aris/shell/ArisDetailsRail.editing.test.tsx` (modify)

> Note: `ArisDetailsEditors.tsx` and `ArisDetailsRail.editing.test.tsx` are also touched by T6 in Wave 2 — C6 runs AFTER T6 merges (different wave). Confirm T6 is merged before starting.

**Read first:** `tabs.ts:274-310` (`buildAttributesTab`), `ArisDetailsEditors.tsx:380-430`, `arisDetailsEditing.ts` (the editing seam), `src/aris/conventions/attributes.ts` (C1), `arisValidationFindings.ts:181-218` (railTarget contract — schema rows keep `attribute` targets addressable).

**Steps:**

- [x] `buildAttributesTab` merges schema rows: attributes from `schemaForObjectType`/`schemaForModelType` with no stored value → a row flagged missing (`bilingual: { enMissing: true, arMissing: true }`) so the existing missing-value highlight + editors light up; mandatory badge from the schema. Editor accepts a schema-declared attribute that does not exist yet (create-on-first-save via `setDefinitionAttribute` / C4's `setModelAttribute` through the `arisDetailsEditing` seam). Every string via `t()` using C4's `aris.attr.*` keys.
- [x] Prettier + tests.

**Tests assert:** an `OT_FUNC` definition without `AT_ID` shows an `AT_ID` row flagged missing; saving writes the attribute (undoable); an EPC model shows the 10 model-schema rows; `check:ui-copy` passes.

**Verify:**

```bash
npx vitest run src/aris/details src/aris/shell/ArisDetailsRail.editing.test.tsx
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:no-skips
```

**Do NOT touch:** `dictionaries.ts`, `authoring.ts`.

---

## Lane C7 — Convention validation rules

**Wave:** 3 · **Worker:** sonnet-med · **Depends on:** C1, C4 (`aris.conv.finding.*` keys)
**Files owned:** `src/aris/conventions/validate.ts` (create), `src/aris/conventions/validate.test.ts` (create), `src/aris/shell/ArisStudioTab.tsx` (one-line append), `src/aris/shell/arisValidationFindings.test.ts` (modify)

> Note: `ArisStudioTab.tsx` is owned by T6 in Wave 2 — C7 runs AFTER T6 merges and makes a SINGLE append to the findings-assembly array.

**Read first:** `arisEpcFindings.ts` (finding shape + `EpcFinding` import), `arisValidationFindings.ts` (unknown `ruleId` → kind `'invalidSequence'` fallback; model-scoped `fallbackModelId`; markers via `nodeIds` — all verified present), `epc/validate.ts` (rule style), `src/aris/conventions/{connectionRules,attributes}.ts`, `ArisStudioTab.tsx` findings assembly (grep `buildArisEpcFindings`).

**Interface:**

```ts
export const CONVENTION_RULE_IDS: readonly string[] // 5 ids
export function buildConventionFindings(
  document: ArisWorkingDocument,
  modelIds?: ReadonlySet<string>
): readonly ArisEpcModelFinding[]
```

**Steps:**

- [x] Five rules emitting `ArisEpcModelFinding`-shaped rows (warning): `conv.connection.illegal` (nodeIds=[cxnOccId]; params from/to/type; via `isLegalConnection`), `conv.function.missingIdentifier` (nodeIds = the definition's occurrence ids; no `AT_ID`), `conv.function.noExecutor` (function with no incoming `CT` whose `raci==='R'` from an executor object type), `conv.model.missingAttribute` (model-scoped: empty nodeIds + modelId → fallback reveal; mandatory schema attribute absent), `conv.naming.hint` (name >60 chars or trailing period). Messages via C4's `aris.conv.finding.*` keys.
- [x] `ArisStudioTab.tsx`: append `buildConventionFindings(document)` to the `epcFindings` array before `buildArisValidationFindings` (one statement).
- [x] Prettier + tests.

**Tests assert:** synthetic docs trigger each rule exactly once; a legal DMT wiring triggers none; `buildArisValidationFindings` maps a conv row to kind `invalidSequence`, keeps `ruleId`, and lands markers on the connection element. `arisValidationFindings.test.ts` gains a conv-pass-through case.

**Verify:**

```bash
npx vitest run src/aris/conventions/validate.test.ts src/aris/shell/arisValidationFindings.test.ts && npm run test:aris:animalwf
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:no-skips
```

**Do NOT touch:** `gapScanner.ts`, `deterministicFixes.ts`, `arisValidationFindings.ts`, `ArisFixMissingDialog.tsx`.

---

## Lane C8 — Measured fidelity fix loop

**Wave:** 3 · **Worker:** opus-4.8-1M · **Depends on:** C2, F1, F2, C5
**Files owned:** `src/aris/canvas/canvasSync.ts`, `src/aris/canvas/renderer.ts`, `src/aris/canvas/elements.ts`, `src/aris/model/buildFromSource.ts`, `src/aris/canvas/svg.ts` (marker helper), NEW `src/aris/canvas/attributeLabels.test.ts` + `src/aris/canvas/attributeLabels.animalwf.test.ts`, updates to `src/aris/canvas/freeTextLayout.test.ts`/`connectionLabels.test.ts` siblings and the two ITERATE fidelity suites' `BASELINE` consts (F1's files — F1 finished in Wave 1, free now)

**Goal:** close the measured gaps on the 2 iterate models to the completion bar; ratchet the iterate baselines to exact.

**Read first:** `canvasSync.ts:409-560,641-830` (`syncLabels` projects only AT_NAME today; `syncConnectionLabels` is the mirror pattern to copy for all occurrence AttrOccs), canvas `renderer.ts` (`drawConnection` has NO arrowheads), `buildFromSource.ts` (pen width/style deliberately nulled), `renderer/buildRenderModel.ts` (AttrOcc placement semantics — port/offset), `waypoints.ts`, R4/R5, the latest `aris-fidelity-report` output.

**Protocol (iterate→fix→re-measure loop):**

- [x] Run `npx vite-node scripts/aris-fidelity-report.ts`; snapshot per-category counts.
- [x] Fix ONE category, in this order: (1) occurrence AttrOcc labels — generalize `syncLabels` to ALL occurrence `attributeOccurrences` (mirror `syncConnectionLabels`: per placement → label element `label:<occId>:<idx>:<attrType>`, text = the definition's attribute value of that type, rect from a generalized `attributePlacementRect(placement, bounds)` reusing the `externalNameRect` math; AT_NAME keeps the name path), so function numbers (`AT_PROC_CODE`/`AT_ID`) render under boxes; (2) arrowheads — `drawConnection` emits a shared `marker-end` via an `svg.ts` helper; (3) connection pen — honor bo pen color/width/dash (`elements.ts` connection bo gains pen fields); (4) occurrence pen width/style carry from source in `buildFromSource` (today nulled) into `occurrence.style`.
- [x] Re-run the report + `npm run test:aris:animalwf`; ratchet the iterate suites' BASELINE for that category to exact/0.
- [x] Repeat until the **completion bar**: topology exact (spine/gates/satellites/counts 0 diffs), numbering exact, symbol exact, color exact where PDF-confirmed, label-rect geometry within ±2px. Frames (`GfxObj`/`RoundedRectangle`)/`Union`/OLE placeholders only if the report shows them on the iterate models (expected out-of-bar — VACD/decorative; record the verdict in the report artifact).
- [x] Prettier. Keep `rawAttributes`/source anchors untouched so `arisDerivedExport` round-trip is unperturbed.

**Verify:**

```bash
npm run test:aris:animalwf                                  # BOTH iterate models fully exact (BASELINE zeros)
npx vitest run src/aris/shell/arisDerivedExport.test.ts     # REQUIRED — pen carry must not break round-trip
npm test
npm run typecheck && npm run lint && npm run check:no-skips
```

**NEVER** run the holdout config. **Do NOT touch:** `shapes.ts`, `vocabulary.ts`, `writer/`, `arisDerivedExport.ts`, holdout files.

---

## Lane E1 — e2e: nested processes

**Wave:** 4 · **Worker:** sonnet-med · **Depends on:** everything through Wave 3
**Files owned (create):** `tests/e2e/aris-nested-processes.spec.ts`

**Read first:** `tests/e2e/aris-explorer-tree.spec.ts` (loopback-HTTP + OPFS harness + webkit persistent-context workaround — copy both verbatim), `tests/e2e/aris-authoring.spec.ts` (palette placement + import via `setInputFiles`).

**Steps:** OPFS workspace: New model `Parent`; place a Function; New folder `subs` + New model `Child` inside; select the function → `Link model…` → pick Child ⇒ `[data-orbitpm-aris-assignment]` visible; tree shows Child nested under Parent (owned row); dblclick the function shape ⇒ Child's tab activates; rename `Child.aml` → `Renamed.aml` in the tree ⇒ marker dblclick still opens it; delete it ⇒ dblclick opens the prefilled New-model dialog (create-missing) ⇒ create ⇒ file exists again in Parent's folder. Chromium + firefox + webkit. Prettier.

**Verify:**

```bash
npm run build && npx playwright test tests/e2e/aris-nested-processes.spec.ts
```

**Do NOT touch:** `src/` — if a selector hook is missing, report back.

---

## Lane E2 — e2e: import split

**Wave:** 4 · **Worker:** kimi-k2.7 · **Depends on:** everything through Wave 3
**Files owned (create):** `tests/e2e/aris-import-split.spec.ts`

**Read first:** `aris-authoring.spec.ts` (fixture import pattern, 3-engine quirks, webkit workaround), `aris-explorer-tree.spec.ts` (OPFS harness).

**Steps:** Scenario A (synthetic inline AML, 2 bilingual groups + a VACD with 2 assignments + 2 EPCs): Import button → dialog lists 3 target paths under the group folder names → confirm → tree shows folders + nesting (VACD owns 2) → dblclick a chevron ⇒ EPC opens. Scenario B (reference): `setInputFiles(resolve(HERE,'../../../reference/AnimalWF/ARISAMLExport.xml'))` → confirm → 8 files, `Animal Welfare` folder, the VACD row owns 7 children (assert the owned-row count) → re-import ⇒ dialog all-skipped. Chromium + firefox + webkit. Prettier.

**Verify:**

```bash
npm run build && npx playwright test tests/e2e/aris-import-split.spec.ts
```

---

## Lane E3 — e2e: fidelity screenshots + interaction + scripts

**Wave:** 4 · **Worker:** sonnet-med · **Depends on:** everything through Wave 3
**Files owned:** `tests/e2e/aris-fidelity-screenshots.spec.ts` (create), `tests/e2e/aris-canvas-interaction.spec.ts` (modify — append), `package.json` (modify — scripts)

**Read first:** `aris-authoring.spec.ts` (fixture import), `aris-canvas-interaction.spec.ts`, `playwright.config.ts`.

**Steps:**

- [x] `aris-fidelity-screenshots.spec.ts`: import the reference fixture via `setInputFiles`, open each iterate model, `page.screenshot({ fullPage: false })` of the canvas → `test-results/fidelity/<model>-<browser>.png`. GATED (3 engines): model opens; exact occurrence-element count; `[data-aris-fidelity]` (symbol fallback) count === 0 for iterate models; ≥1 label element with `data-aris-caption` under a function (numbering visible). NOT gated: pixels.
- [x] `aris-canvas-interaction.spec.ts` append: palette place → type "Approve request" → Enter → SVG caption appears; dblclick → edit; quick-pick swap visible.
- [x] `package.json` scripts: `"test:aris:animalwf:holdout": "vitest run --config vitest.animalwf.holdout.config.ts"`, `"test:aris:fidelity-report": "vite-node scripts/aris-fidelity-report.ts"`. Prettier.

**Verify:**

```bash
npm run build && npm run test:e2e
npm run typecheck && npm run lint && npm run check:no-skips
```

**Do NOT touch:** `src/`.

---

## Lane X1 — i18n final sweep

**Wave:** 4 · **Worker:** sonnet-med · **Depends on:** everything
**Files owned:** `src/i18n/dictionaries.ts` (modify), `src/aris/shell/shellI18n.ts` (modify only if a `tk()` key needs registration)

**Steps:**

- [x] Grep the whole `src/aris` + `src/ArisApp.tsx` for any `t('…')`/`tk('…')` key not present in both dictionaries (or `ARIS_SHELL_MESSAGE_KEYS`); register any stray key en+ar. Confirm `check:ui-copy` and `i18n.test.ts` green. Prettier.

**Verify:**

```bash
npx vitest run src/__tests__/i18n.test.ts && npm run check:ui-copy && npm run typecheck && npm run lint && npm run check:no-skips
```

---

## Wave 5 — Final verification & ship (orchestrator)

- [ ] `npm run test:aris:animalwf:holdout` — FIRST tuning-free run; both holdout models pass. Red → escalation protocol (fable-xhigh debug-only → opus applies) → fix in the owning lane's files → re-verify BOTH iterate and holdout sets.
- [ ] Full suite:

  ```bash
  npm run format:check && npm run lint && npm run typecheck \
    && npm run check:aris-runtime-boundary && npm run check:ui-copy \
    && npm run check:no-skips && npm run check:lite-only && npm run check:lock \
    && npm test && npm run test:aris:animalwf && npm run test:aris:animalwf:holdout \
    && npm run test:e2e \
    && npm run build:aris && npm run check:aris-studio-artifact && npm run check:size
  ```

- [ ] Tick every remaining checkbox; fill the "Resolution evidence" section (one entry per issue with the command/test that proves it).
- [ ] Final commit (fresh artifact) + push + final report per `goal.md`.

---

## Wave 6 — Visual / Render Fidelity Overhaul (RE-OPENED after live PDF comparison)

> **Why this wave exists.** Waves 1–5 measured import fidelity with the `compare.ts`
> comparator (the data MODEL: symbol numbers, connections, attribute values) and with the
> holdout suite. Both went green. But a live import of `ARISAMLExport.xml` into the built
> `release/OrbitPM-ARIS-Studio-Lite.html`, viewed in the browser and compared against the 4
> reference PDFs, shows the RENDERED output is nowhere near the PDFs. The comparator is
> topology-blind (the FidVerify audit warned of exactly this: "comparator-zero is not evidence
> of rendered fidelity"). **`Issue 4` is NOT resolved.** This wave fixes the actual rendering and
> adds a real visual gate so a broken render can never pass again.

### Evaluation — actual render (register-owner, 94 occ) vs `Register_Animal_Owner_Profile_Draft03.pdf`

Captured facts (chromium, built artifact) + PDF legend comparison:

- **Control flow broken — `410 errors · 324 warnings`, "disconnected from the main control flow"
  (`epc.connectivity.orphanNode`).** ROOT CAUSE: production `src/aris/epc/constants.ts`
  `FLOW_CONNECTION_TYPES` excludes `CT_IS_PREDEC_OF_1` (the DMT FUNC→FUNC sequence connector,
  28× in the fixture) — the Wave-5 fidelity fix added it to a COMPARATOR-LOCAL set only, so
  production validation/layout still treat every function as an orphan. The DMT convention is NOT
  strict EPC alternation; direct FUNC→FUNC steps (numbered 01→02→…) are legal and must be treated
  as control flow.
- **Object icons entirely missing — `images:0`, `use:0`, no icon geometry.** In the PDF every
  object carries a distinctive glyph (Application System = monitor, Role/Person = person,
  System Function = ▶▶, Event = arrow-chevron, SLA/Risk = shield/△, Document = doc, Email =
  envelope, etc.). The render draws plain colored boxes. C5's descriptor builders are either not
  emitting icon paths or the renderer is not drawing them.
- **Colors wrong vs the PDF / convention legend.** Measured fills: Application System `#d7c49d`
  (tan) — PDF is light **blue**; Event `#dcbbed` (lavender) — PDF is **pink**; plus spurious
  `#fde047` (yellow ×3) and `#fb923c` (orange ×1) that appear in NO PDF. The DMT convention-manual
  colors must be the authoritative per-object-type fills, and the authored-Brush-vs-convention
  precedence must be resolved so the on-canvas colors match the PDF.
- **Shapes wrong.** Events render as flat hexagons; PDF events are the ARIS arrow/chevron pentagon.
  Verify every object type's silhouette against the manual (functions rounded-rect w/ icon band,
  gates as circle+operator, satellites as rect+icon).
- **Layout does not match the source ARIS coordinates / PDF.** The PDF is a clean top-to-bottom
  spine of numbered functions with satellites arranged left/right and orthogonal connectors; the
  render is scattered, satellites tiny/misplaced. Import must honor the AML `ObjOcc` geometry
  faithfully (position, size, satellite offset) so the imported diagram reproduces the PDF layout.
- **Annotations missing.** No RACI letters (R/A/C/I) on role connectors; function numbering
  (`AT_PROC_CODE`/`AT_ID` 01,02,…) present as 14 labels but not clearly placed under the boxes as
  in the PDF; the print-frame legend/header/Reference-Laws box are not rendered (decide in-scope).
- Present and OK: 93 arrowheads (Phase B), 117 captions, correct symbol NUMBERS in the data model.

Renew-profile (46 occ) shows the same pattern. The 2 holdout models must be evaluated the same way.

### Fix lanes (Wave 6 — file-disjoint; product code, NOT test-only)

- [ ] **V1 — DMT control-flow semantics.** Owner: opus-4.8-1M. Files: `src/aris/epc/constants.ts`,
      `src/aris/epc/flowGraph.ts` (+ tests), `src/aris/epc/validate.ts` (+ tests). Treat
      `CT_IS_PREDEC_OF_1` FUNC→FUNC as control flow in PRODUCTION so the spine connects and orphan
      errors clear; update EPC alternation so a DMT FUNC→FUNC step is legal (not an `epc.alternation`
      error). Target: a reference-model import shows **0 `orphanNode` / `alternation` errors**. Re-verify
      `realData.animalwf.test.ts`, `test:aris:animalwf`, `arisDerivedExport` stay green; then the Wave-5
      comparator can DERIVE its flow set from the production one (remove the comparator-local copy —
      drift risk noted by FidVerify).
- [ ] **V2 — symbol icons + shapes.** Owner: opus-4.8-1M. Files: `src/aris/symbols/shapes.ts`,
      `src/aris/symbols/registry.ts`, `src/aris/canvas/renderer.ts`, `src/aris/canvas/elements.ts`
      (+ their tests). Every convention symbol must render its icon glyph and correct silhouette per
      `../reference/conventions/ARIS_Convention_Manual_DMT_v02.pdf` and the process-PDF legends:
      Event chevron, System-Function ▶▶, App-System monitor, Role/Person person, SLA/Risk shield/△,
      Document/Email/SMS/Letter/Log info-carrier glyphs, XOR/OR/AND gate operators. Assert an icon
      element exists per occurrence (no bare boxes).
- [ ] **V3 — DMT convention colors.** Owner: sonnet-med. Files: `src/aris/conventions/catalog.ts`
      (+ test), `src/aris/canvas/vocabulary.ts`/occurrence-style (+ tests). Set each object type's
      default fill to the manual/PDF color (App-System blue, Event pink, Function green `#339900`,
      Role grey, Business-Rule/SLA/Regulation red family, Requirement pink, Service, etc.). Eliminate
      the `#fde047`/`#fb923c`/`#d7c49d` mis-mappings. Resolve authored-Brush precedence so imported
      occurrences match the PDF (if ARIS renders the symbol default over the stored Brush for a type,
      mirror that). Keep `test:aris:animalwf` meaningful (update expectations to the PDF-correct colors).
- [ ] **V4 — source-coordinate layout fidelity.** Owner: opus-4.8-1M. Files:
      `src/aris/canvas/canvasSync.ts`, `src/aris/model/buildFromSource.ts`,
      `src/aris/renderer/buildRenderModel.ts` (+ tests). Reproduce the AML `ObjOcc` positions/sizes and
      satellite offsets so the imported diagram matches the PDF geometry; orthogonal connector routing.
- [ ] **V5 — RACI + numbering placement (+ optional print frame).** Owner: sonnet-med. Files:
      canvas connection-label + attribute-label placement (+ tests). Render R/A/C/I on the correct
      connectors; place the function number under/beside the box as in the PDF. Legend/header frame:
      spike and decide (may be a separate deliverable — record the verdict).
- [ ] **V6 — palette UX.** Owner: sonnet-med. File: `src/aris/canvas/arisQuickPick.css` / palette
      styling. The catalog palette is 94×754px — taller than the canvas, clipping entries and
      shadowing shapes at Zoom-Fit (surfaced during e2e). Add max-height + internal scroll or a third
      column so it never covers the diagram.

### Wave 6 — the visual regression gate (so this is never untested again)

- [ ] **VG1 — real screenshot baselines.** New `tests/e2e/aris-visual-fidelity.spec.ts`: import
      `ARISAMLExport.xml`, open each of the 4 PDF-backed models (register-owner, renew-profile,
      transfer-citizens, transfer-citizens-companies), Zoom-Fit, and `await expect(canvas)
.toHaveScreenshot('<model>.png', { maxDiffPixelRatio: <tuned> })`. The committed baseline PNGs
      are **human-approved to match the PDFs** (an orchestrator/user checkpoint — a baseline is only
      accepted after visual sign-off vs the PDF, never auto-generated blind). Runs on all 3 engines.
- [ ] **VG2 — structural render gates** (fast, deterministic, in the same spec): for each reference
      model assert — **0 EPC validation errors** on import; **every occurrence has an icon element**
      (no bare box); each object type's rendered fill equals its DMT convention color; events use the
      chevron path; XOR/OR/AND gates use the correct operator glyph; RACI labels present on the
      expected role connectors; function-number labels present under functions; occurrence
      positions/sizes within ±Npx of the AML source coordinates (layout fidelity). These catch the
      exact defects this wave fixes without depending on pixel exactness.
- [ ] **VG3 — wire into the release gate.** Register the new spec in
      `scripts/release-suite-manifest.mjs`; add an `npm run test:aris:visual` script; include it in the
      Wave-5 full-suite command. A red render fails the build.

### Wave 6 also folds in the stale-spec e2e repairs (from the fable e2e debug — TEST-only, no src)

The full-3-engine `npm run test:e2e` "16 chromium failures" were mis-measured (playwright
`globalTimeout: 600_000` killed the run mid-firefox — "160 did not run"; the failures reproduce on
all engines). All are STALE ASSERTIONS vs authorized branch changes, no product bug:

- [ ] **E-fix-A** — `aris-validation.spec.ts`, `lite-mandatory-translation.spec.ts`,
      `lite-mandatory-ai-security.spec.ts`: remove the `[data-orbitpm-aris-model]` count==1 readiness
      waits (model-explorer is now gated to `>1` models — authorized) and use the ObjOcc-attached wait;
      update `aris-validation` marker counts 5/4/5 → 7/6/7 (C7 added convention rules).
- [ ] **E-fix-B** — `aris-details-editing.spec.ts`: park the catalog palette via its grip before
      Zoom-Fit+click (until V6 lands); `aris-authoring.spec.ts`: replace the stale 17-entry
      `PALETTE_CREATE_ACTIONS` with the catalog's 28 `create.*` ids; `aris-explorer-tree.spec.ts`:
      assert the nested row is focused instead of the now-semantic `data-tree-key`
      (`file:[processIds]`, T5/T8 authorized).
- [ ] **E-fix-C** — `playwright.config.ts`: raise `globalTimeout` (≥45 min) so a 3-engine run
      completes; verify each of the 6 specs on chromium+firefox+webkit.

### Wave 6 exit gate

- [ ] All 4 PDF-backed models import with **0 EPC validation errors**, icons present, DMT colors,
      correct shapes, source-faithful layout — verified by the human-approved screenshot baselines AND
      the structural gates on chromium+firefox+webkit.
- [ ] Full suite (incl. `test:aris:visual` + full `test:e2e`) green; artifact rebuilt; pushed.
- [ ] Re-do the live browser check on the rebuilt artifact and confirm against the PDFs.

### Wave 6 ULTRA verification addendum (2026-07-31) — binding corrections and expansion

> **Status and precedence.** This addendum is the result of a second, independent audit of all 49
> convention-manual pages, the four supplied PDFs, the AML, the production render path, and live SVG
> output for all four expected model IDs. It is part of Wave 6. Where it conflicts with the provisional
> Evaluation/V1–V6/VG1–VG3/exit wording above, **this addendum wins**. Correct provisional work is
> retained; false diagnoses and impossible gates are explicitly superseded below. Wave 6 is not
> file-disjoint: V2–V5 share the renderer, element contracts, and canvas synchronization. Run them
> serially under one visual-integration owner, or give those shared files to one owner.

#### Verified evidence and ground-truth classification

The live capture imported SHA-256
`38db10f0e2160eeb116e2b02564cd0a44662c24a18cb1c3ad82ade608b7926f5`, opened each
model by exact ID, invoked Zoom Fit, and serialized every occurrence, primitive, caption, attribute
label, connection path, marker, and warning. The scratch capture and audit artifacts are outside the
repository at `/home/ahmed/.claude/jobs/501f0ce4/tmp/codex_ultra/live_capture/`.
The 49-page manual SHA-256 is
`80852f6c2d9e9111515ea4c998806e8fa40167fb5a7c78c3c787dc0d6d08dab0`; the canonical
decoded logo PNG is
`f1566e2bc06682790f94b4e4b88f40e778bda25c6fbcd4c7d665ba300dc7e649`, and the
transparent convention/RACI legend PNG is
`db1460c17ba4bc4083f637b795250e1c26ae9c25ea4d652b7a83d65642624fd0`.

| Target                      | Model.ID                 | PDF status                                                  | ObjOcc / CxnOcc | Functions / events / gates | Source number labels | Expected RACI | Source routes changed by current endpoint docking |
| --------------------------- | ------------------------ | ----------------------------------------------------------- | --------------: | -------------------------- | -------------------: | ------------- | ------------------------------------------------: |
| register-owner              | `Model.3xqe8yXO9Z7-u-L`  | PDF-exact, SHA `fabb7128…`                                  |         94 / 93 | 14 / 22 / 9 XOR            |                   14 | R5, I5        |                                           57 / 93 |
| renew-profile               | `Model.-1rUudxIp-wP-u-L` | PDF-exact, SHA `db133f7a…`                                  |         46 / 43 | 8 / 5 / 2 XOR              |                    8 | R7, I1        |                                           24 / 43 |
| transfer-citizens           | `Model.3i-a2j4HRS3-u-L`  | PDF-exact, SHA `de931235…`                                  |         78 / 74 | 15 / 9 / 1 XOR + 1 AND     |                   15 | R8, I5        |                                           26 / 74 |
| transfer-citizens-companies | `Model.-778f33baj6c-u-L` | **AML-exact only**; 2025 PDF SHA `91f7d14e…` is directional |         63 / 59 | 11 / 9 / 1 XOR + 1 AND     |                    9 | R6, I4        |                                           20 / 59 |

The first three PDFs are one-page A3 2023 exports whose titles and topology match the AML. The fourth
PDF was created in October 2025, is titled “Transfer of Pet Ownership,” and contains a different
Vet/Petshop two-scenario flow with OTP and supporting-document steps. The mapped AML model was created
in May 2023, is titled “Animal Ownership Transfer between Citizens and Companies,” and has an
11-function intake/decision/AND-completion topology. It contains none of the 2025 PDF's distinguishing
text. **No renderer can produce an exact fourth replica from this AML.** Wave 6 must either obtain the
matching 2025 AML (or the matching 2023 companies PDF) and update the hash-pinned mapping, or report
three PDF-exact models plus one AML-exact/directional model. It must never silently invent PDF-only
nodes, approve the wrong model, or claim four PDF-exact results.

##### Per-model live-render/PDF diff ledger

Every target currently shares these DOM defects: fixed system-ui 12 px single-line captions; no rich
text or Arabic layout; no RACI text; no Gfx/OLE projection; spurious default-lane frames; uniform
slate connection styling/arrowheads; incorrect endpoint docking; editor palette/minimap/validation
overlays in the fitted viewport; and the following incorrect symbol presentation:

| Symbol family        | Live DOM evidence                                                | PDF/manual target                                                   |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Function             | solid `#339900` rounded rectangle; ordinary Function has no icon | white card, decoded `#009933` band/top rule, white `▶▶`             |
| System Function      | solid green card with large central gear                         | same white/green card with small automation/window icon             |
| Event                | solid `#dcbbed` six-point polygon                                | white angular chevron, decoded `#edbbdc` band/top rule, white flag  |
| Application System   | tan `#d7c49d` rounded monitor and stand                          | white card, decoded `#9dc4d7` application/window band               |
| Executor             | large gray body/pink head pictogram                              | white card with role-specific colored person/group tile             |
| Data Entity          | whole pale-blue `#b6dce9` rectangle                              | white card with `#cc3300` data/storage tile                         |
| Information Carrier  | freestanding page/envelope/phone pictogram                       | white card with gray variant tile and centered label                |
| Business Rule/Policy | yellow `#fde047` balance or orange `#fb923c` shield              | white card with `#d52929` scroll/shield tile                        |
| Requirement          | whole `#d5d5f7` box with invented mark                           | white card with decoded `#f7d5d5` requirement tile                  |
| Gate                 | `#999999` circle, but generic caption/fixed stroke behavior      | operator-only circle with exact ∧/×/∨ geometry and no invented name |

The model-specific evidence below is additive; “PDF target” includes all common corrections above.

- **register-owner (`Model.3xqe8yXO9Z7-u-L`).** AML/PDF composition is 14 Functions, 22 Events,
  9 XORs, 22 Application Systems, 9 external persons, 1 employee type, 3 entity types, 8 information
  carriers, 2 Requirements, 1 Policy, and the 3 Reference-law rules. The live layer bbox is
  `(45,114,6766,7663)` and uses model Scale 110 / PrintScale 42. Its source routes are 59×2-point,
  2×3-point, 31×4-point, and 1×5-point; 57 endpoint pairs are currently altered. Fourteen number
  labels render, while ten `AT_TYPE_6` groups expected to show R5/I5 are present but empty. The global
  rail attributes 128 rows to this model (75 error/53 warning), and the canvas shows 79 unique
  warning-marker elements; neither is a model-scoped “410 errors.” Two occurrence widths are also
  improperly auto-expanded. Against the PDF, the top business/individual split, nested XOR trees,
  residential-document loop, registration tail, left/right satellite stacks, and long loopbacks are
  topologically present, but every common shape/paint/text/connector defect applies. Required
  furniture is header `(0,0,6700,388)`, logo 1194×320 at `(5403,40)`, Reference box 742×747 at
  `(5880,487)`, and legend 3800×622 at y=8139.
- **renew-profile (`Model.-1rUudxIp-wP-u-L`).** AML/PDF composition is 8 Functions, 5 Events,
  2 XORs, 12 Application Systems, 8 external persons, 6 entity types, 1 E-mail carrier,
  1 Requirement, and 3 Reference-law rules. The live layer bbox is `(127,114,4581,5286)` and uses
  Scale 110 / PrintScale 62. Routes are 26×2-point, 16×4-point, and 1×5-point; 24 are altered at
  endpoints. All eight numbers render; eight RACI groups expected to show R7/I1 are blank. The rail
  attributes 59 rows (31 error/28 warning), with 42 unique canvas marker elements. The PDF's four-step
  submission spine, owner approval, renewed/amendment XOR, and 06→07→08 amendment loop are present,
  but the common symbol, text, satellite, connection, header, and legend defects apply. Required
  furniture is header `(0,0,4600,388)`, logo at `(3303,40)`, Reference box at `(3777,487)`, and
  legend at y=5489.
- **transfer-citizens (`Model.3i-a2j4HRS3-u-L`).** AML/PDF composition is 15 Functions, 9 Events,
  1 XOR, 1 AND, 25 Application Systems, 13 external persons, 7 entity types, 3 information carriers,
  1 Requirement, and 3 Reference-law rules. The live layer bbox is `(77,114,5334,7013)` and uses
  Scale 80 / PrintScale 51. Routes are 40×2-point and 34×4-point; 26 have altered endpoints. All 15
  number placements render; thirteen RACI groups expected to show R8/I5 are blank. The rail attributes
  112 rows (66 error/46 warning), with 70 unique marker elements. The PDF's authorization spine,
  new-owner acceptance/rejection split, AND join, and three completion branches are structurally
  present, but the common visual defects apply. Required furniture is header `(0,0,5300,388)`, logo
  at `(4003,40)`, Reference box at `(4480,390)`, and legend at y=7289.
- **transfer-citizens-companies (`Model.-778f33baj6c-u-L`).** AML composition is 11 Functions,
  9 Events, 1 XOR, 1 AND, 20 Application Systems, 10 external persons, 6 entity types,
  1 e-document, 1 Requirement, and 3 Reference-law rules. The live layer bbox is
  `(77,114,5334,5613)` and uses Scale 90 / PrintScale 53. Routes are 31×2-point and 28×4-point;
  20 have altered endpoints. Nine source number placements render; ten RACI groups expected to show
  R6/I4 are blank. The rail attributes 79 rows (46 error/33 warning), with 53 unique marker elements.
  Required AML furniture is header `(0,0,5300,388)`, logo at `(4003,40)`, Reference box at
  `(4480,490)`, and legend at y=5889. All common render defects apply, but a node-by-node PDF diff is
  intentionally a provenance **failure**, not a renderer failure: the 2025 Vet/Petshop PDF has
  different actors, 02.xx/03.xx branches, OTP, supporting documents, and topology that do not exist
  in this 2023 AML.

#### Corrections to the provisional Evaluation

- The validation rail's `410 errors · 324 warnings` is global across all eight imported models, not
  scoped to register-owner. The 410 errors are 226 missing Arabic names, 92 missing owners, and 92
  missing process codes. `epc.connectivity.orphanNode` contributes 43 **warnings**, not 410 errors.
  Register-owner has zero predecessor edges and zero orphan findings. The 28 legal
  `CT_IS_PREDEC_OF_1` FUNC→FUNC edges are spread across all seven EEPCs; the four targets contain
  0/5/8/4. V1 fixes false validation and graph semantics, but it is not the cause of register-owner's
  visual layout.
- `images:0` and `use:0` do not mean “no icons.” The current renderer emits inline `rect`, `path`,
  `polygon`, `circle`, and `line` primitives. The defect is that these are invented approximations:
  whole-body green pills, a central gear, a balance scale, an orange shield, a monitor-on-a-stand, and
  an oversized person. They do not implement the DMT white-card/colored-band/icon grammar. Structural
  tests need semantic part markers, not `<image>`/`<use>` counts.
- The raw AML colors are Windows `COLORREF`/BGR byte order. The current RGB interpretation is a direct
  root cause:

  | Stored AML value | Correct sRGB/PDF value | Meaning                            |
  | ---------------- | ---------------------- | ---------------------------------- |
  | `339900`         | `#009933`              | Function/System Function accent    |
  | `dcbbed`         | `#edbbdc`              | Event accent                       |
  | `d7c49d`         | `#9dc4d7`              | AnimalWF Application System accent |
  | `d5d5f7`         | `#f7d5d5`              | Requirement accent                 |
  | `b6dce9`         | `#e9dcb6`              | AnimalWF Role accent               |
  | `cccccc`         | `#cccccc`              | Person/information-carrier accent  |

  Decode every AML color-bearing field once at the source boundary, including `Pen`, `Brush.Color`,
  `Brush.Color2`, FontNode color, StyledElement color, Gfx styles, and connection styles. Do not fix
  these examples with catalog-specific swaps.

- A Brush is not a whole-box fill. The paired PDFs and the AML-embedded legend show a white surface,
  colored left icon tile/top rule, white icon, light outline, and black label. The current
  “apply Brush to the first filled primitive” rule floods the body and is architecturally incapable
  of reproducing the target.
- Source outer geometry is already mostly honored: 279 of 281 target occurrences retain their AML
  x/y/w/h exactly. Two register-owner occurrences are incorrectly width-auto-sized. All 269 connections
  retain their interior source points, but `waypoints.ts` replaces stored endpoints by rectangular
  docking, changing 127 routes and introducing short diagonal segments. V4 must preserve exact source
  geometry and fix those bounded exceptions; it must not add an implicit “clean layout.”
- The live renderer uses a fixed slate `#475569`, 1.5 px, target arrow on every edge, even though all
  269 target connections have source Pen/style/type semantics. It also ignores occurrence/attachment
  z-order.
- All four live layers use a fixed 12 px system font, one `<text>` node, zero `<tspan>` wrapping, and
  effectively 1.6–2.3 CSS px text after Zoom Fit. The AML contains six FontStyleSheets, locale-specific
  Arial metrics, rich StyledElement runs, and multiline/bidi content. This is a first-class fidelity
  lane, not polish.
- Each target model has 10 free-text occurrences, 2 rounded Gfx frames, 2 OLE occurrences, and 2
  default lanes. Three free texts bind live model attributes. The current `160×32` outlined note
  fallback loses anchor auto-sizing, styles, and bindings. The two `LT_DEFAULT`, width-0,
  `0..50000`, name `"."` lanes are invisible sentinels in the PDFs; current dashed swimlane output is
  spurious.
- The header frame, bilingual metadata, DMT logo, Reference Laws box and its three rule cards, bottom
  convention legend, and RACI key are authored AML content, not optional editor chrome. The 14 OLE
  occurrences in the full fixture expose directly renderable `AT_IMAGE_FILE_BLOB` PNGs. For each
  target, the logo is 1194×320 at y=40 and the legend is 3800×622 near the page bottom. V5's
  “optional print frame” decision is therefore superseded: full-print fidelity includes them.
- The current render creates the exact `AT_TYPE_6` placement groups but all are empty. RACI is computed
  connection semantics, not stored text. Resolve it from the complete
  `(modelType, fromObjectType, toObjectType, connectionType)` rule; type alone is unsafe because some
  connection types also express non-RACI policy relationships.

#### Complete target presentation contract

The manual defines four model types: Value Added Chain Diagram for process levels 1–3, EPC for process
level 4, Organizational Chart, and Product/Service Tree. New-diagram authoring must be model-filtered
accordingly. The following supersedes R1's guessed colors and incomplete icon mapping.

The manual does not print normative hex codes, object dimensions, font sizes, padding, or stroke
widths. “Manual” codes below are exact solid-pixel samples from the supplied manual raster; some
relationship examples use alternate tints. The paired process PDF and embedded source legend remain
the pixel oracle for imported AnimalWF output, while the catalog-page sample is the canonical default
for a newly authored object. Preserve this provenance per token instead of presenting sampled values
as undocumented vendor constants.

All rectangular DMT cards share a white caption surface, a light-gray outline, a colored top rule and
left icon tile, a centered black label in the remaining content box, and a white icon. The outer AML
occurrence bounds stretch the surface/band only; icons preserve aspect ratio and stroke weight. The
manual canonical color is the new-object default. An imported, decoded occurrence Brush may override
the designated **accent** role only when that symbol's paint policy permits it; it must not recolor
the white surface, icon, text, or outline.

| Library group                               | Presentation / persisted symbol where verified        | Required silhouette and icon                                                                                 | Canonical new-object accent                                     |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| EPC flow                                    | Event / `ST_EV`                                       | horizontal angular event chevron; pink tile and white flag                                                   | `#edbbdc`                                                       |
| EPC flow                                    | Function / `ST_FUNC`                                  | white rectangle; green top/tile; white double chevrons `▶▶`                                                  | `#009933`                                                       |
| EPC flow                                    | System Function / `ST_SYS_FUNC_ACT`                   | same card; white application/window automation glyph, **not** gear                                           | `#009933`                                                       |
| EPC flow                                    | Process Interface / `ST_PRCS_IF`                      | upper white flag card plus large gray lower/right pointed shadow                                             | `#808080`                                                       |
| Decisions                                   | AND / `ST_OPR_AND_1`                                  | circular operator, white `∧`, no definition-name caption                                                     | `#5e5e5e`                                                       |
| Decisions                                   | XOR / `ST_OPR_XOR_1`                                  | circular operator, white `×`, no definition-name caption                                                     | `#5e5e5e`                                                       |
| Decisions                                   | OR / `ST_OPR_OR_1`                                    | circular operator, white `∨`, no definition-name caption                                                     | `#5e5e5e`                                                       |
| VACD                                        | Start value-added chain / verified start presentation | green left tile/`▶▶`, white body, straight left edge, pointed right edge                                     | manual `#298a25`; exported variant may use `#009900`            |
| VACD                                        | Successor value-added chain / `ST_VAL_ADD_CHN_SML_1`  | same, but concave/inward left tail and pointed right edge                                                    | manual `#298a25`; exported variant may use `#009900`            |
| VACD layout mode (not an extra catalog row) | Superior/container chain                              | enlarged pointed container, title top-center, subordinate chains inside; semantic superior connection hidden | same VACD green                                                 |
| Organization                                | Organizational Unit / `ST_ORG_UNIT_1`                 | three-person/group glyph                                                                                     | `#ff9e00`                                                       |
| Organization                                | Position / `ST_POS`                                   | opposed-triangle/bow-tie glyph                                                                               | `#f9b600`                                                       |
| Organization                                | Group / `ST_GRP_1`                                    | group/flag glyph                                                                                             | `#a17220`                                                       |
| Organization                                | Committee / Team                                      | committee/team glyph; distinct catalog presentation                                                          | embedded AnimalWF legend `#996600`                              |
| Organization                                | Role / `ST_EMPL_TYPE`                                 | single-person glyph                                                                                          | manual `#e19f2d`; AnimalWF imported accent decodes to `#e9dcb6` |
| Organization                                | External person/entity / `ST_PERS_EXT`                | single-person glyph                                                                                          | `#aaaaaa`                                                       |
| Organization                                | Related Entity                                        | person plus `RE`; distinct catalog presentation                                                              | manual `#c2bcae`; embedded AnimalWF legend `#afa098`            |
| Organization                                | Internal person / `ST_PERS`                           | single-person glyph                                                                                          | `#ffda33`                                                       |
| Governance                                  | Business Rule / `ST_BUSINESS_RULE`                    | scroll/document glyph                                                                                        | `#d52929`                                                       |
| Governance                                  | Business Policy / `ST_BUSINESS_POLICY`                | same family, separately named presentation                                                                   | `#d52929`                                                       |
| Governance                                  | SLA                                                   | shield glyph                                                                                                 | `#d52929`                                                       |
| Governance                                  | Law / Regulation                                      | shield glyph; Law/Regulation label differentiates variant                                                    | `#d52929`                                                       |
| Governance                                  | Risk / `ST_RISK_1`                                    | warning triangle/exclamation                                                                                 | `#b10000`                                                       |
| Performance                                 | Measure / KPI / `ST_PERFORM`                          | gauge/speedometer                                                                                            | `#1c7ca7`                                                       |
| Service                                     | Product / Service / `ST_SERVICE`                      | cube glyph; document manual's tray-glyph example as an explicit legacy variant                               | `#78684a`                                                       |
| Technology                                  | Application System / `ST_APPL_SYS`                    | application/window glyph, not a desktop monitor body                                                         | manual `#0a568a`; AnimalWF imported accent `#9dc4d7`            |
| Data                                        | Data Entity / `ST_ENT_TYPE` where verified            | data/storage glyph                                                                                           | `#cc3300`                                                       |
| Data                                        | Entity Type / `ST_ENT_TYPE` fixture presentation      | entity/data glyph; retain fixture presentation separately                                                    | occurrence/template evidence, not guessed blue body             |
| Data                                        | Requirement / `ST_REQUIREMENT`                        | requirement/hand glyph                                                                                       | AnimalWF imported accent `#f7d5d5`                              |
| Information                                 | Generic Information Carrier / `ST_INFO_CARR_1`        | information `i`                                                                                              | `#aaaaaa`                                                       |
| Information                                 | Document / `ST_DOC`                                   | outlined page                                                                                                | `#aaaaaa`                                                       |
| Information                                 | E-mail / `ST_EMAIL_1`                                 | envelope plus `@`                                                                                            | `#aaaaaa`                                                       |
| Information                                 | SMS / `ST_INFO_CARR_HANDY`                            | mobile phone                                                                                                 | `#aaaaaa`                                                       |
| Information                                 | Log / `ST_LOG`                                        | log/page glyph                                                                                               | `#aaaaaa`                                                       |
| Information                                 | ARIS Model carrier                                    | model/hierarchy glyph; persisted identifier must be verified from a real export                              | `#aaaaaa`                                                       |
| Information                                 | Letter / `ST_LETTER`                                  | stacked letter/envelope glyph                                                                                | `#aaaaaa`                                                       |
| Information                                 | Electronic file/folder / `ST_INFO_CARR_EDOC`          | folder/bag with `@`                                                                                          | manual `#999999`; imported fixture may decode `#cccccc`         |

This is a 36-presentation library because the complete manual carrier set adds ARIS Model beyond R1's
35 rows; the superior/container treatment is a layout mode of the VACD presentation, not a 37th
persisted identity. Some presentations currently collapse to the same known `objectType:symbolNum` pair
(Data Entity/Entity Type, Related/External, SLA/Law/Policy, Committee/Org Unit, VACD Start/Successor).
Introduce `catalogId` as presentation identity. A row with no independently verified export
discriminator remains visible for discovery but disabled for placement/export, with a user-readable
“round-trip identity not yet verified” reason. Never pretend a label alone proves symbol identity.

##### Geometry, labels, and print projection

- AML units are tenths of a millimetre. Project to print points with
  `points = amlUnits × 72 / 254 × PrintScale / 100`; retain the model's `Scale` and `PrintScale`
  independently. Do not compare raw model units directly to CSS pixels.
- Canonical target outer sizes in the AnimalWF export are 670×240 for Function/System Function
  (ten register occurrences are 670×210), 454×202 for Event, 141×141 XOR, 140×140 AND, normally
  530×150 for application/data/requirement satellite cards, 554×151 for a person, and 661×193 for
  each Reference-law card. Preserve occurrence-specific exceptions rather than normalizing them.
- Occurrence `SymbolNum` overrides ObjDef default. The targets contain 13 such overrides; descriptor
  selection, palette display, export, and the expected manifest must key the occurrence result.
- Render a definition name only when the occurrence has a visible `AT_NAME` placement. Rule
  occurrences have no name placement; draw only their operator. Empty `AT_PROC_CODE` and average-time
  placements stay invisible.
- Function `AT_ID` is centered outside/below its card according to the source AttrOcc port/offset, not
  guessed from sequence. IDs remain LTR under RTL content. Average processing time, when present, is
  centered above the object.
- English and Arabic object names center and wrap inside the declared content box. Preserve explicit
  paragraph/run breaks, language, bidi isolation, alignment, weight, decoration, color, and overflow
  semantics. The target sheet uses Arial regular/bold; imported StyledElements also reference
  Calibri, SansSerif, and Times New Roman at sizes 7–12.
- The AnimalWF AttrOcc/free-text sheet uses English Arial Height `-10` and Arabic Arial Height `-13`,
  weight 400. Convert negative logical font height using the documented print/DPI transform. Bundle or
  pin metrically compatible fonts so layout is deterministic on all three engines; await
  `document.fonts.ready`.
- A free-text occurrence without Size is an alignment-anchor-based auto-sized text, not a top-left
  default box. Do not invent a visible note border. Resolve its model-attribute binding before
  measurement; preserve inline bold and multiline Arabic/English runs.
- Satellite cards retain exact outer bounds, side, relative offset, stack order, z-order, symbol, and
  short attachment route. Shared buses in the PDFs remain shared orthogonal buses.

##### Connections, canonical labels, and RACI

Imported routes preserve every ordered source point verbatim. New or moved routes dock to descriptor
silhouettes/ports and remain orthogonal where the convention requires it. Pen color/width/style,
visibility, arrow source/target, z-order, and label placement resolve from `CxnDef.Type` plus
occurrence overrides; there is no universal arrow marker.

| Model family | From → To                               | Canonical relation label / semantics                                                |
| ------------ | --------------------------------------- | ----------------------------------------------------------------------------------- |
| VACD         | chain → successor                       | `is predecessor of`                                                                 |
| VACD         | superior → subordinate                  | `is process-oriented superior`; approved view hides line and uses containment       |
| EPC          | Function/Process Interface → Event      | `creates/triggers` (`CT_CRT_1`)                                                     |
| EPC          | Event → Function/Process Interface      | `activates/triggers` (`CT_ACTIV_1`)                                                 |
| EPC          | Event → Rule                            | `is evaluated by` (`CT_IS_EVAL_BY_1`)                                               |
| EPC          | Rule → Event                            | `leads to/triggers` (`CT_LEADS_TO_1`/`CT_LEADS_TO_2`)                               |
| DMT EEPC     | Function → Function                     | `is predecessor of` (`CT_IS_PREDEC_OF_1`), legal only for this endpoint tuple       |
| EPC RACI     | eligible executor → Function            | `R`, `A`, `C`, or `I`, arrow at Function                                            |
| EPC          | Application System → Function           | `supports`                                                                          |
| EPC          | Law/SLA — Function                      | `Regulate`; manual does not resolve direction, so imported type/arrow evidence wins |
| EPC          | Business Policy/Rule → Function         | `affects`                                                                           |
| EPC          | Function → Product/Service              | `produces`                                                                          |
| EPC          | Function → Data Entity                  | `creates`                                                                           |
| EPC          | Data Entity → Function                  | `INPUT`                                                                             |
| EPC          | Function → Information Carrier          | `creates output to`                                                                 |
| EPC          | Information Carrier → Function          | `provides input for`                                                                |
| Org Chart    | Org Unit → subordinate Org Unit         | `is composed of`                                                                    |
| Org Chart    | Position → managed Org Unit             | `is organization manager for`                                                       |
| Org Chart    | manager Position → subordinate Position | `is technical superior to`                                                          |
| Org Chart    | Position → Internal Person              | `occupies`                                                                          |
| Org Chart    | Position → Role                         | `performs`                                                                          |
| Service Tree | parent Service → subordinate Service    | `encompasses`                                                                       |

RACI resolver rules are tuple-scoped: `CT_EXEC_1`/`CT_EXEC_2` → R,
`CT_DECID_ON` → A, `CT_MUST_BE_CONSLT_ABT_1` → C, and
`CT_MUST_BE_INFO_ABT_1` → I only for an eligible executor-to-Function rule. Eligible executors are
Organizational Unit, Position, Group/Committee, Role, and External/Internal/Related person/entity.
Place the letter at the source AttrOcc location near the Function endpoint, avoid route collisions,
and never duplicate a source-authored literal.

##### Attribute, numbering, assignment, and legend contract

| Scope           | Required schema                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VACD model      | no model attributes                                                                                                                                                |
| VACD element    | Identifier mandatory; Description/Definition optional; Average Processing Time optional                                                                            |
| EPC model       | Process Objective, Process Scope, Entity, Authorized by, Relevant Organization Structure, Person Responsible, Version, Identifier, Process Area, Organization Name |
| EPC Function    | Identifier mandatory; Description/Definition optional; Average Processing Time optional                                                                            |
| Org Chart       | manual defines no model/object attribute table; do not invent mandatory fields                                                                                     |
| Service level 1 | Identifier mandatory                                                                                                                                               |
| Service level 2 | Identifier, Description/Definition, Average Processing Time; manual conflicts between summary M and detail O, so preserve source and expose the ambiguity          |
| Service level 3 | Identifier and Service Fees; manual conflicts between summary M and detail O; fees examples are `AED 150`/`Free Service`                                           |

Identifier hierarchy follows the process/service prefix and appends a segment for each lower level or
Function (for example process `DMT.PRS.MGT.14.01.01`, Function
`DMT.PRS.MGT.14.01.01.01`). The library may suggest the next identifier but must not overwrite an
imported value. Assignments are VACD level-3 → EPC, Org level-1 → lower-level Org model, Service
level-1 → level-2, and Service level-2 → level-3; show the small assignment badge without changing
the underlying silhouette.

The required bottom legend is the AML-embedded 1914×361 RGBA image, positioned through its 3800×622
OLE occurrence. It includes Event, Process Interface, AND/XOR/OR, Function, System Function,
Document/E-mail/SMS/Letter, Application System, KPI, Requirement, Risk, Committee/Team, Related
Entity Role, External Entity, Role, Business Rule/Policy, SLA, Regulation, Service, and the bilingual
RACI key:

- R — Responsible
- A — Approval/Accountable
- C — Consulted
- I — Informed

Do not reconstruct this particular imported legend from current palette widgets when the source PNG
is present. The from-scratch library separately generates a descriptor-driven symbol sheet to test
the complete 36-presentation catalog.

#### Adversarial verdict on the existing lanes and gates

| Item    | Verdict                                                         | Binding correction                                                                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1      | Directionally correct, factually misattributed and under-scoped | Use an endpoint-aware production classifier; the 28 edges span seven EEPCs, register has zero; orphan is warning; remove comparator-local flow logic; add the legal EEPC tuple to convention rules.                                                                    |
| V2      | Required outcome, wrong detector and one reversed icon mapping  | Function is `▶▶`; System Function is automation/window. Inline primitives already exist. Replace approximations with semantic DMT descriptors shared by canvas and every preview.                                                                                      |
| V3      | Required outcome, wrong root-cause model                        | Implement the source-wide BGR/COLORREF codec and semantic paint roles. Do not replace authored evidence with flat default fills or test one `fill`.                                                                                                                    |
| V4      | Mostly misdiagnosed                                             | Preserve the 279 already-exact bounds, stop two imported autosizes, preserve all source endpoints/points, carry connection style/arrows/z-order, and consolidate the non-live `buildRenderModel` projection with the actual live path.                                 |
| V5      | Materially incomplete                                           | RACI needs a tuple resolver and exact placement. Styled labels/free text, Gfx header/reference frames, OLE logo/legend, print transform, and sentinel-lane suppression are mandatory, not optional.                                                                    |
| V6      | File scope and product scope are wrong                          | `arisQuickPick.css` alone cannot fix the diagram-js palette. Add responsive containment plus the complete searchable/model-aware drawing library specified below.                                                                                                      |
| VG1     | Not executable as written                                       | `<tuned>` is undefined, the editor screenshot includes overlays, private baselines cannot be committed under current policy, CI lacks the fixture, and the fourth PDF is mismatched. Use a protected hash-pinned bundle and deterministic print/content captures.      |
| VG2     | Tests several wrong things                                      | One fill and `<image>/<use>` presence would enshrine defects. Compare exact semantic parts, style roles, text, furniture, routes, arrows, z-order, and inventories to an independent manifest. Separate false-flow findings from legitimate source-quality validation. |
| VG3     | Incomplete release wiring                                       | A manifest entry does not prove the 12 model/engine cases ran. Update protected workflow and reporter, verify the private bundle, and require exact case execution.                                                                                                    |
| E-fix-A | Readiness repair valid; count update invalid                    | Use active-model/ObjOcc readiness. Repair the synthetic fixture to use canonical EVT→FUNC `CT_ACTIV_1` and FUNC→EVT `CT_CRT_1`; assert named rules/deltas, not magic 7/6/7 counts.                                                                                     |
| E-fix-B | Direction valid with sequencing corrections                     | Land final V6 behavior first; use focus assertions; derive palette action inventory from the versioned catalog manifest rather than another hand-copied list.                                                                                                          |
| E-fix-C | Rejected as written                                             | The workflow overrides Playwright's timeout. Measure/shard first; retain focused readiness/per-test budgets. If needed, coherently raise protected job and CLI ceilings, not a blanket config timeout that hides hangs.                                                |

#### Binding implementation lanes and dependency order

- [ ] **V0 — reference/provenance and privacy contract (BLOCKER).** Record the hashes above plus
      manual, expected-manifest, OLE, and built-artifact hashes in a versioned protected reference
      bundle. Classify register/renew/citizens as `pdf-exact`; classify companies as
      `aml-exact/pdf-directional` until a matching artifact is supplied. Decide nothing by filename
      similarity. The protected workflow fails closed when the bundle/hash is absent and never exposes
      private AnimalWF material to untrusted fork code. Full-print scope is mandatory for the three
      matched PDFs. **Do not start baseline approval or declare Wave 6 complete while the fourth
      provenance mismatch is unresolved.**
- [ ] **V1+ — tuple-scoped DMT control flow.** Add one canonical
      `isControlFlowTriple(type, fromType, toType)` used by `flowGraph`, validation,
      deterministic fixes, conventions, and fidelity comparison. Treat
      `CT_IS_PREDEC_OF_1` as EEPC flow only for FUNC→FUNC and exempt only that tuple from alternation.
      Keep other same-type and invalid-endpoint edges illegal. Remove comparator-local candidate sets
      and duplicate loops. Acceptance: all 28 legal edges across all seven EEPCs are flow; zero false
      `orphanNode`/`alternation`; register stays zero before/after; exact positive/negative tuple tests;
      rule IDs and severities are asserted; VACD validation is scoped separately.
- [ ] **V7 — one live visual projection and lossless source-style contract.** Make
      `semanticIndex → buildFromSource → canvasSync → renderer` consume a single resolved visual
      projection, or make the existing `buildArisRenderModel` canonical; it must no longer be a
      parallel diagnostic object that the canvas ignores. Carry occurrence-level symbol override,
      exact source bounds, z-order, Pen/Brush/Color2, FontStyleSheet/runs, AttrOcc placement, complete
      CxnDef/CxnOcc style and route, FFText, Gfx, OLE, lane semantics, Scale, and PrintScale. Add the
      BGR/COLORREF codec at parsing and typed semantic paint roles
      (`surface/accent/outline/icon/text/operator/decoration`). No downstream code sees ambiguous raw
      color strings. Acceptance: a lossless, ID-sorted projection manifest for every source visual
      record and explicit live/headless parity tests.
- [ ] **V3+ — catalog identity, evidence-ranked paint, and model availability.** Replace
      `defaultFill` with the presentation/paint contract above. Add stable `catalogId`, variant family,
      supported model types, palette category/order, semantic roles, Brush/Pen target/precedence,
      provenance, authorability, and round-trip discriminator. Evidence priority for these imports is:
      paired PDF/embedded legend → decoded occurrence/template style → manual canonical default →
      explicit fallback. For new objects, the manual canonical style wins. Disabled/unverified
      duplicate identities remain discoverable with reasons. Validate every authoring entry point,
      including context pad and programmatic/chat creation, against the active model type.
- [ ] **V2+ — exact DMT descriptors and shared previews.** Build descriptors for all 36
      presentations with silhouette/hit path, stretch policy, icon and content boxes, ports, semantic
      parts, and accessible label. Canvas, palette, quick-pick, drag ghost, context pad, print view, and
      symbol gallery consume the same descriptor—remove separate crude glyph maps. Expose stable
      `data-aris-catalog-id`, `data-aris-part`, `data-aris-icon`, `data-aris-silhouette`, and
      `data-aris-operator`. Unknown imported symbols use a visible `?` fallback plus fidelity finding.
      Acceptance: a reviewed 36-symbol English/Arabic sheet; distinct fingerprints for every variant;
      no stretched/clipped icon, caption collision, duplicate caption, or imported fallback at
      representative 454×202, 670×210/240, 530×150, and 140×140 bounds.
- [ ] **V8 — typography, rich text, bidi, and label layout.** Parse and resolve locale FontNodes and
      inline StyledElement/Paragraph/PlainText runs, including family, logical height, size, weight,
      italic, underline, strikeout, color, alignment, rotation, line breaks, and language. Resolve
      model-attribute-bound FFText before measurement. Use descriptor content boxes and source
      AttrOcc ports/offsets for caption, identifier, average-time, connection, and RACI labels. Support
      Arabic shaping, `dir=auto`/bidi isolation, mixed Arabic/Latin identifiers, deterministic wrapping,
      and source auto-size anchors. Pin fonts and test English, Arabic, mixed, long, multiline, and
      bold runs across engines.
- [ ] **V4+ — exact geometry, routing, connection appearance, satellites, and draw order.** Keep all
      source x/y/w/h values; disable the two observed imported auto-width mutations. Preserve every
      ordered source route point—including endpoints—verbatim on initial import; never silently
      redock or clean-layout imported source. For author-created/moved edges, dock to descriptor
      silhouettes/ports. Render type-specific Pen/style/width/arrows/visibility/labels and unified
      z-order across connections, occurrences, AttrOccs, free text, Gfx, and attachments. Acceptance:
      all 281 bounds and all 269 ordered routes match at ≤0.01 AML unit; after the SVG CTM, screen
      projection is ≤0.5 CSS px; every source-orthogonal route remains orthogonal; exact satellite side,
      relative offset, stack, attachment, and z-order.
- [ ] **V5+ — annotations and authored full-print furniture.** Compute tuple-safe RACI and render the
      exact per-connection ID/text/rect inventory above; render the exact Function-number occurrence
      inventory (14/8/15/9), not a sequential guess. Render ten auto-sized/bound FFTexts, two Gfx
      rounded rectangles, the header/reference box and three rule cards, and two OLE PNG occurrences
      per model at exact bounds/z-order. Decode image bytes safely without executing OLE content;
      enforce size/decompression limits and preserve original bytes for export. Suppress only the
      proven `LT_DEFAULT`, width-0, 0..50000 `"."` sentinel lanes; render genuine lanes. Include OLE
      and free-text extents in Zoom Fit/print bounds. Acceptance: header metadata/logo, Reference box,
      body, bottom legend, and RACI key each pass independent region diffs against all three paired
      PDFs.
- [ ] **V10 — complete from-scratch DMT object/connection library.** Replace the one tall flat palette
      with the drawing-toolkit UX and acceptance contract below. V6's responsive containment is part
      of this lane, not its whole scope. This lane follows V2+/V3+/V8 so it consumes real descriptors,
      model rules, and text behavior rather than duplicating them.
- [ ] **V6+ — responsive palette containment and accessibility.** Touch the actual diagram-js palette
      sizing/positioning sources (`shell.css`, palette grip styles, `arisPaletteDrag.ts`, provider and
      quick-pick), not only `arisQuickPick.css`. Keep grip/toggle visible; internally scroll or
      responsive-grid entries; observe both container and palette; reclamp after resize, entry count,
      locale, font, and column changes. Provide collapse/dock/move rather than claiming a floating
      palette never covers content. Test 320/400 px heights, LTR/RTL, keyboard/focus restoration,
      pointer targets, forced colors, and 25–400% zoom. Fidelity capture always hides editor UI.

#### From-scratch drawing toolkit UX

The complete library is a searchable object browser plus contextual connection assistant, not merely
36 permanent buttons:

- Group objects as **Flow & Decisions**, **Roles & Organization**, **Systems & Data**,
  **Governance & Performance**, **Services**, and **VACD**. Filter groups by the active model type;
  show why a manual-only or unverified row cannot yet be placed.
- Search English/Arabic names, aliases (rule/policy, law/regulation, SMS/mobile, KPI/measure),
  `objectType`, `SymbolNum`, and catalog ID. Results preserve semantic grouping and highlight the
  match. Offer Recent and Favorites without changing canonical order.
- Each result shows the real shared descriptor, bilingual name, one-line purpose, model availability,
  and variant count. Hover/focus opens an enlarged preview and exact default attributes/style.
- Click, drag, Enter, or Space enters placement mode. Escape cancels and restores focus. Arrow keys,
  Home/End, group collapse, type-ahead, and screen-reader names work. SVG internals are decorative
  inside named controls.
- A variant quick-pick appears before placement when identity is meaningful (manual/system Function,
  carrier subtype, executor subtype, rule/policy/SLA/law, VACD start/successor). After placement, the
  same quick-pick can replace the presentation while preserving compatible definition attributes and
  connections. Incompatible replacement is blocked with a reason.
- Defaults are contextual: EPC begins with Event/Function flow items; VACD offers start/successor and
  containment; Org offers its hierarchy objects; Service Tree offers Service. New cards use manual
  paint/size/content-box defaults and suggest, but do not silently overwrite, hierarchical IDs.
- Selecting/hovering an object exposes only legal connection helpers in both directions, with the
  manual canonical label. Executor→Function opens an R/A/C/I quick-pick; flow helpers can insert a
  needed Event or rule; data/system/governance/service helpers choose the correct satellite side and
  port; superior/encompasses helpers offer containment/fan-out geometry. Illegal tuples are absent,
  not created and warned later.
- Keep a compact favorites strip/context pad on canvas and put the full library in a dockable drawer.
  The drawer remembers size/dock state per workspace, never traps focus, and does not affect print or
  Zoom-Fit bounds.

V10 acceptance:

- Exact 36-row catalog and connection-helper manifest; every manual object is discoverable, every
  verified row placeable in the correct model, and no enabled rows collapse to an indistinguishable
  exported identity.
- Search tests cover English, Arabic, aliases, symbol code, no-result, and disabled-result
  explanations. Keyboard-only and screen-reader flows place, variant-swap, connect, cancel, and
  restore focus.
- Imported and newly authored instances resolve the same descriptor/paint/text contract; canvas,
  palette, quick-pick, drag ghost, context pad, and print view have identical descriptor fingerprints.
- Export/reimport preserves verified presentation identity, attributes, layout, and canonical
  connection type. Unverified presentations cannot masquerade as round-trippable.
- A visual gallery covers all 36 presentations, all RACI letters, every gate, every information
  carrier, English/Arabic/mixed labels, supported sizes, light/forced-color UI, and does not use the
  four AnimalWF models as its only coverage (they contain no OR and omit many manual symbols).

#### Strengthened visual/semantic regression gate

- [ ] **VG0 — independent expected manifest.** Store the private expected manifest in the
      hash-pinned protected bundle, authored from AML/PDF evidence rather than imported from runtime
      `catalog.ts`. For every occurrence record ID/definition/object/symbol override, exact source
      bounds/z-order, required semantic parts/silhouette, per-role paint, caption and AttrOcc
      text/rect/font. For every connection record ID/type/endpoints, exact ordered route, Pen/arrows,
      label/RACI text/rect. Also record all FFText/runs/bindings, Gfx, OLE hashes/bounds, lanes,
      Scale/PrintScale, furniture, validation rule multiset, and PDF classification. Deep-compare an
      ID-sorted actual manifest and reject missing **or unexpected** elements.
- [ ] **VG1+ — deterministic PDF and editor captures.** Add a dedicated visual Playwright config in a
      digest-pinned Linux/Playwright 1.61.1 environment with fixed fonts. Pin viewport, DPR 1, light
      theme, `en-US`, UTC, reduced motion, service workers off, and animations/caret off. Await
      `document.fonts.ready`, exact active model/inventory, no editor transaction, render revision
      ready, decoded OLE images, and an identical viewport transform across two frames. Hide palette,
      minimap, validation overlays, selections, context pads, direct editor, cursors, and shell chrome.
      Capture both a full A3 print surface, using AML Scale/PrintScale and comparing the
      header/body/reference/legend regions plus whole page to each of the three matched PDF rasters,
      and a fixed 1600×1000 model-only SVG/editor view per engine for cross-browser regressions.
      Use engine-specific approved baselines, no per-model threshold loosening, no unrecorded masks,
      and a fixed initial contract of color threshold `0.10`, `maxDiffPixels: 250`, and
      `maxDiffPixelRatio: 0.0002`. Chromium is the canonical PDF pixel oracle; all engines must match
      the semantic manifest. Require three clean repeated captures before approval. Baseline update is
      forbidden in CI and writes candidates only outside tracked paths.
- [ ] **VG2+ — exact structural/semantic gates.** Add renderer observability for object type, symbol,
      catalog ID, source bounds, semantic parts, silhouette/operator, label owner/type/value/bounds,
      connection ordered waypoints/style/arrows, active model/revision/ready state, and validation
      rule/severity. On Chromium, Firefox, and WebKit assert exact occurrence/connection/text/furniture
      inventories; per-role sRGB colors; 0.01 model-unit and 0.5 CSS-pixel geometry tolerances; all 269
      routes and orthogonality; exact arrows/z-order; exact RACI and number maps; no unexpected colors,
      labels, lanes, or fallbacks. Do **not** require zero global validation errors from source data.
      Require zero false `orphanNode`/`alternation`, zero render-fidelity diagnostics, and the approved
      named validation multiset. Cover OR and all objects absent from AnimalWF with the synthetic
      36-symbol/connection/RTL gallery.
- [ ] **VG3+ — protected release enforcement.** Securely fetch and SHA-verify the private bundle in an
      environment-protected post-review candidate job; never expose it to fork code. Extend package
      scripts, workflow, suite manifest, release reporter, and reporter tests so the four exact model
      IDs × three engines are discovered and executed exactly once: 12 results, zero skip/retry/
      interruption/duplicate. A public PR job may use a sanitized synthetic gallery, not private
      AnimalWF screenshots. If measured runtime requires it, update both workflow and CLI ceilings;
      config-only timeout changes are insufficient.
- [ ] **VG4 — review provenance and diagnostics.** Approval metadata binds AML/PDF/manual/OLE/
      expected-manifest/baseline/dist hashes, page/crop contract, browser/container/font versions,
      reviewer, and date. Any change invalidates approval. On failure attach private expected/actual/
      diff PNGs, normalized SVG, expected/actual semantic JSON and field diff, rule IDs, console/page
      errors, font list, viewport/DPR/transform, model ID, and all hashes. Public logs expose
      hashes/counts only; protected artifacts use short retention.

#### Corrected Wave 6 exit gate

- [ ] V0 provenance is resolved. Until a matching fourth source/PDF pair exists, release evidence says
      **three PDF-exact + one AML-exact/PDF-directional**; it never says four PDF-exact.
- [ ] All seven EEPCs have zero false `epc.connectivity.orphanNode`/`epc.alternation` findings for the
      legal DMT sequence tuples; legitimate source-quality findings remain visible and match their
      approved rule/severity manifest.
- [ ] The three paired models pass whole-page and region-level A3 comparisons, including bilingual
      header, DMT logo, Reference Laws box, diagram, typography, bottom symbol legend, and RACI key.
      The companies model passes its independent AML visual manifest and only a convention-directional
      review against the 2025 PDF.
- [ ] All four models pass exact occurrence, symbol-override, semantic-part, per-role paint, route,
      connection-style/arrow, z-order, caption, rich/free-text, furniture, OLE, numbering, and RACI
      manifests on Chromium, Firefox, and WebKit. No source sentinel lane or editor overlay appears.
- [ ] The complete 36-presentation drawing library and legal connection assistant pass gallery,
      authoring, export/reimport, search, keyboard, RTL, accessibility, responsive viewport, and shared
      descriptor gates.
- [ ] All 12 protected model/engine cases execute once and pass; synthetic manual-gallery coverage
      passes in normal CI; the full existing release suite remains green; the rebuilt release artifact
      is byte-verified against the tested dist artifact.

---

## Risk appendix

1. **Single-owner-per-wave** file map (§ownership chains) is binding. A lane touching an unowned file = STOP + report.
2. **Dblclick priority collision**: assignment-nav (T6) @2000 returns `false` only when navigating; direct-edit (C3) @1500. A function with an assignment drills down; without one, edits its label. Verified by E1.
3. **Ambiguous Model.IDs** (two blanks pre-T3, duplicated split outputs re-imported): fail-closed everywhere — dropped from index, in `ambiguousProcessIds`, physical rows only, dblclick toasts `aris.assign.ambiguous`. Import-skip on existing ids prevents the common case.
4. **Shared ObjDefs duplicated across split files** (TAMM et al., same `ObjDef.ID` in many files): intended (cross-file identity). Editing a def in one file does not propagate; documented.
5. **RTL/Arabic editing**: `dir="auto"` post-activate covers first-strong; commit path is plain text so worst case is cosmetic caret behavior, never data corruption. C3 has an Arabic test; E3/`aris-i18n-rtl` covers a live step.
6. **Zoom overlay drift**: captured-id commit + `getAbsoluteBBox` + `fontSize×zoom`; an edit survives an unrelated `changed` event (C3 test).
7. **Unverified ARIS numbers** (SLA/Law/Risk/Service/Committee/model attributes): one contiguous `VERIFY-AGAINST-REAL-ARIS-EXPORT` region + `verification` flag; export emits only authored attributes, so a wrong number is a one-table fix later. goal.md carries a standing verify instruction.
8. **Template-color guessing**: descriptor fills change to DMT defaults but authored Pen/Brush win; `test:aris:animalwf` (C5 required run) is the tripwire that imported renders don't change.
9. **Holdout leakage**: separate config + a script that only lands in Wave 4 (E3); holdout expectations authored topology-level in Wave 1 and refined against AML only in Wave 5; never used to tune C8.
10. **`replaceNewObject` ordering**: sub-commands apply sequentially within `transactionCommand`; the 1-occurrence/0-connections guard removes the dangerous cases; C4 tests undo/redo both ways.
11. **Pen-carry vs derived export**: C8 keeps `rawAttributes`/source anchors untouched and runs `arisDerivedExport.test.ts` as a required check.
12. **Span semantics**: T2 pins them with a first-assert; if spans exclude the closing tag, it switches to the element's end boundary — contained in the lane.
13. **OPFS quirks / webkit e2e**: absent `modifiedAt` falls back to hash compare (one read, no parse); e2e uses the proven loopback-HTTP + webkit persistent-context harness; dblclick synthesized on the `data-element-id` gfx with the marker-button click as the primary assertion path.
14. **Authorized test updates** (must be made, not worked around): `arisBlankModel.test.ts` (`Model.New` → minted id/GUID); `ArisApp.test.tsx` import-behavior + model-explorer-gating cases; palette entry-count/action-id assertions in `src/aris/canvas`. Explicitly NOT weakened: single-file-mode, §7.3 package import, BPMN-reject, and the still-valid >1-model model-explorer switch test.

---

## Baseline record (Wave 0 fills this in)

- Baseline SHA: `ff6482b115002b9822a150d12856721f3dbdf11a` (`ff6482b`), branch `feat/aris-only-studio`.
- Gate results at baseline (exit codes verbatim), run independently (no short-circuit) at HEAD `ff6482b`:
  - `format:check` — **exit 1** (pre-existing, non-code): the ONLY flagged file was `implementation_plan.md` (the uncommitted plan doc). Prettier-formatted and committed in this Wave-0 commit → green. No source file failed formatting.
  - `lint` (`eslint . --max-warnings 0`) — exit 0.
  - `typecheck` (`tsc --noEmit -p tsconfig.json`) — exit 0.
  - `check:aris-runtime-boundary` — exit 0.
  - `check:ui-copy` — exit 0.
  - `check:no-skips` — exit 0.
  - `check:lite-only` — exit 0.
  - `check:lock` — exit 0.
  - `npm test` (unit) — exit 0 (333 test files passed).
  - `test:aris:animalwf` — exit 0 (14 test files passed).
- Conclusion: baseline is green at HEAD apart from the plan-doc formatting fixed here. **No fix lane dispatched before Wave 1** (no source gate red).

## Resolution evidence (Wave 5 fills this in)

- Issue 1 (folder tree + nested processes): _(record — T5/T6/T7/T8/T9 + E1/E2 evidence: split-to-files, VACD owns 7 EPCs, dblclick drill-down, create-missing, move-safe links, single-file unchanged)_
- Issue 2 (direct editing + symbols): _(record — C3/C4/C5 + interaction e2e: place→type→Enter caption, dblclick/F2 edit, quick-pick variant swap, full convention palette)_
- Issue 3 (convention alignment): _(record — C1/C5/C6/C7: catalog resolves every symbol with zero fidelity findings, DMT colors, RACI mapping, legality, attribute schema, convention findings)_
- Issue 4 (import fidelity): _(record — C8 iterate suites exact via `test:aris:animalwf`; holdout green first-run via `test:aris:animalwf:holdout`; screenshot artifacts)_

## Wave 7 — Round-trip & feature-parity test sequences (user request 2026-07-31)

Three end-to-end sequences requested by the user. Feasibility mapped against the actual features; decisions recorded.

### Sequence 1 — XML round-trip fidelity + PDF compare

1. Import `ARISAMLExport.xml`.
2. **Export PDF** and compare to the original reference PDF. **NOTE:** the tool had NO PDF-export feature (PDF was only an AI _input_). Per user decision, **build a real PDF export** (port `main:src/editor/exportPdf.ts`, which uses `jspdf` 4.2.1 — already a dep — adapt to the ARIS diagram-js canvas + print frame). Then export the PDF, rasterize, and tolerance-compare to `tmp/pdfimg/Register_…-1.png` / `Renew_…-1.png` (near-match threshold, not exact).
3. **Export XML** (`arisDerivedExport`) and compare to the original XML via `src/aris/fidelity/compare.ts` — 0 structural diffs on register-owner + renew-profile.
   Lane: PDF-export + Seq-1 on main (Kimi K3-max). Owns `src/aris/canvas/exportArisPdf.ts` (new), ArisStudioTab Export-PDF button, Seq-1 test.

### Sequence 2 — create-from-PDF (AI feature)

Put the original PDF into the create-from-PDF feature and check it produces the same drawing (visually or by XML). This feature is **AI-driven** (`src/ai/pdf.ts` → LLM provider, needs API key, non-deterministic). Two modes:

- **Mode 1 (mocked, CI-safe):** drive the pipeline with a RECORDED provider response → assert a well-formed process (plumbing test, deterministic).
- **Mode 2 (live, env-gated):** when `OPENROUTER_API_KEY` is set, call **glm-5.2 via OpenRouter** (user provides the key on request) with the register PDF, export AML, FUZZY-compare to original (similarity threshold, not exact). Skips cleanly without the key. **User will provide the OpenRouter key + model glm-5.2 on request; do NOT block other work waiting for it; never commit the key.**
  Lane: AI-Seq2 harness in worktree (Kimi K3-max). Owns new `src/aris/ai/*.seq2.test.ts` + recorded fixture + minimal transport-injection seam.

### Sequence 3 — Excel round-trip (deterministic)

Generate an Excel of a process using the template, run create-from-Excel, and check it creates the same exact process (visually or by XML). Uses the **deterministic** Excel path (NOT AI): `createArisTemplateWorkbook` (`templateWriter.ts`) → `workbookParser` → `generateAml` → compare. Fully automatable as an exact-match round-trip.
Lane: Excel-Seq3 in worktree (Kimi K3-max). TEST-only unless a genuine round-trip bug surfaces.

### Wave 7 gate

All three lanes' verify sets green; Seq-1 (XML compare 0 diffs, PDF raster ≈ reference) and Seq-3 (exact-match round-trip) automated in CI; Seq-2 Mode-1 (mocked) in CI, Mode-2 (live glm-5.2) run once manually with the user's key and recorded.

## Wave 8 — Create-from-PDF / Picture vision A/B (gemini-3.5-flash-lite + qwen3-vl)

> **Section authored 2026-07-31 by the Wave-8 planning agent** (Seq-2 multimodal follow-up; these
> are planning-agent additions, not orchestrator text). Basis: the research report at
> `/home/ahmed/.claude/jobs/501f0ce4/tmp/seq2-multimodal-recommendation.md` (root cause, live
> OpenRouter model survey, cost table, hardening list) plus the user's **binding decision** below.
> All file/line anchors in this section were re-verified against the working tree on 2026-07-31.
> Numbering note: goal.md's dispatch ledger and some commit subjects reused "Wave 8/9" for e2e
> work; **this file's own wave sequence is authoritative for this section** — the last wave above
> is Wave 7, so this is implementation_plan.md Wave 8. No lane below collides with any earlier
> lane's files (Waves 1–7 are closed).

### Why this wave exists

The Wave-7 Seq-2 live run (`z-ai/glm-5.2` on the register-owner reference PDF) failed
`semantic-exhausted`: glm-5.2 is **text-only**, so OpenRouter's `file-parser` plugin fell back to
OCR — labels survived, arrow topology died — and the model invented connection types (`CT_FLOW`).
Three compounding product gaps make that failure class reachable for ANY model:

1. `SYSTEM_PROMPT` (`src/aris/ai/promptBuilder.ts:101-113`) never lists the 17 supported `CT_*`
   codes and never describes the `ArisAiDraftV1` field shape, even though the user turn
   (`promptBuilder.ts:154`) claims "the ArisAiDraftV1 contract described in the system message".
2. The `unsupported-connection-type` finding (`src/aris/ai/typeValidation.ts:131-141`) is the only
   type finding that does NOT enumerate the allowed set — repair turns said "wrong" without saying
   what would be right, so the model re-guessed until the 3-turn budget died.
3. Nothing normalizes a trivially mappable alias before burning a repair turn, although the
   endpoint-typed census needed to do it deterministically already exists
   (`src/aris/epc/constants.ts:23-34` + the AML census re-verified below).

Additionally `MAX_TOKENS = 8_000` (`src/ArisGenerationPanel.tsx:126`) is below the ~8–10k output
tokens a full-fidelity 14-function draft needs, so a good model can truncate into a fake
"semantic" failure.

### Binding decisions (user, 2026-07-31)

- **A/B BOTH models, live, and compare outcomes**: `google/gemini-3.5-flash-lite`
  ($0.30/$2.50 per M, native PDF `file` modality + image, `structured_outputs`, healthy
  Vertex-global ZDR pool) and `qwen/qwen3-vl-235b-a22b-instruct` ($0.21/$1.90, image-only,
  `structured_outputs`, ZDR via DeepInfra/Venice). The **instruct** variant, NOT thinking —
  cleaner json_schema/enum-lock behavior, cheaper, faster for structured extraction.
- **Qwen has no native PDF** → rasterize the register PDF page offline into the private
  `reference/AnimalWF/png/` tree (never committed — `reference/` lives OUTSIDE this repo at
  `/home/ahmed/Desktop/bpmn_tool/reference/`), so both models see the same page.
- **Product handling of PDFs on image-only models: GATE, do not rasterize client-side** (decision
  recorded in lane M7 below; no pdfjs-dist).
- Apply the **model-agnostic hardening** to BOTH models: (1) enumerate the 17 `CT_*` codes + the
  `ArisAiDraftV1` schema in the system prompt, (2) enumerate the allowed set in the
  `unsupported-connection-type` finding, (3) new deterministic `normalizeDraft` mapping invented
  codes onto valid ones via the endpoint census, (4) enum-locked `response_format: json_schema`
  on capable OpenRouter routes, (5) `MAX_TOKENS` 8_000 → 16_000 for attachment runs.
- The OpenRouter key for the live A/B is at
  `/home/ahmed/.claude/jobs/501f0ce4/tmp/openrouter.env` (env `OPENROUTER_API_KEY`). **Never
  commit it, never echo it, never write it into any repo file.**

### Invariants that MUST survive this wave (violating any of these is a stop-and-revert)

- **The model never emits AML/XML/coordinates/real ARIS ids** — draft JSON only.
  `scanForForbiddenContent` stays the FIRST pass in `validateArisAiDraft`
  (`src/aris/ai/validateDraft.ts:58-62`); the normalizer must not weaken it (it rewrites only
  `connectionType` strings to hardcoded `CT_*` literals, nothing else).
- **ZDR pin unchanged**: `provider: { zdr: true, data_collection: 'deny' }`
  (`src/ai/browserAi.ts:591-594`) stays on every OpenRouter request. Both chosen models have ZDR
  endpoints; that is WHY they were chosen.
- **Attachment uploads exactly once; repair turns are text-only** (`arisAiGeneration.ts:172-219`,
  retry cap `browserAi.ts:905`). Nothing below adds an attachment parameter to any repair seam.
- **Mocked Seq-2 Mode 1 stays CI-safe and deterministic**: no env dependence in mocked tests, no
  network, no `reference/` dependence; live tests keep the in-body env-gated early return (no
  `.skip` — `npm run check:no-skips` must stay green).
- `qwen/qwen3-vl-235b-a22b-instruct` must **never receive a PDF part**: OpenRouter's file-parser
  OCR fallback for non-native models bills $2/1000 pages outside the account's control AND —
  per OpenRouter's ZDR doc — **plugins are not covered by ZDR enforcement**, so a PDF sent to an
  image-only model silently ships workspace content outside the privacy pin. The capability gate
  (M1) + the live-test guard (M8) enforce this at both layers. (Known pre-existing exception:
  the curated text models, e.g. glm-5.2, already use the OCR fallback today — changing THEIR pdf
  capability is explicitly out of scope for this wave; recorded as a follow-up risk.)

### Endpoint census (re-verified 2026-07-31 against `reference/AnimalWF/ARISAMLExport.xml`)

Ground truth for M2's cheat-sheet and M4's mapping table. Every (fromType → toType) pair observed
in the reference maps to exactly ONE connection type except the three flagged rows:

| from → to                | CT code                                             | count | note                                                                                                                         |
| ------------------------ | --------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| OT_EVT → OT_FUNC         | `CT_ACTIV_1`                                        | 36    | control flow                                                                                                                 |
| OT_RULE → OT_FUNC        | `CT_ACTIV_1`                                        | 14    | control flow                                                                                                                 |
| OT_FUNC → OT_EVT         | `CT_CRT_1`                                          | 35    | control flow                                                                                                                 |
| OT_FUNC → OT_RULE        | `CT_LEADS_TO_1`                                     | 16    | control flow                                                                                                                 |
| OT_RULE → OT_EVT         | `CT_LEADS_TO_2`                                     | 36    | control flow                                                                                                                 |
| OT_EVT → OT_RULE         | `CT_IS_EVAL_BY_1`                                   | 19    | control flow                                                                                                                 |
| OT_FUNC → OT_FUNC        | `CT_IS_PREDEC_OF_1` 28 / `CT_IS_PRCS_ORNT_SUPER` 12 | —     | **ambiguous**: pick by owning model's `modelType` — `MT_VAL_ADD_CHN_DGM` → `CT_IS_PRCS_ORNT_SUPER`, else `CT_IS_PREDEC_OF_1` |
| OT_PERS → OT_FUNC        | `CT_EXEC_1` 41 / `CT_MUST_BE_INFO_ABT_1` 23         | —     | **ambiguous**: default `CT_EXEC_1` (majority, "carries out"), warning notes the assumption                                   |
| OT_PERS_TYPE → OT_FUNC   | `CT_EXEC_2`                                         | 3     | satellite                                                                                                                    |
| OT_APPL_SYS → OT_FUNC    | `CT_SUPP_3`                                         | 128   | satellite                                                                                                                    |
| OT_ENT_TYPE → OT_FUNC    | `CT_IS_INP_FOR`                                     | 9     | satellite                                                                                                                    |
| OT_FUNC → OT_ENT_TYPE    | `CT_HAS_OUT` 21 / `CT_READ_1` 6                     | —     | **ambiguous**: default `CT_HAS_OUT` (majority), warning notes the assumption                                                 |
| OT_FUNC → OT_INFO_CARR   | `CT_CRT_OUT_TO`                                     | 28    | satellite                                                                                                                    |
| OT_REQUIREMENT → OT_FUNC | `CT_REFS_TO_2`                                      | 8     | satellite                                                                                                                    |
| OT_POLICY → OT_FUNC      | `CT_AFFECTS`                                        | 2     | satellite                                                                                                                    |

`OT_PERF`, `OT_BUSINESS_RULE`, and all reverse-direction satellite pairs (e.g. OT_FUNC→OT_PERS)
have NO census entry → the normalizer leaves them untouched and the (now-teaching) finding +
repair loop handle them.

### Lanes (ONE opus implementer, executed strictly in order M1 → M8; run each lane's verify set before starting the next)

- [ ] **M1 — Curated vision models + capability flags + prices.** Owner: opus implementer.
      Files: `src/ai/providersLite.ts`, `src/ai/credits.ts`, `src/ai/__tests__/providersLite.test.ts`,
      `src/ai/__tests__/credits.test.ts` (extend if it asserts PRICES keys).
      Changes: 1. Append to `OPENROUTER_MODELS` (`providersLite.ts:66-74`), AFTER the existing 7 entries so
      `defaultLiteModelId('openrouter')` stays `z-ai/glm-5.2` (text default unchanged):
      `{ id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (Google) — vision, native PDF' }` and
      `{ id: 'qwen/qwen3-vl-235b-a22b-instruct', label: 'Qwen3-VL 235B Instruct — vision, picture only' }`.
      (After the A/B, the winner is moved to be the FIRST of these two — see the run procedure.) 2. Add a per-model override consulted by `getLiteModelCapabilities` (`:128-148`) BEFORE the
      `anthropic/`/`google/` prefix heuristic, for reviewed OpenRouter slugs only:
      `const OPENROUTER_MODEL_CAPABILITY_OVERRIDES: Record<string, { pdf: boolean; images: boolean }> = { 'qwen/qwen3-vl-235b-a22b-instruct': { pdf: false, images: true } }`.
      Unlisted curated ids keep today's behavior exactly (gemini-3.5-flash-lite needs no entry:
      the `google/` prefix rule already grants `pdf:true, images:true`). Unreviewed ids still
      fail closed. 3. Add `export const OPENROUTER_STRUCTURED_OUTPUT_MODELS: ReadonlySet<string> = new Set(['google/gemini-3.5-flash-lite', 'qwen/qwen3-vl-235b-a22b-instruct'])`
      — the models whose selected ZDR endpoints list `structured_outputs` (live-verified
      2026-07-31; consumed by M5). Deliberately NOT added to `LiteModelCapabilities` (several
      tests `toEqual` that exact shape). 4. Add `export function firstLiteModelForAttachment(providerId: LiteProviderId, kind: 'pdf' | 'image'): string | null`
      — first curated model of the provider whose `getLiteModelCapabilities` grants that kind
      (consumed by M7). 5. `src/ai/credits.ts` PRICES (`:1479-1501`): add
      `'google/gemini-3.5-flash-lite': { in: 0.3, out: 2.5 }`,
      `'qwen/qwen3-vl-235b-a22b-instruct': { in: 0.21, out: 1.9 }`; refresh the stale
      `'z-ai/glm-5.2'` row `0.8106/2.5476` → `{ in: 1.12, out: 3.52 }` (live catalog
      2026-07-31); bump `ESTIMATED_PRICE_AS_OF` to the implementation date. Re-verify all three
      numbers against `GET https://openrouter.ai/api/v1/models` at implementation time (no key
      needed) and use the live values if they moved. 6. Tests: extend `providersLite.test.ts` — qwen route `toMatchObject({ pdf: false, images: true, verified: true })`,
      gemini-3.5-flash-lite `{ pdf: true, images: true, verified: true }`, and
      `firstLiteModelForAttachment('openrouter','pdf')`/`('openrouter','image')` return a
      model whose capabilities actually grant that kind. Fix any list-enumerating assertions
      that the two new curated entries break (grep: `AiPanelLite.integration.test.tsx`,
      `arisTranslateController.test.tsx`, `pdf.test.ts`).
      Acceptance: `npx vitest run src/ai --maxWorkers=2 --retry=0` green; `npm run typecheck` green;
      `getLiteModelCapabilities('openrouter','qwen/qwen3-vl-235b-a22b-instruct').pdf === false`
      (the ZDR-leak gate) asserted in a test.

- [ ] **M2 — System prompt teaches the vocabulary + the schema.** Owner: opus implementer.
      Files: `src/aris/ai/promptBuilder.ts`, `src/aris/ai/promptBuilder.test.ts`.
      Changes: extend `SYSTEM_PROMPT` (`:101-113`) — keep every existing line byte-identical, then
      append (importing the constants, never hardcoding a second copy — no import cycle:
      `typeValidation.ts` imports only `contract`/`findings`): 1. A compact `ArisAiDraftV1` field spec making the user turn's claim true: top-level
      `{version:1, models[], objects[], relations[], attributes[], assignments[], uncertainties[]}`;
      per-entry required/optional fields exactly as `src/aris/ai/contract.ts` defines them
      (models: logicalId/modelType/names/confidence; objects: logicalId/modelLogicalId/
      objectType/names/attributes/confidence + optional symbolType/suggestedOrder/evidence;
      relations: logicalId/modelLogicalId/sourceLogicalId/targetLogicalId/connectionType/
      confidence + optional names/returnOutcome; attributes with ownerKind/ownerLogicalId;
      uncertainties with targetLogicalId/kind/message). State: strict JSON, no extra keys,
      `names`/`values` carry `en`/`ar` strings. 2. Closed vocabularies, each on one line: the 12 `ARIS_AI_SUPPORTED_OBJECT_TYPES`
      (import from `./typeValidation`), the 17 `ARIS_AI_SUPPORTED_CONNECTION_TYPES`, the 3
      `ARIS_AI_SUPPORTED_RULE_SYMBOL_TYPES`, the 2 `ARIS_AI_SUPPORTED_MODEL_TYPES` (from
      `./contract`), confidence `high|medium|low`. 3. The endpoint cheat-sheet from the census table above (all unambiguous rows + the three
      disambiguation rules), e.g. `event→function CT_ACTIV_1; function→event CT_CRT_1; …;
       application system→function CT_SUPP_3; …`.
      Static text only — determinism is preserved by construction (the constants are frozen
      module consts). Budget ≈ +900 prompt tokens (≈ +$0.0003/run at the picks' input rates).
      Tests: extend `promptBuilder.test.ts` "states the core Section 16.5 rules" (`:26-33`) —
      system prompt matches `CT_ACTIV_1`, `CT_IS_PREDEC_OF_1`, `ArisAiDraftV1`, `connectionType`,
      `OT_APPL_SYS`, and contains ALL 17 CT codes (loop over the imported constant). The
      determinism test (`:22`) needs no change (same-input byte-equality).
      Acceptance: `npx vitest run src/aris/ai/promptBuilder.test.ts` green; prompt-injection tests
      untouched and green.

- [ ] **M3 — The repair finding teaches the allowed set.** Owner: opus implementer.
      Files: `src/aris/ai/typeValidation.ts`, `src/aris/ai/typeValidation.test.ts`.
      Change: the `unsupported-connection-type` message (`:131-141`) becomes
      `` `Connection type "${relation.connectionType}" is not in the supported EPC connection-type set (${ARIS_AI_SUPPORTED_CONNECTION_TYPES.join(', ')}).` ``
      — one line, mirroring the model-type (`:100`) and rule-symbol (`:125`) findings exactly.
      Tests: update the message expectation; add an assertion that the message contains
      `CT_ACTIV_1` and `CT_SUPP_3`.
      Acceptance: `npx vitest run src/aris/ai/typeValidation.test.ts` green.

- [ ] **M4 — Deterministic alias normalizer (`normalizeDraft`).** Owner: opus implementer.
      Files: NEW `src/aris/ai/normalizeDraft.ts`, NEW `src/aris/ai/normalizeDraft.test.ts`,
      `src/aris/shell/arisAiGeneration.ts`, `src/aris/shell/arisAiGeneration.test.ts`,
      `src/aris/ai/index.ts` (barrel export).
      Module contract (`normalizeDraft.ts`, ~120 lines incl. the census table as comments): - `export const NORMALIZED_CONNECTION_FINDING_CODE = 'normalized-connection-type'` - `export function normalizeArisAiDraft(raw: unknown): { value: unknown; rewrites: ArisAiValidationFinding[] }` - Defensive, never throws, copy-on-write (never mutates `raw`; clones only the relation
      entries it changes plus the containers on the path to them). Preconditions per step —
      anything not matching passes through untouched for the validators to report: 1. `raw` must be a plain object whose `models`/`objects`/`relations` are arrays; build
      `logicalId → objectType` from object entries that are plain objects with string
      `logicalId`+`objectType`, and `logicalId → modelType` from model entries likewise. 2. For each relation entry that is a plain object with string `connectionType`,
      `sourceLogicalId`, `targetLogicalId`:
      a. `connectionType` already in `ARIS_AI_SUPPORTED_CONNECTION_TYPES` → untouched.
      b. **Case-fold alias**: `connectionType.trim().toUpperCase()` equals a supported code →
      rewrite to the canonical casing (endpoint types not required).
      c. **Endpoint census**: resolve both endpoints' object types; look up the pair in the
      census mapping table above. OT_FUNC→OT_FUNC picks by the owning model's `modelType`
      (via the relation's `modelLogicalId`; missing/unknown model → default
      `CT_IS_PREDEC_OF_1`). OT_PERS→OT_FUNC defaults `CT_EXEC_1`; OT_FUNC→OT_ENT_TYPE
      defaults `CT_HAS_OUT`. Mapping found → rewrite.
      d. No mapping / unresolved endpoint / non-flow-nor-census pair → untouched. 3. Every rewrite emits one warning finding:
      `finding(NORMALIZED_CONNECTION_FINDING_CODE, '$.relations[<i>].connectionType', 'Rewrote unsupported connection type "<old>" to "<new>" based on <srcType>→<tgtType> endpoints.')`
      (append `' Assumed the majority mapping; CT_READ_1/CT_MUST_BE_INFO_ABT_1/CT_IS_PRCS_ORNT_SUPER are the alternatives.'`
      for the three ambiguous defaults). - The rewrite targets are hardcoded `CT_*` literals from the supported set — the normalizer
      can never introduce forbidden content, and `scanForForbiddenContent` still runs on the
      normalized value afterwards.
      Wiring (`arisAiGeneration.ts`): in the loop after `raw = parseArisAiResponseJson(text)`
      succeeds (`:230`), insert `const normalized = normalizeArisAiDraft(raw)` and validate
      `normalized.value` instead of `raw`; on the success return (`:254-262`) surface
      `warnings: [...normalized.rewrites, ...warnings]`. Repair-turn echo stays the ORIGINAL
      response text (unchanged). Per-attempt rewrites never leak across attempts (the binding is
      inside the loop body). The Create panel then shows the rewrites with zero UI change via the
      existing `setWarnings(findingLines(result.warnings))`.
      Tests (`normalizeDraft.test.ts` — pure unit): CT_FLOW evt→func → CT_ACTIV_1 + 1 warning;
      `ct_activ_1`/`CT_Activ_1` case-fold; CT_SEQ func→evt → CT_CRT_1; func→func in MT_EEPC →
      CT_IS_PREDEC_OF_1 and in MT_VAL_ADD_CHN_DGM → CT_IS_PRCS_ORNT_SUPER; appl_sys→func
      invented code → CT_SUPP_3; func→ENT_TYPE → CT_HAS_OUT with the ambiguity note; pers→func →
      CT_EXEC_1 with the ambiguity note; valid codes untouched (zero rewrites, `value` is the
      SAME reference when nothing changed); dangling sourceLogicalId → untouched; OT_RULE→OT_RULE
      → untouched; non-object/garbage raw → passed through unchanged; input object provably not
      mutated. `arisAiGeneration.test.ts`: add a case where the first (and only) response carries
      two invented codes with mappable endpoints → `ok:true`, `requestsSent === 1`,
      `semanticAttemptsUsed === 0`, `warnings` contains exactly 2 `normalized-connection-type`
      findings.
      Acceptance: `npx vitest run src/aris/ai/normalizeDraft.test.ts src/aris/shell/arisAiGeneration.test.ts` green.
      Note: with M5's enum lock active the normalizer mostly serves non-structured-output routes
      (glm-5.2 today) and the OpenRouter silently-dropped-param case — it is the unconditional
      backstop, not dead code.

- [ ] **M5 — Enum-locked `json_schema` structured outputs (OpenRouter route).** Owner: opus
      implementer. Files: `src/ai/browserAi.ts`, NEW `src/aris/ai/draftJsonSchema.ts`, NEW
      `src/aris/ai/draftJsonSchema.test.ts`, `src/ArisGenerationPanel.tsx`,
      `src/ai/__tests__/payloadBuilders.test.ts`, `src/ai/__tests__/requestPrivacy.test.ts`
      (extend if request-shape assertions break).
      Transport (`browserAi.ts`): 1. `BuildOpts` (`:92-98`) gains `responseSchema?: { name: string; schema: Record<string, unknown> }`. 2. `buildOpenRouterRequest` (`:579-614`): replace the `:596` line with —
      `if (opts.responseSchema) body.response_format = { type: 'json_schema', json_schema: { name: opts.responseSchema.name, strict: true, schema: opts.responseSchema.schema } }`
      `else if (opts.jsonMode) body.response_format = { type: 'json_object' }`.
      Also add `body.usage = { include: true }` unconditionally (OpenRouter accounting field;
      returns authoritative `usage.cost` that `extractUsage` at `credits.ts:1640` already
      reads — makes the M8 cost assertion real instead of estimated). 3. `buildAnthropicRequest`/`buildGeminiRequest` IGNORE `responseSchema` (documented in a
      comment — direct-vendor adapters are out of scope this wave). 4. `makeBrowserCallLLM` `extra` (`:829-833`) gains `responseSchema?`, threaded into the
      `buildRequest` call at `:842` for EVERY attempt of the run (first + repair turns — the
      draft shape is identical on repair).
      Schema module (`draftJsonSchema.ts`): `export function buildArisAiDraftJsonSchema(): Record<string, unknown>`
      — a hand-written JSON Schema mirroring `contract.ts` EXACTLY (no new dependency; do NOT add
      zod-to-json-schema). Every object: `additionalProperties: false`. `required` arrays mirror
      zod optionality precisely — **optional fields are omitted from `required` and are NOT
      nullable** (zod `.optional()` rejects explicit `null`, so a nullable schema would produce
      drafts the validator rejects): - draft: required `[version, models, objects, relations, attributes, assignments, uncertainties]`; `version: {const: 1}`. - model: required `[logicalId, modelType, names, confidence]`; `modelType` enum = `ARIS_AI_SUPPORTED_MODEL_TYPES`. - object: required `[logicalId, modelLogicalId, objectType, names, attributes, confidence]`;
      `objectType` enum = `ARIS_AI_SUPPORTED_OBJECT_TYPES`; `symbolType` stays a FREE string —
      deliberate deviation from the research note: `buildAmlFromArisAiDraft`
      (`src/aris/shell/arisAiCreate.ts:133,197`) uses `object.symbolType ?? DEFAULT_SYMBOLS[…]`
      for ALL object types, so locking it to the 3 rule operators would destroy legitimate
      satellite symbol choices; the rule-symbol vocabulary is still enforced for OT_RULE by
      `typeValidation.ts`. - relation: required `[logicalId, modelLogicalId, sourceLogicalId, targetLogicalId, connectionType, confidence]`;
      **`connectionType` enum = `ARIS_AI_SUPPORTED_CONNECTION_TYPES`** (the point of the lane —
      `CT_FLOW` becomes unrepresentable on schema-enforcing routes). - attribute: required `[logicalId, ownerKind, ownerLogicalId, attributeType, values, confidence]`; `ownerKind` enum. - assignment: required `[logicalId, assignmentType, objectLogicalId, assignedModelLogicalId, confidence]`; `assignmentType` enum `['linked-model']`. - uncertainty: required `[targetLogicalId, kind, message]`; `kind` enum = `ARIS_AI_UNCERTAINTY_KINDS`. - localized text (`names`/`values`): properties `en`/`ar` (`type: 'string', minLength: 1`), no `required`, `additionalProperties: false`. - confidence everywhere: enum `['high','medium','low']`.
      Panel wiring (`ArisGenerationPanel.tsx` `buildSend`, `:534-557`): compute
      `const responseSchema = providerId === 'openrouter' && OPENROUTER_STRUCTURED_OUTPUT_MODELS.has(modelId.trim()) ? { name: 'aris_ai_draft_v1', schema: buildArisAiDraftJsonSchema() } : undefined`
      and pass it in the `makeBrowserCallLLM` extra. All other routes keep today's `json_object`.
      Tests: `draftJsonSchema.test.ts` — every enum in the schema `toEqual`s its exported
      vocabulary constant (drift guard); the `required` arrays match the lists above; spot-check
      that a known-valid draft's optional-field omissions are legal (`symbolType` absent from
      relation/object `required`). `payloadBuilders.test.ts` — with `responseSchema` the body
      carries `response_format.type === 'json_schema'` + `strict: true` + the enum reachable at
      `json_schema.schema.properties.relations.items.properties.connectionType.enum`; without it
      the `json_object` line (`:189`) still holds; `usage: {include:true}` present; the ZDR pin
      assertion (`:191`) untouched.
      Acceptance: `npx vitest run src/ai src/aris/ai/draftJsonSchema.test.ts` green.
      Runtime risk (flagged for the A/B): OpenRouter forwards json_schema per endpoint; if a live
      route 400s on it, the fallback is CONFIG — remove that model from
      `OPENROUTER_STRUCTURED_OUTPUT_MODELS` (one line) and note it in the outcome ledger; never
      auto-fallback silently in code. The zod validator + M4 normalizer remain the unconditional
      backstop either way (OpenRouter drops unsupported params silently on some routes).

- [ ] **M6 — Raise the attachment output budget 8k → 16k.** Owner: opus implementer.
      Files: `src/ArisGenerationPanel.tsx`, `src/ai/browserAi.ts` (comment only),
      panel tests (`src/aris/shell/arisCreateDocumentAi.test.tsx` /
      `src/aris/shell/arisCreatePanel.test.tsx`) if they assert `max_tokens`.
      Changes: keep `MAX_TOKENS = 8_000` for text runs; add `const MAX_ATTACHMENT_TOKENS = 16_000`.
      `buildSend` becomes `buildSend(hasAttachment: boolean)` (call site `send: buildSend(encoded !== undefined)`
      in `createWithAi`, `:599`) and passes `maxTokens: hasAttachment ? MAX_ATTACHMENT_TOKENS : MAX_TOKENS`
      — **for every request of the run, including repair turns** (a repair turn re-emits the FULL
      draft; keying on `request.attachment` would starve turns 2+). Rationale: the recorded
      26-object draft measures ~3.1k output tokens; a full 14-function register draft scales to
      ~8–10k — over the old cap → truncation → fake semantic failure. 16k tokens ≈ 64–100 KB,
      far inside `MAX_PROVIDER_RESPONSE_BODY_BYTES` (1 MiB, `browserAi.ts:187`); update the stale
      "at most 6,000 output tokens" comment at `browserAi.ts:182-186` to the new number. Both A/B
      models allow ≥32k completion tokens (live-verified).
      Acceptance: `npm run typecheck`; the two panel test files green.

- [ ] **M7 — Product decision: PDFs on image-only models are GATED (+ one-click model switch).**
      Owner: opus implementer. Files: `src/ArisGenerationPanel.tsx`,
      `src/i18n/dictionaries.ts` (en block near `:2754`, ar block near `:5689`),
      `src/aris/shell/shellI18n.ts` (`ARIS_SHELL_MESSAGE_KEYS`),
      `src/aris/shell/arisCreateDocumentAi.test.tsx`.
      **Decision (recorded): gate via capability flags; do NOT bundle pdfjs-dist.** Justification:
      (a) repo precedent — `src/ai/pdf.ts:1-9` deliberately excludes pdfjs (~500 KB gzip) from a
      single-file artifact whose size is a shipping constraint; (b) the OCR fallback a PDF would
      otherwise take on an image-only model is a **ZDR leak** (plugins are outside ZDR
      enforcement) and lossy for arrow topology — the exact failure this wave kills; (c) the
      fail-closed machinery for gating already exists end-to-end
      (`getLiteModelCapabilities` → `isAttachmentMediaTypeSupported` → `checkArisAiAttachment`
      `pdf-unsupported`, re-checked at pick AND send time). Client-side rasterization stays a
      recorded future option if a must-serve-PDF-on-qwen requirement ever appears.
      UX change (the only product-code change): today a capability rejection is a dead end. Add a
      suggestion action — keep the last REJECTED `File` in a ref (rejection currently nulls the
      picked state, `:461-465`); when `checkArisAiAttachment` returns `pdf-unsupported`,
      `image-unsupported`, or `model-unverified` on the OpenRouter provider AND
      `firstLiteModelForAttachment(providerId, kind)` (M1) returns a model, render next to the
      `attachmentNotice` a button `data-orbitpm-aris-create-attachment-switch=""` labeled
      `tk('aris.create.attachment.switchModel', 'Switch to {model} and attach', { model })` that
      calls `selectModel(suggested)` then re-runs `pickAttachment` on the kept File. No silent
      auto-switch (the panel's "no fallback" philosophy at `:343-344` stands — this is an explicit
      user action).
      i18n: register the new key in BOTH dictionaries (en+ar) AND `ARIS_SHELL_MESSAGE_KEYS` —
      `src/__tests__/i18n.test.ts:212` fails otherwise.
      Tests (`arisCreateDocumentAi.test.tsx`): picking a PDF with the qwen model selected shows
      the `pdf-unsupported` notice + the switch button; clicking it selects
      `google/gemini-3.5-flash-lite` (the first pdf-capable curated model per M1 ordering) and the
      attachment becomes accepted; picking a PNG with a text-only model (e.g. `z-ai/glm-5.2`)
      offers a switch to the first image-capable model.
      Acceptance: `npx vitest run src/aris/shell/arisCreateDocumentAi.test.tsx src/__tests__/i18n.test.ts` green.

- [ ] **M8 — Seq-2 A/B harness: parameterized model, image mode, hard gates, cost.** Owner: opus
      implementer. Files: `src/aris/ai/createFromPdf.seq2.fixture.ts`,
      `src/aris/ai/createFromPdf.seq2.test.ts`; OFFLINE step in `reference/AnimalWF/png/`
      (outside the repo — see below).
      **Rasterization (offline, once, before the live runs; NOT in CI, NOT committed):**
      `bash
    mkdir -p /home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/png
    pdftoppm -png -r 150 \
      /home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/pdf/Register_Animal_Owner_Profile_Draft03.pdf \
      /home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/png/Register_Animal_Owner_Profile_Draft03
    `
      → produces `Register_Animal_Owner_Profile_Draft03-1.png` (A3 842×1191 pt @150 dpi ≈
      1754×2481 px). Verify size < 5 MiB (`IMAGE_SIZE_LIMITS.openrouter`, `src/ai/pdf.ts:128-132`);
      if over, re-run at `-r 120`. `pdftoppm` is present at `/usr/bin/pdftoppm`. The `reference/`
      tree lives outside the git repo, so committing it is structurally impossible from
      `desktop/` — still, never copy the PNG into the repo.
      Fixture changes: - KEEP `SEQ2_OPENROUTER_MODEL_ID = 'z-ai/glm-5.2'` (`:32`) — it names the RECORDED
      fixture's model; mocked tests stay pinned to it (deterministic, env-free). - Add `export const SEQ2_VISION_MODEL_ID = process.env.SEQ2_VISION_MODEL ?? 'google/gemini-3.5-flash-lite'`
      (live-mode arm selector), `export const SEQ2_LIVE_SOFT_TARGET = 0.65`,
      `export const SEQ2_LIVE_MAX_COST_USD = 0.1`.
      Test changes: - `SEQ2_MAX_TOKENS` (`:69`) → `16_000` with a comment tying it to the panel's
      `MAX_ATTACHMENT_TOKENS` (M6); update the mocked `max_tokens` assertion (`:185`). - `makeSeq2Send(apiKey, modelId = SEQ2_OPENROUTER_MODEL_ID)` — pass the model through to
      `makeBrowserCallLLM`; when `OPENROUTER_STRUCTURED_OUTPUT_MODELS.has(modelId)` also pass
      `responseSchema: { name: 'aris_ai_draft_v1', schema: buildArisAiDraftJsonSchema() }`
      (exactly mirroring the panel's M5 wiring). - Update the two existing mocked request-shape assertions for the M5 transport additions
      (`usage: {include:true}`; glm-5.2 still gets `response_format: {type:'json_object'}`). - NEW mocked test "json_schema request shape for structured-output vision models": send via
      `makeSeq2Send('k', 'google/gemini-3.5-flash-lite')` (literal, NOT the env-dependent
      const), replay the recorded body, assert `response_format.type === 'json_schema'`,
      `json_schema.name === 'aris_ai_draft_v1'`, `json_schema.strict === true`, and
      `json_schema.schema.properties.relations.items.properties.connectionType.enum` equals
      `ARIS_AI_SUPPORTED_CONNECTION_TYPES`; pipeline still returns the recorded draft. - NEW mocked test "invented connection types are normalized without a repair turn": replay a
      variant of the recorded body with `rel-trigger-login` set to `CT_FLOW` (evt→func) and one
      func→evt relation set to `CT_SEQ` → expect `ok:true`, `requestsSent === 1`,
      `semanticAttemptsUsed === 0`, exactly 2 `normalized-connection-type` warnings, and the
      final draft carrying `CT_ACTIV_1`/`CT_CRT_1`. - Live PDF test (existing, reshaped): model = `SEQ2_VISION_MODEL_ID`; keep the in-body
      `OPENROUTER_API_KEY` early return FIRST; then a capability mirror-guard —
      `if (!getLiteModelCapabilities('openrouter', SEQ2_VISION_MODEL_ID).pdf) { console.warn('…image-only model; PDF arm skipped by the same gate the product enforces'); return }`
      (this is how the qwen sweep legally skips the PDF cell — never send qwen a PDF).
      Usage capture: wrap the real `fetch` (`const realFetch = globalThis.fetch` +
      `vi.stubGlobal('fetch', …)` pass-through) — for calls to
      `https://openrouter.ai/api/v1/chat/completions`, `res.clone()`, parse JSON, run
      `extractUsage('openrouter', json)`, accumulate `providerCostUsd ?? estimateCostUsd(SEQ2_VISION_MODEL_ID, inputTokens, outputTokens)`
      (PRICES rows exist per M1) and the request count; return the untouched original response.
      `afterEach` already unstubs.
      Assertions (the A/B hard gates): `result.ok`; **`result.semanticAttemptsUsed <= 1`**;
      `result.warnings.filter(w => w.code === 'normalized-connection-type').length <= 3`
      (zero `unsupported-connection-type` findings survive by construction on success — the ≤3
      normalizer bound proves the model mostly speaks the vocabulary rather than being
      rescued); MT_EEPC + AML assertions unchanged; **`score >= 0.5`** (existing floor) and a
      SOFT target — `if (breakdown.score < SEQ2_LIVE_SOFT_TARGET) console.warn('below soft target 0.65 …')`
      (never a hard fail; glm-5.2's OCR-blind runs tuned the 0.5 floor — a model that sees
      arrows should beat it); **total estimated cost < SEQ2_LIVE_MAX_COST_USD ($0.10)** hard
      when every request yielded usage, `console.warn` otherwise. Finish with ONE grep-able
      line: `SEQ2-AB model=<id> mode=pdf score=<s> fn=<..> ev=<..> mix=<..> conn=<..> repairs=<n> requests=<n> normalized=<n> costUsd=<c>`. - NEW live IMAGE test (covers the picture tab the live suite never exercised): same
      skeleton; read `reference/AnimalWF/png/Register_Animal_Owner_Profile_Draft03-1.png`
      (accept a no-suffix candidate too, mirroring the PDF candidates pattern `:356-360`);
      key-gate FIRST, then if the PNG is missing fail loudly with the exact `pdftoppm` command
      in the message (a keyed run without the raster is an operator error, not a skip);
      attachment `{ kind:'image', mediaType:'image/png', … }`; prompt mirrors the panel's
      picture path exactly — `buildArisAiPrompt({ modelName: 'Request to Register Animal Owner Profile', modelType: 'auto-detect', description: buildImageInstruction('Register Animal Owner Profile') })`;
      model = `SEQ2_VISION_MODEL_ID` (no pdf-capability guard — both arms run this cell); same
      assertions + `mode=image` summary line; same 900 s timeout.
      Acceptance (CI-safe, no key): `npx vitest run src/aris/ai/createFromPdf.seq2.test.ts --maxWorkers=1 --retry=0`
      green with the live tests early-returning; `npm run check:no-skips` green (in-body returns,
      no `.skip`).

### Wave 8 — the live A/B run procedure (implementer/orchestrator, after M1–M8 are green)

1. Load the key WITHOUT echoing it:
   `set -a; source /home/ahmed/.claude/jobs/501f0ce4/tmp/openrouter.env; set +a` — never commit,
   never print, never write it into any file under version control.
2. Ensure the raster exists (M8 offline step, once).
3. Run the matrix from `/home/ahmed/Desktop/bpmn_tool/desktop` (three live cells total —
   gemini×pdf, gemini×image, qwen×image; qwen×pdf self-skips via the capability guard):
   - `SEQ2_VISION_MODEL=google/gemini-3.5-flash-lite npx vitest run src/aris/ai/createFromPdf.seq2.test.ts --maxWorkers=1 --retry=0`
   - `SEQ2_VISION_MODEL=qwen/qwen3-vl-235b-a22b-instruct npx vitest run src/aris/ai/createFromPdf.seq2.test.ts --maxWorkers=1 --retry=0`
     Expected spend ≈ $0.04/cell (gemini) / ≈ $0.03 (qwen), ≤ ~$0.25 total incl. a repair turn.
4. Copy each `SEQ2-AB …` line into the outcome ledger below. If a cell fails its hard gates,
   diagnose (truncation? schema 400 → M5 config fallback? repair exhaustion?), fix, re-run —
   record every attempt.
5. **Pick the attachment-default winner**: both hard-gate-passing models compared by score (image
   mode is the common denominator; gemini's PDF cell breaks ties toward gemini), then by cost.
   Promote the winner to be the FIRST of the two vision entries in `OPENROUTER_MODELS` (M1 note)
   so `firstLiteModelForAttachment` (M7's suggestion) offers it first. `z-ai/glm-5.2` stays the
   overall picker default (text tab).
6. Full verify set: `npm run typecheck && npm run lint && npm test && npm run check:no-skips`
   (the default vitest project includes the seq2 file; live tests early-return without the key in
   CI). Commit in wave-scoped commits; the key and anything under
   `/home/ahmed/Desktop/bpmn_tool/reference/` never enter git.

### Wave 8 outcome ledger (fill during step 4; planning-agent template)

| model                            | mode  | score (fn/ev/mix/conn)              | repairs | requests | normalized | cost USD | json_schema honored? | hard gates |
| -------------------------------- | ----- | ----------------------------------- | ------- | -------- | ---------- | -------- | -------------------- | ---------- |
| google/gemini-3.5-flash-lite     | pdf   |                                     |         |          |            |          |                      |            |
| google/gemini-3.5-flash-lite     | image |                                     |         |          |            |          |                      |            |
| qwen/qwen3-vl-235b-a22b-instruct | image |                                     |         |          |            |          |                      |            |
| qwen/qwen3-vl-235b-a22b-instruct | pdf   | — capability-gated skip (by design) |         |          |            |          |                      |            |

Winner promoted to first vision slot: ______ · schema fallbacks applied: ______ · notes: ______

### Wave 8 exit gate — definition of done

- [ ] **Both models produce a valid register-owner process live**: gemini-3.5-flash-lite passes
      the PDF AND image cells, qwen3-vl-235b-a22b-instruct passes the image cell — each with
      `ok`, `semanticAttemptsUsed ≤ 1`, score ≥ 0.5 (soft-target 0.65 logged), cost < $0.10/run,
      ≤ 3 normalizer rewrites, zero surviving `unsupported-connection-type` findings.
- [ ] **The CT_FLOW class is dead twice over**: enum-locked `json_schema` on both A/B routes
      (or a ledger-recorded config fallback), AND the deterministic normalizer + teaching finding + prompt vocabulary protect every route including non-structured-output ones (mocked
      coverage in M4/M8 proves the no-repair-turn recovery).
- [ ] **MAX_TOKENS fix verified**: attachment runs (and their repair turns) request 16_000; the
      mocked request-shape test pins it.
- [ ] **The qwen-never-sees-a-PDF invariant holds at every layer**: capability registry test
      (M1), panel gate + switch suggestion (M7), live-test mirror guard (M8).
- [ ] Mocked Seq-2 Mode 1 (and every other suite) runs green in CI with NO key, NO network, NO
      `reference/` tree, no `.skip`.
- [ ] Full verify set green (`typecheck`, `lint`, `npm test`, `check:no-skips`); outcome ledger
      filled; winner promoted; the OpenRouter key and the private `reference/` tree (incl. the
      new `png/`) never appear in any commit.

## Wave 9 — PDF-fidelity pass 2 (deep render + re-baseline)

> **Section authored 2026-07-31 by the Wave-9 planning agent.** Basis: the root-caused diff plan at
> `/home/ahmed/.claude/jobs/501f0ce4/tmp/pdf-fidelity-fixplan.md` (all §-references below are into
> that file; its §0 "Measured ground truth" table is the calibration source for every number in
> this wave) and the evidence crops at `/home/ahmed/.claude/jobs/501f0ce4/tmp/pdf-fidelity-crops/`
> (`cmp-*.png` = ORIGINAL left / GENERATED right; `crop.py`/`crop2.py`/`crop3.py` in that dir are
> reusable). All file/line anchors re-verified against the working tree at `fd763d2`.
>
> **What pass 1 already shipped (commits `44e94bc` / `a92acb5` — do NOT re-do):** selectable Latin
> text via an invisible jsPDF text overlay (`exportArisPdf.ts` `overlayArisTextRuns` +
> `collectArisExportTextRuns`), stripped invisible `<Lane>` frames from the export
> (`EXPORT_STRIP_SELECTOR` + `canvasSync.externalNamePlacement` guard), event-glyph convex
> geometry + vertical 25 % divider (`shapes.ts` `eventShape`), Requirements duplicate-caption
> suppression. Pass 1 deliberately kept the IMPORTED RENDER byte-stable so `test:aris:animalwf`
> stayed green untouched. **Pass 2 is the opposite contract: every lane below changes the imported
> render on purpose, so every lane carries its own authorized re-baseline.**
>
> **Deliberately OUT of this wave** (recorded now so nobody "helpfully" folds them in): the
> svg2pdf true-vector export (fixplan §1 preferred path), A3-portrait page geometry (§2), legend
> tier-1 restyle (§3.3), header-band styling / model-attribute styled runs (§3.4 + §6.3),
> Requirements interior text-area anchoring beyond pass-1's suppression (§6.1 fix 2 residual), and
> the caption vertical clamp (§6.2 fix 2). They are pass-3 candidates; none blocks any lane here.

### Worker routing (task contract for the orchestrator)

Each lane is tagged `[sonnet]` (mechanical / numeric / localized) or `[opus]` (judgment /
visual-calibration / multi-file / oracle-re-baseline). Dispatch `[sonnet]` lanes to a
sonnet-medium worker and `[opus]` lanes to opus-4.8, per goal.md's dispatch rules. Lanes execute
**strictly in order P1 → P11** (they share `renderer.ts` / `shapes.ts` / `canvasSync.ts`;
sequential execution is the contention contract, exactly like Wave 8's M-lanes). Run each lane's
verify set before starting the next.

| Order | Lane                                              | Worker |
| ----- | ------------------------------------------------- | ------ |
| 1     | P1 arrowhead truth table                          | sonnet |
| 2     | P2 stroke system (pen unit + marker size)         | sonnet |
| 3     | P3 XOR operator circle                            | sonnet |
| 4     | P4 band / content-box / badge geometry            | sonnet |
| 5     | P5 real font metrics (AFM em-tables)              | sonnet |
| 6     | P6 Reference-Laws title anchor                    | sonnet |
| 7     | P7 RACI `Port="NW"` placement calibration         | opus   |
| 8     | P8 function-green + color-drift adjudication      | opus   |
| 9     | P9 icon-set redraw (ARIS filled-white originals)  | opus   |
| 10    | P10 Arabic selectable text in the PDF export      | opus   |
| 11    | P11 OLE decode tier 1 (DMT logo) + tier-2 verdict | opus   |

### What currently pins the imported render (the oracle inventory)

Binding map — every lane names which of these it re-baselines; anything not named must stay green
untouched:

1. **Expectation JSONs** (OUTSIDE the repo, never committed):
   `/home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/expected/{register-owner,renew-profile}.expected.json`
   (iterate, via `test:aris:animalwf` → `src/aris/fidelity/{registerOwner,renewProfile}.animalwf.test.ts`)
   and `{transfer-citizens,transfer-citizens-companies}.expected.json` (holdout, via
   `test:aris:animalwf:holdout`). They pin **topology + text + `symbolNum` + decoded occurrence
   `fill`** (`compare.ts` reads `occurrence.style.fillColor` through `occurrenceColorToCss`), NOT
   arrows, pen widths, wraps, icons, or label rects. ⇒ Only **P8** (a fill-value change) can touch
   them; every other lane leaves all four JSONs byte-identical.
2. **In-repo animalwf suites** (run via `test:aris:animalwf`):
   - `src/aris/canvas/attributeLabels.animalwf.test.ts:145-165` — "a marker-end arrowhead on
     EVERY connection" for both iterate models. **Directly conflicts with P1**; P1 rewrites it.
   - `src/aris/canvas/connectionLabels.animalwf.test.ts:279-321` — "centres every placement on
     its route midpoint plus the source offsets" for all 123 placements. **Conflicts with P7**
     (the `Port="NW"` RACI badges move); P7 splits it by port.
   - `src/aris/canvas/printFrame.animalwf.test.ts` — header frame/value anchors (:160-195), org
     block `data-aris-ole-pending === 'true'` (:199-204, **conflicts with P11**), 19-tile legend
     (:211-229), per-model RACI letter sets (:236-252, letters only — survives P7), Reference-Laws
     box rect + `stroke #000000` (:259-271), numbering below cards (:278-300).
   - `src/aris/renderer/animalWfRealData.animalwf.test.ts:86-88` — pins
     `fidelityByKind['unsupported-ole-rendering'] === 14` (**conflicts with P11**) and
     `missing-template === 8`.
   - `src/aris/canvas/typography.animalwf.test.ts` — inequality-based (font sizes, ≥3 multiline,
     line pitch ×1.15); survives P5 but must be re-run there.
3. **In-repo unit suites pinning exact render values:**
   `src/aris/canvas/connectionAppearance.test.ts:85-100` (`strokeWidth '3px'`/`'10px'`, marker
   ids, explicit `SrcArrow`/`TgtArrow` override behavior), `src/aris/symbols/symbols.test.ts:104`
   (function accent `'#339900'`) / `:107-130` (36 distinct fingerprints — derived, uniqueness
   only) / `:150-164,184` (icon identity per catalogId), `src/aris/canvas/legend.test.ts:99-112`
   (accent `'#339900'`/`'#edbbdc'`, 19 tiles), `src/aris/canvas/renderer.dmt.test.ts` (structural:
   6-point event surface, 2 function icon polygons, app-window `16/23` rect ratio — the ratio pin
   conflicts with P9), `src/aris/renderer/textWrap.test.ts` + `typography.test.ts` +
   `rendererTypography.test.ts` (wrap fixtures — conflict with P5), `freeTextLayout.test.ts`
   (conflicts with P6), `raci.test.ts` (letters only).
4. **e2e:** `tests/e2e/aris-sequence-1.spec.ts` — exported-PDF ink-structure similarity
   `SIMILARITY_THRESHOLD = 0.75` against the reference PDFs (:58,:150-169). Every P-lane moves
   this score TOWARD the reference; record the per-model score before/after each lane (the spec
   logs it) and treat any decrease as a lane failure. `aris-fidelity-screenshots.spec.ts` pins
   only counts, no pixels. No e2e pins stroke widths or arrow presence (worker re-greps to
   confirm before touching).

### The re-baseline protocol (binding for EVERY lane in this wave)

1. **Implement** the render change (test-first where a pure function allows it).
2. **Crop-verify against the reference PDF — the arbiter is the original PDF crop, never the old
   expectation or test value.** Loop (chromium is the pixel oracle):

   ```bash
   npm run build:aris                                    # rebuilds dist/index.html + release artifact
   npx playwright test tests/e2e/aris-sequence-1.spec.ts --project=chromium
   #   → exported PDFs at /home/ahmed/.claude/jobs/501f0ce4/tmp/pdf/seq1/register-owner-chromium.pdf (+ renew-profile)
   pdftoppm -r 300 -png /home/ahmed/.claude/jobs/501f0ce4/tmp/pdf/seq1/register-owner-chromium.pdf gen
   # re-crop the SAME regions with crop.py/crop2.py from the crops dir and diff side-by-side vs
   # /home/ahmed/.claude/jobs/501f0ce4/tmp/pdf-fidelity-crops/orig-*.png / cmp-*.png
   ```

   The lane report names each crop inspected and the verdict. A lane is not done until its named
   crops match the original (within print-raster tolerance).

3. **Re-baseline in-repo assertions in the same lane/commit as the code change** — an AUTHORIZED
   change, not assertion-weakening: update exactly the assertions the lane lists, keep every
   structural invariant untouched (281 bounds / 269 routes / 123 placements / orthogonality /
   z-order / counts / letters), and never touch an assertion the lane does not list.
4. **Oracle JSONs (P8 only).** The four expectation JSONs live outside the repo and are never
   committed. An authorized value change is applied as a **mechanical, model-independent
   transform run uniformly over ALL FOUR files** (iterate + holdout together — same rule, no
   per-model hand edits), the same way Wave 6 V3 re-based expectations onto PDF-correct colors.
   Example shape (green decision, if P8 changes the value):

   ```bash
   node -e 'const fs=require("fs");for(const f of process.argv.slice(1)){fs.writeFileSync(f,fs.readFileSync(f,"utf8").replaceAll("\"#009933\"","\"#<NEW>\""))}' \
     /home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/expected/*.expected.json
   ```

   The exact command + per-file before/after sha256 go into the Wave-9 ledger. **The orchestrator
   runs/sanctions the transform** (workers may not edit holdout files); topology/counts/names in
   the JSONs never change in this wave.

5. **Holdout discipline.** `test:aris:animalwf:holdout` is NOT part of any lane's inner loop. It
   runs exactly twice in this wave: once immediately after a sanctioned P8 oracle transform (to
   prove the transform, orchestrator-run), and once at the Wave-9 exit gate. Nothing is ever
   tuned against a holdout.
6. **Per-lane gate** (in addition to lane-specific verify commands):

   ```bash
   npm run test:aris:animalwf        # must be green at the END of every lane — never left red between lanes
   npx vitest run <lane test paths>
   npm run typecheck && npm run lint && npm run check:no-skips && npm run check:ui-copy
   npx prettier --write <touched files>
   ```

### Lanes (strictly in order; each lists exact change → crop-verify → re-baseline → acceptance)

- [ ] **P1 `[sonnet]` — Arrowhead truth table: prune arrow-less connection types.**
      Files: `src/aris/canvas/renderer.ts` (`DIRECTED_CONNECTION_TYPES` :94-117),
      `src/aris/canvas/attributeLabels.animalwf.test.ts` (:145-165 rewrite),
      `src/aris/canvas/connectionAppearance.test.ts` (extend).
      Change (fixplan §5.2): all 93 register CxnOcc carry `SrcArrow="0" TgtArrow="0"` (= default),
      so the default-arrow set IS the render. Prune it to the reference truth table. Seed (verify
      each against `orig-1.png` / crops before finalizing — enumerate every distinct
      `CxnDef.Type` across all 8 models first): **KEEP arrow at target** (control flow + outputs + informed) — `CT_ACTIV_1`, `CT_CRT_1`, `CT_LEADS_TO_1`, `CT_LEADS_TO_2`,
      `CT_IS_EVAL_BY_1`, `CT_IS_PREDEC_OF_1`, `CT_CRT_OUT_TO`, `CT_HAS_OUT`,
      `CT_MUST_BE_INFO_ABT_1` (arrow visible at fn 14/03 — `cmp-approve14.png`), and align
      `CT_DECID_ON` + `CT_MUST_BE_CONSLT_ABT_1` with the I-row (0 occurrences in AnimalWF; the
      manual's RACI family shows the arrow at the Function). **REMOVE** (plain line in the
      original) — `CT_EXEC_1`, `CT_EXEC_2` (R-role — `cmp-zoom-raci-r.png`), `CT_SUPP_3`
      (TAMM / Smart Hub / UAE Pass / DED — `cmp-ded.png`), `CT_IS_INP_FOR`, and
      verify-then-decide `CT_READ_1`, `CT_REFS_TO_2`, `CT_AFFECTS` from the crops
      (`cmp-ded.png`, `cmp-requirements.png`). Org-chart types (`CT_IS_COMPOUND_OF_1`,
      `CT_IS_ORG_MANAGER_1`, `CT_IS_TECH_SUPER_1`, `CT_OCCUPIES_1`) have no reference sheet —
      leave them in the set, marked `// unverified-by-reference` in a comment.
      Explicit `SrcArrow`/`TgtArrow` occurrence overrides keep winning (`sourceArrow()` fallback
      logic untouched — `connectionAppearance.test.ts` explicit-override case must stay green
      unmodified).
      Crop-verify: `cmp-ded.png` (no arrow into the green box), `cmp-zoom-raci-r.png` (R plain
      line), `cmp-approve14.png` (I keeps its arrow), `cmp-zoom-funcbadge.png`.
      Re-baseline: REWRITE `attributeLabels.animalwf.test.ts:145-165` from "marker-end on every
      connection" into a per-connection-type truth-table test: export the final table (or derive
      it from `DIRECTED_CONNECTION_TYPES`), walk every connection of BOTH iterate models, assert
      `marker-end` presence `===` table[type] in both directions, assert ≥ 1 arrow-less type
      actually occurred (guards the prune took effect), and keep the shared-`<defs>`-marker
      assertion. Grep `tests/e2e` for arrow-presence assumptions (none known).
      Acceptance: rewritten suite green for both models; `connectionAppearance` green with the
      explicit-override case unmodified; `test:aris:animalwf` green; crops match; ledger row
      records the final truth table (type → arrow yes/no → evidence crop).

- [ ] **P2 `[sonnet]` — Stroke system: `ARIS_PEN_UNIT` + arrowhead size + fallback stroke color.**
      Files: `src/aris/canvas/renderer.ts` (`drawConnection` :1099-1104, `ensureConnectionArrowMarker`
      :661-697, `resolvePaint` :240-250, `CONNECTION_STROKE` :87), `src/aris/canvas/printFrame.ts`
      (`drawGraphicFrames` :526), `src/aris/canvas/connectionAppearance.test.ts`, plus any test a
      grep for pinned widths surfaces (`occurrenceStyle.test.ts`, `printFrame.test.ts`).
      Change (fixplan §5.3/§5.4/§5.5): ARIS logical pen width 1 ≈ 0.265 mm ≈ 2.65 canvas units;
      ours paints 1 unit (≈2.6× too thin), and the marker V is 8×8 units vs the original's ≈16
      long × 34 across. (1) Export `ARIS_PEN_UNIT = 2.646` from `renderer.ts` and multiply every
      SOURCE pen width by it: `drawConnection` (`strokeWidth = width * ARIS_PEN_UNIT`,
      absent/default width 1 → 2.646), `resolvePaint.strokeWidth` (occurrence pen overrides),
      `printFrame.drawGraphicFrames` (`Math.max(1, (penWidth ?? 1)) * ARIS_PEN_UNIT`);
      **descriptor-authored primitive widths stay untouched** (already visually calibrated).
      (2) Marker (`ensureConnectionArrowMarker`): `markerWidth 18`, `markerHeight 36`, `refX 16`,
      `refY 17`, open path `M0,0 L16,17 L0,34` stroke-width ≈ 2.646, filled path same + `z`;
      `refX = length` keeps the tip ON the target edge; `markerUnits userSpaceOnUse` stays.
      (3) `CONNECTION_STROKE` fallback `#475569` → `#000000` (applies only to sources without
      pens; AnimalWF pens already decode to black — print parity, §5.5).
      Crop-verify: `cmp-zoom-arrowhead.png` (V ≈ 34 across × 16 along, black, tip at target),
      `cmp-gate-merge.png`, `cmp-reflaws.png` (frame now ≈0.36 pt at print scale), overview
      `orig-1-overview.png` vs a fresh gen overview (line weight parity).
      Re-baseline: `connectionAppearance.test.ts` `'3px'` → `'7.938px'` and `'10px'` → `'26.46px'`
      (Pen Width 3/10 × 2.646); marker-geometry assertions if any test pins `markerWidth 9`/path
      `M0,0 L8,4 L0,8` (grep). Screen look thickens slightly — that MATCHES the reference (risk
      note §5.4); e2e screenshots pin no pixels.
      Acceptance: both tests + `test:aris:animalwf` green; Seq-1 similarity did not drop; crops
      match.

- [ ] **P3 `[sonnet]` — XOR/operator circle fills its box; bolder mark; arrow gap closed.**
      Files: `src/aris/symbols/shapes.ts` (`ruleShape` :782-828), `src/aris/symbols/symbols.test.ts`,
      `src/aris/canvas/renderer.dmt.test.ts` (only if a grep shows radius/mark pins).
      Change (fixplan §4.4): original circle fills the 141-box exactly; ours is r 44/100 with a
      thin small X, and the docked arrow stops at the box edge leaving a 6-unit gap.
      `circle(50,50,44)` → `circle(50,50,50)` (circle = box, closes the gap since connections dock
      to the rectangular shape path); X arms `(36,36)-(64,64)` → `(30,30)-(70,70)` with
      `strokeWidth` 10–12 (calibrate on `cmp-gateway.png`); scale the AND `∧` / OR `∨` marks'
      stroke to the same weight (family consistency — AND appears on the transfer sheets);
      `hitPath` → `M 50 0 A 50 50 0 1 1 49.999 0 Z`; `iconBox`/ports unchanged. Grey stays
      `#999999` (≈ sampled `#9A9A9A` — no change).
      Crop-verify: `cmp-gateway.png`, `cmp-gate-merge.png` (circle spans the box, arrow tip
      touches the circle after P2's `refX`), transfer-sheet AND if crops exist.
      Re-baseline: `symbols.test.ts` fingerprints are derived (uniqueness-only — safe); update any
      literal `44`/mark-coordinate pins a grep over `src/aris/**/**.test.ts` finds.
      Acceptance: symbol + renderer suites green; `test:aris:animalwf` green; crops match.

- [ ] **P4 `[sonnet]` — Icon-band widths (25 % → 17 % functions / 21 % satellites), content
      boxes, top strip, badge size, hairline + corner polish.**
      Files: `src/aris/symbols/shapes.ts` (`CARD_ICON_BOX`/`CARD_CONTENT_BOX` :14-15, `cardGroups`
      :323-353, `card` :613-622, `eventShape` contentBox :662, `iconGeometry('double-chevron')`
      :379-397, `OUTLINE` :11), `src/aris/canvas/renderer.dmt.test.ts` + `symbols.test.ts` (+ any
      preview/quick-pick snapshot a grep surfaces).
      Change (fixplan §4.3 + §4.1 remainder; measured: function band = 17 % of width, satellites
      21 %, caption area x 18 %…98 %, event caption 27.5 %…92 %). (1) Parameterize
      `cardGroups(accent, icon, bandWidth)` — function + system-function cards band `17`, all
      other cards band `21` (both currently 25); top strip stays ≈3/60 viewBox units (source
      ≈10/240); `card()` passes the per-family band and derives the matching `iconBox` (icon
      centered INSIDE the colored band with today's relative margins — icon shrinks with the
      band) and `contentBox`: functions `{x:18,y:4,width:80,height:53}`, satellites
      `{x:23,y:4,width:74,height:53}` (same inset rule vs band 21), event `contentBox`
      `{x:27.5,y:4,width:64.5,height:53}`. (2) Badge: replace the two large hollow chevron
      polygons with two SMALL FILLED triangles (≈half current size, e.g. `(6,24)(12,30)(6,36)` +
      `(13,24)(19,30)(13,36)`, fill WHITE) — keep exactly 2 polygons (`renderer.dmt.test.ts`
      pins `toHaveLength(2)`), calibrate on `cmp-zoom-funcbadge.png`. (3) `OUTLINE '#c4c7c9'` →
      `'#c0c0c0'` (measured hairline) and give the card surface slightly rounded outer corners
      (rx ≈ 2 viewBox units; if the `rect` drawing element lacks rx support, author the surface
      as a path).
      Crop-verify: `cmp-func01.png`, `cmp-approve14.png`, `cmp-zoom-funcbadge.png`,
      `cmp-satellites-red.png`, `cmp-ded.png`, `cmp-terminate-fn.png` (band ratio + caption
      centring vs the original; wraps are finally judged in P5).
      Re-baseline: `renderer.dmt.test.ts` caption-x bound (58 % of 670 = 388 > 335 — still green,
      verify), any literal `27`/`70`/`25` geometry pins a grep finds; `symbols.test.ts` accent-fill
      pins unchanged (band WIDTH is not pinned). Content-box widening reflows captions — expected;
      `typography.animalwf.test.ts` inequalities re-run green.
      Acceptance: suites green; `test:aris:animalwf` green; crops show 17 %/21 % bands + small
      filled badge; ledger records the derived iconBox/contentBox numbers per family.

- [ ] **P5 `[sonnet]` — Real font metrics: AFM advance-width tables (regular + bold + Arabic
      tiers) replace the coarse em-class table.**
      Files: `src/aris/renderer/textWrap.ts` (`charWidthEm` :20-29, `measureTextWidth` :32-38),
      `src/aris/canvas/typography.ts` (wrap callers pass the resolved weight),
      `src/aris/renderer/textWrap.test.ts`, `src/aris/canvas/typography.test.ts`,
      `src/aris/canvas/rendererTypography.test.ts` (+ re-run `typography.animalwf.test.ts`,
      `freeTextLayout.test.ts`, `directEdit.test.ts` — update only what a wrap-count change
      breaks).
      Change (fixplan §6.2 + §3.6; measured: "registration Service" = 291 units at −10 vs the
      table's 314, +8 % — the systematic over-estimate that wraps every borderline line early).
      (1) Replace `charWidthEm` with the public-domain Adobe core-14 **Helvetica AFM** advance
      table (95 printable ASCII, ×1000 units; Arial is metric-compatible) plus the
      **Helvetica-Bold** table (function captions are bold), selected by a new optional `weight`
      parameter on `measureTextWidth`/`wrapText` (default regular — every existing caller stays
      valid); `typography.wrapLabelLines`/caption layout pass the resolved `fontWeight` through;
      `canvasSync`'s connection-label/attribute-label uses stay regular. (2) Arabic: replace the
      flat 0.55 em with a deterministic tier table (≈0.28 narrow/joiner, 0.50 medium, 0.62 wide,
      from Noto Sans Arabic metrics) — closes the Arabic law-row over-wrap (§3.6) together with
      P4's band fix. (3) Contract preserved: deterministic, no DOM, `buildTextWrapFinding`
      machinery untouched.
      Crop-verify (the four named sites, AFTER P4): start event caption **3 lines**
      (`cmp-start-event.png`), red "owner registration number is valid…" note **5 lines**
      (`cmp-satellites-red.png`), "Economy License Details" **1 line** (`cmp-ded.png`), Arabic law
      rows **2–3 lines** (`cmp-reflaws.png`).
      Re-baseline: `textWrap.test.ts` width/wrap fixtures to the AFM numbers; `typography`/
      `rendererTypography` wrap fixtures; `connectionLabels.animalwf` stays green by construction
      (label rects are centre-anchored; only widths change). Assert in a new unit test:
      `measureTextWidth('registration Service', <−10 EN px size>)` lands within ±2 % of 291
      canvas units.
      Acceptance: all listed suites + `test:aris:animalwf` green; the four crop sites match the
      original line counts; Seq-1 similarity recorded (expected ↑).

- [ ] **P6 `[sonnet]` — Reference-Laws title: CENTER-anchored sized notes (`Position` = anchor,
      not top-left).**
      Files: `src/aris/canvas/canvasSync.ts` (`freeTextBounds` :221-228 + its `syncFreeText`
      caller ≈:514), `src/aris/canvas/renderer.ts` (freeText sized-width/dY=0 path :995-1044),
      `src/aris/canvas/freeTextLayout.test.ts` (+ re-run `cleanLayoutNotes.animalwf.test.ts`,
      `printFrame.animalwf.test.ts`).
      Change (fixplan §3.5; source: `FFTextOcc (6267,551) Size.dX=544 dY=0 Alignment=CENTER`; the
      original centres the text block ON x=6267 — predicted centre 758.4 pt vs measured 760.2 pt —
      while we treat Position as top-left and clip out of the 742×747 frame):
      a note with `Size.dX>0` anchors its box BY ITS ALIGNMENT at `Position`: CENTER →
      `box.x = pos.x − dX/2`; RIGHT → `pos.x − dX`; LEFT → `pos.x` (today's behavior). `dY=0`
      means auto-height: wrap to width `dX`, top-anchored at `pos.y`, no invented border/height.
      Unsized notes (the header's anchored values) are UNTOUCHED — their alignment-anchor path
      already exists; assert `printFrame.animalwf.test.ts` header-value anchors stay byte-equal.
      Add the regression test with the source numbers: dX=544 CENTER at x=6267 → box.x 5995, wrap
      width 544, text centre 6267 (the Reference-Laws title's exact record).
      Crop-verify: `cmp-reflaws.png` — both title lines centred INSIDE the black frame, zero
      clipping (frame weight itself came from P2).
      Re-baseline: `freeTextLayout.test.ts` sized-note fixtures; re-run
      `cleanLayoutNotes.animalwf.test.ts` (imported sized CENTER notes shift by −dX/2 — update
      only assertions that pin the OLD top-left reading, as authorized).
      Acceptance: suites + `test:aris:animalwf` green; crop matches; header anchors unchanged.

- [ ] **P7 `[opus]` — RACI letters honour source `Port="NW"`: above the line, tucked at the role
      box.** Files: `src/aris/canvas/canvasSync.ts` (`connectionLabelRect` :1067-1105 +
      `syncConnectionLabels` :625-693 — `placement.port` is already on the business object :676,
      unused), `src/aris/canvas/raci.test.ts`, `src/aris/canvas/connectionLabels.animalwf.test.ts`
      (:279-321 split), `src/aris/canvas/connectionLabels.test.ts`.
      Change (fixplan §5.1): the 28 derived RACI badges are `AT_TYPE_6` placements with
      `Port="NW"`, Offsets 0, empty value; we centre them on the route midpoint (line strikes
      through the letter). Honour `Port`: keep `CENTER` (and portless) placements EXACTLY on
      today's midpoint-centred math; for `NW`, anchor the drawn-extent box above-left of the
      anchor point. **Calibration is the judgment call** — fixplan §0 measures the R letter's
      bottom-right ≈20 units left of the ROLE box edge and ≈33 units above the line (pt bbox
      [192.6,111.8,195.6,116.4] vs line y 117.86, role box left x 1535u), while §5.1's prose says
      "near the target end"; resolve the contradiction against `cmp-zoom-raci-r.png` +
      `cmp-func01.png` + `cmp-auto05.png` and encode the winning rule as a pure function of the
      route + endpoint boxes (no per-connection constants). Seed rule: anchor = the route point
      where the connection leaves the letter-side box; box bottom-right at
      `(anchorX − 20u, lineY − 10u)` ⇒ centre-y ≈ lineY − 33 for the measured R.
      Verify NO NW label rect intersects any occurrence/satellite box (all 28 letters across both
      iterate models — add that as an assertion, fixplan's stated risk).
      Crop-verify: `cmp-zoom-raci-r.png` (letter floats above the line, tucked left of the role
      box), `cmp-func01.png`, `cmp-auto05.png`.
      Re-baseline: split `connectionLabels.animalwf.test.ts` "centres every placement" by port —
      CENTER placements keep the exact old assertion; NW placements assert the new formula (write
      it as the formula, not 28 hand rects); extend `raci.test.ts` with the measured-R numbers;
      `printFrame.animalwf.test.ts` letter SETS unchanged (positions moved, letters identical).
      Acceptance: all four suites + `test:aris:animalwf` green; crops match; ledger records the
      final anchor rule + calibration numbers.

- [ ] **P8 `[opus]` — Function green `#009933` vs `#33993D`: adjudicate byte-order vs print
      drift; reconcile catalog raw-vs-decoded; oracle transform if (and only if) the value
      changes.** Files: `src/aris/conventions/catalog.ts` (`defaultFill '#339900'` rows :80,:95,
      :188,:203 + provenance comments), `src/aris/symbols/shapes.ts` (`bodyFill` fallbacks),
      `src/aris/symbols/symbols.test.ts:104`, `src/aris/canvas/legend.test.ts:99-112`; oracle:
      all four `*.expected.json` (orchestrator-run transform, §protocol step 4).
      Judgment task (fixplan §4.3 note + §4.5): the original prints function green ≈`#33993D`;
      we render `#009933` (BGR decode of stored `339900` — the decode rule itself is VERIFIED by
      the header pen `996600`→`#006699`, do NOT flip the codec globally). Every reference color
      drifts slightly from its decode (pink `#edbbdc`→sampled `#EAADDB`, blue `#9dc4d7`→`#A0C4D4`,
      red `#c82830`→`#CC2A34`, grey `#999999`→`#9A9A9A`) — consistent with print/CMYK drift — but
      green's R-channel jump (0x00→0x33, matching the RAW first byte) is too big to wave off.
      Protocol: sample `orig-1.png` (300 DPI) at ≥3 sites per anchor color; fit the drift model on
      the KNOWN-correct anchors; invert it for green and pick among `#009933` (keep — expected
      verdict if drift explains it), `#339933`, `#339900`. Record the evidence table in the ledger
      either way. **Verdict = keep:** no render change; still fix the REAL inconsistency this
      lane owns — the legend/palette paint the catalog's RAW `'#339900'` (passes
      `occurrenceColorToCss` unchanged because it starts with `#`) while imported occurrences
      render the decoded `#009933`, two different greens on one screen; store decoded sRGB in
      `catalog.defaultFill` (`'#009933'`), update `symbols.test.ts:104` + `legend.test.ts:109`
      pins, confirm export still writes authored raw values (`arisDerivedExport` untouched), and
      sweep the other catalog rows for the same raw-vs-decoded mismatch (`#dcbbed` events etc.);
      **no oracle change** (JSONs already pin decoded `#009933`). **Verdict = change (e.g.
      `#339933`):** implement at the paint layer such that BOTH imported occurrences and new
      objects render the new green, run the protocol-step-4 transform over all four JSONs
      (`"#009933"` → new value; orchestrator sanctions; one holdout run), update the two test
      pins + catalog + fallbacks.
      Also adjudicate (same drift model, same verdict style, likely no-change): event pink
      `#EDBBDC`→`#EAADDB` (§4.5).
      Crop-verify: `cmp-func01.png` band color side-by-side after the decision.
      Acceptance: `test:aris:animalwf` green (post-transform if any); one sanctioned holdout run
      green if the oracle changed; `symbols`/`legend` suites green; ledger holds the drift-model
      table + verdict + (if run) the transform command and JSON sha256 before/after.

- [ ] **P9 `[opus]` — Icon-set redraw to the ARIS filled-white originals + mapping splits.**
      Files: `src/aris/symbols/shapes.ts` (`iconGeometry` :377-598, `DmtIconId` :26-54, descriptor
      `icon:` fields), `src/aris/conventions/catalog.ts` (icon ids only — colors are P8's),
      `src/aris/symbols/symbols.test.ts` (:150-164,:184 icon pins),
      `src/aris/canvas/renderer.dmt.test.ts` (app-window `16/23` ratio pin :~135, sys-func icon),
      `src/aris/canvas/legend.test.ts` (re-render only — 19 tiles unchanged).
      Change (fixplan §4.2 + §4.5 person): redraw as filled-white silhouettes matching the
      original's 34×34 raster set (reference crops: `cmp-satellites-red.png`, `cmp-ded.png`,
      `cmp-terminate-fn.png`, `cmp-reflaws.png`, `cmp-zoom-eventtip.png`, glyph close-ups liftable
      from `orig-1.png`): pennant flag = pole + small SOLID triangular pennant (event); split the
      shared window glyph — `ST_APPL_SYS` → filled window + title dots + small circle badge (NO
      arrow), NEW `DmtIconId` (e.g. `application-window-down`) for `ST_SYS_FUNC_ACT` → window +
      **down**-arrow; `ST_INFO_CARR_HANDY` → filled smartphone; `ST_EMAIL_1` → filled envelope + @; `ST_ENT_TYPE` → card/tag (today's grid reads as a printer); `ST_BUSINESS_RULE` (the
      Reference-Laws rows) → **shield** (the `law-shield` art exists but the law cards resolve the
      scroll via the canonical business-rule presentation — move the shield onto the presentation
      the imported occurrences actually resolve, record the swap in the ledger); person → filled
      head-and-shoulders silhouette; requirement hand stays (already close). Vector paths, not
      extracted bitmaps (crisper-than-original is the accepted deviation — record it).
      Crop-verify: EVERY redrawn glyph side-by-side vs its `orig-1.png` crop; re-shoot
      `cmp-satellites-red/ded/terminate-fn/reflaws/zoom-eventtip`.
      Re-baseline: `symbols.test.ts` icon-identity pins to the new ids; `renderer.dmt.test.ts`
      window-ratio + monitor-negative assertions to the new geometry; fingerprint uniqueness (36)
      must still hold — new `DmtIconId` keeps every pair distinct. Legend tiles re-render from the
      shared descriptors automatically (count 19 pinned, unchanged).
      Acceptance: symbol/renderer/legend suites + `test:aris:animalwf` green; per-glyph crop board
      in the ledger (glyph → verdict).

- [ ] **P10 `[opus]` — Arabic selectable text in the exported PDF (embedded Arabic TTF subset).**
      Files: `src/aris/canvas/exportArisPdf.ts` (`overlayArisTextRuns` :186-216 + a new
      lazy-loaded font module, e.g. `src/aris/canvas/exportArisPdfArabicFont.ts` holding the
      base64 subset), `src/aris/canvas/exportArisPdf.test.ts`; gate: `npm run check:size`
      (raw 8 MiB / gzip 2.5 MiB budgets in `scripts/check-artifact-size.mjs`).
      Change (fixplan §1 fallback path, Arabic leg — the raster already paints shaped Arabic
      pixels; only the invisible overlay lacks Arabic): embed a subset **Noto Sans Arabic** TTF
      (subset to the Arabic ranges the sheets use, target ≤ ~120 KB base64) via
      `doc.addFileToVFS`/`doc.addFont`; runs containing Arabic switch to it (jsPDF's TTF pipeline
      runs `processArabic` contextual shaping); Latin runs keep core `helvetica` (zero regression
      risk — pass-1 path untouched). Load the font module lazily (`await import()`) ONLY when the
      captured runs contain Arabic, so the base artifact stays small; measure the bundle delta
      and record it against `check:size`.
      Bidi: our runs are logical-order per line (`bidiTextAttrs`); verify extraction/copy order on
      the 3 Arabic header strings + the Reference-Laws rows; set jsPDF R2L per-run if extraction
      comes out reversed. The overlay is `renderingMode:'invisible'` — zero visual risk by
      construction.
      Determinism: no-Arabic documents stay BYTE-IDENTICAL to pass-1 output (font never loaded);
      Arabic documents are deterministic for identical input (fixed font bytes; extend the file-id
      digest with a font marker). Extend `exportArisPdf.test.ts`: byte-identical-without-Arabic,
      deterministic-with-Arabic, font-only-loaded-when-needed.
      Verify: `pdffonts` on a fresh register export lists Helvetica + the Arabic subset;
      `pdftotext` extracts the Arabic header strings; `tests/e2e/aris-sequence-1.spec.ts`
      (chromium) green including its Arabic-content export case (:304-311); `npm run check:size`
      green. Fallback verdict (recorded, not silently shipped): if jsPDF shaping fails review,
      keep the Latin-only overlay and log the tier-2 option (outline paths via opentype.js) in
      the ledger.
      Acceptance: export tests + Seq-1 + `check:size` + `test:aris:animalwf` (untouched by this
      lane — canvas render unchanged) green.

- [ ] **P11 `[opus]` — OLE decode tier 1: DMT logo EMF bitmaps → real `<image>`; legend EMF
      tier-2 verdict.** Files: NEW `src/aris/canvas/oleImage.ts` (+ `oleImage.test.ts`),
      `src/aris/canvas/printFrame.ts` (`drawHeader` :428-462 placeholder swap + plumbing the blob
      bytes into `buildPrintFrame`/its caller), `src/aris/canvas/printFrame.test.ts`,
      `src/aris/canvas/printFrame.animalwf.test.ts` (:199-204),
      `src/aris/renderer/animalWfRealData.animalwf.test.ts` (:88), and whatever single seam
      exposes `index.blobs` to the canvas (named in printFrame.ts's `TODO(V5+ OLE)`).
      Change (fixplan §3.2): the org title block draws a dashed placeholder although the data is
      present — the OLEDef `<Blob>` is base64 → ZIP → `aris.dat`, an EMF whose ONLY content is 2
      `EMR_STRETCHDIBITS` records (embedded DIBs). Implement a narrow extractor: base64 →
      `fflate` unzip (**already a dependency, 0.8.3 — no new dep**) → walk EMF records
      (`[u32 type][u32 size]`) → for STRETCHDIBITS lift `BITMAPINFOHEADER` + pixels into a
      PNG/BMP data URL. Hard limits (decompressed-size cap, dimension cap, record-count cap,
      reject anything malformed → keep the placeholder); NEVER execute/interpret other EMF
      records; source bytes stay verbatim for export (`rawAttributes` untouched —
      `arisDerivedExport` must stay green). `drawHeader` paints `<image>` at the orgBlock bounds
      (`data-aris-ole-image="true"`) when decode succeeds; the `data-aris-ole-pending`
      placeholder remains the fallback path (and its i18n key stays registered).
      **Tier 2 explicitly deferred:** the legend EMF (3241 vector records + 49 bitmaps) is NOT
      rendered this wave — the catalog-drawn legend stays; record the tier-2 verdict + effort (L)
      in the ledger.
      Crop-verify: `cmp-header-right.png` — the DMT bilingual logo + crest appear at
      `(5403,40) 1194×320` (register) instead of the placeholder text.
      Re-baseline: `printFrame.animalwf.test.ts` org-block assertion `ole-pending==='true'` → the
      decoded-image assertion (image node present, href non-empty, placeholder absent) for models
      whose logo decodes; `animalWfRealData.animalwf.test.ts`
      `fidelityByKind['unsupported-ole-rendering'] === 14` → the measured post-decode count
      (decoded logos clear their finding; legend attachments keep theirs — record the count and
      the per-model split in the ledger); `printFrame.test.ts` keeps the fallback-path unit
      coverage (malformed blob → placeholder).
      Acceptance: new + updated suites, `test:aris:animalwf`, and
      `npx vitest run src/aris/shell/arisDerivedExport.animalwf.test.ts` green; crop matches;
      decode limits unit-tested with hostile inputs (zip bomb, truncated EMF, oversized DIB).

### Wave 9 exit gate

- [ ] All 11 lane verify sets green in order; `npm run test:aris:animalwf` green at HEAD;
      **one final sanctioned holdout run** `npm run test:aris:animalwf:holdout` green (plus the
      one mid-wave run only if P8 transformed the oracle).
- [ ] Full re-crop board: re-export both iterate models, re-shoot EVERY `cmp-*` region touched by
      this wave, and record per-region verdicts (original vs new gen) in the ledger. The arbiter
      for every disagreement is the reference PDF crop.
- [ ] `tests/e2e/aris-sequence-1.spec.ts` green on chromium + firefox + webkit; per-model
      similarity scores recorded before/after the wave (expected to RISE from the Wave-7
      baseline; any decrease is a defect).
- [ ] `npm test` green, plus `typecheck`, `lint`, `check:no-skips`, `check:ui-copy`,
      `check:aris-runtime-boundary`, and `check:size` all green; artifact rebuilt
      (`npm run build:aris`) and committed per goal.md's protocol.
- [ ] Expectation JSONs: byte-identical to their pre-wave sha256 UNLESS P8's sanctioned transform
      ran, in which case the ledger holds the transform command + before/after hashes for all
      four files; nothing under `../reference/` is in any commit.
- [ ] Wave-9 ledger filled: per lane — worker, verdicts (truth table, RACI anchor rule, green
      drift table, per-glyph board, OLE finding counts, tier-2/pass-3 deferrals), crop evidence
      paths, exit codes verbatim.
