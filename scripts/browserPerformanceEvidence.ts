/**
 * Evidence contract for the ARIS browser performance gate (plan §21.4).
 *
 * The gate's hardest requirement is "selection/drag/edit response within 100 ms
 * at p95". Three things make that claim easy to fake, and this module exists to
 * make all three checkable rather than asserted:
 *
 *  - the action must be a REAL browser event (`isTrusted`), not a dispatched
 *    synthetic one and not a direct call into the application's own API;
 *  - the response must be an OBSERVED product change (a details-rail heading, a
 *    moved shape transform, a changed label), not merely "the promise resolved";
 *  - a percentile only means something over a population, so each required
 *    interaction must contribute a declared minimum number of samples.
 *
 * `evaluateArisInteractionGate` fails closed on every one of those.
 */

export const REQUIRED_ARIS_INTERACTIONS = ['selection', 'drag', 'edit'] as const
export type ArisInteractionName = (typeof REQUIRED_ARIS_INTERACTIONS)[number]

export interface ArisInteractionSample {
  readonly name: ArisInteractionName
  /** `event.isTrusted` of the browser event the action produced. */
  readonly trustedEvent: boolean
  /** Milliseconds from the trusted event to the observed product change. */
  readonly responseMs: number
  /** What the product actually showed — empty means nothing was observed. */
  readonly observed: string
}

export interface ArisInteractionStatistic {
  readonly name: ArisInteractionName
  readonly samples: number
  readonly medianMs: number
  readonly p95Ms: number
  readonly maxMs: number
}

export interface ArisInteractionGate {
  readonly required: readonly ArisInteractionName[]
  readonly limitMs: number
  readonly minimumSamplesPerInteraction: number
  readonly perInteraction: readonly ArisInteractionStatistic[]
  readonly overallP95Ms: number
  readonly complete: boolean
  readonly passed: boolean
  readonly failures: readonly string[]
}

/**
 * Nearest-rank percentile: the smallest observed value at or above which the
 * requested fraction of the population sits. No interpolation, so the reported
 * number is always a value that was actually measured.
 */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  if (!(fraction > 0) || fraction > 1) throw new Error('Percentile fraction must be in (0, 1].')
  const ordered = [...values].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil(ordered.length * fraction))
  return ordered[rank - 1] as number
}

function statisticFor(
  name: ArisInteractionName,
  samples: readonly ArisInteractionSample[]
): ArisInteractionStatistic {
  const values = samples.map((sample) => sample.responseMs)
  const ordered = [...values].sort((left, right) => left - right)
  return {
    name,
    samples: values.length,
    medianMs: Number(percentile(ordered, 0.5).toFixed(3)),
    p95Ms: Number(percentile(ordered, 0.95).toFixed(3)),
    maxMs: Number((ordered.at(-1) ?? 0).toFixed(3))
  }
}

