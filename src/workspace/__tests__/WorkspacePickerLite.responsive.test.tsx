// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../i18n', () => ({
  t: (key: string): string => key
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' => 'en',
  setLang: vi.fn()
}))

import { WorkspacePickerLite } from '../WorkspacePickerLite'

afterEach(cleanup)

describe('WorkspacePickerLite responsive landmark', () => {
  it('uses a named main surface with dynamic-viewport sizing and a safe fallback', () => {
    render(
      <WorkspacePickerLite
        mode="fallback"
        onOpenFolder={vi.fn()}
        onOpenFile={vi.fn()}
        onNewDiagram={vi.fn()}
        onNewProcess={vi.fn()}
      />
    )

    const main = screen.getByRole('main', { name: 'picker.title' })
    expect(main.style.minHeight).toBe('100vh')
    expect(main.style.height).toBe('100dvh')
    expect(main.style.maxWidth).toBe('100%')
    expect(main.style.overflow).toBe('auto')
  })
})
