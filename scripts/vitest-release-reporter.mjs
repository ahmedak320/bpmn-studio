export default class VitestReleaseIntegrityReporter {
  constructor() {
    this.counts = { passed: 0, failed: 0, skipped: 0, pending: 0 }
    this.integrityFailures = []
  }

  onTestCaseResult(testCase) {
    const result = testCase.result()
    this.counts[result.state] = (this.counts[result.state] ?? 0) + 1
    const label = testCase.fullName

    if (result.state === 'skipped') {
      this.integrityFailures.push(`${label} was skipped at runtime (mode=${testCase.options.mode})`)
    }
    if (testCase.options.mode === 'only') {
      this.integrityFailures.push(`${label} was focused with .only`)
    }
    if (testCase.options.fails) {
      this.integrityFailures.push(`${label} used expected-failure mode`)
    }
    if ((testCase.options.retry ?? 0) > 0) {
      this.integrityFailures.push(`${label} configured ${testCase.options.retry} retries`)
    }

    const diagnostic = testCase.diagnostic()
    if ((diagnostic?.retryCount ?? 0) > 0 || diagnostic?.flaky) {
      this.integrityFailures.push(
        `${label} retried ${diagnostic?.retryCount ?? 0} time(s) or was flaky`
      )
    }
  }

  onTestRunEnd(_testModules, unhandledErrors, reason) {
    if (reason !== 'passed') {
      this.integrityFailures.push(`Vitest run ended with status ${reason}`)
    }
    if (unhandledErrors.length > 0) {
      this.integrityFailures.push(`Vitest reported ${unhandledErrors.length} unhandled error(s)`)
    }
    if (this.integrityFailures.length) {
      console.error('Vitest release integrity failed:')
      for (const failure of this.integrityFailures) console.error(`- ${failure}`)
      process.exitCode = 1
      return
    }
    console.log(
      `Vitest release integrity passed (${this.counts.passed} passed; ` +
        `zero runtime skips/todos/expected failures/retries; run=${reason}).`
    )
  }
}
