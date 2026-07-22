export interface PrintJob {
  /** Full <svg>…</svg> markup from bpmn-js saveSVG(). */
  svg: string
  /** Process display name shown as the print header title. */
  title: string
  /** Folder path shown under the title ('' → workspace root label). */
  folder: string
}

/**
 * The dedicated full-page print view. Rendered (into the normal React tree, but
 * kept display:none on screen by print.css) only while a print job is active;
 * print.css reveals just this subtree during printing, in landscape, with a
 * title header (process name + folder) above the diagram SVG. The SVG comes
 * from bpmn-js's own saveSVG() output (same trusted source as SVG export).
 */
export function PrintView({ job }: { job: PrintJob | null }): JSX.Element | null {
  if (!job) return null
  return (
    <div className="orbitpm-print-root" data-testid="print-root" aria-hidden="true">
      <div className="orbitpm-print-header">
        <h1 className="orbitpm-print-title">{job.title}</h1>
        <p className="orbitpm-print-folder">{job.folder}</p>
      </div>
      <div className="orbitpm-print-svg" dangerouslySetInnerHTML={{ __html: job.svg }} />
    </div>
  )
}

export default PrintView
