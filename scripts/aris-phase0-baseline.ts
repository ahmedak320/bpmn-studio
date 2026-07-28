import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { convertAmlToBpmnFiles } from '../src/library/apcImport.ts'
import { parseAml } from '../src/library/amlParse.ts'

const execFile = promisify(execFileCallback)
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const CAPTURE_DATE = '2026-07-28'
const REFERENCE_ANIMAL_WF = resolve(REPO_ROOT, '../reference/AnimalWF/ARISAMLExport.xml')
const LOCAL_EVIDENCE_ROOT = resolve(REPO_ROOT, 'local-evidence/aris-phase0', CAPTURE_DATE)
const SAFE_REPORT_PATH = resolve(REPO_ROOT, `docs/ARIS_PHASE0_BASELINE_${CAPTURE_DATE}.md`)

interface TestCategorySummary {
  files: number
  cases: number
}

interface FileInventoryEntry {
  path: string
  cases: number
}

interface StartupRequestRecord {
  method: string
  url: string
  resourceType: string
}

interface PrivateModelEvidence {
  ordinal: number
  relPath: string
  screenshotPath: string
}

interface AnimalWfImportEvidence {
  manifestPath: string
  screenshotDir: string
  modelCount: number
  reviewBlocked: boolean
  blockedStatusText?: string
  blockedDialogTextPath?: string
  blockedDialogScreenshotPath?: string
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function sha256File(path: string): Promise<string> {
  return sha256(await fs.readFile(path))
}

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: REPO_ROOT })
  return stdout.trim()
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = resolve(root, entry.name)
      if (entry.isDirectory()) return listFiles(fullPath)
      return [fullPath]
    })
  )
  return files.flat()
}

function countCases(source: string): number {
  const matches = source.match(/^\s*(?:it|test)(?:\.(?:skip|only|fails|fixme|todo))?\s*\(/gm)
  return matches?.length ?? 0
}

function isVitestIntegrationFile(path: string): boolean {
  return /(?:^|\/)integration\.test\.[cm]?[jt]sx?$/.test(path) || /\.integration\.test\.[cm]?[jt]sx?$/.test(path)
}

async function summarizeTests() {
  const allFiles = await listFiles(resolve(REPO_ROOT, 'src'))
  const vitestFiles = allFiles
    .filter((path) => /\.(test\.(ts|tsx))$/.test(path))
    .sort((left, right) => left.localeCompare(right))
  const playwrightFiles = (await listFiles(resolve(REPO_ROOT, 'tests/e2e')))
    .filter((path) => path.endsWith('.spec.ts'))
    .sort((left, right) => left.localeCompare(right))

  const unitInventory: FileInventoryEntry[] = []
  const integrationInventory: FileInventoryEntry[] = []
  for (const path of vitestFiles) {
    const cases = countCases(await fs.readFile(path, 'utf8'))
    const entry = {
      path: relative(REPO_ROOT, path),
      cases
    }
    if (isVitestIntegrationFile(entry.path)) integrationInventory.push(entry)
    else unitInventory.push(entry)
  }

  const e2eInventory: FileInventoryEntry[] = await Promise.all(
    playwrightFiles.map(async (path) => ({
      path: relative(REPO_ROOT, path),
      cases: countCases(await fs.readFile(path, 'utf8'))
    }))
  )

  const summarize = (inventory: FileInventoryEntry[]): TestCategorySummary => ({
    files: inventory.length,
    cases: inventory.reduce((total, entry) => total + entry.cases, 0)
  })

  return {
    unit: summarize(unitInventory),
    integration: summarize(integrationInventory),
    e2e: summarize(e2eInventory),
    inventory: {
      unit: unitInventory,
      integration: integrationInventory,
      e2e: e2eInventory
    }
  }
}

async function captureStartupNetworkLog(artifactPath: string, version: string) {
  const fileUrl = pathToFileURL(artifactPath).toString()
  const browser = await chromium.launch({ headless: true })
  const requests: StartupRequestRecord[] = []
  try {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    page.on('request', (request) => {
      const url = request.url()
      if (url === fileUrl || url.startsWith('data:') || url.startsWith('blob:')) return
      requests.push({
        method: request.method(),
        url,
        resourceType: request.resourceType()
      })
    })
    await page.addInitScript(() => {
      localStorage.setItem('orbitpm.lite.lang', 'en')
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: undefined
      })
    })
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.getByRole('heading', { name: 'OrbitPM Process Studio Lite' }).waitFor({ state: 'visible' })
    await page.locator(`html[data-orbitpm-app-version="${version}"]`).waitFor({ state: 'attached' })
    await page.waitForTimeout(500)
    await context.close()
  } finally {
    await browser.close()
  }

  const log = {
    captureDate: CAPTURE_DATE,
    artifactPath: relative(REPO_ROOT, artifactPath),
    fileUrl,
    unexpectedRequests: requests
  }
  const outputPath = resolve(LOCAL_EVIDENCE_ROOT, 'startup-network.en.json')
  await fs.writeFile(outputPath, `${JSON.stringify(log, null, 2)}\n`, 'utf8')
  return {
    outputPath: relative(REPO_ROOT, outputPath),
    unexpectedRequests: requests
  }
}

