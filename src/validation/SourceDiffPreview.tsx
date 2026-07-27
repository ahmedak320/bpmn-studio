import { t, type Key } from '../i18n'
import type { XmlLineDiff, XmlLineDiffLine } from './sourceDiff'

export interface SourceDiffPreviewProps {
  diff: XmlLineDiff
  id?: string
  title?: string
}

function translate(key: string, variables?: Record<string, string | number>): string {
  return t(key as Key, variables)
}

function lineLabel(line: XmlLineDiffLine): string {
  if (line.kind === 'added') {
    return translate('sourceEditor.diffLine.added', { line: line.candidateLine ?? 1 })
  }
  if (line.kind === 'removed') {
    return translate('sourceEditor.diffLine.removed', { line: line.originalLine ?? 1 })
  }
  return translate('sourceEditor.diffLine.context', {
    original: line.originalLine ?? 1,
    candidate: line.candidateLine ?? 1
  })
}

/**
 * Accessible, content-bearing source diff. Counts remain useful orientation,
 * but each hunk contains the exact before/after lines the user is approving.
 */
export function SourceDiffPreview({
  diff,
  id,
  title = translate('sourceEditor.diff')
}: SourceDiffPreviewProps): JSX.Element {
  const totalHunks = diff.hunks.length + diff.omitted.hunks
  if (diff.hunks.length === 0) {
    return (
      <section id={id} className="orbitpm-source-diff" aria-label={title}>
        {diff.truncated ? (
          <>
            <h3>{title}</h3>
            <p className="orbitpm-source-diff__bounded orbitpm-source-diff__truncated" role="alert">
              {translate('sourceEditor.diffTruncated')}
            </p>
          </>
        ) : (
          <p className="orbitpm-source-diff__empty">{translate('sourceEditor.noChanges')}</p>
        )}
      </section>
    )
  }

  return (
    <section id={id} className="orbitpm-source-diff" aria-label={title}>
      <h3>{title}</h3>
      {diff.truncated ? (
        <p className="orbitpm-source-diff__bounded orbitpm-source-diff__truncated" role="alert">
          {translate('sourceEditor.diffTruncated')}
        </p>
      ) : !diff.aligned ? (
        <p className="orbitpm-source-diff__bounded" role="note">
          {translate('sourceEditor.diffBounded')}
        </p>
      ) : null}
      <div className="orbitpm-source-diff__hunks">
        {diff.hunks.map((hunk, hunkIndex) => (
          <article
            key={`${hunk.originalStart}:${hunk.candidateStart}:${hunkIndex}`}
            className="orbitpm-source-diff__hunk"
            aria-label={translate('sourceEditor.diffHunk', {
              index: hunkIndex + 1,
              total: totalHunks,
              original: hunk.originalStart,
              candidate: hunk.candidateStart
            })}
          >
            <div className="orbitpm-source-diff__hunk-header" dir="ltr">
              @@ -{hunk.originalStart},{hunk.originalLines} +{hunk.candidateStart},
              {hunk.candidateLines} @@
            </div>
            <div role="list">
              {hunk.lines.map((line, lineIndex) => (
                <div
                  key={`${line.kind}:${line.originalLine ?? ''}:${line.candidateLine ?? ''}:${lineIndex}`}
                  role="listitem"
                  className={`orbitpm-source-diff__line orbitpm-source-diff__line--${line.kind}`}
                  aria-label={lineLabel(line)}
                  dir="ltr"
                >
                  <span className="orbitpm-source-diff__line-number" aria-hidden="true">
                    {line.originalLine ?? ''}
                  </span>
                  <span className="orbitpm-source-diff__line-number" aria-hidden="true">
                    {line.candidateLine ?? ''}
                  </span>
                  <span className="orbitpm-source-diff__marker" aria-hidden="true">
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                  </span>
                  <code>{line.content || ' '}</code>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default SourceDiffPreview
