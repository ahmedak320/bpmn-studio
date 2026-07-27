import { beforeAll, describe, expect, it } from 'vitest'
import {
  HARDCODED_UI_COPY_ALLOWLIST,
  auditHardcodedUiCopy,
  formatHardcodedUiCopyFinding,
  scanTsxSource,
  type HardcodedUiCopyAudit
} from '../../scripts/check-hardcoded-ui-copy'

describe('hard-coded user-facing English gate', () => {
  let productionAudit: HardcodedUiCopyAudit

  beforeAll(() => {
    productionAudit = auditHardcodedUiCopy()
  }, 15_000)

  it('rejects visible JSX, accessibility copy, and user-message calls', () => {
    const source = `
      export function BadCopy() {
        const setError = (_value: string) => undefined
        setError('Could not save this process.')
        return (
          <section aria-label="Process tools">
            <button title="Create process">Create process</button>
            {true ? 'No matches found.' : null}
          </section>
        )
      }
    `
    expect(
      scanTsxSource('/repo/src/BadCopy.tsx', source, '/repo').map(({ kind, text }) => ({
        kind,
        text
      }))
    ).toEqual([
      { kind: 'user-message-call', text: 'Could not save this process.' },
      { kind: 'attribute', text: 'Process tools' },
      { kind: 'attribute', text: 'Create process' },
      { kind: 'jsx-text', text: 'Create process' },
      { kind: 'jsx-expression', text: 'No matches found.' }
    ])
  })

  it('keeps production components free of unreviewed hard-coded English', () => {
    expect(productionAudit.violations.map(formatHardcodedUiCopyFinding)).toEqual([])
  })

  it('requires every exact allowlist entry to remain present and justified', () => {
    expect(productionAudit.staleAllowlist).toEqual([])
    expect(
      HARDCODED_UI_COPY_ALLOWLIST.every(
        (entry) => entry.signature.length > 0 && entry.reason.length >= 20
      )
    ).toBe(true)
  })
})
