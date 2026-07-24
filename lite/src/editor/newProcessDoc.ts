// Pure, dependency-light helpers for the "New process" and "create a missing
// linked process" flows. Kept free of React/DOM/File-System-Access so the whole
// name -> slug -> processId -> BPMN-XML derivation is unit-testable in isolation
// (see src/__tests__/newProcessDoc.test.ts) and shared verbatim by BOTH the
// directory-mode (real file) and fallback-mode (in-memory/download) paths, so
// the two can never drift.

import { slugify, FALLBACK_SLUG } from '@app/shared/slug'
import { createNamedDiagramXml } from '@app/renderer/src/editor/newDiagram'

/**
 * FNV-1a (32-bit) over UTF-16 code units → 8 lowercase hex chars. Deterministic
 * and dependency-free, so it produces the SAME id in the browser and in
 * node/vitest. Used to disambiguate non-Latin names whose ASCII slug degenerates
 * to nothing (see `deriveProcessId`).
 */
export function hash8(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Derive a stable, BPMN-legal `<process id>` from a file base name. Mirrors the
 * desktop app's convention (`Process_<slug-with-underscores>`) so a file created
 * in Lite and one created in the desktop app for the same Latin name are
 * link-compatible: dashes become underscores and any stray non-id character is
 * dropped, guaranteeing a valid XML NCName that never starts with a digit.
 *
 * A name written in a NON-Latin script (Arabic, CJK, …) strips to nothing here,
 * so instead of every such name collapsing to the single shared `Process_process`
 * (which silently cross-wired call links — two different Arabic names resolved to
 * the same file), we fall back to `Process_<8-char hash of the original name>`.
 * Two different non-Latin names therefore get two different, stable ids. Latin
 * (and empty / ASCII-punctuation) inputs are byte-identical to before.
 */
export function deriveProcessId(baseName: string): string {
  const safe = baseName.replace(/-/g, '_').replace(/[^A-Za-z0-9_]/g, '')
  // A non-Latin name (Arabic, CJK…) whose ASCII residue is empty OR too short to
  // be meaningful (<3 letters) would otherwise collapse DIFFERENT names onto one
  // shared id — every pure-Arabic name to `Process_process`, and mixed names
  // like "طلب A" / "موافقة A" both to `Process__A` — silently cross-wiring their
  // call links. Hash the original name instead so each gets a distinct, stable,
  // valid NCName (Codex ORIG-6a). A 3+ letter residue is considered meaningful
  // and kept, so a Latin-with-accents name stays link-compatible.
  const asciiLetters = safe.replace(/[^A-Za-z]/g, '')
  if (asciiLetters.length < 3 && /[^\x00-\x7F]/.test(baseName)) {
    const seed = baseName.trim()
    if (seed) return `Process_${hash8(seed)}`
  }
  return `Process_${safe || 'process'}`
}

/**
 * Make a derived process id unique against the CURRENT index by suffixing
 * `_2`, `_3`, … when a collision is reported. Callers that have the workspace's
 * process-id set pass an `isTaken` predicate; without one, filename-level dedup
 * (which flows through `deriveProcessId` via the deduplicated file base name)
 * already keeps ids distinct in practice, and true 32-bit hash collisions are
 * astronomically unlikely.
 */
export function dedupeProcessId(baseId: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(baseId)) return baseId
  for (let n = 2; ; n++) {
    const candidate = `${baseId}_${n}`
    if (!isTaken(candidate)) return candidate
  }
}

/**
 * Turn a process id back into a friendly display name — used to pre-fill the
 * name field when creating a process to satisfy an unresolved `calledElement`
 * (e.g. `Process_customer_onboarding` -> "Customer Onboarding").
 */
