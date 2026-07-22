import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en, ar } from '../i18n/dictionaries'
import { t, tPlural, getLang, setLang, getDir } from '../i18n'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(HERE, '..')

/** Recursively collect every .ts/.tsx source file under lite/src, excluding
 *  the i18n module itself (the dictionaries are the source of truth, not a
 *  consumer) and test files. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'i18n') continue
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('i18n dictionary completeness', () => {
  let usedKeys: Set<string>

  beforeAll(() => {
    const files = collectSourceFiles(SRC_ROOT)
    usedKeys = new Set<string>()
    // Matches t('key...') / t("key...") / tPlural('key...') call sites —
    // deliberately simple (no template literals) since every call site in
    // this codebase uses a static string-literal key by convention.
    const callRe = /\b(?:t|tPlural)\(\s*['"]([a-zA-Z0-9_.]+)['"]/g
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      let m: RegExpExecArray | null
      while ((m = callRe.exec(text))) {
        usedKeys.add(m[1])
      }
    }
  })

  it('finds a non-trivial number of t()/tPlural() call sites (sanity check on the regex + file walk)', () => {
    expect(usedKeys.size).toBeGreaterThan(50)
  })

  it('every key used in source exists in the English dictionary', () => {
    const missing: string[] = []
    for (const key of usedKeys) {
      // tPlural('base', n) looks up '<base>.one' / '<base>.other' at runtime,
      // not '<base>' itself — resolve to the concrete plural-branch keys.
      const candidates = `${key}.one` in en || `${key}.other` in en ? [`${key}.one`, `${key}.other`] : [key]
      for (const c of candidates) {
        if (!(c in en)) missing.push(c)
      }
    }
    expect(missing).toEqual([])
  })

  it('every key used in source exists in the Arabic dictionary', () => {
    const missing: string[] = []
    for (const key of usedKeys) {
      const candidates = `${key}.one` in en || `${key}.other` in en ? [`${key}.one`, `${key}.other`] : [key]
      for (const c of candidates) {
        if (!(c in ar)) missing.push(c)
      }
    }
    expect(missing).toEqual([])
  })

  it('the English and Arabic dictionaries have exactly the same key set', () => {
    const enKeys = Object.keys(en).sort()
    const arKeys = Object.keys(ar).sort()
    expect(arKeys).toEqual(enKeys)
  })

  it('every {placeholder} token used in an Arabic value also exists in the matching English value', () => {
    // The reverse isn't required: a ".one" singular form is often phrased
    // without the count in natural Arabic (e.g. "رابط واحد غير محلول" — "one
    // unresolved link" needs no {count}), matching how the EN ".one" branches
    // already drop the count for the same reason in some keys. Extra vars are
    // harmless — t()'s interpolation only replaces tokens actually present in
    // the string. But an Arabic string referencing a token EN doesn't have
    // would silently render `{typo}` literally — that's the real bug class
    // this guards against.
    const mismatches: string[] = []
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const enTokens = new Set([...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
      const arTokens = [...ar[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      for (const token of arTokens) {
        if (!enTokens.has(token)) mismatches.push(`${key}: ar references {${token}} not in en`)
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('t() / tPlural() runtime behavior', () => {
  it('defaults to English and ltr', () => {
    expect(getLang()).toBe('en')
    expect(getDir()).toBe('ltr')
    expect(t('app.title')).toBe('OrbitPM Process Studio Lite')
  })

  it('interpolates {placeholder} tokens', () => {
    expect(t('footer.folderPrefix', { folderName: 'Docs' })).toBe('📁 Docs')
  })

  it('falls back to the raw key when a var is missing (leaves the token visible, never throws)', () => {
    expect(t('footer.folderPrefix')).toContain('{folderName}')
  })

  it('tPlural picks .one for count===1 and .other otherwise', () => {
    expect(tPlural('footer.unresolvedLinks', 1)).toBe('1 unresolved link')
    expect(tPlural('footer.unresolvedLinks', 3)).toBe('3 unresolved links')
    expect(tPlural('footer.unresolvedLinks', 0)).toBe('0 unresolved links')
  })

  // This suite runs under vitest's plain-node environment (no DOM), matching
  // the rest of lite's unit tests — `t()`/`setLang()`/`getDir()` are pure
  // value lookups that do not require `document`; the module guards its
  // `document.documentElement`/`localStorage` side effects with
  // `typeof document === 'undefined'` / try-catch specifically so it degrades
  // gracefully here. The `dir`-attribute + localStorage-persistence wiring
  // itself is covered by the e2e suite (real browser), not this unit test.
  it('switches language to Arabic: getLang/getDir/t all reflect it', () => {
    setLang('ar')
    try {
      expect(getLang()).toBe('ar')
      expect(getDir()).toBe('rtl')
      expect(t('app.newProcess')).toBe('＋ عملية جديدة')
    } finally {
      setLang('en')
    }
  })

  it('setLang back to en restores ltr', () => {
    setLang('ar')
    setLang('en')
    expect(getLang()).toBe('en')
    expect(getDir()).toBe('ltr')
  })

  it('setLang to the already-active language is a no-op (no throw)', () => {
    expect(() => setLang('en')).not.toThrow()
    expect(getLang()).toBe('en')
  })
})
