import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REQUIRED_BROWSER_SUITES } from './release-suite-manifest.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

export default class ReleaseIntegrityReporter {
  constructor() {
    this.failures = []
    this.counts = { passed: 0, failed: 0, skipped: 0, interrupted: 0, retried: 0 }
  }

  onBegin(_config, suite) {
    const counts = new Map(REQUIRED_BROWSER_SUITES.map((path) => [path, 0]))
    for (const test of suite.allTests()) {
      const path = relative(repositoryRoot, test.location.file).replaceAll('\\', '/')
      if (counts.has(path)) counts.set(path, counts.get(path) + 1)
    }
    for (const [path, count] of counts) {
      if (count === 0) this.failures.push(`${path} contributed no discovered browser tests`)
    }
  }

  onTestEnd(test, result) {
    this.counts[result.status] = (this.counts[result.status] ?? 0) + 1
    if (result.retry > 0) {
      this.counts.retried += 1
      this.failures.push(`${test.titlePath().join(' > ')} ran retry ${result.retry}`)
    }
    if (test.expectedStatus !== 'passed') {
      this.failures.push(
        `${test.titlePath().join(' > ')} declared expected status ${test.expectedStatus}`
      )
    }
    if (result.status === 'skipped') {
      this.failures.push(`${test.titlePath().join(' > ')} was skipped at runtime`)
    }
  }

  async onEnd(result) {
    if (result.status !== 'passed') {
      this.failures.push(`Playwright run ended with status ${result.status}`)
    }
    const summary = {
      status: result.status,
      counts: this.counts,
      integrityFailures: this.failures
    }
    const output = process.env.ORBITPM_PLAYWRIGHT_SUMMARY
    if (output) {
      const path = resolve(output)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)
    }
    if (this.failures.length) {
      console.error('Playwright release integrity failed:')
      for (const failure of this.failures) console.error(`- ${failure}`)
      return { status: 'failed' }
    }
    console.log(
      `Playwright release integrity passed (${this.counts.passed} passed; zero skips/retries).`
    )
    return undefined
  }
}
