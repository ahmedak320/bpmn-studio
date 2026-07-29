import type { ArisAssistantModelInput, ArisProcessDigest } from './types'

export interface IndexBuilderWorkerRequest {
  readonly type: 'build'
  readonly requestId: string
  readonly models: readonly ArisAssistantModelInput[]
}

export type IndexBuilderWorkerResponse =
  | {
      readonly type: 'result'
      readonly requestId: string
      readonly digests: readonly ArisProcessDigest[]
    }
  | { readonly type: 'error'; readonly requestId: string; readonly message: string }
