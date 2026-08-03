// CI smoke test for the `epc-project` headless CLI (implementation plan Lane L-CLI, Wave 22;
// deliverable 4, CLI half; authorized change 4). Wired into `.github/workflows/quality.yml`'s
// policy job, which has no separate lib-build step — the `before` hook below builds
// `packages/epc-engine/dist/` once for the whole file.
//
// Exit-code contract under test (BINDING): 0 = ok; 1 = error-severity EPC validation findings
// (failure artifacts still written); 2 = usage/IO/JSON-parse error.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { before, test } from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testFilePath = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(dirname(testFilePath), '..')
const cliPath = join(repositoryRoot, 'packages/epc-engine/bin/epc-project.mjs')

before(() => {
  execFileSync('npm', ['run', 'build:lib'], { cwd: repositoryRoot, stdio: 'inherit' })
})

// ---------------------------------------------------------------------------
// Fixtures (hand-written CanonicalProcessV1-shaped JSON, mirroring the house
// style of src/aris/canonical/fixtures.ts — not imported from src/, since this
// suite runs under plain `node --test`, outside the vitest src/** graph).
// ---------------------------------------------------------------------------

/** A schema-valid, EPC-structurally-clean start -> activity -> end flow. */
const VALID_MINIMAL = {
  version: 1,
  identity: {
    id: 'proc-minimal',
    names: { en: 'Minimal Process', ar: 'عملية بسيطة' },
    confidence: 'high'
  },
  nodes: [
    { id: 'n-start', kind: 'event', names: { en: 'Start', ar: 'بداية' }, confidence: 'high' },
    {
      id: 'n-task',
      kind: 'activity',
      names: { en: 'Perform task', ar: 'تنفيذ المهمة' },
      confidence: 'medium'
    },
    { id: 'n-end', kind: 'event', names: { en: 'End', ar: 'نهاية' }, confidence: 'high' }
  ],
  decisions: [],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-task',
      confidence: 'high'
    },
    {
      id: 'e-2',
      kind: 'sequence',
      sourceNodeId: 'n-task',
      targetNodeId: 'n-end',
      confidence: 'high'
    }
  ],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
}

/** The one intended defect: an undeclared top-level key -> zod `unrecognized_keys`. */
const INVALID_UNKNOWN_KEY = {
  ...VALID_MINIMAL,
  identity: { ...VALID_MINIMAL.identity, id: 'proc-invalid-unknown-key' },
  unexpectedTopLevelField: 'sneaky'
}

/** Schema-valid, but its projected EEPC has no start/end event — fails the structural gate. */
const STRUCTURALLY_INVALID = {
  version: 1,
  identity: { id: 'proc-broken', names: { en: 'Broken' }, confidence: 'high' },
  nodes: [{ id: 'n-only', kind: 'activity', names: { en: 'Lonely activity' }, confidence: 'high' }],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options
  })
}

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `orbitpm-epc-cli-${prefix}-`))
}

// ---------------------------------------------------------------------------
// (a) validate — clean input
// ---------------------------------------------------------------------------

test('validate: a schema-valid, EPC-clean process exits 0 and prints EpcProjectionFindings on stdout', (context) => {
  const directory = tempDir('validate-ok')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  writeFileSync(inputPath, JSON.stringify(VALID_MINIMAL))

  const result = runCli(['validate', inputPath])

  assert.equal(result.status, 0, result.stderr)
  const findings = JSON.parse(result.stdout)
  assert.equal(findings.ok, true)
  assert.equal(findings.schemaVersion, 1)
  assert.equal(findings.projectionVersion, 1)
  assert.equal(typeof findings.inputSha256, 'string')
  assert.match(findings.inputSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(findings.findings, [])
})

// ---------------------------------------------------------------------------
// (b) validate — schema-invalid input (unknown key)
// ---------------------------------------------------------------------------

test('validate: a schema-invalid process (unknown top-level key) exits 2 with a zod issue on stderr', (context) => {
  const directory = tempDir('validate-bad-schema')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  writeFileSync(inputPath, JSON.stringify(INVALID_UNKNOWN_KEY))

  const result = runCli(['validate', inputPath])

  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /unrecognized_keys/)
})

