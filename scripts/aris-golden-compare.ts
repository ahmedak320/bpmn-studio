/**
 * ARIS visual golden comparison — plan §20.2 (Phase 17).
 *
 * Phase 17 needs a customer-supplied golden pair (one AML/XML export plus the matching ARIS-
 * rendered PDF/PNG) that has not been supplied yet. This script is the automated half of §20.2
 * prepared ahead of time: the moment the golden pair exists on disk, running it produces the
 * complete structural/semantic comparison report the plan asks for, with zero further code
 * changes.
 *
 * ## What is and is not automated
 *
 * §20.2 lists eleven things to compare. Everything derivable from the AML alone — counts, object
 * identity/text, bounds/centers, route bends, colors, fonts, text wrapping, z-order, satellites,
 * lanes, free text — is computed here from the product's own pipeline (`createArisXmlSourcePackage`
 * for parsing and semantic indexing, `buildArisStudioDocument` for the working model, render model
 * and fidelity findings), never a re-implementation.
 *
 * What this script cannot do without an OCR/PDF-vector-extraction dependency (never installed,
 * never requested) is read per-object pixel positions back OUT of the golden PDF/PNG. Rather than
 * fake that with an "approximation" — exactly what §20.2 forbids for missing fonts/templates — the
 * gap is explicit:
 *
 *   - By default the script reports OrbitPM's own computed facts (bounds, centers, route bends,
 *     colors, fonts, z-order, satellite/lane/free-text lists) in full, plus the golden file's own
 *     digest and pixel dimensions (for a PNG) so a human lines the two up visually.
 *   - When the user (or a future extraction pass) supplies `--golden-facts=<path.json>` with
 *     per-element bounds/centers/route points/colors keyed by source id, the SAME comparator runs
 *     the real two-sided check the plan describes: bounds/centers flagged past 2px, route bends
 *     flagged past 3px, colors compared exactly. The `GoldenFacts` shape is documented below.
 *
 * Missing proprietary fonts/templates/custom symbols are never hidden: every
 * `ArisRenderFidelityFinding` the render model produces is reported, and the "hard blocker" kinds
 * (missing-font, missing-template, unknown-custom-symbol, substituted-visual-resource,
 * missing-reference-export) fail the gate on their own.
 *
 * ## Usage
 *
 * ```sh
 * npm run test:aris:golden -- <golden.aml-or-xml> <golden.pdf-or-png>
 * npm run test:aris:golden -- <golden.aml> <golden.png> --golden-facts=facts.json --out=report.json
 * ```
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isSatelliteObjectType } from '../src/aris/canvas/vocabulary'
import type { ArisLocalizedValue } from '../src/aris/model/types'
import { arisText, buildArisStudioDocument } from '../src/aris/shell/arisStudioDocument'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'
import type { ArisRenderFidelityKind } from '../src/aris/renderer/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** §20.2 target: "Centers/bounds within 2 pixels after normalization." */
const BOUNDS_TOLERANCE_PX = 2
/** §20.2 target: "Bend points within 3 pixels." */
const ROUTE_TOLERANCE_PX = 3

/**
 * §20.2/§20.4: "Missing proprietary fonts/templates/custom symbols remain explicit blockers; do
 * not hide them with unreported approximations." These kinds mean the render substituted or lost
 * something the source specified; the rest (pen/brush effects, OLE rendering, text wrap
 * differences) are reported too but do not on their own fail the gate.
 */
const HARD_FIDELITY_KINDS: ReadonlySet<ArisRenderFidelityKind> = new Set([
  'missing-font',
  'missing-template',
  'unknown-custom-symbol',
  'substituted-visual-resource',
  'missing-reference-export'
])

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface ParsedArgs {
  readonly positionals: readonly string[]
  readonly flags: ReadonlyMap<string, string>
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string>()
  for (const arg of argv) {
    const match = /^--([a-zA-Z0-9-]+)=(.*)$/.exec(arg)
    if (match) flags.set(match[1] as string, match[2] as string)
    else positionals.push(arg)
  }
  return { positionals: Object.freeze(positionals), flags }
}

