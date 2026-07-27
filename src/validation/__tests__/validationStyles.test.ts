import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve('src/validation/validation.css'), 'utf8')
const mobileStyles = stylesheet.slice(stylesheet.indexOf('@media (max-width: 680px)'))

describe('validation stylesheet mobile contract', () => {
  it('keeps source content as the scroll owner between non-shrinking chrome', () => {
    expect(stylesheet).toMatch(
      /\.orbitpm-source-editor__body\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-block-size: 0;[\s\S]*?overflow: auto;/
    )
    expect(stylesheet).toMatch(/\.orbitpm-validation__header\s*\{[\s\S]*?flex: 0 0 auto;/)
    expect(stylesheet).toMatch(/\.orbitpm-validation__footer\s*\{[\s\S]*?flex: 0 0 auto;/)
    expect(stylesheet).not.toMatch(
      /\.orbitpm-source-diff__hunks\s*\{[^}]*max-(?:block-size|height):/
    )
    expect(stylesheet).toMatch(
      /\.orbitpm-source-diff__hunks\s*\{[\s\S]*?max-inline-size: 100%;[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/
    )
  })

  it('gives standalone generated-layout review a shrinking middle scroll region', () => {
    expect(stylesheet).toMatch(
      /\.orbitpm-source-editor__layout-preview\.orbitpm-single-file-layout-review__body\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-block-size: 0;[\s\S]*?max-inline-size: 100%;[\s\S]*?overflow: auto;/
    )
  })

  it('uses the dynamic viewport after its legacy fallback and caps the block size', () => {
    expect(mobileStyles).toMatch(
      /\.orbitpm-validation,\s*\.orbitpm-source-editor\s*\{[\s\S]*?height: 100vh;\s*height: 100dvh;[\s\S]*?max-block-size: 100vh;\s*max-block-size: 100dvh;/
    )
  })

  it('keeps footer actions above the device safe area', () => {
    expect(mobileStyles).toMatch(
      /\.orbitpm-validation__footer\s*\{[\s\S]*?padding-block-end: calc\(0\.75rem \+ env\(safe-area-inset-bottom, 0px\)\);/
    )
  })

  it('compacts fixed dialog chrome for a 400%-zoom short-height viewport', () => {
    expect(stylesheet).toMatch(
      /@media \(max-height: 360px\)\s*\{[\s\S]*?\.orbitpm-validation__header\s*\{[\s\S]*?padding: 0\.35rem 0\.5rem;[\s\S]*?\.orbitpm-validation__footer\s*\{[\s\S]*?padding: 0\.35rem 0\.5rem;/
    )
  })
})
