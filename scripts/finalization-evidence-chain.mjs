import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const MAX_STRING_LENGTH = 16 * 1024

function fail(message) {
  throw new Error(message)
}

function parseOptions(command, arguments_) {
  if (command !== 'verify') fail('Expected command verify.')
  const allowed = new Set([
    'artifact',
    'browser-evidence',
    'candidate-sha',
    'chain',
    'finalization-run-id',
    'pages-evidence',
    'pages-url',
    'publication-authority',
    'release-evidence',
    'release-tag'
  ])
  const options = new Map()
  for (const argument of arguments_) {
    const separator = argument.indexOf('=')
    if (!argument.startsWith('--') || separator < 3) {
      fail('Every CLI option must use --name=value syntax.')
    }
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!allowed.has(name)) fail(`--${name} is not supported by verify.`)
    if (!value) fail(`--${name} must not be empty.`)
    if (options.has(name)) fail(`--${name} must be provided exactly once.`)
    options.set(name, value)
  }
  for (const name of [
    'artifact',
    'browser-evidence',
    'candidate-sha',
    'chain',
    'finalization-run-id',
    'pages-evidence',
    'pages-url',
    'publication-authority',
    'release-evidence',
    'release-tag'
  ]) {
    if (!options.has(name)) fail(`--${name} is required.`)
  }
  return options
}

function readJsonBounded(path, label, maxBytes = MAX_JSON_BYTES) {
  let descriptor
  try {
    descriptor = openSync(resolve(path), 'r')
  } catch (error) {
    fail(`${label} must exist and be readable.`)
  }
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size < 2 || metadata.size > maxBytes) {
      fail(`${label} must be a regular JSON file containing 2 through ${maxBytes} bytes.`)
    }
    return JSON.parse(readFileSync(descriptor, 'utf8'))
  } finally {
    closeSync(descriptor)
  }
}

function sha256File(path, label, maxBytes = MAX_ARTIFACT_BYTES) {
  let descriptor
  try {
    descriptor = openSync(resolve(path), 'r')
  } catch (error) {
    fail(`${label} must exist and be readable.`)
  }
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes) {
      fail(`${label} must be a regular file containing 1 through ${maxBytes} bytes.`)
    }
    return createHash('sha256').update(readFileSync(descriptor)).digest('hex')
  } finally {
    closeSync(descriptor)
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`)
  }
  return value
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(assertRecord(value, label)).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} does not match schema version 2.`)
  }
}

function canonicalString(value, label) {
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

function canonicalTimestamp(value, label) {
  const timestamp = canonicalString(value, label)
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    fail(`${label} must be a canonical ISO timestamp.`)
  }
  return timestamp
}

function lowerHex(value, length, label) {
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value)) {
    fail(`${label} must be an exact lowercase hexadecimal digest.`)
  }
  return value
}

function canonicalPositiveDecimal(value, label) {
  const string = canonicalString(value, label)
  if (!/^[1-9]\d*$/u.test(string)) {
    fail(`${label} must be a canonical positive decimal string.`)
  }
  return string
}

function canonicalHttpsUrl(value, label) {
  const url = canonicalString(value, label)
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    fail(`${label} must be a valid canonical HTTPS URL.`)
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.href !== url
  ) {
    fail(
      `${label} must be a canonical HTTPS URL without credentials, a query string, or a fragment.`
    )
  }
  return url
}

function validateReleaseEvidence(releaseEvidence, label) {
  const record = assertRecord(releaseEvidence, label)
  if (record.gate !== 'orbitpm-lite-external-release-evidence') {
    fail(`${label}.gate is invalid.`)
  }
  if (record.status !== 'passed') fail(`${label}.status must be passed.`)
  return {
    candidateSha: lowerHex(record.candidateSha, 40, `${label}.candidateSha`),
    candidateReadyAt: canonicalTimestamp(record.candidateReadyAt, `${label}.candidateReadyAt`),
    artifactSha256: lowerHex(record.artifactSha256, 64, `${label}.artifactSha256`),
    sourceUrl: canonicalHttpsUrl(record.source?.url, `${label}.source.url`),
    sourceSha256: lowerHex(record.source?.sha256, 64, `${label}.source.sha256`)
  }
}

