import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  REQUIRED_RELIABILITY_IDS,
  validateMandatoryEvidence,
  validateMandatoryExecution,
  validateReleaseDiscovery,
  validateReleaseExecution,
  validateReliabilityEvidence
} from './release-reporter.mjs'
import { MANDATORY_BROWSER_EVIDENCE, REQUIRED_BROWSER_SUITES } from './release-suite-manifest.mjs'

const suitePath = 'tests/e2e/lite-mandatory-reliability.spec.ts'

function evidence() {
  return {
    schemaVersion: 2,
    bundle: 'reliability',
    requiredRequirementIds: [...REQUIRED_RELIABILITY_IDS],
    suite: { path: suitePath, exactInventory: true },
    requirements: REQUIRED_RELIABILITY_IDS.map((id, index) => ({
      id,
      browserTests: [`reliability behavior ${index + 1}`]
    }))
  }
}

function discovered(
  titles = REQUIRED_RELIABILITY_IDS.map((_, index) => `reliability behavior ${index + 1}`)
) {
  return titles.map((title) => ({
    path: suitePath,
    project: 'chromium',
    title
  }))
}

function translationDescriptor() {
  return {
    bundle: 'translation',
    evidencePath: 'tests/e2e/mandatory-translation-evidence.json',
    requiredRequirementIds: ['TR-01', 'TR-02']
  }
}

function translationEvidence() {
  return {
    schemaVersion: 2,
    bundle: 'translation',
    requiredRequirementIds: ['TR-01', 'TR-02'],
    suite: {
      path: 'tests/e2e/lite-mandatory-translation.spec.ts',
      exactInventory: true
    },
    requirements: [
      {
        id: 'TR-01',
        browserTests: ['translation repairs the wrong target script']
      },
      {
        id: 'TR-02',
        browserTests: ['translation restores the missing language counterpart']
      }
    ]
  }
}

function translationDiscovery() {
  return [
    {
      path: 'tests/e2e/lite-mandatory-translation.spec.ts',
      project: 'chromium',
      title: 'translation repairs the wrong target script'
    },
    {
      path: 'tests/e2e/lite-mandatory-translation.spec.ts',
      project: 'chromium',
      title: 'translation restores the missing language counterpart'
    }
  ]
}

test('accepts a comprehensive exact reliability binding to Playwright-discovered titles', () => {
  assert.deepEqual(validateReliabilityEvidence(evidence(), discovered()), [])
})

test('rejects stale evidence titles and newly discovered unmapped tests', () => {
  const record = evidence()
  record.requirements[4].browserTests = ['stale REL-05 title']
  const failures = validateReliabilityEvidence(record, discovered())

  assert(failures.some((failure) => failure.includes('stale REL-05 title')))
  assert(
    failures.some(
      (failure) =>
        failure.includes('reliability behavior 5') &&
        failure.includes('is not mapped to a required scenario ID')
    )
  )
})

test('rejects missing, reordered, or duplicate required IDs', () => {
  const missing = evidence()
  missing.requiredRequirementIds.pop()
  missing.requirements.pop()
  assert(
    validateReliabilityEvidence(missing, discovered()).some((failure) =>
      failure.includes('requiredRequirementIds must be exactly')
    )
  )

  const reordered = evidence()
  ;[reordered.requirements[0], reordered.requirements[1]] = [
    reordered.requirements[1],
    reordered.requirements[0]
  ]
  assert(
    validateReliabilityEvidence(reordered, discovered()).some((failure) =>
      failure.includes('requirement IDs must be exactly')
    )
  )

  const duplicate = evidence()
  duplicate.requirements[1].id = duplicate.requirements[0].id
  assert(
    validateReliabilityEvidence(duplicate, discovered()).some((failure) =>
      failure.includes('repeats requirement IDs')
    )
  )
})

test('rejects non-unique discovered titles using Playwright project semantics', () => {
  const titles = REQUIRED_RELIABILITY_IDS.map((_, index) => `reliability behavior ${index + 1}`)
  titles.push('reliability behavior 5')
  const failures = validateReliabilityEvidence(evidence(), discovered(titles))

  assert(
    failures.some((failure) =>
      failure.includes('REL-05 discovered 2 matching tests; expected exactly 1')
    )
  )
  assert(
    failures.some(
      (failure) =>
        failure.includes('discovered reliability test') && failure.includes('occurs 2 times')
    )
  )
})