function printUsage(): void {
  console.error(
    [
      'Usage: npm run test:aris:golden -- <golden.aml-or-xml> <golden.pdf-or-png> [options]',
      '',
      'Required:',
      '  <golden.aml-or-xml>   Path to the golden ARIS AML/XML export (plan §20.1).',
      '  <golden.pdf-or-png>   Path to the matching ARIS-rendered PDF or PNG.',
      '',
      'Options:',
      '  --golden-facts=<path.json>  Per-element golden measurements to compare against',
      '                              (bounds/centers/route points/colors, keyed by source id).',
      '                              Without this, the report contains only what OrbitPM computed',
      '                              from the AML, for manual comparison against the PDF/PNG.',
      '                              See the "GoldenFacts" interface in this script for the shape.',
      '  --out=<path.json>           Where to write the structured report. Defaults to',
      '                              local-evidence/aris-phase17/golden-compare.json (git-ignored).',
      '',
      'Both inputs are treated as private customer data: the report is written only to a',
      'git-ignored path.'
    ].join('\n')
  )
}

const { positionals, flags } = parseArgs(process.argv.slice(2))
if (positionals.length < 2) {
  printUsage()
  process.exit(1)
}

const abs = (value: string): string => (isAbsolute(value) ? value : resolve(REPO, value))
const amlPath = abs(positionals[0] as string)
const visualPath = abs(positionals[1] as string)
const goldenFactsPath = flags.has('golden-facts') ? abs(flags.get('golden-facts') as string) : null
const outPath = abs(flags.get('out') ?? 'local-evidence/aris-phase17/golden-compare.json')

if (!existsSync(amlPath)) {
  console.error(`Golden AML/XML not found at ${amlPath}.`)
  process.exit(1)
}
if (!existsSync(visualPath)) {
  console.error(`Golden PDF/PNG not found at ${visualPath}.`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Privacy — mirrors scripts/aris-animalwf-loop.ts: golden exports are private
// customer data, so any derived report may only land somewhere git ignores.
// ---------------------------------------------------------------------------

function assertGitIgnored(path: string): void {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: REPO, stdio: 'ignore' })
  } catch {
    throw new Error(
      `Refusing to write ${path}: it is not git-ignored. A golden comparison report is derived ` +
        'from private customer data and must never enter the repository.'
    )
  }
}

// ---------------------------------------------------------------------------
// Digests and lightweight file sniffing (zero-dependency, best-effort)
// ---------------------------------------------------------------------------

