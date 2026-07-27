import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref
} from 'react'

import './ActionMenu.css'

const ACTION_SELECTOR = 'button, a[href], [role="menuitem"]'

type ActionMenuMode = 'inline' | 'menu'

interface AttributeSnapshot {
  role: string | null
  tabIndex: string | null
  ariaDisabled: string | null
}

export interface ActionMenuProps {
  mode: ActionMenuMode
  label: string
  children: ReactNode
  direction?: 'ltr' | 'rtl'
  className?: string
  triggerClassName?: string
  menuClassName?: string
  triggerContent?: ReactNode
  triggerRef?: Ref<HTMLButtonElement>
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ;(ref as { current: T | null }).current = value
  }
}

function isDisabled(item: HTMLElement): boolean {
  return (
    (item instanceof HTMLButtonElement && item.disabled) ||
    item.getAttribute('aria-disabled') === 'true'
  )
}

function enabledItems(surface: HTMLElement | null): HTMLElement[] {
  if (!surface) return []
  return Array.from(surface.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (item) => !isDisabled(item) && !item.closest('[hidden], [aria-hidden="true"]')
  )
}

/**
 * Reusable responsive action group.
 *
 * Inline mode leaves the supplied actions in the normal toolbar flow. Menu
 * mode keeps those same React children mounted, adds the ARIA menu contract to
 * their rendered buttons/links, and exposes them through one keyboard menu
 * button. Keeping one child tree avoids remounting stateful caller actions when
 * the responsive mode changes.
 */
export function ActionMenu({
  mode,
  label,
  children,
  direction,
  className,
  triggerClassName,
  menuClassName,
  triggerContent,
  triggerRef
}: ActionMenuProps): JSX.Element {
  const reactId = useId()
  const triggerId = `orbitpm-action-menu-trigger-${reactId}`
  const menuId = `orbitpm-action-menu-${reactId}`
  const rootRef = useRef<HTMLDivElement | null>(null)
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const requestedFocusRef = useRef<'first' | 'last'>('first')
  const [open, setOpen] = useState(false)

  const setTriggerNode = useCallback(
    (node: HTMLButtonElement | null): void => {
      internalTriggerRef.current = node
      assignRef(triggerRef, node)
    },
    [triggerRef]
  )

  const closeMenu = useCallback((restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) internalTriggerRef.current?.focus()
  }, [])

  const openMenu = useCallback((requestedFocus: 'first' | 'last'): void => {
    requestedFocusRef.current = requestedFocus
    setOpen(true)
  }, [])

  useEffect(() => {
    if (mode !== 'menu' && open) setOpen(false)
  }, [mode, open])

  /*
   * toolbarExtra is intentionally a ReactNode API and can contain caller
   * components, not just elements we can clone. Adapt their rendered native
   * actions at the DOM boundary so every item receives the same menu semantics
   * without duplicating or remounting caller content.
   */
  useLayoutEffect(() => {
    if (mode !== 'menu') return
    const surface = surfaceRef.current
    if (!surface) return

    const snapshots = new Map<HTMLElement, AttributeSnapshot>()
    for (const item of Array.from(surface.querySelectorAll<HTMLElement>(ACTION_SELECTOR))) {
      snapshots.set(item, {
        role: item.getAttribute('role'),
        tabIndex: item.getAttribute('tabindex'),
        ariaDisabled: item.getAttribute('aria-disabled')
      })
      item.setAttribute('role', 'menuitem')
      item.setAttribute('tabindex', '-1')
      if (item instanceof HTMLButtonElement && item.disabled) {
        item.setAttribute('aria-disabled', 'true')
      }
    }

    return () => {
      for (const [item, snapshot] of snapshots) {
        if (!item.isConnected) continue
        if (snapshot.role === null) item.removeAttribute('role')
        else item.setAttribute('role', snapshot.role)
        if (snapshot.tabIndex === null) item.removeAttribute('tabindex')
        else item.setAttribute('tabindex', snapshot.tabIndex)
        if (snapshot.ariaDisabled === null) item.removeAttribute('aria-disabled')
        else item.setAttribute('aria-disabled', snapshot.ariaDisabled)
      }
    }
  }, [children, mode])

  useEffect(() => {
    if (!open || mode !== 'menu') return
    const frame = requestAnimationFrame(() => {
      const items = enabledItems(surfaceRef.current)
      const target = requestedFocusRef.current === 'last' ? items.at(-1) : items[0]
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [children, mode, open])

  useEffect(() => {
    if (!open || mode !== 'menu') return

    const isOutside = (event: Event): boolean => {
      const target = event.target
      return target instanceof Node && !rootRef.current?.contains(target)
    }
    const closeFromOutsidePointer = (event: PointerEvent): void => {
      if (isOutside(event)) closeMenu(true)
    }
    const closeFromOutsideFocus = (event: FocusEvent): void => {
      if (isOutside(event)) closeMenu(false)
    }

    document.addEventListener('pointerdown', closeFromOutsidePointer, true)
    document.addEventListener('focusin', closeFromOutsideFocus, true)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutsidePointer, true)
      document.removeEventListener('focusin', closeFromOutsideFocus, true)
    }
  }, [closeMenu, mode, open])

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (mode !== 'menu') return
    if (event.key === 'ArrowDown' || event.key === 'Home') {
      event.preventDefault()
      openMenu('first')
    } else if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault()
      openMenu('last')
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeMenu(true)
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
      return
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = enabledItems(surfaceRef.current)
    if (items.length === 0) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Home') {
      items[0]?.focus()
      return
    }
    if (event.key === 'End') {
      items.at(-1)?.focus()
      return
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex =
      currentIndex < 0
        ? delta > 0
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length
    items[nextIndex]?.focus()
  }

  const rootClassName = ['orbitpm-action-menu', `orbitpm-action-menu--${mode}`, className]
    .filter(Boolean)
    .join(' ')
  const triggerClasses = ['orbitpm-action-menu__trigger', triggerClassName]
    .filter(Boolean)
    .join(' ')
  const surfaceClasses = ['orbitpm-action-menu__surface', menuClassName].filter(Boolean).join(' ')

  return (
    <div ref={rootRef} className={rootClassName} dir={direction}>
      <button
        ref={setTriggerNode}
        id={triggerId}
        type="button"
        className={triggerClasses}
        hidden={mode !== 'menu'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (open) closeMenu(true)
          else openMenu('first')
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        {triggerContent ?? <span aria-hidden="true">⋯</span>}
      </button>
      <div
        ref={surfaceRef}
        id={menuId}
        className={surfaceClasses}
        hidden={mode === 'menu' && !open}
        role={mode === 'menu' ? 'menu' : undefined}
        aria-labelledby={mode === 'menu' ? triggerId : undefined}
        onKeyDown={mode === 'menu' ? handleMenuKeyDown : undefined}
        onClick={
          mode === 'menu'
            ? (event) => {
                const target = event.target
                if (!(target instanceof Element)) return
                const item = target.closest<HTMLElement>('[role="menuitem"]')
                if (!item || !surfaceRef.current?.contains(item) || isDisabled(item)) return
                // Focus the stable trigger before the item disappears. Any
                // dialog opened by the action can then capture it as its return
                // target, while ordinary actions also return here directly.
                closeMenu(true)
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  )
}

export default ActionMenu
