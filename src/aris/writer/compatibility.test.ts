import { describe, expect, it } from 'vitest'
import {
  ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY,
  ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY,
  ARIS_EXPORT_COMPATIBILITY_STATUS,
  describeArisExportCompatibility,
  resolveArisExportLabel
} from './compatibility'
import { prepareDerivedAml } from './exportDerivedAml'
import { SAMPLE_AML } from './testFixture'

describe('ARIS compatibility status (plan section 9.5)', () => {
  it('is experimental until a live ARIS import/re-export has been run by a user', () => {
    expect(ARIS_EXPORT_COMPATIBILITY_STATUS).toBe('experimental')
    expect(describeArisExportCompatibility()).toEqual({
      status: 'experimental',
      experimental: true,
      labelKey: ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY,
      noticeKey: ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY
    })
  })

  it('exposes i18n keys rather than display strings', () => {
    expect(ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY).toBe('aris.export.experimentalLabel')
    expect(ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY).toBe('aris.export.experimentalNotice')
    const values = [ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY, ARIS_EXPERIMENTAL_EXPORT_NOTICE_KEY]
    // No English prose may leak out of this module: a key is dot-separated and space-free.
    values.forEach((key) => {
      expect(key).not.toMatch(/\s/)
      expect(key).toMatch(/^aris\.export\.[A-Za-z]+$/)
    })
  })

  it('resolves the label through the caller-supplied translator, in either language', () => {
    const english: Record<string, string> = {
      [ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY]: 'Experimental ARIS AML export'
    }
    const arabic: Record<string, string> = {
      [ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY]: 'تصدير ARIS AML تجريبي'
    }
    expect(resolveArisExportLabel((key) => english[key] ?? key)).toBe(
      'Experimental ARIS AML export'
    )
    expect(resolveArisExportLabel((key) => arabic[key] ?? key)).toBe('تصدير ARIS AML تجريبي')
  })

  it('returns the key itself when a dictionary entry is missing, rather than English prose', () => {
    expect(resolveArisExportLabel((key) => key)).toBe(ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY)
  })

  it('drops the label only once the status is verified', () => {
    const verified = describeArisExportCompatibility('verified')
    expect(verified.experimental).toBe(false)
    expect(verified.labelKey).toBeNull()
    expect(resolveArisExportLabel((key) => key, verified)).toBeNull()
  })

  it('labels every derived export', () => {
    const exported = prepareDerivedAml({ originalText: SAMPLE_AML, edits: [] })
    expect(exported.compatibility.experimental).toBe(true)
    expect(exported.compatibility.labelKey).toBe(ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY)
  })
})
