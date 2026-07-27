import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject
} from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const dialogStack: symbol[] = []

interface InertSnapshot {
  node: HTMLElement
  inert: boolean
}

export interface AccessibleDialogProps {
  children: ReactNode
  role?: 'dialog' | 'alertdialog'
  ariaLabel?: string
  ariaLabelledby?: string
  ariaDescribedby?: string
  onClose?: () => void
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  backdropRef?: Ref<HTMLDivElement>
  dialogRef?: Ref<HTMLElement>
  backdropClassName?: string
  dialogClassName?: string
  backdropStyle?: CSSProperties
  dialogStyle?: CSSProperties
  dialogId?: string
  dir?: 'ltr' | 'rtl'
  onDialogKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ;(ref as { current: T | null }).current = value
  }
}

function isAvailable(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isAvailable)
}

/**
 * A dialog can be rendered deep inside the editor rather than through a
 * portal. Inert every sibling branch from the backdrop up to <body>, leaving
 * only the branch that contains the active dialog interactive.
 */
function makeOutsideBranchesInert(backdrop: HTMLElement): InertSnapshot[] {
  const snapshots: InertSnapshot[] = []
  const seen = new Set<HTMLElement>()
  let branch: HTMLElement = backdrop
  let parent = branch.parentElement

  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || seen.has(sibling)) continue
      seen.add(sibling)
      snapshots.push({ node: sibling, inert: sibling.inert === true })
      sibling.inert = true
    }
    if (parent === document.body) break
    branch = parent
    parent = parent.parentElement
  }

  return snapshots
}

function restoreInert(snapshots: readonly InertSnapshot[]): void {
  for (const snapshot of snapshots) snapshot.node.inert = snapshot.inert
}

/**
 * Headless modal primitive shared by every OrbitPM dialog.
 *
 * It owns the accessibility contract only: initial focus, Tab containment,
 * topmost Escape handling, outside-page inertness, backdrop dismissal, and
 * trigger-focus restoration. Callers retain their existing visual shell via
 * class/style props and may disable either dismissal path while busy.
 */
export function AccessibleDialog({
  children,
  role = 'dialog',
  ariaLabel,
  ariaLabelledby,
  ariaDescribedby,
  onClose,
  closeOnEscape = true,
  closeOnBackdrop = false,
  initialFocusRef,
  returnFocusRef,
  backdropRef,
  dialogRef,
  backdropClassName,
  dialogClassName,
  backdropStyle,
  dialogStyle,
  dialogId,
  dir,
  onDialogKeyDown
}: AccessibleDialogProps): JSX.Element {
  const tokenRef = useRef(Symbol('orbitpm-dialog'))
  const internalBackdropRef = useRef<HTMLDivElement | null>(null)
  const internalDialogRef = useRef<HTMLElement | null>(null)
  const behaviorRef = useRef({
    onClose,
    closeOnEscape,
    closeOnBackdrop,
    initialFocusRef,
    returnFocusRef
  })
  behaviorRef.current = {
    onClose,
    closeOnEscape,
    closeOnBackdrop,
    initialFocusRef,
    returnFocusRef
  }

  const setBackdropRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalBackdropRef.current = node
      assignRef(backdropRef, node)
    },
    [backdropRef]
  )
  const setDialogRef = useCallback(
    (node: HTMLElement | null) => {
      internalDialogRef.current = node
      assignRef(dialogRef, node)
    },
    [dialogRef]
  )

  useEffect(() => {
    const token = tokenRef.current
    const backdrop = internalBackdropRef.current
    const dialog = internalDialogRef.current
    if (!backdrop || !dialog) return

    const previouslyFocused =
      behaviorRef.current.returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const inertSnapshots = makeOutsideBranchesInert(backdrop)
    dialogStack.push(token)

    const initialTarget =
      behaviorRef.current.initialFocusRef?.current ??
      dialog.querySelector<HTMLElement>('[autofocus]') ??
      focusableElements(dialog)[0] ??
      dialog
    initialTarget.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (dialogStack.at(-1) !== token) return
      const behavior = behaviorRef.current
      if (event.key === 'Escape' && behavior.closeOnEscape && behavior.onClose) {
        event.preventDefault()
        event.stopPropagation()
        behavior.onClose()
        return
      }
      if (event.key !== 'Tab') return

      const candidates = focusableElements(dialog)
      const first = candidates[0] ?? dialog
      const last = candidates.at(-1) ?? dialog
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const index = dialogStack.lastIndexOf(token)
      if (index >= 0) dialogStack.splice(index, 1)
      restoreInert(inertSnapshots)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  const dismissFromBackdrop = (): void => {
    const behavior = behaviorRef.current
    if (dialogStack.at(-1) === tokenRef.current && behavior.closeOnBackdrop && behavior.onClose) {
      behavior.onClose()
    }
  }

  return (
    <div
      ref={setBackdropRef}
      className={backdropClassName}
      style={backdropStyle}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return
        dismissFromBackdrop()
      }}
    >
      <section
        ref={setDialogRef}
        id={dialogId}
        className={dialogClassName}
        style={dialogStyle}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        tabIndex={-1}
        dir={dir}
        onKeyDown={onDialogKeyDown}
      >
        {children}
      </section>
    </div>
  )
}

export default AccessibleDialog
