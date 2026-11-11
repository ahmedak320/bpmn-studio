// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArisExportDialog, type ArisExportModelOption } from './ArisExportDialog'

const models: ArisExportModelOption[] = [
  { id: 'M.A', name: 'Intake', renderable: true },
  { id: 'M.B', name: 'Review', renderable: true },
  { id: 'M.C', name: 'Empty', renderable: false }
]

function mount(overrides: Partial<Parameters<typeof ArisExportDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    models,
    currentModelId: 'M.A',
    amlLabel: 'Experimental ARIS AML export',
    onExportPdf: vi.fn(),
    onExportAml: vi.fn(),
    ...overrides
  }
  render(<ArisExportDialog {...props} />)
  return props
}

describe('ArisExportDialog', () => {
  afterEach(() => cleanup())

  it('exports only the open process by default', () => {
    const props = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 PDF(s)' }))
    expect(props.onExportPdf).toHaveBeenCalledWith(['M.A'])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('exports the selected processes only, skipping ones with no diagram', () => {
    const props = mount()
    fireEvent.click(screen.getByRole('radio', { name: 'Selected processes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 PDF(s)' }))
    expect(props.onExportPdf).toHaveBeenCalledWith(['M.B'])
  })

  it('exports every renderable process for the whole library', () => {
    const props = mount()
    fireEvent.click(screen.getByRole('radio', { name: /Whole library/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Export 2 PDF(s)' }))
    expect(props.onExportPdf).toHaveBeenCalledWith(['M.A', 'M.B'])
  })

  it('runs the derived AML export for the whole open file and hides the scope choice', () => {
    const props = mount()
    fireEvent.click(screen.getByRole('radio', { name: /Experimental ARIS AML export/ }))
    expect(screen.queryByRole('radio', { name: 'Selected processes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export AML' }))
    expect(props.onExportAml).toHaveBeenCalledTimes(1)
    expect(props.onExportPdf).not.toHaveBeenCalled()
  })

  it('disables the export when no process is selected', () => {
    mount()
    fireEvent.click(screen.getByRole('radio', { name: 'Selected processes' }))
    expect(screen.getByRole('button', { name: 'Export 0 PDF(s)' }).hasAttribute('disabled')).toBe(true)
  })
})
