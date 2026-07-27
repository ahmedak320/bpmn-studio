import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
const MAX_STRING_LENGTH = 16 * 1024
const EXPECTED_WORKFLOW = 'Deploy approved tagged Lite artifact to Pages'
const EXPECTED_JOB = 'deploy'
const EXPECTED_NAVIGATION_BINDING = 'bounded-download-fulfilled-response-bytes'

const EXPECTED_TARGETS = new Map([
  [
    'chromium',
    {
      classification: 'playwright-bundled',
      channel: null
    }
  ],
  [
    'chrome',
    {
      classification: 'current-system-channel-observational',
      channel: 'chrome'
    }
  ],
  [
    'edge',
    {
      classification: 'current-system-channel-observational',
      channel: 'msedge'
    }
  ],
  [
    'firefox',
    {
      classification: 'playwright-bundled',
      channel: null
    }
  ],
  [
    'webkit-linux',
    {
      classification: 'playwright-bundled-webkit-on-linux-not-safari',
      channel: null
    }
  ]
])

const EXPECTED_LOCALES = new Map([
  [
    'en',
    {
      browserLocale: 'en-US',
      direction: 'ltr'
    }
  ],
  [
    'ar',
    {
      browserLocale: 'ar-AE',
      direction: 'rtl'
    }
  ]
])

function fail(message) {
  throw new Error(message)
}

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`)
  }
  return value
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(assertRecord(value, label)).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} does not match schema version 1.`)
  }
}

function assertAllowedKeys(value, requiredKeys, optionalKeys, label) {
  const actual = Object.keys(assertRecord(value, label))
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  if (
    requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    fail(`${label} does not match schema version 1.`)
  }
}

function assertCanonicalString(value, label) {
  const hasControlCharacter =
    typeof value === 'string' &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
    })
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_STRING_LENGTH ||
    value !== value.trim() ||
    value !== value.normalize('NFC') ||
    hasControlCharacter
  ) {
    fail(`${label} must be a safe canonical string.`)
  }
  return value
}

function assertAllStringsSafe(value, label = 'evidence') {
  if (typeof value === 'string') {
    assertCanonicalString(value, label)
    return
  }
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      assertAllStringsSafe(nested, `${label}[${index}]`)
    }
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertCanonicalString(key, `${label} property name`)
      assertAllStringsSafe(nested, `${label}.${key}`)
    }
  }
}

function assertLowerSha(value, length, label) {
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value)) {
    fail(`${label} must be an exact lowercase hexadecimal digest.`)
  }
  return value
}

function assertPositiveDecimal(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    fail(`${label} must be a canonical positive decimal string.`)
  }
  return value
}

function assertCanonicalTimestamp(value, label) {
  assertCanonicalString(value, label)
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    fail(`${label} must be a canonical ISO timestamp.`)
  }
}

function canonicalHttpsUrl(value, label) {
  assertCanonicalString(value, label)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`${label} must be a valid canonical HTTPS URL.`)
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.href !== value
  ) {
    fail(
      `${label} must be a canonical HTTPS URL without credentials, a query string, or a fragment.`
    )
  }
  return parsed.href
}

function captureArtifact(path) {
  const absolutePath = resolve(path)
  const descriptor = openSync(absolutePath, 'r')
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size < 1 || before.size > MAX_ARTIFACT_BYTES) {
      fail(
        `The Pages artifact must be a regular file containing 1 through ${MAX_ARTIFACT_BYTES} bytes.`
      )
    }
    const bytes = readFileSync(descriptor)
    const after = fstatSync(descriptor)
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    ) {
      fail('The Pages artifact changed while it was being verified.')
    }
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength
    }
  } finally {
    closeSync(descriptor)
  }
}