function validatePagesEvidence(pagesEvidence, label) {
  const record = assertRecord(pagesEvidence, label)
  if (record.gate !== 'orbitpm-lite-browser-environment') {
    fail(`${label}.gate is invalid.`)
  }
  if (record.result !== 'passed') fail(`${label}.result must be passed.`)
  return {
    candidateSha: lowerHex(record.candidateSha, 40, `${label}.candidateSha`),
    artifactSha256: lowerHex(record.artifact?.sha256, 64, `${label}.artifact.sha256`),
    testedUrl: canonicalHttpsUrl(record.testedUrl, `${label}.testedUrl`),
    servedFinalUrl: canonicalHttpsUrl(record.servedFinalUrl, `${label}.servedFinalUrl`),
    servedSha256: lowerHex(record.servedSha256, 64, `${label}.servedSha256`),
    runId: canonicalPositiveDecimal(record.workflow?.runId, `${label}.workflow.runId`)
  }
}

function validateBrowserEvidence(browserEvidence, label) {
  const record = assertRecord(browserEvidence, label)
  if (record.gate !== 'orbitpm-lite-browser-compatibility-evidence') {
    fail(`${label}.gate is invalid.`)
  }
  if (record.status !== 'passed') fail(`${label}.status must be passed.`)
  const sourceUrl = canonicalHttpsUrl(record.source?.url, `${label}.source.url`)
  const sourceFinalUrl = canonicalHttpsUrl(record.source?.finalUrl, `${label}.source.finalUrl`)
  const baselineUrl = canonicalHttpsUrl(
    record.versionBaseline?.source?.url,
    `${label}.versionBaseline.source.url`
  )
  const baselineFinalUrl = canonicalHttpsUrl(
    record.versionBaseline?.source?.finalUrl,
    `${label}.versionBaseline.source.finalUrl`
  )
  return {
    candidateSha: lowerHex(record.candidateSha, 40, `${label}.candidateSha`),
    candidateReadyAt: canonicalTimestamp(record.candidateReadyAt, `${label}.candidateReadyAt`),
    artifactSha256: lowerHex(record.artifactSha256, 64, `${label}.artifactSha256`),
    pagesUrl: canonicalHttpsUrl(record.pagesUrl, `${label}.pagesUrl`),
    pagesEvidenceSha256: lowerHex(
      record.pagesDeploymentEvidence?.sha256,
      64,
      `${label}.pagesDeploymentEvidence.sha256`
    ),
    sourceUrl,
    sourceFinalUrl,
    sourceSha256: lowerHex(record.source?.sha256, 64, `${label}.source.sha256`),
    baselineUrl,
    baselineFinalUrl,
    baselineSha256: lowerHex(
      record.versionBaseline?.source?.sha256,
      64,
      `${label}.versionBaseline.source.sha256`
    )
  }
}

function validateFinalizationChain(chain, label) {
  assertExactKeys(
    chain,
    [
      'artifactSha256',
      'browserCompatibilityEvidence',
      'browserVersionBaseline',
      'candidateReadyAt',
      'candidateSha',
      'externalEvidence',
      'finalizationRunId',
      'gate',
      'pagesEvidenceSha256',
      'pagesRunId',
      'pagesUrl',
      'publicationAuthoritySha256',
      'releaseEvidenceSha256',
      'releaseRunId',
      'releaseTag',
      'schemaVersion',
      'status'
    ],
    label
  )
  assertExactKeys(
    chain.browserCompatibilityEvidence,
    ['aggregateSha256', 'sourceSha256', 'url'],
    `${label}.browserCompatibilityEvidence`
  )
  assertExactKeys(
    chain.browserVersionBaseline,
    ['sha256', 'sourceSha256', 'url'],
    `${label}.browserVersionBaseline`
  )
  assertExactKeys(chain.externalEvidence, ['sha256', 'url'], `${label}.externalEvidence`)
  if (chain.schemaVersion !== 2) fail(`${label}.schemaVersion must be 2.`)
  if (chain.gate !== 'orbitpm-lite-finalization-chain') fail(`${label}.gate is invalid.`)
  if (chain.status !== 'passed') fail(`${label}.status must be passed.`)
  return {
    candidateSha: lowerHex(chain.candidateSha, 40, `${label}.candidateSha`),
    candidateReadyAt: canonicalTimestamp(chain.candidateReadyAt, `${label}.candidateReadyAt`),
    artifactSha256: lowerHex(chain.artifactSha256, 64, `${label}.artifactSha256`),
    releaseTag: canonicalString(chain.releaseTag, `${label}.releaseTag`),
    releaseRunId: canonicalPositiveDecimal(chain.releaseRunId, `${label}.releaseRunId`),
    pagesRunId: canonicalPositiveDecimal(chain.pagesRunId, `${label}.pagesRunId`),
    finalizationRunId: canonicalPositiveDecimal(
      chain.finalizationRunId,
      `${label}.finalizationRunId`
    ),
    pagesUrl: canonicalHttpsUrl(chain.pagesUrl, `${label}.pagesUrl`),
    releaseEvidenceSha256: lowerHex(
      chain.releaseEvidenceSha256,
      64,
      `${label}.releaseEvidenceSha256`
    ),
    pagesEvidenceSha256: lowerHex(chain.pagesEvidenceSha256, 64, `${label}.pagesEvidenceSha256`),
    publicationAuthoritySha256: lowerHex(
      chain.publicationAuthoritySha256,
      64,
      `${label}.publicationAuthoritySha256`
    ),
    browserEvidenceUrl: canonicalHttpsUrl(
      chain.browserCompatibilityEvidence.url,
      `${label}.browserCompatibilityEvidence.url`
    ),
    browserEvidenceSourceSha256: lowerHex(
      chain.browserCompatibilityEvidence.sourceSha256,
      64,
      `${label}.browserCompatibilityEvidence.sourceSha256`
    ),
    browserEvidenceAggregateSha256: lowerHex(
      chain.browserCompatibilityEvidence.aggregateSha256,
      64,
      `${label}.browserCompatibilityEvidence.aggregateSha256`
    ),
    baselineUrl: canonicalHttpsUrl(
      chain.browserVersionBaseline.url,
      `${label}.browserVersionBaseline.url`
    ),
    baselineSha256: lowerHex(
      chain.browserVersionBaseline.sha256,
      64,
      `${label}.browserVersionBaseline.sha256`
    ),
    baselineSourceSha256: lowerHex(
      chain.browserVersionBaseline.sourceSha256,
      64,
      `${label}.browserVersionBaseline.sourceSha256`
    ),
    externalEvidenceUrl: canonicalHttpsUrl(
      chain.externalEvidence.url,
      `${label}.externalEvidence.url`
    ),
    externalEvidenceSha256: lowerHex(
      chain.externalEvidence.sha256,
      64,
      `${label}.externalEvidence.sha256`
    )
  }
}

