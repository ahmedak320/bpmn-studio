/**
 * ARIS "create from description" fidelity eval harness — Wave 13, lane
 * P11-runner (plan lines 736-767, sub-lane P11-runner).
 *
 * Drives the REAL production pipeline end to end:
 *
 *   buildArisAiPrompt (name = process title, description = file text)
 *     -> runArisAiGeneration (real validate/normalize/EPC-semantics + up to 3
 *        repair turns)
 *     -> buildAmlFromArisAiDraft (deterministic one-column AML)
 *     -> createArisXmlSourcePackage + buildFromSource (real AML parse)
 *     -> compareStructure vs the hand-authored `<process>.expected.json`
 *        oracle (+ an optional per-description facts manifest for
 *        `relativeRecall`)
 *
 * Only the TRANSPORT is swappable:
 *  - Live (default): a Node `fetch` adapter to
 *    `https://openrouter.ai/api/v1/chat/completions`, built with the exact
 *    same pure request builder the app itself uses
 *    (`buildOpenRouterRequest`/`extractText`/`extractUsage` from
 *    `src/ai/browserAi.ts` + `src/ai/credits.ts` — no product code is
 *    duplicated). `OPENROUTER_API_KEY` is read from `../reference/openrouter.env`.
 *    A persisted per-round cost ledger aborts BEFORE sending a request once
 *    the round's cumulative spend is at/over the ceiling (`$5` by default,
 *    `ARIS_EVAL_MAX_COST_USD` env override), and is updated after every
 *    accounted request so the guard holds across separate invocations of this
 *    script for the same `--rounds-tag`.
 *  - `--mock <draftFile>`: NO network call. `<draftFile>` holds the raw model
 *    RESPONSE TEXT (a strict-JSON `ArisAiDraftV1`, exactly as a provider would
 *    have returned it) and is replayed verbatim as attempt 1's "response" —
 *    so `runArisAiGeneration`'s parse/validate/normalize/EPC-semantics steps
 *    all still run for real against it. This is how this lane proves the
 *    pipeline without any live API call (see createFromPdf.seq2.test.ts's
 *    "Mode 1" for the same mocked-transport/real-everything-else precedent).
 *
 * Usage:
 *   npx vite-node scripts/aris-description-eval.ts --desc <file> --process <key> \
 *     [--model z-ai/glm-5.2] [--rounds-tag rN] [--out <json>] [--mock <draftFile>]
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildArisAiPrompt } from '../src/aris/ai/promptBuilder'
import {
  runArisAiGeneration,
  type ArisAiGenerationRequest,
  type ArisAiSend
} from '../src/aris/shell/arisAiGeneration'
import { arisIdForLogicalId, buildAmlFromArisAiDraft } from '../src/aris/shell/arisAiCreate'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'
import { buildFromSource } from '../src/aris/model/buildFromSource'
import { loadExpectation } from '../src/aris/fidelity/loadExpectation'
import {
  compareStructure,
  type StructureFactsManifest,
  type StructureScore
} from '../src/aris/fidelity/structureCompare'
import { buildOpenRouterRequest, extractText } from '../src/ai/browserAi'
import { estimateCostUsd, extractUsage } from '../src/ai/credits'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const REFERENCE_DIR = resolve(REPO, '../reference')
const OPENROUTER_ENV_PATH = resolve(REFERENCE_DIR, 'openrouter.env')
const GEN_TESTS_DIR = resolve(REFERENCE_DIR, 'AnimalWF/gen-tests')

const DEFAULT_MODEL = 'z-ai/glm-5.2'
const DEFAULT_ROUNDS_TAG = 'adhoc'
const DEFAULT_MAX_COST_USD = 5
const MAX_TOKENS = 16_000

// --- CLI -----------------------------------------------------------------------

interface CliArgs {
  readonly desc?: string
  readonly process: string
  readonly model: string
  readonly roundsTag: string
  readonly out?: string
  readonly mock?: string
}

function parseArgs(argv: readonly string[]): CliArgs {
  const map = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      map.set(key, 'true')
    } else {
      map.set(key, next)
      i += 1
    }
  }
  const processKey = map.get('process')
  if (!processKey) fail('--process <key> is required')
  return {
    desc: map.get('desc'),
    process: processKey,
    model: map.get('model') ?? DEFAULT_MODEL,
    roundsTag: map.get('rounds-tag') ?? DEFAULT_ROUNDS_TAG,
    out: map.get('out'),
    mock: map.get('mock')
  }
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

// --- .env (bash-sourceable KEY=value, matching the plan's `set -a; . file; set +a`) ---

function loadEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {}
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return result
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

// --- per-round persisted cost ledger --------------------------------------------

interface CostLedger {
  cumulativeUsd: number
}

function ledgerPath(roundDir: string): string {
  return join(roundDir, '.cost-ledger.json')
}

function readLedger(roundDir: string): CostLedger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(roundDir), 'utf-8')) as Partial<CostLedger>
    return { cumulativeUsd: typeof parsed.cumulativeUsd === 'number' ? parsed.cumulativeUsd : 0 }
  } catch {
    return { cumulativeUsd: 0 }
  }
}

function writeLedger(roundDir: string, ledger: CostLedger): void {
  try {
    mkdirSync(roundDir, { recursive: true })
    writeFileSync(ledgerPath(roundDir), JSON.stringify(ledger, null, 2))
  } catch {
    // Best-effort only — a persistence failure must not crash the eval run.
  }
}

// --- OpenRouter Node transport (pure request/response helpers, real fetch) -----

interface SimpleMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

async function callOpenRouter(
  apiKey: string,
  modelId: string,
  messages: readonly SimpleMessage[]
): Promise<{ text: string; usage: ReturnType<typeof extractUsage> }> {
  const built = buildOpenRouterRequest(
    {
      providerId: 'openrouter',
      model: modelId,
      apiKey,
      title: 'OrbitPM ARIS Studio Lite (P11 eval)'
    },
    [...messages],
    { maxTokens: MAX_TOKENS, jsonMode: true }
  )
  const response = await fetch(built.url, {
    method: 'POST',
    headers: built.headers,
    body: JSON.stringify(built.body)
  })
  if (!response.ok) {
    throw new Error(`OpenRouter request failed: HTTP ${response.status}`)
  }
  const json: unknown = await response.json()
  return { text: extractText('openrouter', json), usage: extractUsage('openrouter', json) }
}

// --- description-file naming convention (gen-tests/descriptions/<process>/<level>-<lang>[.humanized].md) ---

function levelLangFromDescPath(descPath: string): string {
  return basename(descPath)
    .replace(/\.humanized\.md$/, '')
    .replace(/\.md$/, '')
}

/** Sibling `<level>-<lang>.manifest.json` next to the description file, if present. */
function tryLoadManifest(descPath: string | undefined): StructureFactsManifest | undefined {
  if (!descPath) return undefined
  const manifestPath = join(dirname(descPath), `${levelLangFromDescPath(descPath)}.manifest.json`)
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      objects?: unknown
      connections?: unknown
    }
    const objects = Array.isArray(parsed.objects)
      ? parsed.objects.filter((entry): entry is string => typeof entry === 'string')
      : []
    const connections = Array.isArray(parsed.connections)
      ? parsed.connections.filter(
          (entry): entry is [string, string] =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === 'string' &&
            typeof entry[1] === 'string'
        )
      : []
    return { objects, connections }
  } catch {
    return undefined
  }
}

