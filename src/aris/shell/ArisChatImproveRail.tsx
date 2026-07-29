/**
 * "Improve / complete the active process" — plan §18, mounted.
 *
 * The whole §18 pipeline runs here with NO provider and NO key: `scanArisChatGaps`
 * finds the gaps, the interview reducer asks up to three questions a round for at
 * most five rounds, `buildLocalArisPatchProposal` turns the answers into a raw
 * `ArisPatchProposalV1`, and the reducer re-validates that raw value through the
 * same schema an AI-produced one would face.
 *
 * Three §18 guarantees are visible in this component:
 *
 *  - **Safe changes apply atomically and are undoable.** The reducer applies the
 *    automatic-classified commands to a pure copy first; only if that whole batch
 *    validated does `onApplyCommands` replay them as ONE canvas gesture, which is
 *    one entry on the ARIS command stack and therefore one Undo.
 *  - **Topology and destructive changes are confirmation-gated.** They never reach
 *    `onApplyCommands` until the user selects them, and the affected records are
 *    shown before/after first.
 *  - **An invalid patch changes nothing.** Every failure path leaves the canvas
 *    document exactly where it was, because nothing is committed until the pure
 *    dry-run succeeded.
 */

import { useCallback, useMemo, useState } from 'react'

import { t, type Key } from '../../i18n'
import { buildConfirmationPreview } from '../chat/applyEngine'
import type { ArisChatGap } from '../chat/gapScanner'
import {
  advanceArisChatInterview,
  startArisChatInterview,
  TERMINAL_INTERVIEW_STATUSES,
  type ArisChatInterviewState
} from '../chat/interviewLoop'
import {
  parseArisPatchProposal,
  type ArisChatCommand,
  type ArisPatchProposalV1
} from '../chat/patchSchema'
import {
  ArisChatSessionTranscript,
  assertProvenanceSafeToStore,
  buildProvenanceEntry,
  type ArisChatProvenanceEntry
} from '../chat/transcript'
import type { ArisWorkingDocument } from '../model/types'
import { createArisChatInterviewHost, scanArisGaps } from './arisChatHost'
import { ARIS_CHAT_REMOVE_ANSWER, buildLocalArisPatchProposal } from './arisChatProposal'
import { tk } from './shellI18n'

export interface ArisChatImproveRailProps {
  /** The live working document the canvas holds. */
  readonly document: ArisWorkingDocument
  /**
   * Replay validated commands as ONE undoable canvas gesture. Returns the canvas's
   * document afterwards, or `null` when the gesture was rejected (nothing applied).
   */
  readonly onApplyCommands: (
    commands: readonly ArisChatCommand[],
    label: string
  ) => ArisWorkingDocument | null
  readonly onUndo: () => void
  readonly canUndo: boolean
}

type Interview = ArisChatInterviewState<ArisWorkingDocument>

function describeTargets(document: ArisWorkingDocument, ids: readonly string[]): string[] {
  return ids.map((id) => {
    const model = document.models.get(id)
    if (model) return `${id} · ${model.names.fallback ?? model.type}`
    const definition = document.objectDefinitions.get(id)
    if (definition) return `${id} · ${definition.names.fallback ?? definition.type}`
    const connection = document.connectionDefinitions.get(id)
    if (connection) return `${id} · ${connection.type}`
    return id
  })
}

function gapText(gap: ArisChatGap): string {
  return t(gap.messageKey as Key, gap.messageParams)
}

