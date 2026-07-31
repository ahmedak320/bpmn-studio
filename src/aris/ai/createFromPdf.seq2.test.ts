/**
 * Wave 7 — Test Sequence 2: create-from-PDF (AI) harness.
 *
 * "Use the create-from-PDF feature (put in the original PDF) and see if it
 * creates the same drawing (visually or by XML)." The feature is AI-driven and
 * non-deterministic, so this harness has two modes:
 *
 * ## Mode 1 — MOCKED (deterministic, CI-safe)
 *
 * Drives the REAL create-from-PDF pipeline end to end with only the network
 * mocked: `buildPdfInstruction` + `buildArisAiPrompt` (the exact prompt the
 * Create surface builds) → `runArisAiGeneration` (§16.6 steps 3–10: bounded
 * parse, draft validation, EPC semantics, repair turns) →
 * `buildAmlFromArisAiDraft` (steps 11–14: id allocation, geometry, canonical
 * AML). The transport is the production `makeBrowserCallLLM` adapter with
 * `fetch` stubbed to replay the RECORDED OpenRouter response in
 * `createFromPdf.seq2.fixture.ts` — so request building (PDF `file` part,
 * file-parser plugin, JSON mode), bounded body reading, and response-text
 * extraction all run for real. This tests the PLUMBING deterministically,
 * not live LLM quality.
 *
 * ## Transport seam — no production change was needed
 *
 * The injection seam already exists, so `src/ai/browserAi.ts` is UNTOUCHED:
 * `runArisAiGeneration` takes an injected `send` (`ArisAiSend`), and the
 * `send` adapter below mirrors `ArisGenerationPanel.buildSend` one-for-one
 * (same `makeBrowserCallLLM` call, same message mapping, same 8,000 max
 * tokens). The only test double is `fetch` itself, stubbed via
 * `vi.stubGlobal` — production behavior is identical by construction.
 *
 * ## Mode 2 — LIVE (env-gated, non-deterministic)
 *
 * The last test calls OpenRouter with model `z-ai/glm-5.2` (the app's
 * default OpenRouter model id, per providersLite.ts) on the AnimalWF
 * register-owner reference PDF and fuzzy-compares the generated process to
 * the original's expected summary. It is gated on `OPENROUTER_API_KEY` by an
 * early return INSIDE the test body — no skip API — so it passes (with a
 * logged hint) when the key is absent and runs for real when it is present.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeBrowserCallLLM } from '../../ai/browserAi'
import { estimateCostUsd, extractUsage } from '../../ai/credits'
import { buildImageInstruction, buildPdfInstruction, type GenAttachment } from '../../ai/pdf'
import {
  OPENROUTER_STRUCTURED_OUTPUT_MODELS,
  getLiteModelCapabilities
} from '../../ai/providersLite'
import { buildAmlFromArisAiDraft } from '../shell/arisAiCreate'
import {
  runArisAiGeneration,
  type ArisAiGenerationResult,
  type ArisAiSend
} from '../shell/arisAiGeneration'
import { ARIS_AI_SUPPORTED_CONNECTION_TYPES } from './typeValidation'
import { buildArisAiDraftJsonSchema } from './draftJsonSchema'
import { validateArisAiDraftEpcSemantics } from './epcSemantics'
import { buildArisAiPrompt } from './promptBuilder'
import { validateArisAiDraft } from './validateDraft'
import {
  SEQ2_LIVE_MAX_COST_USD,
  SEQ2_LIVE_SOFT_TARGET,
  SEQ2_OPENROUTER_MODEL_ID,
  SEQ2_RECORDED_DRAFT,
  SEQ2_VISION_MODEL_ID,
  buildSeq2OpenRouterBody,
  buildSeq2RecordedOpenRouterBody,
  seq2NameSimilarity,
  seq2SimilarityScore,
  seq2SummaryFromDraft,
  type Seq2ProcessSummary
} from './createFromPdf.seq2.fixture'

// The Create surface's per-request output cap for ATTACHMENT runs
// (ArisGenerationPanel MAX_ATTACHMENT_TOKENS, Wave 8 M6 — raised 8k → 16k so a
// full-fidelity register draft never truncates into a fake semantic failure).
const SEQ2_MAX_TOKENS = 16_000

/** A fetch call captured by the stub, with the decoded JSON request body. */
interface CapturedRequest {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: Record<string, unknown>
}

