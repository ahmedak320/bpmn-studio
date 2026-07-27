// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n'
import {
  type WorkspaceBackupImportCandidate,
  type WorkspaceBackupImportPlan,
  type WorkspaceBackupReviewedBpmn
} from './adapters'
import { BackupImportDialog } from './BackupImportDialog'

const dialogCss = readFileSync(
  resolve(process.cwd(), 'src/workspace/BackupImportDialog.css'),
  'utf8'
)
const PLAN_DIGEST = 'a'.repeat(64)
const LOCALIZATION_DIGEST = 'b'.repeat(64)
const OUTPUT_DIGEST = 'c'.repeat(64)
const EXISTING_DIGEST = 'd'.repeat(64)

function reviewedBpmn(replacesProcessIds: readonly string[] = []): WorkspaceBackupReviewedBpmn {
  return {
    reviewDigest: LOCALIZATION_DIGEST,
    outputDigest: OUTPUT_DIGEST,
    processIds: ['Process_Active', 'Process_Secondary'],
    replacesProcessIds,
    evidence: {
      reviewMode: 'explicit',
      target: 'ar',
      initialAudit: { issues: [{ code: 'missing' }, { code: 'wrong-script' }] },
      finalAudit: { issues: [] },
      appliedPatches: { changed: 4 }
    } as unknown as WorkspaceBackupReviewedBpmn['evidence']
  }
}

function candidate(
  path: string,
  reviewed?: WorkspaceBackupReviewedBpmn
): WorkspaceBackupImportCandidate {
  return {
    path,
    bytes: new Uint8Array([60, 120, 109, 108, 47, 62]),
    archiveSha256: OUTPUT_DIGEST,
    sha256: OUTPUT_DIGEST,
    ...(reviewed ? { reviewedBpmn: reviewed } : {})
  }
}

function plan({
  files = [candidate('active/process.bpmn', reviewedBpmn())],
  collisionPath
}: {
  files?: readonly WorkspaceBackupImportCandidate[]
  collisionPath?: string
} = {}): WorkspaceBackupImportPlan {
  return {
    manifest: {
      format: 'orbitpm-workspace-backup',
      version: 1,
      generatedAt: '2026-07-27T00:00:00.000Z',
      workspace: { id: 'source-workspace', mode: 'directory' },
      checksumAlgorithm: 'SHA-256',
      directories: [],
      files: []
    },
    directories: [],
    files,
    collisions: collisionPath
      ? [
          {
            path: collisionPath,
            incomingHash: OUTPUT_DIGEST,
            existing: {
              path: collisionPath,
              bytes: new Uint8Array([1, 2, 3]),
              hash: EXISTING_DIGEST,
              size: 3,
              modifiedAt: 1_712_345_678_900
            },
            identical: false
          }
        ]
      : [],
    compressedBytes: 512,
    declaredUncompressedBytes: 4_096,
    workspaceId: 'target-workspace',
    workspaceMultipleFiles: true,
    processIdentitySnapshot: [],
    processIdentityDigest: 'e'.repeat(64),
    integrityDigest: 'f'.repeat(64),
    reviewDigest: PLAN_DIGEST
  }
}

beforeEach(() => {
  setLang('en')
})

afterEach(() => {
  cleanup()
  setLang('en')
})

