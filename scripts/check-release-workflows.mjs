import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findActionPinFailures } from './workflow-action-pins.mjs'
import { findCriticalReleaseWorkflowFailures } from './release-workflow-critical-invariants.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const workflowFiles = {
  quality: 'quality.yml',
  candidate: 'release-candidate.yml',
  release: 'release.yml',
  pages: 'pages.yml',
  rollback: 'pages-rollback.yml',
  finalize: 'release-finalize.yml',
  cleanup: 'historical-release-cleanup.yml'
}
const workflows = Object.fromEntries(
  Object.entries(workflowFiles).map(([name, file]) => [name, read(`.github/workflows/${file}`)])
)
const archiveRecord = read('docs/archive/0.4.4.md')
const failures = []

function requireText(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message)
}

function rejectText(source, pattern, message) {
  if (pattern.test(source)) failures.push(message)
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length
}

function jobBlocks(source) {
  const jobsIndex = source.indexOf('\njobs:\n')
  if (jobsIndex < 0) return new Map()
  const jobs = source.slice(jobsIndex + 7)
  const markers = [...jobs.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)]
  return new Map(
    markers.map((marker, index) => {
      const start = marker.index
      const end = index + 1 < markers.length ? markers[index + 1].index : jobs.length
      return [marker[1], jobs.slice(start, end)]
    })
  )
}

function stepBlocks(source) {
  return source.split(/\n(?=\s{6}- name: )/u).filter((block) => /^\s{6}- name:/u.test(block))
}

function requireJobs(workflowName, expected) {
  const actual = [...jobBlocks(workflows[workflowName]).keys()]
  if (actual.join('\n') !== expected.join('\n')) {
    failures.push(
      `${workflowName} jobs changed: expected ${expected.join(', ')}, found ${actual.join(', ')}`
    )
  }
}

const expectedWorkflowFiles = Object.values(workflowFiles).sort()
const actualWorkflowFiles = readdirSync(resolve(root, '.github/workflows'), {
  withFileTypes: true
})
  .filter(
    (entry) => entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))
  )
  .map(({ name }) => name)
  .sort()
if (actualWorkflowFiles.join('\n') !== expectedWorkflowFiles.join('\n')) {
  failures.push(
    `workflow inventory changed: expected ${expectedWorkflowFiles.join(', ')}, found ${actualWorkflowFiles.join(', ')}`
  )
}

for (const [name, source] of Object.entries(workflows)) {
  failures.push(...findActionPinFailures(source, `.github/workflows/${workflowFiles[name]}`))
}
failures.push(...findCriticalReleaseWorkflowFailures(workflows))

