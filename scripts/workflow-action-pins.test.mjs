import assert from 'node:assert/strict'
import test from 'node:test'
import { findActionPinFailures } from './workflow-action-pins.mjs'

const sha = 'a'.repeat(40)
const digest = 'b'.repeat(64)

test('accepts pinned remote, digest-pinned docker, and safe local uses scalars', () => {
  const source = `
steps:
  - uses: actions/checkout@${sha} # exact
  - uses: 'owner/action/path@${sha}'
  - uses: "docker://example/image@sha256:${digest}"
  - uses: ./.github/workflows/quality.yml
`
  assert.deepEqual(findActionPinFailures(source), [])
})

test('rejects tags, missing refs, dynamic and block scalars, and unsafe docker/local refs', () => {
  for (const scalar of [
    'actions/checkout@v6',
    'actions/checkout',
    '${{ matrix.action }}',
    '|',
    '>',
    `docker://example/image@${sha}`,
    './path/../workflow.yml',
    './.github/workflows/${{ inputs.path }}',
    "'./.github/workflows/foo bar.yml'",
    './.github/workflows//quality.yml',
    './.github/workflows/quality.yml?ref=main',
    `actions/checkout@${sha.toUpperCase()}`
  ]) {
    assert.notDeepEqual(findActionPinFailures(`steps:\n  - uses: ${scalar}\n`), [], scalar)
  }
})

test('detects optional-dash shorthand, quotes/comments, and unparseable uses keys', () => {
  assert.notDeepEqual(findActionPinFailures('steps:\n  - uses: actions/x@main # tag\n'), [])
  assert.notDeepEqual(findActionPinFailures(`steps:\n  - "uses": actions/x@${sha}\n`), [])
  assert.notDeepEqual(findActionPinFailures('steps:\n  - ? uses\n    : actions/checkout@v4\n'), [])
  assert.notDeepEqual(findActionPinFailures('steps:\n  - "u\\u0073es": actions/checkout@v4\n'), [])
  assert.notDeepEqual(
    findActionPinFailures('name: &uses-key uses\nsteps:\n  - *uses-key: actions/checkout@v4\n'),
    []
  )
  assert.notDeepEqual(findActionPinFailures(`steps: [{ uses: actions/x@${sha} }]\n`), [])
  assert.notDeepEqual(findActionPinFailures(`steps:\n  - uses: "actions/x@${sha}" trailing\n`), [])
})

test('ignores uses-like shell text inside block scalars', () => {
  assert.deepEqual(
    findActionPinFailures(`
steps:
  - run: |
      value='uses: actions/checkout@v4'
      echo "$value"
  - uses: actions/checkout@${sha}
`),
    []
  )
})

test('does not hide a sibling uses key after a list-item block scalar', () => {
  for (const header of ['|', '|-', '|2', '|2-', '|-2', '>+', '>2+']) {
    assert.notDeepEqual(
      findActionPinFailures(`
steps:
  - name: ${header}
      Checkout
    uses: actions/checkout@v4
`),
      [],
      header
    )
  }
  assert.deepEqual(
    findActionPinFailures(`
steps:
  - name: |
      Checkout
    uses: actions/checkout@${sha}
`),
    []
  )
})
