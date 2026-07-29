import { buildConfirmationPreview, type ArisChatConfirmationPreview } from '../chat/applyEngine'
import {
  advanceArisChatInterview,
  startArisChatInterview,
  TERMINAL_INTERVIEW_STATUSES,
  type ArisChatInterviewHost,
  type ArisChatInterviewState
} from '../chat/interviewLoop'
import { parseArisPatchProposal, type ArisChatCommand } from '../chat/patchSchema'
import {
  assertProvenanceSafeToStore,
  buildProvenanceEntry,
  type ArisChatProvenanceEntry
} from '../chat/transcript'
import type { ArisWorkingDocument } from '../model/types'
import { createArisChatInterviewHost } from './arisChatHost'
import type { ArisTabChatHost } from './arisChatDrawerTypes'
import { buildLocalArisPatchProposal } from './arisChatProposal'

export type ArisChatDrawerEvent =
  | {
      readonly kind: 'status'
      readonly messageKey: string
      readonly params?: Record<string, string | number>
    }
  | { readonly kind: 'applied'; readonly count: number }
  | { readonly kind: 'rejected'; readonly error: string }
  | { readonly kind: 'terminal'; readonly status: string }

export interface ArisChatDrawerInterview {
  readonly state: ArisChatInterviewState<ArisWorkingDocument> | null
  readonly appliedCount: number
  readonly provenance: readonly ArisChatProvenanceEntry[]
}

export function createDrawerInterviewHost(): ArisChatInterviewHost<ArisWorkingDocument> {
  return createArisChatInterviewHost({ origin: 'ai-auto' })
}

export function beginDrawerInterview(
  host: ArisChatInterviewHost<ArisWorkingDocument>,
  document: ArisWorkingDocument
): { interview: ArisChatDrawerInterview; events: readonly ArisChatDrawerEvent[] } {
  const state = startArisChatInterview(document, host)
  const interview: ArisChatDrawerInterview = {
    state,
    appliedCount: 0,
    provenance: []
  }

  if (state.status === 'clean') {
    return {
      interview,
      events: [{ kind: 'status', messageKey: 'aris.chatDrawer.interview.clean' }]
    }
  }

  if (TERMINAL_INTERVIEW_STATUSES.has(state.status)) {
    return {
      interview,
      events: [{ kind: 'terminal', status: state.status }]
    }
  }

  return { interview, events: [] }
}

export function submitDrawerAnswers(
  host: ArisChatInterviewHost<ArisWorkingDocument>,
  interview: ArisChatDrawerInterview,
  target: ArisTabChatHost,
  answers: Readonly<Record<string, string>>
): { interview: ArisChatDrawerInterview; events: readonly ArisChatDrawerEvent[] } {
  const current = interview.state
  if (!current || current.status !== 'awaitingAnswers') {
    return { interview, events: [] }
  }

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
    return {
      interview: { ...interview, state: awaitingProposal },
      events: [{ kind: 'status', messageKey: 'aris.chat.noProposal' }]
    }
  }

  let proposal
  try {
    proposal = parseArisPatchProposal(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      interview: { ...interview, state: awaitingProposal },
      events: [{ kind: 'rejected', error: message }]
    }
  }

  const next = advanceArisChatInterview(awaitingProposal, { type: 'proposalReceived', raw }, host)

  if ('lastError' in next && next.lastError) {
    return {
      interview: { ...interview, state: next },
      events: [{ kind: 'rejected', error: next.lastError }]
    }
  }

  return commit(next, awaitingProposal, proposal.commands, target, host, interview)
}

export function confirmDrawerSelection(
  host: ArisChatInterviewHost<ArisWorkingDocument>,
  interview: ArisChatDrawerInterview,
  target: ArisTabChatHost,
  selectedCommandIds: ReadonlySet<string>
): { interview: ArisChatDrawerInterview; events: readonly ArisChatDrawerEvent[] } {
  const current = interview.state
  if (!current || current.status !== 'awaitingConfirmation') {
    return { interview, events: [] }
  }

  const selectedIds = new Set(
    current.pendingConfirmCommands
      .filter((command) => selectedCommandIds.has(command.commandId))
      .map((command) => command.commandId)
  )

  if (selectedIds.size === 0) {
    return {
      interview,
      events: [{ kind: 'status', messageKey: 'aris.chat.nothingSelected' }]
    }
  }

  const next = advanceArisChatInterview(
    current,
    { type: 'confirmationDecision', selectedCommandIds: selectedIds },
    host
  )

  if ('lastError' in next && next.lastError) {
    return {
      interview: { ...interview, state: next },
      events: [{ kind: 'rejected', error: next.lastError }]
    }
  }

  return commit(next, current, current.pendingConfirmCommands, target, host, interview)
}

export function drawerConfirmationPreview(
  host: ArisChatInterviewHost<ArisWorkingDocument>,
  interview: ArisChatDrawerInterview,
  describeTargets?: (document: ArisWorkingDocument, targetIds: readonly string[]) => unknown
): ArisChatConfirmationPreview<ArisWorkingDocument> | null {
  const state = interview.state
  if (!state || state.status !== 'awaitingConfirmation') return null

  const outcome = buildConfirmationPreview(
    state.document,
    state.pendingConfirmCommands,
    host,
    describeTargets
  )
  return outcome.ok ? outcome.preview : null
}

export function describeCommandTargets(
  document: ArisWorkingDocument,
  ids: readonly string[]
): string[] {
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

function commit(
  next: ArisChatInterviewState<ArisWorkingDocument>,
  previous: ArisChatInterviewState<ArisWorkingDocument>,
  commands: readonly ArisChatCommand[],
  target: ArisTabChatHost,
  host: ArisChatInterviewHost<ArisWorkingDocument>,
  current: ArisChatDrawerInterview
): { interview: ArisChatDrawerInterview; events: readonly ArisChatDrawerEvent[] } {
  const newReceipts = next.receipts.slice(previous.receipts.length)
  const appliedIds = new Set(
    newReceipts.flatMap((receipt) => receipt.entries.map((entry) => entry.commandId))
  )
  const applied = commands.filter((command) => appliedIds.has(command.commandId))

  if (applied.length === 0) {
    return { interview: { ...current, state: next }, events: [] }
  }

  const committed = target.applyCommands(applied, 'aris.chat.improve')
  if (!committed) {
    const live = target.getDocument()
    return {
      interview: {
        ...current,
        state: live ? startArisChatInterview(live, host) : null
      },
      events: [{ kind: 'status', messageKey: 'aris.chat.commitFailed' }]
    }
  }

  const appliedCount = current.appliedCount + applied.length
  const appliedAt = new Date(0).toISOString()
  const gapKinds = previous.gaps.map((gap) => gap.kind)
  const entries = newReceipts.flatMap((receipt) =>
    receipt.entries.map((entry) => buildProvenanceEntry(entry, gapKinds, appliedAt))
  )

  let provenance = current.provenance
  const events: ArisChatDrawerEvent[] = [{ kind: 'applied', count: applied.length }]

  try {
    assertProvenanceSafeToStore(entries)
    provenance = [...current.provenance, ...entries]
  } catch {
    events.push({ kind: 'status', messageKey: 'aris.chat.provenanceRejected' })
  }

  return {
    interview: {
      state: { ...next, document: committed },
      appliedCount,
      provenance
    },
    events
  }
}