const allWorkflowText = Object.values(workflows).join('\n')
for (const [pattern, description] of [
  [/\bgh\s+release\s+delete\b/iu, 'release deletion'],
  [/\bgit\s+tag\s+-[df]\b/iu, 'tag deletion or force'],
  [/\bgit\s+tag\s+--delete\b/iu, 'tag deletion'],
  [/\bgit\s+push\b[^\n]*--force/iu, 'force push'],
  [/\bgit\s+push\b[^\n]*--delete/iu, 'remote deletion'],
  [/\bgit\s+push\b[^\n]*:\s*refs\/tags\//iu, 'remote tag deletion'],
  [/\bgit\s+update-ref\s+-d\b/iu, 'tag/ref deletion']
]) {
  rejectText(allWorkflowText, pattern, `workflows contain prohibited ${description}`)
}
rejectText(
  allWorkflowText,
  /actions\/upload-pages-artifact@/u,
  'Pages must not use upload-pages-artifact because it nests a floating upload action'
)
for (const [pattern, description] of [
  [/owner-waived-review-human-evidence/u, 'owner-waived release policy strings'],
  [/owner waiver 2026-07-27/iu, 'owner-waiver comments'],
  [/allow-no-approvals/iu, 'review-approval bypass switches'],
  [
    /optional; owner waived human evidence|runs only when external evidence is supplied|runs only when browser evidence is supplied/iu,
    'optional human or browser evidence paths'
  ]
]) {
  rejectText(allWorkflowText, pattern, `workflows contain prohibited ${description}`)
}

requireJobs('release', [
  'verify-pretag',
  'protected-tag',
  'draft-release',
  'tag-quality',
  'verify-tag-release'
])
requireJobs('pages', [
  'identity',
  'prepare',
  'artifact-authority',
  'deploy',
  'readback',
  'rollback'
])
requireJobs('rollback', ['verify', 'prepare', 'artifact-authority', 'deploy', 'readback'])
requireJobs('finalize', ['identity', 'publication-authority', 'publish', 'readback'])
requireJobs('cleanup', ['plan', 'cleanup', 'readback'])

requireText(
  workflows.quality,
  /release_mode:[\s\S]*type:\s*boolean/u,
  'quality workflow must expose explicit release_mode'
)
requireText(
  workflows.quality,
  /source_ref:[\s\S]*expected_sha:/u,
  'quality workflow must bind a caller-selected ref and commit'
)
if (
  count(workflows.quality, /ref:\s*\$\{\{\s*inputs\.expected_sha\s*\|\|\s*github\.sha\s*\}\}/gu) !==
    8 ||
  count(workflows.quality, /name:\s*Verify exact checkout/gu) !== 8
) {
  failures.push('every downstream quality job must checkout and assert the immutable expected_sha')
}
requireText(
  workflows.quality,
  /node scripts\/check-release-workflows\.mjs/u,
  'quality must execute release lifecycle static checks'
)
requireText(
  workflows.quality,
  /finalization-evidence-chain\.test\.mjs[\s\S]*historical-release-cleanup\.test\.mjs[\s\S]*pages-evidence-chain\.test\.mjs[\s\S]*release-evidence-chain\.test\.mjs[\s\S]*release-workflow-critical-invariants\.test\.mjs[\s\S]*verify-finalization-artifact-layout\.test\.mjs[\s\S]*verify-archive-recovery-evidence\.test\.mjs[\s\S]*verify-browser-compatibility-evidence\.test\.mjs[\s\S]*verify-external-release-evidence\.test\.mjs[\s\S]*workflow-action-pins\.test\.mjs/u,
  'quality must execute finalization, retained-artifact, workflow, archive, browser, external-evidence, and action-pin regressions'
)
requireText(
  workflows.candidate,
  /uses:\s*\.\/\.github\/workflows\/quality\.yml[\s\S]*source_ref:\s*\$\{\{\s*inputs\.candidate_sha\s*\}\}[\s\S]*expected_sha:\s*\$\{\{\s*inputs\.candidate_sha\s*\}\}/u,
  'candidate quality must bind source_ref and expected_sha to candidate_sha'
)
requireText(
  workflows.candidate,
  /commits\/\$CANDIDATE_SHA\/pulls\?per_page=100[\s\S]*reviews\?per_page=100[\s\S]*release-review-gate\.mjs/u,
  'candidate identity must bind paginated review evidence to the commit'
)

const releaseJobs = jobBlocks(workflows.release)
const protectedTag = releaseJobs.get('protected-tag') ?? ''
const draftRelease = releaseJobs.get('draft-release') ?? ''
requireText(
  protectedTag,
  /environment:[\s\S]*name:\s*release-v0\.4\.5[\s\S]*GH_ADMIN_TOKEN:[\s\S]*immutable-releases[\s\S]*rulesets\/\$RULESET_ID[\s\S]*git\/tags[\s\S]*git\/refs[\s\S]*protected-tag-object\.json/u,
  'protected tag must isolate its admin token and read back the annotated object'
)
requireText(
  protectedTag,
  /v0\.4\.5-nvda-voiceover-arabic-48h-p0p1-reviewed[\s\S]*actor_type: "RepositoryRole"[\s\S]*bypass_mode: "always"/u,
  'protected tag must require the exact approval and v* ruleset bypass identity'
)
requireText(
  draftRelease,
  /contents: write[\s\S]*Download previously verified immutable release assets[\s\S]*Download immutable fixed-data mutation authority/u,
  'draft writer must consume only previously verified immutable artifacts'
)
requireText(
  draftRelease,
  /select\(\.state == "starter"\)[\s\S]*\.size starter-before-delete\.json\)" -eq 0[\s\S]*--method DELETE/u,
  'draft resumption may delete only freshly rechecked zero-byte starter assets'
)
requireText(
  draftRelease,
  /if ! jq -e --arg name "\$name"[\s\S]*gh release upload v0\.4\.5[\s\S]*\.assets \| length\) == 7[\s\S]*gh release download v0\.4\.5/u,
  'draft writer must upload only missing allowlisted assets and read all seven bytes back'
)
requireText(
  workflows.release,
  /tag-quality:[\s\S]*needs: draft-release[\s\S]*source_ref:\s*refs\/tags\/v0\.4\.5[\s\S]*release_mode:\s*true/u,
  'release quality must rebuild from the actual annotated tag'
)
requireText(
  workflows.release,
  /orbitpm-release-mutation-authority-\$\{\{\s*inputs\.candidate_sha\s*\}\}[\s\S]*orbitpm-tag-release-assets-\$\{\{\s*inputs\.candidate_sha\s*\}\}/u,
  'release must retain mutation authority and clean-tag seven-asset authority'
)

