import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve('src/workspace/HistoryDialog.css'), 'utf8')

function linearChannel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const red = linearChannel(Number.parseInt(value.slice(0, 2), 16))
  const green = linearChannel(Number.parseInt(value.slice(2, 4), 16))
  const blue = linearChannel(Number.parseInt(value.slice(4, 6), 16))
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('history dialog visual safety contract', () => {
  it('keeps the dark truncation token above WCAG AA on every known dark surface', () => {
    const darkWarning = '#ffb86c'
    for (const background of ['#1a1b1e', '#232428', '#2a2b2f']) {
      expect(contrast(darkWarning, background)).toBeGreaterThanOrEqual(4.5)
    }
    expect(stylesheet).toMatch(
      /:root\[data-theme='dark'\] \.history-dialog\s*\{[\s\S]*?--orbitpm-history-warning-fg:\s*#ffb86c;/
    )
    expect(stylesheet).toMatch(
      /\.history-dialog__warning\s*\{[\s\S]*?color:\s*var\(--orbitpm-history-warning-fg\);/
    )
  })

  it('pins header and footer around the only vertical scroller at short viewports', () => {
    expect(stylesheet).toMatch(
      /\.history-dialog\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[\s\S]*?overflow:\s*hidden;/
    )
    expect(stylesheet).toMatch(
      /\.history-dialog__body\s*\{[\s\S]*?min-block-size:\s*0;[\s\S]*?overflow:\s*auto;/
    )
    const shortViewport = stylesheet.slice(stylesheet.indexOf('@media (max-height: 480px)'))
    expect(shortViewport).toMatch(
      /\.history-dialog\s*\{[\s\S]*?max-block-size:\s*calc\(100dvh - 8px\);/
    )
    expect(shortViewport).toMatch(
      /\.history-dialog__header,\s*\.history-dialog__footer\s*\{[\s\S]*?padding:\s*8px 12px;/
    )
  })
})
