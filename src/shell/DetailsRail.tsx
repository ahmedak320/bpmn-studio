import { forwardRef, type MouseEvent as ReactMouseEvent } from 'react'

export type DetailsRailInput = 'keyboard' | 'pointer'

export interface DetailsRailProps {
  open: boolean
  controlsId: string
  label: string
  title: string
  direction: 'ltr' | 'rtl'
  onOpenChange: (open: boolean, input: DetailsRailInput) => void
  /** Called after a keyboard/screen-reader request to expand the pane. */
  onRequestPaneFocus?: () => void
  /** Called on collapse with the persistent native toggle as the focus target. */
  onRequestToggleFocus?: (toggle: HTMLButtonElement) => void
  className?: string
}

export const DetailsRail = forwardRef<HTMLButtonElement, DetailsRailProps>(function DetailsRail(
  {
    open,
    controlsId,
    label,
    title,
    direction,
    onOpenChange,
    onRequestPaneFocus,
    onRequestToggleFocus,
    className
  },
  buttonRef
) {
  const railClassName = ['orbitpm-details-rail', className].filter(Boolean).join(' ')

  const toggle = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    const input: DetailsRailInput = event.detail === 0 ? 'keyboard' : 'pointer'
    const nextOpen = !open
    onOpenChange(nextOpen, input)
    if (nextOpen && input === 'keyboard') onRequestPaneFocus?.()
    if (!nextOpen) onRequestToggleFocus?.(event.currentTarget)
  }

  return (
    <div className={railClassName} dir={direction}>
      <button
        ref={buttonRef}
        type="button"
        className="orbitpm-details-rail__toggle"
        data-state={open ? 'open' : 'closed'}
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-controls={controlsId}
        title={title}
      >
        <span className="orbitpm-details-rail__glyph" aria-hidden="true">
          {open ? '›' : '‹'}
        </span>
      </button>
    </div>
  )
})

export default DetailsRail
