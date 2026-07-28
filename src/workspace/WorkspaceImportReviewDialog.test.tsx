// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n'
import {
  createValidationSummary,
  validationIssue,
  type ValidationSeverity,
  type ValidationSource
} from '../validation'
import {
  WORKSPACE_IMPORT_EXACT_EVIDENCE_PAGE_SIZE,
  WORKSPACE_IMPORT_REVIEW_PAGE_SIZE,
  WorkspaceImportReviewDialog,
  type WorkspaceImportReviewDialogProps
} from './WorkspaceImportReviewDialog'
import { WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS } from './WorkspaceImportAutoLayoutPreview'
import type {
  WorkspaceImportArtifact,
  WorkspaceImportCollision,
  WorkspaceImportCollisionDecision,
  WorkspaceImportPlan,
  WorkspaceImportRepairCode,
  WorkspaceImportSkipReason
} from './importTransaction'

const previewMocks = vi.hoisted(() => ({
  props: vi.fn()
}))

vi.mock('./WorkspaceImportAutoLayoutPreview', async () => {
  const actual = await vi.importActual<typeof import('./WorkspaceImportAutoLayoutPreview')>(
    './WorkspaceImportAutoLayoutPreview'
  )
  return {
    ...actual,
    WorkspaceImportAutoLayoutPreview: (props: { artifacts: readonly unknown[] }) => {
      previewMocks.props(props)
      return <div data-testid="auto-layout-preview" />
    }
  }
})

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

// These two cases intentionally drive multiple paged jsdom surfaces. Keep their
// headroom local so a loaded full-suite run does not require a global timeout increase.
const PAGED_EVIDENCE_TEST_TIMEOUT_MS = 15_000
// This path drives 101 controlled collision rows and two page transitions; 20s
// preserves local headroom under full parallel contention without changing the suite default.
const PAGED_COLLISION_EDIT_TEST_TIMEOUT_MS = 20_000

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

