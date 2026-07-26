import {
  WorkspaceOperationError,
  normalizeWorkspacePath,
  sha256Hex,
  type FileSnapshot,
  type WorkspaceAdapter,
  type WorkspaceEntryKind,
  type WorkspaceOperation
} from '../workspace/adapters'
import type { PortableHistoryManager } from '../workspace/history/historyManager'
import type { PathEntryKind, PathTransactionPlan } from './pathTransactions'

export const PATH_TRANSACTION_STAGING_ROOT = '.orbitpm/transactions'

export interface AdapterPathMutationOptions {
  history?: Pick<PortableHistoryManager, 'createRevision'>
}

export interface CapturedPathInventoryEntry {
  readonly suffix: string
  readonly kind: WorkspaceEntryKind
  readonly snapshot?: FileSnapshot
}

export interface CapturedPathInventory {
  readonly rootPath: string
  readonly rootKind: PathEntryKind
  readonly entries: readonly CapturedPathInventoryEntry[]
}

export interface AdapterPathMutation {
  rollback(): Promise<void>
  finalize?(): Promise<void>
}

export class AdapterPathMutationError extends Error {
  readonly rollbackError?: unknown

  constructor(message: string, options: { cause?: unknown; rollbackError?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'AdapterPathMutationError'
    this.rollbackError = options.rollbackError
  }
}

const encoder = new TextEncoder()

function isReservedPath(path: string): boolean {
  return path === '.orbitpm' || path.startsWith('.orbitpm/')
}

function operationForPlan(plan: PathTransactionPlan): 'rename' | 'move' | 'remove' {
  if (plan.request.kind === 'rename') return 'rename'
  if (plan.request.kind === 'move') return 'move'
  return 'remove'
}

function integrityFailure(
  operation: WorkspaceOperation,
  path: string,
  message: string,
  cause?: unknown
): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'integrity-failure',
    operation,
    path,
    message,
    cause
  })
}

function assertPlanTargetsAdapter(adapter: WorkspaceAdapter, plan: PathTransactionPlan): void {
  if (plan.phase !== 'ready' && plan.phase !== 'applying') {
    throw new AdapterPathMutationError(
      `Path transaction storage cannot run while its phase is "${plan.phase}".`
    )
  }
  if (plan.request.workspaceId !== adapter.id) {
    throw new WorkspaceOperationError({
      code: 'stale-workspace',
      operation: operationForPlan(plan),
      path: plan.request.sourcePath,
      message: `Path transaction targets workspace "${plan.request.workspaceId}", not active workspace "${adapter.id}".`
    })
  }
  const source = normalizeWorkspacePath(plan.request.sourcePath)
  const destination =
    plan.request.destinationPath === undefined
      ? undefined
      : normalizeWorkspacePath(plan.request.destinationPath)
  if (isReservedPath(source) || (destination !== undefined && isReservedPath(destination))) {
    throw new WorkspaceOperationError({
      code: 'unsupported',
      operation: operationForPlan(plan),
      path: isReservedPath(source) ? source : destination,
      message: 'OrbitPM metadata paths are reserved and cannot be changed as library entries.'
    })
  }
}

function ownedSnapshot(snapshot: FileSnapshot): FileSnapshot {
  return Object.freeze({
    ...snapshot,
    bytes: new Uint8Array(snapshot.bytes)
  })
}

async function captureFile(
  adapter: WorkspaceAdapter,
  rootPath: string
): Promise<CapturedPathInventory> {
  const snapshot = await adapter.read(rootPath)
  return Object.freeze({
    rootPath,
    rootKind: 'file',
    entries: Object.freeze([
      Object.freeze({
        suffix: '',
        kind: 'file' as const,
        snapshot: ownedSnapshot(snapshot)
      })
    ])
  })
}

async function captureDirectory(
  adapter: WorkspaceAdapter,
  rootPath: string
): Promise<CapturedPathInventory> {
  const descendants = await adapter.list(rootPath)
  const entries: CapturedPathInventoryEntry[] = [
    Object.freeze({ suffix: '', kind: 'directory' as const })
  ]
  for (const entry of descendants) {
    const prefix = `${rootPath}/`
    if (!entry.path.startsWith(prefix)) {
      throw integrityFailure(
        'list',
        rootPath,
        `Workspace listing returned out-of-scope entry "${entry.path}".`
      )
    }
    const suffix = entry.path.slice(rootPath.length)
    if (entry.kind === 'directory') {
      entries.push(Object.freeze({ suffix, kind: 'directory' }))
      continue
    }
    if (!entry.readable) {
      throw new WorkspaceOperationError(
        entry.issue ?? {
          code: 'storage-failure',
          operation: 'read',
          path: entry.path,
          message: `Workspace file "${entry.path}" is unreadable.`
        }
      )
    }
    entries.push(
      Object.freeze({
        suffix,
        kind: 'file',
        snapshot: ownedSnapshot(await adapter.read(entry.path))
      })
    )
  }
  entries.sort((left, right) => left.suffix.localeCompare(right.suffix))
  return Object.freeze({
    rootPath,
    rootKind: 'directory',
    entries: Object.freeze(entries)
  })
}

