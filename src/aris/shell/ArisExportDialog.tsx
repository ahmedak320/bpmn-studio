/**
 * The one export surface for the ARIS studio toolbar.
 *
 * Scope: this process, selected processes, or the whole library (every process in
 * the open file). Format: diagram PDFs, or the derived AML file. The AML file
 * always covers the whole open file, because the derived export is one document;
 * the scope choice therefore applies to PDFs only.
 */
import { useId, useMemo, useState } from 'react'

import { AccessibleDialog } from '../../common/AccessibleDialog'
import { tk } from './shellI18n'

export interface ArisExportModelOption {
  readonly id: string
  readonly name: string
  readonly renderable: boolean
}

export type ArisExportScope = 'current' | 'selected' | 'library'
export type ArisExportFormat = 'pdf' | 'aml'

export interface ArisExportDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly models: readonly ArisExportModelOption[]
  readonly currentModelId: string | null
  /** The experimental-export wording the derived AML carries until it is verified. */
  readonly amlLabel: string
  readonly onExportPdf: (modelIds: readonly string[]) => void
  readonly onExportAml: () => void
}

export function ArisExportDialog({
  open,
  onClose,
  models,
  currentModelId,
  amlLabel,
  onExportPdf,
  onExportAml
}: ArisExportDialogProps): JSX.Element | null {
  const groupId = useId()
  const [format, setFormat] = useState<ArisExportFormat>('pdf')
  const [scope, setScope] = useState<ArisExportScope>('current')
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())

  const renderable = useMemo(() => models.filter((model) => model.renderable), [models])
  const pdfIds = useMemo(() => {
    if (scope === 'current') return currentModelId ? [currentModelId] : []
    if (scope === 'library') return renderable.map((model) => model.id)
    return renderable.filter((model) => picked.has(model.id)).map((model) => model.id)
  }, [scope, currentModelId, renderable, picked])

  if (!open) return null

  const canExport = format === 'aml' ? models.length > 0 : pdfIds.length > 0

  return (
    <AccessibleDialog
      ariaLabel={tk('aris.export.dialog.title', 'Export processes')}
      onClose={onClose}
      closeOnEscape
      closeOnBackdrop
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 15 }}>{tk('aris.export.dialog.title', 'Export processes')}</strong>
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={onClose}>
          {tk('aris.export.dialog.close', 'Close')}
        </button>
      </header>

      <fieldset style={{ display: 'grid', gap: 6, border: 0, padding: 0 }}>
        <legend style={{ fontSize: 12.5, fontWeight: 600 }}>
          {tk('aris.export.dialog.format', 'Format')}
        </legend>
        <label>
          <input
            type="radio"
            name={`${groupId}-format`}
            checked={format === 'pdf'}
            onChange={() => setFormat('pdf')}
          />{' '}
          {tk('aris.export.dialog.pdf', 'Diagram PDF')}
        </label>
        <label>
          <input
            type="radio"
            name={`${groupId}-format`}
            checked={format === 'aml'}
            onChange={() => setFormat('aml')}
          />{' '}
          {amlLabel}{' '}
          {tk('aris.export.dialog.amlScope', '(whole open file)')}
        </label>
      </fieldset>

      {format === 'pdf' && (
        <fieldset style={{ display: 'grid', gap: 6, border: 0, padding: 0 }}>
          <legend style={{ fontSize: 12.5, fontWeight: 600 }}>
            {tk('aris.export.dialog.scope', 'Which processes')}
          </legend>
          <label>
            <input
              type="radio"
              name={`${groupId}-scope`}
              checked={scope === 'current'}
              onChange={() => setScope('current')}
            />{' '}
            {tk('aris.export.dialog.current', 'This process')}
          </label>
          <label>
            <input
              type="radio"
              name={`${groupId}-scope`}
              checked={scope === 'selected'}
              onChange={() => setScope('selected')}
            />{' '}
            {tk('aris.export.dialog.selected', 'Selected processes')}
          </label>
          <label>
            <input
              type="radio"
              name={`${groupId}-scope`}
              checked={scope === 'library'}
              onChange={() => setScope('library')}
            />{' '}
            {tk('aris.export.dialog.library', 'Whole library ({count} processes)', {
              count: renderable.length
            })}
          </label>
          {scope === 'selected' && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, maxHeight: 240, overflow: 'auto' }}>
              {renderable.map((model) => (
                <li key={model.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(model.id)}
                      onChange={(event) =>
                        setPicked((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(model.id)
                          else next.delete(model.id)
                          return next
                        })
                      }
                    />{' '}
                    {model.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          className="orbitpm-lite-primary"
          data-orbitpm-aris-export-run=""
          disabled={!canExport}
          onClick={() => {
            if (format === 'aml') onExportAml()
            else onExportPdf(pdfIds)
            onClose()
          }}
        >
          {format === 'aml'
            ? tk('aris.export.dialog.runAml', 'Export AML')
            : tk('aris.export.dialog.runPdf', 'Export {count} PDF(s)', { count: pdfIds.length })}
        </button>
      </footer>
    </AccessibleDialog>
  )
}
