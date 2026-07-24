// Tolerant, regex-based parser for ARIS AML (ARIS Markup Language) database
// exports — the format behind ARIS "export database / group" XML and the
// experimental `.apc` import. Deliberately NO DOMParser and no dependencies so
// it runs in plain-node unit tests and stays resilient against the many AML
// dialect quirks (multi-line attributes inside start tags, CRLF line endings,
// DTD entities used inside attribute values, three different name-storage
// shapes across ARIS versions).
//
// What a real ARIS 10 AML export looks like (verified against a live "DMT"
// database export):
//
//   <!DOCTYPE AML SYSTEM "ARIS-Export.dtd" [
//     <!ENTITY LocaleId.AEar "14337">      ← internal DTD subset; these
//     <!ENTITY LocaleId.USen "1033">         entities are referenced INSIDE
//   ]>                                       attribute values (&LocaleId.AEar;)
//   <AML>
//     <Group …>
//       <ObjDef ObjDef.ID="…" TypeNum="OT_FUNC" …>          ← object catalogue
//         <AttrDef AttrDef.Type="AT_NAME">
//           <AttrValue LocaleId="&LocaleId.AEar;">          ← per-locale names
//             <StyledElement>…<PlainText TextValue="…"/>…   (arbitrarily deep,
//           </AttrValue>                                     possibly several
//         </AttrDef>                                         styled runs)
//         <CxnDef CxnDef.ID="…" CxnDef.Type="CT_ACTIV_1"    ← connections live
//                 ToObjDef.IdRef="…"/>                        in the SOURCE def
//       </ObjDef>
//       <Model Model.ID="…" Model.Type="MT_EEPC" …>         ← one diagram
//         <Lane …>…</Lane>                                   (has own AT_NAME!)
//         <AttrDef AttrDef.Type="AT_NAME">…</AttrDef>       ← model name
//         <ObjOcc ObjOcc.ID="…" ObjDef.IdRef="…"            ← occurrence =
//                 SymbolNum="ST_OPR_AND_1">                   membership+layout
//           <Position Pos.X="4444" Pos.Y="5898"/>
//           <Size Size.dX="554" Size.dY="151"/>
//           <CxnOcc CxnOcc.ID="…" CxnDef.IdRef="…"          ← per-model edge
//                   ToObjOcc.IdRef="…">…</CxnOcc>             occurrence
//         </ObjOcc>
//       </Model>
//     </Group>
//   </AML>
//
// The parser extracts exactly that skeleton — object definitions with
// localized names and typed connections, plus models with their occurrences
// and geometry — and nothing else. Everything is best-effort: missing pieces
// yield `undefined`, never a throw.

/** A per-locale text value (an AT_NAME across the export's languages). */
export interface LocalizedText {
  en?: string
  ar?: string
  /** Values whose locale we couldn't classify (or that had no LocaleId). */
  others: string[]
}

/** A `<CxnDef>` connection: lives inside its SOURCE ObjDef, names the target. */
export interface AmlCxn {
  id?: string
  /** `CxnDef.Type="CT_…"` (ARIS 10) or legacy `TypeNum="CT_…"`. */
  type?: string
  from: string
  to: string
}

/** An `<ObjDef>` — one object in the database-wide catalogue. */
export interface AmlObj {
  id: string
  /** `TypeNum` — OT_FUNC, OT_EVT, OT_RULE, OT_PERS, OT_APPL_SYS, … */
  typeNum: string
  name: LocalizedText
  cxns: AmlCxn[]
  /**
   * `LinkedModels.IdRefs` — ARIS "model assignment": the Model.IDs this
   * object links to (a value-chain chevron pointing at the EPC it drills
   * into). The raw attribute value is whitespace-padded and potentially
   * multi-valued (space-separated), so it is trimmed and split on runs of
   * whitespace. Empty array when the attribute is absent.
   */
  linkedModelIds: string[]
}

