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
    /^(?:playwright|vitest)\.config\.ts$/.test(path)
)

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

const failures = []
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
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const rule of prohibited) {
      if (rule.pattern.test(line)) {
        failures.push(`${path}:${index + 1}: ${rule.label}`)
      }
    }
  })
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
  `Release-test integrity passed (${testFiles.length} files; no skip/todo/only/quarantine/retry APIs).`
)
