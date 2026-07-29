import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const trackedFiles = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean)
  .filter((path) => existsSync(path))

const prohibitedPaths = [
  /^electron-builder\.ya?ml$/i,
  /^electron\.vite\./i,
  /^src\/(?:main|preload)\//i,
  /^src\/(?:desktop|electron|preload)(?:[./]|$)/i,
  /(?:^|\/)(?:desktop|installer|updater|server|bridge|docker)(?:\/|$)/i,
  /(?:^|\/)(?:Dockerfile|compose\.ya?ml)$/i,
  /\.(?:exe|msi|dmg|pkg|appimage|deb|rpm|snap|nupkg|blockmap)$/i,
  /\.app(?:\/|$)/i,
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
const prohibitedDependencyPatterns = [
  /^electron$/i,
  /^@electron\//i,
  /^@electron-forge\//i,
  /^electron-(?:builder|forge|installer(?:-.+)?|packager|rebuild|updater|vite|winstaller)$/i
]
const isProhibitedDependency = (name) =>
  prohibitedDependencyPatterns.some((pattern) => pattern.test(name))
const dependencyViolations = dependencyNames.filter(isProhibitedDependency)

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const lockedDependencyViolations = Object.keys(lock.packages ?? {})
  .map((path) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length))
  .filter(isProhibitedDependency)

const manifestViolations = []
if (manifest.name !== 'orbitpm-aris-studio-lite') {
  manifestViolations.push(`active package must be orbitpm-aris-studio-lite, found ${manifest.name}`)
}
const scriptText = JSON.stringify(manifest.scripts ?? {})
if (/\b(?:electron|electron-builder|nsis|app-builder|portable-exe|docker)\b/i.test(scriptText)) {
  manifestViolations.push('package scripts contain a prohibited non-Lite build or release command')
}

const workflowViolations = []
const unpinnedActions = []
for (const path of trackedFiles.filter((name) => /^\.github\/workflows\/.+\.ya?ml$/i.test(name))) {
  const contents = readFileSync(path, 'utf8')
  if (
    /\b(?:electron-builder|build-windows|portable-exe|nsis|app-builder)\b/i.test(contents) ||
    /(?:^|\s)--win(?:\s|$)/im.test(contents) ||
    /\.(?:exe|msi|dmg|appimage|blockmap)\b/i.test(contents)
  ) {
    workflowViolations.push(path)
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/i)
    if (!match) continue
    const target = match[1].replace(/^(['"])(.*)\1$/, '$2')
    if (target.startsWith('./')) continue
    const separator = target.lastIndexOf('@')
    const action = separator === -1 ? target : target.slice(0, separator)
    const reference = separator === -1 ? '' : target.slice(separator + 1)
    if (!/^[a-f0-9]{40}$/i.test(reference)) {
      unpinnedActions.push(`${path}: ${action}@${reference || '(missing)'}`)
    }
  }
}

const activeSourceFiles = trackedFiles.filter((name) =>
  /^(?:src|tests|scripts)\/.*\.(?:[cm]?[jt]sx?|json|html|css)$/i.test(name)
)
const sourceViolations = []
for (const path of activeSourceFiles) {
  const contents = readFileSync(path, 'utf8')
  const specifiers = [
    ...contents.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
    )
  ].map((match) => match[1])
  for (const specifier of specifiers) {
    if (
      /^(?:electron|@electron)(?:\/|$)/i.test(specifier) ||
      /(?:^|\/)(?:desktop|electron|preload)(?:\/|$)/i.test(specifier) ||
      /(?:^|\/)src\/main\//i.test(specifier)
    ) {
      sourceViolations.push(`${path} -> ${specifier}`)
    }
  }
}

const legacyPromotionPatterns = [
  /\bdesktop\s+app\s+only\b/i,
  /\bdesktop[- ]only\b/i,
  /\b(?:or|try)\s+(?:use\s+)?the\s+desktop\s+app\b/i,
  /\buse\s+the\s+desktop\s+app\b/i,
  /تطبيق\s+سطح\s+المكتب/u
]
const legacyPromotionTargets = trackedFiles.filter(
  (name) =>
    name === 'index.html' ||
    name === 'src/i18n/dictionaries.ts' ||
    name === 'src/ai/browserAi.ts' ||
    /^(?:README(?:\.[^/]+)?|docs\/(?!archive\/).+\.md)$/i.test(name)
)
const legacyPromotionViolations = []
for (const path of legacyPromotionTargets) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (legacyPromotionPatterns.some((pattern) => pattern.test(line))) {
      legacyPromotionViolations.push(`${path}:${index + 1}`)
    }
  })
}

const violations = [
  ...pathViolations.map((path) => `prohibited tracked path: ${path}`),
  ...dependencyViolations.map((name) => `prohibited dependency: ${name}`),
  ...lockedDependencyViolations.map((name) => `prohibited locked dependency: ${name}`),
  ...manifestViolations,
  ...workflowViolations.map((path) => `prohibited release workflow content: ${path}`),
  ...unpinnedActions.map((action) => `third-party action is not pinned to a full SHA: ${action}`),
  ...sourceViolations.map((path) => `active source imports a prohibited legacy tree: ${path}`),
  ...legacyPromotionViolations.map(
    (path) => `active Lite UI/docs promotes a removed Desktop application: ${path}`
  )
]

if (violations.length > 0) {
  console.error('Lite-only policy check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(
    `Lite-only policy check passed (${trackedFiles.length} active files, ${dependencyNames.length} direct dependencies).`
  )
}
