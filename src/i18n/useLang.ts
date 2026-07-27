// lite/src/i18n/useLang.ts — React hook, no Context needed
import { useSyncExternalStore } from 'react'
import { getLang, subscribe, setLang, type Lang } from './index'

/** Re-renders the calling component whenever the language changes.
 *  Usage: const lang = useLang(); ... t('app.title') stays in sync because
 *  setLang() notifies all subscribers and React re-renders. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang)
}

export { setLang }
