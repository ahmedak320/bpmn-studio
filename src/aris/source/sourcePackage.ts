import { sha256Hex } from '../../workspace/adapters/hash'
import { decodeUtf8Strict } from '../../workspace/utf8'
import { tokenizeXmlInBrowser } from './browserXmlTokenizer'
import type { TokenizedXmlDocument } from './xmlTokenizer'

export interface ArisXmlSourcePackage {
  readonly name: string
  readonly relPath: string | null
  readonly bytes: Uint8Array
  readonly text: string
  readonly sha256: string
  readonly document: TokenizedXmlDocument
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
  const [sha256, document] = await Promise.all([
    sha256Hex(options.bytes),
    tokenizeXmlInBrowser(text, { signal: options.signal })
  ])
  return Object.freeze({
    name: options.name,
    relPath: options.relPath,
    bytes: options.bytes,
    text,
    sha256,
    document
  })
}
