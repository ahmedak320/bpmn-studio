import { expect, test, webkit, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installReliabilityWorkspace } from './fixtures/reliability-fsa'
import { disableAutoTranslate } from './helpers/prefs'

// ---------------------------------------------------------------------------
// RETARGET RECORD — read this before touching the file again.
//
// This spec used to drive the deleted bpmn-js "OrbitPM Process Studio Lite"
// shell (commit 10b6d81, plan §5.3) through `src/App.tsx`'s directory/OPFS/
// single-file workspace, its per-file dirty-flag + Ctrl+S save pipeline
// (`src/sessions/*`, `src/workspace/dirtySave.ts`), its draft-recovery journal
// (IndexedDB `orbitpm-lite-document-sessions`), its `HistoryDialog` revision
// history, its rename/move/delete path transactions with dirty-tab gating,
// its external-edit conflict dialog, and its live catalog/search/duplicate-ID
// repair index. All 13 of its tests failed identically on the very first line
// (the boot assertion for a heading that no longer exists) before this retarget.
//
// Two independent things were verified by reading every relevant source file
// AND by driving the BUILT app live in a real browser (not assumed from the
// old titles):
//
// 1. THE MECHANISM GAP. `src/App.tsx` and everything under `src/sessions/`
//    (draftJournal, pathTransactions, historyRestore, store, controller) and
//    `src/workspace/dirtySave.ts` / `HistoryDialog.tsx` / `liveWorkspaceIndex.ts`
//    are now DEAD CODE — `src/main.tsx` renders only `./ArisApp`, and nothing
//    under `src/aris/**` or `ArisApp.tsx` imports any of those modules
//    (confirmed by grep; `tests/e2e/mandatory-reliability-evidence.json`'s own
//    `implementationAreas` for every REL id still literally say `src/App.tsx`,
//    `src/sessions`, `src/workspace` — i.e. the evidence bundle documents
//    architecture that no longer exists). `ArisApp.tsx` has:
//      - NO dirty tracking at all: its `<ProcessTabList>` is fed
//        `dirtyKeys={new Set()}` — a hard-coded empty set, not a real signal.
//      - NO save affordance: no "Save" button/title anywhere in `ArisApp.tsx`
//        or `ArisStudioTab.tsx`, no `keydown` handler anywhere for Ctrl/Cmd+S.
//      - NO reload-recovery journal, NO external-edit-conflict dialog, NO
//        rename/move/delete UI in the explorer (just Open file / Import /
//        Change folder), NO "Recovery history" dialog, NO duplicate-process-ID
//        repair button, NO search box or catalog "Home" screen with
//        unresolved-link badges — none of the DOM these tests looked for
//        exists in the shipped ARIS shell at all.
//      - The one thing that *can* mutate a model in-session — the chat
//        "Improve with AI" rail (`ArisChatImproveRail`/`arisChatHost.ts`) and
//        (per a sibling task, mid-flight) the details rail — edits an
//        in-memory canvas command stack only. `ArisStudioTab` never reports
//        those edits back up to `ArisApp`'s `tab.studio`, so there is nothing
//        for "Import into workspace…" (the one persistence action that
//        exists) to pick up even if it were exercised, and nothing a reload
//        could ever recover.
//
// 2. AN INDEPENDENT TOOLING BLOCKER on top of (1). `./fixtures/reliability-fsa`
//    (shared with sibling specs — not modified here) makes
//    `window.showDirectoryPicker` resolve to a plain JS object with async
//    methods. `ArisApp.tsx`'s `handleOpenFolder` unconditionally calls
//    `rememberWorkspace(handle)` (`src/fs/workspaceHandle.ts`) after EVERY
//    successful pick, which does `idbSet('rootHandle', handle)` — an IndexedDB
//    `put`, which requires the value to be structured-cloneable. A fake
//    handle carrying functions is not: verified live, this throws
//    `DataCloneError: ... could not be cloned` inside `handleOpenFolder`'s
//    try/catch, so the app never leaves the landing screen and shows
//    "Could not open the folder." This is orthogonal to the ARIS rewrite (the
//    same `rememberWorkspace` call existed in the deleted `src/App.tsx` too)
//    and is not something this task is scoped to fix (only this one test file
//    may be touched). Net effect: EVERY test that needs a *successfully
//    opened* directory workspace — not just ones that need dirty-tracking —
//    is unreachable through this fixture today, regardless of BPMN vs ARIS.
//    The one directory-picker path that *is* reachable is cancellation
//    (`AbortError`), because `pickWorkspace()` returns `null` before
//    `rememberWorkspace` is ever called.
//
// RESULT: of the 13 original tests / REL-01..REL-11, twelve have no surviving
// mechanism, no reachable test path, or both, and are deleted below with a
// one-line reason each. The one requirement with both a real, reachable
// mechanism AND a real assertion surface — REL-06, "Folder-picker cancellation
// retains reconnection" — is kept, retargeted to the ARIS shell's real OPFS
// ("Browser workspace") storage mode and its real explorer/tab DOM.
//
//   REL-01 Reload recovery (directory/OPFS/single-file dirty documents)
//          GAP — no dirty tracking, no recovery journal, in any mode.
//   REL-02 Rename/move/delete with dirty child tabs
//          GAP — no rename/move/delete UI exists in the ARIS explorer at all,
//          and directory-workspace success is fixture-blocked (see (2)).
//   REL-03 Ctrl/Cmd+S saves only the active dirty tab
//          GAP — no save affordance and no keyboard handler exist.
//   REL-04 External edit conflict (compare/keep/reload/overwrite/save-as)
//          GAP — no save path means no on-save conflict dialog exists.
//   REL-05 Workspace switch aborts in-flight assistant/interview/generation
//          GAP — `ArisGenerationPanel` DOES carry real §16.7 machinery
//          (an `AbortController`-backed manual Cancel button, plus
//          `resolveArisAiPlacement`, which discards a result that would land
//          in a workspace that changed mid-request) — see
//          `src/ArisGenerationPanel.tsx`. But no DOM path can produce a
//          *second, distinct, successfully-opened* workspace to switch into:
//          directory success is fixture-blocked (2), and OPFS/single-file
//          have no "switch to a different one" affordance once the shell is
//          ready. The assistant's AI-grounded fallback
//          (`ArisAssistantAiSection.tsx`) has its own `AbortController` but no
//          workspace-staleness guard at all, and switching workspaces never
//          closes already-open tabs, so it has no "hostile late result vs.
//          wrong workspace" story to test in the first place.
//   REL-06 Folder-picker cancellation retains reconnection
//          KEPT — retargeted below.
//   REL-07 Permission revocation and unreadable-file isolation
//          GAP — both require a successfully opened directory workspace (2);
//          the "retains dirty XML" half additionally requires (1)'s save path.
//   REL-08 Cross-tab workspace collision
//          GAP — no save path exists on either tab, so no concurrent-save
//          collision is reachable.
//   REL-09 History restore and quota cleanup
//          GAP — no "Recovery history" dialog exists anywhere in the ARIS
//          shell (`HistoryDialog.tsx` is dead code, unreferenced by ArisApp).
//   REL-10 Duplicate process-ID diagnosis and repair
//          GAP — no repair affordance exists in the ARIS explorer or rails.
//   REL-11 Live dirty search, catalog, and link updates
//          GAP — no search box, catalog "Home" screen, or unresolved-link
//          badge exists anywhere in the ARIS shell.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' })

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

