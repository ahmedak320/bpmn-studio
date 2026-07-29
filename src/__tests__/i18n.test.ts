import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en, ar } from '../i18n/dictionaries'
import { t, tPlural, getLang, setLang, getDir } from '../i18n'
import { ARIS_EXCEL_MESSAGE_KEYS } from '../aris/excel/issues'
import {
  ARIS_LAYOUT_REJECTION_CODES,
  arisLayoutRejectionMessageKey
} from '../aris/layout/rejection'
import {
  ARIS_CHAT_OWN_MESSAGE_KEYS,
  ARIS_CHAT_REUSED_EPC_MESSAGE_KEYS
} from '../aris/chat/messageKeys'
import { ARIS_RENDER_FIDELITY_KINDS } from '../aris/renderer/types'
import { METADATA_CATEGORY_LABEL_KEYS } from '../aris/details/metadata'
import { ARIS_DETAILS_TAB_LABEL_KEYS } from '../aris/details/tabs'
import {
  ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY,
  ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY
} from '../aris/writer/compatibility'

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
      const candidates =
        `${key}.one` in en || `${key}.other` in en ? [`${key}.one`, `${key}.other`] : [key]
      for (const c of candidates) {
        if (!(c in en)) missing.push(c)
      }
    }
    expect(missing).toEqual([])
  })

  it('every key used in source exists in the Arabic dictionary', () => {
    const missing: string[] = []
    for (const key of usedKeys) {
      const candidates =
        `${key}.one` in en || `${key}.other` in en ? [`${key}.one`, `${key}.other`] : [key]
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

describe('ARIS module key-inventory coverage', () => {
  // Regression guard for the whole class of bug this suite exists to catch: several
  // `src/aris/**` module lanes were built without write access to this dictionary, so they
  // emit i18n message keys as plain string literals (in `EpcFinding.messageKey`,
  // `ArisChatGap.messageKey`, `ArisExcelIssue.messageKey`, etc.) that never flow through a
  // `t('...')`/`tPlural('...')` call site inside `src/aris/**` itself — the UI layer that
  // eventually calls `t(finding.messageKey)` lives elsewhere. That means the
  // "every key used in source exists in the dictionary" checks above, which only scan for
  // `t()`/`tPlural()` call sites, cannot see these keys at all: a lane could add a new
  // finding kind with a brand-new key and this file would stay green while the UI silently
  // rendered the raw key to users.
  //
  // Each check below is driven by a module's own exported key-inventory constant (never a
  // hand-copied list here), so a future lane that adds a key without a matching dictionary
  // entry — or renames/removes one the dictionary still carries — fails this suite
  // immediately, regardless of whether anything in `src/aris/**` ever calls `t()` directly.
  //
  // Not every emitting module exports such a constant yet — `src/aris/epc` and
  // `src/aris/symbols` do not (see the epc note below and the report for `symbols`) — so
  // those are cross-checked in a follow-up describe block below.

  function expectKeysRegistered(keys: readonly string[]) {
    const missingEn = keys.filter((key) => !(key in en))
    const missingAr = keys.filter((key) => !(key in ar))
    expect(missingEn).toEqual([])
    expect(missingAr).toEqual([])
  }

  it('registers every key in ARIS_EXCEL_MESSAGE_KEYS (src/aris/excel/issues.ts)', () => {
    expect(ARIS_EXCEL_MESSAGE_KEYS.length).toBeGreaterThan(0)
    expectKeysRegistered(ARIS_EXCEL_MESSAGE_KEYS)
  })

  it('registers every key derived from ARIS_LAYOUT_REJECTION_CODES (src/aris/layout/rejection.ts)', () => {
    const keys = ARIS_LAYOUT_REJECTION_CODES.map((code) => arisLayoutRejectionMessageKey(code))
    expect(keys.length).toBeGreaterThan(0)
    expectKeysRegistered(keys)
  })

  it('registers every key in ARIS_CHAT_OWN_MESSAGE_KEYS (src/aris/chat/messageKeys.ts)', () => {
    expect(ARIS_CHAT_OWN_MESSAGE_KEYS.length).toBeGreaterThan(0)
    expectKeysRegistered(ARIS_CHAT_OWN_MESSAGE_KEYS)
  })

  it(
    'registers every key ARIS_CHAT_REUSED_EPC_MESSAGE_KEYS points at — this is also the ' +
      'authoritative epc.finding key list, since src/aris/epc itself exports no inventory constant',
    () => {
      expect(ARIS_CHAT_REUSED_EPC_MESSAGE_KEYS.length).toBeGreaterThan(0)
      expectKeysRegistered(ARIS_CHAT_REUSED_EPC_MESSAGE_KEYS)
    }
  )

  it('registers every key derived from ARIS_RENDER_FIDELITY_KINDS (src/aris/renderer/types.ts)', () => {
    // The renderer has no exported messageKey inventory, only the finding *kind* list — every
    // builder (fidelity.ts, font.ts, color.ts, textWrap.ts) derives its literal messageKey as
    // `aris.fidelity.<camelCase(kind)>` by convention. Deriving the same way here means this
    // test tracks the kind list even though it can't import the literal keys directly.
    const toCamel = (kind: string) => kind.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    const keys = ARIS_RENDER_FIDELITY_KINDS.map((kind) => `aris.fidelity.${toCamel(kind)}`)
    expect(keys.length).toBeGreaterThan(0)
    expectKeysRegistered(keys)
    // Cross-check the derivation itself against the two keys the symbol registry (a
    // different module) already owns, so a change to the naming convention can't slip past
    // both this test and the one above without either failing.
    expect(keys).toContain('aris.fidelity.unknownCustomSymbol')
    expect(keys).toContain('aris.fidelity.substitutedVisualResource')
  })

  it('registers every key in METADATA_CATEGORY_LABEL_KEYS (src/aris/details/metadata.ts)', () => {
    const keys = Object.values(METADATA_CATEGORY_LABEL_KEYS)
    expect(keys.length).toBeGreaterThan(0)
    expectKeysRegistered(keys)
  })

  it('registers every key in ARIS_DETAILS_TAB_LABEL_KEYS (src/aris/details/tabs.ts)', () => {
    const keys = Object.values(ARIS_DETAILS_TAB_LABEL_KEYS)
    expect(keys.length).toBeGreaterThan(0)
    expectKeysRegistered(keys)
  })

  it('registers the ARIS derived-export compatibility keys (src/aris/writer/compatibility.ts)', () => {
    expectKeysRegistered([ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY, ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY])
  })

  it('fixes the experimental export label to the plan §9.5 wording exactly', () => {
    expect(en[ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY as keyof typeof en]).toBe(
      'Experimental ARIS AML export'
    )
  })
})

describe('t() / tPlural() runtime behavior', () => {
  it('defaults to English and ltr', () => {
    expect(getLang()).toBe('en')
    expect(getDir()).toBe('ltr')
    expect(t('app.title')).toBe('OrbitPM ARIS Studio Lite')
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
      expect(t('app.newProcess')).toBe('＋ نموذج جديد')
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

describe('workspace operational diagnostics', () => {
  const diagnosticKeys = [
    'workspace.import.rollbackEvidence',
    'workspace.import.postCommitReconciliationFailed',
    'workspace.import.postCommitWarning',
    'workspace.import.postCommitTechnicalEvidence',
    'workspace.backup.rollbackEvidence',
    'workspace.backup.historyRetentionFailed',
    'workspace.backup.historyRetentionTechnicalEvidence',
    'workspace.backup.postCommitReconciliationFailed',
    'workspace.backup.postCommitTechnicalEvidence',
    'workspace.localization.workspaceImportRollbackUncertain',
    'workspace.localization.backupRollbackUncertain',
    'workspace.localization.backupCommittedReloadFailed',
    'workspace.sync.reviewedImportEditorChanged',
    'workspace.sync.reviewedImportLocalRetained',
    'workspace.sync.committedReloadEditorChanged',
    'workspace.sync.committedReloadLocalRetained',
    'workspace.sync.postCommitCleanupLocalRetained',
    'workspace.history.liveEditorUnverifiedAfterRestore',
    'workspace.history.newerRevisionBeforeCleanup',
    'workspace.history.liveEditorUnverifiedAfterCleanup',
    'workspace.history.newerRevisionDuringCleanup',
    'workspace.history.editorRefreshIncompleteAfterRestore',
    'workspace.history.restoreCancelled',
    'workspace.history.applyEditorChangedBefore',
    'workspace.history.applyEditorSynchronizationUnavailable',
    'workspace.history.applyTargetSessionChanged',
    'workspace.history.applyLiveEditorUnverified',
    'workspace.history.applyEditorChangedDuring',
    'workspace.storage.opfsOpenFailed',
    'workspace.storage.opfsOpenTechnicalEvidence',
    'session.save.preservationBlocked',
    'session.save.preservationTechnicalEvidence',
    'session.save.permissionLoss',
    'session.save.storageFailure',
    'session.save.storageTechnicalEvidence',
    'session.save.liveXmlCaptureDetail',
    'session.save.localCanvasRecoveryDetail',
    'session.save.retainedEditorCaptureFailed',
    'session.save.retainedEditorChangedDuringRecovery'
  ] as const

  it('keeps every operational diagnostic localized in English and Arabic', () => {
    for (const key of diagnosticKeys) {
      expect(en[key].trim()).not.toBe('')
      expect(ar[key].trim()).not.toBe('')
      expect(ar[key]).not.toBe(en[key])
    }
  })

  it('interpolates rollback evidence without leaking English labels in Arabic', () => {
    setLang('en')
    expect(
      t('workspace.import.rollbackEvidence', {
        error: 'disk error',
        review: 'digest-1',
        applied: t('workspace.diagnostic.none'),
        rollback: t('workspace.diagnostic.complete')
      })
    ).toBe('disk error; review: digest-1; applied: none; rollback: complete')

    setLang('ar')
    try {
      const localized = t('workspace.import.rollbackEvidence', {
        error: 'disk-error',
        review: 'digest-1',
        applied: t('workspace.diagnostic.none'),
        rollback: t('workspace.diagnostic.complete')
      })
      expect(localized).toBe('disk-error؛ المراجعة: digest-1؛ المطبّق: لا شيء؛ التراجع: مكتمل')
      expect(localized).not.toContain('review:')
      expect(localized).not.toContain('applied:')
      expect(localized).not.toContain('rollback:')
    } finally {
      setLang('en')
    }
  })
})

describe('history issue labels', () => {
  const issueKeys = [
    'workspace.history.issue.unreadable',
    'workspace.history.issue.invalidMetadata',
    'workspace.history.issue.missingContent',
    'workspace.history.issue.checksumMismatch',
    'workspace.history.issue.unknown'
  ] as const

  it('provides distinct Arabic copy for every history listing issue', () => {
    for (const key of issueKeys) {
      expect(ar[key]).toMatch(/[\u0600-\u06ff]/u)
      expect(ar[key]).not.toBe(en[key])
    }
  })

  it('interpolates the exact history path into localized Arabic issue copy', () => {
    setLang('ar')
    try {
      const localized = t('workspace.history.issue.unreadable', {
        path: '.orbitpm/history/revision.json'
      })
      expect(localized).toContain('.orbitpm/history/revision.json')
      expect(localized).toMatch(/[\u0600-\u06ff]/u)
      expect(localized).not.toContain('Could not read history metadata')
    } finally {
      setLang('en')
    }
  })
})

describe('direct action failure labels', () => {
  const actionKeys = [
    'sourceEditor.action.previewFailed',
    'sourceEditor.action.layoutFailed',
    'sourceEditor.action.applyFailed',
    'sourceEditor.action.technicalDetails',
    'workspace.history.action.previewFailed',
    'workspace.history.action.diffFailed',
    'workspace.history.action.restoreFailed',
    'workspace.history.action.restoreCopyFailed',
    'workspace.history.action.workspaceRefreshAfterRestoreFailed',
    'workspace.history.action.sessionRefreshAfterRestoreFailed',
    'workspace.history.action.technicalDetails'
  ] as const

  it('provides distinct Arabic summaries and evidence labels for every action context', () => {
    for (const key of actionKeys) {
      expect(ar[key]).toMatch(/[\u0600-\u06ff]/u)
      expect(ar[key]).not.toBe(en[key])
      expect(ar[key]).not.toContain('{error}')
    }
  })

  it('returns Arabic action summaries without interpolating native error text', () => {
    setLang('ar')
    try {
      expect(t('sourceEditor.action.previewFailed')).toBe('تعذّرت معاينة تغييرات المصدر.')
      expect(t('workspace.history.action.diffFailed')).toBe('تعذّرت مقارنة نسخة السجل هذه.')
      expect(t('workspace.history.action.technicalDetails')).toBe('التفاصيل التقنية:')
    } finally {
      setLang('en')
    }
  })
})

describe('translation failure and pagination labels', () => {
  it('keeps native failure text out of stable English and Arabic summaries', () => {
    for (const lang of ['en', 'ar'] as const) {
      setLang(lang)
      const translation = t('translate.failed', { error: 'native-provider-secret' })
      const memory = t('translationReview.memorySaveFailed', {
        error: 'native-storage-secret'
      })
      expect(translation).not.toContain('native-provider-secret')
      expect(memory).not.toContain('native-storage-secret')
      expect(translation).not.toContain('{error}')
      expect(memory).not.toContain('{error}')
    }
    setLang('en')
  })

  it('provides localized accessible paging labels and counts', () => {
    setLang('ar')
    try {
      expect(t('translationReview.fields.paginationLabel')).toMatch(/[\u0600-\u06ff]/u)
      expect(
        t('translationReview.pagination.status', {
          start: 25,
          end: 48,
          total: 2_500,
          page: 2,
          pages: 105
        })
      ).toBe('عرض 25–48 من 2500. الصفحة 2 من 105.')
    } finally {
      setLang('en')
    }
  })
})

describe('process hierarchy reference labels', () => {
  const hierarchyKeys = [
    'tree.reference.canonicalPath',
    'tree.shared',
    'tree.shared.title',
    'tree.cycle.title'
  ] as const

  it('keeps the hierarchy keys in English/Arabic parity', () => {
    for (const key of hierarchyKeys) {
      expect(Object.prototype.hasOwnProperty.call(en, key)).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(ar, key)).toBe(true)
      expect(typeof en[key]).toBe('string')
      expect(typeof ar[key]).toBe('string')
    }
  })

  it('interpolates canonical paths and distinct-parent counts in both languages', () => {
    setLang('en')
    expect(t('tree.reference.canonicalPath', { path: 'Operations/Review.bpmn' })).toBe(
      'Canonical file: Operations/Review.bpmn'
    )
    expect(t('tree.shared.title', { count: 2 })).toBe('Referenced by 2 parent processes')

    setLang('ar')
    try {
      expect(t('tree.reference.canonicalPath', { path: 'Operations/Review.bpmn' })).toBe(
        'الملف الأساسي: Operations/Review.bpmn'
      )
      expect(t('tree.shared.title', { count: 2 })).toBe('تتم الإشارة إليها من 2 عمليات أصلية')
    } finally {
      setLang('en')
    }
  })
})

describe('viewer interaction labels', () => {
  const keys = [
    'pane.details.toggle',
    'pane.details.toggle.title',
    'pane.details.aria',
    'legend.toggle',
    'legend.toggle.title',
    'legend.title',
    'legend.close.aria',
    'legend.event',
    'legend.step',
    'legend.subprocess',
    'legend.gateway',
    'legend.owner',
    'legend.input',
    'legend.output',
    'legend.cc',
    'legend.basis',
    'legend.subprocessChip',
    'semantic.event.tooltip',
    'semantic.step.tooltip',
    'semantic.subprocess.tooltip',
    'semantic.owner.tooltip',
    'semantic.input.tooltip',
    'semantic.output.tooltip',
    'semantic.cc.tooltip',
    'semantic.basis.tooltip',
    'semantic.subprocessChip.tooltip'
  ] as const

  it('keeps every pane, legend, and semantic-tooltip key in EN/AR parity', () => {
    for (const key of keys) {
      expect(Object.prototype.hasOwnProperty.call(en, key)).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(ar, key)).toBe(true)
      expect(en[key].trim()).not.toBe('')
      expect(ar[key].trim()).not.toBe('')
    }
  })

  it('serves localized pane and legend copy at runtime', () => {
    setLang('en')
    expect(t('pane.details.aria')).toBe('Step details and properties')
    expect(t('legend.title')).toBe('Shape legend')
    expect(t('semantic.output.tooltip')).toContain('produced')

    setLang('ar')
    try {
      expect(t('pane.details.aria')).toBe('تفاصيل الخطوة والخصائص')
      expect(t('legend.title')).toBe('دليل أشكال المخطط')
      expect(t('semantic.output.tooltip')).toContain('تنتجها')
    } finally {
      setLang('en')
    }
  })
})
