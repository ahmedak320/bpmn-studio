// Pure, dependency-free helpers for building an owner index from workspace
// .bpmn XML. Mirrors the regex + entity-decode approach in
// `src/shared/processIndex.ts`: a generic tag regex followed by
// attribute-level regexes scoped to that tag's body, so any element
// (tasks, callActivity, startEvent, process, ...) carrying
// `orbitpm:owner` / `orbitpm:ownerType` / `orbitpm:ownerRole` is picked up
// regardless of namespace prefix or attribute order.

export type OwnerType = 'individual' | 'department' | 'division'

export interface OwnerEntry {
  name: string
  type?: OwnerType
  count: number
}

// Any opening/self-closing tag: `<tag ...>` or `<ns:tag ... />`.
const TAG_RE = /<[a-zA-Z_][^>]*>/g
const OWNER_ATTR_RE = /\borbitpm:owner\s*=\s*(?:"([^"]*)"|'([^']*)')/
const OWNER_TYPE_ATTR_RE = /\borbitpm:ownerType\s*=\s*(?:"([^"]*)"|'([^']*)')/

const VALID_TYPES: ReadonlySet<string> = new Set(['individual', 'department', 'division'])

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

interface Accumulator {
  displayName: string
  count: number
  typeCounts: Map<string, number>
}

/**
 * Scan a flat list of (relPath, xml) pairs for `orbitpm:owner` attributes on
 * any tag and aggregate them into `OwnerEntry` records. Aggregation is
 * case-insensitive on the (trimmed) name; the display name kept is the
 * first-seen casing. `type` is the most frequent non-empty
 * `orbitpm:ownerType` value paired with that name (ties broken by
 * first-seen). Sorted by count desc, then name asc (locale compare).
 */
export function collectOwners(files: Array<{ relPath: string; xml: string }>): OwnerEntry[] {
  const byKey = new Map<string, Accumulator>()

  for (const file of files) {
    const xml = file.xml
    if (!xml) continue
    TAG_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TAG_RE.exec(xml)) !== null) {
      const tag = match[0]
      const ownerMatch = OWNER_ATTR_RE.exec(tag)
      if (!ownerMatch) continue
      const rawName = decodeXmlEntities(ownerMatch[1] ?? ownerMatch[2] ?? '').trim()
      if (!rawName) continue

      const key = rawName.toLowerCase()
      let acc = byKey.get(key)
      if (!acc) {
        acc = { displayName: rawName, count: 0, typeCounts: new Map() }
        byKey.set(key, acc)
      }
      acc.count += 1

      const typeMatch = OWNER_TYPE_ATTR_RE.exec(tag)
      if (typeMatch) {
        const rawType = decodeXmlEntities(typeMatch[1] ?? typeMatch[2] ?? '').trim()
        if (rawType && VALID_TYPES.has(rawType)) {
          acc.typeCounts.set(rawType, (acc.typeCounts.get(rawType) ?? 0) + 1)
        }
      }
    }
  }

  const entries: OwnerEntry[] = []
  for (const acc of byKey.values()) {
    let bestType: OwnerType | undefined
    let bestCount = 0
    for (const [type, count] of acc.typeCounts) {
      if (count > bestCount) {
        bestCount = count
        bestType = type as OwnerType
      }
    }
    entries.push({ name: acc.displayName, type: bestType, count: acc.count })
  }

  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.name.localeCompare(b.name)
  })

  return entries
}

/**
 * Substring match (trimmed, case-insensitive) on `name`. Empty/whitespace
 * query returns all entries unchanged.
 */
export function filterOwners(entries: OwnerEntry[], query: string): OwnerEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => e.name.toLowerCase().includes(q))
}

// --- session owners (applied via a dialog, possibly not yet saved to disk) ---

/** Session-observed owner (applied in a dialog but possibly not yet saved to disk). */
export interface SessionOwner {
  name: string
  type?: OwnerType
  count: number
}

/** The comparator every owner list ships in: count desc, then name asc. */
function byCountThenName(a: { name: string; count: number }, b: { name: string; count: number }): number {
  if (b.count !== a.count) return b.count - a.count
  return a.name.localeCompare(b.name)
}

/**
 * Case-insensitive merge of the on-disk owner index with session-observed
 * owners. Disk is authoritative: when a name exists on disk the disk entry is
 * kept unchanged (its casing, type and count all win — session applies get
 * re-counted from the XML on the next save/refresh anyway, so folding session
 * counts in here would double-count). Session-only names are appended with
 * their session count. The result is re-sorted count desc, then name asc
 * (the same comparator collectOwners uses). Inputs are never mutated.
 */
export function mergeOwners(disk: OwnerEntry[], session: SessionOwner[]): OwnerEntry[] {
  const diskKeys = new Set(disk.map((e) => e.name.toLowerCase()))
  const merged: OwnerEntry[] = disk.slice()
  for (const s of session) {
    if (diskKeys.has(s.name.toLowerCase())) continue
    merged.push({ name: s.name, type: s.type, count: s.count })
  }
  merged.sort(byCountThenName)
  return merged
}

/**
 * Upsert one applied dialog's owner additions into the session list.
 * Immutable: returns a new array (`prev` untouched); when every addition is
 * blank, `prev` is returned as-is so callers can skip a state update. Names
 * are trimmed and keyed case-insensitively with FIRST-SEEN casing kept; each
 * addition increments the matching entry's count by one. A non-empty incoming
 * type (validated against the known owner types) fills an UNSET type but
 * never clobbers an already-set one.
 */
export function upsertSessionOwners(
  prev: SessionOwner[],
  additions: Array<{ name: string; type?: string }>
): SessionOwner[] {
  const next = prev.map((entry) => ({ ...entry }))
  const byKey = new Map<string, SessionOwner>()
  for (const entry of next) byKey.set(entry.name.toLowerCase(), entry)

  let changed = false
  for (const addition of additions) {
    const name = addition.name.trim()
    if (!name) continue
    changed = true

    const key = name.toLowerCase()
    let entry = byKey.get(key)
    if (!entry) {
      entry = { name, count: 0 }
      byKey.set(key, entry)
      next.push(entry)
    }
    entry.count += 1

    const rawType = addition.type?.trim()
    if (entry.type === undefined && rawType && VALID_TYPES.has(rawType)) {
      entry.type = rawType as OwnerType
    }
  }

  return changed ? next : prev
}

/** Local copy of org/orgModel.ts's splitList — ownersIndex stays dependency-free. */
function splitLines(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/** The "Name — Role" separator: space + em-dash (U+2014) + space, exactly. */
const RESP_SEPARATOR = ' — '

/**
 * The owner names one applied Step-details dialog introduces: the owner field
 * (with its selected type, passed through raw — upsertSessionOwners validates)
 * plus every person on the responsible list, who is always an 'individual'.
 * respList lines follow the "Name — Role" convention — ONLY the exact
 * space-em-dash-space separator is split on (first occurrence); plain lines
 * are taken whole. Blank fields/lines contribute nothing.
 */
export function ownerAdditionsFromValues(v: {
  owner: string
  ownerType: string
  respList: string
}): Array<{ name: string; type?: string }> {
  const out: Array<{ name: string; type?: string }> = []

  const owner = v.owner.trim()
  if (owner) {
    const type = v.ownerType.trim()
    out.push(type ? { name: owner, type } : { name: owner })
  }

  for (const line of splitLines(v.respList)) {
    const separatorAt = line.indexOf(RESP_SEPARATOR)
    const name = (separatorAt >= 0 ? line.slice(0, separatorAt) : line).trim()
    if (name) out.push({ name, type: 'individual' })
  }

  return out
}
