import { useCallback, useMemo, useState } from 'react'

export const DETAILS_PREFERENCES_VERSION = 1 as const
const DETAILS_PREFERENCE_PREFIX = `orbitpm.lite.preferences.v${DETAILS_PREFERENCES_VERSION}.details`

/**
 * These are the keys already used by the editor. Keeping the stable v1
 * namespace lets the extracted shell adopt existing user choices.
 */
export const DETAILS_OPEN_PREFERENCE_KEY = `${DETAILS_PREFERENCE_PREFIX}.open`
export const DETAILS_WIDTH_PREFERENCE_KEY = `${DETAILS_PREFERENCE_PREFIX}.width`

export interface DetailsWidthBounds {
  min: number
  max: number
  defaultWidth: number
}

export const DEFAULT_DETAILS_WIDTH_BOUNDS: Readonly<DetailsWidthBounds> = Object.freeze({
  min: 240,
  max: 560,
  defaultWidth: 300
})

export interface DetailsPreferences {
  version: typeof DETAILS_PREFERENCES_VERSION
  open: boolean
  width: number
}

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface DetailsPreferencesController {
  preferences: DetailsPreferences
  setOpen(open: boolean): void
  setWidth(width: number): void
  resetWidth(): void
  reset(): void
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function normalizedBounds(bounds: DetailsWidthBounds): DetailsWidthBounds {
  const min = Number.isFinite(bounds.min)
    ? Math.round(bounds.min)
    : DEFAULT_DETAILS_WIDTH_BOUNDS.min
  const maxCandidate = Number.isFinite(bounds.max)
    ? Math.round(bounds.max)
    : DEFAULT_DETAILS_WIDTH_BOUNDS.max
  const max = Math.max(min, maxCandidate)
  const fallback = Number.isFinite(bounds.defaultWidth)
    ? Math.round(bounds.defaultWidth)
    : DEFAULT_DETAILS_WIDTH_BOUNDS.defaultWidth
  return {
    min,
    max,
    defaultWidth: Math.min(max, Math.max(min, fallback))
  }
}

export function clampDetailsWidth(
  width: number,
  bounds: DetailsWidthBounds = DEFAULT_DETAILS_WIDTH_BOUNDS
): number {
  const normalized = normalizedBounds(bounds)
  if (!Number.isFinite(width)) return normalized.defaultWidth
  return Math.min(normalized.max, Math.max(normalized.min, Math.round(width)))
}

export function readDetailsPreferences(
  storage: PreferenceStorage | null = browserStorage(),
  bounds: DetailsWidthBounds = DEFAULT_DETAILS_WIDTH_BOUNDS
): DetailsPreferences {
  const normalized = normalizedBounds(bounds)
  if (!storage) {
    return {
      version: DETAILS_PREFERENCES_VERSION,
      open: false,
      width: normalized.defaultWidth
    }
  }

  try {
    const rawWidth = storage.getItem(DETAILS_WIDTH_PREFERENCE_KEY)
    const parsedWidth = rawWidth == null || rawWidth.trim() === '' ? Number.NaN : Number(rawWidth)
    return {
      version: DETAILS_PREFERENCES_VERSION,
      open: storage.getItem(DETAILS_OPEN_PREFERENCE_KEY) === '1',
      width: clampDetailsWidth(parsedWidth, normalized)
    }
  } catch {
    return {
      version: DETAILS_PREFERENCES_VERSION,
      open: false,
      width: normalized.defaultWidth
    }
  }
}

function persistOpen(storage: PreferenceStorage | null, open: boolean): void {
  try {
    storage?.setItem(DETAILS_OPEN_PREFERENCE_KEY, open ? '1' : '0')
  } catch {
    // Preference persistence is best-effort; live state still updates.
  }
}

function persistWidth(storage: PreferenceStorage | null, width: number): void {
  try {
    storage?.setItem(DETAILS_WIDTH_PREFERENCE_KEY, String(width))
  } catch {
    // Preference persistence is best-effort; live state still updates.
  }
}

function removePreference(storage: PreferenceStorage | null, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Preference persistence is best-effort; live state still updates.
  }
}

export function useDetailsPreferences(options?: {
  storage?: PreferenceStorage | null
  bounds?: DetailsWidthBounds
}): DetailsPreferencesController {
  const storage = options?.storage === undefined ? browserStorage() : options.storage
  const min = options?.bounds?.min ?? DEFAULT_DETAILS_WIDTH_BOUNDS.min
  const max = options?.bounds?.max ?? DEFAULT_DETAILS_WIDTH_BOUNDS.max
  const defaultWidth = options?.bounds?.defaultWidth ?? DEFAULT_DETAILS_WIDTH_BOUNDS.defaultWidth
  const bounds = useMemo(
    () => normalizedBounds({ min, max, defaultWidth }),
    [defaultWidth, max, min]
  )
  const [preferences, setPreferences] = useState<DetailsPreferences>(() =>
    readDetailsPreferences(storage, bounds)
  )

  const setOpen = useCallback(
    (open: boolean): void => {
      setPreferences((current) => ({ ...current, open }))
      persistOpen(storage, open)
    },
    [storage]
  )

  const setWidth = useCallback(
    (width: number): void => {
      const clamped = clampDetailsWidth(width, bounds)
      setPreferences((current) => ({ ...current, width: clamped }))
      persistWidth(storage, clamped)
    },
    [bounds, storage]
  )

  const resetWidth = useCallback((): void => {
    setPreferences((current) => ({ ...current, width: bounds.defaultWidth }))
    removePreference(storage, DETAILS_WIDTH_PREFERENCE_KEY)
  }, [bounds.defaultWidth, storage])

  const reset = useCallback((): void => {
    setPreferences({
      version: DETAILS_PREFERENCES_VERSION,
      open: false,
      width: bounds.defaultWidth
    })
    removePreference(storage, DETAILS_OPEN_PREFERENCE_KEY)
    removePreference(storage, DETAILS_WIDTH_PREFERENCE_KEY)
  }, [bounds.defaultWidth, storage])

  return { preferences, setOpen, setWidth, resetWidth, reset }
}