export function verifyFinalizationEvidenceChain(chain, expected) {
  const chainRecord = validateFinalizationChain(chain, 'chain')
  const releaseEvidence = validateReleaseEvidence(expected.releaseEvidence, 'release evidence')
  const pagesEvidence = validatePagesEvidence(expected.pagesEvidence, 'pages evidence')
  const browserEvidence = validateBrowserEvidence(expected.browserEvidence, 'browser evidence')
  const candidateSha = lowerHex(expected.candidateSha, 40, 'expected candidate SHA')
  const releaseTag = canonicalString(expected.releaseTag, 'expected release tag')
  const finalizationRunId = canonicalPositiveDecimal(
    expected.finalizationRunId,
    'expected finalization run ID'
  )
  const pagesUrl = canonicalHttpsUrl(expected.pagesUrl, 'expected Pages URL')
  const artifactSha256 = lowerHex(expected.artifactSha256, 64, 'expected artifact SHA-256')
  const releaseEvidenceSha256 = lowerHex(
    expected.releaseEvidenceSha256,
    64,
    'expected release evidence SHA-256'
  )
  const pagesEvidenceSha256 = lowerHex(
    expected.pagesEvidenceSha256,
    64,
    'expected Pages evidence SHA-256'
  )
  const publicationAuthoritySha256 = lowerHex(
    expected.publicationAuthoritySha256,
    64,
    'expected publication authority SHA-256'
  )
  const browserEvidenceAggregateSha256 = lowerHex(
    expected.browserEvidenceAggregateSha256,
    64,
    'expected browser evidence aggregate SHA-256'
  )

  const failures = []
  for (const [label, actual, trusted] of [
    ['chain.candidateSha', chainRecord.candidateSha, candidateSha],
    ['release evidence.candidateSha', releaseEvidence.candidateSha, candidateSha],
    ['pages evidence.candidateSha', pagesEvidence.candidateSha, candidateSha],
    ['browser evidence.candidateSha', browserEvidence.candidateSha, candidateSha],
    ['chain.releaseTag', chainRecord.releaseTag, releaseTag],
    ['chain.finalizationRunId', chainRecord.finalizationRunId, finalizationRunId],
    ['chain.pagesUrl', chainRecord.pagesUrl, pagesUrl],
    ['pages evidence.testedUrl', pagesEvidence.testedUrl, pagesUrl],
    ['pages evidence.servedFinalUrl', pagesEvidence.servedFinalUrl, pagesUrl],
    ['browser evidence.pagesUrl', browserEvidence.pagesUrl, pagesUrl],
    ['chain.artifactSha256', chainRecord.artifactSha256, artifactSha256],
    ['release evidence.artifactSha256', releaseEvidence.artifactSha256, artifactSha256],
    ['pages evidence.artifact.sha256', pagesEvidence.artifactSha256, artifactSha256],
    ['pages evidence.servedSha256', pagesEvidence.servedSha256, artifactSha256],
    ['browser evidence.artifactSha256', browserEvidence.artifactSha256, artifactSha256],
    ['chain.releaseEvidenceSha256', chainRecord.releaseEvidenceSha256, releaseEvidenceSha256],
    ['chain.pagesEvidenceSha256', chainRecord.pagesEvidenceSha256, pagesEvidenceSha256],
    [
      'chain.publicationAuthoritySha256',
      chainRecord.publicationAuthoritySha256,
      publicationAuthoritySha256
    ],
    [
      'chain.browserCompatibilityEvidence.aggregateSha256',
      chainRecord.browserEvidenceAggregateSha256,
      browserEvidenceAggregateSha256
    ],
    [
      'browser evidence.pagesDeploymentEvidence.sha256',
      browserEvidence.pagesEvidenceSha256,
      pagesEvidenceSha256
    ],
    [
      'chain.browserCompatibilityEvidence.url',
      chainRecord.browserEvidenceUrl,
      browserEvidence.sourceUrl
    ],
    [
      'chain.browserCompatibilityEvidence.sourceSha256',
      chainRecord.browserEvidenceSourceSha256,
      browserEvidence.sourceSha256
    ],
    ['browser evidence.source.finalUrl', browserEvidence.sourceFinalUrl, browserEvidence.sourceUrl],
    ['chain.browserVersionBaseline.url', chainRecord.baselineUrl, browserEvidence.baselineUrl],
    [
      'chain.browserVersionBaseline.sha256',
      chainRecord.baselineSha256,
      browserEvidence.baselineSha256
    ],
    [
      'chain.browserVersionBaseline.sourceSha256',
      chainRecord.baselineSourceSha256,
      browserEvidence.baselineSha256
    ],
    [
      'browser evidence.versionBaseline.source.finalUrl',
      browserEvidence.baselineFinalUrl,
      browserEvidence.baselineUrl
    ],
    ['chain.externalEvidence.url', chainRecord.externalEvidenceUrl, releaseEvidence.sourceUrl],
    [
      'chain.externalEvidence.sha256',
      chainRecord.externalEvidenceSha256,
      releaseEvidence.sourceSha256
    ],
    ['chain.pagesRunId', chainRecord.pagesRunId, pagesEvidence.runId],
    ['chain.candidateReadyAt', chainRecord.candidateReadyAt, releaseEvidence.candidateReadyAt],
    [
      'browser evidence.candidateReadyAt',
      browserEvidence.candidateReadyAt,
      releaseEvidence.candidateReadyAt
    ]
  ]) {
    if (actual !== trusted) {
      failures.push(`${label} differs from the trusted retained evidence.`)
    }
  }

  if (failures.length) fail(failures.join('\n'))

  return {
    candidateSha: chainRecord.candidateSha,
    candidateReadyAt: chainRecord.candidateReadyAt,
    artifactSha256: chainRecord.artifactSha256,
    finalizationRunId: chainRecord.finalizationRunId
  }
}

