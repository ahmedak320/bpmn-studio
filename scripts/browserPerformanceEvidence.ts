export const REQUIRED_WORKER_INTERACTIONS = ['typing', 'selection', 'pane'] as const
export type WorkerInteractionName = (typeof REQUIRED_WORKER_INTERACTIONS)[number]

export interface WorkerInteractionReceipt {
  readonly name: WorkerInteractionName
  readonly requestType: 'parse' | 'review'
  readonly trustedEvent: boolean
  readonly workerOverlapMs: number
  readonly responseLatencyMs: number
  readonly observed: string
}

export interface WorkerInteractionGate {
  readonly required: readonly WorkerInteractionName[]
  readonly latencyLimitMs: number
  readonly complete: boolean
  readonly passed: boolean
  readonly failures: readonly string[]
}

export function evaluateWorkerInteractionGate(
  receipts: readonly WorkerInteractionReceipt[],
  latencyLimitMs: number
): WorkerInteractionGate {
  if (!Number.isFinite(latencyLimitMs) || latencyLimitMs <= 0) {
    throw new Error('Worker interaction latency limit must be positive.')
  }
  const failures: string[] = []
  for (const name of REQUIRED_WORKER_INTERACTIONS) {
    const matching = receipts.filter((receipt) => receipt.name === name)
    if (matching.length !== 1) {
      failures.push(`${name} must have exactly one receipt (found ${matching.length})`)
      continue
    }
    const [receipt] = matching
    if (!receipt.trustedEvent)
      failures.push(`${name} did not originate from a trusted browser event`)
    if (receipt.requestType !== 'parse') {
      failures.push(`${name} did not overlap the worker parse phase`)
    }
    if (!(receipt.workerOverlapMs > 0)) {
      failures.push(`${name} did not overlap an active import worker request`)
    }
    if (
      !Number.isFinite(receipt.responseLatencyMs) ||
      receipt.responseLatencyMs < 0 ||
      receipt.responseLatencyMs > latencyLimitMs
    ) {
      failures.push(`${name} exceeded the ${latencyLimitMs} ms response budget`)
    }
    if (!receipt.observed.trim()) failures.push(`${name} did not retain an observed UI result`)
  }
  return {
    required: REQUIRED_WORKER_INTERACTIONS,
    latencyLimitMs,
    complete: REQUIRED_WORKER_INTERACTIONS.every(
      (name) => receipts.filter((receipt) => receipt.name === name).length === 1
    ),
    passed: failures.length === 0,
    failures
  }
}
