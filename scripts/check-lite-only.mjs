import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8'
})
  .split('\0')
  .filter(Boolean)

const prohibitedPaths = [
  /^electron-builder\.ya?ml$/i,
  /^electron\.vite\./i,
  /^src\/(?:main|preload)\//i,
  /(?:^|\/)(?:desktop|installer|updater)(?:\/|$)/i,
  /\.(?:exe|blockmap)$/i,
  /(?:^|\/)latest\.ya?ml$/i
]

const pathViolations = trackedFiles.filter((path) =>
  prohibitedPaths.some((pattern) => pattern.test(path))
)

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const dependencyNames = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.optionalDependencies
})
const prohibitedDependencies = new Set([
  'electron',
  'electron-builder',
  'electron-updater',
  'electron-vite'
])
const dependencyViolations = dependencyNames.filter((name) =>
  prohibitedDependencies.has(name)
)

const workflowViolations = []
for (const path of trackedFiles.filter((name) =>
  /^\.github\/workflows\/.+\.ya?ml$/i.test(name)
)) {
  const contents = readFileSync(path, 'utf8')
  if (
    /\b(?:electron-builder|build-windows|portable-exe|nsis)\b/i.test(contents) ||
    /(?:^|\s)--win(?:\s|$)/im.test(contents) ||
    /\.exe\b/i.test(contents)
  ) {
    workflowViolations.push(path)
  }
}

const violations = [
  ...pathViolations.map((path) => `prohibited tracked path: ${path}`),
  ...dependencyViolations.map((name) => `prohibited dependency: ${name}`),
  ...workflowViolations.map((path) => `prohibited release workflow content: ${path}`)
]

if (violations.length > 0) {
  console.error('Lite-only policy check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(
    `Lite-only policy check passed (${trackedFiles.length} tracked files, ${dependencyNames.length} direct dependencies).`
  )
}