export async function capturePathInventory(
  adapter: WorkspaceAdapter,
  pathInput: string,
  expectedKind: PathEntryKind
): Promise<CapturedPathInventory> {
  const path = normalizeWorkspacePath(pathInput)
  try {
    return expectedKind === 'file'
      ? await captureFile(adapter, path)
      : await captureDirectory(adapter, path)
  } catch (error) {
    if (error instanceof WorkspaceOperationError && error.code === 'not-found') throw error
    throw integrityFailure(
      expectedKind === 'file' ? 'read' : 'list',
      path,
      `Workspace entry "${path}" is not the expected ${expectedKind} or could not be captured safely.`,
      error
    )
  }
}

function sameInventory(expected: CapturedPathInventory, actual: CapturedPathInventory): boolean {
  return (
    expected.rootKind === actual.rootKind &&
    expected.entries.length === actual.entries.length &&
    expected.entries.every((entry, index) => {
      const candidate = actual.entries[index]
      return (
        entry.suffix === candidate?.suffix &&
        entry.kind === candidate.kind &&
        (entry.kind === 'directory' ||
          (entry.snapshot?.hash === candidate.snapshot?.hash &&
            entry.snapshot?.size === candidate.snapshot?.size))
      )
    })
  )
}

async function assertInventoryAt(
  adapter: WorkspaceAdapter,
  path: string,
  expected: CapturedPathInventory,
  operation: WorkspaceOperation
): Promise<void> {
  let actual: CapturedPathInventory
  try {
    actual = await capturePathInventory(adapter, path, expected.rootKind)
  } catch (error) {
    throw integrityFailure(
      operation,
      path,
      `Workspace entry "${path}" changed or disappeared during the path transaction.`,
      error
    )
  }
  if (!sameInventory(expected, actual)) {
    throw integrityFailure(
      operation,
      path,
      `Workspace entry "${path}" changed during the path transaction.`
    )
  }
}

async function assertPathMissing(
  adapter: WorkspaceAdapter,
  pathInput: string,
  operation: WorkspaceOperation
): Promise<void> {
  const path = normalizeWorkspacePath(pathInput)
  const entry = (await adapter.list()).find((candidate) => candidate.path === path)
  if (entry) {
    throw integrityFailure(
      operation,
      path,
      `Workspace entry "${path}" unexpectedly exists during the path transaction.`
    )
  }
}

async function relocate(
  adapter: WorkspaceAdapter,
  kind: 'rename' | 'move',
  from: string,
  to: string
): Promise<void> {
  if (kind === 'rename') await adapter.rename(from, to)
  else await adapter.move(from, to)
}

async function guardedInverseRelocation(input: {
  adapter: WorkspaceAdapter
  kind: 'rename' | 'move'
  source: string
  destination: string
  inventory: CapturedPathInventory
}): Promise<void> {
  await assertPathMissing(input.adapter, input.source, input.kind)
  await assertInventoryAt(input.adapter, input.destination, input.inventory, input.kind)
  await relocate(input.adapter, input.kind, input.destination, input.source)
  await assertPathMissing(input.adapter, input.destination, input.kind)
  await assertInventoryAt(input.adapter, input.source, input.inventory, input.kind)
}

async function finishVerifiedRelocation(input: {
  adapter: WorkspaceAdapter
  kind: 'rename' | 'move'
  source: string
  destination: string
  inventory: CapturedPathInventory
}): Promise<AdapterPathMutation> {
  let state: 'applied' | 'rolled-back' = 'applied'
  try {
    await assertPathMissing(input.adapter, input.source, input.kind)
    await assertInventoryAt(input.adapter, input.destination, input.inventory, input.kind)
  } catch (verificationError) {
    try {
      await guardedInverseRelocation(input)
    } catch (rollbackError) {
      throw new AdapterPathMutationError(
        'The workspace path changed after relocation and automatic rollback was unsafe.',
        { cause: verificationError, rollbackError }
      )
    }
    throw verificationError
  }
  return {
    rollback: async () => {
      if (state === 'rolled-back') return
      await guardedInverseRelocation(input)
      state = 'rolled-back'
    }
  }
}

async function transactionStagingPath(planId: string): Promise<string> {
  const hash = await sha256Hex(encoder.encode(planId))
  return `${PATH_TRANSACTION_STAGING_ROOT}/tx-${hash.slice(0, 32)}`
}

async function removeEmptyTransactionFolder(
  adapter: WorkspaceAdapter,
  transactionRoot: string
): Promise<void> {
  try {
    if ((await adapter.list(transactionRoot)).length === 0) {
      await adapter.remove(transactionRoot)
    }
  } catch {
    // Empty staging-folder cleanup is advisory; payload safety is authoritative.
  }
}

