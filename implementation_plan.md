# ARIS Studio Lite — UI & Feature Fixes Implementation Plan

> **For the orchestrator:** dispatch rules, model policy, worker routing, and the commit protocol live in `desktop/goal.md`. This file is the work ledger — its checkboxes are the single source of progress truth. Tick them in the same commit as the lane's code.
>
> **For workers:** you own ONLY the files your lane lists under "Files owned". If completing your lane seems to require touching any other file, STOP and report back — do not touch it. Every step uses checkbox (`- [ ]`) syntax. Never run mutating git commands (commit, push, stash, checkout, reset, branch, rebase). Run every verification command listed for your lane and report each exit code verbatim. Your final message is machine-consumed: return raw findings, file lists, and command results — no pleasantries.

**Goal:** Fix five product issues on `feat/aris-only-studio`: (1) intuitive folder-tree explorer, (2) exposed drawing/editing with a New-model flow, (3) a proper chatbot drawer replacing the assistant modal, (4) a simplified redesigned Generate-with-AI panel, (5) Arabic⇄English content translation with auto-translate on creation plus a fix-missing-components feature.

**Architecture:** Re-wire surviving main-branch components (`FolderTreeLite`, the localization core, `TranslationReviewDialog`, `AiPanelLite` visuals, `AssistantDrawer` UX) onto the ARIS-native backends that already exist (`src/aris/canvas`, `src/aris/assistant`, `src/aris/chat`, `src/aris/localization` [new]). Nothing bpmn-flavored enters the runtime graph.

**Tech stack:** React 18.3, Vite 6, TypeScript 5.9, diagram-js 15.22 (generic), vitest 3.2, Playwright 1.61. Browser SPA, single-file build. NOT Electron.

---

## Global Constraints

Every task's requirements implicitly include this section.

