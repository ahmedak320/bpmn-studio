import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { REQUIRED_BROWSER_SUITES } from './release-suite-manifest.mjs'
import {
  fixtureGuardViolations,
  lineNumberAt,
  matches,
  nodeTestProhibited,
  prohibited
} from './check-no-skips-rules.mjs'

const tracked = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean)
  .filter((path) => existsSync(path))

const testFiles = tracked
  .filter(
    (path) =>
      /^(?:src|tests)\/.*\.(?:[cm]?[jt]sx?)$/.test(path) ||
      /^scripts\/.*\.test\.mjs$/.test(path) ||
      /^(?:playwright|vitest)\.config\.ts$/.test(path)
  )
  // `*.animalwf.test.ts` suites depend on the private, uncommitted AnimalWF reference export and
  // run only through the dedicated, unconditional `npm run test:aris:animalwf` entry point (see
  // vitest.animalwf.config.ts) — never through the default project this scan otherwise mirrors.
  // They contain no conditional execution by design, but are excluded here too so that
  // convention stays authoritative in exactly one place.
  .filter((path) => !/\.animalwf\.test\.ts$/.test(path))
const nodeReleaseTests = tracked.filter((path) => /^scripts\/.*\.test\.mjs$/.test(path)).sort()

const failures = []
const qualityWorkflow = readFileSync('.github/workflows/quality.yml', 'utf8')
const qualityLines = qualityWorkflow.split('\n')
const nodeTestCommands = []
for (let index = 0; index < qualityLines.length; index += 1) {
  const line = qualityLines[index]
  const inline = line.match(/^\s*run:\s+(node --test(?:\s.*)?)\s*$/)
  if (inline) {
    nodeTestCommands.push(inline[1])
    continue
  }
  const folded = line.match(/^(\s+)(node --test(?:\s.*)?)\s*$/)
  if (!folded) continue
  const indentation = folded[1].length
  const commandLines = [folded[2]]
  for (let continuation = index + 1; continuation < qualityLines.length; continuation += 1) {
    const continuationLine = qualityLines[continuation]
    if (continuationLine.trim().length === 0) continue
    const continuationIndentation = continuationLine.match(/^\s*/)[0].length
    if (continuationIndentation < indentation) break
    commandLines.push(continuationLine.trim())
  }
  nodeTestCommands.push(commandLines.join(' '))
}
const nodeTestTokens = nodeTestCommands
  .map((command) => command.replace(/\s+#.*$/u, ''))
  .flatMap((command) => command.split(/\s+/u))
  .map((token) => token.replace(/^(['"])(.*)\1$/u, '$2'))
if (nodeReleaseTests.length === 0) {
  failures.push('release verifier node:test inventory is empty')
}
for (const path of nodeReleaseTests) {
  const invocationCount = nodeTestTokens.filter((token) => token === path).length
  if (invocationCount !== 1) {
    failures.push(
      `.github/workflows/quality.yml executes ${path} ${invocationCount} times; expected exactly once`
    )
  }
}
if (nodeTestCommands.length === 0) {
  failures.push('.github/workflows/quality.yml has no node --test release-verifier command')
}
if (
  nodeTestCommands.some((command) =>
    /(?:^|\s)--test-(?:name-pattern|only|shard)(?:=|\s|$)/u.test(command)
  )
) {
  failures.push(
    '.github/workflows/quality.yml must not filter, focus, or shard release-verifier node tests'
  )
}
const trackedBrowserSuites = testFiles
  .filter((path) => /^tests\/e2e\/.*\.spec\.ts$/.test(path))
  .sort()
const requiredBrowserSuites = [...REQUIRED_BROWSER_SUITES].sort()
if (JSON.stringify(requiredBrowserSuites) !== JSON.stringify(trackedBrowserSuites)) {
  const missingFromManifest = trackedBrowserSuites.filter(
    (path) => !requiredBrowserSuites.includes(path)
  )
  const missingFromTree = requiredBrowserSuites.filter(
    (path) => !trackedBrowserSuites.includes(path)
  )
  if (missingFromManifest.length) {
    failures.push(
      `release suite manifest omits tracked browser suites: ${missingFromManifest.join(', ')}`
    )
  }
  if (missingFromTree.length) {
    failures.push(
      `release suite manifest names missing browser suites: ${missingFromTree.join(', ')}`
    )
  }
}
for (const requiredSuite of REQUIRED_BROWSER_SUITES) {
  if (!testFiles.includes(requiredSuite)) {
    failures.push(`${requiredSuite}: required release browser suite is missing`)
  }
}
for (const path of testFiles) {
  const source = readFileSync(path, 'utf8')
  const rules = /^scripts\/.*\.test\.mjs$/.test(path)
    ? [...prohibited, ...nodeTestProhibited]
    : prohibited
  for (const rule of rules) {
    for (const match of matches(source, rule.pattern)) {
      failures.push(`${path}:${lineNumberAt(source, match.index)}: ${rule.label}`)
    }
  }
  for (const index of fixtureGuardViolations(path, source)) {
    failures.push(
      `${path}:${lineNumberAt(source, index)}: checks for a private reference/... fixture ` +
        '(existsSync) but is not named *.animalwf.test.ts — fixture-dependent suites must use ' +
        'the *.animalwf.test.ts convention (see vitest.animalwf.config.ts) so they throw at ' +
        'module load instead of silently skipping or no-oping when the fixture is absent'
    )
  }
}

const playwrightConfig = readFileSync('playwright.config.ts', 'utf8')
if (!/\bretries\s*:\s*0\b/.test(playwrightConfig)) {
  failures.push('playwright.config.ts: release retries must be explicitly set to 0')
}

if (failures.length) {
  console.error('Release-test integrity check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Release-test integrity passed (${testFiles.length} files, including ${nodeReleaseTests.length} node:test release verifiers; no skip/todo/only/quarantine/retry APIs).`
)
