/**
 * Lane L-P13 — Create-from-PDF model A/B harness (EVALUATION ONLY).
 *
 * Drives the REAL v1 create-from-PDF pipeline (the exact production path the
 * Create surface builds: `buildArisAiPrompt` + `buildPdfInstruction` /
 * `buildImageInstruction` → `runArisAiGeneration` with real repair turns →
 * `buildAmlFromArisAiDraft`) against four models routed through OpenRouter, on
 * the AnimalWF register-owner reference PDF and its rendered PNG, and scores
 * each generated process against `register-owner.expected.json`.
 *
 * This changes NO product code. It reuses the production transport
 * (`makeBrowserCallLLM`) and the seq2 similarity metric verbatim, and adds a
 * small self-contained structural recall/precision scorer (the sibling
 * `structureCompare.ts` lane is not merged here).
 *
 * The plan assumed direct OpenAI/Anthropic keys; those are empty. All four
 * candidates are reached through the single OpenRouter key instead:
 *   - openai/gpt-5.6-terra                (OpenAI candidate)
 *   - anthropic/claude-opus-4.8           (Anthropic candidate)
 *   - google/gemini-3.5-flash-lite        (current baseline, native PDF)
 *   - qwen/qwen3-vl-235b-a22b-instruct    (image-only baseline)
 *
 * Cost discipline: OpenRouter is asked for authoritative `usage.cost` on every
 * request; the harness accumulates per-model spend and ABORTS a model's
 * remaining cells once it crosses the ceiling (default $2/model).
 *
 * Run:
 *   set -a; . ../reference/openrouter.env; set +a
 *   vite-node scripts/aris-pdf-model-ab.ts [--runs 2] [--max-cost-per-model 2]
 *     [--models google/gemini-3.5-flash-lite,anthropic/claude-opus-4.8,...]
 *     [--only-input pdf|png]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeBrowserCallLLM } from '../src/ai/browserAi'
import { estimateCostUsd, extractUsage } from '../src/ai/credits'
import { buildImageInstruction, buildPdfInstruction, type GenAttachment } from '../src/ai/pdf'
import { OPENROUTER_STRUCTURED_OUTPUT_MODELS } from '../src/ai/providersLite'
import type { ArisAiDraftV1 } from '../src/aris/ai/contract'
import { buildArisAiDraftJsonSchema } from '../src/aris/ai/draftJsonSchema'
import { buildArisAiPrompt } from '../src/aris/ai/promptBuilder'
import {
  seq2NameSimilarity,
  seq2SimilarityScore,
  seq2SummaryFromDraft,
  type Seq2ProcessSummary
} from '../src/aris/ai/createFromPdf.seq2.fixture'
import { buildAmlFromArisAiDraft } from '../src/aris/shell/arisAiCreate'
import {
  runArisAiGeneration,
  type ArisAiGenerationResult,
  type ArisAiSend
} from '../src/aris/shell/arisAiGeneration'

// The Create surface's per-request output cap for ATTACHMENT runs
// (ArisGenerationPanel MAX_ATTACHMENT_TOKENS).
const MAX_TOKENS = 16_000

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const REFERENCE_ROOT = resolve(REPO, '../reference/AnimalWF')
const PDF_PATH = join(REFERENCE_ROOT, 'pdf', 'Register_Animal_Owner_Profile_Draft03.pdf')
const PNG_PATH = join(REFERENCE_ROOT, 'png', 'Register_Animal_Owner_Profile_Draft03-1.png')
const EXPECTED_PATH = join(REFERENCE_ROOT, 'expected', 'register-owner.expected.json')
const OUT_DIR = join(REFERENCE_ROOT, 'gen-tests', 'runs', 'pdf-ab')
const REPORT_PATH = join(REFERENCE_ROOT, 'gen-tests', 'pdf-model-ab-report.md')

const HINT = 'Register Animal Owner Profile'
const MODEL_NAME = 'Request to Register Animal Owner Profile'

/** The candidate models, in report order, with whether they accept a native PDF. */
interface ModelSpec {
  readonly id: string
  readonly short: string
  readonly role: string
  /** qwen is image-only — the product's capability gate keeps a PDF off it. */
  readonly pdfCapable: boolean
}