export function evaluateArisInteractionGate(
  samples: readonly ArisInteractionSample[],
  limitMs: number,
  minimumSamplesPerInteraction: number
): ArisInteractionGate {
  if (!Number.isFinite(limitMs) || limitMs <= 0) {
    throw new Error('ARIS interaction latency limit must be positive.')
  }
  if (!Number.isInteger(minimumSamplesPerInteraction) || minimumSamplesPerInteraction < 1) {
    throw new Error('Minimum samples per interaction must be a positive integer.')
  }

  const failures: string[] = []
  const perInteraction: ArisInteractionStatistic[] = []
  let complete = true

  for (const name of REQUIRED_ARIS_INTERACTIONS) {
    const matching = samples.filter((sample) => sample.name === name)
    perInteraction.push(statisticFor(name, matching))
    if (matching.length < minimumSamplesPerInteraction) {
      complete = false
      failures.push(
        `${name} contributed ${matching.length} sample(s); ` +
          `${minimumSamplesPerInteraction} are required for a percentile`
      )
      continue
    }
    const untrusted = matching.filter((sample) => !sample.trustedEvent).length
    if (untrusted > 0) {
      failures.push(
        `${name}: ${untrusted} sample(s) did not originate from a trusted browser event`
      )
    }
    const unobserved = matching.filter((sample) => sample.observed.trim() === '').length
    if (unobserved > 0) {
      failures.push(`${name}: ${unobserved} sample(s) recorded no observed product change`)
    }
    const invalid = matching.filter(
      (sample) => !Number.isFinite(sample.responseMs) || sample.responseMs < 0
    ).length
    if (invalid > 0)
      failures.push(`${name}: ${invalid} sample(s) carry an impossible response time`)
  }

  const overallP95 = Number(
    percentile(
      samples.map((sample) => sample.responseMs),
      0.95
    ).toFixed(3)
  )
  if (complete && overallP95 > limitMs) {
    failures.push(`selection/drag/edit p95 is ${overallP95} ms, above the ${limitMs} ms budget`)
  }

  return {
    required: REQUIRED_ARIS_INTERACTIONS,
    limitMs,
    minimumSamplesPerInteraction,
    perInteraction,
    overallP95Ms: overallP95,
    complete,
    passed: failures.length === 0,
    failures
  }
}

/**
 * Stability evidence for the §21.4 endurance gates ("remain stable through 50
 * model switches", "remain stable through 20 import/close cycles").
 *
 * "Stable" is read as: every cycle ran, none of them errored, and the work did
 * not progressively slow down. The drift ratio compares the median of the last
 * fifth of the run against the median of the first fifth, so a run that leaks
 * state shows up as a rising number rather than as a single slow outlier.
 */
export interface EnduranceEvidence {
  readonly name: string
  readonly cycles: number
  readonly requiredCycles: number
  readonly failedCycles: number
  readonly totalMs: number
  readonly firstFifthMedianMs: number
  readonly lastFifthMedianMs: number
  readonly driftRatio: number
  readonly driftLimit: number
  readonly passed: boolean
  readonly failures: readonly string[]
}

export function evaluateEndurance(
  name: string,
  durationsMs: readonly number[],
  requiredCycles: number,
  driftLimit: number,
  failedCycles = 0
): EnduranceEvidence {
  if (!Number.isInteger(requiredCycles) || requiredCycles < 5) {
    throw new Error('Endurance gates need at least five required cycles.')
  }
  if (!Number.isFinite(driftLimit) || driftLimit <= 1) {
    throw new Error('The endurance drift limit must be greater than 1.')
  }
  const failures: string[] = []
  if (durationsMs.length !== requiredCycles) {
    failures.push(`${name} completed ${durationsMs.length} of ${requiredCycles} cycles`)
  }
  if (failedCycles > 0) failures.push(`${name}: ${failedCycles} cycle(s) reported an error`)

  const window = Math.max(1, Math.floor(durationsMs.length / 5))
  const head = durationsMs.slice(0, window)
  const tail = durationsMs.slice(durationsMs.length - window)
  const firstFifth = percentile(head, 0.5)
  const lastFifth = percentile(tail, 0.5)
  const drift = firstFifth > 0 ? lastFifth / firstFifth : 0
  if (durationsMs.length === requiredCycles && drift > driftLimit) {
    failures.push(
      `${name} slowed by ${drift.toFixed(2)}x across the run ` +
        `(${firstFifth.toFixed(3)} ms to ${lastFifth.toFixed(3)} ms), above the ${driftLimit}x limit`
    )
  }

  return {
    name,
    cycles: durationsMs.length,
    requiredCycles,
    failedCycles,
    totalMs: Number(durationsMs.reduce((sum, value) => sum + value, 0).toFixed(3)),
    firstFifthMedianMs: Number(firstFifth.toFixed(3)),
    lastFifthMedianMs: Number(lastFifth.toFixed(3)),
    driftRatio: Number(drift.toFixed(4)),
    driftLimit,
    passed: failures.length === 0,
    failures
  }
}
