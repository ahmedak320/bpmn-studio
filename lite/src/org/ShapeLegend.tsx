import { useId, useRef, useState } from 'react'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import { PALETTE, type PaletteKey } from './palette'
import {
  SHAPE_LEGEND_KINDS,
  resolveShapeSemantic,
  type ShapeSemanticKind
} from './shapeSemantics'

export interface ShapeLegendProps {
  /** Optional initial disclosure state; omitted keeps the overlay closed. */
  defaultOpen?: boolean
}

type LegendIconKind = ReturnType<typeof resolveShapeSemantic>['icon']

interface LegendIconProps {
  kind: ShapeSemanticKind
  icon: LegendIconKind
  fill: PaletteKey
  stroke: PaletteKey
}

function IconShape({
  icon,
  fill,
  stroke
}: Pick<LegendIconProps, 'icon' | 'fill' | 'stroke'>): JSX.Element {
  const fillColor = PALETTE[fill]
  const strokeColor = PALETTE[stroke]
  const common = {
    fill: fillColor,
    stroke: strokeColor,
    strokeWidth: 1.8,
    strokeLinejoin: 'round' as const
  }

  if (icon === 'start-circle') {
    return <circle cx="12" cy="12" r="8" {...common} />
  }

  if (icon === 'intermediate-circle') {
    return (
      <g>
        <circle cx="12" cy="12" r="8.5" {...common} />
        <circle cx="12" cy="12" r="6.2" fill="none" stroke={strokeColor} strokeWidth="1.2" />
      </g>
    )
  }

  if (icon === 'end-circle') {
    return <circle cx="12" cy="12" r="8" {...common} strokeWidth="3.2" />
  }

  if (icon.endsWith('-diamond')) {
    const marker =
      icon === 'exclusive-diamond' ? (
        <path d="M 8 8 L 16 16 M 16 8 L 8 16" fill="none" stroke={strokeColor} strokeWidth="2" />
      ) : icon === 'inclusive-diamond' ? (
        <circle cx="12" cy="12" r="4.5" fill="none" stroke={strokeColor} strokeWidth="1.8" />
      ) : icon === 'parallel-diamond' ? (
        <path d="M 12 7 L 12 17 M 7 12 L 17 12" fill="none" stroke={strokeColor} strokeWidth="2" />
      ) : icon === 'event-based-diamond' ? (
        <g fill="none" stroke={strokeColor}>
          <circle cx="12" cy="12" r="4.7" strokeWidth="1.2" />
          <path d="M 12 8 L 15.8 10.8 L 14.4 15.2 L 9.6 15.2 L 8.2 10.8 Z" strokeWidth="1.1" />
        </g>
      ) : (
        <path
          d="M 12 7 L 12 17 M 7.7 9.5 L 16.3 14.5 M 16.3 9.5 L 7.7 14.5"
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.6"
        />
      )
    return (
      <g>
        <path d="M 12 2.7 L 21.3 12 L 12 21.3 L 2.7 12 Z" {...common} />
        {marker}
      </g>
    )
  }

  if (icon === 'chip') {
    return <rect x="3" y="7" width="18" height="10" rx="5" {...common} />
  }

  if (icon === 'double-rounded-rect') {
    return (
      <g>
        <rect x="2.5" y="3.5" width="19" height="17" rx="3.5" {...common} />
        <rect x="4.2" y="5.2" width="15.6" height="13.6" rx="2.5" fill="none" stroke={strokeColor} strokeWidth="1" />
        <path d="M 9 16 L 15 16 M 12 13 L 12 19" fill="none" stroke={strokeColor} strokeWidth="1.3" />
      </g>
    )
  }

  if (icon === 'participant' || icon === 'lane') {
    return (
      <g>
        <rect x="1.5" y="4" width="21" height="16" rx={icon === 'participant' ? 1.5 : 0} {...common} />
        <path
          d={icon === 'participant' ? 'M 6 4 L 6 20' : 'M 1.5 9 L 22.5 9'}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.2"
        />
      </g>
    )
  }

  if (icon === 'annotation') {
    return (
      <g>
        <rect x="2" y="3" width="20" height="18" rx="1" fill={fillColor} stroke="none" />
        <path d="M 6 4 L 3 4 L 3 20 L 6 20" fill="none" stroke={strokeColor} strokeWidth="2" />
        <path d="M 7 8 L 20 8 M 7 12 L 18 12 M 7 16 L 15 16" fill="none" stroke={strokeColor} strokeWidth="1.2" />
      </g>
    )
  }

  if (icon === 'data-object') {
    return (
      <g>
        <path d="M 6 2.5 L 15 2.5 L 20 7.5 L 20 21.5 L 6 21.5 Z" {...common} />
        <path d="M 15 2.5 L 15 7.5 L 20 7.5" fill="none" stroke={strokeColor} strokeWidth="1.3" />
      </g>
    )
  }

  if (icon === 'data-store') {
    return (
      <g>
        <path d="M 4 6 C 4 2.5 20 2.5 20 6 L 20 18 C 20 21.5 4 21.5 4 18 Z" {...common} />
        <path d="M 4 6 C 4 9.5 20 9.5 20 6 M 4 10 C 4 13.5 20 13.5 20 10" fill="none" stroke={strokeColor} strokeWidth="1.1" />
      </g>
    )
  }

  return <rect x="2.5" y="4" width="19" height="16" rx="4" {...common} />
}