function evidencePlan(count: number): WorkspaceImportPlan {
  const artifacts = Array.from({ length: count }, (_, index) =>
    artifact(`artifact-${index + 1}`, `target/artifact-${index + 1}.bpmn`)
  )
  const collisions = artifacts.map((item) => collision(item.id, item.destinationPath))
  return plan({
    artifacts,
    collisions,
    skipped: artifacts.map((item, index) => ({
      sourceId: `skipped-source-${index + 1}`,
      sourceName: `skipped-${index + 1}.bpmn`,
      reason: 'unsupported-content',
      message: `skipped-diagnostic-${index + 1}`
    })),
    warnings: artifacts.map((item, index) => ({
      code: 'same-path-process-replacement',
      sourceId: item.sourceId,
      artifactId: item.id,
      message: `warning-diagnostic-${index + 1}`
    })),
    repairs: artifacts.map((item, index) => ({
      code: 'destination-normalized',
      sourceId: item.sourceId,
      artifactId: item.id,
      message: `repair-diagnostic-${index + 1}`,
      before: `incoming\\artifact-${index + 1}.bpmn`,
      after: `incoming/artifact-${index + 1}.bpmn`
    })),
    arisReports: artifacts.map(
      (item, index) =>
        ({
          sourceId: item.sourceId,
          sourceName: `ARIS source ${index + 1}.aml`,
          report: {
            summary: {
              converted: index + 1,
              downgraded: 0,
              ignored: 0,
              ambiguous: 0,
              unmapped: 0
            }
          },
          download: {
            fileName: `aris-report-${index + 1}.json`,
            mimeType: 'application/json',
            text: '{}'
          }
        }) as WorkspaceImportPlan['arisReports'][number]
    ),
    summary: {
      sources: count,
      artifacts: count,
      collisions: count,
      skipped: count,
      repairs: count,
      warnings: count,
      arisReports: count,
      creates: 0,
      identical: 0
    }
  })
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

function replaceControlledInputValue(input: HTMLInputElement, value: string): void {
  // One change event models replacing the field while avoiding userEvent's
  // per-character focus dependency across controlled rerenders.
  fireEvent.change(input, { target: { value } })
}

function ControlledReview({
  plan: reviewPlan,
  onDecisionObserved = vi.fn(),
  onConfirm = vi.fn(),
  initialDecisions = {}
}: {
  plan: WorkspaceImportPlan
  onDecisionObserved?: WorkspaceImportReviewDialogProps['onDecision']
  onConfirm?: () => void
  initialDecisions?: Record<string, WorkspaceImportCollisionDecision | undefined>
}): JSX.Element {
  const [decisions, setDecisions] =
    useState<Record<string, WorkspaceImportCollisionDecision | undefined>>(initialDecisions)
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
  it('keeps every top-level evidence surface bounded at the 2,500-artifact supported limit', () => {
    const supportedLimit = 2_500
    renderDialog(evidencePlan(supportedLimit))

    const listIds = [
      'workspace-import-review-artifact-list',
      'workspace-import-review-skipped-list',
      'workspace-import-review-warning-list',
      'workspace-import-review-repair-list',
      'workspace-import-review-aris-list',
      'workspace-import-review-collision-list'
    ]
    for (const listId of listIds) {
      const list = document.getElementById(listId)
      expect(list).not.toBeNull()
      expect(list?.children).toHaveLength(WORKSPACE_IMPORT_REVIEW_PAGE_SIZE)
      expect(list?.children[0]?.getAttribute('aria-setsize')).toBe(String(supportedLimit))
    }
    expect(document.querySelectorAll('.workspace-import-review__card')).toHaveLength(
      WORKSPACE_IMPORT_REVIEW_PAGE_SIZE * listIds.length
    )
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(screen.queryByText('artifact-2500')).toBeNull()
  }, 15_000)

  it(
    'makes every paged artifact and evidence item, including nested exact IDs, reachable',
    () => {
      const count = WORKSPACE_IMPORT_REVIEW_PAGE_SIZE + 3
      const base = evidencePlan(count)
      const processIds = Array.from(
        { length: WORKSPACE_IMPORT_EXACT_EVIDENCE_PAGE_SIZE + 3 },
        (_, index) => `Process_Reachable_${index + 1}`
      )
      const reviewPlan = {
        ...base,
        artifacts: [{ ...base.artifacts[0]!, processIds }, ...base.artifacts.slice(1)]
      }
      renderDialog(reviewPlan)

      const firstArtifact = document.getElementById('workspace-import-review-artifact-list')
        ?.children[0] as HTMLElement
      const reachedProcessIds = new Set<string>()
      for (;;) {
        const exactItems = [
          ...firstArtifact.querySelectorAll('.workspace-import-review__exact-list li')
        ]
        expect(exactItems.length).toBeLessThanOrEqual(WORKSPACE_IMPORT_EXACT_EVIDENCE_PAGE_SIZE)
        for (const item of exactItems) {
          const value = item.textContent
          if (value?.startsWith('Process_Reachable_')) reachedProcessIds.add(value)
        }
        const next = within(firstArtifact).queryByRole('button', {
          name: 'Next Process IDs: artifact-1 page'
        }) as HTMLButtonElement | null
        if (!next || next.disabled) break
        fireEvent.click(next)
      }
      expect(reachedProcessIds).toEqual(new Set(processIds))

      const pagedLists = [
        {
          id: 'workspace-import-review-artifact-list',
          next: 'Next Prepared artifacts page'
        },
        {
          id: 'workspace-import-review-skipped-list',
          next: 'Next Skipped inputs page'
        },
        {
          id: 'workspace-import-review-warning-list',
          next: 'Next Warnings page'
        },
        {
          id: 'workspace-import-review-repair-list',
          next: 'Next Automatic repairs page'
        },
        {
          id: 'workspace-import-review-aris-list',
          next: 'Next ARIS conversion reports page'
        },
        {
          id: 'workspace-import-review-collision-list',
          next: 'Next Destination collisions page'
        }
      ]
      for (const spec of pagedLists) {
        const list = document.getElementById(spec.id) as HTMLElement
        const reachedPositions = new Set<number>()
        for (;;) {
          expect(list.children.length).toBeLessThanOrEqual(WORKSPACE_IMPORT_REVIEW_PAGE_SIZE)
          for (const item of [...list.children]) {
            reachedPositions.add(Number(item.getAttribute('aria-posinset')))
            expect(item.getAttribute('aria-setsize')).toBe(String(count))
          }
          const next = screen.getByRole('button', { name: spec.next }) as HTMLButtonElement
          expect(next.getAttribute('aria-controls')).toBe(spec.id)
          if (next.disabled) break
          fireEvent.click(next)
        }
        expect(reachedPositions).toEqual(
          new Set(Array.from({ length: count }, (_, index) => index + 1))
        )
      }

      expect(screen.getByText(`skipped-diagnostic-${count}`)).not.toBeNull()
      expect(screen.getByText(`warning-diagnostic-${count}`)).not.toBeNull()
      expect(screen.getByText(`repair-diagnostic-${count}`)).not.toBeNull()
      expect(screen.getByText(`aris-report-${count}.json`)).not.toBeNull()
    },
    PAGED_EVIDENCE_TEST_TIMEOUT_MS
  )

  it('localizes page navigation in Arabic and reaches the final artifact', async () => {
    const user = userEvent.setup()
    const count = WORKSPACE_IMPORT_REVIEW_PAGE_SIZE + 1
    setLang('ar')
    renderDialog(evidencePlan(count))

    const navigation = screen.getByRole('navigation', { name: 'صفحات المخرجات المجهزة' })
    expect(within(navigation).getByRole('status').textContent).toMatch(/[\u0600-\u06ff]/u)
    await user.click(
      within(navigation).getByRole('button', { name: 'صفحة المخرجات المجهزة التالية' })
    )
    expect(screen.getByText(`artifact-${count}`)).not.toBeNull()
    expect(within(navigation).getByRole('status').textContent).toContain(`${count}`)
  })

  it('localizes every skip reason while preserving its exact evidence code and a safe fallback', async () => {
    const user = userEvent.setup()
    setLang('ar')
    const reasons = [
      'unsupported-content',
      'unsafe-path',
      'invalid-bpmn',
      'aml-conversion-failed',
      'process-id-collision',
      'process-identity-changed',
      'localization-review-required',
      'localization-review-cancelled',
      'localization-invalid',
      'destination-parent-file',
      'library-not-bpmn',
      'library-unsafe-path',
      'library-too-large',
      'library-decode-failed'
    ] as const satisfies readonly WorkspaceImportSkipReason[]
    const futureReason = 'future-skip-reason' as WorkspaceImportSkipReason
    renderDialog(
      plan({
        skipped: [...reasons, futureReason].map((reason, index) => ({
          sourceId: `skipped-${index}`,
          sourceName: `skipped-${index}.bpmn`,
          reason,
          message: `evidence-${index}`
        }))
      })
    )

    const labels: string[] = []
    const codes: Array<string | null> = []
    const messages: string[] = []
    const repairs: string[] = []
    const diagnosticValues: Array<string | null> = []
    const skippedSection = screen
      .getByRole('heading', { name: 'المدخلات المتخطاة' })
      .closest('section') as HTMLElement

    for (;;) {
      labels.push(
        ...[...skippedSection.querySelectorAll('[data-workspace-import-skip-reason-label]')].map(
          (element) => element.textContent ?? ''
        )
      )
      codes.push(
        ...[...skippedSection.querySelectorAll('[data-workspace-import-skip-reason-code]')].map(
          (element) => element.textContent
        )
      )
      messages.push(
        ...[...skippedSection.querySelectorAll('[data-workspace-import-localized-message]')].map(
          (element) => element.textContent ?? ''
        )
      )
      repairs.push(
        ...[...skippedSection.querySelectorAll('[data-workspace-import-localized-repair]')].map(
          (element) => element.textContent ?? ''
        )
      )
      const diagnostics = [
        ...skippedSection.querySelectorAll('[data-workspace-import-technical-diagnostic]')
      ]
      diagnosticValues.push(...diagnostics.map((element) => element.textContent))
      for (const evidence of [
        ...skippedSection.querySelectorAll('[data-workspace-import-skip-reason-code]'),
        ...diagnostics
      ]) {
        expect(evidence.tagName).toBe('CODE')
        expect(evidence.getAttribute('lang')).toBe('en')
        expect(evidence.getAttribute('dir')).toBe('ltr')
      }
      const next = within(skippedSection).queryByRole('button', {
        name: 'صفحة المدخلات المتخطاة التالية'
      }) as HTMLButtonElement | null
      if (!next || next.disabled) break
      await user.click(next)
    }

    expect(labels).toHaveLength(reasons.length + 1)
    expect(labels.every((label) => /[\u0600-\u06ff]/u.test(label))).toBe(true)
    expect(
      labels
        .slice(0, reasons.length)
        .some((label) => (reasons as readonly string[]).includes(label))
    ).toBe(false)
    expect(labels.at(-1)).toBe('سبب تخطٍ غير معروف')
    expect(codes).toEqual([...reasons, futureReason])
    expect(messages).toHaveLength(reasons.length + 1)
    expect(messages.every((message) => /[\u0600-\u06ff]/u.test(message))).toBe(true)
    expect(repairs.every((repair) => /[\u0600-\u06ff]/u.test(repair))).toBe(true)
    expect(messages.at(-1)).toBe('تم تخطي المدخل لسبب لا يتعرف عليه هذا الإصدار.')
    expect(repairs.at(-1)).toContain('الدليل التقني')
    expect(diagnosticValues).toEqual(
      [...reasons, futureReason].map((_, index) => `evidence-${index}`)
    )
  })

  it('localizes every repair and known warning while retaining raw diagnostics as evidence', () => {
    setLang('ar')
    const repairCodes = [
      'aml-converted',
      'auto-layout',
      'destination-normalized',
      'destination-deduplicated',
      'destination-case-normalized'
    ] as const satisfies readonly WorkspaceImportRepairCode[]
    const futureRepair = 'future-repair' as WorkspaceImportRepairCode
    const warningCodes = [
      'aml-downgraded',
      'aml-ignored',
      'aml-ambiguous',
      'aml-unmapped',
      'same-path-process-replacement'
    ] as const
    const exactArtifact = artifact('artifact-a', 'target/artifact-a.bpmn')
    renderDialog(
      plan({
        artifacts: [exactArtifact],
        repairs: [...repairCodes, futureRepair].map((code, index) => ({
          code,
          sourceId: exactArtifact.sourceId,
          artifactId: exactArtifact.id,
          message: `raw-repair-${index}`
        })),
        warnings: [
          ...warningCodes.map((code, index) => ({
            code,
            sourceId: exactArtifact.sourceId,
            artifactId: exactArtifact.id,
            message: `raw-warning-${index}`,
            count: index + 1
          })),
          {
            code: 'future-warning',
            sourceId: exactArtifact.sourceId,
            artifactId: exactArtifact.id,
            message: 'raw-warning-future'
          },
          {
            code: 'bpmnlint.label-required',
            sourceId: exactArtifact.sourceId,
            artifactId: exactArtifact.id,
            message: 'raw-warning-wrapper',
            validationIssue: validationIssue({
              code: 'bpmnlint.label-required',
              severity: 'warning',
              source: 'bpmnlint',
              blocking: false,
              ruleId: 'label-required',
              message: 'raw-validation-diagnostic'
            })
          }
        ]
      })
    )

    const warningSection = screen
      .getByRole('heading', { name: 'التحذيرات' })
      .closest('section') as HTMLElement
    const repairSection = screen
      .getByRole('heading', { name: 'الإصلاحات التلقائية' })
      .closest('section') as HTMLElement
    const warningMessages = [
      ...warningSection.querySelectorAll('[data-workspace-import-localized-message]')
    ].map((element) => element.textContent ?? '')
    const warningRepairs = [
      ...warningSection.querySelectorAll('[data-workspace-import-localized-repair]')
    ].map((element) => element.textContent ?? '')
    const repairMessages = [
      ...repairSection.querySelectorAll('[data-workspace-import-localized-message]')
    ].map((element) => element.textContent ?? '')

    expect(warningMessages).toHaveLength(warningCodes.length + 2)
    expect(warningMessages.every((message) => /[\u0600-\u06ff]/u.test(message))).toBe(true)
    expect(warningRepairs.every((repair) => /[\u0600-\u06ff]/u.test(repair))).toBe(true)
    expect(warningMessages[0]).toContain(new Intl.NumberFormat('ar').format(1))
    expect(warningMessages.at(-2)).toBe('أبلغ مخطط الاستيراد عن تحذير لا يتعرف عليه هذا الإصدار.')
    expect(repairMessages).toHaveLength(repairCodes.length + 1)
    expect(repairMessages.every((message) => /[\u0600-\u06ff]/u.test(message))).toBe(true)
    expect(repairMessages.at(-1)).toBe('طبّق المخطط إصلاحًا تلقائيًا لا يتعرف عليه هذا الإصدار.')

    const rawDiagnostics = [
      ...document.querySelectorAll('[data-workspace-import-technical-diagnostic]')
    ]
    expect(rawDiagnostics).toHaveLength(warningCodes.length + 2 + repairCodes.length + 1)
    expect(rawDiagnostics.map((element) => element.textContent)).toEqual([
      ...warningCodes.map((_, index) => `raw-warning-${index}`),
      'raw-warning-future',
      'raw-warning-wrapper',
      ...repairCodes.map((_, index) => `raw-repair-${index}`),
      `raw-repair-${repairCodes.length}`
    ])
    for (const diagnostic of rawDiagnostics) {
      expect(diagnostic.tagName).toBe('CODE')
      expect(diagnostic.getAttribute('lang')).toBe('en')
      expect(diagnostic.getAttribute('dir')).toBe('ltr')
    }
    const validationDiagnostic = document.querySelector(
      '[data-workspace-import-validation-diagnostic]'
    )
    expect(validationDiagnostic?.textContent).toBe('raw-validation-diagnostic')
    expect(validationDiagnostic?.getAttribute('lang')).toBe('en')
    const ruleId = within(warningSection).getByText('label-required')
    expect(ruleId.tagName).toBe('CODE')
    expect(ruleId.getAttribute('lang')).toBe('en')
  })

  it('localizes every sealed validation severity and source while retaining exact code and rule evidence', () => {
    setLang('ar')
    const severities = ['error', 'warning', 'info'] as const satisfies readonly ValidationSeverity[]
    const sources = [
      'xml',
      'moddle',
      'xsd',
      'bpmnlint',
      'structure',
      'semantic',
      'di',
      'orbitpm',
      'preservation'
    ] as const satisfies readonly ValidationSource[]
    const exactArtifact = artifact('validation-evidence', 'target/validation-evidence.bpmn')
    const warnings = sources.map((source, index) => {
      const code = `sealed.${source}.${index}`
      const ruleId = `rule-${source}-${index}`
      return {
        code: `warning-wrapper-${index}`,
        sourceId: exactArtifact.sourceId,
        artifactId: exactArtifact.id,
        message: `wrapper-${index}`,
        validationIssue: validationIssue({
          code,
          severity: severities[index % severities.length],
          source,
          blocking: false,
          ruleId,
          message: `diagnostic-${index}`
        })
      }
    })
    warnings.push({
      code: 'warning-wrapper-future',
      sourceId: exactArtifact.sourceId,
      artifactId: exactArtifact.id,
      message: 'wrapper-future',
      validationIssue: validationIssue({
        code: 'sealed.future',
        severity: 'future-severity' as ValidationSeverity,
        source: 'future-source' as ValidationSource,
        blocking: false,
        ruleId: 'rule-future',
        message: 'diagnostic-future'
      })
    })

    renderDialog(plan({ artifacts: [exactArtifact], warnings }))

    const severityLabels = [
      ...document.querySelectorAll('[data-workspace-import-validation-severity]')
    ].map((element) => element.textContent ?? '')
    const sourceLabels = [
      ...document.querySelectorAll('[data-workspace-import-validation-source]')
    ].map((element) => element.textContent ?? '')
    expect(severityLabels).toHaveLength(sources.length + 1)
    expect(sourceLabels).toHaveLength(sources.length + 1)
    expect(severityLabels.every((label) => /[\u0600-\u06ff]/u.test(label))).toBe(true)
    expect(sourceLabels.every((label) => /[\u0600-\u06ff]/u.test(label))).toBe(true)
    expect(severityLabels).not.toEqual(expect.arrayContaining([...severities]))
    expect(sourceLabels).not.toEqual(expect.arrayContaining([...sources]))
    expect(severityLabels.at(-1)).toBe('خطورة تحقق غير معروفة')
    expect(sourceLabels.at(-1)).toBe('مصدر تحقق غير معروف')

    const exactCodes = [...document.querySelectorAll('[data-workspace-import-validation-code]')]
    const exactRules = [...document.querySelectorAll('[data-workspace-import-validation-rule]')]
    expect(exactCodes.map((element) => element.textContent)).toEqual([
      ...sources.map((source, index) => `sealed.${source}.${index}`),
      'sealed.future'
    ])
    expect(exactRules.map((element) => element.textContent)).toEqual([
      ...sources.map((source, index) => `rule-${source}-${index}`),
      'rule-future'
    ])
    for (const evidence of [...exactCodes, ...exactRules]) {
      expect(evidence.tagName).toBe('CODE')
      expect(evidence.getAttribute('lang')).toBe('en')
      expect(evidence.getAttribute('dir')).toBe('ltr')
    }
  })

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

  it('requires explicit acceptance of the sealed auto-layout repair set and resets it by review digest', async () => {
    const user = userEvent.setup()
    const repaired = artifact('accept-layout', 'target/accept-layout.bpmn')
    const reviewPlan = plan({
      reviewDigest: '4'.repeat(64),
      artifacts: [repaired],
      repairs: [
        {
          code: 'auto-layout',
          sourceId: repaired.sourceId,
          artifactId: repaired.id,
          message: 'Generated missing DI.'
        }
      ]
    })
    const confirm = vi.fn()
    const rendered = renderDialog(reviewPlan, { onConfirm: confirm })
    const acceptance = screen.getByRole('checkbox', {
      name: 'I accept every listed auto-layout repair (1 total).'
    }) as HTMLInputElement
    const confirmButton = screen.getByRole('button', {
      name: 'Confirm import'
    }) as HTMLButtonElement

    expect(acceptance.checked).toBe(false)
    expect(confirmButton.disabled).toBe(true)
    expect(
      screen.getByText('Accept all listed auto-layout repairs before confirming this import.')
    ).not.toBeNull()
    await user.click(acceptance)
    expect(acceptance.checked).toBe(true)
    expect(confirmButton.disabled).toBe(false)
    expect(screen.getByText(/previews are available on demand/i)).not.toBeNull()
    await user.click(confirmButton)
    expect(confirm).toHaveBeenCalledOnce()

    rendered.rerender(
      <WorkspaceImportReviewDialog
        plan={reviewPlan}
        decisions={{}}
        onDecision={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'I accept every listed auto-layout repair (1 total).'
        }) as HTMLInputElement
      ).checked
    ).toBe(true)

    rendered.rerender(
      <WorkspaceImportReviewDialog
        plan={{ ...reviewPlan, reviewDigest: '5'.repeat(64) }}
        decisions={{}}
        onDecision={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'I accept every listed auto-layout repair (1 total).'
        }) as HTMLInputElement
      ).checked
    ).toBe(false)
    expect(
      (screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('localizes the auto-layout acceptance decision in Arabic', async () => {
    const user = userEvent.setup()
    setLang('ar')
    const repaired = artifact('accept-layout-ar', 'target/accept-layout-ar.bpmn')
    renderDialog(
      plan({
        artifacts: [repaired],
        repairs: [
          {
            code: 'auto-layout',
            sourceId: repaired.sourceId,
            artifactId: repaired.id,
            message: 'Generated missing DI.'
          }
        ]
      })
    )

    const acceptance = screen.getByRole('checkbox', {
      name: 'أوافق على جميع إصلاحات التخطيط التلقائي المدرجة وعددها 1.'
    }) as HTMLInputElement
    expect(acceptance.checked).toBe(false)
    expect(
      screen.getByText('وافق على جميع إصلاحات التخطيط التلقائي المدرجة قبل تأكيد هذا الاستيراد.')
    ).not.toBeNull()
    await user.click(acceptance)
    expect(acceptance.checked).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'تأكيد الاستيراد' }) as HTMLButtonElement).disabled
    ).toBe(false)
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

  it('keeps confirmation blocked for an off-page unresolved collision, then enables it when resolved', async () => {
    const user = userEvent.setup()
    const count = WORKSPACE_IMPORT_REVIEW_PAGE_SIZE + 1
    const reviewPlan = evidencePlan(count)
    const initialDecisions = Object.fromEntries(
      reviewPlan.collisions
        .slice(0, -1)
        .map(({ artifactId }) => [artifactId, { action: 'replace' as const }])
    )
    render(<ControlledReview plan={reviewPlan} initialDecisions={initialDecisions} />)

    const confirm = screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(screen.getByText(/1 non-identical collision decision/)).not.toBeNull()
    await user.click(
      screen.getByRole('button', {
        name: 'Next Destination collisions page'
      })
    )
    const offPageDecision = screen.getByLabelText('Collision decision') as HTMLSelectElement
    expect(offPageDecision.value).toBe('')
    await user.selectOptions(offPageDecision, 'replace')
    expect(confirm.disabled).toBe(false)
  })

  it(
    'preserves keep-both drafts across pages and detects off-page duplicate destinations globally',
    async () => {
      const user = userEvent.setup()
      const count = WORKSPACE_IMPORT_REVIEW_PAGE_SIZE + 1
      const reviewPlan = evidencePlan(count)
      const initialDecisions = Object.fromEntries(
        reviewPlan.collisions.map(({ artifactId }) => [artifactId, { action: 'replace' as const }])
      )
      render(<ControlledReview plan={reviewPlan} initialDecisions={initialDecisions} />)

      const confirm = screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement
      const firstDecision = screen.getAllByLabelText('Collision decision')[0]!
      await user.selectOptions(firstDecision, 'keep-both')
      const firstPath = screen.getByLabelText('Keep-both destination') as HTMLInputElement
      replaceControlledInputValue(firstPath, 'target/persisted-copy.bpmn')
      expect(confirm.disabled).toBe(false)

      await user.click(
        screen.getByRole('button', {
          name: 'Next Destination collisions page'
        })
      )
      const offPageDecision = screen.getByLabelText('Collision decision')
      await user.selectOptions(offPageDecision, 'keep-both')
      const offPagePath = screen.getByLabelText('Keep-both destination') as HTMLInputElement
      replaceControlledInputValue(offPagePath, 'TARGET/PERSISTED-COPY.BPMN')
      expect(confirm.disabled).toBe(true)
      expect(screen.getByText(/cannot use the same destination/)).not.toBeNull()

      await user.click(
        screen.getByRole('button', {
          name: 'Previous Destination collisions page'
        })
      )
      const restoredFirstPath = screen.getByLabelText('Keep-both destination') as HTMLInputElement
      expect(restoredFirstPath.value).toBe('target/persisted-copy.bpmn')
      expect((screen.getAllByLabelText('Collision decision')[0] as HTMLSelectElement).value).toBe(
        'keep-both'
      )
      expect(screen.getByText(/cannot use the same destination/)).not.toBeNull()
    },
    PAGED_COLLISION_EDIT_TEST_TIMEOUT_MS
  )

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

    replaceControlledInputValue(destination, 'target/reviewed-copy.bpmn')
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

    replaceControlledInputValue(paths[0]!, '.orbitpm/reviewed.bpmn')
    expect(screen.getByText(/reserved \.orbitpm workspace namespace/)).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    replaceControlledInputValue(paths[0]!, 'target/two.bpmn')
    expect(screen.getByText(/already occupied by an artifact/)).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    replaceControlledInputValue(paths[0]!, '../invalid.bpmn')
    expect(screen.getByText(/valid relative workspace file path/)).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    replaceControlledInputValue(paths[0]!, 'target/shared-copy.bpmn')
    replaceControlledInputValue(paths[1]!, 'TARGET/shared-copy.bpmn')
    expect(screen.getAllByText(/cannot use the same destination/)).toHaveLength(2)
    expect(confirm.disabled).toBe(true)

    replaceControlledInputValue(paths[1]!, 'target/second-copy.bpmn')
    expect(confirm.disabled).toBe(false)
  })

  it('resets editable keep-both state when the sealed review digest changes', () => {
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
    replaceControlledInputValue(firstInput, 'target/edited draft.bpmn')
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

  it('returns every evidence window to its first page when the sealed review digest changes', async () => {
    const user = userEvent.setup()
    const firstPlan = {
      ...evidencePlan(WORKSPACE_IMPORT_REVIEW_PAGE_SIZE + 1),
      reviewDigest: '7'.repeat(64)
    }
    const rendered = renderDialog(firstPlan)
    await user.click(
      screen.getByRole('button', {
        name: 'Next Prepared artifacts page'
      })
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Next Destination collisions page'
      })
    )
    expect(
      screen.getAllByText(`artifact-${WORKSPACE_IMPORT_REVIEW_PAGE_SIZE + 1}`).length
    ).toBeGreaterThan(0)

    rendered.rerender(
      <WorkspaceImportReviewDialog
        plan={{ ...firstPlan, reviewDigest: '8'.repeat(64) }}
        decisions={{}}
        onDecision={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const artifactList = document.getElementById('workspace-import-review-artifact-list')!
    const collisionList = document.getElementById('workspace-import-review-collision-list')!
    expect(artifactList.children[0]?.getAttribute('aria-posinset')).toBe('1')
    expect(collisionList.children[0]?.getAttribute('aria-posinset')).toBe('1')
    expect(
      (
        screen.getByRole('button', {
          name: 'Previous Prepared artifacts page'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Previous Destination collisions page'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it('bounds megabyte diagnostics Unicode-safely while preserving exact repair path evidence', () => {
    const exactArtifact = artifact('bounded-evidence', 'target/bounded-evidence.bpmn')
    const rawDiagnostic = `secret-provider-detail:${'😀'.repeat(600_000)}`
    const exactBefore = `incoming/${'x'.repeat(1_024)}.bpmn`
    const exactAfter = `reviewed/${'y'.repeat(1_024)}.bpmn`
    renderDialog(
      plan({
        artifacts: [exactArtifact],
        skipped: [
          {
            sourceId: 'large-diagnostic-source',
            sourceName: 'large-diagnostic.bpmn',
            reason: 'invalid-bpmn',
            message: rawDiagnostic
          }
        ],
        repairs: [
          {
            code: 'destination-normalized',
            sourceId: exactArtifact.sourceId,
            artifactId: exactArtifact.id,
            message: 'Normalized exact path evidence.',
            before: exactBefore,
            after: exactAfter
          }
        ]
      }),
      { error: rawDiagnostic }
    )

    const skippedSection = screen
      .getByRole('heading', { name: 'Skipped inputs' })
      .closest('section') as HTMLElement
    const itemEvidence = skippedSection.querySelector(
      '[data-workspace-import-technical-diagnostic]'
    ) as HTMLElement
    const applyEvidence = document.querySelector(
      '[data-workspace-import-apply-technical-diagnostic]'
    ) as HTMLElement
    for (const evidence of [itemEvidence, applyEvidence]) {
      expect(Array.from(evidence.textContent ?? '')).toHaveLength(
        WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS
      )
      expect(evidence.textContent?.endsWith('…')).toBe(true)
      expect(evidence.textContent?.includes('\uFFFD')).toBe(false)
    }
    expect(document.querySelectorAll('[data-workspace-import-technical-truncation]')).toHaveLength(
      2
    )
    expect(screen.getByRole('alert').textContent).not.toContain('secret-provider-detail')
    expect(screen.getByText(exactBefore)).not.toBeNull()
    expect(screen.getByText(exactAfter)).not.toBeNull()
    expect(document.body.textContent).not.toContain(rawDiagnostic)
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
    expect(screen.getByRole('alert').textContent).not.toContain('Exact apply error.')
    const applyEvidence = document.querySelector(
      '[data-workspace-import-apply-technical-diagnostic]'
    )
    expect(applyEvidence?.textContent).toBe('Exact apply error.')
    expect(applyEvidence?.getAttribute('dir')).toBe('auto')
    expect(applyEvidence?.hasAttribute('lang')).toBe(false)
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

  // `WorkspaceImportSkipReason` (owned by ./importTransaction) does not yet
  // carry the 'bpmn-not-supported' literal, so this reason can only be
  // constructed here via a cast — the same idiom the "future-skip-reason"
  // case above uses for a reason this build's copy doesn't recognize at all.
  // Unlike that case, this dialog's own skip-diagnostic map *does* already
  // carry dedicated ARIS-only copy for 'bpmn-not-supported' (Phase 2
  // exit-gate, plan §5.2); this proves that copy actually resolves — in both
  // languages — once a caller starts producing the reason.
  it('resolves dedicated ARIS-only copy for the bpmn-not-supported skip reason in English and Arabic', () => {
    const reason = 'bpmn-not-supported' as WorkspaceImportSkipReason
    const skipped = [
      {
        sourceId: 'skipped-bpmn',
        sourceName: 'legacy.bpmn',
        reason,
        message: 'evidence-bpmn-not-supported'
      }
    ]

    setLang('en');
    {
      const { unmount } = renderDialog(plan({ skipped }))
      const skippedSection = screen.getByRole('heading', { name: 'Skipped inputs' }).closest('section') as HTMLElement
      expect(
        within(skippedSection).getByText('BPMN input is not supported in this build')
      ).not.toBeNull()
      expect(
        within(skippedSection).getByText(
          'The input was skipped because this ARIS-only build accepts ARIS AML/XML exports only.'
        )
      ).not.toBeNull()
      unmount()
    }

    setLang('ar')
    {
      const { unmount } = renderDialog(plan({ skipped }))
      const skippedSection = screen.getByRole('heading', { name: 'المدخلات المتخطاة' }).closest('section') as HTMLElement
      expect(
        within(skippedSection).getByText('إدخال BPMN غير مدعوم في هذا الإصدار')
      ).not.toBeNull()
      expect(
        within(skippedSection).getByText(
          'تم تخطي المدخل لأن هذا الإصدار المقتصر على ARIS يقبل فقط صادرات ARIS AML/XML.'
        )
      ).not.toBeNull()
      unmount()
    }
  })
})
