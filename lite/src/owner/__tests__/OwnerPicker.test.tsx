import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OwnerPicker, DEFAULT_OWNER_PICKER_LABELS, ownerSuggestions } from '../OwnerPicker'
import type { OwnerEntry } from '../ownersIndex'

const noop = (): void => {}

const entries: OwnerEntry[] = [
  { name: 'Alice', type: 'individual', count: 5 },
  { name: 'Bob Smith', type: 'individual', count: 3 },
  { name: 'Sales', type: 'department', count: 2 },
  { name: 'Sales North', type: 'department', count: 1 }
]

describe('ownerSuggestions (pure helper)', () => {
  it('returns empty list for an empty query', () => {
    expect(ownerSuggestions(entries, '')).toEqual([])
    expect(ownerSuggestions(entries, '   ')).toEqual([])
  })

  it('filters case-insensitively by substring', () => {
    const result = ownerSuggestions(entries, 'sal')
    expect(result.map((e) => e.name)).toEqual(['Sales', 'Sales North'])
  })

  it('caps the result at the max (default 8)', () => {
    const many: OwnerEntry[] = Array.from({ length: 12 }, (_, i) => ({
      name: `Owner ${i}`,
      count: 1
    }))
    expect(ownerSuggestions(many, 'Owner')).toHaveLength(8)
  })

  it('respects a custom max', () => {
    expect(ownerSuggestions(entries, 'a', 1)).toHaveLength(1)
  })
})

describe('OwnerPicker (static render)', () => {
  it('renders without throwing and includes the name label and current value', () => {
    const html = renderToStaticMarkup(
      <OwnerPicker
        value="Alice"
        ownerType="individual"
        entries={entries}
        labels={DEFAULT_OWNER_PICKER_LABELS}
        onChange={noop}
      />
    )
    expect(html).toContain(DEFAULT_OWNER_PICKER_LABELS.nameLabel)
    expect(html).toContain('value="Alice"')
  })

  it('renders the type select with all three types plus the none option', () => {
    const html = renderToStaticMarkup(
      <OwnerPicker
        value=""
        ownerType=""
        entries={entries}
        labels={DEFAULT_OWNER_PICKER_LABELS}
        onChange={noop}
      />
    )
    expect(html).toContain(DEFAULT_OWNER_PICKER_LABELS.typeIndividual)
    expect(html).toContain(DEFAULT_OWNER_PICKER_LABELS.typeDepartment)
    expect(html).toContain(DEFAULT_OWNER_PICKER_LABELS.typeDivision)
    expect(html).toContain(DEFAULT_OWNER_PICKER_LABELS.typeNone)
  })

  it('renders with an empty entries list without throwing', () => {
    const html = renderToStaticMarkup(
      <OwnerPicker
        value=""
        ownerType=""
        entries={[]}
        labels={DEFAULT_OWNER_PICKER_LABELS}
        onChange={noop}
      />
    )
    expect(html).toContain(DEFAULT_OWNER_PICKER_LABELS.namePlaceholder)
  })

  it('does not statically render the listbox (no focus state on server render)', () => {
    const html = renderToStaticMarkup(
      <OwnerPicker
        value="Sales"
        ownerType=""
        entries={entries}
        labels={DEFAULT_OWNER_PICKER_LABELS}
        onChange={noop}
      />
    )
    expect(html).not.toContain('role="listbox"')
  })

  it('applies custom labels', () => {
    const html = renderToStaticMarkup(
      <OwnerPicker
        value=""
        ownerType=""
        entries={entries}
        labels={{ ...DEFAULT_OWNER_PICKER_LABELS, nameLabel: 'Custom Owner Label' }}
        onChange={noop}
      />
    )
    expect(html).toContain('Custom Owner Label')
  })
})
