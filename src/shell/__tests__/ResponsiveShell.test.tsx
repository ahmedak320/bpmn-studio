// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponsiveShell } from '../ResponsiveShell'

const stylesheet = readFileSync(resolve('src/shell/responsiveShell.css'), 'utf8')

afterEach(cleanup)

describe('ResponsiveShell', () => {
  it('exposes direction and mode while selecting the compact header', () => {
    const onModeChange = vi.fn()
    const { container, rerender } = render(
      <ResponsiveShell
        direction="rtl"
        mode="compact"
        header={<span>wide header</span>}
        compactHeader={<span>compact header</span>}
        footer={<span>footer</span>}
        onModeChange={onModeChange}
      >
        <main>content</main>
      </ResponsiveShell>
    )
    const shell = container.querySelector('.orbitpm-responsive-shell')
    expect(shell?.getAttribute('dir')).toBe('rtl')
    expect(shell?.getAttribute('data-responsive-mode')).toBe('compact')
    expect(screen.getByText('compact header')).not.toBeNull()
    expect(screen.queryByText('wide header')).toBeNull()
    expect(screen.getByText('footer')).not.toBeNull()
    expect(onModeChange).toHaveBeenLastCalledWith('compact')

    rerender(
      <ResponsiveShell
        direction="ltr"
        mode="docked"
        header={<span>wide header</span>}
        compactHeader={<span>compact header</span>}
      >
        <main>content</main>
      </ResponsiveShell>
    )
    expect(screen.getByText('wide header')).not.toBeNull()
    expect(screen.queryByText('compact header')).toBeNull()
  })
})

describe('responsive shell stylesheet contract', () => {
  it('declares 100vh immediately before the dynamic viewport fallback', () => {
    const fallback = stylesheet.indexOf('block-size: 100vh;')
    const dynamic = stylesheet.indexOf('block-size: 100dvh;', fallback)
    expect(fallback).toBeGreaterThan(-1)
    expect(dynamic).toBeGreaterThan(fallback)
  })

  it('pins the three required breakpoint ranges', () => {
    expect(stylesheet).toContain('@media (min-width: 1200px)')
    expect(stylesheet).toContain('@media (min-width: 768px) and (max-width: 1199px)')
    expect(stylesheet).toContain('@media (max-width: 767px)')
    expect(stylesheet).toContain("data-responsive-mode='docked'")
    expect(stylesheet).toContain("data-responsive-mode='overlay'")
    expect(stylesheet).toContain("data-responsive-mode='compact'")
  })

  it('uses logical inline geometry and clips chrome overflow', () => {
    expect(stylesheet).toContain('inset-inline-start: 0')
    expect(stylesheet).toContain('inset-inline-end: 0')
    expect(stylesheet).toContain('border-inline-start:')
    expect(stylesheet).toContain('border-inline-end:')
    expect(stylesheet).toContain('min-inline-size: 0')
    expect(stylesheet).toContain('max-inline-size: 100%')
    expect(stylesheet).toMatch(/orbitpm-responsive-shell[\s\S]*?overflow: hidden;/)
    expect(stylesheet).not.toMatch(/^\s*(?:left|right|width|height)\s*:/m)
  })

  it('keeps the rail touch target and resizer pointer target generous', () => {
    expect(stylesheet).toMatch(
      /\.orbitpm-details-rail__toggle\s*\{[\s\S]*?min-inline-size: 32px;[\s\S]*?min-block-size: 44px;/
    )
    expect(stylesheet).toMatch(
      /\.orbitpm-details-resizer\s*\{[\s\S]*?inline-size: 16px;[\s\S]*?min-inline-size: 16px;/
    )
    expect(stylesheet).toContain(".orbitpm-details-rail[dir='rtl'] .orbitpm-details-rail__glyph")
    expect(stylesheet).toContain('transform: scaleX(-1)')
    expect(stylesheet).toMatch(
      /\.orbitpm-responsive-shell \.orbitpm-lite-rail\s*\{[\s\S]*?inline-size: 32px;[\s\S]*?min-inline-size: 32px;[\s\S]*?min-block-size: 44px;/
    )
  })

  it('defines the wired workspace shell, skip link, and compact action/search layout', () => {
    expect(stylesheet).toMatch(
      /\.orbitpm-responsive-shell\.orbitpm-workspace-shell > \.orbitpm-responsive-shell__body\s*\{[\s\S]*?display: contents;/
    )
    expect(stylesheet).toContain('.orbitpm-workspace-header__actions')
    expect(stylesheet).toContain('.orbitpm-workspace-header__search')
    expect(stylesheet).toContain('.orbitpm-workspace-explorer__content')
    expect(stylesheet).toContain('.orbitpm-skip-link:focus')
    expect(stylesheet).toMatch(
      /data-responsive-mode='compact'[\s\S]*?\.orbitpm-workspace-header__search\s*\{[\s\S]*?order: 3;[\s\S]*?flex: 1 0 100%;/
    )
  })

  it('moves docked search onto its own row before desktop chrome can overlap navigation', () => {
    expect(stylesheet).toMatch(
      /@media \(min-width: 1200px\) and \(max-width: 1599px\)[\s\S]*?data-responsive-mode='docked'[\s\S]*?\.orbitpm-workspace-header\s*\{[\s\S]*?flex-wrap: wrap;/
    )
    expect(stylesheet).toMatch(
      /@media \(min-width: 1200px\) and \(max-width: 1599px\)[\s\S]*?data-responsive-mode='docked'[\s\S]*?\.orbitpm-workspace-header__search\s*\{[\s\S]*?order: 3;[\s\S]*?flex: 1 0 100%;[\s\S]*?min-inline-size: 0;/
    )
  })

  it('disables drawer animation when reduced motion is requested', () => {
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none;/)
  })
})
