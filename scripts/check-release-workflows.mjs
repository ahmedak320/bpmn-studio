import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findActionPinFailures } from './workflow-action-pins.mjs'

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

function requireText(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message)
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length
}

function namedStep(source, name) {
  const marker = `      - name: ${name}`
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const end = source.indexOf('\n      - name:', start + marker.length)
  return source.slice(start, end < 0 ? source.length : end)
}

function commandStepBlocks(source, command) {
  const blocks = []
  let offset = 0
  while (true) {
    const start = source.indexOf(command, offset)
    if (start < 0) return blocks
    const end = source.indexOf('\n      - name:', start)
    blocks.push(source.slice(start, end < 0 ? source.length : end))
    offset = start + command.length
  }
}

function requireProtectionChecks(source, expectedCount, label) {
  for (const [pattern, description] of [
    [/repos\/\$GITHUB_REPOSITORY\/immutable-releases/g, 'immutable-release API'],
    [/repos\/\$GITHUB_REPOSITORY\/rulesets\/\$RULESET_ID/g, 'exact ruleset API'],
    [/test "\$RULESET_BYPASS_ACTOR_ID" = "5"/g, 'exact admin RepositoryRole ID'],
    [/\.name == "OrbitPM protected v\* release tags"/g, 'ruleset name'],
    [/\.target == "tag"/g, 'tag ruleset target'],
    [/\.enforcement == "active"/g, 'active enforcement'],
    [/\.conditions\.ref_name\.include == \["refs\/tags\/v\*"\]/g, 'v* tag scope'],
    [/\.conditions\.ref_name\.exclude == \[\]/g, 'empty tag exclusions'],
    [
      /\(\[\.rules\[\]\.type\] \| sort\) == \["creation", "deletion", "update"\]/g,
      'exact creation/update/deletion rules'
    ],
    [/actor_type: "RepositoryRole"/g, 'RepositoryRole bypass type'],
    [/bypass_mode: "always"/g, 'always bypass mode']
  ]) {
    if (count(source, pattern) !== expectedCount) {
      failures.push(`${label} must perform exactly ${expectedCount} ${description} check(s)`)
    }
  }
}

for (const [name, source] of Object.entries(workflows)) {
  failures.push(...findActionPinFailures(source, `.github/workflows/${workflowFiles[name]}`))
}