const pagesJobs = jobBlocks(workflows.pages)
const pagesPrepare = pagesJobs.get('prepare') ?? ''
const pagesAuthority = pagesJobs.get('artifact-authority') ?? ''
const pagesDeploy = pagesJobs.get('deploy') ?? ''
const pagesReadback = pagesJobs.get('readback') ?? ''
const pagesRollbackCaller = pagesJobs.get('rollback') ?? ''
requireText(
  pagesPrepare,
  /outputs:[\s\S]*pages-artifact-id:[\s\S]*--file "\$RUNNER_TEMP\/artifact\.tar"[\s\S]*id: upload-pages[\s\S]*actions\/upload-artifact@/u,
  'Pages preparation must upload exact artifact.tar and expose its immutable artifact ID'
)
requireText(
  pagesAuthority,
  /needs: \[identity, prepare\][\s\S]*actions\/artifacts\/\$ARTIFACT_ID[\s\S]*workflow_run\.head_sha == \$sha[\s\S]*size_in_bytes[\s\S]*\.digest[\s\S]*artifact\.zip[\s\S]*filename != "artifact\.tar"[\s\S]*tarfile\.open[\s\S]*html_hash\.hexdigest\(\) != expected/u,
  'Pages authority must bind and semantically inspect the exact stored current-run ZIP/tar/HTML'
)
requireText(
  pagesAuthority,
  /releaseProjectionSha256[\s\S]*pagesArtifact:[\s\S]*tarSha256[\s\S]*pagesWorkflowRunId[\s\S]*pagesWorkflowHeadSha/u,
  'Pages authority evidence must retain release projection and outer/inner artifact identities'
)
requireText(
  pagesDeploy,
  /needs: artifact-authority[\s\S]*id-token: write[\s\S]*pages: write[\s\S]*Rebind exact artifact, main, tag, and draft after approval[\s\S]*EXPECTED_RELEASE_PROJECTION_SHA256[\s\S]*release_projection_sha256[\s\S]*Deploy only the authority-verified Pages artifact/u,
  'Pages deployment must rebind artifact and draft projection after approval before deploy-pages'
)
requireText(
  pagesReadback,
  /Read-only deployed byte and evidence verification[\s\S]*pages-browser-environment\.json[\s\S]*--state=draft[\s\S]*orbitpm-pages-evidence-/u,
  'Pages readback must reverify draft bytes and preserve browser/environment evidence'
)
requireText(
  pagesRollbackCaller,
  /needs: \[identity, prepare, artifact-authority, deploy, readback\][\s\S]*needs\.artifact-authority\.result == 'success'[\s\S]*needs\.deploy\.result == 'failure'[\s\S]*needs\.readback\.result != 'success'[\s\S]*uses: \.\/\.github\/workflows\/pages-rollback\.yml[\s\S]*automatic_rollback: true/u,
  'Pages rollback caller must cover failed deploy and failed postdeploy readback after authority success'
)
rejectText(
  pagesRollbackCaller,
  /\n\s+steps:/u,
  'privileged reusable rollback caller must not execute local steps'
)

