import { useEffect, useRef } from 'react'

export interface ProcessTabItem {
  readonly key: string
  readonly title: string
}

export interface ProcessTabListProps {
  tabs: readonly ProcessTabItem[]
  activeKey: string | null
  dirtyKeys: ReadonlySet<string>
  dir: 'ltr' | 'rtl'
  ariaLabel: string
  closeTitle: string
  dirtyLabel: string
  onActivate: (key: string) => void
  /**
   * Returns false when a dirty-tab confirmation is cancelled. Returning true
   * tells the tablist that the parent accepted the close and will remove it.
   */
  onClose: (key: string) => boolean
  onEmptyFocus?: () => void
}

export function processTabId(key: string): string {
  return `orbitpm-process-tab-${encodeURIComponent(key)}`
}

export function processTabPanelId(key: string): string {
  return `orbitpm-process-tabpanel-${encodeURIComponent(key)}`
}

export function ProcessTabList({
  tabs,
  activeKey,
  dirtyKeys,
  dir,
  ariaLabel,
  closeTitle,
  dirtyLabel,
  onActivate,
  onClose,
  onEmptyFocus
}: ProcessTabListProps): JSX.Element {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  const focusTab = (key: string): void => {
    requestAnimationFrame(() => {
      const tab = tabRefs.current.get(key)
      tab?.focus()
      tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    })
  }

  const activateAt = (index: number): void => {
    const tab = tabs[index]
    if (!tab) return
    onActivate(tab.key)
    focusTab(tab.key)
  }

  const closeAt = (index: number): void => {
    const closing = tabs[index]
    if (!closing || !onClose(closing.key)) return
    const remaining = tabs.filter(({ key }) => key !== closing.key)
    if (remaining.length === 0) {
      requestAnimationFrame(() => onEmptyFocus?.())
      return
    }

    const focusKey =
      closing.key === activeKey
        ? (remaining[Math.min(index, remaining.length - 1)]?.key ?? remaining[0]!.key)
        : (activeKey ?? remaining[Math.min(index, remaining.length - 1)]!.key)
    if (closing.key === activeKey) onActivate(focusKey)
    focusTab(focusKey)
  }

  useEffect(() => {
    if (!activeKey) return
    tabRefs.current.get(activeKey)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--orbitpm-border)',
        overflowX: 'auto',
        flex: '0 0 auto'
      }}
    >
      {tabs.map((tab, index) => {
        const active = activeKey === tab.key
        const dirty = dirtyKeys.has(tab.key)
        return (
          <button
            key={tab.key}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.key, node)
              else tabRefs.current.delete(tab.key)
            }}
            id={processTabId(tab.key)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={processTabPanelId(tab.key)}
            aria-label={dirty ? `${tab.title} — ${dirtyLabel}` : tab.title}
            tabIndex={active ? 0 : -1}
            onClick={() => onActivate(tab.key)}
            onKeyDown={(event) => {
              let nextIndex: number | undefined
              if (event.key === 'Home') nextIndex = 0
              else if (event.key === 'End') nextIndex = tabs.length - 1
              else if (event.key === 'ArrowRight') {
                const delta = dir === 'rtl' ? -1 : 1
                nextIndex = (index + delta + tabs.length) % tabs.length
              } else if (event.key === 'ArrowLeft') {
                const delta = dir === 'rtl' ? 1 : -1
                nextIndex = (index + delta + tabs.length) % tabs.length
              } else if (event.key === 'Delete') {
                event.preventDefault()
                closeAt(index)
                return
              }
              if (nextIndex === undefined) return
              event.preventDefault()
              activateAt(nextIndex)
            }}
            style={{
              minHeight: 44,
              paddingBlock: '0.4rem',
              paddingInlineStart: '0.9rem',
              paddingInlineEnd: '0.55rem',
              border: 'none',
              borderBottom: active ? '2px solid var(--orbitpm-accent)' : '2px solid transparent',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: active ? 1 : 0.65
            }}
          >
            <span aria-hidden="true">
              {dirty && <span aria-hidden>● </span>}
              {tab.title}
            </span>
            <span
              aria-hidden="true"
              title={closeTitle}
              onClick={(event) => {
                event.stopPropagation()
                closeAt(index)
              }}
              style={{
                width: 24,
                height: 24,
                display: 'inline-grid',
                placeItems: 'center',
                borderRadius: 4,
                opacity: 0.65
              }}
            >
              ×
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default ProcessTabList
