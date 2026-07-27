import { performance } from 'node:perf_hooks'

import {
  applyCommittedWorkspaceProjectionDelta,
  snapshotAdapterWorkspace
} from '../src/workspace/adapterSnapshot'
import {
  MemoryWorkspaceAdapter,
  type FileSnapshot,
  type ListWorkspaceOptions,
  type ReadFileOptions,
  type SaveOutcome,
  type WorkspaceEntry,
  type WriteAtomicOptions
} from '../src/workspace/adapters'
import { LiveWorkspaceIndex } from '../src/workspace/liveWorkspaceIndex'

export interface WorkspacePerformanceOptions {
  readonly fileCount?: number
  readonly changedFileCount?: number
  readonly directoryCount?: number
}

export interface WorkspacePerformanceMeasurement {
  readonly name: 'initialWorkspaceFiles1000' | 'incrementalWorkspaceOnePercent'
  readonly elapsedMs: number
  readonly details: Readonly<Record<string, number>>
}

export interface WorkspacePerformanceResult {
  readonly initial: WorkspacePerformanceMeasurement
  readonly incremental: WorkspacePerformanceMeasurement
}

class MeasuredMemoryWorkspaceAdapter extends MemoryWorkspaceAdapter {
  listCalls = 0
  readCalls = 0
  writeCalls = 0
  activeReads = 0
  peakConcurrentReads = 0

  override async list(path = '', options: ListWorkspaceOptions = {}): Promise<WorkspaceEntry[]> {
    this.listCalls += 1
    return super.list(path, options)
  }

  override async read(path: string, options: ReadFileOptions = {}): Promise<FileSnapshot> {
    this.readCalls += 1
    this.activeReads += 1
    this.peakConcurrentReads = Math.max(this.peakConcurrentReads, this.activeReads)
    try {
      return await super.read(path, options)
    } finally {
      this.activeReads -= 1
    }
  }

  override async writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options: WriteAtomicOptions = {}
  ): Promise<SaveOutcome> {
    this.writeCalls += 1
    return super.writeAtomic(path, bytes, expectedHash, options)
  }
}

function ordinaryBpmn(processIndex: number, revision = 0): string {
  const tasks = Array.from({ length: 8 }, (_, index) => {
    const id = `Task_${processIndex}_${index + 1}`
    return `<bpmn:userTask id="${id}" name="Review item ${index + 1}" orbitpm:nameEn="Review item ${index + 1}" orbitpm:nameAr="مراجعة البند ${index + 1}" />`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:orbitpm="https://orbitpm.dev/schema/1.0"
  id="Definitions_${processIndex}">
  <bpmn:process id="Process_${processIndex}" name="Process ${processIndex} revision ${revision}">
    <bpmn:startEvent id="Start_${processIndex}" name="Start" orbitpm:nameEn="Start" orbitpm:nameAr="البداية" />
    ${tasks}
    <bpmn:endEvent id="End_${processIndex}" name="End" orbitpm:nameEn="End" orbitpm:nameAr="النهاية" />
  </bpmn:process>
</bpmn:definitions>`
}

function fixturePath(index: number, directoryCount: number): string {
  return (
    `department-${String(index % directoryCount).padStart(2, '0')}/` +
    `process-${String(index).padStart(4, '0')}.bpmn`
  )
}

function countProjectedFiles(node: {
  readonly type: 'file' | 'directory'
  readonly children?: readonly {
    readonly type: 'file' | 'directory'
    readonly children?: readonly unknown[]
  }[]
}): number {
  if (node.type === 'file') return 1
  return (node.children ?? []).reduce(
    (total, child) =>
      total +
      countProjectedFiles(
        child as {
          type: 'file' | 'directory'
          children?: readonly {
            type: 'file' | 'directory'
            children?: readonly unknown[]
          }[]
        }
      ),
    0
  )
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`)
  }
}

