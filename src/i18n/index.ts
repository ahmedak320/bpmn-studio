// lite/src/i18n/index.ts
import { en, ar } from './dictionaries'

export type Lang = 'en' | 'ar'
export type Key = keyof typeof en

const DICTS: Record<Lang, Record<Key, string>> = { en, ar }
const STORAGE_KEY = 'orbitpm.lite.lang'
const DIR: Record<Lang, 'ltr' | 'rtl'> = { en: 'ltr', ar: 'rtl' }

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'ar' ? 'ar' : 'en'
  } catch {
    return 'en'
  }
}

let currentLang: Lang = readStoredLang()
const listeners = new Set<() => void>()

function applyDirAttribute(lang: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('dir', DIR[lang])
  document.documentElement.setAttribute('lang', lang)
  document.title = DICTS[lang]['app.title']
}

// Apply immediately on module load so the very first paint is correct
// (avoids an RTL flash-of-wrong-direction on reload).
applyDirAttribute(currentLang)

export function getLang(): Lang {
  return currentLang
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* localStorage may be unavailable; language just won't persist */
  }
  applyDirAttribute(lang)
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Interpolates {name} tokens in the looked-up string with `vars[name]`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const raw = DICTS[currentLang][key] ?? DICTS.en[key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`))
}

/** Picks the .one/.other plural variant and interpolates {count}. */
export function tPlural(base: string, count: number, vars?: Record<string, string | number>): string {
  const key = (count === 1 ? `${base}.one` : `${base}.other`) as Key
  return t(key, { count, ...vars })
}

export function getDir(): 'ltr' | 'rtl' {
  return DIR[currentLang]
}
