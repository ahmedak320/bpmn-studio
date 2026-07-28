import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { verifyFinalizationEvidenceChain } from './finalization-evidence-chain.mjs'

const scriptPath = fileURLToPath(new URL('./finalization-evidence-chain.mjs', import.meta.url))
const repositoryRoot = resolve(dirname(scriptPath), '..')
const candidateSha = '0123456789abcdef0123456789abcdef01234567'
const candidateReadyAt = '2026-07-27T12:34:56.789Z'
const releaseTag = 'v0.4.5'
const releaseRunId = '30328722238'
const pagesRunId = '30329495229'
const finalizationRunId = '30329668557'
const pagesUrl = 'https://ahmedak320.github.io/bpmn-studio/'
const externalEvidenceUrl = 'https://evidence.example.test/release-reviewed.json'
const externalEvidenceSha256 = 'a'.repeat(64)
const browserEvidenceUrl = 'https://evidence.example.test/browser-compatibility.json'
const browserEvidenceSourceSha256 = 'b'.repeat(64)
const baselineUrl = 'https://evidence.example.test/browser-version-baseline.json'
const baselineSha256 = 'c'.repeat(64)

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function buildFixture(directory) {
  const artifactPath = join(directory, 'OrbitPM-Process-Studio-Lite-0.4.5.html')
  const releaseEvidencePath = join(directory, 'trusted-release-external-evidence-verification.json')
  const pagesEvidencePath = join(directory, 'pages-browser-environment.json')
  const browserEvidencePath = join(directory, 'browser-compatibility-evidence-verification.json')
  const publicationAuthorityPath = join(directory, 'publication-authority.json')
  const chainPath = join(directory, 'finalization-chain.json')

  const artifactBytes = Buffer.from('<!doctype html><title>OrbitPM stable</title>')
  const artifactSha256 = sha256(artifactBytes)
  writeFileSync(artifactPath, artifactBytes)

  const releaseEvidence = {
    gate: 'orbitpm-lite-external-release-evidence',
    status: 'passed',
    verifiedAt: '2026-07-27T13:00:00.000Z',
    candidateSha,
    candidateReadyAt,
    artifactSha256,
    source: {
      url: externalEvidenceUrl,
      sha256: externalEvidenceSha256
    }
  }
  writeJson(releaseEvidencePath, releaseEvidence)
  const releaseEvidenceSha256 = sha256(Buffer.from(JSON.stringify(releaseEvidence, null, 2) + '\n'))

  const pagesEvidence = {
    schemaVersion: 1,
    gate: 'orbitpm-lite-browser-environment',
    result: 'passed',
    generatedAt: '2026-07-27T13:10:00.000Z',
    candidateSha,
    artifact: {
      path: artifactPath,
      sha256: artifactSha256
    },
    testedUrl: pagesUrl,
    servedFinalUrl: pagesUrl,
    servedSha256: artifactSha256,
    workflow: {
      repository: 'ahmedak320/bpmn-studio',
      runId: pagesRunId,
      workflow: 'Deploy approved tagged Lite artifact to Pages',
      job: 'readback'
    }
  }
  writeJson(pagesEvidencePath, pagesEvidence)
  const pagesEvidenceSha256 = sha256(Buffer.from(JSON.stringify(pagesEvidence, null, 2) + '\n'))

  const browserEvidence = {
    schemaVersion: 2,
    gate: 'orbitpm-lite-browser-compatibility-evidence',
    status: 'passed',
    verifiedAt: '2026-07-27T13:20:00.000Z',
    candidateSha,
    candidateReadyAt,
    artifactSha256,
    pagesUrl,
    pagesDeploymentEvidence: {
      sha256: pagesEvidenceSha256
    },
    source: {
      url: browserEvidenceUrl,
      finalUrl: browserEvidenceUrl,
      sha256: browserEvidenceSourceSha256
    },
    versionBaseline: {
      source: {
        url: baselineUrl,
        finalUrl: baselineUrl,
        sha256: baselineSha256
      }
    }
  }
  writeJson(browserEvidencePath, browserEvidence)
  const browserEvidenceAggregateSha256 = sha256(
    Buffer.from(JSON.stringify(browserEvidence, null, 2) + '\n')
  )

  const publicationAuthority = {
    gate: 'orbitpm-finalization-publication-authority',
    status: 'passed',
    candidateSha,
    releaseTag
  }
  writeJson(publicationAuthorityPath, publicationAuthority)
  const publicationAuthoritySha256 = sha256(
    Buffer.from(JSON.stringify(publicationAuthority, null, 2) + '\n')
  )

  const chain = {
    schemaVersion: 2,
    gate: 'orbitpm-lite-finalization-chain',
    status: 'passed',
    candidateSha,
    candidateReadyAt,
    artifactSha256,
    releaseTag,
    releaseRunId,
    pagesRunId,
    finalizationRunId,
    pagesUrl,
    releaseEvidenceSha256,
    pagesEvidenceSha256,
    publicationAuthoritySha256,
    browserCompatibilityEvidence: {
      url: browserEvidenceUrl,
      sourceSha256: browserEvidenceSourceSha256,
      aggregateSha256: browserEvidenceAggregateSha256
    },
    browserVersionBaseline: {
      url: baselineUrl,
      sha256: baselineSha256,
      sourceSha256: baselineSha256
    },
    externalEvidence: {
      url: externalEvidenceUrl,
      sha256: externalEvidenceSha256
    }
  }
  writeJson(chainPath, chain)

  return {
    artifactPath,
    artifactSha256,
    browserEvidence,
    browserEvidenceAggregateSha256,
    browserEvidencePath,
    chain,
    chainPath,
    pagesEvidence,
    pagesEvidencePath,
    pagesEvidenceSha256,
    publicationAuthorityPath,
    publicationAuthoritySha256,
    releaseEvidence,
    releaseEvidencePath,
    releaseEvidenceSha256
  }
}