const ALL_MODELS: readonly ModelSpec[] = [
  {
    id: 'google/gemini-3.5-flash-lite',
    short: 'gemini-3.5-flash-lite',
    role: 'baseline (native PDF)',
    pdfCapable: true
  },
  {
    id: 'qwen/qwen3-vl-235b-a22b-instruct',
    short: 'qwen3-vl-235b',
    role: 'image-only baseline',
    pdfCapable: false
  },
  {
    id: 'openai/gpt-5.6-terra',
    short: 'gpt-5.6-terra',
    role: 'OpenAI candidate',
    pdfCapable: true
  },
  {
    id: 'anthropic/claude-opus-4.8',
    short: 'claude-opus-4.8',
    role: 'Anthropic candidate',
    pdfCapable: true
  }
]

// --- expected oracle --------------------------------------------------------

interface ExpectedSpineEntry {
  readonly kind: string
  readonly nameEn: string
}

interface RegisterOwnerExpected {
  readonly counts: {
    readonly functions: number
    readonly events: number
    readonly rules: number
    readonly connections: number
  }
  readonly spine: readonly ExpectedSpineEntry[]
  readonly satellites: Readonly<Record<string, readonly unknown[]>>
}

function readExpected(): RegisterOwnerExpected {
  return JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as RegisterOwnerExpected
}

function expectedSummary(expected: RegisterOwnerExpected): Seq2ProcessSummary {
  const satelliteCount = Object.values(expected.satellites).reduce(
    (total, list) => total + list.length,
    0
  )
  return {
    functions: expected.counts.functions,
    events: expected.counts.events,
    rules: expected.counts.rules,
    satellites: satelliteCount,
    connections: expected.counts.connections,
    functionNames: expected.spine.filter((e) => e.kind === 'function').map((e) => e.nameEn),
    eventNames: expected.spine.filter((e) => e.kind === 'event').map((e) => e.nameEn)
  }
}

// --- structural scorer (self-contained; sibling structureCompare not merged) -

interface StructureScore {
  controlFlowRecall: number
  controlFlowPrecision: number
  satelliteRecall: number
  gatewayAccuracy: number
  connectionRatio: number
  labelSimilarityMean: number
  misses: { spine: string[]; satellites: string[] }
  hallucinated: string[]
}

const MATCH = 0.5

function bestSimilarity(name: string, candidates: readonly string[]): number {
  let best = 0
  for (const candidate of candidates) {
    const score = seq2NameSimilarity(name, candidate)
    if (score > best) best = score
  }
  return best
}

function countRatio(expected: number, actual: number): number {
  if (expected === 0 && actual === 0) return 1
  const larger = Math.max(expected, actual)
  return larger === 0 ? 1 : Math.min(expected, actual) / larger
}

