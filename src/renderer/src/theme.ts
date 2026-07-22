// Wires the document's `data-theme` attribute (and the CSS custom
// properties keyed off it) to the OS theme, forwarded from main via
// nativeTheme. See scratchpad report C3.md for the exact main/index.ts +
// preload snippets this depends on (channel: THEME_CHANNELS in
// src/main/themeContract.ts).
//
// Falls back to the `prefers-color-scheme` media query if the preload API
// isn't wired yet, so this module is safe to call even before that lands.

export type ThemeMode = 'dark' | 'light'

interface ThemeApi {
  get: () => Promise<{ ok: boolean; data?: boolean; error?: string }>
  onChange: (callback: (isDark: boolean) => void) => () => void
}

const STYLE_ID = 'orbitpm-theme-vars'

function ensureThemeVarsInjected(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
:root[data-theme="light"] {
  --op-bg: #ffffff;
  --op-bg-elevated: #f5f6f8;
  --op-fg: #1a1d21;
  --op-fg-muted: #5b6270;
  --op-border: #dde1e6;
  --op-accent: #1e3a5f;
}
:root[data-theme="dark"] {
  --op-bg: #16191d;
  --op-bg-elevated: #1e2227;
  --op-fg: #e7e9ec;
  --op-fg-muted: #9aa1ac;
  --op-border: #2c3138;
  --op-accent: #5b8fc7;
}
`
  document.head.appendChild(style)
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', mode)
}

function getThemeApi(): ThemeApi | undefined {
  return (window as unknown as { orbitpm?: { theme?: ThemeApi } }).orbitpm?.theme
}

/**
 * Call once on renderer startup (e.g. from main.tsx). Returns an unsubscribe
 * function for symmetry/cleanup in tests; the app itself can ignore it.
 */
export function initTheme(): () => void {
  ensureThemeVarsInjected()

  const api = getThemeApi()
  if (!api) {
    // No preload API yet — fall back to following the OS media query
    // directly so the app still looks correct in dev/before wiring lands.
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => applyTheme(mql.matches ? 'dark' : 'light')
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }

  api
    .get()
    .then((result) => {
      if (result.ok) applyTheme(result.data ? 'dark' : 'light')
    })
    .catch(() => {
      // ignore — onChange below will still keep things in sync going forward
    })

  return api.onChange((isDark) => applyTheme(isDark ? 'dark' : 'light'))
}
