import { useEffect } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

/**
 * `Id` is generic because toast identity conventions differ by caller: the
 * legacy `App.tsx` shell mints numeric ids from an incrementing ref, while
 * `ArisApp.tsx` mints string ids via `crypto.randomUUID()`. Both are valid —
 * the only real contract this component needs is "whatever `id` a toast
 * carries, `onDismiss` is called with that same value." Defaulting `Id` to
 * `number` keeps every existing `ToastMsg`/`Toaster` reference (no explicit
 * type argument) compiling exactly as before; callers that want string ids
 * simply write `ToastMsg<string>` / infer it from the props they pass in.
 */
export interface ToastMsg<Id extends string | number = number> {
  id: Id
  text: string
  tone: ToastTone
}

const TONE_STYLE: Record<ToastTone, { bg: string; border: string }> = {
  info: { bg: 'rgba(37,99,235,0.14)', border: 'rgba(37,99,235,0.5)' },
  success: { bg: 'rgba(34,197,94,0.16)', border: 'rgba(34,197,94,0.5)' },
  error: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.5)' }
}

/** Fixed bottom-right toast stack. Each toast auto-dismisses; clicking one
 *  dismisses it immediately. Used for import results, collision renames, and
 *  other non-blocking feedback. */
export function Toaster<Id extends string | number = number>({
  toasts,
  onDismiss,
  autoDismissMs = 4500
}: {
  toasts: ToastMsg<Id>[]
  onDismiss: (id: Id) => void
  autoDismissMs?: number
}): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        insetInlineEnd: 16,
        bottom: 16,
        zIndex: 4000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
        pointerEvents: 'none'
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} autoDismissMs={autoDismissMs} />
      ))}
    </div>
  )
}

function ToastItem<Id extends string | number>({
  toast,
  onDismiss,
  autoDismissMs
}: {
  toast: ToastMsg<Id>
  onDismiss: (id: Id) => void
  autoDismissMs: number
}): JSX.Element {
  useEffect(() => {
    const h = setTimeout(() => onDismiss(toast.id), autoDismissMs)
    return () => clearTimeout(h)
  }, [toast.id, onDismiss, autoDismissMs])

  const tone = TONE_STYLE[toast.tone]
  const isError = toast.tone === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      onClick={() => onDismiss(toast.id)}
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1.4,
        padding: '0.6rem 0.8rem',
        borderRadius: 8,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: 'var(--orbitpm-fg)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
        backdropFilter: 'blur(2px)'
      }}
    >
      {toast.text}
    </div>
  )
}

export default Toaster
