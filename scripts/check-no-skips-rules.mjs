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
