import { readFileSync } from 'node:fs'

const packageUrl = new URL('../package.json', import.meta.url)
const lockUrl = new URL('../package-lock.json', import.meta.url)
const manifest = JSON.parse(readFileSync(packageUrl, 'utf8'))
const lock = JSON.parse(readFileSync(lockUrl, 'utf8'))
const failures = []

if (lock.lockfileVersion !== 3) {
  failures.push(`package-lock.json must use lockfileVersion 3, found ${lock.lockfileVersion}`)
}

if (manifest.packageManager !== 'npm@11.13.0') {
  failures.push(`packageManager must be exactly npm@11.13.0, found ${manifest.packageManager}`)
}

const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies']
for (const group of dependencyGroups) {
  for (const [name, requested] of Object.entries(manifest[group] ?? {})) {
    if (typeof requested !== 'string' || !/^(?:\d+\.){2}\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested)) {
      failures.push(`${group}.${name} is not an exact registry version: ${requested}`)
    }
  }
}

function validateOverrides(value, path = 'overrides') {
  for (const [name, requested] of Object.entries(value ?? {})) {
    if (typeof requested === 'string') {
      if (!/^(?:\d+\.){2}\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested)) {
        failures.push(`${path}.${name} is not an exact registry version: ${requested}`)
      }
    } else if (requested && typeof requested === 'object') {
      validateOverrides(requested, `${path}.${name}`)
    } else {
      failures.push(`${path}.${name} is not a valid exact override`)
    }
  }
}
validateOverrides(manifest.overrides)

const lockedRoot = lock.packages?.['']
if (!lockedRoot) {
  failures.push('package-lock.json does not contain a root package record')
} else {
  for (const group of dependencyGroups) {
    const expected = manifest[group] ?? {}
    const actual = lockedRoot[group] ?? {}
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      failures.push(`package.json and package-lock.json disagree in ${group}`)
    }
  }
  if (lockedRoot.version !== manifest.version) {
    failures.push(
      `package-lock root version ${lockedRoot.version} does not match ${manifest.version}`
    )
  }
}

if (process.env.CI) {
  if (process.version !== 'v22.22.0') {
    failures.push(`CI Node must be v22.22.0, found ${process.version}`)
  }
  const npmVersion = process.env.npm_config_user_agent?.match(/\bnpm\/([^\s]+)/)?.[1]
  if (npmVersion !== '11.13.0') {
    failures.push(`CI npm must be 11.13.0, found ${npmVersion ?? 'unknown'}`)
  }
}

if (failures.length) {
  console.error('Reproducible dependency-lock check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Dependency lock is reproducible (${Object.keys(lock.packages).length - 1} locked packages; npm@11.13.0).`
)