// --- round report (markdown) ----------------------------------------------------

const REPORT_COLUMNS = [
  'process',
  'levelLang',
  'controlFlowRecall',
  'controlFlowPrecision',
  'connectionRecall',
  'connectionPrecision',
  'satelliteRecall',
  'gatewayAccuracy',
  'labelSimilarityMean',
  'relativeRecall'
] as const

function appendMarkdownRow(
  roundDir: string,
  row: { readonly process: string; readonly levelLang: string; readonly score: StructureScore }
): void {
  mkdirSync(roundDir, { recursive: true })
  const reportPath = join(roundDir, 'report.md')
  if (!existsSync(reportPath)) {
    writeFileSync(
      reportPath,
      `| ${REPORT_COLUMNS.join(' | ')} |\n| ${REPORT_COLUMNS.map(() => '---').join(' | ')} |\n`
    )
  }
  const fmt = (value: number | undefined): string => (value === undefined ? '-' : value.toFixed(3))
  const s = row.score
  const cells = [
    row.process,
    row.levelLang,
    fmt(s.controlFlowRecall),
    fmt(s.controlFlowPrecision),
    fmt(s.connectionRecall),
    fmt(s.connectionPrecision),
    fmt(s.satelliteRecall),
    fmt(s.gatewayAccuracy),
    fmt(s.labelSimilarityMean),
    fmt(s.relativeRecall)
  ]
  appendFileSync(reportPath, `| ${cells.join(' | ')} |\n`)
}

