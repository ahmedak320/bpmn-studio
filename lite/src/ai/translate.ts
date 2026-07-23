// "Translate with AI": fill the MISSING half of every element's bilingual name
// pair (`orbitpm:nameEn` / `orbitpm:nameAr`) through an injected LLM call.
//
// Relationship to editor/langToggle.ts (read that module first): the toggle
// SWITCHES the visible `name` between two STORED translations and counts the
// sides it could not switch as `missing` — this module is the thing that
// creates those missing sides. It never touches the visible `name` itself: a
// run leaves the diagram looking identical, only the stored attrs (and, when
// absent, the diagram-level `orbitpm:activeLang` flag) change, so the very
// next toggle can switch cleanly. Element iteration follows the toggle's
// rules exactly: external labels are skipped (`labelTarget` truthy — they
// share their target's business object, so processing them would double-count
// and double-write), connections are included (flow-condition names), and the
// participants-aware process root — resolved via the toggle's own
// `pickRootBusinessObject` — is processed too (its `name` is the process
// title), deduplicated by business-object identity in case the registry
// already contains it as the canvas root.
//
// Direction semantics — "both directions in one run": each element is
// resolved independently, so a single diagram can simultaneously hold
// English-labeled elements missing their Arabic side (ARIS/DMT exports) and
// Arabic-labeled elements missing their English side; the two groups go out
// as separate per-direction prompts. The diagram-level ACTIVE language
// matters only for an element with NEITHER attr stored: there the visible
// name is adopted as the active-language attr (the same self-healing
// write-back the toggle performs — deferred to the APPLY step so
// `collectMissingTranslations` stays strictly read-only) and only the OTHER
// side is sent for translation. When exactly one side is stored, that stored
// value is the translation source and the missing side is the target — the
// seed deliberately does NOT fire there: the missing side is about to be
// filled by a real translation, and seeding it with the visible name instead
// would (a) fight the translation for the same attribute and (b) on a failed
// chunk permanently pollute the attr with wrong-language text, hiding the
// element from every future re-run.
//
// Failure semantics: a chunk whose response cannot be parsed as a JSON object
// (after ONE retry with a terser reminder appended) gives up — its entries
// count as `skipped`, nothing is written for them, and a later re-run picks
// them up again. Per-entry validation failures (wrong script, empty, or
// non-string values) are skipped the same way. A REJECTED `callLLM`
// (auth/rate/network — see browserAi.ts's TransportError) is NOT swallowed:
// it propagates so the caller can surface the real provider failure instead
// of a misleading "0 translated" outcome.
//
// Kept bpmn-js-free and typed against the same minimal STRUCTURAL modeler
// shape as langToggle.ts, so the node-environment vitest suite drives it with
// plain object fakes — see src/ai/__tests__/translate.test.ts.

import { arabicRatio, detectActiveLang, parseJsonLoose, type CallLLM, type LlmMessage } from '@app/gen'
import { pickRootBusinessObject, type DiagramLang } from '../editor/langToggle'

// --- public shapes -----------------------------------------------------------

/** One missing-translation work item: translate `text` into `target` and store
 *  the result on the element with id `id` (as orbitpm:nameEn / nameAr). */
export interface TranslateEntry {
  id: string
  text: string
  target: 'en' | 'ar'
}

/** What a run achieved. `total` = entries collected; every entry ends up either
 *  `translated` (validated + applied) or `skipped` (parse/validation failure or
 *  missing from the model's response) — `translated + skipped === total`. */
export interface TranslateOutcome {
  translated: number
  skipped: number
  total: number
}

/** Same single generic `get()` surface as langToggle's LangToggleModeler —
 *  callers hand in their real bpmn-js Modeler as-is; tests hand in a fake. */
export interface TranslateModeler {
  get(name: string): unknown
}

// --- structural service/element shapes (internal wiring only) ---------------
// Copies of langToggle.ts's internal shapes — not exported there, and the
// repo's convention for small structural/pure helpers is a local copy per
// module (see langToggle.ts's own note about org/orgModel.ts).

