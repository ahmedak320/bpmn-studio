import type { TokenizedXmlDocument } from './xmlTokenizer'

/**
 * Plan section 6.5 name for layer 2 of the four-layer input architecture: the lossless XML
 * concrete-syntax tree produced by the tokenizer. It is a pure alias of the tokenizer's
 * document type so the interchange contract can use the plan's vocabulary without duplicating
 * the shape.
 */
export type AmlSyntaxTree = TokenizedXmlDocument