/**
 * Stub global `fetch` to replay the given provider response bodies (one per
 * call, last one repeating). Every call is captured for request-shape
 * assertions.
 */
function stubFetchReplaying(payloads: readonly unknown[]): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  vi.stubGlobal(
    'fetch',
    async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
      const payload = payloads[Math.min(calls.length, payloads.length - 1)]
      calls.push({
        url: String(input),
        headers: init?.headers ?? {},
        body: (typeof init?.body === 'string' ? JSON.parse(init.body) : {}) as Record<
          string,
          unknown
        >
      })
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } })
    }
  )
  return { calls }
}

/** A minimal PDF-shaped attachment; the transport never inspects the bytes. */
const SEQ2_MOCK_ATTACHMENT: GenAttachment = {
  kind: 'pdf',
  base64: Buffer.from('%PDF-1.4\n% Seq-2 mocked-transport placeholder bytes\n').toString('base64'),
  mediaType: 'application/pdf',
  fileName: 'Register_Animal_Owner_Profile_Draft03.pdf',
  sizeBytes: 48
}

/**
 * The `send` adapter — a one-for-one mirror of `ArisGenerationPanel.buildSend`
 * (the production wiring), minus the UI-only `callProvider` test hook. The
 * model is a parameter so a live arm can select gemini/qwen; the enum-locked
 * json_schema (M5) is attached exactly as the panel does, for structured-output
 * routes, on EVERY attempt (the retained `makeBrowserCallLLM` threads it).
 */
function makeSeq2Send(apiKey: string, modelId: string = SEQ2_OPENROUTER_MODEL_ID): ArisAiSend {
  const responseSchema = OPENROUTER_STRUCTURED_OUTPUT_MODELS.has(modelId)
    ? { name: 'aris_ai_draft_v1', schema: buildArisAiDraftJsonSchema() }
    : undefined
  return async (request, signal) => {
    const call = makeBrowserCallLLM(
      {
        providerId: 'openrouter',
        model: modelId,
        apiKey,
        title: 'OrbitPM ARIS Studio Lite (Seq-2 harness)'
      },
      {
        ...(request.attachment ? { attachment: request.attachment } : {}),
        ...(responseSchema ? { responseSchema } : {}),
        signal
      }
    )
    const result = await call(
      request.messages.map((message) => ({ role: message.role, content: message.content })),
      { maxTokens: SEQ2_MAX_TOKENS }
    )
    return typeof result === 'string' ? result : JSON.stringify(result)
  }
}

/** The prompt exactly as the Create surface builds it for a PDF attachment. */
function buildSeq2Prompt(): { system: string; user: string } {
  return buildArisAiPrompt({
    modelName: 'Request to Register Animal Owner Profile',
    modelType: 'auto-detect',
    description: buildPdfInstruction('Register Animal Owner Profile')
  })
}

/** The prompt exactly as the Create surface's picture path builds it. */
function buildSeq2ImagePrompt(): { system: string; user: string } {
  return buildArisAiPrompt({
    modelName: 'Request to Register Animal Owner Profile',
    modelType: 'auto-detect',
    description: buildImageInstruction('Register Animal Owner Profile')
  })
}

function runSeq2Generation(
  send: ArisAiSend,
  attachment: GenAttachment,
  onRepairTurn?: (attemptNumber: number) => void,
  prompt: { system: string; user: string } = buildSeq2Prompt()
): Promise<ArisAiGenerationResult> {
  return runArisAiGeneration({
    system: prompt.system,
    user: prompt.user,
    attachment,
    send,
    signal: new AbortController().signal,
    ...(onRepairTurn ? { onRepairTurn } : {})
  })
}

