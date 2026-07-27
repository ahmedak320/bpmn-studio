import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANDATORY_BROWSER_EVIDENCE, REQUIRED_BROWSER_SUITES } from './release-suite-manifest.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const reliabilityEvidence = MANDATORY_BROWSER_EVIDENCE.find(
  ({ bundle }) => bundle === 'reliability'
)

export const REQUIRED_RELIABILITY_IDS = reliabilityEvidence.requiredRequirementIds

function duplicates(values) {
  const seen = new Set()
  const repeated = new Set()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated]
}

function exactOrderedValues(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

function projectName(test) {
  return test.project || '<unnamed-project>'
}

function projectSpecKey(project, path) {
  return JSON.stringify([project, path])
}

function projectTestKey(project, path, title) {
  return JSON.stringify([project, path, title])
}

function testKey(path, title) {
  return JSON.stringify([path, title])
}

function suitePaths(evidence) {
  if (typeof evidence?.suite?.path === 'string') return [evidence.suite.path]
  return Array.isArray(evidence?.suite?.paths) ? evidence.suite.paths : []
}

function normalizedBinding(binding, defaultPath) {
  if (typeof binding === 'string') {
    return { path: defaultPath, title: binding }
  }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return null
  return { path: binding.path, title: binding.title }
}

function mandatoryTestBindings(evidence) {
  const paths = suitePaths(evidence)
  const defaultPath = paths.length === 1 ? paths[0] : undefined
  const bindings = []
  for (const requirement of Array.isArray(evidence?.requirements) ? evidence.requirements : []) {
    for (const browserTest of Array.isArray(requirement?.browserTests)
      ? requirement.browserTests
      : []) {
      const binding = normalizedBinding(browserTest, defaultPath)
      if (binding) bindings.push(binding)
    }
  }
  return bindings
}

export function validateReleaseDiscovery(
  discoveredTests,
  expectedProjects,
  requiredSuites = REQUIRED_BROWSER_SUITES
) {
  const failures = []
  if (discoveredTests.length === 0) {
    failures.push('Playwright discovery yielded zero tests')
  }
  const projects = [...new Set(expectedProjects)]
  if (projects.length === 0) {
    failures.push('Playwright discovery yielded zero configured projects')
  }
  for (const project of projects) {
    for (const path of requiredSuites) {
      const count = discoveredTests.filter(
        (test) => projectName(test) === project && test.path === path
      ).length
      if (count === 0) {
        failures.push(`${project}: ${path} contributed no discovered browser tests`)
      }
    }
  }
  return failures
}

export function validateReleaseExecution(discoveredTests, executedTests) {
  const failures = []
  if (executedTests.length === 0) {
    failures.push('Playwright execution yielded zero tests')
  }

  const expectedProjectSpecs = new Set(
    discoveredTests
      .filter((test) => REQUIRED_BROWSER_SUITES.includes(test.path))
      .map((test) => projectSpecKey(projectName(test), test.path))
  )
  const executedProjectSpecs = new Map()
  for (const test of executedTests) {
    const key = projectSpecKey(projectName(test), test.path)
    executedProjectSpecs.set(key, (executedProjectSpecs.get(key) ?? 0) + 1)
  }
  for (const key of expectedProjectSpecs) {
    if ((executedProjectSpecs.get(key) ?? 0) > 0) continue
    const [project, path] = JSON.parse(key)
    failures.push(`${project}: ${path} executed zero browser tests`)
  }
  return failures
}

/**
 * Bind every hand-authored mandatory-scenario record to Playwright's discovered
 * graph. Discovery is reporter-owned so parameter expansion, projects, and
 * Playwright's actual title semantics are authoritative; source-text regexes
 * are deliberately not used.
 */
export function validateMandatoryEvidence(evidence, discoveredTests, expectedProjects, descriptor) {
  const failures = []
  const label = descriptor.bundle
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return [`mandatory ${label} evidence must be a JSON object`]
  }
  if (evidence.schemaVersion !== 2) {
    failures.push(`mandatory ${label} evidence schemaVersion must be 2`)
  }
  if (evidence.bundle !== descriptor.bundle) {
    failures.push(`mandatory ${label} evidence bundle must be ${descriptor.bundle}`)
  }
  if (!exactOrderedValues(evidence.requiredRequirementIds, descriptor.requiredRequirementIds)) {
    failures.push(
      `mandatory ${label} evidence requiredRequirementIds must be exactly ${descriptor.requiredRequirementIds.join(', ')}`
    )
  }

  const declaredPaths = suitePaths(evidence)
  if (
    declaredPaths.length === 0 ||
    duplicates(declaredPaths).length > 0 ||
    declaredPaths.some((path) => !REQUIRED_BROWSER_SUITES.includes(path))
  ) {
    failures.push(`mandatory ${label} evidence suite paths must be unique required browser suites`)
  }
  if (evidence.suite?.exactInventory !== true && evidence.suite?.exactInventory !== false) {
    failures.push(`mandatory ${label} evidence suite.exactInventory must be boolean`)
  }

  const requirements = Array.isArray(evidence.requirements) ? evidence.requirements : []
  if (!Array.isArray(evidence.requirements)) {
    failures.push(`mandatory ${label} evidence requirements must be an array`)
  }
  const requirementIds = requirements.map((requirement) => requirement?.id)
  if (!exactOrderedValues(requirementIds, descriptor.requiredRequirementIds)) {
    failures.push(
      `mandatory ${label} evidence requirement IDs must be exactly ${descriptor.requiredRequirementIds.join(', ')}`
    )
  }
  const duplicateIds = duplicates(requirementIds)
  if (duplicateIds.length) {
    failures.push(`mandatory ${label} evidence repeats requirement IDs: ${duplicateIds.join(', ')}`)
  }

  const bindingToIds = new Map()
  const defaultPath = declaredPaths.length === 1 ? declaredPaths[0] : undefined
  for (const requirement of requirements) {
    const id = typeof requirement?.id === 'string' ? requirement.id : '<invalid-id>'
    if (!Array.isArray(requirement?.browserTests) || requirement.browserTests.length === 0) {
      failures.push(`${id} must map at least one exact browser test`)
      continue
    }
    const requirementBindings = []
    for (const browserTest of requirement.browserTests) {
      const binding = normalizedBinding(browserTest, defaultPath)
      const path = binding?.path
      const title = binding?.title
      if (
        typeof path !== 'string' ||
        !declaredPaths.includes(path) ||
        !REQUIRED_BROWSER_SUITES.includes(path) ||
        typeof title !== 'string' ||
        title.length < 12 ||
        title.trim() !== title ||
        /\b(?:dummy|placeholder|tbd|todo)\b/iu.test(title)
      ) {
        failures.push(`${id} contains an invalid or placeholder browser test binding`)
        continue
      }
      const key = testKey(path, title)
      requirementBindings.push(key)
      const ids = bindingToIds.get(key) ?? new Set()
      ids.add(id)
      bindingToIds.set(key, ids)
    }
    const duplicateBindings = duplicates(requirementBindings)
    if (duplicateBindings.length) {
      failures.push(`${id} repeats browser test bindings`)
    }
  }

  const projects = [...new Set(expectedProjects)]
  for (const project of projects) {
    const projectTests = discoveredTests.filter((test) => projectName(test) === project)
    const counts = new Map()
    for (const test of projectTests.filter((candidate) => declaredPaths.includes(candidate.path))) {
      const key = testKey(test.path, test.title)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const path of declaredPaths) {
      if (!projectTests.some((test) => test.path === path)) {
        failures.push(`${project}: ${path} contributed no discovered ${label} evidence tests`)
      }
    }
    for (const [key, ids] of bindingToIds) {
      const count = counts.get(key) ?? 0
      if (count !== 1) {
        const [path, title] = JSON.parse(key)
        failures.push(
          `${project}: ${label} evidence "${path} :: ${title}" mapped by ${[...ids].join(', ')} discovered ${count} matching tests; expected exactly 1`
        )
      }
    }
    for (const [key, count] of counts) {
      const [path, title] = JSON.parse(key)
      if (count !== 1) {
        failures.push(
          `${project}: discovered ${label} test "${path} :: ${title}" occurs ${count} times`
        )
      }
      if (evidence.suite.exactInventory && !bindingToIds.has(key)) {
        failures.push(
          `${project}: discovered ${label} test "${path} :: ${title}" is not mapped to a required scenario ID`
        )
      }
    }
  }
  return failures
}

