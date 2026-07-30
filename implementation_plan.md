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

- [ ] Run `npx vite-node scripts/aris-fidelity-report.ts`; snapshot per-category counts.
- [ ] Fix ONE category, in this order: (1) occurrence AttrOcc labels — generalize `syncLabels` to ALL occurrence `attributeOccurrences` (mirror `syncConnectionLabels`: per placement → label element `label:<occId>:<idx>:<attrType>`, text = the definition's attribute value of that type, rect from a generalized `attributePlacementRect(placement, bounds)` reusing the `externalNameRect` math; AT_NAME keeps the name path), so function numbers (`AT_PROC_CODE`/`AT_ID`) render under boxes; (2) arrowheads — `drawConnection` emits a shared `marker-end` via an `svg.ts` helper; (3) connection pen — honor bo pen color/width/dash (`elements.ts` connection bo gains pen fields); (4) occurrence pen width/style carry from source in `buildFromSource` (today nulled) into `occurrence.style`.
- [ ] Re-run the report + `npm run test:aris:animalwf`; ratchet the iterate suites' BASELINE for that category to exact/0.
- [ ] Repeat until the **completion bar**: topology exact (spine/gates/satellites/counts 0 diffs), numbering exact, symbol exact, color exact where PDF-confirmed, label-rect geometry within ±2px. Frames (`GfxObj`/`RoundedRectangle`)/`Union`/OLE placeholders only if the report shows them on the iterate models (expected out-of-bar — VACD/decorative; record the verdict in the report artifact).
- [ ] Prettier. Keep `rawAttributes`/source anchors untouched so `arisDerivedExport` round-trip is unperturbed.

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

- [ ] `aris-fidelity-screenshots.spec.ts`: import the reference fixture via `setInputFiles`, open each iterate model, `page.screenshot({ fullPage: false })` of the canvas → `test-results/fidelity/<model>-<browser>.png`. GATED (3 engines): model opens; exact occurrence-element count; `[data-aris-fidelity]` (symbol fallback) count === 0 for iterate models; ≥1 label element with `data-aris-caption` under a function (numbering visible). NOT gated: pixels.
- [ ] `aris-canvas-interaction.spec.ts` append: palette place → type "Approve request" → Enter → SVG caption appears; dblclick → edit; quick-pick swap visible.
- [ ] `package.json` scripts: `"test:aris:animalwf:holdout": "vitest run --config vitest.animalwf.holdout.config.ts"`, `"test:aris:fidelity-report": "vite-node scripts/aris-fidelity-report.ts"`. Prettier.

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

- [ ] Grep the whole `src/aris` + `src/ArisApp.tsx` for any `t('…')`/`tk('…')` key not present in both dictionaries (or `ARIS_SHELL_MESSAGE_KEYS`); register any stray key en+ar. Confirm `check:ui-copy` and `i18n.test.ts` green. Prettier.

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
