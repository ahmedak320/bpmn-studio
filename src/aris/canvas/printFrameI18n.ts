/**
 * UI copy for the print frame (header band, bottom legend, RACI key).
 *
 * This mirrors the shell's `tk()` contract (`src/aris/shell/shellI18n.ts`) for
 * the canvas layer: the real dictionary is asked first and, only when it has
 * no entry (which `t()` signals by echoing the key), the English source string
 * declared here wins. The canvas cannot import the shell's `tk()` — the shell
 * sits above it — so the fallback lives beside its only consumer. Every key is
 * listed in `ARIS_PRINT_FRAME_MESSAGE_KEYS` so registering it in
 * `src/i18n/dictionaries.ts` is a mechanical copy; the moment a key is
 * registered the fallback becomes unreachable in both languages.
 */

import { t, type Key } from '../../i18n'

/** Every print-frame message key, with its English source text. */
export const ARIS_PRINT_FRAME_MESSAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'aris.printFrame.processCode': 'Process Code',
  'aris.printFrame.processName': 'Process Name',
  'aris.printFrame.organizationalOwner': 'Organizational Owner',
  'aris.printFrame.headerAria': 'Print header for {model}',
  'aris.printFrame.orgBlock':
    'Organization title block — the imported OLE image is not decoded yet',
  'aris.printFrame.legendAria': 'DMT symbol legend and RACI key',
  'aris.printFrame.raci.responsible': 'Responsible',
  'aris.printFrame.raci.approval': 'Approval',
  'aris.printFrame.raci.consulted': 'Consulted',
  'aris.printFrame.raci.informed': 'Informed'
})

export type ArisPrintFrameMessageKey = keyof typeof ARIS_PRINT_FRAME_MESSAGE_KEYS

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/gu, (_match, name: string) =>
    String(vars[name] ?? `{${name}}`)
  )
}

/**
 * Look up `key`; fall back to the English source text while the key is
 * unregistered. Same observable behaviour as the shell's `tk()`.
 */
export function arisPrintFrameText(
  key: ArisPrintFrameMessageKey,
  vars?: Record<string, string | number>
): string {
  const resolved = t(key as Key, vars)
  // `t()` returns the key itself when neither dictionary has an entry.
  if (resolved !== key) return resolved
  return interpolate(ARIS_PRINT_FRAME_MESSAGE_KEYS[key], vars)
}
