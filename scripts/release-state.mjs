import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => (entry.isFile() ? entry.name : `${entry.name}/`))
    .sort()
}

const releasePath = resolve(required('release-json'))
const assetsDirectory = resolve(required('assets'))
const notesPath = resolve(required('notes'))
const expectedTag = required('tag')
const expectedTitle = required('title')
const expectedState = required('state')
const allowMissingAssets = options.get('allow-missing-assets') === 'true'
const expectedDirectoryOption = options.get('expected-assets')
const expectedDirectory = expectedDirectoryOption ? resolve(expectedDirectoryOption) : null

if (!['draft', 'stable'].includes(expectedState)) {
  throw new Error('--state must be draft or stable')
}

const release = JSON.parse(readFileSync(releasePath, 'utf8'))
const failures = []
const expectedNames = [
  'LICENSE',
  'OrbitPM-Excel-Example-0.4.5.xlsx',
  'OrbitPM-Excel-Template-0.4.5.xlsx',
  'OrbitPM-Process-Studio-Lite-0.4.5.cyclonedx.json',
  'OrbitPM-Process-Studio-Lite-0.4.5.html',
  'SHA256SUMS.txt',
  'THIRD_PARTY_NOTICES.md'
].sort()
const localNames = files(assetsDirectory)

if (localNames.join('\n') !== expectedNames.join('\n')) {
  failures.push(
    `local release allowlist mismatch: expected ${expectedNames.join(', ')}, found ${localNames.join(', ')}`
  )
}
if (release.tag_name !== expectedTag) {
  failures.push(`release tag_name must be ${expectedTag}`)
}
if (release.name !== expectedTitle) {
  failures.push(`release title must be ${JSON.stringify(expectedTitle)}`)
}
if ((release.body ?? '') !== readFileSync(notesPath, 'utf8')) {
  failures.push('release body does not match the committed release-note bytes')
}
if (release.prerelease !== false) {
  failures.push('release must not be a prerelease')
}

if (expectedState === 'draft') {
  if (release.draft !== true) failures.push('release must remain a draft')
  if (release.published_at !== null) failures.push('draft release must not have published_at')
  if (release.immutable === true) failures.push('draft release cannot already be immutable')
} else {
  if (release.draft !== false) failures.push('stable release must not be a draft')
  if (!release.published_at) failures.push('stable release must have published_at')
  if (release.immutable !== true) failures.push('stable release must be immutable')
}

const assets = Array.isArray(release.assets) ? release.assets : []
const assetNames = assets.map(({ name }) => name).sort()
if (
  allowMissingAssets
    ? assetNames.some((name) => !expectedNames.includes(name))
    : assetNames.join('\n') !== expectedNames.join('\n')
) {
  failures.push(
    `remote release allowlist mismatch: expected ${expectedNames.join(', ')}, found ${assetNames.join(', ')}`
  )
}
if (new Set(assetNames).size !== assetNames.length) {
  failures.push('remote release contains duplicate asset names')
}

for (const asset of assets) {
  const path = resolve(assetsDirectory, asset.name)
  if (basename(path) !== asset.name || !expectedNames.includes(asset.name)) continue
  const expectedSize = statSync(path).size
  const expectedDigest = `sha256:${sha256(path)}`
  if (asset.state !== 'uploaded') {
    failures.push(`${asset.name} is not in the uploaded state`)
  }
  if (asset.size !== expectedSize) {
    failures.push(`${asset.name} remote size does not match the trusted local asset`)
  }
  if (asset.digest !== expectedDigest) {
    failures.push(`${asset.name} remote digest does not match the trusted local asset`)
  }
}

if (expectedDirectory) {
  const comparisonNames = files(expectedDirectory)
  if (comparisonNames.join('\n') !== expectedNames.join('\n')) {
    failures.push('expected comparison directory does not contain the exact seven assets')
  } else {
    for (const name of expectedNames) {
      if (sha256(resolve(assetsDirectory, name)) !== sha256(resolve(expectedDirectory, name))) {
        failures.push(`${name} differs from the independently verified expected bytes`)
      }
    }
  }
}

if (failures.length) {
  console.error('Release state verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Verified ${expectedState} ${expectedTag}: exact metadata and ${assets.length}/${expectedNames.length} trusted assets.`
)