const rollbackJobs = jobBlocks(workflows.rollback)
const rollbackPrepare = rollbackJobs.get('prepare') ?? ''
const rollbackAuthority = rollbackJobs.get('artifact-authority') ?? ''
const rollbackDeploy = rollbackJobs.get('deploy') ?? ''
const rollbackReadback = rollbackJobs.get('readback') ?? ''
requireText(
  workflows.rollback,
  /workflow_call:[\s\S]*workflow_dispatch:/u,
  'rollback must be reusable and manually callable'
)
requireText(
  rollbackPrepare,
  /rollback-artifact-id:[\s\S]*--file "\$RUNNER_TEMP\/artifact\.tar"[\s\S]*id: upload-rollback/u,
  'rollback preparation must expose the exact artifact.tar upload ID'
)
requireText(
  rollbackAuthority,
  /actions\/artifacts\/\$ARTIFACT_ID[\s\S]*artifact\.zip[\s\S]*filename != "artifact\.tar"[\s\S]*authorityReleaseProjectionSha256[\s\S]*knownGoodReleaseProjectionSha256/u,
  'rollback authority must inspect the stored artifact and retain both release projections'
)
requireText(
  rollbackDeploy,
  /id-token: write[\s\S]*pages: write[\s\S]*Rebind rollback artifact and release authorities after approval[\s\S]*EXPECTED_AUTHORITY_RELEASE_SHA256[\s\S]*EXPECTED_KNOWN_GOOD_RELEASE_SHA256[\s\S]*Deploy verified rollback artifact/u,
  'rollback must rebind artifact, tags, ancestry, and releases after approval'
)
requireText(
  rollbackReadback,
  /Read-only rollback live-byte and authority read-back[\s\S]*rollback-artifact-authority\.json[\s\S]*known-good-release-postdeploy\.json[\s\S]*sha256:\$KNOWN_GOOD_ASSET_SHA256/u,
  'rollback readback must freshly verify known-good release and retained authority'
)
requireText(
  workflows.rollback,
  /v0\.4\.5-main-only-no-reviewer-no-secrets-known-good-auto-rollback[\s\S]*v0\.4\.5-verified-known-good-pages-rollback/u,
  'rollback must retain distinct exact automatic and manual policies'
)

const finalizeJobs = jobBlocks(workflows.finalize)
const finalAuthority = finalizeJobs.get('publication-authority') ?? ''
const finalPublish = finalizeJobs.get('publish') ?? ''
const finalReadback = finalizeJobs.get('readback') ?? ''
requireText(
  workflows.finalize,
  /browser_version_baseline_url:[\s\S]*required: true[\s\S]*browser_version_baseline_sha256:[\s\S]*required: true/u,
  'finalization must require browser-version baseline URL and SHA-256'
)
if (
  count(workflows.finalize, /verify-browser-compatibility-evidence\.mjs/gu) !== 2 ||
  count(workflows.finalize, /--version-baseline-url="\$VERSION_BASELINE_URL"/gu) !== 2 ||
  count(workflows.finalize, /--version-baseline-sha256="\$VERSION_BASELINE_SHA256"/gu) !== 2
) {
  failures.push('finalization must perform exactly two baseline-bound browser verifications')
}
requireText(
  finalAuthority,
  /environment:[\s\S]*name: release-finalize-authority-v0\.4\.5[\s\S]*contents: write[^\n]*# drafts require push-level visibility to read[\s\S]*Checkout exact candidate after approval[\s\S]*orbitpm-finalization-publication-authority/u,
  'post-approval repo-code authority must use the separate zero-secret protected environment'
)
requireText(
  finalPublish,
  /environment:[\s\S]*name: release-finalize-v0\.4\.5[\s\S]*contents: read[\s\S]*Fetch and bind the exact immutable publication authority[\s\S]*GH_ADMIN_TOKEN:[\s\S]*protection_check[\s\S]*--method PATCH[\s\S]*protection_check[\s\S]*releases\/latest[\s\S]*immutable == true/u,
  'isolated publisher must bind immutable authority and bracket publication with policy checks'
)
requireText(
  finalPublish,
  /v0\.4\.5-pages-verified-immutable-stable-publication/u,
  'finalization publish policy must require the exact pages-verified immutable stable publication approval'
)
requireText(
  finalPublish,
  /collaborators\?affiliation=all&per_page=100[\s\S]*for status in queued in_progress[\s\S]*actions\/runs\?status=\$status&per_page=100/u,
  'publisher must enforce sole-writer and concurrent-workflow freeze'
)
requireText(
  finalReadback,
  /schemaVersion: 2[\s\S]*publicationAuthoritySha256[\s\S]*browserCompatibilityEvidence:[\s\S]*browserVersionBaseline:[\s\S]*sourceSha256/u,
  'stable readback must retain schema-2 browser and baseline chain identities'
)
requireText(
  finalReadback,
  /cp[\s\S]*verified-finalization-evidence\/trusted-release-external-evidence-verification\.json[\s\S]*\$chain_dir\/trusted-release-external-evidence-verification\.json[\s\S]*cp[\s\S]*verified-finalization-evidence\/browser-compatibility-evidence-verification\.json[\s\S]*\$chain_dir\/browser-compatibility-evidence-verification\.json[\s\S]*cp[\s\S]*verified-finalization-evidence\/pages\/pages-browser-environment\.json[\s\S]*\$chain_dir\/pages\/pages-browser-environment\.json[\s\S]*cp[\s\S]*verified-finalization-evidence\/pages\/trusted-release-external-evidence-verification\.json[\s\S]*\$chain_dir\/pages\/trusted-release-external-evidence-verification\.json/u,
  'stable readback must copy the retained release, browser, and Pages evidence files into the immutable finalization artifact'
)
requireText(
  finalReadback,
  /node scripts\/finalization-evidence-chain\.mjs verify[\s\S]*--chain="\$chain_dir\/finalization-chain\.json"[\s\S]*--publication-authority="\$authority"[\s\S]*--browser-evidence="\$browser_evidence"/u,
  'stable readback must self-verify the retained finalization chain before uploading immutable evidence'
)
requireText(
  finalReadback,
  /artifact_root=immutable-stable-publication-artifact[\s\S]*node scripts\/verify-finalization-artifact-layout\.mjs[\s\S]*--root="\$artifact_root"[\s\S]*path:\s*immutable-stable-publication-artifact\//u,
  'stable readback must stage and verify one exact immutable finalization artifact directory before upload'
)
requireText(
  finalReadback,
  /releases\/latest[\s\S]*--state=stable[\s\S]*orbitpm-immutable-stable-release-/u,
  'finalization readback must preserve exact latest immutable stable evidence'
)

