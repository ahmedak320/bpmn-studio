import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { matches, prohibited } from './check-no-skips-rules.mjs'

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
