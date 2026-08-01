/**
 * The validation section of the rail (plan §14.1, issue 5).
 *
 * Findings are structured data, never prose: `src/aris/epc` and the gap scanner
 * emit an i18n `messageKey` plus params, unified by `arisValidationFindings`,
 * and this component is the only place that resolves them. Activating a finding
 * asks the canvas to reveal the offending element (or, for a model-scoped rule,
 * the offending model) and — when the finding names a fixable field — opens the
 * details rail on that field.
 *
 * The file keeps the `ArisEpcRail` name and the `data-orbitpm-aris-epc` root so
 * the EPC-rail characterization tests keep passing; the section now also carries
 * the canonical `data-orbitpm-aris-validation` marker and the missing-info gap
 * rows.
 */

import { useMemo, useState } from 'react'

import { t, type Key } from '../../i18n'
import { arisObjectTypeName } from '../conventions/displayNames'
import type { ArisValidationFinding } from './arisValidationFindings'
import { tk } from './shellI18n'

const PAGE_SIZE = 50

/**
 * EPC findings are structured data, never prose (`messageKey` + `messageParams`),
 * so `src/aris/epc` stays UI-pure and emits a raw ARIS type code where a finding
 * names an object type (e.g. `epc.alternation`'s `{objectType}`, `validate.ts:72`).
 * This is the one place that resolves it to a friendly name before interpolation
 * — the same policy every other tooltip/details-pane consumer of
 * `displayNames.ts` follows (user issue 10).
 */
function resolvedMessageParams(
  finding: ArisValidationFinding
): Readonly<Record<string, string>> | undefined {
  const params = finding.messageParams
  if (!params || typeof params.objectType !== 'string') return params
  return { ...params, objectType: arisObjectTypeName({ objectType: params.objectType }) }
}

export interface ArisEpcRailProps {
  readonly findings: readonly ArisValidationFinding[]
  /**
   * Reveal one finding's element (and open the details rail on its field, when
   * it has one). Returns `false` when the element is not on a renderable model,
   * so the rail can say so instead of appearing inert.
   */
  readonly onSelectFinding: (finding: ArisValidationFinding) => boolean
}

export function ArisEpcRail({ findings, onSelectFinding }: ArisEpcRailProps): JSX.Element {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [notice, setNotice] = useState<string | null>(null)

  const counts = useMemo(() => {
    let errors = 0
    let warnings = 0
    for (const finding of findings) {
      if (finding.severity === 'error') errors += 1
      else warnings += 1
    }
    return { errors, warnings }
  }, [findings])
  const shown = findings.slice(0, limit)

  return (
    <section
      className="orbitpm-aris-rail__section"
      data-orbitpm-aris-epc=""
      data-orbitpm-aris-validation=""
    >
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
            {shown.map((finding) => (
              <li key={finding.key} style={{ marginBottom: 6 }}>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  data-orbitpm-aris-validation-issue={finding.kind}
                  data-orbitpm-aris-epc-finding={finding.ruleId ?? undefined}
                  style={{
                    width: '100%',
                    textAlign: 'start',
                    display: 'grid',
                    gap: 2,
                    justifyItems: 'start'
                  }}
                  aria-label={tk('aris.epc.findingAria', 'Select {id} on the canvas', {
                    id: finding.anchorElementId ?? finding.fallbackModelId ?? finding.key
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
                    {t(finding.messageKey as Key, resolvedMessageParams(finding))}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>
                    {finding.severity === 'error'
                      ? tk('aris.epc.severity.error', 'Error')
                      : tk('aris.epc.severity.warning', 'Warning')}
                    {' · '}
                    {finding.ruleId ?? finding.kind}
                  </span>
                </button>
              </li>
            ))}
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
