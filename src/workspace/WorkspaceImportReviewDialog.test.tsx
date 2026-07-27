// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n'
import { createValidationSummary, validationIssue } from '../validation'
import {
  WorkspaceImportReviewDialog,
  type WorkspaceImportReviewDialogProps
} from './WorkspaceImportReviewDialog'
import type {
  WorkspaceImportArtifact,
  WorkspaceImportCollision,
  WorkspaceImportCollisionDecision,
  WorkspaceImportPlan
} from './importTransaction'

const previewMocks = vi.hoisted(() => ({
  props: vi.fn()
}))

vi.mock('./WorkspaceImportAutoLayoutPreview', () => ({
  WorkspaceImportAutoLayoutPreview: (props: { artifacts: readonly unknown[] }) => {
    previewMocks.props(props)
    return <div data-testid="auto-layout-preview" />
  }
}))

afterEach(() => {
  cleanup()
  setLang('en')
  previewMocks.props.mockReset()
})

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const REVIEW_DIGEST = 'd'.repeat(64)
const LOCALIZATION_DIGEST = 'e'.repeat(64)

function artifact(
  id: string,
  destinationPath: string,
  overrides: Partial<WorkspaceImportArtifact> = {}
): WorkspaceImportArtifact {
  const bytes = new Uint8Array([60, 120, 109, 108, 47, 62, id.length])
  return {
    id,
    sourceId: `source-${id}`,
    sourceName: `${id} source.bpmn`,
    sourceKind: 'bpmn',
    sourcePath: `incoming/${id}.bpmn`,
    destinationPath,
    xml: '<xml/>',
    bytes,
    sha256: HASH_A,
    processIds: [`Process_${id}`, `Process_${id}_Secondary`],
    replacesProcessIds: [],
    validation: createValidationSummary([]),
    localizationReviewDigest: LOCALIZATION_DIGEST,
    localizationEvidence: {
      reviewMode: 'explicit',
      reviewDigest: LOCALIZATION_DIGEST,
      outputDigest: HASH_A
    } as WorkspaceImportArtifact['localizationEvidence'],
    ...overrides
  }
}

function collision(
  artifactId: string,
  path: string,
  overrides: Partial<WorkspaceImportCollision> = {}
): WorkspaceImportCollision {
  return {
    artifactId,
    path,
    incomingHash: HASH_A,
    existingHash: HASH_B,
    identical: false,
    existing: {
      path,
      bytes: new Uint8Array([1, 2, 3]),
      hash: HASH_B,
      size: 3,
      modifiedAt: 1_712_345_678_900,
      mimeType: 'application/xml'
    },
    suggestedKeepBothPath: path.replace(/\.bpmn$/i, ' (1).bpmn'),
    ...overrides
  }
}

function plan(overrides: Partial<WorkspaceImportPlan> = {}): WorkspaceImportPlan {
  const artifacts = overrides.artifacts ?? [artifact('artifact-a', 'target/artifact-a.bpmn')]
  const collisions = overrides.collisions ?? []
  return {
    version: 1,
    id: 'workspace-import-plan-exact',
    createdAt: '2026-07-27T08:09:10.111Z',
    workspaceId: 'workspace-exact-id',
    workspaceMode: 'directory',
    workspaceMultipleFiles: true,
    status: 'ready',
    targetFolder: 'target',
    artifacts,
    collisions,
    skipped: [],
    repairs: [],
    warnings: [],
    arisReports: [],
    summary: {
      sources: 1,
      artifacts: artifacts.length,
      collisions: collisions.length,
      skipped: 0,
      repairs: 0,
      warnings: 0,
      arisReports: 0,
      creates: artifacts.length - collisions.length,
      identical: collisions.filter(({ identical }) => identical).length
    },
    processIdentitySnapshot: [],
    processIdentityDigest: HASH_C,
    reviewDigest: REVIEW_DIGEST,
    ...overrides
  }
}