const cleanupJobs = jobBlocks(workflows.cleanup)
const cleanupPlan = cleanupJobs.get('plan') ?? ''
const cleanupWriter = cleanupJobs.get('cleanup') ?? ''
const cleanupReadback = cleanupJobs.get('readback') ?? ''
requireText(
  cleanupPlan,
  /--mode=preflight[\s\S]*484fa611b1bdd4494ef48e2e77ef1d672c1a1a7f769e8ff431a8f911513407d8[\s\S]*orbitpm-historical-cleanup-authority/u,
  'cleanup plan must bind the exact manifest and preserve immutable authority'
)
requireText(
  cleanupPlan,
  /node scripts\/verify-finalization-artifact-layout\.mjs[\s\S]*--root=finalization-evidence[\s\S]*test -f "\$browser_evidence"[\s\S]*test -f "\$release_evidence"[\s\S]*test -f "\$pages_release_evidence"[\s\S]*node scripts\/finalization-evidence-chain\.mjs verify/u,
  'cleanup plan must verify the retained finalization artifact layout and finalization chain against exact external and browser evidence files'
)
requireText(
  cleanupWriter,
  /contents: write[\s\S]*historical-release-cleanup-v0\.4\.5[\s\S]*Fetch and bind the exact immutable cleanup authority[\s\S]*workflow_run\.head_sha == \$sha/u,
  'cleanup writer must bind only the current-run immutable plan after protected approval'
)
requireText(
  cleanupWriter,
  /asset-immediately-before-delete\.json[\s\S]*\.name asset-immediately-before-delete\.json[\s\S]*\.size asset-immediately-before-delete\.json[\s\S]*\.digest asset-immediately-before-delete\.json[\s\S]*--method DELETE/u,
  'cleanup writer must freshly bind each asset ID, name, size, and digest before deletion'
)
requireText(
  cleanupWriter,
  /originalBodySha256[\s\S]*--method PATCH[\s\S]*release_after[\s\S]*recovered-body\.txt/u,
  'cleanup writer must patch and immediately read back only manifest-derived archived metadata'
)
requireText(
  cleanupReadback,
  /node scripts\/finalization-evidence-chain\.mjs verify[\s\S]*--release-tag=v0\.4\.5[\s\S]*--publication-authority="\$publication_authority"/u,
  'cleanup readback must reverify the retained finalization chain from retained cleanup authority files'
)
requireText(
  cleanupReadback,
  /--mode=verify[\s\S]*remainingDeletionCount[\s\S]*"0"[\s\S]*retainedAssetCount[\s\S]*"7"/u,
  'cleanup readback must prove 28 deletions and seven retained assets'
)
for (const source of [cleanupWriter, cleanupReadback]) {
  requireText(
    source,
    /bodyBase64[\s\S]*base64 --decode[\s\S]*sizeBytes[\s\S]*sha256[\s\S]*officialSources \| length[\s\S]*-eq 4[\s\S]*chrome-stable[\s\S]*edge-stable[\s\S]*firefox-stable[\s\S]*safari-stable/u,
    'cleanup authority and readback must hash retained matrix, baseline, Pages, and four vendor-source bytes'
  )
}
rejectText(
  workflows.cleanup,
  /verify-browser-compatibility-evidence\.mjs/u,
  'cleanup must inherit retained browser evidence without vendor refetch'
)

