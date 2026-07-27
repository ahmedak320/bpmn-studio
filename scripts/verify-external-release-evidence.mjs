import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MANIFEST_SCHEMA_VERSION = 2
const SUPPORT_SCHEMA_VERSION = 1
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_SUPPORT_BYTES = 256 * 1024
const MAX_AUTOMATED_SOAK_GATE_BYTES = 16 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 0
const MIN_SOAK_DURATION_MS = 48 * 60 * 60 * 1000
const MAX_SAMPLE_INTERVAL_MINUTES = 60
const SAMPLE_GRACE_MS = 5 * 60 * 1000
const MAX_DECLARED_MEMORY_GROWTH_BYTES = 512 * 1024 * 1024
const MAX_DECLARED_STORAGE_GROWTH_BYTES = 512 * 1024 * 1024
const IMMUTABLE_EVIDENCE_OWNER = 'ahmedak320'
const IMMUTABLE_EVIDENCE_REPOSITORY = 'bpmn-studio'
const IMMUTABLE_EVIDENCE_PATH_PREFIX = ['release-evidence', 'v0.4.5']

const REQUIRED_LOCALES = ['en', 'ar']
const REQUIRED_SOAK_SCENARIOS = [
  'edits',
  'recovery',
  'workspace-switching',
  'imports',
  'translation-cancellation',
  'history-cleanup'
]
const REQUIRED_RETENTION_CHECKS = ['draft-recovery', 'history-retention', 'workspace-state']
const REQUIRED_AUTOMATED_SOAK_SAMPLE_FIELDS = [
  'capturedAt',
  'elapsedMs',
  'residentMemoryBytes',
  'storageBytes',
  'locale',
  'scenario',
  'healthy',
  'sequence',
  'completedOperations',
  'completedScenarioCycles'
]
const REQUIRED_LEDGER_RECORDS = ['soak', 'nvdaWindows', 'voiceOverMacos', 'arabicScreenReader']
const ASSISTIVE_TECHNOLOGY_REQUIREMENTS = {
  nvdaWindows: {
    evidenceType: 'orbitpm-lite-nvda-windows',
    locale: 'en',
    scenarios: ['keyboard-authoring', 'focus-announcements', 'modal-dialog-navigation'],
    operatingSystemPattern: /^Windows\b/i,
    assistiveTechnologyPattern: /^NVDA\b/i,
    browserPattern: /^(?:Google Chrome|Chromium|Microsoft Edge|Mozilla Firefox)$/i
  },
  voiceOverMacos: {
    evidenceType: 'orbitpm-lite-voiceover-macos',
    locale: 'en',
    scenarios: ['keyboard-authoring', 'focus-announcements', 'modal-dialog-navigation'],
    operatingSystemPattern: /^macOS\b/i,
    assistiveTechnologyPattern: /^VoiceOver\b/i,
    browserPattern: /^Safari$/i
  },
  arabicScreenReader: {
    evidenceType: 'orbitpm-lite-arabic-screen-reader',
    locale: 'ar',
    scenarios: ['language-change', 'mixed-language-pronunciation', 'rtl-navigation'],
    operatingSystemPattern: /^(?:Windows|macOS)\b/i,
    assistiveTechnologyPattern: /^(?:NVDA|VoiceOver|JAWS)\b/i,
    browserPattern: /^(?:Google Chrome|Chromium|Microsoft Edge|Mozilla Firefox|Safari)$/i,
    requiresArabicFindings: true
  }
}

const PLACEHOLDER_PATTERN =
  /\b(?:placeholder|replace(?:\s+with)?|example|dummy|fake|unknown|sample|test user|john doe|jane doe|tbd|todo|n a|none)\b/i
const IDENTITY_NAME_PLACEHOLDER_PATTERN =
  /\b(?:placeholder|replace(?:\s+with)?|example|dummy|fake|unknown|sample|test user|john doe|jane doe|reviewer|signatory|operator|tbd|todo|n a|none)\b/i
const AUTOMATION_IDENTITY_PATTERN =
  /\b(?:bot|robot|automation|automated|github actions|ci(?:\/cd)?|service account)\b/i

function option(name, fallback, argv = process.argv.slice(2)) {
  const prefix = `${name}=`
  const argument = argv.find((candidate) => candidate.startsWith(prefix))
  return argument?.slice(prefix.length) ?? fallback
}

export function requiredString(value, label, { minLength = 1, maxLength = 500 } = {}) {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    throw new Error(
      `${label} must be a trimmed string between ${minLength} and ${maxLength} characters.`
    )
  }
  return value
}

function normalizedWords(value) {
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function containsPlaceholder(value, pattern) {
  return pattern.test(normalizedWords(value))
}

export function containsArabicDetail(value) {
  return (
    (value.match(/\p{Script=Arabic}[\p{M}]*\p{Script=Arabic}[\p{Script=Arabic}\p{M}]*/gu) ?? [])
      .length >= 4
  )
}

export function substantiveString(
  value,
  label,
  { minLength = 20, maxLength = 2_000, minWords = 4 } = {}
) {
  const result = requiredString(value, label, { minLength, maxLength })
  if (containsPlaceholder(result, PLACEHOLDER_PATTERN)) {
    throw new Error(`${label} must contain substantive, non-placeholder findings.`)
  }
  const words = result.match(/[\p{L}\p{N}]+/gu) ?? []
  const uniqueWords = new Set(words.map((word) => word.toLocaleLowerCase('en-US')))
  if (words.length < minWords || uniqueWords.size < Math.min(3, minWords)) {
    throw new Error(`${label} must contain substantive, non-repetitive detail.`)
  }
  return result
}

export function requiredSha256(value, label) {
  const digest = requiredString(value, label, { minLength: 64, maxLength: 64 }).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${label} must be a 64-character SHA-256 digest.`)
  }
  if (/^0{64}$/.test(digest)) {
    throw new Error(`${label} must not be the all-zero placeholder digest.`)
  }
  return digest
}

export function requiredCandidateSha(value, label) {
  const digest = requiredString(value, label, { minLength: 40, maxLength: 40 }).toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(digest) || /^0{40}$/.test(digest)) {
    throw new Error(`${label} must be an exact, non-zero 40-character Git commit SHA.`)
  }
  return digest
}

export function requiredHttpsUrl(value, label) {
  const raw = requiredString(value, label, { maxLength: 2_048 })
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} must be a valid credential-free HTTPS URL.`)
  }
  const hostname = url.hostname.toLowerCase()
  const canonicalHostname = hostname.replace(/\.$/, '')
  if (
    url.protocol !== 'https:' ||
    !hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    raw.includes('?') ||
    raw.includes('#') ||
    /[\s<>`]/.test(raw)
  ) {
    throw new Error(
      `${label} must be a credential-free HTTPS URL without a query string or fragment.`
    )
  }
  if (
    canonicalHostname === 'localhost' ||
    canonicalHostname.endsWith('.localhost') ||
    canonicalHostname.endsWith('.local') ||
    canonicalHostname === 'invalid' ||
    canonicalHostname.endsWith('.invalid') ||
    canonicalHostname === 'test' ||
    canonicalHostname.endsWith('.test') ||
    canonicalHostname === 'example' ||
    canonicalHostname.endsWith('.example') ||
    canonicalHostname === 'example.com' ||
    canonicalHostname.endsWith('.example.com') ||
    canonicalHostname === 'example.net' ||
    canonicalHostname.endsWith('.example.net') ||
    canonicalHostname === 'example.org' ||
    canonicalHostname.endsWith('.example.org') ||
    canonicalHostname.includes('_') ||
    isIP(canonicalHostname.replace(/^\[|\]$/g, '')) !== 0
  ) {
    throw new Error(`${label} must identify a public, non-placeholder HTTPS host.`)
  }
  return url.toString()
}

export function requiredImmutableEvidenceUrl(value, label) {
  const canonicalUrl = requiredHttpsUrl(value, label)
  if (value !== canonicalUrl) {
    throw new Error(`${label} must be a canonical immutable evidence URL.`)
  }
  const url = new URL(canonicalUrl)
  const segments = url.pathname.split('/').slice(1)
  const [owner, repository, revision, ...recordPath] = segments
  if (
    url.hostname !== 'raw.githubusercontent.com' ||
    url.port ||
    owner !== IMMUTABLE_EVIDENCE_OWNER ||
    repository !== IMMUTABLE_EVIDENCE_REPOSITORY ||
    !/^[a-f0-9]{40}$/.test(revision ?? '') ||
    /^0{40}$/.test(revision ?? '') ||
    recordPath.length <= IMMUTABLE_EVIDENCE_PATH_PREFIX.length ||
    IMMUTABLE_EVIDENCE_PATH_PREFIX.some((segment, index) => recordPath[index] !== segment) ||
    recordPath.some(
      (segment) => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..'
    ) ||
    !recordPath.at(-1)?.endsWith('.json') ||
    canonicalUrl.includes('%')
  ) {
    throw new Error(
      `${label} must be a canonical raw.githubusercontent.com/${IMMUTABLE_EVIDENCE_OWNER}/${IMMUTABLE_EVIDENCE_REPOSITORY}/<40-character-commit>/${IMMUTABLE_EVIDENCE_PATH_PREFIX.join('/')}/...json URL.`
    )
  }
  return canonicalUrl
}

export function requiredTimestamp(value, label, now) {
  const timestamp = requiredString(value, label, { minLength: 1, maxLength: 100 })
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical UTC ISO-8601 timestamp with milliseconds.`)
  }
  if (parsed > now + MAX_CLOCK_SKEW_MS) {
    throw new Error(`${label} must not be in the future.`)
  }
  if (parsed < now - MAX_EVIDENCE_AGE_MS) {
    throw new Error(`${label} is older than the 30-day release-evidence window.`)
  }
  return parsed
}

