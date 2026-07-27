import { useEffect, type ReactNode } from 'react'
import { useResponsiveShellMode, type ResponsiveShellMode } from './responsiveMode'

export interface ResponsiveShellProps {
  children: ReactNode
  direction: 'ltr' | 'rtl'
  header?: ReactNode
  compactHeader?: ReactNode
  footer?: ReactNode
  className?: string
  mode?: ResponsiveShellMode
  onModeChange?: (mode: ResponsiveShellMode) => void
}

export function ResponsiveShell({
  children,
  direction,
  header,
  compactHeader,
  footer,
  className,
  mode: controlledMode,
  onModeChange
}: ResponsiveShellProps): JSX.Element {
  const detectedMode = useResponsiveShellMode()
  const mode = controlledMode ?? detectedMode

  useEffect(() => {
    onModeChange?.(mode)
  }, [mode, onModeChange])

  const shellClassName = ['orbitpm-responsive-shell', className].filter(Boolean).join(' ')
  const activeHeader = mode === 'compact' && compactHeader !== undefined ? compactHeader : header

  return (
    <div className={shellClassName} dir={direction} data-responsive-mode={mode}>
      {activeHeader !== undefined ? (
        <header className="orbitpm-responsive-shell__header">{activeHeader}</header>
      ) : null}
      <div className="orbitpm-responsive-shell__body">{children}</div>
      {footer !== undefined ? (
        <footer className="orbitpm-responsive-shell__footer">{footer}</footer>
      ) : null}
    </div>
  )
}

export default ResponsiveShell