function validatePlaywrightBrowserManifest(entries) {
  if (!Array.isArray(entries) || entries.length < 3 || entries.length > 64) {
    fail('evidence.runtime.playwrightBrowsers must be a bounded browser manifest.')
  }
  const names = new Set()
  for (const [index, entry] of entries.entries()) {
    const label = `evidence.runtime.playwrightBrowsers[${index}]`
    assertAllowedKeys(entry, ['name', 'revision', 'installByDefault'], ['browserVersion'], label)
    const name = assertCanonicalString(entry.name, `${label}.name`)
    if (names.has(name)) fail('The Playwright browser manifest must not contain duplicates.')
    names.add(name)
    assertCanonicalString(entry.revision, `${label}.revision`)
    if (typeof entry.installByDefault !== 'boolean') {
      fail(`${label}.installByDefault must be boolean.`)
    }
    if (Object.hasOwn(entry, 'browserVersion')) {
      assertCanonicalString(entry.browserVersion, `${label}.browserVersion`)
    }
  }
  for (const requiredName of ['chromium', 'firefox', 'webkit']) {
    if (!names.has(requiredName)) {
      fail(`The Playwright browser manifest is missing ${requiredName}.`)
    }
  }
}

function validateLocale(locale, target, expectedUrl, expectedSha256) {
  const label = `evidence.browsers.${target}.locales.${locale?.applicationLanguage ?? 'unknown'}`
  assertExactKeys(
    locale,
    [
      'applicationLanguage',
      'browserLocale',
      'expectedDirection',
      'documentLanguage',
      'direction',
      'navigatorLanguage',
      'navigatorLanguages',
      'directoryPickerDisabled',
      'openFilePickerDisabled',
      'finalUrl',
      'navigationSourceSha256',
      'navigationSha256',
      'navigationBinding',
      'result'
    ],
    label
  )
  const expected = EXPECTED_LOCALES.get(locale.applicationLanguage)
  if (!expected) fail(`${label}.applicationLanguage is not an expected locale.`)
  if (
    locale.browserLocale !== expected.browserLocale ||
    locale.expectedDirection !== expected.direction ||
    locale.documentLanguage !== locale.applicationLanguage ||
    locale.direction !== expected.direction ||
    locale.navigatorLanguage !== expected.browserLocale ||
    !Array.isArray(locale.navigatorLanguages) ||
    locale.navigatorLanguages.length !== 1 ||
    locale.navigatorLanguages[0] !== expected.browserLocale
  ) {
    fail(`${label} does not match the required EN/AR locale observation.`)
  }
  if (
    locale.directoryPickerDisabled !== true ||
    locale.openFilePickerDisabled !== true ||
    locale.result !== 'passed'
  ) {
    fail(`${label} did not pass the isolated browser observation.`)
  }
  if (locale.finalUrl !== expectedUrl) {
    fail(`${label}.finalUrl differs from the canonical production URL.`)
  }
  if (
    locale.navigationSourceSha256 !== expectedSha256 ||
    locale.navigationSha256 !== expectedSha256
  ) {
    fail(`${label} is not bound to the exact Pages artifact bytes.`)
  }
  if (locale.navigationBinding !== EXPECTED_NAVIGATION_BINDING) {
    fail(`${label}.navigationBinding does not prove fulfilled-response byte binding.`)
  }
  return locale.applicationLanguage
}

function validateBrowser(browser, expectedUrl, expectedSha256) {
  const label = `evidence.browsers.${browser?.target ?? 'unknown'}`
  assertExactKeys(
    browser,
    ['target', 'classification', 'channel', 'version', 'userAgent', 'platform', 'locales'],
    label
  )
  const expected = EXPECTED_TARGETS.get(browser.target)
  if (!expected) fail(`${label}.target is not an expected Pages browser target.`)
  if (browser.classification !== expected.classification || browser.channel !== expected.channel) {
    fail(`${label} has an unexpected browser classification or channel.`)
  }
  assertCanonicalString(browser.version, `${label}.version`)
  assertCanonicalString(browser.userAgent, `${label}.userAgent`)
  assertCanonicalString(browser.platform, `${label}.platform`)
  if (!Array.isArray(browser.locales) || browser.locales.length !== EXPECTED_LOCALES.size) {
    fail(`${label}.locales must contain exactly the EN and AR observations.`)
  }
  const observedLocales = new Set(
    browser.locales.map((locale) =>
      validateLocale(locale, browser.target, expectedUrl, expectedSha256)
    )
  )
  if (
    observedLocales.size !== EXPECTED_LOCALES.size ||
    [...EXPECTED_LOCALES.keys()].some((locale) => !observedLocales.has(locale))
  ) {
    fail(`${label}.locales must contain distinct EN and AR observations.`)
  }
  return browser.target
}

