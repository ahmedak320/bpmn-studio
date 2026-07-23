import { computeBandPlan, type Rect } from '../print/printLayout'
import { splitSvg } from '../print/svgSlice'

export interface PrintJob {
  /** Full <svg>…</svg> markup from bpmn-js saveSVG(). */
  svg: string
  /** File-derived title (used as the header when no processName is given). */
  title: string
  /** Folder path shown under the title ('' → workspace root label). */
  folder: string
  /** Process display name — preferred over `title` for the header heading. */
  processName?: string
  /** Optional owner / metadata line shown beneath the folder. */
  ownerLine?: string
  /** Shape rects (SVG user-space) used to plan band cuts; enables wrapping. */
  shapes?: Rect[]
}

/**
 * The dedicated full-page print view. Rendered (into the normal React tree, but
 * kept display:none on screen by print.css) only while a print job is active;
 * print.css reveals just this subtree during printing, in A4 landscape, with a
 * title header (process name + folder + optional owner) above the diagram.
 *
 * When the job carries a parseable viewBox AND shape rects, a wide diagram is
 * sliced into stacked snake-order bands (see printLayout.computeBandPlan) so
 * each step prints large and the page is filled. Otherwise — legacy jobs, a
 * compact diagram that needs no wrapping, or an unparseable SVG — it falls back
 * to today's single inlined-SVG render. The SVG comes from bpmn-js's own
 * saveSVG() output (the same trusted source as SVG export).
 */
export function PrintView({ job }: { job: PrintJob | null }): JSX.Element | null {
  if (!job) return null

  const headerTitle = job.processName || job.title
  const { inner, viewBox } = splitSvg(job.svg)

  const plan =
    viewBox && job.shapes && job.shapes.length > 0
      ? computeBandPlan({ shapes: job.shapes, viewbox: viewBox })
      : null

  let body: JSX.Element
  if (!viewBox || !job.shapes?.length || !plan || !plan.wrapped) {
    // Legacy / compact render: inline the whole SVG once.
    body = <div className="orbitpm-print-svg" dangerouslySetInnerHTML={{ __html: job.svg }} />
  } else {
    const last = plan.bands.length - 1
    body = (
      <>
        {plan.bands.map((b, i) => (
          <div className="orbitpm-print-band" key={i}>
            {i > 0 && (
              <div className="orbitpm-print-band-marker" aria-hidden="true">
                ⮡
              </div>
            )}
            <svg
              viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`}
              preserveAspectRatio="xMidYMin meet"
              style={{ width: '100%', height: 'auto', display: 'block' }}
              dangerouslySetInnerHTML={{ __html: inner }}
            />
            {i < last && (
              <div className="orbitpm-print-band-marker orbitpm-print-band-marker--end" aria-hidden="true">
                ⮕
              </div>
            )}
          </div>
        ))}
      </>
    )
  }

  return (
    <div className="orbitpm-print-root" data-testid="print-root" aria-hidden="true">
      <div className="orbitpm-print-header">
        <h1 className="orbitpm-print-title">{headerTitle}</h1>
        <p className="orbitpm-print-folder">{job.folder}</p>
        {job.ownerLine ? <p className="orbitpm-print-owner">{job.ownerLine}</p> : null}
      </div>
      {body}
    </div>
  )
}

export default PrintView