async function installMockWorkspace(page: Awaited<ReturnType<ReturnType<typeof chromium.launch>['newPage']>>) {
  await page.addInitScript(() => {
    const missing = (): Error => {
      const error = new Error('Not found')
      error.name = 'NotFoundError'
      return error
    }

    const asText = async (value: string | Blob | ArrayBuffer): Promise<string> => {
      if (typeof value === 'string') return value
      if (value instanceof Blob) return value.text()
      return new TextDecoder().decode(value)
    }

    const fileHandle = (name: string, initial = '') => {
      let text = initial
      let modified = Date.now()
      return {
        kind: 'file',
        name,
        async getFile() {
          const bytes = new TextEncoder().encode(text)
          return {
            text: async () => text,
            arrayBuffer: async () => bytes.buffer.slice(0),
            lastModified: modified,
            size: bytes.byteLength
          }
        },
        async createWritable() {
          let next = ''
          return {
            write: async (value: string | Blob | ArrayBuffer) => {
              next += await asText(value)
            },
            close: async () => {
              text = next
              modified = Date.now()
            }
          }
        }
      }
    }

    const directoryHandle = (
      name: string,
      initial: Record<string, unknown> = {}
    ) => {
      const children = new Map(Object.entries(initial))
      return {
        kind: 'directory',
        name,
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async *entries() {
          for (const entry of children) yield entry
        },
        async getDirectoryHandle(childName: string, options: { create?: boolean } = {}) {
          const existing = children.get(childName)
          if (existing) {
            if ((existing as { kind?: string }).kind !== 'directory') {
              throw new TypeError(`${childName} is a file`)
            }
            return existing
          }
          if (!options.create) throw missing()
          const created = directoryHandle(childName)
          children.set(childName, created)
          return created
        },
        async getFileHandle(childName: string, options: { create?: boolean } = {}) {
          const existing = children.get(childName)
          if (existing) {
            if ((existing as { kind?: string }).kind !== 'file') {
              throw new TypeError(`${childName} is a directory`)
            }
            return existing
          }
          if (!options.create) throw missing()
          const created = fileHandle(childName)
          children.set(childName, created)
          return created
        },
        async removeEntry(childName: string) {
          if (!children.delete(childName)) throw missing()
        }
      }
    }

    const root = directoryHandle('ArisBaselineWorkspace')
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => root
    })
  })
}