interface BusinessObjectLike {
  $type?: string
  $attrs?: Record<string, unknown>
  name?: string
  get?: (name: string) => unknown
  [key: string]: unknown
}

interface LangElementLike {
  /** Registry element id — the id the LLM round-trip is keyed on. */
  id?: unknown
  businessObject?: BusinessObjectLike
  /** Truthy on external-label shapes; skipped unconditionally (see module doc). */
  labelTarget?: unknown
}

interface CanvasLike {
  getRootElement(): LangElementLike | undefined
}

interface ElementRegistryLike {
  getAll(): LangElementLike[]
}

interface ModelingLike {
  updateProperties(element: unknown, properties: Record<string, unknown>): void
}

// --- attribute names ---------------------------------------------------------

const ATTR_NAME_EN = 'orbitpm:nameEn'
const ATTR_NAME_AR = 'orbitpm:nameAr'
const ATTR_ACTIVE_LANG = 'orbitpm:activeLang'

const LANG_ATTR: Record<DiagramLang, string> = {
  en: ATTR_NAME_EN,
  ar: ATTR_NAME_AR
}

function otherLang(lang: DiagramLang): DiagramLang {
  return lang === 'en' ? 'ar' : 'en'
}

// --- dual-world attribute reading (copies of langToggle.ts's readers) --------

/** Read a plain (non-prefixed) moddle property such as `name` or `id`. */
function readModdleProp(bo: BusinessObjectLike | undefined, name: string): unknown {
  if (!bo) return undefined
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get(name)
      if (value !== undefined) return value
    } catch {
      /* fall through to a direct property read */
    }
  }
  return bo[name]
}

/** Read one `orbitpm:*` attribute. Empty string counts as absent. */
function readAttr(bo: BusinessObjectLike | undefined, name: string): string | undefined {
  if (!bo) return undefined
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get(name)
      if (value != null && value !== '') return String(value)
    } catch {
      /* fall through to $attrs */
    }
  }
  const raw = bo.$attrs?.[name]
  if (raw != null && raw !== '') return String(raw)
  return undefined
}

/** The element's current visible name, or '' if unset/not a string. */
function readName(bo: BusinessObjectLike | undefined): string {
  const value = readModdleProp(bo, 'name')
  return typeof value === 'string' ? value : ''
}

/** The id used to key the LLM payload: the registry element's own id when
 *  present, else the business object's (the wrapped collab processRef has no
 *  registry element of its own). '' means "cannot round-trip — skip". */
function readId(element: LangElementLike | undefined, bo: BusinessObjectLike): string {
  const elementId = element?.id
  if (typeof elementId === 'string' && elementId !== '') return elementId
  const boId = readModdleProp(bo, 'id')
  return typeof boId === 'string' ? boId : ''
}

// --- prompt ------------------------------------------------------------------

/** System-style instruction, sent inside the single user message per chunk. */
export const TRANSLATE_INSTRUCTION =
  'You translate BUSINESS PROCESS diagram labels between English and Arabic for a UAE government ' +
  'context. Translate each value faithfully and concisely; Modern Standard Arabic (never ' +
  'transliteration); keep numbers, codes, and proper nouns like DMT as-is; return ONLY a JSON ' +
  'object mapping each id to its translation, no commentary.'

/** Appended (once) to the re-sent prompt after an unparseable response. */
const RETRY_REMINDER =
  'Reminder: respond with ONLY the JSON object mapping each id to its translation — no prose, no markdown fences.'

/** Generous per-call budget: 60 labels plus JSON overhead sits far below this
 *  even in Arabic script. Timeouts are callLLM's own concern, not ours. */
export const TRANSLATE_MAX_TOKENS = 4000

const DEFAULT_CHUNK_SIZE = 60

function buildPrompt(target: DiagramLang, payload: Record<string, string>): string {
  const direction = target === 'ar' ? 'Arabic' : 'English'
  return (
    `${TRANSLATE_INSTRUCTION}\n\n` +
    `Target language for every value in this request: ${direction}. Keep every key exactly as given.\n\n` +
    JSON.stringify(payload)
  )
}