test('rejects zero-test and partial Playwright discovery per project and required spec', () => {
  assert(
    validateReleaseDiscovery([], ['chromium'], REQUIRED_BROWSER_SUITES).some((failure) =>
      failure.includes('discovery yielded zero tests')
    )
  )

  const partial = [
    {
      path: REQUIRED_BROWSER_SUITES[0],
      project: 'chromium',
      title: 'only one discovered test'
    }
  ]
  const failures = validateReleaseDiscovery(partial, ['chromium'], REQUIRED_BROWSER_SUITES)
  assert(
    failures.some((failure) =>
      failure.includes(`${REQUIRED_BROWSER_SUITES[1]} contributed no discovered browser tests`)
    )
  )
})

test('rejects zero and partial execution per project and spec', () => {
  const expected = [
    {
      path: REQUIRED_BROWSER_SUITES[0],
      project: 'chromium',
      title: 'first spec test'
    },
    {
      path: REQUIRED_BROWSER_SUITES[1],
      project: 'chromium',
      title: 'second spec test'
    }
  ]
  const zeroFailures = validateReleaseExecution(expected, [])
  assert(zeroFailures.some((failure) => failure.includes('execution yielded zero tests')))

  const partial = validateReleaseExecution(expected, [expected[0]])
  assert(
    partial.some((failure) =>
      failure.includes(`${REQUIRED_BROWSER_SUITES[1]} executed zero browser tests`)
    )
  )
})

test('rejects deletion of any exact mandatory scenario mapping outside reliability', () => {
  const record = translationEvidence()
  const allTests = translationDiscovery()
  assert.deepEqual(
    validateMandatoryEvidence(record, allTests, ['chromium'], translationDescriptor()),
    []
  )

  const afterDeletion = validateMandatoryEvidence(
    record,
    allTests.slice(0, 1),
    ['chromium'],
    translationDescriptor()
  )
  assert(
    afterDeletion.some(
      (failure) =>
        failure.includes('TR-02') &&
        failure.includes('discovered 0 matching tests; expected exactly 1')
    )
  )
})

test('rejects a placeholder test even when the evidence is changed to name it', () => {
  const record = translationEvidence()
  record.requirements[1].browserTests = ['placeholder translation test']
  const tests = translationDiscovery()
  tests[1].title = 'placeholder translation test'
  const failures = validateMandatoryEvidence(record, tests, ['chromium'], translationDescriptor())

  assert(
    failures.some((failure) =>
      failure.includes('TR-02 contains an invalid or placeholder browser test binding')
    )
  )
  assert(
    failures.some(
      (failure) =>
        failure.includes('placeholder translation test') &&
        failure.includes('not mapped to a required scenario ID')
    )
  )
})

test('requires every mapped mandatory test to execute exactly once', () => {
  const record = translationEvidence()
  const allTests = translationDiscovery()
  const missing = validateMandatoryExecution(
    record,
    allTests,
    allTests.slice(0, 1),
    translationDescriptor()
  )
  assert(
    missing.some(
      (failure) =>
        failure.includes('translation restores the missing language counterpart') &&
        failure.includes('executed 0 tests; expected exactly 1')
    )
  )

  const duplicate = validateMandatoryExecution(
    record,
    allTests,
    [...allTests, allTests[1]],
    translationDescriptor()
  )
  assert(
    duplicate.some(
      (failure) =>
        failure.includes('translation restores the missing language counterpart') &&
        failure.includes('executed 2 tests; expected exactly 1')
    )
  )
})

test('declares exact evidence for every section-5 mandatory scenario bundle', () => {
  assert.deepEqual(
    MANDATORY_BROWSER_EVIDENCE.map(({ bundle, requiredRequirementIds }) => [
      bundle,
      requiredRequirementIds.length
    ]),
    [
      ['reliability', 11],
      ['translation', 10],
      ['spreadsheet', 10],
      ['ui-accessibility', 9],
      ['ai-security', 10]
    ]
  )
})

test('validates every committed mandatory evidence file across multiple projects', () => {
  for (const descriptor of MANDATORY_BROWSER_EVIDENCE) {
    const record = JSON.parse(readFileSync(descriptor.evidencePath, 'utf8'))
    const paths = typeof record.suite.path === 'string' ? [record.suite.path] : record.suite.paths
    const defaultPath = paths.length === 1 ? paths[0] : undefined
    const uniqueBindings = new Map()
    for (const requirement of record.requirements) {
      for (const browserTest of requirement.browserTests) {
        const binding =
          typeof browserTest === 'string' ? { path: defaultPath, title: browserTest } : browserTest
        uniqueBindings.set(JSON.stringify([binding.path, binding.title]), binding)
      }
    }
    const tests = ['chromium', 'firefox'].flatMap((project) =>
      [...uniqueBindings.values()].map(({ path, title }) => ({ path, project, title }))
    )

    assert.deepEqual(
      validateMandatoryEvidence(record, tests, ['chromium', 'firefox'], descriptor),
      [],
      descriptor.bundle
    )
  }
})