describe('BackupImportDialog reviewed evidence', () => {
  it('shows the exact sealed digest and active BPMN localization evidence accessibly', async () => {
    const reviewPlan = plan({
      files: [
        candidate('active/process.bpmn', reviewedBpmn(['Process_Existing'])),
        candidate('.orbitpm/history/revision.bpmn')
      ]
    })
    render(<BackupImportDialog plan={reviewPlan} onApply={vi.fn()} onCancel={vi.fn()} />)

    const dialog = screen.getByRole('dialog', {
      name: 'Review backup file collisions',
      description: /Review the exact sealed backup plan/
    })
    expect(document.activeElement).toBe(
      within(dialog).getByRole('heading', { name: 'Review backup file collisions' })
    )
    expect(within(dialog).getByText(PLAN_DIGEST).closest('code')?.getAttribute('dir')).toBe('ltr')
    expect(within(dialog).getByText('active/process.bpmn')).not.toBeNull()
    expect(within(dialog).getByText('Explicitly reviewed')).not.toBeNull()
    expect(within(dialog).getByText('Arabic')).not.toBeNull()
    expect(within(dialog).getByText(LOCALIZATION_DIGEST)).not.toBeNull()
    expect(within(dialog).getByText(OUTPUT_DIGEST)).not.toBeNull()
    expect(within(dialog).getByText('Process_Active')).not.toBeNull()
    expect(within(dialog).getByText('Process_Existing')).not.toBeNull()
    expect(within(dialog).getByText('2 issues before review · 0 after review')).not.toBeNull()
    expect(within(dialog).queryByText('.orbitpm/history/revision.bpmn')).toBeNull()

    const results = await axe.run(dialog, {
      rules: {
        'color-contrast': { enabled: false }
      }
    })
    expect(results.violations).toEqual([])
  })

  it('disables keep-both for a collision that replaces an existing process identity', async () => {
    const user = userEvent.setup()
    const apply = vi.fn()
    const path = 'active/process.bpmn'
    render(
      <BackupImportDialog
        plan={plan({
          files: [candidate(path, reviewedBpmn(['Process_Existing']))],
          collisionPath: path
        })}
        onApply={apply}
        onCancel={vi.fn()}
      />
    )

    const select = screen.getByRole('combobox', {
      name: `Collision decision ${path}`
    }) as HTMLSelectElement
    const keepBoth = within(select).getByRole('option', {
      name: 'Keep both files'
    }) as HTMLOptionElement
    expect(keepBoth.disabled).toBe(true)
    const describedBy = select.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy!)?.textContent).toContain('Keep both is unavailable')
    expect(document.getElementById(describedBy!)?.textContent).toContain('Process_Existing')

    await user.selectOptions(select, 'replace')
    await user.click(screen.getByRole('button', { name: 'Apply backup import' }))
    expect(apply).toHaveBeenCalledWith({
      [path]: { action: 'replace' }
    })
  })

  it('keeps keep-both available when the reviewed BPMN owns no existing identity', async () => {
    const user = userEvent.setup()
    const apply = vi.fn()
    const path = 'active/process.bpmn'
    render(
      <BackupImportDialog
        plan={plan({
          files: [candidate(path, reviewedBpmn())],
          collisionPath: path
        })}
        onApply={apply}
        onCancel={vi.fn()}
      />
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    const keepBoth = within(select).getByRole('option', {
      name: 'Keep both files'
    }) as HTMLOptionElement
    expect(keepBoth.disabled).toBe(false)
    await user.selectOptions(select, 'keep-both')
    await user.click(screen.getByRole('button', { name: 'Apply backup import' }))
    expect(apply).toHaveBeenCalledWith({
      [path]: { action: 'keep-both' }
    })
  })

  it('uses RTL at 320px while isolating technical evidence LTR and stacking controls', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320
    })
    window.dispatchEvent(new Event('resize'))
    setLang('ar')
    const path = 'active/process.bpmn'
    render(
      <BackupImportDialog
        plan={plan({
          files: [candidate(path, reviewedBpmn())],
          collisionPath: path
        })}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog', {
      name: 'مراجعة تعارضات ملفات النسخة الاحتياطية'
    })
    expect(dialog.getAttribute('dir')).toBe('rtl')
    expect(within(dialog).getByText(PLAN_DIGEST).closest('code')?.getAttribute('dir')).toBe('ltr')
    expect(
      within(dialog)
        .getAllByText(path)
        .every((element) => element.closest('code')?.getAttribute('dir') === 'ltr')
    ).toBe(true)
    expect(dialog.classList.contains('backup-import-dialog')).toBe(true)
    expect(dialogCss).toContain('@media (max-width: 480px)')
    expect(dialogCss).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(dialogCss).toContain('width: calc(100vw - 16px)')
  })
})