export function validateMandatoryExecution(evidence, discoveredTests, executedTests, descriptor) {
  const failures = []
  const label = descriptor.bundle
  const declaredPaths = suitePaths(evidence)
  const projects = [...new Set(discoveredTests.map(projectName))]
  const requiredKeys = new Set(
    mandatoryTestBindings(evidence)
      .filter(
        ({ path, title }) =>
          typeof path === 'string' && typeof title === 'string' && declaredPaths.includes(path)
      )
      .map(({ path, title }) => testKey(path, title))
  )
  if (evidence?.suite?.exactInventory === true) {
    for (const test of discoveredTests.filter((candidate) =>
      declaredPaths.includes(candidate.path)
    )) {
      requiredKeys.add(testKey(test.path, test.title))
    }
  }
  const executedCounts = new Map()
  for (const test of executedTests) {
    const key = projectTestKey(projectName(test), test.path, test.title)
    executedCounts.set(key, (executedCounts.get(key) ?? 0) + 1)
  }
  for (const project of projects) {
    for (const key of requiredKeys) {
      const [path, title] = JSON.parse(key)
      const count = executedCounts.get(projectTestKey(project, path, title)) ?? 0
      if (count !== 1) {
        failures.push(
          `${project}: required ${label} mapping "${path} :: ${title}" executed ${count} tests; expected exactly 1`
        )
      }
    }
  }
  return failures
}