function scoreStructure(expected: RegisterOwnerExpected, draft: ArisAiDraftV1): StructureScore {
  const draftByType = (type: string): ArisAiDraftV1['objects'] =>
    draft.objects.filter((o) => o.objectType === type)
  const draftFunctionNames = draftByType('OT_FUNC').map((o) => o.names.en ?? '')
  const draftEventNames = draftByType('OT_EVT').map((o) => o.names.en ?? '')
  const draftSpineNames = [...draftFunctionNames, ...draftEventNames].filter((n) => n.length > 0)
  const draftRules = draft.objects.filter((o) => o.objectType === 'OT_RULE').length
  const draftSatelliteNames = draft.objects
    .filter((o) => !['OT_FUNC', 'OT_EVT', 'OT_RULE'].includes(o.objectType))
    .map((o) => o.names.en ?? '')
    .filter((n) => n.length > 0)

  const expectedSpine = expected.spine
    .filter((e) => e.kind === 'function' || e.kind === 'event')
    .map((e) => e.nameEn)
  const expectedSatellites = Object.keys(expected.satellites)

  // Recall: expected spine steps recovered (fuzzy) in the draft spine.
  const spineMisses: string[] = []
  let spineHits = 0
  let simSum = 0
  for (const name of expectedSpine) {
    const sim = bestSimilarity(name, draftSpineNames)
    simSum += sim
    if (sim >= MATCH) spineHits += 1
    else spineMisses.push(name)
  }
  const controlFlowRecall = expectedSpine.length === 0 ? 1 : spineHits / expectedSpine.length
  const labelSimilarityMean = expectedSpine.length === 0 ? 1 : simSum / expectedSpine.length

  // Precision: draft spine steps that correspond to a real expected step
  // (everything else is a hallucinated / invented node).
  const hallucinated: string[] = []
  let precisionHits = 0
  for (const name of draftSpineNames) {
    if (bestSimilarity(name, expectedSpine) >= MATCH) precisionHits += 1
    else hallucinated.push(name)
  }
  const controlFlowPrecision =
    draftSpineNames.length === 0 ? 0 : precisionHits / draftSpineNames.length

  // Satellite recall: expected satellite carriers recovered anywhere in the draft.
  const satelliteMisses: string[] = []
  let satHits = 0
  const allDraftNames = [...draftSpineNames, ...draftSatelliteNames]
  for (const name of expectedSatellites) {
    if (bestSimilarity(name, allDraftNames) >= MATCH) satHits += 1
    else satelliteMisses.push(name)
  }
  const satelliteRecall = expectedSatellites.length === 0 ? 1 : satHits / expectedSatellites.length

  return {
    controlFlowRecall,
    controlFlowPrecision,
    satelliteRecall,
    gatewayAccuracy: countRatio(expected.counts.rules, draftRules),
    connectionRatio: countRatio(expected.counts.connections, draft.relations.length),
    labelSimilarityMean,
    misses: { spine: spineMisses, satellites: satelliteMisses },
    hallucinated
  }
}

// --- cost + latency capture (wraps the REAL fetch) --------------------------

interface CellCapture {
  requests: number
  costUsd: number
  everyRequestHadUsage: boolean
  modelId: string
}

let activeCapture: CellCapture | null = null
const realFetch = globalThis.fetch

const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await realFetch(input, init)
  const capture = activeCapture
  if (capture && String(input).startsWith('https://openrouter.ai/api/v1/chat/completions')) {
    capture.requests += 1
    try {
      const json = (await res.clone().json()) as unknown
      const usage = extractUsage('openrouter', json)
      if (!usage) {
        capture.everyRequestHadUsage = false
      } else {
        const cost =
          usage.providerCostUsd ??
          estimateCostUsd(capture.modelId, usage.inputTokens, usage.outputTokens)
        if (cost === null) capture.everyRequestHadUsage = false
        else capture.costUsd += cost
      }
    } catch {
      capture.everyRequestHadUsage = false
    }
  }
  return res
}
globalThis.fetch = wrappedFetch as typeof fetch

// --- send adapter (mirrors ArisGenerationPanel.buildSend / makeSeq2Send) ----

function makeSend(apiKey: string, modelId: string): ArisAiSend {
  const responseSchema = OPENROUTER_STRUCTURED_OUTPUT_MODELS.has(modelId)
    ? { name: 'aris_ai_draft_v1', schema: buildArisAiDraftJsonSchema() }
    : undefined
  return async (request, signal) => {
    const call = makeBrowserCallLLM(
      {
        providerId: 'openrouter',
        model: modelId,
        apiKey,
        title: 'OrbitPM ARIS Studio Lite (L-P13 PDF A/B harness)'
      },
      {
        ...(request.attachment ? { attachment: request.attachment } : {}),
        ...(responseSchema ? { responseSchema } : {}),
        signal
      }
    )
    const result = await call(
      request.messages.map((m) => ({ role: m.role, content: m.content })),
      { maxTokens: MAX_TOKENS }
    )
    return typeof result === 'string' ? result : JSON.stringify(result)
  }
}

// --- one cell ---------------------------------------------------------------

type InputKind = 'pdf' | 'png'

interface CellResult {
  modelId: string
  modelShort: string
  input: InputKind
  run: number
  ok: boolean
  reason?: string
  findings?: string[]
  similarity: number
  functionNameRecall: number
  eventNameRecall: number
  typeDistribution: number
  structure?: StructureScore
  amlObjectCount?: number
  amlRelationCount?: number
  draftCounts?: {
    functions: number
    events: number
    rules: number
    satellites: number
    relations: number
  }
  repairs: number
  requests: number
  latencyMs: number
  costUsd: number
  costMeasured: boolean
}

