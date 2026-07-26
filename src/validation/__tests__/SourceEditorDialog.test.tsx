// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createValidationSummary, validationIssue } from '../contracts'
import { SourceEditorDialog } from '../SourceEditorDialog'

const preservation = vi.hoisted(() => vi.fn())

vi.mock('../extensions', () => ({
  validateUnknownExtensionPreservation: preservation
}))

vi.mock('../../i18n', () => ({
  t: (key: string): string => key
}))

const validSummary = createValidationSummary([], { xmlWellFormed: true })

function renderDialog(
  overrides: Partial<ComponentProps<typeof SourceEditorDialog>> = {}
): ReturnType<typeof render> {
  return render(
    <SourceEditorDialog
      open
      originalXml='<definitions id="original" />'
      validate={vi.fn(async () => validSummary)}
      apply={vi.fn(async () => ({ status: 'applied' as const }))}
      autoLayout={vi.fn(async (xml) => xml)}
      onClose={vi.fn()}
      {...overrides}
    />
  )
}

beforeEach(() => {
  preservation.mockReset().mockResolvedValue(validSummary)
})

afterEach(() => {
  cleanup()
})

describe('SourceEditorDialog Apply outcomes', () => {
  it('keeps the exact draft open and unchanged when review is cancelled', async () => {
    const user = userEvent.setup()
    const apply = vi.fn(async () => ({ status: 'cancelled' as const }))
    const onClose = vi.fn()
    renderDialog({ apply, onClose })
    const textarea = screen.getByRole('textbox')
    const candidate = '<definitions id="candidate" />'
    fireEvent.change(textarea, { target: { value: candidate } })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))

    await waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(apply).toHaveBeenCalledWith(candidate, expect.any(AbortSignal))
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(candidate)
    expect(screen.getByRole('dialog', { name: 'sourceEditor.title' })).not.toBeNull()
  })

  it('shows a blocking coordinator result and never closes as if source applied', async () => {
    const user = userEvent.setup()
    const apply = vi.fn(async () => ({
      status: 'blocked' as const,
      message: 'review still required'
    }))
    const onClose = vi.fn()
    renderDialog({ apply, onClose })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))

    expect((await screen.findByRole('alert')).textContent).toContain('review still required')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('blocks structural validation failures before invoking Apply', async () => {
    const user = userEvent.setup()
    const invalid = createValidationSummary(
      [
        validationIssue({
          code: 'structure.invalid',
          severity: 'error',
          source: 'structure',
          message: 'invalid structure'
        })
      ],
      { xmlWellFormed: true }
    )
    const apply = vi.fn()
    renderDialog({ validate: vi.fn(async () => invalid), apply })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))

    expect(await screen.findByText('structure.invalid')).not.toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })

  it('aborts an in-flight review when the dialog is removed', async () => {
    let capturedSignal: AbortSignal | undefined
    const apply = vi.fn(
      async (_xml: string, signal: AbortSignal) =>
        await new Promise<never>((_resolve, reject) => {
          capturedSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const view = renderDialog({ apply })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))
    await waitFor(() => expect(capturedSignal).toBeDefined())

    view.unmount()

    expect(capturedSignal?.aborted).toBe(true)
  })

  it('aborts an in-flight review when the exact source snapshot changes', async () => {
    let capturedSignal: AbortSignal | undefined
    const apply = vi.fn(
      async (_xml: string, signal: AbortSignal) =>
        await new Promise<never>((_resolve, reject) => {
          capturedSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const validate = vi.fn(async () => validSummary)
    const autoLayout = vi.fn(async (xml: string) => xml)
    const onClose = vi.fn()
    const view = render(
      <SourceEditorDialog
        open
        originalXml='<definitions id="original" />'
        validate={validate}
        apply={apply}
        autoLayout={autoLayout}
        onClose={onClose}
      />
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))
    await waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal))

    view.rerender(
      <SourceEditorDialog
        open
        originalXml='<definitions id="replacement" />'
        validate={validate}
        apply={apply}
        autoLayout={autoLayout}
        onClose={onClose}
      />
    )

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
        '<definitions id="replacement" />'
      )
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
