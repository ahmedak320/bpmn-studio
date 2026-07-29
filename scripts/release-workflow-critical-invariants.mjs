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

export function findCriticalReleaseWorkflowFailures({ candidate, release, pages, rollback }) {
  const failures = []
  for (const [name, source] of Object.entries({ release, pages })) {
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
    occurrences(rollback, '.published_at == null') < 5 ||
    occurrences(rollback, '.immutable != true') < 5
  ) {
    failures.push(
      'critical/automatic-rollback-state: every automatic rollback rebind must require an unpublished, nonimmutable draft'
    )
  }
  return failures
}