// ---------------------------------------------------------------------------
// (c) project --out
// ---------------------------------------------------------------------------

test('project: writes draft.json + model.aml.xml + findings.json + verification.json + narrative.md and exits 0 on a clean process', (context) => {
  const directory = tempDir('project-ok')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  const outDir = join(directory, 'out')
  writeFileSync(inputPath, JSON.stringify(VALID_MINIMAL))

  const result = runCli(['project', inputPath, '--out', outDir])

  assert.equal(result.status, 0, result.stderr)
  const draft = JSON.parse(readFileSync(join(outDir, 'draft.json'), 'utf8'))
  assert.equal(draft.version, 1)
  assert.ok(Array.isArray(draft.objects) && draft.objects.length > 0)
  const aml = readFileSync(join(outDir, 'model.aml.xml'), 'utf8')
  assert.ok(aml.length > 0)
  assert.match(aml, /<AML>|<Model\b/)
  const findings = JSON.parse(readFileSync(join(outDir, 'findings.json'), 'utf8'))
  assert.equal(findings.ok, true)
  const narrative = readFileSync(join(outDir, 'narrative.md'), 'utf8')
  assert.match(narrative, /Minimal Process/)
  assert.match(narrative, /عملية بسيطة/)
  const verification = JSON.parse(readFileSync(join(outDir, 'verification.json'), 'utf8'))
  assert.equal(verification.schemaVersion, 2)
  assert.equal(verification.processId, 'proc-minimal')
})

test('project: writes failure artifacts (incl. model.aml.xml) and exits 1 when the EPC structural gate fails', (context) => {
  const directory = tempDir('project-gate')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  const outDir = join(directory, 'out')
  writeFileSync(inputPath, JSON.stringify(STRUCTURALLY_INVALID))

  const result = runCli(['project', inputPath, '--out', outDir])

  assert.equal(result.status, 1)
  assert.ok(existsSync(join(outDir, 'draft.json')))
  assert.ok(existsSync(join(outDir, 'narrative.md')))
  const aml = readFileSync(join(outDir, 'model.aml.xml'), 'utf8')
  assert.match(aml, /<AML>|<Model\b/)
  const findings = JSON.parse(readFileSync(join(outDir, 'findings.json'), 'utf8'))
  assert.equal(findings.ok, false)
  assert.ok(findings.findings.some((finding) => finding.severity === 'error'))
})

// ---------------------------------------------------------------------------
// (d) render --out (+ --version passthrough)
// ---------------------------------------------------------------------------

