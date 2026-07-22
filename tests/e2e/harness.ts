// Shared Playwright-Electron harness for the OrbitPM Process Studio e2e suite.
//
// Provides a `launchApp` test fixture that:
//   - creates a fresh temp userData dir + temp workspace dir per launch,
//   - optionally pre-seeds the workspace root (workspace-settings.json in
//     userData → the temp workspace) and fixture files/folders on disk,
//   - launches the built app (out/main/index.js) with --no-sandbox and the
//     ORBITPM_USERDATA / ORBITPM_E2E_FIXTURES_DIR / ORBITPM_E2E_FAKE_LLM env
//     hooks (all gated in the main process; no production effect),
//   - neutralizes the browser dialog primitives (window.prompt is unsupported
//     in Electron; window.confirm/alert would block the renderer) so flows are
//     deterministic while the user-visible actions themselves stay real,
//   - on teardown closes the app, removes the temp dirs, and on failure writes
//     a screenshot + trace into tests/e2e/artifacts.

import {
  test as base,
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// This file lives in tests/e2e/, so its directory's grandparent is the repo root.
const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const MAIN_ENTRY = join(REPO_ROOT, 'out', 'main', 'index.js')
const FIXTURES_IR = join(REPO_ROOT, 'tests', 'fixtures', 'ir')
const ARTIFACTS = join(REPO_ROOT, 'tests', 'e2e', 'artifacts')

export interface LaunchOptions {
  /** Pre-seed workspace-settings.json so the app boots straight into the workspace. */
  seedRoot?: boolean
  /** Turn on the main-process fake-LLM path (ORBITPM_E2E_FAKE_LLM=1). */
  fakeLlm?: boolean
  /** Files to write into the temp workspace: { 'sales/order.bpmn': '<xml/>' }. */
  seedFiles?: Record<string, string>
  /** Empty folders to create in the temp workspace (e.g. AI target folders). */
  seedDirs?: string[]
}

export interface Launched {
  app: ElectronApplication
  window: Page
  /** Absolute temp userData dir (holds workspace-settings.json, secrets.json…). */
  userDataDir: string
  /** Absolute temp workspace root the app reads/writes .bpmn files under. */
  workspaceDir: string
}

interface Fixtures {
  launchApp: (options?: LaunchOptions) => Promise<Launched>
}

export const test = base.extend<Fixtures>({
  launchApp: async ({}, use, testInfo) => {
    const running: Launched[] = []
    const tmpDirs: string[] = []

    const launchApp = async (options: LaunchOptions = {}): Promise<Launched> => {
      const rootDir = mkdtempSync(join(tmpdir(), 'orbitpm-e2e-'))
      tmpDirs.push(rootDir)
      const userDataDir = join(rootDir, 'userData')
      const workspaceDir = join(rootDir, 'workspace')
      mkdirSync(userDataDir, { recursive: true })
      mkdirSync(workspaceDir, { recursive: true })

      for (const dir of options.seedDirs ?? []) {
        mkdirSync(join(workspaceDir, dir), { recursive: true })
      }
      for (const [rel, content] of Object.entries(options.seedFiles ?? {})) {
        const abs = join(workspaceDir, rel)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content, 'utf8')
      }
      if (options.seedRoot) {
        writeFileSync(
          join(userDataDir, 'workspace-settings.json'),
          JSON.stringify({ root: workspaceDir }, null, 2)
        )
      }

      const env: Record<string, string | undefined> = {
        ...process.env,
        ORBITPM_USERDATA: userDataDir,
        ORBITPM_E2E_FIXTURES_DIR: FIXTURES_IR,
        DISPLAY: process.env.DISPLAY ?? ':0'
      }
      if (options.fakeLlm) env.ORBITPM_E2E_FAKE_LLM = '1'

      const app = await electron.launch({ args: [MAIN_ENTRY, '--no-sandbox'], env })
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      // Neutralize native/unsupported browser dialogs. Only the dialog
      // primitives are stubbed — the clicks/menus that trigger them stay real.
      await window.evaluate(() => {
        const w = window as unknown as { __E2E_PROMPT__: string }
        w.__E2E_PROMPT__ = ''
        window.confirm = () => true
        window.alert = () => undefined
        window.prompt = () => w.__E2E_PROMPT__
      })

      const launched: Launched = { app, window, userDataDir, workspaceDir }
      running.push(launched)
      return launched
    }

    await use(launchApp)

    // Playwright's use.trace/use.screenshot (playwright.config.ts) capture the
    // electron window on failure into outputDir (tests/e2e/artifacts). Add a
    // manual screenshot as a belt-and-suspenders fallback, then always close the
    // app (releases the display + single-instance lock) and clean temp dirs.
    const failed = testInfo.status !== testInfo.expectedStatus
    if (failed) {
      mkdirSync(ARTIFACTS, { recursive: true })
      let idx = 0
      for (const { window } of running) {
        const tag = `${testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}-${idx++}`
        await window.screenshot({ path: join(ARTIFACTS, `${tag}.png`) }).catch(() => {})
      }
    }
    for (const { app } of running) await app.close().catch(() => {})
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  }
})

export { expect }

/** Set the value the stubbed window.prompt will return for the next action. */
export function setPromptValue(window: Page, value: string): Promise<void> {
  return window.evaluate((v) => {
    ;(window as unknown as { __E2E_PROMPT__: string }).__E2E_PROMPT__ = v
  }, value)
}

/** Force the AI panel's connectivity state to online (fake path needs no net). */
export function forceOnline(window: Page): Promise<void> {
  return window.evaluate(() => window.dispatchEvent(new Event('online')))
}

// --- bpmn-js canvas helpers --------------------------------------------------
// Scope to the ACTIVE editor tab (inactive tabs are display:none, so `:visible`
// selects the active one) and to the MAIN canvas svg (a direct child of
// .djs-container), which excludes the minimap's cloned shapes.

/** The active tab's primary bpmn-js canvas <svg>. */
export function activeCanvas(window: Page): Locator {
  return window.locator('.orbitpm-editor:visible .djs-container > svg').first()
}

/** A specific diagram element (by its bpmn id) in the active canvas. */
export function shapeIn(window: Page, elementId: string): Locator {
  return activeCanvas(window).locator(`.djs-element[data-element-id="${elementId}"]`)
}

/** Wait until the active editor has rendered at least one shape. */
export async function waitForCanvas(window: Page): Promise<void> {
  await expect(activeCanvas(window).locator('.djs-shape').first()).toBeVisible()
}

/**
 * Open a .bpmn from the sidebar tree: expand its folder (only if the file isn't
 * already showing — clicking an expanded folder would collapse it) then
 * double-click the file. Scoped to the tree (`complementary`) so it never
 * matches an open tab of the same name.
 */
export async function openFromTree(
  window: Page,
  fileName: string,
  folderName?: string
): Promise<void> {
  const tree = window.getByRole('complementary')
  const fileEntry = tree.getByText(fileName, { exact: true })
  if (folderName && !(await fileEntry.isVisible().catch(() => false))) {
    await tree.getByText(folderName, { exact: true }).click()
  }
  await fileEntry.dblclick()
  await waitForCanvas(window)
}
