import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const options = new Map()
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf('=')
  if (!argument.startsWith('--') || separator === -1) {
    throw new Error(`Expected --name=value, received ${argument}`)
  }
  options.set(argument.slice(2, separator), argument.slice(separator + 1))
}

function required(name) {
  const value = options.get(name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function prohibitedAsset(name) {
  const normalizedName = name.toLowerCase()
  return (
    normalizedName === 'latest.yml' ||
    normalizedName.endsWith('.exe') ||
    normalizedName.endsWith('.exe.blockmap')
  )
}

const mode = required('mode')
if (!['metadata-patch', 'preflight', 'verify'].includes(mode)) {
  throw new Error('--mode must be metadata-patch, preflight, or verify')
}

const manifestPath = resolve(required('manifest'))
const outputPath = resolve(required('output'))
const manifestBytes = readFileSync(manifestPath)
const manifest = JSON.parse(manifestBytes)

if (mode === 'metadata-patch') {
  const releaseId = required('release-id')
  if (!/^[1-9]\d*$/.test(releaseId)) {
    throw new Error('--release-id must be a positive decimal release ID')
  }
  const release = JSON.parse(readFileSync(resolve(required('release-json')), 'utf8'))
  const expected = manifest.releases.find(
    ({ releaseId: manifestReleaseId }) => String(manifestReleaseId) === releaseId
  )
  const metadataFailures = []
  if (!expected || String(release.id) !== releaseId || release.tag_name !== expected?.tag) {
    metadataFailures.push('live release id/tag is not the selected manifest entry')
  }
  if (
    release.draft !== expected?.draft ||
    release.prerelease !== expected?.prerelease ||
    release.immutable !== false
  ) {
    metadataFailures.push('historical release state changed before its metadata patch')
  }
  const originalBody = release.body ?? ''
  const archivedName = `[ARCHIVED] ${expected?.originalName ?? ''}`
  const prefix = `${manifest.archivalNotice}\n\n`
  const recoveredOriginalBody =
    originalBody === manifest.archivalNotice
      ? ''
      : originalBody.startsWith(prefix)
        ? originalBody.slice(prefix.length)
        : null
  let state
  let patch = null
  if (
    expected &&
    release.name === expected.originalName &&
    sha256(originalBody) === expected.originalBodySha256
  ) {
    state = 'original'
    patch = {
      name: archivedName,
      body: originalBody ? `${manifest.archivalNotice}\n\n${originalBody}` : manifest.archivalNotice
    }
  } else if (
    expected &&
    release.name === archivedName &&
    recoveredOriginalBody !== null &&
    sha256(recoveredOriginalBody) === expected.originalBodySha256
  ) {
    state = 'archived'
  } else {
    metadataFailures.push('historical release title/body is not an allowed manifest-bound state')
  }
  if (metadataFailures.length) {
    throw new Error(metadataFailures.join('\n'))
  }
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        mode,
        releaseId,
        tag: expected.tag,
        state,
        patch
      },
      null,
      2
    )}\n`
  )
  console.log(`Historical metadata ${expected.tag} is safely ${state}.`)
  process.exit(0)
}

const releasesPath = resolve(required('releases'))
const releases = JSON.parse(readFileSync(releasesPath, 'utf8'))
const failures = []

if (manifest.schemaVersion !== 1) failures.push('manifest schemaVersion must be 1')
if (!Array.isArray(manifest.releases) || !Array.isArray(releases)) {
  failures.push('manifest and release snapshot must contain arrays')
}

const manifestReleaseIds = new Set()
const manifestTags = new Set()
const manifestAssetIds = new Set()
const deletionAssets = []
for (const release of manifest.releases ?? []) {
  if (manifestReleaseIds.has(release.releaseId)) {
    failures.push(`duplicate manifest release id ${release.releaseId}`)
  }
  if (manifestTags.has(release.tag)) failures.push(`duplicate manifest tag ${release.tag}`)
  manifestReleaseIds.add(release.releaseId)
  manifestTags.add(release.tag)
  for (const asset of release.assets ?? []) {
    if (manifestAssetIds.has(asset.id)) failures.push(`duplicate manifest asset id ${asset.id}`)
    manifestAssetIds.add(asset.id)
    if (!['delete', 'retain'].includes(asset.action)) {
      failures.push(`${release.tag}/${asset.name} has an invalid manifest action`)
    }
    if ((asset.action === 'delete') !== prohibitedAsset(asset.name)) {
      failures.push(`${release.tag}/${asset.name} action violates the executable/updater policy`)
    }
    if (asset.action === 'delete') deletionAssets.push({ ...asset, tag: release.tag })
  }
}
if (deletionAssets.length !== manifest.expectedDeletionCount) {
  failures.push(
    `manifest must bind exactly ${manifest.expectedDeletionCount} deletions, found ${deletionAssets.length}`
  )
}

const releasesById = new Map(releases.map((release) => [release.id, release]))
const releasesByTag = new Map(releases.map((release) => [release.tag_name, release]))
if (releasesById.size !== releases.length || releasesByTag.size !== releases.length) {
  failures.push('release snapshot contains duplicate ids or tags')
}

const releaseEdits = []
const assetDeletes = []
let retainedAssetCount = 0

for (const expected of manifest.releases ?? []) {
  const actual = releasesById.get(expected.releaseId)
  if (!actual || actual.tag_name !== expected.tag) {
    failures.push(`${expected.tag} release id/tag identity changed`)
    continue
  }
  if (
    actual.draft !== expected.draft ||
    actual.prerelease !== expected.prerelease ||
    actual.immutable !== false
  ) {
    failures.push(`${expected.tag} draft/prerelease/immutable state changed`)
  }

  const originalBody = actual.body ?? ''
  const archivedName = `[ARCHIVED] ${expected.originalName}`
  let archivedBody
  let metadataState
  if (
    actual.name === expected.originalName &&
    sha256(originalBody) === expected.originalBodySha256
  ) {
    metadataState = 'original'
    archivedBody = originalBody
      ? `${manifest.archivalNotice}\n\n${originalBody}`
      : manifest.archivalNotice
  } else if (actual.name === archivedName) {
    const prefix = `${manifest.archivalNotice}\n\n`
    const recoveredOriginalBody =
      originalBody === manifest.archivalNotice
        ? ''
        : originalBody.startsWith(prefix)
          ? originalBody.slice(prefix.length)
          : null
    if (
      recoveredOriginalBody === null ||
      sha256(recoveredOriginalBody) !== expected.originalBodySha256
    ) {
      failures.push(`${expected.tag} archived body is not derived from the bound original notes`)
      continue
    }
    metadataState = 'archived'
    archivedBody = originalBody
  } else {
    failures.push(`${expected.tag} title/body differs from both allowed manifest states`)
    continue
  }

  if (mode === 'verify' && metadataState !== 'archived') {
    failures.push(`${expected.tag} is not visibly marked [ARCHIVED]`)
  } else if (mode === 'preflight' && metadataState === 'original') {
    releaseEdits.push({
      id: expected.releaseId,
      tag: expected.tag,
      name: archivedName,
      body: archivedBody
    })
  }

  const expectedAssetsById = new Map(expected.assets.map((asset) => [asset.id, asset]))
  const actualAssetIds = new Set()
  for (const asset of actual.assets ?? []) {
    const bound = expectedAssetsById.get(asset.id)
    if (!bound) {
      failures.push(`${expected.tag} contains unmanifested asset ${asset.name} (${asset.id})`)
      continue
    }
    actualAssetIds.add(asset.id)
    if (
      asset.name !== bound.name ||
      asset.size !== bound.size ||
      asset.digest !== `sha256:${bound.sha256}` ||
      asset.state !== 'uploaded'
    ) {
      failures.push(`${expected.tag}/${bound.name} no longer matches its manifest identity`)
      continue
    }
    if (bound.action === 'delete') {
      if (mode === 'verify') {
        failures.push(`${expected.tag}/${bound.name} was not deleted`)
      } else {
        assetDeletes.push({
          releaseId: expected.releaseId,
          tag: expected.tag,
          id: bound.id,
          name: bound.name
        })
      }
    } else {
      retainedAssetCount += 1
    }
  }

  for (const bound of expected.assets) {
    if (bound.action === 'retain' && !actualAssetIds.has(bound.id)) {
      failures.push(`${expected.tag}/${bound.name} retained Lite asset is missing`)
    }
  }
}

for (const release of releases) {
  if (manifestTags.has(release.tag_name) || release.tag_name === manifest.stableReleaseTag) {
    continue
  }
  for (const asset of release.assets ?? []) {
    if (prohibitedAsset(asset.name)) {
      failures.push(
        `unmanifested release ${release.tag_name} still contains prohibited asset ${asset.name}`
      )
    }
  }
}

if (failures.length) {
  console.error('Historical release cleanup verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const result = {
  schemaVersion: 1,
  mode,
  manifestSha256: sha256(manifestBytes),
  expectedDeletionCount: manifest.expectedDeletionCount,
  remainingDeletionCount: assetDeletes.length,
  retainedAssetCount,
  releaseEdits,
  assetDeletes,
  verifiedTags: manifest.releases.map(({ tag, tagRefSha, peeledCommitSha }) => ({
    tag,
    tagRefSha,
    peeledCommitSha
  }))
}
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(
  mode === 'preflight'
    ? `Historical cleanup plan verified: ${releaseEdits.length} metadata edits and ${assetDeletes.length} remaining manifest-bound deletions.`
    : `Historical cleanup read-back verified: ${manifest.releases.length} archived releases, ${retainedAssetCount} retained assets, and zero prohibited assets.`
)
