import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import { t } from '../../i18n'
import type { ArisCanvas } from '../canvas/ArisCanvas'
import { ArisCanvasCommandError } from '../canvas/commandBridge'
import type { DmtLibraryGroupId } from '../canvas/dmtLibrary'
import { arisBusinessObject } from '../canvas/elements'
import type { PaletteTarget } from '../canvas/paletteProvider'
import type { ArisQuickPick } from '../canvas/quickPick'
import { arisObjectBlockName } from '../conventions/displayNames'
import { ArisSymbolTiles } from './ArisToolsPanel'

export interface ArisCanvasContextMenuProps {
  readonly canvas: ArisCanvas
  readonly elementId: string
  readonly x: number
  readonly y: number
  readonly returnFocus?: HTMLElement | null
  readonly onClose: () => void
  readonly onToast: (message: string, tone?: 'info' | 'error' | 'success') => void
}

/** Portal-hosted occurrence menu and descriptor-backed change-type picker. */
export function ArisCanvasContextMenu({
  canvas,
  elementId,
  x,
  y,
  returnFocus = null,
  onClose,
  onToast
}: ArisCanvasContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const titleId = `orbitpm-aris-change-type-${useId().replaceAll(':', '')}`
  const [pickerOpen, setPickerOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<DmtLibraryGroupId>>(
    () => new Set()
  )
  const businessObject = arisBusinessObject(canvas.elementRegistry.get(elementId))
  const modelType = businessObject?.kind === 'occurrence' ? businessObject.modelType : 'MT_EEPC'
  const targets = useMemo(() => canvas.palette.targets(), [canvas])
  const currentTarget =
    businessObject?.kind === 'occurrence'
      ? targets.find(
          (target) =>
            target.objectType === businessObject.objectType &&
            target.symbolNum === businessObject.symbolNum
        )
      : undefined
  const [activeActionId, setActiveActionId] = useState(currentTarget?.id ?? targets[0]?.id ?? '')
  const quickPick = canvas.get<ArisQuickPick>('arisQuickPick')
  const canSwap = quickPick.membersFor(elementId).length > 1

  const closeAndRestore = (): void => {
    onClose()
    requestAnimationFrame(() => returnFocus?.focus())
  }

  useEffect(() => {
    const close = (): void => onClose()
    // Mounting is triggered by the native contextmenu event itself. Defer the
    // global closers until that opening event has finished bubbling.
    const arm = window.setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
      window.addEventListener('resize', close)
    }, 0)
    return () => {
      window.clearTimeout(arm)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  useEffect(() => {
    if (!pickerOpen) {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
      return
    }
    const picker = pickerRef.current
    if (!picker) return
    for (const target of targets) {
      const button = picker.querySelector<HTMLButtonElement>(
        `[data-aris-catalog-id="${target.catalogId}"]`
      )
      if (!button) continue
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(target.id === currentTarget?.id))
    }
    picker.querySelector<HTMLButtonElement>('[data-aris-catalog-id][aria-checked="true"]')?.focus()
  }, [collapsedGroups, currentTarget?.id, pickerOpen, targets])

  if (businessObject?.kind !== 'occurrence') return null

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    ]
    const index = items.indexOf(target)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      closeAndRestore()
      return
    }
    if (next === null) return
    event.preventDefault()
    items[next]?.focus()
  }

  const onPickerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndRestore()
      return
    }
    const target = event.target
    if (!(target instanceof HTMLButtonElement) || !target.hasAttribute('data-aris-catalog-id')) {
      return
    }
    const items = [
      ...(pickerRef.current?.querySelectorAll<HTMLButtonElement>('[data-aris-catalog-id]') ?? [])
    ]
    const index = items.indexOf(target)
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % items.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + items.length) % items.length
    } else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next === null) return
    event.preventDefault()
    const nextItem = items[next]
    if (!nextItem) return
    setActiveActionId(nextItem.dataset.action ?? '')
    nextItem.focus()
  }

  const chooseTarget = (target: PaletteTarget, event: Event): void => {
    if (event.type === 'dragstart') return
    try {
      canvas.authoring.changeObjectType(elementId, {
        objectType: target.objectType,
        symbolNum: target.symbolNum,
        catalogId: target.catalogId
      })
      canvas.palette.rememberCatalogPresentation(elementId, target.catalogId)
      closeAndRestore()
    } catch (error) {
      if (!(error instanceof ArisCanvasCommandError)) throw error
      onToast(
        t('aris.changeType.failed', {
          error: error.message
        }),
        'error'
      )
    }
  }

  const toggleGroup = (group: DmtLibraryGroupId): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('aris.contextMenu.aria')}
      aria-orientation="vertical"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 2000,
        minWidth: 190,
        padding: 4,
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 6,
        background: 'var(--orbitpm-panel-bg)',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.25)'
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onMenuKeyDown}
    >
      <MenuButton label={t('aris.contextMenu.changeType')} onClick={() => setPickerOpen(true)} />
      {canSwap && (
        <MenuButton
          label={t('aris.contextPad.swapSymbol')}
          onClick={() => {
            quickPick.open(elementId, true)
            onClose()
          }}
        />
      )}
      <MenuButton
        label={t('aris.contextPad.delete')}
        onClick={() => {
          const element = canvas.elementRegistry.get(elementId)
          if (element) canvas.modeling.removeElements([element])
          onClose()
        }}
      />
    </div>
  )

  const picker = (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(0, 0, 0, 0.35)'
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAndRestore()
      }}
    >
      <div
        ref={pickerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          width: 'min(760px, calc(100vw - 48px))',
          maxHeight: 'min(720px, calc(100vh - 48px))',
          overflow: 'auto',
          padding: 16,
          border: '1px solid var(--orbitpm-border)',
          borderRadius: 8,
          background: 'var(--orbitpm-panel-bg)',
          boxShadow: '0 12px 44px rgba(0, 0, 0, 0.35)'
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onPickerKeyDown}
      >
        <h2 id={titleId} style={{ margin: '0 0 6px', fontSize: 18 }}>
          {t('aris.changeType.title')}
        </h2>
        <p style={{ margin: '0 0 4px', color: 'var(--orbitpm-muted)' }}>
          {t('aris.changeType.current', {
            name: arisObjectBlockName({
              objectType: businessObject.objectType,
              symbolNum: businessObject.symbolNum,
              catalogId: businessObject.catalogId
            })
          })}
        </p>
        <p style={{ margin: '0 0 12px', color: 'var(--orbitpm-muted)', fontSize: 12 }}>
          {t('aris.changeType.keepData')}
        </p>
        <div role="radiogroup" aria-labelledby={titleId}>
          <ArisSymbolTiles
            targets={targets}
            modelType={modelType}
            query=""
            collapsedGroups={collapsedGroups}
            activeActionId={activeActionId}
            onToggleGroup={toggleGroup}
            onActivate={chooseTarget}
            onEntryFocus={setActiveActionId}
          />
        </div>
      </div>
    </div>
  )

  return createPortal(pickerOpen ? picker : menu, document.body)
}

function MenuButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        minHeight: 32,
        padding: '6px 10px',
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: 'inherit',
        textAlign: 'start',
        cursor: 'pointer',
        fontSize: 13
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = 'var(--orbitpm-hover)'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent'
      }}
    >
      {label}
    </button>
  )
}
