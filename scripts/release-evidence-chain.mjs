import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_AGGREGATE_BYTES = 8 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024

function fail(message) {
  throw new Error(message)
}

function parseOptions(command, arguments_) {
  const allowedByCommand = {
    verify: new Set([
      'aggregate',
      'candidate-sha',
      'candidate-ready-at',
      'artifact',
      'source-sha256',
      'source-url'
    ]),
    compare: new Set(['trusted', 'observed'])
  }
  const allowed = allowedByCommand[command]
  if (!allowed) fail('Expected command verify or compare.')
  const options = new Map()
  for (const argument of arguments_) {
    const separator = argument.indexOf('=')
    if (!argument.startsWith('--') || separator < 3) {
      fail('Every CLI option must use --name=value syntax.')
    }
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!allowed.has(name)) fail(`--${name} is not supported by ${command}.`)
    if (!value) fail(`--${name} must not be empty.`)
    if (options.has(name)) fail(`--${name} must be provided exactly once.`)
    options.set(name, value)
  }
  const required =
    command === 'verify'
      ? ['aggregate', 'candidate-sha', 'candidate-ready-at', 'artifact']
      : ['trusted', 'observed']
  for (const name of required) {
    if (!options.has(name)) fail(`--${name} is required.`)
  }
  return options
}

function readJsonBounded(path, label) {
  const descriptor = openSync(resolve(path), 'r')
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_AGGREGATE_BYTES) {
      fail(
        `${label} must be a regular JSON file containing 2 through ${MAX_AGGREGATE_BYTES} bytes.`
      )
    }
    return JSON.parse(readFileSync(descriptor, 'utf8'))
  } finally {
    closeSync(descriptor)
  }
}

function sha256File(path) {
  const descriptor = openSync(resolve(path), 'r')
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_ARTIFACT_BYTES) {
      fail(
        `The release artifact must be a regular file containing 1 through ${MAX_ARTIFACT_BYTES} bytes.`
      )
    }
    return createHash('sha256').update(readFileSync(descriptor)).digest('hex')
  } finally {
    closeSync(descriptor)
  }
}

function canonicalTimestamp(value, label) {
  const parsed = Date.parse(value)
  if (
    typeof value !== 'string' ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    fail(`${label} must be a canonical ISO timestamp.`)
  }
  return value
}

function validateAggregate(aggregate, label, expected = {}) {
  const failures = []
  if (!aggregate || typeof aggregate !== 'object' || Array.isArray(aggregate)) {
    fail(`${label} must be a JSON object.`)
  }
  if (aggregate.gate !== 'orbitpm-lite-external-release-evidence') {
    failures.push(`${label}.gate is invalid`)
  }
  if (aggregate.status !== 'passed') failures.push(`${label}.status must be passed`)
  if (!/^[a-f0-9]{40}$/.test(aggregate.candidateSha ?? '')) {
    failures.push(`${label}.candidateSha is invalid`)
  }
  if (!/^[a-f0-9]{64}$/.test(aggregate.artifactSha256 ?? '')) {
    failures.push(`${label}.artifactSha256 is invalid`)
  }
  try {
    canonicalTimestamp(aggregate.candidateReadyAt, `${label}.candidateReadyAt`)
  } catch (error) {
    failures.push(error.message)
  }
  if (
    !aggregate.source ||
    typeof aggregate.source !== 'object' ||
    Array.isArray(aggregate.source) ||
    !/^[a-f0-9]{64}$/.test(aggregate.source.sha256 ?? '')
  ) {
    failures.push(`${label}.source.sha256 is invalid`)
  }
  try {
    const sourceUrl = new URL(aggregate.source?.url)
    if (
      sourceUrl.protocol !== 'https:' ||
      sourceUrl.username ||
      sourceUrl.password ||
      sourceUrl.search ||
      sourceUrl.hash ||
      sourceUrl.href !== aggregate.source.url
    ) {
      failures.push(`${label}.source.url is not a canonical HTTPS URL`)
    }
  } catch {
    failures.push(`${label}.source.url is invalid`)
  }
  if (expected.candidateSha && aggregate.candidateSha !== expected.candidateSha) {
    failures.push(`${label}.candidateSha differs from the trusted candidate`)
  }
  if (expected.artifactSha256 && aggregate.artifactSha256 !== expected.artifactSha256) {
    failures.push(`${label}.artifactSha256 differs from the trusted artifact bytes`)
  }
  if (expected.candidateReadyAt && aggregate.candidateReadyAt !== expected.candidateReadyAt) {
    failures.push(`${label}.candidateReadyAt differs from trusted pre-tag completion`)
  }
  if (expected.sourceSha256 && aggregate.source?.sha256 !== expected.sourceSha256.toLowerCase()) {
    failures.push(`${label}.source.sha256 differs from the established evidence manifest`)
  }
  if (expected.sourceUrl && aggregate.source?.url !== expected.sourceUrl) {
    failures.push(`${label}.source.url differs from the established evidence manifest`)
  }
  if (failures.length) fail(failures.join('\n'))
}

function canonicalNested(value) {
  if (Array.isArray(value)) return value.map(canonicalNested)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalNested(nested)])
    )
  }
  return value
}

function canonicalAggregate(aggregate) {
  return canonicalNested(
    Object.fromEntries(Object.entries(aggregate).filter(([key]) => key !== 'verifiedAt'))
  )
}

export function verifyReleaseEvidence(aggregate, expected) {
  validateAggregate(aggregate, 'aggregate', expected)
}

export function compareReleaseEvidence(trusted, observed) {
  validateAggregate(trusted, 'trusted aggregate')
  validateAggregate(observed, 'observed aggregate')
  if (
    JSON.stringify(canonicalAggregate(trusted)) !== JSON.stringify(canonicalAggregate(observed))
  ) {
    fail('Observed external-evidence verification differs from the retained release aggregate.')
  }
}

function main() {
  const [command, ...cliArguments] = process.argv.slice(2)
  const options = parseOptions(command, cliArguments)
  if (command === 'verify') {
    const aggregate = readJsonBounded(options.get('aggregate'), 'The evidence aggregate')
    const candidateSha = options.get('candidate-sha')
    if (!/^[a-f0-9]{40}$/.test(candidateSha)) {
      fail('--candidate-sha must be an exact lowercase 40-character Git SHA.')
    }
    const candidateReadyAt = canonicalTimestamp(
      options.get('candidate-ready-at'),
      '--candidate-ready-at'
    )
    verifyReleaseEvidence(aggregate, {
      candidateSha,
      artifactSha256: sha256File(options.get('artifact')),
      candidateReadyAt,
      sourceSha256: options.get('source-sha256'),
      sourceUrl: options.get('source-url')
    })
    console.log(
      `Verified retained evidence aggregate for ${aggregate.candidateSha} ready at ${aggregate.candidateReadyAt}.`
    )
    return
  }
  const trusted = readJsonBounded(options.get('trusted'), 'The trusted evidence aggregate')
  const observed = readJsonBounded(options.get('observed'), 'The observed evidence aggregate')
  compareReleaseEvidence(trusted, observed)
  console.log('Observed external-evidence verification matches the retained release aggregate.')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).toString() === import.meta.url) {
  main()
}