export function requiredArray(value, label, { minLength = 1 } = {}) {
  if (!Array.isArray(value) || value.length < minLength) {
    throw new Error(`${label} must be an array containing at least ${minLength} item(s).`)
  }
  return value
}

export function requireExactSet(values, requiredValues, label) {
  const array = requiredArray(values, label, { minLength: requiredValues.length })
  if (array.some((value) => typeof value !== 'string')) {
    throw new Error(`${label} must contain only strings.`)
  }
  if (new Set(array).size !== array.length) {
    throw new Error(`${label} must not contain duplicate values.`)
  }
  if (
    array.length !== requiredValues.length ||
    requiredValues.some((required) => !array.includes(required))
  ) {
    throw new Error(`${label} must contain exactly: ${requiredValues.join(', ')}.`)
  }
  return array
}

function normalizedIdentityName(identity) {
  return identity.name
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function requiredAccountId(value, label) {
  const accountId = requiredString(value, label, { minLength: 5, maxLength: 160 })
  if (
    !/^[a-z][a-z0-9.-]{1,31}:[A-Za-z0-9](?:[A-Za-z0-9._@/-]{1,126}[A-Za-z0-9])?$/.test(accountId) ||
    containsPlaceholder(accountId, PLACEHOLDER_PATTERN) ||
    containsPlaceholder(accountId, AUTOMATION_IDENTITY_PATTERN)
  ) {
    throw new Error(
      `${label} must be a stable, non-placeholder account identifier such as github:username.`
    )
  }
  return accountId
}

export function requiredHumanIdentity(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a structured human identity.`)
  }
  const name = requiredString(value.name, `${label}.name`, { minLength: 5, maxLength: 120 })
  const nameParts = name
    .split(/\s+/u)
    .filter((part) => (part.match(/[\p{L}\p{M}]/gu) ?? []).length >= 2)
  if (
    nameParts.length < 2 ||
    containsPlaceholder(name, IDENTITY_NAME_PLACEHOLDER_PATTERN) ||
    containsPlaceholder(name, AUTOMATION_IDENTITY_PATTERN)
  ) {
    throw new Error(`${label}.name must identify a non-placeholder human by full name.`)
  }
  const organization = requiredString(value.organization, `${label}.organization`, {
    minLength: 3,
    maxLength: 160
  })
  const role = requiredString(value.role, `${label}.role`, {
    minLength: 3,
    maxLength: 160
  })
  const accountId = requiredAccountId(value.accountId, `${label}.accountId`)
  if (
    containsPlaceholder(organization, PLACEHOLDER_PATTERN) ||
    containsPlaceholder(organization, AUTOMATION_IDENTITY_PATTERN) ||
    containsPlaceholder(role, PLACEHOLDER_PATTERN) ||
    containsPlaceholder(role, AUTOMATION_IDENTITY_PATTERN)
  ) {
    throw new Error(`${label} must identify a substantive human organization and role.`)
  }
  return { name, organization, role, accountId }
}

export function sameIdentity(left, right) {
  return (
    normalizedIdentityName(left) === normalizedIdentityName(right) ||
    left.accountId.toLocaleLowerCase('en-US') === right.accountId.toLocaleLowerCase('en-US')
  )
}

function requireBoundRecord(record, expectedType, candidateSha, artifactSha256, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  if (record.schemaVersion !== SUPPORT_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion must be ${SUPPORT_SCHEMA_VERSION}.`)
  }
  if (record.evidenceType !== expectedType) {
    throw new Error(`${label}.evidenceType must be ${expectedType}.`)
  }
  if (requiredCandidateSha(record.candidateSha, `${label}.candidateSha`) !== candidateSha) {
    throw new Error(`${label} is not bound to the exact candidate SHA.`)
  }
  if (requiredSha256(record.artifactSha256, `${label}.artifactSha256`) !== artifactSha256) {
    throw new Error(`${label} is not bound to the exact artifact SHA-256.`)
  }
}

function requireMatchingIdentity(actual, expected, label) {
  const validated = requiredHumanIdentity(actual, label)
  if (
    validated.name !== expected.name ||
    validated.organization !== expected.organization ||
    validated.role !== expected.role ||
    validated.accountId !== expected.accountId
  ) {
    throw new Error(`${label} does not match the SHA-pinned top-level evidence manifest.`)
  }
  return validated
}

async function readWithAbort(reader, signal, label) {
  if (signal.aborted) {
    throw new Error(`${label} exceeded the evidence-fetch timeout.`)
  }
  let abortHandler
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        abortHandler = () => reject(new Error(`${label} exceeded the evidence-fetch timeout.`))
        signal.addEventListener('abort', abortHandler, { once: true })
      })
    ])
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler)
  }
}

