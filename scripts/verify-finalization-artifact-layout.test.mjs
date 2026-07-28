import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { verifyFinalizationArtifactLayout } from './verify-finalization-artifact-layout.mjs'

const scriptPath = fileURLToPath(
  new URL('./verify-finalization-artifact-layout.mjs', import.meta.url)
)
const repositoryRoot = resolve(dirname(scriptPath), '..')

const expectedFiles = [
  'finalize-evidence/browser-compatibility-evidence-verification.json',
  'finalize-evidence/finalization-chain.json',
  'finalize-evidence/pages/pages-browser-environment.json',
  'finalize-evidence/pages/trusted-release-external-evidence-verification.json',
  'finalize-evidence/trusted-release-external-evidence-verification.json',
  'latest-release.json',
  'publication-authority/publication-authority.json',
  'stable-release.json'
]

function createFixture(rootPath) {
  for (const relativePath of expectedFiles) {
    const fullPath = join(rootPath, relativePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, `${relativePath}\n`)
  }
}

test('accepts the exact immutable finalization artifact inventory and CLI contract', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-finalization-layout-pass-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  createFixture(directory)

  assert.deepEqual(verifyFinalizationArtifactLayout(directory), {
    fileCount: expectedFiles.length,
    files: [...expectedFiles].sort()
  })

  const cli = spawnSync(process.execPath, [scriptPath, `--root=${directory}`], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /Verified immutable finalization artifact layout/)
})

test('rejects missing, unexpected, and non-file inventory entries', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-finalization-layout-fail-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  createFixture(directory)

  rmSync(join(directory, 'finalize-evidence/browser-compatibility-evidence-verification.json'))
  assert.throws(() => verifyFinalizationArtifactLayout(directory), /Missing files:/)

  createFixture(directory)
  const extra = join(directory, 'finalize-evidence', 'unexpected.json')
  writeFileSync(extra, 'unexpected\n')
  assert.throws(() => verifyFinalizationArtifactLayout(directory), /Unexpected files:/)
})

test('CLI rejects missing, duplicate, unknown, and empty options', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-finalization-layout-cli-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  createFixture(directory)

  const accepted = spawnSync(process.execPath, [scriptPath, `--root=${directory}`], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  assert.equal(accepted.status, 0, accepted.stderr)

  for (const [label, arguments_] of [
    ['missing root', [scriptPath]],
    ['duplicate root', [scriptPath, `--root=${directory}`, `--root=${directory}`]],
    ['unknown option', [scriptPath, `--root=${directory}`, '--unexpected=true']],
    ['empty root', [scriptPath, '--root=']]
  ]) {
    const result = spawnSync(process.execPath, arguments_, {
      cwd: repositoryRoot,
      encoding: 'utf8'
    })
    assert.notEqual(result.status, 0, label)
  }
})
