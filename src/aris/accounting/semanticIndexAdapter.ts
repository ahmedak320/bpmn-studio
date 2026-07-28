import type {
  ArisDocumentRootRecord,
  ArisGuidReferenceRecord,
  ArisLinkedModelAssignmentRecord,
  ArisSourceIndex,
  ArisSourceRecordBase
} from '../source/semanticIndex'
import type { ArisAccountingAssignment, ArisAccountingRecord, ArisAccountingSource } from './types'

/**
 * The single seam between the concrete semantic index and the narrow accounting
 * input interface.
 *
 * The rest of the accounting layer only knows about `ArisAccountingRecord` and
 * `ArisAccountingAssignment`. If another agent reshapes the semantic index, only
 * this adapter needs to change.
 */

function pushRecord(
  sink: ArisAccountingRecord[],
  record: ArisSourceRecordBase<Record<string, unknown>> | ArisDocumentRootRecord | ArisGuidReferenceRecord,
  recordKind: string,
  elementNameOverride?: string
): void {
  const parsed =
    'parsed' in record && record.parsed && typeof record.parsed === 'object'
      ? (record.parsed as Record<string, unknown>)
      : undefined

  sink.push({
    path: record.path,
    sourceId: 'sourceId' in record ? record.sourceId : null,
    recordKind,
    elementName: elementNameOverride ?? ('elementName' in record ? record.elementName : ''),
    parsedOwnerElementName:
      parsed && typeof parsed.ownerElementName === 'string' ? parsed.ownerElementName : null,
    parentElementName: 'parent' in record ? record.parent?.elementName ?? null : null
  })
}

function collectMapRecords(
  sink: ArisAccountingRecord[],
  map: ReadonlyMap<string, ArisSourceRecordBase<Record<string, unknown>>>,
  recordKind: string
): void {
  for (const record of map.values()) {
    pushRecord(sink, record, recordKind)
  }
}

function collectArrayRecords(
  sink: ArisAccountingRecord[],
  records: readonly ArisSourceRecordBase<Record<string, unknown>>[],
  recordKind: string,
  elementNameOverride?: (record: ArisSourceRecordBase<Record<string, unknown>>) => string | undefined
): void {
  for (const record of records) {
    pushRecord(sink, record, recordKind, elementNameOverride?.(record))
  }
}

function pushGuidReferences(
  sink: ArisAccountingRecord[],
  references: readonly ArisGuidReferenceRecord[]
): void {
  for (const reference of references) {
    sink.push({
      path: reference.path,
      sourceId: null,
      recordKind: 'guid-reference',
      elementName: reference.guidType,
      parsedOwnerElementName: null,
      parentElementName: reference.ownerElementName
    })
  }
}

function pushAssignments(
  sink: ArisAccountingAssignment[],
  assignments: readonly ArisLinkedModelAssignmentRecord[]
): void {
  for (const assignment of assignments) {
    sink.push({
      objectDefinitionId: assignment.objectDefinitionId,
      objectDefinitionPath: assignment.objectDefinitionPath,
      modelId: assignment.modelId
    })
  }
}

/**
 * Flatten a semantic index into the narrow shape the accounting layer expects.
 */
export function adaptSemanticIndex(index: ArisSourceIndex): ArisAccountingSource {
  const records: ArisAccountingRecord[] = []

  if (index.root) pushRecord(records, index.root, 'document-root')
  if (index.database) pushRecord(records, index.database, 'database')

  collectMapRecords(records, index.groups, 'group')
  collectArrayRecords(records, index.languages, 'language')
  collectMapRecords(records, index.models, 'model')
  collectMapRecords(records, index.objectDefinitions, 'object-definition')
  collectMapRecords(records, index.objectOccurrences, 'object-occurrence')
  collectMapRecords(records, index.connectionDefinitions, 'connection-definition')
  collectMapRecords(records, index.connectionOccurrences, 'connection-occurrence')
  collectArrayRecords(records, index.attributes, 'attribute')
  collectArrayRecords(records, index.attributeOccurrences, 'attribute-occurrence')
  collectMapRecords(records, index.lanes, 'lane')
  collectMapRecords(records, index.freeText, 'free-text')
  collectArrayRecords(records, index.freeTextOccurrences, 'free-text-occurrence')
  collectMapRecords(records, index.attachments, 'attachment')
  collectArrayRecords(records, index.attachmentOccurrences, 'attachment-occurrence')
  collectArrayRecords(records, index.blobs, 'blob')
  collectMapRecords(records, index.styles.fontStyleSheets, 'font-style-sheet')
  collectArrayRecords(records, index.styles.fonts, 'font')
  collectArrayRecords(records, index.styles.pens, 'pen')
  collectArrayRecords(records, index.styles.brushes, 'brush')
  collectArrayRecords(records, index.positions, 'position')
  collectArrayRecords(records, index.sizes, 'size')
  pushGuidReferences(records, index.guidReferences)
  collectArrayRecords(records, index.unknownRecords, 'unknown')
  collectArrayRecords(records, index.supersededRecords, 'superseded')

  const assignments: ArisAccountingAssignment[] = []
  pushAssignments(assignments, index.linkedModelAssignments)

  return Object.freeze({
    records: Object.freeze(records),
    assignments: Object.freeze(assignments)
  })
}
