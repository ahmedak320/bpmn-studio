// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createValidationSummary, validationIssue, type ValidationSummary } from '../contracts'
import type {
  ReadOnlyDiagramPreviewViewer,
  ReadOnlyDiagramPreviewViewerFactory
} from '../ReadOnlyDiagramPreview'
import { SourceDiffPreview } from '../SourceDiffPreview'
import { SourceEditorDialog } from '../SourceEditorDialog'
import { DEFAULT_XML_LINE_DIFF_BUDGETS } from '../sourceDiff'
import { VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS } from '../technicalEvidence'

const preservation = vi.hoisted(() => vi.fn())
const dialogLanguage = vi.hoisted(() => ({ current: 'en' as 'en' | 'ar' }))
const arabicActionCopy = vi.hoisted(
  () =>
    ({
      'sourceEditor.action.previewFailed': 'تعذّرت معاينة تغييرات المصدر.',
      'sourceEditor.action.layoutFailed': 'تعذّر إنشاء تخطيط المخطط.',
      'sourceEditor.action.applyFailed': 'تعذّر تطبيق تغييرات المصدر.',
      'sourceEditor.action.technicalDetails': 'التفاصيل التقنية:'
    }) as Readonly<Record<string, string>>
)

vi.mock('../extensions', () => ({
  validateUnknownExtensionPreservation: preservation
}))

vi.mock('../../i18n', () => ({
  t: (key: string, variables?: Record<string, string | number>): string => {
    if (dialogLanguage.current === 'ar' && arabicActionCopy[key]) return arabicActionCopy[key]
    return key === 'sourceEditor.diffHunk' ? `${key}:${variables?.index}/${variables?.total}` : key
  }
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' | 'ar' => dialogLanguage.current
}))

const validSummary = createValidationSummary([], { xmlWellFormed: true })

function renderDialog(
  overrides: Partial<ComponentProps<typeof SourceEditorDialog>> = {}
): ReturnType<typeof render> {
  return render(
    <SourceEditorDialog
      open
      originalXml='<definitions id="original" />'
      validate={vi.fn(async () => validSummary)}
      apply={vi.fn(async () => ({ status: 'applied' as const }))}
      autoLayout={vi.fn(async (xml) => xml)}
      onClose={vi.fn()}
      {...overrides}
    />
  )
}

beforeEach(() => {
  dialogLanguage.current = 'en'
  preservation.mockReset().mockResolvedValue(validSummary)
})

afterEach(() => {
  cleanup()
})

describe('SourceDiffPreview accessibility', () => {
  it('labels rendered hunks against the true total including omitted hunks', () => {
    render(
      <SourceDiffPreview
        diff={{
          originalLines: 100,
          candidateLines: 100,
          changedLines: 50,
          removedLines: 50,
          addedLines: 50,
          firstChangedLine: 1,
          aligned: true,
          truncated: true,
          omitted: {
            originalChars: 0,
            candidateChars: 0,
            originalLines: 0,
            candidateLines: 0,
            operations: 0,
            previewRows: 98,
            previewChars: 980,
            hunks: 49
          },
          hunks: [
            {
              originalStart: 1,
              originalLines: 1,
              candidateStart: 1,
              candidateLines: 1,
              lines: [
                {
                  kind: 'removed',
                  content: '<old />',
                  originalLine: 1
                },
                {
                  kind: 'added',
                  content: '<new />',
                  candidateLine: 1
                }
              ]
            }
          ]
        }}
      />
    )

    expect(document.querySelector('article')?.getAttribute('aria-label')).toBe(
      'sourceEditor.diffHunk:1/50'
    )
  })
})

