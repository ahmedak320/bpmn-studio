/**
 * DMT sample renderer — bpmn-tool LITE engine with a Codex CLI (gpt-5.6-terra)
 * backend instead of a paid LLM API key.
 *
 * Pipeline (identical "text -> LLM -> drawing" method as the lite tool, only the
 * LLM transport is swapped):
 *   record -> natural-language description
 *          -> composeCreateBpmn() [the tool's exact prompt]
 *          -> Codex CLI (gpt-5.6-terra, logged-in ChatGPT account) -> IR JSON
 *          -> generateBpmnXml() [tool] -> semantic BPMN 2.0 XML
 *          -> layoutProcess() [tool's pinned bpmn-auto-layout] -> BPMN + DI
 *          -> DI -> standalone SVG (this file)
 *
 * Run:  node_modules/.bin/vite-node scripts/dmt-codex-render.ts
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeCreateBpmn, messageHistoryToString, type LlmMessage } from '../src/generation/prompts'
import { UNTRUSTED_WORKSPACE_SYSTEM_GUARD } from '../src/ai/untrustedPrompt'
import { parseJsonLoose } from '../src/generation/parse'
import { generateBpmnXml } from '../src/generation/xml'
import { layoutProcess } from 'bpmn-auto-layout'

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

// ---------------------------------------------------------------------------
// 1. record -> business-process description (declared / written outline)
// ---------------------------------------------------------------------------
type Variant = 'declared' | 'actual'

function buildDescription(rec: any, variant: Variant): string {
  const w = rec.written_outline
  const steps = variant === 'declared' ? w.steps : rec.actual_outline.steps
  const lines: string[] = []
  const label = variant === 'declared' ? 'DECLARED / written process' : 'ACTUAL / observed process'
  lines.push(`Process: ${w.name_en} (${rec.process_id}) — ${label}.`)
  if (w.purpose_en) lines.push(`Purpose: ${w.purpose_en}`)
  lines.push(`Trigger / start: ${w.trigger_en}`)
  if (variant === 'actual') {
    lines.push(
      'This is the ACTUAL observed execution, which diverges from the declared process ' +
        '(added workarounds, extra approvals, or reordered/skipped steps). Model exactly the steps below.'
    )
  }
  lines.push('')
  lines.push('Steps in order:')
  for (const s of steps) {
    const owner = s.performer_unit_id ? ` Performed by ${s.performer_unit_id}.` : ''
    const chan = s.channel ? ` Channel: ${s.channel}.` : ''
    if (s.is_decision && s.decision_condition_en) {
      lines.push(
        `${s.sequence}. DECISION "${s.name_en}": ${s.description_en} Condition: ${s.decision_condition_en}. ` +
          `If the condition is met the process continues to the next step; otherwise the request is returned to the applicant and the process ends.${owner}${chan}`
      )
    } else if (s.is_approval) {
      lines.push(
        `${s.sequence}. APPROVAL "${s.name_en}": ${s.description_en} If approved, continue; if rejected, the process ends with a rejection outcome.${owner}${chan}`
      )
    } else {
      lines.push(`${s.sequence}. "${s.name_en}": ${s.description_en}${owner}${chan}`)
    }
  }
  if (variant === 'actual' && rec.divergence?.events?.length) {
    lines.push('')
    lines.push('Observed divergences from the declared process:')
    for (const ev of rec.divergence.events) {
      lines.push(`- ${ev.mutation_operation} (${ev.event_id}): ${ev.rationale_en}`)
    }
  }
  lines.push('')
  lines.push(`Final outcome: ${w.outcome_en}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 2. Codex CLI backend — one-shot non-interactive completion of the tool prompt
// ---------------------------------------------------------------------------
function codexComplete(promptText: string): string {
  const outFile = join(tmpdir(), `dmt-codex-${randomBytes(6).toString('hex')}.txt`)
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
    { input: promptText, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (res.status !== 0) {
    throw new Error(`codex exec failed (status ${res.status}): ${String(res.stderr).slice(-500)}`)
  }
  return readFileSync(outFile, 'utf8')
}

function extractProcess(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
  if (parsed && typeof parsed === 'object' && 'process' in parsed) {
    const p = (parsed as { process: unknown }).process
    if (Array.isArray(p)) return p as Record<string, unknown>[]
  }
  throw new Error("Model output is missing the 'process' key")
}

// Faithful mirror of the tool's generate.ts repair loop, Codex-backed.
function generateIrWithCodex(description: string): { ir: any[]; semanticXml: string } {
  const userPrompt =
    composeCreateBpmn(messageHistoryToString([{ role: 'user', content: description }])) +
    '\n\nOutput ONLY the JSON object with the top-level "process" key. No prose, no code fences.'
  const messages: LlmMessage[] = [
    { role: 'system', content: UNTRUSTED_WORKSPACE_SYSTEM_GUARD },
    { role: 'user', content: userPrompt }
  ]
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const flat = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n')
    let raw = ''
    try {
      raw = codexComplete(flat)
      const proc = extractProcess(parseJsonLoose(raw))
      const semanticXml = generateBpmnXml(proc as any, {
        identitySeed: description,
        requireBilingual: false
      } as any)
      return { ir: proc, semanticXml }
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`   attempt ${attempt} failed: ${msg}`)
      if (raw) messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: `Error: ${msg}. Try again.` })
    }
  }
  throw new Error(`Could not generate valid IR after 3 attempts. Last: ${String(lastErr)}`)
}

// ---------------------------------------------------------------------------
// 3. DI (bpmn-auto-layout output) -> standalone SVG
// ---------------------------------------------------------------------------
const esc = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function wrap(text: string, max: number): string[] {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ')
  const out: string[] = []
  let line = ''
  for (const w of words) {
    const c = line ? `${line} ${w}` : w
    if (c.length > max && line) {
      out.push(line)
      line = w
    } else line = c
  }
  if (line) out.push(line)
  return out
}

type ElInfo = { tag: string; name: string }

function parseSemantic(xml: string): { els: Map<string, ElInfo>; flows: Map<string, string> } {
  const els = new Map<string, ElInfo>()
  const flows = new Map<string, string>()
  // generateBpmnXml emits default-namespace BPMN (e.g. <startEvent ...>), so
  // match an OPTIONAL bpmn: prefix and filter by known tags below.
  const KNOWN = new Set([
    ...EVENT_TAGS,
    ...GATEWAY_TAGS,
    'task',
    'userTask',
    'serviceTask',
    'sendTask',
    'receiveTask',
    'manualTask',
    'scriptTask',
    'businessRuleTask',
    'callActivity',
    'sequenceFlow'
  ])
  const elRe = /<(?:bpmn:)?([A-Za-z]+)\b([^>]*?)(?:\/>|>)/g
  let m: RegExpExecArray | null
  while ((m = elRe.exec(xml))) {
    const tag = m[1]
    if (!KNOWN.has(tag)) continue
    const attrs = m[2]
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1]
    if (!id) continue
    const name = /\bname="([^"]*)"/.exec(attrs)?.[1] ?? ''
    if (tag === 'sequenceFlow') flows.set(id, name)
    else els.set(id, { tag, name })
  }
  return { els, flows }
}

type Shape = { id: string; x: number; y: number; w: number; h: number }
type Edge = { id: string; pts: Array<{ x: number; y: number }> }

function parseDi(xml: string): { shapes: Shape[]; edges: Edge[] } {
  const shapes: Shape[] = []
  const edges: Edge[] = []
  const shapeRe =
    /<bpmndi:BPMNShape[^>]*bpmnElement="([^"]+)"[^>]*>\s*<dc:Bounds x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g
  let m: RegExpExecArray | null
  while ((m = shapeRe.exec(xml))) {
    shapes.push({ id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] })
  }
  const edgeRe = /<bpmndi:BPMNEdge[^>]*bpmnElement="([^"]+)"[^>]*>([\s\S]*?)<\/bpmndi:BPMNEdge>/g
  while ((m = edgeRe.exec(xml))) {
    const pts: Array<{ x: number; y: number }> = []
    const wpRe = /<di:waypoint x="([\d.-]+)" y="([\d.-]+)"/g
    let w: RegExpExecArray | null
    while ((w = wpRe.exec(m[2]))) pts.push({ x: +w[1], y: +w[2] })
    edges.push({ id: m[1], pts })
  }
  return { shapes, edges }
}

const EVENT_TAGS = new Set(['startEvent', 'endEvent', 'intermediateThrowEvent', 'intermediateCatchEvent'])
const GATEWAY_TAGS = new Set(['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'])

function renderSvg(rec: any, semanticXml: string, laidXml: string, variant: Variant): string {
  const { els, flows } = parseSemantic(semanticXml)
  const { shapes, edges } = parseDi(laidXml)
  const PAD = 40
  const TOP = 96
  let maxX = 0
  let maxY = 0
  for (const s of shapes) {
    maxX = Math.max(maxX, s.x + s.w)
    maxY = Math.max(maxY, s.y + s.h)
  }
  for (const e of edges) for (const p of e.pts) {
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const W = maxX + PAD
  const H = maxY + TOP + PAD
  const off = (n: number) => n + TOP

  const parts: string[] = []
  // edges first
  for (const e of edges) {
    if (e.pts.length < 2) continue
    const d = e.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${off(p.y)}`).join(' ')
    parts.push(`<path d="${d}" class="flow" marker-end="url(#arrow)"/>`)
    const name = flows.get(e.id)
    if (name) {
      const mid = e.pts[Math.floor(e.pts.length / 2) - 1] ?? e.pts[0]
      const nx = e.pts.length > 2 ? e.pts[1].x : mid.x
      const ny = e.pts.length > 2 ? e.pts[1].y : mid.y
      parts.push(
        `<text x="${nx + 4}" y="${off(ny) - 5}" class="flow-label">${esc(name)}</text>`
      )
    }
  }
  // shapes
  for (const s of shapes) {
    const info = els.get(s.id)
    if (!info) continue
    const cx = s.x + s.w / 2
    const cy = off(s.y + s.h / 2)
    if (EVENT_TAGS.has(info.tag)) {
      // EPC-style event = elongated hexagon
      const hw = s.w * 0.9
      const hh = s.h / 2
      const inset = hh * 0.62
      const cls =
        info.tag === 'startEvent' ? 'ev-start' : info.tag === 'endEvent' ? 'ev-end' : 'ev-int'
      const sw = info.tag === 'endEvent' ? 2.6 : 1.6
      const pts = [
        `${cx - hw},${cy}`,
        `${cx - hw + inset},${cy - hh}`,
        `${cx + hw - inset},${cy - hh}`,
        `${cx + hw},${cy}`,
        `${cx + hw - inset},${cy + hh}`,
        `${cx - hw + inset},${cy + hh}`
      ].join(' ')
      parts.push(`<polygon points="${pts}" class="event ${cls}" style="stroke-width:${sw}"/>`)
      if (info.name) {
        const lines = wrap(info.name, 18)
        const ty = cy + hh + 15
        parts.push(txt(lines, cx, ty, 13, 'ev-label', 'middle'))
      }
    } else if (GATEWAY_TAGS.has(info.tag)) {
      const r = s.w / 2
      const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
      parts.push(`<polygon points="${pts}" class="gateway"/>`)
      const sym = info.tag === 'parallelGateway' ? '+' : info.tag === 'inclusiveGateway' ? 'O' : '×'
      parts.push(`<text x="${cx}" y="${cy + 7}" class="gw-sym" text-anchor="middle">${sym}</text>`)
      if (info.name) {
        const lines = wrap(info.name, 20)
        parts.push(txt(lines, cx, cy - r - 6 - (lines.length - 1) * 14, 13, 'gw-label', 'middle'))
      }
    } else {
      // task family
      const taskCls = info.tag.toLowerCase().includes('user')
        ? 'task-user'
        : info.tag.toLowerCase().includes('service')
          ? 'task-service'
          : info.tag.toLowerCase().includes('send') || info.tag.toLowerCase().includes('receive')
            ? 'task-msg'
            : 'task-plain'
      parts.push(
        `<rect x="${s.x}" y="${off(s.y)}" width="${s.w}" height="${s.h}" rx="8" class="task ${taskCls}"/>`
      )
      const lines = wrap(info.name || info.tag, 16)
      parts.push(txt(lines, cx, cy - (lines.length - 1) * 8, 13, 'task-label', 'middle'))
      parts.push(`<text x="${s.x + 6}" y="${off(s.y) + 14}" class="task-kind">${esc(kindLabel(info.tag))}</text>`)
    }
  }

  const vLabel = variant === 'declared' ? 'DECLARED / written path' : 'ACTUAL / observed path'
  const badgeFill = variant === 'declared' ? '#1d4ed8' : '#c2410c'
  const title = `${rec.process_id} — ${esc(rec.written_outline.short_name_en)}`
  const sub = `Domain ${esc(rec.taxonomy?.domain_code ?? '')} · Tier ${esc(rec.complexity?.tier ?? '')} · EPC/BPMN via OrbitPM lite engine + Codex ${MODEL}`
  const badgeW = variant === 'declared' ? 180 : 176
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(W, 900)}" height="${H}" viewBox="0 0 ${Math.max(W, 900)} ${H}" role="img" aria-label="${esc(title)}">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#475569"/></marker>
    <style>
      text{font-family:Arial,Helvetica,sans-serif}
      .title{font-weight:700;font-size:22px;fill:#0f172a}
      .subtitle{font-size:13px;fill:#475569}
      .flow{fill:none;stroke:#475569;stroke-width:1.6}
      .flow-label{font-size:11px;fill:#b45309}
      .event{fill:#ecfdf5}
      .ev-start{stroke:#16a34a;fill:#dcfce7}
      .ev-end{stroke:#7c3aed;fill:#ede9fe}
      .ev-int{stroke:#0284c7;fill:#e0f2fe}
      .ev-label{font-size:12px;fill:#0f172a}
      .task{stroke-width:1.6}
      .task-plain{fill:#f8fafc;stroke:#64748b}
      .task-user{fill:#eff6ff;stroke:#2563eb}
      .task-service{fill:#f0fdf4;stroke:#16a34a}
      .task-msg{fill:#fef3c7;stroke:#d97706}
      .task-label{font-size:13px;font-weight:600;fill:#0f172a}
      .task-kind{font-size:9px;fill:#64748b;font-style:italic}
      .gateway{fill:#fff7ed;stroke:#ea580c;stroke-width:1.8}
      .gw-sym{font-size:20px;font-weight:700;fill:#c2410c}
      .gw-label{font-size:12px;font-weight:600;fill:#7c2d12}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${PAD}" y="42" class="title">${title}</text>
  <text x="${PAD}" y="66" class="subtitle">${sub}</text>
  <rect x="${Math.max(W, 900) - PAD - badgeW}" y="24" width="${badgeW}" height="26" rx="13" fill="${badgeFill}"/>
  <text x="${Math.max(W, 900) - PAD - badgeW / 2}" y="42" text-anchor="middle" style="font-size:13px;font-weight:700;fill:#fff">${vLabel}</text>
  <line x1="${PAD}" y1="80" x2="${Math.max(W, 900) - PAD}" y2="80" stroke="#e2e8f0"/>
  ${parts.join('\n  ')}
</svg>`
}

function kindLabel(tag: string): string {
  const map: Record<string, string> = {
    userTask: 'user',
    serviceTask: 'service',
    sendTask: 'send',
    receiveTask: 'receive',
    manualTask: 'manual',
    scriptTask: 'script',
    businessRuleTask: 'rule',
    task: 'task',
    callActivity: 'call'
  }
  return map[tag] ?? tag
}

function txt(lines: string[], x: number, y: number, lh: number, cls: string, anchor: string): string {
  return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${lines
    .map((l, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(l)}</tspan>`)
    .join('')}</text>`
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const VARIANTS: Variant[] = ['declared', 'actual']

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const records = readFileSync(CATALOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const ids = process.env.SAMPLE_IDS ? process.env.SAMPLE_IDS.split(',') : SAMPLE_IDS
  const manifest: any[] = []
  for (const id of ids) {
    const rec = records.find((r: any) => r.process_id === id)
    if (!rec) {
      console.log(`SKIP ${id}: not found`)
      continue
    }
    const slug = id.toLowerCase()
    console.log(`\n=== ${id} ===`)
    const entry: any = {
      id,
      slug,
      title: rec.written_outline.short_name_en,
      domain: rec.taxonomy?.domain_code,
      tier: rec.complexity?.tier,
      variants: {}
    }
    for (const variant of VARIANTS) {
      const base = `${slug}.${variant}`
      if (process.env.RENDER_ONLY) {
        const semanticXml = readFileSync(join(OUT_DIR, `${base}.bpmn`), 'utf8')
        const laid = readFileSync(join(OUT_DIR, `${base}.layout.bpmn`), 'utf8')
        const svg = renderSvg(rec, semanticXml, laid, variant)
        writeFileSync(join(OUT_DIR, `${base}.svg`), svg)
        console.log(`   [${variant}] re-rendered svg ${svg.length} bytes`)
        entry.variants[variant] = { svg: `${base}.svg`, bpmn: `${base}.bpmn` }
        continue
      }
      const description = buildDescription(rec, variant)
      writeFileSync(join(OUT_DIR, `${base}.input.txt`), description)
      console.log(`   [${variant}] ${description.length} chars -> Codex ${MODEL} ...`)
      const { ir, semanticXml } = generateIrWithCodex(description)
      writeFileSync(join(OUT_DIR, `${base}.ir.json`), JSON.stringify({ process: ir }, null, 2))
      writeFileSync(join(OUT_DIR, `${base}.bpmn`), semanticXml)
      const laid = await layoutProcess(semanticXml)
      writeFileSync(join(OUT_DIR, `${base}.layout.bpmn`), laid)
      const svg = renderSvg(rec, semanticXml, laid, variant)
      writeFileSync(join(OUT_DIR, `${base}.svg`), svg)
      console.log(`   [${variant}] OK: ${ir.length} IR elements, svg ${svg.length} bytes`)
      entry.variants[variant] = { svg: `${base}.svg`, bpmn: `${base}.bpmn` }
    }
    manifest.push(entry)
  }
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('\nDONE ->', OUT_DIR)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
