/** Toolbar button that prints / saves-as-PDF the active diagram. Injected into
 *  the editor toolbar (via EditorTab's `toolbarExtra`) so it sits beside the
 *  SVG/PNG export buttons and matches their styling. App owns the actual
 *  saveSVG → print-view → window.print() flow behind `onPrint`. */
export function PrintButton({
  onPrint,
  disabled
}: {
  onPrint: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className="orbitpm-editor__button"
      onClick={onPrint}
      disabled={disabled}
      title="Print or Save as PDF — opens the print dialog with a full-page, landscape view of this diagram"
    >
      Print / PDF
    </button>
  )
}

export default PrintButton
