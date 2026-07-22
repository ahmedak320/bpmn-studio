// Windows-safe slug utility, shared by the AI file-writer (main) and its unit
// tests. Pure string logic only — no Node/Electron/DOM imports — so it can be
// imported from either process and exercised in vitest without any runtime.
//
// See plan.md risk #5: reserved device names, dashes, dedup are all handled
// here in one place so filenames written to the workspace are always valid on
// Windows (and, being a strict subset of POSIX-legal names, valid elsewhere).

/**
 * Windows reserved device names. A file whose base name (the part before the
 * first dot) is exactly one of these is invalid on Windows *regardless of
 * extension* — `con.bpmn` cannot be created. We neutralize a slug that lands
 * on one of these by appending `-file`. Note COM0/LPT0 and COM10+/LPT10+ are
 * NOT reserved, so only 1-9 are listed.
 */
const RESERVED_NAMES = new Set<string>([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

/** Used when a name slugifies to nothing (all punctuation/whitespace). */
export const FALLBACK_SLUG = 'process'

/**
 * Turn an arbitrary display name into a Windows-safe, lowercase-dashed slug
 * (no extension):
 *  - lowercased
 *  - every run of non-`[a-z0-9]` characters collapses to a single dash
 *  - leading/trailing dashes trimmed
 *  - a reserved device name (con/prn/aux/nul/com1-9/lpt1-9) gets a `-file`
 *    suffix so it is no longer reserved
 *  - an empty result falls back to `"process"`
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD') // fold accents toward ASCII where the platform can
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!base) return FALLBACK_SLUG
  if (RESERVED_NAMES.has(base)) return `${base}-file`
  return base
}

/**
 * Given a base slug and a predicate reporting whether a candidate slug is
 * already taken (typically "does `<candidate>.bpmn` already exist in the
 * target folder?"), return the first free slug: the base itself, then
 * `base-2`, `base-3`, … The predicate receives the bare slug (no extension).
 *
 * Kept synchronous + predicate-injected so it is trivially unit-testable with
 * a `Set`; the caller (main-process AI writer) pre-lists the target directory
 * once and passes a `Set.has`-backed predicate.
 */
export function dedupeSlug(base: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(base)) return base
  let n = 2
  while (isTaken(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
