import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/** Minimal positioned popup menu. Closes on outside click or Escape. */
function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        background: 'var(--tree-menu-bg, #fff)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        padding: 4,
        minWidth: 160,
        zIndex: 1000,
        fontSize: 13
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick()
            onClose()
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 10px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            borderRadius: 4,
            color: item.danger ? '#d33' : 'inherit'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(127,127,127,0.15)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default ContextMenu
