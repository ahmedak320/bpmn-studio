/**
 * Turn off zod's JIT schema compiler, because this artifact ships a CSP that
 * forbids it (plan §2.5).
 *
 * zod 4 compiles a specialised parser for object schemas with `new Function(…)`.
 * Before it does, it probes the host once with `new Function('')` and caches the
 * answer, falling back to its interpreter when the probe throws. Under this
 * app's `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` the probe always
 * throws, so the JIT is never usable here — but the probe still *runs*, and every
 * engine reports it as a real CSP violation. Firefox surfaces that report as a
 * console error on every load:
 *
 *   Content-Security-Policy: The page's settings blocked a JavaScript eval
 *   (script-src) from being executed because it violates the following
 *   directive: "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
 *   (Missing 'unsafe-eval')
 *
 * That message says "eval", not "WebAssembly": Firefox has a separate,
 * differently worded report for WASM ("blocked WebAssembly … Missing
 * 'wasm-unsafe-eval' or 'unsafe-eval'"), and it has honoured `'wasm-unsafe-eval'`
 * since Firefox 102. The artifact's WASM — the inlined xmllint worker behind XSD
 * validation — is therefore *not* what the message is about and is not blocked.
 *
 * `jitless` short-circuits the probe before the `new Function` call, so the
 * violation disappears without widening the CSP by a single source expression and
 * without changing one byte of parsing behaviour: the interpreter this selects is
 * exactly the one the failed probe already selected.
 *
 * This module must be imported for its side effect BEFORE anything that parses a
 * zod schema — `src/main.tsx` imports it first, and `zodJitless.test.ts` pins that
 * ordering.
 */

import { config } from 'zod'

/** Apply the jitless configuration. Idempotent; safe to call more than once. */
export function configureZodForStrictCsp(): void {
  config({ jitless: true })
}

configureZodForStrictCsp()
