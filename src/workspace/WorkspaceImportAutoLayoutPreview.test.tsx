// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n'
import {
  WORKSPACE_IMPORT_AUTO_LAYOUT_MAX_MOUNTED_VIEWERS,
  WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE,
  WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS,
  WorkspaceImportAutoLayoutPreview,
  type WorkspaceImportAutoLayoutPreviewArtifact,
  type WorkspaceImportPreviewViewer,
  type WorkspaceImportPreviewViewerFactory
} from './WorkspaceImportAutoLayoutPreview'

afterEach(() => {
  cleanup()
  setLang('en')
})

const REVIEWED_XML =
  '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Exact_reviewed_DI"/>'

function exactArtifact(
  overrides: Partial<WorkspaceImportAutoLayoutPreviewArtifact> = {}
): WorkspaceImportAutoLayoutPreviewArtifact {
  return {
    artifactId: 'artifact-layout-exact',
    sourceId: 'source-layout-exact',
    sourceName: 'طلبات الشراء.bpmn',
    sourcePath: 'incoming/طلبات الشراء.bpmn',
    destinationPath: 'operations/purchase-request.bpmn',
    reviewedXml: REVIEWED_XML,
    ...overrides
  }
}

function artifactList(count: number): WorkspaceImportAutoLayoutPreviewArtifact[] {
  return Array.from({ length: count }, (_, index) =>
    exactArtifact({
      artifactId: `artifact-layout-${index + 1}`,
      sourceId: `source-layout-${index + 1}`,
      sourceName: `Source ${index + 1}.bpmn`,
      sourcePath: `incoming/source-${index + 1}.bpmn`,
      destinationPath: `operations/process-${index + 1}.bpmn`,
      reviewedXml: `<definitions id="Reviewed_${index + 1}"/>`
    })
  )
}

interface RecordedViewer {
  readonly container: HTMLElement
  readonly signal: AbortSignal
  readonly importXML: ReturnType<typeof vi.fn>
  readonly zoom: ReturnType<typeof vi.fn>
  readonly destroy: ReturnType<typeof vi.fn>
}

function recordingFactory(options?: {
  importResult?: (index: number, xml: string) => Promise<{ warnings?: readonly unknown[] }>
  createError?: Error
}): {
  createViewer: WorkspaceImportPreviewViewerFactory
  viewers: RecordedViewer[]
  events: string[]
  maxMounted: () => number
} {
  const viewers: RecordedViewer[] = []
  const events: string[] = []
  let mounted = 0
  let maxMounted = 0
  const createViewer: WorkspaceImportPreviewViewerFactory = ({ container, signal }) => {
    if (options?.createError) throw options.createError
    const index = viewers.length
    const zoom = vi.fn()
    let destroyed = false
    mounted += 1
    maxMounted = Math.max(maxMounted, mounted)
    events.push(`create:${index}`)
    const viewer: RecordedViewer = {
      container,
      signal,
      importXML: vi.fn((xml: string) => {
        events.push(`import:${index}`)
        return options?.importResult?.(index, xml) ?? Promise.resolve({ warnings: [] })
      }),
      zoom,
      destroy: vi.fn(() => {
        if (destroyed) return
        destroyed = true
        mounted -= 1
        events.push(`destroy:${index}`)
      })
    }
    viewers.push(viewer)
    return {
      importXML: viewer.importXML,
      get: vi.fn((service: 'canvas') => {
        expect(service).toBe('canvas')
        return { zoom }
      }),
      destroy: viewer.destroy
    } as unknown as WorkspaceImportPreviewViewer
  }
  return { createViewer, viewers, events, maxMounted: () => maxMounted }
}

