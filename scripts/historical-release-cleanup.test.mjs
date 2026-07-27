import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(new URL('./historical-release-cleanup.mjs', import.meta.url))
const repositoryRoot = resolve(dirname(scriptPath), '..')
const notice = 'Archived release: executable assets were removed.'
const originalBody = 'Original prerelease notes.\n'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function manifest() {
  return {
    schemaVersion: 1,
    archivalNotice: notice,
    stableReleaseTag: 'v9.0.0',
    expectedDeletionCount: 0,
    releases: [
      {
        releaseId: 42,
        tag: 'v0.0.1-alpha.2',
        originalName: 'Alpha 2',
        originalBodySha256: sha256(originalBody),
        draft: false,
        prerelease: true,
        tagRefSha: 'a'.repeat(40),
        peeledCommitSha: 'b'.repeat(40),
        assets: []
      }
    ]
  }
}

function run(arguments_) {
  return spawnSync(process.execPath, [scriptPath, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
}

test('metadata patch accepts a manifest-bound prerelease and exact archived readback', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-cleanup-metadata-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const manifestPath = join(directory, 'manifest.json')
  const releasePath = join(directory, 'release.json')
  const outputPath = join(directory, 'output.json')
  writeFileSync(manifestPath, JSON.stringify(manifest()))
  writeFileSync(
    releasePath,
    JSON.stringify({
      id: 42,
      tag_name: 'v0.0.1-alpha.2',
      name: 'Alpha 2',
      body: originalBody,
      draft: false,
      prerelease: true,
      immutable: false
    })
  )
  const options = [
    '--mode=metadata-patch',
    `--manifest=${manifestPath}`,
    `--release-json=${releasePath}`,
    '--release-id=42',
    `--output=${outputPath}`
  ]
  const original = run(options)
  assert.equal(original.status, 0, original.stderr)
  const plan = JSON.parse(readFileSync(outputPath, 'utf8'))
  assert.equal(plan.state, 'original')
  assert.deepEqual(plan.patch, {
    name: '[ARCHIVED] Alpha 2',
    body: `${notice}\n\n${originalBody}`
  })

  writeFileSync(
    releasePath,
    JSON.stringify({
      id: 42,
      tag_name: 'v0.0.1-alpha.2',
      ...plan.patch,
      draft: false,
      prerelease: true,
      immutable: false
    })
  )
  const archived = run(options)
  assert.equal(archived.status, 0, archived.stderr)
  assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).state, 'archived')

  const changed = JSON.parse(readFileSync(releasePath, 'utf8'))
  changed.body += 'unreviewed change'
  writeFileSync(releasePath, JSON.stringify(changed))
  const rejected = run(options)
  assert.notEqual(rejected.status, 0)
})

test('preflight rejects uppercase executable and updater names globally', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-cleanup-case-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const manifestPath = join(directory, 'manifest.json')
  const releasesPath = join(directory, 'releases.json')
  const outputPath = join(directory, 'output.json')
  writeFileSync(manifestPath, JSON.stringify(manifest()))
  writeFileSync(
    releasesPath,
    JSON.stringify([
      {
        id: 42,
        tag_name: 'v0.0.1-alpha.2',
        name: 'Alpha 2',
        body: originalBody,
        draft: false,
        prerelease: true,
        immutable: false,
        assets: []
      },
      {
        id: 43,
        tag_name: 'other',
        draft: false,
        prerelease: false,
        immutable: false,
        assets: [{ id: 1, name: 'TOOL.EXE', state: 'uploaded' }]
      }
    ])
  )
  const result = run([
    '--mode=preflight',
    `--manifest=${manifestPath}`,
    `--releases=${releasesPath}`,
    `--output=${outputPath}`
  ])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /prohibited asset TOOL\.EXE/)
})
