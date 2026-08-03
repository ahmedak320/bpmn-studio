/**
 * Headless canonical->SVG render helper for the browser-vs-headless parity e2e
 * (implementation plan Lane L-PARITY, Wave 21; deliverable 3).
 *
 * Run under `vite-node`, NEVER inside Playwright's own loader: it imports the
 * live headless render entry (`@/aris/headless/render`), which pulls in
 * `canvas/renderer`, whose extensionless `diagram-js` ESM imports only Vite's
 * resolver understands (see `./arisRoundtripCompare.ts:1-30` for the same
 * loader constraint). The parity spec therefore SPAWNS this helper and reads
 * the artifacts + one JSON line it emits, rather than importing any engine
 * module itself.
 *
 * Usage:
 *   npx vite-node tests/e2e/helpers/arisHeadlessRender.ts <fixture.json> <outDir>
 *
 * It reads a `CanonicalProcessV1` JSON fixture, renders it through the exact
 * headless pipeline the enterprise consumer uses (`renderCanonicalProcess` —
 * project → structural gate → live diagram-js canvas under jsdom → clean
 * layout → anchored, byte-stable SVG), writes two artifacts the spec boots the
 * browser against:
 *
 *   <outDir>/parity.svg       the rendered, anchored SVG
 *   <outDir>/parity.aml.xml   the `debugAml` from the SAME run — the AML the
 *                             browser imports so both sides start from one
 *                             identical model and apply the SAME `cleanLayout`
 *
 * and prints ONE JSON line on its last stdout line:
 *
 *   {"anchors": {"<ObjOcc id>": {x, y, width, height}}, "svgSha256", "metadata"}
 *
 * The anchors are extracted from the SVG's `data-epc-node` groups: `x`/`y` are
 * the shape group's model-space translate (the diagram-js viewport group is
 * identity in the capture, so the group transform IS model space), and
 * `width`/`height` are the group's diagram-js hit rect (`rect.djs-hit`) —
 * model-space attributes that do not scale with zoom, identical on both sides.
 *
 * Exit code 1 means the helper could not run at all (bad fixture, failed
 * render, or an SVG that yielded no anchors); geometry is data, never an exit
 * code.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// NOTE: '@' (vite.config.ts `resolve.alias`) rather than '../../src/…' — this
// file only ever runs under `vite-node`, which does not absolutize
// two-level-up relative imports from tests/e2e/helpers (see
// `./arisRoundtripCompare.ts:21-24`).
import { parseCanonicalProcess } from '@/aris/canonical'
import { renderCanonicalProcess } from '@/aris/headless/render'
import { ensureHeadlessDom } from '@/aris/headless/environment'

interface AnchorBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Pull the translate (`e`,`f`) out of a `matrix(...)` or `translate(...)` transform. */
function readTranslate(transform: string): { x: number; y: number } {
  const matrix = /matrix\(([^)]+)\)/u.exec(transform)
  if (matrix) {
    const parts = matrix[1].split(/[\s,]+/u).map(Number)
    if (parts.length >= 6) return { x: parts[4], y: parts[5] }
  }
  const translate = /translate\(([^)]+)\)/u.exec(transform)
  if (translate) {
    const parts = translate[1].split(/[\s,]+/u).map(Number)
    return { x: parts[0] ?? 0, y: parts[1] ?? 0 }
  }
  return { x: Number.NaN, y: Number.NaN }
}

/**
 * Parse the rendered SVG's `data-epc-node` groups into a model-space anchor
 * table keyed by the group's `ObjOcc.`-prefixed `data-element-id` — exactly the
 * id the browser canvas draws for the same imported AML.
 */
function extractAnchors(svg: string): Record<string, AnchorBox> {
  // `ensureHeadlessDom` (already invoked by the render above) publishes a jsdom
  // `DOMParser` onto `globalThis`; call it defensively so parsing never depends
  // on the render's side-effect ordering.
  ensureHeadlessDom()
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const anchors: Record<string, AnchorBox> = {}
  doc.querySelectorAll('[data-epc-node]').forEach((group) => {
    const id = group.getAttribute('data-element-id')
    if (!id || !id.startsWith('ObjOcc.')) return
    const { x, y } = readTranslate(group.getAttribute('transform') ?? '')
    const hit = group.querySelector('rect.djs-hit')
    anchors[id] = {
      x,
      y,
      width: hit ? Number(hit.getAttribute('width')) : Number.NaN,
      height: hit ? Number(hit.getAttribute('height')) : Number.NaN
    }
  })
  return anchors
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2]
  const outDir = process.argv[3]
  if (!fixturePath || !outDir) {
    console.error('usage: vite-node arisHeadlessRender.ts <fixture.json> <outDir>')
    process.exit(1)
  }

  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown
  const parsed = parseCanonicalProcess(raw)
  if (!parsed.ok) {
    console.error(
      `fixture is not a valid CanonicalProcessV1:\n${JSON.stringify(parsed.issues, null, 2)}`
    )
    process.exit(1)
  }

  const result = await renderCanonicalProcess(parsed.process)
  if (!result.ok) {
    console.error(
      `headless render failed (reason: ${result.reason}):\n${JSON.stringify(result, null, 2)}`
    )
    process.exit(1)
  }

  writeFileSync(join(outDir, 'parity.svg'), result.svg, 'utf8')
  writeFileSync(join(outDir, 'parity.aml.xml'), result.debugAml, 'utf8')

  const anchors = extractAnchors(result.svg)
  if (Object.keys(anchors).length === 0) {
    console.error('the rendered SVG carried no data-epc-node anchors — cannot compare parity.')
    process.exit(1)
  }

  const payload = {
    anchors,
    svgSha256: createHash('sha256').update(result.svg).digest('hex'),
    metadata: result.metadata
  }
  // One JSON line, last on stdout — the spec parses exactly this line.
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

main()
