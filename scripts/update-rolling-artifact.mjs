import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const sourcePath = resolve(process.argv[2] ?? 'dist/index.html')
const targetPath = resolve(process.argv[3] ?? 'release/OrbitPM-ARIS-Studio-Lite.html')

const sourceStats = statSync(sourcePath, { throwIfNoEntry: false })
if (!sourceStats?.isFile()) {
  console.error(`Built HTML artifact does not exist: ${sourcePath}`)
  process.exit(1)
}

mkdirSync(dirname(targetPath), { recursive: true })
copyFileSync(sourcePath, targetPath)

const bytes = readFileSync(targetPath)
const sha256 = createHash('sha256').update(bytes).digest('hex')

console.log(`Updated rolling ARIS artifact: ${targetPath}`)
console.log(`Bytes: ${bytes.byteLength}`)
console.log(`SHA-256: ${sha256}`)