function buildAttachment(input: InputKind): GenAttachment {
  if (input === 'pdf') {
    const bytes = readFileSync(PDF_PATH)
    return {
      kind: 'pdf',
      base64: bytes.toString('base64'),
      mediaType: 'application/pdf',
      fileName: 'Register_Animal_Owner_Profile_Draft03.pdf',
      sizeBytes: bytes.byteLength
    }
  }
  const bytes = readFileSync(PNG_PATH)
  return {
    kind: 'image',
    base64: bytes.toString('base64'),
    mediaType: 'image/png',
    fileName: 'Register_Animal_Owner_Profile_Draft03-1.png',
    sizeBytes: bytes.byteLength
  }
}

function buildPrompt(input: InputKind): { system: string; user: string } {
  const description = input === 'pdf' ? buildPdfInstruction(HINT) : buildImageInstruction(HINT)
  return buildArisAiPrompt({ modelName: MODEL_NAME, modelType: 'auto-detect', description })
}

async function runCell(
  apiKey: string,
  model: ModelSpec,
  input: InputKind,
  run: number,
  expected: RegisterOwnerExpected,
  expSummary: Seq2ProcessSummary
): Promise<CellResult> {
  const capture: CellCapture = {
    requests: 0,
    costUsd: 0,
    everyRequestHadUsage: true,
    modelId: model.id
  }
  activeCapture = capture
  const started = Date.now()
  let result: ArisAiGenerationResult
  try {
    result = await runArisAiGeneration({
      ...buildPrompt(input),
      attachment: buildAttachment(input),
      send: makeSend(apiKey, model.id),
      signal: new AbortController().signal
    })
  } finally {
    activeCapture = null
  }
  const latencyMs = Date.now() - started

  const base: CellResult = {
    modelId: model.id,
    modelShort: model.short,
    input,
    run,
    ok: result.ok,
    similarity: 0,
    functionNameRecall: 0,
    eventNameRecall: 0,
    typeDistribution: 0,
    repairs: result.semanticAttemptsUsed,
    requests: capture.requests,
    latencyMs,
    costUsd: capture.costUsd,
    costMeasured: capture.requests > 0 && capture.everyRequestHadUsage
  }

  if (!result.ok) {
    return {
      ...base,
      reason: result.reason,
      findings: result.findings.slice(0, 8).map((f) => `${f.code}: ${f.message}`)
    }
  }

  const draft = result.draft
  const actual = seq2SummaryFromDraft(draft)
  const breakdown = seq2SimilarityScore(expSummary, actual)
  const structure = scoreStructure(expected, draft)
  const aml = buildAmlFromArisAiDraft(draft)

  return {
    ...base,
    similarity: breakdown.score,
    functionNameRecall: breakdown.functionNameRecall,
    eventNameRecall: breakdown.eventNameRecall,
    typeDistribution: breakdown.typeDistribution,
    structure,
    amlObjectCount: aml.objectCount,
    amlRelationCount: aml.relationCount,
    draftCounts: {
      functions: actual.functions,
      events: actual.events,
      rules: actual.rules,
      satellites: actual.satellites,
      relations: actual.connections
    }
  }
}

// --- arg parsing ------------------------------------------------------------

interface Args {
  runs: number
  maxCostPerModel: number
  models: readonly ModelSpec[]
  onlyInput: InputKind | null
}

function parseArgs(argv: readonly string[]): Args {
  let runs = 2
  let maxCostPerModel = 2
  let models = ALL_MODELS
  let onlyInput: InputKind | null = null
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--runs' && value) {
      runs = Math.max(1, Number(value))
      i += 1
    } else if (arg === '--max-cost-per-model' && value) {
      maxCostPerModel = Number(value)
      i += 1
    } else if (arg === '--models' && value) {
      const wanted = new Set(value.split(','))
      models = ALL_MODELS.filter((m) => wanted.has(m.id) || wanted.has(m.short))
      i += 1
    } else if (arg === '--only-input' && (value === 'pdf' || value === 'png')) {
      onlyInput = value
      i += 1
    }
  }
  return { runs, maxCostPerModel, models, onlyInput }
}

