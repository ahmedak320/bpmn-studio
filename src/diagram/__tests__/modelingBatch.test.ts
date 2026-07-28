import { describe, expect, it, vi } from 'vitest'
import {
  ModelingBatch,
  ModelingBatchHandler,
  ORBITPM_MODELING_BATCH_COMMAND,
  executeModelingBatch,
  type ModelingBatchUpdate
} from '../modelingBatch'

describe('ModelingBatchHandler', () => {
  it('dispatches property and waypoint updates in one ordered command context', () => {
    const updateProperties = vi.fn()
    const updateWaypoints = vi.fn()
    const handler = new ModelingBatchHandler({
      updateProperties,
      updateWaypoints
    })
    const element = { id: 'Task_1' }
    const connection = { id: 'Flow_1' }
    const updates: ModelingBatchUpdate[] = [
      {
        kind: 'properties',
        element,
        properties: { name: 'Arabic label' }
      },
      {
        kind: 'waypoints',
        connection,
        waypoints: [
          { x: 0, y: 0 },
          { x: 100, y: 0 }
        ]
      }
    ]

    handler.preExecute({ updates })

    expect(updateProperties).toHaveBeenCalledWith(element, {
      name: 'Arabic label'
    })
    expect(updateWaypoints).toHaveBeenCalledWith(connection, [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ])
  })
})

describe('ModelingBatch service', () => {
  it('registers one top-level command and skips an empty update list', () => {
    const registerHandler = vi.fn()
    const execute = vi.fn()
    const service = new ModelingBatch({ registerHandler, execute })

    expect(registerHandler).toHaveBeenCalledWith(
      ORBITPM_MODELING_BATCH_COMMAND,
      ModelingBatchHandler
    )
    service.execute([])
    expect(execute).not.toHaveBeenCalled()

    const updates: ModelingBatchUpdate[] = [
      {
        kind: 'properties',
        element: { id: 'Task_1' },
        properties: { name: 'Updated' }
      }
    ]
    service.execute(updates)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(ORBITPM_MODELING_BATCH_COMMAND, {
      updates
    })
  })

  it('uses the registered atomic service when available', () => {
    const execute = vi.fn()
    const modeling = { updateProperties: vi.fn() }
    const modeler = {
      get(name: string): unknown {
        if (name === 'orbitpmModelingBatch') return { execute }
        if (name === 'modeling') return modeling
        throw new Error(`unexpected service ${name}`)
      }
    }
    const updates: ModelingBatchUpdate[] = [
      {
        kind: 'properties',
        element: { id: 'Task_1' },
        properties: { name: 'Updated' }
      }
    ]

    executeModelingBatch(modeler, updates)

    expect(execute).toHaveBeenCalledWith(updates)
    expect(modeling.updateProperties).not.toHaveBeenCalled()
  })

  it('propagates an atomic service failure without sequentially replaying updates', () => {
    const partialEffects: unknown[] = []
    const execute = vi.fn((updates: readonly ModelingBatchUpdate[]) => {
      partialEffects.push(updates[0])
      throw new Error('atomic batch failed after its first nested command')
    })
    const modeling = {
      updateProperties: vi.fn(),
      updateWaypoints: vi.fn()
    }
    const modeler = {
      get(name: string): unknown {
        if (name === 'orbitpmModelingBatch') return { execute }
        if (name === 'modeling') return modeling
        throw new Error(`unexpected service ${name}`)
      }
    }
    const updates: ModelingBatchUpdate[] = [
      {
        kind: 'properties',
        element: { id: 'Task_1' },
        properties: { name: 'First' }
      },
      {
        kind: 'properties',
        element: { id: 'Task_2' },
        properties: { name: 'Second' }
      }
    ]

    expect(() => executeModelingBatch(modeler, updates)).toThrow(
      'atomic batch failed after its first nested command'
    )
    expect(execute).toHaveBeenCalledOnce()
    expect(partialEffects).toEqual([updates[0]])
    expect(modeling.updateProperties).not.toHaveBeenCalled()
    expect(modeling.updateWaypoints).not.toHaveBeenCalled()
  })
})
