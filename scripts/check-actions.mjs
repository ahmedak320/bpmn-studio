import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const require = createRequire(import.meta.url)
const workflowsDirectory = resolve(root, '.github/workflows')
const expectedWorkflows = [
  'historical-release-cleanup.yml',
  'pages-rollback.yml',
  'pages.yml',
  'quality.yml',
  'release-candidate.yml',
  'release-finalize.yml',
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

function workflowShellScripts(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u)
  const scripts = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(\||>-?)\s*$/u.exec(lines[index])
    if (!match) continue
    const runIndent = match[1].length
    const body = []
    let cursor = index + 1
    while (cursor < lines.length) {
      const line = lines[cursor]
      const indentation = /^\s*/u.exec(line)[0].length
      if (line.trim() && indentation <= runIndent) break
      body.push(line)
      cursor += 1
    }
    const bodyIndent = Math.min(
      ...body.filter((line) => line.trim()).map((line) => /^\s*/u.exec(line)[0].length)
    )
    const normalized = body.map((line) => line.slice(bodyIndent))
    const script = (match[2].startsWith('>') ? normalized.join(' ') : normalized.join('\n'))
      .replace(/\$\{\{[\s\S]*?\}\}/gu, '__GITHUB_ACTION_EXPRESSION__')
      .trim()
    const name =
      lines
        .slice(0, index)
        .reverse()
        .find((line) => /^\s+- name:/u.test(line))
        ?.replace(/^\s+- name:\s*/u, '') ?? `run block at line ${index + 1}`
    scripts.push({ name, script })
    index = cursor - 1
  }
  return scripts
}

let failed = false
for (const workflow of expectedWorkflows) {
  const workflowPath = resolve(workflowsDirectory, workflow)
  const separatelyCheckShell = workflow === 'historical-release-cleanup.yml'
  const shellcheckCommand = separatelyCheckShell ? '' : shellcheckWrapper
  const result = await new Promise((resolveResult) => {
    const child = spawn(actionlint, [`-shellcheck=${shellcheckCommand}`, workflowPath], {
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
  if (separatelyCheckShell) {
    const scripts = workflowShellScripts(workflowPath)
    if (scripts.length === 0) {
      console.error(`${workflow} did not expose any shell blocks for independent ShellCheck`)
      failed = true
      continue
    }
    for (const { name, script } of scripts) {
      const shellcheck = spawnSync(
        shellcheckExecutable,
        ['--shell=bash', '--severity=warning', '--format=gcc', '-'],
        {
          cwd: root,
          encoding: 'utf8',
          input: `${script}\n`,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 30_000
        }
      )
      if (shellcheck.error || shellcheck.status !== 0) {
        console.error(
          `${workflow} ShellCheck failed for ${name}: ${shellcheck.error?.message ?? shellcheck.stderr ?? shellcheck.stdout}`
        )
        failed = true
      }
    }
  }
}

if (failed) process.exit(1)
console.log(`actionlint passed independently for ${expectedWorkflows.length} exact workflows.`)
