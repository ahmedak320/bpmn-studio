import { useCallback, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AccessibleDialog } from '../common/AccessibleDialog'
import type { ResponsiveShellMode } from './responsiveMode'

export interface ResponsiveDrawerProps {
  open: boolean
  mode: ResponsiveShellMode
  side: 'inline-start' | 'inline-end'
  id: string
  label: string
  direction: 'ltr' | 'rtl'
  children: ReactNode
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  describedBy?: string
  closeOnBackdrop?: boolean
  /**
   * Keeps child DOM mounted in a hidden host while closed. Use this for
   * externally-owned DOM (for example, the bpmn-js properties panel).
   */
  keepMounted?: boolean
  className?: string
}

export function ResponsiveDrawer({
  open,
  mode,
  side,
  id,
  label,
  direction,
  children,
  onClose,
  initialFocusRef,
  returnFocusRef,
  describedBy,
  closeOnBackdrop = true,
  keepMounted = false,
  className
}: ResponsiveDrawerProps): JSX.Element | null {
  const [persistentHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null
    const host = document.createElement('div')
    host.className = 'orbitpm-responsive-drawer__persistent-content'
    return host
  })
  const attachPersistentHost = useCallback(
    (surface: HTMLElement | null): void => {
      if (keepMounted && surface && persistentHost) surface.appendChild(persistentHost)
    },
    [keepMounted, persistentHost]
  )
  const inlineChildren = keepMounted && persistentHost ? null : children
  const persistentChildren =
    keepMounted && persistentHost ? createPortal(children, persistentHost) : null

  if (!open) {
    if (!keepMounted) return null
    return (
      <>
        <div
          ref={attachPersistentHost}
          id={id}
          className="orbitpm-responsive-drawer__stash"
          data-side={side}
          data-responsive-mode={mode}
          hidden
          aria-hidden="true"
          dir={direction}
        >
          {inlineChildren}
        </div>
        {persistentChildren}
      </>
    )
  }

  const drawerClassName = [
    'orbitpm-responsive-drawer',
    mode === 'docked' ? 'orbitpm-responsive-drawer--docked' : '',
    `orbitpm-responsive-drawer--${mode}`,
    `orbitpm-responsive-drawer--${side}`,
    className
  ]
    .filter(Boolean)
    .join(' ')

  if (mode === 'docked') {
    return (
      <>
        <aside
          ref={attachPersistentHost}
          id={id}
          className={drawerClassName}
          data-side={side}
          data-responsive-mode={mode}
          aria-label={label}
          aria-describedby={describedBy}
          dir={direction}
        >
          {inlineChildren}
        </aside>
        {persistentChildren}
      </>
    )
  }

  return (
    <>
      <AccessibleDialog
        ariaLabel={label}
        ariaDescribedby={describedBy}
        onClose={onClose}
        closeOnEscape
        closeOnBackdrop={closeOnBackdrop}
        initialFocusRef={initialFocusRef}
        returnFocusRef={returnFocusRef}
        dialogRef={attachPersistentHost}
        dialogId={id}
        dir={direction}
        backdropClassName="orbitpm-responsive-drawer__backdrop"
        dialogClassName={drawerClassName}
      >
        {inlineChildren}
      </AccessibleDialog>
      {persistentChildren}
    </>
  )
}

export default ResponsiveDrawer
