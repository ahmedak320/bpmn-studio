import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Canonical tracked copy — plan §2.4. Do not rename or move: file-smoke and
// tests/e2e/aris-release-artifact.spec.ts depend on this exact path.
const RELEASE_COPY_PATH = resolve('release/OrbitPM-ARIS-Studio-Lite.html')
// Additional repo-root copy so the artifact can be downloaded directly from
// GitHub for manual testing. Always byte-identical to the release copy.
const ROOT_COPY_PATH = resolve('aris_studio.html')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function readIfExists(path) {
  const stats = statSync(path, { throwIfNoEntry: false })
  return stats?.isFile() ? readFileSync(path) : null
}

function describe(path, bytes) {
  return `  ${path} (${bytes.byteLength} bytes, sha256 ${sha256(bytes)})`
}

function runVerify() {
  // No rebuild here — this compares the files as currently tracked/present on
  // disk, so it catches a stale committed copy even when nobody just ran
  // `npm run build:aris`.
  const distBytes = readIfExists(resolve('dist/index.html'))
  const releaseBytes = readIfExists(RELEASE_COPY_PATH)
  const rootBytes = readIfExists(ROOT_COPY_PATH)

  const missing = []
  if (!releaseBytes) missing.push(RELEASE_COPY_PATH)
  if (!rootBytes) missing.push(ROOT_COPY_PATH)
  if (missing.length) {
    console.error('Rolling ARIS artifact verification failed — missing tracked file(s):')
    for (const path of missing) console.error(`  ${path}`)
    process.exit(1)
  }

  const candidates = [
    { path: RELEASE_COPY_PATH, bytes: releaseBytes },
    { path: ROOT_COPY_PATH, bytes: rootBytes }
  ]
  if (distBytes) candidates.unshift({ path: resolve('dist/index.html'), bytes: distBytes })

  const referenceSha = sha256(candidates[0].bytes)
  const mismatched = candidates.filter(
    (candidate) =>
      sha256(candidate.bytes) !== referenceSha ||
      candidate.bytes.byteLength !== candidates[0].bytes.byteLength
  )

  if (mismatched.length) {
    console.error('Rolling ARIS artifact copies have drifted out of sync:')
    for (const candidate of candidates) console.error(describe(candidate.path, candidate.bytes))
    console.error('Run `npm run build:aris` and commit the resulting files together.')
    process.exit(1)
  }

  console.log(
    distBytes
      ? 'Rolling ARIS artifact copies match dist/index.html:'
      : 'Rolling ARIS artifact copies match each other (dist/index.html not present — build to also verify against the current source):'
  )
  for (const candidate of candidates) console.log(describe(candidate.path, candidate.bytes))
  process.exit(0)
}

if (process.argv[2] === '--verify') {
  runVerify()
} else {
  const sourcePath = resolve(process.argv[2] ?? 'dist/index.html')
  const targetPaths = [
    resolve(process.argv[3] ?? 'release/OrbitPM-ARIS-Studio-Lite.html'),
    resolve(process.argv[4] ?? 'aris_studio.html')
  ]

  const sourceStats = statSync(sourcePath, { throwIfNoEntry: false })
  if (!sourceStats?.isFile()) {
    console.error(`Built HTML artifact does not exist: ${sourcePath}`)
    process.exit(1)
  }

  const sourceBytes = readFileSync(sourcePath)
  const sourceSha256 = sha256(sourceBytes)

  for (const targetPath of targetPaths) {
    mkdirSync(dirname(targetPath), { recursive: true })
    copyFileSync(sourcePath, targetPath)
  }

  const results = targetPaths.map((targetPath) => {
    const bytes = readFileSync(targetPath)
    return { targetPath, bytes, sha256: sha256(bytes) }
  })

  const mismatched = results.filter(
    (result) => result.sha256 !== sourceSha256 || result.bytes.byteLength !== sourceBytes.byteLength
  )
  if (mismatched.length) {
    console.error(
      'Rolling ARIS artifact copy verification failed — copy does not match the build output:'
    )
    for (const result of mismatched) console.error(describe(result.targetPath, result.bytes))
    process.exit(1)
  }

  console.log(`Updated rolling ARIS artifacts (source: ${sourcePath}):`)
  for (const result of results) console.log(`  ${result.targetPath}`)
  console.log(`Bytes: ${sourceBytes.byteLength}`)
  console.log(`SHA-256: ${sourceSha256}`)
}