// --- report -----------------------------------------------------------------

function fmt(value: number, digits = 3): string {
  return value.toFixed(digits)
}

function buildReport(
  args: Args,
  cells: readonly CellResult[],
  totalSpend: number,
  aborted: readonly string[]
): string {
  const lines: string[] = []
  lines.push('# Create-from-PDF model A/B — evaluation report (Lane L-P13)')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString()} by \`scripts/aris-pdf-model-ab.ts\`.`)
  lines.push('')
  lines.push(
    'Pipeline: v1 single-shot create-from-PDF (the production Create surface path) — ' +
      '`buildArisAiPrompt` + `buildPdfInstruction`/`buildImageInstruction` → real ' +
      '`runArisAiGeneration` (validate + normalize + ≤3 repair turns) → `buildAmlFromArisAiDraft`. ' +
      'All four models routed through OpenRouter (direct OpenAI/Anthropic keys were empty). ' +
      'Native PDF rides as an OpenRouter `file` part (file-parser plugin); the PNG rides as an ' +
      '`image_url` part. Structured-output routes (gemini-flash-lite, qwen) get the enum-locked ' +
      '`json_schema`; the others get plain `json_object`.'
  )
  lines.push('')
  lines.push(
    'Oracle: `register-owner.expected.json` (14 functions / 22 events / 9 rules / 93 connections; 14 satellite carriers).'
  )
  lines.push('')
  lines.push('## Models')
  lines.push('')
  lines.push('| short | OpenRouter id | role | native PDF |')
  lines.push('| --- | --- | --- | --- |')
  for (const m of ALL_MODELS) {
    lines.push(
      `| ${m.short} | \`${m.id}\` | ${m.role} | ${m.pdfCapable ? 'yes' : 'no (image-only)'} |`
    )
  }
  lines.push('')

  // Per-cell table.
  lines.push('## Per-cell results (2 runs per cell for variance)')
  lines.push('')
  lines.push(
    '| model | input | run | ok | similarity | cfRecall | cfPrec | satRecall | gateAcc | connRatio | repairs | reqs | latency s | cost $ |'
  )
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  )
  for (const c of cells) {
    const s = c.structure
    lines.push(
      `| ${c.modelShort} | ${c.input} | ${c.run} | ${c.ok ? 'yes' : 'FAIL'} | ` +
        `${fmt(c.similarity)} | ${s ? fmt(s.controlFlowRecall) : '-'} | ${s ? fmt(s.controlFlowPrecision) : '-'} | ` +
        `${s ? fmt(s.satelliteRecall) : '-'} | ${s ? fmt(s.gatewayAccuracy) : '-'} | ${s ? fmt(s.connectionRatio) : '-'} | ` +
        `${c.repairs} | ${c.requests} | ${fmt(c.latencyMs / 1000, 1)} | ${c.costMeasured ? fmt(c.costUsd, 4) : '~' + fmt(c.costUsd, 4)} |`
    )
  }
  lines.push('')

  // Aggregates per model × input.
  lines.push('## Aggregates (mean over runs, per model × input)')
  lines.push('')
  lines.push(
    '| model | input | n | mean similarity | mean cfRecall | mean cfPrec | mean satRecall | mean gateAcc | mean latency s | mean cost $ |'
  )
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  const groups = new Map<string, CellResult[]>()
  for (const c of cells) {
    const key = `${c.modelShort}|${c.input}`
    const list = groups.get(key) ?? []
    list.push(c)
    groups.set(key, list)
  }
  const mean = (nums: number[]): number =>
    nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length
  for (const [key, list] of groups) {
    const [short, input] = key.split('|')
    const ok = list.filter((c) => c.ok)
    lines.push(
      `| ${short} | ${input} | ${list.length} | ${fmt(mean(ok.map((c) => c.similarity)))} | ` +
        `${fmt(mean(ok.map((c) => c.structure?.controlFlowRecall ?? 0)))} | ` +
        `${fmt(mean(ok.map((c) => c.structure?.controlFlowPrecision ?? 0)))} | ` +
        `${fmt(mean(ok.map((c) => c.structure?.satelliteRecall ?? 0)))} | ` +
        `${fmt(mean(ok.map((c) => c.structure?.gatewayAccuracy ?? 0)))} | ` +
        `${fmt(mean(list.map((c) => c.latencyMs / 1000)), 1)} | ${fmt(mean(list.map((c) => c.costUsd)), 4)} |`
    )
  }
  lines.push('')

  // Failure-mode examples per model.
  lines.push('## Failure-mode examples (per model)')
  lines.push('')
  for (const m of args.models) {
    const modelCells = cells.filter((c) => c.modelId === m.id)
    if (modelCells.length === 0) continue
    lines.push(`### ${m.short}`)
    lines.push('')
    const failed = modelCells.filter((c) => !c.ok)
    if (failed.length > 0) {
      for (const f of failed) {
        lines.push(
          `- **Pipeline failure** (${f.input} run ${f.run}): reason=\`${f.reason}\`; ` +
            `findings: ${(f.findings ?? []).slice(0, 3).join(' | ') || '(none captured)'}`
        )
      }
    }
    const best = modelCells
      .filter((c) => c.ok && c.structure)
      .sort((a, b) => b.similarity - a.similarity)[0]
    if (best?.structure) {
      const s = best.structure
      const missedSpine = s.misses.spine.slice(0, 5)
      const missedSat = s.misses.satellites.slice(0, 5)
      const hall = s.hallucinated.slice(0, 5)
      lines.push(
        `- **Missed control-flow steps** (${best.input} run ${best.run}, best cell): ${
          missedSpine.length ? missedSpine.map((n) => `"${n}"`).join('; ') : '(none)'
        }`
      )
      lines.push(
        `- **Missed satellites** (roles/systems/documents): ${
          missedSat.length ? missedSat.map((n) => `"${n}"`).join('; ') : '(none)'
        }`
      )
      lines.push(
        `- **Hallucinated / invented spine nodes** (no oracle match): ${
          hall.length ? hall.map((n) => `"${n}"`).join('; ') : '(none)'
        }`
      )
      if (best.draftCounts) {
        lines.push(
          `- **Operator/shape**: drew ${best.draftCounts.rules} rules vs 9 expected ` +
            `(gatewayAccuracy ${fmt(s.gatewayAccuracy, 2)}); ${best.draftCounts.relations} connections ` +
            `vs 93 expected (connRatio ${fmt(s.connectionRatio, 2)}).`
        )
      }
    }
    lines.push('')
  }

  // Recommendation.
  lines.push('## Recommendation')
  lines.push('')
  const perModel = new Map<string, { pdf: number[]; png: number[] }>()
  for (const c of cells) {
    if (!c.ok) continue
    const entry = perModel.get(c.modelShort) ?? { pdf: [], png: [] }
    entry[c.input].push(c.similarity)
    perModel.set(c.modelShort, entry)
  }
  const ranked = [...perModel.entries()]
    .map(([short, e]) => ({
      short,
      pdf: e.pdf.length ? e.pdf.reduce((a, b) => a + b, 0) / e.pdf.length : NaN,
      png: e.png.length ? e.png.reduce((a, b) => a + b, 0) / e.png.length : NaN,
      best: Math.max(
        e.pdf.length ? e.pdf.reduce((a, b) => a + b, 0) / e.pdf.length : 0,
        e.png.length ? e.png.reduce((a, b) => a + b, 0) / e.png.length : 0
      )
    }))
    .sort((a, b) => b.best - a.best)
  lines.push('Best mean similarity per model (PDF / PNG):')
  lines.push('')
  for (const r of ranked) {
    lines.push(
      `- **${r.short}** — PDF ${Number.isNaN(r.pdf) ? 'n/a' : fmt(r.pdf)}, PNG ${
        Number.isNaN(r.png) ? 'n/a' : fmt(r.png)
      }`
    )
  }
  lines.push('')
  if (ranked[0]) {
    lines.push(
      `**Winner:** \`${ranked[0].short}\` (best mean similarity ${fmt(ranked[0].best)}). ` +
        'See the aggregates table for control-flow recall, which is the load-bearing metric for ' +
        'faithfully redrawing a process.'
    )
  }
  lines.push('')
  lines.push('## Spend + budget')
  lines.push('')
  lines.push(`- Total OpenRouter spend this run: **$${fmt(totalSpend, 4)}**`)
  lines.push(`- Per-model ceiling: $${fmt(args.maxCostPerModel, 2)}`)
  lines.push(
    aborted.length
      ? `- Models aborted on the cost ceiling: ${aborted.join(', ')}`
      : '- No model was aborted on the cost ceiling.'
  )
  lines.push('')
  lines.push('## v2 (w10 coarse-to-fine) comparison')
  lines.push('')
  lines.push(
    'SECONDARY per the brief. See the harness stdout / the orchestrator note for whether the ' +
      'w10 `seq2v2` band-tiling pipeline was run for the strong models.'
  )
  lines.push('')
  return lines.join('\n')
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error(
      'OPENROUTER_API_KEY is not set. Source it: set -a; . ../reference/openrouter.env; set +a'
    )
    process.exitCode = 1
    return
  }
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(OUT_DIR, { recursive: true })
  const expected = readExpected()
  const expSummary = expectedSummary(expected)

  const cells: CellResult[] = []
  const spendByModel = new Map<string, number>()
  const aborted: string[] = []
  let totalSpend = 0

  for (const model of args.models) {
    const inputs: InputKind[] = model.pdfCapable ? ['pdf', 'png'] : ['png']
    const chosenInputs = args.onlyInput ? inputs.filter((i) => i === args.onlyInput) : inputs
    let modelSpend = 0
    let modelAborted = false
    for (const input of chosenInputs) {
      if (modelAborted) break
      for (let run = 1; run <= args.runs; run += 1) {
        if (modelSpend >= args.maxCostPerModel) {
          console.warn(
            `ABORT ${model.short}: cumulative $${modelSpend.toFixed(4)} >= ceiling $${args.maxCostPerModel} — skipping remaining cells`
          )
          if (!aborted.includes(model.short)) aborted.push(model.short)
          modelAborted = true
          break
        }
        console.warn(
          `RUN ${model.short} input=${input} run=${run} (model spend so far $${modelSpend.toFixed(4)})`
        )
        let result: CellResult
        try {
          result = await runCell(apiKey, model, input, run, expected, expSummary)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`  EXCEPTION ${model.short} ${input} run ${run}: ${message}`)
          result = {
            modelId: model.id,
            modelShort: model.short,
            input,
            run,
            ok: false,
            reason: 'exception',
            findings: [message],
            similarity: 0,
            functionNameRecall: 0,
            eventNameRecall: 0,
            typeDistribution: 0,
            repairs: 0,
            requests: 0,
            latencyMs: 0,
            costUsd: 0,
            costMeasured: false
          }
        }
        cells.push(result)
        modelSpend += result.costUsd
        totalSpend += result.costUsd
        writeFileSync(
          join(OUT_DIR, `${model.short}-${input}-run${run}.json`),
          JSON.stringify(result, null, 2)
        )
        console.warn(
          `  ${model.short} ${input} run${run}: ok=${result.ok} similarity=${result.similarity.toFixed(3)} ` +
            `cfRecall=${result.structure ? result.structure.controlFlowRecall.toFixed(3) : '-'} ` +
            `repairs=${result.repairs} reqs=${result.requests} latency=${(result.latencyMs / 1000).toFixed(1)}s ` +
            `cost=$${result.costUsd.toFixed(4)}${result.costMeasured ? '' : ' (est)'}`
        )
      }
    }
    spendByModel.set(model.short, modelSpend)
  }

  const report = buildReport(args, cells, totalSpend, aborted)
  writeFileSync(REPORT_PATH, report)
  writeFileSync(join(OUT_DIR, 'all-cells.json'), JSON.stringify(cells, null, 2))
  console.warn('')
  console.warn(`WROTE report: ${REPORT_PATH}`)
  console.warn(`WROTE per-cell JSON: ${OUT_DIR}`)
  console.warn(`TOTAL SPEND: $${totalSpend.toFixed(4)}`)
  for (const [short, spend] of spendByModel) {
    console.warn(`  ${short}: $${spend.toFixed(4)}`)
  }
  console.warn('===REPORT-BEGIN===')
  console.warn(report)
  console.warn('===REPORT-END===')
}

void main()
