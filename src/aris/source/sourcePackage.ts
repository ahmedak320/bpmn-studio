import { sha256Hex } from '../../workspace/adapters/hash'
import { decodeUtf8Strict } from '../../workspace/utf8'
import {
  buildSemanticArisDocument,
  type AmlDiagnostic,
  type ArisSourceIndex
} from './semanticIndex'
import { tokenizeXmlInBrowser } from './browserXmlTokenizer'
import type { AmlSyntaxTree } from './types'

export type { AmlSyntaxTree }

/**
 * Plan section 6.5 interchange contract. Layer 1 (`source`) is the immutable raw bytes,
 * layer 2 (`syntax`) is the lossless concrete-syntax tree, layer 3 (`index`) is the indexed
 * ARIS semantic source, and `diagnostics` reports everything the index could not model.
 */
export interface LosslessAmlDocument {
  readonly source: {
    readonly bytes: Uint8Array
    readonly name: string
    readonly mediaType: string
    readonly sha256: string
    readonly encoding: string
  }
  readonly syntax: AmlSyntaxTree
  readonly index: ArisSourceIndex
  readonly diagnostics: readonly AmlDiagnostic[]
}

export interface ArisXmlSourcePackage {
  readonly name: string
  readonly relPath: string | null
  readonly bytes: Uint8Array
  readonly text: string
  readonly sha256: string
  readonly document: AmlSyntaxTree
  readonly index: ArisSourceIndex
  readonly diagnostics: readonly AmlDiagnostic[]
  readonly lossless: LosslessAmlDocument
}

export async function createArisXmlSourcePackage(options: {
  readonly name: string
  readonly relPath: string | null
  readonly bytes: Uint8Array
  readonly mimeType?: string
  readonly signal?: AbortSignal
}): Promise<ArisXmlSourcePackage> {
  const text = decodeUtf8Strict(options.bytes, {
    operation: 'read',
    ...(options.relPath ? { path: options.relPath } : {})
  })
  const mediaType = options.mimeType ?? 'application/xml'
  const [sha256, document] = await Promise.all([
    sha256Hex(options.bytes),
    tokenizeXmlInBrowser(text, { signal: options.signal })
  ])
  const semantic = buildSemanticArisDocument(document)
  const lossless: LosslessAmlDocument = Object.freeze({
    source: Object.freeze({
      bytes: options.bytes,
      name: options.name,
      mediaType,
      sha256,
      encoding: document.declaration?.encoding ?? 'UTF-8'
    }),
    syntax: document,
    index: semantic.index,
    diagnostics: semantic.diagnostics
  })
  return Object.freeze({
    name: options.name,
    relPath: options.relPath,
    bytes: options.bytes,
    text,
    sha256,
    document,
    index: semantic.index,
    diagnostics: semantic.diagnostics,
    lossless
  })
}