function countObjectsByType(type: string): number {
  return SEQ2_RECORDED_DRAFT.objects.filter((object) => object.objectType === type).length
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Wave 7 Seq-2 — create-from-PDF pipeline (mocked transport)', () => {
  it('replays the recorded provider response through transport → parse → validate → apply → AML', async () => {
    const { calls } = stubFetchReplaying([buildSeq2RecordedOpenRouterBody()])

    const result = await runSeq2Generation(makeSeq2Send('seq2-mocked-key'), SEQ2_MOCK_ATTACHMENT)

    // --- transport: exactly one physical request, built for real ------------
    expect(calls).toHaveLength(1)
    const request = calls[0]
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(request.headers.authorization).toBe('Bearer seq2-mocked-key')
    expect(request.body.model).toBe(SEQ2_OPENROUTER_MODEL_ID)
    // glm-5.2 is not a structured-output route → plain json_object (M5); the
    // attachment budget is 16k (M6); usage accounting is always requested (M5).
    expect(request.body.response_format).toEqual({ type: 'json_object' })
    expect(request.body.max_tokens).toBe(SEQ2_MAX_TOKENS)
    expect(request.body.usage).toEqual({ include: true })
    // The PDF rides as a provider-native file part with the file-parser plugin.
    expect(request.body.plugins).toEqual([{ id: 'file-parser' }])
    const messages = request.body.messages as Array<{ role: string; content: unknown }>
    expect(messages[0].role).toBe('system')
    expect(typeof messages[0].content).toBe('string')
    expect(messages[1].role).toBe('user')
    const firstUserContent = messages[1].content as Array<Record<string, unknown>>
    expect(Array.isArray(firstUserContent)).toBe(true)
    expect(firstUserContent[0].type).toBe('text')
    expect(String(firstUserContent[0].text)).toContain('Register Animal Owner Profile')
    expect(firstUserContent[1]).toEqual({
      type: 'file',
      file: {
        filename: SEQ2_MOCK_ATTACHMENT.fileName,
        file_data: `data:application/pdf;base64,${SEQ2_MOCK_ATTACHMENT.base64}`
      }
    })

    // --- generation loop: valid draft on the first attempt ------------------
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.requestsSent).toBe(1)
    expect(result.semanticAttemptsUsed).toBe(0)
    expect(result.warnings).toHaveLength(0)

    // The parsed draft round-trips the recorded JSON byte-for-byte.
    expect(result.draft).toEqual(SEQ2_RECORDED_DRAFT)

    // --- the draft is a well-formed ARIS process of the right shape ---------
    expect(countObjectsByType('OT_EVT')).toBe(11)
    expect(countObjectsByType('OT_FUNC')).toBe(7)
    expect(countObjectsByType('OT_RULE')).toBe(3)
    // Satellites: Pet Owner, TAMM, UAE Pass, lease document, registration number.
    expect(
      SEQ2_RECORDED_DRAFT.objects.length -
        countObjectsByType('OT_EVT') -
        countObjectsByType('OT_FUNC') -
        countObjectsByType('OT_RULE')
    ).toBe(5)
    expect(SEQ2_RECORDED_DRAFT.relations).toHaveLength(27)
    for (const object of SEQ2_RECORDED_DRAFT.objects) {
      if (object.objectType === 'OT_RULE') expect(object.symbolType).toBe('ST_OPR_XOR_1')
    }

    // Re-run the public validators on the pipeline output: steps 7+8…
    const revalidation = validateArisAiDraft(JSON.parse(JSON.stringify(result.draft)))
    expect(revalidation.ok).toBe(true)
    // …and step 9 (EPC semantics): no errors, no warnings.
    const semantics = validateArisAiDraftEpcSemantics(result.draft)
    expect(semantics.errors).toHaveLength(0)
    expect(semantics.warnings).toHaveLength(0)

    // --- apply → model: canonical AML with allocated ids + geometry ---------
    const aml = buildAmlFromArisAiDraft(result.draft)
    expect(aml.modelCount).toBe(1)
    expect(aml.objectCount).toBe(26)
    expect(aml.relationCount).toBe(27)
    expect(aml.uncertaintyCount).toBe(2)
    expect(aml.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(aml.xml).toContain('<AML>')
    expect(aml.xml).toContain('<Group Group.ID="Group.Root">')
    expect(aml.xml).toContain('Model.ID="Model.model-main"')
    expect(aml.xml).toContain('Model.Type="MT_EEPC"')
    expect(aml.xml).toContain('ObjDef.ID="ObjDef.func-login"')
    expect(aml.xml).toContain('TypeNum="OT_FUNC"')
    expect(aml.xml).toContain('ObjDef.ID="ObjDef.evt-trigger"')
    expect(aml.xml).toContain('CxnDef.ID="CxnDef.rel-trigger-login"')
    expect(aml.xml).toContain('Type="CT_ACTIV_1"')
    expect(aml.xml).toContain('ObjOcc.ID="ObjOcc.func-login"')
    expect(aml.xml).toContain('CxnOcc.ID="CxnOcc.rel-trigger-login"')
    expect(aml.xml).toContain('Login to TAMM portal and select the Pet Owner Registration Service')
  })

  it('sends a text-only repair turn (attachment never resent) when the first response is invalid', async () => {
    const { calls } = stubFetchReplaying([
      // A well-formed provider envelope whose CONTENT is unusable prose — a
      // semantic failure ('response-not-json'), not a transport one.
      buildSeq2OpenRouterBody(
        'The document describes a registration process, but I could not format it as JSON.'
      ),
      buildSeq2RecordedOpenRouterBody()
    ])
    const repairTurns: number[] = []

    const result = await runSeq2Generation(
      makeSeq2Send('seq2-mocked-key'),
      SEQ2_MOCK_ATTACHMENT,
      (attemptNumber) => repairTurns.push(attemptNumber)
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.requestsSent).toBe(2)
    expect(result.semanticAttemptsUsed).toBe(1)
    expect(repairTurns).toEqual([1])
    expect(result.draft).toEqual(SEQ2_RECORDED_DRAFT)

    // The repair request carries the conversation but NO attachment: every
    // message content is a plain string and the file-parser plugin is gone
    // (§16.6 step 5 — the PDF is uploaded on the first attempt only).
    expect(calls).toHaveLength(2)
    const repairBody = calls[1].body
    const repairMessages = repairBody.messages as Array<{ role: string; content: unknown }>
    expect(repairMessages).toHaveLength(4)
    for (const message of repairMessages) {
      expect(typeof message.content).toBe('string')
    }
    expect(repairBody.plugins).toBeUndefined()
    // The repair turn keeps the same transport shape: json_object for glm-5.2,
    // usage accounting requested (M5).
    expect(repairBody.response_format).toEqual({ type: 'json_object' })
    expect(repairBody.usage).toEqual({ include: true })
    const repairPrompt = String(repairMessages[repairMessages.length - 1].content)
    expect(repairPrompt).toContain('Repair turn 1 of 3')
    expect(repairPrompt).toContain('response-not-json')
  })

  it('keeps the recorded fixture valid and the fuzzy scorers honest', () => {
    // Fixture rot guard: the recorded draft must always pass the real validator.
    const validation = validateArisAiDraft(JSON.parse(JSON.stringify(SEQ2_RECORDED_DRAFT)))
    expect(validation.ok).toBe(true)

    // Scorer sanity: identical names score 1, disjoint names score 0, and a
    // paraphrase ("lease/ deed contract" → "lease contract") still matches.
    expect(
      seq2NameSimilarity(
        'Upload copy of lease/ deed contract',
        'Upload copy of lease/ deed contract'
      )
    ).toBe(1)
    expect(seq2NameSimilarity('Login to TAMM portal', 'System checks the business')).toBe(0)

    const summary = seq2SummaryFromDraft(SEQ2_RECORDED_DRAFT)
    expect(summary).toMatchObject({
      functions: 7,
      events: 11,
      rules: 3,
      satellites: 5,
      connections: 27
    })
    const selfScore = seq2SimilarityScore(summary, summary)
    expect(selfScore.score).toBe(1)
    expect(selfScore.functionNameRecall).toBe(1)
    expect(selfScore.eventNameRecall).toBe(1)
  })

  it('sends the enum-locked json_schema request shape for structured-output vision models', async () => {
    // A literal structured-output route id (NOT the env-dependent const) so the
    // mocked test is deterministic regardless of SEQ2_VISION_MODEL.
    const { calls } = stubFetchReplaying([buildSeq2RecordedOpenRouterBody()])
    const result = await runSeq2Generation(
      makeSeq2Send('k', 'google/gemini-3.5-flash-lite'),
      SEQ2_MOCK_ATTACHMENT
    )

    expect(calls).toHaveLength(1)
    const responseFormat = calls[0].body.response_format as {
      type: string
      json_schema: {
        name: string
        strict: boolean
        schema: {
          properties: Record<string, { items: { properties: Record<string, { enum?: unknown }> } }>
        }
      }
    }
    expect(responseFormat.type).toBe('json_schema')
    expect(responseFormat.json_schema.name).toBe('aris_ai_draft_v1')
    expect(responseFormat.json_schema.strict).toBe(true)
    expect(
      responseFormat.json_schema.schema.properties.relations.items.properties.connectionType.enum
    ).toEqual(ARIS_AI_SUPPORTED_CONNECTION_TYPES)
    // The pipeline still returns the recorded draft through the real transport.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft).toEqual(SEQ2_RECORDED_DRAFT)
  })

  it('normalizes invented connection types without a repair turn', async () => {
    // A variant of the recorded body: an event→function edge invents CT_FLOW
    // and a function→event edge invents CT_SEQ — both trivially mappable.
    const variant = structuredClone(SEQ2_RECORDED_DRAFT)
    const relationsById = new Map(
      variant.relations.map((relation) => [relation.logicalId, relation])
    )
    ;(relationsById.get('rel-trigger-login') as { connectionType: string }).connectionType =
      'CT_FLOW'
    ;(
      relationsById.get('rel-auto-approve-registered') as { connectionType: string }
    ).connectionType = 'CT_SEQ'
    const { calls } = stubFetchReplaying([buildSeq2OpenRouterBody(JSON.stringify(variant))])

    const result = await runSeq2Generation(makeSeq2Send('k'), SEQ2_MOCK_ATTACHMENT)

    // One physical request, zero semantic repair turns — the normalizer fixed
    // both codes before validation.
    expect(calls).toHaveLength(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.requestsSent).toBe(1)
    expect(result.semanticAttemptsUsed).toBe(0)
    const normalized = result.warnings.filter(
      (warning) => warning.code === 'normalized-connection-type'
    )
    expect(normalized).toHaveLength(2)
    const draftById = new Map(
      result.draft.relations.map((relation) => [relation.logicalId, relation])
    )
    expect(draftById.get('rel-trigger-login')!.connectionType).toBe('CT_ACTIV_1')
    expect(draftById.get('rel-auto-approve-registered')!.connectionType).toBe('CT_CRT_1')
  })
})

