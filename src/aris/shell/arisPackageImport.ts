/**
 * Import an AML source through `src/aris/packages` — plan §7.3.
 *
 * The package lane is strictly two-phase and this module preserves that: `plan`
 * only reads the workspace and produces a review payload plus a review digest;
 * `commit` echoes that exact digest, writes atomically, and rolls back
 * completely on any failure. The UI must show `plan.review` in between, which is
 * why the two halves are separate exported functions rather than one call.
 *
 * Both storage shapes go through `openArisWorkspace`: a directory workspace
 * becomes a package directory, and a single-file workspace is hydrated into the
 * portable container (plan §2.5) and flushed with one compare-and-set write.
 * Portable mode is not a fallback here — the flush result is reported verbatim,
 * including failure, so a portable workspace can never be told an import
 * succeeded when its container was not written.
 */

import { SingleFileWorkspaceAdapter } from '../../workspace/adapters/singleFile'
import type { WorkspaceAdapter } from '../../workspace/adapters/types'
import { createArisAccountingDocument } from '../packages/accounting'
import type { ArisModelManifestEntry } from '../packages/manifest'
import {
  arisPortableFileName,
  classifyArisWorkspace,
  looksLikeArisPortableContainer,
  openArisWorkspace,
  type ArisPortableFlushResult,
  type ArisWorkspaceSession
} from '../packages/portable'
import {
  commitArisSourcePackage,
  planArisImportedPackage,
  type ArisPackageCommitOutcome,
  type ArisSourcePackagePlan
} from '../packages/transaction'
import type { ArisXmlSourcePackage } from '../source/sourcePackage'
import { arisText, type ArisStudioDocument } from './arisStudioDocument'

export interface ArisPreparedImport {
  readonly session: ArisWorkspaceSession
  readonly plan: ArisSourcePackagePlan
}

export interface ArisImportResult {
  readonly outcome: ArisPackageCommitOutcome
  readonly flush: ArisPortableFlushResult
}

function modelManifestEntries(
  pkg: ArisXmlSourcePackage,
  studio: ArisStudioDocument
): readonly ArisModelManifestEntry[] {
  const summaries = new Map(studio.models.map((model) => [model.id, model]))
  const entries: ArisModelManifestEntry[] = []
  for (const record of pkg.index.models.values()) {
    const modelId = record.parsed.modelId ?? record.sourceId
    if (!modelId) continue
    const summary = summaries.get(modelId)
    entries.push({
      modelId,
      name: (summary ? arisText(summary.names, 'en') : null) ?? modelId,
      modelType: record.parsed.modelType ?? 'MT_UNKNOWN',
      objectCount: summary?.objectCount ?? 0,
      connectionCount: summary?.connectionCount ?? 0,
      sourcePath: record.path
    })
  }
  return entries
}

/**
 * Choose what `openArisWorkspace` should open.
 *
 * A directory workspace opens as itself. A single-file workspace that already
 * holds a portable container opens in place, so a portable round-trip updates
 * the same file. A single-file workspace whose only file is the *imported
 * source* must not open as itself: flushing would replace the user's AML with a
 * container. It gets a sibling container target instead, named by the packages
 * lane's own `arisPortableFileName`.
 */
async function resolvePortableTarget(
  adapter: WorkspaceAdapter,
  sourceName: string
): Promise<{ readonly adapter: WorkspaceAdapter; readonly initialize: boolean }> {
  if (classifyArisWorkspace(adapter) !== 'portable-single-file') {
    return { adapter, initialize: false }
  }
  const entries = await adapter.list('')
  const only = entries.find((entry) => entry.kind === 'file')
  if (only) {
    try {
      const snapshot = await adapter.read(only.path)
      if (looksLikeArisPortableContainer(snapshot.bytes)) {
        return { adapter, initialize: false }
      }
    } catch {
      // Unreadable: fall through to a fresh container target.
    }
  }
  return {
    adapter: new SingleFileWorkspaceAdapter({
      path: arisPortableFileName(sourceName),
      bytes: new Uint8Array(),
      workspaceId: `${adapter.id}::aris-portable`
    }),
    initialize: true
  }
}

/**
 * Phase one: open the workspace in the right storage mode and stage every write
 * in memory. Nothing is written; the returned `plan.review` is what the UI must
 * show before `commitArisWorkspaceImport` may be called.
 */
export async function prepareArisWorkspaceImport(
  adapter: WorkspaceAdapter,
  pkg: ArisXmlSourcePackage,
  studio: ArisStudioDocument
): Promise<ArisPreparedImport> {
  const target = await resolvePortableTarget(adapter, pkg.name)
  const session = await openArisWorkspace(
    target.adapter,
    target.initialize ? { initialize: true } : {}
  )
  const accounting = createArisAccountingDocument({
    sourceSha256: pkg.sha256,
    censusRecords: studio.census.totalSourceRecords,
    entries: studio.sourceAccountingEntries.map((entry) => ({
      sourcePath: entry.sourcePath,
      ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
      kind: entry.kind,
      disposition: entry.disposition,
      targetIds: entry.targetIds,
      // `derived` is what tells the accounting document which rows the lexical
      // census deliberately does not count. Dropping it here would make the
      // census bound reject the very rows it was designed to exclude.
      ...(entry.derived === undefined ? {} : { derived: entry.derived }),
      ...(entry.reason ? { reason: entry.reason } : {})
    }))
  })

  const plan = await planArisImportedPackage({
    adapter: session.workspace,
    source: pkg.lossless.source,
    analysis: { index: pkg.index, diagnostics: pkg.diagnostics },
    accounting,
    models: modelManifestEntries(pkg, studio)
  })

  return { session, plan }
}

/**
 * Phase two: commit the reviewed plan, then flush the session.
 *
 * The flush result is returned unchanged. In directory mode it is always
 * `unchanged` (members were already durable); in portable mode it is the real
 * outcome of the container write, and a `failed` flush means the workspace file
 * still holds its previous bytes.
 */
export async function commitArisWorkspaceImport(
  prepared: ArisPreparedImport
): Promise<ArisImportResult> {
  const outcome = await commitArisSourcePackage({
    adapter: prepared.session.workspace,
    plan: prepared.plan,
    reviewedDigest: prepared.plan.reviewDigest
  })
  if (outcome.status !== 'committed' && outcome.status !== 'deduplicated') {
    return { outcome, flush: { status: 'failed', message: outcome.error.message } }
  }
  const flush = await prepared.session.flush()
  return { outcome, flush }
}
