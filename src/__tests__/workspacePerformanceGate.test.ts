import { describe, expect, it } from 'vitest'

import { measureProductionWorkspacePerformance } from '../../scripts/workspacePerformance'

describe('production workspace performance measurement', () => {
  it('measures adapter list/read through snapshot/index/projection and an exact no-rescan 1% delta', async () => {
    const result = await measureProductionWorkspacePerformance({
      fileCount: 100,
      changedFileCount: 1,
      directoryCount: 10
    })

    expect(result.initial.details).toMatchObject({
      fixtureFiles: 100,
      adapterListCalls: 1,
      adapterReadCalls: 100,
      snapshotFiles: 100,
      snapshotIssues: 0,
      indexedFiles: 100,
      projectedFiles: 100
    })
    expect(result.incremental.details).toEqual({
      fixtureFiles: 100,
      changedFiles: 1,
      changedBasisPoints: 100,
      adapterWrites: 1,
      additionalListCalls: 0,
      additionalReadCalls: 0,
      indexedChangedFiles: 1,
      projectedFiles: 100
    })
    expect(result.initial.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(result.incremental.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('rejects a change set that is not exactly one percent', async () => {
    await expect(
      measureProductionWorkspacePerformance({
        fileCount: 100,
        changedFileCount: 2
      })
    ).rejects.toThrow('exactly one percent')
  })
})