/** An `<ObjOcc>` — one placement of an ObjDef on one model's canvas. */
export interface AmlOcc {
  id?: string
  defId: string
  /** ST_FUNC, ST_EV, ST_OPR_AND_1/OR_1/XOR_1, ST_PERS_EXT, … */
  symbolNum?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

/** A `<CxnOcc>` — one connection drawn on one model's canvas. */
export interface AmlCxnOcc {
  /** `CxnDef.IdRef` — resolves to the database-wide AmlCxn. */
  cxnRef?: string
  /** `ToObjOcc.IdRef` — the target occurrence (informational). */
  toOccRef?: string
}

/** A `<Model>` — one diagram (MT_EEPC = process, MT_VAL_ADD_CHN_DGM = map). */
export interface AmlModel {
  id: string
  type: string
  name: LocalizedText
  /** AT_PROC_CODE attribute value, when the model carries one. */
  procCode?: string
  occs: AmlOcc[]
  cxnOccs: AmlCxnOcc[]
}

export interface AmlDatabase {
  /** Internal-DTD-subset entities: name → replacement text. */
  entities: Record<string, string>
  /** Document-order object catalogue. */
  objects: AmlObj[]
  objectById: Map<string, AmlObj>
  cxnById: Map<string, AmlCxn>
  models: AmlModel[]
  /** `DatabaseName` from the first `<Header-Info …>` block, when present. */
  databaseName?: string
}

/**
 * Cheap sniff: is this text an ARIS AML export? True for an `<AML …>` root
 * element or an `<!DOCTYPE AML …>` declaration; false for BPMN or random XML.
 */
export function looksLikeAml(text: string): boolean {
  return /<AML[\s/>]/.test(text) || /<!DOCTYPE\s+AML[\s>[]/.test(text)
}

/** Parse `<!ENTITY Name "value">` declarations from the internal DTD subset. */
export function parseDtdEntities(text: string): Record<string, string> {
  const entities: Record<string, string> = {}
  // Entities only ever appear in the DOCTYPE's internal subset (before the
  // root element), but scanning the whole text is harmless and simpler.
  const re = /<!ENTITY\s+([\w.-]+)\s+"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) entities[m[1]] = m[2]
  return entities
}

/**
 * Decode entity references in extracted text: numeric (`&#1573;` / `&#x623;`),
 * the standard five, and the export's OWN internal-DTD entities (needed for
 * `LocaleId="&LocaleId.AEar;"` locale matching). Custom entities are expanded
 * FIRST (their replacement text is plain, e.g. "14337"), `&amp;` last so a
 * literal ampersand can't be double-decoded.
 */
export function decodeAmlEntities(text: string, entities: Record<string, string> = {}): string {
  return text
    .replace(/&([\w.-]+);/g, (whole, name: string) => {
      const custom = entities[name]
      if (custom !== undefined) return custom
      return whole // leave standard/numeric refs for the passes below
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** String.fromCodePoint that can't throw on a malformed reference. */
function safeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

/**
 * Classify an AML LocaleId as English or Arabic. ARIS LocaleIds are Windows
 * LCIDs whose low 10 bits are the primary language (9 = English — 1033 en-US,
 * 2057 en-GB, … ; 1 = Arabic — 14337 ar-AE, 1025 ar-SA, …). Unexpanded entity
 * names (`&LocaleId.USen;`) are classified by their suffix as a fallback.
 */
export function localeLang(rawLocale: string | undefined): 'en' | 'ar' | undefined {
  if (!rawLocale) return undefined
  const t = rawLocale.trim()
  if (/^\d+$/.test(t)) {
    const primary = parseInt(t, 10) & 0x3ff
    if (primary === 9) return 'en'
    if (primary === 1) return 'ar'
    return undefined
  }
  if (/ar\b|arab/i.test(t)) return 'ar'
  if (/en\b|\ben/i.test(t)) return 'en'
  return undefined
}

/** Pick the display string for a language, falling back across locales. */
export function pickText(name: LocalizedText, lang: 'en' | 'ar'): string | undefined {
  const other = lang === 'en' ? 'ar' : 'en'
  return name[lang] ?? name[other] ?? name.others[0]
}

// ---------------------------------------------------------------------------
// Low-level tag scanning
// ---------------------------------------------------------------------------

// Attribute strings are read with a QUOTE-AWARE pattern (`[^>"]` runs or full
// quoted strings) so a stray `>` inside an attribute value can't truncate the
// tag, and `[\s\S]` never appears — quoted values may span the CRLF-broken
// multi-line start tags ARIS emits.
const TAG_ATTRS = '((?:[^>"]|"[^"]*")*?)'

/** Read a (possibly dotted) attribute value off a start-tag's attribute string. */
export function readTagAttr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.]/g, '\\.')
  // `(?:^|[\s"])` anchors the attribute NAME so `Pos.X` can't match `…Pos.X`
  // of a longer attribute; values may contain anything but a double quote.
  const m = new RegExp('(?:^|[\\s"])' + escaped + '\\s*=\\s*"([^"]*)"').exec(attrs)
  return m ? m[1] : undefined
}

/** First present of several attribute spellings (`Pos.X` vs plain `X`, …). */
function readTagAttrAny(attrs: string, names: string[]): string | undefined {
  for (const n of names) {
    const v = readTagAttr(attrs, n)
    if (v !== undefined) return v
  }
  return undefined
}

interface TagBlock {
  attrs: string
  body: string
}

/**
 * Iterate all `<tag …>…</tag>` (or self-closing `<tag …/>`) blocks. Assumes
 * the tag does not nest within itself — true for every AML tag we scan
 * (ObjDef, Model, ObjOcc, Lane, AttrDef, AttrValue, FFTextDef, FFTextOcc).
 */
function* scanBlocks(text: string, tag: string): Generator<TagBlock> {
  const open = new RegExp('<' + tag + '\\b' + TAG_ATTRS + '(/?)>', 'g')
  const close = '</' + tag + '>'
  let m: RegExpExecArray | null
  while ((m = open.exec(text))) {
    const attrs = m[1]
    if (m[2] === '/') {
      yield { attrs, body: '' }
      continue
    }
    const closeIdx = text.indexOf(close, open.lastIndex)
    if (closeIdx === -1) {
      // Truncated document: treat the remainder as the body, then stop.
      yield { attrs, body: text.slice(open.lastIndex) }
      return
    }
    yield { attrs, body: text.slice(open.lastIndex, closeIdx) }
    open.lastIndex = closeIdx + close.length
  }
}

/** Remove all blocks of the given tags (used to isolate a model's OWN attrs). */
function stripBlocks(text: string, tags: string[]): string {
  let out = text
  for (const tag of tags) {
    out = out.replace(new RegExp('<' + tag + '\\b' + TAG_ATTRS + '(?:/>|>[\\s\\S]*?</' + tag + '>)', 'g'), '')
  }
  return out
}

// ---------------------------------------------------------------------------
// Localized attribute (AT_NAME / AT_PROC_CODE) extraction
// ---------------------------------------------------------------------------

/**
 * Extract the text of ONE `<AttrValue>` body, across the three shapes AML
 * uses in the wild:
 *  1. ARIS 9/10: nested StyledElements with one or more
 *     `<PlainText TextValue="…"/>` runs (styling may split one name into
 *     several runs — they are joined with a space and whitespace-collapsed);
 *  2. some exports: `<PlainText>text</PlainText>` element content;
 *  3. oldest exports: text sitting directly inside the AttrValue.
 */
function attrValueText(body: string, entities: Record<string, string>): string | undefined {
  const runs: string[] = []
  const byAttr = new RegExp('<PlainText\\b' + TAG_ATTRS + '/?>', 'g')
  let m: RegExpExecArray | null
  while ((m = byAttr.exec(body))) {
    const v = readTagAttr(m[1], 'TextValue')
    if (v !== undefined) runs.push(decodeAmlEntities(v, entities))
  }
  if (runs.length > 0) {
    const joined = runs.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) return joined
  }
  // Element-content PlainText.
  const byPlainText = /<PlainText\b[^>]*>([\s\S]*?)<\/PlainText>/.exec(body)
  if (byPlainText) {
    const v = decodeAmlEntities(byPlainText[1].replace(/<[^>]*>/g, ''), entities).trim()
    if (v) return v
  }
  // Bare AttrValue content (strip any residual styling tags).
  const v = decodeAmlEntities(body.replace(/<[^>]*>/g, ''), entities).trim()
  return v || undefined
}

/**
 * Read a localized attribute (`AttrDef.Type="AT_NAME"` etc.) out of an
 * element body, returning one value per locale. `body` must already be
 * scoped to the owning element (nested Lane/ObjOcc/CxnDef blocks stripped).
 */
function extractLocalizedAttr(body: string, attrType: string, entities: Record<string, string>): LocalizedText {
  const result: LocalizedText = { others: [] }
  for (const def of scanBlocks(body, 'AttrDef')) {
    const type = readTagAttrAny(def.attrs, ['AttrDef.Type', 'TypeNum'])
    if (type !== attrType) continue
    let sawAttrValue = false
    for (const av of scanBlocks(def.body, 'AttrValue')) {
      sawAttrValue = true
      const text = attrValueText(av.body, entities)
      if (!text) continue
      const lang = localeLang(decodeAmlEntities(readTagAttr(av.attrs, 'LocaleId') ?? '', entities))
      if (lang && result[lang] === undefined) result[lang] = text
      else result.others.push(text)
    }
    // Degenerate exports put the text straight into the AttrDef.
    if (!sawAttrValue) {
      const text = attrValueText(def.body, entities)
      if (text) result.others.push(text)
    }
    break // first matching AttrDef wins
  }
  return result
}

// ---------------------------------------------------------------------------
// Object definitions, models, occurrences
// ---------------------------------------------------------------------------

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

/** Parse an `<ObjDef>` body into names + connections. */
function parseObjDef(attrs: string, body: string, entities: Record<string, string>): AmlObj | undefined {
  const id = readTagAttr(attrs, 'ObjDef.ID')
  if (!id) return undefined
  const cxns: AmlCxn[] = []
  for (const c of scanBlocks(body, 'CxnDef')) {
    // ARIS 10 exports type connections via `CxnDef.Type="CT_…"`; older
    // exports used `TypeNum` — accept both (and tolerate an absent type).
    const to = readTagAttrAny(c.attrs, ['ToObjDef.IdRef', 'CxnDef.ToObjDef', 'ToObjDef'])
    if (!to) continue
    cxns.push({
      id: readTagAttr(c.attrs, 'CxnDef.ID'),
      type: readTagAttrAny(c.attrs, ['CxnDef.Type', 'TypeNum']),
      from: id,
      to
    })
  }
  // CxnDefs may carry their own AttrDefs (connection attributes) — strip them
  // so the name scan can only see the OBJECT's attributes.
  const ownBody = stripBlocks(body, ['CxnDef'])
  const linkedModels = readTagAttr(attrs, 'LinkedModels.IdRefs')
  return {
    id,
    typeNum: readTagAttr(attrs, 'TypeNum') ?? '',
    name: extractLocalizedAttr(ownBody, 'AT_NAME', entities),
    cxns,
    // IdRefs values are whitespace-padded and space-separated when
    // multi-valued (verified against real exports, where the sibling
    // `ToCxnDefs.IdRefs` carries values like "      CxnDef.4q8… ").
    linkedModelIds: linkedModels ? linkedModels.trim().split(/\s+/).filter(Boolean) : []
  }
}

/** Parse an `<ObjOcc>` body into geometry + this model's connection occs. */
function parseObjOcc(
  attrs: string,
  body: string
): { occ: AmlOcc; cxnOccs: AmlCxnOcc[] } | undefined {
  const defId = readTagAttr(attrs, 'ObjDef.IdRef')
  if (!defId) return undefined
  // Geometry lives in the occ's OWN head — `<CxnOcc>` children carry their own
  // `<Position>` waypoints and `<AttrOcc>` children their own `<Size>`, so cut
  // the body at whichever nested block comes first before reading either.
  let head = body
  for (const nested of ['<CxnOcc', '<AttrOcc']) {
    const idx = head.indexOf(nested)
    if (idx !== -1) head = head.slice(0, idx)
  }
  const posTag = new RegExp('<Position\\b' + TAG_ATTRS + '/?>').exec(head)
  const sizeTag = new RegExp('<Size\\b' + TAG_ATTRS + '/?>').exec(head)
  const occ: AmlOcc = {
    id: readTagAttr(attrs, 'ObjOcc.ID'),
    defId,
    symbolNum: readTagAttr(attrs, 'SymbolNum'),
    x: posTag ? parseNumber(readTagAttrAny(posTag[1], ['Pos.X', 'X'])) : undefined,
    y: posTag ? parseNumber(readTagAttrAny(posTag[1], ['Pos.Y', 'Y'])) : undefined,
    w: sizeTag ? parseNumber(readTagAttrAny(sizeTag[1], ['Size.dX', 'dX', 'dx'])) : undefined,
    h: sizeTag ? parseNumber(readTagAttrAny(sizeTag[1], ['Size.dY', 'dY', 'dy'])) : undefined
  }
  const cxnOccs: AmlCxnOcc[] = []
  for (const c of scanBlocks(body, 'CxnOcc')) {
    cxnOccs.push({
      cxnRef: readTagAttr(c.attrs, 'CxnDef.IdRef'),
      toOccRef: readTagAttr(c.attrs, 'ToObjOcc.IdRef')
    })
  }
  return { occ, cxnOccs }
}

/** Parse a `<Model>` body into its name, proc code, occurrences and edges. */
function parseModel(attrs: string, body: string, entities: Record<string, string>): AmlModel | undefined {
  const id = readTagAttr(attrs, 'Model.ID')
  if (!id) return undefined
  const occs: AmlOcc[] = []
  const cxnOccs: AmlCxnOcc[] = []
  for (const o of scanBlocks(body, 'ObjOcc')) {
    const parsed = parseObjOcc(o.attrs, o.body)
    if (!parsed) continue
    occs.push(parsed.occ)
    cxnOccs.push(...parsed.cxnOccs)
  }
  // The model's OWN AttrDefs must be isolated from nested blocks that carry
  // AttrDefs of their own: Lanes (row/column headers have AT_NAMEs like "."),
  // free-form texts, and occurrences.
  const ownBody = stripBlocks(body, ['Lane', 'FFTextDef', 'FFTextOcc', 'ObjOcc', 'OLEDef'])
  const procCodeText = extractLocalizedAttr(ownBody, 'AT_PROC_CODE', entities)
  return {
    id,
    type: readTagAttr(attrs, 'Model.Type') ?? '',
    name: extractLocalizedAttr(ownBody, 'AT_NAME', entities),
    procCode: procCodeText.en ?? procCodeText.ar ?? procCodeText.others[0],
    occs,
    cxnOccs
  }
}

/**
 * Parse an AML export into its object catalogue and models. Best-effort and
 * throw-free: malformed pieces are skipped, an empty document yields empty
 * collections.
 */
export function parseAml(text: string): AmlDatabase {
  const entities = parseDtdEntities(text)
  const objects: AmlObj[] = []
  const objectById = new Map<string, AmlObj>()
  const cxnById = new Map<string, AmlCxn>()

  // Models contain ObjOccs (not ObjDefs), and ObjDefs contain CxnDefs (not
  // Models), so the two scans below can safely run over the whole text.
  for (const block of scanBlocks(text, 'ObjDef')) {
    const obj = parseObjDef(block.attrs, block.body, entities)
    if (!obj || objectById.has(obj.id)) continue
    objects.push(obj)
    objectById.set(obj.id, obj)
    for (const c of obj.cxns) if (c.id && !cxnById.has(c.id)) cxnById.set(c.id, c)
  }

  const models: AmlModel[] = []
  for (const block of scanBlocks(text, 'Model')) {
    const model = parseModel(block.attrs, block.body, entities)
    if (model) models.push(model)
  }

  // The export-wide database name lives on the (usually single, self-closing,
  // multi-line) `<Header-Info … DatabaseName="…"/>` prolog tag.
  let databaseName: string | undefined
  for (const header of scanBlocks(text, 'Header-Info')) {
    const raw = readTagAttr(header.attrs, 'DatabaseName')
    if (raw === undefined) continue
    const decoded = decodeAmlEntities(raw, entities).trim()
    if (decoded) databaseName = decoded
    break // first Header-Info carrying the attribute wins
  }

  return { entities, objects, objectById, cxnById, models, databaseName }
}