// --- Mode 2 — LIVE ----------------------------------------------------------

/**
 * Minimum composite similarity for the live run, with justification.
 *
 * The score (see seq2SimilarityScore) weights recovering the original's named
 * steps (0.35 functions + 0.25 events) above aggregate shape (0.20 type mix +
 * 0.20 connection count). A run that recovers ~60% of the named functions and
 * ~50% of the events with a perfect type mix and half the connections scores
 * ≈ 0.64; a run that recovers no meaningful steps scores ≤ 0.40 even with a
 * perfect shape (0.20 + 0.20 maximum from the two shape parts). 0.5 sits
 * between those regimes: it CANNOT pass on shape alone — at least some real
 * steps must come back — and it does not demand near-exact reproduction,
 * which a non-deterministic model cannot guarantee. So ≥ 0.5 means "the same
 * process, recognizably redrawn", which is exactly the Seq-2 question.
 */
const SEQ2_LIVE_SIMILARITY_THRESHOLD = 0.5

/**
 * Worst-case wall clock: one first attempt plus up to three semantic repair
 * turns, each bounded by the transport's own 180 s generation timeout.
 */
const SEQ2_LIVE_TEST_TIMEOUT_MS = 900_000

const HERE = dirname(fileURLToPath(import.meta.url))
const REFERENCE_ROOT = resolve(HERE, '../../../../reference/AnimalWF')
// The task names the file `...Draft03-1.pdf`; the reference tree currently
// carries it without the `-1` suffix. Accept either, fail loudly on neither.
const REFERENCE_PDF_CANDIDATES = [
  'Register_Animal_Owner_Profile_Draft03-1.pdf',
  'Register_Animal_Owner_Profile_Draft03.pdf'
] as const

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

