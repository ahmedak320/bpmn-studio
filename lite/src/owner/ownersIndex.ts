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
