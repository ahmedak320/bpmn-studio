import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyPagesEvidence } from './pages-evidence-chain.mjs'

const scriptPath = fileURLToPath(new URL('./pages-evidence-chain.mjs', import.meta.url))
const repositoryRoot = resolve(dirname(scriptPath), '..')
const candidateSha = '0123456789abcdef0123456789abcdef01234567'
const productionUrl = 'https://ahmedak320.github.io/bpmn-studio/'
const runId = '123456789012345'
const repository = 'ahmedak320/bpmn-studio'
const targetCatalog = [
  ['chromium', 'playwright-bundled', null],
  ['chrome', 'current-system-channel-observational', 'chrome'],
  ['edge', 'current-system-channel-observational', 'msedge'],
  ['firefox', 'playwright-bundled', null],
  ['webkit-linux', 'playwright-bundled-webkit-on-linux-not-safari', null]
]
const localeCatalog = [
  ['en', 'en-US', 'ltr'],
  ['ar', 'ar-AE', 'rtl']
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixtureEvidence(artifactPath, artifactBytes) {
  const digest = sha256(artifactBytes)
  return {
    schemaVersion: 1,
    gate: 'orbitpm-lite-browser-environment',
    result: 'passed',
    generatedAt: '2026-07-27T12:34:56.789Z',
    candidateSha,
    artifact: {
      path: artifactPath,
      sha256: digest
    },
    testedUrl: productionUrl,
    servedFinalUrl: productionUrl,
    servedSha256: digest,
    runner: {
      platform: 'linux',
      architecture: 'x64',
      kernelRelease: '6.11.0',
      imageOs: 'ubuntu24',
      imageVersion: '20260720.1.0',
      runnerOs: 'Linux',
      runnerArchitecture: 'X64'
    },
    runtime: {
      node: 'v22.21.1',
      declaredPackageManager: 'npm@11.13.0',
      playwright: '1.61.1',
      playwrightBrowsers: [
        {
          name: 'chromium',
          revision: '1228',
          browserVersion: '149.0.7827.55',
          installByDefault: true
        },
        {
          name: 'firefox',
          revision: '1532',
          browserVersion: '151.0',
          installByDefault: true
        },
        {
          name: 'webkit',
          revision: '2311',
          browserVersion: '26.5',
          installByDefault: true
        }
      ]
    },
    workflow: {
      repository,
      runId,
      runAttempt: '2',
      workflow: 'Deploy approved tagged Lite artifact to Pages',
      job: 'readback'
    },
    testEnvironment: {
      headless: true,
      fileSystemAccessPickerOverrides: 'disabled',
      externalExecutionConstructors: 'disabled',
      mainDocumentBinding: 'recorded-per-navigation',
      remoteBodyByteLimit: artifactBytes.byteLength,
      remoteRequestTimeoutMs: 30000
    },
    browsers: targetCatalog.map(([target, classification, channel]) => ({
      target,
      classification,
      channel,
      version: '149.0.0',
      userAgent: `OrbitPM synthetic ${target}`,
      platform: 'Linux x86_64',
      locales: localeCatalog.map(([applicationLanguage, browserLocale, direction]) => ({
        applicationLanguage,
        browserLocale,
        expectedDirection: direction,
        documentLanguage: applicationLanguage,
        direction,
        navigatorLanguage: browserLocale,
        navigatorLanguages: [browserLocale],
        directoryPickerDisabled: true,
        openFilePickerDisabled: true,
        finalUrl: productionUrl,
        navigationSourceSha256: digest,
        navigationSha256: digest,
        navigationBinding: 'bounded-download-fulfilled-response-bytes',
        result: 'passed'
      }))
    }))
  }
}

function verify(evidence, artifactPath, overrides = {}) {
  return verifyPagesEvidence(evidence, {
    candidateSha,
    artifactPath,
    url: productionUrl,
    runId,
    repository,
    ...overrides
  })
}

test('accepts the exact production Pages browser evidence chain and CLI contract', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-pages-evidence-pass-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const artifactPath = join(directory, 'OrbitPM-Process-Studio-Lite.html')
  const evidencePath = join(directory, 'browser-environment-evidence.json')
  const artifactBytes = Buffer.from('<!doctype html><title>OrbitPM</title>')
  writeFileSync(artifactPath, artifactBytes)
  const evidence = fixtureEvidence(artifactPath, artifactBytes)
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)

  assert.deepEqual(verify(evidence, artifactPath), {
    candidateSha,
    artifactSha256: sha256(artifactBytes),
    url: productionUrl,
    runId,
    repository
  })

  const cli = spawnSync(
    process.execPath,
    [
      scriptPath,
      'verify',
      `--evidence=${evidencePath}`,
      `--candidate-sha=${candidateSha}`,
      `--artifact=${artifactPath}`,
      `--url=${productionUrl}`,
      `--run-id=${runId}`,
      `--repository=${repository}`
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8'
    }
  )
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /Verified Pages browser evidence/)
})

