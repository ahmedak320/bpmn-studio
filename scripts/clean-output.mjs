import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const allowedTargets = new Set(['dist', 'packages/epc-engine/dist'])
const requested = process.argv[2]

if (!requested || !allowedTargets.has(requested)) {
  console.error(`Refusing to clean unsupported output path: ${requested ?? '(missing)'}`)
  process.exit(1)
}

const target = resolve(repositoryRoot, requested)
if (target === repositoryRoot || !target.startsWith(`${repositoryRoot}/`)) {
  console.error(`Refusing to clean path outside the repository output allowlist: ${target}`)
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
console.log(`Removed generated output: ${requested}/`)