function verifyFixture(fixture, overrides = {}) {
  return verifyFinalizationEvidenceChain(fixture.chain, {
    artifactSha256: fixture.artifactSha256,
    browserEvidence: fixture.browserEvidence,
    browserEvidenceAggregateSha256: fixture.browserEvidenceAggregateSha256,
    candidateSha,
    finalizationRunId,
    pagesEvidence: fixture.pagesEvidence,
    pagesEvidenceSha256: fixture.pagesEvidenceSha256,
    pagesUrl,
    publicationAuthoritySha256: fixture.publicationAuthoritySha256,
    releaseEvidence: fixture.releaseEvidence,
    releaseEvidenceSha256: fixture.releaseEvidenceSha256,
    releaseTag,
    ...overrides
  })
}

test('accepts the exact retained finalization chain and CLI contract', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-finalization-chain-pass-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const fixture = buildFixture(directory)

  assert.deepEqual(verifyFixture(fixture), {
    candidateSha,
    candidateReadyAt,
    artifactSha256: fixture.artifactSha256,
    finalizationRunId
  })

  const cli = spawnSync(
    process.execPath,
    [
      scriptPath,
      'verify',
      `--chain=${fixture.chainPath}`,
      `--candidate-sha=${candidateSha}`,
      `--release-tag=${releaseTag}`,
      `--finalization-run-id=${finalizationRunId}`,
      `--pages-url=${pagesUrl}`,
      `--artifact=${fixture.artifactPath}`,
      `--release-evidence=${fixture.releaseEvidencePath}`,
      `--pages-evidence=${fixture.pagesEvidencePath}`,
      `--publication-authority=${fixture.publicationAuthorityPath}`,
      `--browser-evidence=${fixture.browserEvidencePath}`
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8'
    }
  )
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /Verified finalization evidence chain/)
})