export async function readBodyWithLimit(response, maxBytes, label, signal) {
  const declaredLength = response.headers?.get?.('content-length')
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes}-byte verification limit.`)
    }
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`${label} did not return a readable response body.`)
  }

  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, signal, label)
      if (done) break
      if (!(value instanceof Uint8Array)) {
        throw new Error(`${label} returned a non-byte response chunk.`)
      }
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new Error(`${label} exceeds the ${maxBytes}-byte verification limit.`)
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

export async function fetchVerifiedJson({
  url,
  expectedSha256,
  label,
  maxBytes,
  fetchImpl,
  timeoutMs
}) {
  const requestedUrl = requiredImmutableEvidenceUrl(url, `${label}.url`)
  const expectedDigest = requiredSha256(expectedSha256, `${label}.sha256`)
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await fetchImpl(requestedUrl, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`)
  }
  const finalUrl = requiredImmutableEvidenceUrl(response.url, `${label}.finalUrl`)
  if (finalUrl !== requestedUrl) {
    throw new Error(`${label} must not redirect; publish the exact final HTTPS URL.`)
  }
  const bytes = await readBodyWithLimit(response, maxBytes, label, signal)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedDigest) {
    throw new Error(`${label} SHA-256 ${sha256} does not match ${expectedDigest}.`)
  }

  let json
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON.`)
  }
  let record
  try {
    record = JSON.parse(json)
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
  return {
    requestedUrl,
    finalUrl,
    sha256,
    sizeBytes: bytes.byteLength,
    bodyBase64: bytes.toString('base64'),
    record
  }
}

function validateSoakSummary(soak, candidateReadyAt, now) {
  if (!soak || soak.passed !== true || soak.uninterrupted !== true) {
    throw new Error('soak must record passed=true and uninterrupted=true.')
  }
  const startedAt = requiredTimestamp(soak.startedAt, 'soak.startedAt', now)
  const completedAt = requiredTimestamp(soak.completedAt, 'soak.completedAt', now)
  if (startedAt < candidateReadyAt) {
    throw new Error('soak.startedAt must not predate the trusted candidate-ready instant.')
  }
  if (
    !Number.isSafeInteger(soak.durationMs) ||
    soak.durationMs < MIN_SOAK_DURATION_MS ||
    completedAt - startedAt !== soak.durationMs
  ) {
    throw new Error('soak must record one exact uninterrupted duration of at least 48 hours.')
  }
  requireExactSet(soak.locales, REQUIRED_LOCALES, 'soak.locales')
  requireExactSet(soak.scenarios, REQUIRED_SOAK_SCENARIOS, 'soak.scenarios')
  requireExactSet(soak.retentionChecks, REQUIRED_RETENTION_CHECKS, 'soak.retentionChecks')
  if (
    !Number.isSafeInteger(soak.sampleIntervalMinutes) ||
    soak.sampleIntervalMinutes < 1 ||
    soak.sampleIntervalMinutes > MAX_SAMPLE_INTERVAL_MINUTES
  ) {
    throw new Error('soak.sampleIntervalMinutes must be an integer from 1 through 60.')
  }
  if (soak.memoryGrowth !== 'bounded' || soak.storageGrowth !== 'bounded') {
    throw new Error('soak must record bounded memoryGrowth and storageGrowth.')
  }
  return {
    startedAt,
    completedAt,
    evidenceUrl: requiredHttpsUrl(soak.evidenceUrl, 'soak.evidenceUrl'),
    evidenceSha256: requiredSha256(soak.evidenceSha256, 'soak.evidenceSha256')
  }
}

function validateSoakRecord(record, summary, candidateSha, artifactSha256, now) {
  const label = 'supportingEvidence.soak'
  requireBoundRecord(record, 'orbitpm-lite-soak', candidateSha, artifactSha256, label)
  if (record.passed !== true || record.uninterrupted !== true || record.restarts !== 0) {
    throw new Error(`${label} must record passed=true, uninterrupted=true, and restarts=0.`)
  }
  const startedAt = requiredTimestamp(record.startedAt, `${label}.startedAt`, now)
  const completedAt = requiredTimestamp(record.completedAt, `${label}.completedAt`, now)
  if (
    startedAt !== summary.startedAt ||
    completedAt !== summary.completedAt ||
    record.durationMs !== completedAt - startedAt ||
    record.durationMs < MIN_SOAK_DURATION_MS
  ) {
    throw new Error(`${label} chronology must exactly match the top-level soak summary.`)
  }
  requireExactSet(record.locales, REQUIRED_LOCALES, `${label}.locales`)
  requireExactSet(record.scenarios, REQUIRED_SOAK_SCENARIOS, `${label}.scenarios`)
  if (record.sampleIntervalMinutes !== summary.sampleIntervalMinutes) {
    throw new Error(`${label}.sampleIntervalMinutes must match the top-level soak summary.`)
  }

  const samples = requiredArray(record.samples, `${label}.samples`, {
    minLength: Math.ceil(record.durationMs / (record.sampleIntervalMinutes * 60_000)) + 1
  })
  let previousSampleAt = null
  let firstMemoryBytes
  let firstStorageBytes
  let peakMemoryBytes = 0
  let peakStorageBytes = 0
  let previousCompletedOperations = -1
  const observedLocales = new Set()
  const localeSampleCounts = new Map(REQUIRED_LOCALES.map((locale) => [locale, 0]))
  const sampleScenarioCoverage = new Set()
  for (const [index, sample] of samples.entries()) {
    const sampleLabel = `${label}.samples[${index}]`
    const capturedAt = requiredTimestamp(sample?.capturedAt, `${sampleLabel}.capturedAt`, now)
    if (capturedAt < startedAt || capturedAt > completedAt) {
      throw new Error(`${sampleLabel}.capturedAt must fall inside the soak interval.`)
    }
    if (previousSampleAt !== null) {
      if (capturedAt <= previousSampleAt) {
        throw new Error(`${label}.samples must be strictly chronological.`)
      }
      const allowedGapMs = record.sampleIntervalMinutes * 60_000 + SAMPLE_GRACE_MS
      if (capturedAt - previousSampleAt > allowedGapMs) {
        throw new Error(`${label}.samples contain a gap larger than the declared interval.`)
      }
    }
    if (!Number.isSafeInteger(sample.residentMemoryBytes) || sample.residentMemoryBytes <= 0) {
      throw new Error(`${sampleLabel}.residentMemoryBytes must be a positive integer.`)
    }
    if (!Number.isSafeInteger(sample.storageBytes) || sample.storageBytes < 0) {
      throw new Error(`${sampleLabel}.storageBytes must be a non-negative integer.`)
    }
    if (!REQUIRED_LOCALES.includes(sample.locale)) {
      throw new Error(`${sampleLabel}.locale must be en or ar.`)
    }
    if (!REQUIRED_SOAK_SCENARIOS.includes(sample.scenario)) {
      throw new Error(`${sampleLabel}.scenario must identify a required soak scenario.`)
    }
    if (
      sample.healthy !== true ||
      sample.sequence !== index ||
      !Number.isSafeInteger(sample.completedOperations) ||
      (index === 0
        ? sample.completedOperations !== 0
        : sample.completedOperations <= previousCompletedOperations)
    ) {
      throw new Error(
        `${sampleLabel} must record healthy=true, its exact sequence, zero start operations, and strictly increasing cumulative completedOperations thereafter.`
      )
    }
    previousCompletedOperations = sample.completedOperations
    observedLocales.add(sample.locale)
    localeSampleCounts.set(sample.locale, localeSampleCounts.get(sample.locale) + 1)
    sampleScenarioCoverage.add(`${sample.locale}:${sample.scenario}`)
    firstMemoryBytes ??= sample.residentMemoryBytes
    firstStorageBytes ??= sample.storageBytes
    peakMemoryBytes = Math.max(peakMemoryBytes, sample.residentMemoryBytes)
    peakStorageBytes = Math.max(peakStorageBytes, sample.storageBytes)
    previousSampleAt = capturedAt
  }
  if (
    samples[0].capturedAt !== record.startedAt ||
    samples.at(-1).capturedAt !== record.completedAt
  ) {
    throw new Error(`${label}.samples must include the exact soak start and completion.`)
  }
  requireExactSet([...observedLocales], REQUIRED_LOCALES, `${label}.samples locales`)
  const minimumSamplesPerLocale = Math.ceil(samples.length / 4)
  for (const locale of REQUIRED_LOCALES) {
    if (localeSampleCounts.get(locale) < minimumSamplesPerLocale) {
      throw new Error(
        `${label}.samples must allocate at least one quarter of heartbeats to locale ${locale}.`
      )
    }
    for (const scenario of REQUIRED_SOAK_SCENARIOS) {
      if (!sampleScenarioCoverage.has(`${locale}:${scenario}`)) {
        throw new Error(`${label}.samples must exercise ${locale}:${scenario}.`)
      }
    }
  }

  if (
    !Number.isSafeInteger(record.maxResidentMemoryGrowthBytes) ||
    record.maxResidentMemoryGrowthBytes < 0 ||
    record.maxResidentMemoryGrowthBytes > MAX_DECLARED_MEMORY_GROWTH_BYTES ||
    !Number.isSafeInteger(record.maxStorageGrowthBytes) ||
    record.maxStorageGrowthBytes < 0 ||
    record.maxStorageGrowthBytes > MAX_DECLARED_STORAGE_GROWTH_BYTES
  ) {
    throw new Error(
      `${label} must declare memory and storage growth caps from zero through 512 MiB.`
    )
  }
  if (
    peakMemoryBytes - firstMemoryBytes > record.maxResidentMemoryGrowthBytes ||
    peakStorageBytes - firstStorageBytes > record.maxStorageGrowthBytes
  ) {
    throw new Error(`${label} samples exceed the declared bounded-growth caps.`)
  }

  const scenarioResults = requiredArray(record.scenarioResults, `${label}.scenarioResults`, {
    minLength: REQUIRED_LOCALES.length * REQUIRED_SOAK_SCENARIOS.length
  })
  const scenarioCoverage = new Set()
  for (const [index, result] of scenarioResults.entries()) {
    const resultLabel = `${label}.scenarioResults[${index}]`
    if (
      !REQUIRED_LOCALES.includes(result?.locale) ||
      !REQUIRED_SOAK_SCENARIOS.includes(result?.scenario) ||
      result.passed !== true
    ) {
      throw new Error(`${resultLabel} must identify a required locale/scenario with passed=true.`)
    }
    substantiveString(result.findings, `${resultLabel}.findings`)
    if (result.locale === 'ar' && !containsArabicDetail(result.findings)) {
      throw new Error(`${resultLabel}.findings must contain substantive Arabic-script detail.`)
    }
    const coverageKey = `${result.locale}:${result.scenario}`
    if (scenarioCoverage.has(coverageKey)) {
      throw new Error(`${label}.scenarioResults must not duplicate locale/scenario pairs.`)
    }
    scenarioCoverage.add(coverageKey)
  }
  for (const locale of REQUIRED_LOCALES) {
    for (const scenario of REQUIRED_SOAK_SCENARIOS) {
      if (!scenarioCoverage.has(`${locale}:${scenario}`)) {
        throw new Error(`${label}.scenarioResults must cover ${locale}:${scenario}.`)
      }
    }
  }

  const retentionResults = requiredArray(record.retentionResults, `${label}.retentionResults`, {
    minLength: REQUIRED_RETENTION_CHECKS.length
  })
  const retentionCoverage = new Set()
  for (const [index, result] of retentionResults.entries()) {
    const resultLabel = `${label}.retentionResults[${index}]`
    if (!REQUIRED_RETENTION_CHECKS.includes(result?.check) || result.passed !== true) {
      throw new Error(`${resultLabel} must identify a required retention check with passed=true.`)
    }
    substantiveString(result.findings, `${resultLabel}.findings`)
    if (retentionCoverage.has(result.check)) {
      throw new Error(`${label}.retentionResults must not contain duplicate checks.`)
    }
    retentionCoverage.add(result.check)
  }
  requireExactSet(
    [...retentionCoverage],
    REQUIRED_RETENTION_CHECKS,
    `${label}.retentionResults checks`
  )

  const operatorEntries = requiredArray(record.operators, `${label}.operators`, {
    minLength: REQUIRED_LOCALES.length
  })
  const operatorsByLocale = new Map()
  for (const [index, entry] of operatorEntries.entries()) {
    const operatorLabel = `${label}.operators[${index}]`
    if (!REQUIRED_LOCALES.includes(entry?.locale)) {
      throw new Error(`${operatorLabel}.locale must be en or ar.`)
    }
    if (operatorsByLocale.has(entry.locale)) {
      throw new Error(`${label}.operators must not duplicate locale assignments.`)
    }
    const operator = requiredHumanIdentity(entry.operator, `${operatorLabel}.operator`)
    const existingProfile = [...operatorsByLocale.values()].find((identity) =>
      sameIdentity(identity, operator)
    )
    if (
      existingProfile &&
      ['name', 'organization', 'role', 'accountId'].some(
        (field) => existingProfile[field] !== operator[field]
      )
    ) {
      throw new Error(
        `${label}.operators must use one stable profile when an operator covers both locales.`
      )
    }
    const observedAt = requiredTimestamp(entry.observedAt, `${operatorLabel}.observedAt`, now)
    if (observedAt < startedAt || observedAt > completedAt) {
      throw new Error(`${operatorLabel}.observedAt must fall inside the soak interval.`)
    }
    substantiveString(entry.findings, `${operatorLabel}.findings`, { minLength: 40 })
    if (entry.locale === 'ar' && !containsArabicDetail(entry.findings)) {
      throw new Error(`${operatorLabel}.findings must contain substantive Arabic-script detail.`)
    }
    operatorsByLocale.set(entry.locale, operator)
  }
  requireExactSet([...operatorsByLocale.keys()], REQUIRED_LOCALES, `${label}.operators locales`)
  const operators = [...operatorsByLocale.values()]

  if (!record.attestation || record.attestation.independentOfOperators !== true) {
    throw new Error(`${label}.attestation.independentOfOperators must be true.`)
  }
  const attestedBy = requiredHumanIdentity(
    record.attestation.attestedBy,
    `${label}.attestation.attestedBy`
  )
  if (operators.some((operator) => sameIdentity(attestedBy, operator))) {
    throw new Error(`${label}.attestation must be signed by a human independent of the operators.`)
  }
  const attestedAt = requiredTimestamp(
    record.attestation.attestedAt,
    `${label}.attestation.attestedAt`,
    now
  )
  if (attestedAt <= completedAt) {
    throw new Error(`${label}.attestation.attestedAt must postdate soak completion.`)
  }
  substantiveString(record.attestation.findings, `${label}.attestation.findings`, {
    minLength: 40
  })
  substantiveString(record.findings, `${label}.findings`, { minLength: 40 })
  return {
    automatedGateEvidenceUrl: requiredHttpsUrl(
      record.automatedGateEvidenceUrl,
      `${label}.automatedGateEvidenceUrl`
    ),
    automatedGateEvidenceSha256: requiredSha256(
      record.automatedGateEvidenceSha256,
      `${label}.automatedGateEvidenceSha256`
    ),
    attestedAt,
    operatorIdentities: operators
  }
}

function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return value
}

function requiredNonNegativeSafeInteger(value, label, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive' : 'non-negative'} safe integer.`)
  }
  return value
}

