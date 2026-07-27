import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  fetchVerifiedJson,
  readBodyWithLimit,
  requiredCandidateSha,
  requiredHttpsUrl,
  requiredSha256
} from './verify-external-release-evidence.mjs'

const SCHEMA_VERSION = 1
const EVIDENCE_TYPE = 'orbitpm-legacy-archive-recovery'
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

export const ARCHIVE_BRANCH = Object.freeze({
  name: 'archive/full-product-v0.4.4',
  commitSha: 'cd842b6e0b8d7283e2704ae71ec207440b9e54f2'
})

export const ARCHIVE_TAG = Object.freeze({
  name: 'archive-full-product-v0.4.4',
  objectSha: '4fd3fa1e5b7025e1c7d3c280a058c120594be645',
  peeledCommitSha: 'cd842b6e0b8d7283e2704ae71ec207440b9e54f2'
})

export const ARCHIVE_BUNDLES = Object.freeze([
  Object.freeze({
    id: 'full-product',
    name: 'bpmn-studio-full-product-v0.4.4.bundle',
    sha256: 'aeaebf41b8a2cac89a6b16af7ab49c372cd5feb43319d58231f22ccc3f3553b6',
    sizeBytes: 1_200_974,
    recoveryCommitSha: 'cd842b6e0b8d7283e2704ae71ec207440b9e54f2'
  }),
  Object.freeze({
    id: 'outer-legacy',
    name: 'bpmn-tool-outer-legacy-v0.4.4.bundle',
    sha256: '18254bbc68f9554aa3ceff7f208d14b9400da1a6adb3585ae575f4dce04dcb75',
    sizeBytes: 924_817,
    recoveryCommitSha: 'b1b288939e39c5dd9c2e064f76e24c85ad519fac'
  })
])

function option(name, fallback, argv = process.argv.slice(2)) {
  const prefix = `${name}=`
  const argument = argv.find((candidate) => candidate.startsWith(prefix))
  return argument?.slice(prefix.length) ?? fallback
}

function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return value
}

function requireExactKeys(value, expectedKeys, label) {
  requiredObject(value, label)
  const actualKeys = Object.keys(value).sort()
  const requiredKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== requiredKeys.length ||
    actualKeys.some((key, index) => key !== requiredKeys[index])
  ) {
    throw new Error(`${label} must contain exactly: ${requiredKeys.join(', ')}.`)
  }
}