async function assertTransactionContainsOnlyPayload(
  adapter: WorkspaceAdapter,
  transactionRoot: string,
  payloadPath: string
): Promise<void> {
  const entries = await adapter.list(transactionRoot)
  if (
    entries.some((entry) => entry.path !== payloadPath && !entry.path.startsWith(`${payloadPath}/`))
  ) {
    throw integrityFailure(
      'remove',
      transactionRoot,
      'Transaction staging contains unexpected data and will be preserved for recovery.'
    )
  }
}

async function createDeleteHistory(
  inventory: CapturedPathInventory,
  history: AdapterPathMutationOptions['history']
): Promise<void> {
  const bpmn = inventory.entries.filter(
    (
      entry
    ): entry is CapturedPathInventoryEntry & {
      readonly snapshot: FileSnapshot
    } => entry.kind === 'file' && /\.bpmn$/iu.test(entry.snapshot?.path ?? '')
  )
  if (bpmn.length > 0 && !history) {
    throw new WorkspaceOperationError({
      code: 'unsupported',
      operation: 'remove',
      path: inventory.rootPath,
      message: 'Deleting BPMN files requires a portable history manager.'
    })
  }
  for (const entry of bpmn) {
    await history!.createRevision(entry.snapshot.path, {
      reason: 'delete',
      snapshot: entry.snapshot
    })
  }
}

async function stageDelete(
  adapter: WorkspaceAdapter,
  plan: PathTransactionPlan,
  inventory: CapturedPathInventory,
  options: AdapterPathMutationOptions
): Promise<AdapterPathMutation> {
  const source = plan.request.sourcePath
  const transactionRoot = await transactionStagingPath(plan.id)
  const payloadPath = `${transactionRoot}/payload`
  await adapter.createFolder(transactionRoot)
  const existingStagingEntries = await adapter.list(transactionRoot)
  if (existingStagingEntries.length > 0) {
    throw integrityFailure(
      'move',
      transactionRoot,
      'Transaction staging already contains recoverable data and cannot be reused.'
    )
  }
  try {
    await createDeleteHistory(inventory, options.history)
  } catch (error) {
    await removeEmptyTransactionFolder(adapter, transactionRoot)
    throw error
  }
  try {
    await adapter.move(source, payloadPath)
  } catch (error) {
    await removeEmptyTransactionFolder(adapter, transactionRoot)
    throw error
  }

  let state: 'staged' | 'rolled-back' | 'finalized' = 'staged'
  const rollback = async (): Promise<void> => {
    if (state === 'rolled-back') return
    if (state === 'finalized') {
      throw new AdapterPathMutationError('A finalized delete transaction cannot be rolled back.')
    }
    await guardedInverseRelocation({
      adapter,
      kind: 'move',
      source,
      destination: payloadPath,
      inventory
    })
    state = 'rolled-back'
    await removeEmptyTransactionFolder(adapter, transactionRoot)
  }

  try {
    await assertPathMissing(adapter, source, 'move')
    await assertInventoryAt(adapter, payloadPath, inventory, 'move')
  } catch (verificationError) {
    try {
      await rollback()
    } catch (rollbackError) {
      throw new AdapterPathMutationError(
        'The workspace delete staging could not be verified or rolled back safely.',
        { cause: verificationError, rollbackError }
      )
    }
    throw verificationError
  }

  return {
    rollback,
    finalize: async () => {
      if (state === 'finalized') return
      if (state === 'rolled-back') {
        throw new AdapterPathMutationError('A rolled-back delete transaction cannot be finalized.')
      }
      await assertPathMissing(adapter, source, 'remove')
      await assertInventoryAt(adapter, payloadPath, inventory, 'remove')
      await assertTransactionContainsOnlyPayload(adapter, transactionRoot, payloadPath)
      await adapter.remove(transactionRoot)
      state = 'finalized'
    }
  }
}

export async function mutateAdapterPath(
  adapter: WorkspaceAdapter,
  plan: PathTransactionPlan,
  options: AdapterPathMutationOptions = {}
): Promise<AdapterPathMutation> {
  assertPlanTargetsAdapter(adapter, plan)
  const source = normalizeWorkspacePath(plan.request.sourcePath)
  const inventory = await capturePathInventory(adapter, source, plan.request.entryKind)
  await assertInventoryAt(adapter, source, inventory, operationForPlan(plan))

  if (plan.request.kind === 'delete') {
    return stageDelete(adapter, plan, inventory, options)
  }

  const destination = normalizeWorkspacePath(plan.request.destinationPath ?? '')
  await assertPathMissing(adapter, destination, plan.request.kind)
  await relocate(adapter, plan.request.kind, source, destination)
  return finishVerifiedRelocation({
    adapter,
    kind: plan.request.kind,
    source,
    destination,
    inventory
  })
}

export function createAdapterPathMutation(
  adapter: WorkspaceAdapter,
  options: AdapterPathMutationOptions = {}
): (plan: PathTransactionPlan) => Promise<AdapterPathMutation> {
  return (plan) => mutateAdapterPath(adapter, plan, options)
}
