import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  BPMN_JS_LICENSE,
  containsBpmnAttributionMarkup,
  containsHiddenBpmnAttributionRule,
  normalizeNoticeText
} from './license-policy-data.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = manifest.version
const releaseDirectory = resolve(process.argv[2] ?? 'release')
const htmlName = `OrbitPM-Process-Studio-Lite-${version}.html`
const sbomName = `OrbitPM-Process-Studio-Lite-${version}.cyclonedx.json`
const expected = [
  'LICENSE',
  `OrbitPM-Excel-Example-${version}.xlsx`,
  `OrbitPM-Excel-Template-${version}.xlsx`,
  htmlName,
  sbomName,
  'SHA256SUMS.txt',
  'THIRD_PARTY_NOTICES.md'
].sort()
const actual = readdirSync(releaseDirectory, { withFileTypes: true })
  .map((entry) => (entry.isFile() ? entry.name : `${entry.name}/`))
  .sort()
const failures = []

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  failures.push(
    `release asset allowlist mismatch\n  expected: ${expected.join(', ')}\n  actual: ${actual.join(', ')}`
  )
}

const checksumText = readFileSync(resolve(releaseDirectory, 'SHA256SUMS.txt'), 'utf8')
const checksumLines = checksumText.trimEnd().split('\n')
const checksumNames = []
for (const line of checksumLines) {
  const match = line.match(/^([a-f0-9]{64}) {2}([^/\\]+)$/)
  if (!match) {
    failures.push(`invalid SHA256SUMS line: ${line}`)
    continue
  }
  const [, expectedDigest, name] = match
  checksumNames.push(name)
  const bytes = readFileSync(resolve(releaseDirectory, name))
  const actualDigest = createHash('sha256').update(bytes).digest('hex')
  if (actualDigest !== expectedDigest) {
    failures.push(`checksum mismatch for ${name}`)
  }
}
const expectedChecksumNames = expected.filter((name) => name !== 'SHA256SUMS.txt').sort()
if (JSON.stringify(checksumNames) !== JSON.stringify(expectedChecksumNames)) {
  failures.push('SHA256SUMS.txt does not cover the exact sorted release allowlist')
}

const html = readFileSync(resolve(releaseDirectory, htmlName))
if (html.byteLength > 8 * 1024 * 1024) failures.push('release HTML exceeds the 8 MiB raw limit')
if (gzipSync(html, { level: 9 }).byteLength > Math.floor(2.5 * 1024 * 1024)) {
  failures.push('release HTML exceeds the 2.5 MiB gzip limit')
}
const htmlText = html.toString('utf8')
const htmlOpeningTag = htmlText.match(/<html\b[^>]*>/i)?.[0] ?? ''
const versionMarkers = [
  ...htmlOpeningTag.matchAll(/\bdata-orbitpm-app-version=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)
]
const versionMarker = versionMarkers[0]?.slice(1).find((value) => value !== undefined)
if (versionMarkers.length !== 1 || versionMarker !== version) {
  failures.push(
    `release HTML must contain one app-version marker for ${JSON.stringify(version)}; found ${versionMarkers.length} with value ${JSON.stringify(versionMarker ?? null)}`
  )
}
if (!containsBpmnAttributionMarkup(htmlText)) {
  failures.push('release HTML does not contain the required linked bpmn.io powered-by attribution')
}
if (containsHiddenBpmnAttributionRule(htmlText)) {
  failures.push('release HTML statically hides the required bpmn.io powered-by attribution')
}
if (
  /(?:electron|electron-builder|nsis|latest\.ya?ml|\.exe\b|\.blockmap\b)/i.test(expected.join('\n'))
) {
  failures.push('release allowlist contains a Desktop/Electron artifact')
}

for (const name of expected.filter((candidate) => candidate.endsWith('.xlsx'))) {
  const workbook = readFileSync(resolve(releaseDirectory, name))
  const text = workbook.toString('latin1')
  if (workbook[0] !== 0x50 || workbook[1] !== 0x4b) {
    failures.push(`${name} is not an OOXML ZIP`)
  }
  if (!text.includes('[Content_Types].xml') || !text.includes('xl/workbook.xml')) {
    failures.push(`${name} is missing required XLSX parts`)
  }
  if (/vbaProject\.bin|macrosheets|externalLinks/i.test(text)) {
    failures.push(`${name} contains a prohibited macro or external-link part`)
  }
}

const sbom = JSON.parse(readFileSync(resolve(releaseDirectory, sbomName), 'utf8'))
if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6') {
  failures.push('release SBOM is not CycloneDX 1.6 JSON')
}
if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
  failures.push('release SBOM has no production components')
}
const expectedBpmnLicense = normalizeNoticeText(
  readFileSync(resolve('node_modules/bpmn-js', BPMN_JS_LICENSE.noticeFile), 'utf8')
)
const bpmnComponent = sbom.components?.find(
  ({ name, version: componentVersion }) =>
    `${name}@${componentVersion}` === BPMN_JS_LICENSE.packageKey
)
const bpmnComponentLicense = bpmnComponent?.licenses?.[0]?.license
if (
  bpmnComponentLicense?.name !== BPMN_JS_LICENSE.classification ||
  bpmnComponentLicense?.text?.content !== expectedBpmnLicense
) {
  failures.push('release SBOM does not preserve the reviewed bpmn-js license and full text')
}
const notices = readFileSync(resolve(releaseDirectory, 'THIRD_PARTY_NOTICES.md'), 'utf8')
if (!notices.includes('| Package | Version | License |')) {
  failures.push('third-party notices do not contain the generated license inventory')
}
if (
  !notices.includes('## License and notice texts') ||
  !/^### SHA-256 `[a-f0-9]{64}`$/m.test(notices)
) {
  failures.push('third-party notices do not preserve dependency license/notice texts')
}

function expectedNoticeEvidence(packageKey, installPath, fileName) {
  const text = normalizeNoticeText(readFileSync(resolve(installPath, fileName), 'utf8'))
  return {
    inventory:
      packageKey === BPMN_JS_LICENSE.packageKey
        ? `| bpmn-js | 18.21.0 | ${BPMN_JS_LICENSE.classification} |`
        : undefined,
    packageId: `${packageKey} (${installPath})`,
    source: `Sources: ${installPath}/${fileName}`,
    text: text
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
  }
}

for (const evidence of [
  expectedNoticeEvidence(
    BPMN_JS_LICENSE.packageKey,
    'node_modules/bpmn-js',
    BPMN_JS_LICENSE.noticeFile
  ),
  expectedNoticeEvidence('colors@1.0.3', 'node_modules/colors', 'MIT-LICENSE.txt')
]) {
  if (evidence.inventory && !notices.includes(evidence.inventory)) {
    failures.push(`third-party notices misclassify ${evidence.packageId}`)
  }
  if (
    !notices.includes(evidence.packageId) ||
    !notices.includes(evidence.source) ||
    !notices.includes(evidence.text)
  ) {
    failures.push(
      `third-party notices do not preserve the exact shipped license for ${evidence.packageId}`
    )
  }
}

if (failures.length) {
  console.error('Release verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Release verification passed (${expected.length} exact assets, checksums, size, XLSX, SBOM, licenses, Lite-only policy).`
)
