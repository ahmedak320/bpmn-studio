import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { setLang, t } from '../../i18n'
import { PALETTE } from '../palette'
import { ShapeLegend } from '../ShapeLegend'
import { SHAPE_LEGEND_KINDS, resolveShapeSemantic } from '../shapeSemantics'

afterEach(() => {
  setLang('en')
})

function render(defaultOpen = false): string {
  return renderToStaticMarkup(<ShapeLegend defaultOpen={defaultOpen} />)
}

describe('ShapeLegend', () => {
  it('is closed by default and exposes a labelled disclosure control', () => {
    setLang('en')
    const html = render()

    expect(html).toContain('class="orbitpm-shape-legend"')
    expect(html).toContain('dir="ltr"')
    expect(html).toContain('data-ui-dir="ltr"')
    expect(html).toContain('class="orbitpm-shape-legend__toggle"')
    expect(html).toContain('data-testid="shape-legend-toggle"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/aria-controls="orbitpm-shape-legend-[^"]+"/)
    expect(html).toContain(`title="${t('legend.toggle.title')}"`)
    expect(html).toContain(t('legend.toggle'))
    expect(html).not.toContain('role="region"')
    expect(html).not.toContain('orbitpm-shape-legend__close')
  })

  it('renders the labelled region, close control, every semantic row and palette swatches', () => {
    setLang('en')
    const html = render(true)

    expect(html).toContain('orbitpm-shape-legend--open')
    expect(html).toContain('aria-expanded="true"')
    const panelId = html.match(/aria-controls="([^"]+)"/)?.[1]
    const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(panelId).toMatch(/^orbitpm-shape-legend-/)
    expect(titleId).toBe(`${panelId}-title`)
    expect(html).toContain(`id="${panelId}"`)
    expect(html).toContain('role="region"')
    expect(html).toContain(`id="${titleId}"`)
    expect(html).toContain('data-testid="shape-legend-panel"')
    expect(html).toContain('data-testid="shape-legend-close"')
    expect(html).toContain(`aria-label="${t('legend.close.aria')}"`)

    for (const kind of SHAPE_LEGEND_KINDS) {
      const descriptor = resolveShapeSemantic(kind, 'en')
      expect(html.match(new RegExp(`data-legend-kind="${kind}"`, 'g'))).toHaveLength(2)
      expect(html).toContain(descriptor.label)
      expect(html).toContain(`data-icon="${descriptor.icon}"`)
      expect(html).toContain(`data-swatch-fill="${descriptor.swatch.fill}"`)
      expect(html).toContain(`data-swatch-stroke="${descriptor.swatch.stroke}"`)
      expect(html).toContain(`fill="${PALETTE[descriptor.swatch.fill]}"`)
      expect(html).toContain(`stroke="${PALETTE[descriptor.swatch.stroke]}"`)
    }

    expect(html).toContain('data-icon="start-circle"')
    expect(html).toContain('data-icon="intermediate-circle"')
    expect(html).toContain('data-icon="end-circle"')
    expect(html).toContain('data-icon="exclusive-diamond"')
    expect(html).toContain('data-icon="event-based-diamond"')
    expect(html).toContain('data-icon="rounded-rect"')
    expect(html).toContain('data-icon="annotation"')
    expect(html).toContain('data-icon="data-store"')
    expect(html).toContain('data-icon="chip"')
  })

  it('uses explicit RTL direction and Arabic control and descriptor text', () => {
    setLang('ar')
    const html = render(true)

    expect(html).toContain('dir="rtl"')
    expect(html).toContain('data-ui-dir="rtl"')
    expect(html).toContain(`title="${t('legend.toggle.title')}"`)
    expect(html).toContain(t('legend.title'))
    expect(html).toContain(`aria-label="${t('legend.close.aria')}"`)

    for (const kind of SHAPE_LEGEND_KINDS) {
      expect(html).toContain(resolveShapeSemantic(kind, 'ar').label)
    }

    expect(html).toContain(resolveShapeSemantic('gateway-exclusive', 'ar').explanation)
    expect(html).not.toContain(resolveShapeSemantic('gateway-exclusive', 'en').label)
  })
})
