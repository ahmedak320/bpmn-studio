/**
 * ARIS compatibility status for derived exports (plan section 9.5).
 *
 * Plan section 1.3 rule 14 forbids declaring stable ARIS compatibility until a real ARIS
 * import/re-export has passed. Until then every derived AML download carries an experimental
 * label.
 *
 * The label is exposed as an i18n message KEY, never as a display string: the product ships
 * English and Arabic (`src/i18n/dictionaries.ts`), and a hardcoded English label would be
 * untranslatable and would render wrongly in the RTL shell.
 */

export type ArisExportCompatibilityStatus = 'experimental' | 'verified'

/**
 * Current status. Flipping this to `'verified'` is gated on a USER-RUN test that this codebase
 * cannot perform for itself:
 *
 * 1. Export a derived AML from a real imported source.
 * 2. Import that file into a live ARIS installation.
 * 3. Re-export it from ARIS and confirm ARIS accepted every record without repair.
 *
 * No automated test in this repository may flip it — there is no ARIS server to ask.
 */
export const ARIS_EXPORT_COMPATIBILITY_STATUS: ArisExportCompatibilityStatus = 'experimental'

/**
 * i18n key for the label shown next to any derived-export affordance.
 *
 * The dictionary entry (`src/i18n/dictionaries.ts`) must read "Experimental ARIS AML export" in
 * English, per plan section 9.5. `t()` already falls back to returning the key itself when an
 * entry is missing, so the writer never needs an English literal of its own.
 */
export const ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY = 'aris.export.experimentalLabel'

/** i18n key for the longer explanation of what "experimental" means for this export. */
export const ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY = 'aris.export.experimentalNotice'

export interface ArisExportCompatibility {
  readonly status: ArisExportCompatibilityStatus
  /** True while the export must be labelled experimental. */
  readonly experimental: boolean
  /** i18n key for the short label. `null` once the status is verified. */
  readonly labelKey: string | null
  /** i18n key for the explanatory notice. `null` once the status is verified. */
  readonly noticeKey: string | null
}

/** Describe the compatibility status a derived export must be presented with. */
export function describeArisExportCompatibility(
  status: ArisExportCompatibilityStatus = ARIS_EXPORT_COMPATIBILITY_STATUS
): ArisExportCompatibility {
  const experimental = status === 'experimental'
  return Object.freeze({
    status,
    experimental,
    labelKey: experimental ? ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY : null,
    noticeKey: experimental ? ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY : null
  })
}

/** A translator with the same shape as `t()` from `src/i18n`. */
export type ArisExportTranslate = (key: string) => string

/**
 * Resolve the label through the caller's translator.
 *
 * There is deliberately no default translator and no English fallback string: a caller that has
 * no i18n context gets the key back, which is visible in review, rather than an untranslated
 * English string that silently ships to Arabic users.
 */
export function resolveArisExportLabel(
  translate: ArisExportTranslate,
  compatibility: ArisExportCompatibility = describeArisExportCompatibility()
): string | null {
  return compatibility.labelKey === null ? null : translate(compatibility.labelKey)
}