function readReferencePdf(): { bytes: Buffer; fileName: string } {
  let lastError: unknown = null
  for (const candidate of REFERENCE_PDF_CANDIDATES) {
    try {
      return { bytes: readFileSync(join(REFERENCE_ROOT, 'pdf', candidate)), fileName: candidate }
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `Seq-2 live: reference PDF not found under ${join(REFERENCE_ROOT, 'pdf')} ` +
      `(tried ${REFERENCE_PDF_CANDIDATES.join(', ')}): ${String(lastError)}`
  )
}

function readExpectedSummary(): Seq2ProcessSummary {
  const raw = JSON.parse(
    readFileSync(join(REFERENCE_ROOT, 'expected', 'register-owner.expected.json'), 'utf8')
  ) as RegisterOwnerExpected
  const satelliteCount = Object.values(raw.satellites).reduce(
    (total, list) => total + list.length,
    0
  )
  return {
    functions: raw.counts.functions,
    events: raw.counts.events,
    rules: raw.counts.rules,
    satellites: satelliteCount,
    connections: raw.counts.connections,
    functionNames: raw.spine.filter((entry) => entry.kind === 'function').map((e) => e.nameEn),
    eventNames: raw.spine.filter((entry) => entry.kind === 'event').map((e) => e.nameEn)
  }
}

// The rasterized page for the image arm (offline step; never committed — the
// `reference/` tree lives outside the repo). Accept the `-1` suffix pdftoppm
// emits and a no-suffix candidate, mirroring the PDF candidate pattern.
const REFERENCE_PNG_CANDIDATES = [
  'Register_Animal_Owner_Profile_Draft03-1.png',
  'Register_Animal_Owner_Profile_Draft03.png'
] as const

function readReferencePng(): { bytes: Buffer; fileName: string } {
  let lastError: unknown = null
  for (const candidate of REFERENCE_PNG_CANDIDATES) {
    try {
      return { bytes: readFileSync(join(REFERENCE_ROOT, 'png', candidate)), fileName: candidate }
    } catch (error) {
      lastError = error
    }
  }
  const pngDir = join(REFERENCE_ROOT, 'png')
  const pdfPath = join(REFERENCE_ROOT, 'pdf', 'Register_Animal_Owner_Profile_Draft03.pdf')
  // A keyed run without the raster is an operator error, not a skip — fail
  // loudly with the exact command to produce it.
  throw new Error(
    `Seq-2 live IMAGE: reference PNG not found under ${pngDir} ` +
      `(tried ${REFERENCE_PNG_CANDIDATES.join(', ')}). Create it offline:\n` +
      `  mkdir -p ${pngDir} && pdftoppm -png -r 150 ${pdfPath} ` +
      `${join(pngDir, 'Register_Animal_Owner_Profile_Draft03')}\n` +
      `(last error: ${String(lastError)})`
  )
}

interface Seq2UsageCapture {
  requests: number
  costUsd: number
  everyRequestHadUsage: boolean
}

/**
 * Wrap the REAL `fetch` (pass-through) to accumulate the authoritative
 * OpenRouter cost + request count for the live cell, without altering the
 * response the pipeline sees. `afterEach` already unstubs.
 */
function installOpenRouterUsageCapture(modelId: string): Seq2UsageCapture {
  const capture: Seq2UsageCapture = { requests: 0, costUsd: 0, everyRequestHadUsage: true }
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const res = await realFetch(input as Parameters<typeof realFetch>[0], init)
    try {
      if (String(input).startsWith('https://openrouter.ai/api/v1/chat/completions')) {
        capture.requests += 1
        const json = (await res.clone().json()) as unknown
        const usage = extractUsage('openrouter', json)
        if (!usage) {
          capture.everyRequestHadUsage = false
        } else {
          const cost =
            usage.providerCostUsd ?? estimateCostUsd(modelId, usage.inputTokens, usage.outputTokens)
          if (cost === null) capture.everyRequestHadUsage = false
          else capture.costUsd += cost
        }
      }
    } catch {
      capture.everyRequestHadUsage = false
    }
    return res
  })
  return capture
}