async function captureAnimalWfImportEvidence(artifactPath: string, version: string, amlPath: string) {
  const fileUrl = pathToFileURL(artifactPath).toString()
  const screenshotsDir = resolve(LOCAL_EVIDENCE_ROOT, 'animalwf-screenshots')
  await fs.mkdir(screenshotsDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const models: PrivateModelEvidence[] = []
  let reviewBlocked = false
  let blockedStatusText: string | undefined
  let blockedDialogTextPath: string | undefined
  let blockedDialogScreenshotPath: string | undefined
  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1600, height: 1200 }
    })
    const page = await context.newPage()
    await installMockWorkspace(page)
    await page.addInitScript((appVersion) => {
      localStorage.setItem('orbitpm.lite.lang', 'en')
      document.documentElement.setAttribute('data-aris-baseline-run', appVersion)
    }, version)
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Choose folder workspace', exact: true }).click()
    await page.getByRole('heading', { name: 'Process catalog' }).waitFor({ state: 'visible', timeout: 20_000 })

    const importInput = page.locator('input[type="file"][accept*=".apc"][multiple]')
    await importInput.setInputFiles(amlPath)
    const importReview = page.getByRole('dialog', { name: 'Review workspace import', exact: true })
    await importReview.waitFor({ state: 'visible', timeout: 30_000 })
    const autoLayoutAcceptance = importReview.locator(
      'input[type="checkbox"][aria-describedby="workspace-import-review-layout-acceptance-hint"]'
    )
    if (await autoLayoutAcceptance.count()) {
      await autoLayoutAcceptance.check()
    }
    const confirm = importReview.getByRole('button', { name: 'Confirm import', exact: true })
    await confirm.waitFor({ state: 'visible', timeout: 30_000 })
    let confirmEnabled = false
    try {
      await page.waitForFunction(
        () => {
          const button = [...document.querySelectorAll('button')].find(
            (element) => element.textContent?.trim() === 'Confirm import'
          )
          return button instanceof HTMLButtonElement && !button.disabled
        },
        { timeout: 5_000 }
      )
      confirmEnabled = true
    } catch {
      confirmEnabled = false
    }

    if (!confirmEnabled) {
      reviewBlocked = true
      blockedStatusText =
        (await page.locator('#workspace-import-review-state').textContent())?.trim() ??
        (await importReview.getByRole('alert').textContent().catch(() => ''))?.trim() ??
        ''
      blockedDialogTextPath = resolve(LOCAL_EVIDENCE_ROOT, 'animalwf-review-blocked.txt')
      blockedDialogScreenshotPath = resolve(LOCAL_EVIDENCE_ROOT, 'animalwf-review-blocked.png')
      await fs.writeFile(
        blockedDialogTextPath,
        `${(await importReview.textContent())?.trim() ?? ''}\n`,
        'utf8'
      )
      await importReview.screenshot({ path: blockedDialogScreenshotPath })
      await context.close()
    } else {
      await confirm.click()
      await importReview.waitFor({ state: 'hidden', timeout: 30_000 })

      const canonicalSelector =
        '.orbitpm-tree-row[data-rel-path$=".bpmn"]:not(.orbitpm-tree-reference-row)'
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length > 0,
        canonicalSelector,
        { timeout: 30_000 }
      )

      const relPaths = await page.locator(canonicalSelector).evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('data-rel-path') ?? '')
          .filter((value) => value.length > 0)
      )

      for (let index = 0; index < relPaths.length; index += 1) {
        const row = page.locator(canonicalSelector).nth(index)
        await row.click()
        await page.locator('.djs-container svg').first().waitFor({ state: 'visible', timeout: 30_000 })
        await page.waitForFunction(() => {
          const app = (window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }).__ORBITPM_LITE__
          return Boolean(app?.modeler)
        })
        await page.waitForTimeout(250)
        const screenshotPath = resolve(
          screenshotsDir,
          `model-${String(index + 1).padStart(2, '0')}.png`
        )
        await page.locator('.djs-container').first().screenshot({ path: screenshotPath })
        models.push({
          ordinal: index + 1,
          relPath: relPaths[index],
          screenshotPath: relative(REPO_ROOT, screenshotPath)
        })
      }

      await context.close()
    }
  } finally {
    await browser.close()
  }

  const manifest = {
    captureDate: CAPTURE_DATE,
    artifactPath: relative(REPO_ROOT, artifactPath),
    sourceFixturePath: relative(REPO_ROOT, amlPath),
    modelCount: models.length,
    reviewBlocked,
    ...(blockedStatusText ? { blockedStatusText } : {}),
    ...(blockedDialogTextPath
      ? { blockedDialogTextPath: relative(REPO_ROOT, blockedDialogTextPath) }
      : {}),
    ...(blockedDialogScreenshotPath
      ? { blockedDialogScreenshotPath: relative(REPO_ROOT, blockedDialogScreenshotPath) }
      : {}),
    models
  }
  const manifestPath = resolve(LOCAL_EVIDENCE_ROOT, 'animalwf-import-private.json')
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return {
    manifestPath: relative(REPO_ROOT, manifestPath),
    screenshotDir: relative(REPO_ROOT, screenshotsDir),
    modelCount: models.length,
    reviewBlocked,
    ...(blockedStatusText ? { blockedStatusText } : {}),
    ...(blockedDialogTextPath
      ? { blockedDialogTextPath: relative(REPO_ROOT, blockedDialogTextPath) }
      : {}),
    ...(blockedDialogScreenshotPath
      ? { blockedDialogScreenshotPath: relative(REPO_ROOT, blockedDialogScreenshotPath) }
      : {})
  } satisfies AnimalWfImportEvidence
}