/**
 * Derive a file base name that PRESERVES non-Latin scripts (Arabic, etc.)
 * instead of stripping them the way `slugify()` does — `slugify()` is kept
 * strictly ASCII (Windows-legal dashed-lowercase) because it also feeds
 * `deriveProcessId()`, whose output must be a valid XML NCName. The file name
 * has no such constraint: modern filesystems and the File System Access API
 * both support Unicode names, so an Arabic process name should produce an
 * Arabic `.bpmn` file name, while its `<process id>` still falls back to a
 * stable ASCII form (`Process_process`, deduplicated `Process_process_2`, …)
 * via `slugify()`/`deriveProcessId()` in the callers below.
 *
 * For an ASCII-only input this defers entirely to `slugify()` so existing
 * (English) file names are byte-identical to before this function existed.
 */
export function deriveFileBaseName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return FALLBACK_SLUG
  const hasNonAscii = /[^\x00-\x7F]/.test(trimmed)
  if (!hasNonAscii) return slugify(trimmed)
  // Strip characters illegal in a Windows file name and control characters,
  // collapse whitespace to a single dash, trim stray dashes.
  const safe = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || FALLBACK_SLUG
}

/**
 * Keep a display name human-readable while making it safe as a folder name.
 * Unlike `deriveFileBaseName`, this deliberately preserves case, spaces and
 * non-Latin scripts. The caller supplies its existing slug fallback for names
 * that contain no usable characters after sanitizing.
 */
export function sanitizeFolderName(name: string, fallback: string): string {
  const safe = name
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[.\s]+|[.\s]+$/gu, '')
  return safe || fallback
}

export function humanizeProcessId(id: string): string {
  const words = id
    .replace(/^Process[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  if (!words) return id
  return words.replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface NewProcessDoc {
  /** File slug (no extension) — the `.bpmn` file is named `<fileBaseName>.bpmn`. */
  fileBaseName: string
  /** The `<process id>` — the call-activity link target. */
  processId: string
  /** Display name written to the process `name` attribute. */
  name: string
  /** The full BPMN 2.0 XML for the new file. */
  xml: string
}

/**
 * Build the document for a brand-new process from a user-entered display name.
 * The file name and process id both derive from the name, so the created file is
 * an immediately-linkable, stably-named target. `slugOverride` lets a caller
 * substitute a de-duplicated slug (so a second "Order" in a folder becomes
 * `order-2.bpmn` / `Process_order_2`).
 *
 * The process id derives from the FILE BASE NAME (which preserves Arabic / other
 * scripts), not from the ASCII `slugify()` output — otherwise every non-Latin
 * name slugifies to the `process` fallback and `deriveProcessId` can no longer
 * tell them apart. Because the caller passes an already-deduplicated
 * `slugOverride`, the id inherits that uniqueness (a second "طلب" → file base
 * `طلب-2` → a distinct hashed id). An optional `isProcessIdTaken` predicate adds
 * belt-and-suspenders suffixing against the live index for the rare hash clash.
 */
export function buildNewProcessDoc(
  name: string,
  slugOverride?: string,
  isProcessIdTaken?: (candidate: string) => boolean
): NewProcessDoc {
  const fileBaseName = slugOverride ?? deriveFileBaseName(name)
  const baseId = deriveProcessId(fileBaseName)
  const processId = isProcessIdTaken ? dedupeProcessId(baseId, isProcessIdTaken) : baseId
  return {
    fileBaseName,
    processId,
    name,
    xml: createNamedDiagramXml({ processId, name })
  }
}

/**
 * Build the document for a process that must satisfy a specific, already-set
 * `calledElement` (an unresolved link). Here the process id is FIXED to the
 * calledElement value verbatim — that is what makes the dangling link resolve —
 * while the file name derives independently from the chosen display name. If no
 * name is supplied, a humanized form of the id is used.
 */
export function buildMissingProcessDoc(
  calledElementId: string,
  name?: string,
  slugOverride?: string
): NewProcessDoc {
  const displayName = (name && name.trim()) || humanizeProcessId(calledElementId)
  const fileBaseName = slugOverride ?? deriveFileBaseName(displayName || calledElementId)
  return {
    fileBaseName,
    processId: calledElementId,
    name: displayName,
    xml: createNamedDiagramXml({ processId: calledElementId, name: displayName })
  }
}
