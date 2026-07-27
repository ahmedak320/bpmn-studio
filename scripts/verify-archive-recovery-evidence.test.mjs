import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  ARCHIVE_BRANCH,
  ARCHIVE_BUNDLES,
  ARCHIVE_TAG,
  verifyArchiveRecoveryEvidence,
  verifyGitBundleRecovery
} from './verify-archive-recovery-evidence.mjs'

const CANDIDATE_SHA = '1234567890abcdef1234567890abcdef12345678'
const OTHER_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const BASE_URL =
  `https://raw.githubusercontent.com/ahmedak320/bpmn-studio/${CANDIDATE_SHA}` +
  '/release-evidence/v0.4.5'
const SOURCE_URL = `${BASE_URL}/archive-recovery.json`
const BUNDLE_BYTES = [
  Buffer.from('fixture full product bundle'),
  Buffer.from('fixture outer bundle')
]
const BUNDLE_POLICY = [
  {
    id: 'full-product',
    name: 'fixture-full-product.bundle',
    sha256: digest(BUNDLE_BYTES[0]),
    sizeBytes: BUNDLE_BYTES[0].byteLength,
    recoveryCommitSha: ARCHIVE_BRANCH.commitSha
  },
  {
    id: 'outer-legacy',
    name: 'fixture-outer-legacy.bundle',
    sha256: digest(BUNDLE_BYTES[1]),
    sizeBytes: BUNDLE_BYTES[1].byteLength,
    recoveryCommitSha: 'b1b288939e39c5dd9c2e064f76e24c85ad519fac'
  }
]

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function bundleUrl(name, revision = CANDIDATE_SHA) {
  return (
    `https://raw.githubusercontent.com/ahmedak320/bpmn-studio/${revision}` +
    `/release-evidence/v0.4.5/archive/${name}`
  )
}

function manifest() {
  return {
    schemaVersion: 1,
    evidenceType: 'orbitpm-legacy-archive-recovery',
    candidateSha: CANDIDATE_SHA,
    archiveBranch: { ...ARCHIVE_BRANCH },
    archiveTag: { ...ARCHIVE_TAG },
    bundles: BUNDLE_POLICY.map((bundle) => ({
      ...bundle,
      url: bundleUrl(bundle.name)
    }))
  }
}

function response(bytes, url, { finalUrl = url, status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null
      }
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes))
        controller.close()
      }
    })
  }
}

function buildFixture({ mutateManifest, mutateRoutes, sourceRevision = CANDIDATE_SHA } = {}) {
  const record = manifest()
  mutateManifest?.(record)
  const sourceUrl =
    `https://raw.githubusercontent.com/ahmedak320/bpmn-studio/${sourceRevision}` +
    '/release-evidence/v0.4.5/archive-recovery.json'
  const sourceBytes = Buffer.from(JSON.stringify(record))
  const routes = new Map([
    [sourceUrl, response(sourceBytes, sourceUrl)],
    ...BUNDLE_POLICY.map((bundle, index) => [
      bundleUrl(bundle.name),
      response(BUNDLE_BYTES[index], bundleUrl(bundle.name))
    ])
  ])
  mutateRoutes?.(routes)
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    const found = routes.get(url)
    if (!found) throw new Error(`Unexpected fixture URL ${url}`)
    return found
  }
  const recoveries = []
  const recoveryVerifier = async ({ bytes, bundleName, recoveryCommitSha }) => {
    recoveries.push({ bytes, bundleName, recoveryCommitSha })
    return {
      bundleVerify: 'passed',
      recoveryClone: 'passed',
      recoveredCommitSha: recoveryCommitSha
    }
  }
  return {
    candidateSha: CANDIDATE_SHA,
    sourceUrl,
    sourceSha256: digest(sourceBytes),
    fetchImpl,
    recoveryVerifier,
    archiveBranchPolicy: ARCHIVE_BRANCH,
    archiveTagPolicy: ARCHIVE_TAG,
    bundlePolicy: BUNDLE_POLICY,
    recoveries
  }
}

test('accepts only candidate-pinned evidence and exact recoverable bundle bytes', async () => {
  const fixture = buildFixture()
  const result = await verifyArchiveRecoveryEvidence(fixture)
  assert.equal(result.verification.status, 'passed')
  assert.equal(result.verification.candidateSha, CANDIDATE_SHA)
  assert.deepEqual(
    result.verification.bundles.map(({ id, bundleVerify, recoveryClone }) => ({
      id,
      bundleVerify,
      recoveryClone
    })),
    [
      { id: 'full-product', bundleVerify: 'passed', recoveryClone: 'passed' },
      { id: 'outer-legacy', bundleVerify: 'passed', recoveryClone: 'passed' }
    ]
  )
  assert.equal(fixture.recoveries.length, 2)
  assert.deepEqual(result.bundleBytes.get(BUNDLE_POLICY[0].name), BUNDLE_BYTES[0])
})

