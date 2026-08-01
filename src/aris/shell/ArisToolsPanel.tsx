import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'

import { getLang, t, type Lang } from '../../i18n'
import type { ArisCanvas } from '../canvas/ArisCanvas'
import { descriptorPreviewMarkup } from '../canvas/descriptorPreview'
import { DMT_LIBRARY_GROUPS, searchDmtLibrary, type DmtLibraryGroupId } from '../canvas/dmtLibrary'
import type { PaletteTarget } from '../canvas/paletteProvider'
import { dmtLibraryText } from './dmtLibraryI18n'

import './arisToolsPanel.css'

const HAND_PATH =
  'M7 13V8a1.2 1.2 0 0 1 2.4 0v4m0-5a1.2 1.2 0 0 1 2.4 0v5m0-4a1.2 1.2 0 0 1 2.4 0v4m0-2a1.2 1.2 0 0 1 2.2 0v3a5 5 0 0 1-5 5h-2a4 4 0 0 1-3-1.6L7 16'

export interface ArisSymbolTilesProps {
  readonly targets: readonly PaletteTarget[]
  readonly modelType: string
  readonly query: string
  readonly collapsedGroups: ReadonlySet<DmtLibraryGroupId>
  readonly activeActionId: string
  readonly onToggleGroup: (group: DmtLibraryGroupId) => void
  readonly onActivate: (target: PaletteTarget, event: Event) => void
  readonly onEntryFocus: (actionId: string) => void
}

/** Descriptor-backed symbol grid shared by the rail and the change-type picker. */
export function ArisSymbolTiles({
  targets,
  modelType,
  query,
  collapsedGroups,
  activeActionId,
  onToggleGroup,
  onActivate,
  onEntryFocus
}: ArisSymbolTilesProps): JSX.Element {
  const filtering = query.trim().length > 0
  const matchIds = useMemo(
    () => new Set(searchDmtLibrary(query, modelType).map((item) => item.catalogId)),
    [modelType, query]
  )

  return (
    <div className="aris-symbol-tiles">
      {DMT_LIBRARY_GROUPS.map((group) => {
        const groupTargets = targets.filter(
          (target) => target.group === group.id && (!filtering || matchIds.has(target.catalogId))
        )
        if (filtering && groupTargets.length === 0) return null
        if (!filtering && !targets.some((target) => target.group === group.id)) return null
        const collapsed = !filtering && collapsedGroups.has(group.id)
        const name = dmtLibraryText(group.labelKey)
        return (
          <section key={group.id} className="aris-library-group" data-aris-library-group={group.id}>
            <button
              type="button"
              className="aris-library-group__toggle"
              aria-expanded={!collapsed}
              aria-label={dmtLibraryText('aris.library.group.toggle', {
                state: dmtLibraryText(
                  collapsed ? 'aris.library.group.expand' : 'aris.library.group.collapse'
                ),
                name
              })}
              onClick={() => onToggleGroup(group.id)}
            >
              {name}
            </button>
            {!collapsed
              ? groupTargets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    className="aris-palette-entry aris-palette-entry--symbol"
                    data-action={target.id}
                    data-aris-catalog-id={target.catalogId}
                    data-aris-variant-count={target.variantCount}
                    draggable
                    title={dmtLibraryText('aris.library.item.tooltip', {
                      name: target.title
                    })}
                    aria-label={dmtLibraryText('aris.library.item.aria', {
                      name: target.title,
                      variants: target.variantCount
                    })}
                    tabIndex={activeActionId === target.id ? 0 : -1}
                    onFocus={() => onEntryFocus(target.id)}
                    onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation()
                      onActivate(target, event.nativeEvent)
                    }}
                    onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                      event.stopPropagation()
                      onActivate(target, event.nativeEvent)
                    }}
                  >
                    <span
                      className="aris-palette-entry__preview"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{
                        __html: descriptorPreviewMarkup(target.catalogId)
                      }}
                    />
                    <span className="aris-palette-entry__label">{target.title}</span>
                  </button>
                ))
              : null}
          </section>
        )
      })}
    </div>
  )
}

export interface ArisToolsPanelProps {
  readonly canvas: ArisCanvas | null
  readonly modelType: string
  readonly lang?: Lang
}