let loopbackServer: Server
let HTTP_URL = ''

test.beforeAll(async () => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
  expect(statSync(REFERENCE_AML).isFile(), `reference fixture missing at ${REFERENCE_AML}`).toBe(
    true
  )
  // Real OPFS (`navigator.storage.getDirectory()`) refuses to operate under a
  // `file://` origin ("certain files are unsafe for access within a Web
  // application" — verified live), exactly like the pre-retarget spec's OPFS
  // test needed a loopback HTTP origin. Kept for that same reason.
  loopbackServer = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html)
    })
    response.end(html)
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    loopbackServer.once('error', rejectListen)
    loopbackServer.listen(0, '127.0.0.1', () => {
      loopbackServer.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = loopbackServer.address() as AddressInfo
  HTTP_URL = `http://127.0.0.1:${address.port}/index.html`
})

test.afterAll(
  () =>
    new Promise<void>((resolveClose, rejectClose) => {
      loopbackServer.close((error) => (error ? rejectClose(error) : resolveClose()))
    })
)

/** Opens the built ARIS shell's landing screen over the loopback HTTP origin. */
async function gotoLanding(page: Page): Promise<void> {
  await disableAutoTranslate(page)
  await page.goto(HTTP_URL, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })).toBeVisible({
    timeout: 20_000
  })
}