export function ArisChatImproveRail({
  document,
  onApplyCommands,
  onUndo,
  canUndo
}: ArisChatImproveRailProps): JSX.Element {
  const host = useMemo(() => createArisChatInterviewHost({ origin: 'ai-auto' }), [])
  const gaps = useMemo(() => scanArisGaps(document), [document])
  const [interview, setInterview] = useState<Interview | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [appliedCount, setAppliedCount] = useState(0)
  // §18.7: the transcript is session-local and never persisted; only the
  // provenance entries below are shaped to enter revision history, and they are
  // scanned for credential-shaped content before they are kept at all.
  const transcript = useMemo(() => new ArisChatSessionTranscript(), [])
  const [provenance, setProvenance] = useState<readonly ArisChatProvenanceEntry[]>([])

  const start = useCallback(() => {
    setNotice(null)
    setSelected({})
    setInterview(startArisChatInterview(document, host))
  }, [document, host])

  /**
   * Commit the commands the reducer just applied to its own copy, as one canvas
   * gesture. On rejection the interview is restarted from the untouched canvas
   * document so the two can never drift apart.
   */
  const commit = useCallback(
    (next: Interview, previous: Interview, commands: readonly ArisChatCommand[]): void => {
      const newReceipts = next.receipts.slice(previous.receipts.length)
      const appliedIds = new Set(
        newReceipts.flatMap((receipt) => receipt.entries.map((entry) => entry.commandId))
      )
      const applied = commands.filter((command) => appliedIds.has(command.commandId))
      if (applied.length === 0) {
        setInterview(next)
        return
      }
      const committed = onApplyCommands(applied, 'aris.chat.improve')
      if (!committed) {
        setNotice(
          tk('aris.chat.commitFailed', 'The canvas rejected the change; nothing was applied.')
        )
        setInterview(startArisChatInterview(document, host))
        return
      }
      setAppliedCount((current) => current + applied.length)

      const appliedAt = new Date(0).toISOString()
      const gapKinds = previous.gaps.map((gap) => gap.kind)
      const entries = newReceipts.flatMap((receipt) =>
        receipt.entries.map((entry) => buildProvenanceEntry(entry, gapKinds, appliedAt))
      )
      try {
        assertProvenanceSafeToStore(entries)
        setProvenance((current) => [...current, ...entries])
      } catch {
        // Fail closed: a credential-shaped id never enters revision history.
        setNotice(tk('aris.chat.provenanceRejected', 'A change receipt was withheld from history.'))
      }
      transcript.append({
        id: `receipt-${appliedCount + applied.length}`,
        role: 'system',
        text: applied.map((command) => command.kind).join(', '),
        createdAt: appliedAt
      })

      // Pin the interview to the document the canvas actually holds, so the
      // reducer's revision checks can never drift from the undo stack's.
      setInterview({ ...next, document: committed })
    },
    [appliedCount, document, host, onApplyCommands, transcript]
  )

  const submitAnswers = useCallback(() => {
    const current = interview
    if (!current || current.status !== 'awaitingAnswers') return
    setNotice(null)
    const awaitingProposal = advanceArisChatInterview(
      current,
      { type: 'answersSubmitted', answers },
      host
    )
    const raw = buildLocalArisPatchProposal({
      document: awaitingProposal.document,
      questions: current.questions,
      answers: { ...awaitingProposal.answers }
    })
    if (raw === null) {
      setNotice(
        tk(
          'aris.chat.noProposal',
          'Those answers do not map to a change this build can make deterministically.'
        )
      )
      setInterview(awaitingProposal)
      return
    }
    // Parse before advancing so the commit path has typed commands. The reducer
    // re-validates `raw` through the very same schema, so a builder bug is caught
    // twice and the document is untouched either way.
    let proposal: ArisPatchProposalV1
    try {
      proposal = parseArisPatchProposal(raw)
    } catch (error) {
      setNotice(
        tk('aris.chat.rejected', 'The patch was rejected: {error}', {
          error: error instanceof Error ? error.message : String(error)
        })
      )
      setInterview(awaitingProposal)
      return
    }
    const next = advanceArisChatInterview(awaitingProposal, { type: 'proposalReceived', raw }, host)
    if ('lastError' in next && next.lastError) {
      setNotice(
        tk('aris.chat.rejected', 'The patch was rejected: {error}', { error: next.lastError })
      )
      setInterview(next)
      return
    }
    commit(next, awaitingProposal, proposal.commands)
  }, [answers, commit, host, interview])

  const confirmSelected = useCallback(() => {
    const current = interview
    if (!current || current.status !== 'awaitingConfirmation') return
    setNotice(null)
    const selectedIds = new Set(
      current.pendingConfirmCommands
        .filter((command) => selected[command.commandId])
        .map((command) => command.commandId)
    )
    if (selectedIds.size === 0) {
      setNotice(tk('aris.chat.nothingSelected', 'Select at least one change to apply.'))
      return
    }
    const next = advanceArisChatInterview(
      current,
      { type: 'confirmationDecision', selectedCommandIds: selectedIds },
      host
    )
    if ('lastError' in next && next.lastError) {
      setNotice(
        tk('aris.chat.rejected', 'The patch was rejected: {error}', { error: next.lastError })
      )
      setInterview(next)
      return
    }
    commit(next, current, current.pendingConfirmCommands)
  }, [commit, host, interview, selected])

  const preview = useMemo(() => {
    if (!interview || interview.status !== 'awaitingConfirmation') return null
    const outcome = buildConfirmationPreview(
      interview.document,
      interview.pendingConfirmCommands,
      host,
      describeTargets
    )
    return outcome.ok ? outcome.preview : null
  }, [host, interview])

  const terminal = interview !== null && TERMINAL_INTERVIEW_STATUSES.has(interview.status)

  return (
    <section className="orbitpm-aris-rail__section" data-orbitpm-aris-chat="">
      <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
        {tk('aris.rail.improve', 'Improve this process')}
      </h3>

      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--orbitpm-muted)' }}>
        {tk('aris.chat.gapCount', '{count} gaps found', { count: gaps.length })}
      </p>

      {gaps.length > 0 && (
        <ul
          data-orbitpm-aris-chat-gaps=""
          style={{
            margin: '0 0 8px',
            paddingInlineStart: '1.1rem',
            fontSize: 12,
            maxHeight: 160,
            overflow: 'auto'
          }}
        >
          {gaps.slice(0, 25).map((gap, index) => (
            <li key={`${gap.kind}:${gap.targetIds.join(',')}:${index}`}>{gapText(gap)}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          data-orbitpm-aris-chat-start=""
          disabled={gaps.length === 0}
          onClick={start}
        >
          {tk('aris.chat.start', 'Start completion interview')}
        </button>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          data-orbitpm-aris-chat-undo=""
          disabled={!canUndo || appliedCount === 0}
          onClick={onUndo}
        >
          {tk('aris.chat.undo', 'Undo last applied change')}
        </button>
      </div>

      {interview && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            {tk('aris.chat.round', 'Round {round} of 5 · {status}', {
              round: interview.round,
              status: interview.status
            })}
          </p>

          {interview.status === 'awaitingAnswers' &&
            interview.questions.map((question) => (
              <label
                key={question.id}
                style={{ display: 'grid', gap: 4, fontSize: 12.5 }}
                data-orbitpm-aris-chat-question={question.gapKind}
              >
                <span>{t(question.messageKey as Key, question.messageParams)}</span>
                {question.gapKind === 'unusedDefinition' ? (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={answers[question.id] === ARIS_CHAT_REMOVE_ANSWER}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.checked ? ARIS_CHAT_REMOVE_ANSWER : ''
                        }))
                      }
                    />
                    <span>{tk('aris.chat.proposeRemoval', 'Propose removing it')}</span>
                  </span>
                ) : (
                  <input
                    value={answers[question.id] ?? ''}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                    style={{
                      font: 'inherit',
                      padding: '0.25rem 0.4rem',
                      borderRadius: 6,
                      border: '1px solid var(--orbitpm-border)',
                      background: 'transparent',
                      color: 'inherit'
                    }}
                  />
                )}
              </label>
            ))}

          {interview.status === 'awaitingAnswers' && (
            <button
              type="button"
              className="orbitpm-lite-primary"
              data-orbitpm-aris-chat-submit=""
              onClick={submitAnswers}
            >
              {tk('aris.chat.apply', 'Apply answers')}
            </button>
          )}

          {interview.status === 'awaitingConfirmation' && (
            <div data-orbitpm-aris-chat-confirm="" style={{ display: 'grid', gap: 6 }}>
              <strong style={{ fontSize: 12.5 }}>
                {tk('aris.chat.confirmHeading', 'These changes need confirmation')}
              </strong>
              {interview.pendingConfirmCommands.map((command) => (
                <label
                  key={command.commandId}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}
                >
                  <input
                    type="checkbox"
                    checked={selected[command.commandId] ?? false}
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [command.commandId]: event.target.checked
                      }))
                    }
                  />
                  <span>
                    {command.kind} · {command.targetIds.join(', ')}
                  </span>
                </label>
              ))}
              {preview && (
                <dl className="orbitpm-aris-defs" data-orbitpm-aris-chat-preview="">
                  <div style={{ display: 'contents' }}>
                    <dt>{tk('aris.chat.preview.before', 'Before')}</dt>
                    <dd>{(preview.before as string[] | null)?.join(' | ') ?? ''}</dd>
                    <dt>{tk('aris.chat.preview.after', 'After')}</dt>
                    <dd>{(preview.after as string[] | null)?.join(' | ') ?? ''}</dd>
                  </div>
                </dl>
              )}
              <button
                type="button"
                className="orbitpm-lite-primary"
                data-orbitpm-aris-chat-confirm-apply=""
                onClick={confirmSelected}
              >
                {tk('aris.chat.confirmApply', 'Apply selected changes')}
              </button>
            </div>
          )}

          {terminal && (
            <p
              style={{ margin: 0, fontSize: 12 }}
              data-orbitpm-aris-chat-terminal={interview.status}
            >
              {tk('aris.chat.finished', 'Interview finished: {status}', {
                status: interview.status
              })}
            </p>
          )}
        </div>
      )}

      {provenance.length > 0 && (
        <ul
          data-orbitpm-aris-chat-receipts=""
          style={{ margin: '8px 0 0', paddingInlineStart: '1.1rem', fontSize: 12 }}
        >
          {provenance.map((entry) => (
            <li key={entry.commandId}>
              {entry.kind} · {entry.targetIds.join(', ')} · {entry.origin}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p role="status" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {notice}
        </p>
      )}
    </section>
  )
}
