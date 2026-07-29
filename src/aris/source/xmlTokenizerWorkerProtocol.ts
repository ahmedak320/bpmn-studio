import type {
  TokenizedXmlDocument,
  XmlTokenizerLimits,
  XmlTokenizerErrorCode
} from './xmlTokenizer'

export interface XmlTokenizerWorkerRequest {
  readonly type: 'tokenize'
  readonly requestId: string
  readonly text: string
  readonly limits?: Partial<XmlTokenizerLimits>
}

export type XmlTokenizerWorkerResponse =
  | {
      readonly type: 'result'
      readonly requestId: string
      readonly document: TokenizedXmlDocument
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly code: XmlTokenizerErrorCode | 'unknown'
      readonly message: string
    }
