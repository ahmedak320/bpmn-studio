/**
 * The "Fix missing components" dialog — Lane L5d (plan §18).
 *
 * Renders the three deterministic fix tiers from `buildDeterministicFixPlan`:
 *
 *   - **Tier A — Fill automatically (safe):** a single button that hands the counterpart-language
 *     fills to the translate controller's review/fill path (`onAutoFix`).
 *   - **Tier B — Proposed changes needing confirmation:** a checkbox per deterministic proposal
 *     with an optional before/after preview (`buildPreview`, computed by the tab through
 *     `buildConfirmationPreview`); the apply button commits every selected proposal's commands as
 *     ONE undoable gesture via `onApplySelected`.
 *   - **Tier C — Needs your answers:** the remaining gaps plus a button routing into the chat
 *     drawer's interview tab (`onOpenInterview`).
 *
 * Every user-visible string goes through `tk()`; the `aris.fix.*` keys render their English
 * fallback until Lane X1 registers them. No network is ever touched here.
 */

import { useEffect, useMemo, useState } from 'react'

import { Modal } from '../../workspace/Modal'
import type { ArisChatCommand } from '../chat/patchSchema'
import type { ArisChatWorkingDocument } from '../chat/types'
import {
  ARIS_FIX_GAP_KIND_FALLBACK,
  ARIS_FIX_PROPOSAL_LABEL_FALLBACK,
  type ArisDeterministicFixPlan,
  type ArisFixConfirmProposal
} from '../chat/deterministicFixes'
import { tk } from './shellI18n'

export interface ArisFixPreviewRows {
  readonly before: readonly string[]
  readonly after: readonly string[]
}

export interface ArisFixMissingDialogProps {
  readonly open: boolean
  readonly document: ArisChatWorkingDocument
  readonly plan: ArisDeterministicFixPlan
  readonly busy: boolean
  readonly onAutoFix: () => void
  readonly onApplySelected: (commands: readonly ArisChatCommand[]) => void
  readonly onOpenInterview: () => void
  readonly onClose: () => void
  /**
   * Optional before/after preview for a Tier-B proposal, computed by the tab through
   * `buildConfirmationPreview`. Omitted (e.g. in a unit test) ⇒ no preview rows are rendered.
   */
  readonly buildPreview?: (proposal: ArisFixConfirmProposal) => ArisFixPreviewRows | null
}

const SECTION_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--orbitpm-border)',
  paddingTop: '0.75rem',
  marginTop: '0.75rem'
}

const COUNT_BADGE_STYLE: React.CSSProperties = {
  padding: '0.1rem 0.5rem',
  borderRadius: 999,
  border: '1px solid var(--orbitpm-border)',
  fontSize: 12,
  color: 'var(--orbitpm-muted)',
  marginInlineStart: 8
}

/** A stable key for a proposal within one plan (its first command id is unique per batch). */
function proposalKey(proposal: ArisFixConfirmProposal): string {
  return proposal.commands[0]?.commandId ?? proposal.labelKey
}

function describeTarget(document: ArisChatWorkingDocument, id: string): string {
  const model = document.models.get(id)
  if (model) return `${id} · ${model.names.fallback ?? id}`
  const definition = document.objectDefinitions.get(id)
  if (definition) return `${id} · ${definition.names.fallback ?? definition.type}`
  return id
}

