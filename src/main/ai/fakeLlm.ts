// E2E-only fake LLM path.
//
// Everything in this module is gated behind the ORBITPM_E2E_FAKE_LLM env var
// (checked via `isFakeLlmEnabled`) and is imported by ai.ts solely so the
// Playwright suite can drive the full AI-generate flow (panel -> pipeline ->
// file -> tab) without any network access or provider API keys. It has NO
// production effect: when the env var is unset, `isFakeLlmEnabled()` returns
// false and none of this code influences the real generate / providers path.
//
// The fake returns a deterministic B3 IR object selected by a `[fixture:NAME]`
// marker in the process description, defaulting to a simple linear process.
// generateFromDescription (src/gen) accepts an already-parsed object, so the
// fake CallLLM returns the IR object directly (no model, no JSON round-trip).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CallLLM } from '../../gen'
import type { AvailableProvider } from '../providers'

/** True only when the Playwright suite has explicitly opted into the fake path. */
export function isFakeLlmEnabled(): boolean {
  const flag = process.env.ORBITPM_E2E_FAKE_LLM
  return flag === '1' || flag === 'true'
}

// Minimal valid linear IR (start -> task -> end). Used when the description
// carries no recognized [fixture:NAME] marker, or the named fixture can't be
// read. Kept intentionally trivial so it always passes validateBpmn.
const DEFAULT_LINEAR_IR = {
  process: [
    { type: 'startEvent', id: 'start' },
    { type: 'task', id: 'task1', label: 'Do the work' },
    { type: 'endEvent', id: 'end1' }
  ]
}

// Marker keyword -> B3 fixture basename under tests/fixtures/ir. An empty
// string is the sentinel for "use the built-in linear default".
const FIXTURE_ALIASES: Record<string, string> = {
  linear: '',
  exclusive: 'ex1_professor',
  parallel: 'ex2_parallel',
  nested: 'ex4_nested_exclusive',
  loop: 'ex3_exam_loop',
  events: 'ex6_events'
}

function fixtureMarker(description: string): string | null {
  const m = /\[fixture:([a-z0-9_-]+)\]/i.exec(description)
  return m ? m[1].toLowerCase() : null
}

function loadFixtureIr(marker: string): unknown {
  const alias = FIXTURE_ALIASES[marker]
  // Unknown marker or explicit 'linear' -> the built-in linear default.
  if (!alias) return DEFAULT_LINEAR_IR
  const dir = process.env.ORBITPM_E2E_FIXTURES_DIR
  if (!dir) return DEFAULT_LINEAR_IR
  try {
    return JSON.parse(readFileSync(join(dir, `${alias}.json`), 'utf8'))
  } catch {
    return DEFAULT_LINEAR_IR
  }
}

/**
 * Build a deterministic CallLLM (the B3 generate.ts shape) that ignores the
 * conversation and returns a fixture IR object chosen by the description's
 * `[fixture:NAME]` marker (defaulting to a simple linear process).
 */
export function makeFakeCallLLM(description: string): CallLLM {
  const marker = fixtureMarker(description)
  const ir = marker ? loadFixtureIr(marker) : DEFAULT_LINEAR_IR
  return async () => ir
}

/**
 * Availability list used in place of the real registry when the fake path is
 * on, so the AI panel enables itself without any configured provider keys.
 * Reports a single real ProviderId as configured (the fake CallLLM ignores
 * which provider/model is chosen); using a real id keeps the renderer's
 * getProvider/defaultModelId lookups valid.
 */
export function fakeAvailableProviders(): AvailableProvider[] {
  return [{ id: 'openai', configured: true }]
}