function formatDependencies(title: string, entries: [string, string][]): string {
  return [
    `#### ${title}`,
    '',
    ...entries.map(([name, version]) => `- \`${name}\` — \`${version}\``),
    ''
  ].join('\n')
}

async function main() {
  await fs.mkdir(LOCAL_EVIDENCE_ROOT, { recursive: true })
  const manifest = JSON.parse(await fs.readFile(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
    version: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    overrides?: Record<string, string>
  }

  const branch = await git('branch', '--show-current')
  const branchHead = await git('rev-parse', 'HEAD')
  const sourceMainSha = await git('rev-parse', 'origin/main')
  const artifactPath = resolve(REPO_ROOT, `release/OrbitPM-Process-Studio-Lite-${manifest.version}.html`)
  const artifactStat = await fs.stat(artifactPath)
  const artifactSha = await sha256File(artifactPath)

  const dependencyEntries = Object.entries(manifest.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const devDependencyEntries = Object.entries(manifest.devDependencies ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const overrideEntries = Object.entries(manifest.overrides ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const tests = await summarizeTests()
  const startupLog = await captureStartupNetworkLog(artifactPath, manifest.version)

  const animalStat = await fs.stat(REFERENCE_ANIMAL_WF)
  const animalSha = await sha256File(REFERENCE_ANIMAL_WF)
  const animalText = await fs.readFile(REFERENCE_ANIMAL_WF, 'utf8')
  const parsed = parseAml(animalText)
  const conversion = await convertAmlToBpmnFiles(animalText)
  if ('error' in conversion) {
    throw new Error(`AnimalWF baseline conversion failed: ${conversion.error}`)
  }
  const importEvidence = await captureAnimalWfImportEvidence(
    artifactPath,
    manifest.version,
    REFERENCE_ANIMAL_WF
  )

  const privateSummaryPath = resolve(LOCAL_EVIDENCE_ROOT, 'summary-private.json')
  const privateSummary = {
    captureDate: CAPTURE_DATE,
    branch,
    branchHead,
    sourceMainSha,
    artifactPath: relative(REPO_ROOT, artifactPath),
    artifactSha256: artifactSha,
    startupLog: startupLog.outputPath,
    animalFixturePath: relative(REPO_ROOT, REFERENCE_ANIMAL_WF),
    animalFixtureSha256: animalSha,
    sourceModels: parsed.models.length,
    sourceEpcModels: parsed.models.filter((model) => model.type === 'MT_EEPC').length,
    sourceObjectDefinitions: parsed.objects.length,
    convertedOutputFiles: conversion.files.length,
    uiImportReviewBlocked: importEvidence.reviewBlocked,
    conversionReportSummary: conversion.report.summary,
    privateImportManifest: importEvidence.manifestPath,
    ...(importEvidence.blockedStatusText ? { blockedStatusText: importEvidence.blockedStatusText } : {})
  }
  await fs.writeFile(privateSummaryPath, `${JSON.stringify(privateSummary, null, 2)}\n`, 'utf8')

  const report = [
    '# ARIS Phase 0 Baseline — 2026-07-28',
    '',
    'This baseline was captured on Tuesday, July 28, 2026 on `feat/aris-only-studio` before any ARIS product-code changes.',
    '',
    '## Recorded branch basis',
    '',
    `- Source main SHA: \`${sourceMainSha}\``,
    `- Branch at capture: \`${branch}\``,
    `- Branch head at capture: \`${branchHead}\``,
    '',
    '## Current package identity',
    '',
    `- Package version: \`${manifest.version}\``,
    `- Existing release HTML path: \`release/${basename(artifactPath)}\``,
    `- Existing release HTML size: ${artifactStat.size.toLocaleString('en-US')} bytes`,
    `- Existing release HTML SHA-256: \`${artifactSha}\``,
    '',
    '## Current dependencies',
    '',
    `- Production dependencies: ${dependencyEntries.length}`,
    `- Development dependencies: ${devDependencyEntries.length}`,
    `- Overrides: ${overrideEntries.length}`,
    '',
    formatDependencies('Production', dependencyEntries),
    formatDependencies('Development', devDependencyEntries),
    formatDependencies('Overrides', overrideEntries),
    '## Current test counts',
    '',
    'Classification rule: Vitest files whose path includes `integration.test` are counted as integration; all other `src/**/*.test.ts(x)` files are counted as unit; Playwright `tests/e2e/*.spec.ts` files are counted as browser e2e.',
    '',
    `- Unit tests: ${tests.unit.files} files / ${tests.unit.cases} cases`,
    `- Integration tests: ${tests.integration.files} files / ${tests.integration.cases} cases`,
    `- Browser e2e tests: ${tests.e2e.files} files / ${tests.e2e.cases} cases`,
    '',
    '## Current single-file startup network log',
    '',
    `- Artifact under test: \`release/${basename(artifactPath)}\``,
    `- Unexpected startup requests observed: ${startupLog.unexpectedRequests.length}`,
    `- Local evidence path: \`${startupLog.outputPath}\``,
    '',
    '## AnimalWF source and current import baseline',
    '',
    `- Source path: \`../reference/AnimalWF/ARISAMLExport.xml\``,
    `- Source size: ${animalStat.size.toLocaleString('en-US')} bytes`,
    `- Source SHA-256: \`${animalSha}\``,
    `- Parsed source object definitions: ${parsed.objects.length}`,
    `- Parsed source models: ${parsed.models.length}`,
    `- Parsed source EPC models: ${parsed.models.filter((model) => model.type === 'MT_EEPC').length}`,
    `- Current converted output files: ${conversion.files.length}`,
    `- Current UI-imported canonical model count: ${importEvidence.modelCount}`,
    `- Current full AnimalWF import review blocked: ${importEvidence.reviewBlocked ? 'yes' : 'no'}`,
    ...(importEvidence.blockedStatusText
      ? [`- Current blocked review status: ${importEvidence.blockedStatusText}`]
      : []),
    `- Current conversion report summary: converted=${conversion.report.summary.converted}, downgraded=${conversion.report.summary.downgraded}, ignored=${conversion.report.summary.ignored}, ambiguous=${conversion.report.summary.ambiguous}, unmapped=${conversion.report.summary.unmapped}`,
    '',
    '## Private local-only evidence',
    '',
    'The following evidence was captured locally and intentionally left untracked to avoid publishing organization data:',
    '',
    `- Startup network log: \`${startupLog.outputPath}\``,
    `- AnimalWF private import manifest: \`${importEvidence.manifestPath}\``,
    `- AnimalWF screenshots directory: \`${importEvidence.screenshotDir}\``,
    `- AnimalWF screenshot count: ${importEvidence.modelCount}`,
    ...(importEvidence.blockedDialogTextPath
      ? [`- Blocked review dialog text: \`${importEvidence.blockedDialogTextPath}\``]
      : []),
    ...(importEvidence.blockedDialogScreenshotPath
      ? [`- Blocked review screenshot: \`${importEvidence.blockedDialogScreenshotPath}\``]
      : []),
    `- Private summary: \`${relative(REPO_ROOT, privateSummaryPath)}\``,
    '',
    'No private AML bytes or screenshot content are committed by this report.',
    ''
  ].join('\n')

  await fs.writeFile(SAFE_REPORT_PATH, report, 'utf8')
  console.log(`Wrote safe report: ${relative(REPO_ROOT, SAFE_REPORT_PATH)}`)
  console.log(`Wrote local evidence under: ${relative(REPO_ROOT, LOCAL_EVIDENCE_ROOT)}`)
}

await main()
