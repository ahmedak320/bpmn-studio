import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsDialogLite } from '../SettingsDialogLite'
import { t } from '../../i18n'

const noop = (): void => {}

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  })
  return store
}

function render(open = true): string {
  return renderToStaticMarkup(
    <SettingsDialogLite open={open} onClose={noop} onKeysChanged={noop} onOrgStylingChanged={noop} />
  )
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** React escapes &, < and > inside text nodes (e.g. "coding &amp; step"). */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether the rendered checkbox carrying this aria-label has the `checked`
 *  attribute. React serialises `checked=""` (after style) only when true, and
 *  HTML-escapes the attribute value, so match the whole <input …> tag. */
function checkboxIsChecked(html: string, label: string): boolean {
  const re = new RegExp(`<input[^>]*aria-label="${escapeRegExp(escapeHtmlAttr(label))}"[^>]*>`)
  const match = re.exec(html)
  if (!match) throw new Error('checkbox not found for label: ' + label)
  return match[0].includes('checked')
}

describe('SettingsDialogLite (static render)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders nothing when closed', () => {
    installMemoryStorage()
    expect(render(false)).toBe('')
  })

  it('renders the completeness toggle right after the org-styling toggle, with its hint', () => {
    installMemoryStorage()
    const html = render()
    expect(html).toContain(escapeHtmlText(t('settings.orgStyling.label')))
    expect(html).toContain(escapeHtmlText(t('settings.completeness.label')))
    expect(html).toContain(escapeHtmlText(t('settings.completeness.hint')))
    // ordering: styling toggle first, completeness right after, both before the
    // provider key sections (the storage warning follows the diagram section)
    const styling = html.indexOf(escapeHtmlText(t('settings.orgStyling.label')))
    const completeness = html.indexOf(escapeHtmlText(t('settings.completeness.label')))
    const warning = html.indexOf(escapeHtmlText(t('settings.keyStorageWarning')))
    expect(styling).toBeGreaterThanOrEqual(0)
    expect(completeness).toBeGreaterThan(styling)
    expect(warning).toBeGreaterThan(completeness)
  })

  it('both diagram checkboxes are checked by default (flags unset -> ON)', () => {
    installMemoryStorage()
    const html = render()
    expect(checkboxIsChecked(html, t('settings.orgStyling.label'))).toBe(true)
    expect(checkboxIsChecked(html, t('settings.completeness.label'))).toBe(true)
  })

  it('reflects a persisted completeness=off without touching the styling toggle', () => {
    const store = installMemoryStorage()
    store.set('orbitpm.lite.completenessOn', 'false')
    const html = render()
    expect(checkboxIsChecked(html, t('settings.completeness.label'))).toBe(false)
    expect(checkboxIsChecked(html, t('settings.orgStyling.label'))).toBe(true)
  })

  it('reflects a persisted styling=off without touching the completeness toggle', () => {
    const store = installMemoryStorage()
    store.set('orbitpm.lite.orgStyling', 'false')
    const html = render()
    expect(checkboxIsChecked(html, t('settings.orgStyling.label'))).toBe(false)
    expect(checkboxIsChecked(html, t('settings.completeness.label'))).toBe(true)
  })
})
