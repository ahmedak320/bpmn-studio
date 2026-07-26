import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  BPMN_JS_LICENSE,
  lockedPackageKey,
  normalizeNoticeText,
  reviewedLicenseOverrides
} from './license-policy-data.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const outputIndex = process.argv.indexOf('--output')
const outputPath = resolve(
  outputIndex === -1
    ? `OrbitPM-Process-Studio-Lite-${manifest.version}.cyclonedx.json`
    : (process.argv[outputIndex + 1] ?? '')
)

if (outputIndex !== -1 && !process.argv[outputIndex + 1]) {
  console.error('--output requires a path')
  process.exit(1)
}

function nameFromInstallPath(installPath) {
  return installPath.slice(installPath.lastIndexOf('node_modules/') + 'node_modules/'.length)
}

function purlFor(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name)
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`
}

function integrityHash(integrity) {
  if (!integrity) return undefined
  const [token] = integrity.split(/\s+/)
  const match = token?.match(/^(sha(?:1|256|384|512))-(.+)$/i)
  if (!match) return undefined
  const algorithm = {
    sha1: 'SHA-1',
    sha256: 'SHA-256',
    sha384: 'SHA-384',
    sha512: 'SHA-512'
  }[match[1].toLowerCase()]
  return {
    alg: algorithm,
    content: Buffer.from(match[2], 'base64').toString('hex')
  }
}

const productionEntries = new Map(
  Object.entries(lock.packages).filter(
    ([installPath, record]) => installPath && !record.dev && !record.link && record.version
  )
)

function resolveDependencyPath(parentPath, dependencyName) {
  let cursor = parentPath
  while (true) {
    const candidate = cursor
      ? `${cursor}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`
    if (productionEntries.has(candidate)) return candidate
    const marker = cursor.lastIndexOf('/node_modules/')
    if (marker === -1) break
    cursor = cursor.slice(0, marker)
  }
  return productionEntries.has(`node_modules/${dependencyName}`)
    ? `node_modules/${dependencyName}`
    : undefined
}

function dependencyNames(record) {
  return [
    ...new Set([
      ...Object.keys(record.dependencies ?? {}),
      ...Object.keys(record.optionalDependencies ?? {}),
      ...Object.keys(record.peerDependencies ?? {})
    ])
  ]
}

const references = new Map()
for (const [installPath, record] of productionEntries) {
  const name = record.name ?? nameFromInstallPath(installPath)
  references.set(
    installPath,
    `${purlFor(name, record.version)}?install_path=${encodeURIComponent(installPath)}`
  )
}

const rootRef = purlFor(manifest.name, manifest.version)
const bpmnLicenseText = normalizeNoticeText(
  readFileSync(resolve('node_modules/bpmn-js', BPMN_JS_LICENSE.noticeFile), 'utf8')
)
const components = [...productionEntries].map(([installPath, record]) => {
  const name = record.name ?? nameFromInstallPath(installPath)
  const packageKey = lockedPackageKey(name, record.version)
  const declaredLicense =
    reviewedLicenseOverrides.get(packageKey) ?? String(record.license ?? 'UNKNOWN')
  const hash = integrityHash(record.integrity)
  const spdxLike = /^[A-Za-z0-9-.+()\s]+(?:\s(?:AND|OR|WITH)\s[A-Za-z0-9-.+()\s]+)*$/.test(
    declaredLicense
  )
  return {
    type: 'library',
    'bom-ref': references.get(installPath),
    name,
    version: record.version,
    licenses:
      packageKey === BPMN_JS_LICENSE.packageKey
        ? [
            {
              license: {
                name: BPMN_JS_LICENSE.classification,
                text: { contentType: 'text/plain', content: bpmnLicenseText }
              }
            }
          ]
        : spdxLike
          ? [{ expression: declaredLicense }]
          : [{ license: { name: declaredLicense } }],
    purl: purlFor(name, record.version),
    hashes: hash ? [hash] : undefined,
    properties: [
      { name: 'orbitpm:install-path', value: installPath },
      { name: 'orbitpm:npm-optional', value: String(Boolean(record.optional)) }
    ]
  }
})

components.sort(
  (a, b) =>
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version) ||
    a['bom-ref'].localeCompare(b['bom-ref'])
)

const rootDependencies = Object.keys(manifest.dependencies ?? {})
  .map((name) => resolveDependencyPath('', name))
  .filter(Boolean)
  .map((path) => references.get(path))
  .sort()

const dependencies = [
  { ref: rootRef, dependsOn: rootDependencies },
  ...[...productionEntries].map(([installPath, record]) => ({
    ref: references.get(installPath),
    dependsOn: dependencyNames(record)
      .map((name) => resolveDependencyPath(installPath, name))
      .filter(Boolean)
      .map((path) => references.get(path))
      .sort()
  }))
].sort((a, b) => a.ref.localeCompare(b.ref))

const lockDigest = createHash('sha256')
  .update(readFileSync(new URL('../package-lock.json', import.meta.url)))
  .digest('hex')
const bom = {
  $schema: 'https://cyclonedx.org/schema/bom-1.6.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      'bom-ref': rootRef,
      name: manifest.name,
      version: manifest.version,
      licenses: [{ expression: manifest.license }],
      purl: rootRef,
      externalReferences: [
        {
          type: 'vcs',
          url: manifest.repository.url.replace(/^git\+/, '')
        }
      ],
      properties: [{ name: 'orbitpm:package-lock-sha256', value: lockDigest }]
    }
  },
  components,
  dependencies
}

const failures = []
if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6') {
  failures.push('SBOM header is not CycloneDX 1.6')
}
if (!components.length) failures.push('SBOM contains no production components')
if (new Set(components.map((component) => component['bom-ref'])).size !== components.length) {
  failures.push('SBOM component bom-ref values are not unique')
}
const bpmnComponent = components.find(
  ({ name, version }) => `${name}@${version}` === BPMN_JS_LICENSE.packageKey
)
const bpmnComponentLicense = bpmnComponent?.licenses?.[0]?.license
if (
  bpmnComponentLicense?.name !== BPMN_JS_LICENSE.classification ||
  bpmnComponentLicense?.text?.content !== bpmnLicenseText
) {
  failures.push('SBOM does not preserve the reviewed bpmn-js license classification and text')
}
const knownRefs = new Set([rootRef, ...components.map((component) => component['bom-ref'])])
for (const dependency of dependencies) {
  if (!knownRefs.has(dependency.ref)) failures.push(`unknown dependency ref: ${dependency.ref}`)
  for (const target of dependency.dependsOn) {
    if (!knownRefs.has(target)) failures.push(`unknown dependency target: ${target}`)
  }
}
if (failures.length) {
  console.error('CycloneDX SBOM generation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`)
console.log(
  `Wrote deterministic CycloneDX 1.6 SBOM (${components.length} components): ${outputPath}`
)