function requireExactRecord(actual, expected, label) {
  requireExactKeys(actual, Object.keys(expected), label)
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${label}.${key} must equal ${JSON.stringify(value)}.`)
    }
  }
}

function evidenceRevision(url) {
  return new URL(url).pathname.split('/')[3]
}

function requiredArchiveBundleUrl(value, name, label) {
  const canonicalUrl = requiredHttpsUrl(value, label)
  const url = new URL(canonicalUrl)
  if (
    value !== canonicalUrl ||
    url.port ||
    value.includes('%') ||
    url.pathname.split('/').at(-1) !== name
  ) {
    throw new Error(
      `${label} must be a canonical public HTTPS archival-custody URL ending in ${name}.`
    )
  }
  return canonicalUrl
}

function runGit(args, label) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim()
    throw new Error(`${label} failed${detail ? `: ${detail}` : '.'}`)
  }
  return result.stdout.trim()
}

export function verifyGitBundleRecovery({ bytes, bundleName, recoveryCommitSha }) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`${bundleName} recovery verification requires exact bundle bytes.`)
  }
  const commitSha = requiredCandidateSha(recoveryCommitSha, `${bundleName}.recoveryCommitSha`)
  const workDirectory = mkdtempSync(join(tmpdir(), 'orbitpm-archive-recovery-'))
  try {
    const bundlePath = join(workDirectory, basename(bundleName))
    const verificationRepository = join(workDirectory, 'verify.git')
    const recoveryClone = join(workDirectory, 'recovered')
    writeFileSync(bundlePath, bytes, { flag: 'wx' })
    runGit(['init', '--bare', verificationRepository], `${bundleName} bare repository creation`)
    runGit(
      ['-C', verificationRepository, 'bundle', 'verify', bundlePath],
      `${bundleName} git bundle verification`
    )
    runGit(
      [
        '-c',
        'core.hooksPath=/dev/null',
        'clone',
        '--no-checkout',
        '--no-hardlinks',
        bundlePath,
        recoveryClone
      ],
      `${bundleName} recovery clone`
    )
    runGit(
      ['-C', recoveryClone, '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', commitSha],
      `${bundleName} recovery checkout`
    )
    const recoveredCommitSha = runGit(
      ['-C', recoveryClone, 'rev-parse', 'HEAD'],
      `${bundleName} recovered commit readback`
    )
    if (recoveredCommitSha !== commitSha) {
      throw new Error(
        `${bundleName} recovered ${recoveredCommitSha}, expected exact commit ${commitSha}.`
      )
    }
    runGit(['-C', recoveryClone, 'fsck', '--full'], `${bundleName} recovered repository fsck`)
    return {
      bundleVerify: 'passed',
      recoveryClone: 'passed',
      recoveredCommitSha
    }
  } finally {
    rmSync(workDirectory, { force: true, recursive: true })
  }
}

async function fetchVerifiedBundle({
  url,
  expectedSha256,
  expectedSizeBytes,
  label,
  fetchImpl,
  timeoutMs
}) {
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await fetchImpl(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/octet-stream' },
    signal
  })
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`)
  }
  if (response.url !== url) {
    throw new Error(`${label} must not redirect; publish the exact final HTTPS URL.`)
  }
  const bytes = await readBodyWithLimit(response, MAX_BUNDLE_BYTES, label, signal)
  if (bytes.byteLength !== expectedSizeBytes) {
    throw new Error(`${label} byte length ${bytes.byteLength} does not match ${expectedSizeBytes}.`)
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 ${sha256} does not match ${expectedSha256}.`)
  }
  return { bytes, finalUrl: response.url, sha256, sizeBytes: bytes.byteLength }
}

export async function verifyArchiveRecoveryEvidence({
  candidateSha: candidateShaInput,
  sourceUrl,
  sourceSha256,
  fetchImpl = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
  recoveryVerifier = verifyGitBundleRecovery,
  archiveBranchPolicy = ARCHIVE_BRANCH,
  archiveTagPolicy = ARCHIVE_TAG,
  bundlePolicy = ARCHIVE_BUNDLES
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > FETCH_TIMEOUT_MS) {
    throw new Error(`Fetch timeout must be an integer from 1 through ${FETCH_TIMEOUT_MS} ms.`)
  }
  const candidateSha = requiredCandidateSha(candidateShaInput, '--candidate-sha')
  const source = await fetchVerifiedJson({
    url: sourceUrl,
    expectedSha256: sourceSha256,
    label: 'Archive recovery evidence manifest',
    maxBytes: MAX_MANIFEST_BYTES,
    fetchImpl,
    timeoutMs
  })
  const revision = evidenceRevision(source.requestedUrl)
  if (revision !== candidateSha) {
    throw new Error('Archive recovery evidence URL must be pinned to the exact candidate SHA.')
  }

  const evidence = requiredObject(source.record, 'Archive recovery evidence manifest')
  requireExactKeys(
    evidence,
    ['schemaVersion', 'evidenceType', 'candidateSha', 'archiveBranch', 'archiveTag', 'bundles'],
    'Archive recovery evidence manifest'
  )
  if (evidence.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Archive recovery evidence schemaVersion must be ${SCHEMA_VERSION}.`)
  }
  if (evidence.evidenceType !== EVIDENCE_TYPE) {
    throw new Error(`Archive recovery evidenceType must be ${EVIDENCE_TYPE}.`)
  }
  if (requiredCandidateSha(evidence.candidateSha, 'candidateSha') !== candidateSha) {
    throw new Error('Archive recovery evidence is not bound to the exact candidate SHA.')
  }
  requireExactRecord(evidence.archiveBranch, archiveBranchPolicy, 'archiveBranch')
  requireExactRecord(evidence.archiveTag, archiveTagPolicy, 'archiveTag')
  if (!Array.isArray(evidence.bundles) || evidence.bundles.length !== bundlePolicy.length) {
    throw new Error(`bundles must contain exactly ${bundlePolicy.length} recovery bundles.`)
  }

  const verifiedBundles = []
  const bundleBytes = new Map()
  const occupiedUrls = new Set([source.requestedUrl, source.finalUrl])
  for (const [index, expected] of bundlePolicy.entries()) {
    const bundle = evidence.bundles[index]
    requireExactKeys(
      bundle,
      ['id', 'name', 'url', 'sha256', 'sizeBytes', 'recoveryCommitSha'],
      `bundles[${index}]`
    )
    for (const key of ['id', 'name', 'sizeBytes', 'recoveryCommitSha']) {
      if (bundle[key] !== expected[key]) {
        throw new Error(`bundles[${index}].${key} must equal ${JSON.stringify(expected[key])}.`)
      }
    }
    if (requiredSha256(bundle.sha256, `bundles[${index}].sha256`) !== expected.sha256) {
      throw new Error(`bundles[${index}].sha256 does not match the reviewed archive digest.`)
    }
    const expectedUrl = requiredArchiveBundleUrl(bundle.url, expected.name, `bundles[${index}].url`)
    if (occupiedUrls.has(expectedUrl)) {
      throw new Error('Archive manifest and recovery bundles must use distinct custody URLs.')
    }
    occupiedUrls.add(expectedUrl)
    const fetched = await fetchVerifiedBundle({
      url: expectedUrl,
      expectedSha256: expected.sha256,
      expectedSizeBytes: expected.sizeBytes,
      label: `Archive recovery bundle ${expected.id}`,
      fetchImpl,
      timeoutMs
    })
    const recovery = await recoveryVerifier({
      bytes: fetched.bytes,
      bundleName: expected.name,
      recoveryCommitSha: expected.recoveryCommitSha
    })
    if (
      recovery?.bundleVerify !== 'passed' ||
      recovery?.recoveryClone !== 'passed' ||
      recovery?.recoveredCommitSha !== expected.recoveryCommitSha
    ) {
      throw new Error(`${expected.name} did not pass exact Git bundle recovery verification.`)
    }
    bundleBytes.set(expected.name, fetched.bytes)
    verifiedBundles.push({
      ...expected,
      url: expectedUrl,
      finalUrl: fetched.finalUrl,
      bundleVerify: recovery.bundleVerify,
      recoveryClone: recovery.recoveryClone,
      recoveredCommitSha: recovery.recoveredCommitSha
    })
  }

  return {
    verification: {
      schemaVersion: SCHEMA_VERSION,
      gate: EVIDENCE_TYPE,
      status: 'passed',
      candidateSha,
      source: {
        url: source.requestedUrl,
        finalUrl: source.finalUrl,
        sha256: source.sha256,
        sizeBytes: source.sizeBytes,
        bodyBase64: source.bodyBase64
      },
      archiveBranch: { ...archiveBranchPolicy },
      archiveTag: { ...archiveTagPolicy },
      bundles: verifiedBundles
    },
    bundleBytes
  }
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  recoveryVerifier = verifyGitBundleRecovery
} = {}) {
  const candidateSha = option('--candidate-sha', env.GITHUB_SHA, argv)
  const sourceUrl = option('--url', undefined, argv)
  const sourceSha256 = option('--sha256', undefined, argv)
  const bundlesDirectory = resolve(option('--bundles-dir', 'archive-recovery-bundles', argv))
  const outputPath = resolve(option('--output', 'archive-recovery-verification.json', argv))
  if (resolve(outputPath) === bundlesDirectory) {
    throw new Error('--output and --bundles-dir must identify different paths.')
  }
  if (existsSync(outputPath)) {
    throw new Error(`Refusing to overwrite existing output ${outputPath}.`)
  }
  if (existsSync(bundlesDirectory) && readdirSync(bundlesDirectory).length !== 0) {
    throw new Error(`Refusing to mix verified bundles with files in ${bundlesDirectory}.`)
  }

  const { verification, bundleBytes } = await verifyArchiveRecoveryEvidence({
    candidateSha,
    sourceUrl,
    sourceSha256,
    fetchImpl,
    recoveryVerifier
  })
  mkdirSync(bundlesDirectory, { recursive: true })
  for (const bundle of verification.bundles) {
    writeFileSync(join(bundlesDirectory, bundle.name), bundleBytes.get(bundle.name), {
      flag: 'wx'
    })
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(verification, null, 2)}\n`, { flag: 'wx' })
  console.log(
    `Verified ${verification.bundles.length} immutable legacy Git recovery bundles at candidate ${verification.candidateSha}.`
  )
  return verification
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  await main()
}
