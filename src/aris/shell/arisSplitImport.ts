/**
 * Split-import staging + review dialog (lane T7).
 *
 * {@link prepareArisSplitImport} turns a parsed ARIS XML source package into a
 * staged plan of workspace file writes, skipping models that already exist in
 * the target workspace. {@link executeArisSplitImport} commits that plan
 * sequentially, retrying on external already-exists conflicts with a new
 * numeric suffix and collecting failures rather than throwing.
 */

import { buildArisSplitPlan } from '../source/amlSplit'
import { uniquePathIn } from '../../workspace/liteTreeFromEntries'
import type { ArisXmlSourcePackage } from '../source/sourcePackage'
import type { WorkspaceAdapter } from '../../workspace/adapters/types'

export interface ArisSplitImportTarget {
  readonly modelId: string
  readonly modelName: string | null
  readonly relPath: string
  readonly bytes: Uint8Array
  readonly status: 'write' | 'skip-existing-model'
}

export interface ArisSplitImportPlan {
  readonly sourceName: string
  readonly targets: readonly ArisSplitImportTarget[]
  readonly writeCount: number
  readonly skipCount: number
}

export interface ArisSplitImportOutcome {
  readonly written: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly { readonly relPath: string; readonly message: string }[]
}

function joinRel(dirRel: string, name: string): string {
  if (!dirRel) return name
  return `${dirRel}/${name}`
}

function splitPath(path: string): { dirRel: string; fileName: string } {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash === -1) return { dirRel: '', fileName: path }
  return { dirRel: path.slice(0, lastSlash), fileName: path.slice(lastSlash + 1) }
}

function messageFromOutcome(outcome: Awaited<ReturnType<WorkspaceAdapter['writeAtomic']>>): string {
  if ('error' in outcome && outcome.error) return outcome.error.message
  return outcome.status
}

/**
 * Build a split-import plan: one workspace target per model emitted by the
 * span-preserving splitter. Models whose id is already present in the workspace
 * are marked `skip-existing-model`; everything else receives a unique relative
 * path under `baseFolderRel` and is counted as a write.
 */
export function prepareArisSplitImport(options: {
  readonly pkg: ArisXmlSourcePackage
  readonly baseFolderRel: string
  readonly takenPaths: ReadonlySet<string>
  readonly existingModelIds: ReadonlySet<string>
}): ArisSplitImportPlan {
  const splitPlan = buildArisSplitPlan(options.pkg)
  const taken = new Set(options.takenPaths)
  const targets: ArisSplitImportTarget[] = []
  let writeCount = 0
  let skipCount = 0

  for (const file of splitPlan.files) {
    const folderPath = file.folderSegments.join('/')
    const dirRel = folderPath ? joinRel(options.baseFolderRel, folderPath) : options.baseFolderRel
    const isExisting = options.existingModelIds.has(file.modelId)

    if (isExisting) {
      targets.push(
        Object.freeze({
          modelId: file.modelId,
          modelName: file.modelName,
          relPath: joinRel(dirRel, file.fileName),
          bytes: new Uint8Array(0),
          status: 'skip-existing-model' as const
        })
      )
      skipCount += 1
      continue
    }

    const relPath = uniquePathIn(taken, dirRel, file.fileName)
    taken.add(relPath)
    targets.push(
      Object.freeze({
        modelId: file.modelId,
        modelName: file.modelName,
        relPath,
        bytes: new TextEncoder().encode(file.text),
        status: 'write' as const
      })
    )
    writeCount += 1
  }

  return Object.freeze({
    sourceName: options.pkg.name,
    targets: Object.freeze(targets),
    writeCount,
    skipCount
  })
}

/**
 * Execute a prepared split-import plan against a workspace adapter.
 *
 * Writes are performed sequentially. If a target path already exists, the
 * caller's `expectedMissing` guard returns an `already-exists` conflict; this
 * function retries with a fresh numeric suffix up to 50 times. Any failure is
 * collected in the outcome; nothing is thrown.
 */
export async function executeArisSplitImport(
  adapter: WorkspaceAdapter,
  plan: ArisSplitImportPlan
): Promise<ArisSplitImportOutcome> {
  const written: string[] = []
  const skipped: string[] = []
  const failed: { relPath: string; message: string }[] = []
  const taken = new Set(plan.targets.map((target) => target.relPath))

  for (const target of plan.targets) {
    if (target.status === 'skip-existing-model') {
      skipped.push(target.relPath)
      continue
    }

    let path = target.relPath
    let outcome = await adapter.writeAtomic(path, target.bytes, undefined, {
      expectedMissing: true
    })
    let attempts = 0

    while (
      outcome.ok === false &&
      outcome.status === 'external-conflict' &&
      outcome.reason === 'already-exists' &&
      attempts < 50
    ) {
      taken.add(path)
      const { dirRel, fileName } = splitPath(target.relPath)
      path = uniquePathIn(taken, dirRel, fileName)
      outcome = await adapter.writeAtomic(path, target.bytes, undefined, { expectedMissing: true })
      attempts += 1
    }

    if (outcome.ok) {
      written.push(path)
    } else {
      failed.push({ relPath: path, message: messageFromOutcome(outcome) })
    }
  }

  return Object.freeze({
    written: Object.freeze(written),
    skipped: Object.freeze(skipped),
    failed: Object.freeze(failed)
  })
}
