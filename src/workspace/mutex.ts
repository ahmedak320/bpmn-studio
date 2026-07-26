// A tiny FIFO async mutex. Serializes in-app filesystem mutations (create /
// import / AI-place) so two overlapping operations can never both pick the same
// "free" filename slug and clobber each other (Codex MAJOR-3). Deliberately
// dependency-free (no React / DOM) so the ordering guarantee is unit-testable
// in plain node (see src/__tests__/mutex.test.ts).

export interface AsyncMutex {
  /**
   * Run `fn` with exclusive access: it starts only after every previously
   * enqueued task has settled, and the next queued task waits for it. Returns
   * `fn`'s result; a rejection is propagated to the caller but does NOT stall
   * the queue (the next task still runs).
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>
}

export function createMutex(): AsyncMutex {
  // The tail of the queue: each new task chains off it, so tasks execute in the
  // order runExclusive() was called. `catch(() => {})` keeps a failed task from
  // poisoning the chain for the tasks queued behind it.
  let tail: Promise<unknown> = Promise.resolve()
  return {
    runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn)
      tail = run.catch(() => {})
      return run
    }
  }
}
