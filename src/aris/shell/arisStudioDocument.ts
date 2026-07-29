/**
 * One import → everything the mounted shell needs.
 *
 * This is the composition point the twelve ARIS subsystems were built against:
 * a lossless source package goes in, and the working document (Phase 5), the
 * source-faithful render model plus fidelity report (Phase 9), the details
 * projection (Phase 10) and the complete source accounting (Phase 7) come out.
 *
 * Nothing here re-implements any lane: every value is produced by that lane's
 * own exported entry point.
 */

import { buildAccountingEntries } from '../accounting/accounting'
import { buildLexicalCensus } from '../accounting/lexicalCensus'
import { reconcile } from '../accounting/reconcile'
import { buildAccountingReport } from '../accounting/report'
import { adaptSemanticIndex } from '../accounting/semanticIndexAdapter'
import type {
  ArisAccountingEntry as ArisSourceAccountingEntry,
  ArisAccountingReport,
  ArisLexicalCensus
} from '../accounting/types'
import {
  adaptWorkingDocument,
  type ArisDetailsAttachment,
  type ArisDetailsDocument
} from '../details/seam'
import { scanAmlForOle } from '../details/xmlScan'
import { buildFromSource } from '../model/buildFromSource'
import type { ArisLocalizedValue, ArisWorkingDocument } from '../model/types'
import { buildArisRenderModel } from '../renderer/buildRenderModel'
import type {
  ArisRenderFidelityFinding,
  ArisRenderFidelityKind,
  RenderModelDocument
} from '../renderer/types'
import type { ArisXmlSourcePackage } from '../source/sourcePackage'
import { isSupportedModelType } from '../canvas/vocabulary'
import { localeLang } from '../../library/amlParse'

/**
 * Best available display text for a localized ARIS value in the active language.
 *
 * The locale id keying `value.values` is whatever the source layer stored it
 * as. For real imported AML this is the RAW, unexpanded internal-DTD entity
 * reference (`"&LocaleId.AEar;"` / `"&LocaleId.USen;"`) — `expandXmlEntities`
 * / `decodeAmlEntities` only expand entities inside element text, never
 * attribute values, so an exact-match allow-list of numeric LCIDs/BCP-47 tags
 * can never match a real export. `localeLang` (shared with the details/tabs
 * classifier) resolves numeric LCIDs by primary-language bits and falls back
 * to a case-insensitive `ar`/`en` suffix match, which handles the raw entity
 * reference, the bare entity name, and BCP-47 tags alike.
 */
export function arisText(value: ArisLocalizedValue | undefined, lang: 'en' | 'ar'): string | null {
  if (!value) return null
  for (const [localeId, text] of Object.entries(value.values)) {
    if (typeof text === 'string' && text.trim() !== '' && localeLang(localeId) === lang) return text
  }
  if (typeof value.fallback === 'string' && value.fallback.trim() !== '') return value.fallback
  for (const text of Object.values(value.values)) {
    if (typeof text === 'string' && text.trim() !== '') return text
  }
  return null
}

export interface ArisStudioModelSummary {
  readonly id: string
  readonly type: string
  readonly names: ArisLocalizedValue
  readonly objectCount: number
  readonly connectionCount: number
  /** `false` when `ArisCanvas` refuses to boot this model type (Section 11.2). */
  readonly renderable: boolean
}

export interface ArisStudioDocument {
  /**
   * The exact `buildFromSource` output. The canvas takes ownership of a
   * document derived from it; this reference stays pinned to the imported
   * geometry so "Reset to Source Layout" is exact however many edits ran.
   */
  readonly source: ArisWorkingDocument
  readonly models: readonly ArisStudioModelSummary[]
  readonly renderModels: readonly RenderModelDocument[]
  readonly fidelity: readonly ArisRenderFidelityFinding[]
  readonly fidelityByKind: Readonly<Record<ArisRenderFidelityKind, number>>
  readonly accounting: ArisAccountingReport
  readonly census: ArisLexicalCensus
  /**
   * The COMPLETE accounting entry list, derived rows included.
   *
   * The accounting lane marks derived rows (`entry.derived`) and its own
   * document builder partitions on that flag: the census bound applies to the
   * non-derived rows only, while totals and entries still cover everything.
   * Filtering here would drop assignment provenance from `accounting.v2.json`
   * for no gain — exactly the quiet data loss plan §10 exists to prevent.
   */
  readonly sourceAccountingEntries: readonly ArisSourceAccountingEntry[]
  /** OLE/attachment records extracted from the source (plan §13.4). */
  readonly attachments: ReadonlyMap<string, ArisDetailsAttachment>
}

/** Build the full studio projection of one imported AML source package. */
export function buildArisStudioDocument(pkg: ArisXmlSourcePackage): ArisStudioDocument {
  const source = buildFromSource(pkg.index)

  const models: ArisStudioModelSummary[] = []
  for (const model of source.models.values()) {
    models.push({
      id: model.id,
      type: model.type,
      names: model.names,
      objectCount: model.occurrences.length,
      connectionCount: model.connectionOccurrences.length,
      renderable: !model.unsupported && isSupportedModelType(model.type)
    })
  }

  const render = buildArisRenderModel(pkg.index)

  // §13.4: OLE definitions/occurrences become attachment records the details
  // layer can list, scan and download. `scanAmlForOle` is a pure text scan.
  const attachments = scanAmlForOle(pkg.text).oleDefinitions

  const accountingSource = adaptSemanticIndex(pkg.index)
  const entries = buildAccountingEntries(pkg.document, accountingSource)
  const census = buildLexicalCensus(pkg.document)
  const accounting = buildAccountingReport(entries, reconcile(census, entries))

  return Object.freeze({
    source,
    models: Object.freeze(models),
    renderModels: render.models,
    fidelity: render.fidelity,
    fidelityByKind: render.fidelityByKind,
    accounting,
    census,
    sourceAccountingEntries: Object.freeze([...entries]),
    attachments
  })
}

/** Build the details projection for a working document. Cheap; recompute per revision. */
export function buildArisDetailsDocument(
  document: ArisWorkingDocument,
  attachments?: ReadonlyMap<string, ArisDetailsAttachment>
): ArisDetailsDocument {
  return adaptWorkingDocument(document, attachments ? { attachments } : {})
}
