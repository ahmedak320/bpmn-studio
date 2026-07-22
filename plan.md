# OrbitPM Process Studio — Windows Desktop App (per-user, offline-first, AI-when-online)

## 1. Context

The server stack (SpiffArena + bpmn-assistant + bridge) is **built, verified, and paused** — Azure deployment deferred by Ahmed. New focus: a **Windows desktop app** that runs on his restricted work laptop. Proven constraints (via the Claude Desktop precedent): per-user GUI apps install and run **without admin**; anything needing admin/virtualization/services (Docker, WSL) is blocked; **no CLI**; outbound HTTPS works. Therefore: no Docker, no local servers, no terminal — a single per-user Electron app.

**Product**: "OrbitPM Process Studio" (working name) — draw BPMN 2.0 diagrams, organize them in folders, link processes via call activities with drill-down, and generate diagrams from text descriptions using AI **when online**. Files are standard `.bpmn` XML on disk (OneDrive-friendly; importable into SpiffArena/the future web version). Fully offline except AI.

**Decisions made by Ahmed (do not re-ask):** AI scope v1 = **generate only** (no chat-edit). Providers wired = seven (OpenAI, Anthropic, Moonshot/Kimi, DeepSeek, Gemini, Azure OpenAI, **GLM/Zhipu**); live-verified with his keys: **GLM 5.2, Kimi K3, DeepSeek, Azure OpenAI**. Distribution = **public GitHub repo + GitHub Releases with auto-update**. Signing = **unsigned first**; the first laptop install is the SmartScreen experiment (revisit Azure Trusted Signing if blocked).

## 2. Verified facts (researched — do not re-derive)

### 2a. The generation pipeline to port (from vendored bpmn-assistant, full spec in the E1 explore report)
- **IR**: `{"process": [elements]}`; order = flow (adjacency, no explicit flows). Types: 8 task kinds, `startEvent`/`endEvent`/`intermediateThrowEvent`/`intermediateCatchEvent` (+optional `eventDefinition`: timer|message), `exclusiveGateway`/`inclusiveGateway` (`label`, `has_join`, `branches:[{condition, path:[], next?}]`, inclusive adds `is_default`), `parallelGateway` (`branches` = array of arrays, join always synthesized). Recursion via `path`/`branches`. Branch `next` = loop-back jumps. Conditions are display labels only (never expressions).
- **Prompts**: `create_bpmn` = IR-spec text + 7 few-shot examples + full message history; JSON mode; max_tokens 3000. Retry = conversational repair: on validation failure, next user msg is `Error: <e>. Try again.` (max 3), model sees its own bad output.
- **Validation**: unique ids; exactly one top-level startEvent; ≥1 endEvent anywhere; per-type field checks; non-default inclusive branches need `condition`; exclusive gateway with all-empty branch paths rejected; parallel branch may not be empty; final smoke = run the transformer.
- **Transformer**: flattens IR → `{elements[], flows[]}`. ID conventions: join = `{gatewayId}-join`; flow id = `{sourceRef}-{targetRef}`; `definitions_1`/`Process_1`, `isExecutable="false"`. `has_join` synthesizes converging gateway; without it branches flow straight to the next element. Inclusive default branch → `default=` attr on gateway. **Known quirks**: (a) `add_flow` dedupes by (source,target) silently dropping a second branch's condition label — FIX in the port (suffix duplicate flow ids `-2`, keep both); (b) exclusive gateways never emit `default=` — keep as-is (IR has no field for it).
- **XML**: plain semantic BPMN 2.0 (bpmn2 namespaces declared, **no BPMNDI**). Layout is one call: `const { layoutProcess } = require('bpmn-auto-layout'); layoutedXml = await layoutProcess(xml)` — vendored-proven at **0.4.0** (pin that; upgrade experiment later). Result renders in bpmn-js `importXML`.
- **Python facade notes**: temperature is forced to 1 upstream (ignore/omit temperature); "structured_output" was decorative (just JSON mode) — the TS port upgrades to REAL schema-constrained output.