function validateAutomatedSoakGate(record, summary, candidateSha, artifactSha256, now) {
  const label = 'supportingEvidence.automatedSoakGate'
  requiredObject(record, label)
  if (record.schemaVersion !== SUPPORT_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion must be ${SUPPORT_SCHEMA_VERSION}.`)
  }
  if (record.evidenceType !== 'orbitpm-lite-soak-automation') {
    throw new Error(`${label}.evidenceType must be orbitpm-lite-soak-automation.`)
  }
  if (requiredCandidateSha(record.candidateSha, `${label}.candidateSha`) !== candidateSha) {
    throw new Error(`${label} is not bound to the exact candidate SHA.`)
  }
  if (requiredSha256(record.artifactSha256, `${label}.artifactSha256`) !== artifactSha256) {
    throw new Error(`${label} is not bound to the exact artifact SHA-256.`)
  }
  if (
    record.status !== 'passed' ||
    record.harnessPassed !== true ||
    record.passed !== true ||
    record.releaseEligible !== true ||
    record.smoke !== false ||
    record.uninterrupted !== true ||
    record.restarts !== 0
  ) {
    throw new Error(
      `${label} must record a passed, release-eligible, non-smoke, uninterrupted harness run with zero restarts.`
    )
  }

  const startedAt = requiredTimestamp(record.startedAt, `${label}.startedAt`, now)
  const completedAt = requiredTimestamp(record.completedAt, `${label}.completedAt`, now)
  if (
    startedAt !== summary.startedAt ||
    completedAt !== summary.completedAt ||
    record.durationMs !== completedAt - startedAt ||
    record.durationMs < MIN_SOAK_DURATION_MS ||
    record.durationRequirementMs !== MIN_SOAK_DURATION_MS ||
    record.durationRequirementSatisfied !== true
  ) {
    throw new Error(
      `${label} must exactly match the human wrapper chronology and satisfy the 48-hour requirement.`
    )
  }
  requireExactSet(record.locales, REQUIRED_LOCALES, `${label}.locales`)
  requireExactSet(record.scenarios, REQUIRED_SOAK_SCENARIOS, `${label}.scenarios`)
  requireExactSet(record.retentionChecks, REQUIRED_RETENTION_CHECKS, `${label}.retentionChecks`)
  if (record.sampleIntervalMinutes !== summary.sampleIntervalMinutes) {
    throw new Error(`${label}.sampleIntervalMinutes must match the human soak wrapper.`)
  }

  const samples = requiredArray(record.samples, `${label}.samples`, {
    minLength: Math.ceil(record.durationMs / (record.sampleIntervalMinutes * 60_000)) + 1
  })
  const observedLocales = new Set()
  const scenarioCoverage = new Set()
  let previousCapturedAt = null
  let previousElapsedMs = -1
  let previousCompletedOperations = -1
  let firstResidentMemoryBytes
  let firstStorageBytes
  let peakResidentMemoryBytes = 0
  let peakStorageBytes = 0
  for (const [index, sample] of samples.entries()) {
    const sampleLabel = `${label}.samples[${index}]`
    requiredObject(sample, sampleLabel)
    for (const field of REQUIRED_AUTOMATED_SOAK_SAMPLE_FIELDS) {
      if (!(field in sample)) {
        throw new Error(`${sampleLabel}.${field} is required.`)
      }
    }
    const capturedAt = requiredTimestamp(sample.capturedAt, `${sampleLabel}.capturedAt`, now)
    if (capturedAt < startedAt || capturedAt > completedAt) {
      throw new Error(`${sampleLabel}.capturedAt must fall inside the automated soak interval.`)
    }
    if (previousCapturedAt !== null) {
      const allowedGapMs = record.sampleIntervalMinutes * 60_000 + SAMPLE_GRACE_MS
      if (capturedAt <= previousCapturedAt || capturedAt - previousCapturedAt > allowedGapMs) {
        throw new Error(
          `${label}.samples must be strictly chronological without a gap larger than the declared interval.`
        )
      }
    }
    const elapsedMs = requiredNonNegativeSafeInteger(sample.elapsedMs, `${sampleLabel}.elapsedMs`)
    if ((index === 0 && elapsedMs !== 0) || elapsedMs <= previousElapsedMs) {
      throw new Error(
        `${label}.samples must start at elapsedMs=0 and then strictly increase elapsed time.`
      )
    }
    if (
      !Number.isSafeInteger(sample.residentMemoryBytes) ||
      sample.residentMemoryBytes <= 0 ||
      !Number.isSafeInteger(sample.storageBytes) ||
      sample.storageBytes < 0
    ) {
      throw new Error(`${sampleLabel} must contain valid memory and storage byte measurements.`)
    }
    if (
      !REQUIRED_LOCALES.includes(sample.locale) ||
      !REQUIRED_SOAK_SCENARIOS.includes(sample.scenario)
    ) {
      throw new Error(`${sampleLabel} must identify a required locale and scenario.`)
    }
    const completedOperations = requiredNonNegativeSafeInteger(
      sample.completedOperations,
      `${sampleLabel}.completedOperations`
    )
    const completedScenarioCycles = requiredNonNegativeSafeInteger(
      sample.completedScenarioCycles,
      `${sampleLabel}.completedScenarioCycles`
    )
    if (
      sample.healthy !== true ||
      sample.sequence !== index ||
      (index === 0
        ? completedOperations !== 0 || completedScenarioCycles !== 0
        : completedOperations <= previousCompletedOperations)
    ) {
      throw new Error(
        `${sampleLabel} must be healthy, sequential, and contain truthful cumulative operation and scenario-cycle counts.`
      )
    }
    observedLocales.add(sample.locale)
    scenarioCoverage.add(`${sample.locale}:${sample.scenario}`)
    firstResidentMemoryBytes ??= sample.residentMemoryBytes
    firstStorageBytes ??= sample.storageBytes
    peakResidentMemoryBytes = Math.max(peakResidentMemoryBytes, sample.residentMemoryBytes)
    peakStorageBytes = Math.max(peakStorageBytes, sample.storageBytes)
    previousCapturedAt = capturedAt
    previousElapsedMs = elapsedMs
    previousCompletedOperations = completedOperations
  }
  if (
    samples[0].capturedAt !== record.startedAt ||
    samples.at(-1).capturedAt !== record.completedAt ||
    samples.at(-1).elapsedMs < MIN_SOAK_DURATION_MS
  ) {
    throw new Error(
      `${label}.samples must cover the exact wall-clock interval and at least 48 monotonic hours.`
    )
  }
  requireExactSet([...observedLocales], REQUIRED_LOCALES, `${label}.samples locales`)
  for (const locale of REQUIRED_LOCALES) {
    for (const scenario of REQUIRED_SOAK_SCENARIOS) {
      if (!scenarioCoverage.has(`${locale}:${scenario}`)) {
        throw new Error(`${label}.samples must exercise ${locale}:${scenario}.`)
      }
    }
  }

  for (const [value, valueLabel] of [
    [record.maxResidentMemoryGrowthBytes, `${label}.maxResidentMemoryGrowthBytes`],
    [record.maxStorageGrowthBytes, `${label}.maxStorageGrowthBytes`],
    [record.observedResidentMemoryGrowthBytes, `${label}.observedResidentMemoryGrowthBytes`],
    [record.observedStorageGrowthBytes, `${label}.observedStorageGrowthBytes`]
  ]) {
    requiredNonNegativeSafeInteger(value, valueLabel)
  }
  if (
    record.maxResidentMemoryGrowthBytes > MAX_DECLARED_MEMORY_GROWTH_BYTES ||
    record.maxStorageGrowthBytes > MAX_DECLARED_STORAGE_GROWTH_BYTES ||
    record.observedResidentMemoryGrowthBytes !==
      Math.max(0, peakResidentMemoryBytes - firstResidentMemoryBytes) ||
    record.observedStorageGrowthBytes !== Math.max(0, peakStorageBytes - firstStorageBytes) ||
    record.observedResidentMemoryGrowthBytes > record.maxResidentMemoryGrowthBytes ||
    record.observedStorageGrowthBytes > record.maxStorageGrowthBytes
  ) {
    throw new Error(`${label} automated samples do not satisfy their exact bounded-growth claims.`)
  }

  const automatedScenarioResults = requiredArray(
    record.scenarioResults,
    `${label}.scenarioResults`,
    { minLength: REQUIRED_LOCALES.length * REQUIRED_SOAK_SCENARIOS.length }
  )
  const automatedScenarioCoverage = new Set()
  for (const [index, result] of automatedScenarioResults.entries()) {
    const resultLabel = `${label}.scenarioResults[${index}]`
    if (
      !REQUIRED_LOCALES.includes(result?.locale) ||
      !REQUIRED_SOAK_SCENARIOS.includes(result?.scenario) ||
      result.passed !== true
    ) {
      throw new Error(`${resultLabel} must identify a passed required locale/scenario.`)
    }
    requiredNonNegativeSafeInteger(result.completedCycles, `${resultLabel}.completedCycles`, {
      positive: true
    })
    substantiveString(result.findings, `${resultLabel}.findings`)
    if (result.locale === 'ar' && !containsArabicDetail(result.findings)) {
      throw new Error(`${resultLabel}.findings must contain substantive Arabic-script detail.`)
    }
    const coverageKey = `${result.locale}:${result.scenario}`
    if (automatedScenarioCoverage.has(coverageKey)) {
      throw new Error(`${label}.scenarioResults must not duplicate locale/scenario pairs.`)
    }
    automatedScenarioCoverage.add(coverageKey)
  }
  for (const locale of REQUIRED_LOCALES) {
    for (const scenario of REQUIRED_SOAK_SCENARIOS) {
      if (!automatedScenarioCoverage.has(`${locale}:${scenario}`)) {
        throw new Error(`${label}.scenarioResults must cover ${locale}:${scenario}.`)
      }
    }
  }

  const automatedRetentionResults = requiredArray(
    record.retentionResults,
    `${label}.retentionResults`,
    { minLength: REQUIRED_RETENTION_CHECKS.length }
  )
  const automatedRetentionCoverage = new Set()
  for (const [index, result] of automatedRetentionResults.entries()) {
    const resultLabel = `${label}.retentionResults[${index}]`
    if (!REQUIRED_RETENTION_CHECKS.includes(result?.check) || result.passed !== true) {
      throw new Error(`${resultLabel} must identify a passed required retention check.`)
    }
    substantiveString(result.findings, `${resultLabel}.findings`)
    const metrics = requiredObject(result.metrics, `${resultLabel}.metrics`)
    const metricEntries = Object.entries(metrics)
    if (
      metricEntries.length === 0 ||
      metricEntries.some(
        ([key, value]) =>
          !/^[A-Za-z][A-Za-z0-9]*$/.test(key) ||
          (!Number.isSafeInteger(value) && typeof value !== 'boolean') ||
          (typeof value === 'number' && value < 0)
      ) ||
      !metricEntries.some(([, value]) => value === true || (typeof value === 'number' && value > 0))
    ) {
      throw new Error(`${resultLabel}.metrics must contain objective non-negative counters.`)
    }
    if (automatedRetentionCoverage.has(result.check)) {
      throw new Error(`${label}.retentionResults must not duplicate checks.`)
    }
    automatedRetentionCoverage.add(result.check)
  }
  requireExactSet(
    [...automatedRetentionCoverage],
    REQUIRED_RETENTION_CHECKS,
    `${label}.retentionResults checks`
  )

  const candidateEndpoints = requiredObject(
    record.candidateEndpoints,
    `${label}.candidateEndpoints`
  )
  for (const field of ['requiredSha', 'headShaAtStart', 'headShaAtEnd']) {
    if (
      requiredCandidateSha(candidateEndpoints[field], `${label}.candidateEndpoints.${field}`) !==
      candidateSha
    ) {
      throw new Error(`${label}.candidateEndpoints.${field} must equal the exact candidate SHA.`)
    }
  }
  if (
    candidateEndpoints.cleanAtStart !== true ||
    candidateEndpoints.cleanAtEnd !== true ||
    candidateEndpoints.matchedAtStart !== true ||
    candidateEndpoints.matchedAtEnd !== true
  ) {
    throw new Error(`${label}.candidateEndpoints must prove a clean, unchanged candidate.`)
  }

  const artifactEndpoints = requiredObject(record.artifactEndpoints, `${label}.artifactEndpoints`)
  for (const field of ['sha256AtStart', 'sha256AtEnd']) {
    if (
      requiredSha256(artifactEndpoints[field], `${label}.artifactEndpoints.${field}`) !==
      artifactSha256
    ) {
      throw new Error(`${label}.artifactEndpoints.${field} must equal the exact artifact digest.`)
    }
  }
  const sizeBytesAtStart = requiredNonNegativeSafeInteger(
    artifactEndpoints.sizeBytesAtStart,
    `${label}.artifactEndpoints.sizeBytesAtStart`,
    { positive: true }
  )
  if (
    requiredNonNegativeSafeInteger(
      artifactEndpoints.sizeBytesAtEnd,
      `${label}.artifactEndpoints.sizeBytesAtEnd`,
      { positive: true }
    ) !== sizeBytesAtStart ||
    artifactEndpoints.matchedAtEnd !== true
  ) {
    throw new Error(`${label}.artifactEndpoints must prove unchanged exact artifact bytes.`)
  }
  const clock = requiredObject(record.clock, `${label}.clock`)
  if (
    clock.wallClock !== 'UTC' ||
    clock.elapsedClock !== 'performance.now' ||
    clock.timestampDerivation !== 'startedAt-plus-monotonic-elapsed'
  ) {
    throw new Error(`${label}.clock must describe the soak gate's trusted clock derivation.`)
  }
  substantiveString(record.findings, `${label}.findings`, { minLength: 40 })
}

