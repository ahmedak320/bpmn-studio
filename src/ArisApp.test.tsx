// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ArisApp from './ArisApp'

vi.mock('./ai/AiPanelLite', () => ({
  AiPanelLite: () => <div data-testid="mock-ai-panel">mock-ai-panel</div>
}))

vi.mock('./settings/SettingsDialogLite', () => ({
  SettingsDialogLite: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">mock-settings-dialog</div> : null
}))

vi.mock('./assist/AssistantDrawer', () => ({
  AssistantDrawer: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">mock-assistant-drawer</div> : null
}))

describe('ArisApp production shell', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
    document.title = ''
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {}
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('rejects BPMN files at the top-level ARIS shell boundary', async () => {
    render(<ArisApp />)

    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing ARIS shell file input')

    const xml =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
      '<bpmn:process id="Legacy_Process" />' +
      '</bpmn:definitions>'
    const file = new File([xml], 'legacy.bpmn', { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => new TextEncoder().encode(xml).buffer
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')).not.toBeNull()
    expect(screen.queryByText('ARIS placeholder canvas')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open file…' })).not.toBeNull()
  })

  it('opens AML source tabs in the ARIS placeholder shell and keeps AI/settings/assistant surfaces wired', async () => {
    render(<ArisApp />)

    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing ARIS shell file input')

    const xml = '<AML><Header-Info DatabaseName="DMT" /></AML>'
    const file = new File([xml], 'source.aml', { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => new TextEncoder().encode(xml).buffer
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('ARIS placeholder canvas')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'source.aml' })).not.toBeNull()
    expect(screen.getAllByText('ARIS AML').length).toBeGreaterThan(0)
    expect(screen.getByTestId('mock-ai-panel')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Settings/ }))
    expect(await screen.findByText('mock-settings-dialog')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    await waitFor(() => expect(screen.getByText('mock-assistant-drawer')).not.toBeNull())
  })
})
