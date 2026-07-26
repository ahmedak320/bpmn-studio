import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const rawLimit = 8 * 1024 * 1024
const gzipLimit = Math.floor(2.5 * 1024 * 1024)
const artifactPath = resolve(process.argv[2] ?? 'dist/index.html')
const bytes = readFileSync(artifactPath)
const gzipBytes = gzipSync(bytes, { level: 9 })
const failures = []

if (basename(artifactPath) === 'index.html') {
  const buildDirectory = dirname(artifactPath)
  const entries = []
  function collect(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        entries.push(`${relativePath}/`)
        collect(resolve(directory, entry.name), relativePath)
      } else {
        entries.push(relativePath)
      }
    }
  }
  collect(buildDirectory)
  entries.sort()
  if (entries.length !== 1 || entries[0] !== 'index.html') {
    failures.push(
      `single-file build directory must contain only index.html; found ${entries.join(', ')}`
    )
  }
}
if (bytes.byteLength > rawLimit) {
  failures.push(`raw size ${bytes.byteLength} exceeds ${rawLimit} bytes`)
}
if (gzipBytes.byteLength > gzipLimit) {
  failures.push(`gzip size ${gzipBytes.byteLength} exceeds ${gzipLimit} bytes`)
}

const digest = createHash('sha256').update(bytes).digest('hex')
console.log(
  JSON.stringify(
    {
      artifact: artifactPath,
      rawBytes: bytes.byteLength,
      rawLimitBytes: rawLimit,
      gzipBytes: gzipBytes.byteLength,
      gzipLimitBytes: gzipLimit,
      sha256: digest
    },
    null,
    2
  )
)

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