for (const { name, mutate, message } of [
  {
    name: 'candidate mismatch',
    mutate: (record) => {
      record.candidateSha = OTHER_SHA
    },
    message: /not bound to the exact candidate SHA/
  },
  {
    name: 'archive branch mismatch',
    mutate: (record) => {
      record.archiveBranch.commitSha = OTHER_SHA
    },
    message: /archiveBranch\.commitSha/
  },
  {
    name: 'archive tag object mismatch',
    mutate: (record) => {
      record.archiveTag.objectSha = OTHER_SHA
    },
    message: /archiveTag\.objectSha/
  },
  {
    name: 'missing bundle',
    mutate: (record) => {
      record.bundles.pop()
    },
    message: /bundles must contain exactly 2/
  },
  {
    name: 'extra bundle',
    mutate: (record) => {
      record.bundles.push(structuredClone(record.bundles[0]))
    },
    message: /bundles must contain exactly 2/
  },
  {
    name: 'reviewed digest mismatch',
    mutate: (record) => {
      record.bundles[0].sha256 = 'f'.repeat(64)
    },
    message: /does not match the reviewed archive digest/
  },
  {
    name: 'reviewed size mismatch',
    mutate: (record) => {
      record.bundles[0].sizeBytes += 1
    },
    message: /bundles\[0\]\.sizeBytes/
  },
  {
    name: 'bundle URL with the wrong custody filename',
    mutate: (record) => {
      record.bundles[0].url = `${BASE_URL}/archive/wrong.bundle`
    },
    message: /canonical public HTTPS archival-custody URL/
  },
  {
    name: 'unsigned extra manifest field',
    mutate: (record) => {
      record.notes = 'not reviewed'
    },
    message: /must contain exactly/
  }
]) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(
      verifyArchiveRecoveryEvidence(buildFixture({ mutateManifest: mutate })),
      message
    )
  })
}

test('rejects a manifest URL whose immutable revision differs from the candidate', async () => {
  await assert.rejects(
    verifyArchiveRecoveryEvidence(buildFixture({ sourceRevision: OTHER_SHA })),
    /URL must be pinned to the exact candidate SHA/
  )
})

test('rejects source and bundle redirects', async () => {
  const sourceFixture = buildFixture()
  const sourceBytes = Buffer.from(JSON.stringify(manifest()))
  const redirectedSource = response(sourceBytes, SOURCE_URL, {
    finalUrl: `${BASE_URL}/redirected.json`
  })
  sourceFixture.fetchImpl = async (url, options) => {
    if (url === SOURCE_URL) return redirectedSource
    return buildFixture().fetchImpl(url, options)
  }
  await assert.rejects(verifyArchiveRecoveryEvidence(sourceFixture), /must not redirect/)

  const bundleFixture = buildFixture({
    mutateRoutes(routes) {
      const url = bundleUrl(BUNDLE_POLICY[0].name)
      routes.set(url, response(BUNDLE_BYTES[0], url, { finalUrl: `${url}.redirected` }))
    }
  })
  await assert.rejects(verifyArchiveRecoveryEvidence(bundleFixture), /must not redirect/)
})

test('rejects changed bundle bytes and failed recovery proof', async () => {
  const changedBytesFixture = buildFixture({
    mutateRoutes(routes) {
      const url = bundleUrl(BUNDLE_POLICY[0].name)
      routes.set(url, response(Buffer.from('changed'), url))
    }
  })
  await assert.rejects(verifyArchiveRecoveryEvidence(changedBytesFixture), /byte length|SHA-256/)

  const failedRecoveryFixture = buildFixture()
  failedRecoveryFixture.recoveryVerifier = async ({ recoveryCommitSha }) => ({
    bundleVerify: 'passed',
    recoveryClone: 'failed',
    recoveredCommitSha: recoveryCommitSha
  })
  await assert.rejects(
    verifyArchiveRecoveryEvidence(failedRecoveryFixture),
    /did not pass exact Git bundle recovery verification/
  )
})

test('production archive constants remain bound to the reviewed recovery record', () => {
  assert.deepEqual(ARCHIVE_BUNDLES, [
    {
      id: 'full-product',
      name: 'bpmn-studio-full-product-v0.4.4.bundle',
      sha256: 'aeaebf41b8a2cac89a6b16af7ab49c372cd5feb43319d58231f22ccc3f3553b6',
      sizeBytes: 1_200_974,
      recoveryCommitSha: 'cd842b6e0b8d7283e2704ae71ec207440b9e54f2'
    },
    {
      id: 'outer-legacy',
      name: 'bpmn-tool-outer-legacy-v0.4.4.bundle',
      sha256: '18254bbc68f9554aa3ceff7f208d14b9400da1a6adb3585ae575f4dce04dcb75',
      sizeBytes: 924_817,
      recoveryCommitSha: 'b1b288939e39c5dd9c2e064f76e24c85ad519fac'
    }
  ])
})

test('the default verifier runs git bundle verify and recovers the exact commit', () => {
  const workDirectory = mkdtempSync(join(tmpdir(), 'orbitpm-bundle-test-'))
  try {
    const repository = join(workDirectory, 'source')
    const bundlePath = join(workDirectory, 'fixture.bundle')
    runGit(['init', repository])
    runGit(['-C', repository, 'config', 'user.name', 'OrbitPM Test'])
    runGit(['-C', repository, 'config', 'user.email', 'orbitpm@example.invalid'])
    writeFileSync(join(repository, 'README.md'), 'recoverable fixture\n')
    runGit(['-C', repository, 'add', 'README.md'])
    runGit(['-C', repository, 'commit', '-m', 'Recoverable fixture'])
    const commitSha = runGit(['-C', repository, 'rev-parse', 'HEAD'])
    runGit(['-C', repository, 'bundle', 'create', bundlePath, '--all'])
    assert.deepEqual(
      verifyGitBundleRecovery({
        bytes: readFileSync(bundlePath),
        bundleName: 'fixture.bundle',
        recoveryCommitSha: commitSha
      }),
      {
        bundleVerify: 'passed',
        recoveryClone: 'passed',
        recoveredCommitSha: commitSha
      }
    )
  } finally {
    rmSync(workDirectory, { force: true, recursive: true })
  }
})

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
