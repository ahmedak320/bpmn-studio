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

  it('follows lexical variable-built copy into operational UI messages', () => {
    const source = `
      const message = 'This outer diagnostic is not rendered.'
      export function BadCopy(error: string, row: { id: string }, hasError: boolean) {
        const unused = 'This internal diagnostic is not rendered.'
        const message = \`Storage committed, but reconciliation failed: \${error}\`
        const evidence = 'History retention failed: ' + error
        const errorId = hasError ? \`\${row.id}-neutral-error\` : undefined
        recordWorkspaceIssue(message)
        recordWorkspaceIssue(evidence)
        void unused
        return <>{errorId && <span />}</>
      }
    `

    expect(
      scanTsxSource('/repo/src/BadCopy.tsx', source, '/repo').map(({ kind, text }) => ({
        kind,
        text
      }))
    ).toEqual([
      {
        kind: 'user-message-call',
        text: 'Storage committed, but reconciliation failed: ${…}'
      },
      { kind: 'user-message-call', text: 'History retention failed:' }
    ])
  })

  it('follows user messages through local wrapper parameters', () => {
    const source = `
      function forward(reason: string) {
        setError(reason)
      }
      const forwardFromCallback = useCallback((reason: string, detail: string) => {
        const message = \`\${reason}: \${detail}\`
        recordWorkspaceIssue(message)
      }, [])
      forward('Direct wrapper copy is visible.')
      forwardFromCallback('Callback wrapper copy is visible.', 'technical-detail')
    `

    expect(
      scanTsxSource('/repo/src/BadCopy.tsx', source, '/repo').map(({ kind, text }) => ({
        kind,
        text
      }))
    ).toEqual([
      { kind: 'user-message-call', text: 'Direct wrapper copy is visible.' },
      { kind: 'user-message-call', text: 'Callback wrapper copy is visible.' },
      { kind: 'user-message-call', text: 'technical-detail' }
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
