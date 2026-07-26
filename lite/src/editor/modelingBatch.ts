/**
 * One logical, undoable modeling operation containing any number of ordinary
 * bpmn-js property and waypoint updates.
 *
 * Command handlers may invoke nested modeling commands from preExecute; the
 * diagram-js command stack then groups those nested commands into one atomic
 * undo/redo entry. Lite uses this for whole-diagram language projection and
 * automatic connector repair so a single user action never requires dozens of
 * Undo presses.
 */

export const ORBITPM_MODELING_BATCH_COMMAND = 'orbitpm.modeling.batch'

export type ModelingBatchUpdate =
  | {
      kind: 'properties'
      element: unknown
      properties: Record<string, unknown>
    }
  | {
      kind: 'waypoints'
      connection: unknown
      waypoints: Array<{ x: number; y: number }>
    }

interface ModelingLike {
  updateProperties(element: unknown, properties: Record<string, unknown>): void
  updateWaypoints?(
    connection: unknown,
    waypoints: Array<{ x: number; y: number }>
  ): void
}

interface CommandStackLike {
  registerHandler(command: string, handler: unknown): void
  execute(command: string, context: { updates: readonly ModelingBatchUpdate[] }): void
}

interface BatchContext {
  updates: readonly ModelingBatchUpdate[]
}

export class ModelingBatchHandler {
  static $inject = ['modeling']

  private readonly modeling: ModelingLike

  constructor(modeling: ModelingLike) {
    this.modeling = modeling
  }

  preExecute(context: BatchContext): void {
    for (const update of context.updates) {
      if (update.kind === 'properties') {
        this.modeling.updateProperties(update.element, update.properties)
      } else {
        this.modeling.updateWaypoints?.(update.connection, update.waypoints)
      }
    }
  }
}

export class ModelingBatch {
  static $inject = ['commandStack']

  private readonly commandStack: CommandStackLike

  constructor(commandStack: CommandStackLike) {
    this.commandStack = commandStack
    commandStack.registerHandler(
      ORBITPM_MODELING_BATCH_COMMAND,
      ModelingBatchHandler
    )
  }

  execute(updates: readonly ModelingBatchUpdate[]): void {
    if (updates.length === 0) return
    this.commandStack.execute(ORBITPM_MODELING_BATCH_COMMAND, { updates })
  }
}

export interface ModelingBatchModeler {
  get(name: string): unknown
}

/**
 * Run through the registered atomic service. The small sequential fallback is
 * intentionally retained for unit-test fakes and partially constructed
 * modelers; every real Lite modeler registers ModelingBatchModule.
 */
export function executeModelingBatch(
  modeler: ModelingBatchModeler,
  updates: readonly ModelingBatchUpdate[]
): void {
  if (updates.length === 0) return

  try {
    const service = modeler.get('orbitpmModelingBatch') as
      | { execute(value: readonly ModelingBatchUpdate[]): void }
      | undefined
    if (service?.execute) {
      service.execute(updates)
      return
    }
  } catch {
    /* fall through for structural test doubles */
  }

  const modeling = modeler.get('modeling') as ModelingLike
  for (const update of updates) {
    if (update.kind === 'properties') {
      modeling.updateProperties(update.element, update.properties)
    } else {
      modeling.updateWaypoints?.(update.connection, update.waypoints)
    }
  }
}

export const ModelingBatchModule: {
  __init__: string[]
  orbitpmModelingBatch: [string, typeof ModelingBatch]
} = {
  __init__: ['orbitpmModelingBatch'],
  orbitpmModelingBatch: ['type', ModelingBatch]
}