/** Shared hard-gate assertions + the grep-able SEQ2-AB summary line. */
function reportSeq2Live(params: {
  mode: 'pdf' | 'image'
  modelId: string
  result: ArisAiGenerationResult & { ok: true }
  expectedSummary: Seq2ProcessSummary
  capture: Seq2UsageCapture
}): void {
  const { mode, modelId, result, expectedSummary, capture } = params

  // Hard gate: at most ONE semantic repair turn (a model that sees the drawing
  // should barely need repairs), and at most 3 normalizer rewrites (zero
  // surviving unsupported-connection-type findings by construction on success).
  expect(result.semanticAttemptsUsed).toBeLessThanOrEqual(1)
  const normalizedCount = result.warnings.filter(
    (warning) => warning.code === 'normalized-connection-type'
  ).length
  expect(normalizedCount).toBeLessThanOrEqual(3)

  // Auto-detect should land on EPC; production path draft → canonical AML.
  expect(result.draft.models.some((model) => model.modelType === 'MT_EEPC')).toBe(true)
  const aml = buildAmlFromArisAiDraft(result.draft)
  expect(aml.xml).toContain('<AML>')
  expect(aml.xml).toContain('Model.Type="MT_EEPC"')
  expect(aml.xml).toContain('ObjDef.ID=')
  expect(aml.xml).toContain('CxnOcc')

  const actualSummary = seq2SummaryFromDraft(result.draft)
  const breakdown = seq2SimilarityScore(expectedSummary, actualSummary)
  // Hard floor 0.5 (unchanged); soft target 0.65 is logged, never a hard fail.
  expect(breakdown.score).toBeGreaterThanOrEqual(SEQ2_LIVE_SIMILARITY_THRESHOLD)
  if (breakdown.score < SEQ2_LIVE_SOFT_TARGET) {
    console.warn(
      `SEQ2-AB model=${modelId} mode=${mode} below soft target ${SEQ2_LIVE_SOFT_TARGET}: ` +
        `score=${breakdown.score.toFixed(3)}`
    )
  }

  // Cost is a HARD gate when every request yielded usage; otherwise a warning.
  if (capture.requests > 0 && capture.everyRequestHadUsage) {
    expect(capture.costUsd).toBeLessThan(SEQ2_LIVE_MAX_COST_USD)
  } else {
    console.warn(
      `SEQ2-AB model=${modelId} mode=${mode} cost not fully measured ` +
        `(usage missing on some request); estimated costUsd=${capture.costUsd.toFixed(4)}`
    )
  }

  console.warn(
    `SEQ2-AB model=${modelId} mode=${mode} score=${breakdown.score.toFixed(3)} ` +
      `fn=${breakdown.functionNameRecall.toFixed(2)} ev=${breakdown.eventNameRecall.toFixed(2)} ` +
      `mix=${breakdown.typeDistribution.toFixed(2)} conn=${breakdown.connectionRatio.toFixed(2)} ` +
      `repairs=${result.semanticAttemptsUsed} requests=${capture.requests} ` +
      `normalized=${normalizedCount} costUsd=${capture.costUsd.toFixed(4)}`
  )
}

