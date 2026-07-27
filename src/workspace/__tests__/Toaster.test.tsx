// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../Toaster'

afterEach(cleanup)

describe('Toaster announcements', () => {
  it('announces errors assertively while ordinary feedback remains polite', () => {
    render(
      <Toaster
        toasts={[
          { id: 1, text: 'Import completed.', tone: 'success' },
          { id: 2, text: 'Import failed.', tone: 'error' },
          { id: 3, text: 'Import is ready for review.', tone: 'info' }
        ]}
        onDismiss={vi.fn()}
      />
    )

    const error = screen.getByRole('alert')
    expect(error.textContent).toBe('Import failed.')
    expect(error.getAttribute('aria-live')).toBe('assertive')
    expect(error.getAttribute('aria-atomic')).toBe('true')

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(2)
    expect(statuses.map((status) => status.getAttribute('aria-live'))).toEqual(['polite', 'polite'])
    expect(statuses.every((status) => status.getAttribute('aria-atomic') === 'true')).toBe(true)
  })
})
