import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const require = createRequire(import.meta.url)
const workflowsDirectory = resolve(root, '.github/workflows')
const expectedWorkflows = [
  'pages-rollback.yml',
  'pages.yml',
  'quality.yml',
  'release-candidate.yml',
  'release.yml'
]
const actualWorkflows = readdirSync(workflowsDirectory)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()

if (actualWorkflows.join('\n') !== expectedWorkflows.join('\n')) {
  throw new Error(
    `Workflow inventory changed: expected ${expectedWorkflows.join(', ')}, found ${actualWorkflows.join(', ')}`
  )
}

const actionlintPackage = require(resolve(root, 'node_modules/github-actionlint/package.json'))
if (actionlintPackage.version !== '1.7.12') {
  throw new Error(
    `github-actionlint must remain pinned to 1.7.12, found ${actionlintPackage.version}`
  )
}
const { getBinaryPath } = require(
  resolve(root, 'node_modules/github-actionlint/dist/lib/download.js')
)
const actionlint = await getBinaryPath(actionlintPackage.version)
if (!existsSync(actionlint)) throw new Error('Pinned native actionlint executable is missing.')
const shellcheckWrapper = resolve(root, 'scripts/actionlint-shellcheck.sh')
if (!existsSync(shellcheckWrapper)) {
  throw new Error('Serialized ShellCheck wrapper is missing.')
}
const shellcheckLookup = spawnSync('which', ['shellcheck'], { encoding: 'utf8' })
const shellcheckExecutable = shellcheckLookup.stdout.trim()
if (shellcheckLookup.status !== 0 || !shellcheckExecutable || !existsSync(shellcheckExecutable)) {
  throw new Error('ShellCheck executable is missing.')
}

let failed = false
for (const workflow of expectedWorkflows) {
  const workflowPath = resolve(workflowsDirectory, workflow)
  const result = await new Promise((resolveResult) => {
    const child = spawn(actionlint, [`-shellcheck=${shellcheckWrapper}`, workflowPath], {
      cwd: root,
      stdio: 'inherit'
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 90_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolveResult({ error, timedOut })
    })
    child.once('close', (status, signal) => {
      clearTimeout(timer)
      resolveResult({ signal, status, timedOut })
    })
  })
  if (result.timedOut || result.signal) {
    console.error(`actionlint timed out or was terminated for ${workflow}`)
    failed = true
    continue
  }
  if (result.error) {
    console.error(`actionlint failed to start for ${workflow}: ${result.error.message}`)
    failed = true
    continue
  }
  if (result.status !== 0) {
    console.error(`actionlint failed for ${workflow} with exit code ${result.status}`)
    failed = true
    continue
  }
}

if (failed) process.exit(1)
console.log(`actionlint passed independently for ${expectedWorkflows.length} exact workflows.`)
