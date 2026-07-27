import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
const expectedTag = `v${manifest.version}`
const failures = []

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

if (tag !== expectedTag) failures.push(`release tag must be ${expectedTag}, found ${tag}`)
if (tag) {
  try {
    if (git('cat-file', '-t', tag) !== 'tag') {
      failures.push(`${tag} must be an annotated tag object`)
    }
    if (git('rev-parse', `${tag}^{commit}`) !== git('rev-parse', 'HEAD')) {
      failures.push(`${tag} does not peel to the checked-out commit`)
    }
  } catch (error) {
    failures.push(`could not inspect tag ${tag}: ${error.message}`)
  }
}

if (process.argv.includes('--require-origin-main')) {
  try {
    if (git('rev-parse', 'origin/main') !== git('rev-parse', 'HEAD')) {
      failures.push('release tag commit does not equal origin/main')
    }
  } catch (error) {
    failures.push(`could not inspect origin/main: ${error.message}`)
  }
}

if (failures.length) {
  console.error('Release tag check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`${tag} is annotated and resolves to the checked-out origin/main commit.`)