export function ArisToolsPanel({
  canvas,
  modelType,
  lang = getLang()
}: ArisToolsPanelProps): JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<DmtLibraryGroupId>>(
    () => new Set()
  )
  const [activeActionId, setActiveActionId] = useState('hand-tool')
  const targets = useMemo(() => {
    void modelType
    void lang
    return canvas?.palette.targets() ?? []
  }, [canvas, lang, modelType])
  const hasMatches =
    query.trim().length === 0 ||
    searchDmtLibrary(query, modelType).some((item) =>
      targets.some((target) => target.catalogId === item.catalogId)
    )

  useEffect(() => {
    const root = rootRef.current
    if (!root || root.querySelector(`[data-action="${activeActionId}"]`)) return
    const first = root.querySelector<HTMLButtonElement>('[data-action]')
    if (first) setActiveActionId(first.dataset.action ?? 'hand-tool')
  }, [activeActionId, collapsedGroups, query, targets])

  const toggleGroup = (group: DmtLibraryGroupId): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const onEntryKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement) || target.dataset.action === undefined) return
    const root = rootRef.current
    if (!root) return
    const entries = [...root.querySelectorAll<HTMLButtonElement>('[data-action]')]
    const current = entries.indexOf(target)
    if (current < 0) return
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (current + 1) % entries.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + entries.length) % entries.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = entries.length - 1
    } else if (event.key.length === 1 && /\S/u.test(event.key)) {
      setQuery((currentQuery) => currentQuery + event.key)
      searchRef.current?.focus()
      event.preventDefault()
      return
    }
    if (next === null) return
    const nextEntry = entries[next]
    if (!nextEntry) return
    setActiveActionId(nextEntry.dataset.action ?? 'hand-tool')
    nextEntry.focus()
    event.preventDefault()
  }

  const handLabel = t('aris.palette.hand')
  const lassoLabel = t('aris.palette.lasso')
  const freeTextLabel = t('aris.palette.freeText')

  return (
    <section
      ref={rootRef}
      className="orbitpm-aris-tools"
      data-orbitpm-aris-tools=""
      aria-label={dmtLibraryText('aris.library.aria')}
      onKeyDown={onEntryKeyDown}
    >
      <div
        className="aris-tools-utilities"
        role="group"
        aria-label={dmtLibraryText('aris.library.group.tools')}
      >
        <button
          type="button"
          className="aris-palette-entry"
          data-action="hand-tool"
          title={handLabel}
          aria-label={handLabel}
          tabIndex={activeActionId === 'hand-tool' ? 0 : -1}
          onFocus={() => setActiveActionId('hand-tool')}
          onClick={(event) => canvas?.palette.activateHandTool(event.nativeEvent)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={HAND_PATH} fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="aris-palette-entry__label">{handLabel}</span>
        </button>
        <button
          type="button"
          className="aris-palette-entry"
          data-action="lasso-tool"
          title={lassoLabel}
          aria-label={lassoLabel}
          tabIndex={activeActionId === 'lasso-tool' ? 0 : -1}
          onFocus={() => setActiveActionId('lasso-tool')}
          onClick={(event) => canvas?.palette.activateLassoTool(event.nativeEvent)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect
              x="4"
              y="6"
              width="16"
              height="12"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          </svg>
          <span className="aris-palette-entry__label">{lassoLabel}</span>
        </button>
        <button
          type="button"
          className="aris-palette-entry"
          data-action="create.free-text"
          title={freeTextLabel}
          aria-label={freeTextLabel}
          tabIndex={activeActionId === 'create.free-text' ? 0 : -1}
          onFocus={() => setActiveActionId('create.free-text')}
          onClick={() => canvas?.palette.createFreeText(freeTextLabel)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 7h12M12 7v11" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="aris-palette-entry__label">{freeTextLabel}</span>
        </button>
      </div>

      <div className="aris-library-search">
        <input
          ref={searchRef}
          type="search"
          className="aris-library-search__input"
          value={query}
          placeholder={dmtLibraryText('aris.library.search')}
          aria-label={dmtLibraryText('aris.library.search')}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || query.length === 0) return
            setQuery('')
            event.preventDefault()
          }}
        />
        <span className="aris-library-search__status" role="status" aria-live="polite">
          {query.trim().length > 0 && !hasMatches ? dmtLibraryText('aris.library.noResults') : ''}
        </span>
      </div>

      <ArisSymbolTiles
        targets={targets}
        modelType={modelType}
        query={query}
        collapsedGroups={collapsedGroups}
        activeActionId={activeActionId}
        onToggleGroup={toggleGroup}
        onActivate={(target, event) => canvas?.palette.startPlacement(event, target)}
        onEntryFocus={setActiveActionId}
      />
    </section>
  )
}