// --- main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.desc && !args.mock) fail('either --desc <file> or --mock <draftFile> is required')

  const expected = (() => {
    try {
      return loadExpectation(args.process)
    } catch (error) {
      return fail(
        `could not load ../reference/AnimalWF/expected/${args.process}.expected.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  })()

  const descriptionText = args.desc
    ? readFileSync(args.desc, 'utf-8')
    : '(mock run — no --desc file provided)'
  const prompt = buildArisAiPrompt({
    modelName: expected.nameEn,
    modelType: 'auto-detect',
    description: descriptionText
  })

  const roundDir = join(GEN_TESTS_DIR, 'runs', args.roundsTag)
  const levelLang = args.desc ? levelLangFromDescPath(args.desc) : 'mock'

  let send: ArisAiSend
  let costNote: string

  if (args.mock) {
    const mockResponseText = readFileSync(args.mock, 'utf-8')
    send = async () => mockResponseText
    costNote = 'mock transport — no network call, $0.00'
  } else {
    const apiKey = loadEnvFile(OPENROUTER_ENV_PATH).OPENROUTER_API_KEY
    if (!apiKey) {
      fail(
        `OPENROUTER_API_KEY not found in ${OPENROUTER_ENV_PATH} (required for a live run; pass --mock <draftFile> for an offline proof)`
      )
    }
    const maxCostUsd = Number(process.env.ARIS_EVAL_MAX_COST_USD ?? String(DEFAULT_MAX_COST_USD))
    const ledger = readLedger(roundDir)
    if (ledger.cumulativeUsd >= maxCostUsd) {
      fail(
        `Cost guard: round "${args.roundsTag}" is already at $${ledger.cumulativeUsd.toFixed(2)} >= ceiling $${maxCostUsd} — aborting before any request`
      )
    }
    let cumulativeUsd = ledger.cumulativeUsd
    const modelId = args.model
    send = async (request: ArisAiGenerationRequest) => {
      const { text, usage } = await callOpenRouter(
        apiKey,
        modelId,
        request.messages.map((message) => ({ role: message.role, content: message.content }))
      )
      if (usage) {
        const cost =
          usage.providerCostUsd ??
          estimateCostUsd(modelId, usage.inputTokens, usage.outputTokens) ??
          0
        cumulativeUsd += cost
        writeLedger(roundDir, { cumulativeUsd })
        if (cumulativeUsd > maxCostUsd) {
          throw new Error(
            `Cost guard exceeded mid-round: cumulative $${cumulativeUsd.toFixed(2)} > ceiling $${maxCostUsd} — aborting further repair turns`
          )
        }
      }
      return text
    }
    costNote = `live — cumulative round cost so far: $${ledger.cumulativeUsd.toFixed(2)} (ceiling $${maxCostUsd})`
  }

  console.log(`=== aris-description-eval: ${args.process} (${levelLang}) ===`)
  console.log(`model: ${args.mock ? '(mock)' : args.model} — ${costNote}`)

  const result = await runArisAiGeneration({
    system: prompt.system,
    user: prompt.user,
    send,
    signal: new AbortController().signal
  })

  const outPath = args.out ?? join(roundDir, `${args.process}-${levelLang}.json`)
  mkdirSync(dirname(outPath), { recursive: true })

  if (!result.ok) {
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ok: false,
          process: args.process,
          levelLang,
          model: args.mock ? 'mock' : args.model,
          reason: result.reason,
          findings: result.findings,
          semanticAttemptsUsed: result.semanticAttemptsUsed,
          requestsSent: result.requestsSent
        },
        null,
        2
      )
    )
    console.error(
      `FAILED: ${result.reason} (semantic attempts used: ${result.semanticAttemptsUsed})`
    )
    for (const finding of result.findings) console.error(`  - [${finding.code}] ${finding.message}`)
    process.exitCode = 1
    return
  }

  const amlResult = buildAmlFromArisAiDraft(result.draft, { modelNameFallback: expected.nameEn })
  const sourcePackage = await createArisXmlSourcePackage({
    name: `${args.process}.aml`,
    relPath: null,
    bytes: new TextEncoder().encode(amlResult.xml)
  })
  const document = buildFromSource(sourcePackage.index)

  const firstModel = result.draft.models[0]
  if (!firstModel) fail('the generated draft declared zero models — nothing to compare')
  const modelId = arisIdForLogicalId('Model', firstModel.logicalId)

  const manifest = tryLoadManifest(args.desc)
  const score = compareStructure(document, modelId, expected, manifest ? { manifest } : {})

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ok: true,
        process: args.process,
        levelLang,
        model: args.mock ? 'mock' : args.model,
        generatedAt: new Date().toISOString(),
        semanticAttemptsUsed: result.semanticAttemptsUsed,
        requestsSent: result.requestsSent,
        warnings: result.warnings,
        draftCounts: {
          models: amlResult.modelCount,
          objects: amlResult.objectCount,
          relations: amlResult.relationCount,
          uncertainties: amlResult.uncertaintyCount
        },
        score,
        manifestApplied: manifest !== undefined
      },
      null,
      2
    )
  )
  appendMarkdownRow(roundDir, { process: args.process, levelLang, score })

  console.log('--- StructureScore ---')
  console.log(JSON.stringify(score, null, 2))
  console.log(`Wrote: ${outPath}`)
}

main().catch((error: unknown) => {
  console.error('ERROR:', error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
