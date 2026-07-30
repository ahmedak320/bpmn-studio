import { renderAttributes, type EmittedAttribute } from '../writer/emit'
import { deriveArisSourceFileName } from '../shell/arisBlankModel'
import type {
  ArisConnectionDefinitionRecord,
  ArisGroupRecord,
  ArisObjectDefinitionRecord,
  ArisSourceIndex
} from './semanticIndex'
import type { ArisXmlSourcePackage } from './sourcePackage'
import type { XmlSpan } from './xmlTokenizer'

/**
 * AML span-slice splitter (plan lane T2).
 *
 * {@link buildArisSplitPlan} turns one parsed {@link ArisXmlSourcePackage} into one standalone
 * AML document per model. Every emitted document is assembled from *verbatim byte slices* of the
 * source text — never re-serialized record-by-record — so cross-file identity (`LinkedModels`
 * assignments, object/connection ids, styled-run markup, entity-referenced locale ids) and
 * rendering fidelity survive intact. The only structural surgery performed on a slice is the
 * excision of `<CxnDef>` children that the emitted model never occurs, and the reconstruction of
 * the `<AML>`/`<Group>` container open tags (from their raw attributes) so the model can stand on
 * its own inside its group chain.
 */

export interface ArisSplitFile {
  readonly modelId: string
  readonly modelName: string | null
  readonly fileName: string
  readonly folderSegments: readonly string[]
  readonly text: string
}

export interface ArisSplitPlan {
  readonly files: readonly ArisSplitFile[]
  readonly skippedModelIds: readonly string[]
}

const GROUP_ROOT_ID = 'Group.Root'
const NAME_ATTRIBUTE_TYPE = 'AT_NAME'

/**
 * Windows-safe, cross-platform path-segment sanitizer for a group display name.
 *
 * NFC-normalize and trim → drop the characters no filesystem accepts (`<>:"/\|?*`) plus control
 * characters → collapse internal whitespace to a single space → strip leading dots and trailing
 * dots/spaces (both are unrepresentable on Windows) → fall back to `'group'` if nothing survives.
 */
export function sanitizeArisPathSegment(name: string): string {
  const collapsed = name
    .normalize('NFC')
    .trim()
    // Strip filesystem-illegal characters plus C0 control codes and DEL.
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .replace(/[.\s]+$/u, '')
  return collapsed === '' ? 'group' : collapsed
}

/**
 * Derive the `<slug>.aml` file name for a split model: prefer the English display name, then any
 * other-language name, then the model id, and run the chosen string through the shared
 * {@link deriveArisSourceFileName} dash/reserved-name rules. Two models that resolve to the same
 * name deliberately get the same file name here — collisions are de-duplicated later by the
 * import stager's `uniquePathIn`, not by this pure function.
 */
export function deriveSplitFileName(modelName: string | null, modelId: string): string {
  const base = modelName && modelName.trim() !== '' ? modelName : modelId
  return deriveArisSourceFileName(base)
}

function sliceSpan(text: string, span: XmlSpan): string {
  return text.slice(span.start.offset, span.end.offset)
}

function rawAttributesToEmitted(
  rawAttributes: Readonly<Record<string, string>>
): readonly EmittedAttribute[] {
  return Object.entries(rawAttributes).map(([name, value]) => ({ name, value }))
}

/** The English-preferred (then any other locale) display name for an owner element, or null. */
function displayName(
  index: ArisSourceIndex,
  ownerElementName: string,
  ownerSourceId: string | null
): string | null {
  if (!ownerSourceId) return null
  const attribute = index.attributes.find(
    (candidate) =>
      candidate.parsed.ownerElementName === ownerElementName &&
      candidate.parsed.ownerSourceId === ownerSourceId &&
      candidate.parsed.attributeType === NAME_ATTRIBUTE_TYPE
  )
  if (!attribute) return null
  const values = attribute.parsed.values
  const preferred =
    values.find((value) => value.locale === 'en') ??
    values.find((value) => value.text.trim() !== '') ??
    values[0]
  const text = preferred?.text.trim()
  return text ? text : null
}

/** Verbatim slices of an owner element's own `AT_NAME` `<AttrDef>` records, in source order. */
function nameAttrDefSlices(
  text: string,
  index: ArisSourceIndex,
  ownerElementName: string,
  ownerSourceId: string | null
): readonly string[] {
  if (!ownerSourceId) return []
  return index.attributes
    .filter(
      (candidate) =>
        candidate.parsed.ownerElementName === ownerElementName &&
        candidate.parsed.ownerSourceId === ownerSourceId &&
        candidate.parsed.attributeType === NAME_ATTRIBUTE_TYPE
    )
    .map((candidate) => sliceSpan(text, candidate.span))
}

