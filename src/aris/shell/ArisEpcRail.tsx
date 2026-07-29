/**
 * The EPC validation section of the rail (plan §14.1).
 *
 * Findings are structured data, never prose: `src/aris/epc` emits an i18n
 * `messageKey` plus params, and this component is the only place that resolves
 * them. Activating a finding asks the canvas to reveal the offending occurrence
 * (or, for a connection-scoped rule, the offending connection).
 */

import { useMemo, useState } from 'react'

import { t, type Key } from '../../i18n'
import {
  arisEpcFindingTargetId,
  countArisEpcFindings,
  type ArisEpcModelFinding
} from './arisEpcFindings'
import { tk } from './shellI18n'

const PAGE_SIZE = 50

export interface ArisEpcRailProps {
  readonly findings: readonly ArisEpcModelFinding[]
  /**
   * Reveal one finding's element. Returns `false` when the element is not on a
   * renderable model, so the rail can say so instead of appearing inert.
   */
  readonly onSelectFinding: (finding: ArisEpcModelFinding) => boolean
}

export function ArisEpcRail({ findings, onSelectFinding }: ArisEpcRailProps): JSX.Element {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [notice, setNotice] = useState<string | null>(null)

  const counts = useMemo(() => countArisEpcFindings(findings), [findings])
  const shown = findings.slice(0, limit)

  return (
    <section className="orbitpm-aris-rail__section" data-orbitpm-aris-epc="">
      <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
        {tk('aris.rail.epc', 'EPC validation')}
      </h3>

      {findings.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }} data-orbitpm-aris-epc-clean="">
          {tk('aris.epc.none', 'No EPC rule violations were found in this source.')}
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            {tk('aris.epc.summary', '{errors} errors · {warnings} warnings', {
              errors: counts.errors,
              warnings: counts.warnings
            })}
          </p>
          <ul
            style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflow: 'auto' }}
          >
            {shown.map((finding, index) => {
              const targetId = arisEpcFindingTargetId(finding)
              return (
                <li
                  key={`${finding.modelId}:${finding.ruleId}:${targetId ?? index}`}
                  style={{ marginBottom: 6 }}
                >
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    data-orbitpm-aris-epc-finding={finding.ruleId}
                    style={{
                      width: '100%',
                      textAlign: 'start',
                      display: 'grid',
                      gap: 2,
                      justifyItems: 'start'
                    }}
                    aria-label={tk('aris.epc.findingAria', 'Select {id} on the canvas', {
                      id: targetId ?? finding.modelId
                    })}
                    onClick={() => {
                      const revealed = onSelectFinding(finding)
                      setNotice(
                        revealed
                          ? null
                          : tk(
                              'aris.epc.notOnCanvas',
                              'That finding has no element on a renderable model.'
                            )
                      )
                    }}
                  >
                    <span style={{ fontSize: 12.5, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                      {t(finding.messageKey as Key, finding.messageParams)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>
                      {finding.severity === 'error'
                        ? tk('aris.epc.severity.error', 'Error')
                        : tk('aris.epc.severity.warning', 'Warning')}
                      {' · '}
                      {finding.ruleId}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {findings.length > shown.length && (
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              style={{ marginTop: 4 }}
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              {tk('aris.epc.showMore', 'Show more findings')}
            </button>
          )}
          {notice && (
            <p role="status" style={{ margin: '8px 0 0', fontSize: 12 }}>
              {notice}
            </p>
          )}
        </>
      )}
    </section>
  )
}