export function ArisFixMissingDialog({
  open,
  document,
  plan,
  busy,
  onAutoFix,
  onApplySelected,
  onOpenInterview,
  onClose,
  buildPreview
}: ArisFixMissingDialogProps): JSX.Element | null {
  const allKeys = useMemo(() => plan.confirmProposals.map(proposalKey), [plan.confirmProposals])
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(allKeys))

  // Every proposal starts selected; reset whenever the plan (and thus the key set) changes.
  useEffect(() => {
    setSelected(new Set(allKeys))
  }, [allKeys])

  // Each preview dry-runs its proposal's full command cluster against the live
  // document (~100ms apiece on the reference export). Computing them inside the
  // render map made EVERY checkbox toggle re-run all of them (~5.8s per toggle).
  const previews = useMemo(() => {
    const map = new Map<string, ArisFixPreviewRows | null>()
    if (!open || !buildPreview) return map
    for (const proposal of plan.confirmProposals) {
      const key = proposalKey(proposal)
      if (!map.has(key)) map.set(key, buildPreview(proposal))
    }
    return map
  }, [open, plan.confirmProposals, buildPreview])

  if (!open) return null

  const autoCount = plan.translationFillTargets.length
  const confirmCount = plan.confirmProposals.length
  const interviewCount = plan.interviewGaps.length

  // De-dupe by commandId: full-cluster delete cascades from two orphan clusters can share a
  // connection occurrence (and thus its deterministic delete command id). Command ids are
  // deterministic per record id, so first-seen order is stable and de-duping is exact — without
  // it, select-all would list the same delete twice and the model layer would reject the batch.
  const seenCommandIds = new Set<string>()
  const selectedCommands: readonly ArisChatCommand[] = plan.confirmProposals
    .filter((proposal) => selected.has(proposalKey(proposal)))
    .flatMap((proposal) => proposal.commands)
    .filter((command) => {
      if (seenCommandIds.has(command.commandId)) return false
      seenCommandIds.add(command.commandId)
      return true
    })

  const showsCleanLayoutHint = plan.confirmProposals.some((proposal) =>
    proposal.commands.some((command) => command.kind === 'addCoreObject')
  )

  const toggle = (key: string): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Modal
      title={tk('aris.fix.title', 'Fix missing components')}
      onClose={onClose}
      maxWidth={620}
      closable={!busy}
    >
      <div data-orbitpm-aris-fix-dialog="">
        {/* Tier A — safe translation fills */}
        <section>
          <h3 style={{ fontSize: 15, margin: 0 }}>
            {tk('aris.fix.autoSection', 'Fill automatically (safe)')}
            <span style={COUNT_BADGE_STYLE} data-orbitpm-aris-fix-auto-count={autoCount}>
              {autoCount}
            </span>
          </h3>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-fix-auto={autoCount}
            disabled={busy || autoCount === 0}
            onClick={onAutoFix}
          >
            {tk('aris.fix.autoSection', 'Fill automatically (safe)')}
          </button>
        </section>

        {/* Tier B — deterministic structural proposals, confirm-gated */}
        <section style={SECTION_STYLE}>
          <h3 style={{ fontSize: 15, margin: 0 }}>
            {tk('aris.fix.confirmSection', 'Proposed changes needing confirmation')}
            <span style={COUNT_BADGE_STYLE} data-orbitpm-aris-fix-confirm-count={confirmCount}>
              {confirmCount}
            </span>
          </h3>
          {showsCleanLayoutHint && (
            <p
              style={{ margin: '0.5rem 0', fontSize: 12, color: 'var(--orbitpm-muted)' }}
              data-orbitpm-aris-fix-clean-hint=""
            >
              {tk(
                'aris.fix.cleanLayoutHint',
                'New elements are placed automatically — run Clean Layout afterwards.'
              )}
            </p>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {plan.confirmProposals.map((proposal, index) => {
              const key = proposalKey(proposal)
              const preview = previews.get(key) ?? null
              return (
                <li key={`${key}#${index}`} style={{ padding: '0.4rem 0' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      disabled={busy}
                      data-orbitpm-aris-fix-confirm={key}
                      onChange={() => toggle(key)}
                    />
                    <span>
                      {tk(
                        proposal.labelKey,
                        ARIS_FIX_PROPOSAL_LABEL_FALLBACK[proposal.labelKey] ?? proposal.labelKey
                      )}
                    </span>
                  </label>
                  {preview && (
                    <dl
                      style={{
                        margin: '0.25rem 0 0 1.6rem',
                        fontSize: 12,
                        color: 'var(--orbitpm-muted)'
                      }}
                      data-orbitpm-aris-fix-preview={key}
                    >
                      <dt>{tk('aris.chat.preview.before', 'Before')}</dt>
                      <dd style={{ margin: 0 }}>{preview.before.join(', ')}</dd>
                      <dt>{tk('aris.chat.preview.after', 'After')}</dt>
                      <dd style={{ margin: 0 }}>{preview.after.join(', ')}</dd>
                    </dl>
                  )}
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-fix-apply={selectedCommands.length}
            disabled={busy || selectedCommands.length === 0}
            onClick={() => onApplySelected(selectedCommands)}
          >
            {tk('aris.chat.confirmApply', 'Apply selected changes')}
          </button>
        </section>

        {/* Tier C — needs answers, routes into the chat interview */}
        <section style={SECTION_STYLE}>
          <h3 style={{ fontSize: 15, margin: 0 }}>
            {tk('aris.fix.interviewSection', 'Needs your answers')}
            <span style={COUNT_BADGE_STYLE} data-orbitpm-aris-fix-interview-count={interviewCount}>
              {interviewCount}
            </span>
          </h3>
          <ul
            style={{ margin: '0.5rem 0', paddingInlineStart: '1.2rem', fontSize: 13 }}
            data-orbitpm-aris-fix-interview-list=""
          >
            {plan.interviewGaps.map((gap, index) => (
              <li key={`${gap.kind}:${gap.targetIds.join(',')}:${index}`}>
                {tk(gap.messageKey, ARIS_FIX_GAP_KIND_FALLBACK[gap.kind])}
                {gap.targetIds.length > 0 && (
                  <span style={{ color: 'var(--orbitpm-muted)' }}>
                    {` — ${describeTarget(document, gap.targetIds[0]!)}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-fix-interview={interviewCount}
            disabled={busy || interviewCount === 0}
            onClick={onOpenInterview}
          >
            {tk('aris.fix.openInterview', 'Answer questions…')}
          </button>
        </section>
      </div>
    </Modal>
  )
}
