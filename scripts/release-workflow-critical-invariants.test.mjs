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
    rollback: 'pages-rollback.yml',
    finalize: 'release-finalize.yml',
    cleanup: 'historical-release-cleanup.yml'
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
    name: 'optional finalization browser baseline input',
    sources: () => mutated('finalize', 'browser_version_baseline_sha256:', 'removed_baseline_sha:'),
    failure: /critical\/finalization-inputs/
  },
  {
    name: 'finalization missing-evidence bypass',
    sources: () =>
      mutated(
        'finalize',
        '(.browserCompatibilityEvidence.url | startswith("https://")) and',
        '((.browserCompatibilityEvidence.url == "") or'
      ),
    failure: /critical\/finalization-evidence/
  },
  {
    name: 'missing finalization chain self-verification',
    sources: () =>
      mutated(
        'finalize',
        'node scripts/finalization-evidence-chain.mjs verify',
        'node scripts/untrusted-placeholder.mjs verify'
      ),
    failure: /critical\/finalization-chain-verification/
  },
  {
    name: 'missing finalization artifact layout verifier',
    sources: () => ({
      ...sources,
      finalize: sources.finalize.replace(
        'node scripts/verify-finalization-artifact-layout.mjs',
        'node scripts/untrusted-placeholder.mjs'
      )
    }),
    failure: /critical\/finalization-artifact-layout/
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
    name: 'queued-run publication blind spot',
    sources: () =>
      mutated('finalize', 'for status in queued in_progress', 'for status in in_progress'),
    failure: /critical\/publication-freeze/
  },
  {
    name: 'Pages rollback publication blind spot',
    sources: () =>
      mutated(
        'finalize',
        '.path == ".github/workflows/pages-rollback.yml"',
        '.path == ".github/workflows/ignored.yml"'
      ),
    failure: /critical\/publication-freeze/
  },
  {
    name: 'post-publication automatic rollback',
    sources: () => mutated('rollback', '.published_at == null', '.published_at != null'),
    failure: /critical\/automatic-rollback-state/
  },
  {
    name: 'optional archive evidence',
    sources: () => mutated('cleanup', 'archive_evidence_sha256:', 'removed_archive_sha:'),
    failure: /critical\/archive-input/
  },
  {
    name: 'missing archive verifier',
    sources: () =>
      mutated(
        'cleanup',
        'node scripts/verify-archive-recovery-evidence.mjs',
        'node scripts/untrusted-placeholder.mjs'
      ),
    failure: /critical\/archive-authority/
  },
  {
    name: 'missing finalization chain verifier',
    sources: () => ({
      ...sources,
      cleanup: sources.cleanup.replaceAll(
        'node scripts/finalization-evidence-chain.mjs verify',
        'node scripts/untrusted-placeholder.mjs verify'
      )
    }),
    failure: /critical\/archive-authority/
  },
  {
    name: 'missing pre-delete recovery',
    sources: () => mutated('cleanup', 'verify_pre_delete_bundle()', 'removed_pre_delete_bundle()'),
    failure: /critical\/pre-delete-revalidation/
  },
  {
    name: 'incomplete archive authority file set',
    sources: () => mutated('cleanup', '(.files | length) == 13', '(.files | length) == 10'),
    failure: /critical\/archive-file-set/
  }
]) {
  test(`rejects ${scenario.name}`, () => {
    assert.match(
      findCriticalReleaseWorkflowFailures(scenario.sources()).join('\n'),
      scenario.failure
    )
  })
}