describe('Wave 8 Seq-2 A/B — create-from-PDF / picture pipeline (live OpenRouter)', () => {
  it(
    'generates the register-owner process from the reference PDF and fuzzy-compares to the original',
    async () => {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        console.warn('set OPENROUTER_API_KEY to run live Seq-2')
        return
      }
      // Capability mirror-guard: never send a PDF to an image-only model. This
      // is how the qwen sweep legally skips the PDF cell (the same gate the
      // product enforces at pick and send time).
      if (!getLiteModelCapabilities('openrouter', SEQ2_VISION_MODEL_ID).pdf) {
        console.warn(
          `SEQ2-AB model=${SEQ2_VISION_MODEL_ID} mode=pdf skipped — image-only model; ` +
            `PDF arm skipped by the same gate the product enforces`
        )
        return
      }

      const pdf = readReferencePdf()
      const expectedSummary = readExpectedSummary()
      const attachment: GenAttachment = {
        kind: 'pdf',
        base64: pdf.bytes.toString('base64'),
        mediaType: 'application/pdf',
        fileName: pdf.fileName,
        sizeBytes: pdf.bytes.byteLength
      }

      const capture = installOpenRouterUsageCapture(SEQ2_VISION_MODEL_ID)
      const result = await runSeq2Generation(
        makeSeq2Send(apiKey, SEQ2_VISION_MODEL_ID),
        attachment,
        (attemptNumber) => console.warn(`live Seq-2 pdf: semantic repair turn ${attemptNumber}`)
      )
      if (!result.ok) {
        throw new Error(
          `live Seq-2 pdf generation failed (${result.reason}); first findings: ` +
            JSON.stringify(result.findings.slice(0, 10))
        )
      }
      expect(result.ok).toBe(true)
      reportSeq2Live({
        mode: 'pdf',
        modelId: SEQ2_VISION_MODEL_ID,
        result,
        expectedSummary,
        capture
      })
    },
    SEQ2_LIVE_TEST_TIMEOUT_MS
  )

  it(
    'generates the register-owner process from the reference PNG (picture path) and fuzzy-compares',
    async () => {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        console.warn('set OPENROUTER_API_KEY to run live Seq-2')
        return
      }
      // No pdf-capability guard — both arms (gemini + qwen) run the image cell.
      const png = readReferencePng()
      const expectedSummary = readExpectedSummary()
      const attachment: GenAttachment = {
        kind: 'image',
        base64: png.bytes.toString('base64'),
        mediaType: 'image/png',
        fileName: png.fileName,
        sizeBytes: png.bytes.byteLength
      }

      const capture = installOpenRouterUsageCapture(SEQ2_VISION_MODEL_ID)
      const result = await runSeq2Generation(
        makeSeq2Send(apiKey, SEQ2_VISION_MODEL_ID),
        attachment,
        (attemptNumber) => console.warn(`live Seq-2 image: semantic repair turn ${attemptNumber}`),
        buildSeq2ImagePrompt()
      )
      if (!result.ok) {
        throw new Error(
          `live Seq-2 image generation failed (${result.reason}); first findings: ` +
            JSON.stringify(result.findings.slice(0, 10))
        )
      }
      expect(result.ok).toBe(true)
      reportSeq2Live({
        mode: 'image',
        modelId: SEQ2_VISION_MODEL_ID,
        result,
        expectedSummary,
        capture
      })
    },
    SEQ2_LIVE_TEST_TIMEOUT_MS
  )
})
