import { readFileSync } from 'node:fs'

const expectedDirectives = new Map([
  ['default-src', ["'self'"]],
  ['script-src', ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]],
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ["'self'", 'data:', 'blob:']],
  ['font-src', ["'self'", 'data:']],
  ['worker-src', ["'self'", 'blob:']],
  [
    'connect-src',
    [
      'data:',
      'https://api.anthropic.com',
      'https://generativelanguage.googleapis.com',
      'https://openrouter.ai',
      'https://translate.googleapis.com',
      'https://api.mymemory.translated.net'
    ]
  ],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]]
])

const source = readFileSync(process.argv[2] ?? 'index.html', 'utf8')
const cspTags = [...source.matchAll(/<meta\b[^>]*>/gi)]
  .map(([tag]) => tag)
  .filter((tag) => /\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1/i.test(tag))

if (cspTags.length !== 1) {
  console.error(`Expected exactly one Content-Security-Policy meta tag; found ${cspTags.length}.`)
  process.exit(1)
}

const failures = []
const contentMatch = cspTags[0].match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)
if (!contentMatch) {
  failures.push('CSP meta tag has no quoted content attribute')
}

const directives = new Map()
for (const part of (contentMatch?.[2] ?? '')
  .split(';')
  .map((value) => value.trim())
  .filter(Boolean)) {
  const [name, ...values] = part.split(/\s+/)
  if (directives.has(name)) {
    failures.push(`duplicate CSP directive: ${name}`)
    continue
  }
  directives.set(name, values)
}

for (const [name, expectedValues] of expectedDirectives) {
  const actualValues = directives.get(name)
  if (!actualValues) {
    failures.push(`missing required CSP directive: ${name}`)
    continue
  }
  if (
    actualValues.length !== expectedValues.length ||
    new Set(actualValues).size !== actualValues.length ||
    expectedValues.some((value) => !actualValues.includes(value))
  ) {
    failures.push(
      `${name} must be exactly: ${expectedValues.join(' ')}; found: ${actualValues.join(' ')}`
    )
  }
}
for (const name of directives.keys()) {
  if (!expectedDirectives.has(name)) failures.push(`unexpected CSP directive: ${name}`)
}

if (failures.length) {
  console.error('CSP allowlist check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `CSP allowlist passed (${directives.size} exact directives; ` +
    `${
      expectedDirectives
        .get('connect-src')
        .filter((sourceValue) => sourceValue.startsWith('https://')).length
    } approved external connect-src endpoints plus embedded data: WASM).`
)
