/**
 * Build the offline viewer gallery (index.html) beside the copied tool. Reads the
 * catalog + the generated artifacts and emits a self-contained page that shows the
 * DECLARED and ACTUAL EPC for each sample and links each into ARIS Studio Lite.
 * Run:  node_modules/.bin/vite-node scripts/dmt-build-gallery.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ROOT = '/home/ahmed/Desktop/simulated processes'
const DIR = `${ROOT}/epc-samples-bpmntool`
const CATALOG = `${ROOT}/generator/catalog/processes.jsonl`
const IDS = ['DMT-BLD-0001-ADCM','DMT-COM-0223-ADCM','DMT-COR-0662-DMT','DMT-INF-1375-ADPIC','DMT-MOB-1834-ITC']
const REL = 'epc-samples-bpmntool'

const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const records = readFileSync(CATALOG,'utf8').trim().split('\n').map(JSON.parse)

function panel(slug, v) {
  const png = `${REL}/${slug}.${v}.aris.png`
  const aml = `${REL}/${slug}.${v}.aml`
  const svg = `${REL}/${slug}.${v}.svg`
  const hasPng = existsSync(`${DIR}/${slug}.${v}.aris.png`)
  const hasAml = existsSync(`${DIR}/${slug}.${v}.aml`)
  const hasSvg = existsSync(`${DIR}/${slug}.${v}.svg`)
  const badge = v === 'declared' ? 'declared' : 'actual'
  const img = hasPng
    ? `<a href="${png}" target="_blank" title="Open full-size EPC preview"><img src="${png}" alt="${slug} ${v} EPC" loading="lazy"></a>`
    : (hasSvg ? `<a href="${svg}" target="_blank"><img src="${svg}" alt="${slug} ${v}" loading="lazy"></a>` : `<div class="noimg">preview pending</div>`)
  const links = [
    hasAml ? `<code>${slug}.${v}.aml</code>` : '',
    hasSvg ? `<a href="${svg}" target="_blank">BPMN flowchart</a>` : '',
    existsSync(`${DIR}/${slug}.${v}.input.txt`) ? `<a href="${REL}/${slug}.${v}.input.txt" target="_blank">input text</a>` : ''
  ].filter(Boolean).join(' &middot; ')
  return `<div class="panel ${v}">
    <div class="phead"><span class="pill ${v}">${badge.toUpperCase()}</span> path</div>
    <div class="frame">${img}</div>
    <div class="plinks">${links}</div>
  </div>`
}

const cards = IDS.map((id) => {
  const rec = records.find(r => r.process_id === id)
  const slug = id.toLowerCase()
  const title = rec?.written_outline?.short_name_en ?? id
  const domain = rec?.taxonomy?.domain_code ?? ''
  const tier = rec?.complexity?.tier ?? ''
  return `<section class="card">
    <header class="chead">
      <div><span class="pid">${esc(id)}</span> <span class="ptitle">${esc(title)}</span></div>
      <div class="meta">${esc(domain)} &middot; ${esc(tier)}</div>
    </header>
    <div class="pair">${panel(slug,'declared')}${panel(slug,'actual')}</div>
  </section>`
}).join('\n')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DMT EPC Samples — OrbitPM ARIS Studio (Codex)</title>
<style>
  :root{--bg:#f7f8fa;--card:#fff;--ink:#0f172a;--sub:#64748b;--line:#e2e8f0;--declared:#1d4ed8;--actual:#c2410c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
  header.top{padding:28px 32px 20px;border-bottom:1px solid var(--line);background:#fff}
  h1{margin:0 0 6px;font-size:24px}
  .lede{color:var(--sub);max-width:900px}
  .lede b{color:var(--ink)}
  .cta{margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .btn{display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600}
  .btn.alt{background:#fff;color:#0f172a;border:1px solid var(--line)}
  .how{margin-top:14px;padding:12px 16px;background:#f1f5f9;border:1px solid var(--line);border-radius:8px;color:#334155;max-width:900px}
  .how ol{margin:6px 0 0;padding-left:20px}
  .how code{background:#e2e8f0;padding:1px 6px;border-radius:4px;font-size:13px}
  main{padding:24px 32px;display:flex;flex-direction:column;gap:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .chead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  .pid{font-family:ui-monospace,Menlo,monospace;font-weight:700}
  .ptitle{color:#334155;margin-left:6px}
  .meta{color:var(--sub);font-size:13px}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:0}
  .panel{padding:14px 16px}
  .panel.declared{border-right:1px solid var(--line)}
  .phead{font-size:12px;color:var(--sub);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
  .pill{display:inline-block;color:#fff;border-radius:10px;padding:2px 9px;font-size:11px;font-weight:700;letter-spacing:.3px}
  .pill.declared{background:var(--declared)}
  .pill.actual{background:var(--actual)}
  .frame{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:auto;max-height:520px;display:flex;justify-content:center}
  .frame img{max-width:100%;height:auto;display:block}
  .noimg{padding:60px;color:var(--sub)}
  .plinks{margin-top:8px;font-size:13px;color:var(--sub)}
  .plinks a{color:var(--declared);text-decoration:none}
  .plinks code{background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px}
  @media(max-width:820px){.pair{grid-template-columns:1fr}.panel.declared{border-right:none;border-bottom:1px solid var(--line)}}
  footer{padding:20px 32px 40px;color:var(--sub);font-size:13px}
</style></head>
<body>
<header class="top">
  <h1>DMT process drawings — declared vs actual (EPC)</h1>
  <p class="lede">5 sample DMT records rendered by the <b>OrbitPM ARIS Studio Lite</b> engine with the
  <b>Codex CLI (gpt-5.6-terra)</b> as the LLM backend — <b>no API key</b>. Each record shows two EPCs:
  the <b style="color:var(--declared)">declared / written</b> process and the <b style="color:var(--actual)">actual / observed</b>
  process (the divergence is the point). The images below are previews; open the <code>.aml</code> in the tool for the
  full interactive ARIS view.</p>
  <div class="cta">
    <a class="btn" href="OrbitPM-ARIS-Studio-Lite.html" target="_blank">Open ARIS Studio Lite &rarr;</a>
    <span style="color:var(--sub);font-size:13px">then <b>Open a single ARIS AML/XML file</b> and pick a <code>.aml</code> below</span>
  </div>
  <div class="how"><b>To view a drawing inside the tool (the full ARIS EPC):</b>
    <ol>
      <li>Click <b>Open ARIS Studio Lite</b> above.</li>
      <li>Click <b>Open a single ARIS AML/XML file</b>.</li>
      <li>Pick the record's <code>.aml</code> from <code>${REL}/</code> (the filename is under each preview).</li>
      <li>Use <b>Clean Layout</b> / <b>Zoom Fit</b>, and <b>Labels: EN/AR</b> to switch language.</li>
    </ol>
  </div>
</header>
<main>
${cards}
</main>
<footer>
  Generated by <code>scripts/dmt-aris-render.ts</code> (ARIS AML via Codex) and <code>scripts/dmt-codex-render.ts</code> (BPMN).
  Samples only — pending approval before scaling to the full catalog.
</footer>
</body></html>`

writeFileSync(`${ROOT}/index.html`, html)
console.log('wrote', `${ROOT}/index.html`)