test('rejects blank candidate-ready, release, browser, baseline, and external bindings', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-finalization-chain-blank-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const fixture = buildFixture(directory)

  for (const [label, mutate] of [
    ['blank candidateReadyAt', (value) => (value.candidateReadyAt = '')],
    ['blank releaseEvidenceSha256', (value) => (value.releaseEvidenceSha256 = '')],
    ['blank browser URL', (value) => (value.browserCompatibilityEvidence.url = '')],
    ['blank baseline URL', (value) => (value.browserVersionBaseline.url = '')],
    ['blank external URL', (value) => (value.externalEvidence.url = '')]
  ]) {
    const chain = structuredClone(fixture.chain)
    mutate(chain)
    assert.throws(
      () =>
        verifyFinalizationEvidenceChain(chain, {
          artifactSha256: fixture.artifactSha256,
          browserEvidence: fixture.browserEvidence,
          browserEvidenceAggregateSha256: fixture.browserEvidenceAggregateSha256,
          candidateSha,
          finalizationRunId,
          pagesEvidence: fixture.pagesEvidence,
          pagesEvidenceSha256: fixture.pagesEvidenceSha256,
          pagesUrl,
          publicationAuthoritySha256: fixture.publicationAuthoritySha256,
          releaseEvidence: fixture.releaseEvidence,
          releaseEvidenceSha256: fixture.releaseEvidenceSha256,
          releaseTag
        }),
      undefined,
      label
    )
  }
})

test('rejects mismatched retained evidence identities', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-finalization-chain-mismatch-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const fixture = buildFixture(directory)

  const wrongPagesRun = structuredClone(fixture.chain)
  wrongPagesRun.pagesRunId = '99999999999'
  assert.throws(() => verifyFixture({ ...fixture, chain: wrongPagesRun }), /chain\.pagesRunId/)

  const wrongExternalDigest = structuredClone(fixture.chain)
  wrongExternalDigest.externalEvidence.sha256 = 'd'.repeat(64)
  assert.throws(
    () => verifyFixture({ ...fixture, chain: wrongExternalDigest }),
    /chain\.externalEvidence\.sha256/
  )

  const wrongBrowserDigest = structuredClone(fixture.browserEvidence)
  wrongBrowserDigest.pagesDeploymentEvidence.sha256 = 'e'.repeat(64)
  assert.throws(
    () => verifyFixture({ ...fixture, browserEvidence: wrongBrowserDigest }),
    /browser evidence\.pagesDeploymentEvidence\.sha256/
  )
})

test('CLI rejects missing, duplicate, unknown, and wrong-command options', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-finalization-chain-cli-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const fixture = buildFixture(directory)

  const base = [
    scriptPath,
    'verify',
    `--chain=${fixture.chainPath}`,
    `--candidate-sha=${candidateSha}`,
    `--release-tag=${releaseTag}`,
    `--finalization-run-id=${finalizationRunId}`,
    `--pages-url=${pagesUrl}`,
    `--artifact=${fixture.artifactPath}`,
    `--release-evidence=${fixture.releaseEvidencePath}`,
    `--pages-evidence=${fixture.pagesEvidencePath}`,
    `--publication-authority=${fixture.publicationAuthorityPath}`,
    `--browser-evidence=${fixture.browserEvidencePath}`
  ]
  const accepted = spawnSync(process.execPath, base, {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  assert.equal(accepted.status, 0, accepted.stderr)

  for (const [label, arguments_] of [
    ['missing release tag', base.filter((value) => !value.startsWith('--release-tag='))],
    ['duplicate option', [...base, `--browser-evidence=${fixture.browserEvidencePath}`]],
    ['unknown option', [...base, '--unexpected=true']],
    ['wrong command', [scriptPath, 'compare', ...base.slice(2)]],
    ['missing command', [scriptPath, ...base.slice(2)]]
  ]) {
    const result = spawnSync(process.execPath, arguments_, {
      cwd: repositoryRoot,
      encoding: 'utf8'
    })
    assert.notEqual(result.status, 0, label)
  }
})
