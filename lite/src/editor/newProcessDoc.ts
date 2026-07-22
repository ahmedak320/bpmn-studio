// Pure, dependency-light helpers for the "New process" and "create a missing
// linked process" flows. Kept free of React/DOM/File-System-Access so the whole
// name -> slug -> processId -> BPMN-XML derivation is unit-testable in isolation
// (see src/__tests__/newProcessDoc.test.ts) and shared verbatim by BOTH the
// directory-mode (real file) and fallback-mode (in-memory/download) paths, so
// the two can never drift.

import { slugify, FALLBACK_SLUG } from '@app/shared/slug'
import { createNamedDiagramXml } from '@app/renderer/src/editor/newDiagram'

/**
 * Derive a stable, BPMN-legal `<process id>` from a file slug. Mirrors the
 * desktop app's convention (`Process_<slug-with-underscores>`) so a file
 * created in Lite and one created in the desktop app for the same name are
 * link-compatible. Dashes become underscores and any stray non-id character is
 * dropped, guaranteeing a valid XML NCName that never starts with a digit.
 */
export function deriveProcessId(slug: string): string {
  const safe = slug.replace(/-/g, '_').replace(/[^A-Za-z0-9_]/g, '')
  return `Process_${safe || 'process'}`
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
 * The slug (and therefore the file name) and process id both derive from the
 * name, so the created file is an immediately-linkable, stably-named target.
 * `slugOverride` lets a caller substitute a de-duplicated slug (so a second
 * "Order" in a folder becomes `order-2.bpmn` / `Process_order_2`).
 */
export function buildNewProcessDoc(name: string, slugOverride?: string): NewProcessDoc {
  const slug = slugOverride ?? slugify(name)
  const processId = deriveProcessId(slug)
  const fileBaseName = slugOverride ?? deriveFileBaseName(name)
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