describe('SourceEditorDialog Apply outcomes', () => {
  it.each([
    {
      action: 'preview',
      summary: 'تعذّرت معاينة تغييرات المصدر.',
      detail: 'Native preview parser exploded.'
    },
    {
      action: 'apply',
      summary: 'تعذّر تطبيق تغييرات المصدر.',
      detail: 'Native apply transaction exploded.'
    }
  ] as const)(
    'shows an Arabic $action summary and isolates exact technical evidence',
    async ({ action, summary, detail }) => {
      const user = userEvent.setup()
      dialogLanguage.current = 'ar'
      const validate =
        action === 'preview'
          ? vi.fn(async (): Promise<ValidationSummary> => {
              throw new Error(detail)
            })
          : vi.fn(async () => validSummary)
      const apply =
        action === 'apply'
          ? vi.fn(async (): Promise<never> => {
              throw new Error(detail)
            })
          : vi.fn(async () => ({ status: 'applied' as const }))
      renderDialog({ validate, apply })
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: '<definitions id="candidate" />' }
      })

      await user.click(
        screen.getByRole('button', {
          name: action === 'preview' ? 'sourceEditor.preview' : 'sourceEditor.apply'
        })
      )

      const alert = await screen.findByRole('alert')
      const errorRegion = alert.closest('.orbitpm-source-editor__error')
      expect(errorRegion?.getAttribute('dir')).toBe('rtl')
      expect(alert.textContent).toBe(summary)
      expect(alert.getAttribute('data-source-editor-error-summary')).not.toBeNull()
      const evidence = errorRegion?.querySelector('[data-source-editor-error-technical]')
      expect(evidence?.textContent).toContain('التفاصيل التقنية:')
      const code = evidence?.querySelector('code')
      expect(code?.textContent).toBe(detail)
      expect(code?.getAttribute('lang')).toBe('en')
      expect(code?.getAttribute('dir')).toBe('ltr')
      expect(alert.textContent).not.toContain(detail)
    }
  )

  it('bounds a megabyte action diagnostic at a Unicode code-point boundary', async () => {
    const user = userEvent.setup()
    const detail = `${'x'.repeat(510)}😀TAIL${'z'.repeat(1_000_000)}`
    const expected = `${'x'.repeat(510)}😀…`
    renderDialog({
      validate: vi.fn(async (): Promise<ValidationSummary> => {
        throw new Error(detail)
      })
    })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.preview' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('sourceEditor.action.previewFailed')
    expect(alert.textContent).not.toContain('TAIL')
    const code = document.querySelector('[data-source-editor-error-technical] code')
    expect(code?.textContent).toBe(expected)
    expect(Array.from(code?.textContent ?? '')).toHaveLength(
      VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS
    )
    expect(code?.textContent).not.toContain('\uFFFD')
  })

  it('keeps diff review inside the scroll region and the action footer outside it', () => {
    renderDialog()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })

    const scrollRegion = document.querySelector('[data-source-editor-scroll-region]')
    const diff = document.querySelector('.orbitpm-source-diff')
    const footer = document.querySelector('.orbitpm-validation__footer')
    expect(scrollRegion).not.toBeNull()
    expect(diff).not.toBeNull()
    expect(scrollRegion?.contains(diff)).toBe(true)
    expect(scrollRegion?.contains(footer)).toBe(false)
    expect(scrollRegion?.nextElementSibling).toBe(footer)
  })

  it('keeps exact oversized source unchanged and blocks Apply when its diff is truncated', () => {
    const apply = vi.fn()
    renderDialog({ apply })
    const candidate = Array.from(
      { length: DEFAULT_XML_LINE_DIFF_BUDGETS.maxLines + 1 },
      (_, index) => `<task id="${index}" />`
    ).join('\n')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: candidate } })

    expect(screen.getByRole('alert').textContent).toBe('sourceEditor.diffTruncated')
    expect(
      (screen.getByRole('button', { name: 'sourceEditor.apply' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))
    expect(apply).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(candidate)
  })

  it('blocks acceptance when a generated layout diff is too large to review safely', async () => {
    const user = userEvent.setup()
    const missingDi = createValidationSummary(
      [
        validationIssue({
          code: 'di.process-missing',
          severity: 'warning',
          source: 'di',
          message: 'missing DI'
        })
      ],
      { xmlWellFormed: true }
    )
    const draft = '<definitions id="candidate" />'
    const layoutXml = Array.from(
      { length: DEFAULT_XML_LINE_DIFF_BUDGETS.maxLines + 1 },
      (_, index) => `<layout-row id="${index}" />`
    ).join('\n')
    const validate = vi.fn(async (xml: string) => (xml === layoutXml ? validSummary : missingDi))
    const createViewer: ReadOnlyDiagramPreviewViewerFactory = () =>
      ({
        importXML: vi.fn(async () => ({ warnings: [] })),
        get: vi.fn(() => ({ zoom: vi.fn() })),
        destroy: vi.fn()
      }) as unknown as ReadOnlyDiagramPreviewViewer
    renderDialog({
      validate,
      autoLayout: vi.fn(async () => layoutXml),
      createDiagramPreviewViewer: createViewer
    })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: draft } })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.preview' }))
    await user.click(await screen.findByRole('button', { name: 'sourceEditor.layoutPreview' }))

    expect(await screen.findByRole('alert')).not.toBeNull()
    const accept = screen.getByRole('button', { name: 'sourceEditor.layoutAccept' })
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(accept)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(draft)
  })

  it('keeps a blocked layout unacceptably blocked after previewing the draft again', async () => {
    const user = userEvent.setup()
    const missingDi = createValidationSummary(
      [
        validationIssue({
          code: 'di.process-missing',
          severity: 'warning',
          source: 'di',
          message: 'missing DI'
        })
      ],
      { xmlWellFormed: true }
    )
    const blockedLayout = createValidationSummary(
      [
        validationIssue({
          code: 'xml.invalid',
          severity: 'error',
          source: 'xml',
          message: 'invalid generated layout'
        })
      ],
      { xmlWellFormed: false }
    )
    const draft = '<definitions id="candidate" />'
    const layoutXml = '<definitions id="generated-layout" />'
    const validate = vi.fn(async (xml: string) => (xml === layoutXml ? blockedLayout : missingDi))
    const createViewer: ReadOnlyDiagramPreviewViewerFactory = () =>
      ({
        importXML: vi.fn(async () => ({ warnings: [] })),
        get: vi.fn(() => ({ zoom: vi.fn() })),
        destroy: vi.fn()
      }) as unknown as ReadOnlyDiagramPreviewViewer
    renderDialog({
      validate,
      autoLayout: vi.fn(async () => layoutXml),
      createDiagramPreviewViewer: createViewer
    })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: draft } })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.preview' }))
    await user.click(await screen.findByRole('button', { name: 'sourceEditor.layoutPreview' }))
    expect(await screen.findByText('sourceEditor.diagramPreview.ready')).not.toBeNull()
    const accept = screen.getByRole('button', { name: 'sourceEditor.layoutAccept' })
    expect((accept as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'sourceEditor.preview' }))
    await waitFor(() => expect(validate).toHaveBeenLastCalledWith(draft, false))
    expect((accept as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(accept)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(draft)
  })

  it('keeps the exact draft open and unchanged when review is cancelled', async () => {
    const user = userEvent.setup()
    const apply = vi.fn(async () => ({ status: 'cancelled' as const }))
    const onClose = vi.fn()
    renderDialog({ apply, onClose })
    const textarea = screen.getByRole('textbox')
    const candidate = '<definitions id="candidate" />'
    fireEvent.change(textarea, { target: { value: candidate } })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))

    await waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(apply).toHaveBeenCalledWith(candidate, expect.any(AbortSignal))
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(candidate)
    expect(screen.getByRole('dialog', { name: 'sourceEditor.title' })).not.toBeNull()
  })

  it('shows a blocking coordinator result and never closes as if source applied', async () => {
    const user = userEvent.setup()
    const apply = vi.fn(async () => ({
      status: 'blocked' as const,
      message: 'review still required'
    }))
    const onClose = vi.fn()
    renderDialog({ apply, onClose })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))

    expect((await screen.findByRole('alert')).textContent).toBe('sourceEditor.invalidBlocked')
    expect(document.querySelector('[data-source-editor-error-technical] code')?.textContent).toBe(
      'review still required'
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('blocks structural validation failures before invoking Apply', async () => {
    const user = userEvent.setup()
    const invalid = createValidationSummary(
      [
        validationIssue({
          code: 'structure.invalid',
          severity: 'error',
          source: 'structure',
          message: 'invalid structure'
        })
      ],
      { xmlWellFormed: true }
    )
    const apply = vi.fn()
    renderDialog({ validate: vi.fn(async () => invalid), apply })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })

    await user.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))

    expect(await screen.findByText('structure.invalid')).not.toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })

  it('aborts an in-flight review when the dialog is removed', async () => {
    let capturedSignal: AbortSignal | undefined
    const apply = vi.fn(
      async (_xml: string, signal: AbortSignal) =>
        await new Promise<never>((_resolve, reject) => {
          capturedSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const view = renderDialog({ apply })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))
    await waitFor(() => expect(capturedSignal).toBeDefined())

    view.unmount()

    expect(capturedSignal?.aborted).toBe(true)
  })

  it('aborts an in-flight review when the exact source snapshot changes', async () => {
    let capturedSignal: AbortSignal | undefined
    const apply = vi.fn(
      async (_xml: string, signal: AbortSignal) =>
        await new Promise<never>((_resolve, reject) => {
          capturedSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const validate = vi.fn(async () => validSummary)
    const autoLayout = vi.fn(async (xml: string) => xml)
    const onClose = vi.fn()
    const view = render(
      <SourceEditorDialog
        open
        originalXml='<definitions id="original" />'
        validate={validate}
        apply={apply}
        autoLayout={autoLayout}
        onClose={onClose}
      />
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<definitions id="candidate" />' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))
    await waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal))

    view.rerender(
      <SourceEditorDialog
        open
        originalXml='<definitions id="replacement" />'
        validate={validate}
        apply={apply}
        autoLayout={autoLayout}
        onClose={onClose}
      />
    )

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
        '<definitions id="replacement" />'
      )
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows exact source hunks and requires a rendered read-only layout before acceptance', async () => {
    const user = userEvent.setup()
    const missingDi = createValidationSummary(
      [
        validationIssue({
          code: 'di.process-missing',
          severity: 'warning',
          source: 'di',
          message: 'missing DI'
        })
      ],
      { xmlWellFormed: true }
    )
    const layoutXml = [
      '<definitions id="candidate">',
      '  <process id="Process_1"/>',
      '  <BPMNDiagram id="Diagram_1"/>',
      '</definitions>'
    ].join('\n')
    const validate = vi.fn(async (xml: string) => (xml === layoutXml ? validSummary : missingDi))
    const autoLayout = vi.fn(async () => layoutXml)
    const apply = vi.fn(async () => ({ status: 'applied' as const }))
    let resolveRender!: (result: { warnings?: readonly unknown[] }) => void
    const importXML = vi.fn(
      () =>
        new Promise<{ warnings?: readonly unknown[] }>((resolve) => {
          resolveRender = resolve
        })
    )
    const zoom = vi.fn()
    const createViewer: ReadOnlyDiagramPreviewViewerFactory = () =>
      ({
        importXML,
        get: vi.fn(() => ({ zoom })),
        destroy: vi.fn()
      }) as unknown as ReadOnlyDiagramPreviewViewer
    renderDialog({
      validate,
      autoLayout,
      apply,
      createDiagramPreviewViewer: createViewer
    })

    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: [
          '<definitions id="candidate">',
          '  <process id="Process_1"/>',
          '</definitions>'
        ].join('\n')
      }
    })
    expect(screen.getByText('−', { selector: '[aria-hidden="true"]' })).not.toBeNull()
    expect(screen.getByText('<definitions id="original" />')).not.toBeNull()
    expect(screen.getByText('<definitions id="candidate">')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'sourceEditor.preview' }))
    await user.click(await screen.findByRole('button', { name: 'sourceEditor.layoutPreview' }))

    await waitFor(() => expect(importXML).toHaveBeenCalledWith(layoutXml))
    const accept = screen.getByRole('button', { name: 'sourceEditor.layoutAccept' })
    expect((accept as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('img', { name: 'sourceEditor.layoutDiagramAria' })).not.toBeNull()

    resolveRender({ warnings: [] })
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false))
    expect(zoom).toHaveBeenCalledWith('fit-viewport')
    await user.click(accept)

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(layoutXml)
    await user.click(screen.getByRole('button', { name: 'sourceEditor.apply' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith(layoutXml, expect.any(AbortSignal)))
  })
})
