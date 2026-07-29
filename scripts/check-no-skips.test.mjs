import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { fixtureGuardViolations, matches, prohibited } from './check-no-skips-rules.mjs'

// Fixture strings live in a sibling .json file, deliberately outside check-no-skips.mjs's own
// scan globs, so the fixtures containing the literal patterns under test are never themselves
// mistaken for skipped/focused production or test code by the checker's whole-repo scan.
const fixtures = JSON.parse(
  readFileSync(new URL('./check-no-skips.fixtures.json', import.meta.url), 'utf8')
)

function ruleByLabel(label) {
  const rule = prohibited.find((entry) => entry.label === label)
  assert.ok(rule, `expected a prohibited rule labeled ${JSON.stringify(label)}`)
  return rule
}

function matchCount(source, pattern) {
  return [...matches(source, pattern)].length
}

test('disabled or focused alias: catches genuine Jasmine-style focus/skip aliases', () => {
  const { pattern } = ruleByLabel('disabled or focused alias')
  for (const source of fixtures.focusedAliasGenuine) {
    assert.equal(matchCount(source, pattern), 1, `expected a match in: ${source}`)
  }
})

test('disabled or focused alias: does not flag the ArisCanvas/boot.test.ts false positives', () => {
  const { pattern } = ruleByLabel('disabled or focused alias')
  // src/aris/canvas/ArisCanvas.ts:216 is a `fit(): number { ... }` method definition, and
  // src/aris/canvas/boot.test.ts:102 is `canvas.fit()`, a member-expression call — neither is a
  // Jasmine-style focus/skip alias, and the tightened regex must not flag either shape.
  for (const source of fixtures.focusedAliasFalsePositives) {
    assert.equal(matchCount(source, pattern), 0, `expected no match in: ${source}`)
  }
})

test('skipped suite/test: still catches describe.skip/skipIf and friends', () => {
  const { pattern } = ruleByLabel('skipped suite/test')
  for (const source of fixtures.skippedSuiteGenuine) {
    assert.equal(matchCount(source, pattern), 1, `expected a match in: ${source}`)
  }
})

test('conditional test execution: still catches describe.runIf', () => {
  const { pattern } = ruleByLabel('conditional test execution')
  for (const source of fixtures.runIfGenuine) {
    assert.equal(matchCount(source, pattern), 1, `expected a match in: ${source}`)
  }
})

test('fixture guard: catches a variable-held `it.skip` fixture guard', () => {
  const source = fixtures.fixtureGuardEvasions.variableHeldSkip
  const violations = fixtureGuardViolations('src/aris/example/foo.test.ts', source)
  assert.equal(violations.length, 1, `expected one violation in: ${source}`)
})

test('fixture guard: catches a no-op function alias fixture guard', () => {
  const source = fixtures.fixtureGuardEvasions.noOpAlias
  const violations = fixtureGuardViolations('src/aris/example/foo.test.ts', source)
  assert.equal(violations.length, 1, `expected one violation in: ${source}`)
})

test('fixture guard: catches a describe-level early-return fixture guard', () => {
  const source = fixtures.fixtureGuardEvasions.describeEarlyReturn
  const violations = fixtureGuardViolations('src/aris/example/foo.test.ts', source)
  assert.equal(violations.length, 1, `expected one violation in: ${source}`)
})

test('fixture guard: catches a tautological fixture-absence assertion', () => {
  // The fixture source has two fixture-presence checks near the path literal (the guard and the
  // tautological assertion re-checking it) — both are legitimately flagged.
  const source = fixtures.fixtureGuardEvasions.tautologicalAbsenceAssertion
  const violations = fixtureGuardViolations('src/aris/example/foo.test.ts', source)
  assert.equal(violations.length, 2, `expected two violations in: ${source}`)
})

test('fixture guard: does not fire on a correctly-named *.animalwf.test.ts file', () => {
  const source = fixtures.fixtureGuardCorrectlyNamed
  const violations = fixtureGuardViolations('src/aris/example/foo.animalwf.test.ts', source)
  assert.equal(violations.length, 0, `expected no violations in: ${source}`)
})

test('fixture guard: the same source WOULD violate under a non-animalwf filename', () => {
  // Sanity check that fixtureGuardCorrectlyNamed's content is genuinely a fixture guard (i.e.
  // the previous test passed because of the filename exemption, not because the pattern never
  // matches this shape at all).
  const source = fixtures.fixtureGuardCorrectlyNamed
  const violations = fixtureGuardViolations('src/aris/example/foo.test.ts', source)
  assert.equal(violations.length, 1, `expected one violation in: ${source}`)
})