// --- diagram resolution (pure, shared by collect + translate) ---------------

/** Per-element plan: at most ONE entry (see module doc — the seed satisfies
 *  the active side in the both-missing case, and a single-missing side is a
 *  single target), plus the optional write-back seed applied alongside it. */
interface ResolvedElement {
  /** What modeling.updateProperties receives — the registry element, or a
   *  `{ businessObject }` wrapper for a shapeless collab processRef (bpmn-js's
   *  UpdatePropertiesHandler reads `element.businessObject` directly — see
   *  langToggle.ts's root-write note). */
  target: unknown
  /** Active-language write-back ({ 'orbitpm:nameXx': visibleName }) — present
   *  only when BOTH stored attrs were missing. */
  seed?: Record<string, string>
  entry?: TranslateEntry
}

interface DiagramResolution {
  elements: ResolvedElement[]
  /** The diagram's active language: the stored orbitpm:activeLang when present
   *  ('ar' iff exactly 'ar', mirroring getDiagramLang's strictness), otherwise
   *  detected from the visible labels (majority-Arabic → 'ar'). */
  activeLang: DiagramLang
  /** Present when orbitpm:activeLang was ABSENT and must be stamped at apply. */
  rootStamp?: { target: unknown; lang: DiagramLang }
}

/**
 * Single read-only sweep over the diagram producing everything both public
 * functions need. Iteration mirrors toggleDiagramLang: every registry element
 * except external labels, connections included; then the process root (via
 * pickRootBusinessObject) if the registry didn't already surface its business
 * object. Only elements with a non-empty visible `name` participate.
 */
function resolveDiagram(modeler: TranslateModeler): DiagramResolution {
  const elementRegistry = modeler.get('elementRegistry') as ElementRegistryLike
  const canvas = modeler.get('canvas') as CanvasLike

  interface Gathered {
    target: unknown
    bo: BusinessObjectLike
    id: string
    name: string
  }
  const gathered: Gathered[] = []
  const seen = new Set<BusinessObjectLike>()
  const labels: string[] = []

  for (const element of elementRegistry.getAll()) {
    if (element.labelTarget != null) continue
    const bo = element.businessObject
    if (!bo || seen.has(bo)) continue
    seen.add(bo)
    const name = readName(bo)
    if (name.trim() === '') continue
    labels.push(name)
    gathered.push({ target: element, bo, id: readId(element, bo), name })
  }

  // The process root itself — the process title is translatable too. In a
  // plain-process diagram the registry usually already yielded it (the canvas
  // root is a registered element sharing the same business object, so the
  // `seen` set deduplicates); in a collaboration the processRef has no shape
  // of its own and must be added here, wrapped for updateProperties.
  const root = canvas.getRootElement()
  const rootBo = pickRootBusinessObject(modeler)
  let rootTarget: unknown
  if (rootBo) {
    // The canvas root element when it carries the process directly; a wrapper
    // for a shapeless collab processRef. The id comes from the root ELEMENT in
    // the direct case (registry elements are keyed by it) and from the
    // business object itself in the wrapped case.
    const rootIsElement = root !== undefined && root.businessObject === rootBo
    rootTarget = rootIsElement ? root : { businessObject: rootBo }
    if (!seen.has(rootBo)) {
      seen.add(rootBo)
      const name = readName(rootBo)
      if (name.trim() !== '') {
        labels.push(name)
        gathered.push({
          target: rootTarget,
          bo: rootBo,
          id: readId(rootIsElement ? root : undefined, rootBo),
          name
        })
      }
    }
  }

  // Active language: the stored flag wins (any non-'ar' value reads as 'en',
  // same as getDiagramLang, and a present-but-odd value is NOT re-stamped);
  // when absent, detect from the visible labels and stamp at apply time.
  const storedLang = readAttr(rootBo, ATTR_ACTIVE_LANG)
  const activeLang: DiagramLang =
    storedLang !== undefined ? (storedLang === 'ar' ? 'ar' : 'en') : detectActiveLang(labels)
  const rootStamp =
    rootBo && storedLang === undefined ? { target: rootTarget, lang: activeLang } : undefined

  const elements: ResolvedElement[] = []
  for (const g of gathered) {
    const en = readAttr(g.bo, ATTR_NAME_EN)
    const ar = readAttr(g.bo, ATTR_NAME_AR)
    if (en !== undefined && ar !== undefined) continue // both stored — toggle-ready

    // Without an id the translation cannot round-trip through the LLM's JSON
    // response, so the element is left for a manual pass (never happens for
    // real bpmn-js elements, which always carry ids).
    if (g.id === '') continue

    let seed: Record<string, string> | undefined
    let entry: TranslateEntry | undefined
    if (en === undefined && ar === undefined) {
      // Neither side stored: the visible name IS the active language's text
      // (the toggle's self-healing rule), so it becomes the active attr via
      // the apply-step seed, and only the other side needs the model.
      seed = { [LANG_ATTR[activeLang]]: g.name }
      entry = { id: g.id, text: g.name, target: otherLang(activeLang) }
    } else if (ar !== undefined) {
      // nameEn missing — translate FROM the stored Arabic value.
      entry = { id: g.id, text: ar, target: 'en' }
    } else if (en !== undefined) {
      // nameAr missing — translate FROM the stored English value.
      entry = { id: g.id, text: en, target: 'ar' }
    }

    // Never emit an entry with an empty source text (e.g. a stored attr that
    // is only whitespace — readAttr already treats '' as absent).
    if (entry !== undefined && entry.text.trim() === '') entry = undefined
    if (entry === undefined && seed === undefined) continue

    elements.push({ target: g.target, seed, entry })
  }

  return { elements, activeLang, rootStamp }
}