export async function measureProductionWorkspacePerformance(
  options: WorkspacePerformanceOptions = {}
): Promise<WorkspacePerformanceResult> {
  const fileCount = options.fileCount ?? 1_000
  const changedFileCount = options.changedFileCount ?? 10
  const directoryCount = options.directoryCount ?? 25
  assertPositiveInteger(fileCount, 'fileCount')
  assertPositiveInteger(changedFileCount, 'changedFileCount')
  assertPositiveInteger(directoryCount, 'directoryCount')
  if (changedFileCount >= fileCount) {
    throw new Error('changedFileCount must be smaller than fileCount.')
  }
  if (changedFileCount * 100 !== fileCount) {
    throw new Error('changedFileCount must be exactly one percent of fileCount.')
  }

  const encoder = new TextEncoder()
  const files = Object.fromEntries(
    Array.from({ length: fileCount }, (_, index) => [
      fixturePath(index, directoryCount),
      ordinaryBpmn(index)
    ])
  )
  const adapter = new MeasuredMemoryWorkspaceAdapter({
    id: 'performance-workspace',
    files
  })

  const initialStartedAt = performance.now()
  const snapshot = await snapshotAdapterWorkspace(adapter, 'Performance workspace', {
    readConcurrency: 8
  })
  const index = new LiveWorkspaceIndex(snapshot.files)
  const initialFiles = index.files()
  const initialProjectedFiles = countProjectedFiles(snapshot.tree)
  const initialElapsedMs = performance.now() - initialStartedAt

  if (snapshot.issues.length !== 0) {
    throw new Error(`Initial production snapshot reported ${snapshot.issues.length} issue(s).`)
  }
  if (
    initialFiles.length !== fileCount ||
    initialProjectedFiles !== fileCount ||
    adapter.listCalls !== 1 ||
    adapter.readCalls !== fileCount
  ) {
    throw new Error('Initial production workspace measurement did not traverse every file once.')
  }

  const listsBeforeDelta = adapter.listCalls
  const readsBeforeDelta = adapter.readCalls
  let projection = { tree: snapshot.tree, issues: snapshot.issues }
  const changedPaths: string[] = []
  const incrementalStartedAt = performance.now()
  for (let indexOffset = 0; indexOffset < changedFileCount; indexOffset += 1) {
    const path = fixturePath(indexOffset, directoryCount)
    const outcome = await adapter.writeAtomic(
      path,
      encoder.encode(ordinaryBpmn(indexOffset, 1)),
      undefined,
      {
        expectedWorkspaceId: adapter.id
      }
    )
    if (!outcome.ok) {
      throw new Error(`Incremental performance write failed for "${path}" (${outcome.status}).`)
    }
    index.updateSaved({
      relPath: outcome.snapshot.path,
      xml: new TextDecoder().decode(outcome.snapshot.bytes),
      lastModified: outcome.snapshot.modifiedAt,
      size: outcome.snapshot.size
    })
    const nextProjection = applyCommittedWorkspaceProjectionDelta(projection, {
      kind: 'upsert-bpmn',
      path
    })
    if (!nextProjection) {
      throw new Error(`Exact projection delta rejected the committed path "${path}".`)
    }
    projection = nextProjection
    changedPaths.push(path)
  }
  const changedFilesVisible = index
    .files()
    .filter((file) => changedPaths.includes(file.relPath) && file.xml.includes('revision 1')).length
  const incrementalProjectedFiles = countProjectedFiles(projection.tree)
  const incrementalElapsedMs = performance.now() - incrementalStartedAt

  if (
    changedFilesVisible !== changedFileCount ||
    incrementalProjectedFiles !== fileCount ||
    adapter.writeCalls !== changedFileCount ||
    adapter.listCalls !== listsBeforeDelta ||
    adapter.readCalls !== readsBeforeDelta
  ) {
    throw new Error(
      'Incremental production workspace measurement was not an exact no-rescan delta.'
    )
  }

  return {
    initial: {
      name: 'initialWorkspaceFiles1000',
      elapsedMs: initialElapsedMs,
      details: {
        fixtureFiles: fileCount,
        adapterListCalls: adapter.listCalls,
        adapterReadCalls: adapter.readCalls,
        peakConcurrentReads: adapter.peakConcurrentReads,
        snapshotFiles: snapshot.files.length,
        snapshotIssues: snapshot.issues.length,
        indexedFiles: initialFiles.length,
        projectedFiles: initialProjectedFiles
      }
    },
    incremental: {
      name: 'incrementalWorkspaceOnePercent',
      elapsedMs: incrementalElapsedMs,
      details: {
        fixtureFiles: fileCount,
        changedFiles: changedFileCount,
        changedBasisPoints: (changedFileCount * 10_000) / fileCount,
        adapterWrites: adapter.writeCalls,
        additionalListCalls: adapter.listCalls - listsBeforeDelta,
        additionalReadCalls: adapter.readCalls - readsBeforeDelta,
        indexedChangedFiles: changedFilesVisible,
        projectedFiles: incrementalProjectedFiles
      }
    }
  }
}