function validateAssistiveTechnologySummary(entry, key, candidateReadyAt, now) {
  const label = `assistiveTechnology.${key}`
  const requirement = ASSISTIVE_TECHNOLOGY_REQUIREMENTS[key]
  if (!entry || entry.passed !== true) {
    throw new Error(`${label}.passed must be true.`)
  }
  const operator = requiredHumanIdentity(entry.operator, `${label}.operator`)
  const operatingSystem = substantiveString(entry.operatingSystem, `${label}.operatingSystem`, {
    minLength: 5,
    maxLength: 160,
    minWords: 1
  })
  const assistiveTechnologyVersion = substantiveString(
    entry.assistiveTechnologyVersion,
    `${label}.assistiveTechnologyVersion`,
    { minLength: 2, maxLength: 120, minWords: 1 }
  )
  const browserName = substantiveString(entry.browserName, `${label}.browserName`, {
    minLength: 3,
    maxLength: 80,
    minWords: 1
  })
  const browserVersion = substantiveString(entry.browserVersion, `${label}.browserVersion`, {
    minLength: 2,
    maxLength: 80,
    minWords: 1
  })
  if (
    !requirement.operatingSystemPattern.test(operatingSystem) ||
    !requirement.assistiveTechnologyPattern.test(assistiveTechnologyVersion) ||
    !requirement.browserPattern.test(browserName)
  ) {
    throw new Error(`${label} platform, assistive technology, or browser is mislabeled.`)
  }
  if (key === 'arabicScreenReader') {
    const isWindowsTuple =
      /^Windows\b/i.test(operatingSystem) &&
      /^(?:NVDA|JAWS)\b/i.test(assistiveTechnologyVersion) &&
      /^(?:Google Chrome|Chromium|Microsoft Edge|Mozilla Firefox)$/i.test(browserName)
    const isMacosTuple =
      /^macOS\b/i.test(operatingSystem) &&
      /^VoiceOver\b/i.test(assistiveTechnologyVersion) &&
      /^Safari$/i.test(browserName)
    if (!isWindowsTuple && !isMacosTuple) {
      throw new Error(`${label} must record a supported OS, screen-reader, and browser tuple.`)
    }
  }
  if (
    !/\d/.test(operatingSystem) ||
    !/\d/.test(assistiveTechnologyVersion) ||
    !/\d/.test(browserVersion)
  ) {
    throw new Error(
      `${label} must record exact numeric OS, assistive-technology, and browser versions.`
    )
  }
  if (entry.locale !== requirement.locale) {
    throw new Error(`${label}.locale must be ${requirement.locale}.`)
  }
  const startedAt = requiredTimestamp(entry.startedAt, `${label}.startedAt`, now)
  const testedAt = requiredTimestamp(entry.testedAt, `${label}.testedAt`, now)
  if (startedAt < candidateReadyAt || testedAt < candidateReadyAt) {
    throw new Error(`${label} session must not predate the trusted candidate-ready instant.`)
  }
  if (testedAt <= startedAt) {
    throw new Error(`${label}.testedAt must postdate its session start.`)
  }
  return {
    operator,
    operatingSystem,
    assistiveTechnologyVersion,
    browserName,
    browserVersion,
    locale: entry.locale,
    startedAt,
    testedAt,
    evidenceUrl: requiredHttpsUrl(entry.evidenceUrl, `${label}.evidenceUrl`),
    evidenceSha256: requiredSha256(entry.evidenceSha256, `${label}.evidenceSha256`)
  }
}

