import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { REQUIRED_BROWSER_SUITES } from './release-suite-manifest.mjs'

const tracked = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean)
  .filter((path) => existsSync(path))

const testFiles = tracked.filter(
  (path) =>
    /^(?:src|tests)\/.*\.(?:[cm]?[jt]sx?)$/.test(path) ||
    /^scripts\/.*\.test\.mjs$/.test(path) ||
    /^(?:playwright|vitest)\.config\.ts$/.test(path)
)
const nodeReleaseTests = tracked.filter((path) => /^scripts\/.*\.test\.mjs$/.test(path)).sort()

const prohibited = [
  {
    label: 'skipped suite/test',
    pattern:
      /\b(?:test|it|describe|suite|specify)(?:\s*\.\s*[A-Za-z]+)*\s*\.\s*(?:skip|skipIf|todo|fixme|fail|fails)(?:\s*\.\s*[A-Za-z]+)*\s*(?:\(|<)/
  },
  {
    label: 'focused-only suite/test',
    pattern:
      /\b(?:test|it|describe|suite|specify)(?:\s*\.\s*[A-Za-z]+)*\s*\.\s*only(?:\s*\.\s*[A-Za-z]+)*\s*(?:\(|<)/
  },
  {
    label: 'conditional test execution',
    pattern:
      /\b(?:test|it|describe|suite|specify)(?:\s*\.\s*[A-Za-z]+)*\s*\.\s*runIf(?:\s*\.\s*[A-Za-z]+)*\s*(?:\(|<)/
  },
  {
    label: 'disabled or focused alias',
    pattern: /\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/
  },
  {
    label: 'runtime test skip/fixme annotation',
    pattern: /\btestInfo\s*\.\s*(?:skip|fixme|fail)\s*\(/
  },
  {
    label: 'retry override',
    pattern: /\b(?:retries|retry)\s*:\s*[1-9]\d*\b|--retries(?:=|\s+)[1-9]\d*/
  }
]

const nodeTestProhibited = [
  {
    label: 'node:test skipped/todo/focused method',
    pattern: /\.\s*(?:skip|todo|only)\s*(?:\(|<)/
  },
  {
    label: 'node:test skipped/todo/focused option',
    pattern: /\b(?:skip|todo|only)\s*:/
  }
]

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length
}

function matches(source, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return source.matchAll(new RegExp(pattern.source, flags))
}

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
