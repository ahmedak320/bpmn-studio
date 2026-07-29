// Pure, side-effect-free rule definitions and helpers for scripts/check-no-skips.mjs.
//
// This module does no filesystem or process I/O — it only defines the regexes that flag
// skipped/focused/conditional test execution. It is split out from check-no-skips.mjs (which
// runs its scan as an unconditional module-load side effect, including a possible
// `process.exit(1)`) so the rules can be imported and unit-tested in isolation without
// triggering a full repository scan.

export const prohibited = [
  {
    label: 'skipped suite/test',
    pattern:
      /\b(?:test|it|describe|suite|specify)(?:\s*\.\s*[A-Za-z]+)*\s*\.\s*(?:skip|skipIf|todo|fixme|fail|fails)(?:\s*\.\s*[A-Za-z]+)*\s*(?:\(|<)/
  },
  {
    label: 'focused-only suite/test',
    pattern:
      /\b(?:test|it|describe|suite|specify)(?:\s*\.\s*[A-Za-z]+)*\s*\.\s*only(?:\s*\.\s*[A-Za-z]+)*\s*(?:\(|<)/
  },
  {
    label: 'conditional test execution',
    pattern:
      /\b(?:test|it|describe|suite|specify)(?:\s*\.\s*[A-Za-z]+)*\s*\.\s*runIf(?:\s*\.\s*[A-Za-z]+)*\s*(?:\(|<)/
  },
  {
    label: 'disabled or focused alias',
    // Genuine Jasmine-style focus/skip aliases are bare, statement-position calls whose first
    // argument is the test/suite title string, e.g. `fit('does the thing', () => {})`. Requiring
    // (a) the identifier is not preceded by `.`/a word character — so `canvas.fit(` (a member
    // expression calling an unrelated `fit()` method) never matches — and (b) the first
    // argument starts with a quote — so a bare method definition like `fit(): number {` (no
    // arguments at all) never matches — keeps this catching real `fit`/`xit`/`fdescribe`/
    // `xdescribe` aliases without flagging unrelated `fit()` canvas/zoom APIs.
    pattern: /(?<![.\w$])(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(\s*(?=['"`])/
  },
  {
    label: 'runtime test skip/fixme annotation',
    pattern: /\btestInfo\s*\.\s*(?:skip|fixme|fail)\s*\(/
  },
  {
    label: 'retry override',
    pattern: /\b(?:retries|retry)\s*:\s*[1-9]\d*\b|--retries(?:=|\s+)[1-9]\d*/
  }
]

export const nodeTestProhibited = [
  {
    label: 'node:test skipped/todo/focused method',
    pattern: /\.\s*(?:skip|todo|only)\s*(?:\(|<)/
  },
  {
    label: 'node:test skipped/todo/focused option',
    pattern: /\b(?:skip|todo|only)\s*:/
  }
]

export function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length
}

export function matches(source, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return source.matchAll(new RegExp(pattern.source, flags))
}

// How far (in characters, either direction) an `existsSync(` call may sit from a `reference/...`
// string literal and still count as "guarding" that fixture path. Observed distances across the
// four converted evasion suites (before conversion) ranged 62-360 characters — a variable-held
// path constant, a describe-level guard several lines below the literal, etc. — so this window is
// set well above that ceiling.
const FIXTURE_GUARD_PROXIMITY = 800

// A `reference/<something>` path fragment, as it appears inside a string/template literal (e.g.
// `'../../reference/AnimalWF/ARISAMLExport.xml'`). Intentionally broader than the one fixture
// this repo currently has (`reference/AnimalWF`) so a future private fixture under `reference/`
// is covered without editing this file again.
const REFERENCE_FIXTURE_LITERAL = /reference\/[\w./-]+/
const EXISTS_SYNC_CALL = /\bexistsSync\s*\(/g

/**
 * Finds every `existsSync(...)` call in `source` that sits within `FIXTURE_GUARD_PROXIMITY`
 * characters of a `reference/...` fixture-path string literal, for any `path` that is not itself
 * named `*.animalwf.test.ts`.
 *
 * This exists because a private-fixture presence check is, by construction, the signature of a
 * suite that must never silently skip or no-op when the fixture is absent — the repo's convention
 * for that is the `*.animalwf.test.ts` naming (excluded from the default project, run only via
 * `npm run test:aris:animalwf`, throwing at module load if the fixture is missing). The four
 * `prohibited` rules above only catch specific *syntactic* conditional-execution shapes
 * (`.skip(`, `.runIf(`, etc.); they cannot catch a fixture guard that hides behind a renamed
 * variable holding `it.skip`, a hand-rolled no-op stub function, a describe-level early `return`,
 * or a tautological assertion about the fixture's own absence — every one of those evades the
 * *shape*-based rules while still gating real test bodies on `existsSync`. Keying on the
 * fixture-path check itself, rather than on how the guard is wired into test execution, catches
 * all of them regardless of shape.
 */
export function fixtureGuardViolations(path, source) {
  if (/\.animalwf\.test\.ts$/.test(path)) return []
  const hits = []
  for (const match of source.matchAll(EXISTS_SYNC_CALL)) {
    const windowStart = Math.max(0, match.index - FIXTURE_GUARD_PROXIMITY)
    const windowEnd = Math.min(source.length, match.index + FIXTURE_GUARD_PROXIMITY)
    if (REFERENCE_FIXTURE_LITERAL.test(source.slice(windowStart, windowEnd))) {
      hits.push(match.index)
    }
  }
  return hits
}
