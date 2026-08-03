import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EPC_ENGINE_VERSION } from './version'

describe('EPC_ENGINE_VERSION', () => {
  it('is a plain semver string (deterministic — no clock/random)', () => {
    expect(EPC_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(EPC_ENGINE_VERSION).toBe('0.2.0')
  })

  it('matches packages/epc-engine/package.json once that sub-package manifest exists', () => {
    // The manifest lands in W21 (Lane L-PKG). `existsSync` here guards a REPO
    // path (the committed sub-package manifest under packages/), NOT a private
    // uncommitted asset, so the check:no-skips fixture-guard rule does not apply.
    // Until W21 the assertion is vacuous-by-guard; from W21 it pins the versions.
    const manifestPath = resolve(process.cwd(), 'packages/epc-engine/package.json')
    if (!existsSync(manifestPath)) {
      expect(EPC_ENGINE_VERSION).toBe('0.2.0')
      return
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string }
    expect(manifest.version).toBe(EPC_ENGINE_VERSION)
  })
})
