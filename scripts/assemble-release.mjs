import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = manifest.version

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value) {
    console.error(`${name} requires a value`)
    process.exit(1)
  }
  return value
}

const htmlSource = resolve(option('--html', 'dist/index.html'))
const outputArgument = option('--out', 'release')
if (
  !/^release(?:-[a-z0-9-]+)?$/i.test(outputArgument) ||
  basename(outputArgument) !== outputArgument
) {
  console.error(
    `Release output must be a repository-root release directory, got: ${outputArgument}`
  )
  process.exit(1)
}
const outputDirectory = resolve(outputArgument)

if (existsSync(outputDirectory)) {
  console.error(`Release output already exists; refusing to overwrite: ${outputDirectory}`)
  process.exit(1)
}
if (!existsSync(htmlSource) || !statSync(htmlSource).isFile()) {
  console.error(`Tested HTML artifact does not exist: ${htmlSource}`)
  process.exit(1)
}

mkdirSync(outputDirectory)
const htmlName = `OrbitPM-Process-Studio-Lite-${version}.html`
copyFileSync(htmlSource, resolve(outputDirectory, htmlName))

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(resolve('node_modules/.bin/vite-node'), [
  'src/spreadsheet/scripts/writeTemplates.ts',
  outputDirectory
])
run(process.execPath, [
  'scripts/license-policy.mjs',
  '--report',
  resolve(outputDirectory, 'THIRD_PARTY_NOTICES.md')
])
run(process.execPath, [
  'scripts/generate-sbom.mjs',
  '--output',
  resolve(outputDirectory, `OrbitPM-Process-Studio-Lite-${version}.cyclonedx.json`)
])
copyFileSync(resolve('LICENSE'), resolve(outputDirectory, 'LICENSE'))

const checksumTargets = readdirSync(outputDirectory)
  .filter((name) => name !== 'SHA256SUMS.txt')
  .sort()
const checksumLines = checksumTargets.map((name) => {
  const digest = createHash('sha256')
    .update(readFileSync(resolve(outputDirectory, name)))
    .digest('hex')
  return `${digest}  ${name}`
})
writeFileSync(resolve(outputDirectory, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`)

console.log(
  `Assembled ${checksumTargets.length + 1} allowlisted release assets in ${outputArgument}/.`
)
