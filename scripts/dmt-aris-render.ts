/**
 * DMT ARIS renderer — produces native ARIS AML (.aml) via Codex. By default,
 * Codex emits CanonicalProcessV1 JSON, which is validated and persisted through
 * the convention AML path. Set CONVENTION=off to retain the legacy raw-draft
 * generation path.
 *
 * Run:   node_modules/.bin/vite-node scripts/dmt-aris-render.ts
 *   env: SAMPLE_IDS=DMT-BLD-0001-ADCM   ONLY=declared   (optional filters)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArisAiPrompt } from '../src/aris/ai/promptBuilder'
import { buildArisAiDraftJsonSchema } from '../src/aris/ai/draftJsonSchema'
import { validateArisAiDraft } from '../src/aris/ai/validateDraft'
import { buildCanonicalAiPrompt } from '../src/aris/canonical/aiPrompt'
import { parseCanonicalProcess, type CanonicalProcessV1 } from '../src/aris/canonical/contract'
import { buildCanonicalProcessJsonSchema } from '../src/aris/canonical/jsonSchema'
import { buildConventionAml, type ConventionAmlSuccess } from '../src/aris/headless/amlConvention'
import { buildAmlFromArisAiDraft } from '../src/aris/shell/arisAiCreate'

const CATALOG = '/home/ahmed/Desktop/simulated processes/generator/catalog/processes.jsonl'
const OUT_DIR = '/home/ahmed/Desktop/simulated processes/epc-samples-bpmntool'
const MODEL = 'gpt-5.6-terra'
const SAMPLE_IDS = [
  'DMT-BLD-0001-ADCM',
  'DMT-COM-0223-ADCM',
  'DMT-COR-0662-DMT',
  'DMT-INF-1375-ADPIC',
  'DMT-MOB-1834-ITC'
]
type Variant = 'declared' | 'actual'

type ProcessStep = {
  readonly sequence: string | number
  readonly performer_unit_id?: string
  readonly channel?: string
  readonly is_decision?: boolean
  readonly decision_condition_en?: string
  readonly is_approval?: boolean
  readonly name_en: string
  readonly description_en: string
}

type CatalogRecord = {
  readonly process_id: string
  readonly written_outline: {
    readonly name_en: string
    readonly purpose_en?: string
    readonly trigger_en: string
    readonly outcome_en: string
    readonly steps: readonly ProcessStep[]
  }
  readonly actual_outline: { readonly steps: readonly ProcessStep[] }
  readonly divergence?: {
    readonly events?: readonly { readonly mutation_operation: string; readonly event_id: string; readonly rationale_en: string }[]
  }
}

function buildDescription(rec: CatalogRecord, variant: Variant): string {
  const w = rec.written_outline
  const steps = variant === 'declared' ? w.steps : rec.actual_outline.steps
  const lines: string[] = []
  const label = variant === 'declared' ? 'DECLARED / written process' : 'ACTUAL / observed process'
  lines.push(`Process: ${w.name_en} (${rec.process_id}) — ${label}.`)
  if (w.purpose_en) lines.push(`Purpose: ${w.purpose_en}`)
  lines.push(`Trigger / start: ${w.trigger_en}`)
  if (variant === 'actual') {
    lines.push(
      'This is the ACTUAL observed execution, which diverges from the declared process. Model exactly the steps below.'
    )
  }
  lines.push('', 'Steps in order:')
  for (const s of steps) {
    const owner = s.performer_unit_id ? ` Performed by ${s.performer_unit_id}.` : ''
    const chan = s.channel ? ` Channel: ${s.channel}.` : ''
    if (s.is_decision && s.decision_condition_en) {
      lines.push(
        `${s.sequence}. DECISION "${s.name_en}": ${s.description_en} Condition: ${s.decision_condition_en}. ` +
          `If met, continue; otherwise the request is returned and the process ends.${owner}${chan}`
      )
    } else if (s.is_approval) {
      lines.push(
        `${s.sequence}. APPROVAL "${s.name_en}": ${s.description_en} If approved, continue; if rejected, end with rejection.${owner}${chan}`
      )
    } else {
      lines.push(`${s.sequence}. "${s.name_en}": ${s.description_en}${owner}${chan}`)
    }
  }
  if (variant === 'actual' && rec.divergence?.events?.length) {
    lines.push('', 'Observed divergences:')
    for (const ev of rec.divergence.events) lines.push(`- ${ev.mutation_operation} (${ev.event_id}): ${ev.rationale_en}`)
  }
  lines.push('', `Final outcome: ${w.outcome_en}`)
  return lines.join('\n')
}

function invokeCodex(system: string, user: string, schemaPath?: string): { ok: boolean; output: string; error: string } {
  const outFile = join(tmpdir(), `dmt-aris-${randomBytes(6).toString('hex')}.txt`)
  const prompt = `SYSTEM:\n${system}\n\nUSER:\n${user}\n\nReturn ONLY the JSON object.`
  const args = [
    'exec',
    '--model',
    MODEL,
    '-s',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    ...(schemaPath ? ['--output-schema', schemaPath] : []),
    '-o',
    outFile,
    '-'
  ]
  const res = spawnSync('codex', args, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  if (res.status !== 0) {
    return { ok: false, output: '', error: `codex failed (${res.status}): ${String(res.stderr).slice(-400)}` }
  }
  return { ok: true, output: readFileSync(outFile, 'utf8'), error: '' }
}

function codexCanonical(system: string, user: string, schemaPath: string): string {
  const schemaConstrained = invokeCodex(system, user, schemaPath)
  if (schemaConstrained.ok) return schemaConstrained.output

  console.warn(`   WARN --output-schema invocation failed; retrying prompt-only: ${schemaConstrained.error}`)
  const promptOnly = invokeCodex(system, user)
  if (promptOnly.ok) return promptOnly.output
  throw new Error(`Codex failed with and without --output-schema. Last: ${promptOnly.error}`)
}

function codexDraft(system: string, user: string, schemaPath: string): string {
  const outFile = join(tmpdir(), `dmt-aris-${randomBytes(6).toString('hex')}.txt`)
  void schemaPath // OpenAI strict structured-output rejects the tool's permissive schema; rely on the prompt.
  const prompt = `SYSTEM:\n${system}\n\nUSER:\n${user}\n\nReturn ONLY the JSON object, no prose, no code fences.`
  const res = spawnSync(
    'codex',
    [
      'exec',
      '--model',
      MODEL,
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '-o',
      outFile,
      '-'
    ],
    { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (res.status !== 0) throw new Error(`codex failed (${res.status}): ${String(res.stderr).slice(-400)}`)
  return readFileSync(outFile, 'utf8')
}

function parseDraftLoose(raw: string): unknown {
  const t = raw.trim()
  try {
    return JSON.parse(t)
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t)
    if (fence) return JSON.parse(fence[1])
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1))
    throw new Error('no JSON object in model output')
  }
}

function canonicalIssueSummary(issues: readonly { code: string; message: string }[]): string {
  return issues
    .slice(0, 6)
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join('; ')
}

function projectionFindingSummary(findings: readonly { ruleId: string; messageEn: string }[]): string {
  return findings
    .slice(0, 6)
    .map((finding) => `${finding.ruleId}: ${finding.messageEn}`)
    .join('; ')
}

function conventionFailureSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const REPAIR_STRUCTURAL_REMINDER =
  "You violated structural rules. Remember: the FIRST node must be kind:'event' (start trigger, no incoming edge) and every terminal branch must END in a kind:'event' node (no outgoing edge/outcome) — missingStart/missingEnd means you used an activity as the first/last node; decision nodes express branches ONLY via decisions[].outcomes, never edges; all ids unique; conditional edges need a condition."

async function generateConventionAml(
  rec: CatalogRecord,
  variant: Variant,
  description: string,
  schemaPath: string
): Promise<{ aml: string; canonical: CanonicalProcessV1; result: ConventionAmlSuccess }> {
  const processName = `${rec.process_id} ${variant === 'declared' ? 'Declared' : 'Actual'}`
  const { system, user } = buildCanonicalAiPrompt({ processName, description })
  let repairContext = ''
  let lastError = ''

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const attemptUser = repairContext
        ? `${user}\n\n${REPAIR_STRUCTURAL_REMINDER}\nPrevious attempt had these schema issues: ${repairContext}; fix and return valid JSON only.`
        : user
      const parsed = parseDraftLoose(codexCanonical(system, attemptUser, schemaPath))
      const canonicalResult = parseCanonicalProcess(parsed)
      if (!canonicalResult.ok) {
        repairContext = canonicalIssueSummary(canonicalResult.issues)
        lastError = `canonical parse failed: ${repairContext}`
        console.log(`   attempt ${attempt} failed: ${lastError}`)
        continue
      }

      const result = await buildConventionAml(canonicalResult.process)
      if (!result.ok) {
        repairContext =
          result.reason === 'parse'
            ? canonicalIssueSummary(result.issues)
            : projectionFindingSummary(result.findings.findings)
        lastError = `${result.reason} validation failed: ${repairContext}`
        console.log(`   attempt ${attempt} failed: ${lastError}`)
        continue
      }
      return { aml: result.xml, canonical: canonicalResult.process, result }
    } catch (error) {
      repairContext = conventionFailureSummary(error)
      lastError = repairContext
      console.log(`   attempt ${attempt} failed: ${lastError}`)
    }
  }

  throw new Error(`Could not generate valid convention AML after 5 attempts. Last: ${lastError}`)
}

function generateLegacyAml(
  rec: CatalogRecord,
  variant: Variant,
  description: string,
  schemaPath: string
): {
  aml: string
  counts: { models: number; objects: number; relations: number; uncertainties: number }
} {
  const modelName = `${rec.process_id} ${variant === 'declared' ? 'Declared' : 'Actual'}`
  const { system, user } = buildArisAiPrompt({ modelName, modelType: 'MT_EEPC', description })
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    let raw = ''
    try {
      raw = codexDraft(system, attempt === 1 ? user : `${user}\n\nPrevious attempt failed: ${String(lastErr)}. Fix and return valid JSON only.`, schemaPath)
      const parsed = parseDraftLoose(raw)
      const validation = validateArisAiDraft(parsed)
      if (!validation.ok) {
        const msgs = validation.findings
          .slice(0, 6)
          .map((f) => f.message ?? f.code ?? String(f))
          .join('; ')
        throw new Error(`draft validation failed: ${msgs}`)
      }
      const result = buildAmlFromArisAiDraft(validation.draft, { modelNameFallback: modelName })
      return {
        aml: result.xml,
        counts: {
          models: result.modelCount,
          objects: result.objectCount,
          relations: result.relationCount,
          uncertainties: result.uncertaintyCount
        }
      }
    } catch (e) {
      lastErr = e
      console.log(`   attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`Could not generate valid ARIS draft after 3 attempts. Last: ${String(lastErr)}`)
}

function formatDefaults(defaults: {
  readonly owner?: { readonly id: string }
  readonly system?: { readonly id: string }
  readonly informationObject?: { readonly id: string }
  readonly control?: { readonly id: string }
}): string {
  return [
    `owner=${defaults.owner?.id ?? 'none'}`,
    `system=${defaults.system?.id ?? 'none'}`,
    `informationObject=${defaults.informationObject?.id ?? 'none'}`,
    `control=${defaults.control?.id ?? 'none'}`
  ].join(', ')
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const convention = process.env.CONVENTION !== 'off'
  const schema = convention ? buildCanonicalProcessJsonSchema() : buildArisAiDraftJsonSchema()
  const schemaPath = join(tmpdir(), `aris-${convention ? 'canonical' : 'draft'}-schema-${randomBytes(4).toString('hex')}.json`)
  writeFileSync(schemaPath, JSON.stringify(schema))
  const records = readFileSync(CATALOG, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as CatalogRecord)
  const ids = process.env.SAMPLE_IDS ? process.env.SAMPLE_IDS.split(',') : SAMPLE_IDS
  const only = process.env.ONLY as Variant | undefined
  const variants: Variant[] = only ? [only] : ['declared', 'actual']
  for (const id of ids) {
    const rec = records.find((record) => record.process_id === id)
    if (!rec) {
      console.log(`SKIP ${id}: not found`)
      continue
    }
    const slug = id.toLowerCase()
    console.log(`\n=== ${id} ===`)
    for (const variant of variants) {
      const base = `${slug}.${variant}`
      const description = buildDescription(rec, variant)
      if (!convention) {
        console.log(`   [${variant}] -> Codex ARIS draft (legacy CONVENTION=off) ...`)
        const { aml, counts } = generateLegacyAml(rec, variant, description, schemaPath)
        writeFileSync(join(OUT_DIR, `${base}.aml`), aml)
        console.log(`   [${variant}] OK aml: ${JSON.stringify(counts)}, ${aml.length} bytes`)
        continue
      }

      console.log(`   [${variant}] -> Codex CanonicalProcessV1 ...`)
      const { aml, canonical, result } = await generateConventionAml(rec, variant, description, schemaPath)
      if (!result.layoutAccepted || result.layoutFindings.length > 0) {
        throw new Error(
          `[${variant}] layout rejected; AML and canonical JSON were not written: ${JSON.stringify(result.layoutFindings)}`
        )
      }
      writeFileSync(join(OUT_DIR, `${base}.aml`), aml)
      writeFileSync(join(OUT_DIR, `${base}.canonical.json`), `${JSON.stringify(canonical, null, 2)}\n`)
      console.log(
        `   [${variant}] OK aml: ${JSON.stringify(result.counts)}, ${aml.length} bytes; ` +
          `defaults: ${formatDefaults(result.defaults)}; suppressedOccurrenceCount=${result.suppressedOccurrenceCount}; ` +
          `layoutAccepted=${result.layoutAccepted}`
      )
    }
  }
  console.log('\nDONE ->', OUT_DIR)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
