import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function option(name, fallback) {
  const prefix = `${name}=`
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix))
  return argument?.slice(prefix.length) ?? fallback
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

function requiredSha256(value, label) {
  const digest = requiredString(value, label).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${label} must be a 64-character SHA-256 digest.`)
  }
  return digest
}

function requiredHttpsUrl(value, label) {
  const url = new URL(requiredString(value, label))
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    /[\s<>`]/.test(value)
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL.`)
  }
  return url.toString()
}

function requiredTimestamp(value, label) {
  const timestamp = requiredString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO-8601 timestamp.`)
  }
  return timestamp
}

function validateAssistiveTechnology(entry, label) {
  if (!entry || entry.passed !== true) {
    throw new Error(`${label}.passed must be true.`)
  }
  requiredString(entry.operator, `${label}.operator`)
  requiredString(entry.operatingSystem, `${label}.operatingSystem`)
  requiredString(entry.assistiveTechnologyVersion, `${label}.assistiveTechnologyVersion`)
  requiredString(entry.browserName, `${label}.browserName`)
  requiredString(entry.browserVersion, `${label}.browserVersion`)
  const testedAt = requiredTimestamp(entry.testedAt, `${label}.testedAt`)
  requiredHttpsUrl(entry.evidenceUrl, `${label}.evidenceUrl`)
  requiredSha256(entry.evidenceSha256, `${label}.evidenceSha256`)
  return Date.parse(testedAt)
}

const candidateSha = requiredString(
  option('--candidate-sha', process.env.GITHUB_SHA),
  '--candidate-sha'
).toLowerCase()
if (!/^[a-f0-9]{40}$/.test(candidateSha)) {
  throw new Error('--candidate-sha must be the exact 40-character Git commit SHA.')
}
const sourceUrl = requiredHttpsUrl(option('--url'), '--url')
const expectedSourceSha256 = requiredSha256(option('--sha256'), '--sha256')
const artifactArgument = option('--artifact')
const outputPath = resolve(option('--output', 'verified-external-release-evidence.json'))

const response = await fetch(sourceUrl, {
  cache: 'no-store',
  redirect: 'follow',
  signal: AbortSignal.timeout(30_000)
})
if (!response.ok) throw new Error(`External evidence returned HTTP ${response.status}.`)
if (new URL(response.url).protocol !== 'https:') {
  throw new Error('External evidence redirected away from HTTPS.')
}
const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.byteLength > 1024 * 1024) {
  throw new Error('External release evidence exceeds the 1 MiB verification limit.')
}
const sourceSha256 = createHash('sha256').update(bytes).digest('hex')
if (sourceSha256 !== expectedSourceSha256) {
  throw new Error(
    `External evidence SHA-256 ${sourceSha256} does not match ${expectedSourceSha256}.`
  )
}

const evidence = JSON.parse(bytes.toString('utf8'))
if (evidence.schemaVersion !== 1) {
  throw new Error('External evidence schemaVersion must be 1.')
}
if (evidence.candidateSha?.toLowerCase() !== candidateSha) {
  throw new Error('External evidence is not bound to the exact candidate SHA.')
}
const artifactSha256 = requiredSha256(evidence.artifactSha256, 'artifactSha256')
if (artifactArgument) {
  const artifactBytes = readFileSync(resolve(artifactArgument))
  const actualArtifactSha256 = createHash('sha256').update(artifactBytes).digest('hex')
  if (actualArtifactSha256 !== artifactSha256) {
    throw new Error(
      `External evidence artifact SHA-256 ${artifactSha256} does not match ${actualArtifactSha256}.`
    )
  }
}

const soak = evidence.soak
if (!soak || soak.passed !== true || soak.uninterrupted !== true) {
  throw new Error('soak must record passed=true and uninterrupted=true.')
}
const soakStarted = Date.parse(requiredTimestamp(soak.startedAt, 'soak.startedAt'))
const soakCompleted = Date.parse(requiredTimestamp(soak.completedAt, 'soak.completedAt'))
if (
  !Number.isFinite(soak.durationMs) ||
  soak.durationMs < 172_800_000 ||
  soakCompleted - soakStarted < 172_800_000 ||
  soakCompleted - soakStarted !== soak.durationMs
) {
  throw new Error('soak must record one exact uninterrupted duration of at least 48 hours.')
}
const requiredScenarios = [
  'edits',
  'recovery',
  'workspace-switching',
  'imports',
  'translation-cancellation',
  'history-cleanup'
]
if (
  !Array.isArray(soak.scenarios) ||
  requiredScenarios.some((scenario) => !soak.scenarios.includes(scenario))
) {
  throw new Error(`soak.scenarios must include: ${requiredScenarios.join(', ')}.`)
}
if (soak.memoryGrowth !== 'bounded' || soak.storageGrowth !== 'bounded') {
  throw new Error('soak must record bounded memoryGrowth and storageGrowth.')
}
requiredHttpsUrl(soak.evidenceUrl, 'soak.evidenceUrl')
requiredSha256(soak.evidenceSha256, 'soak.evidenceSha256')

const assistiveTechnologyTimes = [
  validateAssistiveTechnology(
    evidence.assistiveTechnology?.nvdaWindows,
    'assistiveTechnology.nvdaWindows'
  ),
  validateAssistiveTechnology(
    evidence.assistiveTechnology?.voiceOverMacos,
    'assistiveTechnology.voiceOverMacos'
  ),
  validateAssistiveTechnology(
    evidence.assistiveTechnology?.arabicScreenReader,
    'assistiveTechnology.arabicScreenReader'
  )
]

if (evidence.defects?.unresolvedP0 !== 0 || evidence.defects?.unresolvedP1 !== 0) {
  throw new Error('External evidence must record zero unresolved P0 and P1 defects.')
}
requiredString(evidence.defects.signedOffBy, 'defects.signedOffBy')
const defectsSignedOffAt = Date.parse(
  requiredTimestamp(evidence.defects.signedOffAt, 'defects.signedOffAt')
)
requiredString(evidence.review?.reviewedBy, 'review.reviewedBy')
const reviewedAt = Date.parse(requiredTimestamp(evidence.review?.reviewedAt, 'review.reviewedAt'))
if (defectsSignedOffAt < Math.max(soakCompleted, ...assistiveTechnologyTimes)) {
  throw new Error('P0/P1 sign-off must postdate the soak and assistive-technology evidence.')
}
if (reviewedAt < defectsSignedOffAt) {
  throw new Error('Final evidence review must postdate the P0/P1 sign-off.')
}

const verification = {
  schemaVersion: 1,
  gate: 'orbitpm-lite-external-release-evidence',
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  candidateSha,
  artifactSha256,
  source: {
    url: sourceUrl,
    finalUrl: response.url,
    sha256: sourceSha256
  },
  evidence
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(verification, null, 2)}\n`, { flag: 'wx' })
console.log(
  `Verified candidate-bound 48-hour soak, NVDA, VoiceOver, Arabic, and P0/P1 evidence at SHA-256 ${sourceSha256}.`
)