const allWorkflowText = Object.values(workflows).join('\n')
for (const [pattern, description] of [
  [/\bgh\s+release\s+delete\b/i, 'release deletion'],
  [/\bgit\s+tag\s+-[df]\b/i, 'tag deletion or force'],
  [/\bgit\s+tag\s+--delete\b/i, 'tag deletion'],
  [/\bgit\s+push\b[^\n]*--force/i, 'force push'],
  [/\bgit\s+push\b[^\n]*--delete/i, 'remote deletion'],
  [/\bgit\s+push\b[^\n]*:\s*refs\/tags\//i, 'remote tag deletion'],
  [/\bgit\s+update-ref\s+-d\b/i, 'tag/ref deletion']
]) {
  if (pattern.test(allWorkflowText)) failures.push(`workflows contain prohibited ${description}`)
}
if (
  count(allWorkflowText, /--method DELETE/g) !== 2 ||
  count(allWorkflowText, /--method PATCH/g) !== 2
) {
  failures.push(
    'the only API mutations after creation must be starter/manifest asset DELETEs and deterministic release metadata PATCHes'
  )
}

requireText(
  workflows.quality,
  /release_mode:[\s\S]*type:\s*boolean/,
  'quality workflow must expose explicit release_mode'
)
requireText(
  workflows.quality,
  /source_ref:[\s\S]*expected_sha:/,
  'quality workflow must bind a caller-selected ref and commit'
)
requireText(
  workflows.quality,
  /LITE_LIVE_CORS:\s*\$\{\{\s*inputs\.release_mode/,
  'quality live-CORS gate must be reachable through explicit release_mode'
)
if (
  count(workflows.quality, /ref:\s*\$\{\{\s*inputs\.source_ref\s*\|\|\s*github\.sha\s*\}\}/g) !== 1
) {
  failures.push('only quality identity may resolve the caller-selected source_ref')
}
if (
  count(workflows.quality, /ref:\s*\$\{\{\s*inputs\.expected_sha\s*\|\|\s*github\.sha\s*\}\}/g) !==
    8 ||
  count(workflows.quality, /name:\s*Verify exact checkout/g) !== 8
) {
  failures.push('every downstream quality job must checkout and assert the immutable expected_sha')
}
requireText(
  workflows.quality,
  /node scripts\/check-release-workflows\.mjs/,
  'quality workflow must execute release lifecycle static checks'
)
requireText(
  workflows.quality,
  /node --test[\s\S]*browser-environment-evidence\.test\.mjs[\s\S]*historical-release-cleanup\.test\.mjs[\s\S]*pages-evidence-chain\.test\.mjs[\s\S]*release-evidence-chain\.test\.mjs[\s\S]*release-review-gate\.test\.mjs[\s\S]*verify-browser-compatibility-evidence\.test\.mjs[\s\S]*verify-external-release-evidence\.test\.mjs[\s\S]*workflow-action-pins\.test\.mjs/,
  'quality workflow must execute every release identity/evidence regression suite'
)
requireText(
  workflows.quality,
  /Record exact browser[\s\S]*if:\s*\$\{\{\s*matrix\.browser == 'chromium'\s*\}\}[\s\S]*--browsers=chromium/,
  'pre-tag file evidence must use only Chromium exact-byte routing'
)
requireText(
  workflows.candidate,
  /uses:\s*\.\/\.github\/workflows\/quality\.yml[\s\S]*source_ref:\s*\$\{\{\s*inputs\.candidate_sha\s*\}\}[\s\S]*expected_sha:\s*\$\{\{\s*inputs\.candidate_sha\s*\}\}/,
  'pre-tag candidate workflow must explicitly bind reusable quality to candidate_sha'
)
requireText(
  workflows.candidate,
  /commits\/\$CANDIDATE_SHA\/pulls\?per_page=100[\s\S]*gh api --paginate[\s\S]*reviews\?per_page=100[\s\S]*release-review-gate\.mjs[\s\S]*collaborators\/\$reviewer\/permission[\s\S]*admin \| maintain \| write/,
  'pre-tag identity must paginate PR/review history and require a head-bound writer approval'
)

requireText(
  workflows.release,
  /tag-quality:[\s\S]*uses:\s*\.\/\.github\/workflows\/quality\.yml[\s\S]*source_ref:\s*refs\/tags\/v0\.4\.5[\s\S]*expected_sha:\s*\$\{\{\s*inputs\.candidate_sha\s*\}\}[\s\S]*release_mode:\s*true/,
  'release workflow must explicitly call full quality against the actual tag'
)
requireText(
  workflows.release,
  /allow-missing-assets=true[\s\S]*Upload only missing manifest assets/,
  'draft creation must support safe partial-asset resumption'
)
requireText(
  workflows.release,
  /select\(\.state == "starter"\)[\s\S]*test -f "release\/\$asset_name"[\s\S]*\.size[\s\S]*-eq 0[\s\S]*releases\/assets\/\$asset_id[\s\S]*--method DELETE[\s\S]*allow-missing-assets=true/,
  'draft resumption must delete only zero-byte allowlisted starter assets before validation'
)
requireText(
  workflows.release,
  /ORBITPM_RELEASE_APPROVAL_POLICY[\s\S]*v0\.4\.5-nvda-voiceover-arabic-48h-p0p1-reviewed/,
  'tag creation must require the exact protected release approval policy'
)
const protectedTagStep = namedStep(
  workflows.release,
  'Require prerequisites and create the protected tag with isolated admin token'
)
requireText(
  protectedTagStep,
  /GH_ADMIN_TOKEN[\s\S]*immutable-releases[\s\S]*OrbitPM protected v\* release tags[\s\S]*actor_type: "RepositoryRole"[\s\S]*test "\$\(jq -r \.object\.sha <<<"\$main_ref_json"\)" = "\$CANDIDATE_SHA"[\s\S]*git\/tags"[\s\S]*--method POST[\s\S]*ref=refs\/tags\/v0\.4\.5[\s\S]*git\/tags\/\$tag_object_sha[\s\S]*\.object\.sha protected-tag-object\.json\)" = "\$CANDIDATE_SHA"/,
  'tag creation must require exact approval, immutability, and active v* tag protection'
)
requireProtectionChecks(workflows.release, 1, 'protected tag creation')
requireProtectionChecks(workflows.finalize, 2, 'stable finalization')
requireText(
  workflows.release,
  /candidate_ready_at_raw="\$\(jq -r \.updated_at[\s\S]*candidateReady !== pretagCompleted[\s\S]*pretagCompleted >= releaseStarted/,
  'candidate readiness must equal normalized successful pre-tag workflow completion'
)
requireText(
  workflows.release,
  /orbitpm-tag-release-assets-\$\{\{\s*inputs\.candidate_sha\s*\}\}/,
  'release workflow must preserve the exact clean-tag seven-asset set'
)
requireText(
  workflows.release,
  /state=draft/g,
  'release workflow must read back deterministic draft state'
)

if (workflows.pages.includes('orbitpm-tested-pages-')) {
  failures.push('Pages must consume draft release bytes, not a separate generic quality artifact')
}
if (count(workflows.pages, /gh release download/g) < 5) {
  failures.push('Pages must repeatedly re-download all seven draft assets around deployment')
}
if (count(workflows.pages, /scripts\/release-state\.mjs/g) < 5) {
  failures.push('Pages must repeatedly verify release metadata, body, checksums, and bytes')
}
requireText(
  workflows.pages,
  /orbitpm-tag-release-assets-[\s\S]*state=draft[\s\S]*immediately before deployment[\s\S]*state=draft[\s\S]*immediately after deployment/,
  'Pages must bind clean-tag assets and recheck the draft immediately around deployment'
)
requireText(
  workflows.pages,
  /uses:\s*\.\/\.github\/workflows\/pages-rollback\.yml/,
  'failed Pages deployment attempts must call the verified rollback workflow'
)
requireText(
  workflows.pages,
  /needs: \[identity, deploy\][\s\S]*if: \$\{\{ always\(\) && needs\.identity\.result == 'success' && needs\.deploy\.result != 'success' \}\}[\s\S]*automatic_rollback: true/,
  'Pages auto rollback must run after any failed protected deployment but only after identity success'
)
requireText(
  workflows.pages,
  /Preflight the exact known-good rollback release[\s\S]*874294dd41beab992a057924b7d23bf992892363023372cf0221cb215e0c931e[\s\S]*sha256sum --check/,
  'Pages must prove the recorded v0.4.4 rollback bytes before attempting deployment'
)
if (
  count(workflows.pages, /PAGES_URL: https:\/\/ahmedak320\.github\.io\/bpmn-studio\//g) < 2 ||
  count(workflows.pages, /--fetch-attempts=150/g) !== 2
) {
  failures.push('Pages verification must use the hard canonical URL with cache-safe retries')
}
if (
  /\n\s+pages_url:/u.test(workflows.pages) ||
  !workflows.pages.includes('--browsers=chromium,chrome,edge,firefox,webkit-linux') ||
  count(workflows.pages, /--fetch-delay-ms=5000/g) !== 2
) {
  failures.push('Pages must use five fixed targets, EN/AR smoke, and no caller URL')
}
if (
  count(workflows.pages, /steps\.deployment\.outputs\.page_url/g) !== 2 ||
  !/test "\$DEPLOYMENT_URL" = "https:\/\/ahmedak320\.github\.io\/bpmn-studio\/"/u.test(
    workflows.pages
  )
) {
  failures.push('Pages may use the deployment output only to assert the canonical production URL')
}

requireText(
  workflows.rollback,
  /workflow_call:[\s\S]*workflow_dispatch:/,
  'Pages rollback must be both reusable and manually callable'
)
const rollbackDispatch = workflows.rollback.slice(
  workflows.rollback.indexOf('  workflow_dispatch:'),
  workflows.rollback.indexOf('\npermissions:')
)
if (/\n\s+automatic_rollback:/u.test(rollbackDispatch)) {
  failures.push('manual rollback dispatch must not expose the trusted automatic_rollback marker')
}
requireText(
  workflows.rollback,
  /known_good_asset_sha256:[\s\S]*sha256sum --check/,
  'Pages rollback must bind known-good bytes to a recorded SHA-256'
)
requireText(
  workflows.rollback,
  /Recheck identities immediately before rollback deployment[\s\S]*Confirm rollback bytes and identities after deployment/,
  'Pages rollback must verify identity immediately before and after deployment'
)
requireText(
  workflows.rollback,
  /inputs\.automatic_rollback[\s\S]*github-pages-rollback-auto-v0\.4\.5[\s\S]*github-pages-rollback-manual-v0\.4\.5/,
  'rollback must select distinct automatic and manually approved environments'
)
requireText(
  workflows.rollback,
  /expected_called_ref="\$GITHUB_REPOSITORY\/\.github\/workflows\/pages-rollback\.yml@refs\/heads\/main"[\s\S]*GITHUB_WORKFLOW_REF[\s\S]*pages\.yml@refs\/heads\/main[\s\S]*v0\.4\.5-main-only-no-reviewer-no-secrets-known-good-auto-rollback[\s\S]*GITHUB_WORKFLOW_REF" = "\$expected_called_ref"[\s\S]*v0\.4\.5-verified-known-good-pages-rollback/,
  'rollback must bind automatic and manual modes to exact main workflow refs and policies'
)
requireText(
  workflows.rollback,
  /git merge-base --is-ancestor "\$AUTHORITY_SHA" origin\/main[\s\S]*test "\$GITHUB_SHA" = "\$AUTHORITY_SHA"[\s\S]*\.immutable authority-release\.json[\s\S]*sha256:\$KNOWN_GOOD_ASSET_SHA256/,
  'rollback must prove current authority ancestry, manual stable authority, and known-good bytes'
)
if (
  count(workflows.rollback, /PAGES_URL: https:\/\/ahmedak320\.github\.io\/bpmn-studio\//g) !== 1 ||
  count(workflows.rollback, /seq 1 150/g) !== 1
) {
  failures.push('rollback read-back must use the hard canonical URL with cache-safe retries')
}

requireText(
  workflows.finalize,
  /release-finalize-v0\.4\.5/,
  'stable publication must use a distinct protected finalization environment'
)
if (
  !/concurrency:\s*\n\s*group: release-v0\.4\.5/u.test(workflows.release) ||
  !/concurrency:\s*\n\s*group: release-v0\.4\.5/u.test(workflows.finalize)
) {
  failures.push('release creation and finalization must share the release-v0.4.5 lock')
}
requireText(
  workflows.finalize,
  /immutable-releases[\s\S]*make_latest:\s*"true"[\s\S]*releases\/latest/,
  'finalization must require release immutability, publish latest, and read latest back'
)
requireText(
  workflows.finalize,
  /--state=stable/,
  'finalization must read back immutable non-draft/non-prerelease state'
)
requireText(
  workflows.finalize,
  /browser_compatibility_evidence_url:[\s\S]*required: true[\s\S]*browser_compatibility_evidence_sha256:[\s\S]*required: true/,
  'finalization must require exact post-Pages browser-compatibility evidence inputs'
)
if (
  count(workflows.finalize, /verify-browser-compatibility-evidence\.mjs/g) !== 2 ||
  workflows.finalize.indexOf('verify-browser-compatibility-evidence.mjs') >
    workflows.finalize.indexOf('--method PATCH')
) {
  failures.push(
    'browser compatibility must be verified before approval and again before publication'
  )
}
requireText(
  workflows.finalize,
  /ORBITPM_RELEASE_WRITER_FREEZE_POLICY[\s\S]*v0\.4\.5-sole-admin-no-manual-release-writes-during-finalization[\s\S]*collaborators\?affiliation=all&per_page=100[\s\S]*\. == \[\$sole_writer\][\s\S]*actions\/runs\?status=in_progress&per_page=100/,
  'finalization must enforce the exact sole-writer freeze immediately before publication'
)
requireText(
  workflows.finalize,
  /tag_name: \$tag,[\s\S]*target_commitish: \$target,[\s\S]*name: \$name,[\s\S]*body: \$body,[\s\S]*draft: false,[\s\S]*prerelease: false,[\s\S]*make_latest: "true"[\s\S]*--method PATCH/,
  'finalization publication must restate all deterministic stable release metadata'
)
requireText(
  workflows.finalize,
  /--method PATCH[\s\S]*Reconfirm immutable-release setting with the isolated admin token[\s\S]*releases\/latest[\s\S]*\.immutable stable-release\.json[\s\S]*browserCompatibilityEvidenceSha256[\s\S]*finalization-chain\.json/,
  'finalization must recheck immutable policy and retain the complete chain after publication'
)
if (/\n\s+pages_url:/u.test(workflows.finalize)) {
  failures.push('finalization must not accept a caller-controlled Pages URL')
}
for (const [name, source] of [
  ['Pages', workflows.pages],
  ['rollback', workflows.rollback],
  ['finalization', workflows.finalize],
  ['historical cleanup', workflows.cleanup]
]) {
  requireText(
    source,
    /group:\s*orbitpm-pages-deployment/,
    `${name} must share the serialized Pages deployment/finalization lock`
  )
}

requireText(
  workflows.cleanup,
  /historical-release-cleanup-manifest\.json[\s\S]*--mode=preflight[\s\S]*releases\/assets\/\$asset_id[\s\S]*--mode=verify/,
  'historical cleanup must preflight, delete by bound asset id, and verify read-back'
)
requireText(
  workflows.cleanup,
  /historical-release-cleanup-v0\.4\.5[\s\S]*ORBITPM_HISTORICAL_CLEANUP_POLICY[\s\S]*v0\.4\.5-immutable-stable-pages-verified-manifest-28-assets/,
  'historical cleanup mutation must require its exact protected approval policy'
)
if (count(workflows.cleanup, /name "orbitpm-immutable-stable-release-\$CANDIDATE_SHA"/g) !== 2) {
  failures.push('historical cleanup must download finalization authority before and after approval')
}
requireText(
  workflows.cleanup,
  /--mode=metadata-patch[\s\S]*release-immediately-before-metadata-patch\.json[\s\S]*\.state metadata-patch-plan\.json\)" = "original"[\s\S]*--method PATCH[\s\S]*release-immediately-after-metadata-patch\.json[\s\S]*\.state metadata-patch-readback\.json\)" = "archived"/,
  'historical metadata edits must be bound to immediate before/after read-back'
)
requireText(
  workflows.cleanup,
  /asset-before-delete\.json[\s\S]*\.name asset-before-delete\.json[\s\S]*\.size asset-before-delete\.json[\s\S]*\.digest asset-before-delete\.json[\s\S]*releases\/assets\/\$asset_id[\s\S]*--method DELETE/,
  'historical deletion must freshly bind each exact asset id, name, size, and digest'
)
requireText(
  workflows.cleanup,
  /expectedDeletionCount[\s\S]*-eq 28[\s\S]*retainedAssetCount[\s\S]*-eq 7/,
  'historical cleanup must verify exactly 28 deletions and seven retained Lite assets'
)
requireText(
  workflows.cleanup,
  /--state=stable[\s\S]*pages-after-cleanup/,
  'historical cleanup must reverify immutable stable release and Pages afterward'
)
if (
  count(workflows.cleanup, /browserCompatibilityEvidenceSha256/g) < 3 ||
  count(workflows.cleanup, /pages-evidence-chain\.mjs verify/g) !== 3 ||
  count(workflows.cleanup, /release-evidence-chain\.mjs compare/g) !== 3
) {
  failures.push('historical cleanup must retain and reverify release, Pages, and browser chains')
}
if (/\n\s+pages_url:/u.test(workflows.cleanup)) {
  failures.push('historical cleanup must not accept a caller-controlled Pages URL')
}

for (const [workflowName, source] of Object.entries(workflows)) {
  for (const block of commandStepBlocks(
    source,
    'node scripts/verify-external-release-evidence.mjs'
  )) {
    if (!block.includes('--candidate-ready-at=')) {
      failures.push(`${workflowName} external evidence verification omits candidate-ready binding`)
    }
  }
  for (const block of commandStepBlocks(source, 'node scripts/release-evidence-chain.mjs verify')) {
    if (!block.includes('--candidate-ready-at=')) {
      failures.push(`${workflowName} retained evidence verification omits candidate-ready binding`)
    }
  }
}

if (count(allWorkflowText, /^\s+contents: write$/gm) !== 3) {
  failures.push('only release, finalization, and historical cleanup may request contents: write')
}
for (const [workflowName, source, expectedAdminSteps] of [
  ['release', workflows.release, 1],
  ['finalization', workflows.finalize, 3]
]) {
  const adminSteps = source
    .split(/\n(?=\s{6}- name: )/u)
    .filter((step) => step.includes('GH_ADMIN_TOKEN:'))
  if (adminSteps.length !== expectedAdminSteps) {
    failures.push(`${workflowName} must contain exactly ${expectedAdminSteps} admin-token step(s)`)
  }
  for (const step of adminSteps) {
    if (
      /\n\s+uses:/u.test(step) ||
      /\bnode\s+scripts\//u.test(step) ||
      /\bnpm(?:\s|$)/u.test(step) ||
      /(?:^|\s)\.\/scripts\//u.test(step)
    ) {
      failures.push(`${workflowName} admin token must never share a step with repository code`)
    }
    for (const line of step.split(/\r?\n/u).filter((candidate) => candidate.includes('gh api'))) {
      if (!line.includes('GH_TOKEN="$GH_ADMIN_TOKEN" gh api')) {
        failures.push(`${workflowName} admin API calls must explicitly select the admin token`)
      }
    }
  }
}
for (const [workflowName, source] of [
  ['quality', workflows.quality],
  ['candidate', workflows.candidate],
  ['Pages', workflows.pages],
  ['rollback', workflows.rollback],
  ['cleanup', workflows.cleanup]
]) {
  if (source.includes('ORBITPM_RELEASE_ADMIN_TOKEN')) {
    failures.push(`${workflowName} must not receive the environment-scoped admin token`)
  }
}

const manifest = JSON.parse(read('scripts/historical-release-cleanup-manifest.json'))
const manifestSha256 = createHash('sha256')
  .update(read('scripts/historical-release-cleanup-manifest.json'))
  .digest('hex')
const assets = manifest.releases.flatMap((release) =>
  release.assets.map((asset) => ({ ...asset, tag: release.tag }))
)
const deletions = assets.filter(({ action }) => action === 'delete')
const retained = assets.filter(({ action }) => action === 'retain')
if (
  manifest.schemaVersion !== 1 ||
  manifest.stableReleaseTag !== 'v0.4.5' ||
  manifest.releases.length !== 9
) {
  failures.push('historical manifest must use schema 1, stable v0.4.5, and nine bound releases')
}
if (
  new Set(manifest.releases.map(({ releaseId }) => releaseId)).size !== manifest.releases.length ||
  new Set(manifest.releases.map(({ tag }) => tag)).size !== manifest.releases.length
) {
  failures.push('historical manifest release IDs and tags must be globally unique')
}
if (manifest.expectedDeletionCount !== 28 || deletions.length !== 28) {
  failures.push('historical manifest must bind exactly 28 deletions')
}
if (
  deletions.some(({ name }) => {
    const normalized = name.toLowerCase()
    return (
      normalized !== 'latest.yml' &&
      !normalized.endsWith('.exe') &&
      !normalized.endsWith('.exe.blockmap')
    )
  })
) {
  failures.push('historical manifest attempts to delete a non-executable/non-updater asset')
}
if (
  retained.length !== 7 ||
  retained.some(({ name }) => name !== 'OrbitPM-Process-Studio-Lite.html') ||
  manifest.releases.some(
    (release) => release.assets.filter(({ action }) => action === 'retain').length > 1
  )
) {
  failures.push('historical manifest must retain at most one Lite HTML per release, seven total')
}
if (new Set(assets.map(({ id }) => id)).size !== assets.length) {
  failures.push('historical manifest asset ids must be globally unique')
}
if (!archiveRecord.includes(manifestSha256)) {
  failures.push('archive record must contain the exact cleanup-manifest SHA-256')
}
for (const requiredHandoff of [
  'ORBITPM_RELEASE_TAG_RULESET_ID',
  '19784615',
  'ORBITPM_RELEASE_TAG_BYPASS_ACTOR_ID',
  'RepositoryRole',
  'release-finalize-v0.4.5',
  'historical-release-cleanup-v0.4.5',
  'github-pages-rollback-auto-v0.4.5',
  'github-pages-rollback-manual-v0.4.5',
  'ORBITPM_RELEASE_ADMIN_TOKEN',
  'v0.4.5-sole-admin-no-manual-release-writes-during-finalization'
]) {
  if (!archiveRecord.includes(requiredHandoff)) {
    failures.push(`archive handoff must record ${requiredHandoff}`)
  }
}

if (failures.length) {
  console.error('Release workflow static checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  'Release workflow static checks passed (tag quality, resumability, exact Pages bytes, rollback, immutable finalization, and 28-asset cleanup).'
)