function renderDialog(
  reviewPlan: WorkspaceImportPlan,
  props: Partial<WorkspaceImportReviewDialogProps> = {}
) {
  return render(
    <WorkspaceImportReviewDialog
      plan={reviewPlan}
      decisions={{}}
      onDecision={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />
  )
}

function ControlledReview({
  plan: reviewPlan,
  onDecisionObserved = vi.fn(),
  onConfirm = vi.fn()
}: {
  plan: WorkspaceImportPlan
  onDecisionObserved?: WorkspaceImportReviewDialogProps['onDecision']
  onConfirm?: () => void
}): JSX.Element {
  const [decisions, setDecisions] = useState<
    Record<string, WorkspaceImportCollisionDecision | undefined>
  >({})
  return (
    <WorkspaceImportReviewDialog
      plan={reviewPlan}
      decisions={decisions}
      onDecision={(artifactId, decision) => {
        onDecisionObserved(artifactId, decision)
        setDecisions((previous) => {
          if (decision === undefined) {
            const next = { ...previous }
            delete next[artifactId]
            return next
          }
          return { ...previous, [artifactId]: decision }
        })
      }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  )
}

describe('WorkspaceImportReviewDialog', () => {
  it('renders the exact sealed plan, every artifact and all review evidence', async () => {
    const download = vi.fn()
    const exactArtifact = artifact('artifact-exact', 'finance/exact output.bpmn', {
      sourceId: 'source-exact-id',
      sourceName: 'Exact source.aml',
      sourceKind: 'aml',
      sourcePath: 'ARIS/Exact source.aml',
      bytes: new Uint8Array(1_337),
      sha256: HASH_C,
      processIds: ['Process_Exact_A', 'Process_Exact_B'],
      replacesProcessIds: ['Process_Previous'],
      localizationReviewDigest: LOCALIZATION_DIGEST,
      localizationEvidence: {
        reviewMode: 'automatic-complete',
        reviewDigest: LOCALIZATION_DIGEST,
        outputDigest: HASH_C
      } as WorkspaceImportArtifact['localizationEvidence']
    })
    const evidencePlan = plan({
      artifacts: [exactArtifact],
      skipped: [
        {
          sourceId: 'source-skipped',
          sourceName: 'unsafe.bpmn',
          path: '../unsafe.bpmn',
          reason: 'unsafe-path',
          message: 'Exact skipped evidence message.'
        }
      ],
      warnings: [
        {
          code: 'warning.exact',
          sourceId: 'source-exact-id',
          artifactId: 'artifact-exact',
          message: 'Exact warning evidence message.',
          count: 7,
          validationIssue: validationIssue({
            code: 'semantic.exact',
            severity: 'warning',
            source: 'semantic',
            blocking: false,
            message: 'Exact validation issue message.'
          })
        }
      ],
      repairs: [
        {
          code: 'destination-normalized',
          sourceId: 'source-exact-id',
          artifactId: 'artifact-exact',
          message: 'Exact repair evidence message.',
          before: 'before\\exact.bpmn',
          after: 'before/exact.bpmn'
        }
      ],
      arisReports: [
        {
          sourceId: 'source-exact-id',
          sourceName: 'Exact source.aml',
          report: {
            summary: {
              converted: 11,
              downgraded: 12,
              ignored: 13,
              ambiguous: 14,
              unmapped: 15
            }
          },
          download: {
            fileName: 'exact-aris-report.json',
            mimeType: 'application/json',
            text: '{"exact":true}'
          }
        } as WorkspaceImportPlan['arisReports'][number]
      ],
      summary: {
        sources: 9,
        artifacts: 8,
        collisions: 7,
        skipped: 6,
        repairs: 5,
        warnings: 4,
        arisReports: 3,
        creates: 2,
        identical: 1
      }
    })

    renderDialog(evidencePlan, { onDownloadArisReport: download })

    expect(screen.getByText(REVIEW_DIGEST)).not.toBeNull()
    expect(screen.getByText('workspace-import-plan-exact')).not.toBeNull()
    expect(screen.getByText('2026-07-27T08:09:10.111Z')).not.toBeNull()
    expect(screen.getByText('workspace-exact-id')).not.toBeNull()
    expect(screen.getByText('ARIS/Exact source.aml')).not.toBeNull()
    expect(screen.getByText('finance/exact output.bpmn')).not.toBeNull()
    expect(screen.getByText('1337')).not.toBeNull()
    expect(screen.getByText(HASH_C)).not.toBeNull()
    expect(screen.getByText('Process_Exact_A')).not.toBeNull()
    expect(screen.getByText('Process_Exact_B')).not.toBeNull()
    expect(screen.getByText('Process_Previous')).not.toBeNull()
    expect(screen.getByText('automatic-complete')).not.toBeNull()
    expect(screen.getByText(LOCALIZATION_DIGEST)).not.toBeNull()
    expect(screen.getByText('Exact skipped evidence message.')).not.toBeNull()
    expect(screen.getByText('Exact warning evidence message.')).not.toBeNull()
    expect(screen.getByText(/semantic\.exact/)).not.toBeNull()
    expect(screen.getByText('Exact repair evidence message.')).not.toBeNull()
    expect(screen.getByText('before\\exact.bpmn')).not.toBeNull()
    expect(screen.getByText('before/exact.bpmn')).not.toBeNull()
    expect(screen.getByText('exact-aris-report.json')).not.toBeNull()

    const summary = screen.getByRole('heading', { name: 'Plan summary' }).nextElementSibling!
    expect(within(summary as HTMLElement).getByText('9')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('8')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('7')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('6')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('5')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('4')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('3')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('2')).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('1')).not.toBeNull()

    const arisCard = screen.getByRole('heading', {
      name: 'ARIS report 1: Exact source.aml'
    }).parentElement!
    for (const count of ['11', '12', '13', '14', '15']) {
      expect(within(arisCard).getByText(count)).not.toBeNull()
    }
    await userEvent.click(within(arisCard).getByRole('button', { name: 'Download ARIS report' }))
    expect(download).toHaveBeenCalledWith('source-exact-id')
  })

  it('previews only artifacts whose sealed repair evidence records auto-layout', () => {
    const untouched = artifact('artifact-untouched', 'target/untouched.bpmn')
    const repaired = artifact('artifact-repaired', 'target/repaired.bpmn', {
      xml: '<definitions id="reviewed-auto-layout"/>'
    })
    renderDialog(
      plan({
        artifacts: [untouched, repaired],
        repairs: [
          {
            code: 'destination-normalized',
            sourceId: untouched.sourceId,
            artifactId: untouched.id,
            message: 'Normalized destination.'
          },
          {
            code: 'auto-layout',
            sourceId: repaired.sourceId,
            artifactId: repaired.id,
            message: 'Generated missing DI.'
          }
        ]
      })
    )

    expect(screen.getByTestId('auto-layout-preview')).not.toBeNull()
    expect(previewMocks.props).toHaveBeenCalledOnce()
    expect(previewMocks.props.mock.calls[0]?.[0]).toEqual({
      artifacts: [
        {
          artifactId: repaired.id,
          sourceId: repaired.sourceId,
          sourceName: repaired.sourceName,
          sourcePath: repaired.sourcePath,
          destinationPath: repaired.destinationPath,
          reviewedXml: repaired.xml
        }
      ]
    })
  })

  it('defaults identical collisions to a disabled skip and blocks unresolved collisions', async () => {
    const user = userEvent.setup()
    const identicalArtifact = artifact('identical', 'target/identical.bpmn')
    const unresolvedArtifact = artifact('unresolved', 'target/unresolved.bpmn')
    const reviewPlan = plan({
      artifacts: [identicalArtifact, unresolvedArtifact],
      collisions: [
        collision('identical', identicalArtifact.destinationPath, {
          identical: true,
          existingHash: HASH_A
        }),
        collision('unresolved', unresolvedArtifact.destinationPath)
      ],
      summary: {
        sources: 2,
        artifacts: 2,
        collisions: 2,
        skipped: 0,
        repairs: 0,
        warnings: 0,
        arisReports: 0,
        creates: 0,
        identical: 1
      }
    })
    const confirm = vi.fn()
    render(<ControlledReview plan={reviewPlan} onConfirm={confirm} />)

    const selects = screen.getAllByLabelText('Collision decision') as HTMLSelectElement[]
    expect(selects[0]!.value).toBe('skip')
    expect(selects[0]!.disabled).toBe(true)
    expect(selects[1]!.value).toBe('')
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(true)

    await user.selectOptions(selects[1]!, 'replace')
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Confirm import' }))
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('reports replace, skip, and keep-both decisions by artifact ID', async () => {
    const user = userEvent.setup()
    const artifacts = [
      artifact('replace-id', 'target/replace.bpmn'),
      artifact('skip-id', 'target/skip.bpmn'),
      artifact('keep-id', 'target/keep.bpmn')
    ]
    const reviewPlan = plan({
      artifacts,
      collisions: artifacts.map((item) => collision(item.id, item.destinationPath)),
      summary: {
        sources: 3,
        artifacts: 3,
        collisions: 3,
        skipped: 0,
        repairs: 0,
        warnings: 0,
        arisReports: 0,
        creates: 0,
        identical: 0
      }
    })
    const observed = vi.fn()
    render(<ControlledReview plan={reviewPlan} onDecisionObserved={observed} />)
    const selects = screen.getAllByLabelText('Collision decision')

    await user.selectOptions(selects[0]!, 'replace')
    await user.selectOptions(selects[1]!, 'skip')
    await user.selectOptions(selects[2]!, 'keep-both')

    expect(observed).toHaveBeenCalledWith('replace-id', { action: 'replace' })
    expect(observed).toHaveBeenCalledWith('skip-id', { action: 'skip' })
    expect(observed).toHaveBeenCalledWith('keep-id', {
      action: 'keep-both',
      destinationPath: 'target/keep (1).bpmn'
    })
    const destination = screen.getByLabelText('Keep-both destination') as HTMLInputElement
    expect(destination.value).toBe('target/keep (1).bpmn')
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(false)

    await user.clear(destination)
    await user.type(destination, 'target/reviewed-copy.bpmn')
    expect(observed).toHaveBeenLastCalledWith('keep-id', {
      action: 'keep-both',
      destinationPath: 'target/reviewed-copy.bpmn'
    })
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('disables keep-both for identity replacements and single-file adapters', () => {
    const identityArtifact = artifact('identity', 'target/identity.bpmn', {
      replacesProcessIds: ['Process_Existing']
    })
    const identityPlan = plan({
      artifacts: [identityArtifact],
      collisions: [collision(identityArtifact.id, identityArtifact.destinationPath)]
    })
    const first = renderDialog(identityPlan)
    const identityKeepBoth = screen.getByRole('option', {
      name: 'Keep both files'
    }) as HTMLOptionElement
    expect(identityKeepBoth.disabled).toBe(true)
    expect(screen.getByText(/replaces existing process identities/)).not.toBeNull()
    first.unmount()

    const adapterArtifact = artifact('adapter', 'target/adapter.bpmn')
    renderDialog(
      plan({
        workspaceMode: 'single-file',
        workspaceMultipleFiles: false,
        artifacts: [adapterArtifact],
        collisions: [collision(adapterArtifact.id, adapterArtifact.destinationPath)]
      })
    )
    const adapterKeepBoth = screen.getByRole('option', {
      name: 'Keep both files'
    }) as HTMLOptionElement
    expect(adapterKeepBoth.disabled).toBe(true)
    expect(screen.getByText(/adapter cannot create multiple files/)).not.toBeNull()
  })

  it('blocks reserved, occupied, duplicate, and otherwise invalid keep-both destinations', async () => {
    const user = userEvent.setup()
    const artifacts = [
      artifact('keep-one', 'target/one.bpmn'),
      artifact('keep-two', 'target/two.bpmn')
    ]
    const reviewPlan = plan({
      artifacts,
      collisions: artifacts.map((item) => collision(item.id, item.destinationPath))
    })
    render(<ControlledReview plan={reviewPlan} />)
    const selects = screen.getAllByLabelText('Collision decision')
    await user.selectOptions(selects[0]!, 'keep-both')
    await user.selectOptions(selects[1]!, 'keep-both')
    const paths = screen.getAllByLabelText('Keep-both destination') as HTMLInputElement[]
    const confirm = screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement

    await user.clear(paths[0]!)
    await user.type(paths[0]!, '.orbitpm/reviewed.bpmn')
    expect(screen.getByText(/reserved \.orbitpm workspace namespace/)).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    await user.clear(paths[0]!)
    await user.type(paths[0]!, 'target/two.bpmn')
    expect(screen.getByText(/already occupied by an artifact/)).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    await user.clear(paths[0]!)
    await user.type(paths[0]!, '../invalid.bpmn')
    expect(screen.getByText(/valid relative workspace file path/)).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    await user.clear(paths[0]!)
    await user.type(paths[0]!, 'target/shared-copy.bpmn')
    await user.clear(paths[1]!)
    await user.type(paths[1]!, 'TARGET/shared-copy.bpmn')
    expect(screen.getAllByText(/cannot use the same destination/)).toHaveLength(2)
    expect(confirm.disabled).toBe(true)

    await user.clear(paths[1]!)
    await user.type(paths[1]!, 'target/second-copy.bpmn')
    expect(confirm.disabled).toBe(false)
  })

  it('resets editable keep-both state when the sealed review digest changes', async () => {
    const user = userEvent.setup()
    const firstArtifact = artifact('same-id', 'target/same.bpmn')
    const firstPlan = plan({
      reviewDigest: '1'.repeat(64),
      artifacts: [firstArtifact],
      collisions: [
        collision(firstArtifact.id, firstArtifact.destinationPath, {
          suggestedKeepBothPath: 'target/first suggestion.bpmn'
        })
      ]
    })
    const decisions = { 'same-id': { action: 'keep-both' as const } }
    const rendered = renderDialog(firstPlan, { decisions })
    const firstInput = screen.getByLabelText('Keep-both destination') as HTMLInputElement
    expect(firstInput.value).toBe('target/first suggestion.bpmn')
    await user.clear(firstInput)
    await user.type(firstInput, 'target/edited draft.bpmn')
    expect(firstInput.value).toBe('target/edited draft.bpmn')

    rendered.rerender(
      <WorkspaceImportReviewDialog
        plan={{
          ...firstPlan,
          reviewDigest: '2'.repeat(64),
          collisions: [
            {
              ...firstPlan.collisions[0]!,
              suggestedKeepBothPath: 'target/second suggestion.bpmn'
            }
          ]
        }}
        decisions={decisions}
        onDecision={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect((screen.getByLabelText('Keep-both destination') as HTMLInputElement).value).toBe(
      'target/second suggestion.bpmn'
    )
  })

  it('blocks confirmation and cancellation for busy state', () => {
    const blocked = renderDialog(plan({ status: 'blocked' }))
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(true)
    blocked.unmount()

    const reservedArtifact = artifact('reserved', '.orbitpm/reserved.bpmn')
    const reserved = renderDialog(
      plan({
        targetFolder: '.orbitpm',
        artifacts: [reservedArtifact]
      })
    )
    expect(screen.getByText(/plan contains a reserved \.orbitpm destination/)).not.toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(true)
    reserved.unmount()

    const cancel = vi.fn()
    renderDialog(plan(), { busy: true, error: 'Exact apply error.', onCancel: cancel })
    expect(
      (screen.getByRole('button', { name: 'Confirming…' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Close workspace import review'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Cancel import' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancel).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Exact apply error.')
  })

  it('only confirms explicitly and routes the close button, Cancel, and Escape to cancellation', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    const confirm = vi.fn()
    renderDialog(plan(), { onCancel: cancel, onConfirm: confirm })

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Review workspace import' })
    )
    await user.click(screen.getByRole('button', { name: 'Close workspace import review' }))
    await user.click(screen.getByRole('button', { name: 'Cancel import' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(3)
    expect(confirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm import' }))
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('uses RTL layout in Arabic while keeping exact technical evidence LTR', () => {
    setLang('ar')
    renderDialog(plan())
    const dialog = screen.getByRole('dialog', { name: 'مراجعة استيراد مساحة العمل' })
    expect(dialog.getAttribute('dir')).toBe('rtl')
    expect(within(dialog).getByText(REVIEW_DIGEST).closest('code')?.getAttribute('dir')).toBe('ltr')
  })
})
