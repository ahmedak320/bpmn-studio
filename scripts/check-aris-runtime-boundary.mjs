import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const ENTRY = resolve(ROOT, 'src/main.tsx')
const PACKAGE_JSON = resolve(ROOT, 'package.json')

const bannedPackages = new Set([
  '@bpmn-io/properties-panel',
  'bpmn-auto-layout',
  'bpmn-js',
  'bpmn-js-bpmnlint',
  'bpmn-js-create-append-anything',
  'bpmn-js-properties-panel',
  'bpmn-moddle',
  'bpmnlint'
])

const bannedGraphPaths = [
  /^src\/App\.tsx$/u,
  /^src\/editor\//u,
  /^src\/org\/orbitpmModdle\.ts$/u,
  /^src\/validation\/ReadOnlyDiagramPreview\.tsx$/u
]

const packageManifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
const dependencyViolations = [...bannedPackages].filter(
  (name) => packageManifest.dependencies?.[name] !== undefined
)

const resolveCandidate = (path) => {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']
  for (const candidate of extensions.map((extension) => `${path}${extension}`)) {
    if (ts.sys.fileExists(candidate)) return candidate
  }
  for (const extension of extensions) {
    const indexCandidate = resolve(path, `index${extension}`)
    if (ts.sys.fileExists(indexCandidate)) return indexCandidate
  }
  if (ts.sys.fileExists(path)) return path
  return null
}

const resolveImport = (fromFile, specifier) => {
  const bareSpecifier = specifier.replace(/\?.*$/u, '')
  if (specifier.startsWith('@/')) {
    return resolveCandidate(resolve(ROOT, 'src', bareSpecifier.slice(2)))
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolveCandidate(resolve(dirname(fromFile), bareSpecifier))
  }
  return null
}

const relativePath = (file) => file.replaceAll('\\', '/').replace(`${ROOT.replaceAll('\\', '/')}/`, '')

const parseSpecifiers = (file) => {
  if (!/\.[cm]?[jt]sx?$/u.test(file)) return []
  const sourceText = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const specifiers = []
  source.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !(node.importClause?.isTypeOnly ?? false)
    ) {
      specifiers.push(node.moduleSpecifier.text)
      return
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !(node.isTypeOnly ?? false)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
  })
  return specifiers
}

const visited = new Set()
const queue = [ENTRY]
const packageSpecifierViolations = []
const graphPathViolations = []
const unresolvedLocalImports = []

while (queue.length > 0) {
  const file = queue.shift()
  if (!file || visited.has(file)) continue
  visited.add(file)

  const rel = relativePath(file)
  if (bannedGraphPaths.some((pattern) => pattern.test(rel))) {
    graphPathViolations.push(rel)
  }

  for (const specifier of parseSpecifiers(file)) {
    if (bannedPackages.has(specifier)) {
      packageSpecifierViolations.push(`${rel} -> ${specifier}`)
      continue
    }
    const resolved = resolveImport(file, specifier)
    if (resolved) {
      queue.push(resolved)
      continue
    }
    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/')) {
      unresolvedLocalImports.push(`${rel} -> ${specifier}`)
    }
  }
}

const violations = [
  ...dependencyViolations.map((name) => `package.json dependencies still include banned BPMN runtime: ${name}`),
  ...packageSpecifierViolations.map((entry) => `ARIS production graph imports banned BPMN package: ${entry}`),
  ...graphPathViolations.map((path) => `ARIS production graph reaches banned BPMN module: ${path}`),
  ...unresolvedLocalImports.map((entry) => `ARIS production graph has an unresolved local import: ${entry}`)
]

if (violations.length > 0) {
  console.error('ARIS runtime boundary check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(
    `ARIS runtime boundary check passed: ${visited.size} production modules reachable from src/main.tsx.`
  )
}
