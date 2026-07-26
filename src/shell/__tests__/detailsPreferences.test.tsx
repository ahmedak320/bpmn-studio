// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DETAILS_WIDTH_BOUNDS,
  DETAILS_OPEN_PREFERENCE_KEY,
  DETAILS_PREFERENCES_VERSION,
  DETAILS_WIDTH_PREFERENCE_KEY,
  clampDetailsWidth,
  readDetailsPreferences,
  useDetailsPreferences,
  type PreferenceStorage
} from '../detailsPreferences'

afterEach(cleanup)

class MemoryStorage implements PreferenceStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function PreferencesHarness({ storage }: { storage: PreferenceStorage | null }): JSX.Element {
  const controller = useDetailsPreferences({ storage })
  return (
    <>
      <output data-testid="state">
        {String(controller.preferences.open)}:{controller.preferences.width}
      </output>
      <button type="button" onClick={() => controller.setOpen(true)}>
        open
      </button>
      <button type="button" onClick={() => controller.setWidth(900)}>
        widen
      </button>
      <button type="button" onClick={controller.resetWidth}>
        reset width
      </button>
      <button type="button" onClick={controller.reset}>
        reset all
      </button>
    </>
  )
}

describe('Details preferences', () => {
  it('uses a stable versioned namespace and defaults to closed', () => {
    const storage = new MemoryStorage()
    expect(DETAILS_PREFERENCES_VERSION).toBe(1)
    expect(DETAILS_OPEN_PREFERENCE_KEY).toContain('.preferences.v1.details.')
    expect(DETAILS_WIDTH_PREFERENCE_KEY).toContain('.preferences.v1.details.')
    expect(readDetailsPreferences(storage)).toEqual({
      version: 1,
      open: false,
      width: DEFAULT_DETAILS_WIDTH_BOUNDS.defaultWidth
    })
  })

  it('reads valid choices and clamps malformed or out-of-bounds widths', () => {
    const storage = new MemoryStorage()
    storage.setItem(DETAILS_OPEN_PREFERENCE_KEY, '1')
    storage.setItem(DETAILS_WIDTH_PREFERENCE_KEY, '900')
    expect(readDetailsPreferences(storage)).toEqual({
      version: 1,
      open: true,
      width: DEFAULT_DETAILS_WIDTH_BOUNDS.max
    })

    storage.setItem(DETAILS_WIDTH_PREFERENCE_KEY, 'not-a-number')
    expect(readDetailsPreferences(storage).width).toBe(DEFAULT_DETAILS_WIDTH_BOUNDS.defaultWidth)
    storage.setItem(DETAILS_WIDTH_PREFERENCE_KEY, '100')
    expect(readDetailsPreferences(storage).width).toBe(DEFAULT_DETAILS_WIDTH_BOUNDS.min)
  })

  it('rounds and clamps writes to the configured bounds', () => {
    expect(clampDetailsWidth(280.6)).toBe(281)
    expect(clampDetailsWidth(0)).toBe(DEFAULT_DETAILS_WIDTH_BOUNDS.min)
    expect(clampDetailsWidth(900)).toBe(DEFAULT_DETAILS_WIDTH_BOUNDS.max)
    expect(clampDetailsWidth(Number.NaN)).toBe(DEFAULT_DETAILS_WIDTH_BOUNDS.defaultWidth)
    expect(
      clampDetailsWidth(500, {
        min: 250,
        max: 400,
        defaultWidth: 320
      })
    ).toBe(400)
  })

  it('persists open and width changes and resets width to its default', () => {
    const storage = new MemoryStorage()
    render(<PreferencesHarness storage={storage} />)

    expect(screen.getByTestId('state').textContent).toBe('false:300')
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByTestId('state').textContent).toBe('true:300')
    expect(storage.getItem(DETAILS_OPEN_PREFERENCE_KEY)).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'widen' }))
    expect(screen.getByTestId('state').textContent).toBe('true:560')
    expect(storage.getItem(DETAILS_WIDTH_PREFERENCE_KEY)).toBe('560')

    fireEvent.click(screen.getByRole('button', { name: 'reset width' }))
    expect(screen.getByTestId('state').textContent).toBe('true:300')
    expect(storage.getItem(DETAILS_WIDTH_PREFERENCE_KEY)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'reset all' }))
    expect(screen.getByTestId('state').textContent).toBe('false:300')
    expect(storage.getItem(DETAILS_OPEN_PREFERENCE_KEY)).toBeNull()
  })

  it('keeps live state usable when browser storage throws', () => {
    const brokenStorage: PreferenceStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      }
    }
    render(<PreferencesHarness storage={brokenStorage} />)

    expect(screen.getByTestId('state').textContent).toBe('false:300')
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    fireEvent.click(screen.getByRole('button', { name: 'widen' }))
    expect(screen.getByTestId('state').textContent).toBe('true:560')
  })
})