describe('WorkspaceImportAutoLayoutPreview', () => {
  it('keeps large sealed plans within a fixed DOM ceiling and makes every artifact reachable', async () => {
    const user = userEvent.setup()
    const artifacts = artifactList(WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE * 2 + 3)
    const { createViewer, viewers } = recordingFactory()
    const view = render(
      <WorkspaceImportAutoLayoutPreview artifacts={artifacts} createViewer={createViewer} />
    )

    expect(viewers).toHaveLength(0)
    const section = screen
      .getByRole('heading', { name: 'Auto-layout diagram previews' })
      .closest('section') as HTMLElement
    const reached = new Set<string>()

    for (;;) {
      const cards = [...section.querySelectorAll('.workspace-import-layout-preview__artifact')]
      expect(cards.length).toBeLessThanOrEqual(WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE)
      for (const card of cards) {
        const artifactId = within(card as HTMLElement).getByText(/artifact-layout-\d+/).textContent
        if (artifactId) reached.add(artifactId)
        expect(card.getAttribute('aria-setsize')).toBe(String(artifacts.length))
      }
      expect(section.querySelectorAll('[role="img"]')).toHaveLength(0)
      expect(viewers).toHaveLength(0)

      const next = within(section).getByRole('button', { name: 'Next page' })
      if ((next as HTMLButtonElement).disabled) break
      await user.click(next)
    }

    expect(reached).toEqual(new Set(artifacts.map(({ artifactId }) => artifactId)))
    expect(within(section).getByRole('status').textContent).toContain(
      `of ${artifacts.length}. Page 3 of 3.`
    )
    view.unmount()
    expect(viewers).toHaveLength(0)
  })

  it('mounts only the explicitly selected viewer and destroys and aborts it before switching or closing', async () => {
    const user = userEvent.setup()
    const artifacts = artifactList(2)
    const { createViewer, viewers, events, maxMounted } = recordingFactory()
    render(<WorkspaceImportAutoLayoutPreview artifacts={artifacts} createViewer={createViewer} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Preview diagram for operations/process-1.bpmn'
      })
    )
    await waitFor(() => expect(viewers[0]?.zoom).toHaveBeenCalledWith('fit-viewport'))
    expect(viewers[0]?.importXML).toHaveBeenCalledWith(artifacts[0]?.reviewedXml)
    expect(screen.getAllByRole('img')).toHaveLength(1)

    await user.click(
      screen.getByRole('button', {
        name: 'Preview diagram for operations/process-2.bpmn'
      })
    )
    await waitFor(() => expect(viewers[1]?.zoom).toHaveBeenCalledWith('fit-viewport'))
    expect(viewers[0]?.destroy).toHaveBeenCalledTimes(1)
    expect(viewers[0]?.signal.aborted).toBe(true)
    expect(events.indexOf('destroy:0')).toBeLessThan(events.indexOf('create:1'))
    expect(maxMounted()).toBe(WORKSPACE_IMPORT_AUTO_LAYOUT_MAX_MOUNTED_VIEWERS)
    expect(screen.getAllByRole('img')).toHaveLength(1)

    await user.click(
      screen.getByRole('button', {
        name: 'Close diagram preview for operations/process-2.bpmn'
      })
    )
    expect(viewers[1]?.destroy).toHaveBeenCalledTimes(1)
    expect(viewers[1]?.signal.aborted).toBe(true)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('cancels a pending import on page navigation and ignores its stale result', async () => {
    const user = userEvent.setup()
    let resolveFirst!: (result: { warnings?: readonly unknown[] }) => void
    const firstImport = new Promise<{ warnings?: readonly unknown[] }>((resolve) => {
      resolveFirst = resolve
    })
    const artifacts = artifactList(WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE + 1)
    const { createViewer, viewers } = recordingFactory({
      importResult: (index) =>
        index === 0 ? firstImport : Promise.resolve({ warnings: ['render warning'] })
    })
    render(<WorkspaceImportAutoLayoutPreview artifacts={artifacts} createViewer={createViewer} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Preview diagram for operations/process-1.bpmn'
      })
    )
    await waitFor(() => expect(viewers).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(viewers[0]?.destroy).toHaveBeenCalledTimes(1)
    expect(viewers[0]?.signal.aborted).toBe(true)
    expect(screen.queryByRole('img')).toBeNull()

    resolveFirst({ warnings: [] })
    await Promise.resolve()
    expect(viewers[0]?.zoom).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', {
        name: `Preview diagram for operations/process-${artifacts.length}.bpmn`
      })
    )
    await waitFor(() => expect(viewers[1]?.zoom).toHaveBeenCalledWith('fit-viewport'))
    const activePreview = document.querySelector(
      '[data-workspace-import-active-layout-preview]'
    ) as HTMLElement
    expect(within(activePreview).getByRole('status').textContent).toContain('1 rendering warning')
  })

  it('destroys and aborts the old viewer when exact reviewed XML is replaced', async () => {
    const user = userEvent.setup()
    let resolveFirst!: (result: { warnings?: readonly unknown[] }) => void
    const firstImport = new Promise<{ warnings?: readonly unknown[] }>((resolve) => {
      resolveFirst = resolve
    })
    const { createViewer, viewers } = recordingFactory({
      importResult: (index) => (index === 0 ? firstImport : Promise.resolve({ warnings: [] }))
    })
    const artifact = exactArtifact()
    const view = render(
      <WorkspaceImportAutoLayoutPreview artifacts={[artifact]} createViewer={createViewer} />
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Preview diagram for operations/purchase-request.bpmn'
      })
    )
    await waitFor(() => expect(viewers).toHaveLength(1))

    const replacement = '<definitions id="replacement-reviewed-xml"/>'
    view.rerender(
      <WorkspaceImportAutoLayoutPreview
        artifacts={[{ ...artifact, reviewedXml: replacement }]}
        createViewer={createViewer}
      />
    )
    await waitFor(() => expect(viewers).toHaveLength(2))
    expect(viewers[0]?.destroy).toHaveBeenCalledTimes(1)
    expect(viewers[0]?.signal.aborted).toBe(true)
    expect(viewers[1]?.importXML).toHaveBeenCalledWith(replacement)

    resolveFirst({ warnings: [] })
    await Promise.resolve()
    expect(viewers[0]?.zoom).not.toHaveBeenCalled()
    view.unmount()
    expect(viewers[1]?.destroy).toHaveBeenCalledTimes(1)
    expect(viewers[1]?.signal.aborted).toBe(true)
  })

  it('uses a stable localized failure alert and separate bounded Unicode-safe technical evidence', async () => {
    const user = userEvent.setup()
    const rawFailure = `provider-secret:${'😀'.repeat(
      WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS + 50
    )}`
    const failedImport = recordingFactory({
      importResult: () => Promise.reject(new Error(rawFailure))
    })
    const first = render(
      <WorkspaceImportAutoLayoutPreview
        artifacts={[exactArtifact()]}
        createViewer={failedImport.createViewer}
      />
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Preview diagram for operations/purchase-request.bpmn'
      })
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('The reviewed diagram preview could not be rendered.')
    expect(alert.textContent).not.toContain('provider-secret')
    const technical = document.querySelector(
      '[data-workspace-import-preview-error-technical]'
    ) as HTMLElement
    expect(technical.tagName).toBe('CODE')
    expect(technical.hasAttribute('lang')).toBe(false)
    expect(technical.getAttribute('dir')).toBe('auto')
    expect(Array.from(technical.textContent ?? '')).toHaveLength(
      WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS
    )
    expect(technical.textContent?.endsWith('…')).toBe(true)
    expect(failedImport.viewers[0]?.destroy).toHaveBeenCalledTimes(1)
    first.unmount()

    const failedConstruction = recordingFactory({
      createError: new Error('Viewer construction secret')
    })
    render(
      <WorkspaceImportAutoLayoutPreview
        artifacts={[exactArtifact()]}
        createViewer={failedConstruction.createViewer}
      />
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Preview diagram for operations/purchase-request.bpmn'
      })
    )
    expect((await screen.findByRole('alert')).textContent).not.toContain(
      'Viewer construction secret'
    )
    expect(
      document.querySelector('[data-workspace-import-preview-error-technical]')?.textContent
    ).toBe('Viewer construction secret')
  })

  it('keeps navigation localized in Arabic while technical evidence stays LTR', async () => {
    const user = userEvent.setup()
    setLang('ar')
    const artifacts = artifactList(WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE + 1)
    const failed = recordingFactory({
      importResult: () => Promise.reject(new Error('raw-technical-evidence'))
    })
    render(
      <WorkspaceImportAutoLayoutPreview artifacts={artifacts} createViewer={failed.createViewer} />
    )

    expect(
      screen.getByRole('navigation', { name: 'صفحات معاينات التخطيط التلقائي' })
    ).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'الصفحة التالية' }))
    expect(
      screen.getByText(`artifact-layout-${WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE + 1}`)
    ).not.toBeNull()
    await user.click(
      screen.getByRole('button', {
        name: `معاينة مخطط operations/process-${WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE + 1}.bpmn`
      })
    )
    const technical = (await screen.findByText('raw-technical-evidence')).closest('code')
    expect(technical?.getAttribute('dir')).toBe('auto')
    expect(technical?.hasAttribute('lang')).toBe(false)
    expect(screen.getByRole('alert').textContent).toMatch(/[\u0600-\u06ff]/u)
  })

  it('never mutates the sealed artifact list or exact reviewed XML', async () => {
    const user = userEvent.setup()
    const artifact = Object.freeze(exactArtifact())
    const artifacts = Object.freeze([artifact])
    const before = JSON.stringify(artifacts)
    const { createViewer, viewers } = recordingFactory()

    render(<WorkspaceImportAutoLayoutPreview artifacts={artifacts} createViewer={createViewer} />)
    await user.click(
      screen.getByRole('button', {
        name: 'Preview diagram for operations/purchase-request.bpmn'
      })
    )
    await waitFor(() => expect(viewers[0]?.zoom).toHaveBeenCalledWith('fit-viewport'))

    expect(viewers[0]?.importXML).toHaveBeenCalledWith(REVIEWED_XML)
    expect(JSON.stringify(artifacts)).toBe(before)
    expect(artifact.reviewedXml).toBe(REVIEWED_XML)
  })
})
