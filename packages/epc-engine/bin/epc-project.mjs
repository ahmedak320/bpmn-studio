#!/usr/bin/env node
/**
 * `epc-project` — headless CLI for the `@orbitpm/epc-engine` package
 * (implementation plan Lane L-CLI, Wave 22; deliverable 4, CLI half;
 * authorized change 4).
 *
 * Usage: epc-project <validate|project|render> <input.json|-> [--out <dir>] [--model <index>] [--version <id>]
 *
 * Exit codes (BINDING):
 *   0 = ok
 *   1 = error-severity EPC validation findings (findings artifact still written — a failure
 *       artifact, not a crash)
 *   2 = usage / IO / JSON-parse error
 *
 * stdout is DATA ONLY (the `validate` findings JSON); every log/status/error line goes to
 * stderr. `<input.json|->` is read from the given file, or from stdin when the argument is
 * exactly `-`.
 *
 * `validate`/`project` import ONLY `../dist/canonical.js` and therefore NEVER boot a DOM —
 * `buildAmlFromArisAiDraft` (used by `project` to emit `model.aml.xml`) is a pure AML
 * serializer with no DOM dependency of its own. `render` is the ONLY subcommand that imports
 * `../dist/index.js` (the jsdom-backed headless render entry) — both dynamic imports are
 * relative to THIS file, so they resolve correctly regardless of the caller's working
 * directory.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EXIT_OK = 0
const EXIT_FINDINGS = 1
const EXIT_USAGE = 2

const USAGE =
  'Usage: epc-project <validate|project|render> <input.json|-> [--out <dir>] [--model <index>] [--version <id>]'

const KNOWN_OPTIONS = new Set(['--out', '--model', '--version'])

/** Parses argv into `{command, input, options}` or `{error}`. Never exits — pure. */
function parseArgs(argv) {
  const [command, input, ...rest] = argv
  if (!['validate', 'project', 'render'].includes(command)) {
    return { error: `Unknown or missing command: ${command ?? '(none)'}\n${USAGE}` }
  }
  if (!input) {
    return { error: `Missing <input.json|-> argument.\n${USAGE}` }
  }
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    const equalsIndex = token.indexOf('=')
    const key = equalsIndex === -1 ? token : token.slice(0, equalsIndex)
    if (!KNOWN_OPTIONS.has(key)) {
      return { error: `Unrecognized option: ${token}\n${USAGE}` }
    }
    let value = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1)
    if (value === undefined) {
      index += 1
      value = rest[index]
      if (value === undefined) return { error: `${key} requires a value.\n${USAGE}` }
    }
    options[key.slice(2)] = value
  }
  return { command, input, options }
}

/** `--model <index>` -> `{value}` | `{error}` | `{}` (flag absent). Never exits — pure. */
function parseModelIndex(rawValue) {
  if (rawValue === undefined) return {}
  if (!/^\d+$/.test(rawValue)) {
    return { error: `--model must be a non-negative integer, got "${rawValue}".` }
  }
  return { value: Number.parseInt(rawValue, 10) }
}

/** Formats `CanonicalParseIssue[]` as one `path: message [code]` line per issue, on stderr. */
function reportParseIssues(issues) {
  for (const issue of issues) {
    const path = issue.path.length ? issue.path.join('.') : '(root)'
    console.error(`${path}: ${issue.message} [${issue.code}]`)
  }
}

function narrativeMarkdown(narrative) {
  return `${narrative.en}\n\n---\n\n${narrative.ar}\n`
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2))
  if (parsedArgs.error) {
    console.error(parsedArgs.error)
    process.exitCode = EXIT_USAGE
    return
  }
  const { command, input, options } = parsedArgs

  if ((command === 'project' || command === 'render') && !options.out) {
    console.error(`${command} requires --out <dir>.\n${USAGE}`)
    process.exitCode = EXIT_USAGE
    return
  }

  let text
  try {
    text = input === '-' ? readFileSync(0, 'utf8') : readFileSync(input, 'utf8')
  } catch (error) {
    console.error(`Unable to read input "${input}": ${error.message}`)
    process.exitCode = EXIT_USAGE
    return
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    console.error(`Invalid JSON in "${input}": ${error.message}`)
    process.exitCode = EXIT_USAGE
    return
  }

  const {
    parseCanonicalProcess,
    projectCanonicalToDraft,
    validateProjectedDraft,
    buildProcessNarrative,
    buildAmlFromArisAiDraft
  } = await import('../dist/canonical.js')

  const parsedCanonical = parseCanonicalProcess(raw)
  if (!parsedCanonical.ok) {
    reportParseIssues(parsedCanonical.issues)
    process.exitCode = EXIT_USAGE
    return
  }
  const canonical = parsedCanonical.process

  if (command === 'validate') {
    const projection = projectCanonicalToDraft(canonical)
    const findings = await validateProjectedDraft(projection, canonical)
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`)
    process.exitCode = findings.ok ? EXIT_OK : EXIT_FINDINGS
    return
  }

  if (command === 'project') {
    const projection = projectCanonicalToDraft(canonical)
    const findings = await validateProjectedDraft(projection, canonical)
    const narrative = buildProcessNarrative(canonical)
    const aml = buildAmlFromArisAiDraft(projection.draft)
    mkdirSync(options.out, { recursive: true })
    writeJson(join(options.out, 'draft.json'), projection.draft)
    writeFileSync(join(options.out, 'model.aml.xml'), aml.xml)
    writeJson(join(options.out, 'findings.json'), findings)
    writeFileSync(join(options.out, 'narrative.md'), narrativeMarkdown(narrative))
    console.error(`epc-project: wrote ${findings.ok ? '' : 'failure '}artifacts to ${options.out}`)
    process.exitCode = findings.ok ? EXIT_OK : EXIT_FINDINGS
    return
  }

  // command === 'render'
  const modelIndex = parseModelIndex(options.model)
  if (modelIndex.error) {
    console.error(modelIndex.error)
    process.exitCode = EXIT_USAGE
    return
  }
  const { renderCanonicalProcess } = await import('../dist/index.js')
  const renderOptions = {}
  if (modelIndex.value !== undefined) renderOptions.modelIndex = modelIndex.value
  if (options.version !== undefined) renderOptions.sourceVersionId = options.version

  const result = await renderCanonicalProcess(canonical, renderOptions)

  if (!result.ok && result.reason === 'parse') {
    // Defensive: unreachable in practice, since `canonical` above already parsed cleanly.
    reportParseIssues(result.issues)
    process.exitCode = EXIT_USAGE
    return
  }

  mkdirSync(options.out, { recursive: true })
  if (!result.ok) {
    writeJson(join(options.out, 'findings.json'), result.findings)
    writeFileSync(
      join(options.out, 'narrative.md'),
      narrativeMarkdown(buildProcessNarrative(canonical))
    )
    console.error(`epc-project: wrote failure artifacts to ${options.out}`)
    process.exitCode = EXIT_FINDINGS
    return
  }

  writeFileSync(join(options.out, 'process.svg'), result.svg)
  writeJson(join(options.out, 'metadata.json'), result.metadata)
  writeJson(join(options.out, 'findings.json'), result.findings)
  writeFileSync(
    join(options.out, 'narrative.md'),
    narrativeMarkdown(buildProcessNarrative(canonical))
  )
  console.error(`epc-project: wrote artifacts to ${options.out}`)
  process.exitCode = EXIT_OK
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exitCode = EXIT_USAGE
})
