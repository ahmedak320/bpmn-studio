import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_FILES = [
  'finalize-evidence/browser-compatibility-evidence-verification.json',
  'finalize-evidence/finalization-chain.json',
  'finalize-evidence/pages/pages-browser-environment.json',
  'finalize-evidence/pages/trusted-release-external-evidence-verification.json',
  'finalize-evidence/trusted-release-external-evidence-verification.json',
  'latest-release.json',
  'publication-authority/publication-authority.json',
  'stable-release.json'
]

function fail(message) {
  throw new Error(message)
}

function parseOptions(argv = process.argv.slice(2)) {
  const options = new Map()
  for (const argument of argv) {
    const separator = argument.indexOf('=')
    if (!argument.startsWith('--') || separator < 3) {
      fail('Every CLI option must use --name=value syntax.')
    }
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (name !== 'root') fail(`--${name} is not supported.`)
    if (!value) fail('--root must not be empty.')
    if (options.has(name)) fail('--root must be provided exactly once.')
    options.set(name, value)
  }
  if (!options.has('root')) fail('--root is required.')
  return options
}

function walkFiles(rootPath) {
  const queue = [resolve(rootPath)]
  const files = []
  while (queue.length > 0) {
    const directory = queue.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
        continue
      }
      if (!entry.isFile()) {
        fail(`Artifact entry ${relative(resolve(rootPath), fullPath)} must be a regular file.`)
      }
      const relativePath = relative(resolve(rootPath), fullPath).replaceAll('\\', '/')
      const metadata = statSync(fullPath)
      if (metadata.size < 1 || metadata.size > 64 * 1024 * 1024) {
        fail(`Artifact file ${relativePath} must contain 1 through 67108864 bytes.`)
      }
      files.push(relativePath)
    }
  }
  return files.sort()
}

export function verifyFinalizationArtifactLayout(rootPath) {
  const actual = walkFiles(rootPath)
  const expected = [...EXPECTED_FILES].sort()
  const missing = expected.filter((file) => !actual.includes(file))
  const unexpected = actual.filter((file) => !expected.includes(file))
  if (missing.length || unexpected.length) {
    const details = []
    if (missing.length) details.push(`Missing files: ${missing.join(', ')}`)
    if (unexpected.length) details.push(`Unexpected files: ${unexpected.join(', ')}`)
    fail(details.join('\n'))
  }
  return { fileCount: expected.length, files: expected }
}

function main() {
  const options = parseOptions()
  const result = verifyFinalizationArtifactLayout(options.get('root'))
  console.log(`Verified immutable finalization artifact layout with ${result.fileCount} files.`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).toString() === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
