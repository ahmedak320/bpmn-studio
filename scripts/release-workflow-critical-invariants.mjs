const LIFECYCLE_GROUP = 'group: orbitpm-release-lifecycle-v0.4.5'

function occurrences(source, value) {
  return source.split(value).length - 1
}

function workflowInputRequiresTrueString(source, inputName) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === `${inputName}:`)
  if (start < 0) return false
  const body = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s{6}[A-Za-z0-9_-]+:\s*$/u.test(line)) break
    body.push(line)
  }
  const normalized = body.map((line) => line.trim())
  return normalized.includes('required: true') && normalized.includes('type: string')
}

export function findCriticalReleaseWorkflowFailures({
  candidate,
  release,
  pages,
  rollback,
  finalize,
  cleanup
}) {
  const failures = []
  for (const [name, source] of Object.entries({ release, pages, finalize, cleanup })) {
    if (!source.includes(LIFECYCLE_GROUP)) {
      failures.push(`critical/lifecycle-concurrency: ${name} must share the release lifecycle lock`)
    }
  }
  if (
    !rollback.includes("'orbitpm-release-lifecycle-v0.4.5'") ||
    !rollback.includes("format('orbitpm-pages-auto-rollback-{0}', github.run_id)")
  ) {
    failures.push(
      'critical/rollback-concurrency: manual rollback must share the lifecycle lock while called automatic rollback remains caller-bound'
    )
  }
  if (
    !finalize.includes('for status in queued in_progress') ||
    !finalize.includes('active-runs-at-publish.json') ||
    !finalize.includes('.github/workflows/pages.yml') ||
    !finalize.includes('.github/workflows/pages-rollback.yml')
  ) {
    failures.push(
      'critical/publication-freeze: publisher must reject queued or running release, Pages, rollback, finalization, and cleanup workflows'
    )
  }
  if (
    candidate.includes('allow-no-approvals') ||
    candidate.includes('owner-waived-review-human-evidence') ||
    candidate.includes('trusted_approvals" -ge 0') ||
    candidate.includes('trusted_approvals" -ge 0')
  ) {
    failures.push(
      'critical/review-gate: candidate workflow must require at least one trusted independent approval without waiver switches'
    )
  }
  for (const [name, source] of [
    ['release', release],
    ['pages', pages]
  ]) {
    if (
      !workflowInputRequiresTrueString(source, 'external_evidence_url') ||
      !workflowInputRequiresTrueString(source, 'external_evidence_sha256')
    ) {
      failures.push(
        `critical/external-evidence-inputs: ${name} must require exact external evidence URL and SHA-256 inputs`
      )
    }
  }
  if (
    !workflowInputRequiresTrueString(finalize, 'browser_compatibility_evidence_url') ||
    !workflowInputRequiresTrueString(finalize, 'browser_compatibility_evidence_sha256') ||
    !workflowInputRequiresTrueString(finalize, 'browser_version_baseline_url') ||
    !workflowInputRequiresTrueString(finalize, 'browser_version_baseline_sha256') ||
    !workflowInputRequiresTrueString(finalize, 'external_evidence_url') ||
    !workflowInputRequiresTrueString(finalize, 'external_evidence_sha256')
  ) {
    failures.push(
      'critical/finalization-inputs: finalization must require browser compatibility, vendor baseline, and external evidence inputs'
    )
  }
  if (
    finalize.includes('owner-waived-review-human-evidence') ||
    finalize.includes('if [ -n "$BROWSER_EVIDENCE_URL" ]') ||
    finalize.includes('if [ -n "$EVIDENCE_URL" ]') ||
    finalize.includes('(.browserCompatibilityEvidence.url == "")') ||
    finalize.includes('(.browserVersionBaseline.url == "")') ||
    finalize.includes('(.externalEvidence.url == "")')
  ) {
    failures.push(
      'critical/finalization-evidence: finalization must fail closed on missing external and browser evidence'
    )
  }
  if (!finalize.includes('node scripts/finalization-evidence-chain.mjs verify')) {
    failures.push(
      'critical/finalization-chain-verification: finalization must self-verify the retained finalization chain before upload'
    )
  }
  if (
    !finalize.includes('node scripts/verify-finalization-artifact-layout.mjs') ||
    !cleanup.includes('node scripts/verify-finalization-artifact-layout.mjs')
  ) {
    failures.push(
      'critical/finalization-artifact-layout: finalization and cleanup must verify the exact immutable finalization artifact file layout'
    )
  }
  if (
    occurrences(rollback, '.published_at == null') < 5 ||
    occurrences(rollback, '.immutable != true') < 5
  ) {
    failures.push(
      'critical/automatic-rollback-state: every automatic rollback rebind must require an unpublished, nonimmutable draft'
    )
  }

  for (const input of ['archive_evidence_url:', 'archive_evidence_sha256:']) {
    if (!cleanup.includes(input)) {
      failures.push(`critical/archive-input: cleanup must require ${input.slice(0, -1)}`)
    }
  }
  for (const marker of [
    'node scripts/finalization-evidence-chain.mjs verify',
    'node scripts/verify-archive-recovery-evidence.mjs',
    'archive-recovery-verification.json',
    'bpmn-studio-full-product-v0.4.4.bundle',
    'bpmn-tool-outer-legacy-v0.4.4.bundle',
    'aeaebf41b8a2cac89a6b16af7ab49c372cd5feb43319d58231f22ccc3f3553b6',
    '18254bbc68f9554aa3ceff7f208d14b9400da1a6adb3585ae575f4dce04dcb75',
    '4fd3fa1e5b7025e1c7d3c280a058c120594be645'
  ]) {
    if (!cleanup.includes(marker)) {
      failures.push(`critical/archive-authority: cleanup is missing ${marker}`)
    }
  }
  if (occurrences(cleanup, 'bundle verify "$bundle_path"') < 3) {
    failures.push(
      'critical/archive-recovery: plan authority, pre-delete gate, and readback must prove Git bundle recovery'
    )
  }
  const destructiveStep = cleanup.indexOf(
    '- name: Delete only fresh manifest-bound executable and updater assets'
  )
  const preDeleteRecovery = cleanup.indexOf('verify_pre_delete_bundle()', destructiveStep)
  const preDeleteLiveRef = cleanup.indexOf(
    'git/ref/heads/archive/full-product-v0.4.4',
    destructiveStep
  )
  const deleteCall = cleanup.indexOf('--method DELETE', destructiveStep)
  if (
    destructiveStep < 0 ||
    preDeleteRecovery < destructiveStep ||
    preDeleteLiveRef < destructiveStep ||
    deleteCall < preDeleteRecovery ||
    deleteCall < preDeleteLiveRef
  ) {
    failures.push(
      'critical/pre-delete-revalidation: live archive refs and both recovery bundles must be revalidated inside the destructive step'
    )
  }
  if (!cleanup.includes('(.files | length) == 13')) {
    failures.push(
      'critical/archive-file-set: cleanup authority must bind all evidence files and both bundles'
    )
  }
  return failures
}