function validateAssistiveTechnologyRecord(
  record,
  summary,
  key,
  candidateSha,
  artifactSha256,
  now
) {
  const label = `supportingEvidence.${key}`
  const requirement = ASSISTIVE_TECHNOLOGY_REQUIREMENTS[key]
  requireBoundRecord(record, requirement.evidenceType, candidateSha, artifactSha256, label)
  if (record.passed !== true) {
    throw new Error(`${label}.passed must be true.`)
  }
  requireMatchingIdentity(record.operator, summary.operator, `${label}.operator`)
  for (const property of [
    'operatingSystem',
    'assistiveTechnologyVersion',
    'browserName',
    'browserVersion',
    'locale'
  ]) {
    if (record[property] !== summary[property]) {
      throw new Error(`${label}.${property} must match the top-level evidence manifest.`)
    }
  }
  const testedAt = requiredTimestamp(record.testedAt, `${label}.testedAt`, now)
  const startedAt = requiredTimestamp(record.startedAt, `${label}.startedAt`, now)
  if (startedAt !== summary.startedAt) {
    throw new Error(`${label}.startedAt must match the top-level evidence manifest.`)
  }
  if (testedAt !== summary.testedAt) {
    throw new Error(`${label}.testedAt must match the top-level evidence manifest.`)
  }
  const scenarios = requiredArray(record.scenarios, `${label}.scenarios`, {
    minLength: requirement.scenarios.length
  })
  const observedScenarios = new Set()
  for (const [index, scenario] of scenarios.entries()) {
    const scenarioLabel = `${label}.scenarios[${index}]`
    if (!requirement.scenarios.includes(scenario?.id) || scenario.passed !== true) {
      throw new Error(`${scenarioLabel} must identify a required scenario with passed=true.`)
    }
    substantiveString(scenario.findings, `${scenarioLabel}.findings`)
    if (requirement.requiresArabicFindings && !containsArabicDetail(scenario.findings)) {
      throw new Error(`${scenarioLabel}.findings must contain substantive Arabic-script detail.`)
    }
    if (observedScenarios.has(scenario.id)) {
      throw new Error(`${label}.scenarios must not contain duplicate ids.`)
    }
    observedScenarios.add(scenario.id)
  }
  requireExactSet([...observedScenarios], requirement.scenarios, `${label}.scenario ids`)
  substantiveString(record.findings, `${label}.findings`, { minLength: 40 })
  if (requirement.requiresArabicFindings && !containsArabicDetail(record.findings)) {
    throw new Error(`${label}.findings must contain substantive Arabic-script detail.`)
  }
  if (
    key === 'arabicScreenReader' &&
    (record.textDirection !== 'rtl' || record.documentLanguage !== 'ar')
  ) {
    throw new Error(`${label} must record textDirection=rtl and documentLanguage=ar.`)
  }
}

function validateDefectSummary(defects, now) {
  if (!defects || defects.unresolvedP0 !== 0 || defects.unresolvedP1 !== 0) {
    throw new Error('External evidence must record zero unresolved P0 and P1 defects.')
  }
  return {
    signedOffBy: requiredHumanIdentity(defects.signedOffBy, 'defects.signedOffBy'),
    signedOffAt: requiredTimestamp(defects.signedOffAt, 'defects.signedOffAt', now),
    evidenceUrl: requiredHttpsUrl(defects.evidenceUrl, 'defects.evidenceUrl'),
    evidenceSha256: requiredSha256(defects.evidenceSha256, 'defects.evidenceSha256')
  }
}

