import { useCallback, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
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
  /** Optional control rendered inside modal/overlay surfaces, never when docked. */
  modalChrome?: ReactNode
  /** Preferred inline size. Overlay and compact modes still cap it to the viewport. */
  inlineSize?: number | string
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
  modalChrome,
  inlineSize,
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
  const drawerStyle =
    inlineSize === undefined
      ? undefined
      : ({
          '--orbitpm-responsive-drawer-inline-size':
            typeof inlineSize === 'number' ? `${inlineSize}px` : inlineSize
        } as CSSProperties)

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
          style={drawerStyle}
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
        dialogStyle={drawerStyle}
      >
        {modalChrome}
        {inlineChildren}
      </AccessibleDialog>
      {persistentChildren}
    </>
  )
}

export default ResponsiveDrawer
