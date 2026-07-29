import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { findCriticalReleaseWorkflowFailures } from './release-workflow-critical-invariants.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const sources = Object.fromEntries(
  Object.entries({
    candidate: 'release-candidate.yml',
    release: 'release.yml',
    pages: 'pages.yml',
    rollback: 'pages-rollback.yml'
  }).map(([name, file]) => [name, readFileSync(resolve(root, '.github/workflows', file), 'utf8')])
)

function mutated(name, before, after) {
  assert.ok(sources[name].includes(before), `fixture marker missing from ${name}`)
  return { ...sources, [name]: sources[name].replace(before, after) }
}

test('current release workflows satisfy all critical fail-closed invariants', () => {
  assert.deepEqual(findCriticalReleaseWorkflowFailures(sources), [])
})

for (const scenario of [
  {
    name: 'review waiver switch',
    sources: () =>
      mutated('candidate', 'test "$trusted_approvals" -ge 1', 'test "$trusted_approvals" -ge 0'),
    failure: /critical\/review-gate/
  },
  {
    name: 'optional release external evidence input',
    sources: () =>
      mutated(
        'release',
        'external_evidence_url:\n        description: Reviewed NVDA, VoiceOver, Arabic, 48-hour soak, and P0/P1 evidence URL\n        required: true',
        'external_evidence_url:\n        description: Reviewed NVDA, VoiceOver, Arabic, 48-hour soak, and P0/P1 evidence URL\n        required: false'
      ),
    failure: /critical\/external-evidence-inputs/
  },
  {
    name: 'split lifecycle concurrency',
    sources: () =>
      mutated(
        'release',
        'group: orbitpm-release-lifecycle-v0.4.5',
        'group: stale-release-only-lock'
      ),
    failure: /critical\/lifecycle-concurrency/
  },
  {
    name: 'post-publication automatic rollback',
    sources: () => mutated('rollback', '.published_at == null', '.published_at != null'),
    failure: /critical\/automatic-rollback-state/
  }
]) {
  test(`rejects ${scenario.name}`, () => {
    assert.match(
      findCriticalReleaseWorkflowFailures(scenario.sources()).join('\n'),
      scenario.failure
    )
  })
}