export function validateReliabilityEvidence(evidence, discoveredTests) {
  return validateMandatoryEvidence(
    evidence,
    discoveredTests,
    [...new Set(discoveredTests.map(projectName))],
    reliabilityEvidence
  )
}

export default class ReleaseIntegrityReporter {
  constructor() {
    this.failures = []
    this.counts = { passed: 0, failed: 0, skipped: 0, interrupted: 0, retried: 0 }
    this.discoveredTests = []
    this.executedTests = []
    this.mandatoryEvidence = []
  }

  onBegin(_config, suite) {
    const discoveredTests = []
    for (const test of suite.allTests()) {
      const path = relative(repositoryRoot, test.location.file).replaceAll('\\', '/')
      discoveredTests.push({
        path,
        title: test.title,
        project: test.parent.project()?.name ?? '<unnamed-project>'
      })
    }
    this.discoveredTests = discoveredTests
    const scheduledProjects = suite.suites
      .map((projectSuite) => projectSuite.project()?.name)
      .filter((name) => typeof name === 'string' && name.length > 0)
    this.failures.push(...validateReleaseDiscovery(discoveredTests, scheduledProjects))
    for (const descriptor of MANDATORY_BROWSER_EVIDENCE) {
      try {
        const evidence = JSON.parse(
          readFileSync(resolve(repositoryRoot, descriptor.evidencePath), 'utf8')
        )
        this.mandatoryEvidence.push({ descriptor, evidence })
        this.failures.push(
          ...validateMandatoryEvidence(evidence, discoveredTests, scheduledProjects, descriptor)
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.failures.push(
          `mandatory ${descriptor.bundle} evidence could not be loaded: ${message}`
        )
      }
    }
  }

  onTestEnd(test, result) {
    this.executedTests.push({
      path: relative(repositoryRoot, test.location.file).replaceAll('\\', '/'),
      title: test.title,
      project: test.parent.project()?.name ?? '<unnamed-project>'
    })
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
    this.failures.push(...validateReleaseExecution(this.discoveredTests, this.executedTests))
    for (const { descriptor, evidence } of this.mandatoryEvidence) {
      this.failures.push(
        ...validateMandatoryExecution(
          evidence,
          this.discoveredTests,
          this.executedTests,
          descriptor
        )
      )
    }
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