/**
 * Walk a model's group ancestry (innermost group first via `parentGroupId`) and return the chain
 * outermost-first, with the synthetic `Group.Root` container excluded — it is never a real folder.
 */
function groupChainFor(index: ArisSourceIndex, groupId: string | null): readonly ArisGroupRecord[] {
  const chain: ArisGroupRecord[] = []
  const seen = new Set<string>()
  let currentId = groupId
  while (currentId && currentId !== GROUP_ROOT_ID && !seen.has(currentId)) {
    seen.add(currentId)
    const group = index.groups.get(currentId)
    if (!group) break
    chain.push(group)
    currentId = group.parsed.parentGroupId
  }
  return chain.reverse()
}

/** Child `<CxnDef>` records of an object definition, keyed by the parent definition's source id. */
function connectionDefinitionsByParent(
  index: ArisSourceIndex
): ReadonlyMap<string, readonly ArisConnectionDefinitionRecord[]> {
  const byParent = new Map<string, ArisConnectionDefinitionRecord[]>()
  for (const record of index.connectionDefinitions.values()) {
    const parentId = record.parent?.sourceId
    if (!parentId) continue
    const list = byParent.get(parentId) ?? []
    list.push(record)
    byParent.set(parentId, list)
  }
  return byParent
}

/**
 * Verbatim slice of an object definition, with any child `<CxnDef>` whose id is not in
 * `keptConnectionDefinitionIds` cut out. Ranges are removed back-to-front so earlier offsets stay
 * valid, and the run of whitespace preceding each cut is swallowed so no dangling blank line is
 * left behind.
 */
function sliceObjectDefinition(
  text: string,
  definition: ArisObjectDefinitionRecord,
  childConnectionDefinitions: readonly ArisConnectionDefinitionRecord[],
  keptConnectionDefinitionIds: ReadonlySet<string>
): string {
  const start = definition.span.start.offset
  let slice = text.slice(start, definition.span.end.offset)
  const cuts = childConnectionDefinitions
    .filter((child) => {
      const id = child.parsed.connectionDefinitionId
      return id === null || !keptConnectionDefinitionIds.has(id)
    })
    .map((child) => ({
      start: child.span.start.offset - start,
      end: child.span.end.offset - start
    }))
    .sort((a, b) => a.start - b.start)

  for (let index = cuts.length - 1; index >= 0; index -= 1) {
    let cutStart = cuts[index]!.start
    const cutEnd = cuts[index]!.end
    while (cutStart > 0 && /\s/u.test(slice[cutStart - 1]!)) cutStart -= 1
    slice = slice.slice(0, cutStart) + slice.slice(cutEnd)
  }
  return slice
}

function uniqueOrdered<T extends { readonly span: XmlSpan }>(records: readonly T[]): readonly T[] {
  const seen = new Set<T>()
  const result: T[] = []
  for (const record of records) {
    if (seen.has(record)) continue
    seen.add(record)
    result.push(record)
  }
  return result.sort((a, b) => a.span.start.offset - b.span.start.offset)
}

/**
 * Build one standalone AML document per model in the package, each assembled entirely from
 * verbatim slices of `pkg.text`. See the module doc comment for the fidelity guarantees.
 */