export function verifyPagesEvidence(
  evidence,
  { candidateSha, artifactPath, url, runId, repository }
) {
  const expectedCandidateSha = assertLowerSha(candidateSha, 40, '--candidate-sha')
  const expectedRunId = assertPositiveDecimal(runId, '--run-id')
  const expectedRepository = assertCanonicalString(repository, '--repository')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/u.test(expectedRepository)) {
    fail('--repository must be a canonical owner/repository identifier.')
  }
  const expectedUrl = canonicalHttpsUrl(url, '--url')
  const artifact = captureArtifact(artifactPath)

  assertExactKeys(
    evidence,
    [
      'schemaVersion',
      'gate',
      'result',
      'generatedAt',
      'candidateSha',
      'artifact',
      'testedUrl',
      'servedFinalUrl',
      'servedSha256',
      'runner',
      'runtime',
      'workflow',
      'testEnvironment',
      'browsers'
    ],
    'evidence'
  )
  assertAllStringsSafe(evidence)
  if (evidence.schemaVersion !== 1) fail('evidence.schemaVersion must be 1.')
  if (evidence.gate !== 'orbitpm-lite-browser-environment') {
    fail('evidence.gate is invalid.')
  }
  if (evidence.result !== 'passed') fail('evidence.result must be passed.')
  assertCanonicalTimestamp(evidence.generatedAt, 'evidence.generatedAt')
  assertLowerSha(evidence.candidateSha, 40, 'evidence.candidateSha')
  if (evidence.candidateSha !== expectedCandidateSha) {
    fail('evidence.candidateSha differs from the trusted candidate.')
  }

  assertExactKeys(evidence.artifact, ['path', 'sha256'], 'evidence.artifact')
  if (
    !isAbsolute(evidence.artifact.path) ||
    assertLowerSha(evidence.artifact.sha256, 64, 'evidence.artifact.sha256') !== artifact.sha256
  ) {
    fail('evidence.artifact is not bound to the exact local Pages artifact.')
  }
  if (
    canonicalHttpsUrl(evidence.testedUrl, 'evidence.testedUrl') !== expectedUrl ||
    canonicalHttpsUrl(evidence.servedFinalUrl, 'evidence.servedFinalUrl') !== expectedUrl
  ) {
    fail('The tested and served URLs must equal the canonical production URL.')
  }
  if (assertLowerSha(evidence.servedSha256, 64, 'evidence.servedSha256') !== artifact.sha256) {
    fail('evidence.servedSha256 differs from the exact local Pages artifact.')
  }

  assertExactKeys(
    evidence.runner,
    [
      'platform',
      'architecture',
      'kernelRelease',
      'imageOs',
      'imageVersion',
      'runnerOs',
      'runnerArchitecture'
    ],
    'evidence.runner'
  )
  for (const [key, value] of Object.entries(evidence.runner)) {
    assertCanonicalString(value, `evidence.runner.${key}`)
  }
  if (evidence.runner.platform !== 'linux') {
    fail('Pages browser evidence must come from the Linux deployment runner.')
  }

  assertExactKeys(
    evidence.runtime,
    ['node', 'declaredPackageManager', 'playwright', 'playwrightBrowsers'],
    'evidence.runtime'
  )
  for (const key of ['node', 'declaredPackageManager', 'playwright']) {
    assertCanonicalString(evidence.runtime[key], `evidence.runtime.${key}`)
  }
  validatePlaywrightBrowserManifest(evidence.runtime.playwrightBrowsers)

  assertExactKeys(
    evidence.workflow,
    ['repository', 'runId', 'runAttempt', 'workflow', 'job'],
    'evidence.workflow'
  )
  if (
    evidence.workflow.repository !== expectedRepository ||
    evidence.workflow.runId !== expectedRunId ||
    evidence.workflow.workflow !== EXPECTED_WORKFLOW ||
    evidence.workflow.job !== EXPECTED_JOB
  ) {
    fail('evidence.workflow does not match the trusted Pages workflow run.')
  }
  assertPositiveDecimal(evidence.workflow.runAttempt, 'evidence.workflow.runAttempt')

  assertExactKeys(
    evidence.testEnvironment,
    [
      'headless',
      'fileSystemAccessPickerOverrides',
      'externalExecutionConstructors',
      'mainDocumentBinding',
      'remoteBodyByteLimit',
      'remoteRequestTimeoutMs'
    ],
    'evidence.testEnvironment'
  )
  if (
    evidence.testEnvironment.headless !== true ||
    evidence.testEnvironment.fileSystemAccessPickerOverrides !== 'disabled' ||
    evidence.testEnvironment.externalExecutionConstructors !== 'disabled' ||
    evidence.testEnvironment.mainDocumentBinding !== 'recorded-per-navigation' ||
    evidence.testEnvironment.remoteBodyByteLimit !== artifact.size ||
    !Number.isInteger(evidence.testEnvironment.remoteRequestTimeoutMs) ||
    evidence.testEnvironment.remoteRequestTimeoutMs < 1 ||
    evidence.testEnvironment.remoteRequestTimeoutMs > 120_000
  ) {
    fail('evidence.testEnvironment does not match the fail-closed Pages test environment.')
  }

  if (!Array.isArray(evidence.browsers) || evidence.browsers.length !== EXPECTED_TARGETS.size) {
    fail('evidence.browsers must contain exactly the five required browser targets.')
  }
  const observedTargets = new Set(
    evidence.browsers.map((browser) => validateBrowser(browser, expectedUrl, artifact.sha256))
  )
  if (
    observedTargets.size !== EXPECTED_TARGETS.size ||
    [...EXPECTED_TARGETS.keys()].some((target) => !observedTargets.has(target))
  ) {
    fail('evidence.browsers must contain five distinct required browser targets.')
  }

  return {
    candidateSha: expectedCandidateSha,
    artifactSha256: artifact.sha256,
    url: expectedUrl,
    runId: expectedRunId,
    repository: expectedRepository
  }
}