function LegendIcon({ kind, icon, fill, stroke }: LegendIconProps): JSX.Element {
  return (
    <span
      className={`orbitpm-shape-legend__icon orbitpm-shape-legend__icon--${icon}`}
      data-legend-kind={kind}
      data-icon={icon}
      data-swatch-fill={fill}
      data-swatch-stroke={stroke}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        focusable="false"
        aria-hidden="true"
      >
        <IconShape icon={icon} fill={fill} stroke={stroke} />
      </svg>
    </span>
  )
}

/**
 * Canvas shape/decorations key. It is deliberately independent of the BPMN
 * canvas DOM, so it remains available while the canvas is panned or zoomed.
 */
export function ShapeLegend({ defaultOpen = false }: ShapeLegendProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const instanceId = useId().replaceAll(':', '')
  const panelId = `orbitpm-shape-legend-${instanceId}`
  const titleId = `${panelId}-title`
  const lang = useLang()
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div
      className={`orbitpm-shape-legend${open ? ' orbitpm-shape-legend--open' : ''}`}
      dir={dir}
      data-ui-dir={dir}
    >
      <button
        ref={toggleRef}
        type="button"
        className="orbitpm-shape-legend__toggle"
        data-testid="shape-legend-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        title={t('legend.toggle.title')}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">◇</span>
        <span>{t('legend.toggle')}</span>
      </button>

      {open ? (
        <section
          id={panelId}
          className="orbitpm-shape-legend__panel"
          data-testid="shape-legend-panel"
          role="region"
          aria-labelledby={titleId}
          dir={dir}
        >
          <header className="orbitpm-shape-legend__header">
            <h2 id={titleId} className="orbitpm-shape-legend__title">
              {t('legend.title')}
            </h2>
            <button
              type="button"
              className="orbitpm-shape-legend__close"
              data-testid="shape-legend-close"
              aria-label={t('legend.close.aria')}
              title={t('legend.close.aria')}
              onClick={() => {
                setOpen(false)
                toggleRef.current?.focus()
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <ul className="orbitpm-shape-legend__items">
            {SHAPE_LEGEND_KINDS.map((kind) => {
              const descriptor = resolveShapeSemantic(kind, lang)
              return (
                <li
                  key={kind}
                  className="orbitpm-shape-legend__item"
                  data-legend-kind={kind}
                >
                  <LegendIcon
                    kind={kind}
                    icon={descriptor.icon}
                    fill={descriptor.swatch.fill}
                    stroke={descriptor.swatch.stroke}
                  />
                  <span className="orbitpm-shape-legend__copy">
                    <strong className="orbitpm-shape-legend__label">{descriptor.label}</strong>
                    <span className="orbitpm-shape-legend__explanation">
                      {descriptor.explanation}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default ShapeLegend