test('rejects release, byte, URL, workflow, browser, locale, and binding tampering', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-pages-evidence-tamper-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const artifactPath = join(directory, 'OrbitPM-Process-Studio-Lite.html')
  const artifactBytes = Buffer.from('<!doctype html><title>Exact Pages bytes</title>')
  writeFileSync(artifactPath, artifactBytes)

  const mutations = [
    ['schema version', (value) => (value.schemaVersion = 2)],
    ['extra schema field', (value) => (value.untrusted = true)],
    ['gate', (value) => (value.gate = 'other')],
    ['result', (value) => (value.result = 'failed')],
    ['candidate', (value) => (value.candidateSha = 'f'.repeat(40))],
    ['artifact digest', (value) => (value.artifact.sha256 = 'a'.repeat(64))],
    ['served digest', (value) => (value.servedSha256 = 'a'.repeat(64))],
    ['tested URL', (value) => (value.testedUrl = 'https://ahmedak320.github.io/bpmn-studio/other')],
    ['served URL', (value) => (value.servedFinalUrl = 'https://ahmedak320.github.io/')],
    ['repository', (value) => (value.workflow.repository = 'other/repository')],
    ['run ID', (value) => (value.workflow.runId = '999')],
    ['workflow name', (value) => (value.workflow.workflow = 'Untrusted workflow')],
    ['job identity', (value) => (value.workflow.job = 'other')],
    ['runner platform', (value) => (value.runner.platform = 'darwin')],
    ['remote byte limit', (value) => (value.testEnvironment.remoteBodyByteLimit += 1)],
    ['missing target', (value) => value.browsers.pop()],
    ['duplicate target', (value) => (value.browsers[4].target = value.browsers[0].target)],
    ['classification', (value) => (value.browsers[1].classification = 'playwright-bundled')],
    ['channel', (value) => (value.browsers[2].channel = 'chrome')],
    ['missing locale', (value) => value.browsers[0].locales.pop()],
    [
      'duplicate locale',
      (value) =>
        (value.browsers[0].locales[1].applicationLanguage =
          value.browsers[0].locales[0].applicationLanguage)
    ],
    ['browser locale', (value) => (value.browsers[0].locales[0].browserLocale = 'en-GB')],
    ['locale result', (value) => (value.browsers[0].locales[0].result = 'failed')],
    [
      'navigation final URL',
      (value) => (value.browsers[0].locales[0].finalUrl = 'https://example.invalid/')
    ],
    [
      'navigation source digest',
      (value) => (value.browsers[0].locales[0].navigationSourceSha256 = 'b'.repeat(64))
    ],
    [
      'navigation digest',
      (value) => (value.browsers[0].locales[0].navigationSha256 = 'b'.repeat(64))
    ],
    [
      'navigation binding',
      (value) => (value.browsers[0].locales[0].navigationBinding = 'url-only')
    ],
    ['unsafe string', (value) => (value.browsers[0].userAgent = 'unsafe\ninjected')]
  ]

  for (const [label, mutate] of mutations) {
    const evidence = fixtureEvidence(artifactPath, artifactBytes)
    mutate(evidence)
    assert.throws(() => verify(evidence, artifactPath), undefined, label)
  }
})

test('rejects non-canonical or unsafe expected identities and changed local bytes', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-pages-evidence-input-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const artifactPath = join(directory, 'OrbitPM-Process-Studio-Lite.html')
  const originalBytes = Buffer.from('<!doctype html><title>Original</title>')
  writeFileSync(artifactPath, originalBytes)
  const evidence = fixtureEvidence(artifactPath, originalBytes)

  assert.throws(
    () => verify(evidence, artifactPath, { url: 'https://example.test' }),
    /canonical HTTPS URL/
  )
  assert.throws(
    () =>
      verify(evidence, artifactPath, {
        url: 'https://example.test/?token=secret'
      }),
    /query string/
  )
  assert.throws(
    () => verify(evidence, artifactPath, { candidateSha: candidateSha.toUpperCase() }),
    /lowercase hexadecimal/
  )
  assert.throws(() => verify(evidence, artifactPath, { runId: '01' }), /positive decimal/)
  assert.throws(
    () => verify(evidence, artifactPath, { repository: 'owner/repo\ninjected' }),
    /safe canonical/
  )

  writeFileSync(artifactPath, '<!doctype html><title>Replacement</title>')
  assert.throws(
    () => verify(evidence, artifactPath),
    /exact local Pages artifact|exact local Pages artifact bytes/
  )
})

test('CLI rejects duplicate, missing, and unsupported options', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-pages-evidence-cli-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const artifactPath = join(directory, 'artifact.html')
  const evidencePath = join(directory, 'evidence.json')
  const artifactBytes = Buffer.from('<!doctype html>')
  writeFileSync(artifactPath, artifactBytes)
  writeFileSync(evidencePath, JSON.stringify(fixtureEvidence(artifactPath, artifactBytes)))
  const base = [
    scriptPath,
    'verify',
    `--evidence=${evidencePath}`,
    `--candidate-sha=${candidateSha}`,
    `--artifact=${artifactPath}`,
    `--url=${productionUrl}`,
    `--run-id=${runId}`,
    `--repository=${repository}`
  ]
  for (const [label, arguments_] of [
    ['duplicate', [...base, `--run-id=${runId}`]],
    ['unsupported', [...base, '--trusted=true']],
    ['missing', base.filter((argument) => !argument.startsWith('--repository='))]
  ]) {
    const result = spawnSync(process.execPath, arguments_, {
      cwd: repositoryRoot,
      encoding: 'utf8'
    })
    assert.notEqual(result.status, 0, label)
  }
})