test('render: writes process.svg + metadata.json + findings.json + verification.json + narrative.md, anchored + versioned', (context) => {
  const directory = tempDir('render-ok')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  const outDir = join(directory, 'out')
  writeFileSync(inputPath, JSON.stringify(VALID_MINIMAL))

  const result = runCli(['render', inputPath, '--out', outDir, '--version', 'v002'])

  assert.equal(result.status, 0, result.stderr)
  const svg = readFileSync(join(outDir, 'process.svg'), 'utf8')
  assert.match(svg, /<svg[^>]* data-epc-engine-version="[^"]+"/)
  assert.match(svg, /data-epc-schema-version="1"/)
  assert.match(svg, /data-epc-projection-version="1"/)
  assert.match(svg, /data-epc-input-sha256="[0-9a-f]{64}"/)
  assert.match(svg, /data-epc-source-version="v002"/)
  assert.ok((svg.match(/data-epc-node="/g) ?? []).length >= 1)

  const metadata = JSON.parse(readFileSync(join(outDir, 'metadata.json'), 'utf8'))
  assert.equal(metadata.sourceVersionId, 'v002')
  assert.equal(metadata.schemaVersion, 1)

  const findings = JSON.parse(readFileSync(join(outDir, 'findings.json'), 'utf8'))
  assert.equal(findings.ok, true)

  const narrative = readFileSync(join(outDir, 'narrative.md'), 'utf8')
  assert.match(narrative, /Minimal Process/)

  const verification = JSON.parse(readFileSync(join(outDir, 'verification.json'), 'utf8'))
  assert.equal(verification.schemaVersion, 2)
  assert.equal(verification.processId, 'proc-minimal')
})

test('render: writes findings.json + verification.json (no svg/metadata) and exits 1 when the structural gate fails', (context) => {
  const directory = tempDir('render-gate')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  const outDir = join(directory, 'out')
  writeFileSync(inputPath, JSON.stringify(STRUCTURALLY_INVALID))

  const result = runCli(['render', inputPath, '--out', outDir])

  assert.equal(result.status, 1)
  assert.ok(!existsSync(join(outDir, 'process.svg')))
  assert.ok(!existsSync(join(outDir, 'metadata.json')))
  const findings = JSON.parse(readFileSync(join(outDir, 'findings.json'), 'utf8'))
  assert.equal(findings.ok, false)
  // verification.json is a parse-level artifact — written even when the structural gate fails.
  assert.ok(existsSync(join(outDir, 'verification.json')))
})

// ---------------------------------------------------------------------------
// (e) determinism — render twice, byte-identical svg + metadata
// ---------------------------------------------------------------------------

test('render determinism: two runs on the same input produce byte-identical svg and metadata', (context) => {
  const directory = tempDir('render-determinism')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  writeFileSync(inputPath, JSON.stringify(VALID_MINIMAL))
  const outA = join(directory, 'out-a')
  const outB = join(directory, 'out-b')

  const resultA = runCli(['render', inputPath, '--out', outA])
  const resultB = runCli(['render', inputPath, '--out', outB])

  assert.equal(resultA.status, 0, resultA.stderr)
  assert.equal(resultB.status, 0, resultB.stderr)
  assert.ok(readFileSync(join(outA, 'process.svg')).equals(readFileSync(join(outB, 'process.svg'))))
  assert.equal(
    readFileSync(join(outA, 'metadata.json'), 'utf8'),
    readFileSync(join(outB, 'metadata.json'), 'utf8')
  )
  assert.equal(
    readFileSync(join(outA, 'findings.json'), 'utf8'),
    readFileSync(join(outB, 'findings.json'), 'utf8')
  )
})

// ---------------------------------------------------------------------------
// (f) stdin mode
// ---------------------------------------------------------------------------

test('validate: reads the input from stdin when the argument is "-"', () => {
  const result = runCli(['validate', '-'], { input: JSON.stringify(VALID_MINIMAL) })

  assert.equal(result.status, 0, result.stderr)
  const findings = JSON.parse(result.stdout)
  assert.equal(findings.ok, true)
})

// ---------------------------------------------------------------------------
// Additional exit-code-contract coverage (usage errors -> 2)
// ---------------------------------------------------------------------------

test('validate: a schema-valid but EPC-structurally-broken process exits 1 with error findings on stdout', (context) => {
  const directory = tempDir('validate-gate')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  writeFileSync(inputPath, JSON.stringify(STRUCTURALLY_INVALID))

  const result = runCli(['validate', inputPath])

  assert.equal(result.status, 1)
  const findings = JSON.parse(result.stdout)
  assert.equal(findings.ok, false)
  assert.ok(findings.findings.some((finding) => finding.severity === 'error'))
})

test('usage: an unknown command exits 2', () => {
  const result = runCli(['bogus', '/dev/null'])
  assert.equal(result.status, 2)
})

test('usage: a missing input argument exits 2', () => {
  const result = runCli(['validate'])
  assert.equal(result.status, 2)
})

test('usage: malformed JSON input exits 2', (context) => {
  const directory = tempDir('bad-json')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'input.json')
  writeFileSync(inputPath, '{ not json')

  const result = runCli(['validate', inputPath])

  assert.equal(result.status, 2)
})

test('usage: project/render without --out exits 2', () => {
  const missingOutForProject = runCli(['project', '/dev/null'])
  assert.equal(missingOutForProject.status, 2)
  const missingOutForRender = runCli(['render', '/dev/null'])
  assert.equal(missingOutForRender.status, 2)
})