function validateDefectRecord(
  record,
  summary,
  candidateSha,
  artifactSha256,
  reviewedRecordSha256,
  now
) {
  const label = 'supportingEvidence.defectLedger'
  requireBoundRecord(record, 'orbitpm-lite-defect-ledger', candidateSha, artifactSha256, label)
  if (record.unresolvedP0 !== 0 || record.unresolvedP1 !== 0) {
    throw new Error(`${label} must record zero unresolved P0 and P1 defects.`)
  }
  requireMatchingIdentity(record.signedOffBy, summary.signedOffBy, `${label}.signedOffBy`)
  const signedOffAt = requiredTimestamp(record.signedOffAt, `${label}.signedOffAt`, now)
  if (signedOffAt !== summary.signedOffAt) {
    throw new Error(`${label}.signedOffAt must match the top-level evidence manifest.`)
  }
  if (
    requiredCandidateSha(
      record.automatedGatesCandidateSha,
      `${label}.automatedGatesCandidateSha`
    ) !== candidateSha
  ) {
    throw new Error(`${label} automated-gate review is not bound to the exact candidate SHA.`)
  }
  const reviewedEvidence = requiredArray(record.reviewedEvidence, `${label}.reviewedEvidence`, {
    minLength: REQUIRED_LEDGER_RECORDS.length
  })
  const reviewedKeys = new Set()
  for (const [index, reviewedRecord] of reviewedEvidence.entries()) {
    const reviewedLabel = `${label}.reviewedEvidence[${index}]`
    if (!REQUIRED_LEDGER_RECORDS.includes(reviewedRecord?.key)) {
      throw new Error(`${reviewedLabel}.key must identify a required supporting record.`)
    }
    if (reviewedKeys.has(reviewedRecord.key)) {
      throw new Error(`${label}.reviewedEvidence must not contain duplicate record keys.`)
    }
    reviewedKeys.add(reviewedRecord.key)
    if (
      requiredSha256(reviewedRecord.sha256, `${reviewedLabel}.sha256`) !==
      reviewedRecordSha256[reviewedRecord.key]
    ) {
      throw new Error(`${reviewedLabel} is not bound to the exact supporting-record SHA-256.`)
    }
  }
  requireExactSet([...reviewedKeys], REQUIRED_LEDGER_RECORDS, `${label}.reviewedEvidence keys`)
  const severitySummary = requiredArray(record.severitySummary, `${label}.severitySummary`, {
    minLength: 2
  })
  const severities = new Set()
  for (const [index, severity] of severitySummary.entries()) {
    const severityLabel = `${label}.severitySummary[${index}]`
    if (!['P0', 'P1'].includes(severity?.severity) || severity.unresolved !== 0) {
      throw new Error(`${severityLabel} must record P0 or P1 with unresolved=0.`)
    }
    substantiveString(severity.findings, `${severityLabel}.findings`)
    if (severities.has(severity.severity)) {
      throw new Error(`${label}.severitySummary must not duplicate severities.`)
    }
    severities.add(severity.severity)
  }
  requireExactSet([...severities], ['P0', 'P1'], `${label}.severitySummary severities`)

  if (!Array.isArray(record.entries)) {
    throw new Error(`${label}.entries must be an array, including when no defects were found.`)
  }
  let unresolvedP0 = 0
  let unresolvedP1 = 0
  const entryIds = new Set()
  for (const [index, entry] of record.entries.entries()) {
    const entryLabel = `${label}.entries[${index}]`
    const id = requiredString(entry?.id, `${entryLabel}.id`, {
      minLength: 3,
      maxLength: 120
    })
    if (entryIds.has(id)) {
      throw new Error(`${label}.entries must not contain duplicate ids.`)
    }
    entryIds.add(id)
    if (!['P0', 'P1', 'P2', 'P3'].includes(entry.severity)) {
      throw new Error(`${entryLabel}.severity must be P0, P1, P2, or P3.`)
    }
    if (!['resolved', 'accepted'].includes(entry.status)) {
      throw new Error(`${entryLabel}.status must be resolved or accepted.`)
    }
    substantiveString(entry.summary, `${entryLabel}.summary`)
    substantiveString(entry.disposition, `${entryLabel}.disposition`)
    if (entry.status !== 'resolved' && entry.severity === 'P0') unresolvedP0 += 1
    if (entry.status !== 'resolved' && entry.severity === 'P1') unresolvedP1 += 1
  }
  if (unresolvedP0 !== 0 || unresolvedP1 !== 0) {
    throw new Error(`${label}.entries contradict the zero-unresolved P0/P1 summary.`)
  }
  substantiveString(record.findings, `${label}.findings`, { minLength: 40 })
}

function validateReview(review, defectSummary, assistiveTechnologySummaries, now) {
  if (!review || review.independentOfEvidenceProduction !== true) {
    throw new Error('review.independentOfEvidenceProduction must be true.')
  }
  const reviewedBy = requiredHumanIdentity(review.reviewedBy, 'review.reviewedBy')
  const testOperators = Object.values(assistiveTechnologySummaries).map(
    (summary) => summary.operator
  )
  if (testOperators.some((operator) => sameIdentity(defectSummary.signedOffBy, operator))) {
    throw new Error(
      'Defect signatory must be independent of every assistive-technology test operator.'
    )
  }
  if (testOperators.some((operator) => sameIdentity(reviewedBy, operator))) {
    throw new Error(
      'Final evidence reviewer must be independent of every assistive-technology test operator.'
    )
  }
  return {
    reviewedBy,
    reviewedAt: requiredTimestamp(review.reviewedAt, 'review.reviewedAt', now)
  }
}

function validateManifestChronology({
  soakSummary,
  assistiveTechnologySummaries,
  defectSummary,
  reviewSummary,
  assembledAt
}) {
  const latestTestCompletion = Math.max(
    soakSummary.completedAt,
    ...Object.values(assistiveTechnologySummaries).map((summary) => summary.testedAt)
  )
  if (defectSummary.signedOffAt <= latestTestCompletion) {
    throw new Error('P0/P1 sign-off must postdate the soak and assistive-technology evidence.')
  }
  if (reviewSummary.reviewedAt <= defectSummary.signedOffAt) {
    throw new Error('Final evidence review must postdate the P0/P1 sign-off.')
  }
  if (assembledAt < reviewSummary.reviewedAt) {
    throw new Error('assembledAt must not predate final evidence review.')
  }
}

function assertUniqueSupportingUrls(supportingRequests) {
  const urls = new Set()
  for (const request of supportingRequests) {
    if (urls.has(request.url)) {
      throw new Error('Every supporting evidence record must use a distinct HTTPS URL.')
    }
    urls.add(request.url)
  }
}

