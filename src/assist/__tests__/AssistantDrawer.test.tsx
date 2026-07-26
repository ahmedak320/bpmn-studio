import { afterEach, describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantDrawer, type AssistantDrawerProps } from '../AssistantDrawer'
import { t } from '../../i18n'

const noop = (): void => {}
const base: AssistantDrawerProps = {
  open: false,
  onOpen: noop,
  onClose: noop,
  printing: false,
  mode: 'directory',
  keysVersion: 0,
  getDigests: () => Promise.resolve([]),
  onOpenProcess: noop
}

function render(props: Partial<AssistantDrawerProps>): string {
  return renderToStaticMarkup(<AssistantDrawer {...base} {...props} />)
}

describe('AssistantDrawer (static render)', () => {
  it('renders the floating button when closed', () => {
    const html = render({ open: false })
    expect(html).toContain('💬')
    expect(html).toContain(t('assist.open'))
  })

  it('renders the panel with title, placeholder, send and empty hint when open', () => {
    const html = render({ open: true })
    expect(html).toContain(t('assist.title'))
    expect(html).toContain(t('assist.placeholder'))
    expect(html).toContain(t('assist.send'))
    expect(html).toContain(t('assist.empty'))
  })

  it('falls back to local-mode footer when no provider key is configured', () => {
    // In the node test env there is no localStorage key, so no provider is picked.
    const html = render({ open: true })
    expect(html).toContain(t('assist.localMode'))
  })

  it('renders nothing while a print job is active', () => {
    expect(render({ open: true, printing: true })).toBe('')
    expect(render({ open: false, printing: true })).toBe('')
  })

  it('renders both tabs (library active by default) and no Finish button initially', () => {
    const html = render({ open: true })
    expect(html).toContain(t('assist.tab.library'))
    expect(html).toContain(t('assist.tab.interview'))
    expect(html).toContain('aria-selected="true"')
    expect(html).not.toContain(t('assist.interview.finish'))
  })

  it('accepts the interview prop surface without starting anything at render', () => {
    const html = render({
      open: true,
      getActiveInterviewTarget: () => null,
      interviewRequest: null,
      onApplyXml: () => {}
    })
    expect(html).toContain(t('assist.tab.interview'))
    // Library tab is active — the interview no-modeler hint is not shown.
    expect(html).toContain(t('assist.empty'))
  })
})

describe('AssistantDrawer footer (provider picked from stored keys)', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('shows the answering model + provider once a key is stored', () => {
    const store = new Map<string, string>([['orbitpm.lite.key.openrouter', 'sk-test']])
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    }
    const html = render({ open: true, keysVersion: 1 })
    expect(html).toContain(
      t('assist.model.line', { model: 'z-ai/glm-5.2', provider: 'OpenRouter' })
    )
    expect(html).not.toContain(t('assist.localMode'))
  })
})
