import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { TextInputModal } from './TextInputModal'

export interface PromptOptions {
  title: string
  label: string
  /** Suggested value, pre-filled and selected on open. */
  initialValue?: string
  okLabel?: string
  cancelLabel?: string
  hint?: string
  placeholder?: string
}

/** Imperative prompt API: resolves with the entered string, or null if the
 * user cancelled (Cancel / Escape / overlay-click). */
export type PromptText = (options: PromptOptions) => Promise<string | null>

const PromptContext = createContext<PromptText | null>(null)

/**
 * Mounts a single {@link TextInputModal} and exposes the imperative
 * `promptText(opts): Promise<string|null>` via {@link usePromptText}, so call
 * sites stay one-liners:
 *
 *   const name = await promptText({ title: 'New Folder', label: 'Folder name' })
 *   if (name) create(name)
 *
 * Replaces `window.prompt`, which Electron does not support.
 */
export function PromptProvider({ children }: { children: ReactNode }): JSX.Element {
  const [options, setOptions] = useState<PromptOptions | null>(null)
  const [value, setValue] = useState('')
  // The pending promise's resolver lives in a ref (not state) so confirming /
  // cancelling never depends on a stale render and never fires inside a React
  // state updater (which StrictMode double-invokes).
  const resolverRef = useRef<((result: string | null) => void) | null>(null)

  const promptText = useCallback<PromptText>((opts) => {
    return new Promise<string | null>((resolve) => {
      // Defensively settle any prompt that was somehow still open.
      resolverRef.current?.(null)
      resolverRef.current = resolve
      setValue(opts.initialValue ?? '')
      setOptions(opts)
    })
  }, [])

  const close = useCallback((result: string | null) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setOptions(null)
    resolve?.(result)
  }, [])

  return (
    <PromptContext.Provider value={promptText}>
      {children}
      <TextInputModal
        open={options !== null}
        title={options?.title ?? ''}
        label={options?.label ?? ''}
        value={value}
        onChange={setValue}
        okLabel={options?.okLabel}
        cancelLabel={options?.cancelLabel}
        hint={options?.hint}
        placeholder={options?.placeholder}
        onOk={() => close(value.trim())}
        onCancel={() => close(null)}
      />
    </PromptContext.Provider>
  )
}

/** Access the imperative prompt API. Throws if no {@link PromptProvider} is mounted. */
export function usePromptText(): PromptText {
  const ctx = useContext(PromptContext)
  if (!ctx) throw new Error('usePromptText must be used within a <PromptProvider>')
  return ctx
}
