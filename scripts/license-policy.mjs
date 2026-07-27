import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  BPMN_JS_LICENSE,
  lockedPackageKey,
  normalizeNoticeText,
  noticeFilePattern,
  requiredShippedNoticeFiles,
  reviewedLicenseOverrides
} from './license-policy-data.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))

const denied = /\b(?:AGPL|GPL|LGPL|SSPL|BUSL|UNLICENSED|PROPRIETARY)\b/i
const reviewedLicenseExpressions = new Set([
  '0BSD',
  'AFL-2.1',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD-4-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  BPMN_JS_LICENSE.classification,
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
  '(AFL-2.1 OR BSD-3-Clause)',
  '(MIT AND Zlib)',
  '(MPL-2.0 OR Apache-2.0)'
])
function mitLicense(copyright) {
  return `${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
}

const reviewedNoticeFallbacks = new Map([
  [
    '@ai-sdk/provider-utils@5.0.12',
    () => [
      {
        source: 'reviewed Vercel AI SDK monorepo license (node_modules/ai/LICENSE)',
        text: readFileSync(resolve('node_modules/ai/LICENSE'), 'utf8')
      }
    ]
  ],
  [
    '@bpmn-io/semver-compat@0.1.0',
    () => [
      {
        source: 'reviewed package metadata/README fallback',
        text: mitLicense('Copyright (c) bpmn.io contributors')
      }
    ]
  ],
  [
    'bpmn-auto-layout@0.4.0',
    () => [
      {
        source: 'reviewed package metadata/README fallback',
        text: mitLicense('Copyright (c) bpmn.io contributors')
      }
    ]
  ]
])

function packageNameFromPath(path) {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
}

const packages = []
const failures = []
const noticeBlocks = new Map()
const fallbackPackages = new Set()
for (const [installPath, record] of Object.entries(lock.packages)) {
  if (!installPath || record.dev || record.link) continue
  const name = record.name ?? packageNameFromPath(installPath)

  if (!record.version) {
    failures.push(`${name}: missing locked version`)
    continue
  }
  const packageKey = lockedPackageKey(name, record.version)
  const declared = String(record.license ?? '').trim()
  const license = reviewedLicenseOverrides.get(packageKey) ?? declared
  if (!license) {
    failures.push(`${name}@${record.version}: missing license metadata and no reviewed override`)
    continue
  }
  if (denied.test(license)) {
    failures.push(`${name}@${record.version}: denied license ${license}`)
    continue
  }
  if (!reviewedLicenseExpressions.has(license)) {
    failures.push(`${name}@${record.version}: unreviewed license ${license}`)
    continue
  }

  const packageId = `${name}@${record.version} (${installPath})`
  const packageDirectory = resolve(installPath)
  let notices = []
  if (existsSync(packageDirectory)) {
    notices = readdirSync(packageDirectory)
      .filter((fileName) => noticeFilePattern.test(fileName))
      .filter((fileName) => statSync(resolve(packageDirectory, fileName)).isFile())
      .sort((left, right) => left.localeCompare(right))
      .map((fileName) => ({
        source: `${installPath}/${fileName}`,
        text: readFileSync(resolve(packageDirectory, fileName), 'utf8')
      }))
  }
  const requiredNoticeFile = requiredShippedNoticeFiles.get(packageKey)
  if (
    requiredNoticeFile &&
    !notices.some(({ source }) => source === `${installPath}/${requiredNoticeFile}`)
  ) {
    failures.push(
      `${packageId}: required shipped notice ${requiredNoticeFile} was not preserved verbatim`
    )
  }
  if (!notices.length) {
    notices = reviewedNoticeFallbacks.get(packageKey)?.() ?? []
    if (notices.length) fallbackPackages.add(packageId)
  }
  if (!notices.length) {
    failures.push(`${packageId}: no LICENSE/NOTICE text and no reviewed fallback`)
    continue
  }

  for (const notice of notices) {
    const normalized = normalizeNoticeText(notice.text)
    if (!normalized || normalized.includes('\0')) {
      failures.push(`${packageId}: invalid text in ${notice.source}`)
      continue
    }
    const digest = createHash('sha256').update(normalized).digest('hex')
    const block = noticeBlocks.get(digest) ?? {
      digest,
      text: normalized,
      packages: new Set(),
      sources: new Set()
    }
    block.packages.add(packageId)
    block.sources.add(notice.source)
    noticeBlocks.set(digest, block)
  }

  packages.push({
    name,
    version: record.version,
    license,
    installPath,
    repository: record.resolved?.startsWith('http') ? record.resolved : ''
  })
}

packages.sort(
  (a, b) =>
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version) ||
    a.installPath.localeCompare(b.installPath)
)

if (failures.length) {
  console.error('Production dependency license policy failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const reportIndex = process.argv.indexOf('--report')
if (reportIndex !== -1) {
  const requested = process.argv[reportIndex + 1]
  if (!requested) {
    console.error('--report requires an output path')
    process.exit(1)
  }
  const output = resolve(requested)
  mkdirSync(dirname(output), { recursive: true })
  const lines = [
    '# Third-party notices',
    '',
    `OrbitPM Process Studio Lite ${manifest.version} includes the production dependencies listed below.`,
    'Each component remains subject to its own license. Versions and licenses are derived from',
    'the exact release package lock. Reviewed classifications and fallbacks are pinned to exact',
    `package versions; ${BPMN_JS_LICENSE.classification} denotes the additional watermark condition`,
    'in the shipped bpmn-js license. The deduplicated verbatim LICENSE, NOTICE, COPYING, COPYRIGHT,',
    'and AUTHORS texts',
    `shipped by those packages follow the inventory; ${fallbackPackages.size} reviewed npm package(s) that omit`,
    'the text use the explicitly identified upstream/metadata fallback shown below.',
    '',
    '| Package | Version | License |',
    '| --- | ---: | --- |',
    ...packages.map(
      ({ name, version, license }) =>
        `| ${name.replaceAll('|', '\\|')} | ${version} | ${license.replaceAll('|', '\\|')} |`
    ),
    '',
    '## License and notice texts',
    '',
    ...[...noticeBlocks.values()]
      .sort((left, right) => left.digest.localeCompare(right.digest))
      .flatMap((block) => [
        `### SHA-256 \`${block.digest}\``,
        '',
        `Packages: ${[...block.packages].sort().join(', ')}`,
        '',
        `Sources: ${[...block.sources].sort().join(', ')}`,
        '',
        ...block.text.split('\n').map((line) => `    ${line}`),
        ''
      ])
  ]
  writeFileSync(output, `${lines.join('\n')}\n`)
}

console.log(
  `License policy passed for ${packages.length} production dependency records ` +
    `with ${noticeBlocks.size} deduplicated license/notice texts.`
)