function parseCli(arguments_) {
  const [command, ...rawOptions] = arguments_
  if (command !== 'verify') fail('Expected command verify.')
  const allowed = new Set(['evidence', 'candidate-sha', 'artifact', 'url', 'run-id', 'repository'])
  const options = new Map()
  for (const argument of rawOptions) {
    const separator = argument.indexOf('=')
    if (!argument.startsWith('--') || separator < 3) {
      fail('Every CLI option must use --name=value syntax.')
    }
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!allowed.has(name)) fail('An unsupported CLI option was provided.')
    if (!value) fail(`--${name} is required.`)
    if (options.has(name)) fail(`--${name} must be provided exactly once.`)
    options.set(name, value)
  }
  for (const name of allowed) {
    if (!options.has(name)) fail(`--${name} is required.`)
  }
  return options
}

function readEvidence(path) {
  const absolutePath = resolve(path)
  const descriptor = openSync(absolutePath, 'r')
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_EVIDENCE_BYTES) {
      fail(
        `The Pages evidence must be a regular JSON file containing 2 through ${MAX_EVIDENCE_BYTES} bytes.`
      )
    }
    return JSON.parse(readFileSync(descriptor, 'utf8'))
  } finally {
    closeSync(descriptor)
  }
}

function main() {
  const options = parseCli(process.argv.slice(2))
  const evidence = readEvidence(options.get('evidence'))
  const verified = verifyPagesEvidence(evidence, {
    candidateSha: options.get('candidate-sha'),
    artifactPath: options.get('artifact'),
    url: options.get('url'),
    runId: options.get('run-id'),
    repository: options.get('repository')
  })
  console.log(
    `Verified Pages browser evidence for ${verified.candidateSha} in workflow run ${verified.runId}.`
  )
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).toString() === import.meta.url) {
  main()
}
