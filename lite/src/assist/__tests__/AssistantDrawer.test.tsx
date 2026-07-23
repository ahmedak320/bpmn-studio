import { describe, it, expect } from 'vitest'
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
})