interface FileDigest {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function digestFile(path: string): { readonly digest: FileDigest; readonly bytes: Uint8Array } {
  const bytes = new Uint8Array(readFileSync(path))
  return { digest: { path, bytes: bytes.byteLength, sha256: sha256Hex(bytes) }, bytes }
}

interface PixelDimensions {
  readonly width: number
  readonly height: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Zero-dependency PNG header read: signature + IHDR width/height, both fixed offsets. */
function pngDimensions(bytes: Uint8Array): PixelDimensions | null {
  if (bytes.length < 24) return null
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

interface PdfHeuristics {
  readonly looksLikePdf: boolean
  readonly mediaBoxPt: { readonly width: number; readonly height: number } | null
  readonly approxPageCount: number | null
  readonly note: string
}

/**
 * Best-effort, zero-dependency scan of a PDF's uncompressed structure. Real page geometry
 * extraction needs a PDF library this repo does not depend on; this only reads what a naive text
 * scan can find and says so, rather than presenting a guess as measured fact.
 */
function pdfHeuristics(bytes: Uint8Array): PdfHeuristics {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
  const looksLikePdf = text.startsWith('%PDF-')
  const mediaBoxMatch = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(text)
  const mediaBoxPt = mediaBoxMatch
    ? {
        width: Number(mediaBoxMatch[3]) - Number(mediaBoxMatch[1]),
        height: Number(mediaBoxMatch[4]) - Number(mediaBoxMatch[2])
      }
    : null
  const pageMatches = text.match(/\/Type\s*\/Page(?!s)/g)
  return {
    looksLikePdf,
    mediaBoxPt,
    approxPageCount: pageMatches ? pageMatches.length : null,
    note:
      'Best-effort scan of uncompressed PDF structure only (no PDF library is a dependency of ' +
      'this project). Compressed object streams hide this data from a naive scan, so a null or ' +
      'low result does not mean the PDF lacks it — confirm visually when this matters.'
  }
}

// ---------------------------------------------------------------------------
// Raw independent census (shares no code with src/aris/source — same rationale as
// scripts/aris-animalwf-loop.ts: a third, genuinely independent opinion on record counts)
// ---------------------------------------------------------------------------

interface RawCensus {
  readonly bytes: number
  readonly counts: Readonly<Record<string, number>>
}

function rawCensus(text: string): RawCensus {
  const counts: Record<string, number> = {}
  const pattern = /<([A-Za-z_][\w.-]*)(\s[^>]*?)?(\/)?>/g
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match !== null) {
    const name = match[1] as string
    counts[name] = (counts[name] ?? 0) + 1
    match = pattern.exec(text)
  }
  return { bytes: Buffer.byteLength(text, 'utf8'), counts: Object.freeze(counts) }
}

interface CountField {
  readonly label: string
  readonly raw: number
  readonly semanticIndex: number
  readonly workingModel: number | null
  readonly workingModelApproximate: boolean
  readonly agree: boolean
}

function countField(
  label: string,
  raw: number,
  semanticIndex: number,
  workingModel: number | null,
  workingModelApproximate = false
): CountField {
  // Raw vs semantic-index must always agree exactly — two independent parses of the same bytes
  // disagreeing would be a real parser bug. The working-model figure only has to agree when it is
  // not flagged approximate; an approximate figure is shown for transparency but never gates.
  const agree =
    workingModel === null || workingModelApproximate
      ? raw === semanticIndex
      : raw === semanticIndex && semanticIndex === workingModel
  return { label, raw, semanticIndex, workingModel, workingModelApproximate, agree }
}

// ---------------------------------------------------------------------------
// Optional golden-facts comparison (the real two-sided §20.2 check, once the user or a future
// extraction pass supplies per-element golden measurements)
// ---------------------------------------------------------------------------

interface GoldenFactElement {
  readonly sourceId: string
  readonly text?: string
  readonly boundsPx?: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly centerPx?: { readonly x: number; readonly y: number }
  readonly colorHex?: string
}

interface GoldenFactConnection {
  readonly sourceId: string
  readonly bendPointsPx?: readonly { readonly x: number; readonly y: number }[]
}

/**
 * Shape a `--golden-facts` file must have. Every field is optional per entry: supply whatever was
 * measured off the golden PDF/PNG (by hand today, by a future OCR/vector-extraction pass later)
 * and the comparator checks exactly that subset.
 */
interface GoldenFacts {
  readonly counts?: Readonly<Record<string, number>>
  readonly elements?: readonly GoldenFactElement[]
  readonly connections?: readonly GoldenFactConnection[]
}

function loadGoldenFacts(path: string): GoldenFacts {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${path} does not contain a JSON object.`)
  }
  return parsed as GoldenFacts
}

function distancePx(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { digest: amlDigest, bytes: amlBytes } = digestFile(amlPath)
  const { digest: visualDigest, bytes: visualBytes } = digestFile(visualPath)

  // "Import the golden AML through the existing parser" + "Build the semantic index":
  // `createArisXmlSourcePackage` (src/aris/source/sourcePackage.ts) is the one real entry point
  // that does both — tokenize (src/aris/source/xmlTokenizer.ts) then build the semantic index
  // (src/aris/source/semanticIndex.ts) — exactly as scripts/performance-gate.ts and
  // scripts/aris-animalwf-loop.ts already do. No `parseAmlDocument` export exists in this
  // codebase; this is the real, current API for it.
  const pkg = await createArisXmlSourcePackage({
    name: basename(amlPath),
    relPath: null,
    bytes: amlBytes
  })
  const studio = buildArisStudioDocument(pkg)
  const raw = rawCensus(pkg.text)
  const rawCount = (name: string): number => raw.counts[name] ?? 0

  // --- counts (§20.2 "Model/object/connection counts") ---------------------

  // A name (`AT_NAME`) is its own `<AttrDef>` in the source, but the working model splits it out
  // of `.attributes` into its own `.names` field for every owner kind (definitions, models, lanes,
  // free text). Counting `.attributes.length` alone therefore misses one AttrDef per named owner;
  // this reconstructs that so the working-model figure is close to, not wildly under, the raw and
  // semantic-index counts. It is still marked `workingModelApproximate` below because AttrDef can
  // also appear under owners the working model does not represent at all (e.g. `<Group>`), so an
  // exact reconciliation is the accounting lane's job (`src/aris/accounting`), not this script's.
  const hasNameRecord = (value: ArisLocalizedValue): boolean => Object.keys(value.values).length > 0

  let wmObjectOccurrences = 0
  let wmConnectionOccurrences = 0
  let wmLanes = 0
  let wmFreeTextOccurrences = 0
  let wmAttachmentOccurrences = 0
  let wmAttributeDefinitionsApprox = 0
  let wmAttributeOccurrences = 0
  const freeTextDefinitionIdsSeen = new Set<string>()
  const attachmentDefinitionIdsSeen = new Set<string>()

  for (const model of studio.source.models.values()) {
    wmObjectOccurrences += model.occurrences.length
    wmConnectionOccurrences += model.connectionOccurrences.length
    wmLanes += model.lanes.length
    wmFreeTextOccurrences += model.freeText.length
    wmAttachmentOccurrences += model.attachments.length
    wmAttributeDefinitionsApprox += model.attributes.length + (hasNameRecord(model.names) ? 1 : 0)
    for (const occurrence of model.occurrences)
      wmAttributeOccurrences += occurrence.attributeOccurrences.length
    for (const connection of model.connectionOccurrences) {
      wmAttributeOccurrences += connection.attributeOccurrences.length
    }
    for (const lane of model.lanes) {
      wmAttributeDefinitionsApprox += hasNameRecord(lane.names) ? 1 : 0
    }
    for (const text of model.freeText) {
      if (text.definitionId) freeTextDefinitionIdsSeen.add(text.definitionId)
      wmAttributeDefinitionsApprox += text.attributes.length + (hasNameRecord(text.text) ? 1 : 0)
    }
    for (const attachment of model.attachments) {
      if (attachment.definitionId) attachmentDefinitionIdsSeen.add(attachment.definitionId)
    }
  }
  for (const definition of studio.source.objectDefinitions.values()) {
    wmAttributeDefinitionsApprox +=
      definition.attributes.length + (hasNameRecord(definition.names) ? 1 : 0)
  }
  for (const definition of studio.source.connectionDefinitions.values()) {
    wmAttributeDefinitionsApprox +=
      definition.attributes.length + (hasNameRecord(definition.names) ? 1 : 0)
  }

  const counts: readonly CountField[] = Object.freeze([
    countField('models', rawCount('Model'), pkg.index.models.size, studio.source.models.size),
    countField(
      'objectDefinitions',
      rawCount('ObjDef'),
      pkg.index.objectDefinitions.size,
      studio.source.objectDefinitions.size
    ),
    countField(
      'objects (ObjOcc)',
      rawCount('ObjOcc'),
      pkg.index.objectOccurrences.size,
      wmObjectOccurrences
    ),
    countField(
      'connectionDefinitions',
      rawCount('CxnDef'),
      pkg.index.connectionDefinitions.size,
      studio.source.connectionDefinitions.size
    ),
    countField(
      'connections (CxnOcc)',
      rawCount('CxnOcc'),
      pkg.index.connectionOccurrences.size,
      wmConnectionOccurrences
    ),
    countField(
      'attributeDefinitions (AttrDef)',
      rawCount('AttrDef'),
      pkg.index.attributes.length,
      wmAttributeDefinitionsApprox,
      true
    ),
    countField(
      'attributeOccurrences (AttrOcc)',
      rawCount('AttrOcc'),
      pkg.index.attributeOccurrences.length,
      wmAttributeOccurrences
    ),
    countField('lanes', rawCount('Lane'), pkg.index.lanes.size, wmLanes),
    countField(
      'freeTextDefinitions (FFTextDef)',
      rawCount('FFTextDef'),
      pkg.index.freeText.size,
      freeTextDefinitionIdsSeen.size,
      true
    ),
    countField(
      'freeText (FFTextOcc)',
      rawCount('FFTextOcc'),
      pkg.index.freeTextOccurrences.length,
      wmFreeTextOccurrences
    ),
    countField(
      'attachmentDefinitions (OLEDef)',
      rawCount('OLEDef'),
      pkg.index.attachments.size,
      attachmentDefinitionIdsSeen.size,
      true
    ),
    countField(
      'attachments (OLEOcc)',
      rawCount('OLEOcc'),
      pkg.index.attachmentOccurrences.length,
      wmAttachmentOccurrences
    )
  ])
  const countMismatches = counts.filter((field) => !field.agree)

  // --- per-model render facts (§20.2: identity/text, bounds/centers, route bends, colors,
  //     fonts, text wrapping, z-order, satellites, lanes, free text) -------

  interface ElementFact {
    readonly modelId: string
    readonly id: string
    readonly sourceId: string | null
    readonly objectDefinitionId: string | null
    readonly objectType: string
    readonly symbolNum: string
    readonly isSatellite: boolean
    readonly names: Readonly<Record<string, string>>
    readonly displayText: string | null
    readonly bounds: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
    readonly centerPx: { readonly x: number; readonly y: number }
    readonly zOrder: number
    readonly penColorHex: string | null
    readonly brushFillHex: string | null
    readonly font: {
      readonly family: string
      readonly sizePx: number
      readonly weight: number
      readonly requestedFaceName: string | null
      readonly faceAvailable: boolean
    } | null
    readonly wrapped: boolean
  }

  interface ConnectionFact {
    readonly modelId: string
    readonly id: string
    readonly sourceId: string | null
    readonly connectionType: string | null
    readonly fromElementId: string | null
    readonly toElementId: string | null
    readonly zOrder: number
    readonly penColorHex: string | null
    readonly bendPoints: readonly { readonly x: number; readonly y: number }[]
  }

  interface LaneFact {
    readonly modelId: string
    readonly id: string
    readonly sourceId: string | null
    readonly names: Readonly<Record<string, string>>
    readonly orientation: string | null
    readonly startBorder: number | null
    readonly endBorder: number | null
  }

  interface FreeTextFact {
    readonly modelId: string
    readonly id: string
    readonly sourceId: string | null
    readonly text: string | null
    readonly isModelAttributePlaceholder: boolean
    readonly bounds: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
    readonly zOrder: number
  }

  const elements: ElementFact[] = []
  const connections: ConnectionFact[] = []
  const lanes: LaneFact[] = []
  const freeTexts: FreeTextFact[] = []
  const unrenderedModels: {
    readonly id: string
    readonly type: string
    readonly reason: string
  }[] = []

  const renderableModelIds = new Set(studio.renderModels.map((model) => model.modelId))
  for (const summary of studio.models) {
    if (!renderableModelIds.has(summary.id)) {
      unrenderedModels.push({
        id: summary.id,
        type: summary.type,
        reason: summary.renderable
          ? 'not present in the render model output'
          : 'model type is outside the supported scope (plan §11.2)'
      })
    }
  }

  for (const renderModel of studio.renderModels) {
    for (const element of renderModel.elements) {
      const definition = element.objectDefinitionId
        ? studio.source.objectDefinitions.get(element.objectDefinitionId)
        : undefined
      elements.push({
        modelId: renderModel.modelId,
        id: element.id,
        sourceId: element.anchor.sourceId,
        objectDefinitionId: element.objectDefinitionId,
        objectType: element.objectType,
        symbolNum: element.symbolNum,
        isSatellite: isSatelliteObjectType(element.objectType),
        names: definition ? definition.names.values : {},
        displayText:
          element.name?.rawText ?? (definition ? arisText(definition.names, 'en') : null),
        bounds: element.sourceBounds,
        centerPx: {
          x: element.sourceBounds.x + element.sourceBounds.width / 2,
          y: element.sourceBounds.y + element.sourceBounds.height / 2
        },
        zOrder: element.zOrder,
        penColorHex: element.pen?.color ?? null,
        brushFillHex: element.brush
          ? element.brush.fill === 'none'
            ? null
            : element.brush.fill
          : null,
        font: element.name
          ? {
              family: element.name.font.fontFamily,
              sizePx: element.name.font.sizePx,
              weight: element.name.font.weight,
              requestedFaceName: element.name.font.requestedFaceName,
              faceAvailable: element.name.font.faceAvailable
            }
          : null,
        wrapped: element.name?.wrapped ?? false
      })
    }
    for (const connection of renderModel.connections) {
      connections.push({
        modelId: renderModel.modelId,
        id: connection.id,
        sourceId: connection.anchor.sourceId,
        connectionType: connection.connectionType,
        fromElementId: connection.fromElementId,
        toElementId: connection.toElementId,
        zOrder: connection.zOrder,
        penColorHex: connection.pen?.color ?? null,
        bendPoints: connection.sourceRoutePoints
      })
    }
    for (const lane of renderModel.lanes) {
      lanes.push({
        modelId: renderModel.modelId,
        id: lane.id,
        sourceId: lane.anchor.sourceId,
        names: {},
        orientation: lane.orientation,
        startBorder: lane.startBorder,
        endBorder: lane.endBorder
      })
    }
    for (const freeText of renderModel.freeText) {
      freeTexts.push({
        modelId: renderModel.modelId,
        id: freeText.id,
        sourceId: freeText.anchor.sourceId,
        text: freeText.text?.rawText ?? null,
        isModelAttributePlaceholder: freeText.modelAttributeBinding !== null,
        bounds: freeText.sourceBounds,
        zOrder: freeText.zOrder
      })
    }
  }

  const satelliteElements = elements.filter((element) => element.isSatellite)
  const wrappedElements = elements.filter((element) => element.wrapped)
  const fontsUsed = new Map<
    string,
    { family: string; sizePx: number; faceAvailable: boolean; count: number }
  >()
  for (const element of elements) {
    if (!element.font) continue
    const key = `${element.font.family}@${element.font.sizePx}`
    const existing = fontsUsed.get(key)
    if (existing) existing.count += 1
    else {
      fontsUsed.set(key, {
        family: element.font.family,
        sizePx: element.font.sizePx,
        faceAvailable: element.font.faceAvailable,
        count: 1
      })
    }
  }

  // --- fidelity (§20.2/§20.4 explicit-blocker requirement) ------------------

  const fidelityFindings = studio.fidelity.map((finding) => ({
    kind: finding.kind,
    hardBlocker: HARD_FIDELITY_KINDS.has(finding.kind),
    modelId: finding.modelId,
    elementId: finding.elementId,
    sourceId: finding.sourceId,
    messageKey: finding.messageKey,
    params: finding.params
  }))
  const hardBlockers = fidelityFindings.filter((finding) => finding.hardBlocker)

  // --- golden reference metadata (§20.1) ------------------------------------

  const visualKind =
    extname(visualPath).toLowerCase() === '.png'
      ? 'png'
      : extname(visualPath).toLowerCase() === '.pdf'
        ? 'pdf'
        : 'unknown'
  const pngDims = visualKind === 'png' ? pngDimensions(visualBytes) : null
  const pdfInfo = visualKind === 'pdf' ? pdfHeuristics(visualBytes) : null

  const goldenReference = {
    aml: amlDigest,
    visual: { ...visualDigest, kind: visualKind, pngDimensionsPx: pngDims, pdfHeuristics: pdfInfo },
    // §20.1 step 2: recorded manually, never guessed. Filled with `null` so the report's shape
    // documents exactly what a human must supply; nothing here is fabricated.
    metadataToRecordManually: {
      targetArisVersion: null,
      databaseTemplate: null,
      palette: null,
      fonts: null,
      language: null,
      zoom: null,
      pageSize: null,
      exportSettings: null
    }
  }

  // --- optional two-sided comparison against measured golden facts ---------

  interface FactMismatch {
    readonly sourceId: string
    readonly kind: 'bounds' | 'center' | 'route' | 'text' | 'color' | 'route-bend-count'
    readonly detail: string
  }

  let goldenComparison: {
    readonly performed: boolean
    readonly factsPath: string | null
    readonly elementsChecked: number
    readonly connectionsChecked: number
    readonly mismatches: readonly FactMismatch[]
  } = {
    performed: false,
    factsPath: null,
    elementsChecked: 0,
    connectionsChecked: 0,
    mismatches: []
  }

  if (goldenFactsPath) {
    const facts = loadGoldenFacts(goldenFactsPath)
    const elementBySourceId = new Map(
      elements.filter((el) => el.sourceId).map((el) => [el.sourceId as string, el])
    )
    const connectionBySourceId = new Map(
      connections.filter((cx) => cx.sourceId).map((cx) => [cx.sourceId as string, cx])
    )
    const mismatches: FactMismatch[] = []
    let elementsChecked = 0
    let connectionsChecked = 0

    for (const factElement of facts.elements ?? []) {
      const actual = elementBySourceId.get(factElement.sourceId)
      if (!actual) {
        mismatches.push({
          sourceId: factElement.sourceId,
          kind: 'text',
          detail: 'golden-facts references a source id OrbitPM did not render'
        })
        continue
      }
      elementsChecked += 1
      if (factElement.text !== undefined && factElement.text !== (actual.displayText ?? '')) {
        mismatches.push({
          sourceId: factElement.sourceId,
          kind: 'text',
          detail: `golden text "${factElement.text}" vs OrbitPM "${actual.displayText ?? ''}"`
        })
      }
      if (factElement.colorHex !== undefined) {
        const actualColor = (actual.penColorHex ?? actual.brushFillHex ?? '').toLowerCase()
        if (actualColor !== factElement.colorHex.toLowerCase()) {
          mismatches.push({
            sourceId: factElement.sourceId,
            kind: 'color',
            detail: `golden color ${factElement.colorHex} vs OrbitPM ${actualColor || '(none)'}`
          })
        }
      }
      if (factElement.centerPx) {
        const delta = distancePx(factElement.centerPx, actual.centerPx)
        if (delta > BOUNDS_TOLERANCE_PX) {
          mismatches.push({
            sourceId: factElement.sourceId,
            kind: 'center',
            detail: `center delta ${delta.toFixed(2)}px exceeds ${BOUNDS_TOLERANCE_PX}px tolerance`
          })
        }
      }
      if (factElement.boundsPx) {
        const b = factElement.boundsPx
        const cornerDelta = distancePx(
          { x: b.x, y: b.y },
          { x: actual.bounds.x, y: actual.bounds.y }
        )
        const sizeDeltaX = Math.abs(b.width - actual.bounds.width)
        const sizeDeltaY = Math.abs(b.height - actual.bounds.height)
        if (
          cornerDelta > BOUNDS_TOLERANCE_PX ||
          sizeDeltaX > BOUNDS_TOLERANCE_PX ||
          sizeDeltaY > BOUNDS_TOLERANCE_PX
        ) {
          mismatches.push({
            sourceId: factElement.sourceId,
            kind: 'bounds',
            detail:
              `corner delta ${cornerDelta.toFixed(2)}px, size delta (${sizeDeltaX.toFixed(2)}, ` +
              `${sizeDeltaY.toFixed(2)})px exceeds ${BOUNDS_TOLERANCE_PX}px tolerance`
          })
        }
      }
    }

    for (const factConnection of facts.connections ?? []) {
      const actual = connectionBySourceId.get(factConnection.sourceId)
      if (!actual) {
        mismatches.push({
          sourceId: factConnection.sourceId,
          kind: 'route',
          detail: 'golden-facts references a connection source id OrbitPM did not render'
        })
        continue
      }
      connectionsChecked += 1
      const golden = factConnection.bendPointsPx ?? []
      if (golden.length !== actual.bendPoints.length) {
        mismatches.push({
          sourceId: factConnection.sourceId,
          kind: 'route-bend-count',
          detail: `golden has ${golden.length} bend point(s), OrbitPM has ${actual.bendPoints.length}`
        })
        continue
      }
      golden.forEach((point, index) => {
        const delta = distancePx(point, actual.bendPoints[index] as { x: number; y: number })
        if (delta > ROUTE_TOLERANCE_PX) {
          mismatches.push({
            sourceId: factConnection.sourceId,
            kind: 'route',
            detail: `bend point ${index} delta ${delta.toFixed(2)}px exceeds ${ROUTE_TOLERANCE_PX}px tolerance`
          })
        }
      })
    }

    goldenComparison = {
      performed: true,
      factsPath: goldenFactsPath,
      elementsChecked,
      connectionsChecked,
      mismatches: Object.freeze(mismatches)
    }
  }

  // --- assemble + write report ----------------------------------------------

  const report = {
    schemaVersion: 1,
    gate: 'orbitpm-aris-golden-visual-compare',
    planSection: '20.2',
    generatedAt: new Date().toISOString(),
    goldenReference,
    parserDiagnostics: pkg.diagnostics,
    accounting: {
      totalSourceRecords: studio.accounting.totalSourceRecords,
      totalAccounted: studio.accounting.totalAccounted,
      unaccountedCount: studio.accounting.unaccountedCount,
      issues: studio.accounting.issues.length
    },
    counts,
    countMismatches,
    unrenderedModels,
    perModel: studio.models.map((summary) => ({
      id: summary.id,
      type: summary.type,
      renderable: summary.renderable,
      names: summary.names.values,
      objectCount: summary.objectCount,
      connectionCount: summary.connectionCount
    })),
    tolerances: { boundsPx: BOUNDS_TOLERANCE_PX, routePx: ROUTE_TOLERANCE_PX },
    orbitpmRenders: {
      elements,
      connections,
      lanes,
      freeText: freeTexts,
      satellites: {
        count: satelliteElements.length,
        elementIds: satelliteElements.map((e) => e.id)
      },
      textWrapping: {
        wrappedCount: wrappedElements.length,
        elementIds: wrappedElements.map((e) => e.id)
      },
      fontsUsed: [...fontsUsed.values()]
    },
    fidelity: {
      byKind: studio.fidelityByKind,
      findings: fidelityFindings,
      hardBlockerCount: hardBlockers.length,
      hardBlockers
    },
    goldenComparison
  }

  mkdirSync(dirname(outPath), { recursive: true })
  assertGitIgnored(outPath)
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  // --- console summary -------------------------------------------------------

  console.log('')
  console.log(`ARIS golden visual comparison — plan §20.2`)
  console.log(`golden AML   ${amlPath} (${amlDigest.bytes} bytes, sha256 ${amlDigest.sha256})`)
  console.log(
    `golden visual ${visualPath} (${visualDigest.bytes} bytes, sha256 ${visualDigest.sha256}, ${visualKind})`
  )
  if (pngDims) console.log(`  PNG dimensions: ${pngDims.width}x${pngDims.height}px`)
  if (pdfInfo) {
    console.log(
      `  PDF heuristics: looksLikePdf=${pdfInfo.looksLikePdf} mediaBoxPt=${
        pdfInfo.mediaBoxPt ? `${pdfInfo.mediaBoxPt.width}x${pdfInfo.mediaBoxPt.height}` : 'unknown'
      } approxPages=${pdfInfo.approxPageCount ?? 'unknown'}`
    )
  }
  console.log('')
  console.log('counts (raw tag census / semantic index / working model):')
  for (const field of counts) {
    const wm =
      field.workingModel === null
        ? 'n/a'
        : `${field.workingModel}${field.workingModelApproximate ? '~' : ''}`
    console.log(
      `  ${field.agree ? 'OK  ' : 'DIFF'} ${field.label}: raw=${field.raw} index=${field.semanticIndex} model=${wm}`
    )
  }
  console.log('')
  console.log(
    `elements=${elements.length} connections=${connections.length} lanes=${lanes.length} ` +
      `freeText=${freeTexts.length} satellites=${satelliteElements.length} wrapped=${wrappedElements.length}`
  )
  console.log('')
  console.log('fidelity findings by kind:')
  for (const [kind, count] of Object.entries(studio.fidelityByKind)) {
    if (count === 0) continue
    console.log(
      `  ${HARD_FIDELITY_KINDS.has(kind as ArisRenderFidelityKind) ? 'BLOCKER' : 'note   '} ${kind}: ${count}`
    )
  }
  if (hardBlockers.length === 0) console.log('  none')
  console.log('')
  if (goldenComparison.performed) {
    console.log(
      `golden-facts comparison: ${goldenComparison.elementsChecked} element(s) / ` +
        `${goldenComparison.connectionsChecked} connection(s) checked, ${goldenComparison.mismatches.length} mismatch(es)`
    )
    for (const mismatch of goldenComparison.mismatches) {
      console.log(`  [${mismatch.kind}] ${mismatch.sourceId}: ${mismatch.detail}`)
    }
  } else {
    console.log(
      'golden-facts comparison: skipped (no --golden-facts supplied). The report above holds ' +
        "OrbitPM's own computed bounds/centers/routes/colors/fonts for manual comparison against " +
        'the golden PDF/PNG. Supply --golden-facts=<path.json> for the automated 2px/3px-tolerance check.'
    )
  }
  console.log('')
  console.log(`report written to ${outPath}`)

  const blocked =
    studio.accounting.unaccountedCount > 0 ||
    countMismatches.length > 0 ||
    hardBlockers.length > 0 ||
    (goldenComparison.performed && goldenComparison.mismatches.length > 0)

  if (blocked) {
    console.log('')
    console.log(
      'Phase 17 §20.4 visual gate: NOT CLEAN — see countMismatches / fidelity.hardBlockers / ' +
        'goldenComparison.mismatches in the report. §20.4 allows the gate to pass with EXPLICITLY ' +
        'accepted external-resource gaps (e.g. a missing proprietary font); that acceptance is a ' +
        'human decision this script cannot make, so it exits non-zero either way.'
    )
    process.exitCode = 1
  } else {
    console.log('')
    console.log('Phase 17 §20.4 visual gate: automated checks clean.')
  }
}

await main()