/**
 * Read-only preview of what {@link translateDiagram} would send to the model:
 * one entry per element that is missing a stored translation side. Useful for
 * a "nothing to translate" pre-check and for sizing the run. Performs no
 * writes — the write-back seed described in the module doc happens only
 * inside translateDiagram's apply step.
 */
export function collectMissingTranslations(modeler: TranslateModeler): TranslateEntry[] {
  const out: TranslateEntry[] = []
  for (const el of resolveDiagram(modeler).elements) {
    if (el.entry) out.push(el.entry)
  }
  return out
}

// --- LLM round-trip ----------------------------------------------------------

/**
 * Interpret one callLLM result as the {id: translation} object. CallLLM may
 * return raw model text (loose-parsed: fenced/prose-wrapped JSON both accepted
 * via parseJsonLoose) or an already-parsed value from a schema-constrained
 * transport. Anything that is not a plain object — arrays included — is a
 * parse failure (undefined).
 */
function coerceToRecord(raw: unknown): Record<string, unknown> | undefined {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = parseJsonLoose(raw)
    } catch {
      return undefined
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

/**
 * Send one chunk (single-direction) and return the parsed {id: translation}
 * object, retrying ONCE with the terser reminder appended when the first
 * response is unparseable. Undefined ⇒ give up on this chunk (entries skip).
 * Rejections from callLLM propagate — see the module doc's failure semantics.
 */
async function requestChunk(
  callLLM: CallLLM,
  target: DiagramLang,
  chunk: TranslateEntry[]
): Promise<Record<string, unknown> | undefined> {
  const payload: Record<string, string> = {}
  for (const entry of chunk) payload[entry.id] = entry.text
  const prompt = buildPrompt(target, payload)

  const messages: LlmMessage[] = [{ role: 'user', content: prompt }]
  const first = coerceToRecord(await callLLM(messages, { maxTokens: TRANSLATE_MAX_TOKENS }))
  if (first) return first

  const retryMessages: LlmMessage[] = [{ role: 'user', content: `${prompt}\n\n${RETRY_REMINDER}` }]
  return coerceToRecord(await callLLM(retryMessages, { maxTokens: TRANSLATE_MAX_TOKENS }))
}

/**
 * Validate one model-provided translation; returns the trimmed value or
 * undefined (⇒ skipped). Rules:
 *  - must be a non-empty string (identical-to-source IS allowed — "DMT HUB"
 *    legitimately translates to itself);
 *  - target 'ar' must contain at least one Arabic codepoint (arabicRatio > 0
 *    ⇔ ≥ 1 codepoint in the Arabic blocks) UNLESS the source is
 *    digits/punctuation/acronym-like — heuristic: no lowercase [a-z] in the
 *    source ("DMT HUB", "R2", "§4.2" pass through untranslated);
 *  - target 'en' must contain NO Arabic codepoints.
 */
function validateTranslation(entry: TranslateEntry, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return undefined
  const hasArabic = arabicRatio(text) > 0
  if (entry.target === 'ar') {
    const passthroughSource = !/[a-z]/.test(entry.text)
    if (!hasArabic && !passthroughSource) return undefined
  } else if (hasArabic) {
    return undefined
  }
  return text
}

// --- the run -----------------------------------------------------------------

/**
 * Fill every missing stored translation in the diagram via `callLLM`.
 *
 * Entries are grouped by target language (each direction gets its own
 * prompts) and sent in chunks of at most `opts.chunkSize` (default 60),
 * sequentially — deterministic ordering ('en' chunks first, then 'ar') and no
 * parallel burst against provider rate limits. Every write goes through
 * `modeling.updateProperties`, ONE call per element bundling the write-back
 * seed (when both attrs were missing) with the validated translation, so each
 * element lands on the command stack as a single undoable edit; the visible
 * `name` is never touched. Finally `orbitpm:activeLang` is stamped on the
 * process root when it was absent (langToggle-style separate last write,
 * using the detected language) so the toolbar toggle starts from the right
 * side. The stamp mirrors the toggle's own root write: it fires even when
 * nothing needed translating, and never overwrites an existing value.
 */
export async function translateDiagram(
  modeler: TranslateModeler,
  callLLM: CallLLM,
  opts?: { chunkSize?: number }
): Promise<TranslateOutcome> {
  const resolution = resolveDiagram(modeler)
  const modeling = modeler.get('modeling') as ModelingLike

  const entries: TranslateEntry[] = []
  for (const el of resolution.elements) {
    if (el.entry) entries.push(el.entry)
  }
  const total = entries.length

  const rawChunkSize = opts?.chunkSize
  const chunkSize =
    typeof rawChunkSize === 'number' && Number.isFinite(rawChunkSize) && rawChunkSize >= 1
      ? Math.floor(rawChunkSize)
      : DEFAULT_CHUNK_SIZE

  // id → validated translation. Element ids are unique per diagram and each
  // element yields at most one entry, so a flat map is unambiguous.
  const translations = new Map<string, string>()
  for (const target of ['en', 'ar'] as const) {
    const group = entries.filter((entry) => entry.target === target)
    for (let start = 0; start < group.length; start += chunkSize) {
      const chunk = group.slice(start, start + chunkSize)
      const response = await requestChunk(callLLM, target, chunk)
      if (!response) continue // chunk gave up — its entries stay skipped
      for (const entry of chunk) {
        const valid = validateTranslation(entry, response[entry.id])
        if (valid !== undefined) translations.set(entry.id, valid)
      }
    }
  }

  // Apply: one bundled updateProperties per element (seed + translation). An
  // element whose translation was skipped but whose seed exists still gets the
  // seed — that is exactly the write-back the next toggle would perform, and
  // keeping it here means a partially failed run leaves no half-adopted state.
  let translated = 0
  for (const el of resolution.elements) {
    const properties: Record<string, string> = { ...(el.seed ?? {}) }
    if (el.entry) {
      const value = translations.get(el.entry.id)
      if (value !== undefined) {
        properties[LANG_ATTR[el.entry.target]] = value
        translated += 1
      }
    }
    if (Object.keys(properties).length > 0) {
      modeling.updateProperties(el.target, properties)
    }
  }

  if (resolution.rootStamp) {
    modeling.updateProperties(resolution.rootStamp.target, {
      [ATTR_ACTIVE_LANG]: resolution.rootStamp.lang
    })
  }

  return { translated, skipped: total - translated, total }
}