### 2b. Provider layer (Vercel AI SDK — verified July 2026)
First-party packages, all with Object Generation (structured output): `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/google` (Gemini), `@ai-sdk/deepseek`, `@ai-sdk/moonshot` (models incl. `kimi-k3`, `kimi-k2.5`, `kimi-k2-thinking`). **GLM/Zhipu**: no first-party package confirmed → wire via `@ai-sdk/openai-compatible` against Zhipu's OpenAI-compatible endpoint; verify exact base URL + model id (`glm-5.2`?) at implementation from Zhipu docs (bigmodel.cn / z.ai); if a community/first-party `zhipu` provider exists on npm, prefer it.
- Azure needs key + resource endpoint + deployment + api-version (mirror the four-var rule).
- **All LLM calls run in the Electron MAIN process** (keys never enter the renderer). Pass Electron's Chromium-stack fetch (`session.defaultSession.fetch` / `net.fetch`) as the AI SDK provider `fetch` option → system proxy/PAC honored (corporate-proxy compatibility).

### 2c. Packaging/distribution facts
- electron-builder NSIS: `oneClick: true` + `perMachine: false` = Claude-style per-user install into `%LOCALAPPDATA%\Programs`, **no admin**, Start-menu + desktop shortcuts, `.bpmn` fileAssociations registered per-user (HKCU). electron-updater with the GitHub provider auto-updates per-user from public Releases (unsigned OK — do NOT set `verifyUpdateCodeSignature`/publisherName).
- **Canonical Windows build = GitHub Actions `windows-latest` runner** (public repo → free minutes; no wine, signing-ready later). Fallback: local Docker `electronuserland/builder:wine`. Local Linux is for dev/tests only (Electron runs natively on Linux for development; the Windows exe cannot be executed here — verification is static checks + Ahmed's laptop).
- Repo strategy: the app lives in `~/Desktop/bpmn_tool/desktop/` as **its own git repo** (nested, added to the parent's `.gitignore` like `process_models/`), pushed to a **new public GitHub repo** (suggest `bpmn-studio` under Ahmed's account). Keeps the server monorepo private. `gh` CLI availability/auth checked at implementation; if unauthenticated, ask Ahmed to create the repo + grant push (one-time, or `gh auth login` via `!` command).

## 3. Architecture

```
desktop/                          (own git repo → public GitHub)
├─ package.json  electron.vite.config.ts  electron-builder.yml
├─ src/main/                      # Electron main: window mgmt, IPC, updater
│   ├─ index.ts                   # app lifecycle, single-instance, .bpmn file-open args
│   ├─ workspace.ts               # fs ops (scoped to workspace root), chokidar watch
│   ├─ ai.ts                      # generate IPC: providers → generateObject → pipeline
│   ├─ providers.ts               # 7-provider registry (AI SDK), custom fetch, Azure/GLM extras
│   ├─ secrets.ts                 # safeStorage (DPAPI per-user) key vault in userData
│   └─ updater.ts                 # electron-updater (GitHub provider)
├─ src/preload/index.ts           # contextBridge API (typed, minimal surface)
├─ src/renderer/                  # React + TS
│   ├─ App / layout (sidebar tree + tabbed editors + AI panel + settings modal)
│   ├─ editor/                    # bpmn-js Modeler + properties-panel + create-append-anything
│   │                             # save (Ctrl+S), dirty state, SVG/PNG export
│   ├─ tree/                      # folder tree: create/rename/delete files+folders, drag-move
│   ├─ ai/                        # AI panel: description, provider/model, target folder, name
│   └─ links/                     # call-activity: link picker + drill-down (open called process)
├─ src/gen/                       # THE PORT (pure TS, runs in main; unit-tested)
│   ├─ ir/schema.ts               # Zod schema of the IR (recursive union) — drives generateObject
│   ├─ ir/validate.ts             # §2a validation port
│   ├─ transform.ts               # §2a transformer port (+ dedup-flow fix)
│   ├─ xml.ts                     # semantic BPMN XML emitter (escaped, golden-tested)
│   ├─ layout.ts                  # bpmn-auto-layout@0.4.0 layoutProcess wrapper
│   ├─ prompts.ts                 # bpmn_representation + 7 examples → template literals
│   └─ generate.ts                # generateObject-first; fallback text+loose-parse; repair loop (max 3)
├─ resources/ (icons)  tests/unit (vitest)  tests/e2e (playwright-electron)
└─ .github/workflows/build.yml    # windows-latest: build NSIS + publish Release on tag
```

Key behaviors:
- **Workspace** = user-chosen root folder (first-run picker; suggest `Documents\Processes`; note OneDrive folders give sync/backup). All fs IPC is path-validated against the root (no traversal). Atomic saves (temp + rename) for OneDrive friendliness. chokidar refreshes the tree on external changes.
- **Process index**: scan workspace `.bpmn` for `<process id=` (regex + on-open moddle confirm) → map processId → file. Powers the call-activity link picker and double-click drill-down (callActivity → resolve `calledElement` → open that file in a tab; unresolved → toast with "create it?" hint).
- **AI generate flow**: renderer collects {description, providerModel, targetFolder, name} → IPC → main: `generateObject` (Zod IR) → validate → transform → xml → layoutProcess → write `{slug}.bpmn` (Windows-safe slug: lowercase, dash, strip reserved names CON/PRN/AUX/NUL/COM1-9/LPT1-9, dedupe with `-2`) → renderer opens it in a tab. Offline or no-key → panel disabled with clear hint. Errors: friendly message + details to a log file (userData/logs).
- **Security defaults**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for renderer; typed preload API only; keys only in main via safeStorage; no remote content loaded (CSP `default-src 'self'`).
- **Windows polish**: single-instance lock + open-file args (double-click `.bpmn` in Explorer opens a tab), dark mode via `nativeTheme`, high-DPI (default OK), app icon.

## 4. Execution model — MANDATORY agent delegation (unchanged mandate)

Same rules as the server build: **every task by delegated agents** — `sonnet-med` {model:'sonnet', effort:'medium'} for mechanical work, `opus-max` {model:'opus', effort:'max'} for complex code, integration, e2e, and all review. Parallel lanes with disjoint file ownership; one retry then orchestrator escalation; reports to scratchpad; STATUS.md ledger in `desktop/` appended each wave.

| Wave | Lanes (parallel) | Agent | Owns |
|---|---|---|---|
| A | A1 Scaffold: electron-vite+React+TS app boots on Linux; electron-builder.yml (nsis per-user, fileAssociations, publish:github placeholders); repo init + parent .gitignore entry; CI workflow skeleton | sonnet-med | whole `desktop/` skeleton |
| A | A2 **Early installability gate**: build a walking-skeleton Setup.exe (CI if repo ready, else Docker wine fallback) → pre-release → **Ahmed tries it on the laptop** (the unsigned/SmartScreen experiment) while later waves proceed | sonnet-med | CI, release v0.0.1-alpha |
| B | B1 Workspace: tree UI, file/folder CRUD, chokidar, atomic saves, path guards | sonnet-med | src/main/workspace, src/renderer/tree |
| B | B2 Editor: bpmn-js modeler + props panel + create-append-anything, tabs, dirty/save, SVG/PNG export | sonnet-med | src/renderer/editor |
| B | B3 **Pipeline port**: src/gen complete w/ vitest goldens — generate goldens by running the vendored Python transformer on the 7 example IRs (`uv run` against vendor/bpmn-assistant) and asserting TS output equivalence (modulo the documented dedup-fix) | opus-max | src/gen, tests/unit |
| B | B4 Providers+settings: 7-provider registry, safeStorage vault, settings UI, Azure 4-field + GLM endpoint/model config, custom fetch via Electron net | sonnet-med | src/main/providers+secrets, renderer settings |
| C | C1 AI integration: panel → IPC → generate.ts → file → open tab; generateObject w/ fallback+repair; offline/no-key handling; log file | opus-max | src/main/ai, src/renderer/ai, generate.ts glue |
| C | C2 Call-activity linking: index, picker, drill-down, unresolved UX | sonnet-med | src/renderer/links + index code |
| C | C3 Windows polish: file association open-path, single-instance, dark mode, icons, updater wiring + "check for updates" menu | sonnet-med | src/main/index+updater, resources |
| D | D1 E2E (playwright-electron, Linux): boot→pick workspace fixture→draw→save→reopen; AI path with a FAKE provider injected (deterministic IR) proving panel→file→tab; link drill-down; goldens green | opus-max | tests/e2e |
| D | D2 Release build: CI green on windows-latest → v0.1.0 pre-release (Setup.exe + latest.yml); static installer checks (per-user markers, no perMachine); README (install, folders, linking, AI keys incl. GLM/Kimi/DeepSeek/Azure setup, offline matrix, troubleshooting) | sonnet-med | CI, docs |
| E | E1 Review: security (IPC surface, path traversal, key handling, XSS in any HTML rendering, CSP), correctness of gen port vs §2a spec, updater config | opus-max | read-only |
| E | E2 Review: docs/config drift, builder config vs facts §2c, Windows edge list (reserved names, long paths, CRLF) | sonnet-med | read-only |
| F | Fix confirmed findings (tiered), re-run D1 + CI | mixed | per finding |
| G | **User gate (Ahmed)**: install v0.1.0 on the laptop; verify offline drawing/folders/linking; add GLM 5.2 / Kimi K3 / DeepSeek / Azure keys in Settings; live-generate with each; auto-update proof: publish v0.1.1, confirm in-app update. Orchestrator collects results, fixes fallout (wave F2 if needed), final report | — | — |

## 5. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Corporate policy blocks unsigned installer (SmartScreen/AppLocker) | A2 early gate ships a skeleton installer FIRST — fail fast before building everything; fallback = Azure Trusted Signing (~$10/mo, CI-integrated) |
| 2 | GLM 5.2 endpoint/model-id uncertainty | openai-compatible provider with configurable base URL + model id in Settings; verify from Zhipu docs at impl; worst case user-editable |
| 3 | generateObject struggles with the recursive IR schema on some providers | fallback path = JSON-mode text + loose-parse + conversational repair (the proven Python approach); per-provider flag |
| 4 | bpmn-auto-layout limits (no pools/collaborations, message flows) | IR never emits pools; known + accepted; pin 0.4.0 (vendored-proven), upgrade experiment later |
| 5 | Windows FS edges: reserved names, `:` in ids, long paths, CRLF | central slug/sanitize util + unit tests; paths via node path.win32-safe joins; test fixtures include nasty names |
| 6 | OneDrive sync conflicts / file locks | atomic write (tmp+rename), retry-on-EBUSY, chokidar refresh, "file changed on disk" prompt |
| 7 | Corporate proxy blocks AI endpoints | Electron net-stack fetch honors system proxy/PAC; per-provider reachability test button in Settings; Azure OpenAI most likely allowed |
| 8 | CI unavailable (repo/auth delay) | Docker electronuserland/builder:wine local fallback documented in CI file comments |
| 9 | Auto-update breaks (unsigned nuance / latest.yml) | never set publisherName/verify flags; G-wave two-version update proof is a DoD item |
| 10 | Cannot execute the .exe in this Linux env | dev+tests on Linux Electron; installer verified statically + by Ahmed (A2 + G gates) |

## 6. Verification / Definition of Done

- [ ] Vitest goldens: TS pipeline output equivalent to vendored Python transformer on all 7 example IRs (+ new cases: loop-back `next`, dedup-fix, nasty labels); validate.ts rejects each documented invalid case.
- [ ] Playwright-electron suite green on Linux: workspace CRUD, draw/save/reopen, fake-provider AI generate → rendered tab, call-activity drill-down.
- [ ] CI produces `OrbitPM-Process-Studio-Setup-x.y.z.exe` + `latest.yml` on windows-latest; installer static checks show per-user (no admin manifest, no perMachine).
- [ ] **Ahmed's laptop (wave G)**: installs without admin prompt; runs; full offline flow works; live AI generation succeeds with GLM 5.2, Kimi K3, DeepSeek, and Azure OpenAI keys entered in Settings; a generated file imports cleanly into SpiffArena on this desktop (cross-check); auto-update v0.1.0→v0.1.1 works in-app.
- [ ] E-wave reviews done; confirmed findings fixed; README complete; desktop/STATUS.md ledger current; project memory updated.

## 7. Out of scope (v1)

Chat-based editing of existing diagrams; local/offline LLMs; Azure/web deployment (paused); DMN/forms; multi-user sync (OneDrive folder sharing is the interim answer); code signing (pending A2 result); macOS/Linux packages (Windows only, per Ahmed).
