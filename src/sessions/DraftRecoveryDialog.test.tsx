// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang, t } from '../i18n'
import type { DraftRecoveryComparison } from './draftJournal'
import { DraftRecoveryDialog } from './DraftRecoveryDialog'

const timestamp = Date.UTC(2025, 0, 15, 9, 30)

function comparison(
  relation: DraftRecoveryComparison['relation'] = 'same-base'
): DraftRecoveryComparison {
  return {
    draft: {
      id: 'draft-1',
      workspaceId: 'workspace-1',
      path: 'processes/order.bpmn',
      sessionId: 'session-1',
      xml: '<definitions id="recovery-draft" />',
      baseHash: 'base-hash',
      timestamp,
      appVersion: '0.4.5'
    },
    loadedXml: '<definitions id="saved-version" />',
    loadedBaseHash: 'base-hash',
    relation,
    requiresReview: true
  }
}

function renderDialog(overrides: Partial<ComponentProps<typeof DraftRecoveryDialog>> = {}): {
  onDecision: ReturnType<typeof vi.fn>
  onDownload: ReturnType<typeof vi.fn>
  view: ReturnType<typeof render>
} {
  const onDecision = vi.fn()
  const onDownload = vi.fn()
  const view = render(
    <DraftRecoveryDialog
      lang="en"
      title="Order fulfilment"
      comparison={comparison()}
      onDecision={onDecision}
      onDownload={onDownload}
      {...overrides}
    />
  )
  return { onDecision, onDownload, view }
}

beforeEach(() => {
  setLang('en')
})

afterEach(() => {
  cleanup()
  setLang('en')
  vi.restoreAllMocks()
})

describe('DraftRecoveryDialog', () => {
  it('renders an accessible English comparison with exact saved and draft XML', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: t('draftRecovery.title') })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-describedby')).toBe('draft-recovery-summary')
    expect(dialog.getAttribute('dir')).toBe('ltr')

    const summary = within(dialog).getByText((_, element) => {
      return element?.id === 'draft-recovery-summary'
    })
    const formattedTimestamp = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp))
    expect(summary.textContent).toContain('Order fulfilment')
    expect(summary.textContent).toContain(formattedTimestamp)
    expect(summary.textContent).toContain(t('draftRecovery.relation.same-base'))

    const savedSection = within(dialog)
      .getByRole('heading', { name: t('draftRecovery.saved') })
      .closest('section')
    const draftSection = within(dialog)
      .getByRole('heading', { name: t('draftRecovery.draft') })
      .closest('section')
    expect(savedSection).not.toBeNull()
    expect(draftSection).not.toBeNull()
    expect(savedSection?.querySelector('pre')?.textContent).toBe(
      '<definitions id="saved-version" />'
    )
    expect(draftSection?.querySelector('pre')?.textContent).toBe(
      '<definitions id="recovery-draft" />'
    )
    expect(savedSection?.querySelector('pre')?.getAttribute('dir')).toBe('ltr')
    expect(draftSection?.querySelector('pre')?.getAttribute('dir')).toBe('ltr')
  })

  it.each(['same-content', 'same-base', 'base-diverged', 'unknown-base'] as const)(
    'describes the %s recovery relation',
    (relation) => {
      renderDialog({ comparison: comparison(relation) })

      expect(document.querySelector('#draft-recovery-summary')?.textContent).toContain(
        t(`draftRecovery.relation.${relation}`)
      )
    }
  )

  it('dispatches download, discard, and restore as distinct actions', async () => {
    const user = userEvent.setup()
    const { onDecision, onDownload } = renderDialog()
    const dialog = screen.getByRole('dialog', { name: t('draftRecovery.title') })

    await user.click(within(dialog).getByRole('button', { name: t('draftRecovery.download') }))
    expect(onDownload).toHaveBeenCalledOnce()
    expect(onDecision).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: t('draftRecovery.discard') }))
    expect(onDecision).toHaveBeenNthCalledWith(1, 'discard')

    await user.click(within(dialog).getByRole('button', { name: t('draftRecovery.restore') }))
    expect(onDecision).toHaveBeenNthCalledWith(2, 'restore')
  })

  it('focuses Restore and cannot be dismissed with Escape or its backdrop', () => {
    const { onDecision, onDownload } = renderDialog()
    const dialog = screen.getByRole('dialog', { name: t('draftRecovery.title') })
    const restore = within(dialog).getByRole('button', {
      name: t('draftRecovery.restore')
    })

    expect(document.activeElement).toBe(restore)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(dialog.parentElement!)

    expect(screen.getByRole('dialog', { name: t('draftRecovery.title') })).not.toBeNull()
    expect(onDecision).not.toHaveBeenCalled()
    expect(onDownload).not.toHaveBeenCalled()
  })

  it('renders localized Arabic copy and timestamp in RTL while keeping XML LTR', () => {
    setLang('ar')
    renderDialog({
      lang: 'ar',
      title: 'معالجة الطلب',
      comparison: comparison('base-diverged')
    })

    const dialog = screen.getByRole('dialog', { name: t('draftRecovery.title') })
    expect(dialog.getAttribute('dir')).toBe('rtl')
    const summary = within(dialog).getByText((_, element) => {
      return element?.id === 'draft-recovery-summary'
    })
    const formattedTimestamp = new Intl.DateTimeFormat('ar-AE', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp))
    expect(summary.textContent).toContain('معالجة الطلب')
    expect(summary.textContent).toContain(formattedTimestamp)
    expect(summary.textContent).toContain(t('draftRecovery.relation.base-diverged'))
    expect(within(dialog).getAllByText(/definitions/)).toHaveLength(2)
    for (const preview of dialog.querySelectorAll('pre')) {
      expect(preview.getAttribute('dir')).toBe('ltr')
      expect(preview.style.textAlign).toBe('left')
    }
  })

  it('updates the displayed document, comparison, locale, and action handlers on rerender', async () => {
    const user = userEvent.setup()
    const firstDecision = vi.fn()
    const nextDecision = vi.fn()
    const nextDownload = vi.fn()
    const { view } = renderDialog({ onDecision: firstDecision })

    setLang('ar')
    view.rerender(
      <DraftRecoveryDialog
        lang="ar"
        title="عملية بديلة"
        comparison={comparison('unknown-base')}
        onDecision={nextDecision}
        onDownload={nextDownload}
      />
    )

    const dialog = screen.getByRole('dialog', { name: t('draftRecovery.title') })
    expect(dialog.getAttribute('dir')).toBe('rtl')
    expect(within(dialog).getByText(/عملية بديلة/)).not.toBeNull()
    expect(document.querySelector('#draft-recovery-summary')?.textContent).toContain(
      t('draftRecovery.relation.unknown-base')
    )

    await user.click(within(dialog).getByRole('button', { name: t('draftRecovery.download') }))
    await user.click(within(dialog).getByRole('button', { name: t('draftRecovery.restore') }))
    expect(firstDecision).not.toHaveBeenCalled()
    expect(nextDownload).toHaveBeenCalledOnce()
    expect(nextDecision).toHaveBeenCalledWith('restore')
  })
})
