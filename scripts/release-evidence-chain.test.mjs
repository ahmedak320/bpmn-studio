import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareReleaseEvidence, verifyReleaseEvidence } from './release-evidence-chain.mjs'

const scriptPath = fileURLToPath(new URL('./release-evidence-chain.mjs', import.meta.url))
const repositoryRoot = resolve(dirname(scriptPath), '..')
const candidateSha = '0123456789abcdef0123456789abcdef01234567'
const candidateReadyAt = '2026-07-20T12:34:56.789Z'
const sourceUrl = 'https://evidence.example.test/release.json'
const sourceSha256 = 'a'.repeat(64)

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function aggregate(artifactSha256) {
  return {
    gate: 'orbitpm-lite-external-release-evidence',
    status: 'passed',
    verifiedAt: '2026-07-27T10:00:00.000Z',
    candidateSha,
    candidateReadyAt,
    artifactSha256,
    source: {
      url: sourceUrl,
      sha256: sourceSha256
    },
    retainedRecords: {
      verifiedAt: 'nested values are evidence and must not be ignored',
      value: 'exact'
    }
  }
}

test('verifies exact candidate, artifact, readiness, and source bindings', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-release-chain-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const artifactPath = join(directory, 'artifact.html')
  const bytes = Buffer.from('<!doctype html><title>Exact release</title>')
  writeFileSync(artifactPath, bytes)
  const evidence = aggregate(sha256(bytes))

  assert.doesNotThrow(() =>
    verifyReleaseEvidence(evidence, {
      candidateSha,
      artifactSha256: sha256(bytes),
      candidateReadyAt,
      sourceSha256,
      sourceUrl
    })
  )

  for (const [label, expected] of [
    ['candidate', { candidateSha: 'f'.repeat(40) }],
    ['artifact', { artifactSha256: 'f'.repeat(64) }],
    ['readiness', { candidateReadyAt: '2026-07-20T12:34:56.790Z' }],
    ['source hash', { sourceSha256: 'f'.repeat(64) }],
    ['source URL', { sourceUrl: 'https://other.example.test/release.json' }]
  ]) {
    assert.throws(
      () =>
        verifyReleaseEvidence(evidence, {
          candidateSha,
          artifactSha256: sha256(bytes),
          candidateReadyAt,
          sourceSha256,
          sourceUrl,
          ...expected
        }),
      undefined,
      label
    )
  }
})

test('comparison ignores only top-level verifiedAt', () => {
  const trusted = aggregate('b'.repeat(64))
  const observed = structuredClone(trusted)
  observed.verifiedAt = '2026-07-27T11:00:00.000Z'
  assert.doesNotThrow(() => compareReleaseEvidence(trusted, observed))

  observed.retainedRecords.verifiedAt = 'substituted nested evidence'
  assert.throws(() => compareReleaseEvidence(trusted, observed), /differs/)
  observed.retainedRecords.verifiedAt = trusted.retainedRecords.verifiedAt
  observed.retainedRecords.value = 'substituted'
  assert.throws(() => compareReleaseEvidence(trusted, observed), /differs/)
})

test('rejects malformed aggregate identities and noncanonical timestamps', () => {
  const evidence = aggregate('b'.repeat(64))
  for (const mutate of [
    (value) => (value.gate = 'other'),
    (value) => (value.status = 'failed'),
    (value) => (value.candidateSha = candidateSha.toUpperCase()),
    (value) => (value.candidateReadyAt = '2026-07-20T12:34:56Z'),
    (value) => (value.source.url = 'https://evidence.example.test/release.json?token=x'),
    (value) => (value.source.sha256 = 'not-a-digest')
  ]) {
    const changed = structuredClone(evidence)
    mutate(changed)
    assert.throws(() => verifyReleaseEvidence(changed, {}))
  }
})

test('CLI rejects missing, duplicate, unknown, and command-inappropriate options', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-release-chain-cli-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const artifactPath = join(directory, 'artifact.html')
  const aggregatePath = join(directory, 'aggregate.json')
  const bytes = Buffer.from('<!doctype html>')
  writeFileSync(artifactPath, bytes)
  writeFileSync(aggregatePath, JSON.stringify(aggregate(sha256(bytes))))
  const base = [
    scriptPath,
    'verify',
    `--aggregate=${aggregatePath}`,
    `--candidate-sha=${candidateSha}`,
    `--candidate-ready-at=${candidateReadyAt}`,
    `--artifact=${artifactPath}`
  ]
  const accepted = spawnSync(process.execPath, base, {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  assert.equal(accepted.status, 0, accepted.stderr)

  for (const [label, arguments_] of [
    ['missing readiness', base.filter((value) => !value.startsWith('--candidate-ready-at='))],
    ['duplicate', [...base, `--artifact=${artifactPath}`]],
    ['unknown', [...base, '--unexpected=true']],
    ['wrong command option', [scriptPath, 'compare', ...base.slice(2)]],
    ['missing command', [scriptPath, ...base.slice(2)]]
  ]) {
    const result = spawnSync(process.execPath, arguments_, {
      cwd: repositoryRoot,
      encoding: 'utf8'
    })
    assert.notEqual(result.status, 0, label)
  }
})