const privilegedExecution = [
  /uses:\s*actions\/checkout@/u,
  /uses:\s*actions\/setup-node@/u,
  /\bnpm(?:\s|$)/u,
  /\bnode(?:\s|$)/u,
  /(?:^|[\s"'=])(?:\.\/)?scripts\//u
]
for (const [workflowName, source] of Object.entries(workflows)) {
  for (const [jobName, block] of jobBlocks(source)) {
    const privilegedRunner =
      /runs-on:/u.test(block) &&
      (/\n\s{6}(?:contents|pages|id-token): write\s*$/mu.test(block) ||
        block.includes('GH_ADMIN_TOKEN:') ||
        /name:\s*(?:release-v0\.4\.5|release-finalize-v0\.4\.5|historical-release-cleanup-v0\.4\.5|github-pages(?:-rollback-[^\s]+)?)/u.test(
          block
        ))
    if (!privilegedRunner) continue
    for (const pattern of privilegedExecution) {
      if (pattern.test(block)) {
        failures.push(
          `${workflowName}/${jobName} privileged runner may execute only fixed inline shell/API and pinned data/deploy actions`
        )
        break
      }
    }
  }
}
for (const [workflowName, source] of Object.entries(workflows)) {
  for (const [jobName, block] of jobBlocks(source)) {
    if (!block.includes('GH_ADMIN_TOKEN:')) continue
    const adminSteps = stepBlocks(block).filter((step) => step.includes('GH_ADMIN_TOKEN:'))
    if (adminSteps.length !== 1 || count(block, /GH_ADMIN_TOKEN:/gu) !== 1) {
      failures.push(`${workflowName}/${jobName} must expose the admin PAT in exactly one step`)
    }
    for (const adminStep of adminSteps) {
      rejectText(
        adminStep,
        /\n\s+uses:/u,
        `${workflowName}/${jobName} admin-token step must not execute any action`
      )
      for (const line of adminStep
        .split(/\r?\n/u)
        .filter((candidate) => candidate.includes('gh api'))) {
        if (!line.includes('GH_TOKEN="$GH_ADMIN_TOKEN" gh api')) {
          failures.push(`${workflowName}/${jobName} admin API must explicitly select the PAT`)
        }
      }
    }
  }
}
if (count(allWorkflowText, /ORBITPM_RELEASE_ADMIN_TOKEN/gu) !== 2) {
  failures.push(
    'only protected tag creation and isolated stable publication may receive the admin PAT'
  )
}
if (count(allWorkflowText, /^\s+contents: write\s*$/gmu) !== 2) {
  failures.push('only isolated draft creation and historical cleanup may request contents: write')
}

const canonicalStepExpectations = {
  pages: 1,
  rollback: 1,
  finalize: 4,
  cleanup: 4
}
for (const [workflowName, expectedCount] of Object.entries(canonicalStepExpectations)) {
  const canonicalSteps = stepBlocks(workflows[workflowName]).filter(
    (step) =>
      step.includes('curl ') && step.includes("--write-out '%{http_code}\\t%{url_effective}'")
  )
  if (canonicalSteps.length !== expectedCount) {
    failures.push(
      `${workflowName} must contain exactly ${expectedCount} canonical Pages readback step(s)`
    )
  }
  for (const step of canonicalSteps) {
    if (
      step.includes('--location') ||
      !step.includes('--max-redirs 0') ||
      !step.includes('%{http_code}\\t%{url_effective}') ||
      !step.includes("printf '200\\t%s'")
    ) {
      failures.push(
        `${workflowName} canonical Pages readback must reject redirects and assert HTTP 200 plus exact effective URL`
      )
    }
  }
}

for (const [workflowName, source] of [
  ['Pages', workflows.pages],
  ['rollback', workflows.rollback],
  ['finalization', workflows.finalize],
  ['historical cleanup', workflows.cleanup]
]) {
  requireText(
    source,
    /group:\s*orbitpm-pages-deployment/u,
    `${workflowName} must share the serialized Pages deployment/finalization lock`
  )
}
requireText(
  workflows.pages,
  /steps\.deployment\.outputs\.page_url[\s\S]*test "\$DEPLOYMENT_URL" = "https:\/\/ahmedak320\.github\.io\/bpmn-studio\/"/u,
  'Pages may use the deployment output only to assert the canonical URL'
)
rejectText(
  [workflows.pages, workflows.finalize, workflows.cleanup].join('\n'),
  /\n\s+pages_url:/u,
  'release lifecycle must not accept a caller-controlled Pages URL'
)

const manifest = JSON.parse(read('scripts/historical-release-cleanup-manifest.json'))
const manifestBytes = read('scripts/historical-release-cleanup-manifest.json')
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
const assets = manifest.releases.flatMap((release) =>
  release.assets.map((asset) => ({ ...asset, tag: release.tag }))
)
const deletions = assets.filter(({ action }) => action === 'delete')
const retained = assets.filter(({ action }) => action === 'retain')
if (
  manifestSha256 !== '484fa611b1bdd4494ef48e2e77ef1d672c1a1a7f769e8ff431a8f911513407d8' ||
  manifest.schemaVersion !== 1 ||
  manifest.stableReleaseTag !== 'v0.4.5' ||
  manifest.releases.length !== 9 ||
  manifest.expectedDeletionCount !== 28 ||
  deletions.length !== 28 ||
  retained.length !== 7
) {
  failures.push(
    'historical manifest must remain the exact nine-release, 28-delete, seven-retain authority'
  )
}
if (
  new Set(manifest.releases.map(({ releaseId }) => releaseId)).size !== manifest.releases.length ||
  new Set(manifest.releases.map(({ tag }) => tag)).size !== manifest.releases.length ||
  new Set(assets.map(({ id }) => id)).size !== assets.length
) {
  failures.push('historical manifest release, tag, and asset IDs must be globally unique')
}
if (
  deletions.some(({ name }) => {
    const normalized = name.toLowerCase()
    return (
      normalized !== 'latest.yml' &&
      !normalized.endsWith('.exe') &&
      !normalized.endsWith('.exe.blockmap')
    )
  }) ||
  retained.some(({ name }) => name !== 'OrbitPM-Process-Studio-Lite.html')
) {
  failures.push('historical manifest delete/retain actions exceed the executable/updater policy')
}
if (!archiveRecord.includes(manifestSha256)) {
  failures.push('archive record must retain the exact cleanup-manifest SHA-256')
}
for (const handoff of [
  'ORBITPM_RELEASE_TAG_RULESET_ID',
  'ORBITPM_RELEASE_TAG_BYPASS_ACTOR_ID',
  'RepositoryRole',
  'release-finalize-v0.4.5',
  'historical-release-cleanup-v0.4.5',
  'github-pages-rollback-auto-v0.4.5',
  'github-pages-rollback-manual-v0.4.5',
  'ORBITPM_RELEASE_ADMIN_TOKEN',
  'v0.4.5-sole-admin-no-manual-release-writes-during-finalization'
]) {
  if (!archiveRecord.includes(handoff)) failures.push(`archive handoff must record ${handoff}`)
}

if (failures.length) {
  console.error('Release workflow static checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  'Release workflow static checks passed (credential isolation, exact Pages artifacts, no-redirect readback, immutable finalization, retained browser baseline, and manifest-bound cleanup).'
)