function main() {
  const [command, ...arguments_] = process.argv.slice(2)
  const options = parseOptions(command, arguments_)
  const artifactPath = options.get('artifact')
  const releaseEvidencePath = options.get('release-evidence')
  const pagesEvidencePath = options.get('pages-evidence')
  const publicationAuthorityPath = options.get('publication-authority')
  const browserEvidencePath = options.get('browser-evidence')
  const verified = verifyFinalizationEvidenceChain(
    readJsonBounded(options.get('chain'), 'The finalization chain'),
    {
      artifactSha256: sha256File(artifactPath, 'The stable release artifact'),
      browserEvidence: readJsonBounded(browserEvidencePath, 'The browser evidence aggregate'),
      browserEvidenceAggregateSha256: sha256File(
        browserEvidencePath,
        'The browser evidence aggregate'
      ),
      candidateSha: options.get('candidate-sha'),
      finalizationRunId: options.get('finalization-run-id'),
      pagesEvidence: readJsonBounded(pagesEvidencePath, 'The Pages browser evidence'),
      pagesEvidenceSha256: sha256File(pagesEvidencePath, 'The Pages browser evidence'),
      pagesUrl: options.get('pages-url'),
      publicationAuthoritySha256: sha256File(publicationAuthorityPath, 'The publication authority'),
      releaseEvidence: readJsonBounded(releaseEvidencePath, 'The release evidence aggregate'),
      releaseEvidenceSha256: sha256File(releaseEvidencePath, 'The release evidence aggregate'),
      releaseTag: options.get('release-tag')
    }
  )
  console.log(
    `Verified finalization evidence chain for ${verified.candidateSha} at finalization run ${verified.finalizationRunId}.`
  )
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).toString() === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
