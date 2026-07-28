/**
 * The accounting / fidelity rail — plan §10.3 and §12.3.
 *
 * `src/aris/accounting` produces a complete, deterministic report: one row per
 * source construct, each carrying `sourceId`, `targetIds` and `modelId`. The
 * accounting lane's own test calls that "enough identity in each row for the UI
 * to select the element", and this component is the consumer of that seam:
 * activating a row asks the canvas to switch to the row's model and select the
 * element the row accounts for.
 *
 * A real AnimalWF export produces ~68 000 rows, so rows are filtered and paged
 * rather than all mounted — the counts above the table always describe the
 * whole report, never the page.
 */

import { useMemo, useState } from 'react'

import { t } from '../../i18n'
import type { Key } from '../../i18n'
import type { ArisAccountingReport, ArisAccountingReportRow } from '../accounting/types'
import type { ArisRenderFidelityFinding, ArisRenderFidelityKind } from '../renderer/types'
import { tk } from './shellI18n'

const PAGE_SIZE = 100

export interface ArisAccountingRailProps {
  readonly report: ArisAccountingReport
  readonly fidelity: readonly ArisRenderFidelityFinding[]
  readonly fidelityByKind: Readonly<Record<ArisRenderFidelityKind, number>>
  /**
   * Ask the canvas to reveal one accounted record. Returns `false` when the
   * record has no element on any renderable model.
   */
  readonly onSelectRecord: (row: ArisAccountingReportRow) => boolean
}

function matches(row: ArisAccountingReportRow, needle: string): boolean {
  if (needle === '') return true
  return (
    row.sourcePath.toLowerCase().includes(needle) ||
    (row.sourceId ?? '').toLowerCase().includes(needle) ||
    row.kind.toLowerCase().includes(needle) ||
    row.disposition.toLowerCase().includes(needle)
  )
}

export function ArisAccountingRail({
  report,
  fidelity,
  fidelityByKind,
  onSelectRecord
}: ArisAccountingRailProps): JSX.Element {
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [notice, setNotice] = useState<string | null>(null)

  const needle = filter.trim().toLowerCase()
  const matched = useMemo(
    () => report.entries.filter((row) => matches(row, needle)),
    [needle, report.entries]
  )
  const shown = matched.slice(0, limit)

  const fidelityKinds = useMemo(
    () =>
      (Object.entries(fidelityByKind) as [ArisRenderFidelityKind, number][]).filter(
        ([, count]) => count > 0
      ),
    [fidelityByKind]
  )
  const firstFindingByKind = useMemo(() => {
    const map = new Map<ArisRenderFidelityKind, ArisRenderFidelityFinding>()
    for (const finding of fidelity) {
      if (!map.has(finding.kind)) map.set(finding.kind, finding)
    }
    return map
  }, [fidelity])

  return (
    <>
      <section className="orbitpm-aris-rail__section" data-orbitpm-aris-accounting="">
        <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
          {tk('aris.rail.accounting', 'Accounting')}
        </h3>
        <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.5 }}>
          {tk(
            'aris.accounting.summary',
            '{accounted} of {total} source records accounted for; {unaccounted} unaccounted.',
            {
              accounted: report.totalAccounted,
              total: report.totalSourceRecords,
              unaccounted: report.unaccountedCount
            }
          )}
        </p>

        <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: 'var(--orbitpm-muted)' }}>
            {tk('aris.accounting.filter', 'Filter accounting rows')}
          </span>
          <input
            type="search"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
              setLimit(PAGE_SIZE)
            }}
            style={{ width: '100%', marginTop: 4, font: 'inherit', padding: '0.25rem 0.4rem' }}
          />
        </label>

        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {tk('aris.accounting.showing', 'Showing {shown} of {matched} matching rows.', {
            shown: shown.length,
            matched: matched.length
          })}
        </p>

        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="orbitpm-aris-report">
            <thead>
              <tr>
                <th scope="col">{tk('aris.accounting.column.path', 'Source path')}</th>
                <th scope="col">{tk('aris.accounting.column.id', 'Source id')}</th>
                <th scope="col">{tk('aris.accounting.column.kind', 'Kind')}</th>
                <th scope="col">{tk('aris.accounting.column.disposition', 'Disposition')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={`${row.sourcePath}:${row.kind}:${row.disposition}`} data-selectable="true">
                  <td>
                    <button
                      type="button"
                      style={{
                        background: 'transparent',
                        border: 0,
                        padding: 0,
                        font: 'inherit',
                        color: 'inherit',
                        textAlign: 'start',
                        cursor: 'pointer',
                        overflowWrap: 'anywhere'
                      }}
                      aria-label={tk('aris.accounting.rowAria', 'Select {id} on the canvas', {
                        id: row.sourceId ?? row.sourcePath
                      })}
                      onClick={() => {
                        const revealed = onSelectRecord(row)
                        setNotice(
                          revealed
                            ? null
                            : tk(
                                'aris.accounting.notOnCanvas',
                                'That record has no element on the current model.'
                              )
                        )
                      }}
                    >
                      {row.sourcePath}
                    </button>
                  </td>
                  <td>{row.sourceId ?? ''}</td>
                  <td>{row.kind}</td>
                  <td>{row.disposition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {matched.length > shown.length && (
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            style={{ marginTop: 8 }}
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            {tk('aris.accounting.showMore', 'Show more rows')}
          </button>
        )}

        {notice && (
          <p role="status" style={{ margin: '8px 0 0', fontSize: 12 }}>
            {notice}
          </p>
        )}

        <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>
          {tk('aris.accounting.issues', 'Issues')}
        </h4>
        {report.issues.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            {tk('aris.accounting.noIssues', 'No reconciliation issues.')}
          </p>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem', fontSize: 12 }}>
            {report.issues.slice(0, 50).map((issue, index) => (
              <li key={`${issue.construct}:${index}`}>
                {issue.construct}: {issue.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="orbitpm-aris-rail__section" data-orbitpm-aris-fidelity="">
        <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
          {tk('aris.rail.fidelity', 'Fidelity')}
        </h3>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {tk('aris.fidelity.count', '{count} findings', { count: fidelity.length })}
        </p>
        {fidelityKinds.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            {tk('aris.fidelity.none', 'No visual fallbacks were reported for this source.')}
          </p>
        ) : (
          <dl className="orbitpm-aris-defs">
            {fidelityKinds.map(([kind, count]) => {
              const sample = firstFindingByKind.get(kind)
              return (
                <div key={kind} style={{ display: 'contents' }}>
                  <dt>
                    {sample ? t(sample.messageKey as Key, sample.params) : kind}
                  </dt>
                  <dd>{count}</dd>
                </div>
              )
            })}
          </dl>
        )}
      </section>
    </>
  )
}
