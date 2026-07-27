/**
 * Promise-tail mutex. A rejected operation never poisons the queue and all
 * compare-before-write sequences on one adapter instance remain serialized.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}