test('mandatory workspace: folder-picker cancellation retains the current browser workspace and its open tab', async ({
  browserName,
  page
}) => {
  // This test establishes a real OPFS ("Browser workspace") connection
  // before exercising folder-picker cancellation. Real OPFS
  // (`navigator.storage.getDirectory()`) needs the same WebKit accommodation
  // the pre-retarget OPFS-specific test used (see git history): Playwright's
  // WPE MiniBrowser ships StorageAPI/FileSystem/FileSystemWritableStream/
  // AccessHandle but disables them by default, and a `browser.newContext()`
  // page does not inherit MiniBrowser's `--features` flags — only a
  // persistent context launched directly with them does.
  let webkitOpfsContext: BrowserContext | undefined
  let opfsPage = page

  if (browserName === 'webkit') {
    // The empty profile path asks Playwright for an automatically
    // cleaned-up temporary profile. Locale is pinned to undefined: the test
    // runner injects its default en-US locale into manually launched
    // contexts unless the option key is already present, and doing so
    // replaces MiniBrowser's feature-enabled startup page.
    webkitOpfsContext = await webkit.launchPersistentContext('', {
      headless: true,
      locale: undefined,
      args: ['--features=StorageAPI,FileSystem,FileSystemWritableStream,AccessHandle']
    })
    opfsPage = webkitOpfsContext.pages()[0] ?? (await webkitOpfsContext.newPage())
    opfsPage.setDefaultTimeout(30_000)
    opfsPage.setDefaultNavigationTimeout(30_000)
  }

  try {
    // `pickerBehavior: 'abort'` makes `window.showDirectoryPicker()` reject
    // with a real `AbortError`, exactly what Chromium does when a user
    // dismisses the native folder chooser. `pickWorkspace()`
    // (`src/fs/workspaceHandle.ts`) treats that as "no selection" and
    // returns `null` — the one directory-picker path this fixture can drive
    // end-to-end (see the record above), because `handleOpenFolder` returns
    // before ever calling `rememberWorkspace`.
    await installReliabilityWorkspace(opfsPage, {
      name: 'ReliabilityCancellation',
      seed: {},
      pickerBehavior: 'abort'
    })

    await gotoLanding(opfsPage)

    // Establish a real, currently-connected workspace: OPFS ("Browser
    // workspace"), the one storage mode that opens successfully under this
    // fixture without ever touching the blocked directory path. A generous
    // explicit timeout on the click itself, rather than relying on
    // playwright.config.ts's 20s actionTimeout default, since establishing
    // real OPFS storage can be noticeably slower than Chromium/Firefox.
    await opfsPage
      .getByRole('button', { name: 'Open browser workspace' })
      .click({ timeout: 40_000 })
    const banner = opfsPage.getByRole('banner')
    await expect(banner).toContainText('Browser workspace', { timeout: 40_000 })

    // Open a real source so there is an actual open tab to prove survives
    // the cancelled picker — the real customer AnimalWF export used
    // throughout this project (see aris-i18n-rtl.spec.ts,
    // lite-providers.spec.ts).
    await opfsPage.getByRole('button', { name: 'Open file…', exact: true }).click()
    await opfsPage.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
    const tab = opfsPage.getByRole('tab', { name: 'ARISAMLExport.xml', exact: true })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(
      opfsPage.locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]').first()
    ).toBeAttached({ timeout: 20_000 })

    // Cancel the folder picker. `handleOpenDifferent`/`handleOpenFolder`
    // must leave the OPFS workspace, the open tab, and its canvas exactly
    // as they were — no crash, no forced disconnect, no lost work.
    await opfsPage.getByRole('button', { name: 'Change folder…', exact: true }).click()
    await expect(banner).toContainText('Browser workspace')
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(
      opfsPage.locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]').first()
    ).toBeAttached()
    // No error toast/dialog from a merely-cancelled picker — cancellation is
    // silent, exactly like dismissing a native file chooser is everywhere
    // else.
    await expect(opfsPage.getByRole('alert')).toHaveCount(0)
  } finally {
    await webkitOpfsContext?.close()
  }
})
