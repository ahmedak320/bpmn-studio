// Pure conversation-history management for the assistant drawer.
//
// The drawer's transcript mixes real Q/A turns with error/status bubbles; the
// provider must only ever see clean, alternating user/assistant turns (the
// Anthropic Messages API rejects conversations that do not start with a user
// turn or that repeat a role). toLlmHistory therefore keeps only COMPLETE
// user→assistant pairs — an unanswered question (its call errored) is dropped —
// bounds the result to the most recent turns, and truncates each turn, so the
// prompt size stays hard-capped no matter how long the chat has run.

import type { LlmMessage } from '@app/gen'

/** One transcript entry as the drawer stores it. `error`/`status` bubbles are
 *  display-only and never reach the provider. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  kind?: 'chat' | 'error' | 'status'
}

/** Max turns (user + assistant counted separately) sent as prior context. */
export const HISTORY_MAX_TURNS = 12
/** Per-turn character cap inside the outgoing history. */
export const HISTORY_TURN_CHARS = 1500

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + '…'
}

/**
 * Convert the drawer transcript into the provider-ready prior-conversation
 * history: chat-kind turns only, paired strictly user→assistant (unpaired user
 * turns dropped, stray assistant turns before the first user turn dropped),
 * most recent `maxTurns` turns kept (whole pairs, so the result always starts
 * with 'user' and alternates), each turn clipped to `turnChars` characters.
 */
export function toLlmHistory(
  transcript: ChatTurn[],
  maxTurns: number = HISTORY_MAX_TURNS,
  turnChars: number = HISTORY_TURN_CHARS
): LlmMessage[] {
  const chat = transcript.filter((m) => (m.kind ?? 'chat') === 'chat' && m.text.trim() !== '')

  const pairs: Array<[string, string]> = []
  let pendingUser: string | null = null
  for (const turn of chat) {
    if (turn.role === 'user') {
      // A newer question supersedes an unanswered older one.
      pendingUser = turn.text
    } else if (pendingUser !== null) {
      pairs.push([pendingUser, turn.text])
      pendingUser = null
    }
    // assistant turn with no pending user (greeting/local notice) — skipped.
  }

  const maxPairs = Math.max(0, Math.floor(maxTurns / 2))
  const recent = maxPairs > 0 ? pairs.slice(-maxPairs) : []

  const out: LlmMessage[] = []
  for (const [q, a] of recent) {
    out.push({ role: 'user', content: clip(q, turnChars) })
    out.push({ role: 'assistant', content: clip(a, turnChars) })
  }
  return out
}