export function buildArisSplitPlan(pkg: ArisXmlSourcePackage): ArisSplitPlan {
  const { text, index } = pkg
  const root = index.root
  const files: ArisSplitFile[] = []
  const skippedModelIds: string[] = []

  if (!root) {
    return Object.freeze({ files: Object.freeze(files), skippedModelIds: Object.freeze([]) })
  }

  // The prolog (XML declaration + DOCTYPE with the LocaleId entity declarations) is MANDATORY: it
  // is what lets every `&LocaleId…;` reference in the sliced records resolve on re-parse.
  const prolog = text.slice(0, root.span.start.offset).replace(/\s+$/u, '')
  const rootOpenTag = `<${root.elementName}${renderAttributes(rawAttributesToEmitted(root.rawAttributes))}>`
  const rootCloseTag = `</${root.elementName}>`

  const headerSlice = index.database ? sliceSpan(text, index.database.span) : null
  const languageSlices = index.languages.map((language) => sliceSpan(text, language.span))
  const fontStyleSheetSlices = [...index.styles.fontStyleSheets.values()].map((sheet) =>
    sliceSpan(text, sheet.span)
  )

  const childConnectionDefinitions = connectionDefinitionsByParent(index)

  for (const model of index.models.values()) {
    const modelId = model.parsed.modelId
    if (!modelId) {
      // A model with no id cannot be addressed or re-imported; retain it in the skip list rather
      // than emit a file that could never round-trip.
      skippedModelIds.push(model.sourceId ?? '(anonymous model)')
      continue
    }

    const occurrences = [...index.objectOccurrences.values()].filter(
      (occurrence) => occurrence.parsed.modelId === modelId
    )
    const referencedDefinitionIds = new Set(
      occurrences
        .map((occurrence) => occurrence.parsed.objectDefinitionId)
        .filter((id): id is string => id !== null)
    )
    const referencedDefinitions = uniqueOrdered(
      [...referencedDefinitionIds]
        .map((id) => index.objectDefinitions.get(id))
        .filter((record): record is ArisObjectDefinitionRecord => record !== undefined)
    )

    const keptConnectionDefinitionIds = new Set(
      [...index.connectionOccurrences.values()]
        .filter((occurrence) => occurrence.parsed.modelId === modelId)
        .map((occurrence) => occurrence.parsed.connectionDefinitionId)
        .filter((id): id is string => id !== null)
    )

    const referencedFreeTextDefinitionIds = new Set(
      index.freeTextOccurrences
        .filter((occurrence) => occurrence.parsed.modelId === modelId)
        .map((occurrence) => occurrence.parsed.freeTextDefinitionId)
        .filter((id): id is string => id !== null)
    )
    const freeTextSlices = uniqueOrdered(
      [...referencedFreeTextDefinitionIds]
        .map((id) => index.freeText.get(id))
        .filter((record) => record !== undefined)
    ).map((record) => sliceSpan(text, record.span))

    const referencedAttachmentIds = new Set(
      index.attachmentOccurrences
        .filter((occurrence) => occurrence.parsed.modelId === modelId)
        .map((occurrence) => occurrence.parsed.attachmentId)
        .filter((id): id is string => id !== null)
    )
    const attachmentSlices = uniqueOrdered(
      [...referencedAttachmentIds]
        .map((id) => index.attachments.get(id))
        .filter((record) => record !== undefined)
    ).map((record) => sliceSpan(text, record.span))

    // Definitions the model occurs, each with the connection definitions the model never uses
    // excised, then the whole model verbatim — the innermost content of the group chain.
    const definitionBlocks = referencedDefinitions.map((definition) =>
      sliceObjectDefinition(
        text,
        definition,
        childConnectionDefinitions.get(definition.sourceId ?? '') ?? [],
        keptConnectionDefinitionIds
      )
    )
    const modelSlice = sliceSpan(text, model.span)
    let innerContent = [...definitionBlocks, modelSlice].join('\n')

    const chain = groupChainFor(index, model.parsed.groupId)
    for (let depth = chain.length - 1; depth >= 0; depth -= 1) {
      const group = chain[depth]!
      const openTag = `<${group.elementName}${renderAttributes(
        rawAttributesToEmitted(group.rawAttributes)
      )}>`
      const attrDefSlices = nameAttrDefSlices(text, index, group.elementName, group.sourceId)
      innerContent = [openTag, ...attrDefSlices, innerContent, `</${group.elementName}>`].join('\n')
    }

    const documentText = `${[
      prolog,
      rootOpenTag,
      ...(headerSlice ? [headerSlice] : []),
      ...languageSlices,
      ...fontStyleSheetSlices,
      ...freeTextSlices,
      ...attachmentSlices,
      innerContent,
      rootCloseTag
    ].join('\n')}\n`

    const modelName = displayName(index, 'Model', model.sourceId)
    const folderSegments = chain.map((group) =>
      sanitizeArisPathSegment(
        displayName(index, group.elementName, group.sourceId) ?? group.parsed.groupId ?? ''
      )
    )

    files.push(
      Object.freeze({
        modelId,
        modelName,
        fileName: deriveSplitFileName(modelName, modelId),
        folderSegments: Object.freeze(folderSegments),
        text: documentText
      })
    )
  }

  return Object.freeze({
    files: Object.freeze(files),
    skippedModelIds: Object.freeze(skippedModelIds)
  })
}