- Repo: `/home/ahmed/Desktop/bpmn_tool/desktop` (this directory IS the git root). Branch: `feat/aris-only-studio`. Remote: `https://github.com/ahmedak320/bpmn-studio.git`. Canonical artifact: `release/OrbitPM-ARIS-Studio-Lite.html`, rebuilt via `npm run build:aris` in every product commit (orchestrator's job).
- **Gate commands** every lane runs before reporting done (plus lane-specific extras listed per lane):

  ```bash
  npm run typecheck && npm run lint && npm run check:aris-runtime-boundary && npm run check:ui-copy
  npx vitest run <lane's test paths>
  npx prettier --write <every file the lane touched>   # format:check is a CI gate
  ```

- **Runtime-boundary rules** (`scripts/check-aris-runtime-boundary.mjs` walks runtime imports from `src/main.tsx`; **type-only imports are exempt**): never runtime-import `src/assist/digest.ts`, `src/assist/prompt.ts`, `src/assist/requestReview.ts`, `src/assist/interview.ts`, the `@/generation` barrel, `src/editor/**` (deleted AND banned — port old code via `git show main:<path>`), `src/core/newProcessDoc.ts`, the `src/localization/index.ts` barrel (import specific modules instead), `src/App.tsx`, or any `bpmn-*` package.
- **i18n rules:** every user-visible string goes through `t()` with keys added to BOTH the `en` and `ar` maps in `src/i18n/dictionaries.ts` (identical key sets enforced by `src/__tests__/i18n.test.ts`), or through `tk(key, 'English fallback')` from `src/aris/shell/shellI18n.ts`. Unregistered `tk()` keys render their fallback and pass all gates; their registration in `ARIS_SHELL_MESSAGE_KEYS` + both dictionaries happens ONLY in Lane X1. Never hardcode English in JSX text/attributes (`title`, `aria-label`, `placeholder`) or in `pushToast`/`setStatus` calls — `check:ui-copy` blocks it.
- **Lint:** `--max-warnings 0`; `react-hooks/exhaustive-deps` is an ERROR. The only sanctioned `eslint-disable-next-line react-hooks/exhaustive-deps` uses are the two named in the Risk Appendix.
- **No test games:** no `.skip`, `.only`, retries, quarantines, or inflated timeouts — `npm run check:no-skips` must stay green. Never name a helper matching a focused-test alias (e.g. anything reading as `fit(` — see the precedent comment at `src/aris/shell/ArisStudioTab.tsx:483`).

### Authorized product changes

The user explicitly requested these; updating tests that assert the OLD behavior is **required work, not assertion-weakening**. Workers must NOT "fix" the product to satisfy old tests:

1. The consent checkbox, "Exact outbound request" preview, and include-context/redact toggles are REMOVED from the Generate-with-AI create path. (The chat drawer's consent gate is KEPT.)
2. The model-type select is REMOVED from the create panel; generation always uses `'auto-detect'`.
3. The flat explorer file list is REPLACED by the folder tree in multi-file (directory/OPFS) workspaces.
4. `ArisChatImproveRail` is REMOVED; its interview lives in the chat drawer.
5. The `ArisAssistantDrawer` modal + `ArisAssistantPanel` are REPLACED by the chat drawer.

---

## Wave / lane schedule

19 lanes across 9 waves. Lanes within a wave run in parallel and are file-disjoint. Waves are strictly sequential.

| Wave | Lane | Worker                    | Goal                                                                                      |
| ---- | ---- | ------------------------- | ----------------------------------------------------------------------------------------- |
| 0    | —    | orchestrator              | Commit plan docs; verify all gates at HEAD; record baseline SHA + pre-existing failures   |
| 1    | L1a  | **kimi-k2.7**             | Tree-data helpers (`WorkspaceEntry[] → LiteTreeNode`, empty hierarchy inputs, path utils) |
| 1    | L2a  | **kimi-k2.7**             | Blank-model AML builder (minimal valid EPC/VACD source)                                   |
| 1    | L2b  | opus-4.8-1M               | Palette + context pad: icons, labels, localized titles, CSS                               |
| 1    | L1b  | **kimi-k2.7**             | Extract `ArisExplorerPane` from ArisApp; real AI-section collapse toggle (caret-bug fix)  |
| 1    | L3a  | **kimi-k2.7**             | Pure chat interview session core (port of ArisChatImproveRail logic)                      |
| 1    | L5a  | **kimi-k2.7**             | Canvas content-language projection (zero-undo view switch) + RTL captions                 |
| 1    | L5b  | opus-4.8-1M               | ARIS localization adapter (extract → review → run → apply)                                |
| 2    | L1c  | opus-4.8-1M               | FolderTreeLite + full CRUD wired into the pane                                            |
| 2    | L3b  | opus-4.8-1M               | `ArisChatDrawer` UI (FAB + panel + 2 tabs + bubbles)                                      |
| 2    | L3c  | **kimi-k2.7**             | StudioTab publishes `ArisTabChatHost`; delete the improve rail                            |
| 2    | L4a  | opus-4.8-1M               | `ArisGenerationPanel` rebuild to AiPanelLite visuals, simplified                          |
| 3    | L3d  | opus-4.8-1M               | Mount drawer in ArisApp; fix all three openers; delete old modal; update app tests        |
| 3    | L2c  | **kimi-k2.7**             | Movable palette (port of main's paletteDrag) + empty-model hint                           |
| 4    | L5c  | opus-4.8-1M               | Translate controller + toolbar buttons + silent auto-translate                            |
| 5    | L2d  | opus-4.8-1M               | "New model" dialog + all entry points                                                     |
| 6    | L5d  | opus-4.8-1M               | Fix-missing: deterministic planner + three-tier dialog + badge                            |
| 7    | X1   | **sonnet-med**            | Register every `tk()` key; `aris.ai.body` copy update                                     |
| 8    | X2   | opus-4.8-1M               | Update existing e2e suites                                                                |
| 8    | X3   | **kimi-k2.7**             | New e2e: tree CRUD, new-model + draw + undo, translation/fix flows                        |
| 9    | —    | orchestrator + sonnet-med | Full gate suite, `build:aris`, artifact check, evidence, final report                     |

### Contended-file ownership chains (binding — one owner per wave)

- `src/ArisApp.tsx`: L1b(w1) → L1c(w2) → L3d(w3) → L5c(w4) → L2d(w5) → L5d(w6, one line)
- `src/aris/shell/ArisStudioTab.tsx`: L3c(w2) → L2c(w3) → L5c(w4) → L5d(w6)
- `src/i18n/dictionaries.ts`: L2b(w1) → L1c(w2) → L2d(w5) → X1(w7)
- `src/ArisApp.test.tsx`: L1c(w2) → L3d(w3) → L2d(w5)
- `src/aris/shell/index.ts`: L1b(w1) → L3c(w2) → L3d(w3)
- `src/aris/shell/ArisExplorerPane.tsx` (new in w1): L1b(w1) → L1c(w2) → L3d(w3)
- `src/aris/shell/shellI18n.ts`: X1(w7) only
- `tests/e2e/lite-mandatory-translation.spec.ts`: X3(w8) only. All other existing e2e specs: X2(w8) only.

---

## Wave 0 — Baseline (orchestrator)

- [x] Commit `implementation_plan.md` + `goal.md` to the branch. (commit `e7b077d`)
- [x] Run the full gate suite at HEAD: `npm run format:check && npm run lint && npm run typecheck && npm run check:aris-runtime-boundary && npm run check:ui-copy && npm run check:no-skips && npm run check:lite-only && npm test`. Record the SHA and every pre-existing failure verbatim at the bottom of this file under "Baseline record".
- [x] If gates are red at HEAD, dispatch a fix lane (default workers) BEFORE wave 1 and re-record. **N/A — baseline is fully green; no fix lane needed.**

---

## Lane L1a — Tree-data helpers

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned:** `src/workspace/liteTreeFromEntries.ts` (create), `src/workspace/__tests__/liteTreeFromEntries.test.ts` (create)

**Goal:** pure, unit-tested conversion from the workspace adapter's flat listing to the inputs `FolderTreeLite` needs.

**Interface (implement exactly; all imports type-only):**

```ts
import type { WorkspaceEntry } from './adapters/types'
import type { LiteTreeNode } from '../fs/fsAccess'
import type { ProcessHierarchyGraph } from './processHierarchy'
import type { ProcessIndex } from '@/core/processIndex'
import type { MoveFolderOption } from './MoveDialog'

export interface LiteTreeFromEntriesOptions {
  /** Top-level directory subtrees hidden from the tree. Default ['.orbitpm']. */
  readonly hiddenRootDirs?: readonly string[]
  /** File filter. Default: /\.(?:aml|apc|xml|bpmn)$/i test on entry.name. */
  readonly includeFile?: (entry: WorkspaceEntry) => boolean
}
export function buildLiteTreeFromEntries(
  entries: readonly WorkspaceEntry[],
  rootName: string,
  options?: LiteTreeFromEntriesOptions
): LiteTreeNode
export function collectFolderOptions(root: LiteTreeNode, rootLabel: string): MoveFolderOption[]
export function countTreeFiles(root: LiteTreeNode | null): number
/** Suffix fileName with -2, -3… until the joined path is not in takenPaths (case-insensitive). */
export function uniquePathIn(
  takenPaths: ReadonlySet<string>,
  dirRel: string,
  fileName: string
): string
export const EMPTY_PROCESS_INDEX: ProcessIndex // = new Map()
export const EMPTY_PROCESS_GRAPH: ProcessHierarchyGraph // = Object.freeze({ links: [], ambiguousProcessIds: new Set() })
```

**Steps:**

- [ ] **Read first:** `src/workspace/adapters/types.ts` (the `WorkspaceEntry` shape — note directory entries have `kind: 'directory'`), `src/fs/fsAccess.ts` around line 510 (the `sortNodes` comparator), `src/workspace/processHierarchy.ts` (the `ProcessHierarchyGraph` + `LiteTreeNode` consumption), `src/workspace/MoveDialog.tsx` (the `MoveFolderOption` shape).
- [ ] Implement `buildLiteTreeFromEntries`: root node is `{ name: rootName, relPath: '', type: 'directory', children: [] }`. For each entry: skip when its first `/`-segment is in `hiddenRootDirs`; skip files failing `includeFile`. Insert by walking `/`-segments from the root, **synthesizing missing intermediate directory nodes** (the jsdom mock adapter in `ArisApp.test.tsx` lists files only — parents may not exist as entries). Directory entries become directory nodes. File node: `{ name, relPath: entry.path, type: 'file' }`. Keep `.bpmn` files included (the tree shows them; the open handler rejects them — Lane L1c).
- [ ] Sort every `children` array with the exact comparator semantics of `src/fs/fsAccess.ts` `sortNodes` (directories first, then `localeCompare(..., undefined, { sensitivity: 'base' })`, reimplemented locally — do not runtime-import fsAccess).
- [ ] Implement `collectFolderOptions`: DFS, root first — `[{relPath: '', label: rootLabel}, {relPath: 'a', label: 'a'}, {relPath: 'a/b', label: 'a/b'}, …]`.
- [ ] Implement `countTreeFiles` (recursive file count, null-safe) and `uniquePathIn` (join dir + name with a local 3-line join helper; compare lowercased full paths; on collision insert `-2`, `-3`… before the extension).
- [ ] Write `src/workspace/__tests__/liteTreeFromEntries.test.ts` asserting: nested build + sort order (folders before files, case-insensitive); `.orbitpm/**` entries dropped entirely; empty directory entries preserved as expandable folders; parents synthesized when only file entries exist; `countTreeFiles` counts; `uniquePathIn` collision loop incl. case-insensitivity; **integration pin** — `import { buildProcessHierarchy } from '../processHierarchy'` and assert a 2-file tree with `EMPTY_PROCESS_INDEX` + `EMPTY_PROCESS_GRAPH` yields 2 canonical file rows and zero reference rows.
- [ ] Run prettier on both files.

**Verify (report exit codes):**

```bash
npx vitest run src/workspace/__tests__/liteTreeFromEntries.test.ts
npm run typecheck && npm run lint && npm run check:aris-runtime-boundary
```

---

## Lane L2a — Blank-model AML builder

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned:** `src/aris/shell/arisBlankModel.ts` (create), `src/aris/shell/arisBlankModel.test.ts` (create)

**Goal:** a deterministic, minimal AML document that round-trips the full studio pipeline into one renderable, empty, named model — the substrate of the New-model flow.

**Interface (implement exactly):**

```ts
import { attrDefSpec, renderRecord } from '../writer'
import { slugify, FALLBACK_SLUG } from '@/core/slug' // runtime-safe pure string module

export type ArisBlankModelType = 'MT_EEPC' | 'MT_VAL_ADD_CHN_DGM'
export interface ArisBlankModelSpec {
  readonly names: { readonly en?: string; readonly ar?: string } // at least one non-empty
  readonly modelType: ArisBlankModelType
}
export interface ArisBlankModelResult {
  readonly xml: string
  readonly modelId: string
}
export function buildBlankArisAml(spec: ArisBlankModelSpec): ArisBlankModelResult
/** Windows-safe '<slug>.aml' file name from a human model name. */
export function deriveArisSourceFileName(name: string): string
```

**Steps:**

- [ ] **Read first:** `src/aris/shell/arisAiCreate.ts` lines 220–260 (how the AI path emits AML through `renderRecord`/`attrDefSpec` — mirror it exactly, including locale-id constants `'1033'` en / `'1025'` ar around lines 32–33), `src/aris/writer/` exports, `src/core/slug.ts`.
- [ ] Implement `buildBlankArisAml`: emit `<?xml version="1.0" encoding="UTF-8"?>` + `renderRecord({ name: 'AML', children: [ Header-Info record (DatabaseName 'OrbitPM', UserName 'local-user', ArisExeVersion '10'), Group record (Group.ID 'Group.Root', children: [ Model record ]) ] })`. Model record: attributes `Model.ID = 'Model.New'`, `Model.Type = spec.modelType`; one child `attrDefSpec({ type: 'AT_NAME', values: [ ...(spec.names.en ? [{localeId: '1033', text: spec.names.en}] : []), ...(spec.names.ar ? [{localeId: '1025', text: spec.names.ar}] : []) ] })`. Return `{ xml, modelId: 'Model.New' }`.
- [ ] Implement `deriveArisSourceFileName`: `slugify(name) || FALLBACK_SLUG`; for non-ASCII names copy the ~10-line branch from `src/core/newProcessDoc.ts:92` (strip `[<>:"/\\|?*\x00-\x1F]`, collapse whitespace to dashes, trim dashes) — **copy the lines, never import that module** (it drags the BPMN template into the runtime graph); append `'.aml'`.
- [ ] Write `src/aris/shell/arisBlankModel.test.ts`:
  1. `buildBlankArisAml({names:{en:'Order intake'}, modelType:'MT_EEPC'})` → xml contains `Model.Type="MT_EEPC"` and the AT_NAME AttrValue with 'Order intake'.
  2. Pipeline round-trip: `const pkg = await createArisXmlSourcePackage({ name:'x.aml', relPath:null, bytes:new TextEncoder().encode(xml) })` (from `../source/sourcePackage` — verify the exact import path/signature by reading the module first) → `buildArisStudioDocument(pkg)` → exactly one model, `renderable === true`, zero occurrences, accounting reports 0 unaccounted, `arisText(models[0].names,'en') === 'Order intake'`.
  3. (`// @vitest-environment jsdom` block) canvas boot: `installJsdomSvgSupport()` from `../canvas/testing/jsdomSvg` + the geometry shim pattern from `src/ArisApp.test.tsx:268-291`; `ArisCanvas.create({ container, document: studio.source, modelId })` does not throw; `destroy()` cleans up.
- [ ] Run prettier on both files.

**Verify:**

```bash
npx vitest run src/aris/shell/arisBlankModel.test.ts
npm run typecheck && npm run lint && npm run check:aris-runtime-boundary
```

---

## Lane L2b — Palette & context-pad visibility + localization

**Wave:** 1 · **Worker:** opus-4.8-1M · **Depends on:** nothing · **Wave-1 owner of `src/i18n/dictionaries.ts`**
**Files owned:** `src/aris/canvas/paletteProvider.ts`, `src/aris/canvas/contextPadProvider.ts`, `src/aris/shell/shell.css`, `src/i18n/dictionaries.ts`, affected canvas tests

**Goal:** turn the blank-box palette into labeled, iconed, localized entries; localize the context pad; add the wave-1 i18n keys (including grip/hint keys consumed later by L2c).

**Steps:**

- [ ] **Read first:** `src/aris/canvas/paletteProvider.ts` (18 entries: `hand-tool`, `lasso-tool`, `create.free-text`, 12 `create.ot_*`, `create.rule-and|or|xor`), `src/aris/canvas/contextPadProvider.ts` (four hardcoded English titles), `tests/e2e/aris-authoring.spec.ts` lines 37–52 + 184–204 + 247–270 (the `data-action` selectors that MUST keep working), and `git show main:src/editor/embeddedDiagramControls.ts` (the `escapeAttribute` helper pattern only — do not port the module).
- [ ] Modify `paletteProvider.ts`: import `{ t } from '../../i18n'` (React-free, boundary-safe). Keep UNCHANGED: entry ids, `group`, `className`, `arisObjectType`/`arisSymbolNum`, `action` handlers, `targets()`. Replace every hardcoded `title` with `t(...)` per the key table below (`title` for create entries = `t('aris.palette.createTitle', { name: t('aris.palette.func') })` etc.).
- [ ] Add `html` per entry via a local helper `paletteEntryHtml(svgInner: string, label: string): string` returning a single-root `<div class="entry" draggable="true" role="img" aria-label="<escaped label>"><svg viewBox="0 0 24 24" aria-hidden="true">…</svg><span class="aris-palette-entry__label"><escaped label></span></div>`, with a local 5-replace attribute escaper (`&`, `<`, `>`, `"`, `'`). diagram-js `Palette._addEntry` stamps `data-action`, `title`, and the `aris-palette-*` class onto this custom root — verified — so all e2e `[data-action=…]` selectors keep working.
- [ ] Inline SVG glyphs (simple line art, `stroke="currentColor" fill="none" stroke-width="1.5"`): FUNC = rounded rect; EVT = hexagon; AND/OR/XOR = circle containing `∧`/`∨`/`×` text glyph; ENT_TYPE = plain rect; INFO_CARR = rect with folded corner; BUSINESS_RULE = rect + inner horizontal line; PERF = 3-bar mini chart; APPL_SYS = rect with doubled side borders; PERS = head + shoulders arcs; PERS_TYPE = two overlapped persons; REQUIREMENT = document with check; POLICY = shield; hand = open-hand path; lasso = dashed rect; free text = "T" glyph. These are affordances, not the renderer's official symbols — fidelity is not gated.
- [ ] Add a code comment: titles/labels resolve when `getPaletteEntries()` runs (canvas boot); a mid-session UI-language switch updates on the next canvas boot (accepted — the canvas deliberately never re-boots).
- [ ] Modify `contextPadProvider.ts`: the four titles → `t('aris.contextPad.connect')`, `t('aris.contextPad.appendFunction')`, `t('aris.contextPad.appendEvent')`, `t('aris.contextPad.delete')`. **`data-action` ids unchanged** (`connect`, `append.function`, `append.event`, `delete`).
- [ ] Append to `src/aris/shell/shell.css` (no `url()`, no fonts — single-file CSP contract):

  ```css
  .orbitpm-aris-canvas .djs-palette {
    background: var(--orbitpm-panel-bg, var(--orbitpm-bg));
    border: 1px solid var(--orbitpm-border);
    border-radius: 10px;
  }
  .orbitpm-aris-canvas .djs-palette .entry {
    width: 46px;
    height: 46px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  .orbitpm-aris-canvas .djs-palette .entry svg {
    width: 20px;
    height: 20px;
    display: block;
  }
  .orbitpm-aris-canvas .aris-palette-entry__label {
    font-size: 8.5px;
    line-height: 1.1;
    max-width: 44px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ```

- [ ] Add ALL of these keys to BOTH `en` and `ar` maps in `src/i18n/dictionaries.ts` (the i18n test enforces identical key sets):

  | Key                                  | en                                                                                                                         | ar                                                                                                                |
  | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | `aris.palette.hand`                  | Hand tool (pan)                                                                                                            | أداة اليد (تحريك)                                                                                                 |
  | `aris.palette.lasso`                 | Lasso select                                                                                                               | تحديد بالحبل                                                                                                      |
  | `aris.palette.freeText`              | Free text note                                                                                                             | ملاحظة نصية حرة                                                                                                   |
  | `aris.palette.func`                  | Function                                                                                                                   | وظيفة                                                                                                             |
  | `aris.palette.evt`                   | Event                                                                                                                      | حدث                                                                                                               |
  | `aris.palette.rule.and`              | AND rule                                                                                                                   | قاعدة "و"                                                                                                         |
  | `aris.palette.rule.or`               | OR rule                                                                                                                    | قاعدة "أو"                                                                                                        |
  | `aris.palette.rule.xor`              | XOR rule                                                                                                                   | قاعدة "أو الحصرية"                                                                                                |
  | `aris.palette.entType`               | Entity type                                                                                                                | نوع كيان                                                                                                          |
  | `aris.palette.infoCarr`              | Information carrier                                                                                                        | حامل معلومات                                                                                                      |
  | `aris.palette.businessRule`          | Business rule                                                                                                              | قاعدة عمل                                                                                                         |
  | `aris.palette.perf`                  | KPI                                                                                                                        | مؤشر أداء                                                                                                         |
  | `aris.palette.applSys`               | Application system                                                                                                         | نظام تطبيقي                                                                                                       |
  | `aris.palette.pers`                  | Person                                                                                                                     | شخص                                                                                                               |
  | `aris.palette.requirement`           | Requirement                                                                                                                | متطلب                                                                                                             |
  | `aris.palette.policy`                | Policy                                                                                                                     | سياسة                                                                                                             |
  | `aris.palette.persType`              | Role (person type)                                                                                                         | دور (نوع شخص)                                                                                                     |
  | `aris.palette.createTitle`           | Create {name}                                                                                                              | إنشاء {name}                                                                                                      |
  | `aris.palette.grip.title`            | Drag to move the palette. Double-click to reset its position.                                                              | اسحب لتحريك لوحة الأدوات. انقر نقرًا مزدوجًا لإعادة موضعها.                                                       |
  | `aris.canvas.emptyModelHint`         | This model is empty — drag a shape from the palette, or click a palette entry and then click the canvas, to start drawing. | هذا النموذج فارغ — اسحب شكلًا من لوحة الأدوات، أو انقر على عنصر في اللوحة ثم انقر على اللوحة القماشية لبدء الرسم. |
  | `aris.canvas.emptyModelHint.dismiss` | Got it                                                                                                                     | حسنًا                                                                                                             |
  | `aris.contextPad.connect`            | Connect from here                                                                                                          | وصّل من هنا                                                                                                       |
  | `aris.contextPad.appendFunction`     | Append function                                                                                                            | إلحاق وظيفة                                                                                                       |
  | `aris.contextPad.appendEvent`        | Append event                                                                                                               | إلحاق حدث                                                                                                         |
  | `aris.contextPad.delete`             | Delete from this model                                                                                                     | حذف من هذا النموذج                                                                                                |

  (The grip + hint keys are consumed by Lane L2c — this lane only registers them.)

- [ ] Update title assertions in existing canvas tests: run `grep -rn "Create OT_\|Activate hand\|getPaletteEntries" src/aris --include=*.test.ts` and fix every hit. Add (in one canvas test file) assertions that all 18 entry ids/classNames are unchanged and every entry's `html` contains `aris-palette-entry__label`.
- [ ] Run prettier on touched files.

**Verify:**

```bash
npx vitest run src/aris/canvas src/__tests__/i18n.test.ts
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L1b — Extract `ArisExplorerPane` + real AI-section collapse

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing · **Wave-1 owner of `src/ArisApp.tsx` and `src/aris/shell/index.ts`**
**Files owned:** `src/aris/shell/ArisExplorerPane.tsx` (create), `src/ArisApp.tsx`, `src/aris/shell/index.ts`

**Goal:** move the explorer drawer body (`src/ArisApp.tsx` lines ~877–1019) into a dedicated component so later lanes own separate files; fix the "✨ Generate with AI" caret-opens-modal bug by making it a real collapse toggle.

**Interface:**

```ts
export interface ArisExplorerActiveTab {
  readonly key: string
  readonly title: string
  readonly models: readonly ArisStudioModelSummary[]
}
export interface ArisExplorerPaneProps {
  readonly lang: 'en' | 'ar'
  readonly dir: 'ltr' | 'rtl'
  readonly directoryAvailable: boolean
  readonly onImportClick: () => void
  readonly onOpenFileClick: () => void
  readonly onChangeFolder: () => void
  readonly activeTab: ArisExplorerActiveTab | null
  readonly activeModelId: string | null
  readonly onSelectModel: (tabKey: string, modelId: string) => void
  readonly workspaceSources: readonly WorkspaceEntry[]
  readonly openPaths: ReadonlySet<string>
  readonly onOpenWorkspaceFile: (path: string) => void
  readonly onRejectUnsupported: () => void
  readonly onOpenAssistant: () => void
  // ArisGenerationPanel passthrough — type via React.ComponentProps<typeof ArisGenerationPanel>
  readonly workspaceId: string | null
  readonly digests: React.ComponentProps<typeof ArisGenerationPanel>['digests']
  readonly onCreateModel: React.ComponentProps<typeof ArisGenerationPanel>['onCreateModel']
  readonly onDownloadFile: (fileName: string, bytes: Uint8Array, mimeType?: string) => void
  readonly onOpenSettings: () => void
}
export function ArisExplorerPane(props: ArisExplorerPaneProps): JSX.Element
```

**Steps:**

- [ ] **Read first:** `src/ArisApp.tsx` lines 860–1050 (the block being moved), `src/ArisApp.test.tsx` line 254 area (the `input[type="file"]` DOM-order dependence).
- [ ] Create `src/aris/shell/ArisExplorerPane.tsx` and move the JSX **verbatim**: the chrome button row (Import / Open file… / Change folder), the `ArisModelExplorer` block fed from `activeTab.models`, the flat `workspaceSources` `<ul>`, the AI section header button, and the embedded `ArisGenerationPanel`. The hidden `<input type="file">` elements **STAY in `ArisApp.tsx`** — their DOM order is load-bearing for unit + e2e tests.
- [ ] Caret-bug fix inside the pane: `const [aiCollapsed, setAiCollapsed] = useState<boolean>(() => { try { return localStorage.getItem('orbitpm.lite.sidebarAiCollapsed') === '1' } catch { return false } })`. The section header button now toggles + persists (`localStorage.setItem(...)` in the click handler, try/catch-wrapped), gets `aria-expanded={!aiCollapsed}` and `aria-controls="orbitpm-aris-create-section"`, caret `▾` when open / (`dir === 'rtl' ? '◂' : '▸'`) when collapsed. The panel wrapper becomes `<div id="orbitpm-aris-create-section" hidden={aiCollapsed} style={{ flex: '0 1 auto', maxHeight: '55%', overflowY: 'auto' }}>` — **`hidden` attribute, never conditional unmount** (an in-flight generation must survive collapse). The `onOpenAssistant` prop remains wired to the generation panel's own "Open assistant" button only.
- [ ] In `src/ArisApp.tsx`: render `<ArisExplorerPane …/>` inside the `ResponsiveDrawer`, passing `activeTab={activeTab?.studio ? { key: activeTab.key, title: activeTab.title, models: activeTab.studio.models } : null}` and the other props; delete the moved JSX (~140 lines).
- [ ] Add `export { ArisExplorerPane } from './ArisExplorerPane'` (+ prop types) to `src/aris/shell/index.ts`.
- [ ] Acceptance bar: **every existing `src/ArisApp.test.tsx` test passes unchanged.** (Verify with `grep -n "▸\|▾\|aria-expanded" src/ArisApp.test.tsx` that none assert the old caret behavior — currently none do.)
- [ ] Run prettier on touched files.

**Verify:**

```bash
npx vitest run src/ArisApp.test.tsx
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L3a — Chat interview session core

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned:** `src/aris/shell/arisChatDrawerTypes.ts` (create), `src/aris/shell/arisChatDrawerSession.ts` (create), `src/aris/shell/arisChatDrawerSession.test.ts` (create)

**Goal:** port `ArisChatImproveRail`'s reducer-driving logic into a pure, UI-free session module returning message-key events — the functional core of the chat drawer's interview tab.

**Interface:**

```ts
// arisChatDrawerTypes.ts (types only)
import type { ArisWorkingDocument } from '../model/types'
import type { ArisChatCommand } from '../chat/patchSchema'

export interface ArisTabChatHost {
  readonly getDocument: () => ArisWorkingDocument | null
  readonly applyCommands: (
    commands: readonly ArisChatCommand[],
    label: string
  ) => ArisWorkingDocument | null
  readonly undo: () => void
  readonly getCanUndo: () => boolean
}
export interface ArisChatDrawerTarget {
  readonly tabKey: string
  readonly title: string
  readonly host: ArisTabChatHost
}
export interface ArisChatInterviewRequest {
  readonly token: number
  readonly tabKey: string
}
```

```ts
// arisChatDrawerSession.ts
export type ArisChatDrawerEvent =
  | {
      readonly kind: 'status'
      readonly messageKey: string
      readonly params?: Record<string, string | number>
    }
  | { readonly kind: 'applied'; readonly count: number }
  | { readonly kind: 'rejected'; readonly error: string }
  | { readonly kind: 'terminal'; readonly status: string }
export interface ArisChatDrawerInterview {
  readonly state: ArisChatInterviewState<ArisWorkingDocument> | null
  readonly appliedCount: number
  readonly provenance: readonly ArisChatProvenanceEntry[]
}
export function createDrawerInterviewHost(): ArisChatInterviewHost<ArisWorkingDocument> // = createArisChatInterviewHost({ origin: 'ai-auto' })
export function beginDrawerInterview(
  host,
  document
): { interview: ArisChatDrawerInterview; events: readonly ArisChatDrawerEvent[] }
export function submitDrawerAnswers(
  host,
  interview,
  target: ArisTabChatHost,
  answers: Readonly<Record<string, string>>
): { interview; events }
export function confirmDrawerSelection(
  host,
  interview,
  target: ArisTabChatHost,
  selectedCommandIds: ReadonlySet<string>
): { interview; events }
export function drawerConfirmationPreview(
  host,
  interview,
  describeTargets
): ArisChatConfirmationPreview | null
export function describeCommandTargets(
  document: ArisWorkingDocument,
  ids: readonly string[]
): string[] // exported helper
```

**Steps:**

- [ ] **Read first (transcription sources):** `src/aris/shell/ArisChatImproveRail.tsx` in full; `src/aris/chat/interviewLoop.ts` (`startArisChatInterview`, `advanceArisChatInterview`, `TERMINAL_INTERVIEW_STATUSES`), `src/aris/chat/transcript.ts` (`buildProvenanceEntry`, `assertProvenanceSafeToStore`), `src/aris/shell/arisChatHost.ts` (`createArisChatInterviewHost`, `scanArisGaps`), `src/aris/shell/arisChatProposal.ts` (`buildLocalArisPatchProposal`, `ARIS_CHAT_REMOVE_ANSWER`), `src/aris/chat/patchSchema.ts` (`parseArisPatchProposal`), `src/aris/chat/applyEngine.ts` (`buildConfirmationPreview`).
- [ ] Transcribe into pure functions: `submitDrawerAnswers` = rail lines 161–209 (`submitAnswers`): advance `answersSubmitted` → `buildLocalArisPatchProposal` (null → status event `aris.chat.noProposal`, stay awaiting) → `parseArisPatchProposal` (throw → `rejected` event) → advance `proposalReceived` → `lastError` → `rejected`; else run the commit.
- [ ] Commit path = rail lines 114–158 semantics with `onApplyCommands` replaced by `target.applyCommands(applied, 'aris.chat.improve')`: `null` return → status `aris.chat.commitFailed` + restart the interview from `target.getDocument()`; success → `{kind:'applied', count}` + provenance entries via `buildProvenanceEntry` guarded by `assertProvenanceSafeToStore` (failure → status `aris.chat.provenanceRejected`), then pin `state.document` to the document `applyCommands` returned (mirrors rail line 156).
- [ ] `confirmDrawerSelection` = rail lines 211–237; empty selection → status `aris.chat.nothingSelected`. `beginDrawerInterview` = `startArisChatInterview`; a `clean` result → status `aris.chatDrawer.interview.clean`. Terminal statuses → `{kind:'terminal', status}`. Export `describeCommandTargets` = rail lines 68–78.
- [ ] Write `arisChatDrawerSession.test.ts` (node env; documents from `src/aris/chat/testFixtures.ts`, same pattern as `interviewLoop.test.ts`): gap scan yields ≤3 questions; answering a `missingEnglishName` question applies exactly one command through a stub `ArisTabChatHost` whose `applyCommands` replays via `createArisChatApplyHost` and returns the folded doc; `applyCommands` returning `null` restarts from the live doc + emits `aris.chat.commitFailed`; unmappable answers emit `aris.chat.noProposal` with the document untouched; confirm-classified commands never reach `applyCommands` before `confirmDrawerSelection`; one provenance entry per receipt; terminal statuses surface.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/shell/arisChatDrawerSession.test.ts
npm run typecheck && npm run check:aris-runtime-boundary
```

---

## Lane L5a — Canvas content-language projection + RTL captions

**Wave:** 1 · **Worker:** kimi-k2.7 · **Depends on:** nothing
**Files owned:** `src/aris/canvas/localization.ts`, `src/aris/canvas/canvasSync.ts`, `src/aris/canvas/ArisCanvas.ts`, `src/aris/canvas/renderer.ts`, `src/aris/canvas/contentLanguage.test.ts` (create)

**Goal:** `ArisCanvas.setContentLanguage('en'|'ar')` re-renders every label in that language with the fallback chain (never blank), producing **zero undo entries**; Arabic captions get RTL text attributes.

**Steps:**

- [ ] **Read first:** `src/aris/canvas/canvasSync.ts` in full — locate all 8 `readLocalized(...)` call sites (lines ~317, 346, 365, 388, 415, 442, 789, 801; the last two are inside free function `connectionLabelText`). Read `upsertShape` and confirm a business-object `name` change marks the shape dirty for redraw; if the diff logic misses `name`, include it. Also read `src/aris/canvas/emptyDocument.ts` (`DEFAULT_LOCALE_ID = 'en-US'`), `src/aris/canvas/commandBridge.ts` line ~185 (`refresh` — re-sync + `ARIS_DOCUMENT_CHANGED`, NOT a command), `src/library/amlParse.ts:182` (`localeLang` classification), `src/aris/shell/arisDetailsEditing.ts:58` (`ARIS_FALLBACK_LOCALE_IDS`).
- [ ] `src/aris/canvas/localization.ts` — add:

  ```ts
  export type ArisContentLanguage = 'en' | 'ar'
  export const ARIS_CONTENT_LOCALE_IDS: Readonly<Record<ArisContentLanguage, string>> =
    Object.freeze({ en: DEFAULT_LOCALE_ID /* 'en-US' */, ar: 'ar-AE' })
  ```

  (`readLocalized` classifies any representative id per language via `localeLang`, so the exact ar key just needs to classify as Arabic; `'ar-AE'` matches the details-editing fallback.)

- [ ] `src/aris/canvas/canvasSync.ts` — add a private `displayLocaleId = DEFAULT_LOCALE_ID` and `setDisplayLocale(localeId: string): void` on `ArisCanvasSync`; thread `displayLocaleId` into **all 8** `readLocalized` call sites (give `connectionLabelText` an optional `localeId` parameter, passed from the class).
- [ ] `src/aris/canvas/ArisCanvas.ts` — facade:

  ```ts
  setContentLanguage(language: ArisContentLanguage): void {
    this.sync.setDisplayLocale(ARIS_CONTENT_LOCALE_IDS[language])
    this.bridge.refresh('content-language')   // NOT a command: undo stack untouched
  }
  get contentLanguage(): ArisContentLanguage
  ```

- [ ] `src/aris/canvas/renderer.ts` — in `drawCaption` (~line 238) and `drawLabelText` (~line 283): when the text matches `/\p{Script=Arabic}/u`, set attributes `direction: 'rtl'` and `'unicode-bidi': 'plaintext'` on the text node.
- [ ] Write `src/aris/canvas/contentLanguage.test.ts`: boot a doc with en+ar names → `setContentLanguage('ar')` → occurrence business objects carry Arabic names; back to `'en'` restores exact originals; ar-only element under `'en'` display still shows Arabic (fallback — **never `''`**); en-only under `'ar'` shows English; `canUndo` and command count unchanged across 10 toggles (zero-undo contract); raw-entity locale keys (`"&LocaleId.AEar;"`) resolve under `'ar'`; an Arabic caption node carries `direction="rtl"`.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/canvas
npm run typecheck && npm run check:aris-runtime-boundary
```

---

## Lane L5b — ARIS localization adapter

**Wave:** 1 · **Worker:** opus-4.8-1M · **Depends on:** nothing
**Files owned:** `src/aris/localization/` (create: `fields.ts`, `review.ts`, `run.ts`, `aiTranslateTexts.ts`, `apply.ts`, `index.ts`, `__tests__/`)

**Goal:** wire the surviving notation-agnostic `src/localization` core to `ArisWorkingDocument`: field extraction → `DiagramLocalizationReview` construction → provider run → one-gesture apply.

**Layering rule:** this package may import from `src/localization/*` (specific modules, never the barrel), `src/aris/model`, `src/aris/canvas` (types + commandFactory), `src/aris/chat/locale`, `src/library/amlParse` — but **never from `src/aris/shell`** (shell composes lanes; lanes never import shell). Reimplement small shell helpers locally where noted.

**Interfaces (implement exactly):**

```ts
// fields.ts
export interface ArisTranslationOwner {
  readonly kind: 'model' | 'objectDefinition' | 'connectionDefinition' | 'freeText'
  readonly id: string
  readonly modelId: string // '' for document-scoped definitions with no occurrence
}
export interface ArisLocaleIds {
  readonly en: string
  readonly ar: string
}
export interface ArisLocalizationExtract {
  readonly fields: readonly LocalizationField[]
  readonly owners: ReadonlyMap<string, ArisTranslationOwner> // key = elementId used in fields
  readonly locales: ArisLocaleIds
}
export function extractArisLocalizationFields(
  document: ArisWorkingDocument,
  options: { readonly active: 'en' | 'ar'; readonly locales?: ArisLocaleIds }
): ArisLocalizationExtract

// review.ts
export interface ArisLocalizationReviewInput {
  readonly document: ArisWorkingDocument
  readonly target: 'en' | 'ar'
  readonly active: 'en' | 'ar'
  readonly resources?: LocalizationResources // default: SEEDED_GLOSSARY + empty TM
}
export interface ArisLocalizationReviewResult {
  readonly review: DiagramLocalizationReview // source: 'aris'
  readonly owners: ReadonlyMap<string, ArisTranslationOwner>
  readonly locales: ArisLocaleIds
  readonly sourceSignature: string
  readonly revision: number
}
export function buildArisLocalizationReview(
  input: ArisLocalizationReviewInput
): ArisLocalizationReviewResult
export function countArisMissingTranslations(document: ArisWorkingDocument): {
  en: number
  ar: number
}

// run.ts
export interface ArisTranslationRunResult {
  readonly proposals: readonly TranslationOutputProposal[]
  readonly failures: readonly ProviderFailure[]
}
export async function runArisReviewedTranslation(
  review: DiagramLocalizationReview,
  translateTexts: TranslateTextsFn,
  signal?: AbortSignal
): Promise<ArisTranslationRunResult>

// aiTranslateTexts.ts
export function makeArisAiTranslateTexts(
  callLLM: (
    messages: { role: string; content: string }[],
    opts: { maxTokens: number }
  ) => Promise<unknown>,
  options?: { chunkSize?: number } // default 60
): TranslateTextsFn

// apply.ts
export interface ArisTranslationUpdate {
  readonly owner: ArisTranslationOwner
  readonly localeId: string
  readonly value: string
}
export function toArisTranslationUpdates(
  patches: readonly LocalizationPatch[],
  owners: ReadonlyMap<string, ArisTranslationOwner>
): ArisTranslationUpdate[] // drops 'fallback'-property projection patches
export function applyArisTranslations(
  canvas: {
    document: ArisWorkingDocument
    bridge: {
      execute(label: string, thunks: readonly ArisCommandThunk[]): readonly ArisEditCommand[]
    }
  },
  updates: readonly ArisTranslationUpdate[],
  label: string
): number // applied count; ONE bridge.execute ⇒ ONE undo entry; throws on rejection (nothing applied)
```

**Steps:**

- [ ] **Read first:** `src/localization/types.ts` (`LocalizationField`, `BilingualValue`, `LocalizationSource.Aris` at line ~20, `LocalizationStorage`), `src/localization/plan.ts` (`planLocalResourceApplication` ~105, `planLanguageProjection` ~201, `buildTranslationQueue` ~264), `src/localization/audit.ts`, `src/localization/script.ts` (`validateTargetScript`), `src/localization/modelerAdapter.ts` ~291 (the review-assembly shape to mirror — do NOT import this module), `src/localization/glossary.ts` (`SEEDED_GLOSSARY`), `src/ai/translate.ts` (exports `TranslateTextsFn` ~923, `TRANSLATE_INSTRUCTION` ~225, `TRANSLATE_MAX_TOKENS` ~237; directional loop ~931–957; unexported chunk logic ~399–447 incl. `RETRY_REMINDER`), `src/aris/chat/locale.ts` (`hasEnglishName`/`hasArabicName`, locale-id sets), `src/aris/shell/arisChatProposal.ts` lines 34–76 (`detectLocaleIds` semantics + `resolveOwnerKind` — reimplement locally, byte-identical fallbacks `'1033'`/`'1025'`), `src/aris/canvas/commandFactory.ts` (`setLocalizedNameCommand` ~378, `editFreeTextCommand` ~677), `src/aris/shell/arisChatHost.ts` ~723 (`ArisChatGestureCanvas` structural shape), `src/aris/shell/arisChatUndo.test.ts` (headless bridge test harness pattern), `src/localization/TranslationReviewDialog.tsx` top (`TranslationOutputProposal`/`ProviderFailure` shapes ~line 38).
- [ ] `fields.ts`: locale detection = local reimplementation of `detectLocaleIds` (first `values` key per language classified via `localeLang`; fallbacks `'1033'`/`'1025'`). Include: every `document.models` value (field `'name'`, kind `'name'`, elementId = model id, processId = model id); every objectDefinition **with at least one non-blank name value** (unnamed = fix-missing territory; DO include named `OT_RULE` — rules like "Approved?" must translate); every named connectionDefinition; every non-blank `model.freeText` entry (kind `'annotation'`, field `'text'`, owner kind `'freeText'`). processId for definitions = modelId of the first occurrence found, else `'document'`. Per element: en slot = first `values` entry whose key classifies `'en'` (value + that exact localeId), else absent with write-target `locales.en`; ar likewise. Build `LocalizationField` with `value: {en?, ar?, active}`, `origins` `'paired'` for present slots, and `storage: { enProperty: <en write localeId>, arProperty: <ar write localeId>, projectionProperty: 'fallback' }` — **the storage strings smuggle the ARIS write-locale ids through the notation-agnostic pipeline**; `planeIds: []`, `source: 'aris'`.
- [ ] `review.ts`: assemble exactly like `inspectDiagramLocalization` minus moddle: extract → `planLocalResourceApplication(fields, {glossary, translationMemory})` → fold plan updates into the fields → `planLanguageProjection(fields, target)` (note: `'fallback'`-property projection patches are IGNORED at apply time — projection is the canvas's job) → `buildTranslationQueue(fields, {}, target)` → `{source:'aris', target, fields, issues, queue, localUpdates: plan.updates.filter(p => p.property !== 'fallback'), projected, unchanged, blockers, complete, localResources}`. `sourceSignature` = stable JSON of sorted `[elementId, field, en, ar]` rows; also return `revision: document.revision`. `countArisMissingTranslations` = `hasEnglishName`/`hasArabicName` per named element (comment the intentional delta vs gapScanner name rules: named-but-missing-counterpart counts here because translate can fix it).
- [ ] `run.ts`: per direction (`ar` then `en`), take queue items without `requiresSegmentationReview`, batch their `sourceValue`s through `translateTexts(texts, source, target, signal)`; validate each result with `validateTargetScript` + non-empty + ≠ source; positional `undefined`/invalid → `ProviderFailure`. Mirror the directional loop of `translateReviewedDiagramWithTexts`.
- [ ] `aiTranslateTexts.ts`: chunked (default 60) index-keyed JSON payload (`{"0": "...", ...}`) with `TRANSLATE_INSTRUCTION` as system-style preamble and `TRANSLATE_MAX_TOKENS`; strict-JSON parse with ONE retry appending the `RETRY_REMINDER` sentence; positional results. Reimplement the ~40 unexported lines (`requestChunk`/`coerceToRecord` equivalents) locally.
- [ ] `apply.ts`: thunks — owner kind `model`/`objectDefinition`/`connectionDefinition` → `setLocalizedNameCommand(context, document, ownerKind, ownerId, localeId, value)`; `freeText` → `editFreeTextCommand(context, document, id, { text: value, localeId })`. ONE `bridge.execute(label, thunks)` for all updates. The structural canvas parameter matches `ArisChatGestureCanvas`, so tests drive the real bridge headlessly.
- [ ] `index.ts`: re-export everything above.
- [ ] Tests under `src/aris/localization/__tests__/` (fixtures via `src/aris/chat/testFixtures.ts` or `src/aris/model/testFixture.ts` `SYNTHETIC_AML` → `buildFromSource`): extraction cases (en-only / ar-only / both / wrong-script → audit issue / mixed / neutral "API" / raw-entity locale keys / freeText / named rule included / unnamed definition excluded); write-locale fidelity (existing ar key `'14337'` → patch property `'14337'`, NOT `'1025'`; absent → fallback); glossary/TM local resolution with **zero provider calls** (spy `translateTexts`); run failure taxonomy (per-text failure → `ProviderFailure`; whole-chain `FreeTranslateError` propagates); apply = exactly one `bridge.execute`, one undo restores every name, re-running `buildArisLocalizationReview` after apply → `complete === true` and empty queue (idempotence), a rejected gesture leaves the document untouched; no patch ever writes `''`.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/localization
npm run typecheck && npm run check:aris-runtime-boundary
```

---

## Lane L1c — Folder tree + CRUD integration

**Wave:** 2 · **Worker:** opus-4.8-1M · **Depends on:** L1a, L1b · **Wave-2 owner of `src/ArisApp.tsx`, `src/aris/shell/ArisExplorerPane.tsx`, `src/i18n/dictionaries.ts`, `src/ArisApp.test.tsx`**
**Files owned:** those four + `src/aris/shell/arisExplorerActions.tsx` (create) + `src/aris/shell/__tests__/arisExplorerActions.test.tsx` (create)

**Goal:** replace the flat file list with `FolderTreeLite` for multi-file workspaces (directory + OPFS); full CRUD (new folder, rename, delete, move, drag-move, import-drop) against the `WorkspaceAdapter`; single-file mode keeps the flat block; `ArisModelExplorer` stays exactly where it is (models are only known for OPENED sources — do not force eager parsing of every file).

**Steps:**

- [ ] **Read first:** `src/workspace/FolderTreeLite.tsx` props + behavior; `src/workspace/processHierarchy.ts` (`buildProcessHierarchy` accepts empty index/graph → pure physical tree, verified); `src/workspace/adapters/types.ts` (capabilities: `multipleFiles`, `directories`, `rename`, `move`, `remove`) and `src/workspace/adapters/handleAdapter.ts` (`walkDirectory` lists directories; cross-parent `relocate` at ~572); `src/workspace/MoveDialog.tsx`, `src/workspace/ConfirmDialog.tsx`, `src/workspace/EmptyWorkspaceCard.tsx`, `src/workspace/importDrop.ts` (`collectDroppedBpmn`, `isBpmnName`); `src/common/prompt` (`PromptText` — `PromptProvider` already mounted in `src/main.tsx`); `src/ArisApp.tsx` `refreshWorkspaceSources` (~line 324) and `handleOpenWorkspaceFile`; `src/workspace/adapters/memory.ts` (test adapter constructor); reference wiring `git show main:src/App.tsx` lines 11040–11100.
- [ ] `src/ArisApp.tsx` — data plumbing:
  - [ ] New state `const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([])`. In `refreshWorkspaceSources`, store the **unfiltered** `adapter.list()` result (directory entries included) into `workspaceEntries` while keeping `workspaceSources` filtered as today. Single-file branch sets both.
  - [ ] Memos (runtime imports of `buildProcessHierarchy` + L1a helpers are boundary-safe):

    ```ts
    const multiFile = workspaceAdapter?.storage.capabilities.multipleFiles === true
    const explorerTree = useMemo(
      () =>
        multiFile
          ? buildLiteTreeFromEntries(workspaceEntries, rootLabel(mode, workspaceAdapter))
          : null,
      [multiFile, mode, workspaceAdapter, workspaceEntries]
    )
    const explorerHierarchy = useMemo(
      () =>
        explorerTree
          ? buildProcessHierarchy(explorerTree, EMPTY_PROCESS_INDEX, EMPTY_PROCESS_GRAPH)
          : null,
      [explorerTree]
    )
    ```

    (`rootLabel` = a small helper returning the workspace's display name; derive from the adapter or mode the way the header already does.)

  - [ ] Tabs controller (stable `useCallback`s):

    ```ts
    interface ArisExplorerTabsController {
      closeUnder(path: string, kind: 'file' | 'directory'): void // close tabs at/under path; repair activeKey like ProcessTabList's onClose
      remap(from: string, to: string, kind: 'file' | 'directory'): void // rewrite tab.relPath + title; NEVER change tab.key (a key change remounts the canvas and destroys undo history)
    }
    ```

  - [ ] `handleOpenWorkspaceFile`: prepend relPath dedupe — `const existing = tabs.find(t => t.relPath === path); if (existing) { setActiveKey(existing.key); return }` (add `tabs` to deps).
  - [ ] Pass to the pane: `adapter`, `multiFile`, `tree`, `hierarchy`, `activePath: activeTab?.relPath ?? null`, `rootName`, `tabsController`, `onRefreshWorkspace`, `onOpenFileFocus` (open + collapse the drawer when `responsiveMode !== 'docked'`), and `onNewModel: (folderRel: string) => pushToast(t('aris.placeholder.newProcessUnavailable'))` — **a stub; Lane L2d replaces only its body**.
- [ ] Create `src/aris/shell/arisExplorerActions.tsx` — a hook + dialog host owning ALL CRUD:

  ```ts
  export interface UseArisExplorerActionsOptions {
    readonly adapter: WorkspaceAdapter | null
    readonly tree: LiteTreeNode | null
    readonly rootName: string
    readonly promptText: PromptText
    readonly refresh: () => Promise<void>
    readonly toast: (message: string, tone?: 'info' | 'error' | 'success') => void
    readonly tabs: ArisExplorerTabsController
  }
  export interface ArisExplorerActions {
    readonly onNewFolder: (folderRel: string) => void
    readonly onRename: (node: LiteTreeNode) => void
    readonly onDelete: (node: LiteTreeNode) => void
    readonly onMove: (node: LiteTreeNode) => void
    readonly onMoveDrop: (
      fromRel: string,
      fromType: 'file' | 'directory',
      toFolderRel: string
    ) => void
    readonly onImportDrop: (dataTransfer: DataTransfer, toFolderRel: string) => void
    readonly dialogs: JSX.Element | null // MoveDialog + ConfirmDialog rendered from hook state
  }
  export function useArisExplorerActions(
    options: UseArisExplorerActionsOptions
  ): ArisExplorerActions
  ```

  Handler algorithms (exact):
  - [ ] Common guards: bail with an error toast when `adapter` is null or lacks the relevant capability; refuse any operation whose source or destination path has first segment `.orbitpm` (defense-in-depth — the tree never shows those nodes anyway).
  - [ ] `onNewFolder(folderRel)`: `promptText({ title: t('dialog.newFolder.title'), label: t('dialog.newFolder.label'), initialValue: t('dialog.newFolder.initialValue'), okLabel: t('dialog.newFolder.okLabel') })`; reject names matching `/[/\\]/`; `await adapter.createFolder(folderRel ? folderRel + '/' + name : name)`; `await refresh()`; catch → `toast(t('alert.createFolderFailed', { error }), 'error')`.
  - [ ] `onRename(node)`: prompt with `dialog.rename.*` keys, `initialValue: node.name`; for files, if the new name lacks an ARIS extension (`/\.(?:aml|apc|xml|bpmn)$/i`) append the original extension; dest = same parent + finalName; `await adapter.rename(node.relPath, dest)`; `tabs.remap(node.relPath, dest, node.type)`; `refresh()`; catch → `alert.renameFailed`.
  - [ ] `onDelete(node)`: `ConfirmDialog` (`title: t('contextMenu.delete')`, message `t('confirm.deleteNode', { name: node.name })`; non-empty-folder variant adds `t('confirm.deleteFolder.notEmptyBody')` and `requireTyped: node.name`; `danger`, `role: 'alertdialog'`). On confirm: `await adapter.remove(node.relPath)` (recursive); `tabs.closeUnder(node.relPath, node.type)`; `refresh()`; catch → `alert.deleteFailed`.
  - [ ] `onMove(node)`: open `MoveDialog` with `folders = collectFolderOptions(tree, rootName)`; on choose `dest`: `await adapter.move(node.relPath, dest ? dest + '/' + node.name : node.name)`; `tabs.remap(...)`; `refresh()`; catch → `alert.moveFailed`.
  - [ ] `onMoveDrop(fromRel, fromType, toFolderRel)`: same as move with known destination; no-op when destination equals the current parent.
  - [ ] `onImportDrop(dt, toFolderRel)`: `const dropped = await collectDroppedBpmn(dt)`; for each: `.bpmn` name or rejected content → `toast(t('toast.import.arisOnly'))`, skip; else `path = uniquePathIn(existingPaths, toFolderRel, name)` and `await adapter.writeAtomic(path, new TextEncoder().encode(text), undefined, { expectedMissing: true })`; on `already-exists` conflict retry via `uniquePathIn`. After the loop: `refresh()` + `toast(t('aris.explorer.imported', { count }))`.

- [ ] `src/aris/shell/ArisExplorerPane.tsx` — branch the workspace section:

  ```tsx
  {multiFile && tree && hierarchy ? (
    countTreeFiles(tree) === 0
      ? <EmptyWorkspaceCard folderName={rootName} onCreateFirst={() => onNewModel('')} />
      : <FolderTreeLite hierarchy={hierarchy} activePath={activePath}
          onOpenFile={(rel) => /\.bpmn$/i.test(rel) ? onRejectUnsupported() : onOpenWorkspaceFile(rel)}
          onOpenFileFocus={onOpenFileFocus}
          onOpenProcess={() => undefined}
          onNewProcess={onNewModel} onNewFolder={actions.onNewFolder}
          onRename={actions.onRename} onDelete={actions.onDelete} onMove={actions.onMove}
          onMoveDrop={actions.onMoveDrop} onImportDrop={actions.onImportDrop} />
  ) : ( /* existing flat single-file block, verbatim */ )}
  {actions.dialogs}
  ```

  Chrome row additions (multi-file only, before Import): **`＋ New model`** (primary styling, `title={t('aris.explorer.newModel.title')}`) → `onNewModel('')`; **`📁＋`** (`aria-label={t('tree.newFolder.aria')}`, `title={t('tree.newFolder.title')}`) → `actions.onNewFolder('')`; **`↻`** (`title={t('tree.refresh.title')}`, `aria-label={t('tree.refresh.aria')}`) → `onRefreshWorkspace`. (`tree.newFolder.*`/`tree.refresh.*` keys already exist in the dictionaries — verify with grep; if absent, add them in this lane.) `ArisModelExplorer` stays exactly where it is with identical DOM.

- [ ] `src/i18n/dictionaries.ts` — add to BOTH maps: `aris.explorer.newModel` = `＋ New model` / `＋ نموذج جديد`; `aris.explorer.newModel.title` = `Create a blank ARIS model (EPC or value-added chain) in this workspace` / `إنشاء نموذج ARIS فارغ (EPC أو سلسلة قيمة مضافة) في مساحة العمل هذه`; `aris.explorer.imported` = `Imported {count} file(s) into the workspace.` / `تم استيراد {count} ملف/ملفات إلى مساحة العمل.`.
- [ ] Tests:
  - [ ] NEW `src/aris/shell/__tests__/arisExplorerActions.test.tsx` (jsdom; drive the hook via a tiny harness component with the memory adapter): rename preserves extension + calls `tabs.remap`; delete non-empty folder requires typed name + calls `tabs.closeUnder`; move refuses `.orbitpm` destinations; import-drop writes an `.aml`, rejects `.bpmn` with the arisOnly toast, suffixes on collision.
  - [ ] UPDATE `src/ArisApp.test.tsx` directory-mode test (~line 604): the flat `getByRole('button', { name: /legacy\/process\.aml/i })` pills become tree rows — `fireEvent.click(screen.getByRole('treeitem', { name: 'legacy' }))` to expand the synthesized folder, then click the `process.aml` treeitem; `.bpmn` row click asserts the arisOnly toast. Extend `makeDirectoryAdapter`'s mock `storage.capabilities` with `directories/rename/move/remove: true` (**extend the mock, never relax product guards**). Add one new test: folders sort before files and a seeded `.orbitpm/aris/x/manifest.json` entry is hidden.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/ArisApp.test.tsx src/aris/shell/__tests__/arisExplorerActions.test.tsx src/workspace/__tests__ src/__tests__/i18n.test.ts
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L3b — `ArisChatDrawer` UI

**Wave:** 2 · **Worker:** opus-4.8-1M · **Depends on:** L3a
**Files owned:** `src/aris/shell/ArisChatDrawer.tsx` (create), `src/aris/shell/ArisChatDrawer.test.tsx` (create), `src/aris/shell/ArisChatDrawer.aiGate.test.tsx` (create)

**Goal:** the chatbot copied from main's AssistantDrawer UX — 💬 FAB + right-edge sliding panel + two tabs + message bubbles + Enter-to-send — wired to ARIS backends. Chat consent is KEPT via the existing `ArisAssistantAiSection`.

**Props:**

```ts
export interface ArisChatDrawerProps {
  open: boolean
  onOpen: () => void
  onClose: () => void
  keysVersion: number // bumped when Settings closes; `void keysVersion` before pickProvider
  digests: readonly ArisProcessDigest[] // src/aris/assistant/types
  onOpenChip: (chip: ArisAnswerChip) => boolean // src/aris/assistant/answer
  onOpenSettings: () => void
  onChangeWorkspace?: () => void
  getActiveChatTarget: () => ArisChatDrawerTarget | null
  interviewRequest?: ArisChatInterviewRequest | null
}
```

**Steps:**

- [ ] **Read first (transcription source — transcribe, NEVER import):** `src/assist/AssistantDrawer.tsx` (byte-identical to main): style constants lines 1207–1429; launcher lines 938–957; dialog shell + header + tablist lines 1113–1200; tab keydown lines 895–925; scroll effect lines 699–703; bubbles lines 972–1033; input row + footer lines 1077–1110; `pickProvider` lines 152–166; return-focus + `useClientLayoutEffect` lines 233–235 and 402–419; interview-request effect lines 883–891. Also read: `src/common/AccessibleDialog.tsx`; `src/aris/assistant/{answer,retrieval,questionRouter,formatAnswer,types}.ts` (`routeQuestion`, `formatAnswer`, chip shape); `src/aris/shell/ArisAssistantAiSection.tsx` (props + selectors — reused as the consent card); `src/aris/shell/ArisAssistantPanel.tsx` lines 51–54/159–173 (the two suggestion buttons to carry over); `src/aris/shell/ArisChatImproveRail.tsx` lines 317–346 (unusedDefinition checkbox) + 361–431 (confirm card, receipts); `src/ai/TechnicalErrorDetail.tsx`, `src/ai/providerSelection.ts` (`subscribeProviderSelection`), `src/ai/keys.ts` (`hasKey`).
- [ ] Build the chrome: copy the style-constant block; change `PANEL_STYLE.insetBlockEnd: 100` → `0` (no bpmn watermark on this branch) and drop the two attribution comments. Keep `FAB_STYLE` exactly (fixed, insetBlockEnd 72, insetInlineEnd 4, zIndex 900, 44×44 circle, `var(--orbitpm-accent)`, 💬, `aria-label={t('assist.open')}`, `hidden={open}`). `if (!open) return launcher`. Panel via `AccessibleDialog` with `ariaLabel={t('assist.title')}` — **must remain 'Process assistant' / 'مساعد العمليات'** (four e2e suites match the dialog name) — `closeOnEscape`, `closeOnBackdrop`, `initialFocusRef={closeButtonRef}`, `returnFocusRef`, `dir`; header `×` close `aria-label={t('assist.close')}`; optional Change-workspace chip; two `role=tab` buttons `t('assist.tab.library')` / `t('assist.tab.interview')` with the RTL-aware Arrow/Home/End keydown handler.
- [ ] Message model: `{ role: 'user' | 'assistant'; kind?: 'chat' | 'status' | 'error'; text?: string; technicalDetail?: string; lines?: readonly ArisFormattedAnswerLine[]; aiQuestion?: string }`. Message list `role="log" aria-live="polite" aria-relevant="additions text"` with the auto-scroll effect; bubbles per the transcribed styles (user = accent right-aligned; assistant = hover-bg left; status = italic muted; error = `role="alert"` + `TechnicalErrorDetail`); thinking bubble `t('assist.thinking')`.
- [ ] **Library tab:** always-visible muted line `tk('aris.assistant.ask.indexed', '{count} indexed models', { count: digests.length })` under the tabs (preserves the e2e `'8 indexed models'` assertion). Empty state: `t('assist.empty')` + the two suggestion buttons (click = send that text). `send(q)`: push user bubble → `routeQuestion(digests, q, lang)` → `formatAnswer(lang, routed)` → push assistant bubble rendering `lines` (container `data-orbitpm-aris-assistant-answer=""`; each chip a pill button `data-orbitpm-aris-assistant-chip={chip.occurrenceId ?? chip.modelId}` → `onOpenChip(chip)`; failed reveal → status bubble `tk('aris.assistant.chip.unavailable', 'That element is not on the open models.')`). When `routed.kind === 'none'` AND a provider+key is configured (subscribe `subscribeProviderSelection`; check `hasKey`): append an `aiQuestion` message hosting `<ArisAssistantAiSection key={q} digests={digests} question={q} providerId={…} modelId={…} history={aiHistory} onOpenChip={onOpenChip} onAnswered={(turn) => setAiHistory(prev => [...prev, turn])} />` — the kept consent card with its e2e-tested selectors. Input textarea rows=2, Enter sends / Shift+Enter newline, `data-orbitpm-aris-assistant-question=""`, Send `t('assist.send')`. Footer: `t('assist.model.line', {model, provider})` or `t('assist.localMode')`.
- [ ] **Interview tab** (tabpanel root `data-orbitpm-aris-chat=""`; input row hidden here): on tab entry or `interviewRequest`, resolve `getActiveChatTarget()` — null → status `tk('aris.chatDrawer.interview.noTarget', 'Open an ARIS model first, then start the completion interview.')`. Intro card: `tk('aris.chatDrawer.interview.intro', 'I scanned {name} and found {count} gap(s). Answer up to 3 questions per round; safe changes apply as one undoable step.', {name, count})` + gap `<ul data-orbitpm-aris-chat-gaps>` (≤25 rows of `t(gap.messageKey as Key, gap.messageParams)`) + Start button `data-orbitpm-aris-chat-start` + Undo button `data-orbitpm-aris-chat-undo` (enabled when `target.host.getCanUndo() && appliedCount > 0`; on click `host.undo()` then rescan + refresh the count line). Round card when `state.status === 'awaitingAnswers'`: per question a `<label data-orbitpm-aris-chat-question={q.gapKind}>` with `t(q.messageKey, q.messageParams)` + text input — except `unusedDefinition` which renders the checkbox mapping to `ARIS_CHAT_REMOVE_ANSWER` (transcribed from rail lines 317–346); Apply button `data-orbitpm-aris-chat-submit` → `submitDrawerAnswers`; events → bubbles (`applied` → status `tk('aris.chatDrawer.interview.applied', 'Applied {count} change(s) as one undoable step.', {count})`). Confirmation card when `awaitingConfirmation`: rail lines 361–405 structure verbatim (`data-orbitpm-aris-chat-confirm`, per-command checkbox, `data-orbitpm-aris-chat-preview` `<dl>` via `drawerConfirmationPreview` + `describeCommandTargets`, apply button `data-orbitpm-aris-chat-confirm-apply` → `confirmDrawerSelection`). Receipts `<ul data-orbitpm-aris-chat-receipts>` (rail lines 420–431). Terminal `<p data-orbitpm-aris-chat-terminal={status}>` with `tk('aris.chat.finished', …)`-style copy; `roundLimitReached` adds `tk('aris.chatDrawer.interview.roundLimit', 'Round limit reached (5 of 5). Remaining gaps stay listed for a new interview.')`; `clean` → `tk('aris.chatDrawer.interview.clean', 'No gaps found — this model looks complete.')`.
- [ ] `interviewRequest` effect: token-guarded via `lastRequestTokenRef` → `onOpen()` + `setTab('interview')` + fresh session. Carry main's `// eslint-disable-next-line react-hooks/exhaustive-deps` comment on this effect exactly (sanctioned suppression #1).
- [ ] Tests — `ArisChatDrawer.test.tsx` (jsdom): FAB renders with aria-label 'Ask the process assistant' and hides when open; dialog `role=dialog` named 'Process assistant'; Enter sends, Shift+Enter doesn't; local question 'Which processes are available?' renders an answer bubble with `data-orbitpm-aris-assistant-answer` + a chip whose click calls `onOpenChip`; interview with a stub target: gaps card renders, ≤3 questions, answers apply exactly once through `applyCommands`, receipts render; RTL `dir` propagates. `ArisChatDrawer.aiGate.test.tsx`: port the five cases from `ArisAssistantPanel.aiGate.test.tsx` against the drawer — no key ⇒ no `[data-orbitpm-aris-assistant-ai]` and `fetch` never called; with key + unmatched question ⇒ AI section mounts with unchecked consent and disabled submit; etc.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/shell/ArisChatDrawer.test.tsx src/aris/shell/ArisChatDrawer.aiGate.test.tsx
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L3c — StudioTab chat host + rail removal

**Wave:** 2 · **Worker:** kimi-k2.7 · **Depends on:** L3a (types file) · **Wave-2 owner of `src/aris/shell/ArisStudioTab.tsx` and `src/aris/shell/index.ts`**
**Files owned:** `src/aris/shell/ArisStudioTab.tsx`, `src/aris/shell/index.ts`, delete `src/aris/shell/ArisChatImproveRail.tsx`, one new test file

**Steps:**

- [ ] In `src/aris/shell/ArisStudioTab.tsx`: delete the `ArisChatImproveRail` import (line 30); KEEP `applyArisChatCommandsAsGesture` (line 32). Add props: `readonly chatHostKey?: string; readonly onChatHostChange?: (key: string, host: ArisTabChatHost | null) => void` (`import type { ArisTabChatHost } from './arisChatDrawerTypes'`).
- [ ] After `handleApplyChatCommands` (lines 343–350, unchanged) add:

  ```ts
  const chatHost = useMemo<ArisTabChatHost>(
    () => ({
      getDocument: () => canvasRef.current?.document ?? null,
      applyCommands: handleApplyChatCommands,
      undo: () => canvasRef.current?.undo(),
      getCanUndo: () => canvasRef.current?.canUndo ?? false
    }),
    [handleApplyChatCommands]
  )
  useEffect(() => {
    if (!chatHostKey || !onChatHostChange) return
    onChatHostChange(chatHostKey, chatHost)
    return () => onChatHostChange(chatHostKey, null)
  }, [chatHost, chatHostKey, onChatHostChange])
  ```

  (`ArisCanvas` exposes the `document` getter at line ~170, `undo()` ~200, `canUndo` getter ~209 — verified. Getter-based host = no exhaustive-deps suppressions needed.)

- [ ] Delete the rail JSX (lines 610–615). Delete `src/aris/shell/ArisChatImproveRail.tsx`. Remove its export from `src/aris/shell/index.ts` (line 11).
- [ ] Note: `src/aris/shell/arisChatGate.test.ts` and `arisChatUndo.test.ts` drive `arisChatHost` directly — untouched, must stay green. `src/ArisApp.test.tsx`'s interview test (~911) breaks at this point **by design** — Lane L3d fixes it; run only `src/aris/shell` tests in this lane.
- [ ] Add a jsdom test (new file `src/aris/shell/__tests__/arisStudioTabChatHost.test.tsx`, reusing the geometry shim pattern): mounting `ArisStudioTab` fires `onChatHostChange` with a host whose `getDocument()` returns the canvas document after ready, and fires `(key, null)` on unmount.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/shell
npm run typecheck && npm run check:aris-runtime-boundary
```

---

## Lane L4a — Generation panel rebuild

**Wave:** 2 · **Worker:** opus-4.8-1M · **Depends on:** nothing (parallel-safe)
**Files owned:** `src/ArisGenerationPanel.tsx`, `src/aris/shell/arisCreatePanel.test.tsx`, `src/aris/shell/arisCreateDocumentAi.test.tsx`, `src/aris/shell/arisCreateDescriptionContext.test.tsx`

**Goal:** rebuild the panel's chrome to AiPanelLite's visual system, simplified to **Name + per-tab source + AI provider/model**. Pipeline calls unchanged. This implements authorized product changes #1 and #2.

**Steps:**

- [ ] **Read first (transcription source — transcribe, never import):** `src/ai/AiPanelLite.tsx`: `Spinner` 1616–1631; style constants 1672–1776 (`segmentWrap`, `segmentBtn(active)`, `labelStyle`, `labelText`, `inputStyle`, `ghostBtn`, `linkBtn`, `removeBtn`, `warnBox`, `infoBox`, `errorBox`, `okBox`, `noteBox`); tablist JSX 962–1026 + keydown 419–447; provider select 1035–1066; model control 1077–1135; offline listener 355–363; submit/busy/okBox 1426–1538. Also `src/ArisGenerationPanel.tsx` in full (the rewrite target), `src/aris/ai/promptBuilder.ts` lines 34 + 110–122 (`'auto-detect'` support), `src/ai/providerSelection.ts` (`getProviderSelection`/`setProviderSelection`/`subscribeProviderSelection`), `src/ai/providersLite.ts` (`LITE_PROVIDERS`, `defaultLiteModelId`, `allowCustomModel`), `src/ai/keys.ts` (`hasKey`), `src/ai/keyStorageErrorMessage`.
- [ ] Props: remove `digests?`; add `onContinueInChat?: () => void`. Keep everything else (`onCreateModel`, `onDownloadFile`, `onOpenAssistant`, `onOpenSettings`, `embedded`, `workspaceId`, `callProvider`, `parseDocx`, `encodeAttachment`).
- [ ] Rebuild the chrome: body root `<div style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: 12 }}>`; segmented tablist (three tabs: description / document / excel) with roving tabindex + RTL-aware arrows, **keeping** `data-orbitpm-aris-create-description-tab` / `-document-tab` / `-excel-tab`; provider `<select>` with a `' ✓'` suffix on options where `hasKey(p.id)`; model control — `allowCustomModel` (OpenRouter/Gemini) ⇒ free-text `<input list=…>` + `<datalist>`, else `<select>` — **keep `data-orbitpm-aris-create-model` on whichever control renders**; offline `warnBox` (`t('ai.offlineWarning')`) on AI tabs; no-keys `infoBox` with a Settings `linkBtn` (`t('ai.noKeysAtAll.note')` / `.link`); per-tab source fields (description textarea + DOCX/PDF attach buttons | PDF/image file + hint textarea | the existing Excel block); Generate = `.orbitpm-lite-primary` + `Spinner` when busy + Cancel while busy; error/rejection lists wrapped in `errorBox`/`warnBox` **keeping** `data-orbitpm-aris-create-rejections` / `-warnings`; success `okBox role="status"` + (`onContinueInChat && <button …>{t('ai.continueInChat')}</button>`).
- [ ] **Remove entirely:** the `MODEL_TYPES` const (lines ~121–125) and both model-type `<select>`s (~860–875, ~1042–1057) — pass the literal `'auto-detect'` into the `buildArisAiPrompt` call (~245–257); `includeContext`/`redactNames` state + checkboxes + context chips (~199–200, 240–243, 958–1017); sensitivity/request-estimate lines (~259–272); disclosure/consent state + the `<details data-orbitpm-aris-create-preview>` block + consent checkbox (~201, 276–306, 693–746); the now-unused imports from `./aris/shell/arisCreateDescriptionAi` (~36–42). **Keep the module `arisCreateDescriptionAi.ts` on disk** (pure function tests still pass; do not delete it).
- [ ] Provider-selection sync: initialize local `providerId`/`modelId` from `getProviderSelection() ?? { providerId: LITE_PROVIDERS[0].id, modelId: defaultLiteModelId(LITE_PROVIDERS[0].id) }`; subscribe via `subscribeProviderSelection` in a `useEffect`; on user change call `setProviderSelection(...)` and surface a storage failure via the `errorBox` (`keyStorageErrorMessage`).
- [ ] `submitDisabled = busy || (!providerReady && !callProvider) || (tab === 'document' ? documentFile === null : trimmedDescription === '')` — no consent term. `createWithAi()` otherwise unchanged. Excel tab (~1127–1181) unchanged — template-download selectors `data-orbitpm-aris-template-blank` / `-example`, `data-orbitpm-aris-workbook-open` must not change (restyle buttons with `ghostBtn` if desired).
- [ ] Update the three test files (authorized): `arisCreatePanel.test.tsx` — remove the consent click from the submit helper (~103); repurpose the consent-invalidation test (~344–360) as "submit enabled with description present and NO consent control (`[data-orbitpm-aris-create-consent]` absent from DOM)"; ADD: the prompt sent to `callProvider` contains the auto-detect sentence and no workspace context; provider option label ends `' ✓'` with a key stored (use `resetSessionKeysForTests`/`setKey`); okBox CTA calls `onContinueInChat`. `arisCreateDocumentAi.test.tsx` — remove the consent click (~103). `arisCreateDescriptionContext.test.tsx` — delete the panel-driven consent/context/preview cases (helpers ~95–112 + dependents); keep the pure `buildArisCreateDescriptionDisclosure`/sensitivity function-level cases.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/shell/arisCreatePanel.test.tsx src/aris/shell/arisCreateDocumentAi.test.tsx src/aris/shell/arisCreateDescriptionContext.test.tsx
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L3d — App integration of the drawer

**Wave:** 3 · **Worker:** opus-4.8-1M · **Depends on:** L3b, L3c, L4a, L1b · **Wave-3 owner of `src/ArisApp.tsx`, `src/ArisApp.test.tsx`, `src/aris/shell/ArisExplorerPane.tsx`, `src/aris/shell/index.ts`**
**Files owned:** those four + delete `src/ArisAssistantDrawer.tsx`, `src/aris/shell/ArisAssistantPanel.tsx`, `src/aris/shell/ArisAssistantPanel.aiGate.test.tsx`; touch `src/aris/shell/ArisAssistantAiSection.tsx` (doc comment only)

**Steps:**

- [ ] In `src/ArisApp.tsx`:
  - [ ] Replace the `ArisAssistantDrawer` import (line ~3) with `ArisChatDrawer` + `type ArisTabChatHost, type ArisChatDrawerTarget, type ArisChatInterviewRequest` from `./aris/shell`.
  - [ ] Rename `_keysVersion` → `keysVersion` (lines ~258–265 — now consumed) and pass it to the drawer.
  - [ ] Add: `const chatHostsRef = useRef(new Map<string, ArisTabChatHost>())`; `const registerChatHost = useCallback((key: string, host: ArisTabChatHost | null) => { if (host) chatHostsRef.current.set(key, host); else chatHostsRef.current.delete(key) }, [])`; `activeKeyRef`/`tabsRef` mirrors kept current on every render; `const interviewTokenRef = useRef(0)`; `const [interviewRequest, setInterviewRequest] = useState<ArisChatInterviewRequest | null>(null)`; `const getActiveChatTarget = useCallback((): ArisChatDrawerTarget | null => { const key = activeKeyRef.current; if (!key) return null; const host = chatHostsRef.current.get(key); const tab = tabsRef.current.find(t => t.key === key); return host && tab ? { tabKey: key, title: tab.title, host } : null }, [])`; `const handleContinueInChat = useCallback(() => { const tabKey = activeKeyRef.current; if (!tabKey) return; interviewTokenRef.current += 1; setInterviewRequest({ token: interviewTokenRef.current, tabKey }); setAssistantOpen(true) }, [])`.
  - [ ] Delete the pre-ready modal mount (lines ~774–785) — the drawer exists only in the ready phase.
  - [ ] Header Assistant button (~836–842): unchanged — now opens the drawer via `setAssistantOpen(true)`.
  - [ ] StudioTab render block (~1113–1141): add `chatHostKey={tab.key}` and `onChatHostChange={registerChatHost}`.
  - [ ] Replace the ready-phase modal mount (~1183–1195) with:

    ```tsx
    <ArisChatDrawer
      open={assistantOpen}
      onOpen={() => setAssistantOpen(true)}
      onClose={() => setAssistantOpen(false)}
      keysVersion={keysVersion}
      digests={assistantDigests}
      onOpenChip={handleOpenChip}
      onOpenSettings={() => setSettingsOpen(true)}
      onChangeWorkspace={directoryAvailable ? () => void handleOpenDifferent() : undefined}
      getActiveChatTarget={getActiveChatTarget}
      interviewRequest={interviewRequest}
    />
    ```

    (`handleOpenChip` at ~623 already closes the assistant after a successful reveal — keep.)
- [ ] In `src/aris/shell/ArisExplorerPane.tsx`: remove the `digests` passthrough prop to `ArisGenerationPanel` (feature intentionally removed); add `onContinueInChat` passthrough wired from ArisApp's `handleContinueInChat`.
- [ ] Delete `src/ArisAssistantDrawer.tsx`, `src/aris/shell/ArisAssistantPanel.tsx`, `src/aris/shell/ArisAssistantPanel.aiGate.test.tsx` (superseded by L3b's drawer aiGate test). Remove the panel export from `src/aris/shell/index.ts`; add exports for `ArisChatDrawer` + the drawer types. **Keep `ArisAssistantAiSection.tsx`**; update its module doc comment (lines 4–9): now mounted by `ArisChatDrawer`.
- [ ] Update `src/ArisApp.test.tsx` (authorized): test ~552 — replace the old modal-body assertions with `expect(await screen.findByRole('dialog', { name: 'Process assistant' }))` + the 'Ask the library' tab present; also update the `aris.ai.body` copy assertion to the new EN string (see Lane X1). Test ~575 (digests-context) — **DELETE** (authorized change; feature removed). Test ~860 — the suggestion button 'Which processes are available?' exists in the drawer's empty state; answer/chip selectors unchanged; the "answer gone after chip click" wait passes because the closed drawer unmounts its content. Test ~911 (interview) — new preamble: `fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))`, then `fireEvent.click(screen.getByRole('tab', { name: 'Complete this process' }))`; the existing `data-orbitpm-aris-chat-*` selectors then work unchanged (keep the toolbar `data-orbitpm-aris-undo` check). `fillAndSubmit` helper (~1023–1033): delete the consent click (line ~1030).
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/ArisApp.test.tsx
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L2c — Movable palette + empty-model hint

**Wave:** 3 · **Worker:** kimi-k2.7 · **Depends on:** L2b (keys) · **Wave-3 owner of `src/aris/shell/ArisStudioTab.tsx` and `src/aris/shell/ArisCanvasView.tsx`**
**Files owned:** `src/aris/shell/arisPaletteDrag.ts` (create), `src/aris/shell/arisPaletteDrag.test.ts` (create), `src/aris/shell/ArisCanvasView.tsx`, `src/aris/shell/ArisStudioTab.tsx`, `src/aris/shell/__tests__/emptyModelHint.test.tsx` (create), possibly `src/app.css`

**Steps:**

- [ ] **Read first:** `git show main:src/editor/paletteDrag.ts` (351 lines — the port source) and `git show main:src/__tests__/paletteDrag.test.ts`; `src/aris/shell/ArisCanvasView.tsx` boot effect (lines ~150–185); `src/aris/shell/ArisStudioTab.tsx` canvas grid cell.
- [ ] Create `src/aris/shell/arisPaletteDrag.ts`: port the main file with the same exported pure helpers `clampPalettePos(pos, bounds)` / `parsePalettePos(raw)` and `installPaletteDrag(canvasContainer: HTMLElement): () => void`; `STORAGE_KEY = 'orbitpm.aris.palettePos'`; grip title `t('aris.palette.grip.title')` (registered by L2b); same `GRIP_CLASS 'orbitpm-palette-grip'` / dragging class; keep the MutationObserver fallback for late palette creation and the ResizeObserver clamp (both are in the tail of the main file). Verify the grip CSS exists: `grep -n orbitpm-palette-grip src/app.css` — if missing, copy the block from `git show main:src/app.css` into `src/app.css`.
- [ ] Create `src/aris/shell/arisPaletteDrag.test.ts`: port the main test (pure helpers only, node env).
- [ ] `src/aris/shell/ArisCanvasView.tsx`: inside the boot effect, after `handlersRef.current.onReady?.(canvas)`, call `const uninstallDrag = installPaletteDrag(container)` and add `uninstallDrag()` to the cleanup. No dependency-array changes (module-level function identity).
- [ ] `src/aris/shell/ArisStudioTab.tsx`: empty-model hint — derive `const activeModelIsEmpty = ((history.document ?? studio.source).models.get(renderableModelId ?? '')?.occurrences.length ?? -1) === 0`; wrap `ArisCanvasView` in a `position: relative` div; render an absolutely positioned dismissible card (`insetInlineStart: 76px; top: 16px; maxWidth: 340px`; panel bg + border + radius; `data-orbitpm-aris-empty-hint=""`) with `t('aris.canvas.emptyModelHint')` and a dismiss button `t('aris.canvas.emptyModelHint.dismiss')`; dismiss = session `useState` (reappears per tab mount only); hidden when `activeModelIsEmpty` is false (disappears live when the first shape lands — `history` republish). The card must not intercept canvas events outside its own box.
- [ ] Create `src/aris/shell/__tests__/emptyModelHint.test.tsx` (jsdom + geometry shim): blank studio doc (via `buildBlankArisAml` + `createArisXmlSourcePackage` + `buildArisStudioDocument`) ⇒ hint visible; a populated fixture doc ⇒ hint absent.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/shell
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L5c — Translate controller + toolbar + auto-translate

**Wave:** 4 · **Worker:** opus-4.8-1M · **Depends on:** L5a, L5b, L3c · **Wave-4 owner of `src/ArisApp.tsx` and `src/aris/shell/ArisStudioTab.tsx`**
**Files owned:** `src/aris/shell/ArisTranslateController.tsx` (create), `src/aris/shell/arisTranslateController.test.tsx` (create), `src/aris/shell/ArisStudioTab.tsx`, `src/ArisApp.tsx`

**Goal:** the per-diagram translation feature — content-language toggle button, Translate action feeding the surviving `TranslationReviewDialog`, missing-translation badge, and the **silent auto-translate** for created models. UX decisions (locked): created tabs (`sourceKind === 'generated'`) auto-fill the missing language via the free chain with NO dialog (toast + one undo + pref opt-out, ≤200 items, silent degrade on failure); opened/imported files never auto-send — badge → review dialog (that dialog IS the consent surface); AI provider is never auto-selected.

**Steps:**

- [ ] **Read first:** `main:src/App.tsx` via `git show` — `openTranslationReview` 8953–9046 (skeleton to simplify), provider options 1419–1438, free-run 10120–10140; `src/localization/TranslationReviewDialog.tsx` props (review/providers/disclosure/onTranslateNow/onRetryField/onManualEdit/accept flow — all 160 `translationReview.*` keys already exist in both dictionaries); `src/ai/freeTranslate.ts` (`makeFreeTranslateTexts`, `FreeTranslateError`); `src/ai/browserAi.ts` `makeBrowserCallLLM` exact signature (~line 827); `src/ai/translate.ts` `buildTranslationExternalReview` (~463); `src/localization/workspaceStore.ts` (glossary/TM load + append, `.orbitpm/i18n/*` paths); `src/ai/keys.ts` `getPref`/`setPref` (~1195/1205) + `hasKey` + `getKey`; `src/localization/translationRecovery.ts` (`validateTranslationRecoveryValue`); Lane L5b's `src/aris/localization/index.ts`.
- [ ] Create `src/aris/shell/ArisTranslateController.tsx`:

  ```ts
  export interface ArisTranslateControllerHandle {
    openReview(target?: 'en' | 'ar'): void
  }
  export interface ArisTranslateControllerProps {
    readonly getCanvas: () => ArisCanvas | null
    readonly liveDocument: ArisWorkingDocument
    readonly contentLang: 'en' | 'ar'
    readonly documentName: string
    readonly autoTranslateEligible: boolean // sourceKind === 'generated'
    readonly resources: LocalizationResources | null // null ⇒ SEEDED_GLOSSARY + empty TM
    readonly onAcceptedPair?: (pair: { en: string; ar: string }) => void
    readonly onToast: (message: string, tone?: 'info' | 'error' | 'success') => void
  }
  ```

  Behavior: `openReview(target = contentLang === 'en' ? 'ar' : 'en')` → `buildArisLocalizationReview({document: liveDocument, target, active: contentLang, resources})` → if `review.complete` → toast `tk('aris.translate.nothingMissing', 'Every label already has both languages.')` → else mount `TranslationReviewDialog` with providers = (`getProviderSelection()` and `hasKey(sel.providerId)` ? `[{ id: 'selected-ai', label: `${providerLabel} · ${modelId}` }]` : `[]`) plus always `{ id: 'free', label: 'Google Translate → MyMemory' }`; disclosure via `buildTranslationExternalReview(review, {providerId, kind})`. `onTranslateNow`: `'free'` → `makeFreeTranslateTexts({signal})`; `'selected-ai'` → `makeArisAiTranslateTexts(makeBrowserCallLLM(...))`. Run `runArisReviewedTranslation` → proposals; per-field retry re-runs a single-item queue; manual edit validated via `validateTranslationRecoveryValue`. Accept/apply: accepted proposals + `review.localUpdates` → `toArisTranslationUpdates(patches, owners)` → `applyArisTranslations(canvas, updates, tk('aris.translate.gestureLabel', 'Translate labels'))` → toast `tk('aris.translate.applied', 'Applied {count} translations as one undoable step.', {count})`; each accepted provider/manual pair → `onAcceptedPair` (TM persistence). Staleness: before apply, rebuild the extraction and compare `sourceSignature`; mismatch → toast `tk('aris.translate.stale', 'The model changed during review — the list was refreshed.')` + refresh the dialog.

- [ ] Auto-run effect in the controller: when `autoTranslateEligible && getPref('arisAutoTranslate') !== 'off' && !ranRef.current && getCanvas()` — set `ranRef`; build the review; empty queue ⇒ done; `queue.length > 200` ⇒ badge only; else apply `localUpdates`, run the FREE chain, apply everything as one gesture **with no dialog**; toast `tk('aris.translate.autoDone', 'Translated {count} labels automatically — Undo reverts, review from the toolbar.', {count})`; on any `FreeTranslateError` stay silent (the badge remains the entry point).
- [ ] `src/aris/shell/ArisStudioTab.tsx`: props add `readonly sourceKind: string`, `readonly localizationResources: LocalizationResources | null`, `readonly onAcceptedTranslationPair?: (pair: { en: string; ar: string }) => void`. State `contentLangOverride: 'en' | 'ar' | null`; `const contentLang = contentLangOverride ?? lang` (**follows the app language by default**); `const [canvasTick, setCanvasTick] = useState(0)` bumped inside the existing `onReady` handler; effect on `[contentLang, canvasTick]` → `canvasRef.current?.setContentLanguage(contentLang)`. Toolbar (insert after the Reset-layout button, before the layout-mode chip): `<button data-orbitpm-aris-content-lang={contentLang} title={tk('aris.toolbar.contentLang.title', 'Switch the diagram labels between English and Arabic (view only, no edit)')} onClick={() => setContentLangOverride(contentLang === 'en' ? 'ar' : 'en')}>{tk('aris.toolbar.contentLang', 'Labels: {language}', { language: t(contentLang === 'en' ? 'app.lang.en' : 'app.lang.ar') })}</button>`; `<button data-orbitpm-aris-translate onClick={() => translateRef.current?.openReview()}>{tk('aris.toolbar.translate', 'Translate…')}</button>` with badge `<span data-orbitpm-aris-translate-missing={n}>{tk('aris.toolbar.translate.missing', '{count} untranslated', {count: n})}</span>` when `countArisMissingTranslations(liveDocument)` > 0 (memoized on `liveDocument`). Mount `<ArisTranslateController ref={translateRef} …/>` next to the rails (renders only its dialog).
- [ ] `src/ArisApp.tsx` (ONLY these two regions): (a) the StudioTab render block — pass `sourceKind={tab.sourceKind}`, `localizationResources`, `onAcceptedTranslationPair={handleAcceptedTranslationPair}`; (b) near the adapter-binding effect — load `localizationResources` state from `.orbitpm/i18n/glossary.json` + `translation-memory.json` via `src/localization/workspaceStore.ts` loaders when a multi-file adapter binds (absence tolerated → null; single-file → null); `handleAcceptedTranslationPair` = fire-and-forget TM append via the same store (failure → toast only).
- [ ] tk() keys used (registered by X1 — use these EXACT keys + fallbacks): `aris.toolbar.contentLang`, `aris.toolbar.contentLang.title`, `aris.toolbar.translate`, `aris.toolbar.translate.missing`, `aris.translate.nothingMissing`, `aris.translate.applied`, `aris.translate.autoDone`, `aris.translate.autoOff` ('Automatic translation of new models'), `aris.translate.stale`, `aris.translate.gestureLabel`.
- [ ] Create `src/aris/shell/arisTranslateController.test.tsx` (jsdom): dialog opens with the free provider always and the AI provider only with a stored key (`resetSessionKeysForTests`/`setKey`); a TM pair applies with **zero fetches**; an injected `translateTexts` stub → proposals → accept → exactly ONE bridge gesture + toast; the auto-run fires exactly once for `sourceKind='generated'`, never for `'aml'`, never when the pref is off; a whole-chain `FreeTranslateError` degrades silently (badge logic still shows).
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/shell src/aris/localization
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L2d — "New model" wiring

**Wave:** 5 · **Worker:** opus-4.8-1M · **Depends on:** L2a, L1c · **Wave-5 owner of `src/ArisApp.tsx`, `src/i18n/dictionaries.ts`, `src/ArisApp.test.tsx`**
**Files owned:** those three + `src/aris/shell/ArisNewModelDialog.tsx` (create)

**Steps:**

- [ ] **Read first:** `src/workspace/MoveDialog.tsx` (the Modal + footer pattern to copy), `src/workspace/WorkspacePickerLite.tsx` (`onNewProcess`/`onNewDiagram` props), `src/ArisApp.tsx` lines ~740–800 (picker phase + placeholder toasts at ~766–767) and `handleCreateModel` (~555), `src/aris/shell/arisPackageImport.ts` (~101, `SingleFileWorkspaceAdapter` constructor shape), `openImportedBytes` (~350).
- [ ] Create `src/aris/shell/ArisNewModelDialog.tsx`: props `{ open: boolean; folderRel: string | null; lang: 'en' | 'ar'; onCreate(spec: { name: string; modelType: 'MT_EEPC' | 'MT_VAL_ADD_CHN_DGM' }): void; onCancel(): void }`. Fields: name input (initial `t('aris.newModel.nameInitial')`, autofocus + select-all), model-type `<select>` (`aris.newModel.type.epc` default / `aris.newModel.type.vacd`), hint line `t(folderRel === null ? 'aris.newModel.hint.fallback' : 'aris.newModel.hint.directory')`, footer Cancel + Create (`aris.newModel.create`, disabled on empty trimmed name). Root carries `data-orbitpm-aris-new-model=""`.
- [ ] `src/ArisApp.tsx`: state `const [newModelRequest, setNewModelRequest] = useState<{ folderRel: string | null } | null>(null)`. Replace L1c's stub body: `onNewModel: (folderRel) => setNewModelRequest({ folderRel: multiFile ? folderRel : null })`. Implement `handleCreateBlankModel({ name, modelType })`:
  - [ ] Build `const { xml } = buildBlankArisAml({ names: { [lang]: name }, modelType })` (name lands under the active UI language's locale).
  - [ ] **Multi-file + folder target** (`newModelRequest.folderRel !== null`): `bytes = new TextEncoder().encode(xml)`; `path = uniquePathIn(new Set(workspaceEntries.map(e => e.path)), folderRel, deriveArisSourceFileName(name))`; `const outcome = await workspaceAdapter.writeAtomic(path, bytes, undefined, { expectedMissing: true })`; failure → toast `t('aris.newModel.failed', { error })` and return; `await refreshWorkspaceSources(workspaceAdapter)`; `await handleOpenWorkspaceFile(path)`; toast `t('aris.newModel.created', { name: path }, 'success')`.
  - [ ] **Ready but single-file** (`folderRel === null`, workspace bound): `await handleCreateModel({ name, xml })` — virtual generated tab; persist later via the toolbar "Import into workspace…".
  - [ ] **Picker phase** (no workspace yet): `const fileName = deriveArisSourceFileName(name)`; `const adapter = new SingleFileWorkspaceAdapter({ path: fileName, bytes, workspaceId: 'aris-new:' + fileName })`; `await activateAdapter(adapter)`; `await openImportedBytes(fileName, fileName, bytes)`.
  - [ ] Render `<ArisNewModelDialog …/>` in **both** the pre-ready and ready returns (next to `SettingsDialogLite`).
  - [ ] `WorkspacePickerLite`: wire `onNewProcess` and `onNewDiagram` to `setNewModelRequest({ folderRel: null })` — delete the two placeholder toasts (leave the old `aris.placeholder.new*Unavailable` keys in the dictionary; removing keys is churn).
- [ ] `src/i18n/dictionaries.ts` — add to BOTH maps:

  | Key                            | en                                                                                            | ar                                                                        |
  | ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | `aris.newModel.title`          | New ARIS model                                                                                | نموذج ARIS جديد                                                           |
  | `aris.newModel.nameLabel`      | Model name                                                                                    | اسم النموذج                                                               |
  | `aris.newModel.nameInitial`    | New model                                                                                     | نموذج جديد                                                                |
  | `aris.newModel.create`         | Create model                                                                                  | إنشاء النموذج                                                             |
  | `aris.newModel.type`           | Model type                                                                                    | نوع النموذج                                                               |
  | `aris.newModel.type.epc`       | EPC (event-driven process chain)                                                              | سلسلة عمليات مقادة بالأحداث (EPC)                                         |
  | `aris.newModel.type.vacd`      | Value-added chain diagram                                                                     | مخطط سلسلة القيمة المضافة                                                 |
  | `aris.newModel.hint.directory` | A new .aml source file is created in the selected folder and opened for drawing immediately.  | يُنشأ ملف مصدر ‎.aml جديد في المجلد المحدد ويُفتح للرسم فورًا.            |
  | `aris.newModel.hint.fallback`  | The model opens as an in-memory tab; use "Import into workspace…" to store it in a workspace. | يُفتح النموذج كتبويب في الذاكرة؛ استخدم "استيراد إلى مساحة العمل…" لحفظه. |
  | `aris.newModel.created`        | Created {name}.                                                                               | تم إنشاء {name}.                                                          |
  | `aris.newModel.failed`         | Could not create the model: {error}                                                           | تعذّر إنشاء النموذج: {error}                                              |

  Value updates to EXISTING keys (both languages): `emptyWorkspace.heading` → `No models yet` / `لا توجد نماذج بعد`; `emptyWorkspace.createFirst` → `＋ Create your first model` / `＋ أنشئ نموذجك الأول`; `emptyWorkspace.explain` → `Create a blank EPC or value-added chain model in {folderName}, or import ARIS AML/XML exports.` / `أنشئ نموذج EPC أو سلسلة قيمة مضافة فارغًا في {folderName}، أو استورد ملفات ARIS AML/XML.`.

- [ ] Update `src/ArisApp.test.tsx`: directory mode — extend `makeDirectoryAdapter` with an in-memory write store (`writeAtomic` records bytes and serves them via `read`/`list`); click chrome `＋ New model` → dialog → name 'Intake' → Create ⇒ assert `writeAtomic('intake.aml', …, undefined, { expectedMissing: true })`, the tree gains row `intake.aml`, a tab opens, the canvas mounts, and `[data-orbitpm-aris-empty-hint]` is visible. Picker phase (default mock state): `＋ New model` → Create ⇒ tab `intake.aml` opens with canvas. Collision: seed `intake.aml` ⇒ second create writes `intake-2.aml`.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/ArisApp.test.tsx src/aris/shell src/__tests__/i18n.test.ts
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane L5d — Fix-missing components

**Wave:** 6 · **Worker:** opus-4.8-1M · **Depends on:** L5b, L5c, L3d · **Wave-6 owner of `src/aris/shell/ArisStudioTab.tsx` + one line in `src/ArisApp.tsx`**
**Files owned:** `src/aris/chat/deterministicFixes.ts` (create), `src/aris/chat/deterministicFixes.test.ts` (create), `src/aris/shell/ArisFixMissingDialog.tsx` (create), `src/aris/shell/ArisStudioTab.tsx`, `src/ArisApp.tsx` (single line)

**Goal:** the "N issues — Fix…" toolbar badge + three-tier fix dialog. Tier A = safe translation fills (auto, one click); Tier B = deterministic structural proposals, confirm-gated with before/after preview; Tier C = routes into the chat drawer's interview tab.

**Steps:**

- [ ] **Read first:** `src/aris/chat/gapScanner.ts` (the 15 gap kinds + `ArisChatGap` shape), `src/aris/chat/classification.ts` (`AUTOMATIC_COMMAND_KINDS`, `TOPOLOGY_COMMAND_KINDS`, `DESTRUCTIVE_COMMAND_KINDS`), `src/aris/chat/patchSchema.ts` (`ArisChatCommand` kinds incl. `addCoreObject`/`addCoreConnection`/`deleteDefinition`/`deleteOccurrence`/`deleteConnection`), **`src/aris/chat/modelCommandMapping.ts` `toArisEditCommands` for `addCoreObject`** (does it synthesize bounds? if not, the dialog copy shows the Clean-Layout hint), `src/aris/chat/applyEngine.ts` (`buildConfirmationPreview`), `src/aris/shell/arisChatHost.ts` (`scanArisGaps`, `applyArisChatCommandsAsGesture`), `src/aris/chat/locale.ts` (`hasEnglishName`/`hasArabicName`), the EPC graph helper used by the gap scanner (`toChatEpcGraph` or equivalent — find it in `gapScanner.ts` imports).
- [ ] Create `src/aris/chat/deterministicFixes.ts` (with a doc-comment table splitting all 15 gap kinds into tiers):

  ```ts
  export interface ArisDeterministicFixPlan {
    readonly translationFillTargets: readonly ArisChatGap[] // Tier A: counterpart language exists
    readonly confirmProposals: readonly {
      readonly gap: ArisChatGap
      readonly commands: readonly ArisChatCommand[]
      readonly labelKey: string
    }[] // Tier B
    readonly interviewGaps: readonly ArisChatGap[] // Tier C
  }
  export function buildDeterministicFixPlan(
    document: ArisWorkingDocument,
    gaps: readonly ArisChatGap[],
    locales: { readonly en: string; readonly ar: string }
  ): ArisDeterministicFixPlan
  ```

  Tier split (implement exactly): `missingEnglishName`/`missingArabicName` → Tier A when the resolved definition/model has the counterpart language (`hasEnglishName`/`hasArabicName`), else Tier C. `missingStartOrEndEvent` → Tier B: propose `addCoreObject` (OT_EVT, event symbol, bilingual names — start: en 'Process started' / ar 'بدأت العملية'; end: en 'Process completed' / ar 'اكتملت العملية' — from the L2b-style key pair `aris.fix.startEvent.name`/`aris.fix.endEvent.name` resolved at build time) + `addCoreConnection` to/from the first/last function (connection type per the EPC adapter's expectations — copy from `src/aris/epc` fixtures). `unusedDefinition` → Tier B `deleteDefinition` (mirrors the `ARIS_CHAT_REMOVE_ANSWER` flow). `danglingObjectOrConnection` → Tier B `deleteOccurrence`/`deleteConnection` per target. Everything else (`missingProcessCode`, `missingOwner`, `missingInputsOutputsSystems`, `missingDecisionBasis`, `missingXorOutcomes`, `missingReturnTarget`, `invalidSequence`, `missingLinkedModel`, `missingAttachment`, `unaccountedSourceContent`) → Tier C. Placeholder ids (e.g. `'fix-start-event'`) — the gesture allocator maps them to real ids.

- [ ] Create `src/aris/shell/ArisFixMissingDialog.tsx`: `Modal`-based; props `{ open, document, plan: ArisDeterministicFixPlan, busy, onAutoFix(): void, onApplySelected(commands: readonly ArisChatCommand[]): void, onOpenInterview(): void, onClose(): void }`. Three sections with counts: Tier A (`tk('aris.fix.autoSection', 'Fill automatically (safe)')` + one button invoking `onAutoFix`), Tier B (`tk('aris.fix.confirmSection', 'Proposed changes needing confirmation')` — checkbox per proposal + `buildConfirmationPreview` before/after rows, pattern from the old rail's confirm section; apply button), Tier C (`tk('aris.fix.interviewSection', 'Needs your answers')` + gap list + button `tk('aris.fix.openInterview', 'Answer questions…')` → `onOpenInterview`). If `addCoreObject` has no bounds synthesis, show `tk('aris.fix.cleanLayoutHint', 'New elements are placed automatically — run Clean Layout afterwards.')`. `data-orbitpm-aris-fix-*` attributes on every actionable control.
- [ ] `src/aris/shell/ArisStudioTab.tsx`: `const gaps = useMemo(() => scanArisGaps(liveDocument), [liveDocument])`; toolbar badge-button `data-orbitpm-aris-fix-issues={gaps.length}` labeled `tk('aris.fix.badge', '{count} issues — Fix…', { count: gaps.length })` (hidden at 0) → opens the dialog with `buildDeterministicFixPlan(liveDocument, gaps, locales)`. Wire: `onAutoFix` → the translate controller's fill path (`translateRef.current?.openReview()` or the direct free-run for the fill targets); `onApplySelected` → `applyArisChatCommandsAsGesture(canvas, commands, tk('aris.fix.gestureLabel', 'Fix missing components'))` + toast `tk('aris.fix.applied', 'Applied {count} fixes as one undoable step.', {count})` + rescan; `onOpenInterview` → new prop `readonly onOpenInterview?: () => void`.
- [ ] `src/ArisApp.tsx` (**one line**): in the StudioTab render block pass `onOpenInterview={handleContinueInChat}` — Tier C lands in the chat drawer's interview tab for the active tab.
- [ ] tk() keys used (registered by X1): `aris.fix.badge`, `aris.fix.title` ('Fix missing components'), `aris.fix.autoSection`, `aris.fix.confirmSection`, `aris.fix.interviewSection`, `aris.fix.openInterview`, `aris.fix.applied`, `aris.fix.gestureLabel`, `aris.fix.startEvent.name`, `aris.fix.endEvent.name`, `aris.fix.cleanLayoutHint`.
- [ ] Create `src/aris/chat/deterministicFixes.test.ts`: **classification invariant** — every Tier-A fill maps to a kind in `AUTOMATIC_COMMAND_KINDS`; every Tier-B command kind ∈ `TOPOLOGY_COMMAND_KINDS ∪ DESTRUCTIVE_COMMAND_KINDS` (imported from `classification.ts` so policy can never drift silently); **idempotence** — apply the start/end proposal on a fixture missing both → rescan → `missingStartOrEndEvent` gone and a second plan proposes nothing; delete proposals resolve `unusedDefinition`/dangling gaps; translation-fill partition correctness (counterpart present vs absent); every proposal passes patch-schema validation. Plus a jsdom dialog test: sections render per plan; apply = a single gesture; zero network.
- [ ] Run prettier.

**Verify:**

```bash
npx vitest run src/aris/chat src/aris/shell
npm run typecheck && npm run lint && npm run check:ui-copy && npm run check:aris-runtime-boundary
```

---

## Lane X1 — i18n registration sweep

**Wave:** 7 · **Worker:** sonnet-med · **Depends on:** L3b, L3d, L5c, L5d · **Sole owner of `src/aris/shell/shellI18n.ts` + `src/i18n/dictionaries.ts`**

**Steps:**

- [ ] Sweep for every `tk()` key in the new/changed files:

  ```bash
  grep -rhoP "tk\('\K[^']+" src/aris/shell/ArisChatDrawer.tsx src/ArisGenerationPanel.tsx \
    src/aris/shell/ArisTranslateController.tsx src/aris/shell/ArisFixMissingDialog.tsx \
    src/aris/shell/ArisStudioTab.tsx src/aris/shell/arisChatDrawerSession.ts | sort -u
  ```

- [ ] Register EVERY key found in `ARIS_SHELL_MESSAGE_KEYS` (`src/aris/shell/shellI18n.ts`, frozen map — insert alphabetically near the `aris.chat.*` block) with its English source text, AND add entries to BOTH `en`/`ar` maps of `src/i18n/dictionaries.ts`. The expected set (verify against the sweep; the English values are the `tk()` fallbacks already in code — Arabic values as follows, proper MSA):
  - `aris.chatDrawer.interview.intro` → ar: `فحصت {name} ووجدت {count} فجوة. أجب عن ثلاثة أسئلة كحدّ أقصى في كل جولة؛ وتُطبَّق التغييرات الآمنة كخطوة واحدة قابلة للتراجع.`
  - `aris.chatDrawer.interview.noTarget` → ar: `افتح نموذج ARIS أولًا، ثم ابدأ مقابلة الإكمال.`
  - `aris.chatDrawer.interview.clean` → ar: `لا توجد فجوات — يبدو هذا النموذج مكتملًا.`
  - `aris.chatDrawer.interview.applied` → ar: `تم تطبيق {count} من التغييرات كخطوة واحدة قابلة للتراجع.`
  - `aris.chatDrawer.interview.roundLimit` → ar: `تم بلوغ حدّ الجولات (5 من 5). تبقى الفجوات المتبقية مدرجة لمقابلة جديدة.`
  - `aris.assistant.chip.unavailable` → ar: `هذا العنصر غير موجود في النماذج المفتوحة.`
  - `aris.toolbar.contentLang` → ar: `التسميات: {language}` · `aris.toolbar.contentLang.title` → ar: `تبديل تسميات المخطط بين الإنجليزية والعربية (عرض فقط دون تعديل)`
  - `aris.toolbar.translate` → ar: `ترجمة…` · `aris.toolbar.translate.missing` → ar: `{count} بدون ترجمة`
  - `aris.translate.nothingMissing` → ar: `كل التسميات تحمل اللغتين بالفعل.` · `aris.translate.applied` → ar: `تم تطبيق {count} ترجمة كخطوة واحدة قابلة للتراجع.` · `aris.translate.autoDone` → ar: `تمت ترجمة {count} تسمية تلقائيًا — تراجع واحد يستعيدها، ويمكن المراجعة من شريط الأدوات.` · `aris.translate.autoOff` → ar: `الترجمة التلقائية للنماذج الجديدة` · `aris.translate.stale` → ar: `تغيّر النموذج أثناء المراجعة — تم تحديث القائمة.` · `aris.translate.gestureLabel` → ar: `ترجمة التسميات`
  - `aris.fix.badge` → ar: `{count} ملاحظة — إصلاح…` · `aris.fix.title` → ar: `إصلاح المكوّنات الناقصة` · `aris.fix.autoSection` → ar: `تعبئة تلقائية (آمنة)` · `aris.fix.confirmSection` → ar: `تغييرات مقترحة تتطلب تأكيدًا` · `aris.fix.interviewSection` → ar: `تتطلب إجاباتك` · `aris.fix.openInterview` → ar: `الإجابة عن الأسئلة…` · `aris.fix.applied` → ar: `تم تطبيق {count} إصلاحًا كخطوة واحدة قابلة للتراجع.` · `aris.fix.gestureLabel` → ar: `إصلاح المكوّنات الناقصة` · `aris.fix.startEvent.name` → ar: `بدأت العملية` · `aris.fix.endEvent.name` → ar: `اكتملت العملية` · `aris.fix.cleanLayoutHint` → ar: `تُوضع العناصر الجديدة تلقائيًا — شغّل التخطيط النظيف بعد ذلك.`
  - Any additional keys the sweep surfaces: register them with the English fallback found in code + a faithful MSA Arabic translation.
- [ ] Update **`aris.ai.body`** in both maps: EN `Generate a native ARIS model — an EPC or a value-added chain diagram — from a plain-language description, a document, or the Excel template.` AR `أنشئ نموذج ARIS أصليًا — مخطط EPC أو مخطط سلسلة القيمة المضافة — من وصف بلغة عادية أو من مستند أو من قالب Excel.` (L3d's updated test asserts the new EN string.)
- [ ] Run prettier on both files.

**Verify:**

```bash
npx vitest run src/__tests__/i18n.test.ts
npm run check:ui-copy && npm run typecheck
```

---

## Lane X2 — Existing e2e suite updates

**Wave:** 8 · **Worker:** opus-4.8-1M · **Depends on:** everything through X1
**Files owned:** `tests/e2e/lite-mandatory-ai-security.spec.ts`, `tests/e2e/lite-providers.spec.ts`, `tests/e2e/aris-authoring.spec.ts`, `tests/e2e/aris-accessibility.spec.ts`, `tests/e2e/aris-release-artifact.spec.ts`, `tests/e2e/aris-i18n-rtl.spec.ts`

All edits below implement the authorized product changes — do not "restore" removed UI to satisfy old assertions.

**Steps:**

- [ ] `lite-mandatory-ai-security.spec.ts`: helper `prepareArisGeneration` (~355–370) — delete the preview-open + consent lines; `generateAndConsent` (~372–381) → rename `prepareGeneration`, keep `await expect(submit).toBeEnabled()`. Privacy test (~583): retitle (drop "consent-reviewed"); replace the two preview `innerText` assertion blocks (~639–647) with the same assertions run against the CAPTURED outbound request bodies (`chatBodies`): fence markers present, the `Never emit a real ARIS source id` sentence present, the adversarial text present with the attachment and absent after `-attachment-clear`; delete the consent re-checks (~648, ~672–675) — just re-submit. Consent-collision test (~781): preamble becomes the drawer flow — open Assistant, fill `[data-orbitpm-aris-assistant-question]`, click the `Send` button (was 'Ask'); everything from `[data-orbitpm-aris-assistant-ai]` onward is UNCHANGED (the consent card is reused). Cancellation test (~1022): drop preview/consent lines (~1126–1127 and inside the renamed helper); **the model pick `selectOption(VISION_MODEL)` (~1115) becomes `.fill(VISION_MODEL)`** (the OpenRouter model control is now input+datalist); assistant phase (~1160–1180): Ask→Send. Rewrite the stale header comments (lines ~25–28, 54) and the "no user-facing free-text model" comment block (~690–701) — free-text model IS now reachable; keep/extend the `checkArisAiAttachment` fails-closed gate test accordingly.
- [ ] `lite-providers.spec.ts`: test ~173 retitle; delete the preview block (~271–281) — instead assert the outbound `chatRequests[0]` body contains `'Model name: Consent path'`, the description, and the security sentence; delete the disabled/consent dance (~283–286) — submit is enabled immediately after fill; PDF test (~354–365) drop the consent line; update the stale "no model picker" note (~177–181).
- [ ] `aris-authoring.spec.ts`: `completeSafeFields` (~288–326) + the two rail tests (~328–352) get the drawer preamble — `await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click()`, `const drawer = page.getByRole('dialog', { name: 'Process assistant', exact: true })`, `await drawer.getByRole('tab', { name: 'Complete this process' }).click()`, `const rail = drawer.locator('[data-orbitpm-aris-chat]')` — rest unchanged (incl. `data-orbitpm-aris-chat-undo`). Assistant test (~353–401): replace fill+Ask with the suggestion-button click OR textarea+Send; chips/close/selection + zero-network assertions unchanged. ADD assertions: palette labels rendered (`.aris-palette-entry__label` count ≥ 15) and the grip exists (`.orbitpm-palette-grip`).
- [ ] `aris-accessibility.spec.ts` (~98–131) and `aris-release-artifact.spec.ts` (~130–168): expected to pass unchanged (dialog name, 'Close assistant' label, focus trap/restore preserved) — run and confirm; adjust only if a stale double-close `.last()` assumption surfaces (the drawer has a single × close).
- [ ] `aris-i18n-rtl.spec.ts` (~112–300): append to test 2 — after switching the app language to Arabic, assert canvas _label text_ changes (content follows app language) while the existing relX/relY geometry checks still pass (canvas geometry stays unmirrored).
- [ ] Run prettier on touched specs.

**Verify:**

```bash
npm run clean:dist && npm run build
npx playwright test tests/e2e/lite-mandatory-ai-security.spec.ts tests/e2e/lite-providers.spec.ts \
  tests/e2e/aris-authoring.spec.ts tests/e2e/aris-accessibility.spec.ts \
  tests/e2e/aris-release-artifact.spec.ts tests/e2e/aris-i18n-rtl.spec.ts
```

---

## Lane X3 — New e2e specs

**Wave:** 8 · **Worker:** kimi-k2.7 · **Depends on:** everything through X1
**Files owned:** `tests/e2e/aris-explorer-tree.spec.ts` (create), `tests/e2e/aris-new-model.spec.ts` (create), `tests/e2e/lite-mandatory-translation.spec.ts` (sole owner)

**Steps:**

- [ ] Create `tests/e2e/aris-explorer-tree.spec.ts` — loopback-HTTP + OPFS harness (copy from `tests/e2e/lite-mandatory-reliability.spec.ts` ~130–190; real OPFS refuses `file://`). Flow: picker → Browser workspace (OPFS; find the button via its dictionary label — grep the `picker.` keys) → `EmptyWorkspaceCard` visible → `＋ Create your first model` → dialog → name → canvas opens with the hint → the tree shows the file row (`[role="treeitem"]`) → `📁＋` new folder 'Archive' → row action `⤴` Move → `MoveDialog` → destination Archive → expand folder, file inside → row action `✎` rename → row action `🗑` delete file (confirm) → `EmptyWorkspaceCard` returns. Keyboard: focus a row, ArrowDown/ArrowRight/Enter navigate; `Shift+F10` opens the context menu (menuitem roles).
- [ ] Create `tests/e2e/aris-new-model.spec.ts` — `file://` fallback harness (pattern from `aris-authoring.spec.ts:63-80` WITHOUT `setInputFiles`): picker `＋ New model` → EPC → canvas mounts; palette `[data-action="create.ot_func"]` click → canvas click → exactly one `[data-element-id^="ObjOcc."]` exists and `[data-orbitpm-aris-empty-hint]` disappears; focus the canvas, `Control+Z` → occurrence gone; redo via the toolbar button; details-rail rename works; grip drag 60px → the palette's `style.left` changes and persists across reload (localStorage `orbitpm.aris.palettePos`).
- [ ] `tests/e2e/lite-mandatory-translation.spec.ts`: rename helper `consentAndSubmit` (~374–379) → `submitGeneration` (submit only, no consent); TR6 rail test (~925+) gets the drawer preamble (open Assistant → tab 'Complete this process' → `[data-orbitpm-aris-chat]` inside the dialog); **update the header inventory comments (lines ~62–86)** — the "CONFIRMED DEAD" claims about `TranslationReviewDialog`, the Translate button, Google/MyMemory calls, and `.orbitpm/i18n` are now ALIVE (keep the file's grounding-comment style). New tests using the `BILINGUAL_MATRIX_AML` fixture (~113–216) + boot helpers (~230–260):
  1. **Content toggle**: open the matrix → click `[data-orbitpm-aris-content-lang]` → canvas `text` nodes show the Arabic strings (e.g. `تم استلام الطلب`); the en-only element still shows its English text (fallback, never blank); `[data-orbitpm-aris-undo]` stays **disabled** (zero-undo contract); toggle back restores English; ALSO switching the app header language to Arabic flips labels (default-follow behavior).
  2. **Translate review (free, offline-stubbed)**: `page.route` both `https://translate.googleapis.com/*` and `https://api.mymemory.translated.net/*` with canned JSON → click `[data-orbitpm-aris-translate]` → dialog lists 'Google Translate → MyMemory' → Translate now → proposals appear → accept → apply → toggling to Arabic shows the stubbed value; ONE undo reverts everything.
  3. **Auto-translate on create**: stub the endpoints; drive the AI/Excel create path (existing helpers ~609) to open a generated tab ⇒ the toast `Translated … automatically` appears with **no dialog**; undo is enabled; with the pref off via an init script (`localStorage` `orbitpm.lite.cfg.`-prefixed key — read `getPref` to get the exact key format) ⇒ zero translate fetches and the badge `[data-orbitpm-aris-translate-missing]` is visible instead.
  4. **Fix flow**: open the reference export (`openReferenceExport` helper — real AnimalWF, skipped when the private fixture is absent) → `[data-orbitpm-aris-fix-issues]` shows a count → dialog sections render → tick + apply one delete proposal ⇒ the count drops; one undo restores it.
- [ ] Run prettier on the three specs.

**Verify:**

```bash
npm run build
npx playwright test tests/e2e/aris-explorer-tree.spec.ts tests/e2e/aris-new-model.spec.ts tests/e2e/lite-mandatory-translation.spec.ts
```

---

## Wave 9 — Final verification & ship (orchestrator + sonnet-med doc lane)

- [ ] Full suite:

  ```bash
  npm run format:check && npm run lint && npm run typecheck \
    && npm run check:aris-runtime-boundary && npm run check:ui-copy \
    && npm run check:no-skips && npm run check:lite-only \
    && npm test && npm run test:e2e \
    && npm run build:aris && npm run check:aris-studio-artifact && npm run check:size
  ```

- [ ] Sonnet doc lane: tick every remaining checkbox in this file; fill the "Resolution evidence" section below (one entry per issue with the command/test that proves it).
- [ ] Orchestrator: final commit (with fresh artifact) + push + final report per `goal.md`.

---

## Risk appendix

1. **Single-owner-per-wave** file map (§Wave schedule) is binding. A lane touching an unowned file = STOP + report.
2. **`hidden`, never unmount**, for the collapsed generation panel (in-flight requests must survive).
3. **`tab.key` preservation**: rename/move remap `relPath`/`title` only; reopen dedupes by `relPath`. A key change remounts the canvas and silently destroys undo history.
4. **Playwright model control**: OpenRouter model picker is now input+datalist — `fill()`, not `selectOption()`.
5. **Sanctioned `exhaustive-deps` suppressions** (the ONLY two): the drawer's `interviewRequest` token effect (transcribed from main) and the pre-existing `selectionRequest` effect at `ArisStudioTab.tsx:359`.
6. **`check:no-skips` alias trap**: never name helpers matching focused-test aliases (`fit*(` etc.) — precedent comment at `ArisStudioTab.tsx:483`.
7. **ui-copy allowlist** signatures are `file|kind|text` (line-number-free) — refactors are safe; deleting `ArisAssistantPanel.tsx`/`ArisChatImproveRail.tsx` is safe (no allowlist entries reference them).
8. **Interview freshness**: gap counts refresh on tab entry/start/round/undo — not on every canvas gesture (getter model). Documented behavior, matches main's step-boundary freshness.
9. **Single-file build size**: `npm run check:size` must pass; the TranslationReviewDialog adds ~40 KB — within budget, but do not add other heavy dependencies.
10. **Kimi lanes**: L1a, L2a, L1b, L3a, L5a, L3c, L2c, X3 are pre-assigned to the Kimi K2.7 Coding CLI. See `goal.md` for the invocation contract.

---

## Baseline record (Wave 0 fills this in)

- Baseline SHA: `e7b077d83b31b8f2fc99d03cb6493fb3c1d4315f` (plan-docs commit; product code identical to `1b89ce7`, the prior HEAD).
- Gate results at baseline (all run at HEAD, exit codes verbatim):
  - `npm run format:check` → EXIT 0 (All matched files use Prettier code style)
  - `npm run lint` → EXIT 0
  - `npm run typecheck` → EXIT 0
  - `npm run check:aris-runtime-boundary` → EXIT 0
  - `npm run check:ui-copy` → EXIT 0
  - `npm run check:no-skips` → EXIT 0
  - `npm run check:lite-only` → EXIT 0
  - `npm test` → EXIT 0 (314 test files passed; 4003 tests passed; zero runtime skips/todos/expected-failures/retries; duration ~98s)
  - **No pre-existing failures. Baseline is fully green — Wave 1 may proceed.**

## Resolution evidence (Wave 9 fills this in)

- Issue 1 (folder tree): _(pending)_
- Issue 2 (drawing/new model): _(pending)_
- Issue 3 (chatbot): _(pending)_
- Issue 4 (generate panel): _(pending)_
- Issue 5 (translation + fix): _(pending)_