export async function verifyReleaseEvidence({
  candidateSha: candidateShaInput,
  candidateReadyAt: candidateReadyAtInput,
  artifactSha256: artifactSha256Input,
  sourceUrl,
  sourceSha256,
  fetchImpl = fetch,
  now = Date.now(),
  timeoutMs = FETCH_TIMEOUT_MS
}) {
  if (!Number.isFinite(now)) {
    throw new Error('Verification time must be finite.')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > FETCH_TIMEOUT_MS) {
    throw new Error(`Fetch timeout must be an integer from 1 through ${FETCH_TIMEOUT_MS} ms.`)
  }
  const candidateSha = requiredCandidateSha(candidateShaInput, '--candidate-sha')
  const candidateReadyAt = requiredTimestamp(candidateReadyAtInput, '--candidate-ready-at', now)
  const artifactSha256 = requiredSha256(artifactSha256Input, 'artifact SHA-256')
  const source = await fetchVerifiedJson({
    url: sourceUrl,
    expectedSha256: sourceSha256,
    label: 'External release evidence manifest',
    maxBytes: MAX_MANIFEST_BYTES,
    fetchImpl,
    timeoutMs
  })
  const evidence = source.record
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('External evidence manifest must be a JSON object.')
  }
  if (evidence.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`External evidence schemaVersion must be ${MANIFEST_SCHEMA_VERSION}.`)
  }
  if (requiredCandidateSha(evidence.candidateSha, 'candidateSha') !== candidateSha) {
    throw new Error('External evidence is not bound to the exact candidate SHA.')
  }
  const manifestCandidateReadyAt = requiredTimestamp(
    evidence.candidateReadyAt,
    'candidateReadyAt',
    now
  )
  if (manifestCandidateReadyAt !== candidateReadyAt) {
    throw new Error('External evidence is not bound to the trusted candidate-ready instant.')
  }
  if (requiredSha256(evidence.artifactSha256, 'artifactSha256') !== artifactSha256) {
    throw new Error('External evidence is not bound to the exact artifact SHA-256.')
  }
  const assembledAt = requiredTimestamp(evidence.assembledAt, 'assembledAt', now)

  const soakSummaryBase = validateSoakSummary(evidence.soak, candidateReadyAt, now)
  const soakSummary = {
    ...soakSummaryBase,
    sampleIntervalMinutes: evidence.soak.sampleIntervalMinutes
  }
  const assistiveTechnologySummaries = Object.fromEntries(
    Object.keys(ASSISTIVE_TECHNOLOGY_REQUIREMENTS).map((key) => [
      key,
      validateAssistiveTechnologySummary(
        evidence.assistiveTechnology?.[key],
        key,
        candidateReadyAt,
        now
      )
    ])
  )
  const defectSummary = validateDefectSummary(evidence.defects, now)
  const reviewSummary = validateReview(
    evidence.review,
    defectSummary,
    assistiveTechnologySummaries,
    now
  )
  validateManifestChronology({
    soakSummary,
    assistiveTechnologySummaries,
    defectSummary,
    reviewSummary,
    assembledAt
  })

  const supportingRequests = [
    {
      key: 'soak',
      url: soakSummary.evidenceUrl,
      sha256: soakSummary.evidenceSha256
    },
    ...Object.entries(assistiveTechnologySummaries).map(([key, summary]) => ({
      key,
      url: summary.evidenceUrl,
      sha256: summary.evidenceSha256
    })),
    {
      key: 'defectLedger',
      url: defectSummary.evidenceUrl,
      sha256: defectSummary.evidenceSha256
    }
  ]
  assertUniqueSupportingUrls(supportingRequests)

  const fetchedSupportingRecords = await Promise.all(
    supportingRequests.map(async (request) => ({
      key: request.key,
      ...(await fetchVerifiedJson({
        url: request.url,
        expectedSha256: request.sha256,
        label: `Supporting evidence ${request.key}`,
        maxBytes: MAX_SUPPORT_BYTES,
        fetchImpl,
        timeoutMs
      }))
    }))
  )
  if (
    new Set(fetchedSupportingRecords.map((record) => record.finalUrl)).size !==
    fetchedSupportingRecords.length
  ) {
    throw new Error('Every supporting evidence record must resolve to a distinct final URL.')
  }
  const supportingByKey = Object.fromEntries(
    fetchedSupportingRecords.map((record) => [record.key, record])
  )
  const soakValidation = validateSoakRecord(
    supportingByKey.soak.record,
    soakSummary,
    candidateSha,
    artifactSha256,
    now
  )
  const occupiedEvidenceUrls = new Set([
    source.requestedUrl,
    source.finalUrl,
    ...fetchedSupportingRecords.flatMap((record) => [record.requestedUrl, record.finalUrl])
  ])
  if (occupiedEvidenceUrls.has(soakValidation.automatedGateEvidenceUrl)) {
    throw new Error(
      'Automated soak gate evidence must use a distinct URL from the manifest and human supporting records.'
    )
  }
  const automatedSoakGate = {
    key: 'automatedSoakGate',
    ...(await fetchVerifiedJson({
      url: soakValidation.automatedGateEvidenceUrl,
      expectedSha256: soakValidation.automatedGateEvidenceSha256,
      label: 'Automated soak gate evidence',
      maxBytes: MAX_AUTOMATED_SOAK_GATE_BYTES,
      fetchImpl,
      timeoutMs
    }))
  }
  if (occupiedEvidenceUrls.has(automatedSoakGate.finalUrl)) {
    throw new Error(
      'Automated soak gate evidence must resolve to a distinct final URL from every other record.'
    )
  }
  validateAutomatedSoakGate(
    automatedSoakGate.record,
    soakSummary,
    candidateSha,
    artifactSha256,
    now
  )
  if (defectSummary.signedOffAt <= soakValidation.attestedAt) {
    throw new Error('P0/P1 sign-off must postdate the independent soak attestation.')
  }
  if (
    soakValidation.operatorIdentities.some((identity) =>
      sameIdentity(defectSummary.signedOffBy, identity)
    )
  ) {
    throw new Error('Defect signatory must be independent of the soak operators.')
  }
  if (
    soakValidation.operatorIdentities.some((identity) =>
      sameIdentity(reviewSummary.reviewedBy, identity)
    )
  ) {
    throw new Error('Final evidence reviewer must be independent of the soak operators.')
  }
  for (const [key, summary] of Object.entries(assistiveTechnologySummaries)) {
    validateAssistiveTechnologyRecord(
      supportingByKey[key].record,
      summary,
      key,
      candidateSha,
      artifactSha256,
      now
    )
  }
  validateDefectRecord(
    supportingByKey.defectLedger.record,
    defectSummary,
    candidateSha,
    artifactSha256,
    {
      soak: soakSummary.evidenceSha256,
      ...Object.fromEntries(
        Object.entries(assistiveTechnologySummaries).map(([key, summary]) => [
          key,
          summary.evidenceSha256
        ])
      )
    },
    now
  )

  return {
    schemaVersion: 2,
    gate: 'orbitpm-lite-external-release-evidence',
    status: 'passed',
    verifiedAt: new Date(now).toISOString(),
    candidateSha,
    candidateReadyAt: new Date(candidateReadyAt).toISOString(),
    artifactSha256,
    policy: {
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      supportSchemaVersion: SUPPORT_SCHEMA_VERSION,
      maxEvidenceAgeMs: MAX_EVIDENCE_AGE_MS,
      maxClockSkewMs: MAX_CLOCK_SKEW_MS,
      minimumSoakDurationMs: MIN_SOAK_DURATION_MS,
      maximumDeclaredMemoryGrowthBytes: MAX_DECLARED_MEMORY_GROWTH_BYTES,
      maximumDeclaredStorageGrowthBytes: MAX_DECLARED_STORAGE_GROWTH_BYTES,
      fetchTimeoutMs: timeoutMs,
      manifestMaxBytes: MAX_MANIFEST_BYTES,
      supportingRecordMaxBytes: MAX_SUPPORT_BYTES,
      automatedSoakGateMaxBytes: MAX_AUTOMATED_SOAK_GATE_BYTES
    },
    source: {
      url: source.requestedUrl,
      finalUrl: source.finalUrl,
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      bodyBase64: source.bodyBase64
    },
    evidence,
    supportingEvidence: [...fetchedSupportingRecords, automatedSoakGate].map(
      ({ key, requestedUrl, finalUrl, sha256, sizeBytes, bodyBase64, record }) => ({
        key,
        url: requestedUrl,
        finalUrl,
        sha256,
        sizeBytes,
        bodyBase64,
        record
      })
    )
  }
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  now = Date.now()
} = {}) {
  const candidateSha = requiredCandidateSha(
    option('--candidate-sha', env.GITHUB_SHA, argv),
    '--candidate-sha'
  )
  const candidateReadyAt = option('--candidate-ready-at', undefined, argv)
  const sourceUrl = option('--url', undefined, argv)
  const expectedSourceSha256 = option('--sha256', undefined, argv)
  const artifactArgument = option('--artifact', undefined, argv)
  if (!artifactArgument) {
    throw new Error('--artifact is required for exact release-artifact binding.')
  }
  const artifactBytes = readFileSync(resolve(artifactArgument))
  const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex')
  const outputPath = resolve(option('--output', 'verified-external-release-evidence.json', argv))

  const verification = await verifyReleaseEvidence({
    candidateSha,
    candidateReadyAt,
    artifactSha256,
    sourceUrl,
    sourceSha256: expectedSourceSha256,
    fetchImpl,
    now
  })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(verification, null, 2)}\n`, { flag: 'wx' })
  console.log(
    `Verified candidate-bound automated and human-attested 48-hour soak, NVDA, VoiceOver, Arabic, defect-ledger, and independent-review evidence at SHA-256 ${verification.source.sha256}.`
  )
  return verification
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  await main()
}
