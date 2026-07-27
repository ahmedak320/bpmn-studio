import type { DocumentIdentity, WorkspaceIdentity } from './types'

/**
 * A protocol-only identity that can never be confused with a portable
 * workspace path. Every durable workspace mutation, including an ordinary
 * document save, contends on this one lease.
 */
export const WORKSPACE_MUTATION_LOCK_PATH = '\u0000orbitpm-workspace-mutation-v1'

export function workspaceMutationIdentity(workspace: WorkspaceIdentity): DocumentIdentity {
  return {
    workspace,
    path: WORKSPACE_MUTATION_LOCK_PATH
  }
}
