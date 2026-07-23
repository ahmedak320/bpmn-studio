import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { OwnerEntry } from './ownersIndex'
import { filterOwners } from './ownersIndex'

export interface OwnerPickerLabels {
  nameLabel: string
  namePlaceholder: string
  typeLabel: string
  typeIndividual: string
  typeDepartment: string
  typeDivision: string
  typeNone: string
  suggestionsAria: string
}

export const DEFAULT_OWNER_PICKER_LABELS: OwnerPickerLabels = {
  nameLabel: 'Owner',
  namePlaceholder: 'Owner name…',
  typeLabel: 'Type',
  typeIndividual: 'Individual',
  typeDepartment: 'Department',
  typeDivision: 'Division',
  typeNone: '—',
  suggestionsAria: 'Owner suggestions'
}

export interface OwnerPickerProps {
  value: string
  ownerType: string
  entries: OwnerEntry[]
  labels: OwnerPickerLabels
  onChange: (name: string, ownerType: string) => void
  autoFocus?: boolean
}

/**
 * Pure helper (kept separate from component state so it can be unit-tested
 * without a DOM/render environment): the visible suggestion list for a given
 * set of entries + current query, capped to the 8-row visible max.
 */
export function ownerSuggestions(entries: OwnerEntry[], query: string, max = 8): OwnerEntry[] {
  if (!query.trim()) return []
  return filterOwners(entries, query).slice(0, max)
}

const inputStyle: CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box'
}

const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const labelText: CSSProperties = { fontSize: 12, opacity: 0.8 }

/**
 * Controlled owner name/type combobox. Text input with an inline suggestion
 * listbox (filtered against `entries`, max 8 rows), plus a plain `<select>`
 * for the owner type. Free typing always calls `onChange(text, ownerType)`
 * immediately — selecting a suggestion also fills in that entry's type when
 * known.
 */
export function OwnerPicker({
  value,
  ownerType,
  entries,
  labels,
  onChange,
  autoFocus
}: OwnerPickerProps): JSX.Element {
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const suggestions = useMemo(() => ownerSuggestions(entries, value), [entries, value])
  const showList = focused && suggestions.length > 0

  const selectEntry = (entry: OwnerEntry): void => {
    onChange(entry.name, entry.type ?? ownerType)
    setFocused(false)
    setActiveIndex(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!showList) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault()
        selectEntry(suggestions[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setFocused(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={labelStyle}>
        <span style={labelText}>{labels.nameLabel}</span>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            dir="auto"
            role="combobox"
            aria-expanded={showList}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            autoFocus={autoFocus}
            value={value}
            placeholder={labels.namePlaceholder}
            style={inputStyle}
            onChange={(e) => {
              onChange(e.target.value, ownerType)
              setActiveIndex(-1)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
          />
          {showList && (
            <ul
              role="listbox"
              aria-label={labels.suggestionsAria}
              style={{
                position: 'absolute',
                insetInlineStart: 0,
                insetInlineEnd: 0,
                top: '100%',
                marginTop: 2,
                maxHeight: 8 * 34,
                overflowY: 'auto',
                listStyle: 'none',
                padding: 4,
                margin: 0,
                background: 'var(--orbitpm-panel-bg)',
                border: '1px solid var(--orbitpm-border)',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                zIndex: 10
              }}
            >
              {suggestions.map((entry, i) => (
                <li
                  key={entry.name.toLowerCase()}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectEntry(entry)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '0.35rem 0.5rem',
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: i === activeIndex ? 'var(--orbitpm-accent)' : 'transparent',
                    color: i === activeIndex ? '#fff' : 'inherit',
                    fontSize: 13
                  }}
                >
                  <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.name}
                  </span>
                  <span
                    style={{
                      flex: '0 0 auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      opacity: 0.8
                    }}
                  >
                    {entry.type && <span>{entry.type}</span>}
                    <span
                      style={{
                        padding: '0.05rem 0.4rem',
                        borderRadius: 999,
                        background: i === activeIndex ? 'rgba(255,255,255,0.25)' : 'rgba(127,127,127,0.25)'
                      }}
                    >
                      {entry.count}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      <label style={labelStyle}>
        <span style={labelText}>{labels.typeLabel}</span>
        <select
          value={ownerType}
          onChange={(e) => onChange(value, e.target.value)}
          style={inputStyle}
        >
          <option value="">{labels.typeNone}</option>
          <option value="individual">{labels.typeIndividual}</option>
          <option value="department">{labels.typeDepartment}</option>
          <option value="division">{labels.typeDivision}</option>
        </select>
      </label>
    </div>
  )
}
